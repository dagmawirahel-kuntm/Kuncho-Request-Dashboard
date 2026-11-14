-- 518 — HR checks a worker at the door, not at the pay
--
-- 84 of the 106 workers with work recorded are not verified by HR, and the
-- check bites at payment: when finance approves, an unverified worker's pay
-- is split off and held. The worker has already worked, the site manager
-- cannot fix it at that point, and the wait is HR's (25 days, typically).
--
-- A second way to run the same check, off until HR, finance or an admin
-- turns it on: from a start date, a worker who is not verified can be
-- recorded for a grace period (14 days by default) and then cannot be put on
-- a sheet until they are. The block lands where the site manager can act
-- (collect the ID and the bank account), and no pay is held at the end.
--
--   set_labour_door_check(from, grace)   turn it on (a date) or off (NULL)
--   labour_record_until(staff)           the last work date they can be recorded for
--   labour_door_status(staff[])          that date, for the screens

ALTER TABLE public.labour_pay_hold_settings
  ADD COLUMN IF NOT EXISTS door_from  date,
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 1 AND 60);

CREATE OR REPLACE FUNCTION public.set_labour_door_check(p_from date, p_grace integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer', 'finance') THEN
    RAISE EXCEPTION 'Only HR, finance or an admin can change how unverified workers are checked';
  END IF;
  IF p_grace IS NOT NULL AND p_grace NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'The grace period is between 1 and 60 days'; END IF;
  UPDATE labour_pay_hold_settings SET door_from = p_from, grace_days = COALESCE(p_grace, grace_days), updated_at = now(), updated_by = auth.uid() WHERE id;
END $f$;
REVOKE EXECUTE ON FUNCTION public.set_labour_door_check(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_labour_door_check(date, integer) TO authenticated;

-- The check is at the door from its start date on.
CREATE OR REPLACE FUNCTION public.labour_door_on()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE((SELECT h.door_from IS NOT NULL AND CURRENT_DATE >= h.door_from FROM labour_pay_hold_settings h WHERE h.id), false)
$f$;

-- The last work date an unverified casual worker can be recorded for: the
-- grace period counted from their first day of work, or from the start date
-- for everyone who was already working. NULL means no limit (verified, not
-- a casual worker, or the check is not at the door).
CREATE OR REPLACE FUNCTION public.labour_record_until(p_staff uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT CASE WHEN s.employment_type = 'tier_2_casual' AND s.verified_at IS NULL AND h.door_from IS NOT NULL
              THEN GREATEST(COALESCE(f.first_day, CURRENT_DATE), h.door_from) + h.grace_days END
    FROM staff s
    CROSS JOIN labour_pay_hold_settings h
    LEFT JOIN LATERAL (SELECT min(x.d) AS first_day FROM (
                  SELECT min(e.work_date) AS d FROM labour_work_entries e WHERE e.staff_id = s.id
        UNION ALL SELECT min(ld.work_date) FROM labour_day_workers w JOIN labour_days ld ON ld.id = w.day_id WHERE w.staff_id = s.id
        UNION ALL SELECT min(ld.work_date) FROM labour_day_job_crew c JOIN labour_days ld ON ld.id = c.day_id WHERE c.staff_id = s.id
        UNION ALL SELECT min(l.log_date) FROM wo_attendance_log l WHERE l.staff_id = s.id) x) f ON true
   WHERE s.id = p_staff AND h.id
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_record_until(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_record_until(uuid) TO authenticated;

-- For the screens: the unverified workers asked about (or, for HR, finance,
-- operations and admin, all of them) and the date each can be recorded until.
CREATE OR REPLACE FUNCTION public.labour_door_status(p_staff uuid[] DEFAULT NULL)
RETURNS TABLE(staff_id uuid, until date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT s.id, labour_record_until(s.id)
    FROM staff s
   WHERE auth.uid() IS NOT NULL AND s.employment_type = 'tier_2_casual' AND s.verified_at IS NULL
     AND EXISTS (SELECT 1 FROM labour_pay_hold_settings h WHERE h.id AND h.door_from IS NOT NULL)
     AND CASE WHEN p_staff IS NOT NULL THEN s.id = ANY (p_staff)
              ELSE COALESCE(get_user_role()::text IN ('admin', 'hr_officer', 'finance', 'operations_manager', 'executive'), false) OR is_ops_manager() END
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_door_status(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_door_status(uuid[]) TO authenticated;

-- With the check at the door, pay is not held at the end.
CREATE OR REPLACE FUNCTION public.worker_pay_held(p_staff uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(s.employment_type = 'tier_2_casual' AND s.verified_at IS NULL AND CURRENT_DATE >= h.hold_from
                  AND NOT (h.door_from IS NOT NULL AND CURRENT_DATE >= h.door_from), false)
    FROM staff s CROSS JOIN labour_pay_hold_settings h WHERE s.id = p_staff AND h.id;
$function$;

-- The door itself: a worker past their date cannot be put on a day sheet, on
-- a piece job's crew for the day, or on a request's record.
CREATE OR REPLACE FUNCTION public.labour_door_refuse(p_staff uuid, p_date date)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_until date;
BEGIN
  IF p_staff IS NULL OR p_date IS NULL OR NOT labour_door_on() THEN RETURN; END IF;
  v_until := labour_record_until(p_staff);
  IF v_until IS NOT NULL AND p_date > v_until THEN
    RAISE EXCEPTION '% can''t be recorded after % until HR verifies them. Fill in what is missing on Worker details and ask HR to verify',
      (SELECT btrim(employee_name) FROM staff WHERE id = p_staff), to_char(v_until, 'Dy DD Mon');
  END IF;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_door_refuse(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_labour_door_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  PERFORM labour_door_refuse(NEW.staff_id, (SELECT d.work_date FROM labour_days d WHERE d.id = NEW.day_id));
  RETURN NEW;
END $f$;
CREATE OR REPLACE FUNCTION public.trg_labour_door_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  PERFORM labour_door_refuse(NEW.staff_id, NEW.work_date);
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_labour_door_day_workers BEFORE INSERT ON public.labour_day_workers
  FOR EACH ROW EXECUTE FUNCTION public.trg_labour_door_day();
CREATE OR REPLACE TRIGGER trg_labour_door_job_crew BEFORE INSERT ON public.labour_day_job_crew
  FOR EACH ROW EXECUTE FUNCTION public.trg_labour_door_day();
CREATE OR REPLACE TRIGGER trg_labour_door_entries BEFORE INSERT ON public.labour_work_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_labour_door_entry();

-- HR's morning message says who is about to stop being recordable. The
-- function is re-created from its live text with the line added, and is left
-- alone if it does not read as expected.
DO $patch$
DECLARE v text; v_anchor text;
BEGIN
  v := pg_get_functiondef('public.labour_waiting_for(uuid)'::regprocedure);
  IF position('''verify''::text' IN v) = 0 THEN
    v_anchor := CASE WHEN position('WHERE x.amount > 0 HAVING count(*) > 0;' IN v) > 0 THEN 'WHERE x.amount > 0 HAVING count(*) > 0;'
                     WHEN position('FROM pending pe HAVING count(*) > 0;' IN v) > 0 THEN 'FROM pending pe HAVING count(*) > 0;' END;
    IF v_anchor IS NULL THEN RAISE EXCEPTION 'labour_waiting_for does not read as expected; nothing was changed'; END IF;
    v := replace(v, v_anchor, left(v_anchor, length(v_anchor) - 1) || $new$
  UNION ALL
  SELECT 'verify'::text, count(*)::int,
         count(*) || ' worker' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' can''t be recorded after '
           || to_char(min(y.until), 'Dy DD Mon') || ' unless HR verifies them: '
           || array_to_string((array_agg(y.name ORDER BY y.until, y.name))[1:5], ', ')
           || CASE WHEN count(*) > 5 THEN ' and ' || (count(*) - 5) || ' more' ELSE '' END
    FROM (SELECT btrim(s.employee_name) AS name, labour_record_until(s.id) AS until FROM staff s
           WHERE v_role IN ('hr_officer', 'admin') AND labour_door_on() AND s.employment_type = 'tier_2_casual' AND s.verified_at IS NULL
             AND (EXISTS (SELECT 1 FROM labour_day_workers w JOIN labour_days ld ON ld.id = w.day_id WHERE w.staff_id = s.id AND ld.work_date > v_today - 30)
                  OR EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.staff_id = s.id AND e.work_date > v_today - 30))) y
   WHERE y.until IS NOT NULL AND y.until <= v_today + 7 HAVING count(*) > 0;$new$);
    EXECUTE v;
  END IF;
END $patch$;
