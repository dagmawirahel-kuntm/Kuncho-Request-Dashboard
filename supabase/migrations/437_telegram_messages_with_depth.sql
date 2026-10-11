-- 437: Telegram messages with depth.
--
-- A notification on Telegram used to be its title and one line
-- ("PO-2026-0303 · ETB 510 — from Mengistu Gudeta"). Now the message is built
-- from the record when it goes out, so whoever reads it can decide without
-- opening Kuncho:
--   • expenses — what it is, who gets paid (the vendor with their type and
--     history, a staff member, or each worker on a pay sheet), VAT, WHT and
--     what is actually paid, the receipt, the trip or purchase order behind
--     it, the checks the app flags (a possible duplicate names the other
--     expense) and what the project has spent so far;
--   • purchase orders — every line with quantity × price and how the price
--     compares with the last time we bought it, the payment plan, the vendor,
--     which requests it fills, and on delivery what came in against what was
--     ordered;
--   • purchase requests — every item, what is already in the store, and
--     roughly what it costs at the last price paid;
--   • labour requests — the dates, the scope, where, and who is already
--     working on the site (the approval card in the bot shows the same).
-- The bell in the app keeps the short version. notify_service_telegram_outbox
-- hands the long one to the edge function as `text`; if it can't be built,
-- or Telegram refuses it, the short version still goes out.

