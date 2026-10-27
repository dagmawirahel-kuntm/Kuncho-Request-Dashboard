-- 476: Project → work order → people → work done, in one place each.
--
--   labour_entry_costs(project, work order)  every day of work with what it costs:
--       day records (375) priced as pay sheets price them — hours ÷ 8 × the
--       worker's rate, overtime by 458's rules, quantity × unit rate, % × the
--       task price — and the older work-order attendance at its timesheet cost.
--   work_order_people(work order)            the work order's people: everyone on its crew
--       or recorded on it, with days, hours, overtime, cost, last day and the
--       labour requests that pay them.
--   project_work_board(project)              one row per work order: crew, who worked
--       today, person-days this week and in all, labour cost against the
--       labour planned on its requests, progress, and what looks wrong;
--       plus the labour on requests not linked to any work order.
--   labour_quiet_requests()                  open labour requests with no work recorded
--       for three weeks, for the Labour screen to end by hand.
-- Costs are shown to admin, executive, finance, operations, HR and the
-- project's manager; others see days and hours only.

CREATE OR REPLACE FUNCTION public.labour_can_see_costs(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'finance', 'operations_manager', 'hr_officer'), false)
      OR is_ops_manager() OR manages_project(p_project);
$function$;

CREATE OR REPLACE FUNCTION public.labour_entry_costs(p_project uuid DEFAULT NULL, p_wo uuid DEFAULT NULL)
RETURNS TABLE (source text, entry_id uuid, labor_requisition_id uuid, work_order_id uuid, project_id uuid, staff_id uuid,
  work_date date, hours numeric, overtime_hours numeric, quantity numeric, percent_done numeric, cost numeric, confirmed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT 'day', e.id, e.labor_requisition_id, r.work_order_id, e.project_id, e.staff_id, e.work_date,
         COALESCE(e.hours, 0), COALESCE(e.overtime_hours, 0), e.quantity, e.percent_done,
         round(CASE r.payment_basis
           WHEN 'per_day' THEN COALESCE(e.hours, 0) / 8 * labour_worker_day_rate(r.id, e.staff_id)
             + CASE WHEN COALESCE(e.overtime_hours, 0) = 0 THEN 0
                    WHEN e.overtime_agreed_amount IS NOT NULL THEN e.overtime_agreed_amount
                    WHEN o.rule = 'per_hour' THEN e.overtime_hours * o.hour_rate
                    ELSE (e.overtime_hours - e.overtime_night_hours) * labour_worker_day_rate(r.id, e.staff_id) / 8 * o.multiplier
                       + e.overtime_night_hours * labour_worker_day_rate(r.id, e.staff_id) / 8 * o.night_multiplier END
           WHEN 'per_volume' THEN COALESCE(e.quantity, 0) * COALESCE(r.unit_rate, 0)
           ELSE COALESCE(e.percent_done, 0) / 100 * COALESCE(r.fixed_price_amount, 0) END, 2),
         e.pay_sheet_id IS NOT NULL
    FROM labour_work_entries e
    JOIN labor_requisitions r ON r.id = e.labor_requisition_id
    LEFT JOIN LATERAL (SELECT * FROM labour_overtime_rates(r.id, e.work_date)) o ON COALESCE(e.overtime_hours, 0) > 0
   WHERE (p_project IS NULL OR e.project_id = p_project) AND (p_wo IS NULL OR r.work_order_id = p_wo)
  UNION ALL
  SELECT 'legacy', l.id, ts.labor_requisition_id, l.work_order_id, l.project_id, l.staff_id, l.log_date,
         COALESCE(l.hours_logged, 0), COALESCE(l.overtime_hours, 0), l.volume_completed, NULL,
         round(COALESCE(ts.days_worked, 0) * COALESCE(ts.day_rate, 0) + COALESCE(ts.volume_completed, 0) * COALESCE(ts.day_rate, 0)
               + COALESCE(ts.overtime_amount, 0), 2),
         ts.rolled_up_expense_id IS NOT NULL
    FROM wo_attendance_log l
    LEFT JOIN timesheet ts ON ts.id = l.synced_timesheet_id
   WHERE (p_project IS NULL OR l.project_id = p_project) AND (p_wo IS NULL OR l.work_order_id = p_wo)
     AND (COALESCE(l.hours_logged, 0) > 0 OR COALESCE(l.volume_completed, 0) > 0);
$function$;
REVOKE EXECUTE ON FUNCTION labour_entry_costs(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── The work order's people ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.work_order_people(p_wo uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE w work_orders%ROWTYPE; v_costs boolean; v jsonb; v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  SELECT * INTO w FROM work_orders WHERE id = p_wo;
  IF NOT FOUND OR auth.uid() IS NULL THEN RETURN NULL; END IF;
  v_costs := labour_can_see_costs(w.project_id);

  WITH c AS (SELECT * FROM labour_entry_costs(NULL, p_wo)),
  crew AS (
    SELECT staff_id, min(assigned_at)::date AS since, bool_or(removed_at IS NULL) AS on_crew,
           (array_agg(role_on_wo ORDER BY assigned_at DESC) FILTER (WHERE role_on_wo IS NOT NULL))[1] AS role
      FROM work_order_crew WHERE work_order_id = p_wo GROUP BY staff_id
  ), work AS (
    SELECT staff_id, count(DISTINCT work_date) AS days, sum(hours) AS hours, sum(overtime_hours) AS ot,
           sum(cost) AS cost, sum(cost) FILTER (WHERE NOT confirmed) AS unconfirmed,
           max(work_date) AS last_day, min(work_date) AS first_day,
           sum(hours + overtime_hours) FILTER (WHERE work_date = v_today) AS today,
           sum(quantity) AS quantity
      FROM c GROUP BY staff_id
  ), reqs AS (
    SELECT a.staff_id, jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'role', r.role_needed,
             'open', r.status = 'approved' AND r.closed_at IS NULL AND a.status = 'active')) AS requests
      FROM labor_allocations a JOIN labor_requisitions r ON r.id = a.labor_requisition_id
     WHERE r.work_order_id = p_wo GROUP BY a.staff_id
  ), ppl AS (
    SELECT COALESCE(crew.staff_id, work.staff_id) AS staff_id FROM crew FULL JOIN work ON work.staff_id = crew.staff_id
  )
  SELECT jsonb_build_object(
    'people', COALESCE(jsonb_agg(jsonb_build_object(
        'staff_id', p.staff_id,
        'name', COALESCE(s.employee_name, 'The crew'),
        'trade', s.trade_tag, 'casual', s.employment_type = 'tier_2_casual',
        'role', COALESCE(crew.role, (SELECT r.role_needed FROM labor_allocations a JOIN labor_requisitions r ON r.id = a.labor_requisition_id
                                      WHERE a.staff_id = p.staff_id AND r.work_order_id = p_wo ORDER BY a.created_at DESC LIMIT 1)),
        'is_lead', p.staff_id = w.assigned_lead_staff_id,
        'on_crew', COALESCE(crew.on_crew, false), 'since', crew.since,
        'days', COALESCE(work.days, 0), 'hours', COALESCE(work.hours, 0), 'overtime_hours', COALESCE(work.ot, 0),
        'quantity', work.quantity, 'today', work.today,
        'first_day', work.first_day, 'last_day', work.last_day,
        'cost', CASE WHEN v_costs THEN COALESCE(work.cost, 0) END,
        'unconfirmed', CASE WHEN v_costs THEN COALESCE(work.unconfirmed, 0) END,
        'requests', COALESCE(reqs.requests, '[]'::jsonb))
      ORDER BY COALESCE(crew.on_crew, false) DESC, (p.staff_id = w.assigned_lead_staff_id) DESC NULLS LAST,
               work.last_day DESC NULLS LAST, s.employee_name), '[]'::jsonb),
    'costs_visible', v_costs)
    INTO v
    FROM ppl p
    LEFT JOIN crew ON crew.staff_id IS NOT DISTINCT FROM p.staff_id
    LEFT JOIN work ON work.staff_id IS NOT DISTINCT FROM p.staff_id
    LEFT JOIN reqs ON reqs.staff_id = p.staff_id
    LEFT JOIN staff s ON s.id = p.staff_id;
  RETURN v;
