-- 405: What transport costs, where, and whether owning vehicles pays.
--
-- 146 transport jobs were recorded with prices, but places were typed as
-- free text, so nothing could say what a route usually costs or whether
-- the pickup earns its keep. Together with tidying places into saved
-- locations (Locations → Tidy up places), this adds:
--   · a 'market' kind of place (Merkato, Piassa — many sellers, one area);
--   · route_distances: road distance and time between two saved places,
--     looked up once from OpenStreetMap routing and kept; straight-line
--     distance from the pins otherwise;
--   · v_transport_jobs_clean — one row per job with its route, distance,
--     price, timing and whether it was late;
--   · v_transport_route_costs — per route: usual price, range, trend;
--   · v_transport_month_prices — hired prices month by month;
--   · v_fleet_vs_hire — per own vehicle per month: what it cost to run
--     (fuel, repairs, penalties, papers, driver) against what hiring the
--     same trips would have cost;
--   · v_transport_by_project — transport spend per project and as a share
--     of its contract value;
--   · v_transport_pickup_areas — where purchases are collected, and days
--     with several separate pickups from the same place (one trip would do);
--   · v_transport_carriers — hired carriers: jobs, price, on time.
-- All views read through transportation_requests' own access rules.

-- ── A kind for market areas ──────────────────────────────────────────
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'locations'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE locations DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE locations ADD CONSTRAINT locations_kind_check
  CHECK (kind IN ('site', 'vendor_shop', 'market', 'office', 'workshop', 'warehouse', 'client', 'other'));

-- ── Distances ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lat1 IS NULL OR lat2 IS NULL OR lng1 IS NULL OR lng2 IS NULL THEN NULL ELSE
    round((2 * 6371 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::numeric, 2) END
$$;

CREATE TABLE IF NOT EXISTS route_distances (
  from_location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  to_location_id   uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  road_km          numeric NOT NULL CHECK (road_km >= 0),
  road_minutes     numeric,
  source           text NOT NULL DEFAULT 'osrm',
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_location_id, to_location_id)
);
ALTER TABLE route_distances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'route_distances' AND policyname = 'route_distances_rw') THEN
    CREATE POLICY route_distances_rw ON route_distances FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON route_distances TO authenticated;

-- ── One row per job ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_transport_jobs_clean WITH (security_invoker = true) AS
SELECT t.id, t.request_name, t.created_at,
       (date_trunc('month', COALESCE(t.completed_at, t.requested_date::timestamptz, t.created_at)))::date AS month,
       COALESCE(t.completed_at::date, t.requested_date, t.created_at::date) AS job_date,
       t.job_type, t.transport_mode, t.job_status, t.hired_vehicle_class, t.vehicle_id, t.project_id, t.vendor_id,
       t.sourcing_bundle_id, t.driver_name,
       NULLIF(t.amount, 0) AS amount,
       t.pickup_location_id AS pickup_id, p.location_name AS pickup_name, p.kind AS pickup_kind,
       t.dropoff_location_id AS dropoff_id, d.location_name AS dropoff_name, d.kind AS dropoff_kind,
       COALESCE(p.location_name, NULLIF(btrim(t.pickup_location_text), '')) AS pickup_label,
       COALESCE(d.location_name, NULLIF(btrim(t.dropoff_location_text), '')) AS dropoff_label,
       haversine_km(p.latitude, p.longitude, d.latitude, d.longitude) AS straight_km,
       COALESCE(rd.road_km, rd2.road_km) AS road_km,
       COALESCE(rd.road_minutes, rd2.road_minutes) AS road_minutes,
       s.expected_by, t.completed_at, s.completed_on_time, s.is_overdue,
       CASE WHEN t.completed_at IS NOT NULL THEN round((extract(epoch FROM t.completed_at - t.created_at) / 3600)::numeric, 1) END AS hours_to_complete
  FROM transportation_requests t
  LEFT JOIN locations p ON p.id = t.pickup_location_id
  LEFT JOIN locations d ON d.id = t.dropoff_location_id
  LEFT JOIN route_distances rd  ON rd.from_location_id = t.pickup_location_id AND rd.to_location_id = t.dropoff_location_id
  LEFT JOIN route_distances rd2 ON rd2.from_location_id = t.dropoff_location_id AND rd2.to_location_id = t.pickup_location_id
  LEFT JOIN v_transportation_pickup_status s ON s.id = t.id
 WHERE COALESCE(t.job_status, '') <> 'cancelled';

