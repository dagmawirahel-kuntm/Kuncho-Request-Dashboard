-- Two problems surfaced live: (1) a "Gang total" attendance entry writes
-- volume against ONE anchor staff_id, so the rollup and every downstream
-- breakdown (Labor Expense Drafts, the printed Payment Request) showed
-- "1 worker" even when a 5-person gang was actually paid through the
-- gang leader. (2) The printed Payment Request is now the source of
-- truth for payments with no PO, so it needs to actually carry that
-- headcount and the rollup period, not just the anchor's own line.
--
-- Fix: thread a real headcount (gang_size) and the member list
-- (gang_member_names, reusing the "Gang: A, B, C" note already shown in
-- the UI but never persisted) from wo_attendance_log -> timesheet ->
-- labor_expense_workers, so every consumer of the rollup can see the
-- true worker count instead of just the one row that exists.

SET search_path TO public;

ALTER TABLE wo_attendance_log ADD COLUMN IF NOT EXISTS gang_size integer;
ALTER TABLE timesheet         ADD COLUMN IF NOT EXISTS gang_size integer;
ALTER TABLE labor_expense_workers
  ADD COLUMN IF NOT EXISTS gang_size integer,
  ADD COLUMN IF NOT EXISTS gang_member_names text;

COMMENT ON COLUMN wo_attendance_log.gang_size IS
  'Set only on a "Gang total" volume entry: how many workers this single anchored row actually covers (vs the 1 implied by having one staff_id).';
COMMENT ON COLUMN labor_expense_workers.gang_size IS
  'Real headcount this line represents, when it came from a gang-total attendance entry. NULL/1 = one real individual.';

-- ── sync_wo_attendance_before: carry gang_size into timesheet ────────
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
                     ELSE COALESCE(v_alloc.day_rate_snapshot, (SELECT day_rate FROM staff WHERE id = NEW.staff_id)) END;
  v_days := CASE WHEN NEW.hours_logged IS NOT NULL THEN NEW.hours_logged / 8.0 ELSE NULL END;
  v_note := CASE WHEN NEW.is_unallocated THEN 'Unallocated time' || COALESCE(' — ' || NEW.notes, '') ELSE NEW.notes END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO timesheet
      (staff_id, project_id, date, labor_tier, labor_allocation_id, labor_requisition_id, day_rate, days_worked, volume_completed, gang_size, notes)
    VALUES
      (NEW.staff_id, NEW.project_id, NEW.log_date, v_tier, v_alloc.id, v_alloc.labor_requisition_id, v_day_rate, v_days, NEW.volume_completed, NEW.gang_size, v_note)
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
      day_rate = v_day_rate, days_worked = v_days, volume_completed = NEW.volume_completed, gang_size = NEW.gang_size, notes = v_note, updated_at = now()
    WHERE id = NEW.synced_timesheet_id;
  END IF;

  RETURN NEW;
END $fn$;

