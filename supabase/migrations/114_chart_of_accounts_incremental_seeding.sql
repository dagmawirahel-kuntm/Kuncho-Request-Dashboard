-- ============================================================
-- Bug found during this session's verification, unrelated to the
-- advance-payment/GRN/vendor-receipts work but discovered while
-- testing it: migration 103's Cash-at-Bank and category seeding
-- INSERTs number new rows via row_number() OVER (ORDER BY ...) scoped
-- only to the rows being newly inserted THIS run. The first time
-- (103's own initial run against the real 34 accounts / 65
-- categories) that's fine — nothing pre-existing to collide with. But
-- add a 35th bank account or a 66th category later, re-run the same
-- seeding logic (it's meant to be safely idempotent/incremental —
-- that's the whole point of the NOT EXISTS guards), and row_number()
-- restarts at 1, producing account_code '11001' (or '51001', etc.)
-- again — which already exists, so the INSERT...SELECT fails its
-- UNIQUE constraint atomically and silently seeds NOTHING for that
-- run, not just the colliding row. A new bank account or category
-- added after go-live would end up with no chart_of_accounts row at
-- all, and every posting rule that looks one up would log a failure
-- forever until someone notices.
--
-- Fix: offset the row_number() by the current MAX suffix already in
-- use under that code prefix, so a re-run continues the sequence
-- instead of restarting it. Re-runs the same two seeding blocks from
-- migration 103 with only this arithmetic changed; the NOT EXISTS
-- guards mean already-seeded rows are untouched either way.
-- ============================================================

SET search_path TO public;

INSERT INTO chart_of_accounts (account_code, account_name, nature, linked_account_id, parent_account_id, is_postable)
SELECT
  '11' || LPAD((
    COALESCE((SELECT MAX(SUBSTRING(account_code FROM 3)::int) FROM chart_of_accounts WHERE account_code ~ '^11[0-9]{3}$'), 0)
    + row_number() OVER (ORDER BY a.account_name)
  )::text, 3, '0'),
  'Cash at Bank — ' || a.account_name,
  'Asset',
  a.id,
  (SELECT id FROM chart_of_accounts WHERE account_code = '1000'),
  TRUE
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.linked_account_id = a.id);

INSERT INTO chart_of_accounts (account_code, account_name, nature, category_id, parent_account_id, is_postable)
SELECT
  CASE COALESCE(c.nature, 'Expense')
    WHEN 'Asset'    THEN '12' || LPAD((COALESCE((SELECT MAX(SUBSTRING(account_code FROM 3)::int) FROM chart_of_accounts WHERE account_code ~ '^12[0-9]{3}$'), 0) + row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name))::text, 3, '0')
    WHEN 'Liability' THEN '21' || LPAD((COALESCE((SELECT MAX(SUBSTRING(account_code FROM 3)::int) FROM chart_of_accounts WHERE account_code ~ '^21[0-9]{3}$'), 0) + row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name))::text, 3, '0')
    WHEN 'Equity'    THEN '31' || LPAD((COALESCE((SELECT MAX(SUBSTRING(account_code FROM 3)::int) FROM chart_of_accounts WHERE account_code ~ '^31[0-9]{3}$'), 0) + row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name))::text, 3, '0')
    WHEN 'Revenue'   THEN '41' || LPAD((COALESCE((SELECT MAX(SUBSTRING(account_code FROM 3)::int) FROM chart_of_accounts WHERE account_code ~ '^41[0-9]{3}$'), 0) + row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name))::text, 3, '0')
    ELSE             '51' || LPAD((COALESCE((SELECT MAX(SUBSTRING(account_code FROM 3)::int) FROM chart_of_accounts WHERE account_code ~ '^51[0-9]{3}$'), 0) + row_number() OVER (PARTITION BY COALESCE(c.nature, 'Expense') ORDER BY c.category_name))::text, 3, '0')
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

-- Verify: every account and category (minus Salary) now has a row.
SELECT (SELECT count(*) FROM accounts) AS accounts_table_count,
       (SELECT count(*) FROM chart_of_accounts WHERE linked_account_id IS NOT NULL) AS coa_cash_rows;
SELECT (SELECT count(*) FROM categories) - 1 AS expected_category_rows,
       (SELECT count(*) FROM chart_of_accounts WHERE category_id IS NOT NULL) AS actual_category_rows;
SELECT account_code, count(*) FROM chart_of_accounts GROUP BY account_code HAVING count(*) > 1;
