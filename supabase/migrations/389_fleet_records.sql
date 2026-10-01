-- 389 — Fleet records that stay true
--
-- What the data showed (Oct 2026): 46 transport jobs sitting at
-- "requested", 45 of them purchase-order pickups, 19 for orders whose goods
-- had already been received — nothing closed a pickup when its goods
-- arrived. The Toyota read "On job" for a month because the vehicle's
-- status was only changed by the browser of whoever pressed the button. No
-- vehicle had a plate number recorded, and three of September's five
-- traffic penalties were for papers (plate, licence). Fuel was bought and
-- costed through expenses, but with no odometer reading nobody could say
-- what a vehicle does to the litre.
--
-- So:
--   1. Receiving a purchase order's goods (a GRN) completes its pickup job;
--      cancelling the order cancels it. Existing pickups are brought up to
--      date the same way.
--   2. A vehicle's status follows its jobs in the database: on a job while
--      one is in progress, available again when the last one ends.
--   3. vehicle_documents: plate, insurance, annual inspection, road fund and
--      the drivers' licences, each with an expiry, and v_fleet_papers for
--      what's due.
--   4. expenses.odometer_km on fuel fill-ups, v_vehicle_fuel_economy for
--      km per litre and odd entries, and v_vehicle_month_costs for what each
--      vehicle costs a month.

SET search_path TO public;

-- ── 1. Pickups close when the goods arrive ───────────────────────────────
CREATE OR REPLACE FUNCTION grn_completes_pickup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE transportation_requests
     SET job_status = 'completed',
         actual_delivery_date = COALESCE(actual_delivery_date, NEW.received_at::date)
   WHERE job_status IN ('requested', 'assigned', 'in_progress')
     AND (id = NEW.transportation_request_id
          OR (job_type = 'purchase_pickup' AND sourcing_bundle_id = NEW.sourcing_bundle_id));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_grn_completes_pickup ON goods_received_notes;
CREATE TRIGGER trg_grn_completes_pickup AFTER INSERT ON goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION grn_completes_pickup();

CREATE OR REPLACE FUNCTION po_cancel_cancels_pickup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status::text = 'cancelled' AND OLD.status::text IS DISTINCT FROM 'cancelled' THEN
    UPDATE transportation_requests SET job_status = 'cancelled'
     WHERE sourcing_bundle_id = NEW.id AND job_type = 'purchase_pickup'
       AND job_status IN ('requested', 'assigned');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_po_cancel_cancels_pickup ON sourcing_bundles;
CREATE TRIGGER trg_po_cancel_cancels_pickup AFTER UPDATE OF status ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION po_cancel_cancels_pickup();

-- Bring existing pickups up to date: completed on the day their goods were
-- received (the first GRN), or cancelled with their order.
-- (The completion stamp trigger writes now(); the second statement puts
-- the real day back — now() is the same for the whole migration.)
UPDATE transportation_requests t
   SET job_status = 'completed', actual_delivery_date = COALESCE(t.actual_delivery_date, g.received_at::date)
  FROM (SELECT sourcing_bundle_id, min(received_at) AS received_at FROM goods_received_notes
         WHERE sourcing_bundle_id IS NOT NULL GROUP BY 1) g
 WHERE t.sourcing_bundle_id = g.sourcing_bundle_id AND t.job_type = 'purchase_pickup'
   AND t.job_status IN ('requested', 'assigned', 'in_progress');
UPDATE transportation_requests t SET completed_at = g.received_at
  FROM (SELECT sourcing_bundle_id, min(received_at) AS received_at FROM goods_received_notes
         WHERE sourcing_bundle_id IS NOT NULL GROUP BY 1) g
 WHERE t.sourcing_bundle_id = g.sourcing_bundle_id AND t.job_type = 'purchase_pickup'
   AND t.job_status = 'completed' AND t.completed_at = now();

UPDATE transportation_requests t SET job_status = 'cancelled'
  FROM sourcing_bundles b
 WHERE b.id = t.sourcing_bundle_id AND b.status::text = 'cancelled' AND t.job_type = 'purchase_pickup'
   AND t.job_status IN ('requested', 'assigned');

-- ── 2. Vehicle status follows its jobs ───────────────────────────────────
-- On a job while one is in progress; available when none is. Maintenance
-- and offline are set by hand and left alone.
CREATE OR REPLACE FUNCTION sync_vehicle_status(p_vehicle uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE busy boolean;
BEGIN
  IF p_vehicle IS NULL THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM transportation_requests WHERE vehicle_id = p_vehicle AND job_status = 'in_progress') INTO busy;
  UPDATE vehicles SET status = CASE WHEN busy THEN 'on_job' ELSE 'available' END
   WHERE id = p_vehicle AND status IN ('available', 'on_job')
     AND status IS DISTINCT FROM CASE WHEN busy THEN 'on_job' ELSE 'available' END;
