-- 412 — The tax trainer: how to reach a number, for the month and the year
--
-- Management puts in a number for a tax — this month's or the year's — and
-- the trainer lays out the steps that get there, each with what it takes
-- off, in order, until the number is reached; then how much lower it can
-- go, and what is left beyond that.
--
-- Every step is worked out by running the plan (411) again with the step
-- applied on top of the ones before it, so the amounts add up exactly and
-- never count the same VAT twice. Steps are of four kinds:
--   paperwork    — reviewing receipts, recording VAT status: no cost
--   procurement  — where purchases are bought
--   timing       — moves tax between months; lowers this month, not the year
--   pay_policy   — how pay is agreed; changes what staff take home
-- and some are advice with no amount (ask the tax officer).
--
-- Only lawful levers: nothing here suggests splitting payments to stay
-- under a threshold, leaving sales off the books or skipping withholding.
-- Withholding is the vendor's tax, collected for the government, so the
-- trainer does not try to lower it — it shows how to keep it from turning
-- into the company's cost instead.
--
--   tax_plan_year_goals        a goal per tax for a fiscal year
--   tax_plan_levers(y, m, what_if)   the steps for one month
--   tax_plan_year(fiscal_period)     the year: months done, this month,
--                              the rest projected, the year goal and the
--                              monthly average the rest of the year needs

SET search_path TO public;

CREATE TABLE IF NOT EXISTS tax_plan_year_goals (
  fiscal_period_id uuid NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
  schedule_code    text NOT NULL CHECK (schedule_code IN ('VAT', 'WHT', 'SCH_A', 'PENSION')),
  goal_amount      numeric NOT NULL CHECK (goal_amount >= 0),
  note             text,
  set_by           uuid DEFAULT auth.uid(),
  set_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fiscal_period_id, schedule_code)
);
ALTER TABLE tax_plan_year_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_plan_year_goals_read  ON tax_plan_year_goals FOR SELECT USING (tax_plan_reader());
CREATE POLICY tax_plan_year_goals_write ON tax_plan_year_goals FOR ALL USING (tax_plan_manager()) WITH CHECK (tax_plan_manager());
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_plan_year_goals TO authenticated;

