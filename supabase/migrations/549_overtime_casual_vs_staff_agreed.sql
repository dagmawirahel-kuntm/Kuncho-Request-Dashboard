-- Overtime for casual workers and for employees is not the same.
--
--  1. Two sets of rates. The company rates (labour_overtime_settings) priced
--     both the day sheet's casual workers and the payroll overtime of
--     employees. Employees now have their own multipliers (staff_*), starting
--     at today's values so nothing changes until they are edited; the
--     existing ones stay with casual workers.
--  2. An agreed amount on the day sheet. A casual worker's overtime is
--     sometimes a fixed amount agreed and paid, not hours × rate. Each worker
--     on a day can now carry overtime_agreed_amount; when set, it is what the
--     overtime pays (hours, if typed, are kept for the record). Employees'
--     agreed amounts are already typed as an amount on the payroll run.

-- 1. Employees' own rates
ALTER TABLE labour_overtime_settings
  ADD COLUMN IF NOT EXISTS staff_evening_multiplier numeric,
  ADD COLUMN IF NOT EXISTS staff_night_multiplier numeric,
  ADD COLUMN IF NOT EXISTS staff_rest_day_multiplier numeric,
  ADD COLUMN IF NOT EXISTS staff_holiday_multiplier numeric;

UPDATE labour_overtime_settings SET
  staff_evening_multiplier = COALESCE(staff_evening_multiplier, evening_multiplier),
  staff_night_multiplier = COALESCE(staff_night_multiplier, night_multiplier),
  staff_rest_day_multiplier = COALESCE(staff_rest_day_multiplier, rest_day_multiplier),
  staff_holiday_multiplier = COALESCE(staff_holiday_multiplier, holiday_multiplier)
 WHERE id;

COMMENT ON COLUMN labour_overtime_settings.staff_evening_multiplier IS 'Employees'' overtime on a working day (549); the unprefixed rates are for casual workers.';

CREATE OR REPLACE FUNCTION public.set_staff_overtime_rates(p_evening numeric, p_night numeric, p_rest_day numeric, p_holiday numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'finance', 'hr_officer') THEN
    RAISE EXCEPTION 'Only finance, HR or an admin can change employees'' overtime rates';
  END IF;
  IF LEAST(p_evening, p_night, p_rest_day, p_holiday) < 1 OR GREATEST(p_evening, p_night, p_rest_day, p_holiday) > 5 THEN
    RAISE EXCEPTION 'Each rate is a multiple of the hourly rate between 1× and 5×';
  END IF;
  UPDATE labour_overtime_settings SET
    staff_evening_multiplier = p_evening, staff_night_multiplier = p_night,
    staff_rest_day_multiplier = p_rest_day, staff_holiday_multiplier = p_holiday,
    updated_at = now(), updated_by = auth.uid(),
    updated_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid())
  WHERE id;
END $function$;
GRANT EXECUTE ON FUNCTION public.set_staff_overtime_rates(numeric, numeric, numeric, numeric) TO authenticated;

-- Payroll prices employees' hours on their rates.
DO $mig$
DECLARE
  v_old text := pg_get_functiondef('public.payroll_overtime_price(uuid, jsonb)'::regprocedure);
  v_new text := v_old;
BEGIN
  v_new := replace(v_new,
    'v_m := CASE v_kind WHEN ''holiday'' THEN s.holiday_multiplier WHEN ''rest_day'' THEN s.rest_day_multiplier ELSE s.evening_multiplier END;',
    'v_m := CASE v_kind WHEN ''holiday'' THEN COALESCE(s.staff_holiday_multiplier, s.holiday_multiplier) WHEN ''rest_day'' THEN COALESCE(s.staff_rest_day_multiplier, s.rest_day_multiplier) ELSE COALESCE(s.staff_evening_multiplier, s.evening_multiplier) END;');
  v_new := replace(v_new, 'v_mn := GREATEST(s.night_multiplier, v_m);', 'v_mn := GREATEST(COALESCE(s.staff_night_multiplier, s.night_multiplier), v_m);');
  IF v_new = v_old OR v_new NOT LIKE '%staff_night_multiplier%' OR v_new NOT LIKE '%staff_evening_multiplier%' THEN
    RAISE EXCEPTION 'payroll_overtime_price: anchors not found';
  END IF;
  EXECUTE v_new;
