-- Run this LAST, after part00 and all of part01-part10 have succeeded.
-- Applies the staged expense->project links to the real expenses table
-- and cleans up.
--
-- Two passes:
--   1. Exact expense_code match (works for rows whose code hasn't
--      drifted from the original Airtable value).
--   2. Fallback for rows the first pass missed: match by vendor name +
--      date + amount, but only using staging rows whose combination is
--      unique (composite_unique = true) to avoid linking to the wrong
--      project when two different expenses share the same vendor/date/
--      amount.

BEGIN;

-- Pass 1: exact expense_code
UPDATE expenses e
SET project_id = p.id
FROM _exp_project_import imp
JOIN projects p ON lower(trim(p.project_name)) = lower(trim(imp.project_name))
WHERE e.project_id IS NULL
  AND e.expense_code = imp.expense_code;

-- Pass 2: vendor + date + amount fallback, unique combinations only
UPDATE expenses e
SET project_id = p.id
FROM _exp_project_import imp
JOIN projects p ON lower(trim(p.project_name)) = lower(trim(imp.project_name))
WHERE e.project_id IS NULL
  AND imp.composite_unique = true
  AND lower(trim(e.vendors_name)) = imp.vendor_name_norm
  AND e.date = imp.expense_date
  AND round(e.amount_etb, 2) = imp.amount;

DROP TABLE IF EXISTS _exp_project_import;

COMMIT;

-- Verify
SELECT
  count(*) FILTER (WHERE project_id IS NOT NULL)                              AS now_linked,
  count(*) FILTER (WHERE project_id IS NULL AND project_name IS NOT NULL)     AS still_unlinked_with_name,
  count(*) FILTER (WHERE project_id IS NULL AND project_name IS NULL)         AS no_project_name_at_all
FROM expenses;
