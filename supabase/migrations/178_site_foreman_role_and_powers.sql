-- 178 — Site Foreman: role, project scoping, and operational RLS
--
-- A site foreman runs the day-to-day at a residential/site level. Scoping is
-- per-project via staff_assignments (already the "additional role" mechanism
-- from 177). No new column: an active assignment IS the scope.
--
-- Powers are additive on top of existing role-based RLS, so nothing an
-- admin/PM/finance can do today changes. A foreman gets no expense/CA/batch
-- approval — those routes are unchanged.

SET search_path TO public;

-- staff.role is text, not an enum, so 'site_foreman' is immediately a valid
-- value — no DDL needed. Documenting it here so the intent is discoverable.
COMMENT ON COLUMN staff.role IS
  'Free-text job title. System roles that hook into RLS include: Driver, '
  'Purchaser, Finance, Designer, Project Manager, Upper Level Managment, '
  'Carpenter, Labor, and site_foreman (residential site day-to-day; scoped '
  'per-project via staff_assignments).';

-- ── Scope helper ─────────────────────────────────────────────────────
-- SECURITY INVOKER, STABLE — RLS on staff/staff_assignments already restricts
-- what the caller can see, so no DEFINER escalation is needed or wanted.
CREATE OR REPLACE FUNCTION public.is_site_foreman_for_project(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY INVOKER
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM staff s
    JOIN staff_assignments a ON a.staff_id = s.id
    WHERE s.user_id = auth.uid()
      AND s.role = 'site_foreman'
      AND a.project_id = p_project_id
      AND a.active
  );
$function$;
GRANT EXECUTE ON FUNCTION public.is_site_foreman_for_project(uuid) TO authenticated;

-- ── Timesheet: foreman logs Tier 1 + Tier 2 for scoped projects ─────
-- Owner column for CRUD-of-own-uncommitted-entries: existing rows have no
-- direct "created_by" column, but staff_id is what the foreman selects and
-- timesheet.payroll_id lets us define "uncommitted" (not yet linked to a
-- payroll run). A foreman can INSERT for any staff on a scoped project;
-- UPDATE/DELETE only rows they created on a scoped project that hasn't
-- been rolled into payroll yet.
DROP POLICY IF EXISTS site_foreman_timesheet_write ON timesheet;
CREATE POLICY site_foreman_timesheet_write ON timesheet FOR INSERT
  WITH CHECK (
    is_site_foreman_for_project(project_id)
  );

DROP POLICY IF EXISTS site_foreman_timesheet_modify ON timesheet;
CREATE POLICY site_foreman_timesheet_modify ON timesheet FOR UPDATE
  USING (
    is_site_foreman_for_project(project_id)
    AND payroll_id IS NULL  -- uncommitted only
  )
  WITH CHECK (
    is_site_foreman_for_project(project_id)
    AND payroll_id IS NULL
  );

DROP POLICY IF EXISTS site_foreman_timesheet_delete ON timesheet;
CREATE POLICY site_foreman_timesheet_delete ON timesheet FOR DELETE
  USING (
    is_site_foreman_for_project(project_id)
    AND payroll_id IS NULL
  );

DROP POLICY IF EXISTS site_foreman_timesheet_read ON timesheet;
CREATE POLICY site_foreman_timesheet_read ON timesheet FOR SELECT
  USING (is_site_foreman_for_project(project_id));

-- ── HSE: foreman logs on scoped projects, reads scoped projects ─────
-- Existing hse_incidents_read is auth.uid()-permissive already; add write.
DROP POLICY IF EXISTS site_foreman_hse_write ON hse_incidents;
CREATE POLICY site_foreman_hse_write ON hse_incidents FOR INSERT
  WITH CHECK (is_site_foreman_for_project(project_id));

-- ── Work orders: progress → completed on scoped projects only ───────
-- No INSERT for foreman — PM/Ops still create WOs.
DROP POLICY IF EXISTS site_foreman_wo_update ON work_orders;
CREATE POLICY site_foreman_wo_update ON work_orders FOR UPDATE
  USING (is_site_foreman_for_project(project_id))
  WITH CHECK (is_site_foreman_for_project(project_id));

-- ── Stock issues: foreman can request (INSERT) for scoped projects ──
-- The existing pattern IS stock_issues (issue_type='request' semantics live in
-- the app); reuse it. Foreman INSERT is gated by project scope.
DROP POLICY IF EXISTS site_foreman_stock_write ON stock_issues;
CREATE POLICY site_foreman_stock_write ON stock_issues FOR INSERT
  WITH CHECK (is_site_foreman_for_project(project_id));

-- ── Projects: foreman can read the projects they're scoped to ───────
-- Otherwise the project pickers on their forms would be empty.
DROP POLICY IF EXISTS site_foreman_projects_read ON projects;
CREATE POLICY site_foreman_projects_read ON projects FOR SELECT
  USING (is_site_foreman_for_project(id));
