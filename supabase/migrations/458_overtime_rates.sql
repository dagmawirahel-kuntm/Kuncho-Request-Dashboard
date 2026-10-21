-- 458: Overtime rates that can be set, in three layers.
--
-- Until now every overtime hour on a day-rate request was paid at one
-- built-in rule, 1.5 × (day rate ÷ 8), whatever the day or the hour and
-- whatever had been agreed. Now an hour of overtime is priced by the first
-- of these that applies:
--
--   3. An amount agreed for that worker on that day, typed when the day is
--      recorded — it replaces the calculation for that entry.
--   2. The request's own overtime deal, set when labour is asked for (or
--      changed later): one multiplier for every overtime hour, or a flat
--      birr per hour.
--   1. The company's rates, by when the overtime was worked (Labour
--      Proclamation 1156/2019, art. 68): an ordinary working day 1.5×,
--      night (10 pm – 6 am) 1.75×, the weekly rest day 2×, a public holiday
--      2.5×. Finance can change them. A holiday is any day in the holiday
--      calendar (for all sites, or for this site); night hours on a rest day
--      or holiday take the higher of the two rates.
--
-- Only overtime hours are priced this way; regular hours stay day rate ÷ 8.
-- Work already on a pay sheet keeps what it was confirmed at. Each pay
-- sheet line now carries how its overtime was priced, day by day.
--
-- labour_day_sheet and labour_pay_lines keep their output columns (changing
-- them would need a DROP): the new per-day detail comes from
-- labour_overtime_lines() and labour_overtime_day_rates().

-- ── 1. Company rates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labour_overtime_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  evening_multiplier  numeric NOT NULL DEFAULT 1.5  CHECK (evening_multiplier  BETWEEN 1 AND 5),
  night_multiplier    numeric NOT NULL DEFAULT 1.75 CHECK (night_multiplier    BETWEEN 1 AND 5),
  rest_day_multiplier numeric NOT NULL DEFAULT 2    CHECK (rest_day_multiplier BETWEEN 1 AND 5),
  holiday_multiplier  numeric NOT NULL DEFAULT 2.5  CHECK (holiday_multiplier  BETWEEN 1 AND 5),
  -- The weekly rest day, as extract(dow): 0 = Sunday … 6 = Saturday.
  rest_day            smallint NOT NULL DEFAULT 0 CHECK (rest_day BETWEEN 0 AND 6),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_by_name     text
);
INSERT INTO labour_overtime_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE labour_overtime_settings IS
  'The company''s overtime multipliers by when the overtime was worked (458). Changed through set_labour_overtime_settings().';
ALTER TABLE labour_overtime_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'labour_overtime_settings' AND policyname = 'labour_overtime_settings_read') THEN
    EXECUTE 'CREATE POLICY labour_overtime_settings_read ON labour_overtime_settings FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_labour_overtime_settings(
  p_evening numeric, p_night numeric, p_rest_day numeric, p_holiday numeric, p_rest_dow smallint DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'finance', 'operations_manager', 'hr_officer') THEN
    RAISE EXCEPTION 'Only finance, operations, HR or an admin can change the overtime rates';
  END IF;
  IF LEAST(p_evening, p_night, p_rest_day, p_holiday) < 1 OR GREATEST(p_evening, p_night, p_rest_day, p_holiday) > 5 THEN
    RAISE EXCEPTION 'Each rate is a multiple of the hourly rate between 1× and 5×';
  END IF;
  UPDATE labour_overtime_settings SET
    evening_multiplier = p_evening, night_multiplier = p_night,
    rest_day_multiplier = p_rest_day, holiday_multiplier = p_holiday,
    rest_day = COALESCE(p_rest_dow, rest_day),
    updated_at = now(), updated_by = auth.uid(),
    updated_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid())
  WHERE id;
END $function$;

