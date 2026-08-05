-- 177 — Roles branch out: one person, many role assignments
--
-- The org reads: person (user_profiles login) → department → specific role.
-- A person can hold several roles — across departments (driver + procurement
-- officer) or within one — and sometimes scoped to a project (a designer acting
-- as operations manager on one job).
--
-- Why a new table rather than a second staff row: `staff` mixes the person's HR
-- record (salary, day_rate, bank_account, national_id) with their role
-- (role, department_id). Modeling a second role as a second staff row would
-- duplicate payroll-bearing data — payroll would pay them twice and advances
-- would split across two IDs. So staff stays ONE row per person (HR record +
-- primary role, unchanged so nothing that reads staff.role breaks), and
-- additional roles live here.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS staff_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  role          text NOT NULL,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  is_primary    boolean NOT NULL DEFAULT false,
  start_date    date,
  end_date      date,
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_assignments_staff ON staff_assignments(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_assignments_dept ON staff_assignments(department_id);
CREATE INDEX IF NOT EXISTS idx_staff_assignments_project ON staff_assignments(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_assignments_primary ON staff_assignments(staff_id) WHERE is_primary;

COMMENT ON TABLE staff_assignments IS
  'One "part of the work" a person is assigned: a role under a department, optionally scoped to a project. A person (staff row) may hold several; exactly one may be is_primary. Additional responsibilities never duplicate the HR record on staff.';

ALTER TABLE staff_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sa_admin_hr_all ON staff_assignments;
CREATE POLICY sa_admin_hr_all ON staff_assignments FOR ALL
  USING (get_user_role() IN ('admin','hr_officer')) WITH CHECK (get_user_role() IN ('admin','hr_officer'));
DROP POLICY IF EXISTS sa_leadership_write ON staff_assignments;
CREATE POLICY sa_leadership_write ON staff_assignments FOR ALL
  USING (get_user_role() IN ('executive','finance')) WITH CHECK (get_user_role() IN ('executive','finance'));
DROP POLICY IF EXISTS sa_read_all ON staff_assignments;
CREATE POLICY sa_read_all ON staff_assignments FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_assignments TO authenticated;

-- Backfill: each staff row's existing role/department becomes its primary
-- assignment. staff.role is left in place, so every existing page keeps working.
INSERT INTO staff_assignments (staff_id, department_id, role, is_primary, start_date, active)
SELECT s.id, s.department_id, s.role, true, s.starting_date, COALESCE(s.status,'active') = 'active'
FROM staff s
WHERE s.role IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM staff_assignments a WHERE a.staff_id = s.id AND a.is_primary);

-- Every assignment, resolved to person / login / department / project.
CREATE OR REPLACE VIEW v_staff_assignments
WITH (security_invoker = true) AS
SELECT
  a.id AS assignment_id, a.staff_id, a.role, a.is_primary, a.active,
  a.start_date, a.end_date, a.notes,
  a.department_id, d.name AS department_name,
  a.project_id, p.project_name,
  s.employee_name, s.status AS staff_status, s.user_id,
  up.full_name AS login_name, up.email AS login_email, up.role AS system_role
FROM staff_assignments a
JOIN staff s ON s.id = a.staff_id
LEFT JOIN departments d ON d.id = a.department_id
LEFT JOIN projects p ON p.id = a.project_id
LEFT JOIN user_profiles up ON up.id = s.user_id;
GRANT SELECT ON v_staff_assignments TO authenticated;

-- The bigger picture: one row per login, every role they hold anywhere.
CREATE OR REPLACE VIEW v_person_roles
WITH (security_invoker = true) AS
SELECT
  up.id AS user_id, up.full_name, up.email, up.role AS system_role, up.account_status,
  up.is_vrf_manager, up.is_tax_officer, up.is_logistics_officer, up.is_ride_hailing_authorized,
  COUNT(a.id) FILTER (WHERE a.active) AS active_role_count,
  COUNT(DISTINCT a.department_id) FILTER (WHERE a.active) AS department_count,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'assignment_id', a.id, 'role', a.role, 'department', d.name,
        'project', p.project_name, 'is_primary', a.is_primary, 'active', a.active
      ) ORDER BY a.is_primary DESC, a.role
    ) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb
  ) AS roles
FROM user_profiles up
LEFT JOIN staff s ON s.user_id = up.id
LEFT JOIN staff_assignments a ON a.staff_id = s.id
LEFT JOIN departments d ON d.id = a.department_id
LEFT JOIN projects p ON p.id = a.project_id
GROUP BY up.id, up.full_name, up.email, up.role, up.account_status,
         up.is_vrf_manager, up.is_tax_officer, up.is_logistics_officer, up.is_ride_hailing_authorized;
GRANT SELECT ON v_person_roles TO authenticated;

-- Signup: the allowlist (enforce_signup_allowlist) already proves the email is
-- in the company directory. Materialize that proof — attach the new login to its
-- staff record and carry the department onto the profile so the approver sees
-- who this is. Role still starts 'staff'/'pending': a self-signup must never
-- grant itself a privileged role; an admin still approves and picks it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_staff_id uuid;
  v_dept     text;
BEGIN
  SELECT s.id, d.name INTO v_staff_id, v_dept
  FROM staff s
  LEFT JOIN departments d ON d.id = s.department_id
  WHERE s.email IS NOT NULL AND lower(s.email) = lower(NEW.email)
  ORDER BY (s.role IS NOT NULL) DESC, s.created_at
  LIMIT 1;

  INSERT INTO public.user_profiles (id, full_name, role, account_status, email, department)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'staff',
    'pending',
    NEW.email,
    v_dept
  )
  ON CONFLICT (id) DO NOTHING;

  -- Only fills an unlinked staff row, so a deliberate link is never overwritten.
  IF v_staff_id IS NOT NULL THEN
    UPDATE staff SET user_id = NEW.id WHERE id = v_staff_id AND user_id IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;
