-- 435: whoever asks for a truck can hire the driver themselves.
--
-- Most trucks are arranged the way the company has always done it: the person
-- who needs one finds a driver, agrees the price upfront, and the deal is
-- recorded. "Ask for a truck" on the bot now asks who finds the driver:
--
--   🤝 I've hired a driver — pick a driver used before or type a new one (name
--      and phone), the vehicle, and the price agreed; then record the deal.
--      The trip is arranged at once and hired. Logistics hears of it, it
--      waits on the cashier's "Pay out at the gate" list with the driver and
--      the price filled in, and whoever hired follows it on the same message
--      (Picked up / Delivered / Problem).
--   📨 Logistics, please arrange one — as before. When logistics hires one
--      ("🚕 Hire one" on their card) they record the same deal, and whoever
--      asked gets the trip with the driver, the price and the buttons.
--
-- The web form asks the same question (transport_driver_for_trip finds or
-- adds the driver typed by someone who can't see the driver list). A hired
-- trip recorded by anyone outside logistics, on the bot or the web, tells
-- logistics (notification kind trip.hired).

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order) VALUES
  ('trip.hired', 'Transport', 'A driver was hired directly', 'Logistics: someone hired a driver themselves and recorded the deal', 'normal', 36)
ON CONFLICT (kind) DO NOTHING;

-- ── 1. Drivers ──────────────────────────────────────────────────────────
-- An Ethiopian mobile number as 09… or 07…, or NULL.
CREATE OR REPLACE FUNCTION trip_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN d ~ '^0[79][0-9]{8}$' THEN d
              WHEN d ~ '^(251)?[79][0-9]{8}$' THEN '0' || right(d, 9) END
  FROM (SELECT regexp_replace(COALESCE(p, ''), '\D', '', 'g') AS d) x $$;

CREATE OR REPLACE FUNCTION bot_vclass_label(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'lada' THEN 'Lada' WHEN 'mini_isuzu' THEN 'Mini Isuzu' WHEN 'isuzu' THEN 'Isuzu'
                WHEN 'toyota_carryon' THEN 'Toyota with carry-on' WHEN 'other' THEN 'Other vehicle' END $$;

-- The driver with this phone — or, typed without one, this exact name — or a
-- new driver. A phone or vehicle we didn't have is kept on the way.
CREATE OR REPLACE FUNCTION trip_driver_find_or_add(p_name text, p_phone text, p_vclass text DEFAULT NULL) RETURNS transport_drivers
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  d transport_drivers;
  v_name text := NULLIF(btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g')), '');
  v_phone text := trip_phone(p_phone);
  v_class text := CASE WHEN p_vclass IN ('lada', 'mini_isuzu', 'isuzu', 'toyota_carryon', 'other') THEN p_vclass END;
BEGIN
  IF v_phone IS NOT NULL THEN
    SELECT * INTO d FROM transport_drivers WHERE is_active AND trip_phone(phone) = v_phone ORDER BY created_at LIMIT 1;
  END IF;
  IF d.id IS NULL AND v_name IS NOT NULL THEN
    SELECT * INTO d FROM transport_drivers
     WHERE is_active AND lower(full_name) = lower(v_name) AND (v_phone IS NULL OR phone IS NULL)
     ORDER BY created_at LIMIT 1;
  END IF;
  IF d.id IS NULL THEN
    IF v_name IS NULL THEN RAISE EXCEPTION 'Give the driver''s name'; END IF;
    INSERT INTO transport_drivers (full_name, phone, vehicle_class) VALUES (v_name, v_phone, v_class) RETURNING * INTO d;
  ELSIF (d.phone IS NULL AND v_phone IS NOT NULL) OR (d.vehicle_class IS NULL AND v_class IS NOT NULL) THEN
    UPDATE transport_drivers SET phone = COALESCE(phone, v_phone), vehicle_class = COALESCE(vehicle_class, v_class), updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
  END IF;
  RETURN d;
END $$;

-- The web form, for someone who can't see the driver list: the typed driver's id.
CREATE OR REPLACE FUNCTION transport_driver_for_trip(p_name text, p_phone text DEFAULT NULL, p_vclass text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_phone IS NOT NULL AND btrim(p_phone) <> '' AND trip_phone(p_phone) IS NULL THEN
    RAISE EXCEPTION 'That phone number doesn''t look right — use 09… or 07…';
  END IF;
  RETURN (trip_driver_find_or_add(p_name, p_phone, p_vclass)).id;
END $$;

CREATE OR REPLACE FUNCTION bot_user_is_logistics(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT role::text = 'logistics_officer' OR COALESCE(is_logistics_officer, false)
                     FROM user_profiles WHERE id = p_user), false) $$;

-- ── 2. What a trip card says: the hired driver and the price agreed ─────
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
         (SELECT employee_name FROM staff WHERE id = tr.requested_by_staff_id))), ''), '')
    || CASE WHEN tr.transport_mode <> 'own_fleet' AND COALESCE(d.full_name, NULLIF(btrim(tr.driver_name), '')) IS NOT NULL
            THEN E'\nDriver: ' || bot_esc(COALESCE(d.full_name, btrim(tr.driver_name))) || COALESCE(' · ' || d.phone, '')
                 || COALESCE(' · ' || bot_vclass_label(COALESCE(tr.hired_vehicle_class, d.vehicle_class)), '')
            ELSE '' END
    || CASE WHEN tr.transport_mode <> 'own_fleet' AND tr.amount IS NOT NULL THEN E'\nAgreed: ' || bot_birr(tr.amount) ELSE '' END
  FROM (SELECT 1) one LEFT JOIN transport_drivers d ON d.id = tr.hired_driver_id $$;

