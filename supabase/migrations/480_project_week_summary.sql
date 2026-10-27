-- 480: One packed weekly summary per project — in the app, and posted to
-- the project's Telegram group every Saturday evening.
--
-- Labour was being shared in bulk (every entry, every worker). This boils a
-- week on a site down to what a manager reads in thirty seconds:
--   · how many person-days, workers and days on site, against last week;
--   · each work order worked: progress at the start of the week → now, the
--     days spent on it, and whether anyone updated its progress;
--   · what finished, what is overdue, work recorded with no work order;
--   · pay: confirmed pay not yet requested, requests with finance, paid;
--   · workers on site HR hasn't verified, requests gone quiet.
-- Money shows in the app to those who see labour costs (labour_can_see_costs),
-- and in a Telegram group only when the project manager turns it on.
--
-- Telegram: the PM makes a link code on the project page, adds the bot to
-- the site group and sends /link CODE there. /week posts the week so far,
-- /unlink stops it. The bot answers only those commands in groups.

-- ── Groups ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_telegram_groups (
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chat_id        bigint NOT NULL,
  title          text,
  show_costs     boolean NOT NULL DEFAULT false,
  linked_at      timestamptz NOT NULL DEFAULT now(),
  linked_by_name text,
  unlinked_at    timestamptz,
  last_posted_at timestamptz,
  PRIMARY KEY (project_id, chat_id)
);
COMMENT ON TABLE project_telegram_groups IS 'A project''s Telegram site group: gets the weekly summary (480).';

CREATE TABLE IF NOT EXISTS project_telegram_link_codes (
  code            text PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_by_name text,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);

ALTER TABLE project_telegram_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_telegram_link_codes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_telegram_groups' AND policyname = 'ptg_read') THEN
    EXECUTE 'CREATE POLICY ptg_read ON project_telegram_groups FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.can_run_project_group(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager'), false) OR is_ops_manager() OR manages_project(p_project);
$function$;

