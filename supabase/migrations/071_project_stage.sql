-- ============================================================
-- Project lifecycle stage, per operations manual §6.1 (7 stages) and
-- the confirmed budget lock point (§7.1): the baseline locks on the
-- Stage 3 -> 4 transition (pre_construction_mobilization ->
-- procurement_logistics), since the manual requires an approved
-- budget before Stage 3 completes.
--
-- This only stamps budget_baseline_locked_at automatically at that
-- transition (if not already set) and locks the *current* version's
-- project_budgets rows. It does NOT yet block direct edits to
-- budgeted_amount after lock, or add the variation-order version-bump
-- flow — that enforcement (§4/§5 of the original build brief) is
-- still Phase 2, same as originally scoped, since it needs the
-- variation-order UI to be meaningful. What ships here is exactly
-- what was asked: the enum, and the lock timestamp wired to the real
-- gate transition.
-- ============================================================

SET search_path TO public;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage TEXT;

ALTER TABLE projects ADD CONSTRAINT projects_stage_check
  CHECK (stage IS NULL OR stage IN (
    'business_development',
    'design_approvals',
    'pre_construction_mobilization',
    'procurement_logistics',
    'site_execution',
    'quality_snagging_handover',
    'closeout_final_accounts'
  )) NOT VALID;

-- Stamp budget_baseline_locked_at the moment a project moves out of
-- Stage 3 into Stage 4, and lock the current budget version's rows.
-- Only fires forward past that gate (never un-locks on a later stage
-- change) and only sets it once (idempotent — a project re-saved at
-- the same or a later stage doesn't re-stamp).
CREATE OR REPLACE FUNCTION lock_budget_on_stage_3_to_4()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage = 'procurement_logistics'
     AND OLD.stage = 'pre_construction_mobilization'
     AND NEW.budget_baseline_locked_at IS NULL THEN
    NEW.budget_baseline_locked_at := NOW();

    UPDATE project_budgets
    SET locked_at = NOW()
    WHERE project_id = NEW.id
      AND version = NEW.budget_version
      AND locked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_budget_on_stage_3_to_4 ON projects;
CREATE TRIGGER trg_lock_budget_on_stage_3_to_4
  BEFORE UPDATE OF stage ON projects
  FOR EACH ROW EXECUTE FUNCTION lock_budget_on_stage_3_to_4();

-- `stage` joins the same admin/manager/finance-only edit guard as the
-- other budgeting fields (migration 069) — a PM moving their own
-- project through gates is exactly the kind of edit task #9 will
-- unlock; until then it's admin/manager/finance same as the rest.
DROP TRIGGER IF EXISTS trg_restrict_project_budgeting_fields ON projects;
CREATE TRIGGER trg_restrict_project_budgeting_fields
  BEFORE UPDATE OF stage, physical_progress, health, contract_value, target_handover_date,
                    budget_baseline_locked_at, budget_version
  ON projects
  FOR EACH ROW EXECUTE FUNCTION restrict_project_budgeting_field_edits();

-- Verify
SELECT stage, count(*) FROM projects GROUP BY stage ORDER BY stage NULLS FIRST;
