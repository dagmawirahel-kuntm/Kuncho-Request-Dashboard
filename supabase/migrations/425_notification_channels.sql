-- Notifications outside the app: Telegram, a daily email, and the jobs that
-- keep news flowing when nobody has the app open (migration 424 is the inbox).
--
--   Telegram   an admin pastes the company bot's token in Settings →
--              Notifications; each person taps "Connect Telegram", presses
--              Start in the bot, and from then on gets their notifications
--              there (at or above the urgency they chose, outside their quiet
--              hours). /stop in the bot disconnects.
--   Email      a once-a-day digest of what is still unread, for people who
--              turn it on. Needs a Resend API key and a sender address.
--   Jobs       pg_cron, every minute: if anything is waiting for Telegram,
--              ask the notify-channels edge function to send it (pg_net).
--              Daily: the email digest; hourly: the tax-impact ranking, so
--              escalations are noticed even when no one opens the tax pages;
--              nightly: old read notifications are cleared.
--
-- Secrets (bot token, Resend key, the shared secrets between the database
-- and the edge function) live in Supabase Vault, never in a table people can
-- read. Only the service role (the edge function) can read them back.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- ── Settings (no secrets) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_channel_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  app_url text,                         -- where "Open in Kuncho" links point
  functions_url text NOT NULL DEFAULT 'https://kqmpjzweuwhtpvtzhyuy.supabase.co/functions/v1/notify-channels',
  telegram_bot_username text,
  telegram_ready boolean NOT NULL DEFAULT false,
  email_from text,
  email_ready boolean NOT NULL DEFAULT false,
  digest_hour_local integer NOT NULL DEFAULT 7 CHECK (digest_hour_local BETWEEN 0 AND 23),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES user_profiles(id)
);
INSERT INTO notification_channel_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE notification_channel_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_channel_settings' AND policyname = 'ncs_read') THEN
    CREATE POLICY ncs_read ON notification_channel_settings FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
GRANT SELECT ON notification_channel_settings TO authenticated;

-- ── Secrets in Vault ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_secret_put(p_name text, p_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name, 'Kuncho notifications');
  ELSE
    PERFORM vault.update_secret(v_id, p_value);
  END IF;
