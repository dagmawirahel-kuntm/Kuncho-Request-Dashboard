-- Closes PUBLIC/anon EXECUTE on the eight functions migrations 301 and 302
-- added without an explicit REVOKE.
--
-- WHY THIS IS NEEDED AT ALL — migration 238 added
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS
--     FROM PUBLIC, anon;
--
-- on the stated expectation that new functions would start closed. Checked
-- against live ACLs after 301-304 were applied, that is NOT what happens on
-- the migration path this project actually uses:
--
--   ec_month_name          {=X/postgres,postgres=X,authenticated=X,service_role=X}
--   generate_tax_filing_periods  {postgres=X,authenticated=X,service_role=X}
--
-- The first still carries `=X` (PUBLIC). The second does not — and the only
-- difference between them is that 302 spelled out a REVOKE for it. The
-- default-privileges row exists and does exclude PUBLIC, so the safety net
-- is there but is not being applied to functions created this way.
--
-- The operative conclusion: ALTER DEFAULT PRIVILEGES cannot be relied on
-- here. Every new function needs its own REVOKE line in its own migration.
-- That is now true of every function in 302, 303 and 304; these eight from
-- 301 (and tax_filing_due_date from 302) were the ones missed.
--
-- IMPACT OF THE GAP: six of the eight are pure calendar arithmetic that read
-- no rows, so an anonymous caller learned nothing from them. The one that
-- matters is is_tax_officer() — SECURITY DEFINER, and therefore inside the
-- set the security brief drew a line around: seven RLS helpers stay callable
-- by anon, nothing else. It was an eighth. It only ever returns a boolean
-- about the caller, and auth.uid() is NULL for anon so it returns false, but
-- the invariant is the point and it is cheap to hold.
--
-- SAFE BECAUSE: authenticated, service_role and postgres all hold explicit
-- grants on all eight (verified before writing this), so removing PUBLIC
-- takes nothing away from a signed-in caller. Every policy that calls
-- is_tax_officer() is TO authenticated, so anon never evaluates it.
-- ec_month_name() is also evaluated by the tax_filings.period_label
-- generated column, which only ever runs as authenticated or service_role.

SET search_path TO public;

REVOKE EXECUTE ON FUNCTION public.ec_is_leap(int)                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ec_month_name(int)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ec_to_gregorian(int, int, int)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gregorian_to_ec(date)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ec_month_start_greg(int, int)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ec_month_end_greg(int, int)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tax_officer()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tax_filing_due_date(jsonb, int, int, date) FROM PUBLIC, anon;
