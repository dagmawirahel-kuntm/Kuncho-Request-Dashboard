-- Migration 060b: Logistics Officer as a real role + location linking
-- Run 060a_logistics_officer_role_enum.sql FIRST (separate transaction —
-- Postgres won't let a freshly added enum value be used until committed).
--
-- 1. "Logistics Officer" graduates from a badge (is_logistics_officer)
--    to a first-class role, like stock_manager/procurement_officer —
--    assignable directly to individual staff, not just layered on
--    managers. The badge column and its checks are left in place
--    (harmless, additive) so nobody's access breaks mid-transition;
--    the role is now the primary, intended mechanism going forward.
-- 2. locations gain project_id/vendor_id links so a logistics officer
--    dispatching a job can pick "Site — Project X" or "Vendor Y's shop"
--    and have the right project/vendor already attached.

SET search_path TO public;

-- ── locations: link to project / vendor ──────────────────────────
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_id  UUID REFERENCES vendors(id) ON DELETE SET NULL;

-- ── RLS: give the new role what a dispatcher actually needs ──────
-- vehicles: role now grants what the badge granted before
DROP POLICY IF EXISTS "vehicles_manage" ON vehicles;
CREATE POLICY "vehicles_manage" ON vehicles
  FOR ALL USING (
    get_user_role() IN ('admin', 'manager', 'logistics_officer')
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true)
  );

-- transportation_requests: logistics_officer had NO access at all
-- before this (only admin/manager/finance-read/staff-own existed)
DROP POLICY IF EXISTS "logistics_officer_all_transport" ON transportation_requests;
CREATE POLICY "logistics_officer_all_transport" ON transportation_requests
  FOR ALL USING (
    get_user_role() = 'logistics_officer'
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true)
  );

-- locations: dispatchers create/edit pins as they go
DROP POLICY IF EXISTS "logistics_officer_all_locations" ON locations;
CREATE POLICY "logistics_officer_all_locations" ON locations
  FOR ALL USING (
    get_user_role() = 'logistics_officer'
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true)
  );

-- projects: only manager/finance/admin/project_manager could read this
-- before — a dispatcher needs to see projects to link a job/location
DROP POLICY IF EXISTS "logistics_officer_read_projects" ON projects;
CREATE POLICY "logistics_officer_read_projects" ON projects
  FOR SELECT USING (
    get_user_role() = 'logistics_officer'
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true)
  );

-- staff: dispatchers need to assign jobs to people, so they must be
-- able to look staff up (read-only)
DROP POLICY IF EXISTS "logistics_officer_read_staff" ON staff;
CREATE POLICY "logistics_officer_read_staff" ON staff
  FOR SELECT USING (
    get_user_role() = 'logistics_officer'
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true)
  );
