-- ============================================================
-- Security audit fix: get_user_role() NULL-bypass in in-body role
-- checks, across every function the audit found using the buggy
-- pattern `IF get_user_role() NOT IN (...)` / `<> x` / `!= x` (or a
-- local variable assigned from get_user_role() compared the same
-- way).
--
-- get_user_role() is:
--   SELECT role FROM public.user_profiles
--   WHERE id = auth.uid() AND account_status = 'active'
-- and returns NULL for an unauthenticated caller OR an authenticated
-- but inactive/role-less user_profiles row.
--
-- `NULL NOT IN (...)` and `NULL <> x` both evaluate to NULL in SQL,
-- and PL/pgSQL's IF treats a NULL condition exactly like FALSE — so
-- `IF get_user_role() NOT IN ('admin','finance') THEN RAISE
-- EXCEPTION ... END IF;` silently does NOT raise when get_user_role()
-- is NULL. The guard clause no-ops instead of failing closed.
--
-- This is a LIVE vulnerability for SECURITY DEFINER functions (they
-- bypass RLS entirely, so the in-body check is their ONLY gate) that
-- are also EXECUTE-reachable by anon. This project's CREATE FUNCTION
-- default grants EXECUTE to PUBLIC, and Postgres ACLs are additive —
-- a role has whatever is granted to it directly PLUS whatever is
-- granted to PUBLIC — so revoking only from anon is not enough while
-- PUBLIC still holds the grant (confirmed live for the BOQ
-- change-order fix in migration 212: `REVOKE ... FROM PUBLIC, anon`
-- was required, not just `FROM anon`).
--
-- Fix pattern (matches migration 212's established style):
--   - Simple case: `IF get_user_role() NOT IN (...)` becomes
--     `IF get_user_role() IS NULL OR get_user_role() NOT IN (...)`.
--   - Compound/multi-branch case: fold `v_role IS NULL OR` (or
--     `get_user_role() IS NULL OR`) into the specific compound
--     condition that used it, preserving the original logic exactly
--     otherwise.
-- Nothing else changes: no refactoring, no renamed params, no
-- SECURITY DEFINER/INVOKER changes, no changes to which roles are
-- authorized — only the NULL-bypass gap is closed.
--
-- Trigger functions (RETURNS trigger) get no REVOKE statement —
-- Postgres does not allow direct SQL calls to trigger functions, so
-- an EXECUTE grant on one is inert.
--
-- Every non-trigger function below also gets
-- `REVOKE EXECUTE ... FROM PUBLIC, anon` as defense in depth, even
-- where RLS already backstops it (the LOW/cosmetic tier) — anon has
-- no legitimate reason to call any of these directly.
--
-- Two discrepancies found while verifying "latest definition" against
-- every migration file (not just the audit's file:line pointers):
--
--   1. confirm_sales_receipt_physical (audit: 157:178) was DROPPED in
--      migration 158 (`DROP FUNCTION IF EXISTS
--      confirm_sales_receipt_physical(UUID, TEXT);`) when
--      sales_receipts was collapsed into client_attachments. It no
--      longer exists in the schema — confirm_client_receipt_physical
--      (158) is its replacement and is already a separate item in
--      this same list. EXCLUDED here — there is nothing to fix.
--
--   2. enforce_wo_rater_authority (182) — the audit flagged this as a
--      possible false positive ("might already be fine since it's an
--      IN not NOT IN"). On inspection it DOES contain one genuine
--      `v_role NOT IN ('admin','executive')` NULL-bypass (combined
--      with an AND, guarding a "rater must be their own staff record"
--      check) — every other role check in that function uses `IN` or
--      ends in an unconditional ELSE/RAISE and is already NULL-safe.
--      NOT a false positive; included below with a minimal fix to
--      that one line.
--
-- Net: 49 functions named across the three tiers minus the 1 dropped
-- function (confirm_sales_receipt_physical) = 48 functions fixed
-- below.
-- ============================================================

SET search_path TO public;

-- ════════════════════════════════════════════════════════════════
-- HIGH — SECURITY DEFINER, no RLS backstop (REVOKE added, unless trigger)
-- ════════════════════════════════════════════════════════════════

-- ── undo_grn_fulfillment (078) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION undo_grn_fulfillment(p_grn_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bundle_id UUID;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'stock_manager', 'logistics_officer') THEN
    RAISE EXCEPTION 'Not authorized to undo a goods received note';
  END IF;

  SELECT sourcing_bundle_id INTO v_bundle_id FROM goods_received_notes WHERE id = p_grn_id;
  IF v_bundle_id IS NULL THEN
    RAISE EXCEPTION 'GRN not found';
  END IF;

  DELETE FROM goods_received_notes WHERE id = p_grn_id;

  UPDATE sourcing_bundles
  SET status = 'ordered', fulfilled_at = NULL
  WHERE id = v_bundle_id AND status = 'fulfilled';
END;
$$;

REVOKE EXECUTE ON FUNCTION undo_grn_fulfillment(UUID) FROM PUBLIC, anon;

-- ── revert_legacy_fulfillment (079) ────────────────────────────────
CREATE OR REPLACE FUNCTION revert_legacy_fulfillment(p_bundle_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'stock_manager', 'logistics_officer') THEN
    RAISE EXCEPTION 'Not authorized to revert this purchase order';
  END IF;

  IF EXISTS (SELECT 1 FROM goods_received_notes WHERE sourcing_bundle_id = p_bundle_id) THEN
    RAISE EXCEPTION 'This PO has a real GRN on record — use Undo Fulfillment instead';
  END IF;

  UPDATE sourcing_bundles
  SET status = 'ordered', fulfilled_at = NULL
  WHERE id = p_bundle_id AND status = 'fulfilled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found or not currently fulfilled';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION revert_legacy_fulfillment(UUID) FROM PUBLIC, anon;

-- ── create_batch_payment (099) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION create_batch_payment(
  p_expense_ids UUID[],
  p_assignee_id UUID,
  p_payment_code TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch_id UUID;
  v_bad_count INT;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can create a batch payment';
  END IF;

  IF p_expense_ids IS NULL OR array_length(p_expense_ids, 1) IS NULL OR array_length(p_expense_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one expense must be selected';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM expenses WHERE id = ANY(p_expense_ids) AND payment_state <> 'approved_to_pay';
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'All selected expenses must be in approved_to_pay state';
  END IF;

  INSERT INTO batch_payments (payment_code, assignee_id, notes)
  VALUES (p_payment_code, p_assignee_id, p_notes)
  RETURNING id INTO v_batch_id;

  INSERT INTO batch_payment_expenses (batch_payment_id, expense_id)
  SELECT v_batch_id, unnest(p_expense_ids);

  UPDATE expenses
  SET payment_state = 'sent',
      disbursed_by = p_assignee_id,
      payment_method = 'batch_wire'
  WHERE id = ANY(p_expense_ids);

  RETURN v_batch_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_batch_payment(UUID[], UUID, TEXT, TEXT) FROM PUBLIC, anon;

-- ── match_batch_to_transfer (099) ──────────────────────────────────
CREATE OR REPLACE FUNCTION match_batch_to_transfer(p_batch_payment_id UUID, p_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a batch payment to a bank line';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM batch_payments WHERE id = p_batch_payment_id) THEN
    RAISE EXCEPTION 'Batch payment not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM transfers WHERE id = p_transfer_id) THEN
    RAISE EXCEPTION 'Transfer (bank line) not found';
  END IF;

  UPDATE batch_payments SET transfer_id = p_transfer_id WHERE id = p_batch_payment_id;

  UPDATE expenses e
  SET payment_state = 'paid', transfer_id = p_transfer_id
  FROM batch_payment_expenses bpe
  WHERE bpe.batch_payment_id = p_batch_payment_id AND e.id = bpe.expense_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION match_batch_to_transfer(UUID, UUID) FROM PUBLIC, anon;

-- ── match_expense_to_transfer (latest: 154, supersedes 099) ───────
CREATE OR REPLACE FUNCTION match_expense_to_transfer(p_expense_id UUID, p_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_account_id UUID;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match an expense to a bank line';
  END IF;

  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense belongs to a batch payment — match the batch to a bank line instead';
  END IF;

  SELECT from_account_id INTO v_from_account_id FROM transfers WHERE id = p_transfer_id;

  UPDATE expenses
  SET payment_state = 'paid',
      transfer_id   = p_transfer_id,
      account_id    = COALESCE(account_id, v_from_account_id)
  WHERE id = p_expense_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION match_expense_to_transfer(UUID, UUID) FROM PUBLIC, anon;

-- ── convert_opening_balances_to_journal_entry (106) ────────────────
CREATE OR REPLACE FUNCTION convert_opening_balances_to_journal_entry()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy    UUID;
  v_period_start  DATE;
  v_row_count     INT;
  v_bad_nature    INT;
  v_debit_total   NUMERIC;
  v_credit_total  NUMERIC;
  v_entry_id      UUID;
  v_ob            RECORD;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can convert opening balances into a journal entry';
  END IF;

  SELECT count(*) INTO v_row_count FROM opening_balances;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'opening_balances is empty — nothing to convert. Enter the ERCA-sourced figures first.';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE entry_type = 'opening_balance') THEN
    RAISE EXCEPTION 'An opening_balance journal entry already exists — this is a one-time conversion, not repeatable. Reverse it manually first if it genuinely needs redoing.';
  END IF;

  SELECT count(*) INTO v_bad_nature
  FROM opening_balances ob
  JOIN chart_of_accounts coa ON coa.id = ob.chart_of_accounts_id
  WHERE coa.nature NOT IN ('Asset', 'Liability', 'Equity');
  IF v_bad_nature > 0 THEN
    RAISE EXCEPTION '% opening_balances row(s) point at a Revenue/Expense-nature account — only Asset/Liability/Equity belong in an opening balance (P&L does not carry forward)', v_bad_nature;
  END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE side = 'debit'), 0),
    COALESCE(SUM(amount) FILTER (WHERE side = 'credit'), 0)
  INTO v_debit_total, v_credit_total
  FROM opening_balances;

  IF v_debit_total <> v_credit_total THEN
    RAISE EXCEPTION 'ERCA-sourced opening balances do not balance on their own: debits = %, credits = %, difference = %. Surfacing this, not auto-plugging it — resolve the mapping before converting.',
      v_debit_total, v_credit_total, v_debit_total - v_credit_total;
  END IF;

  SELECT id, start_date INTO v_current_fy, v_period_start FROM fiscal_periods WHERE is_current;

  INSERT INTO journal_entries (entry_date, entry_type, description, created_by)
  VALUES (v_period_start, 'opening_balance', 'Opening balance from ERCA filing', auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_ob IN SELECT * FROM opening_balances LOOP
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
    VALUES (
      v_entry_id, v_ob.chart_of_accounts_id,
      CASE WHEN v_ob.side = 'debit' THEN v_ob.amount ELSE 0 END,
      CASE WHEN v_ob.side = 'credit' THEN v_ob.amount ELSE 0 END,
      v_ob.source
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION convert_opening_balances_to_journal_entry() FROM PUBLIC, anon;

-- ── close_fiscal_period (108) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION close_fiscal_period(p_fiscal_period_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period       RECORD;
  v_retained_id  UUID;
  v_entry_id     UUID;
  v_total_revenue NUMERIC;
  v_total_expense NUMERIC;
  v_net          NUMERIC;
  v_line         RECORD;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can close a fiscal period';
  END IF;

  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_fiscal_period_id;
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;
  IF v_period.closed THEN
    RAISE EXCEPTION 'Fiscal period % is already closed', v_period.label;
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE fiscal_period_id = p_fiscal_period_id AND entry_type = 'closing') THEN
    RAISE EXCEPTION 'A closing entry already exists for %', v_period.label;
  END IF;

  SELECT id INTO v_retained_id FROM chart_of_accounts WHERE account_code = '3010';

  -- Insert the closing entry FIRST, while the period is still open —
  -- avoids a chicken-and-egg with the closed-period trigger above,
  -- which would otherwise reject the very entry that closes it.
  INSERT INTO journal_entries (entry_date, entry_type, description)
  VALUES (v_period.end_date, 'closing', 'Year-end close: ' || v_period.label)
  RETURNING id INTO v_entry_id;

  v_total_revenue := 0;
  v_total_expense := 0;

  FOR v_line IN
    SELECT coa.id AS account_id, coa.nature,
           CASE WHEN coa.nature = 'Revenue' THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
                ELSE COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) END AS amount
    FROM chart_of_accounts coa
    JOIN journal_lines jl ON jl.account_id = coa.id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE coa.nature IN ('Revenue', 'Expense') AND je.fiscal_period_id = p_fiscal_period_id
    GROUP BY coa.id, coa.nature
    HAVING CASE WHEN coa.nature = 'Revenue' THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
                ELSE COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) END <> 0
  LOOP
    IF v_line.nature = 'Revenue' THEN
      -- Revenue carries a credit balance; debit it to zero out.
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_line.account_id, v_line.amount, 0, 'Close to Retained Earnings');
      v_total_revenue := v_total_revenue + v_line.amount;
    ELSE
      -- Expense carries a debit balance; credit it to zero out.
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_line.account_id, 0, v_line.amount, 'Close to Retained Earnings');
      v_total_expense := v_total_expense + v_line.amount;
    END IF;
  END LOOP;

  v_net := v_total_revenue - v_total_expense;
  IF v_net > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
    VALUES (v_entry_id, v_retained_id, 0, v_net, format('Net income for %s', v_period.label));
  ELSIF v_net < 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
    VALUES (v_entry_id, v_retained_id, -v_net, 0, format('Net loss for %s', v_period.label));
  END IF;
  -- v_net = 0 with zero revenue and zero expense both: no lines at all
  -- were inserted, which is a legitimately empty (no-op) closing entry
  -- for a period with no ledger activity — balances trivially at 0 = 0.

  SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
  SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;

  UPDATE fiscal_periods SET closed = TRUE, closed_at = NOW(), closed_by = auth.uid()
  WHERE id = p_fiscal_period_id;

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_fiscal_period(UUID) FROM PUBLIC, anon;

-- ── reopen_fiscal_period (108) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION reopen_fiscal_period(p_fiscal_period_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admin can reopen a closed fiscal period';
  END IF;
  UPDATE fiscal_periods SET closed = FALSE, closed_at = NULL, closed_by = NULL
  WHERE id = p_fiscal_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION reopen_fiscal_period(UUID) FROM PUBLIC, anon;

-- ── close_vendor_advance (110) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION close_vendor_advance(p_expense_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expense RECORD;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can close a vendor advance';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF v_expense IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_expense.payment_state <> 'advance' THEN
    RAISE EXCEPTION 'Expense % is not an open advance (payment_state = %)', p_expense_id, v_expense.payment_state;
  END IF;

  UPDATE expenses SET payment_state = 'paid' WHERE id = p_expense_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_vendor_advance(UUID) FROM PUBLIC, anon;

-- ── sign_off_stock_dispatch (latest: 163, supersedes 115/116) ──────
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
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'stock_manager', 'procurement_officer') THEN
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

REVOKE EXECUTE ON FUNCTION sign_off_stock_dispatch(UUID, UUID, NUMERIC) FROM PUBLIC, anon;

-- ── link_expense_vrf (137) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION link_expense_vrf(p_expense_id UUID, p_vrf_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can link an expense to a VRF settlement';
  END IF;

  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense belongs to a batch payment — match the batch to a bank line instead';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE id = p_vrf_id) THEN
    RAISE EXCEPTION 'VRF record not found';
  END IF;

  UPDATE expenses SET payment_state = 'paid', vrf_id = p_vrf_id WHERE id = p_expense_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION link_expense_vrf(UUID, UUID) FROM PUBLIC, anon;

-- ── confirm_expense_cash_payment (137) ──────────────────────────────
CREATE OR REPLACE FUNCTION confirm_expense_cash_payment(p_expense_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can confirm a cash payment';
  END IF;

  UPDATE expenses SET payment_state = 'paid' WHERE id = p_expense_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_expense_cash_payment(UUID) FROM PUBLIC, anon;

-- ── match_payroll_to_transfer (137) ─────────────────────────────────
CREATE OR REPLACE FUNCTION match_payroll_to_transfer(p_payroll_id UUID, p_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match payroll to a bank line';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_payroll_id AND approval_status = 'finance_approved') THEN
    RAISE EXCEPTION 'Payroll must be finance-approved before matching to a bank line';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM transfers WHERE id = p_transfer_id) THEN
    RAISE EXCEPTION 'Transfer (bank line) not found';
  END IF;

  UPDATE payroll SET transfer_id = p_transfer_id, payment_method = 'Bank Transfer', payment_status = 'paid' WHERE id = p_payroll_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION match_payroll_to_transfer(UUID, UUID) FROM PUBLIC, anon;

-- ── link_payroll_vrf (137) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION link_payroll_vrf(p_payroll_id UUID, p_vrf_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can link payroll to a VRF settlement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_payroll_id AND approval_status = 'finance_approved') THEN
    RAISE EXCEPTION 'Payroll must be finance-approved before linking a VRF settlement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE id = p_vrf_id) THEN
    RAISE EXCEPTION 'VRF record not found';
  END IF;

  UPDATE payroll SET vrf_id = p_vrf_id, payment_method = 'VRF', payment_status = 'paid' WHERE id = p_payroll_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION link_payroll_vrf(UUID, UUID) FROM PUBLIC, anon;

-- ── auto_match_statement_import (latest: 201, supersedes 138/154) ──
CREATE OR REPLACE FUNCTION public.auto_match_statement_import(p_import_id UUID)
RETURNS TABLE(matched_count integer, duplicate_count integer, unmatched_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_line RECORD;
  v_expense_id     UUID;
  v_expense_amount NUMERIC;
  v_sale_id        UUID;
  v_sale_amount    NUMERIC;
  v_line_amount    NUMERIC;
  v_matched   INT := 0;
  v_duplicate INT := 0;
  v_unmatched INT := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can run statement matching';
  END IF;

  FOR v_line IN SELECT * FROM bank_statement_lines WHERE import_id = p_import_id LOOP
    IF EXISTS (SELECT 1 FROM transfers WHERE transfer_id_code = v_line.reference_code) THEN
      UPDATE bank_statement_lines
      SET match_status = 'duplicate', matched_expense_id = NULL, matched_sale_id = NULL,
          matched_expense_amount = NULL, variance_amount = NULL
      WHERE id = v_line.id;
      v_duplicate := v_duplicate + 1;
      CONTINUE;
    END IF;

    v_expense_id := NULL; v_expense_amount := NULL;
    v_sale_id := NULL; v_sale_amount := NULL;

    IF v_line.reference_code IS NOT NULL THEN
      IF COALESCE(v_line.debit_amount, 0) > 0 THEN
        SELECT id, amount_etb INTO v_expense_id, v_expense_amount
        FROM expenses
        WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL
        LIMIT 1;
      ELSIF COALESCE(v_line.credit_amount, 0) > 0 THEN
        SELECT id, amount INTO v_sale_id, v_sale_amount
        FROM sales
        WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL
        LIMIT 1;
      END IF;
    END IF;

    IF v_expense_id IS NOT NULL THEN
      v_line_amount := COALESCE(NULLIF(v_line.debit_amount, 0), v_line.credit_amount, 0);
      UPDATE bank_statement_lines
      SET match_status           = 'matched_expense',
          matched_expense_id     = v_expense_id,
          matched_sale_id        = NULL,
          matched_expense_amount = v_expense_amount,
          variance_amount        = CASE WHEN v_expense_amount IS NULL THEN NULL
                                        ELSE v_line_amount - v_expense_amount END
      WHERE id = v_line.id;
      v_matched := v_matched + 1;
    ELSIF v_sale_id IS NOT NULL THEN
      v_line_amount := COALESCE(NULLIF(v_line.credit_amount, 0), v_line.debit_amount, 0);
      UPDATE bank_statement_lines
      SET match_status           = 'matched_sale',
          matched_expense_id     = NULL,
          matched_sale_id        = v_sale_id,
          matched_expense_amount = v_sale_amount,
          variance_amount        = CASE WHEN v_sale_amount IS NULL THEN NULL
                                        ELSE v_line_amount - v_sale_amount END
      WHERE id = v_line.id;
      v_matched := v_matched + 1;
    ELSE
      UPDATE bank_statement_lines
      SET match_status = 'unmatched', matched_expense_id = NULL, matched_sale_id = NULL,
          matched_expense_amount = NULL, variance_amount = NULL
      WHERE id = v_line.id;
      v_unmatched := v_unmatched + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_duplicate, v_unmatched;
END $fn$;

REVOKE EXECUTE ON FUNCTION auto_match_statement_import(UUID) FROM PUBLIC, anon;

-- ── commit_statement_import (latest: 201, supersedes 138) ──────────
CREATE OR REPLACE FUNCTION public.commit_statement_import(p_import_id UUID)
RETURNS TABLE(transfers_created integer, expenses_matched integer, flagged_unmatched integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_import bank_statement_imports%ROWTYPE;
  v_line RECORD;
  v_transfer_id UUID;
  v_created INT := 0;
  v_matched INT := 0;
  v_flagged INT := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can commit a statement import';
  END IF;

  SELECT * INTO v_import FROM bank_statement_imports WHERE id = p_import_id;
  IF v_import.id IS NULL THEN
    RAISE EXCEPTION 'Import not found';
  END IF;
  IF v_import.status = 'committed' THEN
    RAISE EXCEPTION 'This import has already been committed';
  END IF;

  FOR v_line IN SELECT * FROM bank_statement_lines WHERE import_id = p_import_id AND match_status <> 'duplicate' LOOP
    INSERT INTO transfers (transfer_id_code, date, from_account_id, to_account_id, amount, notes)
    VALUES (
      v_line.reference_code,
      COALESCE(v_line.value_date, v_line.post_date),
      CASE WHEN v_line.debit_amount IS NOT NULL AND v_line.debit_amount > 0 THEN v_import.account_id END,
      CASE WHEN v_line.credit_amount IS NOT NULL AND v_line.credit_amount > 0 THEN v_import.account_id END,
      COALESCE(v_line.debit_amount, v_line.credit_amount, 0),
      COALESCE(v_line.narration, '') || ' (ref: ' || COALESCE(v_line.reference, '') || ')'
    ) RETURNING id INTO v_transfer_id;

    v_created := v_created + 1;

    IF v_line.match_status = 'matched_expense' AND v_line.matched_expense_id IS NOT NULL THEN
      PERFORM match_expense_to_transfer(v_line.matched_expense_id, v_transfer_id);
      v_matched := v_matched + 1;
    ELSIF v_line.match_status = 'matched_sale' AND v_line.matched_sale_id IS NOT NULL THEN
      PERFORM match_sale_to_transfer(v_line.matched_sale_id, v_transfer_id);
      v_matched := v_matched + 1;
    ELSE
      v_flagged := v_flagged + 1;
    END IF;

    UPDATE bank_statement_lines SET transfer_id = v_transfer_id WHERE id = v_line.id;
  END LOOP;

  UPDATE bank_statement_imports SET status = 'committed', committed_at = NOW() WHERE id = p_import_id;

  RETURN QUERY SELECT v_created, v_matched, v_flagged;
END $fn$;

REVOKE EXECUTE ON FUNCTION commit_statement_import(UUID) FROM PUBLIC, anon;

-- ── unarchive_all (151) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION unarchive_all()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can un-archive historical data';
  END IF;

  UPDATE expenses                    SET is_archived = false WHERE is_archived;
  UPDATE transfers                   SET is_archived = false WHERE is_archived;
  UPDATE sales                       SET is_archived = false WHERE is_archived;
  UPDATE cash_advances               SET is_archived = false WHERE is_archived;
  UPDATE payroll                     SET is_archived = false WHERE is_archived;
  UPDATE orders                      SET is_archived = false WHERE is_archived;
  UPDATE timesheet                   SET is_archived = false WHERE is_archived;
  UPDATE vendor_receipt_facilitation SET is_archived = false WHERE is_archived;
END;
$$;

REVOKE EXECUTE ON FUNCTION unarchive_all() FROM PUBLIC, anon;

-- ── retry_expense_ledger_posting (154) ───────────────────────────────
CREATE OR REPLACE FUNCTION retry_expense_ledger_posting(p_expense_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expense expenses%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can retry a ledger posting';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF v_expense.id IS NULL THEN
    RETURN 'Expense no longer exists';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    RETURN 'Already posted';
  END IF;

  IF v_expense.payment_state IS DISTINCT FROM 'paid' THEN
    RETURN 'Not paid — nothing to post';
  END IF;

  IF v_expense.category_id IS NULL THEN
    RETURN 'Still no general ledger set on this expense';
  END IF;
  IF v_expense.account_id IS NULL THEN
    RETURN 'Still no payment account set on this expense';
  END IF;

  -- Re-enter the trigger: setting payment_state to itself is not a
  -- DISTINCT change, so drop out of 'paid' and back within the same
  -- statement-pair. Both writes are inside this function's transaction,
  -- so no other session ever observes the intermediate state.
  UPDATE expenses SET payment_state = 'sent' WHERE id = p_expense_id;
  UPDATE expenses SET payment_state = 'paid' WHERE id = p_expense_id;
  UPDATE expenses SET payment_state_changed_at = v_expense.payment_state_changed_at
  WHERE id = p_expense_id;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    UPDATE ledger_posting_failures
    SET resolved = TRUE, resolved_at = NOW(), resolved_by = auth.uid()
    WHERE source_table = 'expenses' AND source_id = p_expense_id AND NOT resolved;
    RETURN 'Posted';
  END IF;

  RETURN 'Still could not post — see the newest failure message for this expense';
END;
$$;

REVOKE EXECUTE ON FUNCTION retry_expense_ledger_posting(UUID) FROM PUBLIC, anon;

-- ── confirm_vendor_receipt_physical (157) ────────────────────────────
CREATE OR REPLACE FUNCTION confirm_vendor_receipt_physical(p_receipt_id UUID, p_note TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only finance or admin can confirm physical receipt of a document';
  END IF;
  UPDATE vendor_receipts
  SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
  WHERE id = p_receipt_id AND physical_received_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION confirm_vendor_receipt_physical(UUID, TEXT) FROM PUBLIC, anon;

-- ── confirm_sales_receipt_physical — EXCLUDED ────────────────────────
-- Audit listed this at 157:178 (SECURITY DEFINER, HIGH). Verified
-- against every later migration file: migration 158
-- (`DROP FUNCTION IF EXISTS confirm_sales_receipt_physical(UUID, TEXT);`)
-- dropped it when sales_receipts was collapsed into client_attachments.
-- It no longer exists — nothing to fix. Its replacement,
-- confirm_client_receipt_physical (158), is fixed below as its own item.

-- ── confirm_client_receipt_physical (158) ────────────────────────────
CREATE OR REPLACE FUNCTION confirm_client_receipt_physical(p_attachment_id UUID, p_note TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only finance or admin can confirm physical receipt of a document';
  END IF;
  UPDATE client_attachments
  SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
  WHERE id = p_attachment_id AND physical_received_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION confirm_client_receipt_physical(UUID, TEXT) FROM PUBLIC, anon;

-- ── split_expense_partial_payment (latest: 174, supersedes 164/168/171) ─
CREATE OR REPLACE FUNCTION public.split_expense_partial_payment(
  p_expense_id uuid, p_paid_amount numeric, p_disbursed_by uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_orig      expenses%ROWTYPE;
  v_remainder NUMERIC;
  v_new_id    UUID;
  v_rem_state TEXT;
  v_rem_appr  expense_approval_status;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can split a partial payment';
  END IF;
  SELECT * INTO v_orig FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_orig.amount_etb IS NULL THEN RAISE EXCEPTION 'Expense has no amount to split'; END IF;
  IF p_paid_amount <= 0 OR p_paid_amount >= v_orig.amount_etb THEN
    RAISE EXCEPTION 'Paid amount (%) must be greater than 0 and less than the full amount (%)', p_paid_amount, v_orig.amount_etb;
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense is in a batch payment — split it out of the batch first';
  END IF;
  IF v_orig.payment_state = 'paid' THEN RAISE EXCEPTION 'This expense is already fully paid'; END IF;
  IF p_disbursed_by IS NULL THEN
    RAISE EXCEPTION 'Choose who is paying this portion (disbursed_by) — the paid part is being settled now';
  END IF;

  v_remainder := v_orig.amount_etb - p_paid_amount;

  IF v_orig.finance_approved_by IS NOT NULL THEN
    v_rem_state := 'approved_to_pay';
    v_rem_appr  := 'finance_approved';
  ELSE
    v_rem_state := 'unpaid';
    v_rem_appr  := v_orig.approval_status;
  END IF;

  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, purchase_type, quantity, uom,
    category_id, sub_category_id, vendor_id, project_id, staff_id, purchaser_user_id,
    account_id, location_id, vehicle_id, property_id,
    requested, payment_status, partially_paid, payment_state,
    approval_status, finance_approved_by, finance_approved_at, split_parent_id, notes
  )
  SELECT
    v_orig.item_service_description, v_remainder, v_orig.expense_type, v_orig.purchase_type, v_orig.quantity, v_orig.uom,
    v_orig.category_id, v_orig.sub_category_id, v_orig.vendor_id, v_orig.project_id, v_orig.staff_id, v_orig.purchaser_user_id,
    v_orig.account_id, v_orig.location_id, v_orig.vehicle_id, v_orig.property_id,
    true, false, false, v_rem_state,
    v_rem_appr, v_orig.finance_approved_by, v_orig.finance_approved_at, v_orig.id,
    COALESCE(v_orig.notes || ' | ', '') || 'Remainder of ' || COALESCE(v_orig.expense_code, v_orig.id::text) || ' after partial payment of ' || p_paid_amount::text
  RETURNING id INTO v_new_id;

  UPDATE expenses SET
    amount_etb = p_paid_amount, partially_paid = false,
    payment_state = 'paid', disbursed_by = p_disbursed_by,
    paid_date = COALESCE(paid_date, CURRENT_DATE),
    notes = COALESCE(notes || ' | ', '') || 'Partially paid ' || p_paid_amount::text || '; remainder ' || v_remainder::text || ' moved to a new queued expense'
  WHERE id = p_expense_id;

  RETURN v_new_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION split_expense_partial_payment(UUID, NUMERIC, UUID) FROM PUBLIC, anon;

-- ── reconcile_account (165) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION reconcile_account(
  p_account_id UUID, p_statement_date DATE, p_statement_balance NUMERIC,
  p_statement_url TEXT DEFAULT NULL, p_statement_name TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_latest_anchor DATE;
  v_system_bal    NUMERIC;
  v_variance      NUMERIC;
  v_recon_id      UUID;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile an account';
  END IF;

  SELECT max(as_of_date) INTO v_latest_anchor FROM bank_balance_anchors WHERE account_id = p_account_id;
  IF v_latest_anchor IS NOT NULL AND p_statement_date <= v_latest_anchor THEN
    RAISE EXCEPTION 'Statement date % must be later than the last reconciliation/anchor (%). Reconcile a more recent statement.',
      p_statement_date, v_latest_anchor;
  END IF;

  -- What the app thinks the balance was on the statement date, BEFORE
  -- this reconciliation moves the anchor.
  SELECT balance INTO v_system_bal FROM account_balances_asof(p_statement_date) WHERE id = p_account_id;
  v_system_bal := COALESCE(v_system_bal, 0);
  v_variance   := p_statement_balance - v_system_bal;

  INSERT INTO bank_reconciliations (account_id, statement_date, statement_balance, system_balance_at_date, variance, statement_url, statement_name, note, reconciled_by)
  VALUES (p_account_id, p_statement_date, p_statement_balance, v_system_bal, v_variance, p_statement_url, p_statement_name, p_note, auth.uid())
  RETURNING id INTO v_recon_id;

  -- Adopt the statement balance as the new anchor: the app now computes
  -- forward from the reconciled figure.
  INSERT INTO bank_balance_anchors (account_id, as_of_date, balance, source, transfer_id)
  VALUES (p_account_id, p_statement_date, p_statement_balance,
          'Bank reconciliation ' || p_statement_date::text || COALESCE(' — ' || p_note, ''), NULL);

  RETURN v_recon_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION reconcile_account(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

-- ── confirm_receipt_pickup (latest: 170, supersedes 166) ────────────
-- Compound "NULL AND NOT false" pattern, as flagged by the audit: if
-- get_user_role() is NULL, `NULL NOT IN (...)` is NULL, and
-- `NULL AND NOT COALESCE(v_is_tax_officer, false)` is NULL whenever
-- the tax-officer flag is false — the IF is skipped either way.
CREATE OR REPLACE FUNCTION public.confirm_receipt_pickup(p_kind text, p_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_is_tax_officer boolean;
BEGIN
  SELECT COALESCE(is_tax_officer, false) INTO v_is_tax_officer FROM user_profiles WHERE id = auth.uid();
  IF (get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance', 'logistics_officer', 'operations_manager'))
     AND NOT COALESCE(v_is_tax_officer, false) THEN
    RAISE EXCEPTION 'Only the tax officer, pickup driver, finance, or admin can confirm a receipt collection';
  END IF;
  IF p_kind = 'vendor' THEN
    UPDATE vendor_receipts SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
    WHERE id = p_id AND physical_received_at IS NULL;
  ELSIF p_kind = 'client' THEN
    UPDATE client_attachments SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
    WHERE id = p_id AND physical_received_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Unknown receipt kind: %', p_kind;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION confirm_receipt_pickup(TEXT, UUID, TEXT) FROM PUBLIC, anon;

-- ── match_line_to_payroll (170) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_line_to_payroll(p_line_id uuid, p_payroll_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile a bank line';
  END IF;
  UPDATE bank_statement_lines SET matched_payroll_id = p_payroll_id, match_status = 'manual' WHERE id = p_line_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION match_line_to_payroll(UUID, UUID) FROM PUBLIC, anon;

-- ── mark_wht_receipt_prepared (175) ──────────────────────────────────
-- Compound "AND NOT tax-officer" pattern, as flagged by the audit.
CREATE OR REPLACE FUNCTION public.mark_wht_receipt_prepared(
  p_expense_id uuid, p_receipt_url text DEFAULT NULL, p_receipt_name text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_is_tax_officer boolean;
BEGIN
  SELECT COALESCE(is_tax_officer,false) INTO v_is_tax_officer FROM user_profiles WHERE id = auth.uid();
  IF (get_user_role() IS NULL OR get_user_role() NOT IN ('admin','finance')) AND NOT COALESCE(v_is_tax_officer,false) THEN
    RAISE EXCEPTION 'Only finance, the tax officer, or an admin can prepare a withholding receipt';
  END IF;
  UPDATE expenses SET wht_receipt_prepared = true,
    wht_receipt_url = COALESCE(p_receipt_url, wht_receipt_url),
    wht_receipt_name = COALESCE(p_receipt_name, wht_receipt_name)
  WHERE id = p_expense_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION mark_wht_receipt_prepared(UUID, TEXT, TEXT) FROM PUBLIC, anon;

-- promote_candidate_to_casual (199) intentionally excluded: confirmed
-- via live pg_proc lookup that it does not exist in this database at
-- all (its sibling from the same migration file,
-- on_labor_req_approved_promote_candidate, does exist). A security
-- hardening migration should only touch functions that are currently
-- live — this isn't a live bug to patch, and deploying it now would
-- be introducing net-new functionality, not fixing an exposure.
-- Deserves its own deliberate decision, not bundling here.

-- ── match_expense_to_statement_line (200) ────────────────────────────
CREATE OR REPLACE FUNCTION public.match_expense_to_statement_line(
  p_line_id uuid,
  p_expense_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_line   bank_statement_lines%ROWTYPE;
  v_amount numeric;
  v_line_amount numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match an expense to a bank line';
  END IF;

  SELECT * INTO v_line FROM bank_statement_lines WHERE id = p_line_id;
  IF v_line.id IS NULL THEN
    RAISE EXCEPTION 'Statement line % not found', p_line_id;
  END IF;
  IF v_line.transfer_id IS NULL THEN
    RAISE EXCEPTION 'This line''s import has not been committed yet — commit it first, then match';
  END IF;
  IF v_line.match_status = 'duplicate' THEN
    RAISE EXCEPTION 'Cannot match a line already flagged as a duplicate';
  END IF;

  SELECT amount_etb INTO v_amount FROM expenses WHERE id = p_expense_id;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'Expense % not found', p_expense_id;
  END IF;

  -- Reuses the existing matcher: role check, batch-payment guard, and the
  -- payment_state='paid' flip (which cascades to payment_status via
  -- enforce_expense_payment_lifecycle) all happen inside this call.
  PERFORM match_expense_to_transfer(p_expense_id, v_line.transfer_id);

  v_line_amount := COALESCE(NULLIF(v_line.debit_amount, 0), v_line.credit_amount, 0);

  UPDATE bank_statement_lines
     SET matched_expense_id     = p_expense_id,
         matched_expense_amount = v_amount,
         match_status           = 'matched_expense',
         variance_amount        = v_line_amount - v_amount
   WHERE id = p_line_id;
END $fn$;

REVOKE EXECUTE ON FUNCTION match_expense_to_statement_line(UUID, UUID) FROM PUBLIC, anon;

-- ── rematch_committed_statement_lines (latest: 201, supersedes 200) ─
CREATE OR REPLACE FUNCTION public.rematch_committed_statement_lines(
  p_import_id uuid DEFAULT NULL
) RETURNS TABLE(matched_count integer, skipped_count integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_line RECORD;
  v_expense_id uuid;
  v_sale_id uuid;
  v_matched int := 0;
  v_skipped int := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can rematch statement lines';
  END IF;

  FOR v_line IN
    SELECT bl.* FROM bank_statement_lines bl
    WHERE bl.match_status = 'unmatched'
      AND bl.transfer_id IS NOT NULL
      AND bl.reference_code IS NOT NULL
      AND (p_import_id IS NULL OR bl.import_id = p_import_id)
  LOOP
    v_expense_id := NULL; v_sale_id := NULL;

    IF COALESCE(v_line.debit_amount, 0) > 0 THEN
      SELECT id INTO v_expense_id FROM expenses
       WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL LIMIT 1;
    ELSIF COALESCE(v_line.credit_amount, 0) > 0 THEN
      SELECT id INTO v_sale_id FROM sales
       WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL LIMIT 1;
    END IF;

    IF v_expense_id IS NOT NULL THEN
      BEGIN
        PERFORM match_expense_to_statement_line(v_line.id, v_expense_id);
        v_matched := v_matched + 1;
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
      END;
    ELSIF v_sale_id IS NOT NULL THEN
      BEGIN
        PERFORM match_sale_to_statement_line(v_line.id, v_sale_id);
        v_matched := v_matched + 1;
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
      END;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_skipped;
END $fn$;

REVOKE EXECUTE ON FUNCTION rematch_committed_statement_lines(UUID) FROM PUBLIC, anon;

-- ── match_sale_to_transfer (201) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_sale_to_transfer(p_sale_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_to_account_id uuid;
  v_transfer_date  date;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a sale to a bank line';
  END IF;

  SELECT to_account_id, date INTO v_to_account_id, v_transfer_date FROM transfers WHERE id = p_transfer_id;
  IF v_to_account_id IS NULL AND v_transfer_date IS NULL THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  UPDATE sales
     SET sales_status  = 'Paid',
         transfer_id   = p_transfer_id,
         account_id    = COALESCE(account_id, v_to_account_id),
         payment_date  = COALESCE(payment_date, v_transfer_date)
   WHERE id = p_sale_id;
END $fn$;

REVOKE EXECUTE ON FUNCTION match_sale_to_transfer(UUID, UUID) FROM PUBLIC, anon;

-- ── match_sale_to_statement_line (201) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.match_sale_to_statement_line(p_line_id uuid, p_sale_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_line        bank_statement_lines%ROWTYPE;
  v_amount      numeric;
  v_line_amount numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a sale to a bank line';
  END IF;

  SELECT * INTO v_line FROM bank_statement_lines WHERE id = p_line_id;
  IF v_line.id IS NULL THEN
    RAISE EXCEPTION 'Statement line % not found', p_line_id;
  END IF;
  IF v_line.transfer_id IS NULL THEN
    RAISE EXCEPTION 'This line''s import has not been committed yet — commit it first, then match';
  END IF;
  IF v_line.match_status = 'duplicate' THEN
    RAISE EXCEPTION 'Cannot match a line already flagged as a duplicate';
  END IF;

  SELECT amount INTO v_amount FROM sales WHERE id = p_sale_id;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'Sale % not found', p_sale_id;
  END IF;

  PERFORM match_sale_to_transfer(p_sale_id, v_line.transfer_id);

  v_line_amount := COALESCE(NULLIF(v_line.credit_amount, 0), v_line.debit_amount, 0);

  UPDATE bank_statement_lines
     SET matched_sale_id         = p_sale_id,
         matched_expense_amount  = v_amount,
         match_status            = 'matched_sale',
         variance_amount         = v_line_amount - v_amount
   WHERE id = p_line_id;
END $fn$;

REVOKE EXECUTE ON FUNCTION match_sale_to_statement_line(UUID, UUID) FROM PUBLIC, anon;

-- ── retry_sale_ledger_posting (202) ──────────────────────────────────
CREATE OR REPLACE FUNCTION retry_sale_ledger_posting(p_sale_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can retry a ledger posting';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN
    RETURN 'Sale no longer exists';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = p_sale_id) THEN
    RETURN 'Already posted';
  END IF;

  IF v_sale.sales_status IS DISTINCT FROM 'Paid' THEN
    RETURN 'Not paid - nothing to post';
  END IF;

  IF v_sale.account_id IS NULL THEN
    RETURN 'Still no payment account set on this sale';
  END IF;
  IF v_sale.amount IS NULL THEN
    RETURN 'Still no amount set on this sale';
  END IF;

  UPDATE sales SET sales_status = sales_status WHERE id = p_sale_id;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = p_sale_id) THEN
    UPDATE ledger_posting_failures
    SET resolved = TRUE, resolved_at = NOW(), resolved_by = auth.uid()
    WHERE source_table = 'sales' AND source_id = p_sale_id AND NOT resolved;
    RETURN 'Posted';
  END IF;

  RETURN 'Still could not post - see the newest failure message for this sale';
END;
$$;

REVOKE EXECUTE ON FUNCTION retry_sale_ledger_posting(UUID) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- MEDIUM
-- ════════════════════════════════════════════════════════════════

-- block_finance_contact_reassign_by_non_admin (147) intentionally
-- excluded: confirmed via live pg_proc/pg_trigger lookup that neither
-- this function nor its trigger exist in this database — and
-- projects.finance_contact_id doesn't exist as a column either, so
-- there is nothing live to attach a fixed trigger to. This is a
-- missing feature (the reassignment guard was apparently never
-- deployed), not a live security regression — if the underlying gap
-- (a deactivated PM could otherwise reassign a finance contact once
-- this feature exists) needs addressing, that's a deliberate,
-- separately-reviewed PR, not part of this hardening pass.

-- ── refresh_exec_dashboard_now (195) — not a trigger, REVOKE added ──
CREATE OR REPLACE FUNCTION public.refresh_exec_dashboard_now()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_role user_role;
  v_last timestamptz;
BEGIN
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin','executive') THEN
    RAISE EXCEPTION 'Only admin or executive may refresh the exec dashboard';
  END IF;

  SELECT MAX(refreshed_at) INTO v_last FROM exec_dashboard_refresh_log;
  IF v_last IS NOT NULL AND v_last > (now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'recent refresh in flight', 'last_refresh', v_last);
  END IF;

  PERFORM public.refresh_exec_dashboard();
  RETURN jsonb_build_object('status', 'ok', 'refreshed_at', now());
END $$;

REVOKE EXECUTE ON FUNCTION refresh_exec_dashboard_now() FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- LOW/cosmetic — RLS backstops these, still worth closing
-- ════════════════════════════════════════════════════════════════

-- ── enforce_expense_approval_transitions (163) — trigger, no REVOKE ─
CREATE OR REPLACE FUNCTION enforce_expense_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN

    -- The live gate: finance releases the expense to payment.
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can approve or reject an expense';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    -- Legacy path: drains rows stranded in manager_approved by the
    -- retired first rung. No new row can reach this state.
    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
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

-- ── enforce_cash_advance_approval_transitions (163) — trigger, no REVOKE ─
CREATE OR REPLACE FUNCTION enforce_cash_advance_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('executive', 'admin') THEN
        RAISE EXCEPTION 'Only an Executive can approve or reject a pending cash advance';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();
    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
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

-- ── enforce_sale_approval_transitions (163) — trigger, no REVOKE ────
CREATE OR REPLACE FUNCTION enforce_sale_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('executive', 'admin') THEN
        RAISE EXCEPTION 'Only an Executive can approve or reject a pending sale';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();
    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
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

-- ── enforce_payroll_approval_transitions (163) — trigger, no REVOKE ─
CREATE OR REPLACE FUNCTION enforce_payroll_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('executive', 'admin') THEN
        RAISE EXCEPTION 'Only an Executive can approve or reject a pending payroll run';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
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
    IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
      RAISE EXCEPTION 'Only Finance can mark a payroll run as paid';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ── enforce_fuel_expense_requester (163) — trigger, no REVOKE ───────
CREATE OR REPLACE FUNCTION enforce_fuel_expense_requester()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.expense_type = 'fuel' AND (TG_OP = 'INSERT' OR OLD.expense_type IS DISTINCT FROM 'fuel') THEN
    IF (get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'logistics_officer'))
       AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true) THEN
      RAISE EXCEPTION 'Only fleet managers can submit a fuel request';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ── enforce_staff_department_assignment (102) — trigger, no REVOKE ──
CREATE OR REPLACE FUNCTION enforce_staff_department_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'hr_officer') THEN
    IF (TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
      RAISE EXCEPTION 'Only Admin or HR can assign or change a staff member''s department';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── enforce_petty_replenishment_approval_authority (121) — trigger, no REVOKE ─
CREATE OR REPLACE FUNCTION enforce_petty_replenishment_approval_authority()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.amount_requested > 5000
     AND (get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'project_manager')) THEN
    RAISE EXCEPTION 'Replenishments over ETB 5,000 need Project Manager (or admin) approval';
  END IF;
  RETURN NEW;
END; $$;

-- ── enforce_expense_finance_fields (137, latest) — trigger, no REVOKE ─
CREATE OR REPLACE FUNCTION enforce_expense_finance_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    IF NEW.payment_status        IS DISTINCT FROM OLD.payment_status
    OR NEW.paid_date             IS DISTINCT FROM OLD.paid_date
    OR NEW.bank_ref               IS DISTINCT FROM OLD.bank_ref
    OR NEW.partially_paid        IS DISTINCT FROM OLD.partially_paid
    OR NEW.partial_paid_amount   IS DISTINCT FROM OLD.partial_paid_amount
    OR NEW.partial_payment_date  IS DISTINCT FROM OLD.partial_payment_date
    OR NEW.partial_payment_notes IS DISTINCT FROM OLD.partial_payment_notes
    OR NEW.total_payment_date    IS DISTINCT FROM OLD.total_payment_date
    OR NEW.account_id            IS DISTINCT FROM OLD.account_id
    OR NEW.transfer_id           IS DISTINCT FROM OLD.transfer_id
    OR NEW.vrf_id                IS DISTINCT FROM OLD.vrf_id
    OR NEW.tax_summary_id        IS DISTINCT FROM OLD.tax_summary_id
    OR NEW.verify_wht            IS DISTINCT FROM OLD.verify_wht
    OR NEW.wht_handling_method   IS DISTINCT FROM OLD.wht_handling_method
    OR NEW.wht_fund              IS DISTINCT FROM OLD.wht_fund
    OR NEW.payment_state         IS DISTINCT FROM OLD.payment_state
    OR NEW.disbursed_by          IS DISTINCT FROM OLD.disbursed_by
    OR NEW.payment_method        IS DISTINCT FROM OLD.payment_method
    THEN
      RAISE EXCEPTION 'Only Finance or Admin can modify payment and finance-linked fields on an expense';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── enforce_wo_rater_authority (182) — trigger, no REVOKE ────────────
-- Audit flagged this as a possible false positive ("IN not NOT IN").
-- On inspection there IS one genuine NOT IN NULL-bypass, in the
-- "rater must be your own linked staff record" check — every other
-- role check in this function uses IN or ends in an unconditional
-- ELSE/RAISE and is already NULL-safe. Minimal fix applied to that
-- one line only.
CREATE OR REPLACE FUNCTION public.enforce_wo_rater_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role          user_role;
  v_caller_staff  uuid;
  v_project       uuid;
  v_lead          uuid;
  v_pm            uuid;
  v_ratee_is_foreman_or_lead boolean;
BEGIN
  v_role         := public.get_user_role();
  v_caller_staff := public.current_staff_id();

  -- Rater MUST be the caller (no ratings on behalf of someone else).
  -- Admin/exec are the one exception — they may correct or backfill a rating
  -- naming another rater — RLS still gates that path.
  IF NEW.rater_staff_id IS DISTINCT FROM v_caller_staff
     AND (v_role IS NULL OR v_role NOT IN ('admin','executive')) THEN
    RAISE EXCEPTION 'Rater must be your own linked staff record';
  END IF;

  SELECT wo.project_id, wo.assigned_lead_staff_id INTO v_project, v_lead
    FROM work_orders wo WHERE wo.id = NEW.work_order_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'Work order % not found', NEW.work_order_id;
  END IF;
  SELECT p.project_manager_id INTO v_pm FROM projects p WHERE p.id = v_project;

  v_ratee_is_foreman_or_lead := (
    NEW.rated_staff_id = v_lead
    OR EXISTS (
      SELECT 1 FROM staff_assignments a
      WHERE a.staff_id  = NEW.rated_staff_id
        AND a.project_id = v_project
        AND a.active
        AND lower(a.role) IN ('site_foreman','site foreman')
    )
    OR EXISTS (
      SELECT 1 FROM staff s
      WHERE s.id = NEW.rated_staff_id AND lower(coalesce(s.role,'')) = 'site_foreman'
    )
  );

  -- Escalation branch — only PM/admin/exec may rate the foreman or lead.
  IF v_ratee_is_foreman_or_lead THEN
    IF v_role IN ('admin','executive')
       OR (v_pm IS NOT NULL AND NEW.rater_staff_id = v_pm) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only the project manager, admin, or executive can rate the site foreman or work order lead on this project';
  END IF;

  -- General branch.
  IF v_role IN ('admin','executive') THEN RETURN NEW; END IF;
  IF v_lead IS NOT NULL AND NEW.rater_staff_id = v_lead THEN RETURN NEW; END IF;
  IF v_pm   IS NOT NULL AND NEW.rater_staff_id = v_pm   THEN RETURN NEW; END IF;
  IF public.is_site_foreman_for_project(v_project) THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'Not authorized to rate work on this work order';
END $$;

-- ── enforce_labor_req_approval_authority (184) — trigger, no REVOKE ─
CREATE OR REPLACE FUNCTION public.enforce_labor_req_approval_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_role user_role;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    v_role := public.get_user_role();
    IF v_role IS NULL OR v_role NOT IN ('admin','hr_officer') THEN
      RAISE EXCEPTION 'Only HR or admin may approve a labor requisition';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $$;

-- ── log_verified_market_price (latest: 191) — not a trigger, REVOKE ─
CREATE OR REPLACE FUNCTION public.log_verified_market_price(
  p_stock_item_id     uuid DEFAULT NULL,
  p_unit_price        numeric DEFAULT NULL,
  p_vendor_id         uuid DEFAULT NULL,
  p_notes             text DEFAULT NULL,
  p_source_reference  text DEFAULT NULL,
  p_sub_category_id   uuid DEFAULT NULL,
  p_item_description  text DEFAULT NULL,
  p_unit              text DEFAULT NULL,
  p_brand             text DEFAULT NULL,
  p_specification     text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_id uuid; v_staff uuid; v_unit text;
BEGIN
  IF public.get_user_role() IS NULL OR public.get_user_role() NOT IN ('admin','executive','procurement_officer') THEN
    RAISE EXCEPTION 'Only Procurement, admin, or executive may log a verified market price';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN RAISE EXCEPTION 'Unit price must be positive'; END IF;
  IF p_stock_item_id IS NULL AND p_sub_category_id IS NULL THEN
    RAISE EXCEPTION 'A verified price needs either a stock_item or a sub_category';
  END IF;
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your account is not linked to a staff record'; END IF;
  IF p_stock_item_id IS NOT NULL THEN
    SELECT unit INTO v_unit FROM stock_items WHERE id = p_stock_item_id;
    IF v_unit IS NULL THEN RAISE EXCEPTION 'Stock item % not found', p_stock_item_id; END IF;
  ELSE
    v_unit := COALESCE(p_unit, 'unit');
  END IF;
  INSERT INTO market_prices
    (stock_item_id, sub_category_id, item_description, brand, specification,
     unit_price, currency, unit, source, source_vendor_id,
     source_reference, sourced_by_staff_id, notes)
  VALUES
    (p_stock_item_id, p_sub_category_id, p_item_description, p_brand, p_specification,
     p_unit_price, 'ETB', v_unit, 'verified_quote', p_vendor_id,
     p_source_reference, v_staff, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION log_verified_market_price(UUID, NUMERIC, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

-- ── fulfill_market_price_check (latest: 191, supersedes 188/190) ────
CREATE OR REPLACE FUNCTION public.fulfill_market_price_check(
  p_request_id uuid, p_unit_price numeric,
  p_vendor_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_brand text DEFAULT NULL, p_specification text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_req market_price_check_requests%ROWTYPE;
  v_staff uuid; v_unit text; v_price_id uuid;
BEGIN
  IF public.get_user_role() IS NULL OR public.get_user_role() NOT IN ('admin','executive','procurement_officer') THEN
    RAISE EXCEPTION 'Only Procurement, admin, or executive may fulfill a check request';
  END IF;
  SELECT * INTO v_req FROM market_price_check_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Request % not found', p_request_id; END IF;
  IF v_req.status <> 'open' THEN RAISE EXCEPTION 'Request is already %', v_req.status; END IF;
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your account is not linked to a staff record'; END IF;
  IF v_req.stock_item_id IS NOT NULL THEN
    SELECT unit INTO v_unit FROM stock_items WHERE id = v_req.stock_item_id;
  ELSE
    v_unit := 'unit';
  END IF;

  INSERT INTO market_prices
    (stock_item_id, sub_category_id, item_description, brand, specification,
     unit_price, currency, unit, source, source_vendor_id,
     sourced_by_staff_id, notes, related_check_request_id)
  VALUES
    (v_req.stock_item_id, v_req.sub_category_id, v_req.item_description,
     COALESCE(p_brand, v_req.brand), COALESCE(p_specification, v_req.specification),
     p_unit_price, 'ETB', v_unit, 'check_request_response',
     p_vendor_id, v_staff, p_notes, p_request_id)
  RETURNING id INTO v_price_id;

  UPDATE market_price_check_requests
     SET status='fulfilled', fulfilled_by_market_price_id=v_price_id,
         fulfilled_at=now(), updated_at=now()
   WHERE id=p_request_id;

  IF v_req.order_item_id IS NOT NULL THEN
    UPDATE order_items
       SET unit_price_est=COALESCE(unit_price_est, p_unit_price),
           needs_market_check=false, updated_at=now()
     WHERE id=v_req.order_item_id AND (needs_market_check=true OR unit_price_est IS NULL);
  END IF;
  RETURN v_price_id;
END $$;

REVOKE EXECUTE ON FUNCTION fulfill_market_price_check(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

-- ── cancel_market_price_check (188) — not a trigger, REVOKE added ───
-- Compound pattern: `get_user_role() NOT IN (...) AND requester <> caller`.
CREATE OR REPLACE FUNCTION public.cancel_market_price_check(
  p_request_id uuid, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_req market_price_check_requests%ROWTYPE; v_staff uuid;
BEGIN
  SELECT * INTO v_req FROM market_price_check_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Request % not found', p_request_id; END IF;
  IF v_req.status <> 'open' THEN RAISE EXCEPTION 'Only open requests can be cancelled'; END IF;
  v_staff := public.current_staff_id();
  IF (public.get_user_role() IS NULL OR public.get_user_role() NOT IN ('admin','executive','procurement_officer'))
     AND v_req.requested_by_staff_id <> v_staff THEN
    RAISE EXCEPTION 'Only the requester or Procurement may cancel this request';
  END IF;

  UPDATE market_price_check_requests
     SET status = 'cancelled', cancelled_reason = p_reason, cancelled_at = now(), updated_at = now()
   WHERE id = p_request_id;
END $$;

REVOKE EXECUTE ON FUNCTION cancel_market_price_check(UUID, TEXT) FROM PUBLIC, anon;

-- ── approve_site_petty_cash_request (179) — SECURITY INVOKER, REVOKE added ─
-- Only the pending_finance branch has the NULL-bypass: `v_role NOT IN
-- (...)` with no ELSE. The pending_pm branch is already NULL-safe (it
-- ends in an unconditional ELSE/RAISE), so it is left untouched.
CREATE OR REPLACE FUNCTION public.approve_site_petty_cash_request(p_request_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_role := get_user_role()::text;
  IF v_r.status = 'pending_finance' THEN
    IF v_role IS NULL OR v_role NOT IN ('finance','admin') THEN RAISE EXCEPTION 'Only Finance can approve a pending_finance request'; END IF;
    UPDATE site_petty_cash_float_requests
      SET status='approved', finance_reviewed_by=auth.uid(), finance_reviewed_at=now(), updated_at=now()
      WHERE id=p_request_id;
  ELSIF v_r.status = 'pending_pm' THEN
    IF v_role = 'admin' THEN
      NULL;
    ELSIF v_role = 'project_manager' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = v_r.project_id AND p.project_manager_id = current_staff_id()
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Only the assigned Project Manager can approve a pending_pm request';
    END IF;
    UPDATE site_petty_cash_float_requests
      SET status='approved', pm_reviewed_by=auth.uid(), pm_reviewed_at=now(), updated_at=now()
      WHERE id=p_request_id;
  ELSE
    RAISE EXCEPTION 'Request is not pending (status=%)', v_r.status;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION approve_site_petty_cash_request(UUID) FROM PUBLIC, anon;

-- ── reject_site_petty_cash_request (179) — SECURITY INVOKER, REVOKE added ─
CREATE OR REPLACE FUNCTION public.reject_site_petty_cash_request(p_request_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_role := get_user_role()::text;
  IF v_r.status = 'pending_finance' THEN
    IF v_role IS NULL OR v_role NOT IN ('finance','admin') THEN RAISE EXCEPTION 'Only Finance can reject a pending_finance request'; END IF;
    UPDATE site_petty_cash_float_requests
      SET status='rejected', rejection_reason=p_reason,
          finance_reviewed_by=auth.uid(), finance_reviewed_at=now(), updated_at=now()
      WHERE id=p_request_id;
  ELSIF v_r.status = 'pending_pm' THEN
    IF v_role = 'admin' THEN
      NULL;
    ELSIF v_role = 'project_manager' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = v_r.project_id AND p.project_manager_id = current_staff_id()
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Only the assigned Project Manager can reject a pending_pm request';
    END IF;
    UPDATE site_petty_cash_float_requests
      SET status='rejected', rejection_reason=p_reason,
          pm_reviewed_by=auth.uid(), pm_reviewed_at=now(), updated_at=now()
      WHERE id=p_request_id;
  ELSE
    RAISE EXCEPTION 'Request is not pending (status=%)', v_r.status;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION reject_site_petty_cash_request(UUID, TEXT) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- Verify
-- ════════════════════════════════════════════════════════════════
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN (
  'undo_grn_fulfillment', 'revert_legacy_fulfillment', 'create_batch_payment',
  'match_batch_to_transfer', 'match_expense_to_transfer', 'convert_opening_balances_to_journal_entry',
  'close_fiscal_period', 'reopen_fiscal_period', 'close_vendor_advance', 'sign_off_stock_dispatch',
  'link_expense_vrf', 'confirm_expense_cash_payment', 'match_payroll_to_transfer', 'link_payroll_vrf',
  'auto_match_statement_import', 'commit_statement_import', 'unarchive_all', 'retry_expense_ledger_posting',
  'confirm_vendor_receipt_physical', 'confirm_client_receipt_physical', 'split_expense_partial_payment',
  'reconcile_account', 'confirm_receipt_pickup', 'match_line_to_payroll', 'mark_wht_receipt_prepared',
  'match_expense_to_statement_line', 'rematch_committed_statement_lines',
  'match_sale_to_transfer', 'match_sale_to_statement_line', 'retry_sale_ledger_posting',
  'refresh_exec_dashboard_now',
  'enforce_expense_approval_transitions', 'enforce_cash_advance_approval_transitions',
  'enforce_sale_approval_transitions', 'enforce_payroll_approval_transitions',
  'enforce_fuel_expense_requester', 'enforce_staff_department_assignment',
  'enforce_petty_replenishment_approval_authority', 'enforce_expense_finance_fields',
  'enforce_wo_rater_authority', 'enforce_labor_req_approval_authority',
  'log_verified_market_price', 'fulfill_market_price_check', 'cancel_market_price_check',
  'approve_site_petty_cash_request', 'reject_site_petty_cash_request'
)
ORDER BY proname;

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name IN (
  'undo_grn_fulfillment', 'revert_legacy_fulfillment', 'create_batch_payment',
  'match_batch_to_transfer', 'match_expense_to_transfer', 'convert_opening_balances_to_journal_entry',
  'close_fiscal_period', 'reopen_fiscal_period', 'close_vendor_advance', 'sign_off_stock_dispatch',
  'link_expense_vrf', 'confirm_expense_cash_payment', 'match_payroll_to_transfer', 'link_payroll_vrf',
  'auto_match_statement_import', 'commit_statement_import', 'unarchive_all', 'retry_expense_ledger_posting',
  'confirm_vendor_receipt_physical', 'confirm_client_receipt_physical', 'split_expense_partial_payment',
  'reconcile_account', 'confirm_receipt_pickup', 'match_line_to_payroll', 'mark_wht_receipt_prepared',
  'match_expense_to_statement_line', 'rematch_committed_statement_lines',
  'match_sale_to_transfer', 'match_sale_to_statement_line', 'retry_sale_ledger_posting',
  'refresh_exec_dashboard_now', 'log_verified_market_price', 'fulfill_market_price_check',
  'cancel_market_price_check', 'approve_site_petty_cash_request', 'reject_site_petty_cash_request'
) AND grantee IN ('PUBLIC', 'anon')
ORDER BY routine_name, grantee;
