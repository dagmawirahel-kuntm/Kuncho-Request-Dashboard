-- ============================================================
-- Project manager becomes a per-project ASSIGNMENT rather than a
-- global role. Confirmed real state before writing this:
--
--   • projects.project_manager_id is written by ProjectFormPage and
--     read by exactly one thing — ProjectManagerViewPage's "my
--     projects" query. Nothing else in the app or the database has
--     ever consulted it for authorization.
--   • Landing is resolved purely from user_profiles.role
--     (LandingRedirect's ROLE_LANDING). Being named on a project
--     confers nothing, so the one staff member actually assigned as
--     PM on 3 projects — whose login role is 'finance' — lands on
--     /finance/payments and can never reach /pm-view.
--   • No account in the system holds the 'project_manager' role at
--     all (2 admin, 2 finance). Every project_manager RLS policy is
--     therefore currently dormant — which is why replacing them here
--     removes nobody's live access.
--   • Those dormant policies are role-wide, not row-scoped:
--     project_manager_all grants ALL on EVERY project; raa_orders_*
--     and ops_roles_order_items grant read/insert/update on EVERY
--     order. Give someone the role and they could raise a purchase
--     request against any of the 89 projects. The unscoped picker in
--     OrderFormPage is the visible symptom; this is the cause.
--
-- Per user decision: the ASSIGNMENT confers the rights, whatever the
-- login role. Someone named on a project gets PM surfaces and scoped
-- ordering for that project while keeping everything their own role
-- already gives them — the finance/PM above keeps all finance access
-- and additionally gets their 3 projects. This mirrors the pattern
-- already established for workshop leads (useIsWorkshopLead: "derived,
-- not a stored permission", widening and narrowing automatically as
-- assignments change) rather than inventing a second mechanism.
--
-- Enforcement is in the database, not just the dropdown: a filtered
-- picker alone is bypassable by anyone calling the API directly.
--
-- IMPORTANT — RLS policies are permissive (OR'd together), so the
-- role-wide grants below are REPLACED, never merely supplemented.
-- Adding a scoped policy alongside a role-wide one would leave the
-- role-wide one deciding every case and change nothing.
-- ============================================================

SET search_path TO public;

-- ── 1. Identity helpers: defined in migration 148, used here ────────
-- current_staff_id() ("who am I, as a staff member" — explicit
-- staff.user_id link wins, else a case-insensitive email match, mirroring
-- useMyStaffId) and manages_project() ("am I the named PM of this one")
-- are declared once, in migration 148, which is the earliest migration
-- that needs them for its site-delivery gate.
--
-- This migration deliberately does NOT redeclare them. An earlier draft
-- did, and the result was two pairs of functions answering the same two
-- questions with separately-maintained bodies — precisely the drift the
-- single definition exists to prevent. 148 runs first, so both are in
-- place by the time anything below references them.
--
-- Note for the policy in section 3: the policy on `projects` itself does
-- NOT call manages_project(); it compares the row's own column instead,
-- which cannot recurse through projects' own RLS.

-- Am I the named PM of anything at all? Drives the route guard and the
-- sidebar entry, so someone with no assignment never sees PM surfaces.
CREATE OR REPLACE FUNCTION is_assigned_project_manager()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.project_manager_id IS NOT NULL
      AND p.project_manager_id = current_staff_id()
  );
$$;

GRANT EXECUTE ON FUNCTION is_assigned_project_manager() TO authenticated;

-- ── 3. projects: replace the role-wide grant with an assigned one ────
-- project_manager_all gave the role ALL commands on EVERY project.
-- Split into read + update scoped to the rows the caller actually
-- manages. Deliberately no INSERT/DELETE: creating and removing
-- projects stays with admin/manager/finance, who already have it —
-- managing a project is not licence to invent one.
DROP POLICY IF EXISTS "project_manager_all" ON projects;

DROP POLICY IF EXISTS "projects_assigned_pm_read" ON projects;
CREATE POLICY "projects_assigned_pm_read" ON projects FOR SELECT
  USING (project_manager_id IS NOT NULL AND project_manager_id = current_staff_id());

DROP POLICY IF EXISTS "projects_assigned_pm_update" ON projects;
CREATE POLICY "projects_assigned_pm_update" ON projects FOR UPDATE
  USING (project_manager_id IS NOT NULL AND project_manager_id = current_staff_id())
  WITH CHECK (project_manager_id IS NOT NULL AND project_manager_id = current_staff_id());

-- ── 4. orders: a PM orders for their own projects, and only those ────
-- The three raa_orders_* policies each carried 'project_manager' as a
-- bare role check. Each is rewritten so the project_manager arm is
-- replaced by the assignment test, while every other role in the same
-- policy keeps exactly the access it had.
--
-- hr_officer and procurement_officer arms are preserved verbatim —
-- their access has nothing to do with project assignment and is not
-- this migration's business.
DROP POLICY IF EXISTS "raa_orders_select" ON orders;
CREATE POLICY "raa_orders_select" ON orders FOR SELECT
  USING (
    get_user_role() IN ('hr_officer', 'procurement_officer')
    OR manages_project(project_id)
  );

DROP POLICY IF EXISTS "raa_orders_update" ON orders;
CREATE POLICY "raa_orders_update" ON orders FOR UPDATE
  USING (
    get_user_role() = 'hr_officer'
    OR manages_project(project_id)
  );

-- The one that actually stops "a PM ordering for any project selected":
-- an insert whose project_id isn't one the caller manages is refused by
-- the database, no matter what the client sent. finance and hr_officer
-- keep their existing unscoped insert.
DROP POLICY IF EXISTS "raa_orders_insert" ON orders;
CREATE POLICY "raa_orders_insert" ON orders FOR INSERT
  WITH CHECK (
    get_user_role() IN ('finance', 'hr_officer')
    OR manages_project(project_id)
  );

-- ── 5. order_items: follow the parent order's project ────────────────
-- ops_roles_order_items granted ALL to manager/finance/hr_officer/
-- project_manager. The first three are untouched; the project_manager
-- arm becomes an assignment test against the line's parent order, so a
-- PM can't reach line items on another project's request either.
DROP POLICY IF EXISTS "ops_roles_order_items" ON order_items;
CREATE POLICY "ops_roles_order_items" ON order_items FOR ALL
  USING (
    get_user_role() IN ('manager', 'finance', 'hr_officer')
    OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND manages_project(o.project_id))
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'finance', 'hr_officer')
    OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND manages_project(o.project_id))
  );

-- ── Verify ───────────────────────────────────────────────────────────
-- The role-wide grant is gone and the scoped ones are in place.
SELECT c.relname, polname, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname IN ('projects', 'orders', 'order_items')
  AND polname IN ('project_manager_all', 'projects_assigned_pm_read', 'projects_assigned_pm_update',
                  'raa_orders_select', 'raa_orders_update', 'raa_orders_insert', 'ops_roles_order_items')
ORDER BY c.relname, polname;

-- The assignment actually resolves: 3 projects, one named PM.
SELECT p.project_name, s.employee_name AS project_manager, s.user_id IS NOT NULL AS login_linked
FROM projects p JOIN staff s ON s.id = p.project_manager_id
ORDER BY p.project_name;

SELECT proname FROM pg_proc
WHERE proname IN ('current_staff_id', 'manages_project', 'is_assigned_project_manager')
ORDER BY proname;
