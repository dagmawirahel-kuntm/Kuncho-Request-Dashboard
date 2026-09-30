-- 379 — Everyone on a labour request, in one list
--
-- A request's people live in three places: labor_allocations (on site),
-- labor_requisition_workers (named from the roster, waiting for approval)
-- and labor_requisition_candidates (new people, hired on approval). The
-- site's team can't read candidates directly (HR's table), so the request
-- page reads them all through here.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.labour_request_people(p_req uuid)
RETURNS TABLE (staff_id uuid, candidate_id uuid, name text, phone text, day_rate numeric, state text, since date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r labor_requisitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT (can_run_labour_site(r.project_id) OR r.requested_by = auth.uid()
          OR COALESCE(get_user_role() IN ('finance'), false)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  -- On the request now, or were: the latest allocation per worker.
  SELECT DISTINCT ON (a.staff_id) a.staff_id, NULL::uuid, s.employee_name::text, s.phone_number::text,
         COALESCE(a.day_rate_snapshot, s.day_rate), CASE WHEN a.status = 'active' THEN 'on_site' ELSE 'left' END, a.start_date
    FROM labor_allocations a JOIN staff s ON s.id = a.staff_id
   WHERE a.labor_requisition_id = p_req
   ORDER BY a.staff_id, (a.status = 'active') DESC, a.created_at DESC;
  -- Named from the roster, starting once approved.
  RETURN QUERY
  SELECT w.staff_id, NULL::uuid, s.employee_name::text, s.phone_number::text, s.day_rate, 'named'::text, NULL::date
    FROM labor_requisition_workers w JOIN staff s ON s.id = w.staff_id
   WHERE w.requisition_id = p_req
     AND NOT EXISTS (SELECT 1 FROM labor_allocations a WHERE a.labor_requisition_id = p_req AND a.staff_id = w.staff_id);
  -- New people, hired when the request is approved.
  RETURN QUERY
  SELECT NULL::uuid, c.id, c.full_name::text, c.phone::text, NULL::numeric, 'new'::text, NULL::date
    FROM labor_requisition_candidates lc JOIN candidates c ON c.id = lc.candidate_id
   WHERE lc.requisition_id = p_req AND lc.promoted_staff_id IS NULL AND c.provisioned_staff_id IS NULL;
END $function$;

REVOKE EXECUTE ON FUNCTION labour_request_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION labour_request_people(uuid) TO authenticated;
