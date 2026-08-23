-- Three related problems reported live on Fasil Tesfaye's WO
-- ("bench and roof work", Mesob Exhibition Center A):
--
-- 1. v_work_order_cost.labor_cost was computed entirely from
--    work_order_labor + labor_allocations (day span x day_rate_snapshot).
--    work_order_labor is a legacy link table that nothing populates any
--    more -- migration 214 added work_order_crew "additive alongside"
--    it and every current crew/roster/HR-provisioning path only writes
--    work_order_crew + labor_allocations, never work_order_labor. So
--    for any WO crewed the modern way (i.e. all of them now), the join
--    found nothing and labor_cost silently read 0 -- for per_day AND
--    per_volume workers alike, not just volume ones.
--
-- 2. Even for allocations that ARE found, day_rate_snapshot is blank on
--    a lot of them (never stamped by provision_tier_2_worker_from_candidate,
--    the roster-request auto-allocate trigger, or older manual assigns),
--    so the old formula's COALESCE(day_rate_snapshot, 0) still landed on 0.
--
-- 3. Confirmed live: Fasil actually logged 2 real days
--    (2026-08-14, 2026-08-15) that synced into `timesheet`, but both
--    rows have day_rate = NULL -- the sync trigger's rate resolution
--    only fell back to staff.day_rate, and whatever staff row it saw at
--    sync time evidently didn't resolve one, and nothing ever
--    recomputed it after (an UPDATE only re-syncs an existing
--    synced_timesheet_id, so a stale NULL never self-heals). A third
--    day (2026-08-03) never synced into `timesheet` at all
--    (synced_timesheet_id is still NULL on that row) -- the only such
--    orphan in the whole table.
--
-- Fixes:
-- - v_work_order_cost rebuilt on work_order_crew (the table that's
--   actually populated) with two figures instead of one blended guess:
--   labor_cost / total_cost = ACTUAL, from wo_attendance_log's synced
--   timesheet rows (what really happened, regardless of payment_basis).
--   labor_cost_estimated / total_cost_estimated = BUDGET, from each
--   crew member's requisition (estimated_total_cost, falling back to
--   unit_rate x estimated_total_volume for per_volume requisitions that
--   never got a total stamped, same fallback the commitment trigger
--   already uses) or the old day-span formula for crew with no
--   requisition link at all (e.g. a plain Tier 1 assign).
-- - sync_wo_attendance_before: added the requisition's estimated_day_rate
--   as a third fallback after allocation snapshot and staff.day_rate, so
--   a future sync can't land on a bare NULL when a rate exists anywhere
--   in the chain.
-- - One-time backfill: Fasil's 2 existing NULL-day_rate timesheet rows
--   corrected to 7500 (his real day rate), and the missing timesheet row
--   for his orphaned 2026-08-03 entry created and linked, matching
--   exactly what the trigger would have produced.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.sync_wo_attendance_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_emp_type text;
  v_alloc    labor_allocations%ROWTYPE;
  v_req      labor_requisitions%ROWTYPE;
  v_day_rate numeric;
  v_days     numeric;
  v_tier     int;
  v_ts_id    uuid;
  v_note     text;
