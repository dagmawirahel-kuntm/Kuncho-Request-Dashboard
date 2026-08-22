-- Site foremen log Tier 2 attendance through wo_attendance_log
-- (LogAttendancePage.tsx), which only ever accepted hours. A gang hired
-- under a `per_volume` labor_requisition (paid unit_rate × volume, often
-- routed to the gang leader as a vendor via payment_model='gang_leader')
-- had no way to log what they produced — the input was hours-only, and
-- the only place that already understood volume (TimesheetFormPage, at
-- /timesheet/new) is admin/HR/finance/exec-only, not reachable by a site
-- foreman doing daily attendance.
--
-- This adds volume_completed to wo_attendance_log alongside hours_logged
-- (exactly one of the two set, per row) and threads it through the sync
-- trigger into `timesheet.volume_completed`, the column the existing
-- per_volume rollup branch already reads.
--
-- Two more things needed fixing for that rollup to actually work once
-- fed real data:
--
-- 1. The per_volume branch still required
--    check_in_time/check_out_time IS NOT NULL on the `timesheet` row.
--    That gate matches the truly-legacy clock-in/out flow, but neither
--    entry point that's actually live today (this sync, or
--    TimesheetFormPage's volumetric form) reliably sets those — the
--    per_day branch already works around the same gap via the
--    timesheet_attendance union, but per_volume has no such fallback.
--    Confirmed live: with the gate in place, a synced per_volume day
--    would sit un-rollable forever. Dropped for the per_volume branch
--    only; per_day is untouched.
--
-- 2. rollup_labor_timesheets_to_expense's restoration in migration 214
--    (fixing the wrong-column INSERT) dropped the vendor_id/
--    paid_to_staff_id assignment migration 189 had — a real regression:
--    every gang_leader-model rollup since then created an expense with
--    no vendor_id, so the money was never routed to the gang leader.
--    Restored here.

SET search_path TO public;

-- ── 1. wo_attendance_log: volume alongside hours ─────────────────────
ALTER TABLE wo_attendance_log
  ADD COLUMN IF NOT EXISTS volume_completed numeric(12,2);

ALTER TABLE wo_attendance_log ALTER COLUMN hours_logged DROP NOT NULL;

ALTER TABLE wo_attendance_log DROP CONSTRAINT IF EXISTS wo_attendance_hours_or_volume_chk;
ALTER TABLE wo_attendance_log ADD CONSTRAINT wo_attendance_hours_or_volume_chk CHECK (
  (is_unallocated = true
    AND hours_logged IS NOT NULL AND hours_logged > 0 AND hours_logged <= 16
    AND volume_completed IS NULL)
  OR
  (is_unallocated = false AND (
    (hours_logged IS NOT NULL AND hours_logged > 0 AND hours_logged <= 16 AND volume_completed IS NULL)
    OR
    (volume_completed IS NOT NULL AND volume_completed > 0 AND hours_logged IS NULL)
  ))
);

COMMENT ON COLUMN wo_attendance_log.volume_completed IS
  'Piece-work day: units produced (m³, m², pcs…) for a crew member on a per_volume labor_requisition. Mutually exclusive with hours_logged.';

-- ── 2. sync_wo_attendance_before: carry volume into timesheet ────────
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
      (staff_id, project_id, date, labor_tier, labor_allocation_id, labor_requisition_id, day_rate, days_worked, volume_completed, notes)
    VALUES
      (NEW.staff_id, NEW.project_id, NEW.log_date, v_tier, v_alloc.id, v_alloc.labor_requisition_id, v_day_rate, v_days, NEW.volume_completed, v_note)
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
      day_rate = v_day_rate, days_worked = v_days, volume_completed = NEW.volume_completed, notes = v_note, updated_at = now()
    WHERE id = NEW.synced_timesheet_id;
  END IF;

  RETURN NEW;
END $fn$;

-- ── 3. rollup_labor_timesheets_to_expense: drop dead gate, restore vendor routing ──
CREATE OR REPLACE FUNCTION public.rollup_labor_timesheets_to_expense(p_labor_requisition_id uuid, p_period_start date, p_period_end date)
RETURNS uuid LANGUAGE plpgsql SET search_path = 'public' AS $function$
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
  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_labor_requisition_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition % not found', p_labor_requisition_id; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'Requisition must be approved before rollup (current: %)', v_req.status; END IF;

  SELECT id INTO v_existing_id FROM expenses
   WHERE rolled_up_from_requisition_id = p_labor_requisition_id
     AND rollup_period_start = p_period_start AND rollup_period_end = p_period_end;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rollup_workers (
    staff_id uuid, days_worked numeric, day_rate numeric, subtotal numeric
  ) ON COMMIT DROP;
  DELETE FROM _rollup_workers;

  IF v_req.payment_basis = 'per_volume' THEN
    -- Piece-work: pay unit_rate × sum(volume_completed) per worker. No
    -- check_in/check_out gate here — neither live entry path (the WO
    -- attendance sync, or TimesheetFormPage's volumetric form) reliably
    -- sets those, and unlike per_day there's no timesheet_attendance
    -- fallback to catch what the gate excludes.
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
    SELECT
      ts.staff_id,
      SUM(COALESCE(ts.volume_completed, 0)) AS days_worked,
      v_req.unit_rate AS day_rate,
      SUM(COALESCE(ts.volume_completed, 0)) * v_req.unit_rate AS subtotal
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
    -- per_day. Union: timesheet rows + attendance rows (days_worked=1 per row).
    -- Both sources feed the same temp table; aggregate to one row per staff.
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

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal)
  SELECT v_expense_id, w.staff_id, w.days_worked, w.day_rate, w.subtotal FROM _rollup_workers w;

  -- Mark exactly the rows that fed the total above as rolled up — matching
  -- each branch's own filter, not just staff_id, so an incomplete row for
  -- the same worker/period (e.g. per_day without a check-out) that wasn't
  -- actually counted doesn't get silently marked paid alongside it.
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
