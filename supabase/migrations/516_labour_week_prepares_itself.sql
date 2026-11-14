-- 516 — the week's pay prepares itself, and one place says where the pay is
--
-- Of ETB 1.16M of confirmed labour pay, 53% had not reached finance: it sat
-- between "confirm", "build a request" and "send", steps nobody was waiting
-- at. The approvals around them almost never refused anything (2 of 144
-- labour requests, none of 14 day sheets, none of 5 payment requests).
--
-- So confirming stops being a step. Locking a day is the confirmation. At the
-- weekly cut-off the system turns every locked day, and work recorded on
-- requests, into pay sheets, and puts everything payable of each site manager
-- into ONE draft payment request. They attach the signed attendance and send.
--
--   labour_week_close()      the cut-off: hourly job, or by hand by admin/ops
--   labour_pay_pipeline()    where the pay is, by stage and site manager

-- ── Settings ────────────────────────────────────────────────────────────────
ALTER TABLE public.labour_pay_week_settings
  ADD COLUMN IF NOT EXISTS auto_prepare   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_closed_to date,
  ADD COLUMN IF NOT EXISTS last_closed_at timestamptz;

-- The most recent cut-off that has passed, as a date in Addis.
CREATE OR REPLACE FUNCTION public.labour_last_cutoff()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT CASE WHEN x.d = t.today AND t.hr < s.cutoff_hour THEN x.d - 7 ELSE x.d END
    FROM labour_pay_week_settings s
    CROSS JOIN (SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date AS today,
                       extract(hour FROM now() AT TIME ZONE 'Africa/Addis_Ababa')::int AS hr) t
    CROSS JOIN LATERAL (SELECT t.today - ((extract(dow FROM t.today)::int - s.cutoff_dow + 7) % 7) AS d) x
   WHERE s.id
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_last_cutoff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_last_cutoff() TO authenticated;

-- The first automatic run is the next cut-off, not the moment this is applied.
UPDATE public.labour_pay_week_settings SET last_closed_to = public.labour_last_cutoff() WHERE id AND last_closed_to IS NULL;

CREATE OR REPLACE FUNCTION public.set_labour_auto_prepare(p_on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT (COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()) THEN
    RAISE EXCEPTION 'Only admin or operations can change this';
  END IF;
  UPDATE labour_pay_week_settings SET auto_prepare = COALESCE(p_on, auto_prepare), updated_at = now(), updated_by = auth.uid(),
         updated_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()) WHERE id;
END $f$;
REVOKE EXECUTE ON FUNCTION public.set_labour_auto_prepare(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_labour_auto_prepare(boolean) TO authenticated;

-- A request the system prepared belongs to the site manager it was prepared for.
ALTER TABLE public.labour_pay_requests
  ADD COLUMN IF NOT EXISTS prepared_for uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS week_to date;
CREATE INDEX IF NOT EXISTS idx_lpr_prepared_for ON public.labour_pay_requests (prepared_for) WHERE prepared_for IS NOT NULL;

CREATE OR REPLACE FUNCTION public.labour_pay_request_can_edit(p_request uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()
      OR EXISTS (SELECT 1 FROM labour_pay_requests q WHERE q.id = p_request AND q.prepared_for IS NOT NULL AND q.prepared_for = current_staff_id())
      OR NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
                      WHERE i.request_id = p_request AND i.removed_at IS NULL AND NOT manages_project(e.project_id));
$function$;

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order) VALUES
  ('labour.week_ready', 'Labour', 'Labour pay ready to sign', 'The week''s pay for your sites, prepared at the cut-off: attach the signed attendance and send it', 'high', 36)
ON CONFLICT (kind) DO UPDATE SET grp = EXCLUDED.grp, label = EXCLUDED.label, description = EXCLUDED.description;

-- ── The system acting at the cut-off ────────────────────────────────────────
-- True only for the scheduled job: nobody is signed in, and the job set the
-- flag for its own transaction. A signed-in person is never "the system".
CREATE OR REPLACE FUNCTION public.labour_is_system()
RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT auth.uid() IS NULL AND COALESCE(current_setting('kuncho.labour_system', true), '') = 'on'
$f$;