END $$;
REVOKE ALL ON FUNCTION sync_vehicle_status(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION transport_job_syncs_vehicle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    PERFORM sync_vehicle_status(OLD.vehicle_id);
  END IF;
  IF TG_OP = 'DELETE' THEN PERFORM sync_vehicle_status(OLD.vehicle_id); RETURN OLD; END IF;
  PERFORM sync_vehicle_status(NEW.vehicle_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_transport_job_syncs_vehicle ON transportation_requests;
CREATE TRIGGER trg_transport_job_syncs_vehicle
  AFTER INSERT OR DELETE OR UPDATE OF job_status, vehicle_id ON transportation_requests
  FOR EACH ROW EXECUTE FUNCTION transport_job_syncs_vehicle();

SELECT sync_vehicle_status(id) FROM vehicles;

-- ── 3. Papers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  staff_id    uuid REFERENCES staff(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('plate', 'libre', 'insurance', 'inspection', 'road_fund', 'driver_licence', 'other')),
  reference   text,
  issued_on   date,
  expires_on  date,
  cost_etb    numeric CHECK (cost_etb >= 0),
  file_url    text,
  file_name   text,
  notes       text,
  created_by  uuid DEFAULT auth.uid() REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((vehicle_id IS NOT NULL) <> (staff_id IS NOT NULL)),
  CHECK ((kind = 'driver_licence') = (staff_id IS NOT NULL)),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE INDEX IF NOT EXISTS vehicle_documents_vehicle ON vehicle_documents (vehicle_id, kind, expires_on DESC);
CREATE INDEX IF NOT EXISTS vehicle_documents_staff ON vehicle_documents (staff_id, expires_on DESC);

ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vehicle_documents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_documents TO authenticated;

CREATE OR REPLACE FUNCTION can_manage_fleet() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'finance', 'logistics_officer', 'operations_manager'), false)
      OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer)
$$;
REVOKE ALL ON FUNCTION can_manage_fleet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_manage_fleet() TO authenticated;

DROP POLICY IF EXISTS vehicle_documents_read ON vehicle_documents;
CREATE POLICY vehicle_documents_read ON vehicle_documents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vehicle_documents_write ON vehicle_documents;
CREATE POLICY vehicle_documents_write ON vehicle_documents FOR ALL TO authenticated
  USING (can_manage_fleet()) WITH CHECK (can_manage_fleet());

-- The latest paper of each kind for each vehicle and driver, with how long
-- it has left. Vehicles with no plate, insurance or inspection on file show
-- as missing; so does a driver of a vehicle with no licence on file.
CREATE OR REPLACE VIEW v_fleet_papers WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (vehicle_id, staff_id, kind) *
    FROM vehicle_documents
   ORDER BY vehicle_id, staff_id, kind, expires_on DESC NULLS LAST, created_at DESC
), needed AS (
  SELECT v.id AS vehicle_id, NULL::uuid AS staff_id, k.kind, v.name AS holder
    FROM vehicles v CROSS JOIN (VALUES ('plate'), ('insurance'), ('inspection'), ('road_fund')) k(kind)
   WHERE v.active
  UNION ALL
  SELECT NULL, s.id, 'driver_licence', s.employee_name
    FROM vehicles v JOIN staff s ON s.id = v.assigned_driver_id
   WHERE v.active
)
SELECT n.vehicle_id, n.staff_id, n.kind, n.holder,
       l.id AS document_id, l.reference, l.issued_on, l.expires_on, l.file_url,
       CASE WHEN l.id IS NULL THEN 'missing'
            WHEN l.expires_on IS NULL THEN 'ok'
            WHEN l.expires_on < current_date THEN 'expired'
            WHEN l.expires_on <= current_date + 30 THEN 'due'
            ELSE 'ok' END AS state,
       (l.expires_on - current_date) AS days_left
  FROM needed n
  LEFT JOIN latest l ON l.kind = n.kind
   AND l.vehicle_id IS NOT DISTINCT FROM n.vehicle_id AND l.staff_id IS NOT DISTINCT FROM n.staff_id;
REVOKE ALL ON v_fleet_papers FROM anon;
GRANT SELECT ON v_fleet_papers TO authenticated;

-- A plate entered as a paper is the vehicle's plate number too.
CREATE OR REPLACE FUNCTION plate_paper_sets_plate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'plate' AND NEW.vehicle_id IS NOT NULL AND btrim(COALESCE(NEW.reference, '')) <> '' THEN
    UPDATE vehicles SET plate_number = btrim(NEW.reference) WHERE id = NEW.vehicle_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_plate_paper_sets_plate ON vehicle_documents;
