-- ============================================================
-- Labor, Tier 1: routine assignment of existing staff to a project.
-- Deliberately no approval workflow — a PM or site lead logs it
-- directly, as fast as a verbal assignment, because approval-gating
-- routine staff moves gets bypassed at the site level (the known
-- industry failure mode this design explicitly avoids per the
-- project's own stated decisions).
--
-- day_rate_snapshot is stamped once at INSERT from the staff member's
-- CURRENT rate and never touched again — a later raise or rate change
-- must not retroactively rewrite what a historical allocation was
-- actually committed at, same reasoning as project_budgets versioning.
-- ============================================================

SET search_path TO public;

-- Shared day-rate resolver, reused by labor_requisitions (094) and the
-- timesheet-actual costing (096). staff.day_rate is used directly
-- when set; staff paid monthly (day_rate NULL, monthly_salary set)
-- fall back to monthly_salary / 26 — a documented approximation (26
-- working days/month), not a precise payroll calendar computation.
--
-- SECURITY DEFINER: staff SELECT is role-restricted (admin, manager/
-- finance, hr_officer, own-row) and project_manager/operations_manager
-- — both legitimately allowed to log a labor_allocations row — have no
-- read policy on staff at all (found by testing this exact function:
-- it silently returned NULL for a project_manager caller instead of
-- erroring, because the underlying SELECT just matched zero rows under
-- their RLS). This narrow function only ever returns a single computed
-- rate, never the row itself, so elevating just this lookup is safe
-- without widening staff's actual read policies.
CREATE OR REPLACE FUNCTION staff_effective_day_rate(p_staff_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(day_rate, monthly_salary / 26.0) FROM staff WHERE id = p_staff_id
$$;

CREATE TABLE IF NOT EXISTS labor_allocations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id           UUID NOT NULL REFERENCES staff(id),
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date           DATE,
  day_rate_snapshot  NUMERIC(12,2),
  status             TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  assigned_by        UUID REFERENCES user_profiles(id),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labor_allocations_project ON labor_allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_labor_allocations_staff ON labor_allocations(staff_id);

CREATE OR REPLACE FUNCTION set_labor_allocation_rate_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.day_rate_snapshot IS NULL THEN
    NEW.day_rate_snapshot := staff_effective_day_rate(NEW.staff_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_labor_allocation_rate ON labor_allocations;
CREATE TRIGGER trg_set_labor_allocation_rate
  BEFORE INSERT ON labor_allocations
  FOR EACH ROW EXECUTE FUNCTION set_labor_allocation_rate_snapshot();

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE labor_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "labor_allocations_read" ON labor_allocations;
CREATE POLICY "labor_allocations_read" ON labor_allocations FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "labor_allocations_write" ON labor_allocations;
CREATE POLICY "labor_allocations_write" ON labor_allocations FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'project_manager', 'operations_manager'));

-- Verify
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'labor_allocations';
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'labor_allocations' ORDER BY policyname;
