-- Solomon needs three concurrent per-volume rates (Filler, Zecolo,
-- Ceramic Wall) all under one work order ("Ceramic Work"). The WO-scoped
-- rate resolution from 249 can't disambiguate between them by itself --
-- multiple active allocations would all match the same work_order_id,
-- so it'd fall back to picking whichever was created most recently,
-- same ambiguity as before. Per the agreed design: the foreman picks
-- which task a day's volume belongs to when there's more than one
-- option, instead of splitting into separate work orders.
--
-- Adds an explicit labor_requisition_id override on wo_attendance_log --
-- set only when the picker actually shows (i.e. the worker has 2+
-- active per_volume allocations on the same work order that day).
-- sync_wo_attendance_before now prefers this explicit value over the
-- inferred WO-match/most-recent lookup when present, and falls through
-- to the existing inference for every other case (a worker with a
-- single allocation never needs to pick anything, unchanged behavior).

SET search_path TO public;

ALTER TABLE wo_attendance_log ADD COLUMN IF NOT EXISTS labor_requisition_id uuid REFERENCES labor_requisitions(id) ON DELETE SET NULL;

COMMENT ON COLUMN wo_attendance_log.labor_requisition_id IS
  'Explicit task override for a worker with multiple concurrent active allocations on the same work order (e.g. several per-volume rates for different tasks). Only meaningful when set; otherwise the sync trigger infers the allocation as before.';

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

  IF NEW.labor_requisition_id IS NOT NULL THEN
    SELECT * INTO v_alloc FROM labor_allocations
     WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
       AND labor_requisition_id = NEW.labor_requisition_id
     ORDER BY start_date DESC LIMIT 1;
  END IF;

  IF v_alloc.id IS NULL AND NEW.work_order_id IS NOT NULL THEN
    SELECT la.* INTO v_alloc FROM labor_allocations la
    JOIN labor_requisitions r ON r.id = la.labor_requisition_id
    WHERE la.staff_id = NEW.staff_id AND la.project_id = NEW.project_id AND la.status = 'active'
      AND r.work_order_id = NEW.work_order_id
    ORDER BY la.start_date DESC LIMIT 1;
  END IF;

  IF v_alloc.id IS NULL THEN
    SELECT * INTO v_alloc FROM labor_allocations
     WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
     ORDER BY start_date DESC LIMIT 1;
  END IF;

  IF v_alloc.labor_requisition_id IS NOT NULL THEN
    SELECT * INTO v_req FROM labor_requisitions WHERE id = v_alloc.labor_requisition_id;
  END IF;

  v_day_rate := CASE WHEN v_req.payment_basis = 'per_volume' THEN v_req.unit_rate
                     ELSE COALESCE(v_alloc.day_rate_snapshot, (SELECT day_rate FROM staff WHERE id = NEW.staff_id), v_req.estimated_day_rate) END;
  v_days := CASE WHEN NEW.hours_logged IS NOT NULL THEN NEW.hours_logged / 8.0 ELSE NULL END;
  v_note := CASE WHEN NEW.is_unallocated THEN 'Unallocated time' || COALESCE(' — ' || NEW.notes, '') ELSE NEW.notes END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO timesheet
      (staff_id, project_id, date, labor_tier, labor_allocation_id, labor_requisition_id, day_rate, days_worked, volume_completed, gang_size, gang_member_staff_ids, overtime_hours, overtime_amount, notes)
    VALUES
      (NEW.staff_id, NEW.project_id, NEW.log_date, v_tier, v_alloc.id, v_alloc.labor_requisition_id, v_day_rate, v_days, NEW.volume_completed, NEW.gang_size, NEW.gang_member_staff_ids, NEW.overtime_hours, NEW.overtime_amount, v_note)
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
      gang_size = NEW.gang_size, gang_member_staff_ids = NEW.gang_member_staff_ids,
      overtime_hours = NEW.overtime_hours, overtime_amount = NEW.overtime_amount,
      notes = v_note, updated_at = now()
    WHERE id = NEW.synced_timesheet_id;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_2_sync_wo_attendance_before ON wo_attendance_log;
CREATE TRIGGER trg_2_sync_wo_attendance_before
  BEFORE INSERT OR UPDATE OF work_order_id, staff_id, project_id, log_date, hours_logged, is_unallocated, notes, volume_completed, gang_size, gang_member_staff_ids, overtime_hours, overtime_amount, labor_requisition_id
  ON wo_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_wo_attendance_before();

-- ── sync_wo_attendance_after: same explicit-override preference ──────
CREATE OR REPLACE FUNCTION public.sync_wo_attendance_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_emp_type    text;
  v_req_id      uuid;
  v_other_exists boolean;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT employment_type INTO v_emp_type FROM staff WHERE id = NEW.staff_id;
    IF v_emp_type = 'tier_2_casual' AND NOT NEW.is_unallocated THEN
      v_req_id := NEW.labor_requisition_id;

      IF v_req_id IS NULL AND NEW.work_order_id IS NOT NULL THEN
        SELECT la.labor_requisition_id INTO v_req_id FROM labor_allocations la
        JOIN labor_requisitions r ON r.id = la.labor_requisition_id
        WHERE la.staff_id = NEW.staff_id AND la.project_id = NEW.project_id AND la.status = 'active'
          AND r.work_order_id = NEW.work_order_id
        ORDER BY la.start_date DESC LIMIT 1;
      END IF;
      IF v_req_id IS NULL THEN
        SELECT labor_requisition_id INTO v_req_id FROM labor_allocations
         WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
         ORDER BY start_date DESC LIMIT 1;
      END IF;

      INSERT INTO timesheet_attendance (staff_id, project_id, work_date, labor_requisition_id, overtime_hours, overtime_amount, created_by)
      VALUES (NEW.staff_id, NEW.project_id, NEW.log_date, v_req_id, NEW.overtime_hours, NEW.overtime_amount, NEW.logged_by_staff_id)
      ON CONFLICT (staff_id, project_id, work_date) DO UPDATE
        SET labor_requisition_id = EXCLUDED.labor_requisition_id,
            overtime_hours = EXCLUDED.overtime_hours,
            overtime_amount = EXCLUDED.overtime_amount
        WHERE timesheet_attendance.rolled_up_expense_id IS NULL;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM timesheet WHERE id = OLD.synced_timesheet_id AND rolled_up_expense_id IS NOT NULL)
       OR EXISTS (
         SELECT 1 FROM timesheet_attendance
         WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND work_date = OLD.log_date
           AND rolled_up_expense_id IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'This attendance entry has already been rolled up into a paid labor expense and can no longer be removed';
    END IF;

    SELECT employment_type INTO v_emp_type FROM staff WHERE id = OLD.staff_id;
    IF v_emp_type = 'tier_2_casual' AND NOT OLD.is_unallocated THEN
      SELECT EXISTS (
        SELECT 1 FROM wo_attendance_log
        WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND log_date = OLD.log_date
          AND is_unallocated = false AND id <> OLD.id
      ) INTO v_other_exists;
      IF NOT v_other_exists THEN
        DELETE FROM timesheet_attendance
         WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND work_date = OLD.log_date;
      END IF;
    END IF;
    IF OLD.synced_timesheet_id IS NOT NULL THEN
      DELETE FROM timesheet WHERE id = OLD.synced_timesheet_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;
