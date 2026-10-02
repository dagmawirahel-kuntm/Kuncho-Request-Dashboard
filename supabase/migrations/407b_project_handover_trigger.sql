-- 407b — Project handovers, part 2: stamp handed_over_at when progress first
-- reaches 100. Named to sort after trg_restrict_project_budgeting_fields,
-- so the field guards see the row as the user sent it.
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.stamp_project_handover() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(NEW.physical_progress, 0) >= 100 THEN
    IF NEW.handed_over_at IS NULL AND (TG_OP = 'INSERT' OR COALESCE(OLD.physical_progress, 0) < 100) THEN
      NEW.handed_over_at := now();
    END IF;
  ELSE
    NEW.handed_over_at := NULL;
  END IF;
  RETURN NEW;
END $function$;

REVOKE EXECUTE ON FUNCTION public.stamp_project_handover() FROM PUBLIC, anon;

CREATE OR REPLACE TRIGGER trg_stamp_handover BEFORE INSERT OR UPDATE OF physical_progress ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_handover();
