-- 459: Where a worker has worked — for the casual worker's page.
--
-- The page showed the labour requests someone was hired through, but not
-- which work orders they were put on or which projects they actually
-- worked on. That lives in four places: work-order crews, labour requests
-- linked to a work order (408), the day records (375, from October 2026)
-- and the older timesheets fed by the work-order attendance log. Reading
-- the day records is limited to whoever runs the site, so the page asks
-- this one function, which puts it together for one person.
--
-- staff_work_history(p_staff) returns
--   { work_orders: [{ id, title, project_id, project_name, status, on_crew, crew_since, crew_until,
--                     role_on_wo, days, last_day, current }],
--     projects:    [{ project_id, project_name, days, hours, first_day, last_day, work_orders, current }] }
-- A day is counted once per project however many records mention it.

CREATE OR REPLACE FUNCTION public.staff_work_history(p_staff uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (COALESCE(get_user_role()::text IN ('admin', 'executive', 'finance', 'hr_officer', 'operations_manager', 'project_manager'), false)
          OR is_ops_manager()) THEN
    RAISE EXCEPTION 'Not allowed to see this worker''s work history';
  END IF;

  WITH days AS (
    -- Day records (375): the request says which work order, if any.
    SELECT e.project_id, r.work_order_id, e.work_date AS day,
           COALESCE(e.hours, 0) + COALESCE(e.overtime_hours, 0) AS hours
      FROM labour_work_entries e
      JOIN labor_requisitions r ON r.id = e.labor_requisition_id
     WHERE e.staff_id = p_staff AND (COALESCE(e.hours, 0) > 0 OR COALESCE(e.overtime_hours, 0) > 0)
    UNION ALL
    -- Work-order attendance (before 375).
    SELECT l.project_id, l.work_order_id, l.log_date, COALESCE(l.hours_logged, 0) + COALESCE(l.overtime_hours, 0)
      FROM wo_attendance_log l
     WHERE l.staff_id = p_staff AND COALESCE(l.hours_logged, 0) > 0
    UNION ALL
    -- Timesheets not fed by the attendance log.
    SELECT t.project_id, NULL::uuid, t.date, COALESCE(t.days_worked, 1) * 8
      FROM timesheet t
     WHERE t.staff_id = p_staff AND NOT COALESCE(t.is_archived, false) AND t.project_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM wo_attendance_log l WHERE l.synced_timesheet_id = t.id)
  ), day1 AS (
    -- One row per project and day; keep the work order where any record names it.
    SELECT project_id, day, max(work_order_id::text)::uuid AS work_order_id, max(hours) AS hours
      FROM days WHERE project_id IS NOT NULL GROUP BY project_id, day
  ), wo_ids AS (
    SELECT work_order_id AS id FROM work_order_crew WHERE staff_id = p_staff
    UNION SELECT r.work_order_id FROM labor_allocations a JOIN labor_requisitions r ON r.id = a.labor_requisition_id
     WHERE a.staff_id = p_staff AND r.work_order_id IS NOT NULL
    UNION SELECT work_order_id FROM day1 WHERE work_order_id IS NOT NULL
  ), wos AS (
    SELECT w.id, COALESCE(NULLIF(btrim(w.title), ''), left(w.scope_of_work, 80), 'Work order') AS title,
           w.project_id, p.project_name, w.status,
           c.crew_since, c.crew_until, c.role_on_wo, c.on_crew,
           (SELECT count(*) FROM day1 d WHERE d.work_order_id = w.id) AS days,
           (SELECT max(d.day) FROM day1 d WHERE d.work_order_id = w.id) AS last_day,
           EXISTS (SELECT 1 FROM labor_allocations a JOIN labor_requisitions r ON r.id = a.labor_requisition_id
                    WHERE a.staff_id = p_staff AND r.work_order_id = w.id AND a.status = 'active' AND r.closed_at IS NULL) AS on_request
      FROM work_orders w
      JOIN wo_ids ON wo_ids.id = w.id
      LEFT JOIN projects p ON p.id = w.project_id
      LEFT JOIN LATERAL (
        SELECT min(cr.assigned_at)::date AS crew_since,
               CASE WHEN bool_or(cr.removed_at IS NULL) THEN NULL ELSE max(cr.removed_at)::date END AS crew_until,
               (array_agg(cr.role_on_wo ORDER BY cr.assigned_at DESC) FILTER (WHERE cr.role_on_wo IS NOT NULL))[1] AS role_on_wo,
               bool_or(cr.removed_at IS NULL) AS on_crew
          FROM work_order_crew cr WHERE cr.work_order_id = w.id AND cr.staff_id = p_staff) c ON true
  ), proj_ids AS (
    SELECT project_id AS id FROM day1
    UNION SELECT project_id FROM labor_allocations WHERE staff_id = p_staff AND project_id IS NOT NULL
    UNION SELECT project_id FROM wos WHERE project_id IS NOT NULL
  ), projs AS (
    SELECT p.id AS project_id, p.project_name,
           (SELECT count(*) FROM day1 d WHERE d.project_id = p.id) AS days,
           (SELECT sum(d.hours) FROM day1 d WHERE d.project_id = p.id) AS hours,
           (SELECT min(d.day) FROM day1 d WHERE d.project_id = p.id) AS first_day,
           (SELECT max(d.day) FROM day1 d WHERE d.project_id = p.id) AS last_day,
           (SELECT count(*) FROM wos WHERE wos.project_id = p.id) AS work_orders,
           EXISTS (SELECT 1 FROM labor_allocations a WHERE a.staff_id = p_staff AND a.project_id = p.id AND a.status = 'active')
             OR EXISTS (SELECT 1 FROM wos WHERE wos.project_id = p.id AND wos.on_crew AND wos.status NOT IN ('completed', 'cancelled')) AS current
      FROM projects p JOIN proj_ids ON proj_ids.id = p.id
  )
  SELECT jsonb_build_object(
    'work_orders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'project_id', project_id, 'project_name', project_name, 'status', status,
        'on_crew', COALESCE(on_crew, false), 'crew_since', crew_since, 'crew_until', crew_until, 'role_on_wo', role_on_wo,
        'days', days, 'last_day', last_day,
        'current', (COALESCE(on_crew, false) OR on_request) AND status NOT IN ('completed', 'cancelled'))
        ORDER BY ((COALESCE(on_crew, false) OR on_request) AND status NOT IN ('completed', 'cancelled')) DESC,
                 COALESCE(last_day, crew_since) DESC NULLS LAST) FROM wos), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'project_id', project_id, 'project_name', project_name, 'days', days, 'hours', hours,
        'first_day', first_day, 'last_day', last_day, 'work_orders', work_orders, 'current', current)
        ORDER BY current DESC, last_day DESC NULLS LAST) FROM projs), '[]'::jsonb))
  INTO v;
  RETURN v;
END $function$;

GRANT EXECUTE ON FUNCTION staff_work_history(uuid) TO authenticated;
