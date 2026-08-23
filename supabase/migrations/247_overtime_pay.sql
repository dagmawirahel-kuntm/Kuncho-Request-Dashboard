-- Overtime capture, per the agreed design: logged on the same daily
-- attendance entry as regular hours (no separate approval step), for
-- per_day workers only (Tier 1 + Tier 2 per_day -- not per_volume/gang,
-- where "hours" isn't how they're paid). The extra pay is an editable
-- amount, not a rigid formula -- the UI suggests 1.5x hourly rate x OT
-- hours as a starting point, but what's actually stored is whatever
-- amount was agreed, since real OT deals vary.
--
-- Threaded the same way gang_size/volume_completed already are:
-- wo_attendance_log -> timesheet -> labor_expense_workers, so the
-- existing rollup/payment/document pipeline just picks it up.
--
-- Also fixes the same latent gap flagged earlier but never actioned:
-- trg_2_sync_wo_attendance_before's UPDATE OF column list was missing
-- volume_completed/gang_size/gang_member_staff_ids (only masked because
-- the UI always also touched notes in the same update) -- adding the
-- full list now that overtime needs to be in it too, rather than
-- leaving the old gap in place.

SET search_path TO public;

ALTER TABLE wo_attendance_log     ADD COLUMN IF NOT EXISTS overtime_hours numeric;
ALTER TABLE wo_attendance_log     ADD COLUMN IF NOT EXISTS overtime_amount numeric;
ALTER TABLE timesheet             ADD COLUMN IF NOT EXISTS overtime_hours numeric;
ALTER TABLE timesheet             ADD COLUMN IF NOT EXISTS overtime_amount numeric;
ALTER TABLE labor_expense_workers ADD COLUMN IF NOT EXISTS overtime_hours numeric;
ALTER TABLE labor_expense_workers ADD COLUMN IF NOT EXISTS overtime_amount numeric;

COMMENT ON COLUMN wo_attendance_log.overtime_amount IS
  'Agreed extra pay for overtime hours worked that day, on top of the normal day rate. Amount is entered directly (a suggested 1.5x formula is only a UI starting point) since real OT deals vary.';

-- ── sync_wo_attendance_before: carry overtime too ─────────────────────
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
  BEFORE INSERT OR UPDATE OF work_order_id, staff_id, project_id, log_date, hours_logged, is_unallocated, notes, volume_completed, gang_size, gang_member_staff_ids, overtime_hours, overtime_amount
  ON wo_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_wo_attendance_before();

-- ── rollup_labor_timesheets_to_expense: fold overtime into per_day pay ──
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
        0::numeric AS overtime_hrs,
        0::numeric AS overtime_amt
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

-- ── v_work_order_cost: include overtime in actual incurred cost ──────
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
    SUM(COALESCE(ts.days_worked, 0) * COALESCE(ts.day_rate, 0) + COALESCE(ts.volume_completed, 0) * COALESCE(ts.day_rate, 0) + COALESCE(ts.overtime_amount, 0)) AS total
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
