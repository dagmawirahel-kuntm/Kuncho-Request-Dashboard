-- ============================================================
-- Approval-chain collapse (Parts A1, A2, A4 of the authority-matrix
-- decisions) plus an urgent repair to fallout from migration 149's
-- `manager` -> `executive` enum rename.
--
-- SECTION 0 IS A HOTFIX AND SHOULD BE READ FIRST.
-- ============================================================

SET search_path TO public;

-- ============================================================
-- 0. HOTFIX — repair function bodies orphaned by the enum rename
--
-- `ALTER TYPE user_role RENAME VALUE 'manager' TO 'executive'` (mig
-- 149 §1) rewrites RLS policy expressions, because those are stored
-- as parsed node trees that reference the enum by OID. It does NOT
-- rewrite PL/pgSQL function bodies, which are stored as plain TEXT
-- in pg_proc.prosrc. Every `IN ('manager', ...)` comparison inside a
-- function therefore survived the rename as a now-invalid literal
-- and raises at runtime:
--
--     invalid input value for enum user_role: "manager"
--
-- Eight functions were affected. Verified broken in production, not
-- theorised: a probe evaluating `v_role NOT IN ('manager','admin')`
-- against a live user_role variable raised the error above.
--
-- Blast radius while broken:
--   - enforce_{expense,order,cash_advance,payroll,sale}_approval_transitions
--     -> the pending -> first-tier-approved / rejected branch throws,
--        so nothing pending could be approved OR rejected.
--   - restrict_project_budgeting_field_edits -> throws on its FIRST
--        statement, so stage/progress/health/budget edits were blocked
--        for every role including admin.
--   - sign_off_stock_dispatch -> same, throws on entry for all roles.
--   - enforce_fuel_expense_requester -> throws on fuel expenses only.
--
-- expenses/orders are rewritten wholesale in section 3 below, so they
-- are not patched here — that would write them twice. The remaining
-- six are repaired now, preserving their existing logic exactly and
-- changing only the dead enum literal.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_cash_advance_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role NOT IN ('executive', 'admin') THEN
        RAISE EXCEPTION 'Only an Executive can approve or reject a pending cash advance';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();
    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can give final approval or reject an executive-approved cash advance';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;
    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;
    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION enforce_payroll_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role NOT IN ('executive', 'admin') THEN
        RAISE EXCEPTION 'Only an Executive can approve or reject a pending payroll run';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can give final approval or reject an executive-approved payroll run';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;

    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;

  -- Marking a run paid requires finance approval, by finance/admin only
  IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    IF NEW.approval_status <> 'finance_approved' THEN
      RAISE EXCEPTION 'A payroll run must be finance-approved before it can be marked paid';
    END IF;
    IF v_role NOT IN ('finance', 'admin') THEN
      RAISE EXCEPTION 'Only Finance can mark a payroll run as paid';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION enforce_sale_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role NOT IN ('executive', 'admin') THEN
        RAISE EXCEPTION 'Only an Executive can approve or reject a pending sale';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();
    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can give final approval or reject an executive-approved sale';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;
    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;
    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION enforce_fuel_expense_requester()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.expense_type = 'fuel' AND (TG_OP = 'INSERT' OR OLD.expense_type IS DISTINCT FROM 'fuel') THEN
    IF get_user_role() NOT IN ('admin', 'executive', 'logistics_officer')
       AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true) THEN
      RAISE EXCEPTION 'Only fleet managers can submit a fuel request';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION restrict_project_budgeting_field_edits()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF get_user_role() IN ('admin', 'executive', 'finance', 'operations_manager') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admin, executive, finance or operations_manager can edit stage, progress, health, or budget fields on a project';
END;
$fn$;

