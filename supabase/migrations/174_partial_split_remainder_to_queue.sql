-- 174 — Partial split: the remainder must not vanish
--
-- The remainder expense was created as unpaid + finance_approved, which put it in
-- NEITHER queue: the to-pay queue needs payment_state='approved_to_pay' and the
-- pending-approval queue needs approval_status in (pending, manager_approved).
-- So a partially-paid expense's remainder disappeared from the payment flow.
--
-- Fix: if the original was already finance-approved (it is, coming from the
-- to-pay queue), the remainder inherits that approval and is created as
-- approved_to_pay — landing straight back in the to-pay queue for next time.

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
  IF get_user_role() NOT IN ('admin', 'finance') THEN
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
