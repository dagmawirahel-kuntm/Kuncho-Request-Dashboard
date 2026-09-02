-- 263 — Labor rollups were double-counting days. Root cause: a fan-out join.
--
-- Reported as "the timesheet is counting double" on Solomon Apartment.
-- Measured for the 2026-08-24 → 2026-08-29 week: the real attendance is
-- 113 worker-days, but the rollup counted 223 — 22 of 23 worker/requisition
-- pairs inflated, some ×3 and ×4.
--
-- It is NOT duplicate timesheet data. The per_day branch of
-- rollup_labor_timesheets_to_expense reads timesheet_attendance and joins:
--
--     LEFT JOIN labor_allocations la
--       ON la.staff_id = att.staff_id AND la.project_id = v_req.project_id
--
-- staff_id + project_id is not unique — a worker who has been allocated to
-- the same project more than once has several matching rows, and the join
-- multiplies every attendance row by that count. Each copy then counts as
-- another full day at `1::numeric AS days_worked`. 24 workers on this
-- project carry more than one allocation, which is exactly why the week
-- came out at almost precisely double.
--
-- The join only ever needed ONE thing from labor_allocations —
-- day_rate_snapshot — so it becomes a LATERAL that returns at most one
-- row, preferring the allocation actually belonging to this requisition
-- (the correct rate) and otherwise the most recent one on the project.
--
-- The other two branches are unaffected and left alone: the timesheet
-- branch joins allocations on `la.id = ts.labor_allocation_id` (a primary
-- key, so at most one row), and the per_volume branch doesn't join
-- allocations at all.
--
-- Note this bug gets *more* likely over time: migration 261 lets one
-- requisition allocate several roster workers, so repeat allocations per
-- worker/project are now the normal case rather than the exception.

CREATE OR REPLACE FUNCTION public.rollup_labor_timesheets_to_expense(p_labor_requisition_id uuid, p_period_start date, p_period_end date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    WHERE ts.labor_requisition_id = p_labor_requisition_id
      AND ts.rolled_up_expense_id IS NULL
      AND ts.date BETWEEN p_period_start AND p_period_end
      AND ts.staff_id IS NOT NULL
      AND COALESCE(ts.volume_completed, 0) > 0
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
      -- Joined on the allocation's primary key: at most one row, no fan-out.
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
      -- LATERAL, not a plain join: staff_id + project_id matches every
      -- allocation that worker has ever had on the project, and a plain
      -- join multiplied each attendance row by that count — one extra
      -- full day per duplicate. Only day_rate_snapshot was ever needed,
      -- so take exactly one row: this requisition's allocation when there
      -- is one (the right rate), else the most recent on the project.
      LEFT JOIN LATERAL (
        SELECT la2.day_rate_snapshot
        FROM labor_allocations la2
        WHERE la2.staff_id = att.staff_id
          AND la2.project_id = v_req.project_id
        ORDER BY (la2.labor_requisition_id = p_labor_requisition_id) DESC,
                 la2.start_date DESC
        LIMIT 1
      ) la ON true
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

-- ── One-time data cleanup: the visible duplicate rows on Solomon Apartment
--
-- Separately from the fan-out, the same worker-day is recorded twice on
-- this project: once as a timesheet row and once as a timesheet_attendance
-- row, created seconds apart. That's what shows as a doubled line on the
-- timesheet screen. These timesheet rows are inert for the per_day rollup
-- (it requires check_in_time/check_out_time, which are NULL on all of
-- them) but they are real duplicates on screen, and would start
-- double-counting for real the moment anyone filled in a check-in time.
--
-- Deliberately NOT a blanket delete of every overlapping row. Kept:
--   * rows carrying volume_completed — per-volume work that
--     timesheet_attendance has no column for, so deleting would destroy it
--     and break the per_volume rollups (30 rows)
--   * rows already tied to a rolled-up expense, including the settled
--     2026-08-17 → 2026-08-23 week (6 rows)
--   * rows with days_worked <> 1, overtime, notes, gang data or a payroll
--     link — anything the attendance row doesn't already imply
-- leaving 265 of 296 genuinely redundant rows to remove.
DELETE FROM timesheet ts
WHERE ts.project_id = 'e43f2beb-e1c8-45e8-9eba-c6b382d669e9'
  AND EXISTS (
    SELECT 1 FROM timesheet_attendance att
    WHERE att.staff_id = ts.staff_id
      AND att.work_date = ts.date
      AND att.labor_requisition_id IS NOT DISTINCT FROM ts.labor_requisition_id
  )
  AND ts.check_in_time IS NULL AND ts.check_out_time IS NULL
  AND COALESCE(ts.volume_completed, 0) = 0
  AND ts.rolled_up_expense_id IS NULL
  AND ts.payroll_id IS NULL
  AND COALESCE(ts.overtime_hours, 0) = 0
  AND COALESCE(ts.overtime_amount, 0) = 0
  AND ts.notes IS NULL
  AND ts.gang_size IS NULL
  AND COALESCE(ts.days_worked, 1) = 1;

-- ── Archive settled rollup drafts
-- A paid rollup has nothing left for finance to do, but the Labor Expense
-- Drafts queue still listed it forever. Archiving clears the queue without
-- deleting anything; the page keeps a "Show archived" toggle.
UPDATE expenses
   SET is_archived = true
 WHERE rolled_up_from_requisition_id IS NOT NULL
   AND payment_state = 'paid'
   AND is_archived = false;
