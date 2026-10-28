-- 484: only labour requests made from 28 Oct 2026 (Addis Ababa time) count
-- towards the fourth hire that makes phone and ID needed (483). Requests
-- before then don't count, so no worker needs them yet because of past hires.
CREATE OR REPLACE FUNCTION public.worker_hire_count(p_staff uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT count(DISTINCT w.requisition_id)::int
    FROM labor_requisition_workers w
    JOIN labor_requisitions r ON r.id = w.requisition_id AND r.status = 'approved'
   WHERE w.staff_id = p_staff
     AND r.created_at >= timestamptz '2026-10-28 00:00+03';
$function$;