END $function$;
GRANT EXECUTE ON FUNCTION work_order_people(uuid) TO authenticated;

-- ── The project's work orders, side by side ──────────────────────────
CREATE OR REPLACE FUNCTION public.project_work_board(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_costs boolean; v jsonb; v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  v_costs := labour_can_see_costs(p_project);

  WITH c AS (SELECT * FROM labour_entry_costs(p_project, NULL)),
  per_wo AS (
    SELECT work_order_id,
           count(DISTINCT (staff_id, work_date)) AS person_days,
           count(DISTINCT (staff_id, work_date)) FILTER (WHERE work_date > v_today - 7) AS week_days,
           count(DISTINCT staff_id) FILTER (WHERE work_date = v_today) AS today,
           sum(cost) AS cost, max(work_date) AS last_worked
      FROM c WHERE work_order_id IS NOT NULL GROUP BY work_order_id
  ), planned AS (
    SELECT work_order_id, sum(COALESCE(estimated_total_cost,
             CASE payment_basis
               WHEN 'per_day' THEN estimated_day_rate * estimated_days * GREATEST(headcount, 1)
               WHEN 'per_volume' THEN unit_rate * estimated_total_volume
               ELSE fixed_price_amount END)) AS planned
      FROM labor_requisitions WHERE work_order_id IS NOT NULL AND status = 'approved' AND project_id = p_project
     GROUP BY work_order_id
  ), rows AS (
    SELECT w.id, COALESCE(NULLIF(btrim(w.title), ''), left(w.scope_of_work, 80), 'Work order') AS title, w.status,
           w.current_progress_pct AS progress, w.target_completion_date AS due,
           (SELECT employee_name FROM staff WHERE id = w.assigned_lead_staff_id) AS lead,
           (SELECT count(*) FROM work_order_crew cr WHERE cr.work_order_id = w.id AND cr.removed_at IS NULL) AS crew,
           COALESCE(pw.today, 0) AS today, COALESCE(pw.week_days, 0) AS week_days, COALESCE(pw.person_days, 0) AS person_days,
           pw.cost, pl.planned, pw.last_worked,
           (SELECT max(u.created_at) FROM wo_progress_updates u WHERE u.work_order_id = w.id) AS last_update
      FROM work_orders w
      LEFT JOIN per_wo pw ON pw.work_order_id = w.id
      LEFT JOIN planned pl ON pl.work_order_id = w.id
     WHERE w.project_id = p_project
  )
  SELECT jsonb_build_object(
    'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'status', status, 'progress', progress, 'due', due, 'lead', lead,
        'crew', crew, 'today', today, 'week_days', week_days, 'person_days', person_days,
        'cost', CASE WHEN v_costs THEN COALESCE(cost, 0) END,
        'planned', CASE WHEN v_costs THEN planned END,
        'spent_pct', CASE WHEN v_costs AND planned > 0 THEN round(COALESCE(cost, 0) / planned * 100) END,
        'last_worked', last_worked, 'last_update', last_update,
        'flags', to_jsonb(array_remove(ARRAY[
          CASE WHEN status IN ('requested', 'in_progress') AND last_worked > v_today - 14
                AND (last_update IS NULL OR last_update < now() - interval '14 days') THEN 'no_progress' END,
          CASE WHEN status IN ('requested', 'in_progress') AND planned > 0
                AND COALESCE(cost, 0) / planned * 100 - COALESCE(progress, 0) >= 20 THEN 'behind' END,
          CASE WHEN status IN ('requested', 'in_progress') AND crew > 0
                AND (last_worked IS NULL OR last_worked <= v_today - 14) THEN 'idle' END,
          CASE WHEN status IN ('requested', 'in_progress') AND due < v_today THEN 'overdue' END
        ], NULL)))
      ORDER BY (status IN ('requested', 'in_progress')) DESC, today DESC, last_worked DESC NULLS LAST, due NULLS LAST) FROM rows), '[]'::jsonb),
    'unlinked', (SELECT jsonb_build_object(
        'requests', (SELECT count(*) FROM labor_requisitions WHERE project_id = p_project AND work_order_id IS NULL
                      AND status = 'approved' AND closed_at IS NULL),
        'person_days', count(DISTINCT (staff_id, work_date)),
        'cost', CASE WHEN v_costs THEN COALESCE(sum(cost), 0) END,
        'last_worked', max(work_date))
      FROM c WHERE work_order_id IS NULL),
    'costs_visible', v_costs)
  INTO v;
  RETURN v;
