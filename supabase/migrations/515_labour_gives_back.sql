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

-- ── One tap: the week's pay for a site ──────────────────────────────────────
-- What a tap would send, site by site, for the sites this person runs.
CREATE OR REPLACE FUNCTION public.labour_week_pay_sites(p_to date DEFAULT NULL)
RETURNS TABLE(project_id uuid, project_name text, to_confirm integer, to_confirm_amount numeric, confirmed integer,
              confirmed_amount numeric, workers integer, first_day date, last_day date, unverified integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_to date := COALESCE(p_to, bot_today());
  v_all boolean := COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager();
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH sites AS (
    SELECT p.id, btrim(p.project_name) AS name FROM projects p WHERE v_all OR manages_project(p.id)
  ), rl AS MATERIALIZED (    -- recorded, not confirmed: a row per worker per request
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
    SELECT rl.pid, rl.sid, false AS chk FROM rl JOIN rec ON rec.req = rl.req WHERE rl.amt > 0
    UNION ALL
    SELECT c.pid, w.staff_id, c.unv > 0 FROM conf c JOIN labor_expense_workers w ON w.expense_id = c.eid
  )
  SELECT s.id, s.name,
    (SELECT count(*) FROM rec r WHERE r.pid = s.id)::int,
    COALESCE((SELECT sum(r.amt) FROM rec r WHERE r.pid = s.id), 0),
    (SELECT count(*) FROM conf c WHERE c.pid = s.id)::int,
    COALESCE((SELECT sum(c.amt) FROM conf c WHERE c.pid = s.id), 0),
    (SELECT count(DISTINCT COALESCE(x.sid::text, 'unnamed')) FROM ppl x WHERE x.pid = s.id)::int,
    LEAST((SELECT min(r.d1) FROM rec r WHERE r.pid = s.id), (SELECT min(c.d1) FROM conf c WHERE c.pid = s.id)),
    GREATEST((SELECT max(r.d2) FROM rec r WHERE r.pid = s.id), (SELECT max(c.d2) FROM conf c WHERE c.pid = s.id)),
    (SELECT count(DISTINCT x.sid) FROM ppl x JOIN staff st ON st.id = x.sid WHERE x.pid = s.id AND x.chk AND st.verified_at IS NULL)::int
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
CREATE OR REPLACE FUNCTION public.labour_site_pulse(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_today date := bot_today(); v_mon date;
BEGIN
  IF auth.uid() IS NULL OR NOT labour_can_see_costs(p_project) THEN RETURN NULL; END IF;
  v_mon := v_today - (extract(isodow FROM v_today)::int - 1);
  RETURN (
    WITH c AS MATERIALIZED (SELECT * FROM labour_entry_costs(p_project, NULL))
    SELECT jsonb_build_object(
      'week_start', v_mon,
      'week_cost', COALESCE((SELECT sum(c.cost) FROM c WHERE c.work_date >= v_mon), 0),
      'week_workers', (SELECT count(DISTINCT c.staff_id) FROM c WHERE c.work_date >= v_mon),
      'week_days', COALESCE((SELECT round(sum(COALESCE(c.hours, 0)) / 8, 1) FROM c WHERE c.work_date >= v_mon), 0),
      'last_week_cost', COALESCE((SELECT sum(c.cost) FROM c WHERE c.work_date >= v_mon - 7 AND c.work_date < v_mon), 0),
      'total_cost', COALESCE((SELECT sum(c.cost) FROM c), 0),
      'budget', (SELECT sum(pb.budgeted_amount) FROM project_budgets pb
                   JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
                   JOIN cost_groups g ON g.id = pb.cost_group_id AND g.name = 'Labor'
                  WHERE pb.project_id = p_project),
      'output', COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM (
                   SELECT q.role_needed AS role, q.volume_unit AS unit, q.estimated_total_volume AS planned,
                          COALESCE(sum(c.quantity) FILTER (WHERE c.work_date >= v_mon), 0) AS week,
                          COALESCE(sum(c.quantity) FILTER (WHERE c.work_date >= v_mon - 7 AND c.work_date < v_mon), 0) AS last_week,
                          COALESCE(sum(c.quantity), 0) AS total
                     FROM c JOIN labor_requisitions q ON q.id = c.labor_requisition_id AND q.payment_basis = 'per_volume'
                    GROUP BY q.id
                   HAVING COALESCE(sum(c.quantity) FILTER (WHERE c.work_date >= v_mon - 7), 0) > 0) o), '[]'::jsonb)));
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_site_pulse(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_site_pulse(uuid) TO authenticated;

-- ── Each worker's week on a site ────────────────────────────────────────────
-- Lines, a total, and the words to send them. "linked" says the bot will
-- tell them itself.
CREATE OR REPLACE FUNCTION public.labour_site_slips(p_project uuid, p_week_of date DEFAULT NULL)
RETURNS TABLE(staff_id uuid, name text, phone text, linked boolean, days numeric, amount numeric, lines jsonb, message text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_day date := COALESCE(p_week_of, bot_today()); v_mon date; v_site text;
BEGIN
  IF auth.uid() IS NULL OR NOT (can_run_labour_site(p_project) OR labour_can_see_costs(p_project)) THEN RETURN; END IF;
  v_mon := v_day - (extract(isodow FROM v_day)::int - 1);
  SELECT btrim(project_name) INTO v_site FROM projects WHERE id = p_project;
  RETURN QUERY
  WITH c AS MATERIALIZED (
    SELECT x.staff_id AS sid, x.work_date, x.hours, x.overtime_hours, x.quantity, x.percent_done, x.cost, q.role_needed, q.payment_basis, q.volume_unit
      FROM labour_entry_costs(p_project, NULL) x
      LEFT JOIN labor_requisitions q ON q.id = x.labor_requisition_id
     WHERE x.staff_id IS NOT NULL AND x.work_date BETWEEN v_mon AND v_mon + 6
  ), per AS (
    SELECT c.sid, sum(COALESCE(c.hours, 0)) / 8 AS d, sum(c.cost) AS amt,
           jsonb_agg(jsonb_build_object('date', c.work_date, 'what', c.role_needed, 'days', round(COALESCE(c.hours, 0) / 8, 2),
                     'overtime_hours', NULLIF(c.overtime_hours, 0), 'quantity', NULLIF(c.quantity, 0), 'unit', c.volume_unit,
                     'amount', round(c.cost, 2)) ORDER BY c.work_date) AS ls,
           string_agg(to_char(c.work_date, 'Dy DD Mon') || ': '
                      || CASE WHEN c.payment_basis = 'per_volume' THEN trim(to_char(COALESCE(c.quantity, 0), 'FM999,990.##')) || ' ' || COALESCE(c.volume_unit, 'units')
                              WHEN c.payment_basis = 'fixed_price' THEN trim(to_char(COALESCE(c.percent_done, 0), 'FM990.##')) || '% of the task'
                              WHEN COALESCE(c.hours, 0) = 8 THEN '1 day' WHEN COALESCE(c.hours, 0) = 4 THEN 'half a day'
                              ELSE trim(to_char(COALESCE(c.hours, 0), 'FM990.##')) || ' hours' END
                      || CASE WHEN COALESCE(c.overtime_hours, 0) > 0 THEN ' + ' || trim(to_char(c.overtime_hours, 'FM990.##')) || ' h overtime' ELSE '' END
                      || ' · ' || bot_birr(round(c.cost, 2)), E'\n' ORDER BY c.work_date) AS txt
      FROM c GROUP BY c.sid
  )
  SELECT p.sid, btrim(s.employee_name), NULLIF(btrim(COALESCE(s.phone_number, '')), ''), bot_chat_of_staff(p.sid) IS NOT NULL,
         round(p.d, 2), round(p.amt, 2), p.ls,
         btrim(s.employee_name) || ', this is what is recorded for you at ' || COALESCE(v_site, 'site') || ', '
           || to_char(v_mon, 'DD Mon') || ' to ' || to_char(v_mon + 6, 'DD Mon') || E':\n' || p.txt
           || E'\nTotal: ' || bot_birr(round(p.amt, 2)) || E'\nIf a day is missing or wrong, tell your site manager.'
    FROM per p JOIN staff s ON s.id = p.sid
   ORDER BY 2;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_site_slips(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_site_slips(uuid, date) TO authenticated;

-- Workers linked to the bot hear in the evening what was recorded for them
-- since the last time (whichever day it was worked).
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
    WITH fresh AS (
      SELECT e.id, e.staff_id, e.work_date FROM labour_work_entries e
        LEFT JOIN labour_worker_notice n ON n.staff_id = e.staff_id
       WHERE e.staff_id IS NOT NULL AND e.recorded_at > COALESCE(n.last_sent_at, now() - interval '26 hours')
         AND e.recorded_at > now() - interval '7 days'
         AND (COALESCE(e.hours, 0) > 0 OR COALESCE(e.quantity, 0) > 0 OR COALESCE(e.percent_done, 0) > 0)
    ), c AS MATERIALIZED (SELECT x.entry_id, x.staff_id, x.work_date, x.project_id, x.hours, x.cost FROM labour_entry_costs(NULL, NULL) x)
    SELECT f.staff_id, bot_chat_of_staff(f.staff_id) AS chat,
           string_agg(to_char(c.work_date, 'Dy DD Mon') || ' · ' || bot_esc(COALESCE(btrim(p.project_name), 'site')) || ' · ' || bot_birr(round(c.cost, 2)),
                      E'\n' ORDER BY c.work_date) AS txt,
           (SELECT COALESCE(sum(k.cost), 0) FROM c k WHERE k.staff_id = f.staff_id AND k.work_date >= v_mon) AS week
      FROM fresh f JOIN c ON c.entry_id = f.id LEFT JOIN projects p ON p.id = c.project_id
     GROUP BY f.staff_id
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
      SELECT x.work_date, x.project_id, x.hours, x.quantity, x.cost, q.role_needed
        FROM labour_entry_costs(NULL, NULL) x LEFT JOIN labor_requisitions q ON q.id = x.labor_requisition_id
       WHERE x.staff_id = p_staff
    )
    SELECT jsonb_build_object(
      'name', btrim(s.employee_name), 'phone', NULLIF(btrim(COALESCE(s.phone_number, '')), ''), 'trade', s.trade_tag,
      'verified', s.verified_at IS NOT NULL, 'linked', bot_chat_of_staff(s.id) IS NOT NULL,
      'first_day', (SELECT min(c.work_date) FROM c), 'last_day', (SELECT max(c.work_date) FROM c),
      'days', COALESCE((SELECT round(sum(COALESCE(c.hours, 0)) / 8, 1) FROM c), 0),
      'days_recorded', (SELECT count(DISTINCT c.work_date) FROM c),
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