-- ── 3. Recording a deal: which driver, what vehicle, what price ─────────
-- Drivers to offer: the ones this person hired before, then the most used.
CREATE OR REPLACE FUNCTION bot_deal_drivers(p_actor jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH mine AS (
    SELECT t.hired_driver_id AS id, max(t.created_at) AS at FROM transportation_requests t
     WHERE t.hired_driver_id IS NOT NULL AND t.job_status <> 'cancelled'
       AND ((t.requested_by_id IS NOT NULL AND t.requested_by_id = NULLIF(p_actor->>'user_id', '')::uuid)
         OR (t.requested_by_staff_id IS NOT NULL AND t.requested_by_staff_id = NULLIF(p_actor->>'staff_id', '')::uuid))
     GROUP BY 1
  ), used AS (
    SELECT hired_driver_id AS id, count(*) AS n FROM transportation_requests
     WHERE hired_driver_id IS NOT NULL AND job_status <> 'cancelled' GROUP BY 1
  ), pick AS (
    SELECT d.id, d.full_name, d.phone, d.vehicle_class, m.at, COALESCE(u.n, 0) AS n
    FROM transport_drivers d LEFT JOIN mine m ON m.id = d.id LEFT JOIN used u ON u.id = d.id
    WHERE d.is_active
    ORDER BY m.at DESC NULLS LAST, COALESCE(u.n, 0) DESC, d.full_name
    LIMIT 6
  )
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'name', full_name, 'phone', phone, 'vclass', vehicle_class))
           ORDER BY at DESC NULLS LAST, n DESC, full_name), '[]'::jsonb) FROM pick $$;

