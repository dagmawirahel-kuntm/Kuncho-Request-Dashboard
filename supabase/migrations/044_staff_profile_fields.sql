-- Migration 044: Add profile fields to staff table
-- Enables staff profile pages and self-service landing page on login

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS email           TEXT,
  ADD COLUMN IF NOT EXISTS national_id     TEXT,
  ADD COLUMN IF NOT EXISTS employment_type TEXT,
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS photo_url       TEXT,
  ADD COLUMN IF NOT EXISTS user_id         UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

-- Fast lookup for dashboard redirect and RLS check
CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_email   ON staff(email)   WHERE email IS NOT NULL;

-- Staff users can read their own record (used for profile page + dashboard redirect)
DROP POLICY IF EXISTS "staff_view_own" ON staff;
CREATE POLICY "staff_view_own" ON staff
  FOR SELECT
  USING (
    get_user_role() = 'staff'
    AND user_id = auth.uid()
  );

-- HR officers need full write access to staff table
DROP POLICY IF EXISTS "hr_officer_all_staff" ON staff;
CREATE POLICY "hr_officer_all_staff" ON staff
  FOR ALL
  USING (get_user_role() = 'hr_officer');

-- Staff can view their own cash advances (needed for profile page tab)
DROP POLICY IF EXISTS "staff_view_own_advances" ON cash_advances;
CREATE POLICY "staff_view_own_advances" ON cash_advances
  FOR SELECT
  USING (
    get_user_role() = 'staff'
    AND staff_id IN (
      SELECT id FROM staff WHERE user_id = auth.uid()
    )
  );

-- Staff can view their own timesheet entries
DROP POLICY IF EXISTS "staff_own_timesheet_select" ON timesheet;
CREATE POLICY "staff_own_timesheet_select" ON timesheet
  FOR SELECT
  USING (
    get_user_role() = 'staff'
    AND staff_id IN (
      SELECT id FROM staff WHERE user_id = auth.uid()
    )
  );

-- Staff can view their own payroll summary records
DROP POLICY IF EXISTS "staff_view_own_payroll_summary" ON emergency_payroll_summary;
CREATE POLICY "staff_view_own_payroll_summary" ON emergency_payroll_summary
  FOR SELECT
  USING (
    get_user_role() = 'staff'
    AND staff_id IN (
      SELECT id FROM staff WHERE user_id = auth.uid()
    )
  );
