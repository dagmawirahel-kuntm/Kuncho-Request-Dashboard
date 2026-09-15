-- 301 — delete PO-2026-0189 and the expense it created
--
-- Asked for directly. The PO and its expense were both raised on 15 Sep
-- within about ninety seconds of each other — created 11:46:16, submitted
-- 11:46:36, approved 11:46:40, ordered 11:46:43, expense created 11:47:52,
-- finance-approved 11:49:03 — which is the shape of an entry somebody put
-- through to see what happened rather than a real purchase.
--
--   PO-2026-0189   d8abdcac-6668-4c11-b63e-08d01100fee2   ordered
--                  Lexus Trading One Member PLC, pay_in_advance, 28,370.52
--   WORK-TOOL-20260915-01  ba223aab-6e5a-41c7-879e-4eaa0e493e3c
--                  purchase_order, finance_approved, approved_to_pay, 28,370.52
--
-- ── What was checked before removing them ────────────────────────────────
--
-- Every table that can point at either row was counted, and only one had
-- anything in it: the single sourcing_bundle_item for the Ingco drill.
-- Specifically empty: goods_received_notes, transportation_requests,
-- vendor_credits, payment_requests, batch_payment_expenses, order_expenses,
-- expense_order_items, stock_receipts, tool_units, fixed_assets,
-- cash_payment_receipts, cash_advance_expenses, vendor_receipts,
-- vendor_credit_applications, purchase_allocation, cpo_bonds, and any split
-- child. No journal_entries and no ledger_posting_failures name either id,
-- so nothing was posted to the ledger and nothing has to be unposted.
--
-- Nothing on the expense says money moved: payment_status false, paid_date
-- null, transfer_id null, payment_confirmed_at null, payment_state still
-- 'approved_to_pay'. No bank_statement_lines row is matched to it.
--
-- ── The one thing that is not clean, recorded deliberately ───────────────
--
-- The expense carries bank_ref 'FT26258C3QG4'. That is the shape of a real
-- CBE transaction reference, and 26258 decodes to day 258 of 2026 — 15 Sep,
-- the day the expense was raised. No imported statement line carries it, but
-- imports currently stop in early September, so the absence proves nothing.
-- If that transfer really was made, deleting this expense removes the only
-- record of what the 28,370.52 was for. That is why the full contents of all
-- three rows are written into this migration below rather than summarised:
-- the deletion is reversible from this file alone.
--
-- ── Snapshot: exactly what is being removed ──────────────────────────────
--
-- sourcing_bundles d8abdcac-6668-4c11-b63e-08d01100fee2
--   bundle_code PO-2026-0189, status ordered, vendor_id
--   ddd6f32b-283d-45f1-9a2f-2336bdf57fd3 (Lexus Trading One Member PLC),
--   vendor_name null, payment_pattern pay_in_advance,
--   items_subtotal_etb 28370.52, discount_kind none, discount_value 0,
--   discount_etb 0, discount_reason null, total_value 28370.52,
--   rejection_deduction_etb 0, expected_delivery_date 2026-09-15,
--   procurement_officer_id df456dc7-e8da-481a-a038-b277093527c2,
--   approved_by df456dc7-e8da-481a-a038-b277093527c2,
--   submitted_at 2026-09-15T11:46:36.936Z, approved_at 11:46:40.017Z,
--   ordered_at 11:46:43.613Z, fulfilled_at null, notes null,
--   finance_notes null, created_at 11:46:16.342211Z,
--   updated_at 11:47:52.963775Z, expense_id ba223aab-…
--
-- sourcing_bundle_items 600e5a85-55a8-4298-9d0f-0026e6fcd4c0
--   bundle_id d8abdcac-…, order_item_id fbf29695-29b0-4835-a469-41570f77e122,
--   quantity_actual 2.000, unit_price_actual 14185.26, sort_order 0,
--   notes null, created_at 2026-09-15T11:46:30.902446Z
--
-- expenses ba223aab-6e5a-41c7-879e-4eaa0e493e3c
--   expense_code WORK-TOOL-20260915-01, expense_type purchase_order,
--   item_service_description 'PO PO-2026-0189 — Ingco drill',
--   amount_etb 28370.52, net_payable 28370.52, credit_applied_etb 0.00,
--   date 2026-09-15, approval_status finance_approved,
--   payment_state approved_to_pay, payment_status false, requested false,
--   vendor_id ddd6f32b-…, vendors_bank_account 1000732622113,
--   account_id 890c3473-dc57-4c01-9f39-17518047c463 (CBE),
--   project_id cfbb5eb7-30d0-4700-903c-e072d15488f8,
--   category_id af84965d-fc4f-4fc2-87f9-94844679bb96, sub_category_id null,
--   fiscal_period_id b6b2ae8b-35f6-4394-bb68-394b19db7cf1,
--   bank_ref FT26258C3QG4, verify_wht true, wht_amount null,
--   purchaser_user_id df456dc7-…, finance_approved_by df456dc7-…,
--   finance_approved_at 2026-09-15T11:49:03.551288Z,
--   manager_approved_by null, manager_approved_at null,
--   payment_state_changed_at 2026-09-15T11:49:03.551288Z,
--   requires_finance_approval false, is_archived false, is_allocated false,
--   delivery_status [], notes null, receipt_url null, transfer_id null,
--   paid_date null, payment_confirmed_at null, sourcing_bundle_id d8abdcac-…,
--   created_at 2026-09-15T11:47:52.31942Z, updated_at 11:51:29.358447Z.
--   Every other column is null or false.

