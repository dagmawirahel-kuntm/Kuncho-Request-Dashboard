-- 447 — The operations manager runs every project
--
-- An operations manager saw no projects, no purchase requests, no expenses,
-- no goods received and no budgets, and could not raise a purchase request:
-- the role was added piecemeal (work orders, labour, fleet, BOQ, PO approval
-- up to 500,000) and never to the core tables. Decided with the owner:
--
--   projects     every project, with the project manager's powers on each —
--                progress, site reports, deliveries to sign, purchase and
--                labour requests, petty cash, BOQ change orders (PM step)
--   approvals    POs up to 500,000 (unchanged); PM-level approvals on every
--                site; transport jobs and labour requests
--   money        project costs and budgets, to read: expenses, POs, goods
--                received, budget against spent. Not bank, payments, tax,
--                payroll, clients or invoices
--   people       the staff directory (names, roles, phones); not salaries or
--                bank accounts, which stay on the staff table
--
-- And the operations manager becomes a badge as well as a role
-- (user_profiles.is_operations_manager), like the logistics and tax-officer
-- badges: whoever holds another role — finance, here — can run operations
-- too. Everything below asks is_ops_manager(), which is true for the role or
-- the badge.
--
-- How:
--   1. is_ops_manager() and the badge
--   2. manages_project() / is_my_managed_project(): true for the operations
--      manager on every project — every rule and function that asks "is this
--      the project's manager" now says yes to them
--   3. functions that check the project manager's role or assignment by hand
--      (site petty cash, change orders, replenishments, ratings, milestones,
--      subcontracts, site-report gaps), and the operations-manager checks that
--      must also accept the badge — patched in place, each edit asserted
--   4. a twin rule for the operations manager beside every rule that grants
--      the project manager role, the operations manager role, or the named
--      project manager. Rules combine with OR, so a twin only adds; the
--      original is untouched. Generated from the live rules by one stated
--      transformation (section 4); left out: client documents, CPO bonds,
--      writing payment milestones, projects (section 5), and five rules
--      another twin already covers
--   5. rules written for the operations manager: projects, purchase requests
--      (with or without a project — workshop and office buying), goods
--      received
--   6. Dagmawi Fitsum: back to finance, with the operations manager badge
--
-- A new rule that grants the project manager something should grant
-- is_ops_manager() the same — nothing here twins rules written later.
--
-- Not done: the Telegram site bot reads the role from its own actor record,
-- so a badge holder acts there as their role (finance).

SET search_path TO public;

-- ── 1. The badge and the helper ─────────────────────────────────────────────
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_operations_manager boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN user_profiles.is_operations_manager IS
  'Runs operations alongside their role: every project with the project manager''s powers (447).';

CREATE OR REPLACE FUNCTION is_ops_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND account_status = 'active'
      AND (role = 'operations_manager' OR is_operations_manager)
  );
$$;
-- Policies for PUBLIC run it for anon too, where it is simply false.
GRANT EXECUTE ON FUNCTION is_ops_manager() TO anon, authenticated;

-- ── 2. Every project is theirs ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION manages_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_project_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = p_project_id
        AND p.project_manager_id IS NOT NULL
        AND p.project_manager_id = current_staff_id()
    )
    OR is_ops_manager()
  );
$$;

CREATE OR REPLACE FUNCTION is_my_managed_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_project_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND project_manager_id = my_staff_id())
    OR is_ops_manager()
  )
$$;

-- ── 3. Functions ────────────────────────────────────────────────────────────
-- Edit a function's live definition in place: p_old must occur exactly
-- p_times times. Re-running is a no-op once p_new is there.
CREATE FUNCTION pg_temp.patch_fn(p_fn regprocedure, p_old text, p_new text, p_times int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text := pg_get_functiondef(p_fn); n int;
BEGIN
  IF position(p_new IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, p_old, ''))) / length(p_old);
  IF n <> p_times THEN
    RAISE EXCEPTION '447: % — expected % of [%], found %', p_fn, p_times, p_old, n;
  END IF;
  EXECUTE replace(d, p_old, p_new);
END $$;

-- PM-level approvals on every site.
SELECT pg_temp.patch_fn('approve_site_petty_cash_request(uuid)',
  $x$IF v_role = 'admin' THEN$x$, $x$IF v_role = 'admin' OR is_ops_manager() THEN$x$);