END $function$;
GRANT EXECUTE ON FUNCTION project_work_board(uuid) TO authenticated;

-- ── Requests that have gone quiet ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.labour_quiet_requests()
RETURNS TABLE (id uuid, role_needed text, project_id uuid, project_name text, work_order_id uuid, work_order text,
  workers integer, last_day date, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT r.id, r.role_needed, r.project_id, p.project_name, r.work_order_id, COALESCE(w.title, left(w.scope_of_work, 60)),
         (SELECT count(*)::int FROM labor_allocations a WHERE a.labor_requisition_id = r.id AND a.status = 'active'),
         GREATEST((SELECT max(e.work_date) FROM labour_work_entries e WHERE e.labor_requisition_id = r.id),
                  (SELECT max(l.log_date) FROM wo_attendance_log l WHERE l.labor_requisition_id = r.id)),
         r.created_at
    FROM labor_requisitions r
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN work_orders w ON w.id = r.work_order_id
   WHERE r.status = 'approved' AND r.closed_at IS NULL AND r.created_at < now() - interval '21 days'
     AND NOT EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.work_date > CURRENT_DATE - 21)
     AND NOT EXISTS (SELECT 1 FROM wo_attendance_log l WHERE l.labor_requisition_id = r.id AND l.log_date > CURRENT_DATE - 21)
     AND (can_manage_labor_requisition(r.id) OR COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false))
   ORDER BY p.project_name, 8 NULLS FIRST;
$function$;
GRANT EXECUTE ON FUNCTION labour_quiet_requests() TO authenticated;
