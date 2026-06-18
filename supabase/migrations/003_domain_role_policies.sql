-- ═══════════════════════════════════════════════════════════════
-- RLS policies for domain-specific roles
-- (run as its own migration so the new enum values from
-- 002_add_domain_roles.sql are safe to reference)
-- ═══════════════════════════════════════════════════════════════

-- Procurement Officer: full access to the procurement domain
CREATE POLICY "procurement_officer_all" ON vendors FOR ALL USING (get_user_role() = 'procurement_officer');
CREATE POLICY "procurement_officer_all" ON categories FOR ALL USING (get_user_role() = 'procurement_officer');
CREATE POLICY "procurement_officer_all" ON sub_categories FOR ALL USING (get_user_role() = 'procurement_officer');
CREATE POLICY "procurement_officer_all" ON vendor_receipt_facilitation FOR ALL USING (get_user_role() = 'procurement_officer');
CREATE POLICY "procurement_officer_all" ON purchase_allocation FOR ALL USING (get_user_role() = 'procurement_officer');

-- HR Officer: full access to the HR domain
CREATE POLICY "hr_officer_all" ON staff FOR ALL USING (get_user_role() = 'hr_officer');
CREATE POLICY "hr_officer_all" ON payroll FOR ALL USING (get_user_role() = 'hr_officer');
CREATE POLICY "hr_officer_all" ON payroll_taxes FOR ALL USING (get_user_role() = 'hr_officer');
CREATE POLICY "hr_officer_all" ON emergency_payroll_summary FOR ALL USING (get_user_role() = 'hr_officer');
CREATE POLICY "hr_officer_all" ON cash_advances FOR ALL USING (get_user_role() = 'hr_officer');
CREATE POLICY "hr_officer_all" ON timesheet FOR ALL USING (get_user_role() = 'hr_officer');

-- Project Manager: full access to the management domain
CREATE POLICY "project_manager_all" ON projects FOR ALL USING (get_user_role() = 'project_manager');
CREATE POLICY "project_manager_all" ON products FOR ALL USING (get_user_role() = 'project_manager');
CREATE POLICY "project_manager_all" ON locations FOR ALL USING (get_user_role() = 'project_manager');