-- sign_off_stock_dispatch: only the guard clause and its message
-- change. The body below is otherwise byte-identical to the live
-- definition.
CREATE OR REPLACE FUNCTION sign_off_stock_dispatch(
  p_order_item_id uuid,
  p_transport_request_id uuid DEFAULT NULL::uuid,
  p_quantity numeric DEFAULT NULL::numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_item        RECORD;
  v_req_project UUID;
  v_on_hand     NUMERIC;
  v_qty         NUMERIC;
  v_avg_cost    NUMERIC;
  v_transport_id UUID;
  v_new_status  TEXT;
  v_bundle_item RECORD;
  v_locked_note TEXT := '';
BEGIN
  IF get_user_role() NOT IN ('admin', 'executive', 'stock_manager', 'procurement_officer') THEN
    RAISE EXCEPTION 'Only admin, executive, stock_manager, or procurement_officer can sign off a stock dispatch';
  END IF;

  SELECT oi.*, o.project_id AS proj_id INTO v_item
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found';
  END IF;
  IF v_item.status <> 'stock_pending_dispatch' THEN
    RAISE EXCEPTION 'Order item % is not pending stock dispatch (status = %)', p_order_item_id, v_item.status;
  END IF;

  v_req_project := v_item.proj_id;
  v_qty := COALESCE(p_quantity, v_item.stock_dispatch_qty);
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'No quantity to dispatch';
  END IF;

  -- Re-verify on-hand NOW, not the stale figure from when the PR was
  -- saved — this is what stands in for a real reservation/hold.
  SELECT qty_on_hand, avg_unit_cost INTO v_on_hand, v_avg_cost
  FROM v_stock_on_hand WHERE stock_item_id = v_item.stock_item_id;
  IF COALESCE(v_on_hand, 0) < v_qty THEN
    RAISE EXCEPTION 'Only % on hand now — not enough to dispatch % (stock was likely committed elsewhere since this PR was saved)', COALESCE(v_on_hand, 0), v_qty;
  END IF;

  IF p_transport_request_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM transportation_requests WHERE id = p_transport_request_id) THEN
      RAISE EXCEPTION 'Transport request not found';
    END IF;
    v_transport_id := p_transport_request_id;
  ELSE
    -- No existing job named — open a new dispatch job in the existing
    -- transportation module rather than inventing a parallel one.
    INSERT INTO transportation_requests (
      request_name, job_type, pickup_location_text, project_id, requested_by_id, requested_date, job_status, notes
    ) VALUES (
      format('Stock dispatch: %s', (SELECT item_name FROM stock_items WHERE id = v_item.stock_item_id)),
      'material_move',
      'Workshop/Warehouse',
      v_req_project,
      auth.uid(),
      CURRENT_DATE,
      'requested',
      format('Auto-created at stock dispatch sign-off for order item %s', p_order_item_id)
    )
    RETURNING id INTO v_transport_id;
  END IF;

  INSERT INTO stock_issues (stock_item_id, quantity, issue_type, project_id, order_item_id, transport_request_id, unit_cost_snapshot, issued_date)
  VALUES (v_item.stock_item_id, v_qty, 'project_use', v_req_project, p_order_item_id, v_transport_id, v_avg_cost, CURRENT_DATE);

  v_new_status := CASE WHEN v_qty >= v_item.quantity THEN 'stock_fulfilled' ELSE 'partially_sourced' END;

  FOR v_bundle_item IN
    SELECT sbi.id, sbi.quantity_actual
    FROM sourcing_bundle_items sbi
    JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id
    WHERE sbi.order_item_id = p_order_item_id
      AND sb.status = 'drafting'
  LOOP
    UPDATE sourcing_bundle_items
    SET quantity_actual = GREATEST(COALESCE(v_bundle_item.quantity_actual, 0) - v_qty, 0),
        notes = TRIM(BOTH chr(10) FROM COALESCE(notes || chr(10), '') ||
          format('%s %s covered from stock at dispatch sign-off on %s — quantity reduced accordingly', v_qty, COALESCE(v_item.unit, ''), CURRENT_DATE))
    WHERE id = v_bundle_item.id;
  END LOOP;

  -- Bundles past drafting are frozen at the DB level (056) — can't
  -- touch quantity_actual or notes there even if we wanted to. Fold
  -- the overlap into the order_item's own note instead.
  FOR v_bundle_item IN
    SELECT sb.bundle_code, sb.status
    FROM sourcing_bundle_items sbi
    JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id
    WHERE sbi.order_item_id = p_order_item_id
      AND sb.status IN ('submitted', 'approved', 'ordered', 'fulfilled')
  LOOP
    v_locked_note := v_locked_note || format(chr(10) || 'Also bundled in %s (%s) — quantity NOT auto-adjusted there (frozen past drafting), review manually.',
      COALESCE(v_bundle_item.bundle_code, 'a sourcing bundle'), v_bundle_item.status);
  END LOOP;

  UPDATE order_items
  SET status = v_new_status,
      stock_dispatch_qty = NULL,
      fulfillment_notes = TRIM(BOTH chr(10) FROM COALESCE(fulfillment_notes || chr(10), '') ||
        format('%s %s signed off and dispatched on %s, transport job %s', v_qty, COALESCE(unit, ''), CURRENT_DATE, v_transport_id) ||
        v_locked_note)
  WHERE id = p_order_item_id;

  RETURN v_transport_id;
