-- ============================================================
-- Restrict staff.department_id writes to admin/hr_officer.
--
-- staff currently has four write-capable RLS policies: admin_all and
-- hr_officer_all (FOR ALL, unrestricted), plus raa_staff_write
-- (INSERT) and raa_staff_update (UPDATE) for manager/finance —
-- meaning manager/finance can today set or change ANY staff column,
-- including department_id, through the same broad row-level grant
-- used for the rest of the staff record. Postgres RLS can't express
-- a column-level carve-out inside those existing policies, so —
-- matching the enforce_expense_finance_fields precedent (migration
-- 006) — this is a BEFORE INSERT/UPDATE trigger that blocks a
-- department_id write specifically for anyone who isn't admin or
-- hr_officer, while leaving those two roles' existing ability to
-- write every other staff column untouched. This is a NEW write
-- path (department_id didn't exist before migration 082), so it
-- gets its own gate rather than joining the existing 24-table RLS
-- gap this project already closed once (migration 080).
--
-- get_user_role() is already SECURITY DEFINER (migration 001) and
-- only ever reads the CALLING user's own row (id = auth.uid()), so
-- there's no cross-user RLS gap here of the kind found in the
-- expense payment lifecycle work (migration 098) — this function
-- doesn't need SECURITY DEFINER of its own to call it correctly.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION enforce_staff_department_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'hr_officer') THEN
    IF (TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
      RAISE EXCEPTION 'Only Admin or HR can assign or change a staff member''s department';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_staff_department_assignment ON staff;
CREATE TRIGGER trg_enforce_staff_department_assignment
  BEFORE INSERT OR UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION enforce_staff_department_assignment();

-- Verify: trigger present on staff.
SELECT tgname FROM pg_trigger WHERE tgrelid = 'staff'::regclass AND NOT tgisinternal ORDER BY tgname;
