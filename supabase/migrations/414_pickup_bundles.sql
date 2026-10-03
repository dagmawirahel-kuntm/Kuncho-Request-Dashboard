-- 414 — One trip for orders from the same area
--
-- When several vendors in the same area are being paid around the same
-- time, their goods can be collected on one trip. And when a pickup isn't
-- urgent, it can be worth waiting a day: orders from the busy market areas
-- come in clusters.
--
-- What the data showed (Oct 2026), purchase orders by the vendor's area:
--   Urael    27 of 37 had another Urael order within a day (31 within two)
--   Merkato  11 of 23 within a day (14 within two)
--   Piassa    5 of 18 within a day (11 within two)
-- yet each was mostly collected on its own trip. 91 orders have no area
-- yet (the vendor has no saved place) and can't be grouped until they do.
--
--   vendor_area(vendor)    the vendor's saved place, else where its goods
--                          have usually been collected
--   v_open_pickups         approved/ordered purchase orders of the last
--                          three weeks whose goods haven't been collected
--                          (no pickup on the road or done), with their area
--   v_pickup_bundles       areas with two or more of them: the orders, how
--                          many separate trips that would be, and roughly
--                          what one shared trip saves
--   pickup_area_advice()   for one order (or vendor): others to combine
--                          with, how often orders from the area cluster,
--                          and whether to book now, combine or wait a day

SET search_path TO public;

CREATE OR REPLACE FUNCTION vendor_area(p_vendor uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT COALESCE(
    (SELECT location_id FROM vendors WHERE id = p_vendor),
    (SELECT t.pickup_location_id FROM transportation_requests t
      WHERE t.vendor_id = p_vendor AND t.pickup_location_id IS NOT NULL AND t.job_status <> 'cancelled'
      GROUP BY t.pickup_location_id ORDER BY count(*) DESC LIMIT 1));
$fn$;
GRANT EXECUTE ON FUNCTION vendor_area(uuid) TO authenticated;

CREATE OR REPLACE VIEW v_open_pickups WITH (security_invoker = true) AS
SELECT sb.id AS bundle_id, sb.bundle_code, sb.vendor_id, COALESCE(v.vendor_name, sb.vendor_name) AS vendor_name,
       sb.status::text AS status, e.payment_state, sb.total_value, sb.expected_delivery_date,
       COALESCE(sb.ordered_at, sb.approved_at, sb.submitted_at, sb.created_at) AS since,
       a.area_id, l.location_name AS area_name, l.kind AS area_kind,
       -- Paid (or an advance sent) means the goods can be collected now.
       COALESCE(e.payment_state IN ('paid', 'sent', 'advance'), false) AS ready,
       j.id AS job_id, j.job_status, j.request_name AS job_name
  FROM sourcing_bundles sb
  LEFT JOIN vendors v ON v.id = sb.vendor_id
  LEFT JOIN expenses e ON e.id = sb.expense_id
  CROSS JOIN LATERAL (SELECT vendor_area(sb.vendor_id) AS area_id) a
  LEFT JOIN locations l ON l.id = a.area_id
  LEFT JOIN LATERAL (
    SELECT t.id, t.job_status, t.request_name FROM transportation_requests t
     WHERE t.sourcing_bundle_id = sb.id AND t.job_status <> 'cancelled'
     ORDER BY t.created_at DESC LIMIT 1) j ON true
 WHERE sb.status::text IN ('approved', 'ordered')
   AND COALESCE(j.job_status, 'requested') IN ('requested', 'assigned')
   AND COALESCE(sb.ordered_at, sb.approved_at, sb.submitted_at, sb.created_at) >= now() - interval '21 days';
GRANT SELECT ON v_open_pickups TO authenticated;

CREATE OR REPLACE VIEW v_pickup_bundles WITH (security_invoker = true) AS
WITH g AS (
  SELECT area_id, min(area_name) AS area_name, count(*) AS orders,
         count(DISTINCT COALESCE(job_id, bundle_id)) AS trips_if_separate,
         count(*) FILTER (WHERE ready) AS ready_now,
         count(*) FILTER (WHERE job_id IS NOT NULL) AS with_job,
         min(since) AS oldest, max(since) AS newest,
         jsonb_agg(jsonb_build_object(
           'bundle_id', bundle_id, 'bundle_code', bundle_code, 'vendor_name', vendor_name, 'status', status,
           'payment_state', payment_state, 'ready', ready, 'total_value', total_value, 'since', since,
           'job_id', job_id, 'job_status', job_status) ORDER BY ready DESC, since) AS items
    FROM v_open_pickups
   WHERE area_id IS NOT NULL
   GROUP BY area_id)
SELECT g.*,
       p.typical_price,
       round(GREATEST(g.trips_if_separate - 1, 0) * p.typical_price) AS saving
  FROM g
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY j.amount) FROM v_transport_jobs_clean j
        WHERE j.pickup_id = g.area_id AND j.transport_mode = 'hired' AND j.amount > 0 AND j.job_date >= current_date - 365),
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY j.amount) FROM v_transport_jobs_clean j
        WHERE j.job_type = 'purchase_pickup' AND j.transport_mode = 'hired' AND j.amount > 0 AND j.job_date >= current_date - 365)
    )::numeric AS typical_price) p
 WHERE g.orders >= 2;
