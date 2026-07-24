-- ============================================================
-- Same class of gap already fixed once for stock_manager (115): the
-- new Design and HSE department landing pages join design_packages/
-- hse_incidents to projects(project_name) for context, but 'design',
-- 'sales', and 'hse_officer' never had a read grant on `projects` —
-- only admin/manager/finance/project_manager/logistics_officer/
-- stock_manager do. A LEFT JOIN hides an RLS-blocked read as "no row"
-- rather than an error, so this would have silently shown a blank
-- project name instead of failing loudly.
--
-- 'sales' is included even though its own landing page doesn't join
-- projects today — contracts.project_id exists precisely so a
-- contract can trace back to its project, and that's a reasonable
-- near-term need for the same role.
--
-- Same gap, same fix, on `clients`: the new BD/Sales landing page
-- joins opportunities/contracts to clients(client_name), but 'sales'
-- had no read grant there either — only admin/finance/manager did.
-- ============================================================

SET search_path TO public;

DROP POLICY IF EXISTS "dept_view_read_projects" ON projects;
CREATE POLICY "dept_view_read_projects" ON projects FOR SELECT
  USING (get_user_role() IN ('design', 'sales', 'hse_officer'));

DROP POLICY IF EXISTS "sales_role_read_clients" ON clients;
CREATE POLICY "sales_role_read_clients" ON clients FOR SELECT
  USING (get_user_role() = 'sales');

-- Verify
SELECT policyname FROM pg_policies WHERE tablename = 'projects' AND policyname = 'dept_view_read_projects';
SELECT policyname FROM pg_policies WHERE tablename = 'clients' AND policyname = 'sales_role_read_clients';
