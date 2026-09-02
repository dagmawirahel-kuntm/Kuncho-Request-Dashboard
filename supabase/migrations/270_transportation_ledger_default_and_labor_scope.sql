-- ── 1. Ledger default for the new 'transportation' expense_type ─────────────
-- Same GL as fleet maintenance ('Transportation'/Fleet & Logistics costs) —
-- hired/ride-hailing transport jobs are the same kind of cost, just not
-- against company-owned vehicles.
INSERT INTO expense_type_ledger_defaults (expense_type, category_id, notes)
SELECT 'transportation'::expense_category, c.id,
       'Hired/ride-hailing transport jobs — same ledger as fleet maintenance'
FROM categories c
WHERE c.category_name = 'Transportation'
ON CONFLICT (expense_type) DO NOTHING;

-- ── 2. Labor requisitions: capture what the work actually was ───────────────
-- The Payment Request document for a labor rollup only ever showed
-- worker/days/rate — no description of the work itself beyond the bare
-- role_needed tag. Both nullable: optional detail, not a new required
-- step in an already-long form.
ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS scope_of_work TEXT,
  ADD COLUMN IF NOT EXISTS site_location TEXT;

COMMENT ON COLUMN labor_requisitions.scope_of_work IS
  'Free-text description of the task/work performed — shown on the labor Payment Request document alongside the worker breakdown.';
COMMENT ON COLUMN labor_requisitions.site_location IS
  'Where the work happened, when it can differ from the project''s own location (e.g. a specific site within a multi-site project).';