-- ── 1. Small helpers ────────────────────────────────────────────────────
-- Escaped for Telegram's HTML. Unlike bot_esc, blank stays NULL, so a
-- COALESCE can drop the whole part.
CREATE OR REPLACE FUNCTION tg_e(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(NULLIF(btrim(p), ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

-- Free text on one line, cut to n characters, escaped.
CREATE OR REPLACE FUNCTION tg_line(p text, n integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT tg_e(notify_short(regexp_replace(p, '\s+', ' ', 'g'), n)) $$;

-- 14,400 · 34.50 — money the way the cards show it, without "birr".
CREATE OR REPLACE FUNCTION tg_num(p numeric) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL THEN '—'
              WHEN round(p, 2) = trunc(p) THEN to_char(trunc(p), 'FM999,999,999,990')
              ELSE to_char(round(p, 2), 'FM999,999,999,990.00') END $$;

-- 4.84M for big sums, the whole number below a million.
CREATE OR REPLACE FUNCTION tg_big(p numeric) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL THEN '—'
              WHEN abs(p) >= 1000000 THEN rtrim(rtrim(to_char(round(p / 1000000, 2), 'FM999,990.00'), '0'), '.') || 'M'
              ELSE tg_num(round(p)) END $$;

-- 4 · 2.5 · 0.25 — a quantity without trailing zeros.
CREATE OR REPLACE FUNCTION tg_qty(p numeric) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p IS NULL THEN '—'
              WHEN p = trunc(p) THEN to_char(p, 'FM999,999,990')
              ELSE rtrim(rtrim(to_char(p, 'FM999,999,990.999'), '0'), '.') END $$;

-- 12 Sep — the day a timestamp fell on in Addis.
CREATE OR REPLACE FUNCTION tg_on(p timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(p AT TIME ZONE 'Africa/Addis_Ababa', 'DD Mon') $$;

-- Sat 10 Oct, like bot_day, but NULL for no date.
CREATE OR REPLACE FUNCTION tg_day(p date) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(p, 'Dy DD Mon') $$;

-- The message's first line: the notification's title, as before.
CREATE OR REPLACE FUNCTION tg_head(n notifications) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n.priority = 'high' THEN '❗' ELSE '' END
    || CASE split_part(n.kind, '.', 1)
         WHEN 'expense' THEN '💳' WHEN 'request' THEN '📦' WHEN 'po' THEN '📦' WHEN 'delivery' THEN '🚚'
         WHEN 'labour' THEN '👷' WHEN 'tax' THEN '🧾' WHEN 'trip' THEN '🚚' ELSE '🔔' END
    || ' <b>' || COALESCE(tg_e(n.title), '') || '</b>' $$;

-- The head lines, a blank line, then the details — cut at a line break if
-- it would run past what Telegram takes in one message.
CREATE OR REPLACE FUNCTION tg_join(p_head text[], p_body text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(t) <= 3800 THEN t
              ELSE left(t, 3800 - position(E'\n' IN reverse(left(t, 3800)))) || E'\n…' END
  FROM (SELECT array_to_string(p_head, E'\n') || COALESCE(E'\n\n' || NULLIF(array_to_string(p_body, E'\n'), ''), '') AS t) x $$;

-- The last price paid for an item, leaving out the given order lines (the
-- order being looked at). Stock items match by item, others by their name.
CREATE OR REPLACE FUNCTION tg_last_price(p_stock uuid, p_name text, p_unit text, p_skip uuid[])
RETURNS TABLE (unit_price numeric, sourced_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT m.unit_price, m.sourced_at FROM market_prices m
  WHERE CASE WHEN p_stock IS NOT NULL THEN m.stock_item_id = p_stock
             ELSE m.stock_item_id IS NULL
              AND m.description_key = lower(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g')) END
    AND (m.source_order_item_id IS NULL OR NOT (m.source_order_item_id = ANY (COALESCE(p_skip, '{}'::uuid[]))))
    AND NOT COALESCE(m.excluded_from_trends, false)
    AND m.unit_price > 0
    AND (p_unit IS NULL OR m.unit IS NULL OR lower(btrim(m.unit)) = lower(btrim(p_unit)))
  ORDER BY m.sourced_at DESC NULLS LAST
  LIMIT 1 $$;

-- " · ▲ 13% vs 30 (12 Sep)" — a price next to the last one paid.
CREATE OR REPLACE FUNCTION tg_vs_last(p_price numeric, p_last numeric, p_at timestamptz) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_price IS NULL OR p_last IS NULL OR p_last <= 0 THEN ''
              WHEN abs(p_price - p_last) / p_last < 0.03 THEN ' · same as last time'
              ELSE ' · ' || CASE WHEN p_price > p_last THEN '▲ ' ELSE '▼ ' END
                   || round(abs(p_price - p_last) / p_last * 100) || '% vs ' || tg_num(p_last)
                   || COALESCE(' (' || tg_on(p_at) || ')', '') END $$;

-- What a project has spent and committed so far, and its budget if it has one.
CREATE OR REPLACE FUNCTION tg_project_line(p_project uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT '🏗 ' || tg_e(p.project_name) || ' so far: '
    || CASE WHEN s.total_actual_with_labor >= 1 THEN '<b>' || tg_big(s.total_actual_with_labor) || ' birr</b> spent' ELSE 'nothing spent yet' END
    || CASE WHEN s.total_committed_with_labor >= 1 THEN ' · ' || tg_big(s.total_committed_with_labor) || ' committed' ELSE '' END
    || CASE WHEN s.total_budget > 0
            THEN E'\n   Budget ' || tg_big(s.total_budget) || ' · '
                 || round(100 * (s.total_actual_with_labor + s.total_committed_with_labor) / s.total_budget) || '% used'
                 || CASE WHEN s.total_actual_with_labor + s.total_committed_with_labor > s.total_budget THEN ' ⚠️' ELSE '' END
            ELSE '' END
    || CASE WHEN COALESCE(p.contract_value, 0) > 0
            THEN CASE WHEN s.total_budget > 0 THEN ' · ' ELSE E'\n   ' END || 'Contract ' || tg_big(p.contract_value)
            ELSE '' END
  FROM projects p JOIN v_project_budget_summary s ON s.project_id = p.id
  WHERE p.id = p_project AND NOT COALESCE(p.is_internal, false) $$;

-- " · Supplier with VAT · verified ✓" — what we know about a vendor.
CREATE OR REPLACE FUNCTION tg_vendor_facts(v vendors) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(' · ' || tg_e(v.vendor_type), '')
    || CASE WHEN v.verification_status = 'verified' THEN ' · verified ✓' ELSE ' · not verified yet' END
    || CASE WHEN v.vendor_type ILIKE '%VAT%' AND NULLIF(btrim(v.tin), '') IS NULL THEN ' · no TIN on file ⚠️' ELSE '' END $$;

-- ── 2. Pieces a message is built from ───────────────────────────────────
-- A purchase order's lines. p_mode: 'compare' adds how each price compares
-- with the last one paid, 'received' what has come in, 'plain' neither.
CREATE OR REPLACE FUNCTION tg_po_lines(p_bundle uuid, p_mode text, p_max integer) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
  v text[] := '{}';
  v_n integer := 0;
  v_skip uuid[];
  v_last numeric;
  v_at timestamptz;
BEGIN
  SELECT array_agg(order_item_id) INTO v_skip FROM sourcing_bundle_items WHERE bundle_id = p_bundle;
  FOR r IN
    SELECT oi.item_name, oi.unit, oi.stock_item_id, bi.quantity_actual AS qty, bi.unit_price_actual AS price,
           l.received, l.damaged, l.rejected, l.outstanding
    FROM sourcing_bundle_items bi
    JOIN order_items oi ON oi.id = bi.order_item_id
    LEFT JOIN v_bundle_line_receipts l ON p_mode = 'received' AND l.bundle_id = p_bundle AND l.bundle_item_id = bi.id
    WHERE bi.bundle_id = p_bundle
    ORDER BY bi.sort_order, bi.created_at
  LOOP
    v_n := v_n + 1;
    CONTINUE WHEN v_n > p_max;
    v_last := NULL; v_at := NULL;
    IF p_mode = 'compare' THEN
      SELECT x.unit_price, x.sourced_at INTO v_last, v_at FROM tg_last_price(r.stock_item_id, r.item_name, r.unit, v_skip) x;
    END IF;
    v := array_append(v, '• ' || COALESCE(tg_e(r.item_name), 'Item')
      || ' — ' || tg_qty(r.qty) || COALESCE(' ' || tg_e(r.unit), '')
      || CASE WHEN r.price IS NOT NULL THEN ' × ' || tg_num(r.price) || ' = ' || tg_num(r.qty * r.price) ELSE '' END
      || CASE WHEN p_mode = 'compare' THEN tg_vs_last(r.price, v_last, v_at)
              WHEN p_mode = 'received' THEN
                CASE WHEN COALESCE(r.received, 0) = 0 THEN ' · nothing in yet'
                     WHEN COALESCE(r.outstanding, 0) <= 0 THEN ' · all in ✓'
                     ELSE ' · ' || tg_qty(r.received) || ' in, ' || tg_qty(r.outstanding) || ' to come' END
                || CASE WHEN COALESCE(r.damaged, 0) > 0 THEN ' · ' || tg_qty(r.damaged) || ' damaged' ELSE '' END
                || CASE WHEN COALESCE(r.rejected, 0) > 0 THEN ' · ' || tg_qty(r.rejected) || ' sent back' ELSE '' END
              ELSE '' END);
  END LOOP;
  IF v_n > p_max THEN v := array_append(v, '…and ' || (v_n - p_max) || ' more'); END IF;
  RETURN v;
END $$;

-- "pays in 2 parts: 40% now, 60% on delivery" — how a purchase order is paid.
CREATE OR REPLACE FUNCTION tg_po_pay(b sourcing_bundles) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN jsonb_typeof(b.payment_plan) = 'array' AND jsonb_array_length(b.payment_plan) > 0 THEN
           'pays in ' || jsonb_array_length(b.payment_plan) || ' parts: '
           || (SELECT string_agg(tg_qty((x->>'pct')::numeric) || '% '
                 || CASE WHEN x->>'due_on' = 'delivery'
                         THEN CASE WHEN COALESCE((x->>'days')::integer, 0) > 0 THEN (x->>'days') || ' days after delivery' ELSE 'on delivery' END
                         ELSE 'now' END, ', ' ORDER BY i)
               FROM jsonb_array_elements(b.payment_plan) WITH ORDINALITY t(x, i))
         WHEN b.payment_pattern = 'pay_in_advance' THEN 'pays in advance'
         WHEN b.payment_pattern = 'pay_on_delivery' THEN 'pays on delivery'
       END $$;

-- A trip: where from and to, the vehicle, the driver and what was agreed.
CREATE OR REPLACE FUNCTION tg_trip_lines(tr transportation_requests, p_expense_amount numeric) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT array_remove(ARRAY[
    '🚚 <b>' || COALESCE(tg_e(tr.request_name), 'A trip') || '</b>'
      || COALESCE(' · ' || tg_day(COALESCE(tr.actual_delivery_date, tr.expected_delivery_date, tr.requested_date)), ''),
    NULLIF(concat_ws(' → ',
      COALESCE(tg_e(tr.pickup_location_text), tg_e((SELECT location_name FROM locations WHERE id = tr.pickup_location_id)), tg_e(tr.vendor_name)),
      COALESCE(tg_e(tr.dropoff_location_text), tg_e((SELECT location_name FROM locations WHERE id = tr.dropoff_location_id)),
               tg_e((SELECT project_name FROM projects WHERE id = tr.project_id)))), ''),
    NULLIF(concat_ws(' · ',
      CASE WHEN tr.transport_mode = 'own_fleet'
           THEN 'Our ' || COALESCE(tg_e((SELECT concat_ws(' ', name, plate_number) FROM vehicles WHERE id = tr.vehicle_id)), 'vehicle')
           ELSE tg_e(bot_vclass_label(COALESCE(tr.hired_vehicle_class, d.vehicle_class))) END,
      'driver ' || COALESCE(tg_e(d.full_name), tg_e(tr.driver_name)) || COALESCE(' ' || tg_e(d.phone), ''),
      CASE WHEN tr.amount IS NOT NULL THEN 'agreed ' || tg_num(tr.amount)
        || CASE WHEN p_expense_amount IS NOT NULL AND tr.amount <> p_expense_amount THEN ' — not what this expense says ⚠️' ELSE '' END END), ''),
    CASE WHEN tr.transport_mode <> 'own_fleet' AND d.payout_method IS NOT NULL
         THEN '💳 The driver gets paid by '
              || CASE WHEN d.payout_method = 'bank' AND NULLIF(btrim(d.bank_name), '') IS NULL THEN 'bank account ' ELSE '' END
              || tg_e(trip_payout_label(d.payout_method, d.bank_name, d.account_number, d.account_name)) END
  ], NULL)
  FROM (SELECT 1) one LEFT JOIN transport_drivers d ON d.id = tr.hired_driver_id $$;

-- Other expenses an expense may be a duplicate of: same payee and amount
-- within 3 days, as expense_issues() checks.
CREATE OR REPLACE FUNCTION tg_expense_twins(e expenses) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT string_agg(tg_e(o.expense_code) || ' (' || COALESCE(tg_day(o.date) || ', ', '')
           || CASE WHEN o.payment_state = 'paid' THEN 'paid'
                   WHEN o.approval_status = 'finance_approved' THEN 'approved'
                   WHEN o.approval_status = 'rejected' THEN 'rejected'
                   ELSE 'waiting' END || ')', ', ')
  FROM (SELECT o.* FROM expenses o
         WHERE o.id <> e.id AND NOT COALESCE(o.is_archived, false)
           AND o.amount_etb = e.amount_etb AND abs(o.date - e.date) <= 3
           AND o.split_parent_id IS DISTINCT FROM e.id AND e.split_parent_id IS DISTINCT FROM o.id
           AND (   (e.vendor_id IS NOT NULL AND o.vendor_id = e.vendor_id)
                OR (e.paid_to_staff_id IS NOT NULL AND o.paid_to_staff_id = e.paid_to_staff_id)
                OR (e.vendor_id IS NULL AND btrim(COALESCE(e.vendors_name, '')) <> ''
                    AND lower(btrim(o.vendors_name)) = lower(btrim(e.vendors_name))))
         ORDER BY abs(o.date - e.date), o.created_at
         LIMIT 2) o $$;

-- Who else is working on a site, and what its labour has come to.
CREATE OR REPLACE FUNCTION tg_site_labour(p_project uuid, p_skip uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NULLIF(concat_ws(' · ',
      CASE WHEN a.n > 0 THEN 'On this site now: ' || a.n || CASE WHEN a.n = 1 THEN ' worker' ELSE ' workers' END
                             || ' on ' || a.reqs || CASE WHEN a.reqs = 1 THEN ' request' ELSE ' requests' END END,
      CASE WHEN x.total > 0 THEN 'labour so far ' || tg_big(x.total) || ' birr' END), '')
  FROM (SELECT count(DISTINCT la.staff_id) AS n, count(DISTINCT la.labor_requisition_id) AS reqs
          FROM labor_allocations la
         WHERE la.project_id = p_project AND la.status = 'active' AND la.labor_requisition_id IS DISTINCT FROM p_skip) a,
       (SELECT sum(e.amount_etb) AS total FROM expenses e
         WHERE e.project_id = p_project AND e.expense_type = 'labor_payment'
           AND NOT COALESCE(e.is_archived, false) AND e.approval_status IS DISTINCT FROM 'rejected') x $$;

-- ── 3. The messages ─────────────────────────────────────────────────────
-- An expense: submitted, approved, rejected, paid… or pushed up the tax queue.
CREATE OR REPLACE FUNCTION tg_expense_text(n notifications) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e expenses;
  ps labour_pay_sheets;
  tr transportation_requests;
  b sourcing_bundles;
  vd vendors;
  r record;
  v text[] := '{}';
  v_body text[] := '{}';
  v_cat text;
  v_proj text;
  v_who text := notify_user_name(n.actor_id);
  v_role text;
  v_unit text;
  v_n integer := 0;
  v_issues text[];
  v_issue text;
  v_typed boolean := false;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = n.entity_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO ps FROM labour_pay_sheets WHERE expense_id = e.id ORDER BY confirmed_at DESC NULLS LAST LIMIT 1;
  v_cat := (SELECT category_name FROM categories WHERE id = e.category_id);
  v_proj := COALESCE((SELECT project_name FROM projects WHERE id = e.project_id), NULLIF(btrim(e.project_name), ''),
                     CASE WHEN e.is_overhead THEN 'Company overhead' END);

  v := array_append(v, tg_head(n));
  v := array_append(v, '<b>' || bot_birr(e.amount_etb) || '</b>' || COALESCE(' · ' || tg_e(v_cat), '') || COALESCE(' · ' || tg_e(v_proj), ''));
  v := array_append(v, COALESCE(tg_e(e.expense_code), 'Expense')
    || CASE WHEN ps.id IS NULL THEN COALESCE(' · ' || tg_line(e.item_service_description, 120), '') ELSE '' END);
  v := array_append(v, CASE n.kind
    WHEN 'expense.resubmitted' THEN '🔁 Sent again after it was rejected' || COALESCE(' — by ' || tg_e(v_who), '') || '.'
    WHEN 'expense.approved' THEN '✅ Approved' || COALESCE(' by ' || tg_e(COALESCE(notify_user_name(e.finance_approved_by), v_who)), '')
                                 || ' — payment is next.'
    WHEN 'expense.rejected' THEN '✖ Rejected' || COALESCE(' by ' || tg_e(v_who), '') || COALESCE(': ' || tg_line(e.rejection_reason, 300), '')
                                 || '. Fix it and send it again from the expense page.'
    WHEN 'expense.unapproved' THEN '↩️ Approval withdrawn' || COALESCE(' by ' || tg_e(v_who), '') || ' — it is waiting for approval again.'
    WHEN 'expense.sent' THEN '💸 Payment sent' || COALESCE(' by ' || tg_e(replace(e.payment_method, '_', ' ')), '') || ' — waiting for the bank to confirm.'
    WHEN 'expense.paid' THEN '✅ Paid' || COALESCE(' on ' || tg_day((e.paid_date AT TIME ZONE 'Africa/Addis_Ababa')::date), '')
                             || COALESCE(' by ' || tg_e(replace(e.payment_method, '_', ' ')), '') || '.'
    WHEN 'expense.advance' THEN '💸 The vendor was paid ahead — it closes when the goods arrive.'
    WHEN 'tax.escalated' THEN tg_line(n.body, 400)
  END);

  -- What it pays for.
  IF ps.id IS NOT NULL THEN
    SELECT btrim(role_needed), volume_unit INTO v_role, v_unit FROM labor_requisitions WHERE id = ps.labor_requisition_id;
    v_body := array_append(v_body, '👷 <b>Pay sheet ' || COALESCE(tg_e(ps.code), '') || '</b>' || COALESCE(' · ' || tg_e(v_role), ''));
    v_body := array_append(v_body, NULLIF(concat_ws(' · ',
      NULLIF(concat_ws(' – ', tg_day(ps.period_start), CASE WHEN ps.period_end IS DISTINCT FROM ps.period_start THEN tg_day(ps.period_end) END), ''),
      'confirmed by ' || tg_e(ps.confirmed_by_name)), ''));
    FOR r IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ps.lines) = 'array' THEN ps.lines ELSE '[]'::jsonb END) x LOOP
      v_n := v_n + 1;
      CONTINUE WHEN v_n > 12;
      v_body := array_append(v_body, '• ' || COALESCE(tg_e(r.x->>'worker_name'), 'Someone') || ' — '
        || CASE WHEN r.x->>'quantity' IS NOT NULL
                  THEN tg_qty((r.x->>'quantity')::numeric) || COALESCE(' ' || tg_e(v_unit), '') || ' × ' || tg_num((r.x->>'rate')::numeric)
                WHEN r.x->>'percent_done' IS NOT NULL
                  THEN tg_qty((r.x->>'percent_done')::numeric) || '% of ' || tg_num((r.x->>'rate')::numeric)
                ELSE tg_qty((r.x->>'days')::numeric) || CASE WHEN (r.x->>'days')::numeric = 1 THEN ' day' ELSE ' days' END
                     || ' × ' || tg_num((r.x->>'rate')::numeric) END
        || ' = ' || tg_num((r.x->>'amount')::numeric)
        || CASE WHEN COALESCE((r.x->>'overtime_amount')::numeric, 0) > 0
                THEN ' (incl. ' || tg_num((r.x->>'overtime_amount')::numeric) || ' overtime)' ELSE '' END);
    END LOOP;
    IF v_n > 12 THEN v_body := array_append(v_body, '…and ' || (v_n - 12) || ' more'); END IF;
    IF v_n > 1 THEN
      v_body := array_append(v_body, v_n || ' workers'
        || COALESCE(' · ' || tg_qty(NULLIF((SELECT sum((x->>'days')::numeric) FROM jsonb_array_elements(ps.lines) x
                                             WHERE jsonb_typeof(ps.lines) = 'array'), 0)) || ' days in all', ''));
    END IF;
  ELSIF EXISTS (SELECT 1 FROM labor_expense_workers WHERE expense_id = e.id) THEN
    v_body := array_append(v_body, '👷 <b>Workers</b>');
    FOR r IN SELECT w.gang_size, w.days_worked, w.day_rate, w.subtotal, s.employee_name
               FROM labor_expense_workers w LEFT JOIN staff s ON s.id = w.staff_id
              WHERE w.expense_id = e.id ORDER BY w.subtotal DESC NULLS LAST LOOP
      v_n := v_n + 1;
      CONTINUE WHEN v_n > 12;
      v_body := array_append(v_body, '• ' || COALESCE(tg_e(r.employee_name), 'Someone')
        || CASE WHEN COALESCE(r.gang_size, 1) > 1 THEN ' (gang of ' || r.gang_size || ')' ELSE '' END
        || COALESCE(' — ' || tg_qty(r.days_worked) || CASE WHEN r.days_worked = 1 THEN ' day' ELSE ' days' END
                    || COALESCE(' × ' || tg_num(r.day_rate), ''), '')
        || COALESCE(' = ' || tg_num(r.subtotal), ''));
    END LOOP;
    IF v_n > 12 THEN v_body := array_append(v_body, '…and ' || (v_n - 12) || ' more'); END IF;
  END IF;

  IF e.sourcing_bundle_id IS NOT NULL THEN
    SELECT * INTO b FROM sourcing_bundles WHERE id = e.sourcing_bundle_id;
    IF FOUND THEN
      v_body := array_append(v_body, '📦 For <b>' || COALESCE(tg_e(b.bundle_code), 'a purchase order') || '</b>'
        || COALESCE(' · ' || tg_e(COALESCE((SELECT vendor_name FROM vendors WHERE id = b.vendor_id), b.vendor_name)), ''));
      v_body := v_body || tg_po_lines(b.id, 'plain', 6);
    END IF;
  END IF;

  SELECT * INTO tr FROM transportation_requests WHERE expense_id = e.id ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN v_body := v_body || tg_trip_lines(tr, e.amount_etb); END IF;

  IF e.vehicle_id IS NOT NULL OR COALESCE(e.fuel_liters, 0) > 0 THEN
    v_body := array_append(v_body, '⛽ ' || NULLIF(concat_ws(' · ',
      tg_e((SELECT concat_ws(' ', name, plate_number) FROM vehicles WHERE id = e.vehicle_id)),
      CASE WHEN e.fuel_liters > 0 THEN tg_qty(e.fuel_liters) || ' L'
                || CASE WHEN e.amount_etb > 0 THEN ' at ' || tg_num(e.amount_etb / e.fuel_liters) || ' a litre' ELSE '' END END,
      CASE WHEN e.odometer_km > 0 THEN 'odometer ' || tg_num(e.odometer_km) || ' km' END), ''));
  END IF;

  -- Who gets paid, and how much really goes out.
  IF e.vendor_id IS NOT NULL THEN
    SELECT * INTO vd FROM vendors WHERE id = e.vendor_id;
    IF FOUND THEN
      v_body := array_append(v_body, '🏪 Paid to <b>' || COALESCE(tg_e(vd.vendor_name), 'a vendor') || '</b>' || tg_vendor_facts(vd)
        || E'\n   ' || (
          SELECT CASE WHEN count(*) = 0 THEN 'First payment to them'
                      ELSE count(*) || CASE WHEN count(*) = 1 THEN ' other payment' ELSE ' other payments' END
                           || ' to them in 12 months · ' || tg_big(sum(x.amount_etb)) || ' birr' END
          FROM expenses x
          WHERE x.vendor_id = vd.id AND x.id <> e.id AND NOT COALESCE(x.is_archived, false)
            AND x.approval_status IS DISTINCT FROM 'rejected' AND x.date > current_date - 365));
    END IF;
  ELSIF e.paid_to_staff_id IS NOT NULL THEN
    v_body := array_append(v_body, '👤 Paid to <b>'
      || COALESCE(tg_e((SELECT employee_name FROM staff WHERE id = e.paid_to_staff_id)), 'a staff member') || '</b> (staff)');
  ELSIF ps.id IS NULL AND tg_e(e.vendors_name) IS NOT NULL THEN
    v_body := array_append(v_body, '🏪 Paid to <b>' || tg_e(e.vendors_name) || '</b> — typed in, not a saved vendor');
    v_typed := true;
  END IF;

  IF COALESCE(e.receipt_vat_amount, 0) > 0 OR COALESCE(e.wht_amount, 0) > 0 OR e.in_parts
     OR (e.net_payable IS NOT NULL AND e.net_payable <> e.amount_etb) THEN
    v_body := array_append(v_body, '💰 ' || concat_ws(' · ',
      CASE WHEN COALESCE(e.receipt_vat_amount, 0) > 0
           THEN 'VAT ' || tg_num(e.receipt_vat_amount) || CASE WHEN e.vat_included THEN ' (included)' ELSE '' END END,
      CASE WHEN COALESCE(e.wht_amount, 0) > 0 THEN 'WHT −' || tg_num(e.wht_amount) END,
      CASE WHEN e.net_payable IS NOT NULL AND e.net_payable <> e.amount_etb THEN 'pays <b>' || tg_num(e.net_payable) || '</b>' END,
      CASE WHEN e.in_parts THEN 'in parts · ' || tg_num(COALESCE(e.paid_to_date_etb, 0)) || ' paid so far' END));
  END IF;

  IF ps.id IS NULL AND e.expense_type IS DISTINCT FROM 'labor_payment' THEN
    v_body := array_append(v_body, '🧾 ' || CASE
      WHEN e.receipt_is_vat THEN 'VAT receipt' || COALESCE(' #' || tg_e(e.receipt_no), '')
                                 || CASE WHEN e.receipt_url IS NOT NULL THEN ' · photo ✓' ELSE ' · no photo yet' END
      WHEN e.receipt_url IS NOT NULL
        OR EXISTS (SELECT 1 FROM vendor_receipts vr WHERE vr.expense_id = e.id AND vr.document_url IS NOT NULL)
        THEN 'Receipt photo ✓' || COALESCE(' · #' || tg_e(e.receipt_no), '')
      WHEN e.receipt_available = 'No' THEN 'No receipt — said so when it was entered'
      ELSE 'No receipt yet' END);
  END IF;

  -- What the app flags on it, in the order the expense page shows them.
  v_issues := expense_issues(e);
  FOREACH v_issue IN ARRAY ARRAY['no_project', 'no_ledger', 'no_payee', 'possible_duplicate', 'typed_payee',
                                 'no_receipt', 'no_bank_ref', 'vague_ledger'] LOOP
    CONTINUE WHEN NOT (v_issue = ANY (v_issues)) OR (v_issue = 'typed_payee' AND v_typed);
    v_body := array_append(v_body, CASE v_issue
      WHEN 'no_project' THEN '⚠️ No project — pick the project, or mark it company overhead.'
      WHEN 'no_ledger' THEN '⚠️ No ledger to post it to.'
      WHEN 'no_payee' THEN '⚠️ Nobody is named as paid.'
      WHEN 'possible_duplicate' THEN '⚠️ Possible duplicate of ' || COALESCE(tg_expense_twins(e), 'another expense') || '.'
      WHEN 'typed_payee' THEN 'ℹ️ The payee is typed in — link the vendor so it counts on their statement.'
      WHEN 'no_receipt' THEN '⚠️ Paid with no receipt photo — its VAT can''t be claimed.'
      WHEN 'no_bank_ref' THEN '⚠️ Paid by transfer with no bank reference.'
      WHEN 'vague_ledger' THEN 'ℹ️ Filed under Multiple or Petty — one ledger would say what it was.'
    END);
  END LOOP;

  IF n.kind IN ('expense.submitted', 'expense.resubmitted') AND e.project_id IS NOT NULL THEN
    v_body := array_append(v_body, tg_project_line(e.project_id));
  END IF;
  v_body := array_append(v_body, '📅 ' || COALESCE(tg_day(e.date), 'No date')
    || COALESCE(' · from ' || COALESCE(tg_e(notify_user_name(e.purchaser_user_id)),
                                       tg_e((SELECT employee_name FROM staff WHERE id = e.staff_id))), ''));
  RETURN tg_join(v, v_body);
END $$;

-- A purchase order: to approve, approved, sent back, ordered, cancelled, delivered.
CREATE OR REPLACE FUNCTION tg_po_text(n notifications) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  b sourcing_bundles;
  vd vendors;
  g goods_received_notes;
  r record;
  v text[] := '{}';
  v_body text[] := '{}';
  v_vendor text;
  v_total numeric;
  v_who text := notify_user_name(n.actor_id);
BEGIN
  SELECT * INTO b FROM sourcing_bundles WHERE id = n.entity_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO vd FROM vendors WHERE id = b.vendor_id;
  v_vendor := COALESCE(vd.vendor_name, b.vendor_name);
  v_total := COALESCE(b.total_value, b.items_subtotal_etb);

  v := array_append(v, tg_head(n));
  v := array_append(v, NULLIF(concat_ws(' · ', CASE WHEN v_total > 0 THEN '<b>' || bot_birr(v_total) || '</b>' END,
                                         tg_e(v_vendor), tg_po_pay(b)), ''));
  v := array_append(v, COALESCE(tg_e(b.bundle_code), 'Purchase order')
    || COALESCE(' · from ' || tg_e(notify_user_name(b.procurement_officer_id)), ''));
  v := array_append(v, CASE n.kind
    WHEN 'po.approved' THEN '✅ Approved' || COALESCE(' by ' || tg_e(COALESCE(notify_user_name(b.approved_by), v_who)), '')
                            || ' — you can place the order.'
    WHEN 'po.returned' THEN '↩️ Sent back to drafting' || COALESCE(' by ' || tg_e(v_who), '') || COALESCE(': ' || tg_line(b.finance_notes, 300), '') || '.'
    WHEN 'po.ordered' THEN '🛒 Ordered' || COALESCE(' — expected ' || tg_day(b.expected_delivery_date), '') || '.'
    WHEN 'po.cancelled' THEN '✖ Cancelled' || COALESCE(' by ' || tg_e(v_who), '')
                             || '. The requested items go back to waiting for a new order.'
  END);
  IF n.kind = 'delivery.received' AND n.dedupe_key ~ '^delivery\.received:[0-9a-f-]{36}$' THEN
    SELECT * INTO g FROM goods_received_notes WHERE id = split_part(n.dedupe_key, ':', 2)::uuid;
    IF FOUND THEN
      v := array_append(v, '📥 Received' || COALESCE(' by ' || tg_e(notify_user_name(g.received_by)), '')
        || COALESCE(' on ' || tg_day((g.received_at AT TIME ZONE 'Africa/Addis_Ababa')::date), '')
        || COALESCE(' · ' || tg_e(g.grn_code), '')
        || COALESCE(' · delivery note ' || tg_e(g.delivery_note_ref), '')
        || CASE WHEN jsonb_typeof(g.photos) = 'array' AND jsonb_array_length(g.photos) > 0
                THEN ' · ' || jsonb_array_length(g.photos) || CASE WHEN jsonb_array_length(g.photos) = 1 THEN ' photo' ELSE ' photos' END
                WHEN g.photo_url IS NOT NULL THEN ' · photo' ELSE '' END);
      v := array_append(v, '🚚 ' || NULLIF(concat_ws(' · ', 'Driver ' || tg_e(g.driver_name), tg_e(g.vehicle_plate)), ''));
    END IF;
  END IF;

  v_body := v_body || tg_po_lines(b.id, CASE WHEN n.kind = 'po.submitted' THEN 'compare'
                                             WHEN n.kind = 'delivery.received' THEN 'received' ELSE 'plain' END, 10);
  IF COALESCE(b.discount_etb, 0) > 0 OR COALESCE(b.rejection_deduction_etb, 0) > 0 THEN
    v_body := array_append(v_body, 'Items ' || tg_num(b.items_subtotal_etb)
      || CASE WHEN COALESCE(b.discount_etb, 0) > 0 THEN ' · discount −' || tg_num(b.discount_etb) || COALESCE(' (' || tg_line(b.discount_reason, 80) || ')', '') ELSE '' END
      || CASE WHEN COALESCE(b.rejection_deduction_etb, 0) > 0 THEN ' · −' || tg_num(b.rejection_deduction_etb) || ' for items sent back' ELSE '' END
      || ' · <b>total ' || tg_num(v_total) || '</b>');
  END IF;
  IF b.expected_delivery_date IS NOT NULL AND n.kind NOT IN ('po.ordered', 'po.cancelled') AND b.status NOT IN ('fulfilled', 'cancelled') THEN
    v_body := array_append(v_body, '📅 Expected ' || tg_day(b.expected_delivery_date)
      || CASE WHEN b.status = 'ordered' AND b.expected_delivery_date < bot_today()
              THEN ' — ' || (bot_today() - b.expected_delivery_date) || CASE WHEN bot_today() - b.expected_delivery_date = 1 THEN ' day' ELSE ' days' END || ' late ⚠️'
              ELSE '' END);
  END IF;
  IF tg_line(b.notes, 300) IS NOT NULL THEN v_body := array_append(v_body, '📝 ' || tg_line(b.notes, 300)); END IF;

  IF vd.id IS NOT NULL THEN
    v_body := array_append(v_body, '🏪 <b>' || COALESCE(tg_e(vd.vendor_name), 'Vendor') || '</b>' || tg_vendor_facts(vd)
      || CASE WHEN n.kind = 'po.submitted' THEN E'\n   ' || (
           SELECT CASE WHEN count(*) = 0 THEN 'First order with them'
                       ELSE count(*) || CASE WHEN count(*) = 1 THEN ' other order' ELSE ' other orders' END
                            || ' with them in 12 months · ' || tg_big(sum(COALESCE(o.total_value, o.items_subtotal_etb))) || ' birr' END
           FROM sourcing_bundles o
           WHERE o.vendor_id = vd.id AND o.id <> b.id AND o.status IN ('approved', 'ordered', 'fulfilled')
             AND o.created_at > now() - interval '12 months')
         ELSE '' END);
  ELSIF n.kind = 'po.submitted' THEN
    v_body := array_append(v_body, '⚠️ No vendor from the vendor list on it yet.');
  END IF;

  FOR r IN
    SELECT p.project_name, string_agg(DISTINCT o.request_code
             || COALESCE(' (' || COALESCE(notify_user_name(o.requested_by_user_id), s.employee_name) || ')', ''), ', ') AS prs
    FROM sourcing_bundle_items bi
    JOIN order_items oi ON oi.id = bi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN projects p ON p.id = o.project_id
    LEFT JOIN staff s ON s.id = o.staff_id
    WHERE bi.bundle_id = b.id
    GROUP BY p.project_name ORDER BY p.project_name LIMIT 4
  LOOP
    v_body := array_append(v_body, '📋 For <b>' || COALESCE(tg_e(r.project_name), 'no project') || '</b> — ' || COALESCE(tg_e(r.prs), 'a request'));
  END LOOP;
  IF n.kind = 'po.submitted' THEN
    FOR r IN
      SELECT DISTINCT o.project_id FROM sourcing_bundle_items bi
      JOIN order_items oi ON oi.id = bi.order_item_id JOIN orders o ON o.id = oi.order_id
      WHERE bi.bundle_id = b.id AND o.project_id IS NOT NULL LIMIT 2
    LOOP
      v_body := array_append(v_body, tg_project_line(r.project_id));
    END LOOP;
  END IF;
  RETURN tg_join(v, v_body);
END $$;

-- A purchase request: new, or rejected.
CREATE OR REPLACE FUNCTION tg_request_text(n notifications) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  o orders;
  r record;
  v text[] := '{}';
  v_body text[] := '{}';
  v_n integer := 0;
  v_priced integer := 0;
  v_est numeric := 0;
  v_last numeric;
  v_at timestamptz;
  v_on numeric;
  v_vendor text;
BEGIN
  SELECT * INTO o FROM orders WHERE id = n.entity_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v := array_append(v, tg_head(n));
  v := array_append(v, '<b>' || COALESCE(tg_e(o.order_name), tg_line(o.item_service_description, 80), 'Purchase request') || '</b>'
    || CASE o.priority WHEN 'urgent' THEN ' · 🔴 urgent' WHEN 'high' THEN ' · 🟠 high priority' ELSE '' END);
  v := array_append(v, COALESCE(tg_e(o.request_code), 'Request')
    || COALESCE(' · ' || tg_e((SELECT project_name FROM projects WHERE id = o.project_id)), '')
    || COALESCE(' · needed by ' || tg_day(o.required_by_date)
         || CASE WHEN o.required_by_date < bot_today()
                 THEN ' (' || (bot_today() - o.required_by_date) || CASE WHEN bot_today() - o.required_by_date = 1 THEN ' day' ELSE ' days' END || ' ago)'
                 WHEN o.required_by_date = bot_today() THEN ' (today)'
                 WHEN o.required_by_date = bot_today() + 1 THEN ' (tomorrow)'
                 ELSE ' (in ' || (o.required_by_date - bot_today()) || ' days)' END, ''));
  IF n.kind = 'request.rejected' THEN
    v := array_append(v, '✖ Rejected' || COALESCE(': ' || tg_line(o.rejection_reason, 300), '') || '.');
  END IF;

  FOR r IN SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.sort_order, oi.created_at LOOP
    v_n := v_n + 1;
    v_last := NULL; v_at := NULL; v_on := NULL;
    IF r.stock_item_id IS NOT NULL THEN
      SELECT qty_on_hand INTO v_on FROM v_stock_on_hand WHERE stock_item_id = r.stock_item_id;
    END IF;
    IF r.unit_price_est IS NULL THEN
      SELECT x.unit_price, x.sourced_at INTO v_last, v_at FROM tg_last_price(r.stock_item_id, r.item_name, r.unit, '{}') x;
    END IF;
    IF COALESCE(r.unit_price_est, v_last) IS NOT NULL AND r.quantity IS NOT NULL THEN
      v_est := v_est + COALESCE(r.unit_price_est, v_last) * r.quantity;
      v_priced := v_priced + 1;
    END IF;
    CONTINUE WHEN v_n > 10;
    v_body := array_append(v_body, '• ' || COALESCE(tg_e(r.item_name), 'Item')
      || COALESCE(' (' || tg_line(r.specifications, 40) || ')', '')
      || ' — ' || tg_qty(r.quantity) || COALESCE(' ' || tg_e(r.unit), '')
      || CASE WHEN r.stock_item_id IS NULL THEN ''
              WHEN COALESCE(v_on, 0) > 0 THEN ' · ' || tg_qty(v_on) || ' in the store' || CASE WHEN v_on >= r.quantity THEN ' ✓' ELSE '' END
              ELSE ' · none in the store' END
      || CASE WHEN r.unit_price_est IS NOT NULL THEN ' · est. ' || tg_num(r.unit_price_est)
              WHEN v_last IS NOT NULL THEN ' · last paid ' || tg_num(v_last) || COALESCE(' (' || tg_on(v_at) || ')', '')
              ELSE '' END);
  END LOOP;
  IF v_n > 10 THEN v_body := array_append(v_body, '…and ' || (v_n - 10) || ' more'); END IF;
  IF v_n = 0 AND (tg_line(o.item_service_description, 120) IS NOT NULL OR o.quantity IS NOT NULL) THEN
    v_body := array_append(v_body, '• ' || COALESCE(tg_line(o.item_service_description, 120), 'Item')
      || COALESCE(' — ' || tg_qty(o.quantity) || COALESCE(' ' || tg_e(o.unit), ''), ''));
  END IF;
  IF v_priced > 0 THEN
    v_body := array_append(v_body, '💰 About <b>' || bot_birr(round(v_est)) || '</b> at the last prices'
      || CASE WHEN v_priced < v_n THEN ' (' || v_priced || ' of ' || v_n || ' items priced)' ELSE '' END);
  END IF;
  IF tg_line(o.notes, 300) IS NOT NULL THEN v_body := array_append(v_body, '📝 ' || tg_line(o.notes, 300)); END IF;
  v_vendor := COALESCE((SELECT vendor_name FROM vendors WHERE id = o.recommended_vendor_id), NULLIF(btrim(o.vendor_recommendation), ''));
  IF v_vendor IS NOT NULL THEN v_body := array_append(v_body, '🏪 Suggested vendor: ' || tg_e(v_vendor)); END IF;
  v_body := array_append(v_body, '🙋 Asked by ' || COALESCE(tg_e(notify_user_name(o.requested_by_user_id)),
                                                          tg_e((SELECT employee_name FROM staff WHERE id = o.staff_id)), 'someone')
    || COALESCE(' · ' || tg_day(o.order_date), ''));
  RETURN tg_join(v, v_body);
END $$;

-- The labour approval card: now with the dates, scope, where, any notes, and
-- who is already working on the site.
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
         ELSE COALESCE(' · ' || bot_birr(r.unit_rate) || ' per ' || bot_esc(r.volume_unit), '')
              || CASE WHEN r.estimated_total_volume > 0 AND r.unit_rate IS NOT NULL
                      THEN ' × ' || tg_qty(r.estimated_total_volume) || ' = <b>' || bot_birr(r.estimated_total_volume * r.unit_rate) || '</b>' ELSE '' END END
    || E'\nStarts ' || bot_day(r.start_date)
    || CASE WHEN r.end_date IS NOT NULL AND r.end_date IS DISTINCT FROM r.start_date THEN ' · until ' || bot_day(r.end_date) ELSE '' END
    || COALESCE(E'\n🧰 ' || tg_line(r.scope_of_work, 200), '')
    || COALESCE(E'\n📍 ' || tg_line(r.site_location, 120), '')
    || COALESCE(E'\n📝 ' || tg_line(r.notes, 200), '')
    || COALESCE(E'\n👤 For ' || tg_e((SELECT employee_name FROM staff WHERE id = r.specific_staff_id)), '')
    || COALESCE(E'\n👷 Gang leader: ' || tg_e((SELECT vendor_name FROM vendors WHERE id = r.gang_leader_vendor_id)), '')
    || COALESCE(E'\n👥 ' || tg_site_labour(r.project_id, r.id), '')
    || E'\nAsked by ' || bot_esc(COALESCE(
         (SELECT full_name FROM user_profiles WHERE id = r.requested_by),
         (SELECT employee_name FROM staff WHERE id = r.requested_by_staff_id), 'someone'))
    || CASE WHEN r.created_via = 'telegram' THEN ' (in Telegram)' ELSE '' END
  FROM projects p WHERE p.id = r.project_id $$;

-- A labour request for someone without the approval card, or its decision.
CREATE OR REPLACE FUNCTION tg_labour_text(n notifications) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r labor_requisitions;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = n.entity_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN tg_join(ARRAY[tg_head(n),
    CASE WHEN n.kind = 'labour.decided' AND r.status = 'approved'
           THEN '✅ Approved' || COALESCE(' by ' || tg_e(notify_user_name(r.approved_by)), '') || ' — add the workers who are coming.'
         WHEN n.kind = 'labour.decided' AND r.status = 'rejected'
           THEN '✖ Not approved' || COALESCE(': ' || tg_line(r.decision_note, 300), '') || '.' END],
    -- The card without its title and project line: the notification's title says both.
    ARRAY[regexp_replace(bot_labour_card_text(r), '^[^\n]*\n[^\n]*\n', '')]);
END $$;

-- ── 4. Which message for which notification ─────────────────────────────
-- NULL when there is nothing to add, or if building it fails: the short
-- version still goes out.
CREATE OR REPLACE FUNCTION notify_tg_text(p_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n notifications;
BEGIN
  SELECT * INTO n FROM notifications WHERE id = p_id;
  IF NOT FOUND OR n.entity_id IS NULL THEN RETURN NULL; END IF;
  RETURN CASE
    WHEN n.entity_type = 'expense' OR (n.entity_type = 'tax_item' AND EXISTS (SELECT 1 FROM expenses WHERE id = n.entity_id))
      THEN tg_expense_text(n)
    WHEN n.entity_type = 'purchase_order' THEN tg_po_text(n)
    WHEN n.entity_type = 'purchase_request' THEN tg_request_text(n)
    WHEN n.entity_type = 'labor_requisition' THEN tg_labour_text(n)
  END;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_tg_text(%): %', p_id, SQLERRM;
  RETURN NULL;
END $$;

-- What is waiting for Telegram, each with its full message. Built once for
-- notifications that say the same thing to several people, and at most 30 a
-- minute — the next minute takes the rest.
CREATE OR REPLACE FUNCTION notify_service_telegram_outbox(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  RETURN COALESCE((
    WITH q AS (
      SELECT * FROM notify_telegram_pending_q() LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 30)
    ), one AS (
      SELECT DISTINCT ON (kind, title, body, link, priority) id, kind, title, body, link, priority
      FROM q ORDER BY kind, title, body, link, priority, created_at
    ), msg AS (
      SELECT kind, title, body, link, priority, notify_tg_text(id) AS text FROM one
    )
    SELECT jsonb_agg(to_jsonb(q) || jsonb_build_object('text', msg.text) ORDER BY q.created_at)
    FROM q LEFT JOIN msg ON msg.kind = q.kind AND msg.title = q.title AND msg.body IS NOT DISTINCT FROM q.body
                        AND msg.link IS NOT DISTINCT FROM q.link AND msg.priority IS NOT DISTINCT FROM q.priority
  ), '[]'::jsonb);
END $$;

-- ── 5. Rights ───────────────────────────────────────────────────────────
-- All of it runs for the edge function or inside the bot; none of it is for
-- the app's users to call.
DO $rights$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('tg_e', 'tg_line', 'tg_num', 'tg_big', 'tg_qty', 'tg_on', 'tg_day', 'tg_head', 'tg_join',
       'tg_last_price', 'tg_vs_last', 'tg_project_line', 'tg_vendor_facts', 'tg_po_lines', 'tg_po_pay', 'tg_trip_lines',
       'tg_expense_twins', 'tg_site_labour', 'tg_expense_text', 'tg_po_text', 'tg_request_text', 'tg_labour_text',
       'bot_labour_card_text', 'notify_tg_text', 'notify_service_telegram_outbox')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $rights$;
