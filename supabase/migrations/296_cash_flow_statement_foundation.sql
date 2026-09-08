-- 296 — Foundations for a cash flow statement
--
-- The ledger can already produce a Trial Balance and a P&L / Balance
-- Sheet preview. The missing third statement is cash flow: where cash
-- actually came from and went, as opposed to what was earned and spent.
--
-- This lays the groundwork rather than shipping a finished statement.
-- What it adds:
--
--   1. cash_flow_section on chart_of_accounts — the classification every
--      cash flow statement is built on (operating / investing /
--      financing), plus 'cash' to mark the cash & cash-equivalent
--      accounts themselves.
--   2. v_cash_flow_movements — every journal line that moved cash,
--      attributed to the counterpart account that explains it.
--   3. v_cash_flow_statement — those movements aggregated by fiscal
--      period and section, which is the statement itself.
--
-- ── Method: direct, not indirect ─────────────────────────────────────────────
--
-- The indirect method starts from profit and reverses out non-cash
-- items. It is the norm in published accounts, but it needs accrual
-- balances (receivables, payables, depreciation) that this ledger does
-- not yet carry reliably. The direct method — read the cash accounts and
-- classify what moved — is what the data can actually support today, and
-- it is the more useful view for a construction business watching
-- payments week to week.
--
-- ── How a movement is attributed ─────────────────────────────────────────────
--
-- For each journal entry, the net movement across cash accounts is the
-- cash effect. The non-cash lines in that same entry explain it, so the
-- movement is attributed to them, weighted by their amounts. A plain
-- two-line entry (Dr expense / Cr bank) attributes exactly. A multi-line
-- entry — such as the vendor-credit settlement in 277, which is Dr
-- expense / Cr bank / Cr Vendor Advances — splits proportionally, which
-- is standard practice and the only defensible option without a
-- per-line cash tag.
--
-- Bank-to-bank transfers net to zero across cash accounts and are
-- excluded, which is correct: moving your own money between your own
-- accounts is not a cash flow.
--
-- ── What this statement cannot yet see ───────────────────────────────────────
--
-- Read the output knowing it is incomplete, for reasons outside this
-- migration:
--
--   · 44 paid expenses totalling 976,355.40 ETB have no journal entry at
--     all. Every one is payment_method = 'cash' with no account_id, and
--     the posting trigger needs a cash account it cannot resolve —
--     there is no "Cash on Hand" account in the chart, only "Cash at
--     Bank — <bank>" rows linked to real bank accounts. Until that
--     account exists and those postings are retried, cash spending is
--     understated by roughly a million birr. (297 adds the account and
--     clears them.)
--   · The transfers table holds 112 rows and produces no journal entries
--     at all, so inter-account movement is invisible to the ledger.
--
-- Neither is fixed here. The classification and the views are correct;
-- the underlying postings are what need completing, and that is a
-- decision about live financial data rather than a schema change.

-- ── 1. Classification ────────────────────────────────────────────────────────

ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS cash_flow_section text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'chart_of_accounts'::regclass AND conname = 'chart_of_accounts_cash_flow_section_check'
  ) THEN
    ALTER TABLE chart_of_accounts ADD CONSTRAINT chart_of_accounts_cash_flow_section_check
      CHECK (cash_flow_section IS NULL
             OR cash_flow_section IN ('cash', 'operating', 'investing', 'financing'));
  END IF;
END $$;

COMMENT ON COLUMN chart_of_accounts.cash_flow_section IS
  'Cash flow statement section. ''cash'' marks the cash and cash-equivalent accounts themselves; operating/investing/financing classify the counterpart accounts that explain a cash movement. NULL means unclassified — such movements are reported separately rather than silently dropped.';

-- Seed. Deliberately explicit rather than pattern-matched on account_code,
-- because this chart already has one account filed against the wrong range
-- (51050 "Steel" is an Asset sitting in the expense band), and a code-range
-- rule would misclassify it.

-- Cash and cash equivalents: every account tied to a real bank/wallet row.
UPDATE chart_of_accounts SET cash_flow_section = 'cash'
 WHERE linked_account_id IS NOT NULL AND cash_flow_section IS NULL;

