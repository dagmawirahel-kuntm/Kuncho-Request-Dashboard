-- ============================================================
-- Bug: bank-matching a sale/expense after it was already marked
-- Paid/paid (but failed to post to the ledger, e.g. because
-- account_id wasn't set yet) never re-attempted the posting.
--
-- All three post_*_payment_to_ledger() triggers only fired on a
-- fresh "not paid -> paid" transition (OLD.status IS DISTINCT FROM
-- NEW.status). match_sale_to_transfer / match_expense_to_transfer
-- (migration 200/201) unconditionally reassert sales_status='Paid' /
-- payment_state='paid' in their UPDATE — which still fires the
-- column-scoped trigger (Postgres fires "UPDATE OF col" whenever col
-- is in the SET list, not only when its value actually changes) —
-- but the OLD-vs-NEW guard inside the function body then blocked it
-- from trying again, since the row was already Paid before the
-- match backfilled account_id. Net effect: the bank line shows
-- matched, the sale/expense shows Paid, but no journal entry is ever
-- created, so nothing downstream of the ledger (account balances,
-- trial balance, P&L) reflects it.
--
-- Fix: drop the OLD-vs-NEW half of each guard, keeping only "is the
-- row currently in the target state". Each function already has its
-- own idempotency check right after (an EXISTS/count against
-- journal_entries), so this doesn't risk double-posting — it just
-- lets a later UPDATE that touches the same status column retry a
-- posting that previously failed, once the missing data is filled
-- in. This is exactly what match_sale_to_transfer /
-- match_expense_to_transfer already do on every match, so the fix
-- makes bank matching self-healing without any extra plumbing.
-- ============================================================

SET search_path TO public;

-- ── Expense paid/advance ────────────────────────────────────────
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

  IF NEW.payment_state NOT IN ('paid', 'advance') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_existing_count FROM journal_entries WHERE source_table = 'expenses' AND source_id = NEW.id;

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

-- ── Sale paid ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION post_sale_payment_to_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy UUID;
  v_row_fy     UUID;
  v_cash_account_id    UUID;
  v_revenue_account_id UUID;
  v_entry_id   UUID;
BEGIN
  IF NEW.sales_status IS DISTINCT FROM 'Paid' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_revenue_account_id FROM chart_of_accounts WHERE account_code = '4010';
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;

    IF v_cash_account_id IS NULL OR NEW.amount IS NULL THEN
      PERFORM log_posting_failure('sales', NEW.id, format(
        'Cannot post: account_id=%s -> cash account %s, amount=%s', NEW.account_id, v_cash_account_id, NEW.amount));
      RETURN NEW;
    END IF;

    INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
    VALUES (NEW.date, 'operational', 'sales', NEW.id, 'Sale paid: ' || COALESCE(NEW.sales_description, NEW.id::text))
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry_id, v_cash_account_id, NEW.amount, 0, 'Received via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id)),
      (v_entry_id, v_revenue_account_id, 0, NEW.amount, NEW.product_or_service);

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('sales', NEW.id, SQLERRM);
  END;

  RETURN NEW;
END;
$$;

-- ── Payroll paid ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION post_payroll_payment_to_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy   UUID;
  v_row_fy       UUID;
  v_posting_date DATE;
  v_gross NUMERIC;
  v_net   NUMERIC;
  v_tax_sum   NUMERIC;
  v_liability NUMERIC;
  v_salary_account_id  UUID;
  v_cash_account_id    UUID;
  v_payable_account_id UUID;
  v_entry_id UUID;
BEGIN
  IF NEW.payment_status IS DISTINCT FROM 'paid' THEN
    RETURN NEW;
  END IF;

  v_posting_date := COALESCE(NEW.end_date, NEW.start_date);
  IF v_posting_date IS NULL THEN
    PERFORM log_posting_failure('payroll', NEW.id, 'Cannot post: no start_date/end_date to key the fiscal period on');
    RETURN NEW;
  END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(v_posting_date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'payroll' AND source_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT COALESCE(SUM(gross_amount), 0), COALESCE(SUM(net_amount), 0)
    INTO v_gross, v_net FROM payroll_staff WHERE payroll_id = NEW.id;

    SELECT COALESCE(SUM(tax_amount), 0) INTO v_tax_sum FROM payroll_taxes WHERE payroll_id = NEW.id;

    v_liability := v_gross - v_net;

    IF v_gross = 0 THEN
      PERFORM log_posting_failure('payroll', NEW.id, 'Cannot post: no payroll_staff rows with a gross_amount for this payroll_id');
      RETURN NEW;
    END IF;

    SELECT id INTO v_salary_account_id  FROM chart_of_accounts WHERE account_code = '5010';
    SELECT id INTO v_payable_account_id FROM chart_of_accounts WHERE account_code = '2020';
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;

    IF v_cash_account_id IS NULL THEN
      PERFORM log_posting_failure('payroll', NEW.id, format(
        'Cannot post: account_id=%s has no Cash at Bank chart_of_accounts row', NEW.account_id));
      RETURN NEW;
    END IF;

    INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
    VALUES (v_posting_date, 'operational', 'payroll', NEW.id, 'Payroll paid: ' || COALESCE(NEW.payroll_record, NEW.id::text))
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry_id, v_salary_account_id, v_gross, 0, 'Gross payroll' || CASE WHEN NEW.pay_period IS NOT NULL THEN ', ' || NEW.pay_period ELSE '' END);

    IF v_net > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_cash_account_id, 0, v_net, 'Net paid via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));
    END IF;

    IF v_liability > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_payable_account_id, 0, v_liability, format('Withheld from gross (payroll_taxes on record for this run: %s)', v_tax_sum));
    END IF;

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('payroll', NEW.id, SQLERRM);
  END;

  RETURN NEW;