BEGIN
  SELECT employment_type INTO v_emp_type FROM staff WHERE id = NEW.staff_id;
  v_tier := CASE WHEN v_emp_type = 'tier_2_casual' THEN 2 ELSE 1 END;

  SELECT * INTO v_alloc FROM labor_allocations
   WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
   ORDER BY start_date DESC LIMIT 1;

  IF v_alloc.labor_requisition_id IS NOT NULL THEN
    SELECT * INTO v_req FROM labor_requisitions WHERE id = v_alloc.labor_requisition_id;
  END IF;

  v_day_rate := CASE WHEN v_req.payment_basis = 'per_volume' THEN v_req.unit_rate
                     ELSE COALESCE(v_alloc.day_rate_snapshot, (SELECT day_rate FROM staff WHERE id = NEW.staff_id), v_req.estimated_day_rate) END;
  v_days := CASE WHEN NEW.hours_logged IS NOT NULL THEN NEW.hours_logged / 8.0 ELSE NULL END;
  v_note := CASE WHEN NEW.is_unallocated THEN 'Unallocated time' || COALESCE(' — ' || NEW.notes, '') ELSE NEW.notes END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO timesheet
      (staff_id, project_id, date, labor_tier, labor_allocation_id, labor_requisition_id, day_rate, days_worked, volume_completed, gang_size, gang_member_staff_ids, notes)
    VALUES
      (NEW.staff_id, NEW.project_id, NEW.log_date, v_tier, v_alloc.id, v_alloc.labor_requisition_id, v_day_rate, v_days, NEW.volume_completed, NEW.gang_size, NEW.gang_member_staff_ids, v_note)
    RETURNING id INTO v_ts_id;
    NEW.synced_timesheet_id := v_ts_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.synced_timesheet_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM timesheet WHERE id = NEW.synced_timesheet_id AND rolled_up_expense_id IS NOT NULL)
       OR EXISTS (
         SELECT 1 FROM timesheet_attendance
         WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND work_date = NEW.log_date
           AND rolled_up_expense_id IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'This attendance entry has already been rolled up into a paid labor expense and can no longer be edited';
    END IF;
    UPDATE timesheet SET
      staff_id = NEW.staff_id, project_id = NEW.project_id, date = NEW.log_date,
      labor_tier = v_tier, labor_allocation_id = v_alloc.id, labor_requisition_id = v_alloc.labor_requisition_id,
      day_rate = v_day_rate, days_worked = v_days, volume_completed = NEW.volume_completed,
      gang_size = NEW.gang_size, gang_member_staff_ids = NEW.gang_member_staff_ids, notes = v_note, updated_at = now()
    WHERE id = NEW.synced_timesheet_id;
  END IF;

  RETURN NEW;
END $fn$;

-- ── v_work_order_cost: actual (real work logged) vs estimated (budget) ──
-- DROP + CREATE, not CREATE OR REPLACE: inserting new columns ahead of
-- materials_cost changes column order, which Postgres rejects for a
-- plain REPLACE. No other view depends on this one (checked live via
-- pg_depend), so the drop is safe.
DROP VIEW IF EXISTS public.v_work_order_cost;
CREATE VIEW public.v_work_order_cost AS
WITH crew_alloc AS (
  SELECT DISTINCT ON (wc.work_order_id, wc.staff_id)
    wc.work_order_id, wc.staff_id, la.id AS labor_allocation_id,
    la.labor_requisition_id, la.day_rate_snapshot, la.start_date, la.end_date
  FROM work_order_crew wc
  JOIN work_orders wo2 ON wo2.id = wc.work_order_id
  LEFT JOIN labor_allocations la
    ON la.staff_id = wc.staff_id AND la.project_id = wo2.project_id AND la.status = 'active'
  WHERE wc.removed_at IS NULL
  ORDER BY wc.work_order_id, wc.staff_id, la.start_date DESC NULLS LAST
),
req_estimate AS (
  SELECT DISTINCT work_order_id, labor_requisition_id
  FROM crew_alloc WHERE labor_requisition_id IS NOT NULL
),
no_req_estimate AS (
  SELECT ca.work_order_id, ca.staff_id,
    (COALESCE(ca.end_date, CURRENT_DATE) - ca.start_date + 1) * COALESCE(ca.day_rate_snapshot, s.day_rate, 0) AS est
  FROM crew_alloc ca LEFT JOIN staff s ON s.id = ca.staff_id
  WHERE ca.labor_requisition_id IS NULL AND ca.labor_allocation_id IS NOT NULL
),
estimate AS (
  SELECT work_order_id, SUM(total) AS total FROM (
    SELECT re.work_order_id,
      COALESCE(
        NULLIF(req.estimated_total_cost, 0),
        CASE WHEN req.payment_basis = 'per_volume' THEN req.unit_rate * COALESCE(req.estimated_total_volume, 0)
             ELSE req.estimated_day_rate * COALESCE(req.estimated_days, 0) * req.headcount END,
        0) AS total
    FROM req_estimate re JOIN labor_requisitions req ON req.id = re.labor_requisition_id
    UNION ALL
    SELECT work_order_id, est FROM no_req_estimate
  ) x GROUP BY work_order_id
),
actual AS (
  SELECT wal.work_order_id,
    SUM(COALESCE(ts.days_worked, 0) * COALESCE(ts.day_rate, 0) + COALESCE(ts.volume_completed, 0) * COALESCE(ts.day_rate, 0)) AS total
  FROM wo_attendance_log wal
  JOIN timesheet ts ON ts.id = wal.synced_timesheet_id
  WHERE wal.work_order_id IS NOT NULL
  GROUP BY wal.work_order_id
),
materials AS (
  SELECT wom.work_order_id, sum(si.total_cost) AS total
  FROM work_order_materials wom JOIN stock_issues si ON si.id = wom.stock_issue_id
  GROUP BY wom.work_order_id
)
SELECT
  wo.id AS work_order_id,
  COALESCE(actual.total, 0) AS labor_cost,
  COALESCE(estimate.total, 0) AS labor_cost_estimated,
  COALESCE(materials.total, 0) AS materials_cost,
  COALESCE(actual.total, 0) + COALESCE(materials.total, 0) AS total_cost,
  COALESCE(estimate.total, 0) + COALESCE(materials.total, 0) AS total_cost_estimated
FROM work_orders wo
LEFT JOIN estimate ON estimate.work_order_id = wo.id
LEFT JOIN actual ON actual.work_order_id = wo.id
LEFT JOIN materials ON materials.work_order_id = wo.id;

-- One-time backfill for Fasil's specific bad rows (safe: neither has
-- been rolled up into a paid expense yet, verified live).
UPDATE timesheet SET day_rate = 7500
 WHERE id IN ('de91f20d-8375-4ed1-b1d6-a5f939a1e9cb', 'cccd50ed-2ab3-4aa9-b30c-708a22816593')
   AND day_rate IS NULL;

DO $$
DECLARE
  v_ts_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM timesheet WHERE labor_allocation_id = 'ba81c47d-c1ca-489f-9355-bb200b62a687' AND date = '2026-08-03') THEN
    INSERT INTO timesheet
      (staff_id, project_id, date, labor_tier, labor_allocation_id, labor_requisition_id, day_rate, days_worked, notes)
    VALUES
      ('350e85b8-0546-4409-bfd3-52e3b1bb4120', '150015f6-a81c-4514-b27d-df2ebcc9c7d4', '2026-08-03', 2,
       'ba81c47d-c1ca-489f-9355-bb200b62a687', '23dafa8f-05ac-4459-b439-938b0fc17cf7', 7500, 1, NULL)
    RETURNING id INTO v_ts_id;
    UPDATE wo_attendance_log SET synced_timesheet_id = v_ts_id WHERE id = '1db0b1cb-ade7-4e6b-8f75-50da9bfa42d9';
  END IF;
END $$;