-- ── The week ─────────────────────────────────────────────────────────
-- p_from: the Monday the week starts (default: this week). p_costs: show money.
-- Not for callers directly — the wrappers below decide p_costs.
CREATE OR REPLACE FUNCTION public.project_week_core(p_project uuid, p_from date, p_costs boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_today date := bot_today();
  v_from date := COALESCE(p_from, date_trunc('week', bot_today())::date);
  v_to date := v_from + 6;
  v_current boolean := v_from + 6 >= bot_today();
  v jsonb;
BEGIN
  WITH c AS (
    SELECT * FROM labour_entry_costs(p_project, NULL) WHERE work_date BETWEEN v_from - 7 AND v_to
  ), wk AS (SELECT * FROM c WHERE work_date >= v_from),
  prev AS (SELECT * FROM c WHERE work_date < v_from),
  per_wo AS (
    SELECT work_order_id, count(DISTINCT (staff_id, work_date)) AS person_days, count(DISTINCT staff_id) AS workers, sum(cost) AS cost
      FROM wk WHERE work_order_id IS NOT NULL GROUP BY 1
  ), upd AS (
    SELECT u.work_order_id, (u.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS d, u.progress_pct, u.note, u.created_at
      FROM wo_progress_updates u JOIN work_orders w ON w.id = u.work_order_id
     WHERE w.project_id = p_project AND (u.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date <= v_to
  ), orders AS (
    SELECT w.id, COALESCE(NULLIF(btrim(w.title), ''), left(w.scope_of_work, 80), 'Work order') AS title, w.status,
           w.target_completion_date AS due,
           (SELECT u.progress_pct FROM upd u WHERE u.work_order_id = w.id AND u.d < v_from ORDER BY u.created_at DESC LIMIT 1) AS before,
           CASE WHEN v_current THEN w.current_progress_pct
                ELSE (SELECT u.progress_pct FROM upd u WHERE u.work_order_id = w.id ORDER BY u.created_at DESC LIMIT 1) END AS now,
           EXISTS (SELECT 1 FROM upd u WHERE u.work_order_id = w.id AND u.d >= v_from) AS updated,
           (SELECT u.note FROM upd u WHERE u.work_order_id = w.id AND u.d >= v_from AND NULLIF(btrim(u.note), '') IS NOT NULL ORDER BY u.created_at DESC LIMIT 1) AS note,
           COALESCE(pw.person_days, 0) AS person_days, COALESCE(pw.workers, 0) AS workers, pw.cost,
           w.status = 'completed' AND (w.updated_at AT TIME ZONE 'Africa/Addis_Ababa')::date BETWEEN v_from AND v_to AS finished
      FROM work_orders w LEFT JOIN per_wo pw ON pw.work_order_id = w.id
     WHERE w.project_id = p_project
  )
  SELECT jsonb_build_object(
    'project', (SELECT jsonb_build_object('id', p.id, 'name', btrim(p.project_name), 'progress', p.physical_progress,
                  'pm', (SELECT employee_name FROM staff WHERE id = p.project_manager_id))
                  FROM projects p WHERE p.id = p_project),
    'from', v_from, 'to', v_to, 'current', v_current, 'costs', p_costs,
    'labour', jsonb_build_object(
      'person_days', (SELECT count(DISTINCT (staff_id, work_date)) FROM wk),
      'workers', (SELECT count(DISTINCT staff_id) FROM wk),
      'days_on_site', (SELECT count(DISTINCT work_date) FROM wk),
      'overtime_hours', (SELECT COALESCE(sum(overtime_hours), 0) FROM wk),
      'cost', CASE WHEN p_costs THEN (SELECT COALESCE(sum(cost), 0) FROM wk) END,
      'prev_person_days', (SELECT count(DISTINCT (staff_id, work_date)) FROM prev),
      'prev_cost', CASE WHEN p_costs THEN (SELECT COALESCE(sum(cost), 0) FROM prev) END,
      'no_work_order_days', (SELECT count(DISTINCT (staff_id, work_date)) FROM wk WHERE work_order_id IS NULL),
      'by_day', (SELECT jsonb_agg(jsonb_build_object('date', d, 'people', (SELECT count(DISTINCT staff_id) FROM wk WHERE work_date = d)) ORDER BY d)
                   FROM generate_series(v_from, v_to, interval '1 day') g(d0), LATERAL (SELECT d0::date AS d) x)),
    'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'status', status, 'due', due, 'before', before, 'now', now,
        'gain', CASE WHEN now IS NOT NULL THEN now - COALESCE(before, 0) END,
        'updated', updated, 'note', note, 'person_days', person_days, 'workers', workers,
        'cost', CASE WHEN p_costs THEN COALESCE(cost, 0) END,
        'flags', to_jsonb(array_remove(ARRAY[
          CASE WHEN person_days > 0 AND NOT updated THEN 'no_update' END,
          CASE WHEN status <> 'completed' AND due < LEAST(v_to, v_today) THEN 'overdue' END], NULL)))
        ORDER BY person_days DESC, title)
      FROM orders WHERE person_days > 0 OR updated OR finished), '[]'::jsonb),
    'finished', COALESCE((SELECT jsonb_agg(title ORDER BY title) FROM orders WHERE finished), '[]'::jsonb),
    'overdue', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', title, 'due', due) ORDER BY due)
                FROM orders WHERE status IN ('requested', 'in_progress') AND due < LEAST(v_to, v_today)), '[]'::jsonb),
    'idle_orders', (SELECT count(*) FROM orders WHERE status = 'in_progress' AND person_days = 0 AND NOT updated),
    'open_orders', (SELECT count(*) FROM orders WHERE status IN ('requested', 'in_progress')),
    'pay', (SELECT jsonb_build_object(
        'to_request', count(*) FILTER (WHERE NOT x.in_request),
        'to_request_amount', CASE WHEN p_costs THEN COALESCE(sum(x.amount_etb) FILTER (WHERE NOT x.in_request), 0) END,
        'with_finance', (SELECT count(DISTINCT q.id) FROM labour_pay_requests q JOIN labour_pay_request_items i ON i.request_id = q.id AND i.removed_at IS NULL
                           JOIN expenses e ON e.id = i.expense_id WHERE q.status IN ('submitted', 'approved') AND e.project_id = p_project),
        'returned', (SELECT count(DISTINCT q.id) FROM labour_pay_requests q JOIN labour_pay_request_items i ON i.request_id = q.id AND i.removed_at IS NULL
                           JOIN expenses e ON e.id = i.expense_id WHERE q.status = 'returned' AND e.project_id = p_project),
        'paid_week', CASE WHEN p_costs THEN (SELECT COALESCE(sum(e.amount_etb), 0) FROM expenses e
                           WHERE e.project_id = p_project AND e.payment_state = 'paid'
                             AND e.paid_date::date BETWEEN v_from AND v_to
                             AND (EXISTS (SELECT 1 FROM labour_pay_sheets ps WHERE ps.expense_id = e.id)
                                  OR EXISTS (SELECT 1 FROM labour_pay_holds h WHERE h.expense_id = e.id))) END)
      FROM (SELECT e.amount_etb,
                   EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
                            WHERE i.expense_id = e.id AND i.removed_at IS NULL AND q.status <> 'cancelled') AS in_request
              FROM expenses e
              LEFT JOIN labour_pay_sheets ps ON ps.expense_id = e.id
              LEFT JOIN labour_pay_holds h ON h.expense_id = e.id
             WHERE e.project_id = p_project AND (ps.id IS NOT NULL OR h.expense_id IS NOT NULL)
               AND e.approval_status = 'pending' AND COALESCE(e.payment_state, 'unpaid') = 'unpaid'
               AND NOT COALESCE(e.is_archived, false)) x),
    'unverified', (SELECT count(DISTINCT wk.staff_id) FROM wk JOIN staff s ON s.id = wk.staff_id
                    WHERE s.employment_type = 'tier_2_casual' AND s.verified_at IS NULL),
    'quiet_requests', (SELECT count(*) FROM labor_requisitions r
                        WHERE r.project_id = p_project AND r.status = 'approved' AND r.closed_at IS NULL AND r.created_at < now() - interval '21 days'
                          AND NOT EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.work_date > CURRENT_DATE - 21)
                          AND NOT EXISTS (SELECT 1 FROM wo_attendance_log l WHERE l.labor_requisition_id = r.id AND l.log_date > CURRENT_DATE - 21))
  ) INTO v;
  RETURN v;