END;
$$;

-- ── Manual retry for sales, mirroring retry_expense_ledger_posting ─
-- Sales can't move backward in lifecycle rank (Draft < Invoiced <
-- Paid, enforced by enforce_sale_lifecycle_and_approval), so the
-- expense retry's "flip away then back" trick doesn't apply here.
-- Reasserting the same value is enough: Postgres fires an
-- "UPDATE OF sales_status" trigger whenever that column is in the
-- SET list, even when the value doesn't change, and the lifecycle
-- guard's own check (NEW.sales_status IS DISTINCT FROM OLD) is false
-- for a no-op reassignment, so it doesn't object.
CREATE OR REPLACE FUNCTION retry_sale_ledger_posting(p_sale_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can retry a ledger posting';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN
    RETURN 'Sale no longer exists';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = p_sale_id) THEN
    RETURN 'Already posted';
  END IF;

  IF v_sale.sales_status IS DISTINCT FROM 'Paid' THEN
    RETURN 'Not paid - nothing to post';
  END IF;

  IF v_sale.account_id IS NULL THEN
    RETURN 'Still no payment account set on this sale';
  END IF;
  IF v_sale.amount IS NULL THEN
    RETURN 'Still no amount set on this sale';
  END IF;

  UPDATE sales SET sales_status = sales_status WHERE id = p_sale_id;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = p_sale_id) THEN
    UPDATE ledger_posting_failures
    SET resolved = TRUE, resolved_at = NOW(), resolved_by = auth.uid()
    WHERE source_table = 'sales' AND source_id = p_sale_id AND NOT resolved;
    RETURN 'Posted';
  END IF;

  RETURN 'Still could not post - see the newest failure message for this sale';
END;
$$;

GRANT EXECUTE ON FUNCTION retry_sale_ledger_posting(uuid) TO authenticated;

-- Verify: functions carry the new bodies.
SELECT proname FROM pg_proc WHERE proname IN
  ('post_expense_payment_to_ledger', 'post_sale_payment_to_ledger', 'post_payroll_payment_to_ledger', 'retry_sale_ledger_posting');
