-- 399: Leave that counts itself.
--
-- Until now `days` was typed by hand and counted calendar days (a
-- 16 Jul–14 Aug request said 30), nothing knew how much leave anyone
-- had, and two requests could overlap. This adds:
--   · working-day counting: Sundays and public holidays (calendar_holidays
--     rows with no project) don't use up leave. Maternity runs in
--     consecutive calendar days, as the law counts it.
--   · annual entitlement per Labour Proclamation 1156/2019 art. 77:
--     16 working days for the first year of service, plus one day for
--     every additional two years. The leave year is the Ethiopian fiscal
--     year (Hamle 1 = 8 July).
--   · leave_balances(): entitlement / taken / pending / left per person,
--     for HR (everyone), a manager (their reports) and staff (themselves).
--   · leave_team_calendar(): who is off between two dates. Colleagues see
--     "on leave"; the type is only shown to HR and the person's manager.
--   · paternity and marriage leave types, a cover person and handover
--     note, "medical certificate received", and a note on the decision.
--   · no overlapping pending/approved requests for the same person.
--   · everyone can read the holiday list (it was limited to a few roles,
--     so staff saw different day counts than HR); HR and admin maintain it.
--   · Ethiopian public holidays for EC 2019 (Sep 2026 – Sep 2027) whose
--     dates are fixed or follow the Orthodox calendar. Eid al-Fitr,
--     Eid al-Adha and Mawlid move with the moon and are announced each
--     year, so HR adds them from the Leave page when announced.
-- Existing rows keep the days they were saved with; days are recounted
-- only when a request's dates change.

-- ── Types and new fields ─────────────────────────────────────────────
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'leave_requests'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%leave_type%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE leave_requests DROP CONSTRAINT %I', c); END IF;
END $$;

ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_leave_type_check
  CHECK (leave_type IN ('annual','sick','unpaid','maternity','paternity','marriage','compassionate','other'));

ALTER TABLE leave_requests
  -- No foreign key on purpose: a second FK to staff would make every
  -- `staff(...)` embed on leave_requests ambiguous for PostgREST. The
  -- guard below checks the person exists instead.
  ADD COLUMN IF NOT EXISTS cover_staff_id uuid,
  ADD COLUMN IF NOT EXISTS handover_note text,
  ADD COLUMN IF NOT EXISTS certificate_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS decision_note text;

ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_dates_check CHECK (end_date >= start_date);

-- ── Counting ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION leave_working_days(p_start date, p_end date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int
  FROM generate_series(p_start, p_end, interval '1 day') g(d)
  WHERE extract(isodow FROM g.d) <> 7
    AND NOT EXISTS (
      SELECT 1 FROM calendar_holidays h
      WHERE h.holiday_date = g.d::date AND h.applies_to_project_id IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION leave_day_count(p_type text, p_start date, p_end date) RETURNS integer
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN NULL
    WHEN p_type = 'maternity' THEN (p_end - p_start) + 1
    ELSE leave_working_days(p_start, p_end)
  END;
$$;

-- Hamle 1 falls on 8 July every Gregorian year.
CREATE OR REPLACE FUNCTION leave_year_start(p_on date DEFAULT current_date) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_on >= make_date(extract(year FROM p_on)::int, 7, 8)
              THEN make_date(extract(year FROM p_on)::int, 7, 8)
              ELSE make_date(extract(year FROM p_on)::int - 1, 7, 8) END;
$$;

CREATE OR REPLACE FUNCTION leave_annual_entitlement(p_started date, p_on date DEFAULT current_date) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT 16 + (greatest(
    coalesce(extract(year FROM age(p_on, p_started))::int, 0) - 1, 0) / 2);
$$;

-- ── Guard: count, overlap ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION leave_request_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hr boolean := (get_user_role())::text IN ('hr_officer','admin');
  clash record;
BEGIN
  -- Recount when the request is new or its dates/type moved. HR may
  -- still set a different figure (e.g. half days) by sending one.
  IF TG_OP = 'INSERT'
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date   IS DISTINCT FROM OLD.end_date
     OR NEW.leave_type IS DISTINCT FROM OLD.leave_type THEN
    IF NOT hr OR NEW.days IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.days IS NOT DISTINCT FROM OLD.days) THEN
      NEW.days := leave_day_count(NEW.leave_type, NEW.start_date, NEW.end_date);
    END IF;
  END IF;

  IF NEW.status IN ('pending','approved') THEN
    SELECT r.start_date, r.end_date INTO clash
    FROM leave_requests r
    WHERE r.staff_id = NEW.staff_id
      AND r.id IS DISTINCT FROM NEW.id
      AND r.status IN ('pending','approved')
      AND daterange(r.start_date, r.end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'This overlaps another leave request (% to %)', clash.start_date, clash.end_date
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.cover_staff_id IS NOT NULL THEN
    IF NEW.cover_staff_id = NEW.staff_id THEN
      RAISE EXCEPTION 'Cover must be someone else' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM staff WHERE id = NEW.cover_staff_id) THEN
      RAISE EXCEPTION 'Cover person not found' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_leave_request_guard BEFORE INSERT OR UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION leave_request_guard();

-- ── Balances ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION leave_balances(p_on date DEFAULT current_date)
RETURNS TABLE (
  staff_id uuid, employee_name text, department_id uuid, starting_date date,
  year_start date, year_end date, entitlement integer,
  annual_taken integer, annual_pending integer, annual_left integer,
  sick_taken_12m integer, other_taken integer, on_leave_today boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT current_staff_id() AS id, (get_user_role())::text AS role),
  yr AS (SELECT leave_year_start(p_on) AS ys),
  people AS (
    SELECT s.* FROM staff s, me
    WHERE s.status = 'active'
      AND coalesce(s.employment_type, '') <> 'tier_2_casual'
      AND (me.role IN ('admin','hr_officer','executive')
           OR s.id = me.id
           OR s.reports_to_id = me.id
           OR EXISTS (SELECT 1 FROM departments d WHERE d.id = s.department_id AND d.head_staff_id = me.id))
  ),
  lr AS (
    SELECT r.*, coalesce(r.days, leave_day_count(r.leave_type, r.start_date, r.end_date)) AS n
    FROM leave_requests r JOIN people p ON p.id = r.staff_id
    WHERE r.status IN ('pending','approved')
  )
  SELECT p.id, p.employee_name, p.department_id, p.starting_date,
         yr.ys, (yr.ys + interval '1 year' - interval '1 day')::date,
         leave_annual_entitlement(p.starting_date, p_on),
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'annual' AND lr.status = 'approved'
                                     AND lr.start_date >= yr.ys AND lr.start_date < yr.ys + interval '1 year'), 0)::int,
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'annual' AND lr.status = 'pending'
                                     AND lr.start_date >= yr.ys AND lr.start_date < yr.ys + interval '1 year'), 0)::int,
         (leave_annual_entitlement(p.starting_date, p_on)
           - coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'annual' AND lr.status = 'approved'
                                         AND lr.start_date >= yr.ys AND lr.start_date < yr.ys + interval '1 year'), 0))::int,
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'sick' AND lr.status = 'approved'
                                     AND lr.start_date > p_on - interval '12 months'), 0)::int,
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type NOT IN ('annual','sick') AND lr.status = 'approved'
                                     AND lr.start_date >= yr.ys AND lr.start_date < yr.ys + interval '1 year'), 0)::int,
         coalesce(bool_or(lr.status = 'approved' AND p_on BETWEEN lr.start_date AND lr.end_date), false)
  FROM people p CROSS JOIN yr
  LEFT JOIN lr ON lr.staff_id = p.id
  GROUP BY p.id, p.employee_name, p.department_id, p.starting_date, yr.ys
  ORDER BY p.employee_name;