-- Operating: trading activity, and the working-capital accounts that sit
-- between a trade and its cash.
UPDATE chart_of_accounts SET cash_flow_section = 'operating'
 WHERE cash_flow_section IS NULL
   AND (nature IN ('Expense', 'Revenue')
        OR account_code IN (
          '1080',   -- Vendor Advances — prepayment for goods/services
          '12001',  -- Aluminum        \
          '12002',  -- Bonds            |  stock and trade deposits
          '12003',  -- Building Materials|
          '51050',  -- Steel           /
          '2010',   -- Accounts Payable
          '2020'    -- Payroll Taxes Payable
        ));

-- Investing: capital assets.
UPDATE chart_of_accounts SET cash_flow_section = 'investing'
 WHERE cash_flow_section IS NULL AND account_code IN ('12004');  -- PPE

-- Financing: borrowings and owner capital.
UPDATE chart_of_accounts SET cash_flow_section = 'financing'
 WHERE cash_flow_section IS NULL AND account_code IN ('2030', '3000', '3010', '3020');

-- Header/roll-up accounts (1000 Assets, 2000 Liabilities, 4000 Revenue)
-- are left NULL where they are not postable — nothing posts to them, so
-- they never appear as a counterpart.

-- ── 2. Movements ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_cash_flow_movements
WITH (security_invoker = true) AS
WITH entry_cash AS (
  -- Net cash effect per journal entry. Positive = cash in.
  -- A transfer between two cash accounts nets to zero and drops out here.
  SELECT jl.journal_entry_id, SUM(jl.debit - jl.credit) AS cash_delta
  FROM journal_lines jl
  JOIN chart_of_accounts c ON c.id = jl.account_id
  WHERE c.cash_flow_section = 'cash'
  GROUP BY jl.journal_entry_id
  HAVING SUM(jl.debit - jl.credit) <> 0
),
counterparts AS (
  -- The non-cash lines that explain the movement.
  SELECT jl.journal_entry_id,
         c.cash_flow_section,
         c.account_code,
         c.account_name,
         ABS(jl.debit - jl.credit) AS weight
  FROM journal_lines jl
  JOIN chart_of_accounts c ON c.id = jl.account_id
  WHERE c.cash_flow_section IS DISTINCT FROM 'cash'
    AND (jl.debit - jl.credit) <> 0
),
weighted AS (
  SELECT cp.journal_entry_id,
         cp.cash_flow_section,
         cp.account_code,
         cp.account_name,
         ec.cash_delta * (cp.weight / NULLIF(SUM(cp.weight) OVER (PARTITION BY cp.journal_entry_id), 0)) AS amount
  FROM counterparts cp
  JOIN entry_cash ec ON ec.journal_entry_id = cp.journal_entry_id
)
SELECT
  je.id AS journal_entry_id,
  je.entry_date,
  je.description,
  je.source_table,
  je.source_id,
  fiscal_period_for_date(je.entry_date) AS fiscal_period_id,
  COALESCE(w.cash_flow_section, 'unclassified') AS section,
  w.account_code,
  w.account_name,
  ROUND(w.amount, 2) AS amount,
  CASE WHEN w.amount >= 0 THEN 'in' ELSE 'out' END AS direction
FROM weighted w
JOIN journal_entries je ON je.id = w.journal_entry_id
WHERE w.amount IS NOT NULL AND ROUND(w.amount, 2) <> 0;

COMMENT ON VIEW public.v_cash_flow_movements IS
  'Every cash movement in the ledger, attributed to the counterpart account that explains it. Amounts are signed: positive is cash in. Multi-line entries split the cash effect proportionally across their non-cash lines. Transfers between two cash accounts net to zero and are excluded.';

GRANT SELECT ON public.v_cash_flow_movements TO authenticated;

-- ── 3. The statement ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_cash_flow_statement
WITH (security_invoker = true) AS
SELECT
  m.fiscal_period_id,
  fp.label AS fiscal_period_label,
  m.section,
  SUM(m.amount) FILTER (WHERE m.amount > 0) AS cash_in,
  -- Reported positive; the sign convention lives in net_cash_flow.
  ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.amount < 0), 0)) AS cash_out,
  SUM(m.amount) AS net_cash_flow,
  count(*) AS movement_count
FROM v_cash_flow_movements m
LEFT JOIN fiscal_periods fp ON fp.id = m.fiscal_period_id
GROUP BY m.fiscal_period_id, fp.label, m.section;

COMMENT ON VIEW public.v_cash_flow_statement IS
  'Cash flow by fiscal period and section (direct method). Built only from postings that reached the ledger — cash-method expenses that failed to post are absent, so reconcile the total against the cash accounts before publishing.';

GRANT SELECT ON public.v_cash_flow_statement TO authenticated;
