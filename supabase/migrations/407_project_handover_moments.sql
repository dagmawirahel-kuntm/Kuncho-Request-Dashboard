-- 407 — Project handovers: when a project reached 100%, and who to tell
--
-- A project's physical_progress reaching 100% is the moment the team
-- handed it over, and the dashboard celebrates it (CelebrationsBar). The
-- app had no record of WHEN that happened, so:
--
--   projects.handed_over_at   stamped by trigger the first time progress
--                             reaches 100, cleared if it drops back below.
--                             Projects already at 100 when this runs are
--                             left unstamped on purpose — their handover
--                             wasn't seen, and celebrating it today would
--                             be news that isn't.
--
--   recent_handovers(p_days)  handovers in the last p_days, for everyone
--                             signed in: name, when, the project manager,
--                             and whether it is one of yours. SECURITY
--                             DEFINER because most roles can't read
--                             projects; it returns nothing else about them.

SET search_path TO public;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS handed_over_at timestamptz;
COMMENT ON COLUMN projects.handed_over_at IS 'When physical_progress first reached 100 (trigger trg_stamp_handover, migration 407).';

-- Named to sort after trg_restrict_project_budgeting_fields, so the field
-- guards see the row as the user sent it.
CREATE OR REPLACE FUNCTION stamp_project_handover() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.physical_progress, 0) >= 100 THEN
    IF NEW.handed_over_at IS NULL AND (TG_OP = 'INSERT' OR COALESCE(OLD.physical_progress, 0) < 100) THEN
      NEW.handed_over_at := now();
    END IF;
  ELSE
    NEW.handed_over_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_handover ON projects;
CREATE TRIGGER trg_stamp_handover BEFORE INSERT OR UPDATE OF physical_progress ON projects
  FOR EACH ROW EXECUTE FUNCTION stamp_project_handover();

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

REVOKE EXECUTE ON FUNCTION recent_handovers(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION recent_handovers(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION stamp_project_handover() FROM PUBLIC, anon;