-- ── What each route costs (hired, priced) ────────────────────────────
CREATE OR REPLACE VIEW v_transport_route_costs WITH (security_invoker = true) AS
WITH j AS (
  SELECT * FROM v_transport_jobs_clean
   WHERE transport_mode = 'hired' AND amount > 0 AND pickup_id IS NOT NULL AND dropoff_id IS NOT NULL
)
SELECT pickup_id, dropoff_id,
       min(pickup_name) AS pickup_name, min(dropoff_name) AS dropoff_name,
       count(*)::int AS jobs,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)::numeric) AS median_price,
       round(percentile_cont(0.25) WITHIN GROUP (ORDER BY amount)::numeric) AS low_price,
       round(percentile_cont(0.75) WITHIN GROUP (ORDER BY amount)::numeric) AS high_price,
       min(amount) AS min_price, max(amount) AS max_price,
       (array_agg(amount ORDER BY job_date DESC))[1] AS last_price,
       max(job_date) AS last_date,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) FILTER (WHERE job_date > current_date - 60)::numeric) AS median_recent,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) FILTER (WHERE job_date <= current_date - 60)::numeric) AS median_before,
       max(COALESCE(road_km, straight_km)) AS km,
       bool_or(road_km IS NOT NULL) AS km_is_road
  FROM j
 GROUP BY pickup_id, dropoff_id;

-- ── Hired prices month by month ──────────────────────────────────────
CREATE OR REPLACE VIEW v_transport_month_prices WITH (security_invoker = true) AS
SELECT month, transport_mode, job_type,
       count(*)::int AS jobs,
       count(amount)::int AS priced_jobs,
       COALESCE(sum(amount), 0) AS spend,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)::numeric) AS median_price,
       round((sum(amount) FILTER (WHERE COALESCE(road_km, straight_km) > 0)
              / NULLIF(sum(COALESCE(road_km, straight_km)) FILTER (WHERE amount > 0), 0))::numeric) AS price_per_km
  FROM v_transport_jobs_clean
 GROUP BY month, transport_mode, job_type;

-- ── Own vehicle or hire? ─────────────────────────────────────────────
-- Running cost = fuel + repairs + penalties + papers (v_vehicle_month_costs)
-- + the assigned driver's monthly salary. "Hiring would have cost" prices
-- each own trip at that route's usual hired price, or the month's usual
-- hired price for the same kind of job when the route has none.
CREATE OR REPLACE VIEW v_fleet_vs_hire WITH (security_invoker = true) AS
WITH own AS (
  SELECT j.vehicle_id, j.month, j.job_type, j.pickup_id, j.dropoff_id
    FROM v_transport_jobs_clean j
   WHERE j.transport_mode = 'own_fleet' AND j.vehicle_id IS NOT NULL
),
hire_month AS (
  SELECT month, job_type, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS med
    FROM v_transport_jobs_clean WHERE transport_mode = 'hired' AND amount > 0 GROUP BY 1, 2
),
hire_any AS (
  SELECT job_type, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS med
    FROM v_transport_jobs_clean WHERE transport_mode = 'hired' AND amount > 0 GROUP BY 1
),
hire_all AS (
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS med
    FROM v_transport_jobs_clean WHERE transport_mode = 'hired' AND amount > 0
),
priced AS (
  SELECT o.vehicle_id, o.month, count(*)::int AS trips,
         count(rc.median_price)::int AS trips_on_known_routes,
         sum(COALESCE(rc.median_price, hm.med, ha.med, (SELECT med FROM hire_all))) AS hire_equivalent
    FROM own o
    LEFT JOIN v_transport_route_costs rc ON rc.pickup_id = o.pickup_id AND rc.dropoff_id = o.dropoff_id
    LEFT JOIN hire_month hm ON hm.month = o.month AND hm.job_type = o.job_type
    LEFT JOIN hire_any ha ON ha.job_type = o.job_type
   GROUP BY 1, 2
),
months AS (
  SELECT vehicle_id, month FROM priced
  UNION SELECT vehicle_id, month FROM v_vehicle_month_costs
)
SELECT v.id AS vehicle_id, v.name AS vehicle_name, v.vehicle_type, v.plate_number, m.month,
       COALESCE(p.trips, 0) AS trips,
       COALESCE(p.trips_on_known_routes, 0) AS trips_on_known_routes,
       COALESCE(c.fuel_etb, 0) AS fuel_etb,
       COALESCE(c.repairs_etb, 0) AS repairs_etb,
       COALESCE(c.penalties_etb, 0) + COALESCE(c.papers_etb, 0) AS other_etb,
       COALESCE(s.monthly_salary, 0) AS driver_etb,
       COALESCE(c.total_etb, 0) + COALESCE(s.monthly_salary, 0) AS running_cost,
       round((COALESCE(c.total_etb, 0) + COALESCE(s.monthly_salary, 0)) / NULLIF(p.trips, 0)) AS cost_per_trip,
       round(p.hire_equivalent) AS hire_equivalent,
       round(COALESCE(p.hire_equivalent, 0) - (COALESCE(c.total_etb, 0) + COALESCE(s.monthly_salary, 0))) AS saved_by_owning
  FROM months m
  JOIN vehicles v ON v.id = m.vehicle_id
  LEFT JOIN priced p ON p.vehicle_id = m.vehicle_id AND p.month = m.month
  LEFT JOIN v_vehicle_month_costs c ON c.vehicle_id = m.vehicle_id AND c.month = m.month
  LEFT JOIN staff s ON s.id = v.assigned_driver_id;

