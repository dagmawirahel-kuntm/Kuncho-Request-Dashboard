-- ── Fix duplicate expense_code values then add unique constraint ──────────────
-- Run this in Supabase SQL Editor.

-- 1. Remove duplicates: keep the one row per expense_code with the earliest
--    created_at; use id as a tiebreaker so the result is always deterministic.
DELETE FROM expenses
WHERE id NOT IN (
  SELECT DISTINCT ON (lower(trim(expense_code))) id
  FROM expenses
  WHERE expense_code IS NOT NULL
  ORDER BY lower(trim(expense_code)), created_at NULLS LAST, id
);

-- 2. Trim any stray whitespace
UPDATE expenses
SET expense_code = trim(expense_code)
WHERE expense_code IS NOT NULL
  AND expense_code != trim(expense_code);

-- 3. Drop old constraint if it somehow exists, then add the clean one
ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_expense_code_unique;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_expense_code_unique UNIQUE (expense_code);

-- 4. Verify — should return 0 rows if everything is clean
SELECT expense_code, count(*)
FROM expenses
WHERE expense_code IS NOT NULL
GROUP BY expense_code
HAVING count(*) > 1;