-- The two confirmations accept the system, and sign what it confirms as
-- "Kuncho (automatic)". Nothing else in them changes: each is re-created from
-- its live text with those lines replaced, and refuses to touch a function
-- that does not read as expected.
DO $patch$
DECLARE v text;
BEGIN
  v := pg_get_functiondef('public.confirm_labour_day_pay(uuid, date, text)'::regprocedure);
  IF position('labour_is_system()' IN v) = 0 THEN
    IF position('IF NOT labour_day_can_run(p_pm) THEN' IN v) = 0
       OR position('v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());' IN v) = 0 THEN
      RAISE EXCEPTION 'confirm_labour_day_pay does not read as expected; nothing was changed';
    END IF;
    v := replace(v, 'IF NOT labour_day_can_run(p_pm) THEN', 'IF NOT (labour_day_can_run(p_pm) OR labour_is_system()) THEN');
    v := replace(v, 'v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());',
                    'v_name text := COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), ''Kuncho (automatic)'');');
    EXECUTE v;
  END IF;

  v := pg_get_functiondef('public.confirm_labour_pay(uuid, date, text)'::regprocedure);
  IF position('labour_is_system()' IN v) = 0 THEN
    IF position('IF NOT (manages_project(r.project_id) OR COALESCE(' IN v) = 0
       OR position('auth.uid(), (SELECT full_name FROM user_profiles WHERE id = auth.uid()), NULLIF(btrim(p_note), ''''))' IN v) = 0 THEN
      RAISE EXCEPTION 'confirm_labour_pay does not read as expected; nothing was changed';
    END IF;
    v := replace(v, 'IF NOT (manages_project(r.project_id) OR COALESCE(', 'IF NOT (labour_is_system() OR manages_project(r.project_id) OR COALESCE(');
    v := replace(v, 'auth.uid(), (SELECT full_name FROM user_profiles WHERE id = auth.uid()), NULLIF(btrim(p_note), ''''))',
                    'auth.uid(), COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), ''Kuncho (automatic)''), NULLIF(btrim(p_note), ''''))');
    EXECUTE v;
  END IF;

  -- The morning message counts a request prepared for someone as theirs to send.
  v := pg_get_functiondef('public.labour_waiting_for(uuid)'::regprocedure);
  IF position('q.prepared_for' IN v) = 0 THEN
    IF position('WHERE q.created_by = p_user AND q.status IN (''draft'', ''returned'')' IN v) = 0 THEN
      RAISE EXCEPTION 'labour_waiting_for does not read as expected; nothing was changed';
    END IF;
    v := replace(v, 'WHERE q.created_by = p_user AND q.status IN (''draft'', ''returned'')',
                    'WHERE (q.created_by = p_user OR (q.prepared_for IS NOT NULL AND q.prepared_for = v_staff)) AND q.status IN (''draft'', ''returned'')');
    EXECUTE v;
  END IF;
END $patch$;

-- Confirmed pay of a site manager that is in no payment request yet. Pay
-- held for a worker HR has not verified stays out until they are.
CREATE OR REPLACE FUNCTION public.labour_payable_of(p_pm uuid)
RETURNS TABLE(pm uuid, expense_id uuid, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE(ps.pm_staff_id, p.project_manager_id), e.id, e.amount_etb
    FROM expenses e
    LEFT JOIN labour_pay_sheets ps ON ps.expense_id = e.id
    LEFT JOIN labour_pay_holds h ON h.expense_id = e.id
    JOIN projects p ON p.id = e.project_id
   WHERE (ps.id IS NOT NULL OR h.expense_id IS NOT NULL)
     AND NOT (h.expense_id IS NOT NULL AND worker_pay_held(h.staff_id))
     AND e.approval_status = 'pending' AND COALESCE(e.payment_state, 'unpaid') = 'unpaid' AND NOT COALESCE(e.is_archived, false)
     AND NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
                      WHERE i.expense_id = e.id AND i.removed_at IS NULL AND q.status <> 'cancelled')
     AND COALESCE(ps.pm_staff_id, p.project_manager_id) IS NOT NULL
     AND (p_pm IS NULL OR COALESCE(ps.pm_staff_id, p.project_manager_id) = p_pm)
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_payable_of(uuid) FROM PUBLIC, anon, authenticated;

-- ── The cut-off ─────────────────────────────────────────────────────────────
-- Run every hour by the job: it acts once, the first time it runs after a
-- cut-off. By hand (p_force, admin or operations) it prepares everything
-- payable up to today. For each site manager: locked days and piece jobs
-- become pay sheets, day work recorded on requests is confirmed, and all of
-- their confirmed pay that is in no request goes into one draft, added to the
-- draft already prepared for them if they have not sent it yet.
CREATE OR REPLACE FUNCTION public.labour_week_close(p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_pay_week_settings%ROWTYPE;
  v_system boolean := auth.uid() IS NULL;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_cut date; v_to date; pm record; q record;
  v_skipped text[]; v_ids uuid[]; v_added numeric; v_total numeric; v_workers integer; v_req uuid; v_code text; v_user uuid;
  v_out jsonb := '[]'::jsonb;
  v_note text;
BEGIN
  IF NOT v_system AND NOT (COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()) THEN
    RAISE EXCEPTION 'Only admin or operations can prepare the pay by hand';
  END IF;
  SELECT * INTO s FROM labour_pay_week_settings WHERE id FOR UPDATE;
  v_cut := labour_last_cutoff();
  IF p_force AND NOT v_system THEN
    v_to := v_today;
  ELSIF NOT s.auto_prepare OR (s.last_closed_to IS NOT NULL AND s.last_closed_to >= v_cut) THEN
    RETURN jsonb_build_object('ran', false);
  ELSE
    v_to := v_cut;
  END IF;
  IF v_system THEN PERFORM set_config('kuncho.labour_system', 'on', true); END IF;
  v_note := CASE WHEN v_system THEN 'Prepared at the weekly cut-off' ELSE 'Prepared by hand' END;

  FOR pm IN
    SELECT st.id, btrim(st.employee_name) AS name,
           COALESCE(st.user_id, (SELECT u.id FROM auth.users u WHERE st.email IS NOT NULL AND lower(u.email) = lower(st.email) LIMIT 1)) AS user_id
      FROM staff st
     WHERE st.id IN (
             SELECT d.pm_staff_id FROM labour_days d JOIN labour_day_workers w ON w.day_id = d.id
              WHERE d.status = 'locked' AND d.work_date <= v_to AND w.pay_run_id IS NULL
             UNION SELECT j.pm_staff_id FROM labour_day_job_costs(NULL, v_to) j WHERE j.amount > 0
             UNION SELECT p.project_manager_id FROM v_labour_unpaid u JOIN projects p ON p.id = u.project_id
                    WHERE u.payment_basis = 'per_day' AND u.first_day <= v_to
             UNION SELECT x.pm FROM labour_payable_of(NULL) x)
     ORDER BY 2
  LOOP
    v_skipped := '{}';
    -- 1. Locked days and piece jobs: one pay run.
    IF EXISTS (SELECT 1 FROM labour_days d JOIN labour_day_workers w ON w.day_id = d.id
                WHERE d.pm_staff_id = pm.id AND d.status = 'locked' AND d.work_date <= v_to AND w.pay_run_id IS NULL)
       OR EXISTS (SELECT 1 FROM labour_day_job_costs(pm.id, v_to) j WHERE j.amount > 0) THEN
      BEGIN
        PERFORM confirm_labour_day_pay(pm.id, v_to, v_note);
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || SQLERRM;
      END;
    END IF;
    -- 2. Day work recorded on a request: crew-leader jobs, and anything from before day sheets.
    FOR q IN SELECT u.labor_requisition_id, u.role_needed FROM v_labour_unpaid u JOIN projects p ON p.id = u.project_id
              WHERE p.project_manager_id = pm.id AND u.payment_basis = 'per_day' AND u.first_day <= v_to
                AND EXISTS (SELECT 1 FROM labour_pay_lines(u.labor_requisition_id, v_to) l WHERE l.amount > 0)
    LOOP
      BEGIN
        PERFORM confirm_labour_pay(q.labor_requisition_id, v_to, v_note);
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || (q.role_needed || ': ' || SQLERRM);
      END;
    END LOOP;
    -- 3. Everything payable of theirs, in no request yet: one draft.
    SELECT array_agg(x.expense_id), sum(x.amount) INTO v_ids, v_added FROM labour_payable_of(pm.id) x;
    IF v_ids IS NULL THEN
      IF cardinality(v_skipped) > 0 THEN
        v_out := v_out || jsonb_build_object('pm', pm.name, 'skipped', to_jsonb(v_skipped));
      END IF;
      CONTINUE;
    END IF;
    SELECT r.id INTO v_req FROM labour_pay_requests r WHERE r.prepared_for = pm.id AND r.status = 'draft' ORDER BY r.created_at DESC LIMIT 1;
    IF v_req IS NULL THEN
      INSERT INTO labour_pay_requests (code, note, created_by, created_by_name, prepared_for, week_to)
      VALUES ('LPR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_pay_request_seq')::text, 4, '0'),
              'Pay up to ' || to_char(v_to, 'Dy DD Mon') || '. ' || v_note || '.',
              auth.uid(), COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), 'Kuncho (automatic)'), pm.id, v_to)
      RETURNING id INTO v_req;
    ELSE
      UPDATE labour_pay_requests SET week_to = v_to, updated_at = now() WHERE id = v_req;
    END IF;
    INSERT INTO labour_pay_request_items (request_id, expense_id) SELECT v_req, unnest(v_ids)
    ON CONFLICT (request_id, expense_id) DO UPDATE SET removed_at = NULL;

    SELECT r.code INTO v_code FROM labour_pay_requests r WHERE r.id = v_req;
    SELECT COALESCE(sum(e.amount_etb), 0) INTO v_total FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
     WHERE i.request_id = v_req AND i.removed_at IS NULL;
    SELECT count(DISTINCT w.staff_id) INTO v_workers FROM labour_pay_request_items i JOIN labor_expense_workers w ON w.expense_id = i.expense_id
     WHERE i.request_id = v_req AND i.removed_at IS NULL;
    IF pm.user_id IS NOT NULL THEN
      PERFORM notify(ARRAY[pm.user_id], 'labour.week_ready',
        'Labour pay is ready to sign: ' || notify_etb(v_total) || CASE WHEN v_workers > 0 THEN ' for ' || v_workers || ' worker' || CASE WHEN v_workers = 1 THEN '' ELSE 's' END ELSE '' END,
        v_code || ', up to ' || to_char(v_to, 'Dy DD Mon') || '. Attach the signed attendance sheet and send it to finance.',
        '/labour/requests/' || v_req, 'labour_pay_request', v_req, NULL, 'labour.week_ready:' || v_req || ':' || v_to, '{}'::jsonb, true);
    END IF;
    v_out := v_out || jsonb_build_object('pm', pm.name, 'request_id', v_req, 'code', v_code, 'added', v_added, 'sheets_added', cardinality(v_ids),
                                         'total', v_total, 'workers', v_workers, 'skipped', to_jsonb(v_skipped));
  END LOOP;

  IF v_to = v_cut AND NOT (p_force AND NOT v_system) THEN
    UPDATE labour_pay_week_settings SET last_closed_to = v_cut, last_closed_at = now() WHERE id;
  END IF;
  RETURN jsonb_build_object('ran', true, 'to', v_to, 'requests', v_out);
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_close(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_close(boolean) TO authenticated;

-- ── Where the pay is ────────────────────────────────────────────────────────
-- Every birr of labour from "recorded" to "paid", by the stage it is at and
-- the site manager it belongs to. A site manager sees their own; operations,
-- finance, HR, executives and admin see everyone's.
--   1 open          recorded on a day sheet not sent for review     (site manager)
--   2 review        sent for review, not locked                     (operations)
--   3 locked        checked; goes into the pay at the cut-off       (nobody)
--   4 to_send       pay request ready, not signed and sent          (site manager)
--   5 with_finance  sent, not approved                              (finance)
--   6 approved      approved, not sent to the bank                  (finance)
--   7 sent          sent to the bank, no proof of payment yet       (finance)
--   8 paid
--   9 held          worker not verified by HR                       (HR)
CREATE OR REPLACE FUNCTION public.labour_pay_pipeline()
RETURNS TABLE(stage integer, key text, pm_staff_id uuid, pm_name text, amount numeric, items integer, oldest date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_all boolean := COALESCE(get_user_role()::text IN ('admin', 'operations_manager', 'finance', 'executive', 'hr_officer'), false) OR is_ops_manager();
  v_me uuid := current_staff_id();
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH days AS (       -- day workers on day sheets, not in a pay run
    SELECT c.pm_staff_id AS pm, c.day_status AS st, c.work_date AS d, c.amount AS amt
      FROM labour_day_costs(NULL, NULL, NULL) c WHERE c.pay_run_id IS NULL
  ), jobs AS (         -- piece and fixed-price work, not in a pay sheet
    SELECT COALESCE(dd.pm_staff_id, p.project_manager_id, r.requested_by_staff_id) AS pm, COALESCE(dd.status, 'locked') AS st, e.work_date AS d,
           round(CASE r.payment_basis WHEN 'per_volume' THEN COALESCE(e.quantity, 0) * COALESCE(r.unit_rate, 0)
                      ELSE COALESCE(e.percent_done, 0) / 100 * COALESCE(r.fixed_price_amount, 0) END, 2) AS amt
      FROM labour_work_entries e
      JOIN labor_requisitions r ON r.id = e.labor_requisition_id AND r.payment_basis IN ('per_volume', 'fixed_price')
      JOIN projects p ON p.id = r.project_id
      LEFT JOIN labour_days dd ON dd.id = e.labour_day_id
     WHERE e.pay_sheet_id IS NULL
  ), onreq AS (        -- day work recorded on a request, not confirmed
    SELECT p.project_manager_id AS pm, c.work_date AS d, c.cost AS amt
      FROM labour_entry_costs(NULL, NULL) c
      JOIN labor_requisitions r ON r.id = c.labor_requisition_id AND r.payment_basis = 'per_day'
      JOIN projects p ON p.id = c.project_id
     WHERE c.source = 'day' AND NOT c.confirmed
  ), sheets AS (       -- confirmed pay
    SELECT COALESCE(ps.pm_staff_id, p.project_manager_id) AS pm, ps.total AS amt, ps.confirmed_at::date AS d,
           e.approval_status::text AS appr, COALESCE(e.payment_state, 'unpaid') AS pay,
           (h.expense_id IS NOT NULL AND worker_pay_held(h.staff_id)) AS held,
           (SELECT rq.status FROM labour_pay_request_items i JOIN labour_pay_requests rq ON rq.id = i.request_id
             WHERE i.expense_id = e.id AND i.removed_at IS NULL AND rq.status <> 'cancelled' ORDER BY rq.created_at DESC LIMIT 1) AS req
      FROM labour_pay_sheets ps
      JOIN expenses e ON e.id = ps.expense_id
      JOIN projects p ON p.id = e.project_id
      LEFT JOIN labour_pay_holds h ON h.expense_id = e.id
     WHERE NOT COALESCE(e.is_archived, false)
  ), held AS (         -- pay split off and held for a worker HR has not verified
    SELECT p.project_manager_id AS pm, e.amount_etb AS amt, h.held_at::date AS d
      FROM labour_pay_holds h JOIN expenses e ON e.id = h.expense_id JOIN projects p ON p.id = e.project_id
     WHERE e.approval_status = 'pending' AND COALESCE(e.payment_state, 'unpaid') = 'unpaid' AND NOT COALESCE(e.is_archived, false)
       AND worker_pay_held(h.staff_id) AND NOT EXISTS (SELECT 1 FROM labour_pay_sheets ps WHERE ps.expense_id = e.id)
  ), r AS (
              SELECT 1 AS stage, 'open' AS key, x.pm, x.amt, x.d FROM days x WHERE x.st = 'open'
    UNION ALL SELECT 1, 'open', x.pm, x.amt, x.d FROM jobs x WHERE x.st = 'open'
    UNION ALL SELECT 2, 'review', x.pm, x.amt, x.d FROM days x WHERE x.st = 'submitted'
    UNION ALL SELECT 2, 'review', x.pm, x.amt, x.d FROM jobs x WHERE x.st = 'submitted'
    UNION ALL SELECT 3, 'locked', x.pm, x.amt, x.d FROM days x WHERE x.st = 'locked'
    UNION ALL SELECT 3, 'locked', x.pm, x.amt, x.d FROM jobs x WHERE x.st = 'locked'
    UNION ALL SELECT 3, 'locked', x.pm, x.amt, x.d FROM onreq x
    UNION ALL SELECT 4, 'to_send', x.pm, x.amt, x.d FROM sheets x WHERE x.appr = 'pending' AND x.pay = 'unpaid' AND NOT x.held AND COALESCE(x.req, 'none') IN ('none', 'draft', 'returned')
    UNION ALL SELECT 5, 'with_finance', x.pm, x.amt, x.d FROM sheets x WHERE x.appr = 'pending' AND x.pay = 'unpaid' AND NOT x.held AND x.req = 'submitted'
    UNION ALL SELECT 6, 'approved', x.pm, x.amt, x.d FROM sheets x WHERE x.pay = 'approved_to_pay'
    UNION ALL SELECT 7, 'sent', x.pm, x.amt, x.d FROM sheets x WHERE x.pay = 'sent'
    UNION ALL SELECT 8, 'paid', x.pm, x.amt, x.d FROM sheets x WHERE x.pay = 'paid'
    UNION ALL SELECT 9, 'held', x.pm, x.amt, x.d FROM sheets x WHERE x.appr = 'pending' AND x.pay = 'unpaid' AND x.held
    UNION ALL SELECT 9, 'held', x.pm, x.amt, x.d FROM held x
  )
  SELECT r.stage, r.key, r.pm, COALESCE(btrim(st.employee_name), 'No site manager'), sum(r.amt), count(*)::int, min(r.d)
    FROM r LEFT JOIN staff st ON st.id = r.pm
   WHERE COALESCE(r.amt, 0) > 0 AND (v_all OR (v_me IS NOT NULL AND r.pm = v_me))
   GROUP BY r.stage, r.key, r.pm, st.employee_name
   ORDER BY r.stage, sum(r.amt) DESC;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_pay_pipeline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_pay_pipeline() TO authenticated;

-- Every hour at :07; it acts once after each cut-off.
SELECT cron.schedule('kuncho-labour-week-close', '7 * * * *', 'SELECT public.labour_week_close()');
