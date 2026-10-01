-- 400: Daily attendance for staff.
--
-- The `timesheet` table only ever held casual (Tier 2) labour written by
-- the Labour pipeline for pay — no permanent staff member's day was
-- recorded anywhere, and its check-in/out columns were never used. This
-- adds one row per person per day for permanent staff, kept apart from
-- the labour pay tables so nothing here can change what casual workers
-- are paid.
--
-- How a day gets recorded:
--   · roll-call — HR, the operations manager, a line manager or a
--     department head marks their people (most workshop staff have no
--     login, so this is the main way);
--   · self check-in/out — staff with a login tap in and out; the server
--     clock sets the time, so it can't be typed in later;
--   · approved leave, Sundays and public holidays are not stored — the
--     screens read them from leave_requests and calendar_holidays.
--
-- How it stays traceable:
--   · every insert, change and delete lands in staff_attendance_log with
--     the before/after row, who and when;
--   · changing a day that has passed, or recording one more than two days
--     late, needs a reason, which goes into the log;
--   · HR locks a period (an Ethiopian month, matching payroll) once it is
--     checked; locked days can't be changed until it is unlocked, and
--     both are logged.

CREATE OR REPLACE FUNCTION addis_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date $$;

-- ── Settings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  day_starts time NOT NULL DEFAULT '08:30',
  late_after_minutes integer NOT NULL DEFAULT 15 CHECK (late_after_minutes BETWEEN 0 AND 180),
  day_ends time NOT NULL DEFAULT '17:30',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO attendance_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE attendance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_settings_read ON attendance_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY attendance_settings_hr ON attendance_settings FOR UPDATE TO authenticated
  USING ((get_user_role())::text IN ('hr_officer','admin')) WITH CHECK ((get_user_role())::text IN ('hr_officer','admin'));

-- ── The day record ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present','late','half_day','field','excused','absent')),
  check_in_at timestamptz,
  check_out_at timestamptz,
  place text CHECK (place IN ('office','workshop','leather_workshop','site','field')),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  note text,
  source text NOT NULL DEFAULT 'register' CHECK (source IN ('self','register')),
  -- Where the phone was at self check-in / check-out, when it shared it.
  in_lat numeric,
  in_lng numeric,
  out_lat numeric,
  out_lng numeric,
  recorded_by uuid DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz,
  -- Write-only: the reason for this change, moved to the log by the guard.
  change_reason text,
  UNIQUE (staff_id, work_date),
  CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at)
);
CREATE INDEX IF NOT EXISTS staff_attendance_date_idx ON staff_attendance (work_date);

-- ── Locked periods ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date date NOT NULL,
  end_date date NOT NULL,
  label text NOT NULL,
  locked_by uuid DEFAULT auth.uid(),
  locked_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (start_date, end_date)
);

