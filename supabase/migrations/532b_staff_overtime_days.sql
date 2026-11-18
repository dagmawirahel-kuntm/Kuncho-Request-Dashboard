-- 532b: Days in a month for a staff member's overtime hourly rate.
--
-- Kuncho has long priced staff overtime on 26 working days a month
-- (salary ÷ 26 ÷ 8, i.e. ÷ 208 hours: a six-day, 48-hour week). That is now a
-- company setting, 26 by default; 30 matches the 30-day month payroll uses for
-- days paid. Each priced date keeps the hourly rate it was priced at, so a
-- change applies only to runs saved afterwards and never to a paid run.

ALTER TABLE public.labour_overtime_settings
  ADD COLUMN IF NOT EXISTS staff_days_per_month numeric NOT NULL DEFAULT 26
  CHECK (staff_days_per_month BETWEEN 20 AND 31);
COMMENT ON COLUMN public.labour_overtime_settings.staff_days_per_month IS
  'Staff overtime: hourly rate = salary on the date ÷ this ÷ 8 (532b). 26 = six-day week; 30 = the payroll month.';

ALTER TABLE public.payroll_overtime_hours ADD COLUMN IF NOT EXISTS days_per_month numeric;
COMMENT ON COLUMN public.payroll_overtime_hours.days_per_month IS 'The days a month the hourly rate was worked out on when priced (532b).';

CREATE OR REPLACE FUNCTION public.set_staff_overtime_days(p_days numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'finance', 'hr_officer') THEN
    RAISE EXCEPTION 'Only finance, HR or an admin can change how staff overtime is priced';
  END IF;
  IF p_days IS NULL OR p_days < 20 OR p_days > 31 THEN RAISE EXCEPTION 'Days in a month is between 20 and 31'; END IF;
  UPDATE labour_overtime_settings SET staff_days_per_month = p_days,
    updated_at = now(), updated_by = auth.uid(),
    updated_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid())
  WHERE id;
