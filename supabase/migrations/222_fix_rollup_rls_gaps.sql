-- rollup_labor_timesheets_to_expense() runs SECURITY INVOKER, so its
-- writes are subject to the caller's own RLS. Two tables it writes to
-- were missing policies since the day they were created (185_tier2_labor_pipeline_c.sql):
--
-- 1. labor_expense_workers had only a SELECT policy (lew_read) — no
--    INSERT policy at all, so "INSERT INTO labor_expense_workers" in the
--    rollup always failed with "new row violates row-level security
--    policy", for every role including admin.
-- 2. timesheet_attendance had SELECT/INSERT/DELETE policies but no
--    UPDATE policy, so the rollup's final "mark rows as rolled up" step
--    (UPDATE timesheet_attendance SET rolled_up_expense_id = ...) would
--    hit the same wall for per_day requisitions once (1) is fixed.
--
-- Mirror the role set already trusted to write labor-related expenses
-- (admin_expenses, expenses_executive_insert, raa_expenses_insert on
-- `expenses`) for labor_expense_workers, and extend timesheet_attendance's
-- existing ta_write role set with executive/finance — the two roles that
-- can reach the Labor Expense Drafts page (sidebar: admin/executive/finance)
-- but weren't covered by ta_write's original INSERT policy.
DROP POLICY IF EXISTS lew_write ON labor_expense_workers;
CREATE POLICY lew_write ON labor_expense_workers FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'finance'::user_role, 'hr_officer'::user_role, 'project_manager'::user_role, 'stock_manager'::user_role]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'finance'::user_role, 'hr_officer'::user_role, 'project_manager'::user_role, 'stock_manager'::user_role]));

DROP POLICY IF EXISTS ta_update ON timesheet_attendance;
CREATE POLICY ta_update ON timesheet_attendance FOR UPDATE
  USING ((get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'finance'::user_role, 'hr_officer'::user_role, 'project_manager'::user_role])) OR is_site_foreman_for_project(project_id))
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'finance'::user_role, 'hr_officer'::user_role, 'project_manager'::user_role])) OR is_site_foreman_for_project(project_id));
