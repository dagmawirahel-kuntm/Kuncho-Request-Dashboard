-- ============================================================
-- Reconciliation pass after 212/213/214: of the 12 functions still
-- carrying PUBLIC/anon EXECUTE, 6 are RLS helper functions confirmed
-- load-bearing (referenced directly inside pg_policies USING/WITH
-- CHECK clauses — get_user_role: 338 policies, current_staff_id: 25,
-- is_site_foreman_for_project: 25, manages_project: 9, my_staff_id: 4,
-- is_my_managed_project: 2) and are intentionally left untouched —
-- revoking PUBLIC/anon on any of these risks turning an anon query
-- against a policy that calls them into a hard "permission denied for
-- function" error instead of the intended zero-rows RLS outcome, for
-- any policy not explicitly scoped `TO authenticated`.
--
-- email_allowed_for_signup is also intentionally left untouched: it's
-- deliberately anon-reachable (granted in migration 050) and called
-- from SignupPage.tsx before the caller has a session — that's the
-- one legitimate pre-auth RPC in the schema.
--
-- The remaining 5 have no legitimate reason to be anon/PUBLIC
-- reachable and get the same hygiene revoke already applied to
-- custodian_flag_asset_issue etc. in 214. None of these are the
-- get_user_role() NULL-bypass bug — different, lower-severity issue
-- (either already correctly gated, or a no-gate-at-all read-only
-- resolver, or a self-scoped write that naturally no-ops for anon):
--
--   - check_and_fulfill_from_stock: already has a correct
--     `auth.uid() IS NULL` guard. Not exploitable, just an
--     unnecessary grant.
--   - resolve_expense_category: STABLE read-only resolver, no auth
--     gate at all — no reason for anon to call it directly.
--   - resolve_leave_approver: STABLE read-only resolver, no auth
--     gate — additionally leaks org-structure data (an approver's
--     user id) to an unauthenticated caller who guesses a staff_id.
--   - set_trainer_hints_enabled: writes via
--     `UPDATE user_profiles ... WHERE id = auth.uid()`, which
--     naturally matches zero rows for anon (auth.uid() IS NULL), so
--     not exploitable — still no reason to leave it reachable.
--   - is_assigned_project_manager: dead code. Zero references in any
--     RLS policy, view, or other function body, and zero calls from
--     the frontend. Its origin migration (155) only ever granted it
--     to `authenticated` — the PUBLIC grant it carries now is just
--     the CREATE FUNCTION default that nothing intentionally added.
--     Likely superseded by manages_project/is_my_managed_project.
-- ============================================================

SET search_path TO public;

REVOKE EXECUTE ON FUNCTION check_and_fulfill_from_stock(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION resolve_leave_approver(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION resolve_expense_category(expense_category, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION set_trainer_hints_enabled(BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION is_assigned_project_manager() FROM PUBLIC, anon;
