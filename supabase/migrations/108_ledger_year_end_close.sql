-- ============================================================
-- Year-end close. Doesn't apply yet — there's only ever been one
-- opening balance so far, nothing has closed — but designed now so
-- it's ready when FY2026/27 ends, same reasoning as building
-- fiscal_periods itself ahead of the first real rollover.
--
-- A deliberate, human-confirmed action only, mirroring the Stage
-- 3->4 budget-lock confirm-dialog pattern — never a silent scheduled
-- job. close_fiscal_period() zeros Revenue and Expense into Retained
-- Earnings for that period and marks it closed; reopen_fiscal_period()
-- is the equally deliberate undo. Asset/Liability/Equity balances
-- need no special "carry forward" step — they're already cumulative
-- in the ledger-preview Balance Sheet (migration 107), so closing a
-- period just stops new postings from landing in it.
-- ============================================================

SET search_path TO public;

ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS closed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES user_profiles(id);

-- Extends the fiscal_period_id tagging trigger from migration 104 with
-- a hard backstop: once a period is closed, nothing — auto-posting,
-- the opening balance conversion, a future manual-entry UI — can
-- insert or move a journal entry into it without a deliberate
-- reopen first. Same function, not a second trigger, so there's no
-- ambiguity about execution order between the two concerns.
CREATE OR REPLACE FUNCTION set_fiscal_period_journal_entries()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_closed BOOLEAN;
BEGIN
  NEW.fiscal_period_id := fiscal_period_for_date(NEW.entry_date);

  IF NEW.fiscal_period_id IS NOT NULL THEN
    SELECT closed INTO v_closed FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
    IF v_closed THEN
      RAISE EXCEPTION 'Fiscal period for % is closed — reopen it first (reopen_fiscal_period) before posting into it', NEW.entry_date;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Close ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION close_fiscal_period(p_fiscal_period_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period       RECORD;
  v_retained_id  UUID;
  v_entry_id     UUID;
  v_total_revenue NUMERIC;
  v_total_expense NUMERIC;
  v_net          NUMERIC;
  v_line         RECORD;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can close a fiscal period';
  END IF;

  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_fiscal_period_id;
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;
  IF v_period.closed THEN
    RAISE EXCEPTION 'Fiscal period % is already closed', v_period.label;
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE fiscal_period_id = p_fiscal_period_id AND entry_type = 'closing') THEN
    RAISE EXCEPTION 'A closing entry already exists for %', v_period.label;
  END IF;

  SELECT id INTO v_retained_id FROM chart_of_accounts WHERE account_code = '3010';

  -- Insert the closing entry FIRST, while the period is still open —
  -- avoids a chicken-and-egg with the closed-period trigger above,
  -- which would otherwise reject the very entry that closes it.
  INSERT INTO journal_entries (entry_date, entry_type, description)
  VALUES (v_period.end_date, 'closing', 'Year-end close: ' || v_period.label)
  RETURNING id INTO v_entry_id;

  v_total_revenue := 0;
  v_total_expense := 0;

  FOR v_line IN
    SELECT coa.id AS account_id, coa.nature,
           CASE WHEN coa.nature = 'Revenue' THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
                ELSE COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) END AS amount
    FROM chart_of_accounts coa
    JOIN journal_lines jl ON jl.account_id = coa.id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE coa.nature IN ('Revenue', 'Expense') AND je.fiscal_period_id = p_fiscal_period_id
    GROUP BY coa.id, coa.nature
    HAVING CASE WHEN coa.nature = 'Revenue' THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
                ELSE COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) END <> 0
  LOOP
    IF v_line.nature = 'Revenue' THEN
      -- Revenue carries a credit balance; debit it to zero out.
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_line.account_id, v_line.amount, 0, 'Close to Retained Earnings');
      v_total_revenue := v_total_revenue + v_line.amount;
    ELSE
      -- Expense carries a debit balance; credit it to zero out.
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_line.account_id, 0, v_line.amount, 'Close to Retained Earnings');
      v_total_expense := v_total_expense + v_line.amount;
    END IF;
  END LOOP;

  v_net := v_total_revenue - v_total_expense;
  IF v_net > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
    VALUES (v_entry_id, v_retained_id, 0, v_net, format('Net income for %s', v_period.label));
  ELSIF v_net < 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
    VALUES (v_entry_id, v_retained_id, -v_net, 0, format('Net loss for %s', v_period.label));
  END IF;
  -- v_net = 0 with zero revenue and zero expense both: no lines at all
  -- were inserted, which is a legitimately empty (no-op) closing entry
  -- for a period with no ledger activity — balances trivially at 0 = 0.

  SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
  SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;

  UPDATE fiscal_periods SET closed = TRUE, closed_at = NOW(), closed_by = auth.uid()
  WHERE id = p_fiscal_period_id;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION close_fiscal_period(UUID) TO authenticated;

-- ── Reopen — the deliberate undo, admin-only (stricter than close,
-- since reopening a closed year is the more consequential direction).
CREATE OR REPLACE FUNCTION reopen_fiscal_period(p_fiscal_period_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admin can reopen a closed fiscal period';
  END IF;
  UPDATE fiscal_periods SET closed = FALSE, closed_at = NULL, closed_by = NULL
  WHERE id = p_fiscal_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION reopen_fiscal_period(UUID) TO authenticated;

-- Verify: functions exist, no periods closed yet (expected — this
-- doesn't apply until FY2026/27 actually ends).
SELECT proname FROM pg_proc WHERE proname IN ('close_fiscal_period', 'reopen_fiscal_period');
SELECT label, closed, closed_at FROM fiscal_periods ORDER BY start_date;
