-- 438: Attendance by QR code on Telegram — from Monday, before the gate
-- tablet arrives.
--
-- Every place people work gets a QR poster: the workshop, the leather
-- workshop, the office, any site. Scanning it opens the Kuncho bot. The first
-- time, one tap shares the phone's number and the bot finds the person by the
-- number on their staff record — no login, no connect link from the office.
-- Then one tap sends their location, and the check-in is the minute Telegram
-- stamped on that message, with how far they were from the place. Scanning
-- again later offers back from lunch or leaving for the day.
--
-- Until the tablet comes, whoever minds the gate — a workshop supervisor, a
-- site foreman, HR — opens 📋 Arrivals in the bot and taps each person
-- without a smartphone in as they walk in; that moment is their check-in,
-- with who tapped it. Both land in staff_attendance, so the roll-call and the
-- month sheet show them, and how each one was made.

-- ── 1. Places with QR codes, and how a day was recorded ──────────────────
CREATE TABLE IF NOT EXISTS attendance_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- In the QR code: t.me/<bot>?start=in_<code>.
  code text NOT NULL UNIQUE DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  name text NOT NULL,
  place text NOT NULL CHECK (place IN ('office', 'workshop', 'leather_workshop', 'site')),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  latitude double precision,
  longitude double precision,
  -- How far from the point still counts as being there.
  radius_m integer NOT NULL DEFAULT 300 CHECK (radius_m BETWEEN 30 AND 5000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CHECK ((place = 'site') = (project_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_places_site_key ON attendance_places (project_id) WHERE project_id IS NOT NULL;
ALTER TABLE attendance_places ENABLE ROW LEVEL SECURITY;
DO $p$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attendance_places' AND policyname = 'attendance_places_read') THEN
    CREATE POLICY attendance_places_read ON attendance_places FOR SELECT TO authenticated USING (true);
  END IF;
END $p$;

-- How each part of a day was recorded: 'qr' (scanned the poster), 'bot' (from
-- the bot's menu), 'gate' (tapped in by whoever minds the gate). Empty means
-- typed in Kuncho. The distance is from the place, when we know where both are.
ALTER TABLE staff_attendance
  ADD COLUMN IF NOT EXISTS in_via text,
  ADD COLUMN IF NOT EXISTS in_dist_m integer,
  ADD COLUMN IF NOT EXISTS in_by_staff uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pm_via text,
  ADD COLUMN IF NOT EXISTS pm_dist_m integer,
  ADD COLUMN IF NOT EXISTS out_via text,
  ADD COLUMN IF NOT EXISTS out_dist_m integer,
  ADD COLUMN IF NOT EXISTS out_by_staff uuid REFERENCES staff(id) ON DELETE SET NULL;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_attendance_via_check') THEN
    ALTER TABLE staff_attendance ADD CONSTRAINT staff_attendance_via_check
      CHECK (COALESCE(in_via, 'qr') IN ('qr', 'bot', 'gate') AND COALESCE(pm_via, 'qr') IN ('qr', 'bot', 'gate')
         AND COALESCE(out_via, 'qr') IN ('qr', 'bot', 'gate'));
  END IF;
END $c$;

-- A time typed over in Kuncho is no longer the one the phone or the gate
-- recorded: forget how it was made, so the roll-call shows who typed it.
CREATE OR REPLACE FUNCTION staff_attendance_via_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.check_in_at IS DISTINCT FROM OLD.check_in_at AND NEW.in_via IS NOT DISTINCT FROM OLD.in_via THEN
    NEW.in_via := NULL; NEW.in_dist_m := NULL; NEW.in_by_staff := NULL;
  END IF;
  IF NEW.pm_at IS DISTINCT FROM OLD.pm_at AND NEW.pm_via IS NOT DISTINCT FROM OLD.pm_via THEN
    NEW.pm_via := NULL; NEW.pm_dist_m := NULL;
  END IF;
  IF NEW.check_out_at IS DISTINCT FROM OLD.check_out_at AND NEW.out_via IS NOT DISTINCT FROM OLD.out_via THEN
    NEW.out_via := NULL; NEW.out_dist_m := NULL; NEW.out_by_staff := NULL;
  END IF;
  RETURN NEW;
END $$;
DO $t$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_attendance_via' AND tgrelid = 'public.staff_attendance'::regclass) THEN
    CREATE TRIGGER trg_staff_attendance_via BEFORE UPDATE ON staff_attendance
      FOR EACH ROW EXECUTE FUNCTION staff_attendance_via_guard();
  END IF;
END $t$;

-- The places to start with. The workshop's point comes from the locations
-- list; the others get theirs from the posters page, standing there.
INSERT INTO attendance_places (name, place, latitude, longitude)
SELECT 'Workshop', 'workshop', l.latitude, l.longitude
FROM (SELECT 1) one
LEFT JOIN LATERAL (SELECT latitude, longitude FROM locations
                    WHERE kind = 'workshop' AND location_name = 'The WORKSHOP' AND latitude IS NOT NULL LIMIT 1) l ON true
WHERE NOT EXISTS (SELECT 1 FROM attendance_places WHERE place = 'workshop');
INSERT INTO attendance_places (name, place)
SELECT 'Leather workshop', 'leather_workshop' WHERE NOT EXISTS (SELECT 1 FROM attendance_places WHERE place = 'leather_workshop');
INSERT INTO attendance_places (name, place)
SELECT 'Office', 'office' WHERE NOT EXISTS (SELECT 1 FROM attendance_places WHERE place = 'office');
-- Sites with people on them now get theirs too, so their foremen can take
-- arrivals from the first day; HR adds the rest from the posters page.
INSERT INTO attendance_places (name, place, project_id, latitude, longitude)
SELECT btrim(p.project_name), 'site', p.id, COALESCE(p.latitude, l.latitude), COALESCE(p.longitude, l.longitude)
FROM projects p LEFT JOIN locations l ON l.id = p.location_id
WHERE NOT COALESCE(p.is_internal, false)
  AND (EXISTS (SELECT 1 FROM staff_assignments a JOIN staff s ON s.id = a.staff_id
                WHERE a.project_id = p.id AND a.active AND s.status = 'active')
    OR EXISTS (SELECT 1 FROM labor_allocations la
                WHERE la.project_id = p.id AND la.status = 'active' AND (la.end_date IS NULL OR la.end_date >= CURRENT_DATE)))
ON CONFLICT DO NOTHING;

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order)
VALUES ('attendance.unknown_phone', 'People', 'Someone checked in with a number we don''t know',
        'A phone number shared at a QR check-in isn''t on any staff record — add it to their record.', 'normal', 52)
ON CONFLICT (kind) DO NOTHING;

-- ── 2. Small helpers ────────────────────────────────────────────────────
-- The last nine digits of an Ethiopian mobile number however it was typed:
-- +251 91 234 5678, 0912345678, 251912345678 → 912345678.
CREATE OR REPLACE FUNCTION att_phone_key(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN d ~ '[79][0-9]{8}$' THEN right(d, 9) END
  FROM (SELECT regexp_replace(COALESCE(p, ''), '\D', '', 'g') AS d) x $$;

-- Metres between two points.
CREATE OR REPLACE FUNCTION att_distance_m(a_lat double precision, a_lng double precision,
                                          b_lat double precision, b_lng double precision) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians(b_lat - a_lat) / 2), 2)
           + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))))::integer $$;

