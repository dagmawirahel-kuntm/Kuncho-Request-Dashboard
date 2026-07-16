-- ============================================================
-- Variation orders: the only path to change a locked budget.
--
-- A variation targets one (project, cost_group). On approval it
-- carries the ENTIRE current version's snapshot forward to a new
-- version (every cost group, not just the targeted one — otherwise
-- v_project_cost_group_budget's `budgets` CTE, which joins on
-- `project_budgets.version = projects.budget_version`, would show
-- every OTHER cost group's budget as 0 the moment budget_version
-- bumps), applying this variation's delta only to its own group.
--
-- Direct INSERT into project_budgets is blocked once a project is
-- locked, UNLESS it's this migration's own approval trigger doing it
-- (flagged via a transaction-local app.variation_approval setting) —
-- closes the loophole where admin/manager/finance's existing broad
-- project_budgets RLS could otherwise be used to add a new version
-- row directly, bypassing the variation record entirely.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS budget_variations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_group_id           UUID NOT NULL REFERENCES cost_groups(id),
  requested_by            UUID REFERENCES user_profiles(id),
  requested_amount_delta  NUMERIC(14,2) NOT NULL,
  reason                  TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by             UUID REFERENCES user_profiles(id),
  approved_at             TIMESTAMPTZ,
  resulting_version       INT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_variations_project ON budget_variations(project_id);

-- ── Guard: once a project is locked, project_budgets can only gain a
-- new row through this migration's approval trigger ─────────────────
CREATE OR REPLACE FUNCTION guard_project_budgets_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_locked BOOLEAN;
BEGIN
  SELECT budget_baseline_locked_at IS NOT NULL INTO v_locked FROM projects WHERE id = NEW.project_id;
  IF v_locked AND COALESCE(current_setting('app.variation_approval', true), '') <> 'true' THEN
    RAISE EXCEPTION 'This project''s budget is locked — new budget lines can only be added through an approved variation order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_project_budgets_insert ON project_budgets;
CREATE TRIGGER trg_guard_project_budgets_insert
  BEFORE INSERT ON project_budgets
  FOR EACH ROW EXECUTE FUNCTION guard_project_budgets_insert();

-- ── Approval: carry the whole snapshot forward a version, apply the
-- delta to the targeted group, bump projects.budget_version ─────────
CREATE OR REPLACE FUNCTION apply_approved_budget_variation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_version INT;
  v_new_version      INT;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    SELECT budget_version INTO v_current_version FROM projects WHERE id = NEW.project_id;
    v_new_version := v_current_version + 1;

    PERFORM set_config('app.variation_approval', 'true', true);

    -- Carry every existing cost group forward, applying this
    -- variation's delta only to its own targeted group
    INSERT INTO project_budgets (project_id, cost_group_id, budgeted_amount, version, created_by, locked_at)
    SELECT
      project_id,
      cost_group_id,
      budgeted_amount + CASE WHEN cost_group_id = NEW.cost_group_id THEN NEW.requested_amount_delta ELSE 0 END,
      v_new_version,
      NEW.approved_by,
      NOW()
    FROM project_budgets
    WHERE project_id = NEW.project_id AND version = v_current_version;

    -- If the targeted cost group had no row at all yet (never
    -- budgeted before), the SELECT above won't have carried it
    -- forward — add it now so the delta isn't silently dropped
    INSERT INTO project_budgets (project_id, cost_group_id, budgeted_amount, version, created_by, locked_at)
    VALUES (NEW.project_id, NEW.cost_group_id, NEW.requested_amount_delta, v_new_version, NEW.approved_by, NOW())
    ON CONFLICT (project_id, cost_group_id, version) DO NOTHING;

    UPDATE projects SET budget_version = v_new_version WHERE id = NEW.project_id;

    NEW.resulting_version := v_new_version;
    NEW.approved_at := COALESCE(NEW.approved_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_approved_budget_variation ON budget_variations;
CREATE TRIGGER trg_apply_approved_budget_variation
  BEFORE UPDATE ON budget_variations
  FOR EACH ROW EXECUTE FUNCTION apply_approved_budget_variation();

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE budget_variations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budget_variations_read" ON budget_variations;
CREATE POLICY "budget_variations_read" ON budget_variations FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'project_manager', 'procurement_officer'));

DROP POLICY IF EXISTS "budget_variations_request" ON budget_variations;
CREATE POLICY "budget_variations_request" ON budget_variations FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'manager', 'finance', 'project_manager'));

-- Only finance/manager/admin can approve or reject — matches the
-- project_budgets write policy from Phase 1
DROP POLICY IF EXISTS "budget_variations_approve" ON budget_variations;
CREATE POLICY "budget_variations_approve" ON budget_variations FOR UPDATE
  USING (get_user_role() IN ('admin', 'manager', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'manager', 'finance'));

GRANT SELECT, INSERT, UPDATE ON budget_variations TO authenticated;

-- Verify
SELECT table_name FROM information_schema.tables WHERE table_name = 'budget_variations';
SELECT count(*) FROM budget_variations;
