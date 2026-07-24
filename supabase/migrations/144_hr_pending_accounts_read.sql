-- ============================================================
-- HR & People department landing page needs to show "pending account
-- signups waiting for approval" as a read-only count/list (per user
-- decision: HR sees the queue, but does not act on it — approving
-- still requires an admin on the full Users & Roles page). Today
-- hr_officer has ZERO visibility into user_profiles beyond their own
-- row (admin_all is FOR ALL admin-only; own_profile_select is
-- self-only) — so a narrow, additive SELECT-only policy is needed.
--
-- Deliberately scoped to account_status = 'pending' only, not every
-- user's full profile/role — hr_officer should not gain visibility
-- into active accounts' roles or badges just to see who's waiting for
-- approval. No write grant here at all; approve/reject stays
-- admin-only exactly as today.
-- ============================================================

SET search_path TO public;

DROP POLICY IF EXISTS "user_profiles_hr_pending_read" ON user_profiles;
CREATE POLICY "user_profiles_hr_pending_read" ON user_profiles FOR SELECT
  USING (get_user_role() = 'hr_officer' AND account_status = 'pending');

-- Verify
SELECT policyname FROM pg_policies WHERE tablename = 'user_profiles' AND policyname = 'user_profiles_hr_pending_read';
