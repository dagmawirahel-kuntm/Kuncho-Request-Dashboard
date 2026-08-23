-- 245 made p_account_id mandatory on create_batch_payment, assuming
-- every batch is bank-wire funded. Live case (Solomon Apartment, ~7
-- labor lines) was actually paid in cash -- and every cash-method
-- expense in this app, batch or not, has always gone through with no
-- account_id at all (checked live: 0 of 8 pre-existing cash expenses
-- have one). Forcing an account choice on a cash-funded batch was
-- wrong, not stricter-but-safer.
--
-- create_batch_payment now takes an explicit p_payment_method
-- (defaults to 'batch_wire', matching prior behavior) and only requires
-- p_account_id when the method actually needs one to post to the ledger
-- later (transfer/cpo/cheque/batch_wire) -- cash can go through with
-- account_id left null, same as the rest of the app.

SET search_path TO public;

DROP FUNCTION IF EXISTS public.create_batch_payment(uuid[], uuid, uuid, text, text);
CREATE FUNCTION public.create_batch_payment(
  p_expense_ids uuid[], p_assignee_id uuid, p_account_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT 'batch_wire', p_payment_code text DEFAULT NULL::text, p_notes text DEFAULT NULL::text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  IF p_account_id IS NULL AND p_payment_method <> 'cash' THEN
    RAISE EXCEPTION 'An account must be selected to fund a % batch payment', p_payment_method;
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
      payment_method = p_payment_method,
      account_id = p_account_id
  WHERE id = ANY(p_expense_ids);

  RETURN v_batch_id;
END;
$function$;
