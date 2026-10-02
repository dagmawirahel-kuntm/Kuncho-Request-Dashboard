-- 404: Leave rules management decides, and paper that HR can keep up with.
--
-- Most staff have no login: their leave forms and the roll-call come to
-- HR on paper. This makes the paper path first-class and turns the open
-- questions about leave into settings management can decide later.
--
-- Leave policy (leave_policy, one row; admin and executives change it):
--   · base days and the service step (law: 16, +1 per further 2 years);
--   · an optional ceiling;
--   · extra days for groups (leave_extra_days: e.g. upper management,
--     a department, a staff type) — none until management adds them;
--   · new joiners: pro-rata (law), full year, or nothing in year one;
--   · probation: length, and whether leave can be used or only builds up;
--   · leave year: Hamle 1 for everyone, or each person's anniversary;
--   · carry-over: how many unused days move into the next year (0 until
--     decided — HR can carry days by hand with an adjustment).
-- Until management confirms it, the row says so (decided_at is null) and
-- the app shows the legal defaults are in use.
--
-- leave_entitlement_detail() works out one person's year and says how:
-- "16 base + 1 for 4 years' service, joined mid-year 9/12 → 12.5".
-- leave_balance_sheet() is leave_balances() with that breakdown, half
-- days, probation and carry-over; leave_balances() stays for old callers.
--
-- leave_adjustments: HR's by-hand corrections per person per leave year
-- (opening balances from the paper files, days carried by agreement).
--
-- Paper: leave_requests gain from_paper / paper_ref / entered_by, so a
-- form HR typed in is told apart from one the person sent. Weekly roll-
-- call sheets get a reference and are tracked from printed to returned
-- to typed in (attendance_sheets), with a photo of the signed original.

