-- 247 added overtime to `timesheet`, but that's the dead branch for
-- Tier 2 casual workers. Confirmed live on the Solomon Apartment batch:
-- all 34 workers are tier_2_casual, and 0 of their `timesheet` rows
-- have check_in_time/check_out_time set (wo_attendance_log's sync never
-- sets those columns), so they never match
-- rollup_labor_timesheets_to_expense's `ts` branch at all. Every one of
-- them was actually rolled up and paid through `timesheet_attendance`
-- (the legacy Tier 2 grid, still fed by sync_wo_attendance_after for
-- every tier_2_casual entry) -- which has no overtime columns, and the
-- rollup's second UNION branch hardcodes overtime to 0. So the overtime
-- feature shipped in 247 silently does nothing for the majority of real
-- site labor.
--
-- Fix: thread overtime through timesheet_attendance the same way, and
-- pull real values in the rollup's second branch instead of the 0
-- placeholders.

SET search_path TO public;

ALTER TABLE timesheet_attendance ADD COLUMN IF NOT EXISTS overtime_hours numeric;
ALTER TABLE timesheet_attendance ADD COLUMN IF NOT EXISTS overtime_amount numeric;

-- ── sync_wo_attendance_after: carry overtime into timesheet_attendance ──
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
      SELECT labor_requisition_id INTO v_req_id FROM labor_allocations
       WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
       ORDER BY start_date DESC LIMIT 1;

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

