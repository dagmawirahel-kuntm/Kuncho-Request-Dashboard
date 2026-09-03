-- timesheet_attendance's UNIQUE(staff_id, project_id, work_date) meant
-- every wo_attendance_log row for a tier-2 casual worker on a given day
-- upserted the SAME summary row, so a person with more than one task the
-- same day (Besufekad: Ceramic Works + Silcon Works, both per_day, plus a
-- per-volume Worker task, all on Mesob Kitchen) had every task but the
-- last-synced one silently overwritten. The per_day rollup path
-- (rollup_labor_timesheets_to_expense / preview_labor_rollup) reads
-- timesheet_attendance for tier-2 workers precisely because their
-- wo_attendance_log-sourced timesheet rows have no check_in/check_out —
-- so the overwritten task could never be rolled up: "No un-rolled
-- timesheets found" even though wo_attendance_log had the real data the
-- whole time. Confirmed live: Besufekad's Aug 24 Ceramic Works row
-- survived, but Silcon Works' Aug 24 and Aug 25 rows were both
-- overwritten by later Worker-task syncs.
--
-- Same split as wo_attendance_log's own index (migration 272): rows with
-- no linked requisition keep the original one-row-per-day guarantee;
-- rows tied to a specific requisition get one row per (staff, project,
-- day, requisition), so multiple tasks the same day get independent
-- summary rows instead of colliding.

ALTER TABLE timesheet_attendance DROP CONSTRAINT IF EXISTS timesheet_attendance_staff_id_project_id_work_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheet_attendance_no_req
  ON timesheet_attendance (staff_id, project_id, work_date)
  WHERE labor_requisition_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheet_attendance_per_req
  ON timesheet_attendance (staff_id, project_id, work_date, labor_requisition_id)
  WHERE labor_requisition_id IS NOT NULL;

-- sync_wo_attendance_after: pick the matching conflict target depending on
-- whether a requisition was resolved for this row, and scope delete-time
-- cleanup to the specific (staff, project, day, requisition) combination
-- instead of to the whole day.
CREATE OR REPLACE FUNCTION public.sync_wo_attendance_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

      IF v_req_id IS NOT NULL THEN
        INSERT INTO timesheet_attendance (staff_id, project_id, work_date, labor_requisition_id, overtime_hours, overtime_amount, created_by)
        VALUES (NEW.staff_id, NEW.project_id, NEW.log_date, v_req_id, NEW.overtime_hours, NEW.overtime_amount, NEW.logged_by_staff_id)
        ON CONFLICT (staff_id, project_id, work_date, labor_requisition_id) WHERE labor_requisition_id IS NOT NULL DO UPDATE
          SET overtime_hours = EXCLUDED.overtime_hours,
              overtime_amount = EXCLUDED.overtime_amount
          WHERE timesheet_attendance.rolled_up_expense_id IS NULL;
      ELSE
        INSERT INTO timesheet_attendance (staff_id, project_id, work_date, labor_requisition_id, overtime_hours, overtime_amount, created_by)
        VALUES (NEW.staff_id, NEW.project_id, NEW.log_date, NULL, NEW.overtime_hours, NEW.overtime_amount, NEW.logged_by_staff_id)
        ON CONFLICT (staff_id, project_id, work_date) WHERE labor_requisition_id IS NULL DO UPDATE
          SET overtime_hours = EXCLUDED.overtime_hours,
              overtime_amount = EXCLUDED.overtime_amount
          WHERE timesheet_attendance.rolled_up_expense_id IS NULL;
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM timesheet WHERE id = OLD.synced_timesheet_id AND rolled_up_expense_id IS NOT NULL)
       OR EXISTS (
         SELECT 1 FROM timesheet_attendance
         WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND work_date = OLD.log_date
           AND labor_requisition_id IS NOT DISTINCT FROM OLD.labor_requisition_id
           AND rolled_up_expense_id IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'This attendance entry has already been rolled up into a paid labor expense and can no longer be removed';
    END IF;

    SELECT employment_type INTO v_emp_type FROM staff WHERE id = OLD.staff_id;
    IF v_emp_type = 'tier_2_casual' AND NOT OLD.is_unallocated THEN
      v_req_id := OLD.labor_requisition_id;
      IF v_req_id IS NULL AND OLD.work_order_id IS NOT NULL THEN
        SELECT la.labor_requisition_id INTO v_req_id FROM labor_allocations la
        JOIN labor_requisitions r ON r.id = la.labor_requisition_id
        WHERE la.staff_id = OLD.staff_id AND la.project_id = OLD.project_id AND la.status = 'active'
          AND r.work_order_id = OLD.work_order_id
        ORDER BY la.start_date DESC LIMIT 1;
      END IF;
      IF v_req_id IS NULL THEN
        SELECT labor_requisition_id INTO v_req_id FROM labor_allocations
         WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND status = 'active'
         ORDER BY start_date DESC LIMIT 1;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM wo_attendance_log
        WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND log_date = OLD.log_date
          AND is_unallocated = false AND id <> OLD.id
          AND labor_requisition_id IS NOT DISTINCT FROM OLD.labor_requisition_id
      ) INTO v_other_exists;
      IF NOT v_other_exists THEN
        DELETE FROM timesheet_attendance
         WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND work_date = OLD.log_date
           AND labor_requisition_id IS NOT DISTINCT FROM v_req_id;
      END IF;
    END IF;
    IF OLD.synced_timesheet_id IS NOT NULL THEN
      DELETE FROM timesheet WHERE id = OLD.synced_timesheet_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;
