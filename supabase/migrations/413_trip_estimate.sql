-- 413 — What a trip would cost, and who is the best deal right now
--
-- A mock trip: two places (or just a distance) in, out comes what it
-- would likely cost by each kind of vehicle we hire, how sure that is,
-- and the drivers whose prices for trips like it have been lowest.
--
-- What the data showed (Oct 2026): hired prices follow distance only
-- loosely. City trips are short (median 4–8 km) and most of the price is
-- the call-out — a straight "per km" line explains 1–29% of the spread.
-- So the estimate is what we actually paid for trips of about the same
-- length: the same route when we've done it at least twice, else the six
-- jobs nearest in distance, with the middle half as the range.
--
-- Drivers: each priced job is compared with what that vehicle usually
-- costs for its distance; a driver's ratio is the middle of those. A
-- ratio of 0.8 means they've charged about 20% under the going rate.
--
-- Also fixed here: eight stored road distances into Meskel Adebabay said
-- ~230 km (Merkato → Meskel Square is 4.8 km by road); the place's pin
-- had been moved after they were looked up. They were looked up again
-- from OpenStreetMap routing and corrected, and route_distances now
-- refuses a road distance more than 4× the straight line plus 5 km, so a
-- stale or wrong pin can't skew prices again.

SET search_path TO public;

-- ── The distance fix (applied Oct 2026) ──────────────────────────────
UPDATE route_distances rd SET road_km = v.km, road_minutes = v.mins, source = 'osrm', computed_at = now()
  FROM (VALUES ('Gazebo', 2.4, 3), ('Urael', 3.8, 6), ('Piassa', 4.5, 6), ('Golagol', 4.6, 7), ('Sarbet', 5.1, 6),
               ('Merkato', 4.8, 6), ('Enkulal Fabrica', 6.4, 8), ('Ayat 49', 12.3, 15)) v(name, km, mins)
  JOIN locations a ON a.location_name = v.name AND a.is_active
  JOIN locations b ON b.location_name = 'Meskel Adebabay' AND b.is_active
 WHERE rd.from_location_id = a.id AND rd.to_location_id = b.id AND rd.road_km > 100;

CREATE OR REPLACE FUNCTION check_route_distance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE v_straight numeric;
BEGIN
  SELECT haversine_km(a.latitude, a.longitude, b.latitude, b.longitude) INTO v_straight
    FROM locations a, locations b WHERE a.id = NEW.from_location_id AND b.id = NEW.to_location_id;
  IF v_straight IS NOT NULL AND NEW.road_km > v_straight * 4 + 5 THEN
    RAISE EXCEPTION 'A road distance of % km is far off the % km straight line between these places — check their pins', NEW.road_km, v_straight;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_check_route_distance BEFORE INSERT OR UPDATE OF road_km ON route_distances
  FOR EACH ROW EXECUTE FUNCTION check_route_distance();

-- ── Priced hired trips, last 12 months ───────────────────────────────
-- Runs as the caller, so transport jobs are read through their own
-- access rules. "opt" is the kind of vehicle: a hired class, or
-- ride-hailing.
CREATE OR REPLACE FUNCTION transport_priced_trips()
RETURNS TABLE (id uuid, opt text, amount numeric, km numeric, job_date date, pickup_id uuid, dropoff_id uuid, driver_id uuid)
LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT t.id, CASE WHEN t.transport_mode = 'ride_hailing' THEN 'ride_hailing' ELSE COALESCE(t.hired_vehicle_class, 'unknown') END,
         t.amount, COALESCE(t.road_km, round(t.straight_km * 1.35, 1)), t.job_date, t.pickup_id, t.dropoff_id, tr.hired_driver_id
    FROM v_transport_jobs_clean t
    JOIN transportation_requests tr ON tr.id = t.id
   WHERE t.transport_mode IN ('hired', 'ride_hailing') AND t.amount > 0 AND t.job_date >= current_date - 365;
$fn$;
REVOKE ALL ON FUNCTION transport_priced_trips() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transport_priced_trips() TO authenticated;

