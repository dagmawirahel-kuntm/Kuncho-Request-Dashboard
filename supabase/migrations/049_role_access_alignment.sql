-- ═══════════════════════════════════════════════════════════════
-- Migration 049: Align RLS with what the app actually lets each
-- role do (role-matrix audit, pre-launch).
--
-- The audit cross-referenced every page's database writes against the
-- effective policies after 001–048 and found dozens of mismatches —
-- the same class of bug as the proforma RLS failure: pages the router
-- exposes to a role whose writes the database then rejects. Examples:
-- finance couldn't INSERT expenses, clients, or vendors; managers could
-- approve payroll/cash advances they couldn't SELECT; HR officers and
-- project managers couldn't submit an expense or transport request;
-- the VRF page (finance section) was procurement-only in RLS.
--
-- All policies here are ADDITIVE (permissive OR) — existing ownership
-- scoping for staff and the approval/payment triggers stay intact and
-- keep enforcing governance regardless of these wider grants.
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- ── Requests every role can raise ────────────────────────────────

-- Expenses: submit + view for all internal roles (staff/procurement
-- keep their own-rows-only policies; admin unchanged)
DROP POLICY IF EXISTS "raa_expenses_select" ON expenses;
CREATE POLICY "raa_expenses_select" ON expenses FOR SELECT
  USING (get_user_role() IN ('hr_officer', 'project_manager', 'stock_manager'));
DROP POLICY IF EXISTS "raa_expenses_insert" ON expenses;
CREATE POLICY "raa_expenses_insert" ON expenses FOR INSERT
  WITH CHECK (get_user_role() IN ('finance', 'hr_officer', 'project_manager', 'stock_manager'));
DROP POLICY IF EXISTS "raa_expenses_update" ON expenses;
CREATE POLICY "raa_expenses_update" ON expenses FOR UPDATE
  USING (get_user_role() IN ('hr_officer', 'project_manager', 'stock_manager'));

-- Transportation requests: likewise for all internal roles
DROP POLICY IF EXISTS "raa_transport_select" ON transportation_requests;
CREATE POLICY "raa_transport_select" ON transportation_requests FOR SELECT
  USING (get_user_role() IN ('hr_officer', 'project_manager', 'stock_manager', 'procurement_officer'));
DROP POLICY IF EXISTS "raa_transport_insert" ON transportation_requests;
CREATE POLICY "raa_transport_insert" ON transportation_requests FOR INSERT
  WITH CHECK (get_user_role() IN ('finance', 'hr_officer', 'project_manager', 'stock_manager', 'procurement_officer'));
DROP POLICY IF EXISTS "raa_transport_update" ON transportation_requests;
CREATE POLICY "raa_transport_update" ON transportation_requests FOR UPDATE
  USING (get_user_role() IN ('manager', 'finance', 'hr_officer', 'project_manager', 'stock_manager', 'procurement_officer'));

-- Purchase requests (orders): staff manage their own; finance/HR/PM can
-- raise and edit; procurement can read what it must source
DROP POLICY IF EXISTS "raa_staff_own_orders" ON orders;
CREATE POLICY "raa_staff_own_orders" ON orders FOR ALL
  USING (get_user_role() = 'staff' AND requested_by_user_id = auth.uid())
  WITH CHECK (get_user_role() = 'staff' AND requested_by_user_id = auth.uid());
DROP POLICY IF EXISTS "raa_orders_select" ON orders;
CREATE POLICY "raa_orders_select" ON orders FOR SELECT
  USING (get_user_role() IN ('hr_officer', 'project_manager', 'procurement_officer'));
DROP POLICY IF EXISTS "raa_orders_insert" ON orders;
CREATE POLICY "raa_orders_insert" ON orders FOR INSERT
  WITH CHECK (get_user_role() IN ('finance', 'hr_officer', 'project_manager'));
DROP POLICY IF EXISTS "raa_orders_update" ON orders;
CREATE POLICY "raa_orders_update" ON orders FOR UPDATE
  USING (get_user_role() IN ('hr_officer', 'project_manager'));

-- Purchase allocation: visible beyond procurement; M/F can maintain
DROP POLICY IF EXISTS "raa_alloc_select" ON purchase_allocation;
CREATE POLICY "raa_alloc_select" ON purchase_allocation FOR SELECT
  USING (get_user_role() IN ('manager', 'finance', 'staff', 'hr_officer', 'project_manager', 'stock_manager'));
