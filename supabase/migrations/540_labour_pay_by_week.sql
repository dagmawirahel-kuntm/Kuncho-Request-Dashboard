-- 540 — labour is paid by the week
--
-- Until now a pay run took "every locked, unpaid day up to a date", and the
-- weekly cut-off swept everything of a site manager into their newest draft
-- request. A day locked after the cut-off fell into the next sweep, older days
-- rode along with newer ones, and "pay me 16–22 Nov" had no answer.
--
-- Now the unit is the PM's week, Monday to Sunday:
--   labour_week_of(date)              the Monday of a date's week
--   labour_week_pay_prepare(pm, week) that week's locked days → its own pay run
--                                     and its own request (LPR), nothing else
--   labour_week_close()               the cut-off: the same, week by week
--   labour_week_pay_undo(pm, week)    admin / HR / operations take a week's pay
--                                     back while finance hasn't acted on it
--   labour_pay_weeks(from, pm)        one line per PM per week, with where it is
--
-- Piece work is measured over time, so a week pays what was measured up to its
-- Sunday that isn't paid yet (as before).

ALTER TABLE public.labour_day_pay_runs ADD COLUMN IF NOT EXISTS week_of date;
ALTER TABLE public.labour_pay_requests ADD COLUMN IF NOT EXISTS week_of date;
CREATE INDEX IF NOT EXISTS labour_pay_requests_week_idx ON public.labour_pay_requests (prepared_for, week_of);

