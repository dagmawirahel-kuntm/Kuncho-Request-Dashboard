-- 515 — labour gives something back to the people who record it
--
-- Recording was a duty with nothing in it for the recorder: attendance was
-- typed days late (7 entries in 10), pay sat between three screens (ETB
-- 196,337 confirmed and in no request), and neither the worker nor the site
-- manager saw anything come of a day being recorded.
--
--   labour_pay_week_settings   the pay-day promise: recorded by the cut-off,
--                              paid on pay day. Off until someone sets it.
--   labour_week_pay_sites()    per site: what is recorded and not confirmed,
--                              and confirmed and in no request.
--   labour_send_week_pay()     one tap by the site manager: confirms what is
--                              recorded on the site and puts everything
--                              payable into one draft payment request, to
--                              check, sign and send.
--   labour_site_pulse()        after saving a day: this week's labour on the
--                              site, last week's, the total against the
--                              labour budget, and what volume work produced.
--   labour_site_slips()        each worker's week on a site, as lines and as
--                              a message ready to share with them.
--   labour_worker_push()       evening: tells workers linked to the bot what
--                              was recorded for them since the last time.
--   labour_worker_history()    a worker's record: days, sites, trades, last
--                              worked, rate.
--
-- All of it reads the three ways of paying alike: by the day (hours), by the
-- piece (quantity) and at a fixed price (% of the task, recorded for the job
-- and belonging to whoever is paid for it).

-- ── The pay week ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.labour_pay_week_settings (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled         boolean NOT NULL DEFAULT false,
  cutoff_dow      integer NOT NULL DEFAULT 6 CHECK (cutoff_dow BETWEEN 0 AND 6),    -- Saturday
  cutoff_hour     integer NOT NULL DEFAULT 18 CHECK (cutoff_hour BETWEEN 0 AND 23), -- 6 pm in Addis
  pay_dow         integer NOT NULL DEFAULT 2 CHECK (pay_dow BETWEEN 0 AND 6),       -- Tuesday
  updated_at      timestamptz,
  updated_by      uuid,
  updated_by_name text
);
INSERT INTO public.labour_pay_week_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.labour_pay_week_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'labour_pay_week_settings' AND policyname = 'labour_pay_week_read') THEN
    CREATE POLICY labour_pay_week_read ON public.labour_pay_week_settings FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
GRANT SELECT ON public.labour_pay_week_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.set_labour_pay_week(p_enabled boolean, p_cutoff_dow integer, p_cutoff_hour integer, p_pay_dow integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT (COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()) THEN
    RAISE EXCEPTION 'Only admin or operations can set the pay week';
  END IF;
  UPDATE labour_pay_week_settings
     SET enabled = COALESCE(p_enabled, enabled), cutoff_dow = COALESCE(p_cutoff_dow, cutoff_dow),
         cutoff_hour = COALESCE(p_cutoff_hour, cutoff_hour), pay_dow = COALESCE(p_pay_dow, pay_dow),
         updated_at = now(), updated_by = auth.uid(), updated_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid())
   WHERE id;
