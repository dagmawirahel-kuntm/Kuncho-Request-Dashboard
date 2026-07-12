-- ============================================================
-- Cost groups for project budgeting.
--
-- categories are flat (no real parent/grouping FK — parent_type is a
-- free-text Operational/Capital/Payroll/Transportation/Other tag that
-- doesn't map to construction cost groups). Budgeting needs a coarser
-- level: Materials, Labor, Subcontract, Transport, Overhead.
--
-- Every category maps to exactly one cost_group via cost_group_id.
-- Unmapped categories are NOT forced into a placeholder row — they
-- stay cost_group_id IS NULL, and every downstream budget view treats
-- NULL as its own "Unallocated" bucket (COALESCE'd at query time) so
-- mapping gaps are always visible on the workspace instead of being
-- silently dropped or silently mis-bucketed.
--
-- Auto-seeded only where parent_type is unambiguous (Payroll->Labor,
-- Transportation->Transport). Everything else is left NULL for a
-- human to map — the verification query at the bottom lists every
-- category with its current mapping (or gap) for that purpose.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS cost_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT UNIQUE NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO cost_groups (name, sort_order) VALUES
  ('Materials',   1),
  ('Labor',       2),
  ('Subcontract', 3),
  ('Transport',   4),
  ('Overhead',    5)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS cost_group_id UUID REFERENCES cost_groups(id);

-- Auto-seed the unambiguous mappings only. Safe to re-run: only
-- touches rows that are still unmapped.
UPDATE categories c
SET cost_group_id = g.id
FROM cost_groups g
WHERE c.cost_group_id IS NULL AND c.parent_type = 'Payroll' AND g.name = 'Labor';

UPDATE categories c
SET cost_group_id = g.id
FROM cost_groups g
WHERE c.cost_group_id IS NULL AND c.parent_type = 'Transportation' AND g.name = 'Transport';

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE cost_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cost_groups_read" ON cost_groups;
CREATE POLICY "cost_groups_read" ON cost_groups FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "cost_groups_admin_write" ON cost_groups;
CREATE POLICY "cost_groups_admin_write" ON cost_groups FOR ALL USING (get_user_role() = 'admin');

GRANT SELECT ON cost_groups TO authenticated;

-- Verify: every category with its current mapping (or gap). Send this
-- back for the remaining categories to be assigned to a cost group.
SELECT
  c.category_name,
  c.parent_type,
  c.nature,
  g.name AS cost_group
FROM categories c
LEFT JOIN cost_groups g ON g.id = c.cost_group_id
ORDER BY (g.name IS NULL) DESC, g.sort_order NULLS LAST, c.category_name;

SELECT
  count(*) FILTER (WHERE cost_group_id IS NOT NULL) AS mapped,
  count(*) FILTER (WHERE cost_group_id IS NULL)      AS unmapped_falls_to_unallocated,
  count(*)                                            AS total_categories
FROM categories;