-- ── Transport per project ────────────────────────────────────────────
CREATE OR REPLACE VIEW v_transport_by_project WITH (security_invoker = true) AS
WITH fleet AS (
  SELECT sum(running_cost) / NULLIF(sum(trips), 0) AS per_trip FROM v_fleet_vs_hire
)
SELECT j.project_id, pr.project_name, pr.contract_value,
       count(*)::int AS jobs,
       count(*) FILTER (WHERE j.transport_mode = 'hired')::int AS hired_jobs,
       count(*) FILTER (WHERE j.transport_mode = 'own_fleet')::int AS own_trips,
       COALESCE(sum(j.amount) FILTER (WHERE j.transport_mode <> 'own_fleet'), 0) AS paid_out,
       round(count(*) FILTER (WHERE j.transport_mode = 'own_fleet') * COALESCE((SELECT per_trip FROM fleet), 0)) AS own_fleet_estimate,
       round(100 * (COALESCE(sum(j.amount) FILTER (WHERE j.transport_mode <> 'own_fleet'), 0)
                    + count(*) FILTER (WHERE j.transport_mode = 'own_fleet') * COALESCE((SELECT per_trip FROM fleet), 0))
             / NULLIF(pr.contract_value, 0), 2) AS pct_of_contract,
       max(j.job_date) AS last_date
  FROM v_transport_jobs_clean j
  JOIN projects pr ON pr.id = j.project_id
 GROUP BY j.project_id, pr.project_name, pr.contract_value;

-- ── Where purchases are collected ────────────────────────────────────
CREATE OR REPLACE VIEW v_transport_pickup_areas WITH (security_invoker = true) AS
WITH j AS (
  SELECT * FROM v_transport_jobs_clean WHERE job_type = 'purchase_pickup' AND pickup_label IS NOT NULL
), same_day AS (
  SELECT lower(pickup_label) AS k, job_date, count(*) AS n FROM j GROUP BY 1, 2 HAVING count(*) > 1
)
SELECT min(j.pickup_id::text)::uuid AS pickup_id, min(j.pickup_label) AS place, (min(j.pickup_id::text) IS NOT NULL) AS saved,
       count(*)::int AS pickups,
       COALESCE(sum(j.amount), 0) AS spend,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY j.amount)::numeric) AS median_price,
       (SELECT count(*) FROM same_day sd WHERE sd.k = lower(min(j.pickup_label)))::int AS days_with_repeat_trips,
       (SELECT COALESCE(sum(sd.n - 1), 0) FROM same_day sd WHERE sd.k = lower(min(j.pickup_label)))::int AS extra_trips,
       max(j.job_date) AS last_date
  FROM j
 GROUP BY lower(j.pickup_label);

-- ── Hired carriers ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_transport_carriers WITH (security_invoker = true) AS
SELECT COALESCE(v.vendor_name, NULLIF(btrim(j.driver_name), ''), 'Unknown') AS carrier,
       j.vendor_id,
       count(*)::int AS jobs,
       count(j.amount)::int AS priced_jobs,
       COALESCE(sum(j.amount), 0) AS spend,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY j.amount)::numeric) AS median_price,
       count(*) FILTER (WHERE j.completed_on_time IS TRUE)::int AS on_time,
       count(*) FILTER (WHERE j.completed_on_time IS FALSE)::int AS late,
       count(*) FILTER (WHERE j.job_status NOT IN ('completed') AND j.job_date < current_date - 7)::int AS still_open,
       max(j.job_date) AS last_date
  FROM v_transport_jobs_clean j
  LEFT JOIN vendors v ON v.id = j.vendor_id
 WHERE j.transport_mode = 'hired'
 GROUP BY 1, 2;

GRANT SELECT ON v_transport_jobs_clean, v_transport_route_costs, v_transport_month_prices, v_fleet_vs_hire,
  v_transport_by_project, v_transport_pickup_areas, v_transport_carriers TO authenticated;
GRANT EXECUTE ON FUNCTION haversine_km(double precision, double precision, double precision, double precision) TO authenticated;