DO $$
DECLARE
  v_bundle  uuid := 'd8abdcac-6668-4c11-b63e-08d01100fee2';
  v_expense uuid := 'ba223aab-6e5a-41c7-879e-4eaa0e493e3c';
  v_n       int;
BEGIN
  -- Re-checked at run time rather than trusted from the investigation above.
  -- If any of this changed between then and now, the delete is the wrong
  -- thing to do and this stops instead.
  IF NOT EXISTS (SELECT 1 FROM sourcing_bundles WHERE id = v_bundle AND bundle_code = 'PO-2026-0189') THEN
    RAISE EXCEPTION 'PO-2026-0189 is not the bundle at %', v_bundle;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM expenses WHERE id = v_expense AND expense_code = 'WORK-TOOL-20260915-01') THEN
    RAISE EXCEPTION 'WORK-TOOL-20260915-01 is not the expense at %', v_expense;
  END IF;

  SELECT count(*) INTO v_n FROM expenses
   WHERE id = v_expense
     AND (payment_status IS TRUE OR paid_date IS NOT NULL OR transfer_id IS NOT NULL
          OR payment_confirmed_at IS NOT NULL OR payment_state IN ('sent', 'paid'));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'the expense now records a payment — not deleting it';
  END IF;

  SELECT count(*) INTO v_n FROM journal_entries WHERE source_id IN (v_bundle, v_expense);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% journal entr(ies) post from these rows — reverse them first', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM goods_received_notes WHERE sourcing_bundle_id = v_bundle;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'the PO has a goods received note — the goods arrived, so this is not a mistaken entry';
  END IF;

  SELECT count(*) INTO v_n FROM bank_statement_lines WHERE matched_expense_id = v_expense;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'a bank statement line is matched to this expense — unmatch it first';
  END IF;

  SELECT count(*) INTO v_n FROM payment_requests WHERE expense_id = v_expense;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'a Payment Request was issued against this expense — void it first';
  END IF;

  -- The requested line goes back in the queue. Sourcing it is what moved it
  -- to 'sourced', so un-sourcing it has to put it back — otherwise the Ingco
  -- drill silently disappears from the sourcing list with nothing bought.
  -- Same revert SourcingBundleFormPage performs when a line is removed.
  UPDATE order_items SET status = 'pending'
   WHERE id IN (SELECT order_item_id FROM sourcing_bundle_items WHERE bundle_id = v_bundle)
     AND status = 'sourced';

  -- Expense first: sourcing_bundles.expense_id is ON DELETE SET NULL, so the
  -- bundle lets go of it by itself.
  DELETE FROM expenses WHERE id = v_expense;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'expected to delete 1 expense, deleted %', v_n; END IF;

  -- The two guards that freeze a PO once it leaves drafting stand between us
  -- and an 'ordered' bundle. They are right to be there — this deletion is
  -- the deliberate exception, so they come off for these two statements and
  -- go straight back on.
  ALTER TABLE sourcing_bundle_items DISABLE TRIGGER trg_enforce_bundle_items_drafting_only;
  ALTER TABLE sourcing_bundles      DISABLE TRIGGER trg_enforce_bundle_drafting_only;

  DELETE FROM sourcing_bundle_items WHERE bundle_id = v_bundle;
  DELETE FROM sourcing_bundles WHERE id = v_bundle;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  ALTER TABLE sourcing_bundles      ENABLE TRIGGER trg_enforce_bundle_drafting_only;
  ALTER TABLE sourcing_bundle_items ENABLE TRIGGER trg_enforce_bundle_items_drafting_only;

  IF v_n <> 1 THEN RAISE EXCEPTION 'expected to delete 1 bundle, deleted %', v_n; END IF;

  IF EXISTS (SELECT 1 FROM sourcing_bundles WHERE id = v_bundle)
     OR EXISTS (SELECT 1 FROM expenses WHERE id = v_expense)
     OR EXISTS (SELECT 1 FROM sourcing_bundle_items WHERE bundle_id = v_bundle) THEN
    RAISE EXCEPTION 'something survived the delete';
  END IF;
END $$;