-- The deal so far, as lines under the card.
CREATE OR REPLACE FUNCTION bot_deal_lines(s jsonb) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(E'\nDriver: ' || NULLIF(bot_esc(s #>> '{deal,name}'), '') || COALESCE(' · ' || (s #>> '{deal,phone}'), ''), '')
      || COALESCE(E'\nVehicle: ' || bot_vclass_label(s #>> '{deal,vclass}'), '')
      || CASE WHEN s #>> '{deal,price}' IS NOT NULL THEN E'\nAgreed: <b>' || bot_birr((s #>> '{deal,price}')::numeric) || '</b>' ELSE '' END $$;

-- Each step of the deal, under what the card already says (p_head). Only a
-- request can be cancelled from here; a logistics card goes back to its drivers.
CREATE OR REPLACE FUNCTION bot_deal_view(p_head text, s jsonb, p_cancel boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_head text := p_head || bot_deal_lines(s);
  v_items jsonb;
  v_back jsonb := jsonb_build_array(bot_btn('◀ Back', 'h:bk'))
    || CASE WHEN p_cancel THEN jsonb_build_array(bot_btn('✖ Cancel', 'x')) ELSE '[]'::jsonb END;
  v_type text := E'\n\nType the driver''s name and phone, for example:\nAbebe Kebede 0911 223344';
BEGIN
  IF s->>'step' = 'h_driver' THEN
    SELECT jsonb_agg(bot_btn('🚛 ' || left(x->>'name', 26) || COALESCE(' · ' || bot_vclass_label(x->>'vclass'), ''), 'h:d:' || (i - 1)) ORDER BY i)
      INTO v_items FROM jsonb_array_elements(COALESCE(s->'hdrivers', '[]'::jsonb)) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object('text', v_head || E'\n\nWhich driver?',
      'kb', bot_kb(bot_grid(v_items, 1) || jsonb_build_array(jsonb_build_array(bot_btn('✏️ Another driver', 'h:n')), v_back)));
  ELSIF s->>'step' = 'h_new' THEN
    RETURN jsonb_build_object('text', v_head || v_type, 'kb', bot_kb(jsonb_build_array(v_back)));
  ELSIF s->>'step' = 'h_vehicle' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\nWhat vehicle?',
      'kb', bot_kb(jsonb_build_array(
        jsonb_build_array(bot_btn('Lada', 'h:v:lada'), bot_btn('Mini Isuzu', 'h:v:mini_isuzu')),
        jsonb_build_array(bot_btn('Isuzu', 'h:v:isuzu'), bot_btn('Toyota with carry-on', 'h:v:toyota_carryon')),
        jsonb_build_array(bot_btn('Other', 'h:v:other')),
        v_back)));
  ELSIF s->>'step' = 'h_price' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\nWhat price was agreed, in birr? Type it, for example: 1500',
      'kb', bot_kb(jsonb_build_array(v_back)));
  END IF;
  RETURN jsonb_build_object('text', v_head || E'\n\nRecord the deal?',
    'kb', bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('✅ Record the deal', 'h:ok')), v_back)));
END $$;

-- What a truck request says so far.
CREATE OR REPLACE FUNCTION bot_truck_head(s jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '🚚 <b>Ask for a truck</b>'
    || COALESCE(E'\n' || NULLIF(bot_esc(s->>'po_label'), ''), '')
    || COALESCE(E'\nMove: ' || NULLIF(bot_esc(s->>'desc'), ''), '')
    || COALESCE(E'\nFor: ' || NULLIF(bot_esc(s->>'site_name'), ''), '')
    || COALESCE(E'\nWhen: ' || bot_when_label(s->>'when'), '') $$;

CREATE OR REPLACE FUNCTION bot_deal_head(t bot_threads, s jsonb) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN t.kind = 'assign'
    THEN bot_trip_card_text((SELECT x FROM transportation_requests x WHERE x.id = (s->>'trip')::uuid), s->>'when')
    ELSE bot_truck_head(s) END $$;

-- Save the step and show it; the steps answered by typing wait for the answer.
CREATE OR REPLACE FUNCTION bot_deal_show(t bot_threads, s jsonb, p_fresh boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF s->>'step' = 'h_new' THEN PERFORM bot_await(t.chat_id, t.id, 'deal_driver');
  ELSIF s->>'step' = 'h_price' THEN PERFORM bot_await(t.chat_id, t.id, 'deal_price');
  END IF;
  PERFORM bot_thread_save(t.id, t.kind, s);
  t.state := s;
  RETURN bot_show(t, bot_deal_view(bot_deal_head(t, s), s, t.kind = 'truck'), p_fresh);
END $$;

-- Where the deal starts: the drivers to pick from, or straight to typing one.
CREATE OR REPLACE FUNCTION bot_deal_start(t bot_threads, s jsonb, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_drivers jsonb := bot_deal_drivers(p_actor);
BEGIN
  RETURN bot_deal_show(t, s - 'deal' || jsonb_build_object('hdrivers', v_drivers,
    'step', CASE WHEN jsonb_array_length(v_drivers) = 0 THEN 'h_new' ELSE 'h_driver' END));
END $$;

-- The deal recorded. A request becomes its trip, hired and arranged; a
-- logistics card hires the trip it was about.
CREATE OR REPLACE FUNCTION bot_deal_done(t bot_threads, s jsonb, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tr transportation_requests;
  th record;
  v_id uuid;
BEGIN
  IF s #>> '{deal,driver}' IS NULL OR s #>> '{deal,price}' IS NULL THEN
    RAISE EXCEPTION 'Pick the driver and type the price first';
  END IF;
  IF t.kind = 'truck' THEN
    v_id := bot_trip_create(p_actor, s || jsonb_build_object('hire', 'self'));
    SELECT * INTO tr FROM transportation_requests WHERE id = v_id;
    -- This message is the trip from now on: whoever hired follows it here.
    UPDATE bot_threads SET kind = 'trip', state = jsonb_build_object('trip', v_id), card_key = 'tp:' || v_id, updated_at = now()
     WHERE id = t.id;
    RETURN bot_edit(t.chat_id, t.message_id,
      '🤝 <b>Deal recorded.</b> Logistics can see it, and the cashier can pay it at the gate.' || E'\n\n' || (bot_trip_view(tr)->>'text'),
      bot_trip_view(tr)->'kb');
  END IF;

  UPDATE transportation_requests
     SET transport_mode = 'hired', hired_driver_id = (s #>> '{deal,driver}')::uuid, driver_name = s #>> '{deal,name}',
         hired_vehicle_class = COALESCE(s #>> '{deal,vclass}', hired_vehicle_class), amount = (s #>> '{deal,price}')::numeric,
         assigned_staff_id = NULL, vehicle_id = NULL, job_status = 'assigned'
   WHERE id = (s->>'trip')::uuid AND job_status = 'requested'
  RETURNING * INTO tr;
  IF tr.id IS NULL THEN
    PERFORM bot_thread_save(t.id, t.kind, s, true);
    RETURN bot_edit(t.chat_id, t.message_id,
      bot_trip_card_text((SELECT x FROM transportation_requests x WHERE x.id = (s->>'trip')::uuid), s->>'when') || E'\n\nAlready arranged.');
  END IF;
  -- Every logistics card about it shows who hired it instead of the buttons.
  FOR th IN SELECT id, chat_id, message_id FROM bot_threads WHERE card_key = 'ta:' || tr.id AND closed_at IS NULL LOOP
    IF th.message_id IS NOT NULL THEN
      PERFORM bot_queue(bot_edit(th.chat_id, th.message_id,
        bot_trip_card_text(tr, s->>'when') || E'\n\n🤝 Hired by ' || bot_esc(p_actor->>'name')));
    END IF;
    UPDATE bot_threads SET closed_at = now() WHERE id = th.id;
  END LOOP;
  RETURN '[]'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION bot_deal_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  d jsonb;
BEGIN
  IF t.kind NOT IN ('truck', 'assign') OR left(COALESCE(s->>'step', ''), 2) <> 'h_' THEN RETURN '[]'::jsonb; END IF;
  IF t.kind = 'assign' AND NOT bot_is_dispatcher(p_actor) THEN RAISE EXCEPTION 'Only logistics or admin can arrange trucks'; END IF;
  IF p_data LIKE 'h:d:%' THEN
    d := s->'hdrivers'->(split_part(p_data, ':', 3)::integer);
    IF d IS NULL THEN RETURN '[]'::jsonb; END IF;
    s := s || jsonb_build_object('deal', jsonb_strip_nulls(jsonb_build_object('driver', d->>'id', 'name', d->>'name',
           'phone', d->>'phone', 'vclass', d->>'vclass', 'price', s #> '{deal,price}')));
    s := s || jsonb_build_object('step', CASE WHEN d->>'vclass' IS NULL THEN 'h_vehicle'
                                              WHEN s #>> '{deal,price}' IS NOT NULL THEN 'h_ok' ELSE 'h_price' END);
  ELSIF p_data = 'h:n' THEN
    s := s || jsonb_build_object('step', 'h_new');
  ELSIF p_data LIKE 'h:v:%' THEN
    IF split_part(p_data, ':', 3) NOT IN ('lada', 'mini_isuzu', 'isuzu', 'toyota_carryon', 'other') THEN RETURN '[]'::jsonb; END IF;
    s := s || jsonb_build_object('deal', COALESCE(s->'deal', '{}'::jsonb) || jsonb_build_object('vclass', split_part(p_data, ':', 3), 'asked', true));
    -- Kept on the driver, so next time it isn't asked.
    UPDATE transport_drivers SET vehicle_class = s #>> '{deal,vclass}', updated_at = now()
     WHERE id = (s #>> '{deal,driver}')::uuid AND vehicle_class IS NULL;
    s := s || jsonb_build_object('step', CASE WHEN s #>> '{deal,price}' IS NOT NULL THEN 'h_ok' ELSE 'h_price' END);
  ELSIF p_data = 'h:bk' THEN
    IF s->>'step' = 'h_driver' OR (s->>'step' = 'h_new' AND jsonb_array_length(COALESCE(s->'hdrivers', '[]'::jsonb)) = 0) THEN
      -- Out of the deal: back to the question that started it.
      s := s - 'deal' - 'hdrivers';
      IF t.kind = 'truck' THEN
        s := s || jsonb_build_object('step', 'who');
        PERFORM bot_thread_save(t.id, 'truck', s);
        t.state := s;
        RETURN bot_show(t, bot_truck_view(s));
      END IF;
      s := s - 'step';
      PERFORM bot_thread_save(t.id, 'assign', s);
      RETURN bot_edit(t.chat_id, t.message_id,
        bot_trip_card_text((SELECT x FROM transportation_requests x WHERE x.id = (s->>'trip')::uuid), s->>'when') || E'\n\nWho takes it?',
        bot_assign_kb(s->'drivers', (s->>'trip')::uuid));
    END IF;
    s := s || jsonb_build_object('step', CASE s->>'step'
      WHEN 'h_new' THEN 'h_driver'
      WHEN 'h_vehicle' THEN 'h_driver'
      WHEN 'h_price' THEN CASE WHEN COALESCE((s #>> '{deal,asked}')::boolean, false) THEN 'h_vehicle' ELSE 'h_driver' END
      ELSE 'h_price' END);
  ELSIF p_data = 'h:ok' THEN
    RETURN bot_deal_done(t, s, p_actor);
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  RETURN bot_deal_show(t, s);
END $$;

-- The typed answers: the driver (name and phone) and the price.
CREATE OR REPLACE FUNCTION bot_deal_text(t bot_threads, p_what text, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_phone text;
  v_name text;
  d transport_drivers;
  v_num numeric;
BEGIN
  IF t.kind = 'assign' AND NOT bot_is_dispatcher(p_actor) THEN RAISE EXCEPTION 'Only logistics or admin can arrange trucks'; END IF;
  IF p_what = 'deal_driver' THEN
    v_phone := substring(p_text FROM '\+?[0-9][0-9 \-]{7,16}[0-9]');
    v_name := btrim(regexp_replace(replace(p_text, COALESCE(v_phone, ''), ' '), '[\s,;:\-]+', ' ', 'g'));
    IF length(regexp_replace(v_name, '[0-9\s.,;:+()\-]', '', 'g')) < 2 THEN
      RETURN bot_msg(t.chat_id, 'Send the driver''s name too, for example: Abebe Kebede 0911 223344');
    END IF;
    IF v_phone IS NOT NULL AND trip_phone(v_phone) IS NULL THEN
      RETURN bot_msg(t.chat_id, 'That phone number doesn''t look right. Send the name and a phone like 0911 223344.');
    END IF;
    d := trip_driver_find_or_add(left(v_name, 80), v_phone);
    s := s || jsonb_build_object('deal', jsonb_strip_nulls(jsonb_build_object('driver', d.id, 'name', d.full_name,
           'phone', d.phone, 'vclass', d.vehicle_class, 'price', s #> '{deal,price}')));
    s := s || jsonb_build_object('step', CASE WHEN d.vehicle_class IS NULL THEN 'h_vehicle'
                                              WHEN s #>> '{deal,price}' IS NOT NULL THEN 'h_ok' ELSE 'h_price' END);
  ELSIF p_what = 'deal_price' THEN
    v_num := substring(replace(p_text, ',', '') FROM '[0-9]+(?:\.[0-9]+)?')::numeric;
    IF v_num IS NULL OR v_num < 50 OR v_num > 50000 THEN
      RETURN bot_msg(t.chat_id, 'Send the price in birr, like 1500.');
    END IF;
    s := s || jsonb_build_object('deal', COALESCE(s->'deal', '{}'::jsonb) || jsonb_build_object('price', round(v_num, 2)), 'step', 'h_ok');
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  PERFORM bot_await_clear(t.chat_id);
  RETURN bot_deal_show(t, s, true);
END $$;

-- ── 4. Asking for a truck: who finds the driver ─────────────────────────
CREATE OR REPLACE FUNCTION bot_truck_view(s jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_head text := bot_truck_head(s);
  v_items jsonb;
BEGIN
  IF left(COALESCE(s->>'step', ''), 2) = 'h_' THEN RETURN bot_deal_view(v_head, s, true); END IF;
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
  ELSIF s->>'step' = 'who' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\nWho finds the driver?',
      'kb', bot_kb(jsonb_build_array(
        jsonb_build_array(bot_btn('🤝 I''ve hired a driver', 'k:h')),
        jsonb_build_array(bot_btn('📨 Logistics, please arrange one', 'k:l')),
        jsonb_build_array(bot_btn('◀ Back', 'k:bk'), bot_btn('✖ Cancel', 'x')))));
  END IF;
  RETURN jsonb_build_object('text', v_head || E'\n\nSend it to logistics?',
    'kb', bot_kb(jsonb_build_array(
      jsonb_build_array(bot_btn('✅ Send', 'k:ok')),
      jsonb_build_array(bot_btn('◀ Back', 'k:bk'), bot_btn('✖ Cancel', 'x')))));
END $$;

-- s->>'hire' = 'self': the deal is recorded with it, so the trip is hired and
-- arranged from the start and no logistics card goes out.
CREATE OR REPLACE FUNCTION bot_trip_create(p_actor jsonb, s jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_po sourcing_bundles;
  v_vendor vendors;
  v_proj projects;
  v_id uuid;
  v_when date := CASE WHEN s->>'when' IN ('tam', 'tpm') THEN bot_today() + 1 ELSE bot_today() END;
  v_self boolean := s->>'hire' = 'self';
BEGIN
  IF NOT bot_can_truck(p_actor) THEN RAISE EXCEPTION 'You can''t ask for trucks from here'; END IF;
  IF v_self AND (s #>> '{deal,driver}' IS NULL OR s #>> '{deal,price}' IS NULL) THEN
    RAISE EXCEPTION 'Pick the driver and type the price first';
  END IF;
  IF s->>'po' IS NOT NULL THEN
    SELECT * INTO v_po FROM sourcing_bundles WHERE id = (s->>'po')::uuid;
    SELECT * INTO v_vendor FROM vendors WHERE id = v_po.vendor_id;
  END IF;
  SELECT * INTO v_proj FROM projects WHERE id = NULLIF(s->>'site', '')::uuid;
  INSERT INTO transportation_requests (request_name, job_type, job_status, priority, project_id, sourcing_bundle_id,
    vendor_id, vendor_name, pickup_location_id, pickup_location_text, dropoff_location_id, dropoff_location_text,
    requested_date, expected_delivery_date, notes, requested_by_id, requested_by_staff_id, created_via, requested,
    transport_mode, hired_driver_id, driver_name, hired_vehicle_class, amount, assigned_at)
  VALUES (
    CASE WHEN v_po.id IS NOT NULL
         THEN 'Collect ' || v_po.bundle_code || COALESCE(' from ' || COALESCE(v_vendor.vendor_name, v_po.vendor_name), '')
         ELSE left(btrim(s->>'desc'), 120) END,
    CASE WHEN v_po.id IS NOT NULL THEN 'purchase_pickup' ELSE 'material_move' END,
    CASE WHEN v_self THEN 'assigned' ELSE 'requested' END,
    CASE WHEN s->>'when' = 'now' THEN 'urgent' ELSE 'normal' END,
    v_proj.id, v_po.id, v_po.vendor_id, COALESCE(v_vendor.vendor_name, v_po.vendor_name),
    v_vendor.location_id, CASE WHEN v_po.id IS NOT NULL THEN COALESCE(v_vendor.vendor_name, v_po.vendor_name) END,
    v_proj.location_id, btrim(v_proj.project_name),
    bot_today(), v_when,
    concat_ws(E'\n', NULLIF(btrim(s->>'desc'), ''), 'When: ' || bot_when_label(s->>'when'),
      CASE WHEN v_self THEN 'Driver hired by ' || (p_actor->>'name') || ' and recorded in Telegram'
           ELSE 'Asked in Telegram by ' || (p_actor->>'name') END),
    NULLIF(p_actor->>'user_id', '')::uuid, CASE WHEN p_actor->>'user_id' IS NULL THEN NULLIF(p_actor->>'staff_id', '')::uuid END,
    'telegram', true,
    CASE WHEN v_self THEN 'hired' ELSE 'own_fleet' END,
    CASE WHEN v_self THEN (s #>> '{deal,driver}')::uuid END,
    CASE WHEN v_self THEN s #>> '{deal,name}' END,
    CASE WHEN v_self THEN s #>> '{deal,vclass}' END,
    CASE WHEN v_self THEN (s #>> '{deal,price}')::numeric END,
    CASE WHEN v_self THEN now() END)
  RETURNING id INTO v_id;
  IF NOT v_self THEN PERFORM bot_trip_cards(v_id, s->>'when'); END IF;
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
    s := s || jsonb_build_object('when', split_part(p_data, ':', 3), 'step', 'who');
  ELSIF p_data = 'k:h' THEN
    RETURN bot_deal_start(t, s || jsonb_build_object('hire', 'self'), p_actor);
  ELSIF p_data = 'k:l' THEN
    s := s - 'hire' - 'deal' - 'hdrivers' || jsonb_build_object('step', 'confirm');
  ELSIF p_data = 'k:bk' THEN
    s := s || jsonb_build_object('step', CASE s->>'step'
      WHEN 'confirm' THEN 'who'
      WHEN 'who' THEN 'when'
      WHEN 'when' THEN CASE WHEN s ? 'po' THEN 'po' ELSE 'site' END
      ELSE 'what' END);
    IF s->>'step' = 'site' AND NOT s ? 'sites' THEN s := s || jsonb_build_object('sites', bot_sites(p_actor)); END IF;
  ELSIF p_data = 'k:ok' THEN
    s := s - 'hire';
    PERFORM bot_thread_save(t.id, 'truck', s || jsonb_build_object('trip', bot_trip_create(p_actor, s)), true);
    RETURN bot_edit(t.chat_id, t.message_id, replace(bot_truck_view(s)->>'text', E'\n\nSend it to logistics?', '')
      || E'\n\n✅ Sent to logistics. I''ll tell you when a truck is arranged.');
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  PERFORM bot_thread_save(t.id, 'truck', s);
  RETURN bot_show(t, bot_truck_view(s));
END $$;

-- ── 5. Logistics: "🚕 Hire one" records the deal too ───────────────────
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
    SELECT * INTO tr FROM transportation_requests WHERE id = v_trip;
    IF tr.job_status IS DISTINCT FROM 'requested' THEN
      PERFORM bot_thread_save(t.id, t.kind, t.state, true);
      RETURN bot_edit(t.chat_id, t.message_id, bot_trip_card_text(tr, t.state->>'when') || E'\n\nAlready arranged.');
    END IF;
    RETURN bot_deal_start(t, t.state, p_actor);
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

-- ── 6. Following a hired trip ───────────────────────────────────────────
-- Whoever asked for a trip can move it on too: on a hired truck nobody else
-- is on Telegram to do it.
CREATE OR REPLACE FUNCTION bot_trip_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tr transportation_requests;
BEGIN
  SELECT * INTO tr FROM transportation_requests WHERE id = (t.state->>'trip')::uuid;
  IF NOT FOUND THEN RETURN bot_answer(NULL, 'That trip is gone.'); END IF;
  IF NOT (bot_is_dispatcher(p_actor)
          OR (tr.assigned_staff_id IS NOT NULL AND tr.assigned_staff_id = NULLIF(p_actor->>'staff_id', '')::uuid)
          OR (tr.requested_by_id IS NOT NULL AND tr.requested_by_id = NULLIF(p_actor->>'user_id', '')::uuid)
          OR (tr.requested_by_staff_id IS NOT NULL AND tr.requested_by_staff_id = NULLIF(p_actor->>'staff_id', '')::uuid)) THEN
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

-- Logistics hears of a driver hired outside logistics (bot or web).
CREATE OR REPLACE FUNCTION bot_trip_hired_note(tr transportation_requests) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_users uuid[];
  v_carded uuid[] := '{}';
  v_who text := COALESCE((SELECT full_name FROM user_profiles WHERE id = tr.requested_by_id),
                         (SELECT employee_name FROM staff WHERE id = tr.requested_by_staff_id), 'Someone');
  v_driver text := COALESCE((SELECT full_name FROM transport_drivers WHERE id = tr.hired_driver_id), NULLIF(btrim(tr.driver_name), ''), 'a driver');
  v_url text := bot_url('/transportation/' || tr.id || '/edit');
BEGIN
  SELECT array_agg(id) INTO v_users FROM user_profiles
   WHERE account_status = 'active' AND (role::text = 'logistics_officer' OR COALESCE(is_logistics_officer, false))
     AND id IS DISTINCT FROM tr.requested_by_id;
  IF v_users IS NULL THEN
    SELECT array_agg(id) INTO v_users FROM user_profiles
     WHERE account_status = 'active' AND role::text = 'admin' AND id IS DISTINCT FROM tr.requested_by_id;
  END IF;
  IF bot_ready() THEN
    FOR u IN SELECT np.user_id, np.telegram_chat_id AS chat FROM notification_prefs np
              WHERE np.user_id = ANY (v_users) AND np.telegram_chat_id IS NOT NULL LOOP
      PERFORM bot_queue(bot_msg(u.chat, '🤝 <b>' || bot_esc(v_who) || ' hired a driver</b>' || E'\n' || bot_trip_card_text(tr),
        CASE WHEN v_url IS NOT NULL THEN bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('Open in Kuncho', v_url)))) END));
      v_carded := v_carded || u.user_id;
    END LOOP;
  END IF;
  PERFORM bot_notify(v_users, 'trip.hired', v_who || ' hired ' || v_driver || ': ' || COALESCE(tr.request_name, 'a trip'),
    NULLIF(concat_ws(' · ', bot_vclass_label(tr.hired_vehicle_class), CASE WHEN tr.amount IS NOT NULL THEN 'agreed ' || bot_birr(tr.amount) END), ''),
    '/transportation/' || tr.id || '/edit', 'transportation_request', tr.id, v_carded);
END $$;

-- As in 433, plus: a hired trip recorded outside logistics tells logistics; a
-- hired truck arranged by logistics reaches whoever asked with its driver,
-- price and buttons; and nobody is told what they just did themselves.
CREATE OR REPLACE FUNCTION trg_bot_trip_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_chat bigint;
  t bot_threads;
  v_msg text;
  v_by_asker boolean := (NEW.requested_by_id IS NOT NULL AND NEW.requested_by_id = auth.uid())
    OR (NEW.requested_by_staff_id IS NOT NULL AND NEW.requested_by_staff_id::text = current_setting('kuncho.bot_staff', true));
BEGIN
  IF TG_OP = 'INSERT' AND NEW.transport_mode = 'hired' AND NEW.hired_driver_id IS NOT NULL
     AND NEW.job_status IN ('assigned', 'in_progress', 'completed') AND NEW.created_via <> 'payout'
     AND NOT bot_user_is_logistics(NEW.requested_by_id) THEN
    PERFORM bot_trip_hired_note(NEW);
  END IF;
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
     AND NEW.job_status IN ('assigned', 'completed', 'cancelled') AND NOT v_by_asker THEN
    v_chat := COALESCE(bot_chat_of_user(NEW.requested_by_id), bot_chat_of_staff(NEW.requested_by_staff_id));
    v_msg := CASE NEW.job_status
      WHEN 'assigned' THEN '🚚 <b>Your truck is arranged</b>' || E'\n' || CASE WHEN NEW.transport_mode = 'own_fleet'
          THEN bot_esc(COALESCE(NEW.request_name, ''))
               || E'\nDriver: ' || bot_esc(COALESCE((SELECT employee_name FROM staff WHERE id = NEW.assigned_staff_id), 'ours'))
               || COALESCE(' · ' || NULLIF(bot_esc((SELECT name FROM vehicles WHERE id = NEW.vehicle_id)), ''), '')
          ELSE bot_trip_card_text(NEW) END
      WHEN 'completed' THEN '✅ <b>Delivered</b>' || E'\n' || bot_esc(COALESCE(NEW.request_name, ''))
      ELSE '✖ <b>Trip cancelled</b>' || E'\n' || bot_esc(COALESCE(NEW.request_name, '')) END;
    IF v_chat IS NOT NULL THEN
      IF NEW.job_status = 'assigned' AND NEW.transport_mode <> 'own_fleet' THEN
        -- A hired truck: whoever asked follows it, with its buttons.
        UPDATE bot_threads SET closed_at = now() WHERE kind = 'trip' AND state->>'trip' = NEW.id::text AND chat_id = v_chat AND closed_at IS NULL;
        t := bot_thread_new(jsonb_build_object('chat', v_chat, 'user_id', NEW.requested_by_id, 'staff_id', NEW.requested_by_staff_id),
                            'trip', jsonb_build_object('trip', NEW.id), 'tp:' || NEW.id);
        PERFORM bot_queue(bot_msg(v_chat, v_msg || E'\n\nTap below as it goes.', bot_trip_view(NEW)->'kb', t.id));
      ELSE
        PERFORM bot_queue(bot_msg(v_chat, v_msg));
      END IF;
    END IF;
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

-- ── 7. Routing: the deal's buttons and typed answers ────────────────────
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
        WHEN c.awaiting IN ('deal_driver', 'deal_price') THEN bot_deal_text(t, c.awaiting, v_text, p_actor)
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

-- ── 8. Rights ───────────────────────────────────────────────────────────
DO $rights$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('trip_phone', 'bot_vclass_label', 'trip_driver_find_or_add', 'bot_user_is_logistics',
       'bot_deal_drivers', 'bot_deal_lines', 'bot_deal_view', 'bot_truck_head', 'bot_deal_head', 'bot_deal_show', 'bot_deal_start',
       'bot_deal_done', 'bot_deal_button', 'bot_deal_text', 'bot_trip_hired_note')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $rights$;
REVOKE ALL ON FUNCTION transport_driver_for_trip(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transport_driver_for_trip(text, text, text) TO authenticated;