END $function$;
REVOKE ALL ON FUNCTION public.project_week_core(uuid, date, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.project_week_summary(p_project uuid, p_from date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  RETURN project_week_core(p_project, p_from, labour_can_see_costs(p_project))
         || jsonb_build_object('groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('chat_id', g.chat_id, 'title', g.title,
              'show_costs', g.show_costs, 'linked_at', g.linked_at, 'last_posted_at', g.last_posted_at) ORDER BY g.linked_at)
              FROM project_telegram_groups g WHERE g.project_id = p_project AND g.unlinked_at IS NULL), '[]'::jsonb),
            'can_link', can_run_project_group(p_project));
END $function$;

-- Every project with labour or progress this week or last, one line each.
CREATE OR REPLACE FUNCTION public.projects_week_overview(p_from date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_from date := COALESCE(p_from, date_trunc('week', bot_today())::date); s jsonb; out jsonb := '[]'::jsonb; pr record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  FOR pr IN
    SELECT DISTINCT x.project_id FROM (
      SELECT e.project_id FROM labour_work_entries e WHERE e.work_date BETWEEN v_from - 7 AND v_from + 6
      UNION SELECT l.project_id FROM wo_attendance_log l WHERE l.log_date BETWEEN v_from - 7 AND v_from + 6
      UNION SELECT w.project_id FROM wo_progress_updates u JOIN work_orders w ON w.id = u.work_order_id
             WHERE (u.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date BETWEEN v_from AND v_from + 6) x
     WHERE x.project_id IS NOT NULL
  LOOP
    s := project_week_core(pr.project_id, v_from, labour_can_see_costs(pr.project_id));
    out := out || jsonb_build_array(jsonb_build_object(
      'project', s->'project', 'labour', s->'labour' - 'by_day', 'by_day', s#>'{labour,by_day}',
      'orders_worked', (SELECT count(*) FROM jsonb_array_elements(s->'orders') o WHERE (o->>'person_days')::int > 0),
      'no_update', (SELECT count(*) FROM jsonb_array_elements(s->'orders') o WHERE o->'flags' ? 'no_update'),
      'gain', (SELECT round(avg((o->>'gain')::numeric)) FROM jsonb_array_elements(s->'orders') o WHERE o->>'gain' IS NOT NULL AND (o->>'updated')::boolean),
      'finished', jsonb_array_length(s->'finished'), 'overdue', jsonb_array_length(s->'overdue'),
      'pay', s->'pay', 'unverified', s->'unverified', 'costs', s->'costs'));
  END LOOP;
  RETURN jsonb_build_object('from', v_from, 'to', v_from + 6,
    'projects', COALESCE((SELECT jsonb_agg(x ORDER BY (x#>>'{labour,person_days}')::int DESC) FROM jsonb_array_elements(out) x), '[]'::jsonb));
END $function$;

-- ── Telegram text ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_week_text(s jsonb)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  l jsonb := s->'labour'; o jsonb; t text; n int := 0; v_more int;
  v_pd int := (l->>'person_days')::int; v_prev int := (l->>'prev_person_days')::int;
BEGIN
  t := '📋 <b>' || bot_esc(s#>>'{project,name}') || '</b>' || E'\n'
    || CASE WHEN (s->>'current')::boolean THEN 'This week so far · ' ELSE 'Week of ' END
    || bot_day((s->>'from')::date) || ' – ' || bot_day(LEAST((s->>'to')::date, bot_today())) || E'\n\n';

  IF v_pd = 0 THEN
    t := t || '👷 No labour recorded' || CASE WHEN v_prev > 0 THEN ' (last week ' || v_prev || ' person-days)' ELSE '' END || E'\n';
  ELSE
    t := t || '👷 <b>' || v_pd || '</b> person-days · ' || (l->>'workers') || ' workers · ' || (l->>'days_on_site') || ' days on site'
      || CASE WHEN v_prev > 0 THEN ' (last week ' || v_prev || ')' ELSE '' END || E'\n';
    IF (l->>'overtime_hours')::numeric > 0 THEN t := t || '⏱ ' || trim_scale((l->>'overtime_hours')::numeric)::text || ' h overtime' || E'\n'; END IF;
  END IF;
  IF (s->>'costs')::boolean AND (l->>'cost')::numeric > 0 THEN t := t || '💰 Labour ' || bot_birr((l->>'cost')::numeric) || E'\n'; END IF;

  IF jsonb_array_length(s->'orders') > 0 THEN
    t := t || E'\n<b>Work orders</b>\n';
    FOR o IN SELECT x FROM jsonb_array_elements(s->'orders') x LOOP
      n := n + 1;
      EXIT WHEN n > 8;
      t := t || '• ' || bot_esc(rtrim(left(o->>'title', 60))) || ' — '
        || CASE WHEN (o->>'person_days')::int > 0 THEN (o->>'person_days') || CASE WHEN (o->>'person_days')::int = 1 THEN ' day' ELSE ' days' END || ' · ' ELSE '' END
        || CASE WHEN (o->>'updated')::boolean AND o->>'before' IS NOT NULL AND (o->>'before')::numeric <> COALESCE((o->>'now')::numeric, -1)
                  THEN (o->>'before')::numeric::int || '% → <b>' || (o->>'now')::numeric::int || '%</b>'
                WHEN (o->>'updated')::boolean AND o->>'now' IS NOT NULL THEN '<b>' || (o->>'now')::numeric::int || '%</b>'
                WHEN o->>'now' IS NOT NULL THEN (o->>'now')::numeric::int || '% · ⚠️ not updated'
                ELSE '⚠️ no progress update' END
        || CASE WHEN o->>'note' IS NOT NULL THEN E'\n   <i>' || bot_esc(left(o->>'note', 120)) || '</i>' ELSE '' END
        || E'\n';
    END LOOP;
    v_more := jsonb_array_length(s->'orders') - 8;
    IF v_more > 0 THEN t := t || '…and ' || v_more || ' more' || E'\n'; END IF;
  END IF;
  IF (l->>'no_work_order_days')::int > 0 THEN
    t := t || '❔ ' || (l->>'no_work_order_days') || ' person-days recorded without a work order' || E'\n';
  END IF;

  IF jsonb_array_length(s->'finished') > 0 THEN
    t := t || E'\n✅ Finished: ' || bot_esc((SELECT string_agg(left(x #>> '{}', 50), ', ') FROM jsonb_array_elements(s->'finished') x)) || E'\n';
  END IF;
  IF jsonb_array_length(s->'overdue') > 0 THEN
    t := t || '⏰ ' || jsonb_array_length(s->'overdue') || ' overdue: '
      || bot_esc((SELECT string_agg(rtrim(left(x->>'title', 40)), ', ') FROM (SELECT x FROM jsonb_array_elements(s->'overdue') x LIMIT 3) y))
      || CASE WHEN jsonb_array_length(s->'overdue') > 3 THEN '…' ELSE '' END || E'\n';
  END IF;

  IF (s#>>'{pay,to_request}')::int > 0 OR (s#>>'{pay,with_finance}')::int > 0 OR (s#>>'{pay,returned}')::int > 0 THEN
    t := t || E'\n<b>Pay</b>\n';
    IF (s#>>'{pay,returned}')::int > 0 THEN t := t || '↩️ ' || (s#>>'{pay,returned}') || ' payment request sent back by finance — fix and resend' || E'\n'; END IF;
    IF (s#>>'{pay,to_request}')::int > 0 THEN
      t := t || '📝 ' || (s#>>'{pay,to_request}') || ' confirmed pay sheet' || CASE WHEN (s#>>'{pay,to_request}')::int = 1 THEN '' ELSE 's' END
        || ' not yet sent to finance' || CASE WHEN (s->>'costs')::boolean THEN ' (' || bot_birr((s#>>'{pay,to_request_amount}')::numeric) || ')' ELSE '' END || E'\n';
    END IF;
    IF (s#>>'{pay,with_finance}')::int > 0 THEN t := t || '🏦 ' || (s#>>'{pay,with_finance}') || ' payment request with finance' || E'\n'; END IF;
  END IF;
  IF (s->>'unverified')::int > 0 THEN t := t || '🪪 ' || (s->>'unverified') || ' worker(s) on site not verified by HR yet' || E'\n'; END IF;
  IF (s->>'quiet_requests')::int > 0 THEN t := t || '💤 ' || (s->>'quiet_requests') || ' labour request(s) with no work for 3 weeks — close them' || E'\n'; END IF;

  IF bot_url('/projects/' || (s#>>'{project,id}')) IS NOT NULL THEN
    t := t || E'\n<a href="' || bot_url('/projects/' || (s#>>'{project,id}') || '?tab=summary') || '">Open in Kuncho</a>';
  END IF;
  RETURN t;
END $function$;

-- ── Linking a group ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_telegram_link_code(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_code text; v_until timestamptz := now() + interval '2 days';
BEGIN
  IF NOT can_run_project_group(p_project) THEN RAISE EXCEPTION 'Only the project manager links the site group'; END IF;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  INSERT INTO project_telegram_link_codes (code, project_id, created_by, created_by_name, expires_at)
  VALUES (v_code, p_project, auth.uid(), (SELECT full_name FROM user_profiles WHERE id = auth.uid()), v_until);
  RETURN jsonb_build_object('code', v_code, 'expires_at', v_until,
    'bot', (SELECT telegram_bot_username FROM notification_channel_settings WHERE id));
END $function$;

CREATE OR REPLACE FUNCTION public.project_telegram_group_set(p_project uuid, p_chat bigint, p_show_costs boolean DEFAULT NULL, p_unlink boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT can_run_project_group(p_project) THEN RAISE EXCEPTION 'Only the project manager changes the site group'; END IF;
  UPDATE project_telegram_groups SET show_costs = COALESCE(p_show_costs, show_costs),
         unlinked_at = CASE WHEN p_unlink THEN now() ELSE unlinked_at END
   WHERE project_id = p_project AND chat_id = p_chat;
END $function$;

-- Commands in a group: /link CODE, /week, /unlink. Anything else: silence.
CREATE OR REPLACE FUNCTION public.bot_group(p_chat bigint, p_msg jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_text text := btrim(COALESCE(p_msg->>'text', ''));
  m text[]; c record; v_out jsonb := '[]'::jsonb; g record; v_name text;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  -- A group that became a supergroup gets a new id.
  IF p_msg ? 'migrate_to_chat_id' THEN
    UPDATE project_telegram_groups SET chat_id = (p_msg->>'migrate_to_chat_id')::bigint WHERE chat_id = p_chat;
    RETURN '[]'::jsonb;
  END IF;
  -- The bot was just added: say how to link it.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_msg->'new_chat_members', '[]'::jsonb)) u
              WHERE lower(u->>'username') = lower((SELECT telegram_bot_username FROM notification_channel_settings WHERE id))) THEN
    RETURN bot_msg(p_chat, '👋 Hi! I post a short weekly summary of a Kuncho project here. Project manager: open the project in Kuncho → '
      || '<b>Summary</b> → <b>Link a Telegram group</b>, then send the <code>/link CODE</code> it shows.');
  END IF;
  m := regexp_match(v_text, '^/(\w+)(?:@\w+)?\s*(.*)$');
  IF m IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF lower(m[1]) = 'link' THEN
    SELECT * INTO c FROM project_telegram_link_codes WHERE code = upper(btrim(m[2])) AND used_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN
      RETURN bot_msg(p_chat, 'That code has expired or was already used. In Kuncho, open the project → <b>Summary</b> → <b>Link a Telegram group</b> for a new one.');
    END IF;
    UPDATE project_telegram_link_codes SET used_at = now() WHERE code = c.code;
    INSERT INTO project_telegram_groups (project_id, chat_id, title, linked_by_name)
    VALUES (c.project_id, p_chat, p_msg #>> '{chat,title}', c.created_by_name)
    ON CONFLICT (project_id, chat_id) DO UPDATE SET unlinked_at = NULL, title = EXCLUDED.title, linked_at = now(), linked_by_name = EXCLUDED.linked_by_name;
    SELECT btrim(project_name) INTO v_name FROM projects WHERE id = c.project_id;
    RETURN bot_msg(p_chat, '✅ This group now gets the weekly summary for <b>' || bot_esc(v_name) || '</b> every Saturday evening. '
      || 'Send /week any time for the week so far, /unlink to stop.');
  END IF;

  IF lower(m[1]) = 'week' THEN
    FOR g IN SELECT * FROM project_telegram_groups WHERE chat_id = p_chat AND unlinked_at IS NULL LOOP
      v_out := v_out || bot_msg(p_chat, bot_week_text(project_week_core(g.project_id, NULL, g.show_costs)));
    END LOOP;
    IF jsonb_array_length(v_out) = 0 THEN
      RETURN bot_msg(p_chat, 'This group isn''t linked to a project yet. In Kuncho, open the project → <b>Summary</b> → <b>Link a Telegram group</b>.');
    END IF;
    RETURN v_out;
  END IF;

  IF lower(m[1]) = 'unlink' THEN
    UPDATE project_telegram_groups SET unlinked_at = now() WHERE chat_id = p_chat AND unlinked_at IS NULL;
    RETURN bot_msg(p_chat, CASE WHEN FOUND THEN 'Unlinked. No more weekly summaries here.' ELSE 'This group isn''t linked to a project.' END);
  END IF;
  RETURN '[]'::jsonb;
END $function$;
REVOKE ALL ON FUNCTION public.bot_group(bigint, jsonb) FROM PUBLIC, anon, authenticated;

-- bot_handle answered private chats only; groups now go to bot_group.
DO $$
DECLARE v_def text := pg_get_functiondef('public.bot_handle(jsonb)'::regprocedure);
BEGIN
  IF position('bot_group(' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '  IF v_chat IS NULL OR v_type IS DISTINCT FROM ''private'' THEN RETURN ''[]''::jsonb; END IF;',
      '  IF v_chat IS NOT NULL AND v_type IN (''group'', ''supergroup'') THEN
    IF v_msg IS NULL THEN RETURN ''[]''::jsonb; END IF;
    BEGIN
      RETURN bot_group(v_chat, v_msg);
    EXCEPTION WHEN OTHERS THEN
      RETURN bot_msg(v_chat, ''⚠️ '' || bot_esc(SQLERRM));
    END;
  END IF;
  IF v_chat IS NULL OR v_type IS DISTINCT FROM ''private'' THEN RETURN ''[]''::jsonb; END IF;');
    IF position('bot_group(' IN v_def) = 0 THEN RAISE EXCEPTION 'bot_handle has changed — add the group branch by hand'; END IF;
    EXECUTE v_def;
  END IF;
END $$;

-- ── Saturday evening ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_week_push()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE g record; v_n int := 0;
BEGIN
  IF NOT bot_ready() THEN RETURN 0; END IF;
  FOR g IN SELECT * FROM project_telegram_groups WHERE unlinked_at IS NULL
             AND (last_posted_at IS NULL OR last_posted_at < now() - interval '5 days') LOOP
    PERFORM bot_queue(bot_msg(g.chat_id, bot_week_text(project_week_core(g.project_id, NULL, g.show_costs))));
    UPDATE project_telegram_groups SET last_posted_at = now() WHERE project_id = g.project_id AND chat_id = g.chat_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.bot_week_push() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kuncho-bot-week-summary') THEN
    -- Saturday 18:07 in Addis Ababa.
    PERFORM cron.schedule('kuncho-bot-week-summary', '7 15 * * 6', 'SELECT public.bot_week_push()');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION project_week_summary(uuid, date), projects_week_overview(date),
  project_telegram_link_code(uuid), project_telegram_group_set(uuid, bigint, boolean, boolean), can_run_project_group(uuid) TO authenticated;
