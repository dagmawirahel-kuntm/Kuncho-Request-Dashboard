-- 266 — Repair broken wo_attendance_log → timesheet links
--
-- Regression from 263/264. Those migrations deleted `timesheet` rows that
-- merely restated a timesheet_attendance row, to clear worker-days that
-- appeared twice on screen. The predicate checked volume, overtime, notes,
-- gang data, payroll links and rollup links — but NOT
-- wo_attendance_log.synced_timesheet_id, which points at exactly those
-- rows. That FK is ON DELETE SET NULL, so the deletes silently unlinked
-- 285 attendance logs instead of failing.
--
-- v_work_order_cost derives a work order's actual labor cost by INNER
-- JOINing wo_attendance_log to timesheet through that link, so every
-- unlinked day dropped straight out of the total. "Screed Work at Roto
-- area, Cleaning stairs & HCB Execution" has 67 logged days but only one
-- surviving link, so it reported 1,500 ETB instead of the real figure.
--
-- Rollup totals were unaffected: the rollup reads timesheet_attendance
-- (untouched) for per-day work, and the per-volume timesheet rows were
-- deliberately preserved. This was a work-order costing problem only.
--
-- Those timesheet rows were therefore never redundant — they are the
-- canonical per-day cost record behind work-order costing. This migration
-- rebuilds them by replaying sync_wo_attendance_before()'s own INSERT
-- logic, so the restored rows are what the system would have written
-- itself rather than a reconstruction of my own design: the same
-- three-step allocation precedence, the same rate COALESCE, the same
-- days_worked = hours_logged / 8.
--
-- Kept as a callable function, not a one-shot block: any future deletion
-- of a timesheet row will silently unlink attendance the same way, and
-- this repairs it.

