-- Security regression fix: SECURITY DEFINER functions callable by anon.
--
-- Verified against the live database before writing this migration:
--   148 SECURITY DEFINER functions exist in `public`
--    90 of them grant EXECUTE to PUBLIC (and therefore anon)
--     7 of those are the RLS helpers, which must keep it
--    62 are trigger functions -- Postgres refuses to invoke a function
--       returning `trigger` directly ("trigger functions can only be called
--       as triggers"), so their grant is not reachable and is left alone
--    21 are directly callable RPCs -- the real exposure, revoked below
--
-- No call site loses access: every one of the 90 already carries its own
-- explicit `authenticated` grant, and all 90 carry `service_role`, so
-- revoking PUBLIC/anon removes only the anonymous path. Confirmed by
-- counting functions that would be left with neither -- zero.
--
-- The 21 are not obscure: they move money. Batch payment creation,
-- approval and confirmation; vendor credit creation and application;
-- expense un-approval; bank credit classification; staff record merges;
-- payment request save/void; petty cash float opening. All were callable
-- with nothing but the project's anon key.

SET search_path TO public;

-- ── 1) set_primary_staff_bank_account — had NO authorization check at all ──
--
-- It took an account id, resolved its staff_id, and flipped is_primary.
-- Any caller could repoint any staff member's primary bank account, which
-- is the account payment runs pay into. Restricted to admin/finance/HR,
-- matching the roles that manage staff records.
--
-- COALESCE(... , false) rather than a bare IN: get_user_role() returns NULL
-- for a caller with no user_profiles row, `NULL IN (...)` is NULL, and
-- `IF NOT NULL THEN` does not take the branch -- the same NULL-role bypass
-- migration 213 hardened elsewhere.
CREATE OR REPLACE FUNCTION public.set_primary_staff_bank_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff uuid;
  v_role  user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_role := get_user_role();
  IF NOT COALESCE(v_role IN ('admin', 'finance', 'hr_officer'), false) THEN
    RAISE EXCEPTION 'Only admin, finance or HR can change a staff member''s primary bank account';
  END IF;

  SELECT staff_id INTO v_staff FROM staff_bank_accounts WHERE id = p_account_id;
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Bank account % not found', p_account_id;
  END IF;

  UPDATE staff_bank_accounts SET is_primary = false
   WHERE staff_id = v_staff AND is_primary AND id <> p_account_id;
  UPDATE staff_bank_accounts SET is_primary = true, is_active = true
   WHERE id = p_account_id;
END $function$;

-- ── 2) open_float_from_request — NULL-role bypass ─────────────────────────
--
-- It did check roles, but the check could not fire for an unauthenticated
-- caller: v_role came back NULL, so `v_role IN ('admin','finance')` was
-- NULL, the whole condition was NULL, and `IF NOT (NULL) THEN RAISE` did
-- not raise -- execution fell through to the INSERT and opened a petty cash
-- float. The guard also moves ahead of the SELECT ... FOR UPDATE, so an
-- anonymous caller can no longer take a row lock on the request table.
CREATE OR REPLACE FUNCTION public.open_float_from_request(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text; v_float uuid;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_r.status <> 'approved' THEN RAISE EXCEPTION 'Only approved requests can open a float (status=%)', v_r.status; END IF;
  v_role := get_user_role()::text;
  IF NOT (v_role IN ('admin','finance')
    OR (v_role = 'project_manager' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = v_r.project_id AND p.project_manager_id = current_staff_id()
    ))
  ) THEN RAISE EXCEPTION 'Not authorised to open this float'; END IF;

  INSERT INTO petty_cash_floats(custodian_staff_id, project_id, float_amount, current_balance, active, opened_from_request_id)
  VALUES (v_r.requested_by_staff_id, v_r.project_id, v_r.requested_amount, v_r.requested_amount, true, v_r.id)
  RETURNING id INTO v_float;
  UPDATE site_petty_cash_float_requests
    SET status='opened', resulting_float_id=v_float, updated_at=now()
    WHERE id=p_request_id;
  RETURN v_float;
END;
$function$;

-- ── 3) Revoke PUBLIC/anon EXECUTE on the 21 callable SECURITY DEFINER RPCs ─
-- The 7 RLS helpers (get_user_role, current_staff_id, my_staff_id,
-- is_my_managed_project, manages_project, is_site_foreman_for_project,
-- email_allowed_for_signup) deliberately keep theirs: the first six are
-- evaluated inside RLS policies, and email_allowed_for_signup is called
-- during signup, before the caller is authenticated.
REVOKE EXECUTE ON FUNCTION public.apply_vendor_credit(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_batch_payment(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.classify_bank_credit(uuid, text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_batch_payment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_batch_payment(uuid[], uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_vendor_credit(uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fund_payable_from_vendor_credit(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.merge_staff_records(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.open_float_from_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_labor_rollup(uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rematch_committed_statement_lines(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resync_wo_attendance_timesheets() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rollup_labor_timesheets_to_expense(uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_payment_request(text, uuid, text, jsonb, jsonb, text, numeric, text, integer, integer, date, date, text[], text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_primary_staff_bank_account(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.settle_expense_with_vendor_credit(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_site_petty_cash_request(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unapprove_expense(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.undo_labor_rollup(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.undo_labor_rollups_for_period(uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.void_payment_request(uuid, text) FROM PUBLIC, anon;

-- ── 4) New functions start closed ─────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC on every newly created function, which
-- is how all 90 got there. This changes the default so future ones do not.
--
-- Caveat worth knowing: ALTER DEFAULT PRIVILEGES applies to objects created
-- by the role that runs it (here, the migration role). Functions created by
-- a different role will still default to PUBLIC, so this reduces the chance
-- of a recurrence rather than eliminating it -- the sweep at the bottom is
-- what actually catches one.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- ── Verification sweep ────────────────────────────────────────────────────
-- Callable (non-trigger) SECURITY DEFINER functions still reachable by
-- PUBLIC or anon. Expected: exactly the 7 RLS helpers.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
  AND p.prorettype::regtype::text <> 'trigger'
  AND (EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
                WHERE r.rolname = 'anon' AND a.privilege_type = 'EXECUTE'))
ORDER BY p.proname;
