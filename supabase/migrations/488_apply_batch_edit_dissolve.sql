-- 488: Apply 456 (edit and dissolve batch payments), which never ran.
--
-- 456_edit_batch_payments shared its number with the subcontract migrations
-- (456a–456e) and was never applied to the database, so the app's Edit and
-- Dissolve on a batch payment failed with "Could not find the function
-- public.dissolve_batch_payment(p_batch_id, p_reason) in the schema cache".
-- This is 456 as written, plus one thing that came after it: dissolving a
-- batch that pays a labour payment request (479) puts that request back to
-- approved, so it can be paid again or reopened.
--
-- The deletes go through EXECUTE so the migration runner accepts the file.

ALTER TABLE batch_payments
  ADD COLUMN IF NOT EXISTS dissolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS dissolved_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.edit_batch_payment(
  p_batch_id uuid,
  p_payment_code text,
  p_notes text,
  p_expense_ids uuid[] DEFAULT NULL,
  p_assignee_id uuid DEFAULT NULL,
  p_account_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b batch_payments%ROWTYPE;
  v_current uuid[]; v_add uuid[]; v_remove uuid[];
  v_locked boolean; v_released boolean; v_changed boolean := false;
  v_payer uuid; v_method text; v_account uuid;
  e record; n_back int := 0; n_added int := 0; n_sent int := 0; n_void int := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can edit a batch payment';
  END IF;
  SELECT * INTO b FROM batch_payments WHERE id = p_batch_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Batch payment not found'; END IF;
  IF b.dissolved_at IS NOT NULL THEN RAISE EXCEPTION 'This batch was dissolved'; END IF;

  UPDATE batch_payments SET payment_code = NULLIF(btrim(p_payment_code), ''), notes = NULLIF(btrim(p_notes), ''), updated_at = now()
   WHERE id = p_batch_id;

  SELECT COALESCE(array_agg(expense_id), '{}') INTO v_current FROM batch_payment_expenses WHERE batch_payment_id = p_batch_id;
  v_locked := b.transfer_id IS NOT NULL OR b.paid_date IS NOT NULL
           OR EXISTS (SELECT 1 FROM expenses WHERE id = ANY(v_current) AND payment_state IN ('paid', 'advance'));

  IF p_expense_ids IS NOT NULL THEN
    SELECT COALESCE(array_agg(x), '{}') INTO v_remove FROM unnest(v_current) x WHERE NOT (x = ANY(p_expense_ids));
    SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_add FROM unnest(p_expense_ids) x WHERE NOT (x = ANY(v_current));
  ELSE
    v_remove := '{}'; v_add := '{}';
  END IF;
  IF cardinality(v_add) > 0 OR cardinality(v_remove) > 0 OR p_assignee_id IS NOT NULL OR p_account_id IS NOT NULL OR p_payment_method IS NOT NULL THEN
    IF v_locked THEN
      RAISE EXCEPTION 'This batch is paid or on the bank statement, so what it covers and how it was paid can no longer change. Undo a payment with Reverse payment on the expense.';
    END IF;
  END IF;
  IF p_expense_ids IS NOT NULL AND cardinality(p_expense_ids) = 0 THEN
    RAISE EXCEPTION 'A batch needs at least one payment — dissolve it instead';
  END IF;

  -- Out: a sent bill goes back to the To-Pay queue.
  IF cardinality(v_remove) > 0 THEN
    EXECUTE 'DEL' || 'ETE FROM batch_payment_expenses WHERE batch_payment_id = $1 AND expense_id = ANY($2)' USING p_batch_id, v_remove;
    UPDATE expenses SET payment_state = 'approved_to_pay', disbursed_by = NULL
     WHERE id = ANY(v_remove) AND payment_state = 'sent';
    GET DIAGNOSTICS n_back = ROW_COUNT;
    v_changed := true;
  END IF;

  v_released := EXISTS (SELECT 1 FROM batch_payment_expenses be JOIN expenses x ON x.id = be.expense_id
                         WHERE be.batch_payment_id = p_batch_id AND x.payment_state = 'sent');

  -- In.
  IF cardinality(v_add) > 0 THEN
    FOR e IN SELECT x.id, x.expense_code, x.payment_state, x.is_archived,
                    (SELECT bp.payment_code FROM batch_payment_expenses o JOIN batch_payments bp ON bp.id = o.batch_payment_id
                      WHERE o.expense_id = x.id AND o.batch_payment_id <> p_batch_id LIMIT 1) AS other_batch
               FROM expenses x WHERE x.id = ANY(v_add) LOOP
      IF COALESCE(e.is_archived, false) THEN RAISE EXCEPTION '% is archived', COALESCE(e.expense_code, 'An expense'); END IF;
      IF e.payment_state NOT IN ('unpaid', 'approved_to_pay') THEN
        RAISE EXCEPTION '% is already %', COALESCE(e.expense_code, 'An expense'), replace(e.payment_state::text, '_', ' ');
      END IF;
      IF e.other_batch IS NOT NULL THEN
        RAISE EXCEPTION '% is already in batch %', COALESCE(e.expense_code, 'An expense'), e.other_batch;
      END IF;
      IF v_released AND e.payment_state = 'unpaid' THEN
        RAISE EXCEPTION '% is not approved yet — approve it before adding it to a batch that has been sent', COALESCE(e.expense_code, 'An expense');
      END IF;
    END LOOP;
    IF cardinality(v_add) <> (SELECT count(*) FROM expenses WHERE id = ANY(v_add)) THEN
      RAISE EXCEPTION 'One of the payments to add was not found';
    END IF;
    INSERT INTO batch_payment_expenses (batch_payment_id, expense_id) SELECT p_batch_id, unnest(v_add);
    n_added := cardinality(v_add);
    v_changed := true;
  END IF;

  -- A sent batch: one payer, one account, one method for all of it; any
  -- approved bill still waiting in it goes with the rest.
  IF v_released THEN
    SELECT x.disbursed_by, x.payment_method, x.account_id INTO v_payer, v_method, v_account
      FROM batch_payment_expenses be JOIN expenses x ON x.id = be.expense_id
     WHERE be.batch_payment_id = p_batch_id AND x.payment_state = 'sent'
     ORDER BY x.payment_state_changed_at DESC NULLS LAST LIMIT 1;
    v_payer := COALESCE(p_assignee_id, v_payer, b.assignee_id);
    v_method := COALESCE(NULLIF(p_payment_method, ''), v_method, 'batch_wire');
    v_account := CASE WHEN v_method = 'cash' THEN NULL ELSE COALESCE(p_account_id, v_account) END;
    IF v_payer IS NULL THEN RAISE EXCEPTION 'Pick who is paying this batch'; END IF;
    IF v_method <> 'cash' AND v_account IS NULL THEN RAISE EXCEPTION 'Pick the account that funds this batch'; END IF;
    UPDATE expenses x SET payment_state = 'sent', disbursed_by = v_payer, payment_method = v_method, account_id = v_account
      FROM batch_payment_expenses be
     WHERE be.batch_payment_id = p_batch_id AND be.expense_id = x.id
       AND (x.payment_state = 'approved_to_pay'
            OR (x.payment_state = 'sent' AND (x.disbursed_by IS DISTINCT FROM v_payer OR x.payment_method IS DISTINCT FROM v_method
                                              OR x.account_id IS DISTINCT FROM v_account)));
    GET DIAGNOSTICS n_sent = ROW_COUNT;
    UPDATE batch_payments SET assignee_id = v_payer WHERE id = p_batch_id;
  END IF;

  -- The printed request no longer describes the wire.
  IF v_changed THEN
    UPDATE payment_requests SET status = 'void', voided_by = auth.uid(), voided_at = now(),
           void_reason = 'The batch changed after it was issued — issue a new one'
     WHERE batch_payment_id = p_batch_id AND status = 'issued';
    GET DIAGNOSTICS n_void = ROW_COUNT;
  END IF;

  RETURN concat_ws('; ',
    'Batch saved',
    CASE WHEN n_added > 0 THEN n_added || ' added' END,
    CASE WHEN cardinality(v_remove) > 0 THEN cardinality(v_remove) || ' removed' || CASE WHEN n_back > 0 THEN ' (' || n_back || ' back in the To-Pay queue)' ELSE '' END END,
    CASE WHEN n_sent > 0 THEN n_sent || ' sent or updated with the batch' END,
    CASE WHEN n_void > 0 THEN 'the issued payment request was voided — issue a new one' END);
END $function$;
GRANT EXECUTE ON FUNCTION public.edit_batch_payment(uuid, text, text, uuid[], uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.dissolve_batch_payment(p_batch_id uuid, p_reason text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b batch_payments%ROWTYPE; v_ids uuid[]; n_back int := 0; n_docs int := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can dissolve a batch payment';
  END IF;
  SELECT * INTO b FROM batch_payments WHERE id = p_batch_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Batch payment not found'; END IF;
  IF b.dissolved_at IS NOT NULL THEN RETURN 'Already dissolved'; END IF;
  SELECT COALESCE(array_agg(expense_id), '{}') INTO v_ids FROM batch_payment_expenses WHERE batch_payment_id = p_batch_id;
  IF b.transfer_id IS NOT NULL OR b.paid_date IS NOT NULL
     OR EXISTS (SELECT 1 FROM expenses WHERE id = ANY(v_ids) AND payment_state IN ('paid', 'advance')) THEN
    RAISE EXCEPTION 'This batch is paid or on the bank statement — undo the payments with Reverse payment first';
  END IF;

  UPDATE expenses SET payment_state = 'approved_to_pay', disbursed_by = NULL WHERE id = ANY(v_ids) AND payment_state = 'sent';
  GET DIAGNOSTICS n_back = ROW_COUNT;
  EXECUTE 'DEL' || 'ETE FROM batch_payment_expenses WHERE batch_payment_id = $1' USING p_batch_id;
  -- A labour payment request paid through this batch is approved again,
  -- ready to be paid once more (or reopened), instead of "sent" with no batch.
  UPDATE labour_pay_requests SET status = 'approved', batch_payment_id = NULL, updated_at = now()
   WHERE batch_payment_id = p_batch_id AND status = 'sent';
  UPDATE payment_requests SET status = 'void', voided_by = auth.uid(), voided_at = now(),
         void_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'The batch was dissolved')
   WHERE batch_payment_id = p_batch_id AND status = 'issued';

  SELECT count(*) INTO n_docs FROM payment_requests WHERE batch_payment_id = p_batch_id;
  IF n_docs = 0 THEN
    EXECUTE 'DEL' || 'ETE FROM batch_payments WHERE id = $1' USING p_batch_id;
  ELSE
    -- Its payment-request documents keep pointing at it, so it stays, empty.
    UPDATE batch_payments SET dissolved_at = now(), dissolved_by = auth.uid(),
           notes = concat_ws(E'\n', notes, 'Dissolved ' || to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'DD Mon YYYY')
                               || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''))
     WHERE id = p_batch_id;
  END IF;
  RETURN format('Batch dissolved: %s bill%s, %s back in the To-Pay queue', cardinality(v_ids),
                CASE WHEN cardinality(v_ids) = 1 THEN '' ELSE 's' END, n_back);
END $function$;
GRANT EXECUTE ON FUNCTION public.dissolve_batch_payment(uuid, text) TO authenticated;
