-- "The OT is not really registering to be rolled up under labor expense
-- draft" — traced live: the actual rollup (rollup_labor_timesheets_to_
-- expense) already folds overtime into each worker's subtotal
-- correctly (confirmed on an existing rolled expense: 1500 day rate +
-- 750 OT = 2250, and on a fresh dry run: 500 + 1200 OT = 1700 per
-- worker). What's broken is preview_labor_rollup's per_day branch — it
-- computes total_amount as SUM(days * rate) only, never adding
-- overtime_amt at all, even though its own `combined` subquery already
-- selects it. So the "Owes X" badge and the pre-rollup total on the
-- Labor Expense Drafts launcher understate every OT-bearing requisition
-- by exactly the OT amount (reproduced live: a 3-worker/2-OT
-- requisition previewed "Owes 1,500" when the true payable, and what
-- the real rollup actually produces, is 3,900) — reading as "the OT
-- isn't registering" even though it was captured correctly all along.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.preview_labor_rollup(p_labor_requisition_id uuid, p_period_start date, p_period_end date)
 RETURNS TABLE(worker_count integer, total_units numeric, unit_label text, total_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      WHERE ts.labor_requisition_id = p_labor_requisition_id
        AND ts.rolled_up_expense_id IS NULL
        AND ts.date BETWEEN p_period_start AND p_period_end
        AND ts.staff_id IS NOT NULL
        AND COALESCE(ts.volume_completed, 0) > 0
      GROUP BY ts.staff_id
      HAVING SUM(COALESCE(ts.volume_completed, 0)) > 0
    ) w;
  ELSE
    RETURN QUERY
    SELECT COUNT(*)::int, COALESCE(SUM(c.days), 0), 'days'::text,
           COALESCE(SUM(c.days * c.rate) + SUM(c.overtime_amt), 0)
    FROM (
      SELECT combined.staff_id, SUM(combined.days_worked) AS days, MAX(combined.day_rate) AS rate,
             SUM(combined.overtime_amt) AS overtime_amt
      FROM (
        SELECT
          ts.staff_id,
          COALESCE(ts.days_worked, 1)::numeric AS days_worked,
          COALESCE(ts.day_rate, la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate,
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
          COALESCE(att.overtime_amount, 0)::numeric AS overtime_amt
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
