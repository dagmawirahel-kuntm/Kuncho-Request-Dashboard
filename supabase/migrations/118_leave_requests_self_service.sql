-- ============================================================
-- Leave requests self-service (spec §6).
--
-- leave_requests (085) and its HR approval queue (LeaveRequestsPage)
-- already exist, but the table's only RLS policy is
-- "leave_requests_hr_only" (hr_officer/admin, FOR ALL) — no ordinary
-- employee can submit their own request. This adds three narrowly
-- scoped policies, following the exact "own staff record" pattern
-- from migration 044 (staff_view_own_advances etc.): a user may
-- select/insert/update-while-pending only rows whose staff_id
-- resolves to their own staff record (by user_id link or email
-- match). Deliberately NOT gated to get_user_role() = 'staff' like
-- 044's examples — leave applies to every employee regardless of
-- their system role (finance, design, procurement, ...), not just
-- the literal 'staff' role value. HR's existing FOR-ALL policy is
-- untouched and still governs approve/reject and full visibility.
-- ============================================================

SET search_path TO public;

DROP POLICY IF EXISTS "leave_requests_own_select" ON leave_requests;
CREATE POLICY "leave_requests_own_select" ON leave_requests
  FOR SELECT
  USING (
    staff_id IN (
      SELECT id FROM staff
      WHERE user_id = auth.uid()
         OR lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "leave_requests_own_insert" ON leave_requests;
CREATE POLICY "leave_requests_own_insert" ON leave_requests
  FOR INSERT
  WITH CHECK (
    status = 'pending'
    AND staff_id IN (
      SELECT id FROM staff
      WHERE user_id = auth.uid()
         OR lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- Self-cancel only: an employee can withdraw their own request while
-- it's still pending, but can't approve/reject their own, and can't
-- touch it once HR has already decided.
DROP POLICY IF EXISTS "leave_requests_own_cancel" ON leave_requests;
CREATE POLICY "leave_requests_own_cancel" ON leave_requests
  FOR UPDATE
  USING (
    status = 'pending'
    AND staff_id IN (
      SELECT id FROM staff
      WHERE user_id = auth.uid()
         OR lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    status IN ('pending', 'cancelled')
    AND staff_id IN (
      SELECT id FROM staff
      WHERE user_id = auth.uid()
         OR lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- Verify: leave_requests should now show 4 policies total
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'leave_requests' ORDER BY policyname;