-- ── Policy ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_policy (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  base_days              numeric NOT NULL DEFAULT 16 CHECK (base_days >= 0),
  extra_day_every_years  integer NOT NULL DEFAULT 2 CHECK (extra_day_every_years >= 0),
  max_annual_days        numeric CHECK (max_annual_days IS NULL OR max_annual_days > 0),
  new_joiner_rule        text NOT NULL DEFAULT 'prorata' CHECK (new_joiner_rule IN ('prorata', 'full', 'none_first_year')),
  probation_months       integer NOT NULL DEFAULT 2 CHECK (probation_months BETWEEN 0 AND 12),
  probation_rule         text NOT NULL DEFAULT 'can_use' CHECK (probation_rule IN ('can_use', 'accrue_only')),
  leave_year_basis       text NOT NULL DEFAULT 'fiscal' CHECK (leave_year_basis IN ('fiscal', 'anniversary')),
  carry_over_max_days    numeric NOT NULL DEFAULT 0 CHECK (carry_over_max_days >= 0),
  include_casual         boolean NOT NULL DEFAULT false,
  notes                  text,
  decided_by             uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  decided_at             timestamptz,
  updated_by             uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO leave_policy (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS leave_extra_days (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  match_field text NOT NULL CHECK (match_field IN ('management_level', 'staff_type', 'employment_type', 'department_id')),
  match_value text NOT NULL,
  extra_days  numeric NOT NULL CHECK (extra_days > 0),
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  year_start  date NOT NULL,
  days        numeric NOT NULL CHECK (days <> 0),
  reason      text NOT NULL CHECK (btrim(reason) <> ''),
  created_by  uuid DEFAULT auth.uid() REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_adjustments_staff_idx ON leave_adjustments (staff_id, year_start);

ALTER TABLE leave_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_extra_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_adjustments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leave_policy' AND policyname = 'leave_policy_read') THEN
    CREATE POLICY leave_policy_read ON leave_policy FOR SELECT TO authenticated USING (true);
    CREATE POLICY leave_policy_manage ON leave_policy FOR UPDATE TO authenticated
      USING (COALESCE(get_user_role()::text IN ('admin', 'executive'), false))
      WITH CHECK (COALESCE(get_user_role()::text IN ('admin', 'executive'), false));
    CREATE POLICY leave_extra_days_read ON leave_extra_days FOR SELECT TO authenticated USING (true);
    CREATE POLICY leave_extra_days_manage ON leave_extra_days FOR ALL TO authenticated
      USING (COALESCE(get_user_role()::text IN ('admin', 'executive'), false))
      WITH CHECK (COALESCE(get_user_role()::text IN ('admin', 'executive'), false));
    CREATE POLICY leave_adjustments_read ON leave_adjustments FOR SELECT TO authenticated
      USING (COALESCE(get_user_role()::text IN ('admin', 'hr_officer', 'executive'), false) OR staff_id = current_staff_id());
    CREATE POLICY leave_adjustments_hr ON leave_adjustments FOR ALL TO authenticated
      USING (COALESCE(get_user_role()::text IN ('admin', 'hr_officer'), false))
      WITH CHECK (COALESCE(get_user_role()::text IN ('admin', 'hr_officer'), false));
  END IF;
END $$;
GRANT SELECT, UPDATE ON leave_policy TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_extra_days, leave_adjustments TO authenticated;

-- Stamp who changed the policy; "confirm" is a separate, deliberate step.
CREATE OR REPLACE FUNCTION leave_policy_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  IF NEW.decided_at IS DISTINCT FROM OLD.decided_at AND NEW.decided_at IS NOT NULL THEN
    NEW.decided_by := auth.uid();
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_leave_policy_stamp BEFORE UPDATE ON leave_policy
  FOR EACH ROW EXECUTE FUNCTION leave_policy_stamp();

-- ── One person's year, worked out and explained ─────────────────────
CREATE OR REPLACE FUNCTION leave_entitlement_detail(p_staff uuid, p_on date DEFAULT current_date, p_with_carry boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pol      leave_policy%ROWTYPE;
  s        staff%ROWTYPE;
  ys       date;
  ye       date;
  yrs      int := 0;
  svc      numeric := 0;
  grp      numeric := 0;
  grp_lbl  text[];
  full_yr  numeric;
  frac     numeric := 1;
  earned   numeric;
  carried  numeric := 0;
  adj      numeric := 0;
  prev     jsonb;
  prev_left numeric;
  prob_end date;
  in_prob  boolean := false;
  parts    jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO pol FROM leave_policy LIMIT 1;
  SELECT * INTO s FROM staff WHERE id = p_staff;
  IF s.id IS NULL THEN RETURN NULL; END IF;

  -- The leave year this day falls in.
  IF pol.leave_year_basis = 'anniversary' AND s.starting_date IS NOT NULL AND p_on >= s.starting_date THEN
    ys := (s.starting_date + make_interval(years => extract(year FROM age(p_on, s.starting_date))::int))::date;
  ELSE
    ys := leave_year_start(p_on);
  END IF;
  ye := (ys + interval '1 year' - interval '1 day')::date;

  IF s.starting_date IS NOT NULL AND p_on >= s.starting_date THEN
    yrs := extract(year FROM age(p_on, s.starting_date))::int;
  END IF;
  IF pol.extra_day_every_years > 0 THEN
    svc := greatest(yrs - 1, 0) / pol.extra_day_every_years;
  END IF;

  SELECT coalesce(sum(x.extra_days), 0), array_agg(x.label || ' +' || trim(to_char(x.extra_days, 'FM999990.##')))
    INTO grp, grp_lbl
    FROM leave_extra_days x
   WHERE x.active AND x.match_value = CASE x.match_field
           WHEN 'management_level' THEN s.management_level
           WHEN 'staff_type'       THEN s.staff_type
           WHEN 'employment_type'  THEN s.employment_type
           WHEN 'department_id'    THEN s.department_id::text END;

  full_yr := pol.base_days + svc + grp;
  parts := parts || jsonb_build_object('label', 'Base', 'days', pol.base_days);
  IF svc > 0 THEN
    parts := parts || jsonb_build_object('label', format('%s years'' service (+1 per %s after the first)', yrs, pol.extra_day_every_years), 'days', svc);
  END IF;
  IF grp > 0 THEN
    parts := parts || jsonb_build_object('label', array_to_string(grp_lbl, ', '), 'days', grp);
  END IF;
  IF pol.max_annual_days IS NOT NULL AND full_yr > pol.max_annual_days THEN
    parts := parts || jsonb_build_object('label', 'Capped at the company maximum', 'days', pol.max_annual_days - full_yr);
    full_yr := pol.max_annual_days;
  END IF;

  -- Joined during this leave year.
  IF s.starting_date IS NOT NULL AND s.starting_date > ys THEN
    IF pol.new_joiner_rule = 'prorata' THEN
      frac := greatest((ye - s.starting_date + 1)::numeric / (ye - ys + 1), 0);
      parts := parts || jsonb_build_object('label', format('Joined %s — part of the year (%s%%)', to_char(s.starting_date, 'DD Mon YYYY'), round(frac * 100)),
                                           'days', round(full_yr * frac * 2) / 2 - full_yr);
    ELSIF pol.new_joiner_rule = 'none_first_year' AND yrs < 1 THEN
      frac := 0;
      parts := parts || jsonb_build_object('label', 'First year of service — no annual leave yet', 'days', -full_yr);
    END IF;
  END IF;
  earned := round(full_yr * frac * 2) / 2;

  -- Days carried in from last year, up to the company limit.
  IF p_with_carry AND pol.carry_over_max_days > 0 AND (s.starting_date IS NULL OR s.starting_date < ys) THEN
    prev := leave_entitlement_detail(p_staff, ys - 1, false);
    SELECT (prev->>'total')::numeric - coalesce(sum(coalesce(r.days, leave_day_count(r.leave_type, r.start_date, r.end_date))), 0)
      INTO prev_left
      FROM leave_requests r
     WHERE r.staff_id = p_staff AND r.leave_type = 'annual' AND r.status = 'approved'
       AND r.start_date >= (prev->>'year_start')::date AND r.start_date <= (prev->>'year_end')::date;
    carried := least(pol.carry_over_max_days, greatest(coalesce(prev_left, 0), 0));
    IF carried > 0 THEN
      parts := parts || jsonb_build_object('label', format('Carried from last year (up to %s)', trim(to_char(pol.carry_over_max_days, 'FM999990.##'))), 'days', carried);
    END IF;
  END IF;

  SELECT coalesce(sum(a.days), 0) INTO adj FROM leave_adjustments a WHERE a.staff_id = p_staff AND a.year_start = ys;
  IF adj <> 0 THEN
    parts := parts || jsonb_build_object('label', 'Set by HR', 'days', adj);
  END IF;

  IF s.starting_date IS NOT NULL AND pol.probation_months > 0 THEN
    prob_end := (s.starting_date + make_interval(months => pol.probation_months))::date;
    in_prob := p_on < prob_end;
  END IF;

  RETURN jsonb_build_object(
    'year_start', ys, 'year_end', ye, 'service_years', yrs,
    'earned', earned, 'carried', carried, 'adjusted', adj,
    'total', earned + carried + adj,
    'in_probation', in_prob, 'probation_ends', prob_end,
    'can_use', NOT (in_prob AND pol.probation_rule = 'accrue_only'),
    'parts', parts);
END $$;

-- ── Everyone's balance, explained ───────────────────────────────────
CREATE OR REPLACE FUNCTION leave_balance_sheet(p_on date DEFAULT current_date)
RETURNS TABLE (
  staff_id uuid, employee_name text, department_id uuid, staff_type text, role text, starting_date date,
  year_start date, year_end date, entitlement numeric,
  annual_taken numeric, annual_pending numeric, annual_left numeric,
  sick_taken_12m numeric, unpaid_taken numeric, other_taken numeric, on_leave_today boolean,
  in_probation boolean, probation_ends date, can_use boolean, breakdown jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT current_staff_id() AS id, (get_user_role())::text AS role),
  pol AS (SELECT include_casual FROM leave_policy LIMIT 1),
  people AS (
    SELECT s.*, leave_entitlement_detail(s.id, p_on) AS d
    FROM staff s, me, pol
    WHERE s.status = 'active'
      AND (pol.include_casual OR coalesce(s.employment_type, '') <> 'tier_2_casual')
      AND (me.role IN ('admin','hr_officer','executive')
           OR s.id = me.id
           OR s.reports_to_id = me.id
           OR EXISTS (SELECT 1 FROM departments dd WHERE dd.id = s.department_id AND dd.head_staff_id = me.id))
  ),
  lr AS (
    SELECT r.*, coalesce(r.days, leave_day_count(r.leave_type, r.start_date, r.end_date))::numeric AS n
    FROM leave_requests r JOIN people p ON p.id = r.staff_id
    WHERE r.status IN ('pending','approved')
  )
  SELECT p.id, p.employee_name, p.department_id, p.staff_type, p.role, p.starting_date,
         (p.d->>'year_start')::date, (p.d->>'year_end')::date, (p.d->>'total')::numeric,
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'annual' AND lr.status = 'approved'
                                     AND lr.start_date BETWEEN (p.d->>'year_start')::date AND (p.d->>'year_end')::date), 0),
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'annual' AND lr.status = 'pending'
                                     AND lr.start_date BETWEEN (p.d->>'year_start')::date AND (p.d->>'year_end')::date), 0),
         (p.d->>'total')::numeric
           - coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'annual' AND lr.status = 'approved'
                                         AND lr.start_date BETWEEN (p.d->>'year_start')::date AND (p.d->>'year_end')::date), 0),
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'sick' AND lr.status = 'approved'
                                     AND lr.start_date > p_on - interval '12 months'), 0),
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type = 'unpaid' AND lr.status = 'approved'
                                     AND lr.start_date BETWEEN (p.d->>'year_start')::date AND (p.d->>'year_end')::date), 0),
         coalesce(sum(lr.n) FILTER (WHERE lr.leave_type NOT IN ('annual','sick','unpaid') AND lr.status = 'approved'
                                     AND lr.start_date BETWEEN (p.d->>'year_start')::date AND (p.d->>'year_end')::date), 0),
         coalesce(bool_or(lr.status = 'approved' AND p_on BETWEEN lr.start_date AND lr.end_date), false),
         (p.d->>'in_probation')::boolean, (p.d->>'probation_ends')::date, (p.d->>'can_use')::boolean, p.d
  FROM people p
  LEFT JOIN lr ON lr.staff_id = p.id
  GROUP BY p.id, p.employee_name, p.department_id, p.staff_type, p.role, p.starting_date, p.d
  ORDER BY p.employee_name;
