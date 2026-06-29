-- ── Fix duplicate expense_code values (with FK re-pointing) ──────────────────
-- Run in Supabase SQL Editor.

-- 1. Build a temp map: dupe_id → keeper_id
CREATE TEMP TABLE _exp_map AS
SELECT e.id AS dupe_id, k.keeper_id
FROM expenses e
JOIN (
  SELECT DISTINCT ON (lower(trim(expense_code)))
    id           AS keeper_id,
    lower(trim(expense_code)) AS code_key
  FROM expenses
  WHERE expense_code IS NOT NULL
  ORDER BY lower(trim(expense_code)), created_at NULLS LAST, id
) k ON lower(trim(e.expense_code)) = k.code_key
WHERE e.id != k.keeper_id
  AND e.expense_code IS NOT NULL;

-- 2. Re-point every table that references expenses(id)

-- purchase_allocation.parent_purchase_id (no cascade — must update manually)
UPDATE purchase_allocation
SET parent_purchase_id = m.keeper_id
FROM _exp_map m
WHERE parent_purchase_id = m.dupe_id;

-- transportation_requests.expense_id
UPDATE transportation_requests
SET expense_id = m.keeper_id
FROM _exp_map m
WHERE expense_id = m.dupe_id;

-- cpo_bonds.related_expense_id
UPDATE cpo_bonds
SET related_expense_id = m.keeper_id
FROM _exp_map m
WHERE related_expense_id = m.dupe_id;

-- order_expenses.expense_id (ON DELETE CASCADE — safe to update or delete)
DELETE FROM order_expenses WHERE expense_id IN (SELECT dupe_id FROM _exp_map);

-- batch_payment_expenses.expense_id (ON DELETE CASCADE)
DELETE FROM batch_payment_expenses WHERE expense_id IN (SELECT dupe_id FROM _exp_map);

-- cash_advance_expenses.expense_id (ON DELETE CASCADE)
DELETE FROM cash_advance_expenses WHERE expense_id IN (SELECT dupe_id FROM _exp_map);

-- expense_order_items.expense_id (ON DELETE CASCADE)
DELETE FROM expense_order_items WHERE expense_id IN (SELECT dupe_id FROM _exp_map);

-- stock_receipts.expense_id (ON DELETE SET NULL — already handled, but explicit)
UPDATE stock_receipts SET expense_id = NULL
FROM _exp_map m WHERE expense_id = m.dupe_id;

-- stock_issues.expense_id (ON DELETE SET NULL)
UPDATE stock_issues SET expense_id = NULL
FROM _exp_map m WHERE expense_id = m.dupe_id;

-- sourcing_bundles.expense_id (ON DELETE SET NULL)
UPDATE sourcing_bundles SET expense_id = NULL
FROM _exp_map m WHERE expense_id = m.dupe_id;

-- 3. Now safe to delete the duplicate expense rows
DELETE FROM expenses WHERE id IN (SELECT dupe_id FROM _exp_map);

DROP TABLE _exp_map;

-- 4. Trim whitespace on remaining codes
UPDATE expenses
SET expense_code = trim(expense_code)
WHERE expense_code IS NOT NULL AND expense_code != trim(expense_code);

-- 5. Add unique constraint
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_expense_code_unique;
ALTER TABLE expenses ADD CONSTRAINT expenses_expense_code_unique UNIQUE (expense_code);

-- 6. Verify — must return 0 rows
SELECT expense_code, count(*)
FROM expenses
WHERE expense_code IS NOT NULL
GROUP BY expense_code
HAVING count(*) > 1;
