-- ============================================================
-- Fixes a gap found during Schedule (PR 9b) frontend code review,
-- not caught by checkpoint (c)'s RLS testing: 218's schedules_insert
-- policy — WITH CHECK (get_user_role() = 'admin' OR owner_pm_staff_id
-- = current_staff_id()) — is self-referential on INSERT. There is no
-- existing row to compare against yet, so ANY authenticated staff
-- member can satisfy the non-admin branch simply by naming themselves
-- as owner_pm_staff_id on the new row — a finance user, an hr_officer,
-- anyone. Confirmed live: a finance-role staff member successfully
-- inserted a schedules row self-appointed as owner (probed in a rolled
-- -back transaction as the actual `authenticated` role, not the
-- superuser connection).
--
-- Item 23 says "PM only (the assigned owner) + admin" — "PM" means
-- role = project_manager, not "whoever the new row claims as its
-- owner." Fix: require the inserter to actually hold the
-- project_manager role for the non-admin branch.
--
-- schedules_update needed no equivalent fix: its USING clause checks
-- owner_pm_staff_id against the row's EXISTING (pre-update) value, so
-- a non-owner can't self-appoint by updating someone else's schedule
-- — USING already fails before WITH CHECK is even evaluated. The
-- self-referential gap is unique to INSERT, where no prior row exists
-- to check against. schedule_tasks_write has the same protection as
-- schedules_update (it checks the PARENT schedule's already-set
-- owner_pm_staff_id, not a value the inserter controls), so it's not
-- affected either.
-- ============================================================

SET search_path TO public;

DROP POLICY IF EXISTS schedules_insert ON schedules;

CREATE POLICY schedules_insert ON schedules FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = 'admin'
    OR (get_user_role() = 'project_manager' AND owner_pm_staff_id = current_staff_id())
  );

-- Verify.
SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename = 'schedules' AND policyname = 'schedules_insert';