END;
$fn$;

-- ============================================================
-- 1. (Decision A1) Retire the legacy manager_* policies on orders
--    and expenses now that explicit replacements are live.
--
-- Migration 149 §1b already created accurately-named policies that
-- reproduce these grants exactly. Keeping both would leave two
-- policies expressing one rule. Verified equivalent before dropping:
--
--   manager_read_expenses   (SELECT executive|finance)
--     == expenses_executive_read  ∪ expenses_finance_read
--   manager_update_expenses (UPDATE executive)
--     == expenses_executive_update
--   manager_write_expenses  (INSERT CHECK executive)
--     == expenses_executive_insert
--   manager_read_orders     (SELECT executive|finance)
--     == orders_executive_read    ∪ orders_finance_read
--   manager_write_orders    (INSERT CHECK executive)
--     == orders_executive_insert
--
-- Finance's SELECT path on both tables is preserved by the
-- *_finance_read policies — that was the load-bearing grant behind
-- the Payment Hub, the expense list and every finance approval
-- screen, and it is why these were replaced rather than deleted.
--
-- Policies elsewhere that merely list `executive` as one entry in a
-- legitimate multi-role grant are deliberately left alone: a grant
-- to a role with no current holders is a headcount fact, not cruft.
-- ============================================================

DROP POLICY IF EXISTS "manager_read_expenses"   ON expenses;
DROP POLICY IF EXISTS "manager_update_expenses" ON expenses;
DROP POLICY IF EXISTS "manager_write_expenses"  ON expenses;
DROP POLICY IF EXISTS "manager_read_orders"     ON orders;
DROP POLICY IF EXISTS "manager_write_orders"    ON orders;

-- ============================================================
-- 2. (Decision A2) Enforce the ETB 50,000 Procurement Officer cap on
--    sourcing bundle approval.
--
-- The documented authority matrix caps a Procurement Officer at
-- 50,000, but nothing enforced it on bundles: `sourcing_bundles_policy`
-- was FOR ALL with no amount predicate, so a Procurement Officer
-- could approve a bundle of any size. The only 50,000 in the schema
-- was expenses.requires_finance_approval, which is unrelated.
--
-- Two things this deliberately does NOT do:
--
--  a) It does not cap Procurement Officers' ability to *edit* large
--     bundles. Assembling a >50k bundle is their core job; only the
--     transition to `approved` is capped. The cap therefore lives in
--     WITH CHECK (which sees the NEW row) and not in USING.
--
--  b) It does not narrow SELECT. The old policy was FOR ALL, which
--     includes SELECT — splitting it naively into an UPDATE-only
--     rule would silently revoke read access. Read/insert/delete are
--     restated verbatim for the same four roles.
--
-- The existing operations_manager <= 500,000 cap
-- (ops_manager_approve_capped_bundles) is untouched, and admin
-- remains uncapped as the de facto top tier (decision A3 — no new
-- CEO/MD role is invented here).
-- ============================================================

DROP POLICY IF EXISTS "sourcing_bundles_policy" ON sourcing_bundles;

DROP POLICY IF EXISTS "sourcing_bundles_read" ON sourcing_bundles;
CREATE POLICY "sourcing_bundles_read" ON sourcing_bundles FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin','executive','finance','procurement_officer']::user_role[]));

