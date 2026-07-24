-- ============================================================
-- Finance review gate: a new step between "stock check confirms an
-- item isn't available in-house" and "a sourcing bundle can be
-- created for it" — answers "should we pursue this," a different
-- question from the existing payment-stage finance approval on
-- expenses (which answers "release this payment"). Both stay in
-- place; this is additive.
--
-- Per confirmed decisions this round:
-- §2 scope: applies whenever the line's estimated value is >= 20% of
--   that cost group's current Remaining budget — not a flat floor.
--   Below that, it's auto-"exempt" and never shown to a human.
-- §3 escalation: no new authority tier. Any 'finance' role holder is
--   sufficient — matches how finance's existing sourcing_bundles
--   approval already works today (uncapped; only operations_manager
--   has a dollar cap, migration 133, unrelated to this gate).
-- §4 fallback: any finance role holder can act, always — no waiting
--   window. projects.finance_contact_id is a suggested/primary
--   contact for UI purposes only, never an access-control gate — this
--   matches the codebase's universal convention (every existing
--   approval gate is role-based, never identity-locked; confirmed no
--   precedent exists for a timed handoff anywhere in this schema).
--
-- finance_contact_id -> user_profiles(id), NOT staff(id): unlike
-- projects.project_manager_id (staff(id), migration 004), a finance
-- contact must be someone RLS can check against auth.uid(), i.e. a
-- real login/user_profiles row with role = 'finance' — a staff row
-- may have no login at all.
-- ============================================================

SET search_path TO public;

-- ── 1. projects.finance_contact_id ──────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS finance_contact_id UUID REFERENCES user_profiles(id);

-- Reassignment locked to admin even though projects' own UPDATE RLS
-- (049_role_access_alignment.sql) is broader (manager/finance can
-- update other project fields) — layered BEFORE UPDATE guard, same
-- pattern as block_manual_contract_value_edit (117).
CREATE OR REPLACE FUNCTION block_finance_contact_reassign_by_non_admin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.finance_contact_id IS DISTINCT FROM OLD.finance_contact_id AND get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can assign or reassign a project''s finance contact';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_finance_contact_reassign ON projects;
CREATE TRIGGER trg_block_finance_contact_reassign
  BEFORE UPDATE OF finance_contact_id ON projects
  FOR EACH ROW EXECUTE FUNCTION block_finance_contact_reassign_by_non_admin();

-- ── 2. finance_sourcing_reviews ──────────────────────────────────────
-- One row per order_item that needed a sourcing decision. 'exempt' is
-- computed automatically (below the 20%-of-remaining threshold) and
-- never shown as an actionable item; 'pending' is a real human
-- decision waiting; 'approved'/'rejected' are named, timestamped
-- decisions — same shape as rent_payment_requests (141).
CREATE TABLE IF NOT EXISTS finance_sourcing_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id  UUID NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'exempt')),
  reviewed_by    UUID REFERENCES user_profiles(id),
  reviewed_at    TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_sourcing_reviews_status ON finance_sourcing_reviews(status);

ALTER TABLE finance_sourcing_reviews ENABLE ROW LEVEL SECURITY;

-- Read: as open as order_items itself (021 — any authenticated user)
-- since this is visibility into why a line is or isn't sourceable,
-- not sensitive financial detail by itself.
DROP POLICY IF EXISTS "finance_sourcing_reviews_read" ON finance_sourcing_reviews;
CREATE POLICY "finance_sourcing_reviews_read" ON finance_sourcing_reviews FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Write (the actual decision): finance/admin only, matching §3's
-- confirmed "any finance role holder is sufficient" — no new
-- escalation tier. No INSERT policy: rows are only ever created by
-- ensure_finance_sourcing_review() (SECURITY DEFINER), never directly.
DROP POLICY IF EXISTS "finance_sourcing_reviews_write" ON finance_sourcing_reviews;
CREATE POLICY "finance_sourcing_reviews_write" ON finance_sourcing_reviews FOR UPDATE
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

GRANT SELECT, UPDATE ON finance_sourcing_reviews TO authenticated;

-- Stamp reviewer identity on the actual decision, never on the
-- system-computed 'exempt' status — same pattern as
-- stamp_rent_payment_request_approval (141).
CREATE OR REPLACE FUNCTION stamp_finance_sourcing_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_finance_sourcing_review ON finance_sourcing_reviews;
CREATE TRIGGER trg_stamp_finance_sourcing_review
  BEFORE UPDATE OF status ON finance_sourcing_reviews
  FOR EACH ROW EXECUTE FUNCTION stamp_finance_sourcing_review();

