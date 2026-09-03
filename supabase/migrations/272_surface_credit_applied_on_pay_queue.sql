-- 272 — Make a credit-funded payable visible where it's actually paid
--
-- Reported: PO-2026-0115 had the vendor credit applied to it, but there
-- was no way to tell that at the point of prepping it for payment.
--
-- Checked where finance actually executes a payment and found the gap is
-- worse than "not shown": it's actively wrong on the one screen that
-- decides the wire amount.
--
--   v_to_pay_queue (the To Pay list) never carried credit_applied_etb,
--   so every render site fell back to net_payable ?? amount_etb — the
--   gross-minus-WHT figure, with no idea a credit had reduced the cash
--   still owed.
--
--   The "Record Advance Payment" modal is the one PO-2026-0115 actually
--   goes through (payment_pattern = pay_in_advance). It pulls amount_etb
--   directly and labels it "Advance amount (full approved)" — the
--   literal number finance would wire. For this PO that is 54,665.04,
--   6,173.94 more than the 48,491.10 that should actually move, which
--   would silently defeat the whole point of applying the credit and
--   overpay the vendor by exactly the amount the credit was meant to
--   save.
--
-- ── A second, independent bug found while checking this ─────────────────────
--
-- split_expense_partial_payment() (migration 209 or thereabouts) copies
-- the original expense's columns into the new "remainder" row via an
-- explicit column list that predates credit_applied_etb, so it isn't in
-- it. The "paid part" row keeps the ORIGINAL credit_applied_etb while
-- its amount_etb shrinks to whatever was split off — so a split of, say,
-- 3,000 out of a 54,665.04 expense with 6,173.94 of credit applied would
-- leave credit_applied_etb (6,173.94) larger than amount_etb (3,000) on
-- the paid-part row. post_expense_payment_to_ledger()'s v_cash :=
-- amount_etb - credit_applied_etb would go negative, and the remainder
-- row would carry no record of the credit at all. "Pay part" is offered
-- on every to-pay row regardless of payment_pattern, so this was
-- reachable for PO-2026-0115 today, not a hypothetical.
--
-- No safe automatic split exists here — proportioning the credit across
-- both halves is guessable but not verifiable from the data alone. So
-- this is refused outright, the same stance already taken in 269 for
-- partial settlement from a credit: fail loudly with a specific reason
-- rather than produce a number nobody can reconcile.

-- ── 1. The to-pay queue carries the credit and the real cash figure ─────────

CREATE OR REPLACE VIEW public.v_to_pay_queue AS
SELECT
  e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.project_id,
  p.project_name,
  c.cost_group_id,
  cg.name AS cost_group_name,
  e.verify_wht,
  e.finance_approved_by,
  e.finance_approved_at,
  EXTRACT(day FROM (now() - e.finance_approved_at)) AS days_since_approval,
  e.sourcing_bundle_id,
  sb.payment_pattern,
  e.net_payable,
  e.wht_amount,
  COALESCE(e.credit_applied_etb, 0) AS credit_applied_etb,
  -- Same formula as v_credit_applicable_payables.cash_payable (271) —
  -- one definition of "what actually has to move," not two that can
  -- drift apart.
  COALESCE(e.amount_etb, 0) - COALESCE(e.wht_amount, 0) - COALESCE(e.credit_applied_etb, 0) AS cash_to_send
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN categories c ON c.id = e.category_id
LEFT JOIN cost_groups cg ON cg.id = c.cost_group_id
LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
WHERE e.payment_state = 'approved_to_pay';

GRANT SELECT ON public.v_to_pay_queue TO authenticated;

COMMENT ON VIEW public.v_to_pay_queue IS
  'Expenses approved and awaiting payment. cash_to_send is what should actually move — amount_etb net of WHT and any vendor credit already applied — and is the figure any payment-execution UI should show and use, not amount_etb or net_payable alone.';

-- ── 2. Refuse to split a credit-funded expense ───────────────────────────────

CREATE OR REPLACE FUNCTION public.split_expense_partial_payment(
  p_expense_id uuid,
  p_paid_amount numeric,
  p_disbursed_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- A vendor credit was applied against the whole of this expense, not a
  -- portion of it. Splitting would leave one side under-crediting and the
  -- other over-crediting, with no source data to say how to divide it
  -- correctly — so this fails loudly rather than guessing.
  IF COALESCE(v_orig.credit_applied_etb, 0) > 0 THEN
    RAISE EXCEPTION 'Expense % has % ETB of vendor credit applied — it cannot be split into a partial payment. Pay the remaining cash amount (see cash_to_send) in full, or contact finance to unwind the credit application first.',
      COALESCE(v_orig.expense_code, v_orig.id::text), v_orig.credit_applied_etb;
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

COMMENT ON FUNCTION public.split_expense_partial_payment IS
  'Splits an approved expense into a paid portion and a remainder still in the queue. Refuses expenses with a vendor credit already applied (credit_applied_etb > 0) — the credit cannot be safely divided between the two resulting rows.';
