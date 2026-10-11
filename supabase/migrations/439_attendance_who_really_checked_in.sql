-- 439: Knowing who really checked in.
--
-- The number can't be borrowed: the 📱 button sends the number of the
-- Telegram account on that phone, which Telegram checked by SMS, and the bot
-- refuses anyone else's contact card (438). What a phone can't prove is who
-- is holding it. So:
--
--   • Every check-in on Telegram is tied to the person's own number. People
--     connected with an office link or through their Kuncho login share their
--     number once, before their first check-in, and it has to be the number
--     on their staff record; if it isn't, HR is told.
--   • Each check-in keeps how sure the phone was of where it was. A point
--     picked on the map instead of read from the phone's GPS is marked, and so
--     are two people checking in from exactly the same spot within three
--     minutes — one phone used for both; HR is told about those.
--   • Whoever minds the gate confirms who is really there: 👀 Who's here in
--     Arrivals lists everyone who checked themselves in, and each working
--     morning at the check time the bot sends it to the supervisor. One tap
--     if everyone is there; anyone who isn't is marked and HR is told.
--   • Lunch, leaving and these checks, made on Telegram, no longer show on the
--     roll-call as someone's change: they show how they were made.

-- ── 1. What each check-in keeps ─────────────────────────────────────────
ALTER TABLE staff_attendance
  -- How sure the phone was of where it was, in metres; empty for a point
  -- picked on the map, or a time not sent from a phone.
  ADD COLUMN IF NOT EXISTS in_acc_m integer,
  ADD COLUMN IF NOT EXISTS pm_acc_m integer,
  ADD COLUMN IF NOT EXISTS out_acc_m integer,
  ADD COLUMN IF NOT EXISTS pm_lat double precision,
  ADD COLUMN IF NOT EXISTS pm_lng double precision,
  -- What to look at: [{k: 'map', part}, {k: 'pair', part, with: staff id, secs}]
  ADD COLUMN IF NOT EXISTS hints jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The supervisor's check: true here, false not here, empty not checked.
  ADD COLUMN IF NOT EXISTS seen boolean,
  ADD COLUMN IF NOT EXISTS seen_by_staff uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seen_at timestamptz;

-- A chat's own Telegram number, once shared with the button.
ALTER TABLE bot_chats
  ADD COLUMN IF NOT EXISTS phone_key text,
  ADD COLUMN IF NOT EXISTS phone_checked_at timestamptz;

-- When supervisors are asked who's really there; empty turns it off.
ALTER TABLE attendance_settings ADD COLUMN IF NOT EXISTS check_at time DEFAULT '09:30';

-- Which places get that daily check. Office managers see their people anyway.
DO $d$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'attendance_places' AND column_name = 'daily_check') THEN
    ALTER TABLE attendance_places ADD COLUMN daily_check boolean NOT NULL DEFAULT true;
    UPDATE attendance_places SET daily_check = false WHERE place = 'office';
  END IF;
END $d$;

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order)
VALUES ('attendance.flag', 'People', 'A check-in needs a look',
        'Two people checked in from one phone, someone checked in from a number that isn''t on their record, or a supervisor says someone who checked in isn''t there.',
        'normal', 53)
ON CONFLICT (kind) DO NOTHING;

-- ── 2. Changes made on Telegram aren't someone's edit ───────────────────
-- As in 401, except that back from lunch, leaving and a supervisor's check
-- made on Telegram keep the last change made in Kuncho: the roll-call shows
-- how they were made instead.
CREATE OR REPLACE FUNCTION staff_attendance_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d date := CASE WHEN TG_OP = 'DELETE' THEN OLD.work_date ELSE NEW.work_date END;
  lk record;
