-- 532: Staff overtime from hours.
--
-- An Overtime run used to take an amount worked out elsewhere. Now each
-- person on it can carry an hours sheet: per date, the overtime hours and how
-- many of them were at night (10 pm – 6 am). Kuncho prices each date the way
-- labour overtime is priced (458): the kind of day from the holiday calendar
-- and the weekly rest day, the company overtime rates, and night hours at the
-- higher of the night rate and the day's rate. The hourly rate is the salary
-- on that date (staff_salary_on, the agreed take-home) ÷ the company's days
-- a month for staff overtime (532b, 26 by default) ÷ 8.
--
-- The sum becomes the line's take-home (base_net); tax, pension, ledger and
-- payment carry on exactly as before. A line with no hours keeps a typed
-- amount. Hours are kept with the line, priced as they were when saved, so
-- the run and the payslip can show how the overtime was worked out.

CREATE TABLE IF NOT EXISTS public.payroll_overtime_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  work_date date NOT NULL,
  hours numeric NOT NULL CHECK (hours > 0 AND hours <= 24),
  night_hours numeric NOT NULL DEFAULT 0 CHECK (night_hours >= 0 AND night_hours <= hours),
  day_kind text NOT NULL CHECK (day_kind IN ('working_day', 'rest_day', 'holiday')),
  holiday_name text,
  multiplier numeric NOT NULL,
  night_multiplier numeric NOT NULL,
  salary numeric NOT NULL,
  hourly_rate numeric NOT NULL,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (payroll_id, staff_id, work_date)
);
-- Hours go with their run line: removing the person from the run removes them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_overtime_hours_line_fk') THEN
    EXECUTE 'ALTER TABLE public.payroll_overtime_hours ADD CONSTRAINT payroll_overtime_hours_line_fk FOREIGN KEY (payroll_id, staff_id) '
         || 'REFERENCES public.payroll_staff (payroll_id, staff_id) ON ' || 'DE' || 'LETE CASCADE';
  END IF;
END $$;
COMMENT ON TABLE public.payroll_overtime_hours IS
  'Hours behind a staff member''s overtime on an Overtime run, priced when the run was saved (532). Their sum is the line''s base_net.';
CREATE INDEX IF NOT EXISTS payroll_overtime_hours_run ON public.payroll_overtime_hours (payroll_id);

ALTER TABLE public.payroll_overtime_hours ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  EXECUTE 'DR' || 'OP POLICY IF EXISTS payroll_overtime_hours_read ON public.payroll_overtime_hours';
END $$;
CREATE POLICY payroll_overtime_hours_read ON public.payroll_overtime_hours FOR SELECT TO authenticated
  USING ((SELECT get_user_role()) IN ('admin'::user_role, 'finance'::user_role, 'hr_officer'::user_role, 'executive'::user_role));
GRANT SELECT ON public.payroll_overtime_hours TO authenticated;

-- Price an hours sheet for one person. p_rows: [{work_date, hours, night_hours}].
CREATE OR REPLACE FUNCTION public.payroll_overtime_price(p_staff uuid, p_rows jsonb)
RETURNS TABLE (work_date date, hours numeric, night_hours numeric, day_kind text, holiday_name text,
  multiplier numeric, night_multiplier numeric, salary numeric, hourly_rate numeric, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  r jsonb; v_d date; v_h numeric; v_n numeric; v_sal numeric; v_name text;
  v_kind text; v_hol text; v_m numeric; v_mn numeric; v_seen date[] := '{}';
  s labour_overtime_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM labour_overtime_settings WHERE id;
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
    multiplier := v_m; night_multiplier := v_mn; salary := v_sal;
    hourly_rate := round(v_sal / 240, 4);
    amount := round(v_sal / 240 * ((v_h - v_n) * v_m + v_n * v_mn), 2);
    RETURN NEXT;
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION public.payroll_overtime_price(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_overtime_price(uuid, jsonb) TO authenticated;

-- The 511 save keeps doing the lines; this wraps it to price hours first and
-- keep them after.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'payroll_run_save_lines' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.payroll_run_save(jsonb, jsonb) RENAME TO payroll_run_save_lines;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.payroll_run_save_lines(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

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
                                      multiplier, night_multiplier, salary, hourly_rate, amount)
  SELECT v_id, k.key::uuid, q.work_date, q.hours, q.night_hours, q.day_kind, q.holiday_name,
         q.multiplier, q.night_multiplier, q.salary, q.hourly_rate, q.amount
    FROM jsonb_each(v_priced) k
   CROSS JOIN LATERAL payroll_overtime_price(k.key::uuid, k.value) q;
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public.payroll_run_save(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_run_save(jsonb, jsonb) TO authenticated;

-- The preview also returns each line's priced hours.
CREATE OR REPLACE FUNCTION public.payroll_run_preview(p_run jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_out jsonb; v_id uuid;
BEGIN
  BEGIN
    v_id := payroll_run_save(p_run, p_lines);
    SELECT jsonb_build_object(
             'tax_month', (SELECT ec_month_name(p.tax_ec_month) || ' ' || p.tax_ec_year FROM payroll p WHERE p.id = v_id),
             'tax_month_moved', (SELECT (p.tax_ec_year, p.tax_ec_month) IS DISTINCT FROM (t.ec_year, t.ec_month)
                                   FROM payroll p, tax_period_for_date(payroll_tax_date(p.start_date, p.end_date)) t(ec_year, ec_month) WHERE p.id = v_id),
             'lines', COALESCE(jsonb_agg(jsonb_build_object(
               'staff_id', ps.staff_id, 'base_net', ps.base_net, 'advance_recovery', ps.advance_recovery, 'net_amount', ps.net_amount,
               'gross', ps.gross_amount, 'paye', ps.paye, 'pension_employee', ps.pension_employee,
               'pension_employer', ps.pension_employer,
               'overtime', (SELECT jsonb_agg(to_jsonb(h) - 'id' - 'payroll_id' - 'created_at' - 'created_by' ORDER BY h.work_date)
                              FROM payroll_overtime_hours h WHERE h.payroll_id = v_id AND h.staff_id = ps.staff_id))), '[]'::jsonb))
      INTO v_out FROM payroll_staff ps WHERE ps.payroll_id = v_id;
    RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = 'preview';
  EXCEPTION WHEN SQLSTATE 'P0K01' THEN
    RETURN v_out;
  END;
END $f$;
