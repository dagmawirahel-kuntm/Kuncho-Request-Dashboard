-- ============================================================
-- Site delivery confirmation + return-to-stock — closes two real
-- gaps surfaced by inspecting the existing materials chain:
--
-- 1. Depletion by project already works (stock_issues.project_id has
--    tracked this since day one) but nothing on the SITE side ever
--    confirms a dispatch actually arrived — sign_off_stock_dispatch
--    (115) records what the WAREHOUSE claims it sent, and that's
--    final. A truck could lose a third of its load in transit and
--    the system would never know.
--
-- 2. stock_receipts.receipt_type has carried 'site_return' as a valid
--    value since the very first stock migration (022b) — nothing has
--    ever written one. There is no "project finished, unused
--    materials are coming back" flow at all today.
--
-- Per confirmed decisions:
-- - Site confirmer = the project's own assigned project_manager_id
--   (matches finance_contact_id's precedent: an identity-scoped gate,
--   not a role-wide one — a PM should only confirm deliveries to
--   their own project). admin/manager/operations_manager included as
--   the same standing fallback used for every other identity-scoped
--   gate this project has built, so one person's absence can't stall
--   a whole project's material flow.
-- - A quantity-confirmed mismatch is FLAGGED, never auto-adjusts
--   stock_issues/stock_receipts — a human (stock_manager/procurement_
--   officer) decides what a shortfall actually means.
-- - Return-to-stock is two-sided, mirroring the existing GRN
--   segregation of duties: the project side reports what's coming
--   back (a request, no stock effect yet); only stock_manager (the
--   warehouse side) confirming receipt creates the real stock_receipts
--   row that actually restores the quantity.
-- ============================================================

SET search_path TO public;

-- ── Shared identity-scoping helpers ──────────────────────────────────
-- Mirrors useMyStaffId()'s own resolution order (explicit user_id link
-- wins, else a case-insensitive email match) so "is this the project's
-- own PM" means the same thing server-side as it already does
-- client-side everywhere else.
--
-- THE canonical definition of this pair, defined here because this is
-- the earliest migration that needs it. Migration 155 uses the same two
-- functions for its own project-manager scoping rather than declaring a
-- second pair — one answer to "who am I" and "do I manage this", not two
-- that can drift apart. Do not add a third; extend these.
--
-- Written as plain SQL (not plpgsql) in one query rather than two
-- sequential lookups: DESC NULLS LAST is what keeps the explicit link
-- ahead of the email match, because for an unlinked row (user_id NULL)
-- the comparison is NULL and a bare DESC would sort those FIRST in
-- Postgres — silently inverting the precedence rule.
CREATE OR REPLACE FUNCTION current_staff_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id
  FROM staff s
  WHERE auth.uid() IS NOT NULL
    AND (
      s.user_id = auth.uid()
      OR (s.email IS NOT NULL
          AND lower(s.email) = lower((SELECT u.email FROM auth.users u WHERE u.id = auth.uid())))
    )
  ORDER BY (s.user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION current_staff_id() TO authenticated;

-- SECURITY DEFINER and owned by the migration role, so reading projects
-- here is not itself subject to projects' RLS — no recursion when this
-- is called from a policy on another table.
CREATE OR REPLACE FUNCTION manages_project(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND p.project_manager_id IS NOT NULL
      AND p.project_manager_id = current_staff_id()
  );
$$;

GRANT EXECUTE ON FUNCTION manages_project(UUID) TO authenticated;

-- Earlier drafts of this migration shipped the same two helpers under
-- the names is_my_managed_project/my_staff_id. Dropped so no environment
-- that ran one of those drafts is left with a second, diverging copy.
-- No-ops everywhere else. Order matters: is_my_managed_project called
-- my_staff_id, so the dependent goes first.
DROP FUNCTION IF EXISTS is_my_managed_project(UUID);
DROP FUNCTION IF EXISTS my_staff_id();

-- ── 1. Site delivery confirmation ───────────────────────────────────
-- One row per stock_issues dispatch — its absence IS "not yet
-- confirmed," so no status column is needed (this is a one-time
-- act, not a multi-stage approval like the gates elsewhere in this
-- project).
CREATE TABLE IF NOT EXISTS stock_delivery_confirmations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_issue_id      UUID NOT NULL UNIQUE REFERENCES stock_issues(id) ON DELETE CASCADE,
  quantity_confirmed  NUMERIC(10,2) NOT NULL,
  condition_notes     TEXT,
  confirmed_by        UUID REFERENCES user_profiles(id),
  confirmed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stock_delivery_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_delivery_confirmations_read" ON stock_delivery_confirmations;
