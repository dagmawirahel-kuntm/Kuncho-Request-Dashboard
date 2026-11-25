-- 538: Closing the gaps the security check found (24 Nov 2026).
--
-- 1. Pay. v_payroll_line_tax and v_payroll_tax_by_staff_period (511) run
--    with their owner's rights and filter nothing, so any login could read
--    every person's gross, net and PAYE. 357 closed this kind of leak; these
--    two came after it. The tax functions that read them by name all run
--    with owner rights (tax_plan_compute, tax_plan_levers,
--    build_tax_filing_schedule) and keep reading them unchanged. The app
--    reads new *_app views instead, which return a row only to admin,
--    executive, finance, HR, the tax officer — or the person it is about.
--
-- 2. Signed-out callers. The browser key is public by design, so anything
--    granted to `anon` is open to the internet. Signed out, the app needs
--    three things: checking a document's QR code (verify_document), a
--    driver's trip sheet (driver_trip_sheet) and the sign-up email check
--    (email_allowed_for_signup). Everything else in public is closed to
--    anon: tables, views and sequences, and every function — which until now
--    anon could call through PUBLIC's default grant. Signed-in users keep
--    exactly the functions they could call before (counted per function
--    first, so functions closed on purpose stay closed). Objects made later
--    start closed to anon too.
--
-- 3. Function search_path. 192 functions resolved names through the
--    caller's search_path, get_user_role() — which every policy uses —
--    among them. Each is pinned to public, extensions (what Supabase uses by
--    default, so lookups don't change). Extension-owned functions are left
--    alone.
--
-- 4. Client prices. Every 'staff' login could read every proforma and its
--    lines (043/049, from before the sales role existed). Those grants go.
--    Contracts and opportunities — deal values — were open to every login;
--    staff and technicians lose them. Project managers, operations, finance
--    and the rest keep them: project pages show the contract.
--
-- 5. A leftover: _claude_write_probe, a test table with no row security.
--
-- Not done here (dashboard settings, not SQL): leaked-password protection
-- and two-step sign-in, under Supabase → Authentication.

SET search_path TO public;

-- ── 1. Pay ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_payroll_line_tax_app WITH (security_barrier = true) AS
  SELECT * FROM v_payroll_line_tax
   WHERE (SELECT get_user_role()) = ANY (ARRAY['admin', 'executive', 'finance', 'hr_officer']::user_role[])
      OR (SELECT is_tax_officer())
      OR staff_id = (SELECT current_staff_id());

CREATE OR REPLACE VIEW v_payroll_tax_by_staff_period_app WITH (security_barrier = true) AS
  SELECT * FROM v_payroll_tax_by_staff_period
   WHERE (SELECT get_user_role()) = ANY (ARRAY['admin', 'executive', 'finance', 'hr_officer']::user_role[])
      OR (SELECT is_tax_officer())
      OR staff_id = (SELECT current_staff_id());

REVOKE ALL ON v_payroll_line_tax, v_payroll_tax_by_staff_period FROM anon, authenticated;
REVOKE ALL ON v_payroll_line_tax_app, v_payroll_tax_by_staff_period_app FROM anon;
GRANT SELECT ON v_payroll_line_tax_app, v_payroll_tax_by_staff_period_app TO authenticated;

-- ── 2. Signed-out callers ────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

DO $$
DECLARE
  f record;
  keep_auth oid[];
  keep_service oid[];
BEGIN
  -- Who can call what today, before PUBLIC's grant goes.
  SELECT array_agg(p.oid) INTO keep_auth
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  SELECT array_agg(p.oid) INTO keep_service
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND has_function_privilege('service_role', p.oid, 'EXECUTE');

  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.oid = ANY (keep_auth) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    IF f.oid = ANY (keep_service) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END $$;

-- What the signed-out pages need.
GRANT EXECUTE ON FUNCTION verify_document(text)          TO anon;
GRANT EXECUTE ON FUNCTION driver_trip_sheet(uuid)        TO anon;
GRANT EXECUTE ON FUNCTION email_allowed_for_signup(text) TO anon;

-- New objects start closed to anon (and functions to PUBLIC).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

-- ── 3. Function search_path ──────────────────────────────────────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', f.sig);
  END LOOP;
END $$;

-- ── 4. Client prices ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS proforma_staff    ON proformas;
DROP POLICY IF EXISTS raa_pi_staff_read ON proforma_items;

DROP POLICY IF EXISTS contracts_read ON contracts;
CREATE POLICY contracts_read ON contracts FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL
         AND COALESCE((SELECT get_user_role()) <> ALL (ARRAY['staff', 'technician']::user_role[]), false));

DROP POLICY IF EXISTS opportunities_read ON opportunities;
CREATE POLICY opportunities_read ON opportunities FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL
         AND COALESCE((SELECT get_user_role()) <> ALL (ARRAY['staff', 'technician']::user_role[]), false));

-- ── 5. Leftover ──────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _claude_write_probe;