CREATE OR REPLACE FUNCTION public.resync_wo_attendance_timesheets()
RETURNS TABLE(repaired int, skipped int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_log      wo_attendance_log%ROWTYPE;
  v_emp_type text;
  v_alloc    labor_allocations%ROWTYPE;
  v_req      labor_requisitions%ROWTYPE;
  v_day_rate numeric;
  v_days     numeric;
  v_tier     int;
  v_ts_id    uuid;
  v_note     text;
  v_repaired int := 0;
  v_skipped  int := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance', 'hr_officer') THEN
    RAISE EXCEPTION 'Only admin, executive, finance, or HR may resync attendance timesheets';
  END IF;

  FOR v_log IN
    SELECT * FROM wo_attendance_log WHERE synced_timesheet_id IS NULL ORDER BY log_date, created_at
  LOOP
    -- A timesheet row for this worker/project/day may already exist (for
    -- instance the per-volume rows that were deliberately preserved).
    -- Re-link to it rather than creating a second one.
    SELECT id INTO v_ts_id
    FROM timesheet
    WHERE staff_id = v_log.staff_id
      AND project_id = v_log.project_id
      AND date = v_log.log_date
    ORDER BY created_at
    LIMIT 1;

    IF v_ts_id IS NOT NULL THEN
      UPDATE wo_attendance_log SET synced_timesheet_id = v_ts_id WHERE id = v_log.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT employment_type INTO v_emp_type FROM staff WHERE id = v_log.staff_id;
    v_tier := CASE WHEN v_emp_type = 'tier_2_casual' THEN 2 ELSE 1 END;

    -- Same three-step allocation precedence as sync_wo_attendance_before().
    v_alloc := NULL;
    IF v_log.labor_requisition_id IS NOT NULL THEN
      SELECT * INTO v_alloc FROM labor_allocations
       WHERE staff_id = v_log.staff_id AND project_id = v_log.project_id AND status = 'active'
         AND labor_requisition_id = v_log.labor_requisition_id
       ORDER BY start_date DESC LIMIT 1;
    END IF;

    IF v_alloc.id IS NULL AND v_log.work_order_id IS NOT NULL THEN
      SELECT la.* INTO v_alloc FROM labor_allocations la
      JOIN labor_requisitions r ON r.id = la.labor_requisition_id
      WHERE la.staff_id = v_log.staff_id AND la.project_id = v_log.project_id AND la.status = 'active'
        AND r.work_order_id = v_log.work_order_id
      ORDER BY la.start_date DESC LIMIT 1;
    END IF;

    IF v_alloc.id IS NULL THEN
      SELECT * INTO v_alloc FROM labor_allocations
       WHERE staff_id = v_log.staff_id AND project_id = v_log.project_id AND status = 'active'
       ORDER BY start_date DESC LIMIT 1;
    END IF;

    v_req := NULL;
    IF v_alloc.labor_requisition_id IS NOT NULL THEN
      SELECT * INTO v_req FROM labor_requisitions WHERE id = v_alloc.labor_requisition_id;
    END IF;

    v_day_rate := CASE WHEN v_req.payment_basis = 'per_volume' THEN v_req.unit_rate
                       ELSE COALESCE(v_alloc.day_rate_snapshot,
                                     (SELECT day_rate FROM staff WHERE id = v_log.staff_id),
                                     v_req.estimated_day_rate) END;
    v_days := CASE WHEN v_log.hours_logged IS NOT NULL THEN v_log.hours_logged / 8.0 ELSE NULL END;
    v_note := CASE WHEN v_log.is_unallocated
                   THEN 'Unallocated time' || COALESCE(' — ' || v_log.notes, '')
                   ELSE v_log.notes END;

    INSERT INTO timesheet
      (staff_id, project_id, date, labor_tier, labor_allocation_id, labor_requisition_id,
       day_rate, days_worked, volume_completed, gang_size, gang_member_staff_ids,
       overtime_hours, overtime_amount, notes)
    VALUES
      (v_log.staff_id, v_log.project_id, v_log.log_date, v_tier, v_alloc.id, v_alloc.labor_requisition_id,
       v_day_rate, v_days, v_log.volume_completed, v_log.gang_size, v_log.gang_member_staff_ids,
       v_log.overtime_hours, v_log.overtime_amount, v_note)
    RETURNING id INTO v_ts_id;

    UPDATE wo_attendance_log SET synced_timesheet_id = v_ts_id WHERE id = v_log.id;
    v_repaired := v_repaired + 1;
  END LOOP;

  RETURN QUERY SELECT v_repaired, v_skipped;
END $function$;

COMMENT ON FUNCTION public.resync_wo_attendance_timesheets IS
  'Rebuilds the timesheet row behind any wo_attendance_log whose synced_timesheet_id is NULL, replaying sync_wo_attendance_before()''s own INSERT logic. Re-links to an existing timesheet row for the same worker/project/day where one is present. Work-order costing reads that link, so a broken one silently understates labor cost.';

-- Repair the 285 links broken by 263/264.
SELECT * FROM public.resync_wo_attendance_timesheets();

-- ── Stop this failing silently again
--
-- ON DELETE SET NULL is what turned a delete into quiet data loss: the
-- delete succeeded, the link vanished, and work-order costing simply
-- reported a smaller number. RESTRICT makes the same mistake fail loudly
-- at the point it's made.
--
-- The legitimate deletion path is unaffected. Attendance is removed by
-- deleting the wo_attendance_log row; sync_wo_attendance_after() then
-- deletes the timesheet row from an AFTER DELETE trigger, by which point
-- the referencing row is already gone and RESTRICT has nothing to object
-- to. Verified both ways before applying: a direct timesheet delete is now
-- rejected by the constraint, while deleting an attendance log still
-- succeeds and still cleans up its timesheet row.
ALTER TABLE wo_attendance_log DROP CONSTRAINT wo_attendance_log_synced_timesheet_id_fkey;
ALTER TABLE wo_attendance_log ADD CONSTRAINT wo_attendance_log_synced_timesheet_id_fkey
  FOREIGN KEY (synced_timesheet_id) REFERENCES timesheet(id) ON DELETE RESTRICT;
