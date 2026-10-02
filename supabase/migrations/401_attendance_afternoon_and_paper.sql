-- 401: The after-lunch roll-call, and marks copied in from paper.
--
-- Two roll-calls a day were done on paper: one in the morning, one after
-- lunch. A day row now carries both:
--   · status / check_in_at      — the morning roll-call (as before);
--   · pm_status / pm_at         — the after-lunch roll-call: back on time,
--     back late, out on work, excused, or didn't come back.
-- pm_status stays empty until the after-lunch roll-call is taken; until
-- then the day counts as before. Once it is taken, each half counts
-- half a day.
--
-- pm_recorded_by / pm_recorded_at say who took the after-lunch mark and
-- when — set by the database, never by the client.
--
-- from_paper marks rows typed in from a paper register, so the month
-- sheet and the change log can tell them from marks made on the day.
-- Changes still go through the same guard and log as everything else.
--
-- attendance_settings.lunch_ends is when people are due back; the grace
-- minutes apply to it as they do to the morning start.
-- attendance_back_from_lunch() lets staff with a login mark their own
-- return, timed by the server clock like check-in.

ALTER TABLE staff_attendance
  ADD COLUMN IF NOT EXISTS pm_status text CHECK (pm_status IN ('present','late','field','excused','absent')),
  ADD COLUMN IF NOT EXISTS pm_at timestamptz,
  ADD COLUMN IF NOT EXISTS pm_recorded_by uuid,
  ADD COLUMN IF NOT EXISTS pm_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS from_paper boolean NOT NULL DEFAULT false;

ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS lunch_ends time NOT NULL DEFAULT '13:30';

-- Same guard as 400, plus: stamp who took the after-lunch mark.
CREATE OR REPLACE FUNCTION staff_attendance_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d date := CASE WHEN TG_OP = 'DELETE' THEN OLD.work_date ELSE NEW.work_date END;
  lk record;
BEGIN
  SELECT label INTO lk FROM attendance_locks WHERE d BETWEEN start_date AND end_date LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is locked — HR has to unlock it before this day can change', lk.label USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.work_date <> OLD.work_date
     AND EXISTS (SELECT 1 FROM attendance_locks WHERE OLD.work_date BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'The original day is in a locked period' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.work_date > addis_today() THEN
    RAISE EXCEPTION 'Attendance can''t be recorded ahead of the day' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.recorded_by := coalesce(NEW.recorded_by, auth.uid());
    NEW.recorded_at := now();
    NEW.updated_by := NULL; NEW.updated_at := NULL;
    IF NEW.pm_status IS NOT NULL THEN
      NEW.pm_recorded_by := auth.uid(); NEW.pm_recorded_at := now();
    ELSE
      NEW.pm_recorded_by := NULL; NEW.pm_recorded_at := NULL;
    END IF;
    IF NEW.work_date < addis_today() - 2 AND coalesce(btrim(NEW.change_reason), '') = '' THEN
      RAISE EXCEPTION 'Recording a day more than two days late needs a reason' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.recorded_by := OLD.recorded_by; NEW.recorded_at := OLD.recorded_at;
    NEW.source := CASE WHEN NEW.source = 'self' AND OLD.source = 'self' THEN 'self' ELSE NEW.source END;
    NEW.updated_by := auth.uid(); NEW.updated_at := now();
    IF NEW.pm_status IS DISTINCT FROM OLD.pm_status OR NEW.pm_at IS DISTINCT FROM OLD.pm_at THEN
      NEW.pm_recorded_by := auth.uid(); NEW.pm_recorded_at := now();
    ELSE
      NEW.pm_recorded_by := OLD.pm_recorded_by; NEW.pm_recorded_at := OLD.pm_recorded_at;
    END IF;
    IF OLD.work_date < addis_today() AND coalesce(btrim(NEW.change_reason), '') = '' THEN
      RAISE EXCEPTION 'Changing a day that has passed needs a reason' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  PERFORM set_config('attendance.reason', coalesce(NEW.change_reason, ''), true);
  NEW.change_reason := NULL;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION attendance_back_from_lunch()
RETURNS staff_attendance
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := current_staff_id();
  cfg attendance_settings;
  local_now timestamp := now() AT TIME ZONE 'Africa/Addis_Ababa';
  rec staff_attendance;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Your login isn''t linked to a staff record — ask HR'; END IF;
  SELECT * INTO cfg FROM attendance_settings WHERE id;
  SELECT * INTO rec FROM staff_attendance WHERE staff_id = me AND work_date = addis_today();
  IF NOT FOUND OR rec.check_in_at IS NULL THEN RAISE EXCEPTION 'Check in first'; END IF;
  IF rec.pm_status IS NOT NULL THEN
    RAISE EXCEPTION 'Already marked back at %', coalesce(to_char(rec.pm_at AT TIME ZONE 'Africa/Addis_Ababa', 'HH24:MI'), 'after lunch');
  END IF;
  UPDATE staff_attendance
     SET pm_status = CASE WHEN local_now::time > cfg.lunch_ends + make_interval(mins => cfg.late_after_minutes) THEN 'late' ELSE 'present' END,
         pm_at = now()
   WHERE id = rec.id RETURNING * INTO rec;
  RETURN rec;
END $$;

GRANT EXECUTE ON FUNCTION attendance_back_from_lunch() TO authenticated;
