-- ============================================================
-- Auto-posting: the ledger observes what finance already enters
-- (per the payment-lifecycle work) and posts itself — no second
-- manual entry. Three rules, current fiscal year only:
--   expense reaching payment_state = 'paid'
--   sale reaching sales_status = 'Paid'
--   payroll reaching payment_status = 'paid'
--
-- Scope boundary (confirmed, not the same thing as the fiscal-period
-- "continuing items" exemption used for project Committed/Actual):
-- this posts current-FY transactions only. It is never run backward
-- over historical expenses/sales/payroll to build a retroactive
-- ledger for FY2025/26 or earlier — those years are represented
-- purely by whatever gets manually entered as an opening balance
-- (a later migration), not reconstructed. A current-FY row still
-- feeds its project's lifecycle Actual under the unrelated,
-- unchanged fiscal-period rule; it just doesn't also get a
-- retroactive journal entry if it predates the current FY.
--
-- Non-negotiable guardrail: auto-posting is additive. It must never
-- change whether finance can mark an expense paid, a sale paid, or a
-- payroll paid — the ledger records, it doesn't gate. Two mechanisms
-- make that true:
--   1. Every posting attempt is wrapped in its own BEGIN/EXCEPTION
--      block. Any failure — a missing account mapping, a data
--      surprise, a bug — is caught, logged to
--      ledger_posting_failures for review, and swallowed. The
--      triggering UPDATE always succeeds regardless of whether the
--      ledger could post it.
--   2. journal_lines' balance trigger (migration 104) is a DEFERRED
--      constraint, so it doesn't fire until COMMIT — which is AFTER
--      this function's own BEGIN/EXCEPTION block has already
--      returned, meaning a normal exception handler here can't catch
--      it. SET CONSTRAINTS ... IMMEDIATE forces that check to run
--      right now, inside the catchable block, then resets to
--      DEFERRED afterward so it doesn't change behavior for anything
--      else running later in the same transaction.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS ledger_posting_failures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table  TEXT NOT NULL,
  source_id     UUID NOT NULL,
  error_message TEXT NOT NULL,
  attempted_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved      BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES user_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_posting_failures_unresolved
  ON ledger_posting_failures(source_table, attempted_at) WHERE NOT resolved;

CREATE OR REPLACE FUNCTION log_posting_failure(p_source_table TEXT, p_source_id UUID, p_error TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO ledger_posting_failures (source_table, source_id, error_message)
  VALUES (p_source_table, p_source_id, p_error);
END;
$$;

-- ── Expense paid ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION post_expense_payment_to_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy UUID;
  v_row_fy     UUID;
  v_expense_account_id UUID;
  v_cash_account_id    UUID;
  v_entry_id   UUID;
BEGIN
  IF NOT (NEW.payment_state = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'paid')) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW; -- pre-current-FY or undated: not this engine's job (see header)
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = NEW.id) THEN
    RETURN NEW; -- idempotent: never double-post
  END IF;

  BEGIN
    SELECT coa.id INTO v_expense_account_id FROM chart_of_accounts coa WHERE coa.category_id = NEW.category_id;
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;

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
  IF NOT (NEW.sales_status = 'Paid' AND (TG_OP = 'INSERT' OR OLD.sales_status IS DISTINCT FROM 'Paid')) THEN
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
    -- Generic Sales Revenue for every paid sale (confirmed decision:
    -- product_or_service is uncontrolled free text, not a safe key
    -- for a finer-grained mapping).
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

DROP TRIGGER IF EXISTS trg_post_sale_payment_to_ledger ON sales;
CREATE TRIGGER trg_post_sale_payment_to_ledger
  AFTER INSERT OR UPDATE OF sales_status ON sales
  FOR EACH ROW EXECUTE FUNCTION post_sale_payment_to_ledger();

-- ── Payroll paid ──────────────────────────────────────────────────
-- Amounts come from payroll_staff (per-employee gross/net), never a
-- single figure off payroll itself — payroll carries no amount
-- column of its own. The Payroll Taxes Payable credit is
-- (gross - net), not a separate SUM(payroll_taxes.tax_amount) —
-- that guarantees the entry always balances by construction,
-- regardless of whether payroll_taxes reconciles exactly against
-- gross-minus-net (other deductions could also live in that gap).
-- payroll_taxes' own total is still recorded in the line's notes for
-- cross-reference, since it's real, already-computed data worth
-- keeping visible even when it isn't the posted figure itself.
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
  IF NOT (NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid')) THEN
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

DROP TRIGGER IF EXISTS trg_post_payroll_payment_to_ledger ON payroll;
CREATE TRIGGER trg_post_payroll_payment_to_ledger
  AFTER INSERT OR UPDATE OF payment_status ON payroll
  FOR EACH ROW EXECUTE FUNCTION post_payroll_payment_to_ledger();

-- Verify: triggers present on all three tables.
SELECT 'expenses' AS tbl, tgname FROM pg_trigger WHERE tgrelid = 'expenses'::regclass AND tgname = 'trg_post_expense_payment_to_ledger'
UNION ALL
SELECT 'sales', tgname FROM pg_trigger WHERE tgrelid = 'sales'::regclass AND tgname = 'trg_post_sale_payment_to_ledger'
UNION ALL
SELECT 'payroll', tgname FROM pg_trigger WHERE tgrelid = 'payroll'::regclass AND tgname = 'trg_post_payroll_payment_to_ledger';

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE ledger_posting_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_posting_failures_admin_finance" ON ledger_posting_failures;
CREATE POLICY "ledger_posting_failures_admin_finance" ON ledger_posting_failures FOR ALL
  USING (get_user_role() IN ('admin', 'finance'));