DROP POLICY IF EXISTS "sourcing_bundles_insert" ON sourcing_bundles;
CREATE POLICY "sourcing_bundles_insert" ON sourcing_bundles FOR INSERT
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','executive','finance','procurement_officer']::user_role[]));

DROP POLICY IF EXISTS "sourcing_bundles_delete" ON sourcing_bundles;
CREATE POLICY "sourcing_bundles_delete" ON sourcing_bundles FOR DELETE
  USING (get_user_role() = ANY (ARRAY['admin','executive','finance','procurement_officer']::user_role[]));

-- admin / executive / finance: uncapped update, as before.
DROP POLICY IF EXISTS "sourcing_bundles_update_uncapped" ON sourcing_bundles;
CREATE POLICY "sourcing_bundles_update_uncapped" ON sourcing_bundles FOR UPDATE
  USING      (get_user_role() = ANY (ARRAY['admin','executive','finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','executive','finance']::user_role[]));

-- procurement_officer: may edit any bundle, but may only leave it in
-- `approved` when total_value <= 50,000. Above that the bundle has to
-- go to an Operations Manager (<= 500,000) or an admin.
DROP POLICY IF EXISTS "sourcing_bundles_update_procurement_capped" ON sourcing_bundles;
CREATE POLICY "sourcing_bundles_update_procurement_capped" ON sourcing_bundles FOR UPDATE
  USING (get_user_role() = 'procurement_officer')
  WITH CHECK (
    get_user_role() = 'procurement_officer'
    AND (status <> 'approved' OR COALESCE(total_value, 0) <= 50000)
  );

COMMENT ON POLICY "sourcing_bundles_update_procurement_capped" ON sourcing_bundles IS
  'Procurement Officer approval cap: may build and edit bundles of any size, but cannot set status=approved above ETB 50,000.';

-- ============================================================
-- 3. (Decision A4) Collapse the purchase-request / expense approval
--    ladder.
--
-- Both `orders` and `expenses` carried a `pending -> manager_approved`
-- first rung that maps to nothing in the authority matrix. Because
-- its role check resolved to admin-or-executive and there are no
-- executive holders, it functioned in practice as an admin-only
-- bottleneck on every purchase request and every expense — the
-- unexplainable extra step.
--
-- Columns, enum labels and all historical values are KEPT. There are
-- live rows in these states (orders: 2 finance_approved; expenses: 3
-- finance_approved, 1 manager_approved) and the audit trail is worth
-- more than the tidiness of dropping a column.
--
-- 3a. orders.approval_status stops gating anything at all. The real
--     gates in the Materials chain are the pre-sourcing finance
--     review and bundle approval by amount (section 2), both of which
--     sit downstream of the PR.
-- ============================================================

DROP TRIGGER IF EXISTS trg_enforce_order_approval_transitions ON orders;
DROP FUNCTION IF EXISTS enforce_order_approval_transitions();

COMMENT ON COLUMN orders.approval_status IS
  'RETAINED FOR HISTORY ONLY — gates nothing as of migration 163. The purchase request itself is no longer an approval step; authority is exercised downstream at pre-sourcing finance review and at bundle approval by amount. Existing values are preserved audit trail.';

-- ------------------------------------------------------------
-- 3b. expenses keep exactly one gate: finance approval, which is
--     what releases the expense to payment (the trigger
--     sync_expense_payment_state_on_finance_approval flips
--     payment_state to approved_to_pay, and disbursement segregation
--     via disbursed_by is enforced separately).
--
--     `pending -> finance_approved` is now a single hop by
--     finance/admin. The old `manager_approved -> finance_approved`
--     hop is retained solely so the one live row sitting in
--     manager_approved has a legal path forward; nothing can enter
--     manager_approved any more.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_expense_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN

    -- The live gate: finance releases the expense to payment.
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can approve or reject an expense';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    -- Legacy path: drains rows stranded in manager_approved by the
    -- retired first rung. No new row can reach this state.
    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can approve or reject an expense';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      -- Resubmission after a rejection clears the prior approval trail.
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;

    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON COLUMN expenses.approval_status IS
  'Single gate as of migration 163: pending -> finance_approved by finance/admin, which releases the expense to payment. The manager_approved rung is retired; the label survives for historical rows only.';