-- ── 2. The request's own deal ────────────────────────────────────────
ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS overtime_rule text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS overtime_multiplier numeric,
  ADD COLUMN IF NOT EXISTS overtime_hour_rate numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labor_requisitions_overtime_rule_ck') THEN
    ALTER TABLE labor_requisitions ADD CONSTRAINT labor_requisitions_overtime_rule_ck CHECK (
      (overtime_rule = 'company')
      OR (overtime_rule = 'multiplier' AND overtime_multiplier BETWEEN 1 AND 5)
      OR (overtime_rule = 'per_hour' AND overtime_hour_rate > 0));
  END IF;
END $$;
COMMENT ON COLUMN labor_requisitions.overtime_rule IS
  'How overtime on this request is priced (458): company = the company''s rates by day and hour; multiplier = overtime_multiplier × the hourly rate for every overtime hour; per_hour = overtime_hour_rate birr per hour.';

CREATE OR REPLACE FUNCTION public.set_labour_overtime_rule(p_req uuid, p_rule text, p_value numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r labor_requisitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (manages_project(r.project_id) OR COALESCE(get_user_role()::text IN ('admin', 'operations_manager', 'hr_officer', 'finance'), false)) THEN
    RAISE EXCEPTION 'The project manager, operations, HR or finance sets the overtime deal';
  END IF;
  IF r.payment_basis <> 'per_day' THEN RAISE EXCEPTION 'Overtime is paid only on day-rate requests'; END IF;
  IF p_rule NOT IN ('company', 'multiplier', 'per_hour') THEN RAISE EXCEPTION 'Unknown overtime rule %', p_rule; END IF;
  IF p_rule = 'multiplier' AND NOT (p_value BETWEEN 1 AND 5) THEN RAISE EXCEPTION 'The multiplier is between 1× and 5×'; END IF;
  IF p_rule = 'per_hour' AND NOT (p_value > 0) THEN RAISE EXCEPTION 'Give the birr per overtime hour'; END IF;

  UPDATE labor_requisitions SET
    overtime_rule = p_rule,
    overtime_multiplier = CASE WHEN p_rule = 'multiplier' THEN p_value END,
    overtime_hour_rate = CASE WHEN p_rule = 'per_hour' THEN p_value END
  WHERE id = p_req;

  PERFORM log_labour_event(p_req, 'overtime_rule', CASE p_rule
    WHEN 'company' THEN 'Overtime at the company rates'
    WHEN 'multiplier' THEN format('Overtime at %s× the hourly rate', trim_scale(p_value))
    ELSE format('Overtime at %s ETB an hour', to_char(p_value, 'FM999,999,990.##')) END
    || ' — for work not yet confirmed for pay');
END $function$;

-- ── 3. The day's entry: night hours and an agreed amount ─────────────
ALTER TABLE labour_work_entries
  ADD COLUMN IF NOT EXISTS overtime_night_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_agreed_amount numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labour_work_entries_overtime_night_ck') THEN
    ALTER TABLE labour_work_entries ADD CONSTRAINT labour_work_entries_overtime_night_ck
      CHECK (overtime_night_hours >= 0 AND overtime_night_hours <= overtime_hours);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labour_work_entries_overtime_agreed_ck') THEN
    ALTER TABLE labour_work_entries ADD CONSTRAINT labour_work_entries_overtime_agreed_ck
      CHECK (overtime_agreed_amount IS NULL OR (overtime_agreed_amount >= 0 AND overtime_hours > 0));
  END IF;
END $$;
COMMENT ON COLUMN labour_work_entries.overtime_night_hours IS 'Of the overtime hours, how many were between 10 pm and 6 am (458).';
COMMENT ON COLUMN labour_work_entries.overtime_agreed_amount IS 'Overtime pay agreed for this worker on this day; replaces the calculation (458).';

-- ── Pricing ──────────────────────────────────────────────────────────
-- What kind of day it was for overtime: a holiday (in the calendar, for
-- all sites or this one), the weekly rest day, or an ordinary working day.
CREATE OR REPLACE FUNCTION public.labour_overtime_day(p_project uuid, p_date date)
RETURNS TABLE (day_kind text, holiday_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT CASE WHEN h.name IS NOT NULL THEN 'holiday'
              WHEN extract(dow FROM p_date) = s.rest_day THEN 'rest_day'
              ELSE 'working_day' END,
         h.name
  FROM labour_overtime_settings s
  LEFT JOIN LATERAL (
    SELECT ch.name FROM calendar_holidays ch
    WHERE ch.holiday_date = p_date AND (ch.applies_to_project_id IS NULL OR ch.applies_to_project_id = p_project)
    ORDER BY ch.applies_to_project_id NULLS LAST LIMIT 1) h ON true
  WHERE s.id;
$function$;

-- The rates in force on one request on one day.
CREATE OR REPLACE FUNCTION public.labour_overtime_rates(p_req uuid, p_date date)
RETURNS TABLE (labor_requisition_id uuid, day_kind text, holiday_name text, rule text,
  multiplier numeric, night_multiplier numeric, hour_rate numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT r.id, d.day_kind, d.holiday_name, r.overtime_rule,
    CASE r.overtime_rule
      WHEN 'multiplier' THEN r.overtime_multiplier
      WHEN 'per_hour' THEN NULL
      ELSE CASE d.day_kind WHEN 'holiday' THEN s.holiday_multiplier WHEN 'rest_day' THEN s.rest_day_multiplier ELSE s.evening_multiplier END END,
    CASE r.overtime_rule
      WHEN 'multiplier' THEN r.overtime_multiplier
      WHEN 'per_hour' THEN NULL
      ELSE GREATEST(s.night_multiplier,
             CASE d.day_kind WHEN 'holiday' THEN s.holiday_multiplier WHEN 'rest_day' THEN s.rest_day_multiplier ELSE s.evening_multiplier END) END,
    CASE WHEN r.overtime_rule = 'per_hour' THEN r.overtime_hour_rate END
  FROM labor_requisitions r
  CROSS JOIN labour_overtime_settings s
  CROSS JOIN LATERAL labour_overtime_day(r.project_id, p_date) d
  WHERE r.id = p_req AND s.id;
$function$;

-- For the Record screen: the rates in force on each of a site's requests.
CREATE OR REPLACE FUNCTION public.labour_overtime_day_rates(p_project uuid, p_date date)
RETURNS TABLE (labor_requisition_id uuid, day_kind text, holiday_name text, rule text,
  multiplier numeric, night_multiplier numeric, hour_rate numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT o.* FROM labor_requisitions r
  CROSS JOIN LATERAL labour_overtime_rates(r.id, p_date) o
  WHERE r.project_id = p_project AND r.payment_basis = 'per_day' AND r.status = 'approved' AND r.closed_at IS NULL
    AND can_run_labour_site(p_project);
$function$;

-- A worker's day rate on a request — the same choice labour_pay_lines makes.
CREATE OR REPLACE FUNCTION public.labour_worker_day_rate(p_req uuid, p_staff uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(
    (SELECT la.day_rate_snapshot FROM labor_allocations la WHERE la.labor_requisition_id = p_req AND la.staff_id = p_staff
      ORDER BY (la.status = 'active') DESC, la.created_at DESC LIMIT 1),
    (SELECT s.day_rate FROM staff s WHERE s.id = p_staff),
    (SELECT r.estimated_day_rate FROM labor_requisitions r WHERE r.id = p_req), 0);
$function$;

-- Every overtime entry not yet on a pay sheet, priced, with how.
CREATE OR REPLACE FUNCTION public.labour_overtime_lines(p_req uuid, p_to date)
RETURNS TABLE (entry_id uuid, staff_id uuid, work_date date, overtime_hours numeric, night_hours numeric,
  day_kind text, holiday_name text, rule text, day_rate numeric, multiplier numeric, night_multiplier numeric,
  hour_rate numeric, agreed_amount numeric, amount numeric, basis text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH e AS (
    SELECT e.*, labour_worker_day_rate(p_req, e.staff_id) AS rate
    FROM labour_work_entries e
    JOIN labor_requisitions r ON r.id = e.labor_requisition_id AND r.payment_basis = 'per_day'
    WHERE e.labor_requisition_id = p_req AND e.pay_sheet_id IS NULL AND e.work_date <= p_to AND e.overtime_hours > 0
  ), x AS (
    SELECT e.*, o.day_kind, o.holiday_name, o.rule, o.multiplier, o.night_multiplier, o.hour_rate,
      e.overtime_hours - e.overtime_night_hours AS day_hours,
      CASE o.day_kind WHEN 'holiday' THEN COALESCE(o.holiday_name, 'holiday') WHEN 'rest_day' THEN 'rest day' ELSE 'working day' END AS kind_label
    FROM e CROSS JOIN LATERAL labour_overtime_rates(p_req, e.work_date) o
  )
  SELECT x.id, x.staff_id, x.work_date, x.overtime_hours, x.overtime_night_hours,
    x.day_kind, x.holiday_name,
    CASE WHEN x.overtime_agreed_amount IS NOT NULL THEN 'agreed' ELSE x.rule END,
    x.rate, x.multiplier, x.night_multiplier, x.hour_rate, x.overtime_agreed_amount,
    round(CASE
      WHEN x.overtime_agreed_amount IS NOT NULL THEN x.overtime_agreed_amount
      WHEN x.rule = 'per_hour' THEN x.overtime_hours * x.hour_rate
      ELSE x.day_hours * x.rate / 8 * x.multiplier + x.overtime_night_hours * x.rate / 8 * x.night_multiplier END, 2),
    CASE
      WHEN x.overtime_agreed_amount IS NOT NULL THEN 'agreed for the day'
      WHEN x.rule = 'per_hour' THEN format('%s h × %s an hour (request deal)', trim_scale(x.overtime_hours), to_char(x.hour_rate, 'FM999,999,990.##'))
      WHEN x.rule = 'multiplier' THEN format('%s h × %s× (request deal)', trim_scale(x.overtime_hours), trim_scale(x.multiplier))
      WHEN x.overtime_night_hours = 0 THEN format('%s h × %s× (%s)', trim_scale(x.overtime_hours), trim_scale(x.multiplier), x.kind_label)
      WHEN x.day_hours = 0 THEN format('%s h night × %s× (%s)', trim_scale(x.overtime_hours), trim_scale(x.night_multiplier), x.kind_label)
      ELSE format('%s h × %s× + %s h night × %s× (%s)', trim_scale(x.day_hours), trim_scale(x.multiplier),
             trim_scale(x.overtime_night_hours), trim_scale(x.night_multiplier), x.kind_label) END
  FROM x
  ORDER BY x.staff_id, x.work_date;
$function$;

-- What is owed: as before, with overtime priced by labour_overtime_lines.
CREATE OR REPLACE FUNCTION public.labour_pay_lines(p_req uuid, p_to date)
RETURNS TABLE(staff_id uuid, worker_name text, first_day date, last_day date, days numeric, hours numeric,
  overtime_hours numeric, quantity numeric, percent_done numeric, rate numeric, overtime_amount numeric, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH r AS (SELECT * FROM labor_requisitions WHERE id = p_req),
  e AS (
    SELECT e.* FROM labour_work_entries e
    WHERE e.labor_requisition_id = p_req AND e.pay_sheet_id IS NULL AND e.work_date <= p_to
  ), agg AS (
    SELECT e.staff_id, min(e.work_date) AS first_day, max(e.work_date) AS last_day,
      sum(COALESCE(e.hours, 0)) AS hours, sum(e.overtime_hours) AS ot,
      sum(COALESCE(e.quantity, 0)) AS qty, sum(COALESCE(e.percent_done, 0)) AS pct
    FROM e GROUP BY e.staff_id
  ), ot AS (
    SELECT o.staff_id, sum(o.amount) AS amount FROM labour_overtime_lines(p_req, p_to) o GROUP BY o.staff_id
  ), priced AS (
    SELECT a.*, s.employee_name,
      CASE r.payment_basis
        WHEN 'per_day' THEN labour_worker_day_rate(p_req, a.staff_id)
        WHEN 'per_volume' THEN r.unit_rate
        ELSE r.fixed_price_amount END AS rate,
      r.payment_basis,
      COALESCE(ot.amount, 0) AS ot_amount
    FROM agg a CROSS JOIN r LEFT JOIN staff s ON s.id = a.staff_id
    LEFT JOIN ot ON ot.staff_id IS NOT DISTINCT FROM a.staff_id
  )
  SELECT p.staff_id,
    COALESCE(p.employee_name, CASE WHEN p.payment_basis = 'fixed_price' THEN 'Task' ELSE 'Crew' END),
    p.first_day, p.last_day,
    CASE WHEN p.payment_basis = 'per_day' THEN round(p.hours / 8, 3) END,
    CASE WHEN p.payment_basis = 'per_day' THEN p.hours END,
    p.ot,
    CASE WHEN p.payment_basis = 'per_volume' THEN p.qty END,
    CASE WHEN p.payment_basis = 'fixed_price' THEN p.pct END,
    p.rate,
    CASE WHEN p.payment_basis = 'per_day' THEN round(p.ot_amount, 2) ELSE 0 END,
    round(CASE p.payment_basis
      WHEN 'per_day'    THEN p.hours / 8 * p.rate + p.ot_amount
      WHEN 'per_volume' THEN p.qty * p.rate
      ELSE p.pct / 100 * p.rate END, 2)
  FROM priced p
  ORDER BY 2;
$function$;

-- ── Recording: night hours and an agreed amount ──────────────────────
-- p_entries: [{req, staff (or null), hours, overtime_hours, overtime_night_hours,
--              overtime_amount, quantity, percent_done, note}]
CREATE OR REPLACE FUNCTION public.record_labour_day(p_project uuid, p_date date, p_entries jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_line  jsonb;
  v_req   labor_requisitions%ROWTYPE;
  v_staff uuid;
  v_hours numeric; v_ot numeric; v_qty numeric; v_pct numeric;
  v_night numeric; v_agreed numeric;
  v_n     integer := 0;
  v_name  text := COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), NULLIF(current_setting('kuncho.bot_name', true), ''));
  v_so_far numeric;
BEGIN
  IF NOT can_run_labour_site(p_project) THEN
    RAISE EXCEPTION 'Only the site foreman, the project manager, operations or HR can record work on this site';
  END IF;
  IF p_date > CURRENT_DATE THEN RAISE EXCEPTION 'Work can''t be recorded for a day that hasn''t happened'; END IF;
  IF p_date < CURRENT_DATE - 60 THEN RAISE EXCEPTION 'That is more than 60 days ago — ask operations to record it'; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP
    SELECT * INTO v_req FROM labor_requisitions WHERE id = (v_line->>'req')::uuid;
    IF NOT FOUND OR v_req.project_id <> p_project THEN RAISE EXCEPTION 'A line belongs to another site'; END IF;
    IF v_req.status <> 'approved' THEN RAISE EXCEPTION '% is not approved yet', v_req.role_needed; END IF;
    v_staff  := NULLIF(v_line->>'staff', '')::uuid;
    v_hours  := NULLIF(v_line->>'hours', '')::numeric;
    v_ot     := COALESCE(NULLIF(v_line->>'overtime_hours', '')::numeric, 0);
    v_night  := COALESCE(NULLIF(v_line->>'overtime_night_hours', '')::numeric, 0);
    v_agreed := NULLIF(v_line->>'overtime_amount', '')::numeric;
    v_qty    := NULLIF(v_line->>'quantity', '')::numeric;
    v_pct    := NULLIF(v_line->>'percent_done', '')::numeric;

    IF EXISTS (SELECT 1 FROM labour_work_entries
                WHERE labor_requisition_id = v_req.id AND staff_id IS NOT DISTINCT FROM v_staff
                  AND work_date = p_date AND pay_sheet_id IS NOT NULL) THEN
      CONTINUE;  -- already confirmed for pay: leave it
    END IF;

    IF v_req.payment_basis = 'fixed_price' THEN
      v_hours := NULL; v_qty := NULL; v_ot := 0;
      IF v_pct IS NOT NULL THEN
        SELECT COALESCE(sum(percent_done), 0) INTO v_so_far FROM labour_work_entries
         WHERE labor_requisition_id = v_req.id AND work_date <> p_date;
        IF v_so_far + v_pct > 100 THEN
          RAISE EXCEPTION '% is already % %% done — at most % %% more', v_req.role_needed, v_so_far, 100 - v_so_far;
        END IF;
      END IF;
    ELSIF v_req.payment_basis = 'per_volume' THEN
      v_hours := NULL; v_pct := NULL; v_ot := 0;
    ELSE
      v_qty := NULL; v_pct := NULL;
      IF v_staff IS NULL THEN RAISE EXCEPTION 'Day-rate work is recorded per worker'; END IF;
    END IF;

    IF v_ot = 0 THEN
      v_night := 0; v_agreed := NULL;
    ELSE
      IF v_night < 0 OR v_night > v_ot THEN
        RAISE EXCEPTION 'Night hours for % can''t be more than the % overtime hours', COALESCE((SELECT employee_name FROM staff WHERE id = v_staff), 'a worker'), trim_scale(v_ot);
      END IF;
      IF v_agreed < 0 THEN RAISE EXCEPTION 'An agreed overtime amount can''t be negative'; END IF;
    END IF;

    IF COALESCE(v_hours, 0) = 0 AND v_ot = 0 AND COALESCE(v_qty, 0) = 0 AND v_pct IS NULL THEN
      DELETE FROM labour_work_entries
       WHERE labor_requisition_id = v_req.id AND staff_id IS NOT DISTINCT FROM v_staff
         AND work_date = p_date AND pay_sheet_id IS NULL;
      CONTINUE;
    END IF;

    INSERT INTO labour_work_entries (labor_requisition_id, project_id, work_date, staff_id, hours, overtime_hours,
      overtime_night_hours, overtime_agreed_amount, quantity, percent_done, note, recorded_by, recorded_by_name)
    VALUES (v_req.id, p_project, p_date, v_staff, v_hours, v_ot, v_night, v_agreed, v_qty, v_pct,
      NULLIF(btrim(v_line->>'note'), ''), auth.uid(), v_name)
    ON CONFLICT (labor_requisition_id, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid), work_date)
    DO UPDATE SET hours = EXCLUDED.hours, overtime_hours = EXCLUDED.overtime_hours,
      overtime_night_hours = EXCLUDED.overtime_night_hours, overtime_agreed_amount = EXCLUDED.overtime_agreed_amount,
      quantity = EXCLUDED.quantity, percent_done = EXCLUDED.percent_done, note = EXCLUDED.note,
      recorded_by = EXCLUDED.recorded_by, recorded_by_name = EXCLUDED.recorded_by_name, recorded_at = now()
    WHERE labour_work_entries.pay_sheet_id IS NULL;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

-- ── Confirming: each line keeps how its overtime was priced ──────────
CREATE OR REPLACE FUNCTION public.confirm_labour_pay(p_req uuid, p_to date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r         labor_requisitions%ROWTYPE;
  v_lines   jsonb;
  v_total   numeric;
  v_from    date;
  v_last    date;
  v_sheet   uuid;
  v_code    text;
  v_expense uuid;
  v_project text;
  v_count   int;
  v_labor_category_id uuid := 'd9f67bf3-38ef-49d6-ad77-2869af9b6c82';
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (manages_project(r.project_id) OR COALESCE((get_user_role() IN ('admin', 'operations_manager') OR is_ops_manager()), false)) THEN
    RAISE EXCEPTION 'The project manager confirms what is owed on their site';
  END IF;

  SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('overtime_detail',
           (SELECT jsonb_agg(jsonb_build_object('date', o.work_date, 'hours', o.overtime_hours, 'night_hours', o.night_hours,
                    'rule', o.rule, 'basis', o.basis, 'amount', o.amount) ORDER BY o.work_date)
              FROM labour_overtime_lines(p_req, p_to) o WHERE o.staff_id IS NOT DISTINCT FROM l.staff_id))),
         sum(l.amount), min(l.first_day), max(l.last_day), count(*)
    INTO v_lines, v_total, v_from, v_last, v_count
  FROM labour_pay_lines(p_req, p_to) l;
  IF COALESCE(v_count, 0) = 0 THEN RAISE EXCEPTION 'Nothing recorded to pay up to %', to_char(p_to, 'DD Mon'); END IF;
  IF COALESCE(v_total, 0) <= 0 THEN RAISE EXCEPTION 'What is recorded comes to nothing — check the rates on this request'; END IF;

  SELECT project_name INTO v_project FROM projects WHERE id = r.project_id;
  v_code := 'LPS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_pay_sheet_seq')::text, 4, '0');

  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, category_id, project_id, date,
    vendor_id, paid_to_staff_id, approval_status, payment_state,
    rolled_up_from_requisition_id, rollup_period_start, rollup_period_end)
  VALUES (
    format('Labour %s · %s · %s · %s to %s', v_code, r.role_needed, COALESCE(v_project, '—'),
           to_char(v_from, 'DD Mon'), to_char(v_last, 'DD Mon YYYY')),
    v_total, 'labor_payment'::expense_category, v_labor_category_id, r.project_id, v_last,
    CASE WHEN r.payment_model = 'gang_leader' THEN r.gang_leader_vendor_id END,
    CASE WHEN r.payment_model = 'individual' AND v_count = 1 THEN (SELECT (x->>'staff_id')::uuid FROM jsonb_array_elements(v_lines) x LIMIT 1) END,
    'pending'::expense_approval_status, 'unpaid', p_req, v_from, v_last)
  RETURNING id INTO v_expense;

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_staff_ids, overtime_hours, overtime_amount)
  SELECT v_expense,
    COALESCE((x->>'staff_id')::uuid,
      (SELECT a.staff_id FROM labor_allocations a WHERE a.labor_requisition_id = p_req ORDER BY (a.status = 'active') DESC, a.created_at LIMIT 1)),
    COALESCE((x->>'days')::numeric, (x->>'quantity')::numeric, (x->>'percent_done')::numeric, 0),
    COALESCE((x->>'rate')::numeric, 0), (x->>'amount')::numeric,
    CASE WHEN x->>'staff_id' IS NULL THEN GREATEST((SELECT count(DISTINCT a.staff_id) FROM labor_allocations a WHERE a.labor_requisition_id = p_req AND a.status = 'active'), 1) ELSE 1 END,
    CASE WHEN x->>'staff_id' IS NULL THEN (SELECT array_agg(DISTINCT a.staff_id) FROM labor_allocations a WHERE a.labor_requisition_id = p_req AND a.status = 'active') END,
    NULLIF((x->>'overtime_hours')::numeric, 0), NULLIF((x->>'overtime_amount')::numeric, 0)
  FROM jsonb_array_elements(v_lines) x
  WHERE (x->>'staff_id') IS NOT NULL
     OR EXISTS (SELECT 1 FROM labor_allocations a WHERE a.labor_requisition_id = p_req);

  INSERT INTO labour_pay_sheets (code, labor_requisition_id, project_id, period_start, period_end, total, lines, expense_id,
    confirmed_by, confirmed_by_name, note)
  VALUES (v_code, p_req, r.project_id, v_from, v_last, v_total, v_lines, v_expense,
    auth.uid(), (SELECT full_name FROM user_profiles WHERE id = auth.uid()), NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_sheet;

  UPDATE labour_work_entries SET pay_sheet_id = v_sheet
   WHERE labor_requisition_id = p_req AND pay_sheet_id IS NULL AND work_date <= p_to;

  PERFORM log_labour_event(p_req, 'pay_confirmed',
    format('%s · %s ETB · %s to %s', v_code, to_char(v_total, 'FM999,999,990.00'), to_char(v_from, 'DD Mon'), to_char(v_last, 'DD Mon')));
  RETURN v_sheet;
END $function$;

GRANT EXECUTE ON FUNCTION set_labour_overtime_settings(numeric, numeric, numeric, numeric, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION set_labour_overtime_rule(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION labour_overtime_day_rates(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION labour_overtime_lines(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION labour_overtime_rates(uuid, date) TO authenticated;