-- ── 3. Row creation: the moment a line is confirmed not sourceable
-- from stock ─────────────────────────────────────────────────────────
-- SECURITY DEFINER so the computed exemption is always based on a
-- full, accurate read of v_project_cost_group_budget (a
-- security_invoker view) regardless of which role's RLS grants
-- happened to trigger this — a fail-closed default (v_status :=
-- 'pending') covers every case where the amount can't be safely
-- assessed, rather than silently exempting on incomplete data.
CREATE OR REPLACE FUNCTION ensure_finance_sourcing_review(p_order_item_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item          RECORD;
  v_cost_group_id UUID;
  v_line_amount   NUMERIC;
  v_remaining     NUMERIC;
  v_is_provisional BOOLEAN;
  v_status        TEXT;
BEGIN
  SELECT oi.quantity, oi.unit_price_est, oi.sub_category_id, o.project_id
  INTO v_item
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT c.cost_group_id INTO v_cost_group_id
  FROM sub_categories sc JOIN categories c ON c.id = sc.parent_category_id
  WHERE sc.id = v_item.sub_category_id;

  IF v_item.project_id IS NULL OR v_cost_group_id IS NULL OR v_item.unit_price_est IS NULL THEN
    -- Unallocated category, no project, or no price estimate yet —
    -- can't safely compute a percentage. Same "can't assess, don't
    -- guess" default as budgetCheck.ts's own 'unavailable' outcome.
    v_status := 'pending';
  ELSE
    v_line_amount := COALESCE(v_item.quantity, 0) * v_item.unit_price_est;

    SELECT remaining_amount, is_provisional INTO v_remaining, v_is_provisional
    FROM v_project_cost_group_budget
    WHERE project_id = v_item.project_id AND cost_group_id = v_cost_group_id;

    IF NOT FOUND OR v_is_provisional OR v_remaining <= 0 THEN
      v_status := 'pending';
    ELSIF v_line_amount >= 0.20 * v_remaining THEN
      v_status := 'pending';
    ELSE
      v_status := 'exempt';
    END IF;
  END IF;

  INSERT INTO finance_sourcing_reviews (order_item_id, status)
  VALUES (p_order_item_id, v_status)
  ON CONFLICT (order_item_id) DO NOTHING;
END;
$$;

-- ── 4. Hook into both places a line can be confirmed "not in stock" ──
-- (a) check_and_fulfill_from_stock (115) already runs for any line
-- WITH a stock_item_id — extend its two existing no-stock-available
-- early-return branches. Signature/return type unchanged, so a plain
-- CREATE OR REPLACE is safe (no DROP needed, unlike 115's own change).
CREATE OR REPLACE FUNCTION check_and_fulfill_from_stock(p_order_item_id UUID)
RETURNS TABLE(proposed_qty NUMERIC, remaining_qty NUMERIC, new_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item      RECORD;
  v_on_hand   NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT oi.* INTO v_item FROM order_items oi WHERE oi.id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found';
  END IF;

  IF COALESCE(v_item.quantity, 0) <= 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, COALESCE(v_item.quantity, 0), v_item.status;
    RETURN;
  END IF;

  IF v_item.stock_item_id IS NULL THEN
    PERFORM ensure_finance_sourcing_review(p_order_item_id);
    RETURN QUERY SELECT 0::NUMERIC, v_item.quantity, v_item.status;
    RETURN;
  END IF;

  SELECT qty_on_hand INTO v_on_hand FROM v_stock_on_hand WHERE stock_item_id = v_item.stock_item_id;
  v_on_hand := GREATEST(COALESCE(v_on_hand, 0), 0);

  IF v_on_hand <= 0 THEN
    PERFORM ensure_finance_sourcing_review(p_order_item_id);
    RETURN QUERY SELECT 0::NUMERIC, v_item.quantity, v_item.status;
    RETURN;
  END IF;

  UPDATE order_items
  SET status = 'stock_pending_dispatch',
      stock_dispatch_qty = LEAST(v_on_hand, v_item.quantity),
      fulfillment_notes = TRIM(BOTH E'\n' FROM COALESCE(fulfillment_notes || E'\n', '') ||
        format('%s %s available from stock as of %s — awaiting stock officer sign-off and transport assignment',
               LEAST(v_on_hand, v_item.quantity), COALESCE(unit, ''), CURRENT_DATE))
  WHERE id = p_order_item_id;

  RETURN QUERY SELECT LEAST(v_on_hand, v_item.quantity), (v_item.quantity - LEAST(v_on_hand, v_item.quantity)), 'stock_pending_dispatch'::TEXT;
END;
$$;

-- (b) A line with NO stock_item_id at all never goes through the RPC
-- above — the frontend only calls it "for every new/pending line WITH
-- a stock_item_id" (OrderFormPage.tsx). Such a line is unambiguously
-- "not available in-house" the moment it's saved, so a trigger
-- catches it directly rather than depending on frontend behavior.
CREATE OR REPLACE FUNCTION trg_order_item_ensure_finance_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stock_item_id IS NULL AND NEW.status = 'pending' AND COALESCE(NEW.quantity, 0) > 0 THEN
    PERFORM ensure_finance_sourcing_review(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_item_ensure_finance_review ON order_items;
CREATE TRIGGER trg_order_item_ensure_finance_review
  AFTER INSERT OR UPDATE OF stock_item_id, status, quantity ON order_items
  FOR EACH ROW EXECUTE FUNCTION trg_order_item_ensure_finance_review();

-- ── 5. The actual gate: block sourcing until cleared ─────────────────
-- Server-side enforcement, not just hidden UI — even a direct API
-- call inserting into sourcing_bundle_items is blocked here.
CREATE OR REPLACE FUNCTION enforce_finance_review_before_sourcing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM finance_sourcing_reviews WHERE order_item_id = NEW.order_item_id;
  IF v_status IS NOT NULL AND v_status NOT IN ('exempt', 'approved') THEN
    RAISE EXCEPTION 'This request needs a finance review before it can be sourced (current status: %)', v_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_finance_review_before_sourcing ON sourcing_bundle_items;
CREATE TRIGGER trg_enforce_finance_review_before_sourcing
  BEFORE INSERT ON sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_review_before_sourcing();

-- Verify
SELECT column_name FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'finance_contact_id';
SELECT tablename FROM pg_tables WHERE tablename = 'finance_sourcing_reviews';
SELECT proname FROM pg_proc WHERE proname IN ('ensure_finance_sourcing_review', 'check_and_fulfill_from_stock', 'trg_order_item_ensure_finance_review', 'enforce_finance_review_before_sourcing');
SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_block_finance_contact_reassign', 'trg_stamp_finance_sourcing_review', 'trg_order_item_ensure_finance_review', 'trg_enforce_finance_review_before_sourcing') ORDER BY tgname;