CREATE POLICY "stock_delivery_confirmations_read" ON stock_delivery_confirmations FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Insert-only (never edited/withdrawn once recorded — same
-- append-only discipline used for staff_ffe_skill_ratings, 140).
-- Identity-scoped: the project's own PM, or the standing
-- admin/manager/operations_manager fallback.
DROP POLICY IF EXISTS "stock_delivery_confirmations_insert" ON stock_delivery_confirmations;
CREATE POLICY "stock_delivery_confirmations_insert" ON stock_delivery_confirmations FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin', 'manager', 'operations_manager')
    OR (
      get_user_role() = 'project_manager'
      AND EXISTS (
        SELECT 1 FROM stock_issues si WHERE si.id = stock_issue_id AND manages_project(si.project_id)
      )
    )
  );

GRANT SELECT, INSERT ON stock_delivery_confirmations TO authenticated;

-- Server-stamped regardless of what the client sends — same
-- tamper-resistance reasoning as every other named-approval trigger
-- in this project.
CREATE OR REPLACE FUNCTION stamp_stock_delivery_confirmation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.confirmed_by := auth.uid();
  NEW.confirmed_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_stock_delivery_confirmation ON stock_delivery_confirmations;
CREATE TRIGGER trg_stamp_stock_delivery_confirmation
  BEFORE INSERT ON stock_delivery_confirmations
  FOR EACH ROW EXECUTE FUNCTION stamp_stock_delivery_confirmation();

-- Discrepancy is computed, never stored — dispatched vs confirmed
-- quantity, flagged for stock_manager/procurement_officer follow-up.
-- Nothing here touches stock_issues/stock_receipts (§ "flag, don't
-- auto-correct").
CREATE OR REPLACE VIEW v_stock_delivery_confirmations
WITH (security_invoker = true) AS
SELECT
  si.id AS stock_issue_id,
  si.stock_item_id,
  st.item_name AS stock_item_name,
  si.project_id,
  p.project_name,
  si.quantity AS quantity_dispatched,
  si.issued_date,
  si.transport_request_id,
  dc.id AS confirmation_id,
  dc.quantity_confirmed,
  dc.condition_notes,
  dc.confirmed_by,
  dc.confirmed_at,
  (dc.id IS NOT NULL) AS is_confirmed,
  (dc.id IS NOT NULL AND dc.quantity_confirmed IS DISTINCT FROM si.quantity) AS has_discrepancy
FROM stock_issues si
JOIN stock_items st ON st.id = si.stock_item_id
LEFT JOIN projects p ON p.id = si.project_id
LEFT JOIN stock_delivery_confirmations dc ON dc.stock_issue_id = si.id
WHERE si.issue_type = 'project_use';

GRANT SELECT ON v_stock_delivery_confirmations TO authenticated;

-- ── 2. Return to stock ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_return_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id       UUID NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
  project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
  quantity_requested  NUMERIC(10,2) NOT NULL CHECK (quantity_requested > 0),
  quantity_received   NUMERIC(10,2),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'rejected')),
  notes               TEXT,
  requested_by        UUID REFERENCES user_profiles(id),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by        UUID REFERENCES user_profiles(id),
  confirmed_at        TIMESTAMPTZ,
  stock_receipt_id    UUID REFERENCES stock_receipts(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_return_requests_status ON stock_return_requests(status);

ALTER TABLE stock_return_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_return_requests_read" ON stock_return_requests;
CREATE POLICY "stock_return_requests_read" ON stock_return_requests FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Initiating a return: same identity-scoped + standing-fallback shape
-- as delivery confirmation above.
DROP POLICY IF EXISTS "stock_return_requests_insert" ON stock_return_requests;
CREATE POLICY "stock_return_requests_insert" ON stock_return_requests FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin', 'manager', 'operations_manager')
    OR (get_user_role() = 'project_manager' AND (project_id IS NULL OR manages_project(project_id)))
  );