-- ── The estimate ─────────────────────────────────────────────────────
-- Runs as the caller, so drivers are read through their own access rules.
CREATE OR REPLACE FUNCTION transport_trip_estimate(p_km numeric DEFAULT NULL, p_pickup uuid DEFAULT NULL, p_dropoff uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE v_opts jsonb; v_drivers jsonb; v_fleet jsonb; v_route_km numeric; v_route_min numeric; v_straight numeric;
BEGIN
  -- The trip's distance: given, or the saved road distance, or the pins.
  IF p_pickup IS NOT NULL AND p_dropoff IS NOT NULL THEN
    SELECT road_km, road_minutes INTO v_route_km, v_route_min FROM route_distances
     WHERE (from_location_id, to_location_id) IN ((p_pickup, p_dropoff), (p_dropoff, p_pickup)) LIMIT 1;
    SELECT haversine_km(a.latitude, a.longitude, b.latitude, b.longitude) INTO v_straight
      FROM locations a, locations b WHERE a.id = p_pickup AND b.id = p_dropoff;
  END IF;
  p_km := COALESCE(p_km, v_route_km, round(v_straight * 1.35, 1));

  -- One row per kind of vehicle.
  WITH tj AS (SELECT * FROM transport_priced_trips()),
  o AS (SELECT DISTINCT opt FROM tj),
  allj AS (
    SELECT opt, count(*) AS jobs, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS med_all,
           (array_agg(amount ORDER BY job_date DESC))[1] AS last_price, max(job_date) AS last_date
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
     GROUP BY opt)
  SELECT jsonb_agg(jsonb_build_object(
           'option', a.opt, 'jobs', a.jobs,
           'estimate', round(COALESCE(CASE WHEN r.n >= 2 THEN r.med END, n.med, a.med_all)),
           'low', round(CASE WHEN r.n >= 2 THEN r.lo WHEN n.n >= 4 THEN n.p25 ELSE n.lo END),
           'high', round(CASE WHEN r.n >= 2 THEN r.hi WHEN n.n >= 4 THEN n.p75 ELSE n.hi END),
           'route_jobs', COALESCE(r.n, 0), 'route_median', round(r.med),
           'near_jobs', COALESCE(n.n, 0), 'near_km_low', n.km_lo, 'near_km_high', n.km_hi,
           'confidence', CASE WHEN r.n >= 2 THEN 'route'
                              WHEN n.n >= 4 AND n.km_off <= GREATEST(3, p_km * 0.5) THEN 'good'
                              WHEN n.n >= 2 THEN 'rough' ELSE 'thin' END,
           'last_price', a.last_price, 'last_date', a.last_date)
         ORDER BY COALESCE(CASE WHEN r.n >= 2 THEN r.med END, n.med, a.med_all))
    INTO v_opts
    FROM allj a LEFT JOIN nagg n ON n.opt = a.opt LEFT JOIN route r ON r.opt = a.opt;

  -- Drivers: their prices against the going rate for each job's distance.
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

  -- Our own vehicles, last full month: what a trip cost with everything counted.
  SELECT jsonb_agg(jsonb_build_object('vehicle', f.vehicle_name, 'plate', f.plate_number, 'month', f.month,
                                      'trips', f.trips, 'running_cost', f.running_cost, 'fuel', f.fuel_etb, 'cost_per_trip', f.cost_per_trip)
                   ORDER BY f.cost_per_trip NULLS LAST)
    INTO v_fleet
    FROM v_fleet_vs_hire f
   WHERE f.month = (date_trunc('month', current_date) - interval '1 month')::date AND f.running_cost > 0;

  RETURN jsonb_build_object(
    'km', p_km, 'road_km', v_route_km, 'road_minutes', v_route_min, 'straight_km', v_straight,
    'distance_source', CASE WHEN v_route_km IS NOT NULL AND p_km = v_route_km THEN 'road'
                            WHEN v_straight IS NOT NULL AND p_km = round(v_straight * 1.35, 1) THEN 'pins' ELSE 'given' END,
    'options', COALESCE(v_opts, '[]'::jsonb),
    'drivers', COALESCE(v_drivers, '[]'::jsonb),
    'own_fleet', COALESCE(v_fleet, '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION transport_trip_estimate(numeric, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transport_trip_estimate(numeric, uuid, uuid) TO authenticated;
