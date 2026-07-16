-- ============================================================
-- "Safarian" wasn't covered by the original category mapping doc
-- (migration 072) — it's the one true gap in the 14 unmapped rows,
-- distinct from the 13 deliberate balance-sheet/non-project
-- exclusions (it's tagged parent_type = 'Project', unlike those).
-- Confirmed: Materials.
-- ============================================================

SET search_path TO public;

UPDATE categories c
SET cost_group_id = g.id
FROM cost_groups g
WHERE c.cost_group_id IS NULL
  AND lower(trim(c.category_name)) = lower(trim('Safarian'))
  AND g.name = 'Materials';

-- Verify
SELECT category_name, parent_type, nature
FROM categories
WHERE cost_group_id IS NULL
ORDER BY category_name;

SELECT
  count(*) FILTER (WHERE cost_group_id IS NOT NULL) AS mapped,
  count(*) FILTER (WHERE cost_group_id IS NULL)      AS unmapped_falls_to_unallocated,
  count(*)                                            AS total_categories
FROM categories;