-- ── Change log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_attendance_log (
  id bigserial PRIMARY KEY,
  attendance_id uuid,
  staff_id uuid,
  work_date date,
  action text NOT NULL CHECK (action IN ('insert','update','delete','lock','unlock')),
  old_row jsonb,
  new_row jsonb,
  reason text,
  changed_by uuid DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_attendance_log_staff_idx ON staff_attendance_log (staff_id, work_date);
CREATE INDEX IF NOT EXISTS staff_attendance_log_time_idx ON staff_attendance_log (changed_at DESC);

-- ── Who may record / see whom ────────────────────────────────────────
-- HR, admin and the operations manager record anyone; otherwise a line
-- manager records their reports and a department head their department.
CREATE OR REPLACE FUNCTION can_record_attendance(p_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (get_user_role())::text IN ('hr_officer','admin','operations_manager')
      OR EXISTS (
        SELECT 1 FROM staff s
        WHERE s.id = p_staff
          AND s.id IS DISTINCT FROM current_staff_id()
          AND (s.reports_to_id = current_staff_id()
               OR EXISTS (SELECT 1 FROM departments d WHERE d.id = s.department_id AND d.head_staff_id = current_staff_id()))
      );
$$;

CREATE OR REPLACE FUNCTION can_see_attendance(p_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_staff = current_staff_id()
      OR (get_user_role())::text IN ('executive','finance')
      OR can_record_attendance(p_staff);
$$;

ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_attendance_read ON staff_attendance FOR SELECT TO authenticated USING (can_see_attendance(staff_id));
CREATE POLICY staff_attendance_insert ON staff_attendance FOR INSERT TO authenticated WITH CHECK (can_record_attendance(staff_id));
CREATE POLICY staff_attendance_update ON staff_attendance FOR UPDATE TO authenticated
  USING (can_record_attendance(staff_id)) WITH CHECK (can_record_attendance(staff_id));
CREATE POLICY staff_attendance_delete ON staff_attendance FOR DELETE TO authenticated
  USING ((get_user_role())::text IN ('hr_officer','admin'));

ALTER TABLE staff_attendance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_attendance_log_read ON staff_attendance_log FOR SELECT TO authenticated
  USING (CASE WHEN staff_id IS NULL THEN (get_user_role())::text IN ('hr_officer','admin','executive','finance','operations_manager')
              ELSE can_see_attendance(staff_id) END);

ALTER TABLE attendance_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_locks_read ON attendance_locks FOR SELECT TO authenticated USING (true);
CREATE POLICY attendance_locks_hr_insert ON attendance_locks FOR INSERT TO authenticated
  WITH CHECK ((get_user_role())::text IN ('hr_officer','admin'));
CREATE POLICY attendance_locks_hr_delete ON attendance_locks FOR DELETE TO authenticated
  USING ((get_user_role())::text IN ('hr_officer','admin'));

-- ── Guard: locks, reasons, stamps ────────────────────────────────────
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
  -- The month moved too: the old date must not be locked either.
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
    IF NEW.work_date < addis_today() - 2 AND coalesce(btrim(NEW.change_reason), '') = '' THEN
      RAISE EXCEPTION 'Recording a day more than two days late needs a reason' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- Who first recorded it never changes.
    NEW.recorded_by := OLD.recorded_by; NEW.recorded_at := OLD.recorded_at;
    NEW.source := CASE WHEN NEW.source = 'self' AND OLD.source = 'self' THEN 'self' ELSE NEW.source END;
    NEW.updated_by := auth.uid(); NEW.updated_at := now();
    IF OLD.work_date < addis_today() AND coalesce(btrim(NEW.change_reason), '') = '' THEN
      RAISE EXCEPTION 'Changing a day that has passed needs a reason' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- The reason belongs to this one change: hand it to the log and keep it
  -- off the row, so the next change has to give its own.
  PERFORM set_config('attendance.reason', coalesce(NEW.change_reason, ''), true);
  NEW.change_reason := NULL;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_staff_attendance_guard BEFORE INSERT OR UPDATE OR DELETE ON staff_attendance
  FOR EACH ROW EXECUTE FUNCTION staff_attendance_guard();

CREATE OR REPLACE FUNCTION staff_attendance_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO staff_attendance_log (attendance_id, staff_id, work_date, action, new_row, reason)
    VALUES (NEW.id, NEW.staff_id, NEW.work_date, 'insert', to_jsonb(NEW), nullif(current_setting('attendance.reason', true), ''));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO staff_attendance_log (attendance_id, staff_id, work_date, action, old_row, new_row, reason)
    VALUES (NEW.id, NEW.staff_id, NEW.work_date, 'update', to_jsonb(OLD), to_jsonb(NEW), nullif(current_setting('attendance.reason', true), ''));
    RETURN NEW;
  ELSE
    INSERT INTO staff_attendance_log (attendance_id, staff_id, work_date, action, old_row)
    VALUES (OLD.id, OLD.staff_id, OLD.work_date, 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;
END $$;

CREATE OR REPLACE TRIGGER trg_staff_attendance_audit AFTER INSERT OR UPDATE OR DELETE ON staff_attendance
  FOR EACH ROW EXECUTE FUNCTION staff_attendance_audit();

CREATE OR REPLACE FUNCTION attendance_lock_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO staff_attendance_log (action, new_row, reason) VALUES ('lock', to_jsonb(NEW), NEW.label);
    RETURN NEW;
  END IF;
  INSERT INTO staff_attendance_log (action, old_row, reason) VALUES ('unlock', to_jsonb(OLD), OLD.label);
  RETURN OLD;
END $$;

CREATE OR REPLACE TRIGGER trg_attendance_lock_audit AFTER INSERT OR DELETE ON attendance_locks
  FOR EACH ROW EXECUTE FUNCTION attendance_lock_audit();

-- ── Self check-in / check-out ────────────────────────────────────────
-- Times come from the server clock. Late is judged against the settings.
CREATE OR REPLACE FUNCTION attendance_check_in(p_place text DEFAULT NULL, p_project uuid DEFAULT NULL, p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
RETURNS staff_attendance
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := current_staff_id();
  cfg attendance_settings;
  local_now timestamp := now() AT TIME ZONE 'Africa/Addis_Ababa';
  st text;
  rec staff_attendance;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Your login isn''t linked to a staff record — ask HR'; END IF;
  SELECT * INTO cfg FROM attendance_settings WHERE id;
  st := CASE WHEN local_now::time > cfg.day_starts + make_interval(mins => cfg.late_after_minutes) THEN 'late' ELSE 'present' END;

  SELECT * INTO rec FROM staff_attendance WHERE staff_id = me AND work_date = addis_today();
  IF FOUND AND rec.check_in_at IS NOT NULL THEN
    RAISE EXCEPTION 'Already checked in at %', to_char(rec.check_in_at AT TIME ZONE 'Africa/Addis_Ababa', 'HH24:MI');
  END IF;

  IF FOUND THEN
    UPDATE staff_attendance SET check_in_at = now(), status = CASE WHEN status IN ('absent') THEN st ELSE status END,
      place = coalesce(p_place, place), project_id = coalesce(p_project, project_id),
      in_lat = p_lat, in_lng = p_lng
    WHERE id = rec.id RETURNING * INTO rec;
  ELSE
    INSERT INTO staff_attendance (staff_id, work_date, status, check_in_at, place, project_id, source, in_lat, in_lng)
    VALUES (me, addis_today(), st, now(), p_place, p_project, 'self', p_lat, p_lng)
    RETURNING * INTO rec;
  END IF;
  RETURN rec;
END $$;

CREATE OR REPLACE FUNCTION attendance_check_out(p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
RETURNS staff_attendance
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := current_staff_id();
  rec staff_attendance;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Your login isn''t linked to a staff record — ask HR'; END IF;
  SELECT * INTO rec FROM staff_attendance WHERE staff_id = me AND work_date = addis_today();
  IF NOT FOUND OR rec.check_in_at IS NULL THEN RAISE EXCEPTION 'Check in first'; END IF;
  UPDATE staff_attendance SET check_out_at = now(), out_lat = p_lat, out_lng = p_lng
  WHERE id = rec.id RETURNING * INTO rec;
  RETURN rec;
END $$;

-- ── Who appears on the register ──────────────────────────────────────
CREATE OR REPLACE FUNCTION attendance_people()
RETURNS TABLE (staff_id uuid, employee_name text, role text, staff_type text, department_id uuid,
               department_name text, reports_to_id uuid, can_record boolean, is_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.employee_name, s.role, s.staff_type, s.department_id, d.name, s.reports_to_id,
         can_record_attendance(s.id), s.id = current_staff_id()
  FROM staff s
  LEFT JOIN departments d ON d.id = s.department_id
  WHERE s.status = 'active'
    AND coalesce(s.employment_type, '') <> 'tier_2_casual'
    AND can_see_attendance(s.id)
  ORDER BY s.employee_name;
$$;

GRANT SELECT ON attendance_settings, attendance_locks, staff_attendance, staff_attendance_log TO authenticated;
GRANT INSERT, UPDATE, DELETE ON staff_attendance TO authenticated;
GRANT INSERT, DELETE ON attendance_locks TO authenticated;
GRANT UPDATE ON attendance_settings TO authenticated;
GRANT EXECUTE ON FUNCTION addis_today(), can_record_attendance(uuid), can_see_attendance(uuid),
  attendance_check_in(text, uuid, numeric, numeric), attendance_check_out(numeric, numeric),
  attendance_people() TO authenticated;
