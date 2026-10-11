-- 443 — A reference links a bill to its bank line once the bill is paid
--
-- Typing a bank reference on a bill linked it to the statement line with that
-- reference at once — even a bill still waiting for approval. A bill recorded
-- from the bank audit ("paid by the bank, not in the system", 440) carries the
-- line's reference from the start, so the line looked reconciled while the
-- books held no payment, and a bill later rejected would have hidden money
-- that left the account.
--
-- Now the reference links a bill sent, paid or paid ahead only. Until then the
-- line stays on the audit, showing the bill already recorded with its
-- reference; paying the bill with it (pay_expense / mark_payment_paid, 442)
-- links the two through the reconciliation, which records the match and books
-- the bank's charge.

SET search_path TO public;

CREATE OR REPLACE FUNCTION auto_sync_expense_bank_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer_id     UUID;
  v_from_account_id UUID;
BEGIN
  IF COALESCE(current_setting('kuncho.ref_autolink', true), '') = 'off' THEN
    RETURN NEW;
  END IF;
  -- Nothing has gone out yet in the system's eyes: the line waits.
  IF NEW.payment_state IS NULL OR NEW.payment_state NOT IN ('sent', 'paid', 'advance') THEN
    RETURN NEW;
  END IF;
  IF NEW.bank_ref IS NOT NULL AND NEW.transfer_id IS NULL
     AND (TG_OP = 'INSERT' OR NEW.bank_ref IS DISTINCT FROM OLD.bank_ref) THEN
    SELECT id, from_account_id INTO v_transfer_id, v_from_account_id
    FROM transfers WHERE transfer_id_code = NEW.bank_ref LIMIT 1;
    IF v_transfer_id IS NOT NULL THEN
      NEW.transfer_id := v_transfer_id;
      NEW.account_id  := COALESCE(NEW.account_id, v_from_account_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
