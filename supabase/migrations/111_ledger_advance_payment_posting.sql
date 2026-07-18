-- ============================================================
-- Ledger posting for the two payment patterns, correctly reflected in
-- the accounts:
--   Pattern A (pay_on_delivery): unchanged — Debit Expense, Credit Cash.
--   Pattern B (pay_in_advance): the payment debits Vendor Advances
--     (asset) and credits Cash; closing the advance (GRN received)
--     debits the Expense account and credits Vendor Advances — cash
--     doesn't move a second time, only the classification does.
--
-- Same non-blocking discipline as every other posting rule (migration
-- 105): wrapped in its own BEGIN/EXCEPTION, SET CONSTRAINTS forced
-- IMMEDIATE then reset DEFERRED so a posting failure is caught here,
-- never propagated to block the underlying expense write.
-- ============================================================

SET search_path TO public;

INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable) VALUES
  ('1080', 'Vendor Advances', 'Asset', (SELECT id FROM chart_of_accounts WHERE account_code = '1000'), TRUE)
ON CONFLICT (account_code) DO NOTHING;

CREATE OR REPLACE FUNCTION post_expense_payment_to_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy UUID;
  v_row_fy     UUID;
  v_expense_account_id UUID;
  v_cash_account_id    UUID;
  v_advance_account_id UUID;
  v_entry_id   UUID;
  v_is_advance_close BOOLEAN;
  v_existing_count INT;
BEGIN
  v_is_advance_close := (TG_OP = 'UPDATE' AND OLD.payment_state = 'advance' AND NEW.payment_state = 'paid');

  -- Two entry points now, not one: a fresh 'advance' (Pattern B's
  -- payment leg) or a fresh 'paid' (Pattern A directly, or Pattern
  -- B's close leg — v_is_advance_close tells them apart below).
  IF NOT (
    (NEW.payment_state = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'paid'))
    OR (NEW.payment_state = 'advance' AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance'))
  ) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_existing_count FROM journal_entries WHERE source_table = 'expenses' AND source_id = NEW.id;

  -- Idempotency, per leg rather than per expense — a Pattern-B
  -- expense legitimately gets TWO entries over its life (advance,
  -- then close), so "any entry already exists" can't be the guard
  -- here the way it is for every other posting rule. The advance leg
  -- posts only when nothing exists yet; the close leg posts only when
  -- exactly the advance leg's one entry exists; a direct paid (no
  -- advance involved) posts only when nothing exists yet.
  IF NEW.payment_state = 'advance' AND v_existing_count > 0 THEN RETURN NEW; END IF;
  IF NEW.payment_state = 'paid' AND v_is_advance_close AND v_existing_count <> 1 THEN RETURN NEW; END IF;
  IF NEW.payment_state = 'paid' AND NOT v_is_advance_close AND v_existing_count > 0 THEN RETURN NEW; END IF;

  BEGIN
    SELECT coa.id INTO v_expense_account_id FROM chart_of_accounts coa WHERE coa.category_id = NEW.category_id;
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;
    SELECT id INTO v_advance_account_id FROM chart_of_accounts WHERE account_code = '1080';

    IF NEW.payment_state = 'advance' THEN
      IF v_advance_account_id IS NULL OR v_cash_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post advance: advance account %s, account_id=%s -> cash account %s, amount_etb=%s',
          v_advance_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Vendor advance recorded: ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_advance_account_id, NEW.amount_etb, 0, 'Advance — goods not yet received: ' || COALESCE(NEW.item_service_description, '')),
        (v_entry_id, v_cash_account_id, 0, NEW.amount_etb, 'Paid via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));

    ELSIF v_is_advance_close THEN
      IF v_expense_account_id IS NULL OR v_advance_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot close advance: category_id=%s -> expense account %s, advance account %s, amount_etb=%s',
          NEW.category_id, v_expense_account_id, v_advance_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Vendor advance closed (GRN received): ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description),
        (v_entry_id, v_advance_account_id, 0, NEW.amount_etb, 'Advance closed — goods received');

    ELSE
      -- Direct 'paid', not via an advance — Pattern A, or an ad-hoc
      -- expense outside the bundle chain. Unchanged from migration 105.
      IF v_expense_account_id IS NULL OR v_cash_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post: category_id=%s -> expense account %s, account_id=%s -> cash account %s, amount_etb=%s',
          NEW.category_id, v_expense_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Expense paid: ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description),
        (v_entry_id, v_cash_account_id, 0, NEW.amount_etb, 'Paid via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));
    END IF;

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('expenses', NEW.id, SQLERRM);
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_expense_payment_to_ledger ON expenses;
CREATE TRIGGER trg_post_expense_payment_to_ledger
  AFTER INSERT OR UPDATE OF payment_state ON expenses
  FOR EACH ROW EXECUTE FUNCTION post_expense_payment_to_ledger();

-- Verify: Vendor Advances account present, function/trigger updated.
SELECT account_code, account_name, nature FROM chart_of_accounts WHERE account_code = '1080';
SELECT tgname FROM pg_trigger WHERE tgrelid = 'expenses'::regclass AND tgname = 'trg_post_expense_payment_to_ledger';
