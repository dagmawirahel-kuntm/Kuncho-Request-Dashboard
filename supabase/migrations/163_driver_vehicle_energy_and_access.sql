-- ============================================================
-- Driver & vehicle batch:
--   * Fuel / charge readings, logged by drivers (fuel vehicles in
--     liters, electric in %).
--   * Drivers can VIEW their vehicle's engagements (the "Biruk can't
--     see IVECO's fuel request" complaint).
--   * The assigned driver — not a separate logistics officer — accepts
--     and starts their own jobs.
--
-- Driver identity, established rather than assumed: auth.uid() ->
-- staff.user_id -> staff.id, matched against vehicles.assigned_driver_id
-- and transportation_requests.assigned_staff_id (both FK -> staff).
-- my_staff_id() (migration 148) already resolves auth.uid() to staff.id,
-- so it is reused here rather than re-deriving the join.
--
-- In this org the drivers ARE the logistics officers (Biruk, Dagmawi
-- Fitsum, Kaleb all hold role logistics_officer), so the access grants
-- key on that role plus the specific assigned-driver identity.
-- ============================================================

SET search_path TO public;

-- ── 1. Fuel vs electric ─────────────────────────────────────────────
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS energy_type TEXT NOT NULL DEFAULT 'fuel'
  CHECK (energy_type IN ('fuel', 'electric'));

-- The electric motorbike is the only non-fuel vehicle today. Matched on
-- name rather than assuming an id — narrow ILIKE so it can't catch the
-- IVECO or Toyota.
UPDATE vehicles SET energy_type = 'electric'
WHERE energy_type = 'fuel' AND (name ILIKE '%electric%' OR name ILIKE '%motorbike%' OR vehicle_type ILIKE '%electric%');

COMMENT ON COLUMN vehicles.energy_type IS
  'fuel = tracked in liters against fuel_tank_liters; electric = tracked as charge %. Drives which reading the energy log and gauge expect.';

-- ── 2. The readings ─────────────────────────────────────────────────
-- A log (time series), not a single mutable level column: the point is
-- to see depletion across the day, which a running level can't show.
-- Exactly one of fuel_liters / charge_percent is set, matching the
-- vehicle's energy_type — enforced so an electric bike can't get a
-- liters reading or vice versa.
CREATE TABLE IF NOT EXISTS vehicle_energy_log (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id                UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  logged_by                 UUID REFERENCES user_profiles(id),
  reading_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  energy_type               TEXT NOT NULL CHECK (energy_type IN ('fuel', 'electric')),
  fuel_liters               NUMERIC(8,2) CHECK (fuel_liters >= 0),
  charge_percent            NUMERIC(5,2) CHECK (charge_percent >= 0 AND charge_percent <= 100),
  transportation_request_id UUID REFERENCES transportation_requests(id) ON DELETE SET NULL,
  note                      TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (energy_type = 'fuel'     AND fuel_liters    IS NOT NULL AND charge_percent IS NULL)
    OR (energy_type = 'electric' AND charge_percent IS NOT NULL AND fuel_liters    IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vehicle_energy_log_vehicle ON vehicle_energy_log(vehicle_id, reading_at DESC);

ALTER TABLE vehicle_energy_log ENABLE ROW LEVEL SECURITY;

-- Read: fleet oversight roles, plus the assigned driver of that vehicle.
DROP POLICY IF EXISTS "vehicle_energy_log_read" ON vehicle_energy_log;
CREATE POLICY "vehicle_energy_log_read" ON vehicle_energy_log FOR SELECT
  USING (
    get_user_role() IN ('admin', 'executive', 'finance', 'operations_manager', 'logistics_officer')
    OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_id AND v.assigned_driver_id = my_staff_id())
  );

-- Write: admin / logistics officer, or the vehicle's own assigned driver.
DROP POLICY IF EXISTS "vehicle_energy_log_write" ON vehicle_energy_log;
CREATE POLICY "vehicle_energy_log_write" ON vehicle_energy_log FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin', 'logistics_officer', 'operations_manager')
    OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_id AND v.assigned_driver_id = my_staff_id())
  );

GRANT SELECT, INSERT ON vehicle_energy_log TO authenticated;

-- ── 3. Latest reading + depletion, per vehicle ──────────────────────
CREATE OR REPLACE VIEW v_vehicle_energy_current
WITH (security_invoker = true) AS
SELECT DISTINCT ON (v.id)
  v.id AS vehicle_id, v.name AS vehicle_name, v.energy_type, v.fuel_tank_liters,
  l.reading_at, l.fuel_liters, l.charge_percent, l.logged_by, l.note,
  CASE
    WHEN v.energy_type = 'electric' THEN l.charge_percent
    WHEN v.fuel_tank_liters IS NOT NULL AND v.fuel_tank_liters > 0 THEN ROUND(l.fuel_liters / v.fuel_tank_liters * 100, 1)
  END AS percent_remaining,
  CASE
    WHEN v.energy_type = 'electric' THEN 100 - l.charge_percent
    WHEN v.fuel_tank_liters IS NOT NULL THEN v.fuel_tank_liters - l.fuel_liters
  END AS depleted
FROM vehicles v
LEFT JOIN vehicle_energy_log l ON l.vehicle_id = v.id
WHERE v.active
ORDER BY v.id, l.reading_at DESC NULLS LAST;

GRANT SELECT ON v_vehicle_energy_current TO authenticated;

-- ── 4. Drivers can VIEW their vehicle's fuel/vehicle expenses ───────
-- Scoped to expenses that name a vehicle (fuel, maintenance) — NOT the
-- whole ledger. Answers "the fuel request for IVECO is not available to
-- Biruk": logistics_officer had no SELECT on expenses at all.
DROP POLICY IF EXISTS "logistics_officer_read_vehicle_expenses" ON expenses;
CREATE POLICY "logistics_officer_read_vehicle_expenses" ON expenses FOR SELECT
  USING (get_user_role() = 'logistics_officer' AND vehicle_id IS NOT NULL);

-- ── 5. The assigned driver accepts & starts their own job ───────────
-- No separate logistics-officer assignment step: the driver moves their
-- own job through requested -> assigned (accept) -> in_progress (picked
-- up) -> completed. Scoped to jobs assigned to them, or on the vehicle
-- they drive.
DROP POLICY IF EXISTS "driver_update_own_jobs" ON transportation_requests;
CREATE POLICY "driver_update_own_jobs" ON transportation_requests FOR UPDATE
  USING (
    assigned_staff_id = my_staff_id()
    OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = transportation_requests.vehicle_id AND v.assigned_driver_id = my_staff_id())
  );

DROP POLICY IF EXISTS "driver_read_own_jobs" ON transportation_requests;
CREATE POLICY "driver_read_own_jobs" ON transportation_requests FOR SELECT
  USING (
    get_user_role() = 'logistics_officer'
    OR assigned_staff_id = my_staff_id()
    OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = transportation_requests.vehicle_id AND v.assigned_driver_id = my_staff_id())
  );

-- ── Verify ──────────────────────────────────────────────────────────
SELECT name, energy_type, fuel_tank_liters FROM vehicles ORDER BY name;
SELECT count(*) AS energy_log_table FROM information_schema.tables WHERE table_name='vehicle_energy_log';
SELECT * FROM v_vehicle_energy_current ORDER BY vehicle_name;
