-- 180 — Site foreman scope: identity accepted on the assignment too +
-- SECURITY DEFINER so the helper can read staff cross-role
--
-- Two fixes in one:
--
-- 1) 178's helper required staff.role='site_foreman' AND an active assignment
--    on the project. Dagmawi Fitsum → AIH and Anteneh → Test 2 set the foreman
--    role on the assignment itself ("Site Foreman"/"Site_foreman"), not on the
--    staff row — the intuitive thing to do when adding a per-project role —
--    and their Site Ops surface stayed empty. Accept identity in EITHER place.
--
-- 2) The helper was SECURITY INVOKER. It joins to `staff`, but roles like
--    project_manager and procurement_officer have NO SELECT policy on staff,
--    so under those callers' RLS the join found nothing and the helper always
--    returned false — even when the data qualified. current_staff_id() already
--    handles this by being SECURITY DEFINER for the same reason. Match that.
--    No callable escalation: the helper takes only p_project_id and returns a
--    bool derived from the caller's own auth.uid().

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.is_site_foreman_for_project(p_project_id uuid)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
 SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM staff s
    JOIN staff_assignments a ON a.staff_id = s.id
    WHERE s.user_id = auth.uid()
      AND a.project_id = p_project_id
      AND a.active
      AND (
        lower(s.role) = 'site_foreman'
        OR lower(a.role) IN ('site_foreman','site foreman')
      )
  );
$function$;
GRANT EXECUTE ON FUNCTION public.is_site_foreman_for_project(uuid) TO authenticated;
