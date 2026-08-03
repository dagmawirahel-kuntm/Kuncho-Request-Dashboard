-- 168 — Fix partial-payment split hitting a generated column
--
-- split_expense_partial_payment (migration 164) listed requires_finance_approval
-- in its INSERT and selected the parent's value. That column is GENERATED ALWAYS
-- ((amount_etb > 50000)), so Postgres rejects any explicit value:
--   "cannot insert a non-DEFAULT value into column requires_finance_approval".
--
-- Drop it from the INSERT — Postgres recomputes it from the remainder row's own
-- amount, which is exactly what we want (a small remainder may no longer need
-- finance sign-off even if the original did).

CREATE OR REPLACE FUNCTION public.split_expense_partial_payment(p_expense_id uuid, p_paid_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orig     expenses%ROWTYPE;
  v_remainder NUMERIC;
  v_new_id   UUID;
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

  v_remainder := v_orig.amount_etb - p_paid_amount;

  -- requires_finance_approval is a GENERATED column — NOT in the INSERT.
  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, purchase_type, quantity, uom,
    category_id, sub_category_id, vendor_id, project_id, staff_id, purchaser_user_id,
    account_id, location_id, vehicle_id, property_id,
    requested, payment_status, partially_paid, payment_state,
    approval_status, split_parent_id, notes
  )
  SELECT
    v_orig.item_service_description, v_remainder, v_orig.expense_type, v_orig.purchase_type, v_orig.quantity, v_orig.uom,
    v_orig.category_id, v_orig.sub_category_id, v_orig.vendor_id, v_orig.project_id, v_orig.staff_id, v_orig.purchaser_user_id,
    v_orig.account_id, v_orig.location_id, v_orig.vehicle_id, v_orig.property_id,
    true, false, false, 'unpaid',
    v_orig.approval_status, v_orig.id,
    COALESCE(v_orig.notes || ' | ', '') || 'Remainder of ' || COALESCE(v_orig.expense_code, v_orig.id::text) || ' after partial payment'
  RETURNING id INTO v_new_id;

  UPDATE expenses SET
    amount_etb = p_paid_amount, payment_status = true, partially_paid = false,
    payment_state = 'paid', paid_date = COALESCE(paid_date, CURRENT_DATE),
    notes = COALESCE(notes || ' | ', '') || 'Partially paid; remainder moved to a new expense'
  WHERE id = p_expense_id;

  RETURN v_new_id;
END;
$function$;
