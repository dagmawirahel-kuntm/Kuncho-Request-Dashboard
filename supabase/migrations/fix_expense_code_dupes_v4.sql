-- ── Fix duplicate expense_code values — single DO block ───────────────────────
DO $$
BEGIN

  -- Build mapping inside block so it stays alive for all statements
  CREATE TEMP TABLE IF NOT EXISTS _exp_map AS
  SELECT e.id AS dupe_id, k.keeper_id
  FROM expenses e
  JOIN (
    SELECT DISTINCT ON (lower(trim(expense_code)))
      id AS keeper_id,
      lower(trim(expense_code)) AS code_key
    FROM expenses
    WHERE expense_code IS NOT NULL
    ORDER BY lower(trim(expense_code)), created_at NULLS LAST, id
  ) k ON lower(trim(e.expense_code)) = k.code_key
  WHERE e.id != k.keeper_id
    AND e.expense_code IS NOT NULL;

  -- purchase_allocation.parent_purchase_id
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

  -- tool_units.expense_id
  UPDATE tool_units
  SET expense_id = NULL
  FROM _exp_map m
  WHERE expense_id = m.dupe_id;

  -- stock_receipts.expense_id
  UPDATE stock_receipts
  SET expense_id = NULL
  FROM _exp_map m
  WHERE expense_id = m.dupe_id;

  -- sourcing_bundles.expense_id
  UPDATE sourcing_bundles
  SET expense_id = NULL
  FROM _exp_map m
  WHERE expense_id = m.dupe_id;

  -- cascade-delete junction rows
  DELETE FROM order_expenses         WHERE expense_id IN (SELECT dupe_id FROM _exp_map);
  DELETE FROM batch_payment_expenses WHERE expense_id IN (SELECT dupe_id FROM _exp_map);
  DELETE FROM cash_advance_expenses  WHERE expense_id IN (SELECT dupe_id FROM _exp_map);
  DELETE FROM expense_order_items    WHERE expense_id IN (SELECT dupe_id FROM _exp_map);

  -- Delete the duplicate expense rows
  DELETE FROM expenses WHERE id IN (SELECT dupe_id FROM _exp_map);

  DROP TABLE _exp_map;

  -- Trim whitespace
  UPDATE expenses
  SET expense_code = trim(expense_code)
  WHERE expense_code IS NOT NULL AND expense_code != trim(expense_code);

  -- Add unique constraint
  ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_expense_code_unique;
  ALTER TABLE expenses ADD CONSTRAINT expenses_expense_code_unique UNIQUE (expense_code);

END $$;

-- Verify — must return 0 rows
SELECT expense_code, count(*)
FROM expenses
WHERE expense_code IS NOT NULL
GROUP BY expense_code
HAVING count(*) > 1;
