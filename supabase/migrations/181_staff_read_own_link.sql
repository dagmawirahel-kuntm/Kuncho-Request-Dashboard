-- 181 — Anyone can SELECT their own linked staff row
--
-- Symptom: PM view and Site Ops "My Projects" were empty for a project_manager
-- login even though the data qualified. Diagnostic showed the identity
-- resolver — useMyStaffId, which queries `staff` by user_id/email — returned
-- zero rows because no RLS policy grants a project_manager (or procurement_
-- officer, or design, etc.) SELECT on the staff table. Downstream project
-- queries all no-oped.
--
-- Fix: every authenticated user can read their own linked staff row. Match by
-- user_id (the explicit link) OR by email match — same fallback the app-side
-- hook uses. No cross-user leakage — the row must be theirs.

SET search_path TO public;

DROP POLICY IF EXISTS staff_read_own_link ON staff;
CREATE POLICY staff_read_own_link ON staff FOR SELECT
  USING (
    user_id = auth.uid()
    OR (email IS NOT NULL AND lower(email) = lower(coalesce(auth.jwt() ->> 'email','')))
  );
