-- ============================================================
-- Migration 071 stamped budget_baseline_locked_at on the Stage 3->4
-- transition but never actually froze the budget rows themselves —
-- its own header said as much. This adds the real freeze: once a
-- project_budgets row has locked_at set, a direct UPDATE of
-- budgeted_amount is rejected. The only way to change it after that
-- is an approved variation order (076), which inserts a new version
-- rather than editing the locked row.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION prevent_locked_budget_edit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This budget line is locked — changes must go through a variation order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_locked_budget_edit ON project_budgets;
CREATE TRIGGER trg_prevent_locked_budget_edit
  BEFORE UPDATE OF budgeted_amount ON project_budgets
  FOR EACH ROW EXECUTE FUNCTION prevent_locked_budget_edit();

-- Also stamp locked_at on the *current* version's rows the moment
-- 071's stage trigger runs — 071 already does this for rows that
-- exist at the moment of transition, but if a budget line gets added
-- to an already-locked project's current version afterward (shouldn't
-- normally happen, but nothing prevented it), it would sneak in
-- unlocked. Close that gap: any INSERT into project_budgets at the
-- project's current locked version is locked immediately too.
CREATE OR REPLACE FUNCTION lock_new_budget_row_if_project_locked()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_locked_at TIMESTAMPTZ;
  v_current_version INT;
BEGIN
  SELECT budget_baseline_locked_at, budget_version INTO v_locked_at, v_current_version
  FROM projects WHERE id = NEW.project_id;

  IF v_locked_at IS NOT NULL AND NEW.version = v_current_version AND NEW.locked_at IS NULL THEN
    NEW.locked_at := v_locked_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_new_budget_row_if_project_locked ON project_budgets;
CREATE TRIGGER trg_lock_new_budget_row_if_project_locked
  BEFORE INSERT ON project_budgets
  FOR EACH ROW EXECUTE FUNCTION lock_new_budget_row_if_project_locked();

-- Verify
SELECT count(*) FILTER (WHERE locked_at IS NOT NULL) AS locked_budget_rows,
       count(*) FILTER (WHERE locked_at IS NULL) AS unlocked_budget_rows
FROM project_budgets;