-- ── rollup_labor_timesheets_to_expense: pull real OT from timesheet_attendance too ──
CREATE OR REPLACE FUNCTION public.rollup_labor_timesheets_to_expense(p_labor_requisition_id uuid, p_period_start date, p_period_end date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_req            labor_requisitions%ROWTYPE;
  v_existing_id    uuid;
  v_expense_id     uuid;
  v_total          numeric := 0;
  v_worker_count   int     := 0;
  v_days_or_vol    numeric := 0;
  v_project_name   text;
  v_desc           text;
  v_labor_category_id uuid := 'd9f67bf3-38ef-49d6-ad77-2869af9b6c82';
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin','executive','finance','hr_officer') THEN
    RAISE EXCEPTION 'Only admin, executive, finance, or HR may run a labor rollup';
  END IF;

  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_labor_requisition_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition % not found', p_labor_requisition_id; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'Requisition must be approved before rollup (current: %)', v_req.status; END IF;

  SELECT id INTO v_existing_id FROM expenses
   WHERE rolled_up_from_requisition_id = p_labor_requisition_id
     AND rollup_period_start = p_period_start AND rollup_period_end = p_period_end;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rollup_workers (
    staff_id uuid, days_worked numeric, day_rate numeric, subtotal numeric,
    gang_size integer, gang_member_names text, gang_member_staff_ids uuid[],
    overtime_hours numeric, overtime_amount numeric
  ) ON COMMIT DROP;
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS gang_size integer;
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS gang_member_names text;
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS gang_member_staff_ids uuid[];
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS overtime_hours numeric;
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS overtime_amount numeric;
  DELETE FROM _rollup_workers WHERE true;

  IF v_req.payment_basis = 'per_volume' THEN
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, gang_member_staff_ids)
    SELECT
      ts.staff_id,
      SUM(COALESCE(ts.volume_completed, 0)) AS days_worked,
      v_req.unit_rate AS day_rate,
      SUM(COALESCE(ts.volume_completed, 0)) * v_req.unit_rate AS subtotal,
      MAX(ts.gang_size) AS gang_size,
      (array_agg(ts.notes ORDER BY ts.date DESC) FILTER (WHERE ts.notes IS NOT NULL))[1] AS gang_member_names,
      (SELECT ts2.gang_member_staff_ids FROM timesheet ts2
        WHERE ts2.staff_id = ts.staff_id
          AND ts2.labor_requisition_id = p_labor_requisition_id
          AND ts2.date BETWEEN p_period_start AND p_period_end
          AND ts2.gang_member_staff_ids IS NOT NULL
        ORDER BY ts2.date DESC LIMIT 1) AS gang_member_staff_ids
    FROM timesheet ts
    LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
    WHERE ts.labor_requisition_id = p_labor_requisition_id
      AND ts.rolled_up_expense_id IS NULL
      AND ts.date BETWEEN p_period_start AND p_period_end
      AND ts.staff_id IS NOT NULL
      AND COALESCE(ts.volume_completed, 0) > 0
      AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
    GROUP BY ts.staff_id
    HAVING SUM(COALESCE(ts.volume_completed, 0)) > 0;
  ELSE
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal, overtime_hours, overtime_amount)
    SELECT
      combined.staff_id,
      SUM(combined.days_worked) AS days_worked,
      MAX(combined.day_rate)    AS day_rate,
      SUM(combined.days_worked) * MAX(combined.day_rate) + SUM(combined.overtime_amt) AS subtotal,
      NULLIF(SUM(combined.overtime_hrs), 0) AS overtime_hours,
      NULLIF(SUM(combined.overtime_amt), 0) AS overtime_amount
    FROM (
      SELECT
        ts.staff_id,
        COALESCE(ts.days_worked, 1)::numeric AS days_worked,
        COALESCE(ts.day_rate, la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate,
        COALESCE(ts.overtime_hours, 0)::numeric AS overtime_hrs,
        COALESCE(ts.overtime_amount, 0)::numeric AS overtime_amt
      FROM timesheet ts
      LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = ts.staff_id
      WHERE ts.labor_requisition_id = p_labor_requisition_id
        AND ts.rolled_up_expense_id IS NULL
        AND ts.date BETWEEN p_period_start AND p_period_end
        AND ts.check_in_time IS NOT NULL AND ts.check_out_time IS NOT NULL
        AND ts.staff_id IS NOT NULL
        AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
      UNION ALL
      SELECT
        att.staff_id,
        1::numeric AS days_worked,
        COALESCE(la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate,
        COALESCE(att.overtime_hours, 0)::numeric AS overtime_hrs,
        COALESCE(att.overtime_amount, 0)::numeric AS overtime_amt
      FROM timesheet_attendance att
      LEFT JOIN labor_allocations la ON la.staff_id = att.staff_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = att.staff_id
      WHERE att.labor_requisition_id = p_labor_requisition_id
        AND att.rolled_up_expense_id IS NULL
        AND att.work_date BETWEEN p_period_start AND p_period_end
    ) combined
    GROUP BY combined.staff_id;
  END IF;

  SELECT COALESCE(SUM(subtotal),0), COALESCE(SUM(GREATEST(COALESCE(gang_size,1),1)),0), COALESCE(SUM(days_worked),0)
    INTO v_total, v_worker_count, v_days_or_vol FROM _rollup_workers;

  IF v_worker_count = 0 THEN
    RAISE EXCEPTION 'No un-rolled timesheets found in period % to %', p_period_start, p_period_end;
  END IF;

  SELECT project_name INTO v_project_name FROM projects WHERE id = v_req.project_id;
  v_desc := format(
    CASE WHEN v_req.payment_basis = 'per_volume'
         THEN 'Labor payment: %s worker%s · %s %s (%s, %s → %s)'
         ELSE 'Labor payment: %s worker%s · %s day%s (%s, %s → %s)'
    END,
    v_worker_count, CASE WHEN v_worker_count=1 THEN '' ELSE 's' END,
    v_days_or_vol,
    CASE WHEN v_req.payment_basis = 'per_volume' THEN COALESCE(v_req.volume_unit,'units')
         ELSE CASE WHEN v_days_or_vol=1 THEN '' ELSE 's' END END,
    COALESCE(v_project_name,'—'), p_period_start, p_period_end);

  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, category_id, project_id, date,
    vendor_id, paid_to_staff_id,
    approval_status, payment_state,
    rolled_up_from_requisition_id, rollup_period_start, rollup_period_end
  ) VALUES (
    v_desc, v_total, 'labor_payment'::expense_category, v_labor_category_id, v_req.project_id, p_period_end,
    CASE WHEN v_req.payment_model = 'gang_leader' THEN v_req.gang_leader_vendor_id ELSE NULL END,
    CASE WHEN v_req.payment_model = 'individual' AND v_worker_count = 1
         THEN (SELECT staff_id FROM _rollup_workers LIMIT 1) ELSE NULL END,
    'pending'::expense_approval_status, 'unpaid',
    p_labor_requisition_id, p_period_start, p_period_end
  ) RETURNING id INTO v_expense_id;

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, gang_member_staff_ids, overtime_hours, overtime_amount)
  SELECT v_expense_id, w.staff_id, w.days_worked, w.day_rate, w.subtotal, w.gang_size, w.gang_member_names, w.gang_member_staff_ids, w.overtime_hours, w.overtime_amount FROM _rollup_workers w;

  IF v_req.payment_basis = 'per_volume' THEN
    UPDATE timesheet SET rolled_up_expense_id = v_expense_id
     WHERE labor_requisition_id = p_labor_requisition_id
       AND rolled_up_expense_id IS NULL
       AND date BETWEEN p_period_start AND p_period_end
       AND staff_id IN (SELECT staff_id FROM _rollup_workers)
       AND COALESCE(volume_completed, 0) > 0;
  ELSE
    UPDATE timesheet SET rolled_up_expense_id = v_expense_id
     WHERE labor_requisition_id = p_labor_requisition_id
       AND rolled_up_expense_id IS NULL
       AND date BETWEEN p_period_start AND p_period_end
       AND check_in_time IS NOT NULL AND check_out_time IS NOT NULL
       AND staff_id IN (SELECT staff_id FROM _rollup_workers);

    UPDATE timesheet_attendance SET rolled_up_expense_id = v_expense_id
     WHERE labor_requisition_id = p_labor_requisition_id
       AND rolled_up_expense_id IS NULL
       AND work_date BETWEEN p_period_start AND p_period_end
       AND staff_id IN (SELECT staff_id FROM _rollup_workers);
  END IF;

  RETURN v_expense_id;
END $function$;
