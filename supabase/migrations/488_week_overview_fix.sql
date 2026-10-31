-- 488: the This Week on Site overview of all projects failed with
-- "operator is not unique: unknown - unknown". s->'labour' - 'by_day' was read
-- as s -> ('labour' - 'by_day'); the brackets make it drop by_day from the
-- labour totals as meant. Nothing else changes.
CREATE OR REPLACE FUNCTION public.projects_week_overview(p_from date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_from date := COALESCE(p_from, date_trunc('week', bot_today())::date); s jsonb; out jsonb := '[]'::jsonb; pr record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  FOR pr IN
    SELECT DISTINCT x.project_id FROM (
      SELECT e.project_id FROM labour_work_entries e WHERE e.work_date BETWEEN v_from - 7 AND v_from + 6
      UNION SELECT l.project_id FROM wo_attendance_log l WHERE l.log_date BETWEEN v_from - 7 AND v_from + 6
      UNION SELECT w.project_id FROM wo_progress_updates u JOIN work_orders w ON w.id = u.work_order_id
             WHERE (u.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date BETWEEN v_from AND v_from + 6) x
     WHERE x.project_id IS NOT NULL
  LOOP
    s := project_week_core(pr.project_id, v_from, labour_can_see_costs(pr.project_id));
    out := out || jsonb_build_array(jsonb_build_object(
      'project', s->'project', 'labour', (s->'labour') - 'by_day', 'by_day', s#>'{labour,by_day}',
      'orders_worked', (SELECT count(*) FROM jsonb_array_elements(s->'orders') o WHERE (o->>'person_days')::int > 0),
      'no_update', (SELECT count(*) FROM jsonb_array_elements(s->'orders') o WHERE o->'flags' ? 'no_update'),
      'gain', (SELECT round(avg((o->>'gain')::numeric)) FROM jsonb_array_elements(s->'orders') o WHERE o->>'gain' IS NOT NULL AND (o->>'updated')::boolean),
      'finished', jsonb_array_length(s->'finished'), 'overdue', jsonb_array_length(s->'overdue'),
      'pay', s->'pay', 'unverified', s->'unverified', 'costs', s->'costs'));
  END LOOP;
  RETURN jsonb_build_object('from', v_from, 'to', v_from + 6,
    'projects', COALESCE((SELECT jsonb_agg(x ORDER BY (x#>>'{labour,person_days}')::int DESC) FROM jsonb_array_elements(out) x), '[]'::jsonb));
END $function$;
