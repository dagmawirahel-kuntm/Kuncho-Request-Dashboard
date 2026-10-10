-- 433 — The site bot: asking, recording and approving with Telegram buttons.
--
-- Staff were not filling in forms: two accounts entered 84% of all labour
-- requests and work orders, and hired trips were typed in after the fact,
-- then waited weeks for approval. The Telegram bot that already delivers
-- notifications (425) now takes requests too, with buttons — the only typing
-- is a number, a name or a one-line note:
--
--   * Ask for workers: site → work → how many → days → day rate → send. The
--     request is filed exactly as the app files it, with a work order found or
--     opened for that site and work, and operations, HR and admin get it as a
--     card with Approve / Reject. Whoever asked is told, and adds the crew.
--   * Ask for a truck: a purchase order to collect, or a one-line note.
--     Logistics gets a card to hand it to one of our drivers or hire one.
--   * Our drivers get each trip with Picked up / Delivered / Problem.
--   * Who worked today: the site's crew as buttons. Every evening the bot asks
--     the site foreman (or the project manager) on its own.
--   * The cashier records a payment made at the gate on the Pay out page; a
--     different finance person approves it from a card, which completes it.
--     The payer and the approver stay two people, as the payment rules require.
--   * Anything typed that isn't a menu goes to the admins as a note and is
--     counted — that count is what says whether paid reading is worth it.
--
-- People without a Kuncho login (site foremen, drivers) connect from their
-- staff record. The bot acts as the person on the other end: a login is held
-- to the same rules as in the app (the bot runs as them), a staff link to the
-- sites that person is assigned to or manages.

SET search_path TO public;

-- ── 1. Schema ───────────────────────────────────────────────────────────
ALTER TABLE notification_channel_settings ADD COLUMN IF NOT EXISTS telegram_hook_version integer NOT NULL DEFAULT 1;

ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS requested_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS requested_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE labour_work_entries ADD COLUMN IF NOT EXISTS recorded_via text NOT NULL DEFAULT 'app';

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS spot_paid_by uuid REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS spot_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS spot_paid_method text,
  ADD COLUMN IF NOT EXISTS spot_paid_account_id uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS spot_paid_ref text;
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_spot_paid_method_check') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_spot_paid_method_check
      CHECK (spot_paid_method IS NULL OR spot_paid_method IN ('cash', 'telebirr'));
  END IF;
END $c$;
COMMENT ON COLUMN expenses.spot_paid_by IS
  'The cashier who paid this on the spot (Pay out, migration 433). It completes as paid once another finance person approves it.';