-- Confirming/rejecting: the warehouse side — same roles as GRN intake
-- (63) and stock dispatch sign-off (115).
DROP POLICY IF EXISTS "stock_return_requests_confirm" ON stock_return_requests;
CREATE POLICY "stock_return_requests_confirm" ON stock_return_requests FOR UPDATE
  USING (get_user_role() IN ('admin', 'stock_manager', 'logistics_officer') AND status = 'pending')
  WITH CHECK (get_user_role() IN ('admin', 'stock_manager', 'logistics_officer'));

GRANT SELECT, INSERT, UPDATE ON stock_return_requests TO authenticated;

CREATE OR REPLACE FUNCTION stamp_stock_return_request()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.requested_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_stock_return_request ON stock_return_requests;
CREATE TRIGGER trg_stamp_stock_return_request
  BEFORE INSERT ON stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION stamp_stock_return_request();

-- The actual stock effect: only fires the moment status reaches
-- 'received' — a real stock_receipts row, receipt_type='site_return',
-- restoring the confirmed quantity (never the originally-requested
-- one, if they differ) to the warehouse. Rejection leaves stock
-- untouched entirely. SECURITY DEFINER so stock_manager doesn't need
-- (and isn't granted) direct INSERT on stock_receipts to do this —
-- the same segregation-of-duties shape as mark_bundle_fulfilled_on_grn
-- (63) and receipt_catalogued_stock_item (109).
CREATE OR REPLACE FUNCTION confirm_stock_return()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt_id UUID;
BEGIN
  IF NEW.status = 'received' AND OLD.status IS DISTINCT FROM 'received' THEN
    NEW.confirmed_by := auth.uid();
    NEW.confirmed_at := NOW();
    IF NEW.quantity_received IS NULL THEN
      NEW.quantity_received := NEW.quantity_requested;
    END IF;

    INSERT INTO stock_receipts (stock_item_id, quantity, receipt_type, destination, received_date, notes)
    VALUES (
      NEW.stock_item_id, NEW.quantity_received, 'site_return', 'warehouse', CURRENT_DATE,
      'Return to stock' || (SELECT ' from ' || project_name FROM projects WHERE id = NEW.project_id) || COALESCE(' — ' || NEW.notes, '')
    )
    RETURNING id INTO v_receipt_id;

    NEW.stock_receipt_id := v_receipt_id;
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    NEW.confirmed_by := auth.uid();
    NEW.confirmed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_confirm_stock_return ON stock_return_requests;
CREATE TRIGGER trg_confirm_stock_return
  BEFORE UPDATE OF status ON stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION confirm_stock_return();

-- Verify
SELECT proname FROM pg_proc WHERE proname IN ('current_staff_id', 'manages_project', 'confirm_stock_return');
SELECT tablename FROM pg_tables WHERE tablename IN ('stock_delivery_confirmations', 'stock_return_requests') ORDER BY tablename;
SELECT viewname FROM pg_views WHERE viewname = 'v_stock_delivery_confirmations';
SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_stamp_stock_delivery_confirmation', 'trg_stamp_stock_return_request', 'trg_confirm_stock_return') ORDER BY tgname;