END $$;
REVOKE ALL ON FUNCTION notify_secret_put(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION notify_secret(p_name text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1 $$;
REVOKE ALL ON FUNCTION notify_secret(text) FROM PUBLIC, anon, authenticated;

-- The shared secrets the database and the edge function use with each other
-- and with Telegram's webhook: made once, here.
DO $$ BEGIN
  IF notify_secret('kuncho_notify_dispatch_secret') IS NULL THEN
    PERFORM notify_secret_put('kuncho_notify_dispatch_secret', encode(extensions.gen_random_bytes(24), 'hex'));
  END IF;
  IF notify_secret('kuncho_notify_telegram_hook_secret') IS NULL THEN
    PERFORM notify_secret_put('kuncho_notify_telegram_hook_secret', encode(extensions.gen_random_bytes(24), 'hex'));
  END IF;
END $$;

-- ── Admin: set up the channels ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notification_channels_admin_save(
  p_app_url text DEFAULT NULL, p_telegram_token text DEFAULT NULL,
  p_resend_key text DEFAULT NULL, p_email_from text DEFAULT NULL, p_digest_hour integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF get_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only an admin can set up notification channels'; END IF;
  IF NULLIF(btrim(p_telegram_token), '') IS NOT NULL THEN
    IF btrim(p_telegram_token) !~ '^[0-9]+:[A-Za-z0-9_-]{30,}$' THEN
      RAISE EXCEPTION 'That does not look like a Telegram bot token (it should look like 123456789:ABC…)';
    END IF;
    PERFORM notify_secret_put('kuncho_notify_telegram_token', btrim(p_telegram_token));
    -- the edge function confirms it with Telegram and sets telegram_ready
    UPDATE notification_channel_settings SET telegram_ready = false, telegram_bot_username = NULL WHERE id;
  END IF;
  IF NULLIF(btrim(p_resend_key), '') IS NOT NULL THEN
    PERFORM notify_secret_put('kuncho_notify_resend_key', btrim(p_resend_key));
  END IF;
  UPDATE notification_channel_settings SET
    app_url = COALESCE(NULLIF(rtrim(btrim(p_app_url), '/'), ''), app_url),
    email_from = COALESCE(NULLIF(btrim(p_email_from), ''), email_from),
    digest_hour_local = COALESCE(p_digest_hour, digest_hour_local),
    email_ready = (notify_secret('kuncho_notify_resend_key') IS NOT NULL
                   AND COALESCE(NULLIF(btrim(p_email_from), ''), email_from) IS NOT NULL),
    updated_at = now(), updated_by = auth.uid()
  WHERE id;
  RETURN notification_channels_admin_status();
END $$;

CREATE OR REPLACE FUNCTION notification_channels_admin_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s notification_channel_settings%ROWTYPE;
BEGIN
  IF get_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only an admin can see notification channel setup'; END IF;
  SELECT * INTO s FROM notification_channel_settings WHERE id;
  RETURN jsonb_build_object(
    'app_url', s.app_url, 'telegram_ready', s.telegram_ready, 'telegram_bot_username', s.telegram_bot_username,
    'telegram_token_saved', notify_secret('kuncho_notify_telegram_token') IS NOT NULL,
    'email_ready', s.email_ready, 'email_from', s.email_from,
    'resend_key_saved', notify_secret('kuncho_notify_resend_key') IS NOT NULL,
    'digest_hour_local', s.digest_hour_local,
    'linked_telegram', (SELECT count(*) FROM notification_prefs WHERE telegram_chat_id IS NOT NULL),
    'email_digest_on', (SELECT count(*) FROM notification_prefs WHERE email_digest),
    'last_dispatch', (SELECT max((delivered->>'telegram')::timestamptz) FROM notifications WHERE delivered ? 'telegram'),
    'jobs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active)), '[]'::jsonb)
             FROM cron.job WHERE jobname LIKE 'kuncho-%'));
END $$;
GRANT EXECUTE ON FUNCTION notification_channels_admin_save(text, text, text, text, integer),
  notification_channels_admin_status() TO authenticated;

-- ── Each person: preferences, Telegram link ─────────────────────────────────
CREATE OR REPLACE FUNCTION notification_prefs_save(
  p_outside_min_priority text, p_quiet_from time, p_quiet_to time, p_email_digest boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  INSERT INTO notification_prefs (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  UPDATE notification_prefs SET
    outside_min_priority = COALESCE(p_outside_min_priority, outside_min_priority),
    quiet_from = p_quiet_from, quiet_to = p_quiet_to,
    email_digest = COALESCE(p_email_digest, email_digest),
    updated_at = now()
  WHERE user_id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION notification_telegram_link_start()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_code text; v_bot text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT telegram_bot_username INTO v_bot FROM notification_channel_settings WHERE id AND telegram_ready;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'Telegram is not set up yet — an admin adds the bot in Settings → Notifications'; END IF;
  v_code := encode(extensions.gen_random_bytes(12), 'hex');
  INSERT INTO notification_prefs (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  UPDATE notification_prefs SET telegram_link_code = v_code, telegram_link_expires = now() + interval '15 minutes', updated_at = now()
  WHERE user_id = auth.uid();
  RETURN jsonb_build_object('url', 'https://t.me/' || v_bot || '?start=' || v_code, 'bot', v_bot, 'expires_in_minutes', 15);
END $$;

CREATE OR REPLACE FUNCTION notification_telegram_unlink()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE notification_prefs SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL,
    telegram_link_code = NULL, telegram_link_expires = NULL, updated_at = now()
  WHERE user_id = auth.uid();
END $$;
GRANT EXECUTE ON FUNCTION notification_prefs_save(text, time, time, boolean), notification_telegram_link_start(),
  notification_telegram_unlink() TO authenticated;

-- ── For the edge function (service role only) ───────────────────────────────
-- The caller's JWT role (inside a definer function current_user is always the owner, so it proves nothing).
CREATE OR REPLACE FUNCTION notify_is_service() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role' $$;

CREATE OR REPLACE FUNCTION notify_service_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s notification_channel_settings%ROWTYPE;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  SELECT * INTO s FROM notification_channel_settings WHERE id;
  RETURN jsonb_build_object(
    'app_url', s.app_url, 'functions_url', s.functions_url, 'email_from', s.email_from,
    'telegram_token', notify_secret('kuncho_notify_telegram_token'),
    'telegram_hook_secret', notify_secret('kuncho_notify_telegram_hook_secret'),
    'dispatch_secret', notify_secret('kuncho_notify_dispatch_secret'),
    'resend_key', notify_secret('kuncho_notify_resend_key'));
END $$;

CREATE OR REPLACE FUNCTION notify_service_telegram_ready(p_bot_username text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  UPDATE notification_channel_settings
     SET telegram_bot_username = p_bot_username, telegram_ready = p_bot_username IS NOT NULL, updated_at = now()
   WHERE id;
END $$;

-- /start <code> in the bot: link that chat to the person who made the code.
CREATE OR REPLACE FUNCTION notify_service_telegram_link(p_code text, p_chat_id bigint, p_username text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  SELECT user_id INTO v_user FROM notification_prefs
  WHERE telegram_link_code = p_code AND telegram_link_expires > now();
  IF v_user IS NULL THEN RETURN NULL; END IF;
  -- one chat, one person
  UPDATE notification_prefs SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL
  WHERE telegram_chat_id = p_chat_id AND user_id <> v_user;
  UPDATE notification_prefs SET telegram_chat_id = p_chat_id, telegram_username = p_username, telegram_linked_at = now(),
    telegram_link_code = NULL, telegram_link_expires = NULL, updated_at = now()
  WHERE user_id = v_user;
  RETURN COALESCE(notify_user_name(v_user), 'there');
END $$;

CREATE OR REPLACE FUNCTION notify_service_telegram_unlink_chat(p_chat_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  UPDATE notification_prefs SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL, updated_at = now()
  WHERE telegram_chat_id = p_chat_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- What is waiting for Telegram: unread, recent, urgent enough for that
-- person, outside their quiet hours (held, not dropped, until they end).
CREATE OR REPLACE FUNCTION notify_telegram_pending_q()
RETURNS TABLE (id uuid, chat_id bigint, kind text, title text, body text, link text, priority text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT n.id, p.telegram_chat_id, n.kind, n.title, n.body, n.link, n.priority, n.created_at
  FROM notifications n
  JOIN notification_prefs p ON p.user_id = n.user_id AND p.telegram_chat_id IS NOT NULL
  WHERE n.created_at > now() - interval '12 hours'
    AND n.read_at IS NULL
    AND NOT (n.delivered ? 'telegram')
    AND (notify_priority_rank(n.priority) >= notify_priority_rank(p.outside_min_priority) OR n.kind = 'system.test')
    AND NOT (p.quiet_from IS NOT NULL AND p.quiet_to IS NOT NULL AND (
          CASE WHEN p.quiet_from <= p.quiet_to
               THEN (now() AT TIME ZONE 'Africa/Addis_Ababa')::time >= p.quiet_from AND (now() AT TIME ZONE 'Africa/Addis_Ababa')::time < p.quiet_to
               ELSE (now() AT TIME ZONE 'Africa/Addis_Ababa')::time >= p.quiet_from OR (now() AT TIME ZONE 'Africa/Addis_Ababa')::time < p.quiet_to END))
  ORDER BY n.created_at $$;
REVOKE ALL ON FUNCTION notify_telegram_pending_q() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION notify_service_telegram_outbox(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM notify_telegram_pending_q() LIMIT p_limit) q), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION notify_service_mark_delivered(p_ids uuid[], p_channel text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  UPDATE notifications SET delivered = delivered || jsonb_build_object(p_channel, now())
  WHERE id = ANY (p_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- The morning email: each person's unread news from the last day.
CREATE OR REPLACE FUNCTION notify_service_digest_batch()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email, 'name', u.full_name, 'items', items))
    FROM user_profiles u
    JOIN notification_prefs p ON p.user_id = u.id AND p.email_digest
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'link', n.link,
               'priority', n.priority, 'created_at', n.created_at) ORDER BY n.created_at DESC) items
      FROM notifications n
      WHERE n.user_id = u.id AND n.read_at IS NULL AND NOT (n.delivered ? 'email')
        AND n.created_at > now() - interval '26 hours') x
    WHERE u.email IS NOT NULL AND u.account_status IS DISTINCT FROM 'disabled' AND x.items IS NOT NULL), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION notify_service_config(), notify_service_telegram_ready(text), notify_service_telegram_link(text, bigint, text),
  notify_service_telegram_unlink_chat(bigint), notify_service_telegram_outbox(integer), notify_service_mark_delivered(uuid[], text),
  notify_service_digest_batch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_service_config(), notify_service_telegram_ready(text), notify_service_telegram_link(text, bigint, text),
  notify_service_telegram_unlink_chat(bigint), notify_service_telegram_outbox(integer), notify_service_mark_delivered(uuid[], text),
  notify_service_digest_batch() TO service_role;

-- ── The jobs ────────────────────────────────────────────────────────────────
-- Call the edge function only when there is something to do.
CREATE OR REPLACE FUNCTION notify_kick(p_action text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s notification_channel_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM notification_channel_settings WHERE id;
  IF p_action = 'dispatch' AND NOT (s.telegram_ready AND EXISTS (SELECT 1 FROM notify_telegram_pending_q())) THEN RETURN NULL; END IF;
  IF p_action = 'digest' AND NOT s.email_ready THEN RETURN NULL; END IF;
  RETURN net.http_post(
    url := s.functions_url,
    body := jsonb_build_object('action', p_action),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-dispatch-secret', notify_secret('kuncho_notify_dispatch_secret')),
    timeout_milliseconds := 30000);
END $$;
REVOKE ALL ON FUNCTION notify_kick(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION notifications_cleanup()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM notifications
  WHERE (read_at IS NOT NULL AND read_at < now() - interval '120 days')
     OR created_at < now() - interval '365 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION notifications_cleanup() FROM PUBLIC, anon, authenticated;

-- The digest hour follows the setting: reschedule when it changes.
CREATE OR REPLACE FUNCTION notify_schedule_jobs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_hour integer := (SELECT (digest_hour_local - 3 + 24) % 24 FROM notification_channel_settings WHERE id);
BEGIN
  PERFORM cron.schedule('kuncho-notify-dispatch', '* * * * *', 'SELECT public.notify_kick(''dispatch'')');
  PERFORM cron.schedule('kuncho-notify-digest', '2 ' || v_hour || ' * * *', 'SELECT public.notify_kick(''digest'')');
  PERFORM cron.schedule('kuncho-tax-impact-hourly', '7 * * * *', 'SELECT public.tax_impact_recompute(false)');
  PERFORM cron.schedule('kuncho-notifications-cleanup', '23 0 * * *', 'SELECT public.notifications_cleanup()');
END $$;
REVOKE ALL ON FUNCTION notify_schedule_jobs() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trg_notify_settings_reschedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.digest_hour_local IS DISTINCT FROM OLD.digest_hour_local THEN PERFORM notify_schedule_jobs(); END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_notify_settings_reschedule
  AFTER UPDATE OF digest_hour_local ON notification_channel_settings
  FOR EACH ROW EXECUTE FUNCTION trg_notify_settings_reschedule();

SELECT notify_schedule_jobs();
