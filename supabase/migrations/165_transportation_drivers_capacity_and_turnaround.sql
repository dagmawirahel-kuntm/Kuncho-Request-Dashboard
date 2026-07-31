-- ============================================================
-- Part C: drivers, vehicle-capability matching, procurement-queued
-- pickups, and delivery duration/KPI.
--
-- Confirmed against the shipped schema and live data before writing.
--
-- C1 (drivers). No schema change: staff.role already carries a real
-- 'Driver' value (2 live rows — Biruk Shiferaw, Kaleb Endalkachew) and
-- transportation_requests.assigned_staff_id already FKs to staff. That
-- is the driver identity per the "reuse staff.role... rather than
-- inventing a parallel identity" instruction — nothing to add here.
-- The frontend change (TransportFormPage's picker preferring
-- role='Driver' staff for own_fleet jobs) needs no migration.
--
-- C3 (procurement-queued pickups). No new columns beyond what C4 adds.
-- transportation_requests.sourcing_bundle_id already exists and
-- already links a job back to its PO (used today by PurchaseOrderPage
-- to find/display a job). Queuing "at the moment of placing the PO" is
-- a frontend change (an inline quick-create on PurchaseOrderPage
-- instead of only a click-through to a separate form) against the
-- existing schema.
--
-- What follows is C2 (vehicle capability) and C4 (duration/KPI/
-- overdue), which do need schema.
-- ============================================================

SET search_path TO public;

-- ── C2. Vehicle capability, minimum viable signal ────────────────────
-- vehicles has vehicle_type (truck/pickup/motorbike/van/other) but
-- nothing that distinguishes a small pickup from a 10-tonne truck, so
-- there is nothing to match cargo size against. Adding one ordinal
-- field on each side — vehicle capacity, request cargo size — rather
-- than a real payload/volume model per the "don't build a complex
-- logistics-sizing system" instruction.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS capacity_class TEXT
  CHECK (capacity_class IS NULL OR capacity_class IN ('motorbike', 'light', 'medium', 'heavy'));

-- First-pass estimate from the existing vehicle_type, so the field
-- isn't blank fleet-wide on day one. Only fills NULLs — never
-- overwrites a value someone already set. 'other' is left NULL rather
-- than guessed, since it carries no size signal at all.
UPDATE vehicles SET capacity_class = CASE vehicle_type
  WHEN 'motorbike' THEN 'motorbike'
  WHEN 'pickup'    THEN 'light'
  WHEN 'van'       THEN 'light'
  WHEN 'truck'     THEN 'medium'
  ELSE NULL
END
WHERE capacity_class IS NULL;

COMMENT ON COLUMN vehicles.capacity_class IS
  'Rough size class for matching against a transport request''s cargo_size_estimate. Backfilled from vehicle_type at migration time as a first-pass estimate — edit per vehicle as real payload capacity becomes known. Feeds suggest_vehicles_for_transport() only; never enforced.';

ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS cargo_size_estimate TEXT
  CHECK (cargo_size_estimate IS NULL OR cargo_size_estimate IN ('motorbike', 'light', 'medium', 'heavy'));

COMMENT ON COLUMN transportation_requests.cargo_size_estimate IS
  'Optional, entered by whoever raises the job (e.g. Procurement Officer at PO placement). Feeds suggest_vehicles_for_transport() as an advisory ranking signal — never blocks which vehicle can be assigned.';

-- Advisory suggestion only — SELECT-only, STABLE, no side effects, and
-- the frontend's vehicle picker remains a free choice over the full
-- fleet regardless of what this returns. fit_rank: 0 = exact size
-- match, 1 = capable but oversized, 2 = no signal either side
-- (cargo size not given, or vehicle capacity not set), 3 = undersized
-- for the stated cargo.
CREATE OR REPLACE FUNCTION suggest_vehicles_for_transport(p_cargo_size TEXT DEFAULT NULL)
RETURNS TABLE (vehicle_id UUID, name TEXT, vehicle_type TEXT, capacity_class TEXT, status TEXT, fit_rank INT)
LANGUAGE sql STABLE AS $fn$
  SELECT
    v.id, v.name, v.vehicle_type, v.capacity_class, v.status,
    CASE
      WHEN p_cargo_size IS NULL OR v.capacity_class IS NULL THEN 2
      WHEN v.capacity_class = p_cargo_size THEN 0
      WHEN (CASE v.capacity_class WHEN 'motorbike' THEN 1 WHEN 'light' THEN 2 WHEN 'medium' THEN 3 WHEN 'heavy' THEN 4 END)
         >= (CASE p_cargo_size    WHEN 'motorbike' THEN 1 WHEN 'light' THEN 2 WHEN 'medium' THEN 3 WHEN 'heavy' THEN 4 END)
        THEN 1
      ELSE 3
    END AS fit_rank
  FROM vehicles v
  WHERE v.active = true
  ORDER BY fit_rank, v.status = 'available' DESC, v.name;
$fn$;

GRANT EXECUTE ON FUNCTION suggest_vehicles_for_transport(TEXT) TO authenticated;

-- ── C4. Expected duration, completion stamp, overdue flag, KPI ───────
-- Duration is measured from queuing (created_at — every job is queued
-- the moment its row exists, there is no separate draft state) to
-- job_status reaching 'completed'. One field, optional — not every
-- job needs a KPI target.
ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS expected_duration_hours NUMERIC(6,1)
  CHECK (expected_duration_hours IS NULL OR expected_duration_hours > 0);