$$;

-- The old shape, for anything still calling it.
CREATE OR REPLACE FUNCTION leave_balances(p_on date DEFAULT current_date)
RETURNS TABLE (
  staff_id uuid, employee_name text, department_id uuid, starting_date date,
  year_start date, year_end date, entitlement integer,
  annual_taken integer, annual_pending integer, annual_left integer,
  sick_taken_12m integer, other_taken integer, on_leave_today boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.staff_id, b.employee_name, b.department_id, b.starting_date, b.year_start, b.year_end,
         floor(b.entitlement)::int, ceil(b.annual_taken)::int, ceil(b.annual_pending)::int, floor(b.annual_left)::int,
         ceil(b.sick_taken_12m)::int, ceil(b.other_taken + b.unpaid_taken)::int, b.on_leave_today
  FROM leave_balance_sheet(p_on) b;
$$;

GRANT EXECUTE ON FUNCTION leave_entitlement_detail(uuid, date, boolean), leave_balance_sheet(date) TO authenticated;

-- ── Paper leave forms ───────────────────────────────────────────────
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS from_paper boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paper_ref  text,
  ADD COLUMN IF NOT EXISTS entered_by uuid;

-- The 399 guard, plus: who typed it, and probation when management has
-- said leave only builds up during it.
CREATE OR REPLACE FUNCTION leave_request_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hr boolean := (get_user_role())::text IN ('hr_officer','admin');
  clash record;
  d jsonb;
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date   IS DISTINCT FROM OLD.end_date
     OR NEW.leave_type IS DISTINCT FROM OLD.leave_type THEN
    IF NOT hr OR NEW.days IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.days IS NOT DISTINCT FROM OLD.days) THEN
      NEW.days := leave_day_count(NEW.leave_type, NEW.start_date, NEW.end_date);
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.entered_by := auth.uid();
    IF NOT hr THEN NEW.from_paper := false; NEW.paper_ref := NULL; END IF;
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

    IF NEW.leave_type = 'annual'
       AND (TG_OP = 'INSERT' OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.leave_type IS DISTINCT FROM OLD.leave_type) THEN
      d := leave_entitlement_detail(NEW.staff_id, NEW.start_date, false);
      IF d IS NOT NULL AND NOT (d->>'can_use')::boolean THEN
        RAISE EXCEPTION 'Annual leave builds up during probation but can be taken from % (company leave policy)',
          to_char((d->>'probation_ends')::date, 'DD Mon YYYY') USING ERRCODE = 'check_violation';
      END IF;
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

-- ── Paper roll-call sheets ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_sheets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref          text NOT NULL UNIQUE,
  group_name   text NOT NULL,
  week_start   date NOT NULL,
  people       integer,
  printed_by   uuid DEFAULT auth.uid() REFERENCES user_profiles(id) ON DELETE SET NULL,
  printed_at   timestamptz NOT NULL DEFAULT now(),
  returned_at  timestamptz,
  returned_by  uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  entered_at   timestamptz,
  entered_by   uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  photo_path   text,
  note         text,
  UNIQUE (group_name, week_start)
);
ALTER TABLE attendance_sheets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_sheets' AND policyname = 'attendance_sheets_rw') THEN
    CREATE POLICY attendance_sheets_rw ON attendance_sheets FOR ALL TO authenticated
      USING (COALESCE(get_user_role()::text IN ('admin', 'hr_officer', 'executive', 'operations_manager'), false))
      WITH CHECK (COALESCE(get_user_role()::text IN ('admin', 'hr_officer', 'operations_manager'), false));
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON attendance_sheets TO authenticated;