-- "40 m" / "1.2 km".
CREATE OR REPLACE FUNCTION att_dist_label(p integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL THEN NULL WHEN p >= 1000 THEN to_char(p / 1000.0, 'FM990.0') || ' km' ELSE p || ' m' END $$;

-- Where someone with this staff type usually works.
CREATE OR REPLACE FUNCTION att_usual_place(p_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type WHEN 'Office' THEN 'office' WHEN 'Work Shop' THEN 'workshop'
                     WHEN 'Leather Workshop' THEN 'leather_workshop' WHEN 'Site' THEN 'site' END $$;

-- On time or late, by the rules on the attendance page: against the start of
-- the day, or the end of lunch.
CREATE OR REPLACE FUNCTION att_status_for(p_at timestamptz, p_lunch boolean) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT CASE WHEN (p_at AT TIME ZONE 'Africa/Addis_Ababa')::time
                     > CASE WHEN p_lunch THEN COALESCE(s.lunch_ends, '13:30'::time) ELSE s.day_starts END
                       + make_interval(mins => s.late_after_minutes)
                THEN 'late' ELSE 'present' END
    FROM attendance_settings s WHERE s.id), 'present') $$;

CREATE OR REPLACE FUNCTION att_place_by_code(p_code text) RETURNS attendance_places
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM attendance_places WHERE code = lower(p_code) AND active LIMIT 1 $$;

-- Keyboards under the message box: Telegram's only way to ask for a phone
-- number or a location. Each goes away after one tap.
CREATE OR REPLACE FUNCTION att_keys(p_rows jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('keyboard', p_rows, 'resize_keyboard', true, 'one_time_keyboard', true) $$;

CREATE OR REPLACE FUNCTION att_phone_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT att_keys(jsonb_build_array(jsonb_build_array(jsonb_build_object('text', '📱 Share my number', 'request_contact', true)))) $$;

CREATE OR REPLACE FUNCTION att_loc_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT att_keys(jsonb_build_array(
    jsonb_build_array(jsonb_build_object('text', '📍 Send my location', 'request_location', true)),
    jsonb_build_array(jsonb_build_object('text', '✖ Cancel')))) $$;

CREATE OR REPLACE FUNCTION att_no_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"remove_keyboard": true}'::jsonb $$;