-- ── The steps for one month ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION tax_plan_levers(p_ec_year int DEFAULT NULL, p_ec_month int DEFAULT NULL, p_what_if jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_y int := p_ec_year; v_m int := p_ec_month;
  v_patch jsonb := COALESCE(p_what_if, '{}'::jsonb);
  v_pol jsonb; c0 jsonb; c jsonb; cn jsonb; v_steps jsonb := '[]'::jsonb;
  v_vat numeric; v_next numeric; v_amt numeric; v_n int; v_cur_min numeric; v_r numeric;
  v_is_current boolean; v_s date; v_e date;
  v_paye numeric; v_pen numeric; v_paye_g numeric; v_pen_g numeric; v_staff int; v_src text;
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see the tax plan';
  END IF;
  IF v_y IS NULL OR v_m IS NULL THEN
    SELECT ec_year, ec_month INTO v_y, v_m FROM tax_period_for_date(current_date);
  END IF;

  SELECT COALESCE(jsonb_object_agg(code, jsonb_build_object('on', is_active, 'v', value)), '{}'::jsonb) INTO v_pol FROM tax_policies;
  v_pol := v_pol || v_patch;
  c0 := tax_plan_compute(v_y, v_m, v_patch);
  c := c0;
  v_is_current := (c0->>'is_current')::boolean;
  v_s := (c0->>'start')::date; v_e := (c0->>'end')::date;
  v_r := (c0->'rates'->>'vat')::numeric;
  v_vat := (c->'schedules'->'VAT'->>'benchmark')::numeric;

  -- VAT 1: every VAT receipt reviewed in time.
  IF NOT ((v_pol->'review_receipts'->>'on')::boolean AND (v_pol->'review_receipts'->>'v')::numeric >= 100) THEN
    v_patch := v_patch || '{"review_receipts": {"on": true, "v": 100}}'::jsonb;
    cn := tax_plan_compute(v_y, v_m, v_patch);
    v_next := (cn->'schedules'->'VAT'->>'benchmark')::numeric;
    IF v_vat - v_next > 0.5 THEN
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'VAT', 'code', 'review_all', 'kind', 'paperwork',
        'title', 'Get every VAT receipt reviewed before the return',
        'detail', 'Input VAT only counts once the tax officer has reviewed the receipt. Clear the queue on the VAT tracker before the return is filed.',
        'amount', round(v_vat - v_next, 2), 'patch', '{"review_receipts": {"on": true, "v": 100}}'::jsonb, 'link', '/vat-tracker'));
    END IF;
    v_vat := v_next; c := cn;
  END IF;

  -- VAT 2: bigger purchases from VAT-registered suppliers.
  v_cur_min := CASE WHEN (v_pol->'vat_supplier_min'->>'on')::boolean THEN (v_pol->'vat_supplier_min'->>'v')::numeric END;
  IF v_cur_min IS NULL OR v_cur_min > 20000 THEN
    v_patch := v_patch || '{"vat_supplier_min": {"on": true, "v": 20000}}'::jsonb;
    cn := tax_plan_compute(v_y, v_m, v_patch);
    v_next := (cn->'schedules'->'VAT'->>'benchmark')::numeric;
    IF v_vat - v_next > 0.5 THEN
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'VAT', 'code', 'vat_supplier_20k', 'kind', 'procurement',
        'title', 'Buy anything of 20,000 or more from a VAT-registered supplier',
        'detail', (cn->'facts'->>'moved_n') || ' approved payments of that size go to suppliers who give no VAT receipt. Bought from a VAT supplier at the same price, the VAT inside is claimed back. Ask procurement to re-source them before paying.',
        'amount', round(v_vat - v_next, 2), 'patch', '{"vat_supplier_min": {"on": true, "v": 20000}}'::jsonb, 'link', '/finance/payments'));
    END IF;
    v_vat := v_next; c := cn; v_cur_min := 20000;
  END IF;
  IF v_cur_min > 10000 THEN
    v_patch := v_patch || '{"vat_supplier_min": {"on": true, "v": 10000}}'::jsonb;
    cn := tax_plan_compute(v_y, v_m, v_patch);
    v_next := (cn->'schedules'->'VAT'->>'benchmark')::numeric;
    IF v_vat - v_next > 0.5 THEN
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'VAT', 'code', 'vat_supplier_10k', 'kind', 'procurement',
        'title', 'Lower that line to 10,000',
        'detail', 'The same rule for purchases from 10,000. Smaller suppliers often don''t give VAT receipts, so this takes more effort from procurement.',
        'amount', round(v_vat - v_next, 2), 'patch', '{"vat_supplier_min": {"on": true, "v": 10000}}'::jsonb, 'link', '/finance/payments'));
    END IF;
    v_vat := v_next; c := cn;
  END IF;

  -- VAT 3: purchases nobody has said carry VAT or not (an estimate). It
  -- and step 4 are worked out here rather than by the plan, so they leave
  -- v_vat — the plan's own figure — alone, and the timing step after them
  -- is still measured plan against plan.
  -- (After step 1 every VAT receipt is assumed reviewed.)
  v_amt := COALESCE((c->'facts'->>'unknown_vat')::numeric, 0);
  v_n := COALESCE((c->'facts'->>'unknown_n')::int, 0);
  IF v_amt > 0.5 THEN
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'VAT', 'code', 'flag_unknown', 'kind', 'paperwork', 'estimate', true,
      'title', 'Find out whether ' || v_n || ' purchase' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' came with a VAT receipt',
      'detail', 'Paid to suppliers whose VAT status isn''t recorded. Each one that came with a VAT receipt can be claimed; this is the most it could be.',
      'amount', round(v_amt, 2), 'link', '/vat-tracker'));
  END IF;

  -- VAT 4 (timing): purchases from VAT suppliers waiting for approval —
  -- approved and paid this month, their VAT is claimed this month.
  IF v_is_current THEN
    SELECT count(*), COALESCE(sum(round(e.amount_etb * v_r / (1 + v_r), 2)), 0) INTO v_n, v_amt
      FROM expenses e
      LEFT JOIN vendors v ON v.id = e.vendor_id
      LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
     WHERE e.payment_state = 'unpaid' AND NOT COALESCE(e.payment_status, false)
       AND NOT COALESCE(e.is_archived, false) AND e.vendor_receipt_facilitation_id IS NULL
       AND e.expense_type IS DISTINCT FROM 'vrf' AND e.date <= v_e
       AND COALESCE(ivi.vat_applicable, true)
       AND (ivi.vat_applicable OR e.receipt_is_vat OR v.vendor_type::text = 'Supplier with VAT');
    IF v_amt > 0.5 THEN
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'VAT', 'code', 'bring_forward', 'kind', 'timing',
        'title', 'Approve and pay ' || v_n || ' delivered purchase' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' from VAT suppliers before ' || to_char(v_e, 'DD Mon'),
        'detail', 'They are waiting for approval. Paid and receipted this month, their VAT is claimed on this return instead of a later one. Only for goods already delivered, and only if the cash allows — it moves VAT earlier, it doesn''t lower the year.',
        'amount', round(v_amt, 2), 'link', '/expenses'));
    END IF;
  END IF;

  -- VAT 5 (timing): invoice next month.
  IF COALESCE((c->'facts'->>'pipe_vat')::numeric, 0) > 0.5 AND COALESCE((v_pol->'invoice_on_issue'->>'on')::boolean, false) THEN
    v_patch := v_patch || '{"invoice_on_issue": {"on": true, "v": 0}}'::jsonb;
    cn := tax_plan_compute(v_y, v_m, v_patch);
    v_next := (cn->'schedules'->'VAT'->>'benchmark')::numeric;
    IF v_vat - v_next > 0.5 THEN
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'VAT', 'code', 'invoice_next_month', 'kind', 'timing',
        'title', 'Raise the client invoice in the first days of next month',
        'detail', 'VAT is due in the month a sale is invoiced. Invoicing on the 1st instead of the 30th moves its VAT a whole return later — but the client pays later too, and it comes back next month.',
        'amount', round(v_vat - v_next, 2), 'patch', '{"invoice_on_issue": {"on": true, "v": 0}}'::jsonb, 'link', '/invoices'));
    END IF;
    v_vat := v_next; c := cn;
  END IF;

  -- WHT: nothing to lower — keep it from becoming the company's cost.
  IF COALESCE((c0->'facts'->>'wht_up_missing_n')::int, 0) > 0 THEN
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'WHT', 'code', 'withhold_before_paying', 'kind', 'protect',
      'title', 'Withhold on ' || (c0->'facts'->>'wht_up_missing_n') || ' approved payment' || CASE WHEN (c0->'facts'->>'wht_up_missing_n')::int = 1 THEN '' ELSE 's' END || ' before paying them',
      'detail', 'If it isn''t withheld, the company owes it from its own pocket.',
      'amount', 0, 'exposure', round((c0->'facts'->>'wht_up_missing')::numeric, 2), 'link', '/finance/payments'));
  END IF;
  IF COALESCE((c0->'facts'->>'wht_paid_missing_n')::int, 0) > 0 THEN
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'WHT', 'code', 'recover_missed', 'kind', 'protect',
      'title', 'Sort out ' || (c0->'facts'->>'wht_paid_missing_n') || ' payment' || CASE WHEN (c0->'facts'->>'wht_paid_missing_n')::int = 1 THEN '' ELSE 's' END || ' made without withholding',
      'detail', 'Check whether it was withheld and not recorded; if not, agree with the vendor how to settle it before the return.',
      'amount', 0, 'exposure', round((c0->'facts'->>'wht_paid_missing')::numeric, 2), 'link', '/expenses'));
  END IF;
  IF COALESCE((c0->'facts'->>'no_tin_n')::int, 0) > 0 THEN
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'WHT', 'code', 'get_tins', 'kind', 'protect',
      'title', 'Get the TIN of ' || (c0->'facts'->>'no_tin_n') || ' vendor payment' || CASE WHEN (c0->'facts'->>'no_tin_n')::int = 1 THEN '' ELSE 's' END || ' over the threshold',
      'detail', 'Without a TIN the higher withholding rate may apply and the input VAT can''t be claimed.',
      'amount', 0, 'exposure', round((c0->'facts'->>'no_tin_amt')::numeric * (c0->'rates'->>'wht')::numeric, 2), 'link', '/vendors'));
  END IF;

  -- Payroll tax and pension: what each 1% of payroll is worth, and what
  -- agreeing pay as gross instead of net would change.
  v_paye := (c0->'schedules'->'SCH_A'->>'benchmark')::numeric;
  v_pen  := (c0->'schedules'->'PENSION'->>'benchmark')::numeric;
  IF v_paye > 0 THEN
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'SCH_A', 'code', 'payroll_size', 'kind', 'info',
      'title', 'Each 1% of payroll is about ' || to_char(round(v_paye / 100), 'FM999,999,999') || ' of payroll tax',
      'detail', 'Payroll tax follows what is paid. Overtime, bonuses and new hires move it; the payroll policy above plans with a change.',
      'amount', 0));
    -- Pay is agreed net, so the company carries the tax on top. The same
    -- figures agreed as gross would carry this much less tax and pension.
    SELECT min(sp.period_label), count(*),
           COALESCE(sum(CASE WHEN b.rate IS NULL THEN 0 ELSE GREATEST(sp.net_all * (b.rate)::numeric - (b.deduct)::numeric, 0) END), 0),
           COALESCE(sum(CASE WHEN sp.pension_covered THEN sp.net_all * 0.18 ELSE 0 END), 0)
      INTO v_src, v_staff, v_paye_g, v_pen_g
      FROM v_payroll_tax_by_staff_period sp
      LEFT JOIN LATERAL (
        SELECT (bd->>'rate')::numeric AS rate, (bd->>'deduct')::numeric AS deduct
          FROM jsonb_array_elements(tax_rate_note('SCH_A', v_s)->'bands') bd
         WHERE sp.net_all >= (bd->>'min')::numeric - 0.01 AND (bd->>'max' IS NULL OR sp.net_all <= (bd->>'max')::numeric)
         LIMIT 1) b ON true
     WHERE (sp.ec_year, sp.ec_month) = (SELECT ec_year, ec_month FROM v_payroll_tax_by_staff_period
                                         WHERE (ec_year, ec_month) <= (v_y, v_m) AND net_all > 0
                                         ORDER BY ec_year DESC, ec_month DESC LIMIT 1)
       AND sp.net_all > 0;
    IF v_staff > 0 AND v_paye - v_paye_g > 0.5 THEN
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'SCH_A', 'code', 'agree_gross', 'kind', 'pay_policy',
        'title', 'Agree new pay as gross, not net',
        'detail', 'Pay is agreed as take-home today, so the company pays the tax on top (grossed up). If the same figures were agreed as gross for the ' || v_staff || ' people on ' || v_src || '''s payroll, payroll tax would be this much lower — but staff would take home less unless pay is raised. A pay policy decision for new contracts, with HR.',
        'amount', round(v_paye - v_paye_g, 2)));
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'PENSION', 'code', 'agree_gross', 'kind', 'pay_policy',
        'title', 'Agree new pay as gross, not net',
        'detail', 'Pension is 18% of gross pay. With pay agreed as gross the gross is smaller, and so is pension — with the same take-home caveat as payroll tax.',
        'amount', round(GREATEST(v_pen - v_pen_g, 0), 2)));
    END IF;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'SCH_A', 'code', 'allowances', 'kind', 'advice',
      'title', 'Ask the tax officer which allowances are tax-free',
      'detail', 'Some payments to staff — for example travel per diem and some transport allowances, within the limits the law sets — are not employment income. Paying them as allowances where they genuinely apply keeps them out of payroll tax.',
      'amount', 0));
  END IF;
  IF v_pen > 0 THEN
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('tax', 'PENSION', 'code', 'pension_fixed', 'kind', 'info',
      'title', 'Pension is a fixed 18% of gross pay',
      'detail', '7% from the employee and 11% from the company for everyone covered. It follows payroll; each 1% of payroll is about ' || to_char(round(v_pen / 100), 'FM999,999,999') || '.',
      'amount', 0));
  END IF;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('ec_year', v_y, 'ec_month', v_m, 'label', c0->>'label', 'is_current', v_is_current, 'end', v_e),
    'base', jsonb_build_object(
      'VAT', (c0->'schedules'->'VAT'->>'benchmark')::numeric, 'WHT', (c0->'schedules'->'WHT'->>'benchmark')::numeric,
      'SCH_A', v_paye, 'PENSION', v_pen),
    'steps', v_steps);
END $fn$;
REVOKE ALL ON FUNCTION tax_plan_levers(int, int, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_plan_levers(int, int, jsonb) TO authenticated;

-- ── The year ─────────────────────────────────────────────────────────
-- Months done count what was declared (or the benchmark until a return is
-- filed); this month counts its benchmark; the months ahead are projected —
-- payroll from the last payroll, VAT and WHT at the average of the last
-- three months that had any.
CREATE OR REPLACE FUNCTION tax_plan_year(p_fiscal_period_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  fy fiscal_periods%ROWTYPE; v_cur record; v_from record; v_i int; v_y int; v_m int; v_state text;
  c jsonb; v_code text; v_val numeric; v_bench numeric; v_decl numeric; v_goal numeric; v_src text;
  v_months jsonb := '{"VAT": [], "WHT": [], "SCH_A": [], "PENSION": []}'::jsonb;
  v_taxes jsonb := '[]'::jsonb; v_run numeric; v_ytd numeric; v_now numeric; v_rest numeric; v_left int; v_ygoal numeric;
  v_mgoals numeric; v_label text; arr jsonb; el jsonb;
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see the tax plan';
  END IF;
  IF p_fiscal_period_id IS NULL THEN
    SELECT * INTO fy FROM fiscal_periods WHERE is_current ORDER BY start_date DESC LIMIT 1;
  ELSE
    SELECT * INTO fy FROM fiscal_periods WHERE id = p_fiscal_period_id;
  END IF;
  IF fy.id IS NULL THEN RAISE EXCEPTION 'Fiscal year not found'; END IF;

  SELECT * INTO v_cur FROM tax_period_for_date(current_date);
  SELECT * INTO v_from FROM tax_period_for_date(fy.start_date);

  FOR v_i IN 0..11 LOOP
    v_m := ((v_from.ec_month - 1 + v_i) % 12) + 1;
    v_y := v_from.ec_year + ((v_from.ec_month - 1 + v_i) / 12);
    v_state := CASE WHEN (v_y, v_m) < (v_cur.ec_year, v_cur.ec_month) THEN 'done'
                    WHEN (v_y, v_m) = (v_cur.ec_year, v_cur.ec_month) THEN 'current' ELSE 'ahead' END;
    c := tax_plan_compute(v_y, v_m, NULL);
    FOREACH v_code IN ARRAY ARRAY['VAT', 'WHT', 'SCH_A', 'PENSION'] LOOP
      v_bench := GREATEST((c->'schedules'->v_code->>'benchmark')::numeric, 0);
      SELECT declared_amount INTO v_decl FROM tax_filings
       WHERE schedule_code = v_code AND period_ec_year = v_y AND period_ec_month = v_m LIMIT 1;
      SELECT goal_amount INTO v_goal FROM tax_plan_goals
       WHERE ec_year = v_y AND ec_month = v_m AND schedule_code = v_code;
      v_src := NULL; v_val := NULL;
      IF v_state = 'done' THEN
        v_val := COALESCE(v_decl, v_bench); v_src := CASE WHEN v_decl IS NOT NULL THEN 'declared' ELSE 'benchmark' END;
      ELSIF v_state = 'current' THEN
        v_val := v_bench; v_src := 'benchmark';
      ELSIF v_code IN ('SCH_A', 'PENSION') THEN
        v_val := v_bench; v_src := 'projected';
      END IF;
      v_months := jsonb_set(v_months, ARRAY[v_code], (v_months->v_code) || jsonb_build_array(jsonb_build_object(
        'ec_year', v_y, 'ec_month', v_m, 'label', c->>'label', 'state', v_state,
        'value', v_val, 'source', v_src, 'benchmark', v_bench, 'declared', v_decl, 'goal', v_goal)));
    END LOOP;
  END LOOP;

  FOREACH v_code IN ARRAY ARRAY['VAT', 'WHT', 'SCH_A', 'PENSION'] LOOP
    arr := v_months->v_code;
    -- Run rate for VAT and WHT: the last three months, done or current, that had any.
    SELECT avg((e->>'value')::numeric) INTO v_run FROM (
      SELECT e FROM jsonb_array_elements(arr) WITH ORDINALITY t(e, i)
       WHERE e->>'state' IN ('done', 'current') AND (e->>'value')::numeric > 0
       ORDER BY i DESC LIMIT 3) x;
    v_run := COALESCE(v_run, 0);
    -- Fill the months ahead.
    SELECT jsonb_agg(CASE WHEN e->>'state' = 'ahead' AND e->'value' = 'null'::jsonb
                          THEN e || jsonb_build_object('value', round(v_run, 2), 'source', 'run rate') ELSE e END ORDER BY i)
      INTO arr FROM jsonb_array_elements(arr) WITH ORDINALITY t(e, i);
    v_months := jsonb_set(v_months, ARRAY[v_code], arr);

    SELECT COALESCE(sum((e->>'value')::numeric) FILTER (WHERE e->>'state' = 'done'), 0),
           COALESCE(sum((e->>'value')::numeric) FILTER (WHERE e->>'state' = 'current'), 0),
           COALESCE(sum((e->>'value')::numeric) FILTER (WHERE e->>'state' = 'ahead'), 0),
           count(*) FILTER (WHERE e->>'state' IN ('current', 'ahead')),
           sum((e->>'goal')::numeric)
      INTO v_ytd, v_now, v_rest, v_left, v_mgoals
      FROM jsonb_array_elements(arr) e;
    SELECT goal_amount INTO v_ygoal FROM tax_plan_year_goals WHERE fiscal_period_id = fy.id AND schedule_code = v_code;
    SELECT display_label INTO v_label FROM tax_schedules WHERE code = v_code;
    v_taxes := v_taxes || jsonb_build_array(jsonb_build_object(
      'code', v_code, 'label', COALESCE(v_label, v_code),
      'done', round(v_ytd, 2), 'current', round(v_now, 2), 'ahead', round(v_rest, 2),
      'projected', round(v_ytd + v_now + v_rest, 2), 'run_rate', round(v_run, 2),
      'months_left', v_left, 'goal', v_ygoal, 'monthly_goals_total', v_mgoals,
      'needed_per_month', CASE WHEN v_ygoal IS NOT NULL AND v_left > 0 THEN round((v_ygoal - v_ytd) / v_left, 2) END,
      'months', arr));
    v_ygoal := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'fiscal_period', jsonb_build_object('id', fy.id, 'label', fy.label, 'start', fy.start_date, 'end', fy.end_date, 'is_current', fy.is_current),
    'current', jsonb_build_object('ec_year', v_cur.ec_year, 'ec_month', v_cur.ec_month),
    'taxes', v_taxes,
    'can_manage', tax_plan_manager());
END $fn$;
REVOKE ALL ON FUNCTION tax_plan_year(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_plan_year(uuid) TO authenticated;