BEGIN
  SELECT label INTO lk FROM attendance_locks WHERE d BETWEEN start_date AND end_date LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is locked — HR has to unlock it before this day can change', lk.label USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.work_date <> OLD.work_date
     AND EXISTS (SELECT 1 FROM attendance_locks WHERE OLD.work_date BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'The original day is in a locked period' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.work_date > addis_today() THEN
    RAISE EXCEPTION 'Attendance can''t be recorded ahead of the day' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.recorded_by := coalesce(NEW.recorded_by, auth.uid());
    NEW.recorded_at := now();
    NEW.updated_by := NULL; NEW.updated_at := NULL;
    IF NEW.pm_status IS NOT NULL THEN
      NEW.pm_recorded_by := auth.uid(); NEW.pm_recorded_at := now();
    ELSE
      NEW.pm_recorded_by := NULL; NEW.pm_recorded_at := NULL;
    END IF;
    IF NEW.work_date < addis_today() - 2 AND coalesce(btrim(NEW.change_reason), '') = '' THEN
      RAISE EXCEPTION 'Recording a day more than two days late needs a reason' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.recorded_by := OLD.recorded_by; NEW.recorded_at := OLD.recorded_at;
    NEW.source := CASE WHEN NEW.source = 'self' AND OLD.source = 'self' THEN 'self' ELSE NEW.source END;
    IF coalesce(current_setting('attendance.by_bot', true), '') = 'on' THEN
      NEW.updated_by := OLD.updated_by; NEW.updated_at := OLD.updated_at;
    ELSE
      NEW.updated_by := auth.uid(); NEW.updated_at := now();
    END IF;
    IF NEW.pm_status IS DISTINCT FROM OLD.pm_status OR NEW.pm_at IS DISTINCT FROM OLD.pm_at THEN
      NEW.pm_recorded_by := auth.uid(); NEW.pm_recorded_at := now();
    ELSE
      NEW.pm_recorded_by := OLD.pm_recorded_by; NEW.pm_recorded_at := OLD.pm_recorded_at;
    END IF;
    IF OLD.work_date < addis_today() AND coalesce(btrim(NEW.change_reason), '') = '' THEN
      RAISE EXCEPTION 'Changing a day that has passed needs a reason' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  PERFORM set_config('attendance.reason', coalesce(NEW.change_reason, ''), true);
  NEW.change_reason := NULL;
  RETURN NEW;
END $$;

-- As in 438: a time typed over in Kuncho forgets how the phone or the gate
-- made it — now also how sure the phone was, and what was marked about it.
CREATE OR REPLACE FUNCTION staff_attendance_via_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.check_in_at IS DISTINCT FROM OLD.check_in_at AND NEW.in_via IS NOT DISTINCT FROM OLD.in_via THEN
    NEW.in_via := NULL; NEW.in_dist_m := NULL; NEW.in_by_staff := NULL; NEW.in_acc_m := NULL;
    NEW.hints := COALESCE((SELECT jsonb_agg(h) FROM jsonb_array_elements(NEW.hints) h WHERE h->>'part' IS DISTINCT FROM 'in'), '[]'::jsonb);
  END IF;
  IF NEW.pm_at IS DISTINCT FROM OLD.pm_at AND NEW.pm_via IS NOT DISTINCT FROM OLD.pm_via THEN
    NEW.pm_via := NULL; NEW.pm_dist_m := NULL; NEW.pm_acc_m := NULL; NEW.pm_lat := NULL; NEW.pm_lng := NULL;
    NEW.hints := COALESCE((SELECT jsonb_agg(h) FROM jsonb_array_elements(NEW.hints) h WHERE h->>'part' IS DISTINCT FROM 'pm'), '[]'::jsonb);
  END IF;
  IF NEW.check_out_at IS DISTINCT FROM OLD.check_out_at AND NEW.out_via IS NOT DISTINCT FROM OLD.out_via THEN
    NEW.out_via := NULL; NEW.out_dist_m := NULL; NEW.out_by_staff := NULL; NEW.out_acc_m := NULL;
    NEW.hints := COALESCE((SELECT jsonb_agg(h) FROM jsonb_array_elements(NEW.hints) h WHERE h->>'part' IS DISTINCT FROM 'out'), '[]'::jsonb);
  END IF;
  RETURN NEW;
END $$;

-- ── 3. Check-ins tied to the person's own number ────────────────────────
-- This chat's own Telegram number is the one on this staff record.
CREATE OR REPLACE FUNCTION att_number_ok(p_chat bigint, p_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM bot_chats c, staff s
                  WHERE c.chat_id = p_chat AND s.id = p_staff
                    AND c.phone_key IS NOT NULL AND c.phone_key = att_phone_key(s.phone_number)) $$;

-- Keep the number a chat shared with the button (its own — the caller checks).
CREATE OR REPLACE FUNCTION att_number_keep(p_chat bigint, p_key text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO bot_chats (chat_id, phone_key, phone_checked_at, updated_at) VALUES (p_chat, p_key, now(), now())
  ON CONFLICT (chat_id) DO UPDATE SET phone_key = EXCLUDED.phone_key, phone_checked_at = now() $$;

-- A connected chat sharing its number before its first check-in: it has to
-- be the number on the person's staff record.
CREATE OR REPLACE FUNCTION att_number(p_actor jsonb, p_msg jsonb, t bot_threads) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_chat bigint := (p_actor->>'chat')::bigint;
  v_staff uuid := NULLIF(p_actor->>'staff_id', '')::uuid;
  v_key text := att_phone_key(p_msg #>> '{contact,phone_number}');
  v_shown text := COALESCE('0' || att_phone_key(p_msg #>> '{contact,phone_number}'), p_msg #>> '{contact,phone_number}', '?');
  v_rec text;
  pl attendance_places;
BEGIN
  -- Only their own number: the button sends the account's, a contact card could be anyone's.
  IF (p_msg #>> '{contact,user_id}') IS DISTINCT FROM (p_msg #>> '{from,id}') THEN
    RETURN bot_msg(v_chat, 'Share <b>your own</b> number with the button below.', att_phone_keys());
  END IF;
  PERFORM att_number_keep(v_chat, v_key);
  PERFORM bot_await_clear(v_chat);
  SELECT att_phone_key(phone_number) INTO v_rec FROM staff WHERE id = v_staff;
  IF v_key IS NULL OR v_rec IS DISTINCT FROM v_key THEN
    PERFORM bot_thread_save(t.id, 'att', t.state, true);
    PERFORM notify(notify_role_users(ARRAY['hr_officer', 'admin']), 'attendance.flag',
      'A check-in from a number that isn''t on the record',
      (p_actor->>'name') || ' tried to check in from a Telegram account with the number ' || v_shown
        || CASE WHEN v_rec IS NULL THEN ', and their staff record has no phone number.' ELSE ', which isn''t the number on their staff record.' END
        || ' If the number is theirs, put it on the record and they can scan again. If it isn''t, someone else may be using their connection.',
      '/staff/' || v_staff, 'staff', v_staff, NULL, 'attendance.number:' || v_staff || ':' || COALESCE(v_key, '-'));
    RETURN bot_msg(v_chat, '🤔 This Telegram account''s number, <b>' || bot_esc(v_shown)
      || '</b>, isn''t the one on your staff record, so I can''t record your attendance from it.'
      || E'\n\nI''ve told HR. Once your record has your number, scan the QR code again.', att_no_keys());
  END IF;
  SELECT * INTO pl FROM attendance_places WHERE id = (t.state->>'place')::uuid AND active;
  RETURN bot_msg(v_chat, '✅ Number checked — it''s the one on your record. You won''t be asked again.')
      || att_next(p_actor, pl, COALESCE(t.state->>'via', 'qr'), t);
END $$;

-- ── 4. Recording, with what the phone said about itself ─────────────────
-- 438's att_record, plus how sure the phone was of where it was (p_acc,
-- metres) and whether the point was picked on the map (p_picked). Someone
-- else's check-in from exactly the same spot within three minutes is marked
-- on both — one phone used for two people? — and HR is told.
CREATE OR REPLACE FUNCTION att_save(p_staff uuid, pl attendance_places, p_mode text, p_at timestamptz,
                                    p_lat double precision, p_lng double precision, p_via text, p_by uuid,
                                    p_acc integer, p_picked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_day date := (p_at AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_dist integer := att_distance_m(pl.latitude, pl.longitude, p_lat, p_lng);
  v_phone boolean := p_via IN ('qr', 'bot');
  v_hints jsonb := '[]'::jsonb;
  v_status text;
  o record;
  r staff_attendance;
BEGIN
  IF p_staff IS NULL THEN RAISE EXCEPTION 'Your Kuncho login isn''t linked to a staff record — ask HR to link it'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('in', 'pm', 'out') THEN RAISE EXCEPTION 'Unknown attendance step %', p_mode; END IF;
  -- Made on Telegram: the roll-call shows how, not a change (staff_attendance_guard).
  PERFORM set_config('attendance.by_bot', 'on', true);
  SELECT * INTO r FROM staff_attendance WHERE staff_id = p_staff AND work_date = v_day;
  IF p_mode = 'in' AND r.check_in_at IS NOT NULL THEN RAISE EXCEPTION 'Already in since %', bot_clock(r.check_in_at); END IF;
  IF p_mode <> 'in' AND r.check_in_at IS NULL THEN RAISE EXCEPTION 'Check in first'; END IF;
  IF p_mode = 'pm' AND r.pm_status IS NOT NULL THEN RAISE EXCEPTION 'Already back since %', COALESCE(bot_clock(r.pm_at), 'lunch'); END IF;
  IF p_mode = 'out' AND r.check_out_at IS NOT NULL THEN RAISE EXCEPTION 'Already out since %', bot_clock(r.check_out_at); END IF;

  IF v_phone AND p_picked THEN
    v_hints := v_hints || jsonb_build_array(jsonb_build_object('k', 'map', 'part', p_mode));
  ELSIF v_phone AND p_lat IS NOT NULL THEN
    SELECT x.staff_id, x.secs INTO o FROM (
      SELECT a.staff_id,
             abs(extract(epoch FROM (CASE p_mode WHEN 'in' THEN a.check_in_at WHEN 'pm' THEN a.pm_at ELSE a.check_out_at END) - p_at))::integer AS secs,
             att_distance_m(CASE p_mode WHEN 'in' THEN a.in_lat WHEN 'pm' THEN a.pm_lat ELSE a.out_lat END,
                            CASE p_mode WHEN 'in' THEN a.in_lng WHEN 'pm' THEN a.pm_lng ELSE a.out_lng END, p_lat, p_lng) AS m,
             CASE p_mode WHEN 'in' THEN a.in_via WHEN 'pm' THEN a.pm_via ELSE a.out_via END AS via
        FROM staff_attendance a
       WHERE a.work_date = v_day AND a.staff_id <> p_staff) x
     WHERE x.via IN ('qr', 'bot') AND x.secs <= 180 AND x.m <= 1
     ORDER BY x.secs LIMIT 1;
    IF FOUND THEN
      v_hints := v_hints || jsonb_build_array(jsonb_build_object('k', 'pair', 'part', p_mode, 'with', o.staff_id, 'secs', o.secs));
      UPDATE staff_attendance
         SET hints = hints || jsonb_build_array(jsonb_build_object('k', 'pair', 'part', p_mode, 'with', p_staff, 'secs', o.secs))
       WHERE staff_id = o.staff_id AND work_date = v_day;
      PERFORM notify(notify_role_users(ARRAY['hr_officer', 'admin']), 'attendance.flag', 'Two check-ins from one spot',
        (SELECT btrim(employee_name) FROM staff WHERE id = p_staff) || ' and ' || (SELECT btrim(employee_name) FROM staff WHERE id = o.staff_id)
          || CASE p_mode WHEN 'in' THEN ' checked in ' WHEN 'pm' THEN ' came back from lunch ' ELSE ' checked out ' END
          || o.secs || ' seconds apart from exactly the same spot at ' || pl.name
          || ' — it may be one phone used for both. Their supervisor can say who was really there.',
        '/attendance', 'staff', p_staff, NULL,
        'attendance.pair:' || least(p_staff::text, o.staff_id::text) || ':' || greatest(p_staff::text, o.staff_id::text) || ':' || v_day || ':' || p_mode);
    END IF;
  END IF;

  IF p_mode = 'in' THEN
    v_status := att_status_for(p_at, false);
    IF r.id IS NULL THEN
      INSERT INTO staff_attendance (staff_id, work_date, status, check_in_at, place, project_id, source,
                                    in_lat, in_lng, in_via, in_dist_m, in_by_staff, in_acc_m, hints)
      VALUES (p_staff, v_day, v_status, p_at, pl.place, pl.project_id, CASE WHEN p_by IS NULL THEN 'self' ELSE 'register' END,
              p_lat, p_lng, p_via, v_dist, p_by, p_acc, v_hints)
      RETURNING * INTO r;
    ELSE
      -- Marked earlier without a time (a roll-call): the time is now known.
      UPDATE staff_attendance
         SET check_in_at = p_at, status = CASE WHEN status IN ('present', 'late', 'absent') THEN v_status ELSE status END,
             place = pl.place, project_id = pl.project_id, in_lat = p_lat, in_lng = p_lng,
             in_via = p_via, in_dist_m = v_dist, in_by_staff = p_by, in_acc_m = p_acc, hints = hints || v_hints
       WHERE id = r.id RETURNING * INTO r;
    END IF;
  ELSIF p_mode = 'pm' THEN
    v_status := att_status_for(p_at, true);
    UPDATE staff_attendance
       SET pm_status = v_status, pm_at = p_at, pm_via = p_via, pm_dist_m = v_dist,
           pm_lat = p_lat, pm_lng = p_lng, pm_acc_m = p_acc, hints = hints || v_hints
     WHERE id = r.id RETURNING * INTO r;
  ELSE
    UPDATE staff_attendance
       SET check_out_at = greatest(p_at, r.check_in_at), out_lat = p_lat, out_lng = p_lng,
           out_via = p_via, out_dist_m = v_dist, out_by_staff = p_by, out_acc_m = p_acc, hints = hints || v_hints
     WHERE id = r.id RETURNING * INTO r;
  END IF;
  RETURN jsonb_build_object('at', p_at, 'status', CASE WHEN p_mode = 'pm' THEN r.pm_status ELSE r.status END,
    'dist', v_dist, 'far', COALESCE(v_dist > pl.radius_m, false), 'place', pl.name, 'picked', v_phone AND p_picked);
END $$;

-- As in 438, for the gate list, which sends no location.
CREATE OR REPLACE FUNCTION att_record(p_staff uuid, pl attendance_places, p_mode text, p_at timestamptz,
                                      p_lat double precision, p_lng double precision, p_via text, p_by uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT att_save(p_staff, pl, p_mode, p_at, p_lat, p_lng, p_via, p_by, NULL, false) $$;

-- ── 5. The bot ──────────────────────────────────────────────────────────
-- As in 438, with the number asked for once before the first check-in by
-- anyone who didn't connect with it.
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
  -- Connected with an office link or a Kuncho login: tie the check-ins to their number, once.
  IF NOT att_number_ok(v_chat, v_staff) THEN
    PERFORM bot_thread_save(t.id, 'att', v_state || '{"mode": "number"}'::jsonb);
    PERFORM bot_await(v_chat, t.id, 'att_phone');
    RETURN bot_msg(v_chat, '📱 <b>One time only:</b> tap <b>Share my number</b> below. Check-ins are tied to the number on your staff record.',
                   att_phone_keys());
  END IF;
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

-- As in 438, also keeping the chat's number, and telling HR when someone's
-- check-ins move to a different Telegram account than the one connected before.
CREATE OR REPLACE FUNCTION att_contact(p_chat bigint, p_msg jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_key text := att_phone_key(p_msg #>> '{contact,phone_number}');
  v_ids uuid[];
  v_staff uuid;
  v_name text;
  v_old bigint;
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
  SELECT chat_id INTO v_old FROM bot_staff_links WHERE staff_id = v_staff;
  UPDATE bot_staff_links SET chat_id = NULL, username = NULL, linked_at = NULL WHERE chat_id = p_chat AND staff_id <> v_staff;
  INSERT INTO bot_staff_links (staff_id, chat_id, username, linked_at)
  VALUES (v_staff, p_chat, p_msg #>> '{from,username}', now())
  ON CONFLICT (staff_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, username = EXCLUDED.username, linked_at = now(),
                                       link_code = NULL, link_expires = NULL;
  PERFORM att_number_keep(p_chat, v_key);
  IF v_old IS NOT NULL AND v_old <> p_chat THEN
    PERFORM notify(notify_role_users(ARRAY['hr_officer', 'admin']), 'attendance.flag',
      'Check-ins moved to another Telegram account',
      v_name || ' connected the Telegram account with their own number, 0' || v_key
        || '. The account connected for them before no longer works for them — if it wasn''t theirs, someone else had their connection.',
      '/staff/' || v_staff, 'staff', v_staff, NULL, 'attendance.moved:' || v_staff || ':' || p_chat);
  END IF;

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

-- As in 438, keeping how sure the phone was of where it was, and saying so
-- when the point was picked on the map.
CREATE OR REPLACE FUNCTION att_location(p_actor jsonb, p_msg jsonb, t bot_threads) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_chat bigint := (p_actor->>'chat')::bigint;
  v_mode text := t.state->>'mode';
  -- Telegram's own stamp of when it was sent, not the phone's clock.
  v_at timestamptz := COALESCE(to_timestamp((p_msg->>'date')::double precision), now());
  -- A reading from the phone's GPS says how sure it is; a point picked on the
  -- map, or a named place from the list, doesn't.
  v_acc integer := round((p_msg #>> '{location,horizontal_accuracy}')::numeric)::integer;
  v_picked boolean := p_msg ? 'venue' OR (p_msg #>> '{location,horizontal_accuracy}') IS NULL;
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
  v := att_save(NULLIF(p_actor->>'staff_id', '')::uuid, pl, v_mode, v_at,
                (p_msg #>> '{location,latitude}')::double precision, (p_msg #>> '{location,longitude}')::double precision,
                COALESCE(t.state->>'via', 'qr'), NULL, v_acc, v_picked);
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
    || CASE WHEN (v->>'picked')::boolean
            THEN E'\n📌 That point was picked on the map, not read from your phone''s GPS, so it''s marked for your supervisor to check. '
                 || 'Next time tap <b>📍 Send my location</b>.' ELSE '' END
    || CASE v_mode WHEN 'in' THEN E'\n\nScan the code again when you''re back from lunch or leaving.'
                   WHEN 'out' THEN E'\n\nHave a good evening!' ELSE '' END,
    att_no_keys());
END $$;

-- As in 438, also while the number is awaited.
CREATE OR REPLACE FUNCTION att_text(t bot_threads, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_text ~* 'cancel|\mstop\M|\mno\M' THEN
    PERFORM bot_await_clear(t.chat_id);
    PERFORM bot_thread_save(t.id, 'att', t.state, true);
    RETURN bot_msg(t.chat_id, 'Cancelled. Scan the QR code again whenever you need.', att_no_keys());
  END IF;
  IF t.state->>'mode' = 'number' THEN
    RETURN bot_msg(t.chat_id, 'Tap <b>📱 Share my number</b> below — or send /cancel.', att_phone_keys());
  END IF;
  RETURN bot_msg(t.chat_id, 'Tap <b>📍 Send my location</b> below — or <b>✖ Cancel</b>.', att_loc_keys());
END $$;

-- ── 6. 👀 Who's here: the supervisor confirms ───────────────────────────
-- Everyone who checked themselves in at a place today, is still there and
-- hasn't been seen yet, with what to look out for; marked ones first.
-- mark: 🚫 said not here · 📌 picked on the map · 👥 same spot as someone · 📍 far away
CREATE OR REPLACE FUNCTION att_check_list(pl attendance_places) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.staff_id, 'name', x.name, 'mark', x.mark) ORDER BY x.mark = '', x.name), '[]'::jsonb)
  FROM (
    SELECT a.staff_id, btrim(s.employee_name) AS name,
           concat_ws(' ',
             CASE WHEN a.seen = false THEN '🚫' END,
             CASE WHEN a.hints @> '[{"k": "map", "part": "in"}]' THEN '📌' END,
             CASE WHEN a.hints @> '[{"k": "pair", "part": "in"}]' THEN '👥' END,
             CASE WHEN a.in_dist_m > pl.radius_m THEN '📍' END) AS mark
      FROM staff_attendance a JOIN staff s ON s.id = a.staff_id
     WHERE a.work_date = bot_today() AND a.check_in_at IS NOT NULL AND a.check_out_at IS NULL
       AND a.in_via IN ('qr', 'bot') AND a.seen IS DISTINCT FROM true
       AND a.place = pl.place AND a.project_id IS NOT DISTINCT FROM pl.project_id
  ) x $$;

-- The supervisor says whether someone who checked themselves in is there.
-- Not here — or here after all — goes to HR.
CREATE OR REPLACE FUNCTION att_seen(pl attendance_places, p_staff uuid, p_here boolean, p_actor jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_name text := (SELECT btrim(employee_name) FROM staff WHERE id = p_staff);
  v_was boolean;
  a staff_attendance;
BEGIN
  PERFORM set_config('attendance.by_bot', 'on', true);
  SELECT seen INTO v_was FROM staff_attendance WHERE staff_id = p_staff AND work_date = bot_today();
  UPDATE staff_attendance SET seen = p_here, seen_by_staff = NULLIF(p_actor->>'staff_id', '')::uuid, seen_at = now()
   WHERE staff_id = p_staff AND work_date = bot_today() AND check_in_at IS NOT NULL
  RETURNING * INTO a;
  IF a.id IS NULL THEN RETURN v_name || ' has no check-in today'; END IF;
  IF NOT p_here THEN
    PERFORM notify(notify_role_users(ARRAY['hr_officer', 'admin']), 'attendance.flag', 'Checked in, but not at work',
      (p_actor->>'name') || ' says ' || v_name || ' isn''t at ' || pl.name || ', though ' || v_name || '''s phone checked in at '
        || bot_clock(a.check_in_at) || ' (' || CASE a.in_via WHEN 'qr' THEN 'scanned the QR' ELSE 'on Telegram' END
        || COALESCE(', ' || att_dist_label(a.in_dist_m) || ' from the place', '') || '). Someone may have checked in for them.',
      '/attendance', 'staff', p_staff, NULL, 'attendance.not_here:' || p_staff || ':' || bot_today());
    RETURN v_name || ' marked not here — HR is told';
  ELSIF v_was = false THEN
    PERFORM notify(notify_role_users(ARRAY['hr_officer', 'admin']), 'attendance.flag', 'Here after all',
      (p_actor->>'name') || ' now says ' || v_name || ' is at ' || pl.name || ' after all.',
      '/attendance', 'staff', p_staff, NULL, 'attendance.here_after_all:' || p_staff || ':' || bot_today());
  END IF;
  RETURN v_name || ': here ✓';
END $$;

-- A gate conversation for one place: who is expected there.
CREATE OR REPLACE FUNCTION att_gate_state(pl attendance_places) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('step', 'list', 'place', pl.id, 'place_name', pl.name, 'leaving', false,
    'people', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.staff_id, 'name', p.name) ORDER BY p.name)
                          FROM att_gate_people(pl) p), '[]'::jsonb)) $$;

-- As in 438.
CREATE OR REPLACE FUNCTION att_gate_at(t bot_threads, p_place uuid, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  pl attendance_places;
  s jsonb;
BEGIN
  SELECT g.* INTO pl FROM att_gate_places(p_actor) g WHERE g.id = p_place;
  IF pl.id IS NULL THEN RAISE EXCEPTION 'You can''t record arrivals there'; END IF;
  s := att_gate_state(pl);
  PERFORM bot_thread_save(t.id, 'gate', s);
  RETURN bot_show(t, att_gate_view(s));
END $$;

-- As in 438, with 👀 Who's here: the list of people who checked themselves
-- in, and the question about one of them.
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
  v_left integer;
  v_p jsonb;
  v_pair text;
  ar staff_attendance;
  pl attendance_places;
BEGIN
  IF s->>'step' = 'place' THEN
    SELECT jsonb_agg(bot_btn(left(x->>'name', 40), 'g:p:' || (i - 1)) ORDER BY i) INTO v_items
      FROM jsonb_array_elements(COALESCE(s->'places', '[]'::jsonb)) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object('text', '📋 <b>Arrivals</b>' || E'\n\nWhich place?',
      'kb', bot_kb(bot_grid(v_items, 1) || jsonb_build_array(jsonb_build_array(bot_btn('✖ Close', 'x')))));
  END IF;
  SELECT * INTO pl FROM attendance_places WHERE id = (s->>'place')::uuid;

  -- One person from the list: are they here?
  IF s->>'ask' IS NOT NULL THEN
    v_p := s->'checks'->((s->>'ask')::integer);
    SELECT * INTO ar FROM staff_attendance WHERE staff_id = (v_p->>'id')::uuid AND work_date = bot_today();
    SELECT btrim(o.employee_name) || ', ' || (h->>'secs') || ' seconds apart' INTO v_pair
      FROM jsonb_array_elements(ar.hints) h JOIN staff o ON o.id = (h->>'with')::uuid
     WHERE h->>'k' = 'pair' AND h->>'part' = 'in' LIMIT 1;
    RETURN jsonb_build_object(
      'text', '👀 Is <b>' || bot_esc(v_p->>'name') || '</b> here?'
        || E'\nChecked in at ' || COALESCE(bot_clock(ar.check_in_at), '—')
        || CASE ar.in_via WHEN 'qr' THEN ' · scanned the QR' WHEN 'bot' THEN ' · on Telegram' ELSE '' END
        || COALESCE(' · ' || att_dist_label(ar.in_dist_m) || CASE WHEN ar.in_dist_m > pl.radius_m THEN ' away 📍' ELSE ' from here' END, '')
        || CASE WHEN ar.hints @> '[{"k": "map", "part": "in"}]' THEN E'\n📌 The location was picked on the map, not read from the phone''s GPS.' ELSE '' END
        || CASE WHEN v_pair IS NOT NULL THEN E'\n👥 Exactly the same spot as ' || bot_esc(v_pair) || ' — one phone for both?' ELSE '' END
        || CASE WHEN ar.seen = false THEN E'\n🚫 Marked not here.' ELSE '' END,
      'kb', bot_kb(jsonb_build_array(
        jsonb_build_array(bot_btn('✅ Here', 'g:y:' || (s->>'ask')), bot_btn('🚫 Not here', 'g:n:' || (s->>'ask'))),
        jsonb_build_array(bot_btn('← Back', 'g:c')))));
  END IF;

  -- Who's here: everyone who checked themselves in on their phone.
  IF COALESCE((s->>'check')::boolean, false) THEN
    SELECT jsonb_agg(bot_btn(left(COALESCE(NULLIF(x.e->>'mark', '') || ' ', '') || (x.e->>'name'), 26), 'g:s:' || (x.i - 1)) ORDER BY x.i),
           count(*) FILTER (WHERE x.e->>'mark' NOT LIKE '%🚫%')
      INTO v_items, v_left
      FROM jsonb_array_elements(COALESCE(s->'checks', '[]'::jsonb)) WITH ORDINALITY x(e, i);
    RETURN jsonb_build_object(
      'text', '👀 <b>Who''s here · ' || bot_esc(s->>'place_name') || '</b> · ' || bot_day(bot_today())
        || CASE WHEN v_items IS NULL
                THEN E'\n\nEveryone who checked themselves in on their phone has been seen. 👍'
                WHEN v_left = 0
                THEN E'\n\nEveryone else has been seen. If someone marked 🚫 turns up, tap their name.'
                ELSE E'\n' || v_left || ' checked themselves in on their phone and haven''t been seen yet'
                     || CASE WHEN jsonb_array_length(s->'checks') > v_left
                             THEN ' · ' || (jsonb_array_length(s->'checks') - v_left) || ' marked not here' ELSE '' END
                     || E'.\n\nLook around, then tap anyone who isn''t here. If everyone is, tap <b>✅ All here</b>.'
                     || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(s->'checks') e WHERE e->>'mark' <> '')
                             THEN E'\n\n📌 picked on the map · 👥 same spot as someone else · 📍 far away · 🚫 said not here' ELSE '' END
           END,
      'kb', bot_kb(bot_grid(COALESCE(v_items, '[]'::jsonb), 2)
        || CASE WHEN v_left > 0 THEN jsonb_build_array(jsonb_build_array(bot_btn('✅ All here (' || v_left || ')', 'g:a'))) ELSE '[]'::jsonb END
        || jsonb_build_array(jsonb_build_array(bot_btn('← Arrivals', 'g:b'), bot_btn('🔄 Refresh', 'g:c'), bot_btn('✖ Close', 'x')))));
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
  SELECT count(*) INTO v_left FROM jsonb_array_elements(att_check_list(pl)) e WHERE e->>'mark' NOT LIKE '%🚫%';
  RETURN jsonb_build_object(
    'text', '📋 <b>Arrivals · ' || bot_esc(s->>'place_name') || '</b> · ' || bot_day(bot_today())
      || E'\n✅ ' || v_in || ' in · ⬜ ' || v_not || ' not yet' || CASE WHEN v_out > 0 THEN ' · 🏁 ' || v_out || ' gone' ELSE '' END
      || CASE WHEN v_recent IS NOT NULL THEN E'\nLatest: ' || bot_esc(v_recent) ELSE '' END
      || E'\n\n' || CASE WHEN v_leaving THEN 'Tap a name as they leave — that moment is their check-out.'
                         ELSE 'Tap a name as they walk in — that moment is their check-in. People with a smartphone scan the QR code themselves.' END
      || CASE WHEN v_items IS NULL THEN E'\n\n' || CASE WHEN v_leaving THEN 'Nobody is in to check out.' ELSE 'Everyone is in. 👍' END ELSE '' END
      || CASE WHEN v_more > 0 THEN E'\n…and ' || v_more || ' more below the first 80.' ELSE '' END,
    'kb', bot_kb(bot_grid(COALESCE(v_items, '[]'::jsonb), 2)
      || jsonb_build_array(jsonb_build_array(bot_btn('👀 Who''s here' || CASE WHEN v_left > 0 THEN ' (' || v_left || ' to see)' ELSE '' END, 'g:c')))
      || jsonb_build_array(jsonb_build_array(
           bot_btn(CASE WHEN v_leaving THEN '🕘 Arriving' ELSE '🏁 Leaving' END, 'g:l'), bot_btn('🔄 Refresh', 'g:r'), bot_btn('✖ Close', 'x')))));
END $$;

-- As in 438, with the Who's here buttons: g:c the list, g:s:i ask about one,
-- g:y:i here, g:n:i not here, g:a all here, g:b back to arrivals.
CREATE OR REPLACE FUNCTION att_gate_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_person jsonb;
  pl attendance_places;
  v jsonb;
  v_toast text;
  v_n integer := 0;
BEGIN
  IF p_data LIKE 'g:p:%' THEN
    RETURN att_gate_at(t, (s->'places'->(split_part(p_data, ':', 3)::integer)->>'id')::uuid, p_actor);
  ELSIF p_data NOT IN ('g:l', 'g:r', 'g:b', 'g:c', 'g:a') AND p_data !~ '^g:[ioyns]:[0-9]+$' THEN
    RETURN '[]'::jsonb;
  END IF;
  -- Still allowed at this place?
  SELECT g.* INTO pl FROM att_gate_places(p_actor) g WHERE g.id = (s->>'place')::uuid;
  IF pl.id IS NULL THEN RAISE EXCEPTION 'You can''t record arrivals there any more'; END IF;

  IF p_data = 'g:l' THEN
    s := jsonb_set(s - 'check' - 'ask', '{leaving}', to_jsonb(NOT COALESCE((s->>'leaving')::boolean, false)));
  ELSIF p_data = 'g:b' THEN
    s := s - 'check' - 'ask';
  ELSIF p_data = 'g:c' THEN
    s := (s - 'ask') || jsonb_build_object('check', true, 'leaving', false, 'checks', att_check_list(pl));
  ELSIF p_data ~ '^g:[io]:[0-9]+$' THEN
    v_person := s->'people'->(split_part(p_data, ':', 3)::integer);
    IF v_person IS NULL THEN RETURN bot_answer(NULL, 'That list is old — tap 🔄 Refresh.', true); END IF;
    v := att_record((v_person->>'id')::uuid, pl, CASE WHEN p_data LIKE 'g:i:%' THEN 'in' ELSE 'out' END, now(),
                    NULL, NULL, 'gate', NULLIF(p_actor->>'staff_id', '')::uuid);
    v_toast := (v_person->>'name') || CASE WHEN p_data LIKE 'g:i:%' THEN ' in at ' ELSE ' out at ' END || bot_clock(now())
               || CASE WHEN p_data LIKE 'g:i:%' AND v->>'status' = 'late' THEN ' — late' ELSE '' END;
  ELSIF p_data ~ '^g:s:[0-9]+$' THEN
    IF s->'checks'->(split_part(p_data, ':', 3)::integer) IS NULL THEN RETURN bot_answer(NULL, 'That list is old — tap 🔄 Refresh.', true); END IF;
    s := jsonb_set(s, '{ask}', to_jsonb(split_part(p_data, ':', 3)::integer));
  ELSIF p_data ~ '^g:[yn]:[0-9]+$' THEN
    v_person := s->'checks'->(split_part(p_data, ':', 3)::integer);
    IF v_person IS NULL THEN RETURN bot_answer(NULL, 'That list is old — tap 🔄 Refresh.', true); END IF;
    v_toast := att_seen(pl, (v_person->>'id')::uuid, p_data LIKE 'g:y:%', p_actor);
    s := (s - 'ask') || jsonb_build_object('check', true, 'checks', att_check_list(pl));
  ELSIF p_data = 'g:a' THEN
    FOR v_person IN SELECT e FROM jsonb_array_elements(COALESCE(s->'checks', '[]'::jsonb)) e WHERE e->>'mark' NOT LIKE '%🚫%' LOOP
      PERFORM att_seen(pl, (v_person->>'id')::uuid, true, p_actor);
      v_n := v_n + 1;
    END LOOP;
    v_toast := v_n || CASE WHEN v_n = 1 THEN ' person' ELSE ' people' END || ' seen here ✓';
    s := (s - 'ask') || jsonb_build_object('check', true, 'checks', att_check_list(pl));
  END IF;
  PERFORM bot_thread_save(t.id, 'gate', s);
  RETURN CASE WHEN v_toast IS NOT NULL THEN bot_answer(NULL, v_toast) ELSE '[]'::jsonb END || bot_show(t, att_gate_view(s));
END $$;

-- Each working morning at the check time: ask whoever minds each place
-- who's really there, when anyone checked themselves in and hasn't been
-- seen yet. Workshops: the supervisor on the floor of the people who work
-- there (else whoever they report to, else their department head). Sites:
-- their foremen, else the project manager. Once a day per place.
CREATE OR REPLACE FUNCTION att_check_push() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_at time := (SELECT check_at FROM attendance_settings WHERE id);
  v_now time := (now() AT TIME ZONE 'Africa/Addis_Ababa')::time;
  v_day date := addis_today();
  pl attendance_places;
  r record;
  v_actor jsonb;
  v_checks jsonb;
  t bot_threads;
  v_n integer := 0;
BEGIN
  IF NOT bot_ready() OR v_at IS NULL OR v_now - v_at NOT BETWEEN interval '0' AND interval '3 hours' THEN RETURN 0; END IF;
  FOR pl IN SELECT * FROM attendance_places WHERE active AND daily_check LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM calendar_holidays h WHERE h.holiday_date = v_day
                            AND (h.applies_to_project_id IS NULL OR h.applies_to_project_id IS NOT DISTINCT FROM pl.project_id));
    v_checks := att_check_list(pl);
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) e WHERE e->>'mark' NOT LIKE '%🚫%');
    FOR r IN
      WITH sup AS (
        SELECT a.staff_id, 1 AS pri FROM staff_assignments a JOIN staff s ON s.id = a.staff_id
         WHERE pl.project_id IS NOT NULL AND a.project_id = pl.project_id AND a.active AND s.status = 'active'
           AND (s.role = 'site_foreman' OR a.role ILIKE '%foreman%')
        UNION
        SELECT p.project_manager_id, 2 FROM projects p
         WHERE pl.project_id IS NOT NULL AND p.id = pl.project_id AND p.project_manager_id IS NOT NULL
        UNION
        SELECT w.reports_to_id, CASE WHEN att_usual_place(b.staff_type) = pl.place THEN 1 ELSE 2 END
          FROM staff w JOIN staff b ON b.id = w.reports_to_id
         WHERE pl.project_id IS NULL AND w.status = 'active' AND b.status = 'active' AND att_usual_place(w.staff_type) = pl.place
        UNION
        SELECT d.head_staff_id, 3 FROM staff w JOIN departments d ON d.id = w.department_id
         WHERE pl.project_id IS NULL AND w.status = 'active' AND att_usual_place(w.staff_type) = pl.place AND d.head_staff_id IS NOT NULL
      ), reach AS (
        SELECT bot_chat_of_staff(staff_id) AS chat, pri FROM sup
      )
      SELECT DISTINCT chat FROM reach WHERE chat IS NOT NULL AND pri = (SELECT min(pri) FROM reach WHERE chat IS NOT NULL)
    LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM bot_threads WHERE chat_id = r.chat AND kind = 'gate'
                             AND state->>'place' = pl.id::text AND state->>'nudged' = v_day::text);
      v_actor := bot_actor(r.chat);
      CONTINUE WHEN v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM att_gate_places(v_actor) g WHERE g.id = pl.id);
      t := bot_thread_new(v_actor, 'gate', att_gate_state(pl) || jsonb_build_object('check', true, 'checks', v_checks, 'nudged', v_day));
      PERFORM bot_queue(bot_show(t, att_gate_view(t.state)));
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;

-- As in 438, with the number a connected chat shares before its first check-in.
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
    IF c.awaiting = 'att_phone' THEN
      SELECT * INTO t FROM bot_threads WHERE id = c.awaiting_thread AND kind = 'att' AND closed_at IS NULL;
      IF FOUND THEN RETURN att_number(p_actor, p_msg, t); END IF;
    END IF;
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

-- ── 7. For the posters page ─────────────────────────────────────────────
-- As in 438, with whether the place gets the daily check.
CREATE OR REPLACE FUNCTION attendance_places_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_bot text := (SELECT telegram_bot_username FROM notification_channel_settings WHERE id);
BEGIN
  IF NOT att_can_manage() THEN RAISE EXCEPTION 'Only HR, operations or admin can manage the attendance QR codes'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', ap.id, 'code', ap.code, 'name', ap.name, 'place', ap.place, 'project_id', ap.project_id,
      'latitude', ap.latitude, 'longitude', ap.longitude, 'radius_m', ap.radius_m, 'active', ap.active,
      'daily_check', ap.daily_check,
      'url', CASE WHEN v_bot IS NOT NULL THEN 'https://t.me/' || v_bot || '?start=in_' || ap.code END,
      'in_today', (SELECT count(*) FROM staff_attendance a
                    WHERE a.work_date = addis_today() AND a.check_in_at IS NOT NULL
                      AND a.place = ap.place AND a.project_id IS NOT DISTINCT FROM ap.project_id),
      'expected', (SELECT count(*) FROM att_gate_people(ap)))
      ORDER BY ap.active DESC, ap.project_id IS NOT NULL, ap.name)
    FROM attendance_places ap), '[]'::jsonb);
END $$;

-- As in 438, with daily_check. p: {name?, radius_m?, active?, daily_check?, latitude?, longitude?, new_code?}
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
    daily_check = COALESCE((p->>'daily_check')::boolean, daily_check),
    latitude = CASE WHEN p ? 'latitude' THEN (p->>'latitude')::double precision ELSE latitude END,
    longitude = CASE WHEN p ? 'longitude' THEN (p->>'longitude')::double precision ELSE longitude END,
    code = CASE WHEN COALESCE((p->>'new_code')::boolean, false)
                THEN substr(md5(random()::text || clock_timestamp()::text), 1, 10) ELSE code END
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Place not found'; END IF;
END $$;

-- ── 8. The morning check, and rights ────────────────────────────────────
-- Every ten minutes through the working morning, Monday to Saturday (UTC):
-- att_check_push itself waits for the check time and asks once a day.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'kuncho-attendance-check';
SELECT cron.schedule('kuncho-attendance-check', '*/10 5-9 * * 1-6', 'SELECT public.att_check_push()');

DO $rights$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('att_number_ok', 'att_number_keep', 'att_number', 'att_save', 'att_record',
       'att_next', 'att_contact', 'att_location', 'att_text', 'att_check_list', 'att_seen', 'att_gate_state', 'att_gate_at',
       'att_gate_view', 'att_gate_button', 'att_check_push', 'bot_on_message', 'staff_attendance_guard', 'staff_attendance_via_guard')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $rights$;
REVOKE ALL ON FUNCTION attendance_places_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION attendance_place_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_places_list() TO authenticated;
GRANT EXECUTE ON FUNCTION attendance_place_update(uuid, jsonb) TO authenticated;
