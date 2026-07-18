-- ============================================================
-- Trial balance + ledger-derived P&L/Balance Sheet — run alongside
-- the legacy financial views (migrations 053/054/064/070), not in
-- place of them. Those stay authoritative: they're live, adopted,
-- and have their own working cutover logic
-- (financials_cutover_date()). Everything here carries a
-- _ledger_preview naming so it's unmistakably a second, parallel
-- system, not surfaced as the app's default anywhere yet.
--
-- Same warn-only discipline as budget enforcement and payment
-- states: the two systems run side by side until compared against
-- each other for at least one full period and shown to agree (or any
-- disagreement is understood and explained). A cutover decision, if
-- one ever gets made, is separate and explicit — not something this
-- migration decides implicitly by which view the app happens to read.
-- ============================================================

SET search_path TO public;

-- ── Trial balance — the fundamental internal-consistency check ────
CREATE OR REPLACE VIEW v_trial_balance
WITH (security_invoker = true) AS
SELECT
  coa.id AS chart_of_accounts_id,
  coa.account_code,
  coa.account_name,
  coa.nature,
  je.fiscal_period_id,
  fp.label AS fiscal_period_label,
  COALESCE(SUM(jl.debit), 0) AS total_debit,
  COALESCE(SUM(jl.credit), 0) AS total_credit,
  COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS balance
FROM chart_of_accounts coa
LEFT JOIN journal_lines jl ON jl.account_id = coa.id
LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
WHERE coa.is_postable
GROUP BY coa.id, coa.account_code, coa.account_name, coa.nature, je.fiscal_period_id, fp.label
ORDER BY coa.account_code;

GRANT SELECT ON v_trial_balance TO authenticated;

-- ── P&L (ledger-derived preview) — current fiscal period only, since
-- these are period statements by definition. ───────────────────────
CREATE OR REPLACE VIEW v_pl_ledger_preview
WITH (security_invoker = true) AS
SELECT
  coa.account_code,
  coa.account_name,
  coa.nature,
  CASE WHEN coa.nature = 'Revenue'
    THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
    ELSE COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
  END AS amount
FROM chart_of_accounts coa
JOIN journal_lines jl ON jl.account_id = coa.id
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE coa.nature IN ('Revenue', 'Expense')
  AND je.fiscal_period_id = (SELECT id FROM fiscal_periods WHERE is_current)
GROUP BY coa.account_code, coa.account_name, coa.nature
ORDER BY coa.nature DESC, coa.account_code; -- Revenue before Expense

GRANT SELECT ON v_pl_ledger_preview TO authenticated;

-- ── Balance Sheet (ledger-derived preview) — point-in-time,
-- cumulative, never resets at a fiscal year boundary: opening balance
-- (once entered) plus every journal movement up to p_as_of_date. A
-- plain view can't take a parameter, so this is a function; the date
-- filter lives inside the aggregation subquery (not a WHERE clause
-- applied after a LEFT JOIN), which matters — filtering after the
-- join would silently exclude accounts with zero activity before the
-- cutoff instead of correctly showing them at a zero balance.
CREATE OR REPLACE FUNCTION balance_sheet_ledger_preview(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (account_code TEXT, account_name TEXT, nature TEXT, balance NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    coa.account_code,
    coa.account_name,
    coa.nature,
    CASE WHEN coa.nature = 'Asset'
      THEN COALESCE(m.total_debit, 0) - COALESCE(m.total_credit, 0)
      ELSE COALESCE(m.total_credit, 0) - COALESCE(m.total_debit, 0)
    END AS balance
  FROM chart_of_accounts coa
  LEFT JOIN (
    SELECT jl.account_id, SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.entry_date <= p_as_of_date
    GROUP BY jl.account_id
  ) m ON m.account_id = coa.id
  WHERE coa.nature IN ('Asset', 'Liability', 'Equity') AND coa.is_postable
  ORDER BY coa.account_code;
$$;

GRANT EXECUTE ON FUNCTION balance_sheet_ledger_preview(DATE) TO authenticated;

-- Verify: trial balance sums to zero across all accounts for every
-- fiscal period with activity (empty right now — nothing posts until
-- current-FY paid expenses/sales/payroll or the opening balance
-- exist, both separate steps from this migration).
SELECT fiscal_period_label, SUM(total_debit) AS sum_debit, SUM(total_credit) AS sum_credit,
       SUM(total_debit) - SUM(total_credit) AS should_be_zero
FROM v_trial_balance
WHERE fiscal_period_id IS NOT NULL
GROUP BY fiscal_period_label;

SELECT * FROM v_pl_ledger_preview;
SELECT * FROM balance_sheet_ledger_preview(CURRENT_DATE);
