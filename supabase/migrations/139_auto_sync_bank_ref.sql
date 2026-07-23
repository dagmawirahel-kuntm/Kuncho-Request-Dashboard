-- ============================================================
-- Auto-sync: once expenses.bank_ref is populated (or changed) and a
-- transfer with that exact reference already exists — e.g. from a
-- bank statement import that landed before the expense's own
-- bank_ref was typed in — link it immediately, instead of only
-- catching the match at import time (auto_match_statement_import,
-- migration 138, only checks the OTHER direction: transfers imported
-- while an expense's bank_ref already existed).
--
-- Deliberately does NOT touch payment_state. bank_ref is a plain data
-- field finance can edit at any point in an expense's life — forcing
-- payment_state to 'paid' as a side effect here would collide head-on
-- with 098's segregation-of-duty gate (needs a real, different
-- finance_approved_by/disbursed_by pair) and could reject an
-- otherwise-ordinary bank_ref edit outright. Linking transfer_id is a
-- safe, reversible side effect; changing payment_state is a deliberate
-- action left to match_expense_to_transfer / the existing "Match to
-- Bank Line" flow.
--
-- bank_ref is already finance/admin-only editable in the UI
-- (ExpenseFormPage's financeLocked gate), so this trigger setting
-- transfer_id as a side effect of the same UPDATE never conflicts with
-- 098's enforce_expense_finance_fields role check — it's the same
-- actor's statement either way.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION auto_sync_expense_bank_ref()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer_id UUID;
BEGIN
  IF NEW.bank_ref IS NOT NULL AND NEW.transfer_id IS NULL
     AND (TG_OP = 'INSERT' OR NEW.bank_ref IS DISTINCT FROM OLD.bank_ref) THEN
    SELECT id INTO v_transfer_id FROM transfers WHERE transfer_id_code = NEW.bank_ref LIMIT 1;
    IF v_transfer_id IS NOT NULL THEN
      NEW.transfer_id := v_transfer_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_sync_expense_bank_ref ON expenses;
CREATE TRIGGER trg_auto_sync_expense_bank_ref
  BEFORE INSERT OR UPDATE OF bank_ref ON expenses
  FOR EACH ROW EXECUTE FUNCTION auto_sync_expense_bank_ref();

-- Verify
SELECT tgname FROM pg_trigger WHERE tgrelid = 'expenses'::regclass AND tgname = 'trg_auto_sync_expense_bank_ref';
