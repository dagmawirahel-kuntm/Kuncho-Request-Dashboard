-- 542 — phone and ID are no longer needed for HR to verify a casual worker
--
-- Since 483 a worker's phone and ID were needed from their 4th hire: HR
-- couldn't verify them without, and a verified worker reaching a 4th hire was
-- sent back to the site team (and their pay held). They stay on the form, to
-- fill in when known, but nothing waits on them.

CREATE OR REPLACE FUNCTION public.worker_id_needed(p_staff uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT false;
$function$;