$$;

-- ── Who is off ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION leave_team_calendar(p_from date, p_to date)
RETURNS TABLE (
  request_id uuid, staff_id uuid, employee_name text, department_id uuid,
  start_date date, end_date date, days integer, status text, leave_type text,
  cover_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT s.id, s.department_id, (get_user_role())::text AS role
    FROM (SELECT current_staff_id() AS id) x LEFT JOIN staff s ON s.id = x.id
  )
  SELECT r.id, s.id, s.employee_name, s.department_id, r.start_date, r.end_date,
         r.days::int, r.status,
         CASE WHEN me.role IN ('admin','hr_officer','executive') OR s.id = me.id OR s.reports_to_id = me.id
              THEN r.leave_type ELSE 'leave' END,
         c.employee_name
  FROM leave_requests r
  JOIN staff s ON s.id = r.staff_id
  LEFT JOIN staff c ON c.id = r.cover_staff_id
  CROSS JOIN me
  WHERE r.status IN ('pending','approved')
    AND r.start_date <= p_to AND r.end_date >= p_from
    AND (me.role IN ('admin','hr_officer','executive')
         OR s.id = me.id
         OR s.reports_to_id = me.id
         OR (me.department_id IS NOT NULL AND s.department_id = me.department_id AND r.status = 'approved'))
  ORDER BY r.start_date, s.employee_name;
$$;

GRANT EXECUTE ON FUNCTION leave_working_days(date, date), leave_day_count(text, date, date),
  leave_year_start(date), leave_annual_entitlement(date, date),
  leave_balances(date), leave_team_calendar(date, date) TO authenticated;

-- ── Holidays ─────────────────────────────────────────────────────────
ALTER POLICY calendar_holidays_select ON calendar_holidays TO authenticated USING (true);

CREATE POLICY calendar_holidays_hr_write ON calendar_holidays FOR ALL TO authenticated
  USING ((get_user_role())::text IN ('hr_officer','admin'))
  WITH CHECK ((get_user_role())::text IN ('hr_officer','admin'));

INSERT INTO calendar_holidays (holiday_date, name)
SELECT v.d, v.n FROM (VALUES
  (date '2026-09-11', 'Enkutatash (Ethiopian New Year)'),
  (date '2026-09-27', 'Meskel'),
  (date '2027-01-07', 'Genna (Ethiopian Christmas)'),
  (date '2027-01-19', 'Timket (Epiphany)'),
  (date '2027-03-02', 'Adwa Victory Day'),
  (date '2027-04-30', 'Siklet (Good Friday)'),
  (date '2027-05-01', 'International Labour Day'),
  (date '2027-05-02', 'Fasika (Ethiopian Easter)'),
  (date '2027-05-05', 'Patriots'' Victory Day'),
  (date '2027-05-28', 'Downfall of the Derg'),
  (date '2027-09-12', 'Enkutatash (Ethiopian New Year)'),
  (date '2027-09-28', 'Meskel')
) AS v(d, n)
WHERE NOT EXISTS (
  SELECT 1 FROM calendar_holidays h WHERE h.holiday_date = v.d AND h.applies_to_project_id IS NULL
);