CREATE OR REPLACE FUNCTION public.labour_week_of(p_date date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT p_date - (extract(isodow FROM p_date)::int - 1)
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_of(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_of(date) TO authenticated, service_role;

-- ── A pay run can start on a day (the week's Monday) as well as end on one ──
DROP FUNCTION IF EXISTS public.confirm_labour_day_pay(uuid, date, text);
CREATE OR REPLACE FUNCTION public.confirm_labour_day_pay(p_pm uuid, p_to date, p_note text DEFAULT NULL::text, p_from date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run uuid; v_code text; v_from date; v_last date; v_total numeric; v_n int; v_jobs int; v_missing text; v_cat uuid; v_exp uuid; v_sheet uuid;
  v_pm_name text := (SELECT employee_name FROM staff WHERE id = p_pm);
  v_name text := COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), 'Kuncho (automatic)');
  prj record; job record; v_lines jsonb;
BEGIN
  IF NOT (labour_day_can_run(p_pm) OR labour_is_system()) THEN RAISE EXCEPTION 'The PM confirms what is owed for their workers'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('labour_day_pay:' || p_pm::text));
  PERFORM 1 FROM labour_day_workers w JOIN labour_days d ON d.id = w.day_id
   WHERE d.pm_staff_id = p_pm AND d.status = 'locked' AND d.work_date <= p_to AND (p_from IS NULL OR d.work_date >= p_from) AND w.pay_run_id IS NULL
   FOR UPDATE OF w;

  SELECT string_agg(DISTINCT s.employee_name, ', ') INTO v_missing
    FROM labour_days d JOIN labour_day_workers w ON w.day_id = d.id JOIN staff s ON s.id = w.staff_id
   WHERE d.pm_staff_id = p_pm AND d.status = 'locked' AND d.work_date <= p_to AND (p_from IS NULL OR d.work_date >= p_from)
     AND w.pay_run_id IS NULL AND COALESCE(s.day_rate, 0) <= 0
     AND EXISTS (SELECT 1 FROM labour_day_allocations a WHERE a.day_id = d.id AND a.staff_id = w.staff_id AND a.days > 0);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'No day rate on file for %. HR adds it on the worker''s record first', v_missing; END IF;

  SELECT count(*), min(work_date), max(work_date) INTO v_n, v_from, v_last
    FROM labour_day_costs(p_pm, p_from, p_to) c WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL;
  SELECT count(DISTINCT labor_requisition_id), LEAST(v_from, min(work_date)), GREATEST(v_last, max(work_date)) INTO v_jobs, v_from, v_last
    FROM labour_day_job_costs(p_pm, p_to) HAVING sum(amount) > 0;
  IF COALESCE(v_n, 0) = 0 AND COALESCE(v_jobs, 0) = 0 THEN RAISE EXCEPTION 'No locked days to pay up to %', to_char(p_to, 'DD Mon'); END IF;
  IF v_from IS NULL THEN
    SELECT min(work_date), max(work_date) INTO v_from, v_last FROM labour_day_costs(p_pm, p_from, p_to) c WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL;
  END IF;

  v_code := 'LDP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_day_pay_run_seq')::text, 4, '0');
  INSERT INTO labour_day_pay_runs (code, pm_staff_id, period_start, period_end, total, note, confirmed_by, confirmed_by_name, week_of)
  VALUES (v_code, p_pm, v_from, v_last, 0, NULLIF(btrim(p_note), ''), auth.uid(), v_name,
          CASE WHEN p_from IS NOT NULL AND p_from = labour_week_of(p_from) AND p_to = p_from + 6 THEN p_from END)
  RETURNING id INTO v_run;

  v_cat := COALESCE((SELECT c.id FROM categories c WHERE c.category_name = 'Labor' AND c.parent_type = 'Project' ORDER BY c.created_at LIMIT 1),
                    (SELECT c.id FROM categories c WHERE c.category_name = 'Labor' ORDER BY c.created_at LIMIT 1));

  -- Day workers: one payable per project.
  FOR prj IN
    SELECT c.project_id, p.project_name, sum(c.amount) AS amount, min(c.work_date) AS first_day, max(c.work_date) AS last_day,
           count(DISTINCT c.staff_id) AS workers, (array_agg(DISTINCT c.staff_id))[1] AS one_staff
      FROM labour_day_costs(p_pm, p_from, p_to) c JOIN projects p ON p.id = c.project_id
     WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL
     GROUP BY c.project_id, p.project_name
    HAVING sum(c.amount) > 0
     ORDER BY p.project_name
  LOOP
    SELECT jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'worker_name', s.employee_name, 'first_day', x.first_day, 'last_day', x.last_day,
             'days', x.days, 'hours', x.days * 8, 'overtime_hours', x.ot_h, 'quantity', NULL, 'percent_done', NULL, 'rate', x.rate,
             'overtime_amount', x.ot, 'amount', x.amount, 'build_days', x.build, 'repair_days', x.repair, 'other_days', x.other) ORDER BY s.employee_name)
      INTO v_lines
      FROM (SELECT c.staff_id, min(c.work_date) AS first_day, max(c.work_date) AS last_day, sum(c.days) AS days, max(c.day_rate) AS rate,
                   sum(c.overtime_hours) AS ot_h, sum(c.overtime) AS ot, sum(c.amount) AS amount,
                   sum(c.days) FILTER (WHERE c.bucket = 'build') AS build, sum(c.days) FILTER (WHERE c.bucket = 'repair') AS repair,
                   sum(c.days) FILTER (WHERE c.bucket NOT IN ('build', 'repair')) AS other
              FROM labour_day_costs(p_pm, p_from, p_to, prj.project_id) c
             WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL AND c.project_id = prj.project_id
             GROUP BY c.staff_id) x
      JOIN staff s ON s.id = x.staff_id;

    INSERT INTO expenses (
      item_service_description, amount_etb, expense_type, category_id, project_id, date,
      paid_to_staff_id, approval_status, payment_state, rollup_period_start, rollup_period_end)
    VALUES (
      format('Labour %s · day sheets · %s · %s · %s to %s', v_code, COALESCE(v_pm_name, '—'), prj.project_name,
             to_char(prj.first_day, 'DD Mon'), to_char(prj.last_day, 'DD Mon YYYY')),
      prj.amount, 'labor_payment'::expense_category, v_cat, prj.project_id, prj.last_day,
      CASE WHEN prj.workers = 1 THEN prj.one_staff END,
      'pending'::expense_approval_status, 'unpaid', prj.first_day, prj.last_day)
    RETURNING id INTO v_exp;

    INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, overtime_hours, overtime_amount)
    SELECT v_exp, (x->>'staff_id')::uuid, (x->>'days')::numeric, (x->>'rate')::numeric, (x->>'amount')::numeric, 1,
           NULLIF((x->>'overtime_hours')::numeric, 0), NULLIF((x->>'overtime_amount')::numeric, 0)
      FROM jsonb_array_elements(v_lines) x;

    INSERT INTO labour_pay_sheets (code, labor_requisition_id, project_id, period_start, period_end, total, lines, expense_id,
      confirmed_by, confirmed_by_name, note, day_pay_run_id, pm_staff_id)
    VALUES ('LPS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_pay_sheet_seq')::text, 4, '0'),
      NULL, prj.project_id, prj.first_day, prj.last_day, prj.amount, v_lines, v_exp,
      auth.uid(), v_name, NULLIF(btrim(p_note), ''), v_run, p_pm);
  END LOOP;

  -- Piece jobs: each on its own payable, the same way as before.
  FOR job IN SELECT labor_requisition_id AS id FROM labour_day_job_costs(p_pm, p_to) GROUP BY 1 HAVING sum(amount) > 0 LOOP
    v_sheet := confirm_labour_pay(job.id, p_to, p_note);
    UPDATE labour_pay_sheets SET day_pay_run_id = v_run, pm_staff_id = p_pm WHERE id = v_sheet;
  END LOOP;

  UPDATE labour_day_pay_runs r
     SET total = (SELECT COALESCE(sum(ps.total), 0) FROM labour_pay_sheets ps WHERE ps.day_pay_run_id = v_run),
         lines = COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'worker_name', s.employee_name, 'days', x.days,
                                   'rate', x.rate, 'overtime_amount', x.ot, 'amount', x.amount) ORDER BY s.employee_name)
                             FROM (SELECT c.staff_id, sum(c.days) AS days, max(c.day_rate) AS rate, sum(c.overtime) AS ot, sum(c.amount) AS amount
                                     FROM labour_day_costs(p_pm, p_from, p_to) c WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL
                                    GROUP BY c.staff_id) x JOIN staff s ON s.id = x.staff_id), '[]'::jsonb)
                 || COALESCE((SELECT jsonb_agg(jsonb_build_object('job_id', ps.labor_requisition_id, 'worker_name', q.role_needed, 'amount', ps.total) ORDER BY q.role_needed)
                                FROM labour_pay_sheets ps JOIN labor_requisitions q ON q.id = ps.labor_requisition_id
                               WHERE ps.day_pay_run_id = v_run), '[]'::jsonb)
   WHERE r.id = v_run;

  UPDATE labour_day_workers w SET pay_run_id = v_run
    FROM labour_days d
   WHERE d.id = w.day_id AND d.pm_staff_id = p_pm AND d.status = 'locked' AND d.work_date <= p_to
     AND (p_from IS NULL OR d.work_date >= p_from) AND w.pay_run_id IS NULL;
  RETURN v_run;
