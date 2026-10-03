-- 407c — Project handovers, part 3: recent_handovers(p_days) — handovers in
-- the last p_days for everyone signed in: name, when, the project manager,
-- and whether it is one of yours. SECURITY DEFINER because most roles
-- can't read projects; it returns nothing else about them.
CREATE OR REPLACE FUNCTION public.recent_handovers(p_days int DEFAULT 3)
RETURNS TABLE (project_id uuid, project_name text, handed_over_at timestamptz, project_manager text, is_mine boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT p.id, p.project_name, p.handed_over_at, s.employee_name::text,
         p.project_manager_id IS NOT NULL AND p.project_manager_id = public.current_staff_id()
    FROM projects p
    LEFT JOIN staff s ON s.id = p.project_manager_id
   WHERE auth.uid() IS NOT NULL
     AND p.handed_over_at IS NOT NULL
     AND NOT COALESCE(p.is_internal, false)
     AND p.handed_over_at > now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 3), 1), 14))
   ORDER BY p.handed_over_at DESC
   LIMIT 5
$function$;

REVOKE EXECUTE ON FUNCTION public.recent_handovers(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recent_handovers(int) TO authenticated;
