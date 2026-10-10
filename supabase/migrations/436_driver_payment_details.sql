-- 436: how a hired driver gets paid — asked once, kept on the driver.
--
-- Recording a deal (migration 435) now asks how the driver is paid when the
-- driver list doesn't know yet: telebirr (their own phone in one tap, or
-- another number), a bank account, cash, or "not sure" for the cashier to
-- ask. It is kept on the driver when the deal is recorded, so it isn't asked
-- again. Details already on file are never changed from a deal — only in
-- Kuncho by the office (transport_drivers RLS) — so nobody can redirect a
-- driver's money from a chat.
--
-- Trip cards say how the driver is paid, the web form asks the same when
-- someone types a new driver (transport_driver_for_trip with p_pay), and a
-- gate payment by telebirr records the driver's telebirr number as where the
-- money went (pay_out_trip).

-- ── 1. Payment details ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bot_banks() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '["CBE", "Awash", "Dashen", "Abyssinia", "Coopbank", "Wegagen", "Hibret", "Zemen"]'::jsonb $$;

-- How a driver is paid, in a few words.
CREATE OR REPLACE FUNCTION trip_payout_label(p_method text, p_bank text, p_account text, p_name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_method
    WHEN 'cash' THEN 'cash'
    WHEN 'telebirr' THEN 'telebirr ' || COALESCE(p_account, '—')
    WHEN 'bank' THEN concat_ws(' ', NULLIF(btrim(p_bank), ''), COALESCE(p_account, '—')) || COALESCE(' · ' || NULLIF(btrim(p_name), ''), '')
  END $$;

-- A driver's payment details as the deal carries them, when they're complete.
CREATE OR REPLACE FUNCTION bot_driver_pay(d transport_drivers) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN d.payout_method = 'cash' OR (d.payout_method IN ('telebirr', 'bank') AND d.account_number IS NOT NULL)
    THEN jsonb_strip_nulls(jsonb_build_object('method', d.payout_method, 'bank', d.bank_name, 'account', d.account_number, 'name', d.account_name)) END $$;

-- A driver's payment details, where we have none. p_pay: {method, bank, account, name}.
CREATE OR REPLACE FUNCTION trip_driver_set_payout(p_driver uuid, p_pay jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_method text := p_pay->>'method';
  v_account text := NULLIF(btrim(p_pay->>'account'), '');
BEGIN
  IF p_driver IS NULL OR v_method IS NULL OR v_method NOT IN ('telebirr', 'bank', 'cash') THEN RETURN; END IF;
  IF v_method = 'telebirr' THEN
    v_account := trip_phone(v_account);
    IF v_account IS NULL OR v_account !~ '^09' THEN RETURN; END IF;
  ELSIF v_method = 'bank' THEN
    v_account := regexp_replace(COALESCE(v_account, ''), '\D', '', 'g');
    IF v_account !~ '^[0-9]{6,20}$' THEN RETURN; END IF;
  END IF;
  UPDATE transport_drivers
     SET payout_method = v_method,
         account_number = CASE WHEN v_method = 'cash' THEN NULL ELSE v_account END,
         bank_name = CASE WHEN v_method = 'bank' THEN NULLIF(btrim(p_pay->>'bank'), '') END,
         account_name = CASE WHEN v_method = 'bank' THEN NULLIF(btrim(p_pay->>'name'), '') END,
         updated_at = now()
   WHERE id = p_driver
     AND (payout_method IS NULL OR (payout_method IN ('telebirr', 'bank') AND account_number IS NULL));
END $$;

-- The web form's typed driver, with how they're paid (p_pay may be null).
CREATE OR REPLACE FUNCTION transport_driver_for_trip(p_name text, p_phone text, p_vclass text, p_pay jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_phone IS NOT NULL AND btrim(p_phone) <> '' AND trip_phone(p_phone) IS NULL THEN
    RAISE EXCEPTION 'That phone number doesn''t look right — use 09… or 07…';
  END IF;
  IF p_pay->>'method' = 'telebirr' AND COALESCE(trip_phone(p_pay->>'account'), '') !~ '^09' THEN
    RAISE EXCEPTION 'That telebirr number doesn''t look right — use 09…';
  END IF;
  IF p_pay->>'method' = 'bank' AND (regexp_replace(COALESCE(p_pay->>'account', ''), '\D', '', 'g') !~ '^[0-9]{6,20}$'
                                    OR NULLIF(btrim(p_pay->>'bank'), '') IS NULL) THEN
    RAISE EXCEPTION 'Give the bank and the account number';
  END IF;
  v_id := (trip_driver_find_or_add(p_name, p_phone, p_vclass)).id;
  PERFORM trip_driver_set_payout(v_id, p_pay);
  RETURN v_id;
END $$;

-- ── 2. Cards say how the driver is paid ─────────────────────────────────
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
    || CASE WHEN tr.transport_mode <> 'own_fleet' AND d.payout_method IS NOT NULL
            THEN E'\nPaid by: ' || bot_esc(trip_payout_label(d.payout_method, d.bank_name, d.account_number, d.account_name)) ELSE '' END
  FROM (SELECT 1) one LEFT JOIN transport_drivers d ON d.id = tr.hired_driver_id $$;

CREATE OR REPLACE FUNCTION bot_trip_hired_note(tr transportation_requests) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_users uuid[];
  v_carded uuid[] := '{}';
  v_who text := COALESCE((SELECT full_name FROM user_profiles WHERE id = tr.requested_by_id),
                         (SELECT employee_name FROM staff WHERE id = tr.requested_by_staff_id), 'Someone');
  d transport_drivers;
  v_url text := bot_url('/transportation/' || tr.id || '/edit');
BEGIN
  SELECT * INTO d FROM transport_drivers WHERE id = tr.hired_driver_id;
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
  PERFORM bot_notify(v_users, 'trip.hired',
    v_who || ' hired ' || COALESCE(d.full_name, NULLIF(btrim(tr.driver_name), ''), 'a driver') || ': ' || COALESCE(tr.request_name, 'a trip'),
    NULLIF(concat_ws(' · ', bot_vclass_label(tr.hired_vehicle_class),
      CASE WHEN tr.amount IS NOT NULL THEN 'agreed ' || bot_birr(tr.amount) END,
      CASE WHEN d.payout_method IS NOT NULL THEN 'paid by ' || trip_payout_label(d.payout_method, d.bank_name, d.account_number, d.account_name) END), ''),
    '/transportation/' || tr.id || '/edit', 'transportation_request', tr.id, v_carded);
END $$;

-- ── 3. The deal: driver, vehicle, how they're paid, price ───────────────
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
    SELECT d AS drv, d.full_name, m.at, COALESCE(u.n, 0) AS n
    FROM transport_drivers d LEFT JOIN mine m ON m.id = d.id LEFT JOIN used u ON u.id = d.id
    WHERE d.is_active
    ORDER BY m.at DESC NULLS LAST, COALESCE(u.n, 0) DESC, d.full_name
    LIMIT 6
  )
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', (drv).id, 'name', (drv).full_name, 'phone', (drv).phone,
           'vclass', (drv).vehicle_class, 'pay', bot_driver_pay(drv))) ORDER BY at DESC NULLS LAST, n DESC, full_name), '[]'::jsonb)
  FROM pick $$;