CREATE TRIGGER trg_plate_paper_sets_plate AFTER INSERT OR UPDATE OF reference ON vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION plate_paper_sets_plate();

-- ── 4. Fuel and running costs ────────────────────────────────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS odometer_km numeric CHECK (odometer_km >= 0);

-- Each fill-up with the distance since the one before and km per litre
-- (distance driven on the previous fill ÷ litres put in now, the usual
-- fill-to-fill reckoning), plus what looks wrong about it.
CREATE OR REPLACE VIEW v_vehicle_fuel_economy WITH (security_invoker = true) AS
WITH fills AS (
  SELECT e.id AS expense_id, e.expense_code, e.vehicle_id, e.date, e.created_at, e.fuel_liters, e.amount_etb, e.odometer_km,
         e.receipt_url, e.approval_status,
         lag(e.odometer_km) OVER w AS prev_odometer_km
    FROM expenses e
   WHERE e.expense_type = 'fuel' AND e.vehicle_id IS NOT NULL
  WINDOW w AS (PARTITION BY e.vehicle_id ORDER BY e.date, e.created_at)
)
SELECT f.*,
       CASE WHEN f.odometer_km IS NOT NULL AND f.prev_odometer_km IS NOT NULL THEN f.odometer_km - f.prev_odometer_km END AS km_since_last,
       CASE WHEN f.odometer_km > f.prev_odometer_km AND f.fuel_liters > 0
            THEN round((f.odometer_km - f.prev_odometer_km) / f.fuel_liters, 2) END AS km_per_litre,
       CASE WHEN f.fuel_liters > 0 THEN round(f.amount_etb / f.fuel_liters, 2) END AS etb_per_litre,
       array_remove(ARRAY[
         CASE WHEN COALESCE(f.fuel_liters, 0) <= 0 THEN 'no litres' END,
         CASE WHEN v.fuel_tank_liters > 0 AND f.fuel_liters > v.fuel_tank_liters * 1.05 THEN 'more than the tank holds' END,
         CASE WHEN f.odometer_km < f.prev_odometer_km THEN 'odometer went backwards' END,
         CASE WHEN f.odometer_km IS NULL THEN 'no odometer' END,
         CASE WHEN f.receipt_url IS NULL THEN 'no receipt' END
       ], NULL) AS flags
  FROM fills f JOIN vehicles v ON v.id = f.vehicle_id;
REVOKE ALL ON v_vehicle_fuel_economy FROM anon;
GRANT SELECT ON v_vehicle_fuel_economy TO authenticated;

-- What each vehicle costs a month: fuel, repairs, penalties and papers,
-- with the trips it made.
CREATE OR REPLACE VIEW v_vehicle_month_costs WITH (security_invoker = true) AS
WITH c AS (
  SELECT vehicle_id, date_trunc('month', date)::date AS month, amount_etb AS fuel_etb, fuel_liters, 0::numeric AS repairs_etb, 0::numeric AS penalties_etb, 0::numeric AS papers_etb, 0 AS trips
    FROM expenses WHERE expense_type = 'fuel' AND vehicle_id IS NOT NULL AND COALESCE(approval_status::text, '') <> 'rejected'
  UNION ALL
  SELECT vehicle_id, date_trunc('month', COALESCE(completed_at, created_at))::date, 0, 0, COALESCE(actual_cost, 0), 0, 0, 0
    FROM vehicle_maintenance_requests WHERE status::text = 'completed'
  UNION ALL
  SELECT vehicle_id, date_trunc('month', penalty_date)::date, 0, 0, 0, amount, 0, 0 FROM vehicle_penalties
  UNION ALL
  SELECT vehicle_id, date_trunc('month', COALESCE(issued_on, created_at::date))::date, 0, 0, 0, 0, COALESCE(cost_etb, 0), 0
    FROM vehicle_documents WHERE vehicle_id IS NOT NULL AND cost_etb > 0
  UNION ALL
  SELECT vehicle_id, date_trunc('month', COALESCE(completed_at, created_at))::date, 0, 0, 0, 0, 0, 1
    FROM transportation_requests WHERE vehicle_id IS NOT NULL AND job_status = 'completed'
)
SELECT vehicle_id, month,
       sum(fuel_etb) AS fuel_etb, sum(fuel_liters) AS fuel_liters, sum(repairs_etb) AS repairs_etb,
       sum(penalties_etb) AS penalties_etb, sum(papers_etb) AS papers_etb,
       sum(fuel_etb + repairs_etb + penalties_etb + papers_etb) AS total_etb,
       sum(trips)::int AS trips
  FROM c GROUP BY vehicle_id, month;
REVOKE ALL ON v_vehicle_month_costs FROM anon;
GRANT SELECT ON v_vehicle_month_costs TO authenticated;
