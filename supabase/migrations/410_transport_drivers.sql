-- 410 — Hired drivers as people we know, and when each job moved
--
-- What the data showed (Oct 2026): 70 hired / ride-hailing jobs carried a
-- driver only as typed text — 45 different spellings, the same freelance
-- drivers turning up for different suppliers ("Enkuneh Mekonnen / mekonnin
-- / Mekonnin", "Talamos / Talemos Bezabih"), and bank account numbers typed
-- into the name ("Abel 1000233546748") because there was nowhere to put
-- them. No phone or plate anywhere. A job knew when it was completed, not
-- when it was assigned or started.
--
-- Now:
--   * transport_drivers: name, phone, plate, the vehicle they usually come
--     with, how they're paid (bank / telebirr / cash) and the account.
--   * transportation_requests.hired_driver_id; picking a driver on a job
--     fills the vehicle class and, when paying, the payee.
--   * assigned_at / started_at stamped when a job moves (completed_at was
--     already), so the job page can show its timeline.
--   * v_transport_drivers: each driver with trips, last trip and what they
--     were paid on jobs.
--   * Drivers built once from the typed names: spellings that are the same
--     person merged (trigram similarity), account numbers lifted out of the
--     name, and the jobs linked.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS transport_drivers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL CHECK (btrim(full_name) <> ''),
  phone           text,
  plate_number    text,
  vehicle_class   text,
  usual_vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  payout_method   text CHECK (payout_method IN ('bank', 'telebirr', 'cash')),
  bank_name       text,
  account_number  text,
  account_name    text,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transport_drivers_name_trgm ON transport_drivers USING gin (lower(full_name) gin_trgm_ops);

CREATE TRIGGER transport_drivers_updated_at BEFORE UPDATE ON transport_drivers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE transport_drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY transport_drivers_read ON transport_drivers FOR SELECT USING (
  get_user_role() IN ('admin', 'executive', 'finance', 'operations_manager', 'hr_officer', 'project_manager', 'stock_manager', 'procurement_officer', 'logistics_officer')
  OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_logistics_officer));
CREATE POLICY transport_drivers_write ON transport_drivers FOR INSERT WITH CHECK (
  get_user_role() IN ('admin', 'executive', 'finance', 'operations_manager', 'hr_officer', 'project_manager', 'stock_manager', 'procurement_officer', 'logistics_officer')
  OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_logistics_officer));
CREATE POLICY transport_drivers_update ON transport_drivers FOR UPDATE USING (
  get_user_role() IN ('admin', 'executive', 'finance', 'operations_manager', 'procurement_officer', 'logistics_officer')
  OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_logistics_officer));
CREATE POLICY transport_drivers_delete ON transport_drivers FOR DELETE USING (get_user_role() = 'admin');
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_drivers TO authenticated;

ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS hired_driver_id uuid REFERENCES transport_drivers(id) ON DELETE SET NULL;
ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS started_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_transport_hired_driver ON transportation_requests (hired_driver_id) WHERE hired_driver_id IS NOT NULL;

-- ── When the job moved ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION stamp_transport_stage_times()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.job_status IS DISTINCT FROM OLD.job_status THEN
    IF NEW.job_status IN ('assigned', 'in_progress', 'completed') AND NEW.assigned_at IS NULL THEN NEW.assigned_at := now(); END IF;
    IF NEW.job_status IN ('in_progress', 'completed') AND NEW.started_at IS NULL THEN NEW.started_at := now(); END IF;
    IF NEW.job_status = 'requested' THEN NEW.assigned_at := NULL; NEW.started_at := NULL; END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_stamp_transport_stage_times BEFORE UPDATE OF job_status ON transportation_requests
  FOR EACH ROW EXECUTE FUNCTION stamp_transport_stage_times();

