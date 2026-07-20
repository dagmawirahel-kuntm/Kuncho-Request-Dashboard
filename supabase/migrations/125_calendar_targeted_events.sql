-- ============================================================
-- Calendar: announcements to a single named staff member (spec §7).
--
-- company_events (052) only has free-text `department` (NULL =
-- company-wide, else a department name) — no per-person targeting.
-- Adds a nullable recipient_staff_id: NULL keeps every existing
-- department/company-wide row and behavior unchanged; set means
-- "just for this one person."
--
-- Read RLS today ("events_read_all") is USING (get_user_role() IS NOT
-- NULL) — every authenticated user can read every row, department
-- filtering in CalendarPage.tsx/DepartmentBoard.tsx is client-side
-- convenience only, not access control. Naively adding
-- recipient_staff_id under that same policy would let anyone read
-- someone else's personal message just by querying company_events
-- directly — exactly the "silently expand who can see a personal
-- message" the spec warned against. So the read policy is tightened:
-- a personal row (recipient_staff_id NOT NULL) is only visible to its
-- recipient, plus admin/manager/hr_officer (the same three roles that
-- already have blanket write/manage access to this table, per 052's
-- own "communication gate" framing — consistent with them retaining
-- oversight of what they post, not a new grant). Department/company-
-- wide rows (recipient_staff_id IS NULL) keep the original
-- read-everyone behavior verbatim.
-- ============================================================

SET search_path TO public;

ALTER TABLE company_events ADD COLUMN IF NOT EXISTS recipient_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_company_events_recipient ON company_events(recipient_staff_id);

DROP POLICY IF EXISTS "events_read_all" ON company_events;
CREATE POLICY "events_read_all" ON company_events
  FOR SELECT USING (
    recipient_staff_id IS NULL
    OR get_user_role() IN ('admin', 'manager', 'hr_officer')
    OR recipient_staff_id IN (
      SELECT id FROM staff WHERE user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- events_write (052) is unchanged — admin/manager/hr_officer already
-- own posting/deleting any row, targeted or not.

-- Verify
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'company_events' ORDER BY policyname;