SELECT pg_temp.patch_fn('reject_site_petty_cash_request(uuid, text)',
  $x$IF v_role = 'admin' THEN$x$, $x$IF v_role = 'admin' OR is_ops_manager() THEN$x$);
SELECT pg_temp.patch_fn('open_float_from_request(uuid)',
  $x$IF NOT (v_role IN ('admin','finance')$x$, $x$IF NOT (v_role IN ('admin','finance') OR is_ops_manager()$x$);
SELECT pg_temp.patch_fn('pm_approve_change_order(uuid)',
  $x$get_user_role() NOT IN ('admin', 'project_manager') THEN$x$,
  $x$(get_user_role() NOT IN ('admin', 'project_manager') AND NOT is_ops_manager()) THEN$x$);
SELECT pg_temp.patch_fn('record_client_signoff(uuid, text)',
  $x$get_user_role() NOT IN ('admin', 'project_manager') THEN$x$,
  $x$(get_user_role() NOT IN ('admin', 'project_manager') AND NOT is_ops_manager()) THEN$x$);
SELECT pg_temp.patch_fn('reject_change_order(uuid, text)',
  $x$v_role NOT IN ('admin', 'project_manager') THEN$x$,
  $x$(v_role NOT IN ('admin', 'project_manager') AND NOT is_ops_manager()) THEN$x$, 2);
SELECT pg_temp.patch_fn('enforce_petty_replenishment_approval_authority()',
  $x$get_user_role() NOT IN ('admin', 'project_manager')) THEN$x$,
  $x$(get_user_role() NOT IN ('admin', 'project_manager') AND NOT is_ops_manager())) THEN$x$);
SELECT pg_temp.patch_fn('adopt_subcontract_expense(uuid, text, uuid)',
  $x$'project_manager'::user_role, 'procurement_officer'::user_role])) THEN$x$,
  $x$'project_manager'::user_role, 'procurement_officer'::user_role]) OR is_ops_manager()) THEN$x$);
-- Rating a site foreman or a work-order lead: the project manager's right.
SELECT pg_temp.patch_fn('enforce_wo_rater_authority()',
  $x$IF v_role IN ('admin','executive')$x$, $x$IF (v_role IN ('admin','executive') OR is_ops_manager())$x$, 2);
SELECT pg_temp.patch_fn('mark_milestone_progress_met(uuid)',
  $x$COALESCE(v_role IN ('admin', 'finance'), false) OR (v_caller IS NOT NULL AND v_caller = v_pm_staff)$x$,
  $x$COALESCE(v_role IN ('admin', 'finance'), false) OR (v_caller IS NOT NULL AND v_caller = v_pm_staff) OR is_ops_manager()$x$);
SELECT pg_temp.patch_fn('site_report_gaps(uuid)',
  $x$get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role]) AS is_exec$x$,
  $x$(get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role]) OR is_ops_manager()) AS is_exec$x$);

