-- 415 — Loading crews on the trip, and pricing trips to places we've never been
--
-- 1. Loading and unloading labour. IVECO trips nearly always hire a crew
--    to load and unload, paid on paper slips and entered later — if at
--    all — as stand-alone labour expenses no one can tie back to a trip
--    ("Tempered glass loading labour" 80,000; "Magnesium board loading/
--    unloading" 500). Now the crew is recorded on the trip itself —
--    stage, how many, how paid, how much, the crew lead and their payout
--    account — by the driver from My Trips or by the office on the job,
--    and turned into a labour payment request for the normal approval and
--    payment queue, linked to the trip, its vehicle and its project.
--
--      transport_job_labour            one crew record per stage
--      request_transport_labour_payment(ids)   files the payment request
--      v_transport_job_costs           trip price + crew per job
--
-- 2. Trips beyond what we've done. The estimator (413) prices a trip from
--    trips of about the same length; for a place we've never been, or a
--    distance well past any trip on record, there is nothing that close.
--    City prices are mostly call-out — a Lada averages ~150–200 a km in
--    town but costs ~1,050 + ~56 a km once the call-out is split out — so
--    for those trips the estimate is the call-out plus the per-km rate,
--    marked rough, with a call to do market research: get quotes from the
--    drivers who've been the best deal, and log them.
--
--      transport_quotes                quotes collected, per route or place
--      transport_trip_estimate()       adds, per kind of vehicle: average
--                                      per km, call-out + per km, the
--                                      by-the-km estimate, recent quotes;
--                                      and whether this is new ground

SET search_path TO public;

-- ── 1. Crews ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_job_labour (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_request_id  uuid NOT NULL REFERENCES transportation_requests(id) ON DELETE CASCADE,
  stage                 text NOT NULL DEFAULT 'both' CHECK (stage IN ('loading', 'unloading', 'both')),
  workers               int  CHECK (workers IS NULL OR workers > 0),
  basis                 text NOT NULL DEFAULT 'lump_sum' CHECK (basis IN ('lump_sum', 'per_person')),
  rate                  numeric CHECK (rate IS NULL OR rate > 0),
  amount                numeric NOT NULL CHECK (amount > 0),
  payee_name            text NOT NULL CHECK (btrim(payee_name) <> ''),
  payee_phone           text,
  payout_method         text CHECK (payout_method IN ('bank', 'telebirr', 'cash')),
  account_number        text,
  note                  text,
  expense_id            uuid REFERENCES expenses(id) ON DELETE SET NULL,
  recorded_by           uuid DEFAULT auth.uid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (basis <> 'per_person' OR (workers IS NOT NULL AND rate IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_transport_job_labour_job ON transport_job_labour (transport_request_id);

ALTER TABLE transport_job_labour ENABLE ROW LEVEL SECURITY;
-- Whoever can see the trip can see and record its crew (the trip's own
-- access rules decide); a crew already sent for payment can't be changed.
CREATE POLICY transport_job_labour_read ON transport_job_labour FOR SELECT
  USING (EXISTS (SELECT 1 FROM transportation_requests t WHERE t.id = transport_request_id));
CREATE POLICY transport_job_labour_insert ON transport_job_labour FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM transportation_requests t WHERE t.id = transport_request_id));
CREATE POLICY transport_job_labour_update ON transport_job_labour FOR UPDATE
  USING (expense_id IS NULL AND EXISTS (SELECT 1 FROM transportation_requests t WHERE t.id = transport_request_id));
CREATE POLICY transport_job_labour_delete ON transport_job_labour FOR DELETE
  USING (expense_id IS NULL AND EXISTS (SELECT 1 FROM transportation_requests t WHERE t.id = transport_request_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_job_labour TO authenticated;

-- One payment request for the crews picked (one crew lead per request).
-- SECURITY DEFINER because drivers and logistics may only file fuel
-- expenses directly; it checks the caller can see the trip first.
CREATE OR REPLACE FUNCTION request_transport_labour_payment(p_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_job uuid; v_jobs int; v_payees int; v_total numeric; v_t transportation_requests%ROWTYPE;
  r record; v_desc text; v_exp uuid; v_role text := get_user_role()::text; v_staff uuid := my_staff_id();
  v_logistics boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT count(DISTINCT transport_request_id), count(DISTINCT lower(btrim(payee_name))), min(transport_request_id::text)::uuid, sum(amount)
    INTO v_jobs, v_payees, v_job, v_total
    FROM transport_job_labour WHERE id = ANY (p_ids) AND expense_id IS NULL;
  IF v_jobs IS NULL OR v_jobs = 0 THEN RAISE EXCEPTION 'Nothing left to request — these crews were already sent for payment'; END IF;
  IF v_jobs > 1 THEN RAISE EXCEPTION 'Request crews one trip at a time'; END IF;
  IF v_payees > 1 THEN RAISE EXCEPTION 'These crews have different crew leads — request each one separately'; END IF;

  SELECT * INTO v_t FROM transportation_requests WHERE id = v_job;
  SELECT COALESCE(is_logistics_officer, false) INTO v_logistics FROM user_profiles WHERE id = auth.uid();
  IF NOT (v_role IN ('admin', 'executive', 'finance', 'operations_manager', 'hr_officer', 'project_manager', 'stock_manager', 'procurement_officer', 'logistics_officer')
          OR v_logistics OR v_t.assigned_staff_id = v_staff OR v_t.requested_by_id = auth.uid()
          OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = v_t.vehicle_id AND v.assigned_driver_id = v_staff)) THEN
    RAISE EXCEPTION 'Only the trip''s driver, logistics or the office can request this payment';
  END IF;

  SELECT * INTO r FROM transport_job_labour WHERE id = ANY (p_ids) AND expense_id IS NULL ORDER BY created_at LIMIT 1;
  SELECT string_agg(CASE stage WHEN 'loading' THEN 'loading' WHEN 'unloading' THEN 'unloading' ELSE 'loading and unloading' END
                    || COALESCE(' (' || workers || ' worker' || CASE WHEN workers = 1 THEN '' ELSE 's' END || ')', ''), ', ' ORDER BY created_at)
    INTO v_desc FROM transport_job_labour WHERE id = ANY (p_ids) AND expense_id IS NULL;

  INSERT INTO expenses (expense_type, category_id, item_service_description, amount_etb, date, project_id, is_overhead, vehicle_id,
                        vendors_name, vendors_bank_account, payment_method, notes, purchaser_user_id,
                        approval_status, requested, payment_status, partially_paid, contacted, verify_wht,
                        is_new_item, is_allocated, receipt_delivered, delivery_status)
  VALUES ('labor_payment', (SELECT id FROM categories WHERE category_name = 'Labor' ORDER BY id LIMIT 1),
          initcap(left(v_desc, 1)) || substr(v_desc, 2) || ' — ' || COALESCE(v_t.request_name, 'transport job'),
          v_total, COALESCE(v_t.completed_at::date, v_t.requested_date, current_date), v_t.project_id, v_t.project_id IS NULL, v_t.vehicle_id,
          btrim(r.payee_name), NULLIF(btrim(COALESCE(r.account_number, '')), ''),
          CASE WHEN r.payout_method = 'cash' THEN 'cash' END,
          'Crew lead: ' || btrim(r.payee_name) || COALESCE(', ' || r.payee_phone, '') || COALESCE(' · paid by ' || r.payout_method, '')
            || '. Recorded on the trip, not on paper (migration 415).',
          auth.uid(), 'pending', true, false, false, false, false, false, false, false, '{}')
  RETURNING id INTO v_exp;

  UPDATE transport_job_labour SET expense_id = v_exp WHERE id = ANY (p_ids) AND expense_id IS NULL;
  RETURN v_exp;
END $fn$;
REVOKE ALL ON FUNCTION request_transport_labour_payment(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_transport_labour_payment(uuid[]) TO authenticated;

CREATE OR REPLACE VIEW v_transport_job_costs WITH (security_invoker = true) AS
SELECT t.id AS transport_request_id, t.request_name, t.vehicle_id, t.transport_mode,
       NULLIF(t.amount, 0) AS trip_amount,
       COALESCE(l.crew_amount, 0) AS crew_amount,
       COALESCE(NULLIF(t.amount, 0), 0) + COALESCE(l.crew_amount, 0) AS total_amount,
       COALESCE(l.crews, 0) AS crews, COALESCE(l.workers, 0) AS workers,
       COALESCE(l.unrequested, 0) AS crew_unrequested
  FROM transportation_requests t
  LEFT JOIN LATERAL (
    SELECT sum(amount) AS crew_amount, count(*) AS crews, sum(workers) AS workers,
           sum(amount) FILTER (WHERE expense_id IS NULL) AS unrequested
      FROM transport_job_labour x WHERE x.transport_request_id = t.id) l ON true;
GRANT SELECT ON v_transport_job_costs TO authenticated;

-- ── 2. Quotes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_location_id  uuid REFERENCES locations(id) ON DELETE SET NULL,
  to_location_id    uuid REFERENCES locations(id) ON DELETE SET NULL,
  from_text         text,
  to_text           text,
  km                numeric CHECK (km IS NULL OR km > 0),
  option            text NOT NULL CHECK (option IN ('ride_hailing', 'other', 'lada', 'toyota_carryon', 'mini_isuzu', 'isuzu', 'unknown')),
  driver_id         uuid REFERENCES transport_drivers(id) ON DELETE SET NULL,
  carrier_name      text,
  phone             text,
  price             numeric NOT NULL CHECK (price > 0),
  quoted_at         date NOT NULL DEFAULT current_date,
  note              text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (driver_id IS NOT NULL OR NULLIF(btrim(COALESCE(carrier_name, '')), '') IS NOT NULL),
  CHECK (to_location_id IS NOT NULL OR NULLIF(btrim(COALESCE(to_text, '')), '') IS NOT NULL OR km IS NOT NULL)
);
ALTER TABLE transport_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY transport_quotes_read ON transport_quotes FOR SELECT USING (
  get_user_role()::text IN ('admin', 'executive', 'finance', 'operations_manager', 'hr_officer', 'project_manager', 'stock_manager', 'procurement_officer', 'logistics_officer')
  OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_logistics_officer));
CREATE POLICY transport_quotes_insert ON transport_quotes FOR INSERT WITH CHECK (
  get_user_role()::text IN ('admin', 'executive', 'finance', 'operations_manager', 'hr_officer', 'project_manager', 'stock_manager', 'procurement_officer', 'logistics_officer')
  OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_logistics_officer));
CREATE POLICY transport_quotes_delete ON transport_quotes FOR DELETE USING (created_by = auth.uid() OR get_user_role()::text = 'admin');
GRANT SELECT, INSERT, DELETE ON transport_quotes TO authenticated;

-- ── 2. The estimate, with per-km rates, quotes and new ground ────────
CREATE OR REPLACE FUNCTION transport_trip_estimate(p_km numeric DEFAULT NULL, p_pickup uuid DEFAULT NULL, p_dropoff uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE
  v_opts jsonb; v_drivers jsonb; v_fleet jsonb; v_route_km numeric; v_route_min numeric; v_straight numeric;
  v_max_km numeric; v_seen_pickup boolean := true; v_seen_dropoff boolean := true; v_new boolean; v_reason text;
  v_quotes jsonb;
BEGIN
  IF p_pickup IS NOT NULL AND p_dropoff IS NOT NULL THEN
    SELECT road_km, road_minutes INTO v_route_km, v_route_min FROM route_distances
     WHERE (from_location_id, to_location_id) IN ((p_pickup, p_dropoff), (p_dropoff, p_pickup)) LIMIT 1;
    SELECT haversine_km(a.latitude, a.longitude, b.latitude, b.longitude) INTO v_straight
      FROM locations a, locations b WHERE a.id = p_pickup AND b.id = p_dropoff;
  END IF;
  p_km := COALESCE(p_km, v_route_km, round(v_straight * 1.35, 1));

  -- New ground: a place no trip has touched, or a distance well past any trip on record.
  SELECT max(km) INTO v_max_km FROM transport_priced_trips();
  IF p_pickup IS NOT NULL THEN
    v_seen_pickup := EXISTS (SELECT 1 FROM transportation_requests t WHERE p_pickup IN (t.pickup_location_id, t.dropoff_location_id) AND t.job_status <> 'cancelled');
  END IF;
  IF p_dropoff IS NOT NULL THEN
    v_seen_dropoff := EXISTS (SELECT 1 FROM transportation_requests t WHERE p_dropoff IN (t.pickup_location_id, t.dropoff_location_id) AND t.job_status <> 'cancelled');
  END IF;
  v_new := NOT v_seen_pickup OR NOT v_seen_dropoff OR (p_km IS NOT NULL AND v_max_km IS NOT NULL AND p_km > v_max_km * 1.3);
  v_reason := CASE
    WHEN p_km IS NOT NULL AND v_max_km IS NOT NULL AND p_km > v_max_km * 1.3 THEN 'Our longest priced trip is ' || round(v_max_km, 1) || ' km — this one is ' || p_km || ' km.'
    WHEN NOT v_seen_dropoff THEN 'We have never had a trip to or from where this is going.'
    WHEN NOT v_seen_pickup THEN 'We have never had a trip to or from the pickup.' END;

  WITH tj AS (SELECT * FROM transport_priced_trips()),
  o AS (SELECT DISTINCT opt FROM tj),
  allj AS (
    SELECT opt, count(*) AS jobs, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS med_all,
           (array_agg(amount ORDER BY job_date DESC))[1] AS last_price, max(job_date) AS last_date,
           -- Per km: the plain average (all paid ÷ all km), and split into a call-out and a per-km rate.
           sum(amount) FILTER (WHERE km > 0) / NULLIF(sum(km) FILTER (WHERE km > 0), 0) AS per_km_avg,
           count(*) FILTER (WHERE km > 0) AS km_trips, max(km) AS max_km,
           regr_slope(amount::float8, km::float8) FILTER (WHERE km > 0) AS slope,
           regr_intercept(amount::float8, km::float8) FILTER (WHERE km > 0) AS intercept
      FROM tj GROUP BY opt),
  near AS (
    SELECT o.opt, x.amount, x.km FROM o CROSS JOIN LATERAL (
      SELECT j.amount, j.km FROM tj j
       WHERE j.opt = o.opt AND j.km IS NOT NULL AND p_km IS NOT NULL
       ORDER BY abs(j.km - p_km), j.job_date DESC LIMIT 6) x),
  nagg AS (
    SELECT opt, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS med,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY amount) AS p25, percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) AS p75,
           min(amount) AS lo, max(amount) AS hi, min(km) AS km_lo, max(km) AS km_hi, max(abs(km - p_km)) AS km_off
      FROM near GROUP BY opt),
  route AS (
    SELECT opt, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS med, min(amount) AS lo, max(amount) AS hi
      FROM tj
     WHERE p_pickup IS NOT NULL AND p_dropoff IS NOT NULL
       AND ((pickup_id = p_pickup AND dropoff_id = p_dropoff) OR (pickup_id = p_dropoff AND dropoff_id = p_pickup))
     GROUP BY opt),
  q AS (
    -- Quotes from the last 90 days: for this route, or of about this distance.
    SELECT option AS opt, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med, min(price) AS lo, max(price) AS hi
      FROM transport_quotes
     WHERE quoted_at >= current_date - 90
       AND ((p_dropoff IS NOT NULL AND to_location_id IS NOT NULL
             AND ((to_location_id = p_dropoff AND from_location_id IS NOT DISTINCT FROM p_pickup) OR (to_location_id = p_pickup AND from_location_id IS NOT DISTINCT FROM p_dropoff)))
            OR (p_km IS NOT NULL AND km BETWEEN p_km * 0.8 AND p_km * 1.25))
     GROUP BY option),
  m AS (
    SELECT a.*, n.n, n.med, n.p25, n.p75, n.lo, n.hi, n.km_lo, n.km_hi, n.km_off,
           r.n AS r_n, r.med AS r_med, r.lo AS r_lo, r.hi AS r_hi,
           q.n AS q_n, q.med AS q_med, q.lo AS q_lo, q.hi AS q_hi,
           -- By the km: call-out + rate when there are enough trips and the
           -- rate makes sense, else the plain average (from 3 trips up).
           CASE WHEN p_km IS NULL THEN NULL
                WHEN a.km_trips >= 8 AND a.slope > 0 THEN GREATEST(a.intercept, 0) + a.slope * p_km
                WHEN a.km_trips >= 3 THEN a.per_km_avg * p_km END AS by_km,
           (p_km IS NOT NULL AND (v_new OR a.max_km IS NULL OR p_km > a.max_km * 1.3)) AS beyond
      FROM allj a LEFT JOIN nagg n ON n.opt = a.opt LEFT JOIN route r ON r.opt = a.opt LEFT JOIN q ON q.opt = a.opt)
  SELECT jsonb_agg(jsonb_build_object(
           'option', opt, 'jobs', jobs,
           'estimate', round(CASE WHEN q_n >= 2 THEN q_med WHEN r_n >= 2 THEN r_med
                                  WHEN beyond AND by_km IS NOT NULL THEN GREATEST(by_km, COALESCE(med, 0))
                                  ELSE COALESCE(med, med_all) END),
           'low', round(CASE WHEN q_n >= 2 THEN q_lo WHEN r_n >= 2 THEN r_lo WHEN beyond AND by_km IS NOT NULL THEN GREATEST(by_km, COALESCE(med, 0)) * 0.7
                             WHEN n >= 4 THEN p25 ELSE lo END),
           'high', round(CASE WHEN q_n >= 2 THEN q_hi WHEN r_n >= 2 THEN r_hi WHEN beyond AND by_km IS NOT NULL THEN GREATEST(by_km, COALESCE(med, 0)) * 1.4
                              WHEN n >= 4 THEN p75 ELSE hi END),
           'route_jobs', COALESCE(r_n, 0), 'route_median', round(r_med),
           'near_jobs', COALESCE(n, 0), 'near_km_low', km_lo, 'near_km_high', km_hi,
           'quotes', COALESCE(q_n, 0), 'quote_median', round(q_med),
           'per_km_avg', round(per_km_avg), 'call_out', CASE WHEN km_trips >= 8 AND slope > 0 THEN round(GREATEST(intercept, 0)) END,
           'per_km_rate', CASE WHEN km_trips >= 8 AND slope > 0 THEN round(slope::numeric, 1) END,
           'km_trips', km_trips, 'max_km', max_km, 'by_km', round(by_km), 'beyond', beyond,
           'confidence', CASE WHEN q_n >= 2 THEN 'quotes' WHEN r_n >= 2 THEN 'route'
                              WHEN beyond AND by_km IS NOT NULL THEN 'per_km'
                              WHEN n >= 4 AND km_off <= GREATEST(3, p_km * 0.5) THEN 'good'
                              WHEN n >= 2 THEN 'rough' ELSE 'thin' END,
           'last_price', last_price, 'last_date', last_date)
         ORDER BY CASE WHEN q_n >= 2 THEN q_med WHEN r_n >= 2 THEN r_med WHEN beyond AND by_km IS NOT NULL THEN GREATEST(by_km, COALESCE(med, 0)) ELSE COALESCE(med, med_all) END)
    INTO v_opts
    FROM m;

  WITH tj AS (SELECT * FROM transport_priced_trips()),
  rated AS (
    SELECT j.driver_id, j.opt, j.job_date, j.amount / NULLIF(x.typical, 0) AS ratio
      FROM tj j
      CROSS JOIN LATERAL (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY k.amount) AS typical, count(*) AS n
          FROM tj k
         WHERE k.opt = j.opt AND k.id <> j.id AND k.km IS NOT NULL
           AND k.km BETWEEN j.km * 0.6 - 1 AND j.km * 1.4 + 1) x
     WHERE j.driver_id IS NOT NULL AND j.km IS NOT NULL AND x.n >= 2),
  per AS (
    SELECT driver_id, count(*) AS rated_jobs, percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio) AS ratio,
           mode() WITHIN GROUP (ORDER BY opt) AS opt, max(job_date) AS last_rated
      FROM rated GROUP BY driver_id)
  SELECT jsonb_agg(jsonb_build_object(
           'driver_id', d.id, 'name', d.full_name, 'phone', d.phone, 'plate', d.plate_number,
           'option', p.opt, 'vehicle_class', d.vehicle_class, 'payout_method', d.payout_method,
           'trips', d.trips, 'last_trip', d.last_trip, 'rated_jobs', p.rated_jobs, 'ratio', round(p.ratio::numeric, 2),
           'estimate', round((p.ratio * ((SELECT (e->>'estimate')::numeric FROM jsonb_array_elements(v_opts) e WHERE e->>'option' = p.opt LIMIT 1)))::numeric))
         ORDER BY p.ratio, d.trips DESC)
    INTO v_drivers
    FROM per p JOIN v_transport_drivers d ON d.id = p.driver_id
   WHERE d.is_active;

  SELECT jsonb_agg(jsonb_build_object('vehicle', f.vehicle_name, 'plate', f.plate_number, 'month', f.month,
                                      'trips', f.trips, 'running_cost', f.running_cost, 'fuel', f.fuel_etb, 'cost_per_trip', f.cost_per_trip)
                   ORDER BY f.cost_per_trip NULLS LAST)
    INTO v_fleet
    FROM v_fleet_vs_hire f
   WHERE f.month = (date_trunc('month', current_date) - interval '1 month')::date AND f.running_cost > 0;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q.id, 'option', q.option, 'price', q.price, 'km', q.km, 'quoted_at', q.quoted_at,
                                               'who', COALESCE(d.full_name, q.carrier_name), 'phone', COALESCE(q.phone, d.phone), 'note', q.note,
                                               'from', COALESCE(fl.location_name, q.from_text), 'to', COALESCE(tl.location_name, q.to_text))
                            ORDER BY q.quoted_at DESC, q.price), '[]'::jsonb)
    INTO v_quotes
    FROM transport_quotes q
    LEFT JOIN transport_drivers d ON d.id = q.driver_id
    LEFT JOIN locations fl ON fl.id = q.from_location_id
    LEFT JOIN locations tl ON tl.id = q.to_location_id
   WHERE q.quoted_at >= current_date - 90
     AND ((p_dropoff IS NOT NULL AND q.to_location_id IN (p_dropoff, p_pickup))
          OR (p_km IS NOT NULL AND q.km BETWEEN p_km * 0.8 AND p_km * 1.25));

  RETURN jsonb_build_object(
    'km', p_km, 'road_km', v_route_km, 'road_minutes', v_route_min, 'straight_km', v_straight,
    'distance_source', CASE WHEN v_route_km IS NOT NULL AND p_km = v_route_km THEN 'road'
                            WHEN v_straight IS NOT NULL AND p_km = round(v_straight * 1.35, 1) THEN 'pins' ELSE 'given' END,
    'new_ground', COALESCE(v_new, false), 'new_ground_reason', v_reason, 'max_km_on_record', round(v_max_km, 1),
    'options', COALESCE(v_opts, '[]'::jsonb),
    'drivers', COALESCE(v_drivers, '[]'::jsonb),
    'own_fleet', COALESCE(v_fleet, '[]'::jsonb),
    'quotes', v_quotes);
END $fn$;
