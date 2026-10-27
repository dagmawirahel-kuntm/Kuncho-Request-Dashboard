-- 478: Who can do this job? — the worker picker for a PM or foreman.
--
-- Asking for labour meant typing a name into a search box of 140 casual
-- workers, with nothing to say who does what, who is free, or who has done
-- good work on this site before. labour_candidates() answers that for a
-- project (and optionally a work order) on a day: every active casual
-- worker with their trade, rate, whether HR has verified them, whether they
-- are busy elsewhere that day or tied to another open request, how many
-- days they have worked on this project, their rating, and whether they are
-- already on the work order's crew.

CREATE OR REPLACE FUNCTION public.labour_candidates(p_project uuid, p_work_order uuid DEFAULT NULL, p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (staff_id uuid, name text, trade text, day_rate numeric, phone text, verified boolean,
  busy_today jsonb, open_elsewhere integer, days_here integer, last_worked date, last_site text,
  score numeric, on_this_job boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT s.id, s.employee_name, s.trade_tag, s.day_rate, s.phone_number, s.verified_at IS NOT NULL,
    (SELECT jsonb_build_object('project', p.project_name, 'what', COALESCE(w.title, r.role_needed))
       FROM labour_work_entries e JOIN labor_requisitions r ON r.id = e.labor_requisition_id
       LEFT JOIN work_orders w ON w.id = r.work_order_id LEFT JOIN projects p ON p.id = e.project_id
      WHERE e.staff_id = s.id AND e.work_date = p_date
        AND (r.work_order_id IS DISTINCT FROM p_work_order OR p_work_order IS NULL)
      ORDER BY e.recorded_at DESC LIMIT 1),
    (SELECT count(*)::int FROM labor_allocations a JOIN labor_requisitions r ON r.id = a.labor_requisition_id
      WHERE a.staff_id = s.id AND a.status = 'active' AND r.closed_at IS NULL AND r.project_id <> p_project),
    (SELECT count(DISTINCT e.work_date)::int FROM labour_work_entries e WHERE e.staff_id = s.id AND e.project_id = p_project)
      + (SELECT count(DISTINCT l.log_date)::int FROM wo_attendance_log l WHERE l.staff_id = s.id AND l.project_id = p_project),
    (SELECT max(e.work_date) FROM labour_work_entries e WHERE e.staff_id = s.id),
    (SELECT p.project_name FROM labour_work_entries e JOIN projects p ON p.id = e.project_id WHERE e.staff_id = s.id ORDER BY e.work_date DESC LIMIT 1),
    (SELECT CASE WHEN v.sufficient_data THEN v.overall_score_100 END FROM v_staff_rolling_performance v WHERE v.staff_id = s.id),
    p_work_order IS NOT NULL AND EXISTS (SELECT 1 FROM work_order_crew c WHERE c.work_order_id = p_work_order AND c.staff_id = s.id AND c.removed_at IS NULL)
  FROM staff s
  WHERE s.employment_type = 'tier_2_casual' AND COALESCE(s.status, 'active') = 'active'
    AND auth.uid() IS NOT NULL
  ORDER BY s.employee_name;
$function$;
GRANT EXECUTE ON FUNCTION labour_candidates(uuid, uuid, date) TO authenticated;