-- The operations manager's own checks, so the badge passes them too.
SELECT pg_temp.patch_fn('apply_place_suggestion(text, uuid, uuid, text)',
  $x$v_role IN ('admin', 'executive', 'operations_manager', 'logistics_officer')$x$,
  $x$(v_role IN ('admin', 'executive', 'operations_manager', 'logistics_officer') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('att_can_manage()',
  $x$get_user_role()::text IN ('admin', 'hr_officer', 'operations_manager', 'executive')$x$,
  $x$(get_user_role()::text IN ('admin', 'hr_officer', 'operations_manager', 'executive') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('bot_can_ask_labour(uuid)',
  $x$get_user_role()::text IN ('admin', 'executive', 'project_manager', 'operations_manager', 'hr_officer')$x$,
  $x$(get_user_role()::text IN ('admin', 'executive', 'project_manager', 'operations_manager', 'hr_officer') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('bot_staff_link_code(uuid)',
  $x$get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer')$x$,
  $x$(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('bot_staff_unlink(uuid)',
  $x$get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer')$x$,
  $x$(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('can_manage_labor_requisition(uuid)',
  $x$get_user_role()::text IN ('admin', 'executive', 'hr_officer', 'operations_manager')$x$,
  $x$(get_user_role()::text IN ('admin', 'executive', 'hr_officer', 'operations_manager') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('can_record_attendance(uuid)',
  $x$(get_user_role())::text IN ('hr_officer','admin','operations_manager')$x$,
  $x$((get_user_role())::text IN ('hr_officer','admin','operations_manager') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('can_run_labour_site(uuid)',
  $x$get_user_role() IN ('admin', 'executive', 'operations_manager', 'hr_officer')$x$,
  $x$(get_user_role() IN ('admin', 'executive', 'operations_manager', 'hr_officer') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('can_run_work_order(uuid)',
  $x$get_user_role() IN ('admin', 'executive', 'operations_manager', 'project_manager')$x$,
  $x$(get_user_role() IN ('admin', 'executive', 'operations_manager', 'project_manager') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('close_labour_of_finished_orders()',
  $x$get_user_role() NOT IN ('admin', 'executive', 'operations_manager', 'hr_officer')$x$,
  $x$(get_user_role() NOT IN ('admin', 'executive', 'operations_manager', 'hr_officer') AND NOT is_ops_manager())$x$);
SELECT pg_temp.patch_fn('complete_expired_labor_allocations(uuid)',
  $x$get_user_role()::text NOT IN ('admin', 'executive', 'hr_officer', 'operations_manager')$x$,
  $x$(get_user_role()::text NOT IN ('admin', 'executive', 'hr_officer', 'operations_manager') AND NOT is_ops_manager())$x$);
SELECT pg_temp.patch_fn('confirm_labour_pay(uuid, date, text)',
  $x$get_user_role() IN ('admin', 'operations_manager')$x$,
  $x$(get_user_role() IN ('admin', 'operations_manager') OR is_ops_manager())$x$);
SELECT pg_temp.patch_fn('enforce_labor_req_approval_authority()',
  $x$v_role NOT IN ('admin', 'hr_officer', 'operations_manager')$x$,
  $x$(v_role NOT IN ('admin', 'hr_officer', 'operations_manager') AND NOT is_ops_manager())$x$);
SELECT pg_temp.patch_fn('submit_boq_change_order(uuid, text, text, boolean, numeric, jsonb)',
  $x$get_user_role() NOT IN ('admin', 'project_manager', 'operations_manager', 'design')$x$,
  $x$(get_user_role() NOT IN ('admin', 'project_manager', 'operations_manager', 'design') AND NOT is_ops_manager())$x$);
-- Who hears that labour was asked for: badge holders too.
SELECT pg_temp.patch_fn('trg_bot_labour_requested()',
  $x$WHERE role::text IN ('admin', 'hr_officer', 'operations_manager') AND account_status = 'active'$x$,
  $x$WHERE (role::text IN ('admin', 'hr_officer', 'operations_manager') OR is_operations_manager) AND account_status = 'active'$x$);

-- ── 4. A twin rule for the operations manager ───────────────────────────────
-- Add a rule unless one of that name is there already.
CREATE FUNCTION pg_temp.add_policy(p_table text, p_name text, p_cmd text, p_roles text, p_using text, p_check text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = p_table AND policyname = p_name) THEN
    RETURN;
  END IF;
  EXECUTE format('CREATE POLICY %I ON %I FOR %s TO %s', p_name, p_table, p_cmd, p_roles)
    || CASE WHEN p_using IS NOT NULL THEN ' USING (' || p_using || ')' ELSE '' END
    || CASE WHEN p_check IS NOT NULL THEN ' WITH CHECK (' || p_check || ')' ELSE '' END;
END $$;

-- For every rule granting the project manager role, the operations manager
-- role or the named project manager, the twin is the same rule with:
--   a role check naming project_manager or operations_manager → is_ops_manager()
--   a role check naming neither                               → false
--   project_manager_id = current_staff_id()                   → (… OR is_ops_manager())
-- so it grants the operations manager what that rule grants the project
-- manager, on every project, and grants nobody else anything new: the parts
-- of a rule that don't ask about a role are the original's.
DO $twin$
DECLARE r record; u text; c text; e text; x text; n int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies
    WHERE schemaname = 'public'
      AND coalesce(qual, '') || ' ' || coalesce(with_check, '')
          ~ '(''operations_manager''|''project_manager''|project_manager_id = current_staff_id\(\))'
      AND policyname !~ '_ops$'
      AND tablename NOT IN ('client_attachments', 'cpo_bonds', 'projects')
      AND NOT (tablename IN ('payment_milestones', 'payment_milestone_boq_items') AND cmd <> 'SELECT')
      AND policyname NOT IN ('ops_manager_read_capped_bundles', 'ops_manager_read_capped_bundle_items',
                             'ops_manager_read_transport', 'properties_read', 'rent_payment_requests_read')
    ORDER BY tablename, policyname
  LOOP
    u := r.qual; c := r.with_check;
    FOR i IN 1..2 LOOP
      e := CASE WHEN i = 1 THEN u ELSE c END;
      CONTINUE WHEN e IS NULL;
      FOR x IN SELECT (regexp_matches(e, 'get_user_role\(\) = ANY \(ARRAY\[[^\]]*\]\)', 'g'))[1] LOOP
        e := replace(e, x, CASE WHEN x ~ '''(project_manager|operations_manager)''' THEN '@OPS@' ELSE 'false' END);
      END LOOP;
      FOR x IN SELECT (regexp_matches(e, '\(get_user_role\(\)\)::text = ANY \(ARRAY\[[^\]]*\]\)', 'g'))[1] LOOP
        e := replace(e, x, CASE WHEN x ~ '''(project_manager|operations_manager)''' THEN '@OPS@' ELSE 'false' END);
      END LOOP;
      FOR x IN SELECT (regexp_matches(e, 'get_user_role\(\) = ''[a-z_]+''::user_role', 'g'))[1] LOOP
        e := replace(e, x, CASE WHEN x ~ '''(project_manager|operations_manager)''' THEN '@OPS@' ELSE 'false' END);
      END LOOP;
      e := regexp_replace(e, '((\m[a-z_]+\.)?project_manager_id = current_staff_id\(\))', '(\1 OR @OPS@)', 'g');
      e := replace(e, '@OPS@', '(SELECT is_ops_manager())');
      IF e ~ 'get_user_role' THEN
        RAISE EXCEPTION '447: a role check in %.% was not rewritten: %', r.tablename, r.policyname, e;
      END IF;
      IF i = 1 THEN u := e; ELSE c := e; END IF;
    END LOOP;
    CONTINUE WHEN coalesce(u, '') || coalesce(c, '') !~ 'is_ops_manager';
    PERFORM pg_temp.add_policy(r.tablename, left(r.policyname, 55) || '_ops', r.cmd, array_to_string(r.roles, ','), u, c);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '447: % twin rules', n;
END $twin$;

-- ── 5. Rules written for the operations manager ────────────────────────────
-- Projects: every project, to read and to run (stage, progress and budget
-- fields are already theirs in restrict_project_budgeting_field_edits).
SELECT pg_temp.add_policy('projects', 'projects_ops_read', 'SELECT', 'authenticated', '(SELECT is_ops_manager())', NULL);
SELECT pg_temp.add_policy('projects', 'projects_ops_update', 'UPDATE', 'authenticated', '(SELECT is_ops_manager())', '(SELECT is_ops_manager())');
-- Purchase requests, with or without a project.
SELECT pg_temp.add_policy('orders', 'orders_ops_read', 'SELECT', 'authenticated', '(SELECT is_ops_manager())', NULL);
SELECT pg_temp.add_policy('orders', 'orders_ops_insert', 'INSERT', 'authenticated', NULL, '(SELECT is_ops_manager())');
SELECT pg_temp.add_policy('orders', 'orders_ops_update', 'UPDATE', 'authenticated', '(SELECT is_ops_manager())', '(SELECT is_ops_manager())');
SELECT pg_temp.add_policy('order_items', 'order_items_ops_all', 'ALL', 'authenticated', '(SELECT is_ops_manager())', '(SELECT is_ops_manager())');
-- Goods received, to read.
SELECT pg_temp.add_policy('goods_received_notes', 'grn_ops_read', 'SELECT', 'authenticated', '(SELECT is_ops_manager())', NULL);
SELECT pg_temp.add_policy('goods_received_note_items', 'grn_items_ops_read', 'SELECT', 'authenticated', '(SELECT is_ops_manager())', NULL);

-- ── 6. Dagmawi Fitsum: finance, and operations ─────────────────────────────
UPDATE user_profiles SET role = 'finance', is_operations_manager = true
 WHERE id = '71147969-86d5-48f0-a976-71a2a5456643' AND role = 'operations_manager';