-- ── preview_labor_rollup: real headcount, not row count ──────────────
CREATE OR REPLACE FUNCTION public.preview_labor_rollup(p_labor_requisition_id uuid, p_period_start date, p_period_end date)
RETURNS TABLE (worker_count integer, total_units numeric, unit_label text, total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_req labor_requisitions%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin','executive','finance','hr_officer') THEN
    RAISE EXCEPTION 'Only admin, executive, finance, or HR may preview a labor rollup';
  END IF;

  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_labor_requisition_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition % not found', p_labor_requisition_id; END IF;

  IF v_req.payment_basis = 'per_volume' THEN
    RETURN QUERY
    SELECT COALESCE(SUM(GREATEST(COALESCE(w.gang_size, 1), 1)), 0)::int,
           COALESCE(SUM(w.units), 0), COALESCE(v_req.volume_unit, 'units'),
           COALESCE(SUM(w.units), 0) * COALESCE(v_req.unit_rate, 0)
    FROM (
      SELECT ts.staff_id, SUM(COALESCE(ts.volume_completed, 0)) AS units, MAX(ts.gang_size) AS gang_size
      FROM timesheet ts
      LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
      WHERE ts.labor_requisition_id = p_labor_requisition_id
        AND ts.rolled_up_expense_id IS NULL
        AND ts.date BETWEEN p_period_start AND p_period_end
        AND ts.staff_id IS NOT NULL
        AND COALESCE(ts.volume_completed, 0) > 0
        AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
      GROUP BY ts.staff_id
      HAVING SUM(COALESCE(ts.volume_completed, 0)) > 0
    ) w;
  ELSE
    RETURN QUERY
    SELECT COUNT(*)::int, COALESCE(SUM(c.days), 0), 'days'::text, COALESCE(SUM(c.days * c.rate), 0)
    FROM (
      SELECT combined.staff_id, SUM(combined.days_worked) AS days, MAX(combined.day_rate) AS rate
      FROM (
        SELECT
          ts.staff_id,
          COALESCE(ts.days_worked, 1)::numeric AS days_worked,
          COALESCE(ts.day_rate, la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
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
          COALESCE(la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
        FROM timesheet_attendance att
        LEFT JOIN labor_allocations la ON la.staff_id = att.staff_id AND la.project_id = v_req.project_id
        LEFT JOIN staff s ON s.id = att.staff_id
        WHERE att.labor_requisition_id = p_labor_requisition_id
          AND att.rolled_up_expense_id IS NULL
          AND att.work_date BETWEEN p_period_start AND p_period_end
      ) combined
      GROUP BY combined.staff_id
    ) c;
  END IF;
END $function$;

-- ── rollup_labor_timesheets_to_expense: carry gang_size + member names ──
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
    gang_size integer, gang_member_names text
  ) ON COMMIT DROP;
  -- Reused across calls in the same pooled connection (see migration
  -- 221/235) — make sure a prior call's gang columns don't leak in if
  -- this session's temp table predates this migration.
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS gang_size integer;
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS gang_member_names text;
  DELETE FROM _rollup_workers WHERE true;

  IF v_req.payment_basis = 'per_volume' THEN
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names)
    SELECT
      ts.staff_id,
      SUM(COALESCE(ts.volume_completed, 0)) AS days_worked,
      v_req.unit_rate AS day_rate,
      SUM(COALESCE(ts.volume_completed, 0)) * v_req.unit_rate AS subtotal,
      MAX(ts.gang_size) AS gang_size,
      (array_agg(ts.notes ORDER BY ts.date DESC) FILTER (WHERE ts.notes IS NOT NULL))[1] AS gang_member_names
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
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
    SELECT
      combined.staff_id,
      SUM(combined.days_worked) AS days_worked,
      MAX(combined.day_rate)    AS day_rate,
      SUM(combined.days_worked) * MAX(combined.day_rate) AS subtotal
    FROM (
      SELECT
        ts.staff_id,
        COALESCE(ts.days_worked, 1)::numeric AS days_worked,
        COALESCE(ts.day_rate, la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
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
        COALESCE(la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
      FROM timesheet_attendance att
      LEFT JOIN labor_allocations la ON la.staff_id = att.staff_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = att.staff_id
      WHERE att.labor_requisition_id = p_labor_requisition_id
        AND att.rolled_up_expense_id IS NULL
        AND att.work_date BETWEEN p_period_start AND p_period_end
    ) combined
    GROUP BY combined.staff_id;
  END IF;

  SELECT COALESCE(SUM(subtotal),0), COUNT(*), COALESCE(SUM(days_worked),0)
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
    item_service_description, amount_etb, expense_type, project_id, date,
    vendor_id, paid_to_staff_id,
    approval_status, payment_state,
    rolled_up_from_requisition_id, rollup_period_start, rollup_period_end
  ) VALUES (
    v_desc, v_total, 'labor_payment'::expense_category, v_req.project_id, p_period_end,
    CASE WHEN v_req.payment_model = 'gang_leader' THEN v_req.gang_leader_vendor_id ELSE NULL END,
    CASE WHEN v_req.payment_model = 'individual' AND v_worker_count = 1
         THEN (SELECT staff_id FROM _rollup_workers LIMIT 1) ELSE NULL END,
    'pending'::expense_approval_status, 'unpaid',
    p_labor_requisition_id, p_period_start, p_period_end
  ) RETURNING id INTO v_expense_id;

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names)
  SELECT v_expense_id, w.staff_id, w.days_worked, w.day_rate, w.subtotal, w.gang_size, w.gang_member_names FROM _rollup_workers w;

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