END $f$;
REVOKE EXECUTE ON FUNCTION public.set_labour_pay_week(boolean, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_labour_pay_week(boolean, integer, integer, integer) TO authenticated;

-- ── Whose work, and in what words ───────────────────────────────────────────
-- Three ways of paying, one record. Day work and piece work name the worker.
-- A fixed-price task (and a crew's piece work) is recorded for the job, with
-- no name on it: it belongs to whoever is paid for it, the first worker on
-- the request, exactly as confirm_labour_pay pays it.
CREATE OR REPLACE FUNCTION public.labour_entry_worker(p_req uuid, p_staff uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $f$
  SELECT COALESCE(p_staff, (SELECT a.staff_id FROM labor_allocations a WHERE a.labor_requisition_id = p_req
                             ORDER BY (a.status = 'active') DESC, a.created_at LIMIT 1))
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_entry_worker(uuid, uuid) FROM PUBLIC, anon;

-- 46, 46.5, 1,200: a number as someone would write it.
CREATE OR REPLACE FUNCTION public.labour_num(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(to_char(COALESCE(p, 0), 'FM999,999,990.00'), '\.?0+$', '')
$f$;

-- "1 day", "Gypsum board, 46 m²", "Electrician, 40% of the task".
CREATE OR REPLACE FUNCTION public.labour_entry_words(p_job text, p_basis text, p_hours numeric, p_ot numeric, p_qty numeric, p_unit text, p_pct numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_basis = 'per_volume' OR (p_basis IS NULL AND COALESCE(p_hours, 0) = 0 AND COALESCE(p_qty, 0) > 0)
                THEN COALESCE(NULLIF(btrim(p_job), '') || ', ', '') || labour_num(p_qty) || ' ' || COALESCE(NULLIF(btrim(p_unit), ''), 'units')
              WHEN p_basis = 'fixed_price' THEN COALESCE(NULLIF(btrim(p_job), '') || ', ', '') || labour_num(p_pct) || '% of the task'
              WHEN COALESCE(p_hours, 0) = 8 THEN '1 day' WHEN COALESCE(p_hours, 0) = 4 THEN 'half a day'
              ELSE labour_num(p_hours) || ' hours' END
      || CASE WHEN COALESCE(p_ot, 0) > 0 THEN ' + ' || labour_num(p_ot) || ' h overtime' ELSE '' END
$f$;

-- ── One tap: the week's pay for a site ──────────────────────────────────────
-- What a tap would send, site by site, for the sites this person runs.
-- "crews" are jobs with pay waiting and nobody named on them.
CREATE OR REPLACE FUNCTION public.labour_week_pay_sites(p_to date DEFAULT NULL)
RETURNS TABLE(project_id uuid, project_name text, to_confirm integer, to_confirm_amount numeric, confirmed integer,
              confirmed_amount numeric, workers integer, first_day date, last_day date, unverified integer, crews integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_to date := COALESCE(p_to, bot_today());
  v_all boolean := COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager();
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH sites AS (
    SELECT p.id, btrim(p.project_name) AS name FROM projects p WHERE v_all OR manages_project(p.id)
  ), rl AS MATERIALIZED (    -- recorded, not confirmed: a row per worker (or task) per request
    SELECT u.project_id AS pid, u.labor_requisition_id AS req, u.first_day AS d1, u.last_day AS d2, x.staff_id AS sid, x.amount AS amt
      FROM v_labour_unpaid u
      CROSS JOIN LATERAL labour_pay_lines(u.labor_requisition_id, v_to) x
     WHERE u.project_id IN (SELECT s.id FROM sites s) AND u.first_day <= v_to
  ), rec AS (
    SELECT rl.pid, rl.req, min(rl.d1) AS d1, max(rl.d2) AS d2, sum(rl.amt) AS amt
      FROM rl GROUP BY rl.pid, rl.req HAVING sum(rl.amt) > 0
  ), conf AS MATERIALIZED (  -- confirmed, in no payment request
    SELECT d.expense_id AS eid, d.project_id AS pid, d.amount AS amt, d.unverified AS unv, d.period_start AS d1, d.period_end AS d2
      FROM labour_payable_drafts() d WHERE d.project_id IN (SELECT s.id FROM sites s)
  ), ppl AS (                -- a worker counts once on a site, however many sheets they are on
    SELECT rl.pid, labour_entry_worker(rl.req, rl.sid) AS sid, rl.req::text AS job, false AS chk
      FROM rl JOIN rec ON rec.req = rl.req WHERE rl.amt > 0
    UNION ALL
    SELECT c.pid, w.staff_id, c.eid::text, c.unv > 0 FROM conf c LEFT JOIN labor_expense_workers w ON w.expense_id = c.eid
  )
  SELECT s.id, s.name,
    (SELECT count(*) FROM rec r WHERE r.pid = s.id)::int,
    COALESCE((SELECT sum(r.amt) FROM rec r WHERE r.pid = s.id), 0),
    (SELECT count(*) FROM conf c WHERE c.pid = s.id)::int,
    COALESCE((SELECT sum(c.amt) FROM conf c WHERE c.pid = s.id), 0),
    (SELECT count(DISTINCT x.sid) FROM ppl x WHERE x.pid = s.id)::int,
    LEAST((SELECT min(r.d1) FROM rec r WHERE r.pid = s.id), (SELECT min(c.d1) FROM conf c WHERE c.pid = s.id)),
    GREATEST((SELECT max(r.d2) FROM rec r WHERE r.pid = s.id), (SELECT max(c.d2) FROM conf c WHERE c.pid = s.id)),
    (SELECT count(DISTINCT x.sid) FROM ppl x JOIN staff st ON st.id = x.sid WHERE x.pid = s.id AND x.chk AND st.verified_at IS NULL)::int,
    (SELECT count(DISTINCT x.job) FROM ppl x WHERE x.pid = s.id AND x.sid IS NULL)::int
  FROM sites s
  WHERE EXISTS (SELECT 1 FROM rec r WHERE r.pid = s.id) OR EXISTS (SELECT 1 FROM conf c WHERE c.pid = s.id)
  ORDER BY 2;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_pay_sites(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_pay_sites(date) TO authenticated;

-- Confirm what is recorded on the site up to p_to, then put everything
-- payable on it into one draft payment request. The site manager presses
-- it (so the confirmation is theirs), then checks, signs and sends.
CREATE OR REPLACE FUNCTION public.labour_send_week_pay(p_project uuid, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_to date := COALESCE(p_to, bot_today());
  u record; v_confirmed integer := 0; v_skipped text[] := '{}';
  v_ids uuid[]; v_total numeric; v_req uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (manages_project(p_project) OR COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()) THEN
    RAISE EXCEPTION 'The project manager sends the pay for their site';
  END IF;
  FOR u IN SELECT x.labor_requisition_id, x.role_needed FROM v_labour_unpaid x WHERE x.project_id = p_project AND x.first_day <= v_to LOOP
    BEGIN
      PERFORM confirm_labour_pay(u.labor_requisition_id, v_to, 'Confirmed with the week''s pay');
      v_confirmed := v_confirmed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped || (u.role_needed || ': ' || SQLERRM);
    END;
  END LOOP;
  SELECT array_agg(d.expense_id), sum(d.amount) INTO v_ids, v_total FROM labour_payable_drafts() d WHERE d.project_id = p_project;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION '%', CASE WHEN cardinality(v_skipped) > 0 THEN 'Nothing could be put in a request. ' || array_to_string(v_skipped, '; ')
                              ELSE 'Nothing recorded on this site is waiting to be paid' END;
  END IF;
  v_req := create_labour_pay_request(v_ids, NULL);
  RETURN jsonb_build_object('request_id', v_req, 'code', (SELECT code FROM labour_pay_requests WHERE id = v_req),
                            'confirmed', v_confirmed, 'sheets', cardinality(v_ids), 'total', v_total, 'skipped', to_jsonb(v_skipped));
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_send_week_pay(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_send_week_pay(uuid, date) TO authenticated;

-- ── The site's pulse ────────────────────────────────────────────────────────
-- "output" is what the jobs paid by the piece or at a fixed price produced:
-- quantity against the amount asked for, or % of the task against 100.
CREATE OR REPLACE FUNCTION public.labour_site_pulse(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_today date := bot_today(); v_mon date;
BEGIN
  IF auth.uid() IS NULL OR NOT labour_can_see_costs(p_project) THEN RETURN NULL; END IF;
  v_mon := v_today - (extract(isodow FROM v_today)::int - 1);
  RETURN (
    WITH c AS MATERIALIZED (
      SELECT x.*, labour_entry_worker(x.labor_requisition_id, x.staff_id) AS sid FROM labour_entry_costs(p_project, NULL) x
    )
    SELECT jsonb_build_object(
      'week_start', v_mon,
      'week_cost', COALESCE((SELECT sum(c.cost) FROM c WHERE c.work_date >= v_mon), 0),
      'week_workers', (SELECT count(DISTINCT c.sid) FROM c WHERE c.work_date >= v_mon AND c.cost > 0),
      'week_days', COALESCE((SELECT round(sum(COALESCE(c.hours, 0)) / 8, 1) FROM c WHERE c.work_date >= v_mon), 0),
      'last_week_cost', COALESCE((SELECT sum(c.cost) FROM c WHERE c.work_date >= v_mon - 7 AND c.work_date < v_mon), 0),
      'total_cost', COALESCE((SELECT sum(c.cost) FROM c), 0),
      'budget', (SELECT sum(pb.budgeted_amount) FROM project_budgets pb
                   JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
                   JOIN cost_groups g ON g.id = pb.cost_group_id AND g.name = 'Labor'
                  WHERE pb.project_id = p_project),
      'output', COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.week DESC, o.role) FROM (
                   SELECT q.role_needed AS role, q.payment_basis AS basis,
                          CASE WHEN q.payment_basis = 'per_volume' THEN q.volume_unit ELSE '%' END AS unit,
                          CASE WHEN q.payment_basis = 'per_volume' THEN q.estimated_total_volume ELSE 100 END AS planned,
                          COALESCE(sum(m.v) FILTER (WHERE c.work_date >= v_mon), 0) AS week,
                          COALESCE(sum(m.v) FILTER (WHERE c.work_date >= v_mon - 7 AND c.work_date < v_mon), 0) AS last_week,
                          COALESCE(sum(m.v), 0) AS total
                     FROM c JOIN labor_requisitions q ON q.id = c.labor_requisition_id AND q.payment_basis IN ('per_volume', 'fixed_price')
                     CROSS JOIN LATERAL (SELECT CASE WHEN q.payment_basis = 'per_volume' THEN c.quantity ELSE c.percent_done END AS v) m
                    GROUP BY q.id
                   HAVING COALESCE(sum(m.v) FILTER (WHERE c.work_date >= v_mon - 7), 0) > 0) o), '[]'::jsonb)));
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_site_pulse(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_site_pulse(uuid) TO authenticated;

-- ── Each worker's week ──────────────────────────────────────────────────────
-- Lines, a total, and the words to send them, whatever they are paid by: days,
-- quantity, or % of a task. On one site, or on several at once (a PM's day
-- sheet covers all of theirs). A job with nobody on it to name gets a row of
-- its own. "linked" says the bot will tell them itself; "crew" is how many
-- people share what was recorded for a crew.
CREATE OR REPLACE FUNCTION public.labour_site_slips(p_project uuid, p_week_of date DEFAULT NULL, p_projects uuid[] DEFAULT NULL)
RETURNS TABLE(staff_id uuid, name text, phone text, linked boolean, crew integer, summary text, amount numeric, lines jsonb, message text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_day date := COALESCE(p_week_of, bot_today()); v_mon date; v_set uuid[]; v_site text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT array_agg(p.id) INTO v_set FROM projects p
   WHERE p.id = ANY (COALESCE(p_projects, ARRAY[p_project])) AND (can_run_labour_site(p.id) OR labour_can_see_costs(p.id));
  IF v_set IS NULL THEN RETURN; END IF;
  v_mon := v_day - (extract(isodow FROM v_day)::int - 1);
  -- With one site its name goes in the opening line; with several, on each line.
  v_site := CASE WHEN cardinality(v_set) = 1 THEN (SELECT btrim(project_name) FROM projects WHERE id = v_set[1]) END;
  RETURN QUERY
  WITH c AS MATERIALIZED (
    SELECT labour_entry_worker(x.labor_requisition_id, x.staff_id) AS sid, x.labor_requisition_id AS req,
           CASE WHEN x.staff_id IS NULL THEN (SELECT count(DISTINCT a.staff_id) FROM labor_allocations a
                                               WHERE a.labor_requisition_id = x.labor_requisition_id AND a.status = 'active') ELSE 0 END AS crew_n,
           x.work_date, x.hours, x.overtime_hours, x.quantity, x.percent_done, x.cost, q.role_needed, btrim(pr.project_name) AS site,
           COALESCE(q.payment_basis, CASE WHEN COALESCE(x.hours, 0) = 0 AND COALESCE(x.quantity, 0) > 0 THEN 'per_volume' ELSE 'per_day' END) AS basis,
           COALESCE(NULLIF(btrim(q.volume_unit), ''), 'units') AS unit
      FROM labour_entry_costs(CASE WHEN cardinality(v_set) = 1 THEN v_set[1] END, NULL) x
      LEFT JOIN labor_requisitions q ON q.id = x.labor_requisition_id
      LEFT JOIN projects pr ON pr.id = x.project_id
     WHERE x.project_id = ANY (v_set) AND x.work_date BETWEEN v_mon AND v_mon + 6
       AND (COALESCE(x.hours, 0) > 0 OR COALESCE(x.overtime_hours, 0) > 0 OR COALESCE(x.quantity, 0) > 0 OR COALESCE(x.percent_done, 0) > 0)
  ), who AS (    -- a worker; or, with nobody on the request to name, the job itself
    SELECT c.*, COALESCE(c.sid::text, 'job:' || COALESCE(c.req::text, '')) AS k FROM c
  ), part AS (   -- the week in a few words: days, each unit of piece work, each task
    SELECT w.k, CASE w.basis WHEN 'per_day' THEN 1 WHEN 'per_volume' THEN 2 ELSE 3 END AS ord,
           CASE w.basis
             WHEN 'per_day' THEN NULLIF(concat_ws(' + ',
                    CASE WHEN sum(COALESCE(w.hours, 0)) > 0 THEN labour_num(round(sum(COALESCE(w.hours, 0)) / 8, 2)) || CASE WHEN sum(COALESCE(w.hours, 0)) = 8 THEN ' day' ELSE ' days' END END,
                    CASE WHEN sum(COALESCE(w.overtime_hours, 0)) > 0 THEN labour_num(sum(COALESCE(w.overtime_hours, 0))) || ' h overtime' END), '')
             WHEN 'per_volume' THEN labour_num(sum(COALESCE(w.quantity, 0))) || ' ' || max(w.unit)
             ELSE COALESCE(max(w.role_needed) || ' ', '') || labour_num(sum(COALESCE(w.percent_done, 0))) || '%' END AS words
      FROM who w
     GROUP BY w.k, w.basis, CASE WHEN w.basis = 'per_volume' THEN w.unit END, CASE WHEN w.basis = 'fixed_price' THEN w.req END
  ), per AS (
    SELECT w.k, max(w.sid::text)::uuid AS sid, max(w.role_needed) AS job, max(w.site) AS site, max(w.crew_n) AS crew_n, sum(w.cost) AS amt,
           jsonb_agg(jsonb_build_object('date', w.work_date, 'site', w.site, 'what', w.role_needed, 'basis', w.basis, 'days', round(COALESCE(w.hours, 0) / 8, 2),
                     'overtime_hours', NULLIF(w.overtime_hours, 0), 'quantity', NULLIF(w.quantity, 0), 'unit', CASE WHEN w.basis = 'per_volume' THEN w.unit END,
                     'percent_done', NULLIF(w.percent_done, 0), 'amount', round(w.cost, 2)) ORDER BY w.work_date) AS ls,
           string_agg(to_char(w.work_date, 'Dy DD Mon') || ': ' || CASE WHEN v_site IS NULL THEN COALESCE(w.site || ', ', '') ELSE '' END
                      || labour_entry_words(CASE WHEN w.basis <> 'per_day' THEN w.role_needed END, w.basis, w.hours, w.overtime_hours, w.quantity, w.unit, w.percent_done)
                      || ' · ' || bot_birr(round(w.cost, 2)), E'\n' ORDER BY w.work_date) AS txt
      FROM who w GROUP BY w.k
  )
  SELECT p.sid, COALESCE(btrim(s.employee_name), p.job, 'Crew'), NULLIF(btrim(COALESCE(s.phone_number, '')), ''),
         p.sid IS NOT NULL AND bot_chat_of_staff(p.sid) IS NOT NULL, p.crew_n::int,
         (SELECT string_agg(t.words, ' + ' ORDER BY t.ord, t.words) FROM part t WHERE t.k = p.k),
         round(p.amt, 2), p.ls,
         CASE WHEN p.sid IS NULL THEN COALESCE(p.job, 'Crew') || ' at ' || COALESCE(p.site, 'site') || ': this is what is recorded for the crew, '
              ELSE btrim(s.employee_name) || ', this is what is recorded for you' || CASE WHEN p.crew_n > 1 THEN ' and your crew (' || p.crew_n || ' people)' ELSE '' END
                   || CASE WHEN v_site IS NOT NULL THEN ' at ' || v_site ELSE '' END || ', ' END
           || to_char(v_mon, 'DD Mon') || ' to ' || to_char(v_mon + 6, 'DD Mon') || E':\n' || p.txt
           || E'\nTotal: ' || bot_birr(round(p.amt, 2)) || E'\nIf something is missing or wrong, tell your site manager.'
    FROM per p LEFT JOIN staff s ON s.id = p.sid
   ORDER BY (p.sid IS NULL), 2;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_site_slips(uuid, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_site_slips(uuid, date, uuid[]) TO authenticated;

-- Workers linked to the bot hear in the evening what was recorded for them
-- since the last time (whichever day it was worked): on a request by the
-- day, by the piece or as part of a task, or on a day sheet.
CREATE TABLE IF NOT EXISTS public.labour_worker_notice (
  staff_id     uuid PRIMARY KEY REFERENCES public.staff(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.labour_worker_notice ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.labour_worker_push()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE w record; v_n integer := 0; v_mon date := bot_today() - (extract(isodow FROM bot_today())::int - 1);
BEGIN
  IF auth.uid() IS NOT NULL AND COALESCE(get_user_role()::text, '') <> 'admin' THEN
    RAISE EXCEPTION 'Only admin can send the workers'' messages by hand';
  END IF;
  IF NOT bot_ready() THEN RETURN 0; END IF;
  FOR w IN
    WITH c AS MATERIALIZED (
      SELECT x.source, x.entry_id, labour_entry_worker(x.labor_requisition_id, x.staff_id) AS sid, x.work_date, x.project_id,
             x.hours, x.overtime_hours, x.quantity, x.percent_done, x.cost, q.role_needed, q.payment_basis, q.volume_unit
        FROM labour_entry_costs(NULL, NULL) x LEFT JOIN labor_requisitions q ON q.id = x.labor_requisition_id
    ), touched AS (   -- recorded on a request, or saved on a day sheet, in the last week
      SELECT 'day'::text AS source, e.id AS entry_id, NULL::uuid AS sid, NULL::date AS work_date, e.recorded_at AS at
        FROM labour_work_entries e WHERE e.recorded_at > now() - interval '7 days'
      UNION ALL
      SELECT 'sheet', NULL, dw.staff_id, d.work_date, COALESCE(d.saved_at, d.created_at)
        FROM labour_days d JOIN labour_day_workers dw ON dw.day_id = d.id
       WHERE COALESCE(d.saved_at, d.created_at) > now() - interval '7 days'
    ), fresh AS (
      SELECT DISTINCT ON (c.source, c.entry_id) c.*
        FROM touched t
        JOIN c ON c.source = t.source AND ((t.source = 'day' AND c.entry_id = t.entry_id)
                                        OR (t.source = 'sheet' AND c.sid = t.sid AND c.work_date = t.work_date))
       WHERE c.sid IS NOT NULL
         AND (COALESCE(c.hours, 0) > 0 OR COALESCE(c.overtime_hours, 0) > 0 OR COALESCE(c.quantity, 0) > 0 OR COALESCE(c.percent_done, 0) > 0)
         AND t.at > COALESCE((SELECT n.last_sent_at FROM labour_worker_notice n WHERE n.staff_id = c.sid), now() - interval '26 hours')
       ORDER BY c.source, c.entry_id
    )
    SELECT f.sid AS staff_id, bot_chat_of_staff(f.sid) AS chat,
           string_agg(to_char(f.work_date, 'Dy DD Mon') || ' · ' || bot_esc(COALESCE(btrim(p.project_name), 'site')) || ' · '
                      || bot_esc(labour_entry_words(CASE WHEN f.payment_basis IN ('per_volume', 'fixed_price') THEN f.role_needed END,
                                                    f.payment_basis, f.hours, f.overtime_hours, f.quantity, f.volume_unit, f.percent_done))
                      || ' · ' || bot_birr(round(f.cost, 2)), E'\n' ORDER BY f.work_date) AS txt,
           (SELECT COALESCE(sum(k.cost), 0) FROM c k WHERE k.sid = f.sid AND k.work_date >= v_mon) AS week
      FROM fresh f LEFT JOIN projects p ON p.id = f.project_id
     GROUP BY f.sid
  LOOP
    CONTINUE WHEN w.chat IS NULL;
    PERFORM bot_queue(bot_msg(w.chat,
      E'✅ <b>Recorded for you</b>\n' || w.txt || E'\n\nThis week so far: <b>' || bot_birr(round(w.week, 2)) || E'</b>\nMissing or wrong? Tell your site manager.'));
    INSERT INTO labour_worker_notice (staff_id, last_sent_at) VALUES (w.staff_id, now())
    ON CONFLICT (staff_id) DO UPDATE SET last_sent_at = now();
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_worker_push() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_worker_push() TO authenticated;

-- ── A worker's record ───────────────────────────────────────────────────────
-- Days for day work, quantity for piece work, tasks for fixed-price work.
CREATE OR REPLACE FUNCTION public.labour_worker_history(p_staff uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_money boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF NOT (COALESCE(get_user_role()::text IN ('admin', 'executive', 'finance', 'hr_officer', 'operations_manager', 'project_manager'), false)
          OR is_ops_manager()
          OR EXISTS (SELECT 1 FROM labor_allocations a JOIN labor_requisitions q ON q.id = a.labor_requisition_id
                      WHERE a.staff_id = p_staff AND can_run_labour_site(q.project_id))) THEN
    RETURN NULL;
  END IF;
  v_money := COALESCE(get_user_role()::text IN ('admin', 'executive', 'finance', 'hr_officer', 'operations_manager', 'project_manager'), false) OR is_ops_manager();
  RETURN (
    WITH c AS MATERIALIZED (
      SELECT x.work_date, x.project_id, x.hours, x.quantity, x.percent_done, x.cost, x.labor_requisition_id AS req, q.role_needed,
             COALESCE(q.payment_basis, CASE WHEN COALESCE(x.hours, 0) = 0 AND COALESCE(x.quantity, 0) > 0 THEN 'per_volume' ELSE 'per_day' END) AS basis,
             COALESCE(NULLIF(btrim(q.volume_unit), ''), 'units') AS unit
        FROM labour_entry_costs(NULL, NULL) x LEFT JOIN labor_requisitions q ON q.id = x.labor_requisition_id
       WHERE x.staff_id = p_staff OR (x.staff_id IS NULL AND labour_entry_worker(x.labor_requisition_id, NULL) = p_staff)
    )
    SELECT jsonb_build_object(
      'name', btrim(s.employee_name), 'phone', NULLIF(btrim(COALESCE(s.phone_number, '')), ''), 'trade', s.trade_tag,
      'verified', s.verified_at IS NOT NULL, 'linked', bot_chat_of_staff(s.id) IS NOT NULL,
      'first_day', (SELECT min(c.work_date) FROM c), 'last_day', (SELECT max(c.work_date) FROM c),
      'days', COALESCE((SELECT round(sum(COALESCE(c.hours, 0)) / 8, 1) FROM c WHERE c.basis = 'per_day'), 0),
      'days_recorded', (SELECT count(DISTINCT c.work_date) FROM c),
      'piece', COALESCE((SELECT jsonb_agg(jsonb_build_object('unit', u.unit, 'qty', u.qty) ORDER BY u.qty DESC)
                           FROM (SELECT c.unit, sum(COALESCE(c.quantity, 0)) AS qty FROM c WHERE c.basis = 'per_volume' GROUP BY c.unit) u), '[]'::jsonb),
      'tasks', (SELECT count(DISTINCT c.req) FROM c WHERE c.basis = 'fixed_price'),
      'earned', CASE WHEN v_money THEN COALESCE((SELECT round(sum(c.cost), 2) FROM c), 0) END,
      'day_rate', CASE WHEN v_money THEN (SELECT a.day_rate_snapshot FROM labor_allocations a WHERE a.staff_id = p_staff AND a.day_rate_snapshot IS NOT NULL
                                           ORDER BY a.created_at DESC LIMIT 1) END,
      'on_site_now', (SELECT string_agg(DISTINCT btrim(p.project_name), ', ') FROM labor_allocations a JOIN labor_requisitions q ON q.id = a.labor_requisition_id
                        JOIN projects p ON p.id = q.project_id WHERE a.staff_id = p_staff AND a.status = 'active' AND q.closed_at IS NULL),
      'sites', COALESCE((SELECT jsonb_agg(to_jsonb(z) ORDER BY z.last_day DESC) FROM (
                  SELECT btrim(p.project_name) AS project, count(DISTINCT c.work_date) AS days, max(c.work_date) AS last_day,
                         string_agg(DISTINCT c.role_needed, ', ') AS work
                    FROM c JOIN projects p ON p.id = c.project_id GROUP BY p.id) z), '[]'::jsonb))
      FROM staff s WHERE s.id = p_staff);
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_worker_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_worker_history(uuid) TO authenticated;

-- 6:30 pm in Addis, every day.
SELECT cron.schedule('kuncho-labour-worker-push', '30 15 * * *', 'SELECT public.labour_worker_push()');
