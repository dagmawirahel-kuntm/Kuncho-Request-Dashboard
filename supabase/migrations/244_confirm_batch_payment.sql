-- Found live: batch-paid labor expenses (create_batch_payment sets
-- payment_state='sent', payment_method='batch_wire') never advance past
-- 'sent'. Every OTHER payment method has a confirmation step that moves
-- it to 'paid' -- cash has confirm_expense_cash_payment(), transfer/cpo/
-- cheque get matched to an imported bank statement line, vrf gets
-- confirmed by the VRF Manager. 'batch_wire' has none: nothing in the
-- frontend ever sets payment_state='paid' for it. Since
-- post_expense_payment_to_ledger only fires "IF NEW.payment_state NOT IN
-- ('paid','advance') THEN RETURN NEW", a batch-paid labor expense also
-- never posts a journal entry -- it's invisible everywhere that reads
-- confirmed payments (the ledger, any 'paid'-only report), which is
-- exactly the "not coming in the payment table" symptom reported live.
--
-- Adds the missing confirmation step, mirroring confirm_expense_cash_payment.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.confirm_batch_payment(p_batch_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can confirm a batch payment';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM batch_payments WHERE id = p_batch_payment_id) THEN
    RAISE EXCEPTION 'Batch payment % not found', p_batch_payment_id;
  END IF;

  UPDATE expenses
     SET payment_state = 'paid'
   WHERE payment_state = 'sent'
     AND id IN (SELECT expense_id FROM batch_payment_expenses WHERE batch_payment_id = p_batch_payment_id);
END;
$function$;