-- People with no Kuncho login, connected to the bot from their staff record.
CREATE TABLE IF NOT EXISTS bot_staff_links (
  staff_id     uuid PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  chat_id      bigint UNIQUE,
  username     text,
  linked_at    timestamptz,
  link_code    text UNIQUE,
  link_expires timestamptz,
  created_by   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One conversation per bot message: what the buttons on it are asking.
CREATE TABLE IF NOT EXISTS bot_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     bigint NOT NULL,
  message_id  bigint,
  kind        text NOT NULL,
  state       jsonb NOT NULL DEFAULT '{}'::jsonb,
  card_key    text,
  actor_user  uuid,
  actor_staff uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS bot_threads_message_uq ON bot_threads (chat_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bot_threads_card_idx ON bot_threads (card_key) WHERE card_key IS NOT NULL;

-- What a chat's next typed message answers.
CREATE TABLE IF NOT EXISTS bot_chats (
  chat_id         bigint PRIMARY KEY,
  awaiting_thread uuid REFERENCES bot_threads(id) ON DELETE SET NULL,
  awaiting        text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- What the bot sends on its own — cards, reminders, edits — sent within a minute.
CREATE TABLE IF NOT EXISTS bot_outbox (
  id         bigserial PRIMARY KEY,
  chat_id    bigint NOT NULL,
  method     text NOT NULL DEFAULT 'sendMessage',
  payload    jsonb NOT NULL,
  thread_id  uuid REFERENCES bot_threads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  attempts   integer NOT NULL DEFAULT 0,
  error      text
);
-- Claimed while being sent, so the minute's dispatch and the webhook don't both send a row.
ALTER TABLE bot_outbox ADD COLUMN IF NOT EXISTS taken_at timestamptz;
CREATE INDEX IF NOT EXISTS bot_outbox_pending_idx ON bot_outbox (id) WHERE sent_at IS NULL;

-- Anything sent to the bot that wasn't a menu: passed to the admins, and counted.
CREATE TABLE IF NOT EXISTS bot_inbox_unmatched (
  id          bigserial PRIMARY KEY,
  chat_id     bigint NOT NULL,
  actor_user  uuid,
  actor_staff uuid,
  actor_name  text,
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bot_staff_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_inbox_unmatched ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bot_staff_links' AND policyname = 'bot_staff_links_read') THEN
    CREATE POLICY bot_staff_links_read ON bot_staff_links FOR SELECT
      USING (COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bot_inbox_unmatched' AND policyname = 'bot_inbox_read') THEN
    CREATE POLICY bot_inbox_read ON bot_inbox_unmatched FOR SELECT
      USING (COALESCE(get_user_role()::text = 'admin', false));
  END IF;
END $p$;
REVOKE ALL ON bot_threads, bot_chats, bot_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON bot_staff_links, bot_inbox_unmatched FROM PUBLIC, anon, authenticated;
GRANT SELECT ON bot_staff_links, bot_inbox_unmatched TO authenticated;

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order) VALUES
  ('expense.spot_paid', 'Expenses', 'Paid at the gate, to approve', 'Finance, except whoever paid', 'high', 19),
  ('labour.requested', 'Labour', 'A labour request to approve', 'Operations, HR and admin', 'normal', 32),
  ('labour.decided', 'Labour', 'Your labour request was decided', 'Whoever asked for the workers', 'normal', 33),
  ('trip.requested', 'Transport', 'A truck was asked for', 'Logistics', 'normal', 34),
  ('trip.update', 'Transport', 'Your truck is arranged or delivered', 'Whoever asked for the truck', 'normal', 35),
  ('bot.note', 'System', 'A message typed to the bot', 'Admins: anything typed that isn''t a menu', 'normal', 91)
ON CONFLICT (kind) DO NOTHING;

-- ── 2. Small helpers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_esc(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(COALESCE(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

CREATE OR REPLACE FUNCTION bot_birr(p numeric) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL THEN '—'
              WHEN p = trunc(p) THEN to_char(p, 'FM999,999,999,990')
              ELSE to_char(p, 'FM999,999,999,990.00') END || ' birr' $$;

CREATE OR REPLACE FUNCTION bot_day(p date) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL THEN '—' ELSE to_char(p, 'Dy DD Mon') END $$;

-- Today on site, in Addis.
CREATE OR REPLACE FUNCTION bot_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date $$;

CREATE OR REPLACE FUNCTION bot_clock(p timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(p AT TIME ZONE 'Africa/Addis_Ababa', 'HH24:MI') $$;

CREATE OR REPLACE FUNCTION bot_ready() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT telegram_ready FROM notification_channel_settings WHERE id), false) $$;

-- A link into the app, when the app's address is known.
CREATE OR REPLACE FUNCTION bot_url(p_path text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT rtrim(app_url, '/') || p_path FROM notification_channel_settings
   WHERE id AND app_url ~ '^https://' $$;

-- Telegram calls, as the bot function makes them.
CREATE OR REPLACE FUNCTION bot_act(p_method text, p_payload jsonb, p_bind uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('method', p_method, 'payload', p_payload, 'bind', p_bind))) $$;

CREATE OR REPLACE FUNCTION bot_btn(p_text text, p_data text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(p_text, p_data) $$;

-- Buttons laid out p_cols to a row: p_items is [[text, data], ...].
CREATE OR REPLACE FUNCTION bot_grid(p_items jsonb, p_cols integer DEFAULT 2) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(r ORDER BY ri), '[]'::jsonb) FROM (
    SELECT (i - 1) / p_cols AS ri, jsonb_agg(x ORDER BY i) AS r
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY e(x, i)
    GROUP BY (i - 1) / p_cols) z $$;

-- Rows of [text, data] into Telegram's inline keyboard; data that is a web
-- address becomes a link button.
CREATE OR REPLACE FUNCTION bot_kb(p_rows jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('inline_keyboard', COALESCE(jsonb_agg(r ORDER BY ri), '[]'::jsonb)) FROM (
    SELECT ri, jsonb_agg(CASE WHEN b->>1 ~ '^https?://' THEN jsonb_build_object('text', b->>0, 'url', b->>1)
                              ELSE jsonb_build_object('text', b->>0, 'callback_data', b->>1) END ORDER BY bi) AS r
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) WITH ORDINALITY rr(row_, ri),
         jsonb_array_elements(rr.row_) WITH ORDINALITY bb(b, bi)
    WHERE b->>1 IS NOT NULL
    GROUP BY ri) z $$;

CREATE OR REPLACE FUNCTION bot_msg(p_chat bigint, p_text text, p_kb jsonb DEFAULT NULL, p_bind uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT bot_act('sendMessage', jsonb_build_object('chat_id', p_chat, 'text', p_text, 'parse_mode', 'HTML',
    'disable_web_page_preview', true, 'reply_markup', p_kb), p_bind) $$;

-- Without a keyboard, editing a message also takes its buttons away.
CREATE OR REPLACE FUNCTION bot_edit(p_chat bigint, p_mid bigint, p_text text, p_kb jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT bot_act('editMessageText', jsonb_build_object('chat_id', p_chat, 'message_id', p_mid, 'text', p_text,
    'parse_mode', 'HTML', 'disable_web_page_preview', true, 'reply_markup', p_kb)) $$;

CREATE OR REPLACE FUNCTION bot_answer(p_id text, p_text text DEFAULT NULL, p_alert boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT bot_act('answerCallbackQuery', jsonb_build_object('callback_query_id', p_id, 'text', p_text,
    'show_alert', CASE WHEN p_alert THEN true END)) $$;

-- Queue calls for the next minute's dispatch (triggers can't send themselves).
CREATE OR REPLACE FUNCTION bot_queue(p_actions jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO bot_outbox (chat_id, method, payload, thread_id)
  SELECT (a->'payload'->>'chat_id')::bigint, a->>'method', a->'payload', NULLIF(a->>'bind', '')::uuid
  FROM jsonb_array_elements(COALESCE(p_actions, '[]'::jsonb)) a
  WHERE a->'payload'->>'chat_id' IS NOT NULL $$;

CREATE OR REPLACE FUNCTION bot_chat_of_user(p_user uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT np.telegram_chat_id FROM notification_prefs np JOIN user_profiles u ON u.id = np.user_id
   WHERE np.user_id = p_user AND u.account_status = 'active' $$;

CREATE OR REPLACE FUNCTION bot_chat_of_staff(p_staff uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT chat_id FROM bot_staff_links WHERE staff_id = p_staff),
    (SELECT bot_chat_of_user(s.user_id) FROM staff s WHERE s.id = p_staff AND s.user_id IS NOT NULL)) $$;

-- In-app notifications for the same event; people who got a Telegram card
-- for it are marked as already told there, so they don't get it twice.
CREATE OR REPLACE FUNCTION bot_notify(p_users uuid[], p_kind text, p_title text, p_body text, p_link text,
  p_entity_type text, p_entity_id uuid, p_carded uuid[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM notify(p_users, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id, NULL, p_kind || ':' || p_entity_id);
  IF cardinality(p_carded) > 0 THEN
    UPDATE notifications SET delivered = COALESCE(delivered, '{}'::jsonb) || jsonb_build_object('telegram', now())
     WHERE dedupe_key = p_kind || ':' || p_entity_id AND user_id = ANY (p_carded);
  END IF;
END $$;

-- The same for a one-off note (a question, a problem, a typed message): each
-- is its own notification, never folded into an earlier one.
CREATE OR REPLACE FUNCTION bot_note(p_users uuid[], p_title text, p_body text, p_link text DEFAULT NULL,
  p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL, p_carded uuid[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_key text := 'bot.note:' || gen_random_uuid();
BEGIN
  PERFORM notify(p_users, 'bot.note', p_title, p_body, p_link, p_entity_type, p_entity_id, NULL, v_key);
  IF cardinality(p_carded) > 0 THEN
    UPDATE notifications SET delivered = COALESCE(delivered, '{}'::jsonb) || jsonb_build_object('telegram', now())
     WHERE dedupe_key = v_key AND user_id = ANY (p_carded);
  END IF;
END $$;

-- ── 3. Who is on the other end, and acting as them ─────────────────────
CREATE OR REPLACE FUNCTION bot_actor(p_chat bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user uuid; v_name text; v_role text; v_staff uuid; v_staff_role text;
BEGIN
  SELECT np.user_id, up.full_name, up.role::text INTO v_user, v_name, v_role
  FROM notification_prefs np JOIN user_profiles up ON up.id = np.user_id
  WHERE np.telegram_chat_id = p_chat AND up.account_status = 'active'
  LIMIT 1;
  IF v_user IS NOT NULL THEN
    SELECT s.id, s.role INTO v_staff, v_staff_role FROM staff s
     WHERE s.user_id = v_user
        OR (s.email IS NOT NULL AND lower(s.email) = lower((SELECT u.email FROM auth.users u WHERE u.id = v_user)))
     ORDER BY (s.user_id = v_user) DESC NULLS LAST, (s.status = 'active') DESC
     LIMIT 1;
  ELSE
    SELECT l.staff_id, s.role, s.employee_name INTO v_staff, v_staff_role, v_name
    FROM bot_staff_links l JOIN staff s ON s.id = l.staff_id
    WHERE l.chat_id = p_chat AND COALESCE(s.status, 'active') = 'active'
    LIMIT 1;
    IF v_staff IS NULL THEN RETURN NULL; END IF;
  END IF;
  RETURN jsonb_build_object('chat', p_chat, 'user_id', v_user, 'name', COALESCE(NULLIF(btrim(v_name), ''), 'there'),
    'role', v_role, 'staff_id', v_staff, 'staff_role', v_staff_role);
END $$;

-- For the rest of this transaction the database sees the person: a login is
-- signed in as itself, so every rule the app applies applies here; a staff
-- link stays the bot, checked against that person's sites (below).
CREATE OR REPLACE FUNCTION bot_become(p_actor jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('kuncho.bot_name', COALESCE(p_actor->>'name', ''), true);
  PERFORM set_config('kuncho.bot_staff', COALESCE(p_actor->>'staff_id', ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_actor->>'user_id', ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_actor->>'user_id' IS NOT NULL
         THEN jsonb_build_object('sub', p_actor->>'user_id', 'role', 'authenticated')
         ELSE jsonb_build_object('role', 'service_role') END::text, true);
END $$;

-- A staff link (no login) runs a site it is assigned to or manages.
CREATE OR REPLACE FUNCTION bot_staff_runs_site(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NULL AND notify_is_service()
     AND EXISTS (
       SELECT 1 FROM staff_assignments a
        WHERE a.staff_id = NULLIF(current_setting('kuncho.bot_staff', true), '')::uuid
          AND a.project_id = p_project AND a.active
       UNION ALL
       SELECT 1 FROM projects p
        WHERE p.id = p_project
          AND p.project_manager_id = NULLIF(current_setting('kuncho.bot_staff', true), '')::uuid) $$;

CREATE OR REPLACE FUNCTION public.can_run_labour_site(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false)
      OR manages_project(p_project)
      OR is_site_foreman_for_project(p_project)
      OR bot_staff_runs_site(p_project);
$function$;

-- The timeline names a staff link by its person, as it names a login.
CREATE OR REPLACE FUNCTION public.log_labour_event(p_req uuid, p_kind text, p_body text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  INSERT INTO labour_request_events (labor_requisition_id, kind, body, actor, actor_name)
  VALUES (p_req, p_kind, NULLIF(btrim(p_body), ''), auth.uid(),
          COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), NULLIF(current_setting('kuncho.bot_name', true), '')));
$function$;

DO $patch$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.record_labour_day(uuid, date, jsonb)'::regprocedure);
  IF position('kuncho.bot_name' IN d) > 0 THEN RETURN; END IF;
  n := regexp_replace(d,
    'v_name\s+text := \(SELECT full_name FROM user_profiles WHERE id = auth\.uid\(\)\);',
    'v_name  text := COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), NULLIF(current_setting(''kuncho.bot_name'', true), ''''));');
  IF n = d THEN RAISE EXCEPTION 'record_labour_day: the recorder''s name line was not found'; END IF;
  EXECUTE n;
END $patch$;

-- A work order the bot opens for someone without a login is written by the
-- service role on their behalf; anyone else still has to be signed in.
DO $patch$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.derive_task_progress_from_work_orders()'::regprocedure);
  IF position('notify_is_service()' IN d) > 0 THEN RETURN; END IF;
  n := replace(d, 'IF auth.uid() IS NULL THEN', 'IF auth.uid() IS NULL AND NOT notify_is_service() THEN');
  IF n = d THEN RAISE EXCEPTION 'derive_task_progress_from_work_orders: the sign-in check was not found'; END IF;
  EXECUTE n;
END $patch$;

-- What a person may do from the bot.
CREATE OR REPLACE FUNCTION bot_can_ask_labour(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'project_manager', 'operations_manager', 'hr_officer'), false)
      OR (auth.uid() IS NOT NULL AND (is_site_foreman_for_project(p_project) OR manages_project(p_project)))
      OR bot_staff_runs_site(p_project) $$;

CREATE OR REPLACE FUNCTION bot_on_a_site(p_actor jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(p_actor->>'role' IN ('admin', 'executive', 'project_manager', 'operations_manager', 'hr_officer'), false)
      OR EXISTS (SELECT 1 FROM staff_assignments a WHERE a.staff_id = NULLIF(p_actor->>'staff_id', '')::uuid AND a.active)
      OR EXISTS (SELECT 1 FROM projects p WHERE p.project_manager_id = NULLIF(p_actor->>'staff_id', '')::uuid AND p.handed_over_at IS NULL) $$;

CREATE OR REPLACE FUNCTION bot_can_truck(p_actor jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT bot_on_a_site(p_actor) OR COALESCE(p_actor->>'role' IN ('procurement_officer', 'logistics_officer', 'finance'), false) $$;

CREATE OR REPLACE FUNCTION bot_is_driver(p_actor jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_actor->>'staff_role' ILIKE 'driver%', false) $$;

CREATE OR REPLACE FUNCTION bot_is_dispatcher(p_actor jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_actor->>'role' IN ('admin', 'logistics_officer', 'operations_manager'), false) $$;

CREATE OR REPLACE FUNCTION bot_is_labour_approver(p_actor jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_actor->>'role' IN ('admin', 'hr_officer', 'operations_manager'), false) $$;

CREATE OR REPLACE FUNCTION bot_is_finance(p_actor jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_actor->>'role' IN ('admin', 'finance'), false) $$;

-- ── 4. Lists the menus offer ────────────────────────────────────────────
-- The person's own sites first (manager of, assigned to), then — for the
-- office — the sites where something happened in the last six weeks.
CREATE OR REPLACE FUNCTION bot_sites(p_actor jsonb, p_limit integer DEFAULT 8, p_q text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (
    SELECT NULLIF(p_actor->>'staff_id', '')::uuid AS staff,
           COALESCE(p_actor->>'role' IN ('admin', 'executive', 'operations_manager', 'hr_officer',
             'procurement_officer', 'logistics_officer', 'finance'), false) AS office
  ), mine AS (
    SELECT p.id FROM projects p, me WHERE p.project_manager_id = me.staff
    UNION
    SELECT a.project_id FROM staff_assignments a, me WHERE a.staff_id = me.staff AND a.active AND a.project_id IS NOT NULL
  ), busy AS (
    SELECT project_id AS id, max(at) AS last_at FROM (
      SELECT project_id, created_at AS at FROM labor_requisitions WHERE created_at > now() - interval '45 days'
      UNION ALL SELECT project_id, created_at FROM orders WHERE created_at > now() - interval '45 days'
      UNION ALL SELECT project_id, created_at FROM expenses WHERE created_at > now() - interval '45 days'
    ) x WHERE project_id IS NOT NULL GROUP BY project_id
  ), pick AS (
    SELECT p.id, btrim(p.project_name) AS name, (p.id IN (SELECT id FROM mine)) AS own, b.last_at
    FROM projects p LEFT JOIN busy b ON b.id = p.id, me
    WHERE p.handed_over_at IS NULL AND NOT COALESCE(p.is_internal, false)
      AND (p.id IN (SELECT id FROM mine) OR (me.office AND (b.id IS NOT NULL OR p_q IS NOT NULL)))
      AND (p_q IS NULL OR p.project_name ILIKE '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%')
    ORDER BY own DESC, last_at DESC NULLS LAST, name
    LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY own DESC, last_at DESC NULLS LAST, name), '[]'::jsonb)
  FROM pick $$;

CREATE OR REPLACE FUNCTION bot_trades() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '["Daily labour", "Cleaner", "Painter", "Chiseler", "Mason", "Ceramic fixer", "Carpenter", "Electrician"]'::jsonb $$;

-- The usual day rate for the work, from past requests (rounded to 50).
CREATE OR REPLACE FUNCTION bot_rate_hint(p_trade text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH pat AS (
    SELECT CASE lower(btrim(p_trade))
      WHEN 'daily labour' THEN '(worker|labo|daily|general)'
      WHEN 'cleaner' THEN 'clean' WHEN 'painter' THEN 'paint' WHEN 'chiseler' THEN 'chisel'
      WHEN 'mason' THEN '(mason|meson)' WHEN 'ceramic fixer' THEN 'ceramic' WHEN 'carpenter' THEN 'carpent'
      WHEN 'electrician' THEN 'electric'
      ELSE '^' || regexp_replace(lower(btrim(p_trade)), '[^a-z0-9 ]', '', 'g') || '$' END AS re)
  SELECT COALESCE((round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.estimated_day_rate) / 50) * 50)::numeric, 800)
  FROM labor_requisitions r, pat
  WHERE r.payment_basis = 'per_day' AND r.estimated_day_rate BETWEEN 100 AND 10000
    AND lower(COALESCE(NULLIF(r.trade_tag, ''), r.role_needed)) ~ pat.re $$;

-- Purchase orders waiting to be collected: ordered or approved, no truck yet.
CREATE OR REPLACE FUNCTION bot_open_pos(p_actor jsonb, p_q text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (
    SELECT NULLIF(p_actor->>'staff_id', '')::uuid AS staff,
           COALESCE(p_actor->>'role' IN ('admin', 'executive', 'operations_manager', 'hr_officer',
             'procurement_officer', 'logistics_officer', 'finance'), false) AS office
  ), mine AS (
    SELECT p.id FROM projects p, me WHERE p.project_manager_id = me.staff
    UNION
    SELECT a.project_id FROM staff_assignments a, me WHERE a.staff_id = me.staff AND a.active AND a.project_id IS NOT NULL
  ), po AS (
    SELECT b.id, b.bundle_code, COALESCE(v.vendor_name, b.vendor_name) AS vendor, b.expected_delivery_date, b.created_at,
      (SELECT o.project_id FROM sourcing_bundle_items i
         JOIN order_items oi ON oi.id = i.order_item_id JOIN orders o ON o.id = oi.order_id
        WHERE i.bundle_id = b.id AND o.project_id IS NOT NULL
        GROUP BY o.project_id ORDER BY count(*) DESC LIMIT 1) AS project_id
    FROM sourcing_bundles b LEFT JOIN vendors v ON v.id = b.vendor_id
    WHERE b.status IN ('approved', 'ordered') AND b.created_at > now() - interval '120 days'
      AND NOT EXISTS (SELECT 1 FROM transportation_requests t WHERE t.sourcing_bundle_id = b.id AND t.job_status <> 'cancelled')
      AND (p_q IS NULL OR b.bundle_code ILIKE '%' || btrim(p_q) || '%' OR COALESCE(v.vendor_name, b.vendor_name) ILIKE '%' || btrim(p_q) || '%')
  ), pick AS (
    SELECT po.* FROM po, me
    WHERE me.office OR po.project_id IN (SELECT id FROM mine)
    ORDER BY po.expected_delivery_date NULLS LAST, po.created_at DESC
    LIMIT 8
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', k.id, 'project_id', k.project_id,
           'label', concat_ws(' · ', k.bundle_code, left(k.vendor, 26)) || COALESCE(' → ' || left(btrim(p.project_name), 22), ''))
         ORDER BY k.expected_delivery_date NULLS LAST, k.created_at DESC), '[]'::jsonb)
  FROM pick k LEFT JOIN projects p ON p.id = k.project_id $$;

-- People who worked this site before and aren't on the request yet; failing
-- that, casual workers recently on any site.
CREATE OR REPLACE FUNCTION bot_usual_crew(p_req uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH r AS (SELECT * FROM labor_requisitions WHERE id = p_req),
  seen AS (
    SELECT e.staff_id, max(e.work_date)::timestamptz AS at, 1 AS here FROM labour_work_entries e, r
     WHERE e.project_id = r.project_id AND e.staff_id IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT a.staff_id, max(a.created_at), 1 FROM labor_allocations a, r WHERE a.project_id = r.project_id GROUP BY 1
    UNION ALL
    SELECT w.staff_id, max(w.created_at), 1 FROM labor_expense_workers w JOIN expenses x ON x.id = w.expense_id, r
     WHERE x.project_id = r.project_id AND w.staff_id IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT a.staff_id, max(a.created_at), 0 FROM labor_allocations a WHERE a.created_at > now() - interval '60 days' GROUP BY 1
  ), ranked AS (
    SELECT s.id, s.employee_name AS name, max(seen.here) AS here, max(seen.at) AS last_at
    FROM seen JOIN staff s ON s.id = seen.staff_id
    WHERE COALESCE(s.status, 'active') = 'active'
      AND NOT EXISTS (SELECT 1 FROM labor_requisition_workers w WHERE w.requisition_id = p_req AND w.staff_id = s.id)
    GROUP BY s.id, s.employee_name
    ORDER BY max(seen.here) DESC, max(seen.at) DESC
    LIMIT 12
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'on', false) ORDER BY here DESC, last_at DESC), '[]'::jsonb)
  FROM ranked $$;

-- A site's day-rate crew for one day, from the same sheet the app records on.
-- Everyone starts ticked until something is recorded for the day.
CREATE OR REPLACE FUNCTION bot_crew_lines(p_project uuid, p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('req', d.labor_requisition_id, 'staff', d.staff_id, 'name', d.worker_name,
           'on', COALESCE(d.hours > 0, NOT EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.project_id = p_project AND e.work_date = p_date)),
           'locked', d.locked)
         ORDER BY d.worker_name), '[]'::jsonb)
  FROM labour_day_sheet(p_project, p_date) d
  WHERE d.payment_basis = 'per_day' AND d.staff_id IS NOT NULL $$;

-- ── 5. Threads and typed answers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_thread_new(p_actor jsonb, p_kind text, p_state jsonb, p_card text DEFAULT NULL, p_chat bigint DEFAULT NULL)
RETURNS bot_threads LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t bot_threads;
BEGIN
  INSERT INTO bot_threads (chat_id, kind, state, card_key, actor_user, actor_staff)
  VALUES (COALESCE(p_chat, (p_actor->>'chat')::bigint), p_kind, COALESCE(p_state, '{}'::jsonb), p_card,
          NULLIF(p_actor->>'user_id', '')::uuid, NULLIF(p_actor->>'staff_id', '')::uuid)
  RETURNING * INTO t;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION bot_thread_save(p_id uuid, p_kind text, p_state jsonb, p_close boolean DEFAULT false) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE bot_threads SET kind = p_kind, state = p_state, updated_at = now(),
         closed_at = CASE WHEN p_close THEN now() ELSE closed_at END
   WHERE id = p_id $$;

CREATE OR REPLACE FUNCTION bot_await(p_chat bigint, p_thread uuid, p_what text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO bot_chats (chat_id, awaiting_thread, awaiting, updated_at) VALUES (p_chat, p_thread, p_what, now())
  ON CONFLICT (chat_id) DO UPDATE SET awaiting_thread = EXCLUDED.awaiting_thread, awaiting = EXCLUDED.awaiting, updated_at = now() $$;

CREATE OR REPLACE FUNCTION bot_await_clear(p_chat bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE bot_chats SET awaiting_thread = NULL, awaiting = NULL, updated_at = now() WHERE chat_id = p_chat $$;

-- Show a view ({text, kb}) on the thread's message: edit it, or send it the
-- first time. p_fresh sends it as a new message below (after the person typed
-- something), taking the buttons off the old one.
CREATE OR REPLACE FUNCTION bot_show(t bot_threads, p_view jsonb, p_fresh boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF t.message_id IS NULL THEN
    RETURN bot_msg(t.chat_id, p_view->>'text', p_view->'kb', t.id);
  ELSIF p_fresh THEN
    RETURN bot_act('editMessageReplyMarkup', jsonb_build_object('chat_id', t.chat_id, 'message_id', t.message_id))
        || bot_msg(t.chat_id, p_view->>'text', p_view->'kb', t.id);
  END IF;
  RETURN bot_edit(t.chat_id, t.message_id, p_view->>'text', p_view->'kb');
END $$;

-- ── 6. The menu ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_menu_view(p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_n integer;
  v_url text := bot_url('/');
BEGIN
  IF bot_on_a_site(p_actor) THEN
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(bot_btn('👷 Workers', 'm:w'), bot_btn('🚚 Truck', 'm:t')))
                     || jsonb_build_array(jsonb_build_array(bot_btn('📋 Who worked today', 'm:c')));
  ELSIF bot_can_truck(p_actor) THEN
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(bot_btn('🚚 Truck', 'm:t')));
  END IF;
  IF bot_is_labour_approver(p_actor) OR bot_is_finance(p_actor) THEN
    SELECT (CASE WHEN bot_is_labour_approver(p_actor) THEN (SELECT count(*) FROM labor_requisitions WHERE status = 'pending') ELSE 0 END)
         + (CASE WHEN bot_is_finance(p_actor) THEN (SELECT count(*) FROM expenses WHERE spot_paid_by IS NOT NULL
               AND approval_status IN ('pending', 'manager_approved') AND spot_paid_by IS DISTINCT FROM NULLIF(p_actor->>'user_id', '')::uuid
               AND NOT COALESCE(is_archived, false)) ELSE 0 END)
      INTO v_n;
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(bot_btn('✅ To approve (' || v_n || ')', 'm:a')));
  END IF;
  IF bot_is_dispatcher(p_actor) THEN
    SELECT count(*) INTO v_n FROM transportation_requests WHERE created_via = 'telegram' AND job_status = 'requested';
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(bot_btn('🚚 Trucks to arrange (' || v_n || ')', 'm:k')));
  END IF;
  IF bot_is_driver(p_actor) THEN
    SELECT count(*) INTO v_n FROM transportation_requests
     WHERE assigned_staff_id = NULLIF(p_actor->>'staff_id', '')::uuid AND job_status IN ('assigned', 'in_progress');
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(bot_btn('🚗 My trips (' || v_n || ')', 'm:d')));
  END IF;
  IF p_actor->>'user_id' IS NOT NULL AND v_url IS NOT NULL THEN
    v_rows := v_rows || jsonb_build_array(jsonb_build_array(bot_btn('Open Kuncho', v_url)));
  END IF;
  IF jsonb_array_length(v_rows) = 0 THEN
    RETURN jsonb_build_object('text', 'Hi ' || bot_esc(p_actor->>'name') || '. You''re connected: your Kuncho notifications arrive here.');
  END IF;
  RETURN jsonb_build_object('text', 'Hi <b>' || bot_esc(p_actor->>'name') || '</b>. What do you need?', 'kb', bot_kb(v_rows));
END $$;

CREATE OR REPLACE FUNCTION bot_menu_new(p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t bot_threads;
BEGIN
  t := bot_thread_new(p_actor, 'menu', '{}'::jsonb);
  RETURN bot_show(t, bot_menu_view(p_actor));
END $$;

-- ── 7. Ask for workers ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_workers_view(s jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_head text;
  v_m numeric;
  v_start date;
  v_items jsonb;
BEGIN
  v_head := '👷 <b>Ask for workers</b>'
    || COALESCE(E'\nSite: ' || NULLIF(bot_esc(s->>'site_name'), ''), '')
    || COALESCE(E'\nWork: ' || NULLIF(bot_esc(s->>'trade'), ''), '')
    || CASE WHEN s->>'step' <> 'confirm' THEN
         COALESCE(E'\nPeople: ' || (s->>'n'), '') || COALESCE(E'\nDays: ' || (s->>'days'), '') ELSE '' END;

  IF s->>'step' = 'site' THEN
    SELECT jsonb_agg(bot_btn(left(x->>'name', 32), 'w:s:' || (i - 1)) ORDER BY i) INTO v_items
      FROM jsonb_array_elements(COALESCE(s->'sites', '[]'::jsonb)) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object(
      'text', v_head || E'\n\n' || CASE WHEN v_items IS NULL THEN 'You aren''t on a site yet. Find one by name:' ELSE 'Which site?' END,
      'kb', bot_kb(bot_grid(v_items, 2) || jsonb_build_array(jsonb_build_array(bot_btn('🔎 Another site', 'w:sf'), bot_btn('✖ Cancel', 'x')))));
  ELSIF s->>'step' = 'trade' THEN
    SELECT jsonb_agg(bot_btn(x #>> '{}', 'w:t:' || (i - 1)) ORDER BY i) INTO v_items
      FROM jsonb_array_elements(bot_trades()) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object('text', v_head || E'\n\nWhat work?',
      'kb', bot_kb(bot_grid(v_items, 2) || jsonb_build_array(jsonb_build_array(bot_btn('✏️ Something else', 'w:to'), bot_btn('◀ Back', 'w:bk')))));
  ELSIF s->>'step' = 'count' THEN
    SELECT jsonb_agg(bot_btn(v::text, 'w:n:' || v) ORDER BY v) INTO v_items FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 8, 10]) v;
    RETURN jsonb_build_object('text', v_head || E'\n\nHow many people?',
      'kb', bot_kb(bot_grid(v_items, 4) || jsonb_build_array(jsonb_build_array(bot_btn('Other number', 'w:no'), bot_btn('◀ Back', 'w:bk')))));
  ELSIF s->>'step' = 'days' THEN
    SELECT jsonb_agg(bot_btn(v::text, 'w:d:' || v) ORDER BY v) INTO v_items FROM unnest(ARRAY[1, 2, 3, 4, 5, 7, 10, 14]) v;
    RETURN jsonb_build_object('text', v_head || E'\n\nFor how many days?',
      'kb', bot_kb(bot_grid(v_items, 4) || jsonb_build_array(jsonb_build_array(bot_btn('Other number', 'w:do'), bot_btn('◀ Back', 'w:bk')))));
  ELSIF s->>'step' = 'rate' THEN
    v_m := bot_rate_hint(s->>'trade');
    SELECT jsonb_agg(bot_btn(bot_birr(v), 'w:r:' || v) ORDER BY v) INTO v_items
      FROM (SELECT DISTINCT v FROM unnest(ARRAY[GREATEST(v_m - 100, 100), v_m, v_m + 100]) v) z;
    RETURN jsonb_build_object('text', v_head || E'\n\nDay rate per person? Usually about ' || bot_birr(v_m) || ' for this work.',
      'kb', bot_kb(bot_grid(v_items, 3) || jsonb_build_array(jsonb_build_array(bot_btn('Other amount', 'w:ro'), bot_btn('◀ Back', 'w:bk')))));
  END IF;

  -- confirm
  v_start := CASE WHEN s->>'start' = 'today' THEN bot_today() ELSE bot_today() + 1 END;
  IF s->>'start' IS DISTINCT FROM 'today' AND extract(isodow FROM v_start) = 7 THEN v_start := v_start + 1; END IF;
  RETURN jsonb_build_object('text', v_head
      || E'\nCrew: ' || (s->>'n') || ' × ' || (s->>'days') || CASE WHEN s->>'days' = '1' THEN ' day × ' ELSE ' days × ' END || bot_birr((s->>'rate')::numeric)
      || E'\nTotal: <b>' || bot_birr((s->>'n')::numeric * (s->>'days')::numeric * (s->>'rate')::numeric) || '</b>'
      || E'\nStarts: ' || bot_day(v_start)
      || E'\n\nSend it for approval?',
    'kb', bot_kb(jsonb_build_array(
      jsonb_build_array(bot_btn('✅ Send for approval', 'w:ok')),
      jsonb_build_array(CASE WHEN s->>'start' = 'today' THEN bot_btn('📅 Start tomorrow', 'w:st') ELSE bot_btn('📅 Start today', 'w:st') END,
                        bot_btn('◀ Back', 'w:bk')),
      jsonb_build_array(bot_btn('✖ Cancel', 'x')))));
END $$;

-- A work order for the work on that site: the open one with the same name,
-- or a new one — so labour always lands on a job without anyone opening it.
CREATE OR REPLACE FUNCTION bot_work_order_for(p_project uuid, p_trade text, p_actor jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM work_orders
   WHERE project_id = p_project AND status IN ('requested', 'in_progress')
     AND lower(btrim(COALESCE(title, ''))) = lower(btrim(p_trade))
   ORDER BY created_at DESC LIMIT 1;
  IF v IS NULL THEN
    INSERT INTO work_orders (project_id, work_type, title, scope_of_work, requested_by, status)
    VALUES (p_project, 'site', btrim(p_trade),
            btrim(p_trade) || ' — opened from a Telegram request by ' || COALESCE(p_actor->>'name', 'someone'),
            NULLIF(p_actor->>'user_id', '')::uuid, 'requested')
    RETURNING id INTO v;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION bot_labour_create(p_actor jsonb, s jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_proj uuid := (s->>'site')::uuid;
  v_n integer := (s->>'n')::integer;
  v_days integer := (s->>'days')::integer;
  v_rate numeric := (s->>'rate')::numeric;
  v_start date := CASE WHEN s->>'start' = 'today' THEN bot_today() ELSE bot_today() + 1 END;
  v_id uuid;
BEGIN
  IF v_proj IS NULL OR v_n IS NULL OR v_days IS NULL OR v_rate IS NULL OR s->>'trade' IS NULL THEN
    RAISE EXCEPTION 'Something is missing — start again from /menu';
  END IF;
  IF NOT bot_can_ask_labour(v_proj) THEN RAISE EXCEPTION 'You can only ask for workers on your own sites'; END IF;
  IF s->>'start' IS DISTINCT FROM 'today' AND extract(isodow FROM v_start) = 7 THEN v_start := v_start + 1; END IF;
  INSERT INTO labor_requisitions (project_id, role_needed, headcount, start_date, end_date, payment_basis, payment_model,
    pay_cycle, estimated_day_rate, estimated_days, is_casual_or_new, requested_by,
    requested_by_staff_id, status, notes, created_via, work_order_id)
  VALUES (v_proj, btrim(s->>'trade'), v_n, v_start, v_start + (v_days - 1), 'per_day', 'individual',
    'weekly', v_rate, v_days, true, NULLIF(p_actor->>'user_id', '')::uuid,
    CASE WHEN p_actor->>'user_id' IS NULL THEN NULLIF(p_actor->>'staff_id', '')::uuid END, 'pending',
    'Asked in Telegram by ' || (p_actor->>'name'), 'telegram', bot_work_order_for(v_proj, s->>'trade', p_actor))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION bot_workers_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_i integer;
  v_prev text;
  v_id uuid;
  v_url text;
BEGIN
  IF p_data LIKE 'w:s:%' THEN
    v_i := split_part(p_data, ':', 3)::integer;
    IF s->'sites'->v_i IS NULL THEN RAISE EXCEPTION 'That site is no longer on the list — start again from /menu'; END IF;
    IF NOT bot_can_ask_labour((s->'sites'->v_i->>'id')::uuid) THEN
      RAISE EXCEPTION 'You can only ask for workers on your own sites';
    END IF;
    s := s || jsonb_build_object('site', s->'sites'->v_i->>'id', 'site_name', s->'sites'->v_i->>'name', 'step', 'trade');
  ELSIF p_data = 'w:sf' THEN
    PERFORM bot_await(t.chat_id, t.id, 'site_search');
    RETURN bot_edit(t.chat_id, t.message_id, '👷 <b>Ask for workers</b>' || E'\n\nType part of the site''s name.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('✖ Cancel', 'x')))));
  ELSIF p_data LIKE 'w:t:%' THEN
    s := s || jsonb_build_object('trade', bot_trades()->>split_part(p_data, ':', 3)::integer, 'step', 'count');
  ELSIF p_data = 'w:to' THEN
    PERFORM bot_await(t.chat_id, t.id, 'trade');
    RETURN bot_edit(t.chat_id, t.message_id, (bot_workers_view(s)->>'text') || E'\n\nType the work, for example: Gypsum fixer.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('◀ Back', 'w:bk'), bot_btn('✖ Cancel', 'x')))));
  ELSIF p_data LIKE 'w:n:%' THEN
    s := s || jsonb_build_object('n', split_part(p_data, ':', 3)::integer, 'step', 'days');
  ELSIF p_data = 'w:no' THEN
    PERFORM bot_await(t.chat_id, t.id, 'count');
    RETURN bot_edit(t.chat_id, t.message_id, (bot_workers_view(s)->>'text') || E'\n\nType the number of people.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('◀ Back', 'w:bk'), bot_btn('✖ Cancel', 'x')))));
  ELSIF p_data LIKE 'w:d:%' THEN
    s := s || jsonb_build_object('days', split_part(p_data, ':', 3)::integer, 'step', 'rate');
  ELSIF p_data = 'w:do' THEN
    PERFORM bot_await(t.chat_id, t.id, 'days');
    RETURN bot_edit(t.chat_id, t.message_id, (bot_workers_view(s)->>'text') || E'\n\nType the number of days.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('◀ Back', 'w:bk'), bot_btn('✖ Cancel', 'x')))));
  ELSIF p_data LIKE 'w:r:%' THEN
    s := s || jsonb_build_object('rate', split_part(p_data, ':', 3)::numeric, 'step', 'confirm');
  ELSIF p_data = 'w:ro' THEN
    PERFORM bot_await(t.chat_id, t.id, 'rate');
    RETURN bot_edit(t.chat_id, t.message_id, (bot_workers_view(s)->>'text') || E'\n\nType the day rate in birr.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('◀ Back', 'w:bk'), bot_btn('✖ Cancel', 'x')))));
  ELSIF p_data = 'w:st' THEN
    s := s || jsonb_build_object('start', CASE WHEN s->>'start' = 'today' THEN 'tomorrow' ELSE 'today' END);
  ELSIF p_data = 'w:bk' THEN
    v_prev := CASE s->>'step' WHEN 'trade' THEN 'site' WHEN 'count' THEN 'trade' WHEN 'days' THEN 'count'
                              WHEN 'rate' THEN 'days' WHEN 'confirm' THEN 'rate' ELSE 'site' END;
    s := s || jsonb_build_object('step', v_prev);
  ELSIF p_data = 'w:ok' THEN
    v_id := bot_labour_create(p_actor, s);
    PERFORM bot_thread_save(t.id, 'workers', s || jsonb_build_object('req', v_id), true);
    v_url := bot_url('/labour/' || v_id);
    RETURN bot_edit(t.chat_id, t.message_id,
      '✅ <b>Sent for approval</b>' || E'\n' || bot_esc(s->>'site_name') || ' · ' || bot_esc(s->>'trade')
      || E'\n' || (s->>'n') || ' × ' || (s->>'days') || CASE WHEN s->>'days' = '1' THEN ' day × ' ELSE ' days × ' END || bot_birr((s->>'rate')::numeric)
      || E'\n\nI''ll message you when it''s decided.',
      CASE WHEN v_url IS NOT NULL THEN bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('Open in Kuncho', v_url)))) END);
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  PERFORM bot_thread_save(t.id, 'workers', s);
  t.state := s;
  RETURN bot_show(t, bot_workers_view(s));
END $$;

CREATE OR REPLACE FUNCTION bot_workers_text(t bot_threads, p_what text, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_num numeric;
  v_sites jsonb;
BEGIN
  IF p_what = 'site_search' THEN
    v_sites := bot_sites(p_actor, 8, p_text);
    IF jsonb_array_length(v_sites) = 0 THEN
      RETURN bot_msg(t.chat_id, 'No site you can ask for matches “' || bot_esc(left(p_text, 40)) || '”. Try another word.');
    END IF;
    s := s || jsonb_build_object('sites', v_sites, 'step', 'site');
  ELSIF p_what = 'trade' THEN
    s := s || jsonb_build_object('trade', left(btrim(p_text), 60), 'step', 'count');
  ELSE
    v_num := substring(replace(p_text, ',', '') FROM '[0-9]+(?:\.[0-9]+)?')::numeric;
    IF p_what = 'count' THEN
      IF v_num IS NULL OR v_num < 1 OR v_num > 300 OR v_num <> trunc(v_num) THEN
        RETURN bot_msg(t.chat_id, 'Send just the number of people, like 6.');
      END IF;
      s := s || jsonb_build_object('n', v_num::integer, 'step', 'days');
    ELSIF p_what = 'days' THEN
      IF v_num IS NULL OR v_num < 1 OR v_num > 120 OR v_num <> trunc(v_num) THEN
        RETURN bot_msg(t.chat_id, 'Send just the number of days, like 3.');
      END IF;
      s := s || jsonb_build_object('days', v_num::integer, 'step', 'rate');
    ELSIF p_what = 'rate' THEN
      IF v_num IS NULL OR v_num < 50 OR v_num > 20000 THEN
        RETURN bot_msg(t.chat_id, 'Send the day rate in birr, like 750.');
      END IF;
      s := s || jsonb_build_object('rate', round(v_num, 2), 'step', 'confirm');
    END IF;
  END IF;
  PERFORM bot_await_clear(t.chat_id);
  PERFORM bot_thread_save(t.id, 'workers', s);
  t.state := s;
  RETURN bot_show(t, bot_workers_view(s), true);
END $$;

-- ── 8. Labour approval cards, and what happens after the decision ──────
CREATE OR REPLACE FUNCTION bot_labour_card_text(r labor_requisitions) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT '👷 <b>Labour request</b>' || E'\n' || bot_esc(btrim(p.project_name)) || ' · ' || bot_esc(btrim(r.role_needed))
    || E'\n' || r.headcount || CASE WHEN r.headcount = 1 THEN ' person' ELSE ' people' END
    || CASE r.payment_basis
         WHEN 'per_day' THEN
           CASE WHEN r.estimated_days IS NOT NULL AND r.estimated_day_rate IS NOT NULL
                THEN ' × ' || rtrim(to_char(r.estimated_days, 'FM999990.##'), '.') || CASE WHEN r.estimated_days = 1 THEN ' day × ' ELSE ' days × ' END || bot_birr(r.estimated_day_rate)
                     || ' = <b>' || bot_birr(r.headcount * r.estimated_days * r.estimated_day_rate) || '</b>'
                ELSE COALESCE(' at ' || bot_birr(r.estimated_day_rate) || ' a day', '') END
         WHEN 'fixed_price' THEN ' · fixed price ' || bot_birr(r.fixed_price_amount)
         ELSE COALESCE(' · ' || bot_birr(r.unit_rate) || ' per ' || bot_esc(r.volume_unit), '') END
    || E'\nStarts ' || bot_day(r.start_date)
    || E'\nAsked by ' || bot_esc(COALESCE(
         (SELECT full_name FROM user_profiles WHERE id = r.requested_by),
         (SELECT employee_name FROM staff WHERE id = r.requested_by_staff_id), 'someone'))
    || CASE WHEN r.created_via = 'telegram' THEN ' (in Telegram)' ELSE '' END
  FROM projects p WHERE p.id = r.project_id $$;

CREATE OR REPLACE FUNCTION bot_labour_card_kb(p_req uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT bot_kb(jsonb_build_array(
    jsonb_build_array(bot_btn('✅ Approve', 'lr:a'), bot_btn('✖ Reject', 'lr:r')),
    jsonb_build_array(bot_btn('Open in Kuncho', bot_url('/labour/' || p_req))))) $$;

-- Send a request's card to one approver.
CREATE OR REPLACE FUNCTION bot_labour_card_to(r labor_requisitions, p_user uuid, p_chat bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t bot_threads;
BEGIN
  UPDATE bot_threads SET closed_at = now() WHERE chat_id = p_chat AND card_key = 'lr:' || r.id AND closed_at IS NULL;
  t := bot_thread_new(jsonb_build_object('chat', p_chat, 'user_id', p_user), 'lr_card', jsonb_build_object('req', r.id), 'lr:' || r.id);
  PERFORM bot_queue(bot_msg(p_chat, bot_labour_card_text(r), bot_labour_card_kb(r.id), t.id));
END $$;

CREATE OR REPLACE FUNCTION trg_bot_labour_requested() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_users uuid[];
  v_carded uuid[] := '{}';
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NULL; END IF;
  SELECT array_agg(id) INTO v_users FROM user_profiles
   WHERE role::text IN ('admin', 'hr_officer', 'operations_manager') AND account_status = 'active'
     AND id IS DISTINCT FROM NEW.requested_by;
  IF bot_ready() THEN
    FOR u IN SELECT np.user_id, np.telegram_chat_id AS chat FROM notification_prefs np
              WHERE np.user_id = ANY (v_users) AND np.telegram_chat_id IS NOT NULL LOOP
      PERFORM bot_labour_card_to(NEW, u.user_id, u.chat);
      v_carded := v_carded || u.user_id;
    END LOOP;
  END IF;
  PERFORM bot_notify(v_users, 'labour.requested',
    'Labour to approve: ' || COALESCE((SELECT btrim(project_name) FROM projects WHERE id = NEW.project_id), 'a site') || ' · ' || NEW.role_needed,
    NEW.headcount || ' people from ' || to_char(NEW.start_date, 'DD Mon'), '/labour/' || NEW.id, 'labor_requisition', NEW.id, v_carded);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'labour request card: %', SQLERRM;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_bot_labour_requested AFTER INSERT ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION trg_bot_labour_requested();

CREATE OR REPLACE FUNCTION trg_bot_labour_decided() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  th record;
  v_who text;
  v_text text;
  v_chat bigint;
  t bot_threads;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('approved', 'rejected') THEN RETURN NULL; END IF;
  v_who := COALESCE((SELECT full_name FROM user_profiles WHERE id = COALESCE(CASE WHEN NEW.status = 'approved' THEN NEW.approved_by END, auth.uid())),
                    NULLIF(current_setting('kuncho.bot_name', true), ''), 'the office');
  v_text := bot_labour_card_text(NEW) || E'\n\n'
    || CASE WHEN NEW.status = 'approved' THEN '✅ Approved by ' || bot_esc(v_who)
            ELSE '✖ Not approved' || COALESCE(': ' || bot_esc(NULLIF(btrim(NEW.decision_note), '')), '') || ' (' || bot_esc(v_who) || ')' END;
  -- Every card about it shows the decision instead of the buttons.
  FOR th IN SELECT id, chat_id, message_id FROM bot_threads WHERE card_key = 'lr:' || NEW.id AND closed_at IS NULL LOOP
    IF th.message_id IS NOT NULL THEN PERFORM bot_queue(bot_edit(th.chat_id, th.message_id, v_text)); END IF;
    UPDATE bot_threads SET closed_at = now() WHERE id = th.id;
  END LOOP;

  -- Whoever asked: approved, and now who is coming.
  v_chat := COALESCE(bot_chat_of_user(NEW.requested_by), bot_chat_of_staff(NEW.requested_by_staff_id));
  IF v_chat IS NOT NULL AND bot_ready() THEN
    IF NEW.status = 'approved' THEN
      t := bot_thread_new(jsonb_build_object('chat', v_chat, 'user_id', NEW.requested_by, 'staff_id', NEW.requested_by_staff_id),
                          'lr_next', jsonb_build_object('req', NEW.id));
      PERFORM bot_queue(bot_msg(v_chat, v_text || E'\n\nWho is coming? Add them, then you can tick who worked each day.',
        bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('👥 From the usual crew', 'aw:c'), bot_btn('✏️ Someone new', 'aw:n')),
                                 jsonb_build_array(bot_btn('Later', 'aw:d')))), t.id));
    ELSE
      PERFORM bot_queue(bot_msg(v_chat, v_text));
    END IF;
  END IF;
  IF NEW.requested_by IS NOT NULL THEN
    PERFORM bot_notify(ARRAY[NEW.requested_by], 'labour.decided',
      CASE WHEN NEW.status = 'approved' THEN 'Approved: ' ELSE 'Not approved: ' END
        || COALESCE((SELECT btrim(project_name) FROM projects WHERE id = NEW.project_id), 'a site') || ' · ' || NEW.role_needed,
      CASE WHEN NEW.status = 'approved' THEN 'Add the workers who are coming' ELSE NULLIF(btrim(NEW.decision_note), '') END,
      '/labour/' || NEW.id, 'labor_requisition', NEW.id,
      CASE WHEN v_chat IS NOT NULL THEN ARRAY[NEW.requested_by] ELSE '{}'::uuid[] END);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'labour decision cards: %', SQLERRM;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_bot_labour_decided AFTER UPDATE OF status ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION trg_bot_labour_decided();

CREATE OR REPLACE FUNCTION bot_reasons() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '["Not needed now", "Too many people", "The rate is too high", "Use our own staff"]'::jsonb $$;

CREATE OR REPLACE FUNCTION bot_labour_reject(p_req uuid, p_reason text, p_actor jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT bot_is_labour_approver(p_actor) THEN RAISE EXCEPTION 'Only operations, HR or admin can decide labour requests'; END IF;
  UPDATE labor_requisitions SET status = 'rejected', decision_note = left(btrim(p_reason), 300)
   WHERE id = p_req AND status = 'pending';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION bot_lr_card_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_req uuid := (t.state->>'req')::uuid;
  r labor_requisitions;
  v_items jsonb;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = v_req;
  IF NOT FOUND THEN RETURN bot_answer(NULL, 'That request is gone.'); END IF;
  IF p_data = 'lr:a' THEN
    IF NOT bot_is_labour_approver(p_actor) THEN RAISE EXCEPTION 'Only operations, HR or admin can approve labour'; END IF;
    UPDATE labor_requisitions SET status = 'approved' WHERE id = v_req AND status = 'pending';
    IF NOT FOUND THEN RETURN bot_edit(t.chat_id, t.message_id, bot_labour_card_text(r) || E'\n\nAlready decided.'); END IF;
    RETURN '[]'::jsonb;  -- the decision edits every card (see the trigger)
  ELSIF p_data = 'lr:r' THEN
    SELECT jsonb_agg(bot_btn(x #>> '{}', 'lr:rr:' || (i - 1)) ORDER BY i) INTO v_items FROM jsonb_array_elements(bot_reasons()) WITH ORDINALITY e(x, i);
    RETURN bot_edit(t.chat_id, t.message_id, bot_labour_card_text(r) || E'\n\nWhy not?',
      bot_kb(bot_grid(v_items, 2) || jsonb_build_array(jsonb_build_array(bot_btn('✏️ Type a reason', 'lr:rt'), bot_btn('◀ Back', 'lr:bk')))));
  ELSIF p_data LIKE 'lr:rr:%' THEN
    IF NOT bot_labour_reject(v_req, bot_reasons()->>split_part(p_data, ':', 3)::integer, p_actor) THEN
      RETURN bot_edit(t.chat_id, t.message_id, bot_labour_card_text(r) || E'\n\nAlready decided.');
    END IF;
    RETURN '[]'::jsonb;
  ELSIF p_data = 'lr:rt' THEN
    PERFORM bot_await(t.chat_id, t.id, 'reject_reason');
    RETURN bot_edit(t.chat_id, t.message_id, bot_labour_card_text(r) || E'\n\nType the reason.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('◀ Back', 'lr:bk')))));
  ELSIF p_data = 'lr:bk' THEN
    RETURN bot_edit(t.chat_id, t.message_id, bot_labour_card_text(r), bot_labour_card_kb(v_req));
  END IF;
  RETURN '[]'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION bot_lr_reason_text(t bot_threads, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM bot_await_clear(t.chat_id);
  IF bot_labour_reject((t.state->>'req')::uuid, p_text, p_actor) THEN
    RETURN bot_msg(t.chat_id, 'Rejected, with your reason.');
  END IF;
  RETURN bot_msg(t.chat_id, 'That request was already decided.');
END $$;

-- ── 9. Adding the crew to an approved request ─────────────────────────
CREATE OR REPLACE FUNCTION bot_aw_view(s jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_items jsonb;
  v_on integer;
  v_head text;
BEGIN
  SELECT bot_esc(btrim(p.project_name)) || ' · ' || bot_esc(r.role_needed)
         || E'\nOn it now: ' || (SELECT count(*) FROM labor_requisition_workers w WHERE w.requisition_id = r.id)
         || ' of ' || r.headcount
    INTO v_head FROM labor_requisitions r JOIN projects p ON p.id = r.project_id WHERE r.id = (s->>'req')::uuid;
  SELECT jsonb_agg(bot_btn(CASE WHEN (x->>'on')::boolean THEN '✅ ' ELSE '⬜ ' END || left(x->>'name', 24), 'aw:' || (i - 1)) ORDER BY i),
         count(*) FILTER (WHERE (x->>'on')::boolean)
    INTO v_items, v_on
    FROM jsonb_array_elements(COALESCE(s->'crew', '[]'::jsonb)) WITH ORDINALITY e(x, i);
  v_head := '👥 <b>Add the crew</b>' || E'\n' || COALESCE(v_head, '')
      || CASE WHEN COALESCE(s->>'added', '') <> '' THEN E'\nJust added: ' || bot_esc(s->>'added') ELSE '' END;
  RETURN jsonb_build_object(
    'head', v_head,
    'text', v_head || E'\n\n' || CASE WHEN v_items IS NULL THEN 'Nobody from before to pick. Add someone new.' ELSE 'Tap who is coming, then Add.' END,
    'kb', bot_kb(bot_grid(v_items, 2) || jsonb_build_array(
      CASE WHEN COALESCE(v_on, 0) > 0 THEN jsonb_build_array(bot_btn('➕ Add ' || v_on, 'aw:ok')) ELSE '[]'::jsonb END,
      jsonb_build_array(bot_btn('✏️ Someone new', 'aw:n'), bot_btn('✔ Done', 'aw:d')))));
END $$;

CREATE OR REPLACE FUNCTION bot_aw_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_i integer;
  x jsonb;
  v_names text[] := '{}';
BEGIN
  IF p_data = 'aw:c' THEN
    s := s || jsonb_build_object('crew', bot_usual_crew((s->>'req')::uuid));
  ELSIF p_data = 'aw:n' THEN
    PERFORM bot_await(t.chat_id, t.id, 'new_worker');
    PERFORM bot_thread_save(t.id, 'add_workers', s);
    RETURN bot_edit(t.chat_id, t.message_id, (bot_aw_view(s)->>'head') || E'\n\nSend the name and phone number, like:\n<code>Abebe Kebede 0911234567</code>\nSeveral people? One per line.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('✔ Done', 'aw:d')))));
  ELSIF p_data = 'aw:d' THEN
    PERFORM bot_thread_save(t.id, 'add_workers', s, true);
    RETURN bot_edit(t.chat_id, t.message_id, (bot_aw_view(s)->>'head') || E'\n\nDone. Tick who worked from 📋 Who worked today (/menu).');
  ELSIF p_data = 'aw:ok' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(s->'crew', '[]'::jsonb)) LOOP
      IF (x->>'on')::boolean THEN
        PERFORM labour_add_worker((s->>'req')::uuid, (x->>'id')::uuid);
        v_names := v_names || (x->>'name');
      END IF;
    END LOOP;
    s := s || jsonb_build_object('crew', bot_usual_crew((s->>'req')::uuid), 'added', array_to_string(v_names, ', '));
  ELSIF p_data ~ '^aw:[0-9]+$' THEN
    v_i := split_part(p_data, ':', 2)::integer;
    IF s->'crew'->v_i IS NOT NULL THEN
      s := jsonb_set(s, ARRAY['crew', v_i::text, 'on'], to_jsonb(NOT COALESCE((s->'crew'->v_i->>'on')::boolean, false)));
    END IF;
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  PERFORM bot_thread_save(t.id, 'add_workers', s);
  RETURN bot_show(t, bot_aw_view(s));
END $$;

-- "Abebe Kebede 0911234567", one person a line.
CREATE OR REPLACE FUNCTION bot_aw_text(t bot_threads, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_line text;
  v_phone text;
  v_name text;
  v_done text[] := '{}';
  v_bad text[] := '{}';
BEGIN
  FOREACH v_line IN ARRAY regexp_split_to_array(p_text, E'\\s*\\n\\s*') LOOP
    CONTINUE WHEN btrim(v_line) = '';
    v_phone := substring(regexp_replace(v_line, '[\s-]', '', 'g') FROM '((?:\+?251|0)?[79][0-9]{8})');
    v_name := btrim(regexp_replace(regexp_replace(v_line, '(\+?251|0)?[79][0-9 -]{8,11}', '', 'g'), '\s+', ' ', 'g'), ' ,.-');
    IF v_name = '' OR length(v_name) < 2 THEN
      v_bad := v_bad || btrim(v_line);
      CONTINUE;
    END IF;
    PERFORM labour_add_new_worker((s->>'req')::uuid, v_name, v_phone, NULL);
    v_done := v_done || (v_name || COALESCE(' (' || v_phone || ')', ''));
  END LOOP;
  s := s || jsonb_build_object('added', array_to_string(v_done, ', '), 'crew', bot_usual_crew((s->>'req')::uuid));
  PERFORM bot_thread_save(t.id, 'add_workers', s);
  t.state := s;
  RETURN bot_show(t, jsonb_build_object(
      'text', (bot_aw_view(s)->>'head')
        || CASE WHEN cardinality(v_bad) > 0 THEN E'\n\nI couldn''t read: ' || bot_esc(array_to_string(v_bad, '; ')) || '. Send a name, then the phone.' ELSE '' END
        || E'\n\nSend more names, or tap Done.',
      'kb', bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('✔ Done', 'aw:d'))))), true);
END $$;

-- ── 10. Who worked today ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_crew_view(s jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_items jsonb;
  v_on integer;
  v_all integer;
BEGIN
  IF s->>'step' = 'site' THEN
    SELECT jsonb_agg(bot_btn(left(x->>'name', 32), 'c:s:' || (i - 1)) ORDER BY i) INTO v_items
      FROM jsonb_array_elements(COALESCE(s->'sites', '[]'::jsonb)) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object('text', '📋 <b>Who worked today</b>' || E'\n\nWhich site?',
      'kb', bot_kb(bot_grid(v_items, 2) || jsonb_build_array(jsonb_build_array(bot_btn('✖ Cancel', 'x')))));
  END IF;
  SELECT jsonb_agg(bot_btn(CASE WHEN COALESCE((x->>'locked')::boolean, false) THEN '🔒 '
                                WHEN (x->>'on')::boolean THEN '✅ ' ELSE '⬜ ' END || left(x->>'name', 24),
                           CASE WHEN COALESCE((x->>'locked')::boolean, false) THEN 'c:l' ELSE 'c:' || (i - 1) END) ORDER BY i),
         count(*) FILTER (WHERE (x->>'on')::boolean), count(*)
    INTO v_items, v_on, v_all
    FROM jsonb_array_elements(COALESCE(s->'lines', '[]'::jsonb)) WITH ORDINALITY e(x, i);
  IF COALESCE(v_all, 0) = 0 THEN
    RETURN jsonb_build_object('text', '📋 <b>' || bot_esc(s->>'project_name') || '</b>'
        || E'\n\nNobody to tick: there''s no approved day-rate request with workers on it today.',
      'kb', bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('👷 Ask for workers', 'm:w'), bot_btn('✖ Close', 'x')))));
  END IF;
  RETURN jsonb_build_object('text', '📋 Who worked at <b>' || bot_esc(s->>'project_name') || '</b> on ' || bot_day((s->>'date')::date) || '?'
      || E'\nTap a name to switch it: ✅ worked, ⬜ didn''t. A full day each.',
    'kb', bot_kb(bot_grid(v_items, 2) || jsonb_build_array(
      jsonb_build_array(bot_btn('💾 Save — ' || v_on || ' of ' || v_all, 'c:sv')),
      jsonb_build_array(bot_btn('➕ Add someone', 'c:add'), bot_btn('✖ Cancel', 'x')))));
END $$;

-- Sites that have a day-rate crew to tick today.
CREATE OR REPLACE FUNCTION bot_crew_sites(p_actor jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY i), '[]'::jsonb)
  FROM jsonb_array_elements(bot_sites(p_actor, 20)) WITH ORDINALITY e(x, i)
  WHERE EXISTS (
    SELECT 1 FROM labor_requisitions r
     WHERE r.project_id = (x->>'id')::uuid AND r.status = 'approved' AND r.closed_at IS NULL AND r.payment_basis = 'per_day'
       AND COALESCE(r.start_date, bot_today()) <= bot_today() AND (r.end_date IS NULL OR r.end_date >= bot_today() - 7)) $$;

CREATE OR REPLACE FUNCTION bot_crew_open(t bot_threads, p_project uuid, p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_date date := LEAST(bot_today(), CURRENT_DATE);
  s jsonb;
BEGIN
  IF NOT can_run_labour_site(p_project) THEN RAISE EXCEPTION 'Only the site''s team, operations or HR can record work there'; END IF;
  s := jsonb_build_object('step', 'sheet', 'project', p_project, 'project_name', p_name, 'date', v_date,
                          'lines', bot_crew_lines(p_project, v_date));
  PERFORM bot_thread_save(t.id, 'crew', s);
  t.state := s;
  RETURN bot_show(t, bot_crew_view(s));
END $$;

CREATE OR REPLACE FUNCTION bot_crew_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_i integer;
  v_entries jsonb;
  v_names text;
  v_reqs uuid[];
  a bot_threads;
BEGIN
  IF p_data LIKE 'c:s:%' THEN
    v_i := split_part(p_data, ':', 3)::integer;
    RETURN bot_crew_open(t, (s->'sites'->v_i->>'id')::uuid, s->'sites'->v_i->>'name');
  ELSIF p_data = 'c:l' THEN
    RETURN bot_answer(NULL, 'Already confirmed for pay — change it in the app.');
  ELSIF p_data ~ '^c:[0-9]+$' THEN
    v_i := split_part(p_data, ':', 2)::integer;
    IF s->'lines'->v_i IS NOT NULL THEN
      s := jsonb_set(s, ARRAY['lines', v_i::text, 'on'], to_jsonb(NOT COALESCE((s->'lines'->v_i->>'on')::boolean, false)));
    END IF;
  ELSIF p_data = 'c:sv' THEN
    SELECT jsonb_agg(jsonb_build_object('req', x->>'req', 'staff', x->>'staff', 'hours', CASE WHEN (x->>'on')::boolean THEN 8 ELSE 0 END)),
           string_agg(CASE WHEN (x->>'on')::boolean THEN x->>'name' END, ', ' ORDER BY x->>'name')
      INTO v_entries, v_names
      FROM jsonb_array_elements(s->'lines') x WHERE NOT COALESCE((x->>'locked')::boolean, false);
    PERFORM record_labour_day((s->>'project')::uuid, (s->>'date')::date, COALESCE(v_entries, '[]'::jsonb));
    UPDATE labour_work_entries SET recorded_via = 'telegram'
     WHERE project_id = (s->>'project')::uuid AND work_date = (s->>'date')::date AND recorded_at = now();
    PERFORM bot_thread_save(t.id, 'crew', s, true);
    RETURN bot_edit(t.chat_id, t.message_id, '✅ <b>Saved</b> — ' || bot_esc(s->>'project_name') || ', ' || bot_day((s->>'date')::date)
      || E'\n' || (SELECT count(*) FROM jsonb_array_elements(s->'lines') x WHERE (x->>'on')::boolean)
      || ' of ' || jsonb_array_length(s->'lines') || ' worked' || COALESCE(': ' || NULLIF(bot_esc(v_names), ''), '.'));
  ELSIF p_data = 'c:add' THEN
    -- The crew is added to a request on this site: the one ending last.
    SELECT array_agg(id ORDER BY end_date DESC NULLS FIRST, created_at DESC) INTO v_reqs FROM labor_requisitions
     WHERE project_id = (s->>'project')::uuid AND status = 'approved' AND closed_at IS NULL AND payment_basis = 'per_day';
    IF v_reqs IS NULL THEN RETURN bot_answer(NULL, 'There''s no approved request on this site to add people to.', true); END IF;
    a := bot_thread_new(p_actor, 'add_workers', jsonb_build_object('req', v_reqs[1], 'crew', bot_usual_crew(v_reqs[1])));
    RETURN bot_show(a, bot_aw_view(a.state));
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  PERFORM bot_thread_save(t.id, 'crew', s);
  RETURN bot_show(t, bot_crew_view(s));
END $$;

-- Every working evening: ask each site with a day-rate crew and nothing
-- recorded yet. The site foremen are asked; with none connected, the project
-- manager.
CREATE OR REPLACE FUNCTION bot_crew_push() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  pr record;
  r record;
  v_actor jsonb;
  v_lines jsonb;
  v_date date := LEAST(bot_today(), CURRENT_DATE);
  v_n integer := 0;
  t bot_threads;
BEGIN
  IF NOT bot_ready() THEN RETURN 0; END IF;
  FOR pr IN
    SELECT DISTINCT p.id, btrim(p.project_name) AS name, p.project_manager_id
    FROM labor_requisitions q JOIN projects p ON p.id = q.project_id
    WHERE q.status = 'approved' AND q.closed_at IS NULL AND q.payment_basis = 'per_day'
      AND COALESCE(q.start_date, v_date) <= v_date AND (q.end_date IS NULL OR q.end_date >= v_date)
      AND EXISTS (SELECT 1 FROM labor_allocations a WHERE a.labor_requisition_id = q.id AND a.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.project_id = p.id AND e.work_date = v_date)
  LOOP
    FOR r IN
      WITH team AS (
        SELECT a.staff_id, 1 AS pri FROM staff_assignments a JOIN staff s ON s.id = a.staff_id
         WHERE a.project_id = pr.id AND a.active AND (s.role = 'site_foreman' OR a.role ILIKE '%foreman%')
        UNION
        SELECT pr.project_manager_id, 2 WHERE pr.project_manager_id IS NOT NULL
      ), reach AS (
        SELECT bot_chat_of_staff(staff_id) AS chat, pri FROM team
      )
      SELECT DISTINCT chat FROM reach
       WHERE chat IS NOT NULL AND pri = (SELECT min(pri) FROM reach WHERE chat IS NOT NULL)
    LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM bot_threads WHERE chat_id = r.chat AND kind = 'crew'
                             AND state->>'project' = pr.id::text AND state->>'date' = v_date::text);
      v_actor := bot_actor(r.chat);
      CONTINUE WHEN v_actor IS NULL;
      PERFORM bot_become(v_actor);
      v_lines := bot_crew_lines(pr.id, v_date);
      CONTINUE WHEN jsonb_array_length(v_lines) = 0;
      t := bot_thread_new(v_actor, 'crew', jsonb_build_object('step', 'sheet', 'project', pr.id, 'project_name', pr.name,
                          'date', v_date, 'lines', v_lines, 'evening', true));
      PERFORM bot_queue(bot_show(t, bot_crew_view(t.state)));
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;

-- ── 11. Ask for a truck ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_when_label(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'now' THEN 'Now' WHEN 'pm' THEN 'This afternoon' WHEN 'tam' THEN 'Tomorrow morning'
                WHEN 'tpm' THEN 'Tomorrow afternoon' ELSE p END $$;

CREATE OR REPLACE FUNCTION bot_truck_view(s jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_head text := '🚚 <b>Ask for a truck</b>'
    || COALESCE(E'\n' || NULLIF(bot_esc(s->>'po_label'), ''), '')
    || COALESCE(E'\nMove: ' || NULLIF(bot_esc(s->>'desc'), ''), '')
    || COALESCE(E'\nFor: ' || NULLIF(bot_esc(s->>'site_name'), ''), '')
    || COALESCE(E'\nWhen: ' || bot_when_label(s->>'when'), '');
  v_items jsonb;
BEGIN
  IF s->>'step' = 'what' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\nWhat is it for?',
      'kb', bot_kb(jsonb_build_array(
        jsonb_build_array(bot_btn('📦 Collect a purchase order', 'k:po')),
        jsonb_build_array(bot_btn('✏️ Something else', 'k:o')),
        jsonb_build_array(bot_btn('✖ Cancel', 'x')))));
  ELSIF s->>'step' = 'po' THEN
    SELECT jsonb_agg(bot_btn(left(x->>'label', 60), 'k:p:' || (i - 1)) ORDER BY i) INTO v_items
      FROM jsonb_array_elements(COALESCE(s->'pos', '[]'::jsonb)) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object('text', v_head || E'\n\n'
        || CASE WHEN v_items IS NULL THEN 'No purchase orders are waiting to be collected for your sites.' ELSE 'Which purchase order?' END,
      'kb', bot_kb(bot_grid(v_items, 1) || jsonb_build_array(
        jsonb_build_array(bot_btn('🔎 Find by code or supplier', 'k:pf')),
        jsonb_build_array(bot_btn('✏️ Something else', 'k:o'), bot_btn('◀ Back', 'k:bk')))));
  ELSIF s->>'step' = 'site' THEN
    SELECT jsonb_agg(bot_btn(left(x->>'name', 32), 'k:s:' || (i - 1)) ORDER BY i) INTO v_items
      FROM jsonb_array_elements(COALESCE(s->'sites', '[]'::jsonb)) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object('text', v_head || E'\n\nWhich site is it for?',
      'kb', bot_kb(bot_grid(v_items, 2) || jsonb_build_array(
        jsonb_build_array(bot_btn('Not for a site', 'k:s:-')),
        jsonb_build_array(bot_btn('◀ Back', 'k:bk'), bot_btn('✖ Cancel', 'x')))));
  ELSIF s->>'step' = 'when' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\nWhen?',
      'kb', bot_kb(jsonb_build_array(
        jsonb_build_array(bot_btn('Now', 'k:w:now'), bot_btn('This afternoon', 'k:w:pm')),
        jsonb_build_array(bot_btn('Tomorrow morning', 'k:w:tam'), bot_btn('Tomorrow afternoon', 'k:w:tpm')),
        jsonb_build_array(bot_btn('◀ Back', 'k:bk'), bot_btn('✖ Cancel', 'x')))));
  END IF;
  RETURN jsonb_build_object('text', v_head || E'\n\nSend it to logistics?',
    'kb', bot_kb(jsonb_build_array(
      jsonb_build_array(bot_btn('✅ Send', 'k:ok')),
      jsonb_build_array(bot_btn('◀ Back', 'k:bk'), bot_btn('✖ Cancel', 'x')))));
END $$;

CREATE OR REPLACE FUNCTION bot_trip_card_text(tr transportation_requests, p_when text DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT '🚚 <b>' || bot_esc(COALESCE(tr.request_name, 'A trip')) || '</b>'
    || COALESCE(E'\nFrom: ' || NULLIF(bot_esc(COALESCE(tr.pickup_location_text, tr.vendor_name)), ''), '')
    || COALESCE(E'\nTo: ' || NULLIF(bot_esc(COALESCE(tr.dropoff_location_text, (SELECT btrim(project_name) FROM projects WHERE id = tr.project_id))), ''), '')
    || E'\nWhen: ' || COALESCE(bot_when_label(p_when),
         CASE WHEN tr.priority <> 'normal' THEN 'As soon as possible'
              ELSE bot_day(COALESCE(tr.expected_delivery_date, tr.requested_date))
                   || COALESCE(', ' || substring(tr.notes FROM 'When: (?:This |Tomorrow )?(morning|afternoon)'), '') END)
    || COALESCE(E'\nAsked by ' || NULLIF(bot_esc(COALESCE(
         (SELECT full_name FROM user_profiles WHERE id = tr.requested_by_id),
         (SELECT employee_name FROM staff WHERE id = tr.requested_by_staff_id))), ''), '') $$;

-- Our drivers, each with their own vehicle where they have one.
CREATE OR REPLACE FUNCTION bot_own_drivers() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('staff', id, 'name', name, 'vehicle', vehicle) ORDER BY name), '[]'::jsonb) FROM (
    SELECT s.id, s.employee_name AS name,
           (SELECT v.id FROM vehicles v WHERE v.assigned_driver_id = s.id AND COALESCE(v.active, true) ORDER BY v.created_at LIMIT 1) AS vehicle
    FROM staff s WHERE s.role ILIKE 'driver%' AND COALESCE(s.status, 'active') = 'active'
    ORDER BY s.employee_name LIMIT 8) d $$;

CREATE OR REPLACE FUNCTION bot_assign_kb(p_drivers jsonb, p_trip uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT bot_kb(bot_grid((SELECT jsonb_agg(bot_btn('🚗 ' || left(x->>'name', 20), 'as:' || (i - 1)) ORDER BY i)
                           FROM jsonb_array_elements(p_drivers) WITH ORDINALITY e(x, i)), 2)
    || jsonb_build_array(jsonb_build_array(bot_btn('🚕 Hire one', 'as:h')),
                         jsonb_build_array(bot_btn('Open in Kuncho', bot_url('/transportation/' || p_trip || '/edit'))))) $$;

-- Logistics (or, with nobody in logistics connected, admin) gets the trip to arrange.
CREATE OR REPLACE FUNCTION bot_trip_cards(p_trip uuid, p_when text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tr transportation_requests;
  u record;
  v_users uuid[];
  v_carded uuid[] := '{}';
  v_drivers jsonb := bot_own_drivers();
  t bot_threads;
BEGIN
  SELECT * INTO tr FROM transportation_requests WHERE id = p_trip;
  SELECT array_agg(id) INTO v_users FROM user_profiles WHERE role::text = 'logistics_officer' AND account_status = 'active';
  IF bot_ready() THEN
    FOR u IN
      SELECT np.user_id, np.telegram_chat_id AS chat FROM notification_prefs np JOIN user_profiles up ON up.id = np.user_id
       WHERE np.telegram_chat_id IS NOT NULL AND up.account_status = 'active'
         AND (up.role::text = 'logistics_officer'
              OR (up.role::text = 'admin' AND NOT EXISTS (
                    SELECT 1 FROM notification_prefs n2 JOIN user_profiles u2 ON u2.id = n2.user_id
                     WHERE u2.role::text = 'logistics_officer' AND u2.account_status = 'active' AND n2.telegram_chat_id IS NOT NULL)))
         AND np.user_id IS DISTINCT FROM tr.requested_by_id
    LOOP
      t := bot_thread_new(jsonb_build_object('chat', u.chat, 'user_id', u.user_id), 'assign',
                          jsonb_build_object('trip', p_trip, 'drivers', v_drivers, 'when', p_when), 'ta:' || p_trip);
      PERFORM bot_queue(bot_msg(u.chat, bot_trip_card_text(tr, p_when) || E'\n\nWho takes it?', bot_assign_kb(v_drivers, p_trip), t.id));
      v_carded := v_carded || u.user_id;
    END LOOP;
  END IF;
  PERFORM bot_notify(v_users, 'trip.requested', 'Truck asked for: ' || COALESCE(tr.request_name, 'a trip'),
    bot_when_label(p_when), '/transportation/' || p_trip || '/edit', 'transportation_request', p_trip, v_carded);
END $$;

CREATE OR REPLACE FUNCTION bot_trip_create(p_actor jsonb, s jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_po sourcing_bundles;
  v_vendor vendors;
  v_proj projects;
  v_id uuid;
  v_when date := CASE WHEN s->>'when' IN ('tam', 'tpm') THEN bot_today() + 1 ELSE bot_today() END;
BEGIN
  IF NOT bot_can_truck(p_actor) THEN RAISE EXCEPTION 'You can''t ask for trucks from here'; END IF;
  IF s->>'po' IS NOT NULL THEN
    SELECT * INTO v_po FROM sourcing_bundles WHERE id = (s->>'po')::uuid;
    SELECT * INTO v_vendor FROM vendors WHERE id = v_po.vendor_id;
  END IF;
  SELECT * INTO v_proj FROM projects WHERE id = NULLIF(s->>'site', '')::uuid;
  INSERT INTO transportation_requests (request_name, job_type, job_status, priority, project_id, sourcing_bundle_id,
    vendor_id, vendor_name, pickup_location_id, pickup_location_text, dropoff_location_id, dropoff_location_text,
    requested_date, expected_delivery_date, notes, requested_by_id, requested_by_staff_id, created_via, requested)
  VALUES (
    CASE WHEN v_po.id IS NOT NULL
         THEN 'Collect ' || v_po.bundle_code || COALESCE(' from ' || COALESCE(v_vendor.vendor_name, v_po.vendor_name), '')
         ELSE left(btrim(s->>'desc'), 120) END,
    CASE WHEN v_po.id IS NOT NULL THEN 'purchase_pickup' ELSE 'material_move' END,
    'requested', CASE WHEN s->>'when' = 'now' THEN 'urgent' ELSE 'normal' END,
    v_proj.id, v_po.id, v_po.vendor_id, COALESCE(v_vendor.vendor_name, v_po.vendor_name),
    v_vendor.location_id, CASE WHEN v_po.id IS NOT NULL THEN COALESCE(v_vendor.vendor_name, v_po.vendor_name) END,
    v_proj.location_id, btrim(v_proj.project_name),
    bot_today(), v_when,
    concat_ws(E'\n', NULLIF(btrim(s->>'desc'), ''), 'When: ' || bot_when_label(s->>'when'), 'Asked in Telegram by ' || (p_actor->>'name')),
    NULLIF(p_actor->>'user_id', '')::uuid, CASE WHEN p_actor->>'user_id' IS NULL THEN NULLIF(p_actor->>'staff_id', '')::uuid END,
    'telegram', true)
  RETURNING id INTO v_id;
  PERFORM bot_trip_cards(v_id, s->>'when');
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION bot_truck_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_i integer;
BEGIN
  IF p_data = 'k:po' THEN
    s := s || jsonb_build_object('step', 'po', 'pos', bot_open_pos(p_actor));
  ELSIF p_data = 'k:pf' THEN
    PERFORM bot_await(t.chat_id, t.id, 'po_search');
    RETURN bot_edit(t.chat_id, t.message_id, '🚚 <b>Ask for a truck</b>' || E'\n\nType the purchase order code or the supplier''s name.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('◀ Back', 'k:bk'), bot_btn('✖ Cancel', 'x')))));
  ELSIF p_data LIKE 'k:p:%' THEN
    v_i := split_part(p_data, ':', 3)::integer;
    IF s->'pos'->v_i IS NULL THEN RETURN '[]'::jsonb; END IF;
    s := s - 'desc' || jsonb_build_object('po', s->'pos'->v_i->>'id', 'po_label', s->'pos'->v_i->>'label',
      'site', s->'pos'->v_i->>'project_id', 'site_name', (SELECT btrim(project_name) FROM projects WHERE id = (s->'pos'->v_i->>'project_id')::uuid),
      'step', 'when');
  ELSIF p_data = 'k:o' THEN
    PERFORM bot_await(t.chat_id, t.id, 'trip_desc');
    s := s - 'po' - 'po_label';
    PERFORM bot_thread_save(t.id, 'truck', s);
    RETURN bot_edit(t.chat_id, t.message_id, '🚚 <b>Ask for a truck</b>' || E'\n\nWhat needs moving, from where to where? One message.',
      bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('◀ Back', 'k:bk'), bot_btn('✖ Cancel', 'x')))));
  ELSIF p_data LIKE 'k:s:%' THEN
    IF split_part(p_data, ':', 3) = '-' THEN
      s := s - 'site' - 'site_name' || jsonb_build_object('step', 'when');
    ELSE
      v_i := split_part(p_data, ':', 3)::integer;
      s := s || jsonb_build_object('site', s->'sites'->v_i->>'id', 'site_name', s->'sites'->v_i->>'name', 'step', 'when');
    END IF;
  ELSIF p_data LIKE 'k:w:%' THEN
    s := s || jsonb_build_object('when', split_part(p_data, ':', 3), 'step', 'confirm');
  ELSIF p_data = 'k:bk' THEN
    s := s || jsonb_build_object('step', CASE s->>'step'
      WHEN 'confirm' THEN 'when'
      WHEN 'when' THEN CASE WHEN s ? 'po' THEN 'po' ELSE 'site' END
      ELSE 'what' END);
    IF s->>'step' = 'site' AND NOT s ? 'sites' THEN s := s || jsonb_build_object('sites', bot_sites(p_actor)); END IF;
  ELSIF p_data = 'k:ok' THEN
    PERFORM bot_thread_save(t.id, 'truck', s || jsonb_build_object('trip', bot_trip_create(p_actor, s)), true);
    RETURN bot_edit(t.chat_id, t.message_id, replace(bot_truck_view(s)->>'text', E'\n\nSend it to logistics?', '')
      || E'\n\n✅ Sent to logistics. I''ll tell you when a truck is arranged.');
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  PERFORM bot_thread_save(t.id, 'truck', s);
  RETURN bot_show(t, bot_truck_view(s));
END $$;

CREATE OR REPLACE FUNCTION bot_truck_text(t bot_threads, p_what text, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_pos jsonb;
BEGIN
  IF p_what = 'po_search' THEN
    v_pos := bot_open_pos(p_actor, p_text);
    IF jsonb_array_length(v_pos) = 0 THEN
      RETURN bot_msg(t.chat_id, 'No purchase order waiting to be collected matches “' || bot_esc(left(p_text, 40)) || '”. Try another word.');
    END IF;
    s := s || jsonb_build_object('step', 'po', 'pos', v_pos);
  ELSIF p_what = 'trip_desc' THEN
    IF length(btrim(p_text)) < 4 THEN RETURN bot_msg(t.chat_id, 'Say a bit more: what, from where, to where.'); END IF;
    s := s || jsonb_build_object('desc', left(btrim(p_text), 300), 'step', 'site', 'sites', bot_sites(p_actor));
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  PERFORM bot_await_clear(t.chat_id);
  PERFORM bot_thread_save(t.id, 'truck', s);
  t.state := s;
  RETURN bot_show(t, bot_truck_view(s), true);
END $$;

-- Logistics hands it out.
CREATE OR REPLACE FUNCTION bot_assign_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_trip uuid := (t.state->>'trip')::uuid;
  v_i integer;
  d jsonb;
  tr transportation_requests;
  th record;
  v_line text;
BEGIN
  IF NOT bot_is_dispatcher(p_actor) THEN RAISE EXCEPTION 'Only logistics or admin can arrange trucks'; END IF;
  IF p_data = 'as:h' THEN
    UPDATE transportation_requests SET transport_mode = 'hired', job_status = 'assigned'
     WHERE id = v_trip AND job_status = 'requested' RETURNING * INTO tr;
    v_line := '🚕 A hired truck — arranged by ' || bot_esc(p_actor->>'name');
  ELSIF p_data ~ '^as:[0-9]+$' THEN
    v_i := split_part(p_data, ':', 2)::integer;
    d := t.state->'drivers'->v_i;
    IF d IS NULL THEN RETURN '[]'::jsonb; END IF;
    UPDATE transportation_requests
       SET transport_mode = 'own_fleet', assigned_staff_id = (d->>'staff')::uuid,
           vehicle_id = COALESCE(NULLIF(d->>'vehicle', '')::uuid, vehicle_id), job_status = 'assigned'
     WHERE id = v_trip AND job_status = 'requested' RETURNING * INTO tr;
    v_line := '🚗 ' || bot_esc(d->>'name') || ' takes it — arranged by ' || bot_esc(p_actor->>'name');
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  IF tr.id IS NULL THEN
    RETURN bot_edit(t.chat_id, t.message_id, bot_trip_card_text((SELECT x FROM transportation_requests x WHERE id = v_trip), t.state->>'when')
      || E'\n\nAlready arranged.');
  END IF;
  FOR th IN SELECT id, chat_id, message_id FROM bot_threads WHERE card_key = 'ta:' || v_trip AND closed_at IS NULL LOOP
    IF th.message_id IS NOT NULL THEN
      PERFORM bot_queue(bot_edit(th.chat_id, th.message_id, bot_trip_card_text(tr, t.state->>'when') || E'\n\n' || v_line));
    END IF;
    UPDATE bot_threads SET closed_at = now() WHERE id = th.id;
  END LOOP;
  RETURN '[]'::jsonb;
END $$;

-- The trip card a driver works from.
CREATE OR REPLACE FUNCTION bot_trip_view(tr transportation_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'text', bot_trip_card_text(tr)
      || COALESCE(E'\nVehicle: ' || NULLIF(bot_esc((SELECT name FROM vehicles WHERE id = tr.vehicle_id)), ''), '')
      || CASE tr.job_status
           WHEN 'in_progress' THEN E'\n\n📦 Picked up' || COALESCE(' at ' || bot_clock(tr.started_at), '')
           WHEN 'completed' THEN E'\n\n✅ Delivered' || COALESCE(' at ' || bot_clock(tr.completed_at), '')
           WHEN 'cancelled' THEN E'\n\n✖ Cancelled'
           ELSE '' END,
    'kb', CASE tr.job_status
            WHEN 'assigned' THEN bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('📦 Picked up', 'tp:p'), bot_btn('✅ Delivered', 'tp:d')),
                                                          jsonb_build_array(bot_btn('⚠️ Problem', 'tp:x'))))
            WHEN 'in_progress' THEN bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('✅ Delivered', 'tp:d'), bot_btn('⚠️ Problem', 'tp:x'))))
          END) $$;

CREATE OR REPLACE FUNCTION trg_bot_trip_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_chat bigint;
  t bot_threads;
  v_msg text;
BEGIN
  IF NOT bot_ready() THEN RETURN NULL; END IF;
  -- Our driver gets the trip with its buttons.
  IF NEW.job_status = 'assigned' AND NEW.transport_mode = 'own_fleet' AND NEW.assigned_staff_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.assigned_staff_id IS DISTINCT FROM NEW.assigned_staff_id OR OLD.job_status IS DISTINCT FROM 'assigned') THEN
    v_chat := bot_chat_of_staff(NEW.assigned_staff_id);
    IF v_chat IS NOT NULL THEN
      UPDATE bot_threads SET closed_at = now() WHERE kind = 'trip' AND state->>'trip' = NEW.id::text AND closed_at IS NULL;
      t := bot_thread_new(jsonb_build_object('chat', v_chat, 'staff_id', NEW.assigned_staff_id), 'trip',
                          jsonb_build_object('trip', NEW.id), 'tp:' || NEW.id);
      PERFORM bot_queue(bot_show(t, jsonb_build_object('text', '🆕 New trip for you' || E'\n' || (bot_trip_view(NEW)->>'text'), 'kb', bot_trip_view(NEW)->'kb')));
    END IF;
  END IF;
  -- Whoever asked from Telegram hears when it's arranged and when it arrives.
  IF NEW.created_via = 'telegram' AND TG_OP = 'UPDATE' AND NEW.job_status IS DISTINCT FROM OLD.job_status
     AND NEW.job_status IN ('assigned', 'completed', 'cancelled') THEN
    v_chat := COALESCE(bot_chat_of_user(NEW.requested_by_id), bot_chat_of_staff(NEW.requested_by_staff_id));
    v_msg := CASE NEW.job_status
      WHEN 'assigned' THEN '🚚 <b>Your truck is arranged</b>' || E'\n' || bot_esc(COALESCE(NEW.request_name, ''))
        || E'\n' || CASE WHEN NEW.transport_mode = 'own_fleet'
                         THEN 'Driver: ' || bot_esc(COALESCE((SELECT employee_name FROM staff WHERE id = NEW.assigned_staff_id), 'ours'))
                              || COALESCE(' · ' || NULLIF(bot_esc((SELECT name FROM vehicles WHERE id = NEW.vehicle_id)), ''), '')
                         ELSE 'A hired truck' END
      WHEN 'completed' THEN '✅ <b>Delivered</b>' || E'\n' || bot_esc(COALESCE(NEW.request_name, ''))
      ELSE '✖ <b>Trip cancelled</b>' || E'\n' || bot_esc(COALESCE(NEW.request_name, '')) END;
    IF v_chat IS NOT NULL THEN PERFORM bot_queue(bot_msg(v_chat, v_msg)); END IF;
    IF NEW.requested_by_id IS NOT NULL THEN
      PERFORM notify(ARRAY[NEW.requested_by_id], 'trip.update', regexp_replace(v_msg, '<[^>]+>|\n.*', '', 'g'),
        NEW.request_name, '/transportation/' || NEW.id || '/edit', 'transportation_request', NEW.id, NULL,
        'trip.update:' || NEW.id || ':' || NEW.job_status);
      IF v_chat IS NOT NULL THEN
        UPDATE notifications SET delivered = COALESCE(delivered, '{}'::jsonb) || jsonb_build_object('telegram', now())
         WHERE dedupe_key = 'trip.update:' || NEW.id || ':' || NEW.job_status AND user_id = NEW.requested_by_id;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trip messages: %', SQLERRM;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_bot_trip_moved AFTER INSERT OR UPDATE OF job_status, assigned_staff_id ON transportation_requests
  FOR EACH ROW EXECUTE FUNCTION trg_bot_trip_moved();

CREATE OR REPLACE FUNCTION bot_trip_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tr transportation_requests;
BEGIN
  SELECT * INTO tr FROM transportation_requests WHERE id = (t.state->>'trip')::uuid;
  IF NOT FOUND THEN RETURN bot_answer(NULL, 'That trip is gone.'); END IF;
  IF tr.assigned_staff_id IS DISTINCT FROM NULLIF(p_actor->>'staff_id', '')::uuid AND NOT bot_is_dispatcher(p_actor) THEN
    RAISE EXCEPTION 'This trip is with another driver now';
  END IF;
  IF p_data = 'tp:p' THEN
    UPDATE transportation_requests SET job_status = 'in_progress' WHERE id = tr.id AND job_status = 'assigned' RETURNING * INTO tr;
  ELSIF p_data = 'tp:d' THEN
    UPDATE transportation_requests SET job_status = 'completed' WHERE id = tr.id AND job_status IN ('assigned', 'in_progress') RETURNING * INTO tr;
  ELSIF p_data = 'tp:x' THEN
    PERFORM bot_await(t.chat_id, t.id, 'trip_problem');
    RETURN bot_msg(t.chat_id, 'What''s the problem? One message, and I''ll pass it to logistics.');
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  IF tr.id IS NULL THEN SELECT * INTO tr FROM transportation_requests WHERE id = (t.state->>'trip')::uuid; END IF;
  IF tr.job_status IN ('completed', 'cancelled') THEN PERFORM bot_thread_save(t.id, 'trip', t.state, true); END IF;
  RETURN bot_show(t, bot_trip_view(tr));
END $$;

CREATE OR REPLACE FUNCTION bot_trip_problem(t bot_threads, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tr transportation_requests;
  u record;
  v_users uuid[];
  v_carded uuid[] := '{}';
  v_note text := 'Problem (' || (p_actor->>'name') || ', ' || bot_clock(now()) || '): ' || left(btrim(p_text), 500);
BEGIN
  UPDATE transportation_requests SET notes = concat_ws(E'\n', notes, v_note) WHERE id = (t.state->>'trip')::uuid RETURNING * INTO tr;
  PERFORM bot_await_clear(t.chat_id);
  SELECT array_agg(id) INTO v_users FROM user_profiles
   WHERE account_status = 'active' AND role::text IN ('logistics_officer', 'admin')
     AND id IS DISTINCT FROM NULLIF(p_actor->>'user_id', '')::uuid;
  FOR u IN SELECT np.user_id, np.telegram_chat_id AS chat FROM notification_prefs np
            WHERE np.user_id = ANY (v_users) AND np.telegram_chat_id IS NOT NULL AND np.telegram_chat_id <> t.chat_id LOOP
    PERFORM bot_queue(bot_msg(u.chat, '⚠️ <b>Problem on a trip</b>' || E'\n' || bot_esc(COALESCE(tr.request_name, '')) || E'\n' || bot_esc(v_note)));
    v_carded := v_carded || u.user_id;
  END LOOP;
  PERFORM bot_note(v_users, 'Problem on a trip: ' || COALESCE(tr.request_name, 'a trip'), v_note,
    '/transportation/' || tr.id || '/edit', 'transportation_request', tr.id, v_carded);
  RETURN bot_msg(t.chat_id, 'Sent to logistics.');
END $$;

-- ── 12. Paid at the gate ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_spot_text(e expenses) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT '💵 <b>Paid at the gate</b> — ' || bot_esc(COALESCE(e.expense_code, ''))
    || E'\n<b>' || bot_birr(e.amount_etb) || '</b> ' || CASE e.spot_paid_method WHEN 'telebirr' THEN 'by telebirr' ELSE 'cash' END
    || ' to ' || bot_esc(COALESCE(e.vendors_name, (SELECT vendor_name FROM vendors WHERE id = e.vendor_id), 'someone'))
    || E'\nFor: ' || bot_esc(COALESCE(e.item_service_description, ''))
    || E'\nSite: ' || bot_esc(COALESCE((SELECT btrim(project_name) FROM projects WHERE id = e.project_id), 'Company overhead'))
    || E'\nPaid by ' || bot_esc(COALESCE((SELECT full_name FROM user_profiles WHERE id = e.spot_paid_by), 'the cashier'))
    || ' at ' || bot_clock(e.spot_paid_at) || ', ' || bot_day((e.spot_paid_at AT TIME ZONE 'Africa/Addis_Ababa')::date) $$;

CREATE OR REPLACE FUNCTION bot_spot_kb(p_exp uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT bot_kb(jsonb_build_array(
    jsonb_build_array(bot_btn('✅ Approve', 'sp:a'), bot_btn('❓ Ask', 'sp:q')),
    jsonb_build_array(bot_btn('Open in Kuncho', bot_url('/expenses/' || p_exp))))) $$;

-- Finance and admin — except whoever paid — get it to approve.
CREATE OR REPLACE FUNCTION bot_spot_cards(p_exp uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e expenses;
  u record;
  v_users uuid[];
  v_carded uuid[] := '{}';
  t bot_threads;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_exp;
  SELECT array_agg(id) INTO v_users FROM user_profiles
   WHERE role::text IN ('finance', 'admin') AND account_status = 'active' AND id IS DISTINCT FROM e.spot_paid_by;
  IF bot_ready() THEN
    FOR u IN SELECT np.user_id, np.telegram_chat_id AS chat FROM notification_prefs np
              WHERE np.user_id = ANY (v_users) AND np.telegram_chat_id IS NOT NULL LOOP
      UPDATE bot_threads SET closed_at = now() WHERE chat_id = u.chat AND card_key = 'sp:' || p_exp AND closed_at IS NULL;
      t := bot_thread_new(jsonb_build_object('chat', u.chat, 'user_id', u.user_id), 'spot', jsonb_build_object('exp', p_exp), 'sp:' || p_exp);
      PERFORM bot_queue(bot_msg(u.chat, bot_spot_text(e), bot_spot_kb(p_exp), t.id));
      v_carded := v_carded || u.user_id;
    END LOOP;
  END IF;
  PERFORM bot_notify(v_users, 'expense.spot_paid',
    'Paid at the gate: ' || bot_birr(e.amount_etb) || ' to ' || COALESCE(e.vendors_name, 'someone'),
    e.item_service_description, '/expenses/' || p_exp, 'expense', p_exp, v_carded);
END $$;

-- Approving a payment made at the gate completes it: paid by the cashier who
-- paid it, approved by whoever approved it — the payment rules still check
-- that those are two different people.
CREATE OR REPLACE FUNCTION trg_expense_spot_decided() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  th record;
  v_who text := COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), 'finance');
  v_line text;
  v_chat bigint;
  e expenses;
BEGIN
  IF NEW.spot_paid_by IS NULL OR NEW.approval_status IS NOT DISTINCT FROM OLD.approval_status THEN RETURN NULL; END IF;
  IF NEW.approval_status = 'finance_approved' THEN
    IF NEW.finance_approved_by = NEW.spot_paid_by THEN
      RAISE EXCEPTION 'You paid this one yourself, so someone else in finance has to approve it';
    END IF;
    IF NEW.payment_state IS DISTINCT FROM 'paid' THEN
      UPDATE expenses SET payment_state = 'paid', disbursed_by = NEW.spot_paid_by,
             payment_method = CASE WHEN NEW.spot_paid_method = 'telebirr' THEN 'other' ELSE 'cash' END,
             account_id = COALESCE(NEW.spot_paid_account_id, account_id),
             paid_date = NEW.spot_paid_at,
             bank_ref = COALESCE(NEW.spot_paid_ref, bank_ref)
       WHERE id = NEW.id;
    END IF;
    v_line := '✅ Approved by ' || bot_esc(v_who) || ' — recorded as paid';
  ELSIF NEW.approval_status = 'rejected' THEN
    v_line := '✖ Rejected by ' || bot_esc(v_who) || COALESCE(': ' || bot_esc(NULLIF(btrim(NEW.rejection_reason), '')), '');
    v_chat := bot_chat_of_user(NEW.spot_paid_by);
    IF v_chat IS NOT NULL AND bot_ready() THEN
      PERFORM bot_queue(bot_msg(v_chat, bot_spot_text(NEW) || E'\n\n' || v_line || E'\nThe money went out: sort it out with ' || bot_esc(v_who) || '.'));
    END IF;
  ELSE
    RETURN NULL;
  END IF;
  SELECT * INTO e FROM expenses WHERE id = NEW.id;
  FOR th IN SELECT id, chat_id, message_id FROM bot_threads WHERE card_key = 'sp:' || NEW.id AND closed_at IS NULL LOOP
    IF th.message_id IS NOT NULL THEN PERFORM bot_queue(bot_edit(th.chat_id, th.message_id, bot_spot_text(e) || E'\n\n' || v_line)); END IF;
    UPDATE bot_threads SET closed_at = now() WHERE id = th.id;
  END LOOP;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_expense_spot_decided AFTER UPDATE OF approval_status ON expenses
  FOR EACH ROW WHEN (NEW.spot_paid_by IS NOT NULL) EXECUTE FUNCTION trg_expense_spot_decided();

CREATE OR REPLACE FUNCTION bot_spot_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e expenses;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = (t.state->>'exp')::uuid;
  IF NOT FOUND THEN RETURN bot_answer(NULL, 'That payment is gone.'); END IF;
  IF p_data = 'sp:a' THEN
    IF NOT bot_is_finance(p_actor) THEN RAISE EXCEPTION 'Only finance can approve a payment'; END IF;
    UPDATE expenses SET approval_status = 'finance_approved'
     WHERE id = e.id AND approval_status IN ('pending', 'manager_approved');
    IF NOT FOUND THEN RETURN bot_edit(t.chat_id, t.message_id, bot_spot_text(e) || E'\n\nAlready decided.'); END IF;
    RETURN '[]'::jsonb;
  ELSIF p_data = 'sp:q' THEN
    PERFORM bot_await(t.chat_id, t.id, 'spot_question');
    RETURN bot_msg(t.chat_id, 'Type your question for ' || bot_esc(COALESCE((SELECT full_name FROM user_profiles WHERE id = e.spot_paid_by), 'the cashier')) || '.');
  END IF;
  RETURN '[]'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION bot_spot_question(t bot_threads, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e expenses;
  v_chat bigint;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = (t.state->>'exp')::uuid;
  PERFORM bot_await_clear(t.chat_id);
  v_chat := bot_chat_of_user(e.spot_paid_by);
  IF v_chat IS NOT NULL THEN
    PERFORM bot_queue(bot_msg(v_chat, '❓ <b>' || bot_esc(p_actor->>'name') || '</b> asks about ' || bot_esc(COALESCE(e.expense_code, 'a gate payment'))
      || ':' || E'\n' || bot_esc(left(btrim(p_text), 800))));
  END IF;
  PERFORM bot_note(ARRAY[e.spot_paid_by], 'Question about ' || COALESCE(e.expense_code, 'a gate payment') || ' from ' || (p_actor->>'name'),
    left(btrim(p_text), 800), '/expenses/' || e.id, 'expense', e.id,
    CASE WHEN v_chat IS NOT NULL THEN ARRAY[e.spot_paid_by] ELSE '{}'::uuid[] END);
  RETURN bot_msg(t.chat_id, 'Sent to ' || bot_esc(COALESCE((SELECT full_name FROM user_profiles WHERE id = e.spot_paid_by), 'the cashier')) || '.');
END $$;

-- The cashier records a trip paid at the gate (finance and admin only).
-- p: {trip_id | po_id | project_id + description | overhead, driver_id | driver_name + driver_phone,
--     amount, method: cash|telebirr, account_id (telebirr), ref, date (default today),
--     receipt_url, receipt_name, receipt_is_vat, receipt_no, receipt_vat_amount, note}
CREATE OR REPLACE FUNCTION pay_out_trip(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_role text := get_user_role()::text;
  v_amount numeric := NULLIF(p->>'amount', '')::numeric;
  v_method text := COALESCE(NULLIF(p->>'method', ''), 'cash');
  v_driver transport_drivers;
  v_trip transportation_requests;
  v_po sourcing_bundles;
  v_vendor vendors;
  v_project uuid;
  v_desc text;
  v_exp uuid;
  v_code text;
  v_date date := COALESCE(NULLIF(p->>'date', '')::date, bot_today());
  v_paid_at timestamptz;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN RAISE EXCEPTION 'Only finance can record a payment'; END IF;
  IF v_date > bot_today() THEN RAISE EXCEPTION 'That day hasn''t come yet'; END IF;
  IF v_date < bot_today() - 30 THEN RAISE EXCEPTION 'That''s more than 30 days ago — record it as an ordinary expense'; END IF;
  -- Paid today: now. Paid on an earlier day: midday that day.
  v_paid_at := CASE WHEN v_date = bot_today() THEN now() ELSE (v_date + time '12:00') AT TIME ZONE 'Africa/Addis_Ababa' END;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Enter the amount paid'; END IF;
  IF v_amount > 50000 THEN RAISE EXCEPTION 'That''s more than a gate payment — record it as an expense instead'; END IF;
  IF v_method NOT IN ('cash', 'telebirr') THEN RAISE EXCEPTION 'Pay out takes cash or telebirr'; END IF;
  IF v_method = 'telebirr' AND NULLIF(p->>'account_id', '') IS NULL THEN RAISE EXCEPTION 'Which account did the telebirr payment come from?'; END IF;

  -- Who was paid.
  IF NULLIF(p->>'driver_id', '') IS NOT NULL THEN
    SELECT * INTO v_driver FROM transport_drivers WHERE id = (p->>'driver_id')::uuid;
  ELSIF NULLIF(btrim(p->>'driver_name'), '') IS NOT NULL THEN
    INSERT INTO transport_drivers (full_name, phone, payout_method, created_by)
    VALUES (btrim(p->>'driver_name'), NULLIF(btrim(p->>'driver_phone'), ''), v_method, auth.uid())
    RETURNING * INTO v_driver;
  END IF;
  IF v_driver.id IS NULL THEN RAISE EXCEPTION 'Who was paid? Pick the driver or type the name'; END IF;

  -- The trip: one asked for already, or recorded now.
  IF NULLIF(p->>'trip_id', '') IS NOT NULL THEN
    SELECT * INTO v_trip FROM transportation_requests WHERE id = (p->>'trip_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_trip.job_status = 'cancelled' THEN RAISE EXCEPTION 'That trip was cancelled'; END IF;
    IF v_trip.expense_id IS NOT NULL THEN RAISE EXCEPTION 'That trip is already paid'; END IF;
    v_project := NULLIF(p->>'project_id', '')::uuid;  -- for a trip asked for without a site
    UPDATE transportation_requests
       SET transport_mode = CASE WHEN transport_mode = 'ride_hailing' THEN 'ride_hailing' ELSE 'hired' END,
           hired_driver_id = v_driver.id, amount = v_amount,
           job_status = CASE WHEN job_status IN ('requested', 'assigned', 'in_progress') THEN 'completed' ELSE job_status END
     WHERE id = v_trip.id RETURNING * INTO v_trip;
  ELSE
    IF NULLIF(p->>'po_id', '') IS NOT NULL THEN
      SELECT * INTO v_po FROM sourcing_bundles WHERE id = (p->>'po_id')::uuid;
      SELECT * INTO v_vendor FROM vendors WHERE id = v_po.vendor_id;
      v_project := COALESCE(NULLIF(p->>'project_id', '')::uuid,
        (SELECT o.project_id FROM sourcing_bundle_items i JOIN order_items oi ON oi.id = i.order_item_id JOIN orders o ON o.id = oi.order_id
          WHERE i.bundle_id = v_po.id AND o.project_id IS NOT NULL GROUP BY o.project_id ORDER BY count(*) DESC LIMIT 1));
    ELSE
      v_project := NULLIF(p->>'project_id', '')::uuid;
      IF NULLIF(btrim(p->>'description'), '') IS NULL THEN RAISE EXCEPTION 'What was the trip for?'; END IF;
    END IF;
    INSERT INTO transportation_requests (request_name, job_type, transport_mode, job_status, priority, project_id,
      sourcing_bundle_id, vendor_id, vendor_name, pickup_location_id, pickup_location_text, dropoff_location_text,
      requested_date, hired_driver_id, amount, completed_at, notes, requested_by_id, created_via, requested)
    VALUES (COALESCE(CASE WHEN v_po.id IS NOT NULL THEN 'Collect ' || v_po.bundle_code || COALESCE(' from ' || COALESCE(v_vendor.vendor_name, v_po.vendor_name), '') END,
                     left(btrim(p->>'description'), 120)),
      CASE WHEN v_po.id IS NOT NULL THEN 'purchase_pickup' ELSE 'material_move' END, 'hired', 'completed', 'normal', v_project,
      v_po.id, v_po.vendor_id, COALESCE(v_vendor.vendor_name, v_po.vendor_name), v_vendor.location_id,
      COALESCE(v_vendor.vendor_name, v_po.vendor_name), (SELECT btrim(project_name) FROM projects WHERE id = v_project),
      v_date, v_driver.id, v_amount, v_paid_at, NULLIF(btrim(p->>'note'), ''), auth.uid(), 'payout', true)
    RETURNING * INTO v_trip;
  END IF;

  v_project := COALESCE(v_trip.project_id, v_project);
  IF v_project IS NULL AND NOT COALESCE((p->>'overhead')::boolean, false) THEN
    RAISE EXCEPTION 'Which project was this trip for? Or mark it company overhead.';
  END IF;
  v_desc := 'Transport: ' || COALESCE(v_trip.request_name, 'trip');

  INSERT INTO expenses (expense_type, item_service_description, amount_etb, date, project_id, is_overhead,
    vendors_name, vendors_bank_account, payment_method, account_id, receipt_url, receipt_name,
    receipt_is_vat, receipt_no, receipt_vat_amount, notes,
    purchaser_user_id, approval_status, requested, payment_status, partially_paid, contacted, verify_wht,
    is_new_item, is_allocated, receipt_delivered, delivery_status,
    spot_paid_by, spot_paid_at, spot_paid_method, spot_paid_account_id, spot_paid_ref)
  VALUES ('transportation', v_desc, v_amount, v_date, v_project, v_project IS NULL,
    v_driver.full_name, CASE WHEN v_method = 'telebirr' THEN COALESCE(v_driver.phone, v_driver.account_number) END,
    CASE WHEN v_method = 'telebirr' THEN 'other' ELSE 'cash' END, NULLIF(p->>'account_id', '')::uuid,
    NULLIF(p->>'receipt_url', ''), NULLIF(p->>'receipt_name', ''),
    CASE WHEN NULLIF(p->>'receipt_url', '') IS NOT NULL THEN (p->>'receipt_is_vat')::boolean END,
    NULLIF(btrim(p->>'receipt_no'), ''), NULLIF(p->>'receipt_vat_amount', '')::numeric,
    NULLIF(btrim(p->>'note'), ''),
    auth.uid(), 'pending', true, false, false, false, false, false, false, false, '{}',
    auth.uid(), v_paid_at, v_method, NULLIF(p->>'account_id', '')::uuid, NULLIF(btrim(p->>'ref'), ''))
  RETURNING id, expense_code INTO v_exp, v_code;

  UPDATE transportation_requests SET expense_id = v_exp WHERE id = v_trip.id;
  PERFORM bot_spot_cards(v_exp);
  RETURN jsonb_build_object('expense_id', v_exp, 'expense_code', v_code, 'trip_id', v_trip.id);
END $$;
REVOKE ALL ON FUNCTION pay_out_trip(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pay_out_trip(jsonb) TO authenticated;

-- Trips the cashier may be paying for: hired or not yet arranged, unpaid.
CREATE OR REPLACE VIEW v_trips_to_pay WITH (security_invoker = true) AS
SELECT t.id, t.request_name, t.job_status, t.transport_mode, t.created_via, t.project_id,
       btrim(p.project_name) AS project_name, t.sourcing_bundle_id, b.bundle_code, t.vendor_name,
       t.pickup_location_text, t.dropoff_location_text, t.requested_date, t.expected_delivery_date,
       t.hired_driver_id, d.full_name AS driver_name, d.phone AS driver_phone, t.amount, t.created_at
FROM transportation_requests t
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN sourcing_bundles b ON b.id = t.sourcing_bundle_id
LEFT JOIN transport_drivers d ON d.id = t.hired_driver_id
WHERE t.expense_id IS NULL AND t.job_status <> 'cancelled'
  AND (t.transport_mode IN ('hired', 'ride_hailing') OR (t.assigned_staff_id IS NULL AND t.job_status = 'requested'))
  AND t.created_at > now() - interval '60 days';
GRANT SELECT ON v_trips_to_pay TO authenticated;

-- What was paid at the gate lately, and where its approval stands.
CREATE OR REPLACE VIEW v_spot_payments WITH (security_invoker = true) AS
SELECT e.id, e.expense_code, e.item_service_description, e.amount_etb, e.vendors_name AS paid_to, e.spot_paid_method,
       e.spot_paid_at, e.spot_paid_by, up.full_name AS paid_by_name, e.approval_status, e.payment_state,
       e.finance_approved_by, fa.full_name AS approved_by_name, e.project_id, btrim(p.project_name) AS project_name, e.receipt_url
FROM expenses e
LEFT JOIN user_profiles up ON up.id = e.spot_paid_by
LEFT JOIN user_profiles fa ON fa.id = e.finance_approved_by
LEFT JOIN projects p ON p.id = e.project_id
WHERE e.spot_paid_by IS NOT NULL AND NOT COALESCE(e.is_archived, false)
  AND e.spot_paid_at > now() - interval '30 days';
GRANT SELECT ON v_spot_payments TO authenticated;

-- ── 13. Approvals on request, drivers' trips, unmatched messages ───────
CREATE OR REPLACE FUNCTION bot_to_approve(t bot_threads, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r labor_requisitions;
  e record;
  v_n integer := 0;
  v_all integer := 0;
BEGIN
  -- The newest first: the old ones are usually settled some other way, and
  -- they stay in Kuncho.
  IF bot_is_labour_approver(p_actor) THEN
    SELECT count(*) INTO v_all FROM labor_requisitions WHERE status = 'pending';
    FOR r IN SELECT * FROM labor_requisitions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 6 LOOP
      PERFORM bot_labour_card_to(r, NULLIF(p_actor->>'user_id', '')::uuid, t.chat_id);
      v_n := v_n + 1;
    END LOOP;
  END IF;
  IF bot_is_finance(p_actor) THEN
    v_all := v_all + (SELECT count(*) FROM expenses WHERE spot_paid_by IS NOT NULL AND approval_status IN ('pending', 'manager_approved')
                       AND spot_paid_by IS DISTINCT FROM NULLIF(p_actor->>'user_id', '')::uuid AND NOT COALESCE(is_archived, false));
    FOR e IN SELECT id FROM expenses WHERE spot_paid_by IS NOT NULL AND approval_status IN ('pending', 'manager_approved')
              AND spot_paid_by IS DISTINCT FROM NULLIF(p_actor->>'user_id', '')::uuid AND NOT COALESCE(is_archived, false)
              ORDER BY spot_paid_at DESC LIMIT 6 LOOP
      DECLARE x bot_threads; ex expenses;
      BEGIN
        SELECT * INTO ex FROM expenses WHERE id = e.id;
        UPDATE bot_threads SET closed_at = now() WHERE chat_id = t.chat_id AND card_key = 'sp:' || e.id AND closed_at IS NULL;
        x := bot_thread_new(p_actor, 'spot', jsonb_build_object('exp', e.id), 'sp:' || e.id);
        PERFORM bot_queue(bot_msg(t.chat_id, bot_spot_text(ex), bot_spot_kb(e.id), x.id));
      END;
      v_n := v_n + 1;
    END LOOP;
  END IF;
  PERFORM bot_thread_save(t.id, 'menu', t.state, true);
  RETURN bot_edit(t.chat_id, t.message_id, CASE
    WHEN v_n = 0 THEN 'Nothing is waiting for you. ✅'
    WHEN v_all > v_n THEN v_all || ' waiting for you — the newest ' || v_n || ' below; the rest are in Kuncho.'
    ELSE v_n || ' waiting for you — below.' END);
END $$;

CREATE OR REPLACE FUNCTION bot_my_trips(t bot_threads, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tr transportation_requests;
  x bot_threads;
  v_n integer := 0;
BEGIN
  FOR tr IN SELECT * FROM transportation_requests
             WHERE assigned_staff_id = NULLIF(p_actor->>'staff_id', '')::uuid AND job_status IN ('assigned', 'in_progress')
             ORDER BY expected_delivery_date NULLS LAST, created_at LIMIT 5 LOOP
    UPDATE bot_threads SET closed_at = now() WHERE kind = 'trip' AND state->>'trip' = tr.id::text AND chat_id = t.chat_id AND closed_at IS NULL;
    x := bot_thread_new(p_actor, 'trip', jsonb_build_object('trip', tr.id), 'tp:' || tr.id);
    PERFORM bot_queue(bot_show(x, bot_trip_view(tr)));
    v_n := v_n + 1;
  END LOOP;
  PERFORM bot_thread_save(t.id, 'menu', t.state, true);
  RETURN bot_edit(t.chat_id, t.message_id, CASE WHEN v_n = 0 THEN 'No trips for you right now.' ELSE 'Your trips — below.' END);
END $$;

CREATE OR REPLACE FUNCTION bot_trucks_to_arrange(t bot_threads, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tr transportation_requests;
  x bot_threads;
  v_drivers jsonb := bot_own_drivers();
  v_n integer := 0;
BEGIN
  FOR tr IN SELECT * FROM transportation_requests WHERE created_via = 'telegram' AND job_status = 'requested'
             ORDER BY created_at LIMIT 6 LOOP
    UPDATE bot_threads SET closed_at = now() WHERE chat_id = t.chat_id AND card_key = 'ta:' || tr.id AND closed_at IS NULL;
    x := bot_thread_new(p_actor, 'assign', jsonb_build_object('trip', tr.id, 'drivers', v_drivers), 'ta:' || tr.id);
    PERFORM bot_queue(bot_msg(t.chat_id, bot_trip_card_text(tr) || E'\n\nWho takes it?', bot_assign_kb(v_drivers, tr.id), x.id));
    v_n := v_n + 1;
  END LOOP;
  PERFORM bot_thread_save(t.id, 'menu', t.state, true);
  RETURN bot_edit(t.chat_id, t.message_id, CASE WHEN v_n = 0 THEN 'No trucks waiting to be arranged.' ELSE v_n || ' to arrange — below.' END);
END $$;

-- Typed but not a menu: the admins get it as a note, and it's counted. A
-- photo, voice note or file (p_media, the message's id) is copied to the
-- admins on Telegram under the note.
CREATE OR REPLACE FUNCTION bot_log_unmatched(p_actor jsonb, p_body text, p_media bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_chat bigint := (p_actor->>'chat')::bigint;
  v_admins uuid[];
  v_carded uuid[] := '{}';
BEGIN
  INSERT INTO bot_inbox_unmatched (chat_id, actor_user, actor_staff, actor_name, body)
  VALUES (v_chat, NULLIF(p_actor->>'user_id', '')::uuid, NULLIF(p_actor->>'staff_id', '')::uuid, p_actor->>'name', left(p_body, 2000));
  SELECT array_agg(id) INTO v_admins FROM user_profiles WHERE role::text = 'admin' AND account_status = 'active'
     AND id IS DISTINCT FROM NULLIF(p_actor->>'user_id', '')::uuid;
  FOR u IN SELECT np.user_id, np.telegram_chat_id AS chat FROM notification_prefs np
            WHERE np.user_id = ANY (v_admins) AND np.telegram_chat_id IS NOT NULL AND np.telegram_chat_id <> v_chat LOOP
    PERFORM bot_queue(bot_msg(u.chat, '✉️ <b>' || bot_esc(p_actor->>'name') || '</b> wrote to the bot:' || E'\n' || bot_esc(left(p_body, 1500))));
    IF p_media IS NOT NULL THEN
      PERFORM bot_queue(bot_act('copyMessage', jsonb_build_object('chat_id', u.chat, 'from_chat_id', v_chat, 'message_id', p_media)));
    END IF;
    v_carded := v_carded || u.user_id;
  END LOOP;
  PERFORM bot_note(v_admins, (p_actor->>'name') || ' wrote to the bot', left(p_body, 800), NULL, NULL, NULL, v_carded);
END $$;

CREATE OR REPLACE FUNCTION bot_unmatched(p_actor jsonb, p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM bot_log_unmatched(p_actor, p_body);
  RETURN bot_msg((p_actor->>'chat')::bigint, 'I only understand the buttons, so I''ve passed your message to the office.')
      || bot_menu_new(p_actor);
END $$;

-- ── 14. Routing ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_on_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sites jsonb;
BEGIN
  PERFORM bot_await_clear(t.chat_id);
  IF p_data = 'x' THEN
    PERFORM bot_thread_save(t.id, t.kind, t.state, true);
    RETURN bot_edit(t.chat_id, t.message_id, 'Cancelled. Send /menu when you need something.');
  ELSIF p_data = 'm:w' THEN
    IF NOT bot_on_a_site(p_actor) THEN RAISE EXCEPTION 'Asking for workers is for the site team, operations and HR'; END IF;
    t.state := jsonb_build_object('step', 'site', 'sites', bot_sites(p_actor));
    PERFORM bot_thread_save(t.id, 'workers', t.state);
    RETURN bot_show(t, bot_workers_view(t.state));
  ELSIF p_data = 'm:t' THEN
    IF NOT bot_can_truck(p_actor) THEN RAISE EXCEPTION 'You can''t ask for trucks from here'; END IF;
    t.state := jsonb_build_object('step', 'what');
    PERFORM bot_thread_save(t.id, 'truck', t.state);
    RETURN bot_show(t, bot_truck_view(t.state));
  ELSIF p_data = 'm:c' THEN
    v_sites := bot_crew_sites(p_actor);
    IF jsonb_array_length(v_sites) = 0 THEN
      PERFORM bot_thread_save(t.id, 'crew', '{}'::jsonb, true);
      RETURN bot_edit(t.chat_id, t.message_id, '📋 Nothing to tick: none of your sites has approved day-rate workers today.',
        bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('👷 Ask for workers', 'm:w')))));
    ELSIF jsonb_array_length(v_sites) = 1 THEN
      RETURN bot_crew_open(t, (v_sites->0->>'id')::uuid, v_sites->0->>'name');
    END IF;
    t.state := jsonb_build_object('step', 'site', 'sites', v_sites);
    PERFORM bot_thread_save(t.id, 'crew', t.state);
    RETURN bot_show(t, bot_crew_view(t.state));
  ELSIF p_data = 'm:a' THEN
    RETURN bot_to_approve(t, p_actor);
  ELSIF p_data = 'm:d' THEN
    RETURN bot_my_trips(t, p_actor);
  ELSIF p_data = 'm:k' THEN
    IF NOT bot_is_dispatcher(p_actor) THEN RAISE EXCEPTION 'Only logistics or admin can arrange trucks'; END IF;
    RETURN bot_trucks_to_arrange(t, p_actor);
  END IF;

  RETURN CASE t.kind
    WHEN 'workers' THEN bot_workers_button(t, p_data, p_actor)
    WHEN 'truck' THEN bot_truck_button(t, p_data, p_actor)
    WHEN 'crew' THEN bot_crew_button(t, p_data, p_actor)
    WHEN 'add_workers' THEN bot_aw_button(t, p_data, p_actor)
    WHEN 'lr_next' THEN bot_aw_button(t, p_data, p_actor)
    WHEN 'lr_card' THEN bot_lr_card_button(t, p_data, p_actor)
    WHEN 'assign' THEN bot_assign_button(t, p_data, p_actor)
    WHEN 'trip' THEN bot_trip_button(t, p_data, p_actor)
    WHEN 'spot' THEN bot_spot_button(t, p_data, p_actor)
    ELSE '[]'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION bot_on_message(p_actor jsonb, p_msg jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_chat bigint := (p_actor->>'chat')::bigint;
  v_text text := btrim(COALESCE(p_msg->>'text', p_msg->>'caption', ''));
  v_media text := CASE WHEN p_msg ? 'photo' THEN 'photo' WHEN p_msg ? 'voice' THEN 'voice note' WHEN p_msg ? 'video' THEN 'video'
                       WHEN p_msg ? 'video_note' THEN 'video note' WHEN p_msg ? 'audio' THEN 'audio'
                       WHEN p_msg ? 'document' THEN 'file' WHEN p_msg ? 'location' THEN 'location' END;
  c bot_chats;
  t bot_threads;
BEGIN
  IF v_text ~* '^/(start|menu)(@\w+)?$' OR lower(v_text) IN ('menu', 'ምናሌ', 'hi', 'hello', 'selam', 'ሰላም', 'start') THEN
    PERFORM bot_await_clear(v_chat);
    RETURN bot_menu_new(p_actor);
  ELSIF v_text ~* '^/help(@\w+)?$' THEN
    RETURN bot_msg(v_chat, 'Tap /menu and pick what you need: workers, a truck, or ticking who worked today. '
      || 'Everything is buttons — you only type a number, a name or a short note when I ask.');
  ELSIF v_text ~* '^/cancel(@\w+)?$' THEN
    PERFORM bot_await_clear(v_chat);
    RETURN bot_msg(v_chat, 'OK. Send /menu when you need something.');
  END IF;

  SELECT * INTO c FROM bot_chats WHERE chat_id = v_chat;
  IF c.awaiting_thread IS NOT NULL AND v_text <> '' THEN
    SELECT * INTO t FROM bot_threads WHERE id = c.awaiting_thread AND closed_at IS NULL;
    IF FOUND THEN
      -- A photo with the answer as its caption: the answer goes on, the photo to the office.
      IF v_media IS NOT NULL THEN
        PERFORM bot_log_unmatched(p_actor, '[' || v_media || '] ' || v_text, (p_msg->>'message_id')::bigint);
      END IF;
      RETURN CASE
        WHEN c.awaiting IN ('site_search', 'trade', 'count', 'days', 'rate') AND t.kind = 'workers' THEN bot_workers_text(t, c.awaiting, v_text, p_actor)
        WHEN c.awaiting IN ('po_search', 'trip_desc') THEN bot_truck_text(t, c.awaiting, v_text, p_actor)
        WHEN c.awaiting = 'new_worker' THEN bot_aw_text(t, v_text, p_actor)
        WHEN c.awaiting = 'reject_reason' THEN bot_lr_reason_text(t, v_text, p_actor)
        WHEN c.awaiting = 'trip_problem' THEN bot_trip_problem(t, v_text, p_actor)
        WHEN c.awaiting = 'spot_question' THEN bot_spot_question(t, v_text, p_actor)
        ELSE '[]'::jsonb END;
    END IF;
  END IF;

  IF v_media IS NOT NULL THEN
    -- Photos, voice notes, files: the free bot can't read them, so the
    -- office gets a copy.
    PERFORM bot_log_unmatched(p_actor, '[' || v_media || ']' || COALESCE(' ' || NULLIF(v_text, ''), ''), (p_msg->>'message_id')::bigint);
    RETURN bot_msg(v_chat, 'I can''t read photos or voice notes, so I''ve passed it to the office. For requests, use /menu.');
  ELSIF v_text = '' THEN
    RETURN bot_msg(v_chat, 'Send /menu when you need something.');
  END IF;
  RETURN bot_unmatched(p_actor, v_text);
END $$;

-- The one entry point: a Telegram update in, the Telegram calls to make out.
CREATE OR REPLACE FUNCTION bot_handle(p_update jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cb jsonb := p_update->'callback_query';
  v_msg jsonb := p_update->'message';
  v_chat bigint := COALESCE((p_update #>> '{callback_query,message,chat,id}')::bigint, (p_update #>> '{message,chat,id}')::bigint);
  v_type text := COALESCE(p_update #>> '{callback_query,message,chat,type}', p_update #>> '{message,chat,type}');
  v_actor jsonb;
  v_out jsonb := '[]'::jsonb;
  v_toast text;
  v_alert boolean := false;
  v_ans jsonb;
  t bot_threads;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  IF v_chat IS NULL OR v_type IS DISTINCT FROM 'private' THEN RETURN '[]'::jsonb; END IF;
  v_actor := bot_actor(v_chat);
  IF v_actor IS NULL THEN
    IF v_cb IS NOT NULL THEN RETURN bot_answer(v_cb->>'id', 'This chat isn''t connected to Kuncho.', true); END IF;
    RETURN bot_msg(v_chat, 'Hi! This chat isn''t connected to Kuncho yet. If you have a Kuncho login, open '
      || '<b>Settings → Notifications</b> and tap <b>Connect Telegram</b>. Otherwise ask the office for your connect link.');
  END IF;
  PERFORM bot_become(v_actor);

  BEGIN
    IF v_cb IS NOT NULL THEN
      SELECT * INTO t FROM bot_threads
       WHERE chat_id = v_chat AND message_id = (v_cb #>> '{message,message_id}')::bigint AND closed_at IS NULL;
      IF NOT FOUND THEN
        v_toast := 'This menu has expired. Send /menu for a new one.';
      ELSE
        v_out := bot_on_button(t, v_cb->>'data', v_actor);
      END IF;
    ELSE
      v_out := bot_on_message(v_actor, v_msg);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- A rule said no (a permission, a closed request…): say so, change nothing.
    IF v_cb IS NOT NULL THEN
      v_toast := left(SQLERRM, 190); v_alert := true; v_out := '[]'::jsonb;
    ELSE
      v_out := bot_msg(v_chat, '⚠️ ' || bot_esc(SQLERRM));
    END IF;
  END;

  IF v_cb IS NOT NULL THEN
    -- A handler's own answer (it has no id yet) wins over the default.
    SELECT a INTO v_ans FROM jsonb_array_elements(v_out) a WHERE a->>'method' = 'answerCallbackQuery' LIMIT 1;
    IF v_ans IS NOT NULL THEN
      v_toast := v_ans->'payload'->>'text';
      v_alert := COALESCE((v_ans->'payload'->>'show_alert')::boolean, false);
    END IF;
    v_out := COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements(v_out) a WHERE a->>'method' <> 'answerCallbackQuery'), '[]'::jsonb);
    v_out := bot_answer(v_cb->>'id', v_toast, v_alert) || v_out;
  END IF;
  RETURN v_out;
END $$;

-- ── 15. The function's side: binding, the outbox, linking ──────────────
CREATE OR REPLACE FUNCTION bot_bind(p_thread uuid, p_message_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  UPDATE bot_threads SET message_id = p_message_id, updated_at = now() WHERE id = p_thread;
END $$;

CREATE OR REPLACE FUNCTION bot_outbox_take(p_limit integer DEFAULT 40) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  WITH pick AS (
    SELECT id FROM bot_outbox
     WHERE sent_at IS NULL AND attempts < 5 AND (taken_at IS NULL OR taken_at < now() - interval '2 minutes')
     ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), took AS (
    UPDATE bot_outbox o SET attempts = attempts + 1, taken_at = now() FROM pick WHERE o.id = pick.id
    RETURNING o.id, o.method, o.payload, o.thread_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('outbox_id', id, 'method', method, 'payload', payload, 'bind', thread_id)) ORDER BY id), '[]'::jsonb)
    INTO v FROM took;
  RETURN v;
END $$;

-- Sent: the message it became answers its thread's buttons. Not sent: tried
-- again next minute, unless Telegram will never take it (p_error 'permanent: …').
CREATE OR REPLACE FUNCTION bot_outbox_done(p_id bigint, p_ok boolean, p_message_id bigint DEFAULT NULL, p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_thread uuid;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  UPDATE bot_outbox SET sent_at = CASE WHEN p_ok THEN now() END, error = p_error,
         taken_at = CASE WHEN p_ok THEN taken_at END,
         attempts = CASE WHEN p_ok OR p_error IS NULL OR p_error !~* '^permanent' THEN attempts ELSE 5 END
   WHERE id = p_id
  RETURNING thread_id INTO v_thread;
  IF p_ok AND p_message_id IS NOT NULL AND v_thread IS NOT NULL THEN
    UPDATE bot_threads SET message_id = p_message_id, updated_at = now() WHERE id = v_thread AND message_id IS NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION bot_hook_version() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  RETURN (SELECT telegram_hook_version FROM notification_channel_settings WHERE id);
END $$;

CREATE OR REPLACE FUNCTION bot_hook_set_version(p_version integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  UPDATE notification_channel_settings SET telegram_hook_version = p_version WHERE id;
END $$;

-- /start <code> for someone without a login.
CREATE OR REPLACE FUNCTION bot_link_staff(p_code text, p_chat bigint, p_username text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_staff uuid;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  SELECT staff_id INTO v_staff FROM bot_staff_links WHERE link_code = p_code AND link_expires > now();
  IF v_staff IS NULL THEN RETURN NULL; END IF;
  UPDATE bot_staff_links SET chat_id = NULL WHERE chat_id = p_chat AND staff_id <> v_staff;
  UPDATE bot_staff_links SET chat_id = p_chat, username = p_username, linked_at = now(), link_code = NULL, link_expires = NULL
   WHERE staff_id = v_staff;
  RETURN (SELECT employee_name FROM staff WHERE id = v_staff);
END $$;

CREATE OR REPLACE FUNCTION bot_unlink_chat(p_chat bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v integer;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  UPDATE bot_staff_links SET chat_id = NULL, username = NULL, linked_at = NULL WHERE chat_id = p_chat;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

-- From the app: a connect link for someone without a login (admin, HR, operations).
CREATE OR REPLACE FUNCTION bot_staff_link_code(p_staff uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_code text := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
  v_bot text := (SELECT telegram_bot_username FROM notification_channel_settings WHERE id);
BEGIN
  IF NOT COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false) THEN
    RAISE EXCEPTION 'Only admin, operations or HR can connect people to the bot';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id = p_staff) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'The Telegram bot isn''t set up yet (Settings → Notifications)'; END IF;
  INSERT INTO bot_staff_links (staff_id, link_code, link_expires, created_by)
  VALUES (p_staff, v_code, now() + interval '7 days', auth.uid())
  ON CONFLICT (staff_id) DO UPDATE SET link_code = EXCLUDED.link_code, link_expires = EXCLUDED.link_expires;
  RETURN jsonb_build_object('code', v_code, 'bot', v_bot, 'url', 'https://t.me/' || v_bot || '?start=' || v_code,
                            'expires', now() + interval '7 days');
END $$;

CREATE OR REPLACE FUNCTION bot_staff_unlink(p_staff uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false) THEN
    RAISE EXCEPTION 'Only admin, operations or HR can disconnect people from the bot';
  END IF;
  UPDATE bot_staff_links SET chat_id = NULL, username = NULL, linked_at = NULL, link_code = NULL, link_expires = NULL
   WHERE staff_id = p_staff;
END $$;

-- What the bot did this month, for admin.
CREATE OR REPLACE FUNCTION bot_activity() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_from timestamptz := date_trunc('month', now() AT TIME ZONE 'Africa/Addis_Ababa') AT TIME ZONE 'Africa/Addis_Ababa';
BEGIN
  IF NOT COALESCE(get_user_role()::text IN ('admin', 'executive'), false) THEN RAISE EXCEPTION 'Admin only'; END IF;
  RETURN jsonb_build_object(
    'since', v_from,
    'labour_requests', (SELECT count(*) FROM labor_requisitions WHERE created_via = 'telegram' AND created_at >= v_from),
    'labour_requests_app', (SELECT count(*) FROM labor_requisitions WHERE created_via = 'app' AND created_at >= v_from),
    'trips', (SELECT count(*) FROM transportation_requests WHERE created_via = 'telegram' AND created_at >= v_from),
    'crew_days', (SELECT count(DISTINCT (project_id, work_date)) FROM labour_work_entries WHERE recorded_via = 'telegram' AND recorded_at >= v_from),
    'gate_payments', (SELECT count(*) FROM expenses WHERE spot_paid_by IS NOT NULL AND spot_paid_at >= v_from),
    'gate_payments_waiting', (SELECT count(*) FROM expenses WHERE spot_paid_by IS NOT NULL AND approval_status IN ('pending', 'manager_approved') AND NOT COALESCE(is_archived, false)),
    'unmatched', (SELECT count(*) FROM bot_inbox_unmatched WHERE created_at >= v_from),
    'unmatched_photos', (SELECT count(*) FROM bot_inbox_unmatched WHERE created_at >= v_from AND body LIKE '[%]'),
    'linked_logins', (SELECT count(*) FROM notification_prefs WHERE telegram_chat_id IS NOT NULL),
    'linked_staff', (SELECT count(*) FROM bot_staff_links WHERE chat_id IS NOT NULL),
    'recent_unmatched', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', actor_name, 'body', body, 'at', created_at) ORDER BY created_at DESC)
                                  FROM (SELECT * FROM bot_inbox_unmatched ORDER BY created_at DESC LIMIT 10) x), '[]'::jsonb));
END $$;

-- The minute's dispatch also runs when the bot has something to send, or
-- its webhook still needs the buttons switched on.
CREATE OR REPLACE FUNCTION public.notify_kick(p_action text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s notification_channel_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM notification_channel_settings WHERE id;
  IF p_action = 'dispatch' AND NOT (s.telegram_ready AND (
       EXISTS (SELECT 1 FROM notify_telegram_pending_q())
       OR EXISTS (SELECT 1 FROM bot_outbox WHERE sent_at IS NULL AND attempts < 5)
       OR s.telegram_hook_version < 2)) THEN RETURN NULL; END IF;
  IF p_action = 'digest' AND NOT s.email_ready THEN RETURN NULL; END IF;
  RETURN net.http_post(
    url := s.functions_url,
    body := jsonb_build_object('action', p_action),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-dispatch-secret', notify_secret('kuncho_notify_dispatch_secret')),
    timeout_milliseconds := 30000);
END $function$;

-- Evenings at 17:30 Addis (14:30 UTC), Monday to Saturday.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'kuncho-bot-crew-check';
SELECT cron.schedule('kuncho-bot-crew-check', '30 14 * * 1-6', 'SELECT public.bot_crew_push()');

-- ── 16. Rights ──────────────────────────────────────────────────────────
DO $rights$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND (p.proname LIKE 'bot\_%' OR p.proname IN ('trg_bot_labour_requested', 'trg_bot_labour_decided',
           'trg_bot_trip_moved', 'trg_expense_spot_decided'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    IF f.proname IN ('bot_handle', 'bot_bind', 'bot_outbox_take', 'bot_outbox_done', 'bot_hook_version',
                     'bot_hook_set_version', 'bot_link_staff', 'bot_unlink_chat') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    ELSIF f.proname IN ('bot_staff_link_code', 'bot_staff_unlink', 'bot_activity') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END $rights$;