END $function$;
REVOKE EXECUTE ON FUNCTION public.confirm_labour_day_pay(uuid, date, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_labour_day_pay(uuid, date, text, date) TO authenticated, service_role;

-- ── The PM's draft request for a week, made if there isn't one ──
CREATE OR REPLACE FUNCTION public.labour_week_request(p_pm uuid, p_week date, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v uuid; w date := labour_week_of(p_week);
BEGIN
  SELECT r.id INTO v FROM labour_pay_requests r
   WHERE r.prepared_for = p_pm AND r.week_of = w AND r.status = 'draft' ORDER BY r.created_at DESC LIMIT 1;
  IF v IS NULL THEN
    INSERT INTO labour_pay_requests (code, note, created_by, created_by_name, prepared_for, week_to, week_of)
    VALUES ('LPR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_pay_request_seq')::text, 4, '0'),
            'Week of ' || to_char(w, 'DD Mon') || ' – ' || to_char(w + 6, 'DD Mon YYYY') || COALESCE('. ' || NULLIF(btrim(p_note), '') || '.', ''),
            auth.uid(), COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), 'Kuncho (automatic)'), p_pm, w + 6, w)
    RETURNING id INTO v;
  ELSE
    UPDATE labour_pay_requests SET updated_at = now() WHERE id = v;
  END IF;
  RETURN v;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_request(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- ── Prepare one PM's week: its locked days, and nothing from other weeks ──
CREATE OR REPLACE FUNCTION public.labour_week_pay_prepare(p_pm uuid, p_week date, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  w date := labour_week_of(p_week); v_run uuid; v_req uuid; v_exp uuid[]; v_total numeric; v_workers int;
  v_note text := COALESCE(NULLIF(btrim(p_note), ''), CASE WHEN labour_is_system() THEN 'Prepared at the weekly cut-off' ELSE 'Prepared by hand' END);
BEGIN
  IF NOT (labour_day_can_run(p_pm) OR labour_is_system()) THEN RAISE EXCEPTION 'The PM prepares the pay for their own workers'; END IF;
  IF w > labour_week_of((now() AT TIME ZONE 'Africa/Addis_Ababa')::date) THEN RAISE EXCEPTION 'That week hasn''t started yet'; END IF;

  IF EXISTS (SELECT 1 FROM labour_days d JOIN labour_day_workers x ON x.day_id = d.id
              WHERE d.pm_staff_id = p_pm AND d.status = 'locked' AND d.work_date BETWEEN w AND w + 6 AND x.pay_run_id IS NULL)
     OR EXISTS (SELECT 1 FROM labour_day_job_costs(p_pm, w + 6) j HAVING sum(j.amount) > 0) THEN
    v_run := confirm_labour_day_pay(p_pm, w + 6, v_note, w);
  END IF;

  -- This week's payables not in a request yet: the run's, and any other of the PM's whose period ends this week.
  SELECT array_agg(DISTINCT x.expense_id) INTO v_exp
    FROM labour_payable_of(p_pm) x
    JOIN expenses e ON e.id = x.expense_id
    LEFT JOIN labour_pay_sheets ps ON ps.expense_id = e.id
   WHERE (v_run IS NOT NULL AND ps.day_pay_run_id = v_run)
      OR labour_week_of(COALESCE(e.rollup_period_end, e.date)) = w;

  IF v_exp IS NULL THEN
    SELECT r.id INTO v_req FROM labour_pay_requests r WHERE r.prepared_for = p_pm AND r.week_of = w AND r.status <> 'cancelled'
     ORDER BY r.created_at DESC LIMIT 1;
    IF v_req IS NULL THEN
      RAISE EXCEPTION 'Nothing to pay for the week of % — lock its days first', to_char(w, 'DD Mon');
    END IF;
  ELSE
    v_req := labour_week_request(p_pm, w, v_note);
    INSERT INTO labour_pay_request_items (request_id, expense_id) SELECT v_req, unnest(v_exp)
    ON CONFLICT (request_id, expense_id) DO UPDATE SET removed_at = NULL;
  END IF;

  SELECT COALESCE(sum(e.amount_etb), 0) INTO v_total FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
   WHERE i.request_id = v_req AND i.removed_at IS NULL;
  SELECT count(DISTINCT lw.staff_id) INTO v_workers FROM labour_pay_request_items i JOIN labor_expense_workers lw ON lw.expense_id = i.expense_id
   WHERE i.request_id = v_req AND i.removed_at IS NULL;
  RETURN jsonb_build_object('request_id', v_req, 'code', (SELECT code FROM labour_pay_requests WHERE id = v_req), 'week_of', w,
                            'added', COALESCE(cardinality(v_exp), 0), 'total', v_total, 'workers', v_workers,
                            'run_code', (SELECT code FROM labour_day_pay_runs WHERE id = v_run));
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_pay_prepare(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_pay_prepare(uuid, date, text) TO authenticated, service_role;

-- ── The cut-off: week by week, one request per PM per week ──
CREATE OR REPLACE FUNCTION public.labour_week_close(p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_pay_week_settings%ROWTYPE;
  v_system boolean := auth.uid() IS NULL;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_cut date; v_to date; pm record; q record; wk record; r jsonb;
  v_skipped text[]; v_ids uuid[]; v_req uuid;
  v_out jsonb := '[]'::jsonb; v_reqs uuid[];
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
    v_skipped := '{}'; v_reqs := '{}';
    -- 1. Each week with locked days or piece work not paid yet, oldest first: its own pay and request.
    FOR wk IN
      SELECT DISTINCT labour_week_of(d.work_date) AS w FROM labour_days d JOIN labour_day_workers x ON x.day_id = d.id
       WHERE d.pm_staff_id = pm.id AND d.status = 'locked' AND d.work_date <= v_to AND x.pay_run_id IS NULL
      UNION SELECT labour_week_of(max(j.work_date)) FROM labour_day_job_costs(pm.id, v_to) j HAVING sum(j.amount) > 0
      ORDER BY 1
    LOOP
      BEGIN
        r := labour_week_pay_prepare(pm.id, wk.w, v_note);
        v_reqs := v_reqs || (r->>'request_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || ('week of ' || to_char(wk.w, 'DD Mon') || ': ' || SQLERRM);
      END;
    END LOOP;
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
    -- 3. Anything else payable of theirs in no request yet: into the request of the week it ends in.
    FOR wk IN SELECT labour_week_of(COALESCE(e.rollup_period_end, e.date)) AS w, array_agg(x.expense_id) AS ids
                FROM labour_payable_of(pm.id) x JOIN expenses e ON e.id = x.expense_id GROUP BY 1 ORDER BY 1
    LOOP
      v_req := labour_week_request(pm.id, wk.w, v_note);
      INSERT INTO labour_pay_request_items (request_id, expense_id) SELECT v_req, unnest(wk.ids)
      ON CONFLICT (request_id, expense_id) DO UPDATE SET removed_at = NULL;
      v_reqs := v_reqs || v_req;
    END LOOP;

    IF cardinality(v_skipped) > 0 THEN
      v_out := v_out || jsonb_build_object('pm', pm.name, 'skipped', to_jsonb(v_skipped));
    END IF;
    FOR q IN
      SELECT rq.id, rq.code, rq.week_of,
             (SELECT COALESCE(sum(e.amount_etb), 0) FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
               WHERE i.request_id = rq.id AND i.removed_at IS NULL) AS total,
             (SELECT count(DISTINCT lw.staff_id) FROM labour_pay_request_items i JOIN labor_expense_workers lw ON lw.expense_id = i.expense_id
               WHERE i.request_id = rq.id AND i.removed_at IS NULL)::int AS workers
        FROM labour_pay_requests rq WHERE rq.id = ANY (SELECT DISTINCT unnest(v_reqs)) ORDER BY rq.week_of NULLS FIRST
    LOOP
      IF pm.user_id IS NOT NULL THEN
        PERFORM notify(ARRAY[pm.user_id], 'labour.week_ready',
          'Labour pay is ready to sign: ' || notify_etb(q.total) || CASE WHEN q.workers > 0 THEN ' for ' || q.workers || ' worker' || CASE WHEN q.workers = 1 THEN '' ELSE 's' END ELSE '' END,
          q.code || COALESCE(', week of ' || to_char(q.week_of, 'DD Mon'), '') || '. Attach the signed attendance sheet and send it to finance.',
          '/labour/requests/' || q.id, 'labour_pay_request', q.id, NULL, 'labour.week_ready:' || q.id || ':' || v_to, '{}'::jsonb, true);
      END IF;
      v_out := v_out || jsonb_build_object('pm', pm.name, 'request_id', q.id, 'code', q.code, 'week_of', q.week_of,
                                           'total', q.total, 'workers', q.workers, 'skipped', '[]'::jsonb);
    END LOOP;
  END LOOP;

  IF v_to = v_cut AND NOT (p_force AND NOT v_system) THEN
    UPDATE labour_pay_week_settings SET last_closed_to = v_cut, last_closed_at = now() WHERE id;
  END IF;
  RETURN jsonb_build_object('ran', true, 'to', v_to, 'requests', v_out);
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_close(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_close(boolean) TO authenticated, service_role;

-- ── Undo a week's pay while finance hasn't acted on it ──
-- Takes the week's payables out of their draft request, removes the pay run(s)
-- and payables, and (if asked) sends the days back to the PM. A pay run made
-- before 540 can cover several weeks; it comes back whole, and the result says
-- which days it covered.
CREATE OR REPLACE FUNCTION public.labour_week_pay_undo(p_pm uuid, p_week date, p_reason text, p_send_back boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  w date := labour_week_of(p_week);
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  v_runs uuid[]; v_exp uuid[]; v_reqs uuid[]; v_from date; v_to date; v_total numeric; v_codes text; v_bad text; v_back int := 0; d record;
BEGIN
  IF NOT labour_day_is_approver() THEN RAISE EXCEPTION 'Only admin, HR or operations undo a week''s pay'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why the week''s pay is undone'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('labour_day_pay:' || p_pm::text));

  SELECT array_agg(DISTINCT x.id) INTO v_runs FROM (
    SELECT lw.pay_run_id AS id FROM labour_day_workers lw JOIN labour_days dd ON dd.id = lw.day_id
     WHERE dd.pm_staff_id = p_pm AND dd.work_date BETWEEN w AND w + 6 AND lw.pay_run_id IS NOT NULL
    UNION SELECT ps.day_pay_run_id FROM labour_work_entries e JOIN labour_days dd ON dd.id = e.labour_day_id JOIN labour_pay_sheets ps ON ps.id = e.pay_sheet_id
     WHERE dd.pm_staff_id = p_pm AND dd.work_date BETWEEN w AND w + 6 AND ps.day_pay_run_id IS NOT NULL
    UNION SELECT r.id FROM labour_day_pay_runs r WHERE r.pm_staff_id = p_pm AND r.week_of = w) x;

  IF v_runs IS NULL THEN RAISE EXCEPTION 'The week of % has no pay to undo', to_char(w, 'DD Mon'); END IF;

  SELECT min(r.period_start), max(r.period_end), sum(r.total) INTO v_from, v_to, v_total FROM labour_day_pay_runs r WHERE r.id = ANY (v_runs);
  SELECT array_agg(ps.expense_id) INTO v_exp FROM labour_pay_sheets ps WHERE ps.day_pay_run_id = ANY (v_runs) AND ps.expense_id IS NOT NULL;
  v_exp := COALESCE(v_exp, '{}');

  IF EXISTS (SELECT 1 FROM expenses e WHERE e.id = ANY (v_exp)
              AND (COALESCE(e.payment_state, 'unpaid') <> 'unpaid' OR e.approval_status::text NOT IN ('pending', 'rejected'))) THEN
    RAISE EXCEPTION 'Finance has already approved or paid part of this week — ask finance to withdraw the approval first';
  END IF;
  SELECT string_agg(DISTINCT q.code, ', ') INTO v_bad FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
   WHERE i.expense_id = ANY (v_exp) AND i.removed_at IS NULL AND q.status NOT IN ('draft', 'returned', 'cancelled');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'This week''s pay is already with finance in % — ask finance to send it back first', v_bad; END IF;
  IF EXISTS (SELECT 1 FROM payment_requests pr WHERE pr.expense_id = ANY (v_exp))
     OR EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = ANY (v_exp)) THEN
    RAISE EXCEPTION 'This week''s pay is already on a payment request or batch — take it off first';
  END IF;

  -- Out of the draft requests; a draft left with nothing in it is cancelled.
  SELECT array_agg(DISTINCT i.request_id), string_agg(DISTINCT q.code, ', ') INTO v_reqs, v_codes
    FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
   WHERE i.expense_id = ANY (v_exp) AND i.removed_at IS NULL;
  UPDATE labour_pay_request_items SET removed_at = now() WHERE expense_id = ANY (v_exp) AND removed_at IS NULL;
  UPDATE labour_pay_request_deductions dd SET amount = 0 WHERE dd.request_id = ANY (COALESCE(v_reqs, '{}')) AND dd.amount > 0
     AND NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labor_expense_workers lw ON lw.expense_id = i.expense_id
                      WHERE i.request_id = dd.request_id AND i.removed_at IS NULL AND lw.staff_id = dd.staff_id);
  UPDATE labour_pay_requests q SET status = CASE WHEN EXISTS (SELECT 1 FROM labour_pay_request_items i WHERE i.request_id = q.id AND i.removed_at IS NULL)
                                                 THEN q.status ELSE 'cancelled' END,
         updated_at = now()
   WHERE q.id = ANY (COALESCE(v_reqs, '{}')) AND q.status IN ('draft', 'returned');

  -- The pay itself, as reopen_labour_day_pay does.
  UPDATE labour_day_workers SET pay_run_id = NULL WHERE pay_run_id = ANY (v_runs);
  DELETE FROM labour_pay_sheets WHERE day_pay_run_id = ANY (v_runs);
  DELETE FROM expenses WHERE id = ANY (v_exp);
  DELETE FROM labour_day_pay_runs WHERE id = ANY (v_runs);

  -- The days: noted, and back to the PM if asked.
  FOR d IN SELECT dd.id, dd.status FROM labour_days dd WHERE dd.pm_staff_id = p_pm AND dd.work_date BETWEEN COALESCE(v_from, w) AND COALESCE(v_to, w + 6) LOOP
    INSERT INTO labour_day_changes (day_id, kind, changed_by, changed_by_name, reason, before)
    VALUES (d.id, CASE WHEN p_send_back AND d.status <> 'open' THEN 'unlock' ELSE 'edit' END, auth.uid(), v_name,
            'Pay undone: ' || btrim(p_reason), labour_day_snapshot(d.id));
    IF p_send_back AND d.status <> 'open' THEN
      UPDATE labour_days SET status = 'open', locked_at = NULL, locked_by = NULL, locked_by_name = NULL, review_note = btrim(p_reason) WHERE id = d.id;
      v_back := v_back + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('runs', cardinality(v_runs), 'from', v_from, 'to', v_to, 'total', v_total, 'requests', v_codes, 'sent_back', v_back);
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_pay_undo(uuid, date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_pay_undo(uuid, date, text, boolean) TO authenticated, service_role;

-- ── One line per PM per week: what it costs, by site, and where it is ──
CREATE OR REPLACE FUNCTION public.labour_pay_weeks(p_from date, p_pm uuid DEFAULT NULL)
RETURNS TABLE(pm_staff_id uuid, pm_name text, week_of date, days_open integer, days_review integer, days_locked integer,
              amount numeric, to_prepare numeric, projects jsonb, requests jsonb, run_from date, run_to date, stage text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH f AS (SELECT labour_week_of(p_from) AS f),
  dy AS (
    SELECT d.id, d.pm_staff_id AS pm, labour_week_of(d.work_date) AS w, d.status
      FROM labour_days d, f
     WHERE d.work_date >= f.f AND (p_pm IS NULL OR d.pm_staff_id = p_pm) AND labour_day_can_see(d.pm_staff_id)
       AND (EXISTS (SELECT 1 FROM labour_day_workers x WHERE x.day_id = d.id) OR EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labour_day_id = d.id))
  ),
  money AS (   -- day workers and piece work on these days
    SELECT c.pm_staff_id AS pm, labour_week_of(c.work_date) AS w, c.project_id, c.amount,
           (c.day_status = 'locked' AND c.pay_run_id IS NULL) AS unpaid_locked
      FROM labour_day_costs(p_pm, (SELECT f FROM f), NULL) c WHERE c.day_id IN (SELECT id FROM dy)
    UNION ALL
    SELECT dd.pm_staff_id, labour_week_of(e.work_date), e.project_id,
           round(CASE r.payment_basis WHEN 'per_volume' THEN COALESCE(e.quantity, 0) * COALESCE(r.unit_rate, 0)
                      ELSE COALESCE(e.percent_done, 0) / 100 * COALESCE(r.fixed_price_amount, 0) END, 2),
           (dd.status = 'locked' AND e.pay_sheet_id IS NULL)
      FROM labour_work_entries e
      JOIN labor_requisitions r ON r.id = e.labor_requisition_id AND r.payment_basis IN ('per_volume', 'fixed_price')
      JOIN labour_days dd ON dd.id = e.labour_day_id
     WHERE dd.id IN (SELECT id FROM dy)
  ),
  runs AS (    -- pay runs holding these weeks' days
    SELECT DISTINCT dy.pm, dy.w, lw.pay_run_id AS run FROM dy JOIN labour_day_workers lw ON lw.day_id = dy.id WHERE lw.pay_run_id IS NOT NULL
    UNION SELECT dy.pm, dy.w, ps.day_pay_run_id FROM dy JOIN labour_work_entries e ON e.labour_day_id = dy.id JOIN labour_pay_sheets ps ON ps.id = e.pay_sheet_id
     WHERE ps.day_pay_run_id IS NOT NULL
  ),
  exps AS (    -- their payables (plus piece pay sheets made outside a run)
    SELECT runs.pm, runs.w, ps.expense_id FROM runs JOIN labour_pay_sheets ps ON ps.day_pay_run_id = runs.run WHERE ps.expense_id IS NOT NULL
    UNION SELECT dy.pm, dy.w, ps.expense_id FROM dy JOIN labour_work_entries e ON e.labour_day_id = dy.id JOIN labour_pay_sheets ps ON ps.id = e.pay_sheet_id
     WHERE ps.expense_id IS NOT NULL
  ),
  reqs AS (
    SELECT DISTINCT x.pm, x.w, q.id, q.code, q.status FROM exps x
      JOIN labour_pay_request_items i ON i.expense_id = x.expense_id AND i.removed_at IS NULL
      JOIN labour_pay_requests q ON q.id = i.request_id AND q.status <> 'cancelled'
  ),
  keys AS (SELECT DISTINCT pm, w FROM dy)
  SELECT k.pm, btrim(st.employee_name), k.w,
         (SELECT count(*)::int FROM dy WHERE dy.pm = k.pm AND dy.w = k.w AND dy.status = 'open'),
         (SELECT count(*)::int FROM dy WHERE dy.pm = k.pm AND dy.w = k.w AND dy.status = 'submitted'),
         (SELECT count(*)::int FROM dy WHERE dy.pm = k.pm AND dy.w = k.w AND dy.status = 'locked'),
         (SELECT COALESCE(sum(m.amount), 0) FROM money m WHERE m.pm = k.pm AND m.w = k.w),
         (SELECT COALESCE(sum(m.amount), 0) FROM money m WHERE m.pm = k.pm AND m.w = k.w AND m.unpaid_locked),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', y.project_id, 'name', p.project_name, 'amount', y.amount) ORDER BY y.amount DESC)
                     FROM (SELECT m.project_id, sum(m.amount) AS amount FROM money m WHERE m.pm = k.pm AND m.w = k.w GROUP BY 1 HAVING sum(m.amount) > 0) y
                     JOIN projects p ON p.id = y.project_id), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status,
                     'total', (SELECT COALESCE(sum(e.amount_etb), 0) FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
                                WHERE i.request_id = r.id AND i.removed_at IS NULL)) ORDER BY r.code)
                     FROM reqs r WHERE r.pm = k.pm AND r.w = k.w), '[]'::jsonb),
         (SELECT min(pr.period_start) FROM runs JOIN labour_day_pay_runs pr ON pr.id = runs.run WHERE runs.pm = k.pm AND runs.w = k.w),
         (SELECT max(pr.period_end) FROM runs JOIN labour_day_pay_runs pr ON pr.id = runs.run WHERE runs.pm = k.pm AND runs.w = k.w),
         CASE
           WHEN EXISTS (SELECT 1 FROM dy WHERE dy.pm = k.pm AND dy.w = k.w AND dy.status <> 'locked') THEN 'days'
           WHEN EXISTS (SELECT 1 FROM money m WHERE m.pm = k.pm AND m.w = k.w AND m.unpaid_locked AND m.amount > 0) THEN 'prepare'
           WHEN NOT EXISTS (SELECT 1 FROM exps x WHERE x.pm = k.pm AND x.w = k.w) THEN 'nothing'
           WHEN NOT EXISTS (SELECT 1 FROM exps x JOIN expenses e ON e.id = x.expense_id
                             WHERE x.pm = k.pm AND x.w = k.w AND COALESCE(e.payment_state, 'unpaid') <> 'paid') THEN 'paid'
           WHEN EXISTS (SELECT 1 FROM reqs r WHERE r.pm = k.pm AND r.w = k.w AND r.status IN ('draft', 'returned'))
             OR EXISTS (SELECT 1 FROM exps x WHERE x.pm = k.pm AND x.w = k.w
                         AND NOT EXISTS (SELECT 1 FROM reqs r JOIN labour_pay_request_items i ON i.request_id = r.id AND i.removed_at IS NULL
                                          WHERE i.expense_id = x.expense_id)) THEN 'send'
           ELSE 'finance'
         END
    FROM keys k JOIN staff st ON st.id = k.pm
   ORDER BY k.w DESC, st.employee_name;
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_pay_weeks(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_pay_weeks(date, uuid) TO authenticated, service_role;