-- ── Drivers with their trips ─────────────────────────────────────────
CREATE OR REPLACE VIEW v_transport_drivers WITH (security_invoker = true) AS
SELECT d.*,
       v.vendor_name AS usual_vendor_name,
       COALESCE(j.trips, 0) AS trips,
       j.last_trip,
       COALESCE(j.amount, 0) AS amount_on_jobs
  FROM transport_drivers d
  LEFT JOIN vendors v ON v.id = d.usual_vendor_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS trips, max(t.requested_date) AS last_trip, sum(COALESCE(t.amount, 0)) AS amount
      FROM transportation_requests t WHERE t.hired_driver_id = d.id AND t.job_status <> 'cancelled') j ON true;
GRANT SELECT ON v_transport_drivers TO authenticated;

-- ── Drivers from the names typed so far ──────────────────────────────
DO $fn$
DECLARE r record; v_id uuid; v_norm text; v_digits text; v_skel text;
BEGIN
  FOR r IN
    SELECT btrim(driver_name) AS name, count(*) AS n
      FROM transportation_requests
     WHERE transport_mode IN ('hired', 'ride_hailing') AND NULLIF(btrim(driver_name), '') IS NOT NULL
       AND btrim(driver_name) !~* '^ride$' AND driver_name NOT LIKE '%,%'
     GROUP BY btrim(driver_name) ORDER BY count(*) DESC, btrim(driver_name)
  LOOP
    v_digits := substring(r.name from '[0-9]{8,16}');
    v_norm := lower(btrim(regexp_replace(regexp_replace(r.name, '[0-9]+', '', 'g'), '\s+', ' ', 'g')));
    IF v_norm = '' THEN CONTINUE; END IF;
    -- Same person: the same consonants once vowels and doubled letters go
    -- ("Talamos Bezabih" / "Talemos Bezabh"), or close spellings.
    v_skel := regexp_replace(regexp_replace(v_norm, '[aeiou]', '', 'g'), '(.)\1+', '\1', 'g');
    v_id := NULL;
    SELECT id INTO v_id FROM transport_drivers
     WHERE regexp_replace(regexp_replace(lower(full_name), '[aeiou]', '', 'g'), '(.)\1+', '\1', 'g') = v_skel
        OR (similarity(lower(full_name), v_norm) >= 0.55 AND split_part(lower(full_name), ' ', 1) % split_part(v_norm, ' ', 1))
     ORDER BY similarity(lower(full_name), v_norm) DESC LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO transport_drivers (full_name, account_number, payout_method, notes, created_by)
      VALUES (initcap(v_norm), v_digits, CASE WHEN v_digits IS NOT NULL THEN 'bank' END,
              'Created from transport jobs typed before the driver list (migration 410).', NULL)
      RETURNING id INTO v_id;
    ELSIF v_digits IS NOT NULL THEN
      UPDATE transport_drivers SET account_number = COALESCE(account_number, v_digits),
             payout_method = COALESCE(payout_method, 'bank') WHERE id = v_id;
    END IF;
    UPDATE transportation_requests SET hired_driver_id = v_id
     WHERE btrim(driver_name) = r.name AND transport_mode IN ('hired', 'ride_hailing') AND hired_driver_id IS NULL;
  END LOOP;

  -- The vehicle each usually came with, and the supplier they mostly carry for.
  UPDATE transport_drivers d SET
    vehicle_class = (SELECT t.hired_vehicle_class FROM transportation_requests t WHERE t.hired_driver_id = d.id AND t.hired_vehicle_class IS NOT NULL
                      GROUP BY 1 ORDER BY count(*) DESC LIMIT 1),
    usual_vendor_id = (SELECT x.vid FROM (
                        SELECT t.vendor_id AS vid, count(*) AS n FROM transportation_requests t
                         WHERE t.hired_driver_id = d.id AND t.vendor_id IS NOT NULL GROUP BY t.vendor_id) x
                       WHERE x.n >= 2 ORDER BY x.n DESC LIMIT 1);
END $fn$;
-- Applied (Oct 2026): 37 drivers, 68 jobs linked.