-- ── 3. Recording ────────────────────────────────────────────────────────
-- A check-in, back from lunch or check-out ('in' | 'pm' | 'out') for one
-- person at a place, at the time given. p_by: who tapped it at the gate.
CREATE OR REPLACE FUNCTION att_record(p_staff uuid, pl attendance_places, p_mode text, p_at timestamptz,
                                      p_lat double precision, p_lng double precision, p_via text, p_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_day date := (p_at AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_dist integer := att_distance_m(pl.latitude, pl.longitude, p_lat, p_lng);
  v_status text;
  r staff_attendance;
BEGIN
  IF p_staff IS NULL THEN RAISE EXCEPTION 'Your Kuncho login isn''t linked to a staff record — ask HR to link it'; END IF;
  SELECT * INTO r FROM staff_attendance WHERE staff_id = p_staff AND work_date = v_day;
  IF p_mode = 'in' THEN
    v_status := att_status_for(p_at, false);
    IF r.id IS NULL THEN
      INSERT INTO staff_attendance (staff_id, work_date, status, check_in_at, place, project_id, source,
                                    in_lat, in_lng, in_via, in_dist_m, in_by_staff)
      VALUES (p_staff, v_day, v_status, p_at, pl.place, pl.project_id, CASE WHEN p_by IS NULL THEN 'self' ELSE 'register' END,
              p_lat, p_lng, p_via, v_dist, p_by)
      RETURNING * INTO r;
    ELSIF r.check_in_at IS NOT NULL THEN
      RAISE EXCEPTION 'Already in since %', bot_clock(r.check_in_at);
    ELSE
      -- Marked earlier without a time (a roll-call): the time is now known.
      UPDATE staff_attendance
         SET check_in_at = p_at, status = CASE WHEN status IN ('present', 'late', 'absent') THEN v_status ELSE status END,
             place = pl.place, project_id = pl.project_id, in_lat = p_lat, in_lng = p_lng,
             in_via = p_via, in_dist_m = v_dist, in_by_staff = p_by
       WHERE id = r.id RETURNING * INTO r;
    END IF;
  ELSIF p_mode = 'pm' THEN
    IF r.check_in_at IS NULL THEN RAISE EXCEPTION 'Check in first'; END IF;
    IF r.pm_status IS NOT NULL THEN RAISE EXCEPTION 'Already back since %', COALESCE(bot_clock(r.pm_at), 'lunch'); END IF;
    v_status := att_status_for(p_at, true);
    UPDATE staff_attendance SET pm_status = v_status, pm_at = p_at, pm_via = p_via, pm_dist_m = v_dist
     WHERE id = r.id RETURNING * INTO r;
  ELSIF p_mode = 'out' THEN
    IF r.check_in_at IS NULL THEN RAISE EXCEPTION 'Check in first'; END IF;
    IF r.check_out_at IS NOT NULL THEN RAISE EXCEPTION 'Already out since %', bot_clock(r.check_out_at); END IF;
    UPDATE staff_attendance SET check_out_at = greatest(p_at, r.check_in_at), out_lat = p_lat, out_lng = p_lng,
           out_via = p_via, out_dist_m = v_dist, out_by_staff = p_by
     WHERE id = r.id RETURNING * INTO r;
  ELSE
    RAISE EXCEPTION 'Unknown attendance step %', p_mode;
  END IF;
  RETURN jsonb_build_object('at', p_at, 'status', CASE WHEN p_mode = 'pm' THEN r.pm_status ELSE r.status END,
    'dist', v_dist, 'far', COALESCE(v_dist > pl.radius_m, false), 'place', pl.name);
END $$;

-- ── 4. The bot: scan, share your number once, send your location ────────
-- What a scan means right now for this person: check in, or — once in —
-- back from lunch or leaving. t: the conversation to use, if there is one.
CREATE OR REPLACE FUNCTION att_next(p_actor jsonb, pl attendance_places, p_via text, t bot_threads) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_chat bigint := (p_actor->>'chat')::bigint;
  v_staff uuid := NULLIF(p_actor->>'staff_id', '')::uuid;
  r staff_attendance;
  v_state jsonb;
BEGIN
  IF pl.id IS NULL THEN
    RETURN bot_msg(v_chat, 'This QR code isn''t in use any more. Ask the office for the new one.', att_no_keys());
  END IF;
  IF v_staff IS NULL THEN
    RETURN bot_msg(v_chat, 'Your Kuncho login isn''t linked to a staff record, so I can''t record your attendance. Ask HR to link it.', att_no_keys());
  END IF;
  -- One attendance conversation at a time.
  UPDATE bot_threads SET closed_at = now()
   WHERE chat_id = v_chat AND kind = 'att' AND closed_at IS NULL AND id IS DISTINCT FROM t.id;
  v_state := jsonb_build_object('place', pl.id, 'via', p_via);
  IF t.id IS NULL THEN t := bot_thread_new(p_actor, 'att', v_state); END IF;
  SELECT * INTO r FROM staff_attendance WHERE staff_id = v_staff AND work_date = bot_today();

  IF r.check_in_at IS NULL THEN
    PERFORM bot_thread_save(t.id, 'att', v_state || '{"mode": "in"}'::jsonb);
    PERFORM bot_await(v_chat, t.id, 'att_loc');
    RETURN bot_msg(v_chat, '📍 <b>' || bot_esc(pl.name) || '</b> · check in'
      || E'\nTap <b>📍 Send my location</b> below. The moment you send it is your check-in.', att_loc_keys());
  ELSIF r.check_out_at IS NOT NULL THEN
    PERFORM bot_thread_save(t.id, 'att', v_state, true);
    RETURN bot_msg(v_chat, '👋 You checked out at <b>' || bot_clock(r.check_out_at) || '</b> today. See you tomorrow!', att_no_keys());
  END IF;
  PERFORM bot_thread_save(t.id, 'att', v_state || '{"mode": "choose"}'::jsonb);
  RETURN bot_show(t, jsonb_build_object(
    'text', '🕘 In since <b>' || bot_clock(r.check_in_at) || '</b> · ' || bot_esc(pl.name)
      || CASE WHEN r.pm_status IS NOT NULL THEN E'\nBack from lunch at ' || COALESCE(bot_clock(r.pm_at), '—') ELSE '' END
      || E'\n\nWhat now?',
    'kb', bot_kb(jsonb_build_array(
      CASE WHEN r.pm_status IS NULL THEN jsonb_build_array(bot_btn('🍽 Back from lunch', 'a:p')) ELSE '[]'::jsonb END,
      jsonb_build_array(bot_btn('🏁 Leaving for the day', 'a:o')),
      jsonb_build_array(bot_btn('✖ Nothing', 'x'))))));
END $$;

-- A phone number shared with the button: find the staff record with it and
-- connect this chat to them, then carry on with the scan that asked for it.
CREATE OR REPLACE FUNCTION att_contact(p_chat bigint, p_msg jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_key text := att_phone_key(p_msg #>> '{contact,phone_number}');
  v_ids uuid[];
  v_staff uuid;
  v_name text;
  v_actor jsonb;
  c bot_chats;
  t bot_threads;
  pl attendance_places;
BEGIN
  -- Only their own number: the button sends the account's, a contact card could be anyone's.
  IF (p_msg #>> '{contact,user_id}') IS DISTINCT FROM (p_msg #>> '{from,id}') THEN
    RETURN bot_msg(p_chat, 'Share <b>your own</b> number with the button below.', att_phone_keys());
  END IF;
  SELECT array_agg(s.id) INTO v_ids FROM staff s
   WHERE v_key IS NOT NULL AND COALESCE(s.status, 'active') = 'active' AND att_phone_key(s.phone_number) = v_key;
  IF COALESCE(cardinality(v_ids), 0) <> 1 THEN
    PERFORM notify(notify_role_users(ARRAY['hr_officer', 'admin']), 'attendance.unknown_phone',
      'A check-in from a number we don''t know',
      COALESCE('0' || v_key, p_msg #>> '{contact,phone_number}')
        || COALESCE(' (' || NULLIF(btrim(concat_ws(' ', p_msg #>> '{contact,first_name}', p_msg #>> '{contact,last_name}')), '') || ' on Telegram)', '')
        || CASE WHEN cardinality(v_ids) > 1 THEN ' is on ' || cardinality(v_ids) || ' staff records.' ELSE ' isn''t on any staff record.' END
        || ' Put it on the right record and they can scan again.',
      '/staff', NULL, NULL, NULL, 'attendance.unknown_phone:' || COALESCE(v_key, p_chat::text) || ':' || bot_today());
    RETURN bot_msg(p_chat, '🤔 I can''t find <b>' || bot_esc(COALESCE('0' || v_key, p_msg #>> '{contact,phone_number}')) || '</b> on '
      || CASE WHEN cardinality(v_ids) > 1 THEN 'just one staff record' ELSE 'any staff record' END
      || E'.\n\nI''ve told HR. Once your number is on your record, scan the QR code again.', att_no_keys());
  END IF;
  v_staff := v_ids[1];
  v_name := (SELECT btrim(employee_name) FROM staff WHERE id = v_staff);
  UPDATE bot_staff_links SET chat_id = NULL, username = NULL, linked_at = NULL WHERE chat_id = p_chat AND staff_id <> v_staff;
  INSERT INTO bot_staff_links (staff_id, chat_id, username, linked_at)
  VALUES (v_staff, p_chat, p_msg #>> '{from,username}', now())
  ON CONFLICT (staff_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, username = EXCLUDED.username, linked_at = now(),
                                       link_code = NULL, link_expires = NULL;

  v_actor := bot_actor(p_chat);
  SELECT * INTO c FROM bot_chats WHERE chat_id = p_chat;
  SELECT * INTO t FROM bot_threads WHERE id = c.awaiting_thread AND kind = 'att' AND closed_at IS NULL;
  PERFORM bot_await_clear(p_chat);
  IF t.id IS NULL OR v_actor IS NULL THEN
    RETURN bot_msg(p_chat, '✅ Connected, <b>' || bot_esc(v_name) || '</b>. Scan the QR code at work to check in.', att_no_keys());
  END IF;
  UPDATE bot_threads SET actor_staff = v_staff WHERE id = t.id;
  PERFORM bot_become(v_actor);
  SELECT * INTO pl FROM attendance_places WHERE id = (t.state->>'place')::uuid AND active;
  RETURN bot_msg(p_chat, '✅ Connected, <b>' || bot_esc(v_name) || '</b>. From now on, scanning the code is all it takes.')
      || att_next(v_actor, pl, COALESCE(t.state->>'via', 'qr'), t);
END $$;

-- A chat Kuncho doesn't know yet: a scanned attendance code, or the number it
-- asked for, can connect it. NULL when it is neither.
CREATE OR REPLACE FUNCTION att_unlinked(p_chat bigint, p_msg jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_text text := btrim(COALESCE(p_msg->>'text', ''));
  pl attendance_places;
  t bot_threads;
BEGIN
  IF v_text ~* '^/start(@\w+)?\s+in_[a-z0-9]+$' THEN
    pl := att_place_by_code(substring(v_text FROM 'in_([A-Za-z0-9]+)$'));
    IF pl.id IS NULL THEN
      RETURN bot_msg(p_chat, 'This QR code isn''t in use any more. Ask the office for the new one.');
    END IF;
    UPDATE bot_threads SET closed_at = now() WHERE chat_id = p_chat AND kind = 'att' AND closed_at IS NULL;
    t := bot_thread_new('{}'::jsonb, 'att', jsonb_build_object('place', pl.id, 'via', 'qr'), NULL, p_chat);
    PERFORM bot_await(p_chat, t.id, 'att_phone');
    RETURN bot_msg(p_chat, '👋 <b>Kuncho attendance</b> · ' || bot_esc(pl.name)
      || E'\n\nThe first time, tap <b>📱 Share my number</b> below so I know who you are. It''s matched with the number on your staff record.',
      att_phone_keys());
  ELSIF p_msg ? 'contact' THEN
    RETURN att_contact(p_chat, p_msg);
  ELSIF EXISTS (SELECT 1 FROM bot_chats WHERE chat_id = p_chat AND awaiting = 'att_phone') THEN
    RETURN bot_msg(p_chat, 'Tap <b>📱 Share my number</b> below so I know who you are.', att_phone_keys());
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'att_unlinked: %', SQLERRM;
  RETURN bot_msg(p_chat, '⚠️ Something went wrong — scan the code again in a minute.');
END $$;

-- The location the question asked for: record it.
CREATE OR REPLACE FUNCTION att_location(p_actor jsonb, p_msg jsonb, t bot_threads) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_chat bigint := (p_actor->>'chat')::bigint;
  v_mode text := t.state->>'mode';
  -- Telegram's own stamp of when it was sent, not the phone's clock.
  v_at timestamptz := COALESCE(to_timestamp((p_msg->>'date')::double precision), now());
  pl attendance_places;
  v jsonb;
BEGIN
  IF p_msg ? 'forward_origin' OR p_msg ? 'forward_date' THEN
    RETURN bot_msg(v_chat, 'That location was forwarded. Tap <b>📍 Send my location</b> below instead.', att_loc_keys());
  END IF;
  SELECT * INTO pl FROM attendance_places WHERE id = (t.state->>'place')::uuid;
  IF pl.id IS NULL OR v_mode IS NULL OR v_mode NOT IN ('in', 'pm', 'out') THEN
    PERFORM bot_await_clear(v_chat);
    RETURN bot_msg(v_chat, 'Scan the QR code again to start over.', att_no_keys());
  END IF;
  v := att_record(NULLIF(p_actor->>'staff_id', '')::uuid, pl, v_mode, v_at,
                  (p_msg #>> '{location,latitude}')::double precision, (p_msg #>> '{location,longitude}')::double precision,
                  COALESCE(t.state->>'via', 'qr'), NULL);
  PERFORM bot_await_clear(v_chat);
  PERFORM bot_thread_save(t.id, 'att', t.state, true);
  RETURN bot_msg(v_chat,
    CASE v_mode WHEN 'in' THEN '✅ <b>In at ' WHEN 'pm' THEN '✅ <b>Back at ' ELSE '👋 <b>Out at ' END || bot_clock(v_at) || '</b> · ' || bot_esc(pl.name)
    || CASE WHEN v->>'status' IS DISTINCT FROM 'late' THEN ''
            WHEN v_mode = 'in' THEN E'\n⏰ After the start time, so it''s marked late.'
            WHEN v_mode = 'pm' THEN E'\n⏰ After lunch ended, so it''s marked late.' ELSE '' END
    || CASE WHEN (v->>'far')::boolean
            THEN E'\n⚠️ You''re ' || att_dist_label((v->>'dist')::integer) || ' from ' || bot_esc(pl.name)
                 || '. It''s recorded, and your supervisor sees how far you were.' ELSE '' END
    || CASE v_mode WHEN 'in' THEN E'\n\nScan the code again when you''re back from lunch or leaving.'
                   WHEN 'out' THEN E'\n\nHave a good evening!' ELSE '' END,
    att_no_keys());
END $$;

-- Something typed while a location or number is awaited.
CREATE OR REPLACE FUNCTION att_text(t bot_threads, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_text ~* 'cancel|\mstop\M|\mno\M' THEN
    PERFORM bot_await_clear(t.chat_id);
    PERFORM bot_thread_save(t.id, 'att', t.state, true);
    RETURN bot_msg(t.chat_id, 'Cancelled. Scan the QR code again whenever you need.', att_no_keys());
  END IF;
  RETURN bot_msg(t.chat_id, 'Tap <b>📍 Send my location</b> below — or <b>✖ Cancel</b>.', att_loc_keys());
END $$;

-- From the menu, without a QR code: pick where you are.
CREATE OR REPLACE FUNCTION att_menu_pick(t bot_threads, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_staff uuid := NULLIF(p_actor->>'staff_id', '')::uuid;
  v_usual text;
  v_places jsonb;
  v_items jsonb;
  r staff_attendance;
  pl attendance_places;
BEGIN
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your Kuncho login isn''t linked to a staff record — ask HR to link it'; END IF;
  -- Already in today: the place is known, go straight to lunch or leaving.
  SELECT * INTO r FROM staff_attendance WHERE staff_id = v_staff AND work_date = bot_today();
  IF r.check_in_at IS NOT NULL THEN
    SELECT * INTO pl FROM attendance_places ap
     WHERE ap.active AND ap.place = r.place AND ap.project_id IS NOT DISTINCT FROM r.project_id LIMIT 1;
    IF pl.id IS NOT NULL THEN
      RETURN bot_edit(t.chat_id, t.message_id, '🕘 <b>' || bot_esc(pl.name) || '</b>') || att_next(p_actor, pl, 'bot', NULL);
    END IF;
  END IF;
  v_usual := att_usual_place((SELECT staff_type FROM staff WHERE id = v_staff));
  SELECT jsonb_agg(jsonb_build_object('id', ap.id, 'name', ap.name)
           ORDER BY (ap.project_id IS NULL AND ap.place = v_usual) DESC,
                    EXISTS (SELECT 1 FROM staff_assignments a WHERE a.staff_id = v_staff AND a.active AND a.project_id = ap.project_id) DESC,
                    ap.project_id IS NOT NULL, ap.name)
    INTO v_places FROM attendance_places ap WHERE ap.active;
  IF v_places IS NULL THEN RAISE EXCEPTION 'No places are set up for attendance yet'; END IF;
  PERFORM bot_thread_save(t.id, 'att', jsonb_build_object('step', 'pick', 'places', v_places, 'via', 'bot'));
  SELECT jsonb_agg(bot_btn(left(x->>'name', 40), 'a:pl:' || (i - 1)) ORDER BY i) INTO v_items
    FROM jsonb_array_elements(v_places) WITH ORDINALITY e(x, i);
  RETURN bot_edit(t.chat_id, t.message_id, '🕘 <b>Check in / out</b>' || E'\n\nWhere are you? (Next time, just scan the QR code there.)',
    bot_kb(bot_grid(v_items, 1) || jsonb_build_array(jsonb_build_array(bot_btn('✖ Cancel', 'x')))));
END $$;

-- Buttons on an attendance conversation: a place picked from the menu, back
-- from lunch, leaving.
CREATE OR REPLACE FUNCTION att_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  pl attendance_places;
  v_mode text := CASE p_data WHEN 'a:p' THEN 'pm' WHEN 'a:o' THEN 'out' END;
BEGIN
  IF p_data LIKE 'a:pl:%' THEN
    SELECT * INTO pl FROM attendance_places
     WHERE id = (t.state->'places'->(split_part(p_data, ':', 3)::integer)->>'id')::uuid AND active;
    IF pl.id IS NULL THEN RETURN bot_answer(NULL, 'That place isn''t in use any more.', true); END IF;
    RETURN bot_edit(t.chat_id, t.message_id, '🕘 <b>' || bot_esc(pl.name) || '</b>') || att_next(p_actor, pl, 'bot', t);
  END IF;
  IF v_mode IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO pl FROM attendance_places WHERE id = (t.state->>'place')::uuid;
  IF pl.id IS NULL THEN RETURN bot_answer(NULL, 'Scan the QR code again.', true); END IF;
  PERFORM bot_thread_save(t.id, 'att', t.state || jsonb_build_object('mode', v_mode));
  PERFORM bot_await(t.chat_id, t.id, 'att_loc');
  RETURN bot_edit(t.chat_id, t.message_id,
           CASE v_mode WHEN 'pm' THEN '🍽 Back from lunch' ELSE '🏁 Leaving for the day' END || ' · ' || bot_esc(pl.name))
      || bot_msg(t.chat_id, 'Tap <b>📍 Send my location</b> below. The moment you send it is what''s recorded.', att_loc_keys());
END $$;

-- ── 5. The gate: whoever minds it taps people in ────────────────────────
-- Places someone can tap people in at: HR, admin and operations anywhere;
-- whoever looks after people who work at the workshop, leather workshop or
-- office (their supervisor or department head) there; whoever runs a site at it.
CREATE OR REPLACE FUNCTION att_gate_places(p_actor jsonb) RETURNS SETOF attendance_places
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ap.* FROM attendance_places ap
  WHERE ap.active AND (
       COALESCE(p_actor->>'role' IN ('admin', 'hr_officer', 'operations_manager', 'executive'), false)
    OR (ap.project_id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM staff_assignments a WHERE a.project_id = ap.project_id AND a.active
                     AND a.staff_id = NULLIF(p_actor->>'staff_id', '')::uuid)
       OR EXISTS (SELECT 1 FROM projects p WHERE p.id = ap.project_id AND p.project_manager_id = NULLIF(p_actor->>'staff_id', '')::uuid)))
    OR (ap.project_id IS NULL AND EXISTS (
          SELECT 1 FROM staff s LEFT JOIN departments d ON d.id = s.department_id
           WHERE s.status = 'active' AND att_usual_place(s.staff_type) = ap.place
             AND (s.reports_to_id = NULLIF(p_actor->>'staff_id', '')::uuid
                  OR d.head_staff_id = NULLIF(p_actor->>'staff_id', '')::uuid))))
  ORDER BY ap.project_id IS NOT NULL, ap.name $$;

-- Who is expected at a place: its staff (workshop, leather workshop, office),
-- or for a site, the staff assigned to it and the workers on it today.
CREATE OR REPLACE FUNCTION att_gate_people(pl attendance_places) RETURNS TABLE (staff_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT s.id, btrim(s.employee_name) FROM staff s
  WHERE s.status = 'active' AND (
       (pl.project_id IS NULL AND att_usual_place(s.staff_type) = pl.place AND COALESCE(s.employment_type, '') <> 'tier_2_casual')
    OR (pl.project_id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM staff_assignments a WHERE a.staff_id = s.id AND a.project_id = pl.project_id AND a.active)
       OR EXISTS (SELECT 1 FROM labor_allocations la
                   WHERE la.staff_id = s.id AND la.project_id = pl.project_id AND la.status = 'active'
                     AND COALESCE(la.start_date, bot_today()) <= bot_today()
                     AND (la.end_date IS NULL OR la.end_date >= bot_today())))))
  ORDER BY btrim(s.employee_name) $$;

CREATE OR REPLACE FUNCTION att_gate_view(s jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_leaving boolean := COALESCE((s->>'leaving')::boolean, false);
  v_items jsonb;
  v_in integer;
  v_out integer;
  v_not integer;
  v_more integer;
  v_recent text;
BEGIN
  IF s->>'step' = 'place' THEN
    SELECT jsonb_agg(bot_btn(left(x->>'name', 40), 'g:p:' || (i - 1)) ORDER BY i) INTO v_items
      FROM jsonb_array_elements(COALESCE(s->'places', '[]'::jsonb)) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object('text', '📋 <b>Arrivals</b>' || E'\n\nWhich place?',
      'kb', bot_kb(bot_grid(v_items, 1) || jsonb_build_array(jsonb_build_array(bot_btn('✖ Close', 'x')))));
  END IF;
  WITH ppl AS (
    SELECT (x.e->>'id')::uuid AS id, x.e->>'name' AS name, (x.i - 1) AS ix, a.check_in_at, a.check_out_at
    FROM jsonb_array_elements(COALESCE(s->'people', '[]'::jsonb)) WITH ORDINALITY x(e, i)
    LEFT JOIN staff_attendance a ON a.staff_id = (x.e->>'id')::uuid AND a.work_date = bot_today()
  ), due AS (
    SELECT * FROM ppl
     WHERE CASE WHEN v_leaving THEN check_in_at IS NOT NULL AND check_out_at IS NULL ELSE check_in_at IS NULL END
  )
  SELECT (SELECT jsonb_agg(bot_btn(CASE WHEN v_leaving THEN '🏁 ' ELSE '' END || left(d.name, 22),
                                   CASE WHEN v_leaving THEN 'g:o:' ELSE 'g:i:' END || d.ix) ORDER BY d.name)
            FROM (SELECT * FROM due ORDER BY name LIMIT 80) d),
         (SELECT count(*) FROM ppl WHERE check_in_at IS NOT NULL AND check_out_at IS NULL),
         (SELECT count(*) FROM ppl WHERE check_out_at IS NOT NULL),
         (SELECT count(*) FROM ppl WHERE check_in_at IS NULL),
         (SELECT greatest(count(*) - 80, 0) FROM due),
         (SELECT string_agg(z.name || ' ' || bot_clock(z.check_in_at), ', ' ORDER BY z.check_in_at DESC)
            FROM (SELECT * FROM ppl WHERE check_in_at IS NOT NULL ORDER BY check_in_at DESC LIMIT 3) z)
    INTO v_items, v_in, v_out, v_not, v_more, v_recent;
  RETURN jsonb_build_object(
    'text', '📋 <b>Arrivals · ' || bot_esc(s->>'place_name') || '</b> · ' || bot_day(bot_today())
      || E'\n✅ ' || v_in || ' in · ⬜ ' || v_not || ' not yet' || CASE WHEN v_out > 0 THEN ' · 🏁 ' || v_out || ' gone' ELSE '' END
      || CASE WHEN v_recent IS NOT NULL THEN E'\nLatest: ' || bot_esc(v_recent) ELSE '' END
      || E'\n\n' || CASE WHEN v_leaving THEN 'Tap a name as they leave — that moment is their check-out.'
                         ELSE 'Tap a name as they walk in — that moment is their check-in. People with a smartphone scan the QR code themselves.' END
      || CASE WHEN v_items IS NULL THEN E'\n\n' || CASE WHEN v_leaving THEN 'Nobody is in to check out.' ELSE 'Everyone is in. 👍' END ELSE '' END
      || CASE WHEN v_more > 0 THEN E'\n…and ' || v_more || ' more below the first 80.' ELSE '' END,
    'kb', bot_kb(bot_grid(COALESCE(v_items, '[]'::jsonb), 2) || jsonb_build_array(jsonb_build_array(
      bot_btn(CASE WHEN v_leaving THEN '🕘 Arriving' ELSE '🏁 Leaving' END, 'g:l'), bot_btn('🔄 Refresh', 'g:r'), bot_btn('✖ Close', 'x')))));
END $$;

-- Open the list for one place.
CREATE OR REPLACE FUNCTION att_gate_at(t bot_threads, p_place uuid, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  pl attendance_places;
  v_people jsonb;
  s jsonb;
BEGIN
  SELECT g.* INTO pl FROM att_gate_places(p_actor) g WHERE g.id = p_place;
  IF pl.id IS NULL THEN RAISE EXCEPTION 'You can''t record arrivals there'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id', p.staff_id, 'name', p.name) ORDER BY p.name) INTO v_people FROM att_gate_people(pl) p;
  s := jsonb_build_object('step', 'list', 'place', pl.id, 'place_name', pl.name, 'people', COALESCE(v_people, '[]'::jsonb), 'leaving', false);
  PERFORM bot_thread_save(t.id, 'gate', s);
  RETURN bot_show(t, att_gate_view(s));
END $$;

CREATE OR REPLACE FUNCTION att_gate_open(t bot_threads, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_places jsonb;
  s jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name)) INTO v_places FROM att_gate_places(p_actor) g;
  IF v_places IS NULL THEN RAISE EXCEPTION 'Arrivals is for supervisors, site foremen and HR'; END IF;
  IF jsonb_array_length(v_places) = 1 THEN RETURN att_gate_at(t, (v_places->0->>'id')::uuid, p_actor); END IF;
  s := jsonb_build_object('step', 'place', 'places', v_places);
  PERFORM bot_thread_save(t.id, 'gate', s);
  RETURN bot_show(t, att_gate_view(s));
END $$;

CREATE OR REPLACE FUNCTION att_gate_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_person jsonb;
  pl attendance_places;
  v jsonb;
  v_toast text;
BEGIN
  IF p_data LIKE 'g:p:%' THEN
    RETURN att_gate_at(t, (s->'places'->(split_part(p_data, ':', 3)::integer)->>'id')::uuid, p_actor);
  ELSIF p_data = 'g:l' THEN
    s := jsonb_set(s, '{leaving}', to_jsonb(NOT COALESCE((s->>'leaving')::boolean, false)));
  ELSIF p_data ~ '^g:[io]:[0-9]+$' THEN
    v_person := s->'people'->(split_part(p_data, ':', 3)::integer);
    IF v_person IS NULL THEN RETURN bot_answer(NULL, 'That list is old — tap 🔄 Refresh.', true); END IF;
    -- Still allowed to record at this place?
    SELECT g.* INTO pl FROM att_gate_places(p_actor) g WHERE g.id = (s->>'place')::uuid;
    IF pl.id IS NULL THEN RAISE EXCEPTION 'You can''t record arrivals there any more'; END IF;
    v := att_record((v_person->>'id')::uuid, pl, CASE WHEN p_data LIKE 'g:i:%' THEN 'in' ELSE 'out' END, now(),
                    NULL, NULL, 'gate', NULLIF(p_actor->>'staff_id', '')::uuid);
    v_toast := (v_person->>'name') || CASE WHEN p_data LIKE 'g:i:%' THEN ' in at ' ELSE ' out at ' END || bot_clock(now())
               || CASE WHEN p_data LIKE 'g:i:%' AND v->>'status' = 'late' THEN ' — late' ELSE '' END;
  ELSIF p_data <> 'g:r' THEN
    RETURN '[]'::jsonb;
  END IF;
  PERFORM bot_thread_save(t.id, 'gate', s);
  RETURN CASE WHEN v_toast IS NOT NULL THEN bot_answer(NULL, v_toast) ELSE '[]'::jsonb END || bot_show(t, att_gate_view(s));
END $$;

-- ── 6. Into the bot ─────────────────────────────────────────────────────
-- As in 434, with a chat Kuncho doesn't know yet able to connect itself by
-- scanning an attendance code.
CREATE OR REPLACE FUNCTION bot_handle(p_update jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cb jsonb := p_update->'callback_query';
  v_msg jsonb := p_update->'message';
  v_chat bigint := COALESCE((p_update #>> '{callback_query,message,chat,id}')::bigint, (p_update #>> '{message,chat,id}')::bigint);
  v_type text := COALESCE(p_update #>> '{callback_query,message,chat,type}', p_update #>> '{message,chat,type}');
  v_mid bigint := (p_update #>> '{callback_query,message,message_id}')::bigint;
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
    v_out := att_unlinked(v_chat, v_msg);
    IF v_out IS NOT NULL THEN RETURN v_out; END IF;
    RETURN bot_msg(v_chat, 'Hi! This chat isn''t connected to Kuncho yet. If you have a Kuncho login, open '
      || '<b>Settings → Notifications</b> and tap <b>Connect Telegram</b>. Otherwise scan the attendance QR code at work, '
      || 'or ask the office for your connect link.');
  END IF;

  -- A card that went out without its message id being kept: find it by what it says.
  IF v_cb IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bot_threads WHERE chat_id = v_chat AND message_id = v_mid AND closed_at IS NULL) THEN
    t := bot_thread_by_text(v_chat, v_mid, v_cb #>> '{message,text}');
  END IF;
  PERFORM bot_become(v_actor);

  BEGIN
    IF v_cb IS NOT NULL THEN
      SELECT * INTO t FROM bot_threads
       WHERE chat_id = v_chat AND message_id = v_mid AND closed_at IS NULL;
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

-- As in 436, with attendance: a scanned code, then the location it asks for.
CREATE OR REPLACE FUNCTION bot_on_message(p_actor jsonb, p_msg jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_chat bigint := (p_actor->>'chat')::bigint;
  v_text text := btrim(COALESCE(p_msg->>'text', p_msg->>'caption', ''));
  v_media text := CASE WHEN p_msg ? 'photo' THEN 'photo' WHEN p_msg ? 'voice' THEN 'voice note' WHEN p_msg ? 'video' THEN 'video'
                       WHEN p_msg ? 'video_note' THEN 'video note' WHEN p_msg ? 'audio' THEN 'audio'
                       WHEN p_msg ? 'document' THEN 'file' END;
  c bot_chats;
  t bot_threads;
BEGIN
  IF v_text ~* '^/start(@\w+)?\s+in_[a-z0-9]+$' THEN
    PERFORM bot_await_clear(v_chat);
    RETURN att_next(p_actor, att_place_by_code(substring(v_text FROM 'in_([A-Za-z0-9]+)$')), 'qr', NULL);
  END IF;
  IF v_text ~* '^/(start|menu)(@\w+)?$' OR lower(v_text) IN ('menu', 'ምናሌ', 'hi', 'hello', 'selam', 'ሰላም', 'start') THEN
    PERFORM bot_await_clear(v_chat);
    RETURN bot_menu_new(p_actor);
  ELSIF v_text ~* '^/help(@\w+)?$' THEN
    RETURN bot_msg(v_chat, 'Tap /menu and pick what you need: workers, a truck, or ticking who worked today. '
      || 'Everything is buttons — you only type a number, a name or a short note when I ask.');
  ELSIF v_text ~* '^/cancel(@\w+)?$' THEN
    PERFORM bot_await_clear(v_chat);
    RETURN bot_msg(v_chat, 'OK. Send /menu when you need something.', att_no_keys());
  END IF;

  SELECT * INTO c FROM bot_chats WHERE chat_id = v_chat;
  IF p_msg ? 'location' THEN
    IF c.awaiting = 'att_loc' THEN
      SELECT * INTO t FROM bot_threads WHERE id = c.awaiting_thread AND closed_at IS NULL;
      IF FOUND THEN RETURN att_location(p_actor, p_msg, t); END IF;
    END IF;
    RETURN bot_msg(v_chat, 'To check in, scan the QR code where you work — or send /menu and tap <b>🕘 Check in / out</b>.', att_no_keys());
  ELSIF p_msg ? 'contact' THEN
    RETURN bot_msg(v_chat, 'You''re already connected as <b>' || bot_esc(p_actor->>'name') || '</b>.', att_no_keys());
  END IF;

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
        WHEN c.awaiting IN ('deal_driver', 'deal_price', 'deal_pay_tb', 'deal_pay_acct') THEN bot_deal_text(t, c.awaiting, v_text, p_actor)
        WHEN c.awaiting = 'new_worker' THEN bot_aw_text(t, v_text, p_actor)
        WHEN c.awaiting = 'reject_reason' THEN bot_lr_reason_text(t, v_text, p_actor)
        WHEN c.awaiting = 'trip_problem' THEN bot_trip_problem(t, v_text, p_actor)
        WHEN c.awaiting = 'spot_question' THEN bot_spot_question(t, v_text, p_actor)
        WHEN c.awaiting IN ('att_loc', 'att_phone') THEN att_text(t, v_text, p_actor)
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

-- As in 435, with 🕘 Check in / out and 📋 Arrivals.
CREATE OR REPLACE FUNCTION bot_on_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sites jsonb;
BEGIN
  PERFORM bot_await_clear(t.chat_id);
  IF p_data = 'x' THEN
    PERFORM bot_thread_save(t.id, t.kind, t.state, true);
    RETURN bot_edit(t.chat_id, t.message_id, 'Cancelled. Send /menu when you need something.');
  ELSIF p_data = 'm:in' THEN
    RETURN att_menu_pick(t, p_actor);
  ELSIF p_data = 'm:g' THEN
    RETURN att_gate_open(t, p_actor);
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
  ELSIF p_data LIKE 'h:%' THEN
    RETURN bot_deal_button(t, p_data, p_actor);
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
    WHEN 'att' THEN att_button(t, p_data, p_actor)
    WHEN 'gate' THEN att_gate_button(t, p_data, p_actor)
    ELSE '[]'::jsonb END;
END $$;

-- As in 433, with attendance on top: everyone with a staff record can check
-- in or out; supervisors, foremen and HR also get the arrivals list.
CREATE OR REPLACE FUNCTION bot_menu_view(p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_n integer;
  v_url text := bot_url('/');
  v_att jsonb := '[]'::jsonb;
BEGIN
  IF p_actor->>'staff_id' IS NOT NULL THEN
    v_att := v_att || jsonb_build_array(bot_btn('🕘 Check in / out', 'm:in'));
  END IF;
  IF EXISTS (SELECT 1 FROM att_gate_places(p_actor)) THEN
    v_att := v_att || jsonb_build_array(bot_btn('📋 Arrivals', 'm:g'));
  END IF;
  IF jsonb_array_length(v_att) > 0 THEN v_rows := v_rows || jsonb_build_array(v_att); END IF;
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

-- ── 7. For the posters page ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION att_can_manage() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'hr_officer', 'operations_manager', 'executive'), false) $$;

-- The places, each with its QR link and how many checked in there today.
CREATE OR REPLACE FUNCTION attendance_places_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_bot text := (SELECT telegram_bot_username FROM notification_channel_settings WHERE id);
BEGIN
  IF NOT att_can_manage() THEN RAISE EXCEPTION 'Only HR, operations or admin can manage the attendance QR codes'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', ap.id, 'code', ap.code, 'name', ap.name, 'place', ap.place, 'project_id', ap.project_id,
      'latitude', ap.latitude, 'longitude', ap.longitude, 'radius_m', ap.radius_m, 'active', ap.active,
      'url', CASE WHEN v_bot IS NOT NULL THEN 'https://t.me/' || v_bot || '?start=in_' || ap.code END,
      'in_today', (SELECT count(*) FROM staff_attendance a
                    WHERE a.work_date = addis_today() AND a.check_in_at IS NOT NULL
                      AND a.place = ap.place AND a.project_id IS NOT DISTINCT FROM ap.project_id),
      'expected', (SELECT count(*) FROM att_gate_people(ap)))
      ORDER BY ap.active DESC, ap.project_id IS NOT NULL, ap.name)
    FROM attendance_places ap), '[]'::jsonb);
END $$;

-- A site's poster: its place, made the first time.
CREATE OR REPLACE FUNCTION attendance_place_add_site(p_project uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid;
  p projects;
BEGIN
  IF NOT att_can_manage() THEN RAISE EXCEPTION 'Only HR, operations or admin can manage the attendance QR codes'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  SELECT id INTO v_id FROM attendance_places WHERE project_id = p_project;
  IF v_id IS NOT NULL THEN
    UPDATE attendance_places SET active = true WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO attendance_places (name, place, project_id, latitude, longitude)
  SELECT btrim(p.project_name), 'site', p.id, COALESCE(p.latitude, l.latitude), COALESCE(p.longitude, l.longitude)
  FROM (SELECT 1) one LEFT JOIN locations l ON l.id = p.location_id
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Name, radius, on or off, its point on the map, or a new code (the old QR
-- stops working). p: {name?, radius_m?, active?, latitude?, longitude?, new_code?}
CREATE OR REPLACE FUNCTION attendance_place_update(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT att_can_manage() THEN RAISE EXCEPTION 'Only HR, operations or admin can manage the attendance QR codes'; END IF;
  IF p ? 'latitude' AND (p->>'latitude') IS NOT NULL
     AND ((p->>'latitude')::double precision NOT BETWEEN -90 AND 90 OR (p->>'longitude')::double precision NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'That point isn''t on the map';
  END IF;
  UPDATE attendance_places SET
    name = COALESCE(NULLIF(btrim(p->>'name'), ''), name),
    radius_m = COALESCE((p->>'radius_m')::integer, radius_m),
    active = COALESCE((p->>'active')::boolean, active),
    latitude = CASE WHEN p ? 'latitude' THEN (p->>'latitude')::double precision ELSE latitude END,
    longitude = CASE WHEN p ? 'longitude' THEN (p->>'longitude')::double precision ELSE longitude END,
    code = CASE WHEN COALESCE((p->>'new_code')::boolean, false)
                THEN substr(md5(random()::text || clock_timestamp()::text), 1, 10) ELSE code END
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Place not found'; END IF;
END $$;

-- ── 8. Rights ───────────────────────────────────────────────────────────
DO $rights$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('att_phone_key', 'att_distance_m', 'att_dist_label', 'att_usual_place',
       'att_status_for', 'att_place_by_code', 'att_keys', 'att_phone_keys', 'att_loc_keys', 'att_no_keys', 'att_record',
       'att_next', 'att_contact', 'att_unlinked', 'att_location', 'att_text', 'att_menu_pick', 'att_button',
       'att_gate_places', 'att_gate_people', 'att_gate_view', 'att_gate_at', 'att_gate_open', 'att_gate_button',
       'bot_handle', 'bot_on_message', 'bot_on_button', 'bot_menu_view', 'att_can_manage', 'staff_attendance_via_guard')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $rights$;
REVOKE ALL ON FUNCTION attendance_places_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION attendance_place_add_site(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION attendance_place_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_places_list() TO authenticated;
GRANT EXECUTE ON FUNCTION attendance_place_add_site(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION attendance_place_update(uuid, jsonb) TO authenticated;