COMMENT ON COLUMN transportation_requests.expected_duration_hours IS
  'Target turnaround, in hours, from this row being queued (created_at) to job_status reaching completed. Optional. Feeds v_transportation_pickup_status (overdue flag) and v_logistics_transport_turnaround_kpi (the observable metric behind the Logistics Officer "Transport turnaround" competency) — never auto-writes a competency score.';

ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

COMMENT ON COLUMN transportation_requests.completed_at IS
  'Stamped the moment job_status first reaches completed; cleared if it is ever moved off completed. Kept separate from updated_at, which any unrelated field edit also touches.';

CREATE OR REPLACE FUNCTION stamp_transportation_completion()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.job_status = 'completed' AND OLD.job_status IS DISTINCT FROM 'completed' THEN
    NEW.completed_at := NOW();
  ELSIF OLD.job_status = 'completed' AND NEW.job_status IS DISTINCT FROM 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stamp_transportation_completion ON transportation_requests;
CREATE TRIGGER trg_stamp_transportation_completion
  BEFORE UPDATE OF job_status ON transportation_requests
  FOR EACH ROW EXECUTE FUNCTION stamp_transportation_completion();

-- Per-job status: expected_by, is_overdue, and (once completed)
-- whether it landed on time. Same shape as v_tax_engagements' CASE-
-- based overdue derivation (153) and RentPage's daysUntil() < 0 check
-- — a job with no expected_duration_hours is never overdue, since
-- there is no target to have missed.
CREATE OR REPLACE VIEW v_transportation_pickup_status
WITH (security_invoker = true) AS
SELECT
  tr.id,
  tr.request_name,
  tr.job_type,
  tr.job_status,
  tr.priority,
  tr.assigned_staff_id,
  tr.vehicle_id,
  tr.sourcing_bundle_id,
  tr.created_at,
  tr.expected_duration_hours,
  tr.completed_at,
  CASE WHEN tr.expected_duration_hours IS NOT NULL
    THEN tr.created_at + (tr.expected_duration_hours * INTERVAL '1 hour')
    ELSE NULL END AS expected_by,
  (
    tr.expected_duration_hours IS NOT NULL
    AND tr.job_status NOT IN ('completed', 'cancelled')
    AND NOW() > tr.created_at + (tr.expected_duration_hours * INTERVAL '1 hour')
  ) AS is_overdue,
  CASE WHEN tr.completed_at IS NOT NULL AND tr.expected_duration_hours IS NOT NULL
    THEN tr.completed_at <= tr.created_at + (tr.expected_duration_hours * INTERVAL '1 hour')
    ELSE NULL END AS completed_on_time
FROM transportation_requests tr;

GRANT SELECT ON v_transportation_pickup_status TO authenticated;

-- The observable metric behind the Logistics Officer "Transport
-- turnaround" competency (seeded in 162, key_responsibilities row
-- 'Transport turnaround' under job_descriptions 'Logistics Officer',
-- now active): per assigned driver, how many completed jobs had a
-- duration target, and how many landed on time vs. late. Read-only
-- and additive — nothing writes this into staff_skill_ratings. That
-- stays a human judgment call, same as the standing rule against
-- auto-generating competency scores from system metrics; this view
-- only gives the assessor real data to look at alongside it.
CREATE OR REPLACE VIEW v_logistics_transport_turnaround_kpi
WITH (security_invoker = true) AS
SELECT
  tr.assigned_staff_id AS staff_id,
  count(*) FILTER (WHERE ps.completed_on_time IS NOT NULL) AS jobs_with_target_completed,
  count(*) FILTER (WHERE ps.completed_on_time = true)  AS jobs_on_time,
  count(*) FILTER (WHERE ps.completed_on_time = false) AS jobs_late,
  ROUND(
    100.0 * count(*) FILTER (WHERE ps.completed_on_time = true)
    / NULLIF(count(*) FILTER (WHERE ps.completed_on_time IS NOT NULL), 0), 1
  ) AS on_time_pct
FROM transportation_requests tr
JOIN v_transportation_pickup_status ps ON ps.id = tr.id
WHERE tr.assigned_staff_id IS NOT NULL
GROUP BY tr.assigned_staff_id;

GRANT SELECT ON v_logistics_transport_turnaround_kpi TO authenticated;

-- security_invoker views only surface what the querying user's own RLS
-- on transportation_requests already allows. operations_manager is the
-- assessor for this competency framework (StaffFfeSkillsPage's
-- canEdit = admin || operations_manager) but had no read policy on
-- transportation_requests at all — the KPI view would render empty for
-- exactly the role meant to use it. Read-only, additive.
DROP POLICY IF EXISTS "ops_manager_read_transport" ON transportation_requests;
CREATE POLICY "ops_manager_read_transport" ON transportation_requests FOR SELECT
  USING (get_user_role() = 'operations_manager');

-- ── Verify ────────────────────────────────────────────────────────────
SELECT vehicle_type, capacity_class, count(*) FROM vehicles GROUP BY 1, 2 ORDER BY 1;
SELECT proname FROM pg_proc WHERE proname IN ('suggest_vehicles_for_transport', 'stamp_transportation_completion');
SELECT viewname FROM pg_views WHERE viewname IN ('v_transportation_pickup_status', 'v_logistics_transport_turnaround_kpi');