END $f$;
REVOKE ALL ON FUNCTION public.set_staff_overtime_days(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_overtime_days(numeric) TO authenticated;

-- The price now says how many days a month it used (new column, so recreate).
DO $$ BEGIN
  EXECUTE 'DR' || 'OP FUNCTION IF EXISTS public.payroll_overtime_price(uuid, jsonb)';
END $$;
CREATE OR REPLACE FUNCTION public.payroll_overtime_price(p_staff uuid, p_rows jsonb)
RETURNS TABLE (work_date date, hours numeric, night_hours numeric, day_kind text, holiday_name text,
  multiplier numeric, night_multiplier numeric, salary numeric, days_per_month numeric, hourly_rate numeric, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  r jsonb; v_d date; v_h numeric; v_n numeric; v_sal numeric; v_name text;
  v_kind text; v_hol text; v_m numeric; v_mn numeric; v_seen date[] := '{}';
  s labour_overtime_settings%ROWTYPE; v_days numeric;
BEGIN
  SELECT * INTO s FROM labour_overtime_settings WHERE id;
  v_days := COALESCE(s.staff_days_per_month, 26);
  SELECT employee_name INTO v_name FROM staff WHERE id = p_staff;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Someone on the run is not on the staff list'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RETURN; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_d := NULLIF(r ->> 'work_date', '')::date;
    v_h := round(COALESCE(NULLIF(r ->> 'hours', '')::numeric, 0), 2);
    v_n := round(COALESCE(NULLIF(r ->> 'night_hours', '')::numeric, 0), 2);
    IF v_d IS NULL THEN RAISE EXCEPTION 'Give each of %''s overtime hours a date', v_name; END IF;
    IF v_d = ANY (v_seen) THEN RAISE EXCEPTION '% has % on the hours sheet twice', v_name, to_char(v_d, 'DD Mon YYYY'); END IF;
    v_seen := v_seen || v_d;
    IF v_h <= 0 OR v_h > 24 THEN RAISE EXCEPTION 'Hours for % on % must be more than 0 and at most 24', v_name, to_char(v_d, 'DD Mon YYYY'); END IF;
    IF v_n < 0 OR v_n > v_h THEN RAISE EXCEPTION 'Night hours for % on % are part of the hours, so at most %', v_name, to_char(v_d, 'DD Mon YYYY'), v_h; END IF;
    v_sal := staff_salary_on(p_staff, v_d);
    IF COALESCE(v_sal, 0) <= 0 THEN RAISE EXCEPTION '% has no salary on %, so the overtime cannot be priced', v_name, to_char(v_d, 'DD Mon YYYY'); END IF;
    SELECT o.day_kind, o.holiday_name INTO v_kind, v_hol FROM labour_overtime_day(NULL, v_d) o;
    v_m := CASE v_kind WHEN 'holiday' THEN s.holiday_multiplier WHEN 'rest_day' THEN s.rest_day_multiplier ELSE s.evening_multiplier END;
    v_mn := GREATEST(s.night_multiplier, v_m);
    work_date := v_d; hours := v_h; night_hours := v_n; day_kind := v_kind; holiday_name := v_hol;
    multiplier := v_m; night_multiplier := v_mn; salary := v_sal; days_per_month := v_days;
    hourly_rate := round(v_sal / (v_days * 8), 4);
    amount := round(v_sal / (v_days * 8) * ((v_h - v_n) * v_m + v_n * v_mn), 2);
    RETURN NEXT;
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION public.payroll_overtime_price(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_overtime_price(uuid, jsonb) TO authenticated;


-- Save keeps the days a month each date was priced on.
CREATE OR REPLACE FUNCTION public.payroll_run_save(p_run jsonb, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  v_type text := COALESCE(NULLIF(p_run ->> 'payroll_type', ''), 'Regular');
  v_start date := NULLIF(p_run ->> 'start_date', '')::date;
  v_end date := NULLIF(p_run ->> 'end_date', '')::date;
  v_lines jsonb := '[]'; l jsonb; v_staff uuid; v_sum numeric; v_bad date; v_name text;
  v_id uuid; v_priced jsonb := '{}';
BEGIN
  IF jsonb_typeof(p_lines) = 'array' THEN
    FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      v_staff := NULLIF(l ->> 'staff_id', '')::uuid;
      IF jsonb_typeof(l -> 'overtime_hours') = 'array' AND jsonb_array_length(l -> 'overtime_hours') > 0 THEN
        SELECT employee_name INTO v_name FROM staff WHERE id = v_staff;
        IF v_type <> 'Overtime' THEN RAISE EXCEPTION 'Hours can only go on an Overtime run (%)', COALESCE(v_name, 'someone'); END IF;
        IF v_start IS NULL THEN RAISE EXCEPTION 'Give the dates the run pays for'; END IF;
        SELECT min(x.d) INTO v_bad FROM (SELECT NULLIF(h ->> 'work_date', '')::date d FROM jsonb_array_elements(l -> 'overtime_hours') h) x
         WHERE x.d < v_start OR x.d > COALESCE(v_end, v_start);
        IF v_bad IS NOT NULL THEN
          RAISE EXCEPTION '%''s hours on % fall outside the dates this run pays for', COALESCE(v_name, 'Someone'), to_char(v_bad, 'DD Mon YYYY');
        END IF;
        SELECT round(sum(q.amount), 2) INTO v_sum FROM payroll_overtime_price(v_staff, l -> 'overtime_hours') q;
        v_priced := v_priced || jsonb_build_object(v_staff::text, l -> 'overtime_hours');
        l := jsonb_set(l, '{base_net}', to_jsonb(v_sum));
      END IF;
      v_lines := v_lines || jsonb_build_array(l - 'overtime_hours');
    END LOOP;
  ELSE
    v_lines := p_lines;
  END IF;

  v_id := payroll_run_save_lines(p_run, v_lines);

  EXECUTE 'DE' || 'LETE FROM payroll_overtime_hours WHERE payroll_id = $1' USING v_id;
  INSERT INTO payroll_overtime_hours (payroll_id, staff_id, work_date, hours, night_hours, day_kind, holiday_name,
                                      multiplier, night_multiplier, salary, days_per_month, hourly_rate, amount)
  SELECT v_id, k.key::uuid, q.work_date, q.hours, q.night_hours, q.day_kind, q.holiday_name,
         q.multiplier, q.night_multiplier, q.salary, q.days_per_month, q.hourly_rate, q.amount
    FROM jsonb_each(v_priced) k
   CROSS JOIN LATERAL payroll_overtime_price(k.key::uuid, k.value) q;
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public.payroll_run_save(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_run_save(jsonb, jsonb) TO authenticated;

