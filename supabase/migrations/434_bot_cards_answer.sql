-- 434: the buttons on the bot's cards answer again.
--
-- Cards the bot sends to other people go out through bot_outbox: labour
-- approvals, gate payments to approve, trucks to arrange, a driver's trip, the
-- evening "who worked today", and "who is coming?" once labour is approved. A
-- tap is matched to its conversation by the message it was made on, so each
-- sent card has to be tied to its message id. The notify-channels function
-- passes that id to bot_outbox_done, but the database was still running an
-- earlier draft of migration 433 whose bot_outbox_done ignored it (and had no
-- taken_at claim). So every such card answered "This menu has expired". Menus
-- people opened themselves were tied by another path and worked.
--
-- This brings bot_outbox_take, bot_outbox_done and pay_out_trip up to 433 as
-- written. A card that was sent but never tied to its message — every one sent
-- so far — now finds its conversation on the first tap by what it says, so the
-- cards already in people's chats work without being sent again.

ALTER TABLE bot_outbox ADD COLUMN IF NOT EXISTS taken_at timestamptz;
CREATE INDEX IF NOT EXISTS bot_outbox_thread_idx ON bot_outbox (thread_id) WHERE thread_id IS NOT NULL;

-- ── 1. The outbox, as in 433 ────────────────────────────────────────────
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

-- ── 2. Gate payments, as in 433 (with the day paid and the receipt's VAT) ─
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

-- ── 3. A card sent but never tied to its message ────────────────────────
-- What Telegram shows of a card we sent as HTML: no tags, entities decoded,
-- whitespace evened out.
CREATE OR REPLACE FUNCTION bot_plain(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
    replace(replace(replace(replace(regexp_replace(COALESCE(p, ''), '<[^>]*>', '', 'g'),
      '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&amp;', '&'),
    '\s+', ' ', 'g')) $$;

-- The open conversation in this chat whose card says exactly what the tapped
-- message says. It is tied to that message from now on. Nothing if the message
-- already belongs to a conversation (that one is finished) or nothing matches.
CREATE OR REPLACE FUNCTION bot_thread_by_text(p_chat bigint, p_message_id bigint, p_text text) RETURNS bot_threads
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t bot_threads;
  v_text text := btrim(regexp_replace(COALESCE(p_text, ''), '\s+', ' ', 'g'));
BEGIN
  IF p_message_id IS NULL OR v_text = '' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM bot_threads WHERE chat_id = p_chat AND message_id = p_message_id) THEN RETURN NULL; END IF;
  SELECT th.* INTO t FROM bot_threads th
   WHERE th.chat_id = p_chat AND th.message_id IS NULL AND th.closed_at IS NULL
     AND th.created_at > now() - interval '30 days'
     AND EXISTS (SELECT 1 FROM bot_outbox o
                  WHERE o.thread_id = th.id AND o.sent_at IS NOT NULL AND o.method = 'sendMessage'
                    AND bot_plain(o.payload->>'text') = v_text)
   ORDER BY th.created_at DESC
   LIMIT 1;
  IF t.id IS NULL THEN RETURN NULL; END IF;
  UPDATE bot_threads SET message_id = p_message_id, updated_at = now() WHERE id = t.id AND message_id IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  t.message_id := p_message_id;
  RETURN t;
END $$;

-- ── 4. The entry point: as in 433, plus that fallback ───────────────────
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
    RETURN bot_msg(v_chat, 'Hi! This chat isn''t connected to Kuncho yet. If you have a Kuncho login, open '
      || '<b>Settings → Notifications</b> and tap <b>Connect Telegram</b>. Otherwise ask the office for your connect link.');
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

REVOKE ALL ON FUNCTION bot_plain(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bot_thread_by_text(bigint, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bot_handle(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bot_handle(jsonb) TO service_role;