-- The next thing the deal still needs.
CREATE OR REPLACE FUNCTION bot_deal_next(s jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN s #>> '{deal,vclass}' IS NULL THEN 'h_vehicle'
    WHEN s #> '{deal,pay}' IS NULL AND NOT COALESCE((s #>> '{deal,pay_skip}')::boolean, false) THEN 'h_pay'
    WHEN s #>> '{deal,price}' IS NULL THEN 'h_price'
    ELSE 'h_ok' END $$;

-- The deal as it stands, from a driver picked or typed: what we know of them,
-- and the price if one was typed already.
CREATE OR REPLACE FUNCTION bot_deal_of(s jsonb, p_driver jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT s || jsonb_build_object('deal', jsonb_strip_nulls(jsonb_build_object(
    'driver', p_driver->>'id', 'name', p_driver->>'name', 'phone', p_driver->>'phone', 'vclass', p_driver->>'vclass',
    'pay', p_driver->'pay', 'price', s #> '{deal,price}'))) $$;

CREATE OR REPLACE FUNCTION bot_deal_lines(s jsonb) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(E'\nDriver: ' || NULLIF(bot_esc(s #>> '{deal,name}'), '') || COALESCE(' · ' || (s #>> '{deal,phone}'), ''), '')
      || COALESCE(E'\nVehicle: ' || bot_vclass_label(s #>> '{deal,vclass}'), '')
      || CASE WHEN s #> '{deal,pay}' IS NOT NULL
              THEN E'\nPaid by: ' || bot_esc(trip_payout_label(s #>> '{deal,pay,method}', s #>> '{deal,pay,bank}', s #>> '{deal,pay,account}', s #>> '{deal,pay,name}'))
              WHEN COALESCE((s #>> '{deal,pay_skip}')::boolean, false) THEN E'\nPaid by: not known yet — the cashier will ask'
              ELSE '' END
      || CASE WHEN s #>> '{deal,price}' IS NOT NULL THEN E'\nAgreed: <b>' || bot_birr((s #>> '{deal,price}')::numeric) || '</b>' ELSE '' END $$;

CREATE OR REPLACE FUNCTION bot_deal_view(p_head text, s jsonb, p_cancel boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_head text := p_head || bot_deal_lines(s);
  v_items jsonb;
  v_back jsonb := jsonb_build_array(bot_btn('◀ Back', 'h:bk'))
    || CASE WHEN p_cancel THEN jsonb_build_array(bot_btn('✖ Cancel', 'x')) ELSE '[]'::jsonb END;
  v_type text := E'\n\nType the driver''s name and phone, for example:\nAbebe Kebede 0911 223344';
  v_phone text := s #>> '{deal,phone}';
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
  ELSIF s->>'step' = 'h_pay' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\nHow does the driver get paid?',
      'kb', bot_kb(
        CASE WHEN v_phone ~ '^09' THEN jsonb_build_array(jsonb_build_array(bot_btn('📱 telebirr · ' || v_phone, 'h:p:tbp'))) ELSE '[]'::jsonb END
        || jsonb_build_array(
          jsonb_build_array(bot_btn(CASE WHEN v_phone ~ '^09' THEN '📱 Another telebirr number' ELSE '📱 telebirr' END, 'h:p:tb'),
                            bot_btn('🏦 Bank account', 'h:p:bk')),
          jsonb_build_array(bot_btn('💵 Cash', 'h:p:cash'), bot_btn('🤷 Not sure', 'h:p:skip')),
          v_back)));
  ELSIF s->>'step' = 'h_pay_tb' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\nType the telebirr number, for example: 0911 223344',
      'kb', bot_kb(jsonb_build_array(v_back)));
  ELSIF s->>'step' = 'h_pay_bank' THEN
    SELECT jsonb_agg(bot_btn(x #>> '{}', 'h:b:' || (i - 1)) ORDER BY i) INTO v_items
      FROM jsonb_array_elements(bot_banks()) WITH ORDINALITY e(x, i);
    RETURN jsonb_build_object('text', v_head || E'\n\nWhich bank?',
      'kb', bot_kb(bot_grid(v_items || jsonb_build_array(bot_btn('Other bank', 'h:b:o')), 3) || jsonb_build_array(v_back)));
  ELSIF s->>'step' = 'h_pay_acct' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\n' || CASE WHEN s #>> '{deal,bank_pick}' IS NULL
        THEN E'Type the bank, the account number and the name on it, for example:\nNib 7000123456789 Abebe Kebede'
        ELSE 'Type the ' || bot_esc(s #>> '{deal,bank_pick}') || E' account number and the name on it, for example:\n1000123456789 Abebe Kebede' END,
      'kb', bot_kb(jsonb_build_array(v_back)));
  ELSIF s->>'step' = 'h_price' THEN
    RETURN jsonb_build_object('text', v_head || E'\n\nWhat price was agreed, in birr? Type it, for example: 1500',
      'kb', bot_kb(jsonb_build_array(v_back)));
  END IF;
  RETURN jsonb_build_object('text', v_head || E'\n\nRecord the deal?',
    'kb', bot_kb(jsonb_build_array(jsonb_build_array(bot_btn('✅ Record the deal', 'h:ok')), v_back)));
END $$;

CREATE OR REPLACE FUNCTION bot_deal_show(t bot_threads, s jsonb, p_fresh boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF s->>'step' = 'h_new' THEN PERFORM bot_await(t.chat_id, t.id, 'deal_driver');
  ELSIF s->>'step' = 'h_price' THEN PERFORM bot_await(t.chat_id, t.id, 'deal_price');
  ELSIF s->>'step' = 'h_pay_tb' THEN PERFORM bot_await(t.chat_id, t.id, 'deal_pay_tb');
  ELSIF s->>'step' = 'h_pay_acct' THEN PERFORM bot_await(t.chat_id, t.id, 'deal_pay_acct');
  END IF;
  PERFORM bot_thread_save(t.id, t.kind, s);
  t.state := s;
  RETURN bot_show(t, bot_deal_view(bot_deal_head(t, s), s, t.kind = 'truck'), p_fresh);
END $$;

CREATE OR REPLACE FUNCTION bot_deal_button(t bot_threads, p_data text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  d jsonb;
  v_pay jsonb;
BEGIN
  IF t.kind NOT IN ('truck', 'assign') OR left(COALESCE(s->>'step', ''), 2) <> 'h_' THEN RETURN '[]'::jsonb; END IF;
  IF t.kind = 'assign' AND NOT bot_is_dispatcher(p_actor) THEN RAISE EXCEPTION 'Only logistics or admin can arrange trucks'; END IF;
  IF p_data LIKE 'h:d:%' THEN
    d := s->'hdrivers'->(split_part(p_data, ':', 3)::integer);
    IF d IS NULL THEN RETURN '[]'::jsonb; END IF;
    s := bot_deal_of(s, d);
    s := s || jsonb_build_object('step', bot_deal_next(s));
  ELSIF p_data = 'h:n' THEN
    s := s || jsonb_build_object('step', 'h_new');
  ELSIF p_data LIKE 'h:v:%' THEN
    IF split_part(p_data, ':', 3) NOT IN ('lada', 'mini_isuzu', 'isuzu', 'toyota_carryon', 'other') THEN RETURN '[]'::jsonb; END IF;
    s := s || jsonb_build_object('deal', COALESCE(s->'deal', '{}'::jsonb) || jsonb_build_object('vclass', split_part(p_data, ':', 3), 'asked', true));
    -- Kept on the driver, so next time it isn't asked.
    UPDATE transport_drivers SET vehicle_class = s #>> '{deal,vclass}', updated_at = now()
     WHERE id = (s #>> '{deal,driver}')::uuid AND vehicle_class IS NULL;
    s := s || jsonb_build_object('step', bot_deal_next(s));
  ELSIF p_data LIKE 'h:p:%' THEN
    v_pay := CASE split_part(p_data, ':', 3)
      WHEN 'tbp' THEN CASE WHEN s #>> '{deal,phone}' ~ '^09' THEN jsonb_build_object('method', 'telebirr', 'account', s #>> '{deal,phone}') END
      WHEN 'cash' THEN jsonb_build_object('method', 'cash') END;
    IF split_part(p_data, ':', 3) = 'tb' THEN
      s := s || jsonb_build_object('step', 'h_pay_tb');
    ELSIF split_part(p_data, ':', 3) = 'bk' THEN
      s := s || jsonb_build_object('step', 'h_pay_bank');
    ELSIF split_part(p_data, ':', 3) = 'skip' THEN
      s := s || jsonb_build_object('deal', (s->'deal') - 'pay' || jsonb_build_object('pay_skip', true, 'asked_pay', true));
      s := s || jsonb_build_object('step', bot_deal_next(s));
    ELSIF v_pay IS NOT NULL THEN
      s := s || jsonb_build_object('deal', (s->'deal') - 'pay_skip' || jsonb_build_object('pay', v_pay, 'asked_pay', true));
      s := s || jsonb_build_object('step', bot_deal_next(s));
    ELSE
      RETURN '[]'::jsonb;
    END IF;
  ELSIF p_data LIKE 'h:b:%' THEN
    s := s || jsonb_build_object('deal', CASE WHEN split_part(p_data, ':', 3) = 'o' THEN (s->'deal') - 'bank_pick'
      ELSE (s->'deal') || jsonb_build_object('bank_pick', bot_banks()->>(split_part(p_data, ':', 3)::integer)) END,
      'step', 'h_pay_acct');
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
      WHEN 'h_pay' THEN CASE WHEN COALESCE((s #>> '{deal,asked}')::boolean, false) THEN 'h_vehicle' ELSE 'h_driver' END
      WHEN 'h_pay_tb' THEN 'h_pay'
      WHEN 'h_pay_bank' THEN 'h_pay'
      WHEN 'h_pay_acct' THEN 'h_pay_bank'
      WHEN 'h_price' THEN CASE WHEN COALESCE((s #>> '{deal,asked_pay}')::boolean, false) THEN 'h_pay'
                               WHEN COALESCE((s #>> '{deal,asked}')::boolean, false) THEN 'h_vehicle' ELSE 'h_driver' END
      ELSE 'h_price' END);
  ELSIF p_data = 'h:ok' THEN
    RETURN bot_deal_done(t, s, p_actor);
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  RETURN bot_deal_show(t, s);
END $$;

-- The typed answers: the driver, the telebirr number, the bank account, the price.
CREATE OR REPLACE FUNCTION bot_deal_text(t bot_threads, p_what text, p_text text, p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := t.state;
  v_phone text;
  v_name text;
  d transport_drivers;
  v_num numeric;
  v_acct text;
  v_bank text;
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
    s := bot_deal_of(s, jsonb_build_object('id', d.id, 'name', d.full_name, 'phone', d.phone, 'vclass', d.vehicle_class, 'pay', bot_driver_pay(d)));
  ELSIF p_what = 'deal_pay_tb' THEN
    v_phone := trip_phone(p_text);
    IF v_phone IS NULL OR v_phone !~ '^09' THEN
      RETURN bot_msg(t.chat_id, 'That doesn''t look like a telebirr number. Send it like 0911 223344.');
    END IF;
    s := s || jsonb_build_object('deal', (s->'deal') - 'pay_skip' || jsonb_build_object('pay', jsonb_build_object('method', 'telebirr', 'account', v_phone), 'asked_pay', true));
  ELSIF p_what = 'deal_pay_acct' THEN
    v_acct := substring(p_text FROM '[0-9][0-9 \-]{4,28}[0-9]');
    v_bank := COALESCE(s #>> '{deal,bank_pick}', NULLIF(btrim(split_part(p_text, COALESCE(v_acct, '§'), 1)), ''));
    v_name := NULLIF(btrim(regexp_replace(CASE WHEN v_acct IS NULL THEN '' ELSE substr(p_text, strpos(p_text, v_acct) + length(v_acct)) END, '\s+', ' ', 'g')), '');
    v_acct := regexp_replace(COALESCE(v_acct, ''), '\D', '', 'g');
    IF v_acct !~ '^[0-9]{6,20}$' THEN
      RETURN bot_msg(t.chat_id, 'Send the account number, for example: 1000123456789 Abebe Kebede');
    END IF;
    IF v_bank IS NULL THEN
      RETURN bot_msg(t.chat_id, 'Send the bank too, for example: Nib 7000123456789 Abebe Kebede');
    END IF;
    s := s || jsonb_build_object('deal', (s->'deal') - 'pay_skip' - 'bank_pick' || jsonb_build_object('pay',
      jsonb_strip_nulls(jsonb_build_object('method', 'bank', 'bank', left(v_bank, 40), 'account', v_acct, 'name', left(v_name, 80))), 'asked_pay', true));
  ELSIF p_what = 'deal_price' THEN
    v_num := substring(replace(p_text, ',', '') FROM '[0-9]+(?:\.[0-9]+)?')::numeric;
    IF v_num IS NULL OR v_num < 50 OR v_num > 50000 THEN
      RETURN bot_msg(t.chat_id, 'Send the price in birr, like 1500.');
    END IF;
    s := s || jsonb_build_object('deal', COALESCE(s->'deal', '{}'::jsonb) || jsonb_build_object('price', round(v_num, 2)));
  ELSE
    RETURN '[]'::jsonb;
  END IF;
  s := s || jsonb_build_object('step', bot_deal_next(s));
  PERFORM bot_await_clear(t.chat_id);
  RETURN bot_deal_show(t, s, true);
END $$;

-- As in 435, plus: how the driver is paid is kept on the driver first, so
-- the trip and everyone told about it carry it.
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
  PERFORM trip_driver_set_payout((s #>> '{deal,driver}')::uuid, s #> '{deal,pay}');
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

-- As in 435, plus the typed telebirr number and bank account.
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
        WHEN c.awaiting IN ('deal_driver', 'deal_price', 'deal_pay_tb', 'deal_pay_acct') THEN bot_deal_text(t, c.awaiting, v_text, p_actor)
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

-- ── 4. A gate payment by telebirr went to the driver's telebirr number ──
-- As in 433/434, with that one change (vendors_bank_account).
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
    v_driver.full_name,
    CASE WHEN v_method = 'telebirr' THEN COALESCE(CASE WHEN v_driver.payout_method = 'telebirr' THEN v_driver.account_number END, v_driver.phone, v_driver.account_number) END,
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

-- ── 5. Rights ───────────────────────────────────────────────────────────
DO $rights$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('bot_banks', 'trip_payout_label', 'bot_driver_pay', 'trip_driver_set_payout',
       'bot_deal_next', 'bot_deal_of')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $rights$;
REVOKE ALL ON FUNCTION transport_driver_for_trip(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transport_driver_for_trip(text, text, text, jsonb) TO authenticated;
