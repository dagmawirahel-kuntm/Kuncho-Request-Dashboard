-- Run this LAST, after part00 and all of part01-part08 have succeeded.
-- Applies the staged expense->project links to the real expenses table
-- and cleans up.

BEGIN;

UPDATE expenses e
SET project_id = p.id
FROM _exp_project_import imp
JOIN projects p ON lower(trim(p.project_name)) = lower(trim(imp.project_name))
WHERE e.project_id IS NULL
  AND e.expense_code = imp.expense_code;

DROP TABLE IF EXISTS _exp_project_import;

COMMIT;

-- Verify
SELECT
  count(*) FILTER (WHERE project_id IS NOT NULL)                              AS now_linked,
  count(*) FILTER (WHERE project_id IS NULL AND project_name IS NOT NULL)     AS still_unlinked_with_name,
  count(*) FILTER (WHERE project_id IS NULL AND project_name IS NULL)         AS no_project_name_at_all
FROM expenses;