DROP POLICY IF EXISTS "raa_alloc_write" ON purchase_allocation;
CREATE POLICY "raa_alloc_write" ON purchase_allocation FOR INSERT
  WITH CHECK (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_alloc_update" ON purchase_allocation;
CREATE POLICY "raa_alloc_update" ON purchase_allocation FOR UPDATE
  USING (get_user_role() IN ('manager', 'finance'));

-- ── Finance suite (routes: admin/manager/finance) ────────────────

-- Clients: finance owns the client book; managers can read
DROP POLICY IF EXISTS "raa_clients_finance" ON clients;
CREATE POLICY "raa_clients_finance" ON clients FOR ALL
  USING (get_user_role() = 'finance');
DROP POLICY IF EXISTS "raa_clients_manager_read" ON clients;
CREATE POLICY "raa_clients_manager_read" ON clients FOR SELECT
  USING (get_user_role() = 'manager');

-- Managers can read the money screens they help govern
DROP POLICY IF EXISTS "raa_accounts_manager_read" ON accounts;
CREATE POLICY "raa_accounts_manager_read" ON accounts FOR SELECT
  USING (get_user_role() = 'manager');
DROP POLICY IF EXISTS "raa_transfers_manager_read" ON transfers;
CREATE POLICY "raa_transfers_manager_read" ON transfers FOR SELECT
  USING (get_user_role() = 'manager');
DROP POLICY IF EXISTS "raa_tax_manager_read" ON tax_summary;
CREATE POLICY "raa_tax_manager_read" ON tax_summary FOR SELECT
  USING (get_user_role() = 'manager');
DROP POLICY IF EXISTS "raa_batch_manager_read" ON batch_payments;
CREATE POLICY "raa_batch_manager_read" ON batch_payments FOR SELECT
  USING (get_user_role() = 'manager');

-- VRF: finance reconciles it (was procurement+admin only)
DROP POLICY IF EXISTS "raa_vrf_finance" ON vendor_receipt_facilitation;
CREATE POLICY "raa_vrf_finance" ON vendor_receipt_facilitation FOR ALL
  USING (get_user_role() = 'finance');
DROP POLICY IF EXISTS "raa_vrf_manager_read" ON vendor_receipt_facilitation;
CREATE POLICY "raa_vrf_manager_read" ON vendor_receipt_facilitation FOR SELECT
  USING (get_user_role() = 'manager');

-- CPO bonds: finance + project managers manage, managers read (was admin-only)
DROP POLICY IF EXISTS "raa_cpo_finance" ON cpo_bonds;
CREATE POLICY "raa_cpo_finance" ON cpo_bonds FOR ALL
  USING (get_user_role() IN ('finance', 'project_manager'));
DROP POLICY IF EXISTS "raa_cpo_manager_read" ON cpo_bonds;
CREATE POLICY "raa_cpo_manager_read" ON cpo_bonds FOR SELECT
  USING (get_user_role() = 'manager');

-- ── HR suite (routes: admin/manager/finance/hr_officer) ──────────

-- Managers approve payroll runs & advances: they must be able to read them
DROP POLICY IF EXISTS "raa_payroll_manager_read" ON payroll;
CREATE POLICY "raa_payroll_manager_read" ON payroll FOR SELECT
  USING (get_user_role() = 'manager');
DROP POLICY IF EXISTS "raa_payroll_staff_manager_read" ON payroll_staff;
CREATE POLICY "raa_payroll_staff_manager_read" ON payroll_staff FOR SELECT
  USING (get_user_role() = 'manager');
DROP POLICY IF EXISTS "raa_advances_read" ON cash_advances;
CREATE POLICY "raa_advances_read" ON cash_advances FOR SELECT
  USING (get_user_role() IN ('manager', 'finance'));

-- Emergency payroll: finance settles it (had zero access)
DROP POLICY IF EXISTS "raa_eps_finance" ON emergency_payroll_summary;
CREATE POLICY "raa_eps_finance" ON emergency_payroll_summary FOR ALL
  USING (get_user_role() = 'finance');
DROP POLICY IF EXISTS "raa_eps_manager_read" ON emergency_payroll_summary;
CREATE POLICY "raa_eps_manager_read" ON emergency_payroll_summary FOR SELECT
  USING (get_user_role() = 'manager');

DROP POLICY IF EXISTS "raa_ptax_manager_read" ON payroll_taxes;
CREATE POLICY "raa_ptax_manager_read" ON payroll_taxes FOR SELECT
  USING (get_user_role() = 'manager');

-- Timesheets & staff records: managers/finance can maintain (routes allow it)
DROP POLICY IF EXISTS "raa_timesheet_write" ON timesheet;
CREATE POLICY "raa_timesheet_write" ON timesheet FOR INSERT
  WITH CHECK (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_timesheet_update" ON timesheet;
CREATE POLICY "raa_timesheet_update" ON timesheet FOR UPDATE
  USING (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_staff_write" ON staff;
CREATE POLICY "raa_staff_write" ON staff FOR INSERT
  WITH CHECK (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_staff_update" ON staff;
CREATE POLICY "raa_staff_update" ON staff FOR UPDATE
  USING (get_user_role() IN ('manager', 'finance'));

-- ── Procurement & master data (routes: admin/manager/finance/proc) ─

DROP POLICY IF EXISTS "raa_vendors_write" ON vendors;
CREATE POLICY "raa_vendors_write" ON vendors FOR INSERT
  WITH CHECK (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_vendors_update" ON vendors;
CREATE POLICY "raa_vendors_update" ON vendors FOR UPDATE
  USING (get_user_role() IN ('manager', 'finance'));

-- General ledger structure: finance owns it, managers can maintain entries
DROP POLICY IF EXISTS "raa_categories_finance" ON categories;
CREATE POLICY "raa_categories_finance" ON categories FOR ALL
  USING (get_user_role() = 'finance');
DROP POLICY IF EXISTS "raa_categories_manager_write" ON categories;
CREATE POLICY "raa_categories_manager_write" ON categories FOR INSERT
  WITH CHECK (get_user_role() = 'manager');
DROP POLICY IF EXISTS "raa_categories_manager_update" ON categories;
CREATE POLICY "raa_categories_manager_update" ON categories FOR UPDATE
  USING (get_user_role() = 'manager');
DROP POLICY IF EXISTS "raa_subcat_finance" ON sub_categories;
CREATE POLICY "raa_subcat_finance" ON sub_categories FOR ALL
  USING (get_user_role() = 'finance');
DROP POLICY IF EXISTS "raa_subcat_manager_write" ON sub_categories;
CREATE POLICY "raa_subcat_manager_write" ON sub_categories FOR INSERT
  WITH CHECK (get_user_role() = 'manager');
DROP POLICY IF EXISTS "raa_subcat_manager_update" ON sub_categories;
CREATE POLICY "raa_subcat_manager_update" ON sub_categories FOR UPDATE
  USING (get_user_role() = 'manager');

-- ── Management section (routes: admin/manager/finance/pm) ────────

DROP POLICY IF EXISTS "raa_projects_write" ON projects;
CREATE POLICY "raa_projects_write" ON projects FOR UPDATE
  USING (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_projects_insert" ON projects;
CREATE POLICY "raa_projects_insert" ON projects FOR INSERT
  WITH CHECK (get_user_role() = 'finance');
DROP POLICY IF EXISTS "raa_products_write" ON products;
CREATE POLICY "raa_products_write" ON products FOR INSERT
  WITH CHECK (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_products_update" ON products;
CREATE POLICY "raa_products_update" ON products FOR UPDATE
  USING (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_locations_write" ON locations;
CREATE POLICY "raa_locations_write" ON locations FOR INSERT
  WITH CHECK (get_user_role() IN ('manager', 'finance'));
DROP POLICY IF EXISTS "raa_locations_update" ON locations;
CREATE POLICY "raa_locations_update" ON locations FOR UPDATE
  USING (get_user_role() IN ('manager', 'finance'));

-- ── Regressions & hardening ──────────────────────────────────────

-- 047 accidentally removed staff's read access to proforma line items
DROP POLICY IF EXISTS "raa_pi_staff_read" ON proforma_items;
CREATE POLICY "raa_pi_staff_read" ON proforma_items FOR SELECT
  USING (get_user_role() = 'staff');

-- v_account_balances ran with owner rights, exposing all balances to any
-- authenticated user. Managers now have accounts SELECT, so the view can
-- respect the caller's RLS instead.
ALTER VIEW public.v_account_balances SET (security_invoker = true);