END $mig$;

-- 2. An agreed overtime amount on the day sheet
ALTER TABLE labour_day_workers
  ADD COLUMN IF NOT EXISTS overtime_agreed_amount numeric CHECK (overtime_agreed_amount IS NULL OR overtime_agreed_amount >= 0);

COMMENT ON COLUMN labour_day_workers.overtime_agreed_amount IS
  'Overtime agreed as a fixed amount for the day (549); when set it replaces hours × rate.';

DO $mig$
DECLARE v_old text; v_new text;
BEGIN
  -- Saving the day keeps the amount.
  v_old := pg_get_functiondef('public.labour_day_save(uuid, date, jsonb, boolean, text, jsonb)'::regprocedure);
  v_new := replace(v_old,
    'INSERT INTO labour_day_workers (day_id, staff_id, paid_days, overtime_hours, overtime_night_hours, note)',
    'INSERT INTO labour_day_workers (day_id, staff_id, paid_days, overtime_hours, overtime_night_hours, note, overtime_agreed_amount)');
  v_new := replace(v_new,
    'VALUES (d.id, v_staff, v_paid, v_ot, v_night, NULLIF(btrim(w->>''note''), ''''));',
    'VALUES (d.id, v_staff, v_paid, v_ot, v_night, NULLIF(btrim(w->>''note''), ''''),'
    || E'\n            CASE WHEN NULLIF(w->>''overtime_amount'', '''') IS NOT NULL THEN round(GREATEST((w->>''overtime_amount'')::numeric, 0), 2) END);');
  IF v_new NOT LIKE '%overtime_agreed_amount)%' OR v_new NOT LIKE '%w->>''overtime_amount''%' THEN RAISE EXCEPTION 'labour_day_save: anchors not found'; END IF;
  EXECUTE v_new;

  -- Costing pays the amount instead of hours × rate.
  v_old := pg_get_functiondef('public.labour_day_costs(uuid, date, date, uuid)'::regprocedure);
  v_new := replace(v_old, 'w.overtime_night_hours AS night_h,', 'w.overtime_night_hours AS night_h, w.overtime_agreed_amount AS agreed,');
  v_new := replace(v_new, 'CASE WHEN w.ot_h = 0 THEN 0', 'CASE WHEN w.agreed IS NOT NULL THEN w.agreed WHEN w.ot_h = 0 THEN 0');
  IF v_new NOT LIKE '%AS agreed,%' OR v_new NOT LIKE '%WHEN w.agreed IS NOT NULL THEN w.agreed%' THEN RAISE EXCEPTION 'labour_day_costs: anchors not found'; END IF;
  EXECUTE v_new;

  -- The sheet reads it back.
  v_old := pg_get_functiondef('public.labour_day_get(uuid, date)'::regprocedure);
  v_new := replace(v_old,
    '''overtime_night_hours'', CASE WHEN v_prefill THEN 0 ELSE w.overtime_night_hours END,',
    '''overtime_night_hours'', CASE WHEN v_prefill THEN 0 ELSE w.overtime_night_hours END,'
    || E'\n                ''overtime_amount'', CASE WHEN v_prefill THEN NULL ELSE w.overtime_agreed_amount END,');
  IF v_new = v_old THEN RAISE EXCEPTION 'labour_day_get: anchor not found'; END IF;
  EXECUTE v_new;

  -- A locked day's change log records it.
  v_old := pg_get_functiondef('public.labour_day_snapshot(uuid)'::regprocedure);
  v_new := replace(v_old, '''overtime_night_hours'', w.overtime_night_hours,', '''overtime_night_hours'', w.overtime_night_hours, ''overtime_amount'', w.overtime_agreed_amount,');
  IF v_new = v_old THEN RAISE EXCEPTION 'labour_day_snapshot: anchor not found'; END IF;
  EXECUTE v_new;
END $mig$;
