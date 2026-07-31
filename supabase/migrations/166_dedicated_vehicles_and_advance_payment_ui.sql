-- ============================================================
-- Two additions requested for the current PR:
--
-- 1. Dedicated vehicle per driver. Confirmed with the user directly:
--    "a dedicated vehicle for a designated driver is how the company
--    operates" — not a suggestion, an operational fact. Migration 165
--    modeled vehicle assignment as purely per-job (transportation_
--    requests.vehicle_id/assigned_staff_id), with no persistent link.
--    This adds that persistent link on vehicles, one driver per
--    vehicle, enforced.
--
--    Live state checked before writing: 3 vehicles, 2 staff with
--    role='Driver' (Biruk Shiferaw, Kaleb Endalkachew). Which driver
--    has which vehicle is not something this migration can know or
--    guess — same standing rule as reports_to_id and every other
--    real-world fact that only a human can supply. The column is
--    added unset; the new UI (FleetPage, VehicleDetailPage) is where
--    the actual pairing gets entered.
--
-- 2. Advance-payment UI. The DB mechanism (migrations 110/111:
--    sourcing_bundles.payment_pattern, expenses.payment_state =
--    'advance', close_vendor_advance(), v_open_vendor_advances) has
--    existed since those migrations but was checked and confirmed to
--    have ZERO frontend surface — payment_pattern isn't even in
--    database.ts, and nothing calls close_vendor_advance(). Every
--    purchase has been running as pattern A (pay-on-delivery) by
--    default regardless of what a vendor actually demands. Only one
--    schema change is needed here: v_to_pay_queue doesn't expose
--    which pattern an expense's PO uses, so the frontend can't tell a
--    normal payment from an advance that needs the different action.
--    Appended at the end of the SELECT list, not inserted — CREATE OR
--    REPLACE VIEW cannot reorder or rename existing output columns,
--    only append (hit this exact error in migration 164, fixed the
--    same way).
-- ============================================================

SET search_path TO public;

-- ── 1. Dedicated vehicle per driver ──────────────────────────────────
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS assigned_driver_id UUID REFERENCES staff(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_assigned_driver_id_unique'
  ) THEN
    -- One driver, one vehicle. Postgres UNIQUE treats every NULL as
    -- distinct, so any number of vehicles can sit unassigned (pool/
    -- spare vehicles) — only a real double-booking of the same driver
    -- onto two vehicles is blocked.
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_assigned_driver_id_unique UNIQUE (assigned_driver_id);
  END IF;
END $$;

COMMENT ON COLUMN vehicles.assigned_driver_id IS
  'The staff member (role=Driver) this vehicle is permanently dedicated to — how the company actually operates its fleet, not a per-job assignment. transportation_requests.assigned_staff_id/vehicle_id (per-job, migration 165) is a separate, ad-hoc concept for covering a specific job; this is the standing pairing. One driver cannot be dedicated to two vehicles (enforced); a vehicle may have no dedicated driver (pool/spare).';

-- Data-integrity guard, not an advisory suggestion — unlike vehicle-
-- capacity matching (165), which the user explicitly wanted kept
-- non-blocking, a dedicated-driver assignment is a real-world identity
-- fact: only an actual driver can be one. Checked on write, not just
-- filtered in the UI picker, so a bad assignment can't slip in through
-- any other path (Studio, a script, a future page).
CREATE OR REPLACE FUNCTION validate_vehicle_assigned_driver()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.assigned_driver_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM staff WHERE id = NEW.assigned_driver_id AND role = 'Driver') THEN
      RAISE EXCEPTION 'assigned_driver_id must reference a staff member with role = Driver';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_validate_vehicle_assigned_driver ON vehicles;
CREATE TRIGGER trg_validate_vehicle_assigned_driver
  BEFORE INSERT OR UPDATE OF assigned_driver_id ON vehicles
  FOR EACH ROW EXECUTE FUNCTION validate_vehicle_assigned_driver();

-- ── 2. Advance-payment UI: the one missing signal ────────────────────
-- Reproduces v_to_pay_queue's current definition (126) verbatim, adding
-- sourcing_bundle_id and the linked bundle's payment_pattern at the end.
CREATE OR REPLACE VIEW v_to_pay_queue
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.project_id,
  p.project_name,
  c.cost_group_id,
  cg.name AS cost_group_name,
  e.verify_wht,
  e.finance_approved_by,
  e.finance_approved_at,
  EXTRACT(DAY FROM (NOW() - e.finance_approved_at)) AS days_since_approval,
  e.sourcing_bundle_id,
  sb.payment_pattern
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN categories c ON c.id = e.category_id
LEFT JOIN cost_groups cg ON cg.id = c.cost_group_id
LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
WHERE e.payment_state = 'approved_to_pay';

GRANT SELECT ON v_to_pay_queue TO authenticated;

-- ── Verify ────────────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'assigned_driver_id';
SELECT conname FROM pg_constraint WHERE conname = 'vehicles_assigned_driver_id_unique';
SELECT proname FROM pg_proc WHERE proname = 'validate_vehicle_assigned_driver';
SELECT column_name FROM information_schema.columns WHERE table_name = 'v_to_pay_queue' AND column_name IN ('sourcing_bundle_id', 'payment_pattern');