GRANT SELECT ON v_pickup_bundles TO authenticated;

-- ── Advice for one order ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pickup_area_advice(p_bundle uuid DEFAULT NULL, p_vendor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE
  v_vendor uuid := p_vendor; v_area uuid; v_area_name text; v_others jsonb; v_n int;
  v_orders int; v_next1 int; v_next2 int; v_typical numeric; v_advice text; v_title text; v_detail text;
BEGIN
  IF p_bundle IS NOT NULL THEN SELECT vendor_id INTO v_vendor FROM sourcing_bundles WHERE id = p_bundle; END IF;
  v_area := vendor_area(v_vendor);
  IF v_area IS NULL THEN
    RETURN jsonb_build_object('advice', 'unknown', 'title', NULL,
      'detail', 'This vendor has no saved place yet, so other orders from the same area can''t be found. Set it on Locations → Tidy up places.');
  END IF;
  SELECT location_name INTO v_area_name FROM locations WHERE id = v_area;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('bundle_id', o.bundle_id, 'bundle_code', o.bundle_code, 'vendor_name', o.vendor_name,
           'status', o.status, 'payment_state', o.payment_state, 'ready', o.ready, 'job_id', o.job_id, 'job_status', o.job_status)
           ORDER BY o.ready DESC, o.since), '[]'::jsonb), count(*)
    INTO v_others, v_n
    FROM v_open_pickups o
   WHERE o.area_id = v_area AND o.bundle_id IS DISTINCT FROM p_bundle;

  -- How often an order from this area had another within one and two days.
  WITH po AS (
    SELECT sb.id, COALESCE(sb.ordered_at, sb.approved_at, sb.submitted_at, sb.created_at)::date AS d
      FROM sourcing_bundles sb
     WHERE sb.status::text NOT IN ('cancelled', 'drafting') AND vendor_area(sb.vendor_id) = v_area
       AND COALESCE(sb.ordered_at, sb.approved_at, sb.submitted_at, sb.created_at) >= now() - interval '12 months')
  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM po p2 WHERE p2.id <> po.id AND p2.d BETWEEN po.d AND po.d + 1)),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM po p2 WHERE p2.id <> po.id AND p2.d BETWEEN po.d AND po.d + 2))
    INTO v_orders, v_next1, v_next2
    FROM po;

  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY j.amount) INTO v_typical
    FROM v_transport_jobs_clean j
   WHERE j.pickup_id = v_area AND j.transport_mode = 'hired' AND j.amount > 0 AND j.job_date >= current_date - 365;

  IF v_n > 0 THEN
    v_advice := 'combine';
    v_title := v_n || ' other order' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' from ' || v_area_name || ' still to collect — one trip can take them all';
    v_detail := 'Collect them together instead of booking a trip each.' ||
      CASE WHEN v_typical IS NOT NULL THEN ' A hired trip from here usually costs about ' || to_char(round(v_typical), 'FM999,999') || '.' ELSE '' END;
  ELSIF v_orders >= 5 AND v_next1::numeric / v_orders >= 0.5 THEN
    v_advice := 'wait';
    v_title := 'Orders from ' || v_area_name || ' come in clusters — wait a day if this can';
    v_detail := v_next1 || ' of the last ' || v_orders || ' orders from here had another within a day. If the goods aren''t needed today, check with procurement before booking a trip of its own.';
  ELSIF v_orders >= 5 AND v_next2::numeric / v_orders >= 0.5 THEN
    v_advice := 'wait';
    v_title := 'Another order from ' || v_area_name || ' often follows within two days';
    v_detail := v_next2 || ' of the last ' || v_orders || ' orders from here had another within two days. If it isn''t urgent, ask procurement whether more is coming.';
  ELSE
    v_advice := 'go';
    v_title := NULL;
    v_detail := CASE WHEN v_orders > 0 THEN 'Orders from ' || v_area_name || ' rarely come together (' || v_next1 || ' of ' || v_orders || ' within a day) — book when ready.' END;
  END IF;

  RETURN jsonb_build_object('advice', v_advice, 'title', v_title, 'detail', v_detail,
    'area_id', v_area, 'area_name', v_area_name, 'others', v_others,
    'orders_12m', v_orders, 'next_day', v_next1, 'next_two_days', v_next2, 'typical_price', round(v_typical));
END $fn$;
REVOKE ALL ON FUNCTION pickup_area_advice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pickup_area_advice(uuid, uuid) TO authenticated;
