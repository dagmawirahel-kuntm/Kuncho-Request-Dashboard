-- ============================================================
-- Chart of accounts — formalizes the embryonic chart already sitting
-- in categories.nature (migration 005), rather than duplicating it.
-- One row per postable account; a small 2-level hierarchy (5 group
-- headers, everything else a child of one of them) so a trial balance
-- can roll up by nature without a deeper structure nobody asked for.
--
-- Confirmed against live data before writing this: 65 categories, 61
-- with nature = NULL (migration 072's deliberate "reset to NULL rather
-- than guess" cleanup), 4 with nature = 'Asset', 0 Liability/Equity/
-- Revenue. Every existing report that reads nature already treats NULL
-- as an ordinary Expense via COALESCE(nature, 'Expense') (migration
-- 064) — this migration carries that same convention forward rather
-- than second-guessing a deliberate prior decision.
--
-- Decided additions this round (confirmed): Retained Earnings and
-- Accounts Payable — both load-bearing for the opening balance (a
-- future migration) and the auto-posting rules (a future migration).
-- Deliberately NOT added: Accumulated Depreciation, Accounts
-- Receivable (nothing today tracks depreciation policy or unbilled-
-- sale-as-receivable in a way that would feed them correctly — empty
-- structure nobody uses yet), and Owner's Equity/Share Capital (not
-- called out as load-bearing; Retained Earnings absorbs the opening
-- balance's equity side unless a real need for a separate line shows
-- up). Same discipline as the unused procurement chain: don't build
-- ahead of actual use.
--
-- Also added: Payroll Taxes Payable (a future payroll-posting rule
-- needs somewhere to credit withheld tax) and a single generic Sales
-- Revenue account (all paid sales route here — product_or_service is
-- uncontrolled free text, so a finer split would be guessing).
--
-- linked_account_id is NOT part of the originally-sketched column
-- list, but is necessary plumbing: the future auto-posting rules need
-- a reliable way to map an expense/sale's account_id (a payment
-- account) to the right Cash-at-Bank chart_of_accounts row, and
-- nothing else on this table can carry that link losslessly.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code      TEXT UNIQUE NOT NULL,
  account_name      TEXT NOT NULL,
  nature            TEXT NOT NULL CHECK (nature IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  category_id       UUID REFERENCES categories(id),
  linked_account_id UUID REFERENCES accounts(id),
  parent_account_id UUID REFERENCES chart_of_accounts(id),
  is_postable       BOOLEAN NOT NULL DEFAULT TRUE,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coa_category ON chart_of_accounts(category_id);
CREATE INDEX IF NOT EXISTS idx_coa_linked_account ON chart_of_accounts(linked_account_id);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON chart_of_accounts(parent_account_id);

-- ── Group headers (not postable — pure rollup nodes) ────────────────
INSERT INTO chart_of_accounts (account_code, account_name, nature, is_postable) VALUES
  ('1000', 'Assets',      'Asset',     FALSE),
  ('2000', 'Liabilities', 'Liability', FALSE),
  ('3000', 'Equity',      'Equity',    FALSE),
  ('4000', 'Revenue',     'Revenue',   FALSE),
  ('5000', 'Expense',     'Expense',   FALSE)
ON CONFLICT (account_code) DO NOTHING;

-- ── Cash at Bank — one per accounts row, regardless of active status.
-- An inactive account can still hold historical postings; excluding it
-- would just be a lookup failure waiting to happen. ─────────────────
INSERT INTO chart_of_accounts (account_code, account_name, nature, linked_account_id, parent_account_id, is_postable)
SELECT
  '11' || LPAD(row_number() OVER (ORDER BY a.account_name)::text, 3, '0'),
  'Cash at Bank — ' || a.account_name,
  'Asset',
  a.id,
  (SELECT id FROM chart_of_accounts WHERE account_code = '1000'),
  TRUE
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.linked_account_id = a.id);

-- ── Fixed-code accounts the future posting rules reference by code,
-- not by name (name is free-form and could be renamed later). ──────
INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable) VALUES
  ('2010', 'Accounts Payable',       'Liability', (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), TRUE),
  ('2020', 'Payroll Taxes Payable',  'Liability', (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), TRUE),
  ('3010', 'Retained Earnings',      'Equity',    (SELECT id FROM chart_of_accounts WHERE account_code = '3000'), TRUE),
  ('4010', 'Sales Revenue',          'Revenue',   (SELECT id FROM chart_of_accounts WHERE account_code = '4000'), TRUE),
  ('5010', 'Salary and Wages',       'Expense',   (SELECT id FROM chart_of_accounts WHERE account_code = '5000'), TRUE)
ON CONFLICT (account_code) DO NOTHING;

-- ── One row per category, inheriting nature (NULL -> Expense, the
-- codebase's own established convention). "Salary" is excluded here —
-- it already exists above at the fixed code 5010, so payroll postings
-- can reference it without a name lookup. ───────────────────────────
INSERT INTO chart_of_accounts (account_code, account_name, nature, category_id, parent_account_id, is_postable)
SELECT
  CASE COALESCE(c.nature, 'Expense')
    WHEN 'Asset'     THEN '12' || LPAD(row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name)::text, 3, '0')
    WHEN 'Liability'  THEN '21' || LPAD(row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name)::text, 3, '0')
    WHEN 'Equity'     THEN '31' || LPAD(row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name)::text, 3, '0')
    WHEN 'Revenue'    THEN '41' || LPAD(row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name)::text, 3, '0')
    ELSE                   '51' || LPAD(row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name)::text, 3, '0')
  END,
  c.category_name,
  COALESCE(c.nature, 'Expense'),
  c.id,
  (SELECT id FROM chart_of_accounts WHERE account_code =
    CASE COALESCE(c.nature, 'Expense')
      WHEN 'Asset' THEN '1000' WHEN 'Liability' THEN '2000' WHEN 'Equity' THEN '3000'
      WHEN 'Revenue' THEN '4000' ELSE '5000'
    END),
  TRUE
FROM categories c
WHERE c.category_name <> 'Salary'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts coa WHERE coa.category_id = c.id);

-- Verify: group headers + fixed accounts present, exactly one row per
-- accounts row and per category (minus Salary, which maps to 5010).
SELECT account_code, account_name, nature, is_postable
FROM chart_of_accounts WHERE parent_account_id IS NULL ORDER BY account_code;

SELECT count(*) AS total_accounts,
       count(*) FILTER (WHERE linked_account_id IS NOT NULL) AS cash_at_bank_rows,
       count(*) FILTER (WHERE category_id IS NOT NULL) AS category_rows,
       count(*) FILTER (WHERE category_id IS NULL AND linked_account_id IS NULL AND is_postable) AS fixed_accounts
FROM chart_of_accounts;

SELECT (SELECT count(*) FROM accounts) AS accounts_table_count,
       (SELECT count(*) FROM chart_of_accounts WHERE linked_account_id IS NOT NULL) AS coa_cash_rows;

SELECT (SELECT count(*) FROM categories) - 1 AS expected_category_rows, -- minus Salary
       (SELECT count(*) FROM chart_of_accounts WHERE category_id IS NOT NULL) AS actual_category_rows;

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chart_of_accounts_read" ON chart_of_accounts;
CREATE POLICY "chart_of_accounts_read" ON chart_of_accounts FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "chart_of_accounts_admin_finance_write" ON chart_of_accounts;
CREATE POLICY "chart_of_accounts_admin_finance_write" ON chart_of_accounts FOR ALL
  USING (get_user_role() IN ('admin', 'finance'));
