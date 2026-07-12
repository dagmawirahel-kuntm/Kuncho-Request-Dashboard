-- ============================================================
-- Project budgeting: schema only (Phase 1 — no lock enforcement yet,
-- that's migration 070+ once the budget lock/variation-order flow
-- ships). Adds the columns and the project_budgets table; derived
-- actual/committed/remaining views are a separate migration.
--
-- `stage` is deliberately NOT added here — the lifecycle gate names
-- are still being confirmed against the operations manual. Every
-- other column proceeds.
-- ============================================================

SET search_path TO public;

-- ── projects: budgeting/workspace columns ──────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_id                 UUID REFERENCES clients(id),
  ADD COLUMN IF NOT EXISTS contract_value             NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS physical_progress          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS health                     TEXT,
  ADD COLUMN IF NOT EXISTS target_handover_date       DATE,
  ADD COLUMN IF NOT EXISTS budget_baseline_locked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS budget_version             INT NOT NULL DEFAULT 1;

ALTER TABLE projects ADD CONSTRAINT projects_physical_progress_check
  CHECK (physical_progress IS NULL OR (physical_progress >= 0 AND physical_progress <= 100)) NOT VALID;

ALTER TABLE projects ADD CONSTRAINT projects_health_check
  CHECK (health IS NULL OR health IN ('On Track', 'At Risk', 'Off Track')) NOT VALID;

-- Backfill client_id from sales, but only where a project's sales all
-- agree on one client — ambiguous (0 or 2+ distinct clients) is left
-- NULL rather than guessed. A project can also have its client set
-- directly going forward, independent of sales history.
UPDATE projects p
SET client_id = sub.only_client_id
FROM (
  SELECT project_id, (array_agg(client_id))[1] AS only_client_id
  FROM sales
  WHERE project_id IS NOT NULL AND client_id IS NOT NULL
  GROUP BY project_id
  HAVING COUNT(DISTINCT client_id) = 1
) sub
WHERE p.id = sub.project_id AND p.client_id IS NULL;

-- ── project_budgets ─────────────────────────────────────────────────────
-- One row per (project, cost_group, version). "Current" for a project
-- is wherever project_budgets.version = projects.budget_version; older
-- versions stay in the table as an audit trail once the lock/variation
-- flow (migration 070+) starts incrementing budget_version.
CREATE TABLE IF NOT EXISTS project_budgets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_group_id    UUID NOT NULL REFERENCES cost_groups(id),
  budgeted_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  version          INT NOT NULL DEFAULT 1,
  locked_at        TIMESTAMPTZ,
  locked_by        UUID REFERENCES user_profiles(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by       UUID REFERENCES user_profiles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_budgets_project_group_version
  ON project_budgets (project_id, cost_group_id, version);

CREATE INDEX IF NOT EXISTS idx_project_budgets_project ON project_budgets(project_id);

-- ── RLS: project_budgets ─────────────────────────────────────────────────
ALTER TABLE project_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_budgets_read" ON project_budgets;
CREATE POLICY "project_budgets_read" ON project_budgets FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'project_manager', 'procurement_officer'));

DROP POLICY IF EXISTS "project_budgets_write" ON project_budgets;
CREATE POLICY "project_budgets_write" ON project_budgets FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'manager', 'finance'));

GRANT SELECT, INSERT, UPDATE, DELETE ON project_budgets TO authenticated;

-- ── Column-level guard on projects ───────────────────────────────────────
-- `project_manager_all` (migration 003) already grants role='project_manager'
-- unscoped FOR ALL on every project row — broader than "this project's own
-- PM". Per the current decision, stage/progress/health/budget fields are
-- editable only by admin/manager/finance until task #9 (staff.user_id ->
-- login linking) lands and this can be scoped to the project's actual PM.
-- RLS alone can't carve out specific columns from an otherwise-permitted
-- row UPDATE, so this is enforced with a trigger — same mechanism as the
-- GRN fulfillment control (migration 063).
CREATE OR REPLACE FUNCTION restrict_project_budgeting_field_edits()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF get_user_role() IN ('admin', 'manager', 'finance') THEN
    RETURN NEW;
  END IF;

  -- TODO(#9): once staff.user_id reliably links a PM's login to their
  -- staff record, also allow this project's own PM here, e.g.:
  --   IF EXISTS (SELECT 1 FROM staff WHERE id = OLD.project_manager_id AND user_id = auth.uid())
  --   THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'Only admin, manager, or finance can edit stage, progress, health, or budget fields on a project';
END;
$$;

DROP TRIGGER IF EXISTS trg_restrict_project_budgeting_fields ON projects;
CREATE TRIGGER trg_restrict_project_budgeting_fields
  BEFORE UPDATE OF physical_progress, health, contract_value, target_handover_date,
                    budget_baseline_locked_at, budget_version
  ON projects
  FOR EACH ROW EXECUTE FUNCTION restrict_project_budgeting_field_edits();

-- ── project_manager needs to see PO commitments on their own projects'
-- workspace, but sourcing_bundles/sourcing_bundle_items RLS (migration
-- 026) only ever granted admin/manager/finance/procurement_officer
-- (plus stock_manager/logistics_officer, migration 063) — project_manager
-- was never added, which would silently zero out "Committed" on the
-- budgeting view for that role. Same gap shape as 063 found for
-- stock_manager/logistics_officer.
DROP POLICY IF EXISTS "project_manager_read_bundles" ON sourcing_bundles;
CREATE POLICY "project_manager_read_bundles" ON sourcing_bundles FOR SELECT
  USING (get_user_role() = 'project_manager');

DROP POLICY IF EXISTS "project_manager_read_bundle_items" ON sourcing_bundle_items;
CREATE POLICY "project_manager_read_bundle_items" ON sourcing_bundle_items FOR SELECT
  USING (get_user_role() = 'project_manager');

-- Verify
SELECT
  count(*) FILTER (WHERE client_id IS NOT NULL) AS projects_with_client_backfilled,
  count(*) FILTER (WHERE client_id IS NULL)     AS projects_without_client,
  count(*)                                       AS total_projects
FROM projects;

SELECT table_name FROM information_schema.tables WHERE table_name = 'project_budgets';
