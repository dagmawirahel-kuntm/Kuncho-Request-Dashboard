-- 180 — Site foreman scope: identity accepted on the assignment too
--
-- 178's helper required staff.role='site_foreman' AND an active assignment on
-- the project. Two people (Dagmawi Fitsum → AIH, Anteneh → Test 2) set the
-- foreman role on the assignment itself ("Site Foreman"/"Site_foreman"), not on
-- the staff row — the intuitive thing to do when adding a per-project role —
-- and their Site Ops surface stayed empty because the identity check failed.
--
-- Fix: accept identity in EITHER place. staff.role stays the "primary/global"
-- foreman flag (someone whose default job is foreman), and an assignment role
-- of Site Foreman on a project makes that person a foreman on THAT project.
-- Matches how the multi-role model already works for other departments.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.is_site_foreman_for_project(p_project_id uuid)
 RETURNS boolean LANGUAGE sql SECURITY INVOKER STABLE
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
