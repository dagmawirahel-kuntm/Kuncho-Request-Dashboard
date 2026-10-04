-- 419 — Tax forecast with expectations, and working back from a VAT goal
--
-- The tax plan (411, 412) looks at one month at a time from what is already
-- in the books. Management also knows what is coming — a progress payment
-- to invoice, equipment to buy — and asks questions like "can we get a VAT
-- return (a credit) in Tikimt, and how?". The data (Meskerem 2019):
--
--   * Every VAT return so far has been payable (Hamle 893K, Nehase 3.93M),
--     with no input VAT claimed: 38 Nehase purchases (1.30M VAT) still need
--     their receipts, and 10.4M paid to VAT suppliers in four months has
--     never been claimed.
--   * Coming: a 9.41M payment request not yet invoiced (1.23M VAT), three
--     contract milestones not billed (25.4M gross, 3.3M VAT), 8.98M of
--     approved bills to pay (7.2M to VAT suppliers) and 14.7M of open orders.
--
--   tax_forecast_expectations   what management expects: a sale or purchase,
--                               in a month, with or without VAT; a contract
--                               milestone can be scheduled into a month
--   tax_forecast(months)        each tax for this month and the next ones —
--                               VAT on its current course and with the open
--                               steps done, a VAT credit carried month to
--                               month, the goals, and what is coming but not
--                               yet placed in a month
--   tax_vat_goal(y, m, target)  work back from a VAT goal (negative = a
--                               credit): how far it is, the ways to close it
--                               in order of effort, whether it can be reached,
--                               and when it can't, what it would take and why
--                               buying to create VAT never pays

SET search_path TO public;

-- ── What management expects ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_forecast_expectations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ec_year int NOT NULL,
  ec_month int NOT NULL CHECK (ec_month BETWEEN 1 AND 13),
  kind text NOT NULL CHECK (kind IN ('sale', 'purchase')),
  label text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  amount_includes_vat boolean NOT NULL DEFAULT true,
  -- a sale that carries VAT; a purchase from a supplier who gives a VAT receipt
  vat_applies boolean NOT NULL DEFAULT true,
  milestone_id uuid REFERENCES payment_milestones(id) ON DELETE SET NULL,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_forecast_expectations_period ON tax_forecast_expectations (ec_year, ec_month);
ALTER TABLE tax_forecast_expectations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_forecast_expectations_read ON tax_forecast_expectations FOR SELECT USING (tax_plan_reader());
CREATE POLICY tax_forecast_expectations_write ON tax_forecast_expectations FOR ALL USING (tax_plan_reader()) WITH CHECK (tax_plan_reader());
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_forecast_expectations TO authenticated;

-- ── VAT for one month, in parts ────────────────────────────────────────
-- From the plan's own computation (411) so the two agree, plus what is
-- expected. "Course" is what happens with nothing more done; the open steps
-- are capturing this month's receipts and, this month, paying the approved
-- bills to VAT suppliers.
CREATE OR REPLACE FUNCTION tax_forecast_vat_month(p_y int, p_m int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  c jsonb; parts jsonb; r numeric; cur record; v_current boolean;
  v_out numeric; v_pipe numeric; v_claimed numeric; v_waiting numeric; v_approved numeric;
  e_out numeric; e_in numeric; e_wht numeric; e_n int;
  v_course numeric; v_steps numeric;
BEGIN
  c := tax_plan_compute(p_y, p_m, NULL);
  parts := c->'schedules'->'VAT'->'parts';
  r := COALESCE((c->'rates'->>'vat')::numeric, 0.15);
  SELECT ec_year, ec_month INTO cur FROM tax_period_for_date(current_date);
  v_current := (cur.ec_year, cur.ec_month) = (p_y, p_m);

  v_out      := COALESCE((parts->0->>'amount')::numeric, 0);
  v_pipe     := COALESCE((parts->1->>'full')::numeric, 0);
  v_claimed  := -COALESCE((parts->2->>'amount')::numeric, 0);
  v_waiting  := COALESCE((parts->3->>'full')::numeric, 0);
  v_approved := COALESCE((parts->4->>'full')::numeric, 0);

  SELECT COALESCE(sum(CASE WHEN vat_applies THEN CASE WHEN amount_includes_vat THEN amount * r / (1 + r) ELSE amount * r END ELSE 0 END) FILTER (WHERE kind = 'sale'), 0),
         COALESCE(sum(CASE WHEN vat_applies THEN CASE WHEN amount_includes_vat THEN amount * r / (1 + r) ELSE amount * r END ELSE 0 END) FILTER (WHERE kind = 'purchase'), 0),
         -- purchases over the goods threshold have 3% withheld from the vendor
         COALESCE(sum(CASE WHEN (CASE WHEN vat_applies AND amount_includes_vat THEN amount / (1 + r) ELSE amount END) >= COALESCE((c->'rates'->>'wht_goods')::numeric, 20000)
                           THEN (CASE WHEN vat_applies AND amount_includes_vat THEN amount / (1 + r) ELSE amount END) * COALESCE((c->'rates'->>'wht')::numeric, 0.03) ELSE 0 END)
                  FILTER (WHERE kind = 'purchase'), 0),
         count(*)
    INTO e_out, e_in, e_wht, e_n
    FROM tax_forecast_expectations WHERE ec_year = p_y AND ec_month = p_m;

  v_course := round(v_out + v_pipe + e_out - v_claimed - e_in, 2);
  v_steps  := round(v_course - v_waiting - v_approved, 2);

  RETURN jsonb_build_object(
    'rate', r, 'is_current', v_current,
    'sales_invoiced', round(v_out, 2), 'sales_to_invoice', round(v_pipe, 2), 'sales_expected', round(e_out, 2),
    'input_claimed', round(v_claimed, 2), 'input_expected', round(e_in, 2),
    'input_waiting_receipts', round(v_waiting, 2), 'input_approved_bills', round(v_approved, 2),
    'course', v_course, 'with_steps', v_steps,
    'expected_wht', round(e_wht, 2), 'expectations', e_n,
    'plan', c);
END $fn$;
REVOKE ALL ON FUNCTION tax_forecast_vat_month(int, int) FROM PUBLIC, anon, authenticated;

-- ── The forecast ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tax_forecast(p_months int DEFAULT 6)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  cur record; i int; y int; m int; idx int; v jsonb; c jsonb; b record;
  v_credit numeric := 0; v_net numeric; v_pos numeric; v_credit_out numeric;
  v_months jsonb := '[]'::jsonb; v_goals jsonb; r numeric := 0.15;
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see the tax plan';
  END IF;
  SELECT ec_year, ec_month INTO cur FROM tax_period_for_date(current_date);

  FOR i IN 0 .. GREATEST(LEAST(COALESCE(p_months, 6), 12), 1) - 1 LOOP
    idx := cur.ec_year * 12 + (cur.ec_month - 1) + i;
    y := idx / 12; m := idx % 12 + 1;
    v := tax_forecast_vat_month(y, m);
    c := v->'plan';
    r := (v->>'rate')::numeric;
    SELECT start_greg, end_greg INTO b FROM tax_period_bounds(y, m);

    -- A VAT credit is carried into the next return and used against it.
    v_net := (v->>'with_steps')::numeric;
    v_pos := v_net - v_credit;
    v_credit_out := GREATEST(-v_pos, 0);

    SELECT COALESCE(jsonb_object_agg(schedule_code, goal_amount), '{}'::jsonb) INTO v_goals
      FROM tax_plan_goals WHERE ec_year = y AND ec_month = m;

    v_months := v_months || jsonb_build_object(
      'ec_year', y, 'ec_month', m, 'label', ec_month_name(m) || ' ' || y,
      'start', b.start_greg, 'end', b.end_greg, 'is_current', i = 0,
      'vat', (v - 'plan' - 'rate' - 'is_current') || jsonb_build_object(
          'credit_in', round(v_credit, 2), 'payable', round(GREATEST(v_pos, 0), 2), 'credit_out', round(v_credit_out, 2)),
      'wht', round((c->'schedules'->'WHT'->>'benchmark')::numeric + (v->>'expected_wht')::numeric, 2),
      'sch_a', round((c->'schedules'->'SCH_A'->>'benchmark')::numeric, 2),
      'pension', round((c->'schedules'->'PENSION'->>'benchmark')::numeric, 2),
      'payroll_projected', (c->'facts'->>'payroll_rows')::int = 0,
      'goals', v_goals,
      'expectations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', x.id, 'kind', x.kind, 'label', x.label, 'amount', x.amount, 'amount_includes_vat', x.amount_includes_vat,
            'vat_applies', x.vat_applies, 'milestone_id', x.milestone_id, 'note', x.note,
            'vat', round(CASE WHEN x.vat_applies THEN CASE WHEN x.amount_includes_vat THEN x.amount * r / (1 + r) ELSE x.amount * r END ELSE 0 END, 2))
            ORDER BY x.kind DESC, x.amount DESC)
          FROM tax_forecast_expectations x WHERE x.ec_year = y AND x.ec_month = m), '[]'::jsonb));
    v_credit := v_credit_out;
  END LOOP;

  RETURN jsonb_build_object(
    'rate', r,
    'months', v_months,
    -- Coming, but not placed in a month yet
    'unscheduled', jsonb_build_object(
      'milestones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', pm.id, 'title', pm.title, 'kind', pm.kind, 'project', p.project_name, 'gross', pm.gross_amount_etb,
                 'vat', round(pm.gross_amount_etb - COALESCE(pm.gross_excl_vat_etb, pm.gross_amount_etb / (1 + r)), 2))
               ORDER BY pm.gross_amount_etb DESC)
          FROM payment_milestones pm LEFT JOIN projects p ON p.id = pm.project_id
         WHERE pm.status = 'pending'
           AND NOT EXISTS (SELECT 1 FROM tax_forecast_expectations x WHERE x.milestone_id = pm.id)
           -- already asked for: the payment request is counted where it was issued
           AND NOT EXISTS (SELECT 1 FROM client_payment_requests cr WHERE cr.milestone_id = pm.id AND cr.status = 'issued')), '[]'::jsonb),
      'open_orders', (
        SELECT jsonb_build_object('count', count(*), 'value', round(COALESCE(sum(sb.total_value), 0)),
                                  'vat', round(COALESCE(sum(sb.total_value) FILTER (WHERE vd.vendor_type::text = 'Supplier with VAT'), 0) * r / (1 + r)))
          FROM sourcing_bundles sb LEFT JOIN vendors vd ON vd.id = sb.vendor_id
         WHERE sb.status::text IN ('ordered', 'approved', 'submitted')
           AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.sourcing_bundle_id = sb.id AND NOT COALESCE(e.is_archived, false)))),
    'can_manage', tax_plan_reader());
END $fn$;
REVOKE ALL ON FUNCTION tax_forecast(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_forecast(int) TO authenticated;

-- ── Working back from a VAT goal ───────────────────────────────────────
-- Ways to lower a month's VAT, easiest first. Each says how much it can do
-- (capacity) and how much of it the goal needs (used). Timing moves only
-- shift VAT between months; buying to create input VAT never pays: every
-- 1.15 spent brings back 0.15.
CREATE OR REPLACE FUNCTION tax_vat_goal(p_ec_year int, p_ec_month int, p_target numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  f jsonb; mo jsonb; vat jsonb; r numeric; cur record; v_current boolean;
  v_course numeric; v_need numeric; v_left numeric; v_use numeric; v_total numeric := 0;
  v_levers jsonb := '[]'::jsonb; l record; v_reached text; v_closest numeric; v_remaining numeric;
  v_late numeric; v_orders numeric; v_switch numeric; v_move_in numeric; v_credit_months jsonb := '[]'::jsonb;
  v_cum numeric; v_used_up text; mm jsonb; v_i int := 0; v_idx int;
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see the tax plan';
  END IF;
  IF p_target IS NULL THEN RAISE EXCEPTION 'Give the VAT you want to end the month at (a minus figure is a credit)'; END IF;

  f := tax_forecast(6);
  SELECT x INTO mo FROM jsonb_array_elements(f->'months') x
   WHERE (x->>'ec_year')::int = p_ec_year AND (x->>'ec_month')::int = p_ec_month;
  IF mo IS NULL THEN RAISE EXCEPTION 'Pick this month or one of the next five'; END IF;
  vat := mo->'vat';
  r := (f->>'rate')::numeric;
  SELECT ec_year, ec_month INTO cur FROM tax_period_for_date(current_date);
  v_current := (cur.ec_year, cur.ec_month) = (p_ec_year, p_ec_month);

  v_course := (vat->>'course')::numeric;
  v_need := round(v_course - p_target, 2);

  -- Capacities that need their own lookups (this month only)
  IF v_current THEN
    SELECT COALESCE(sum(vat_amount), 0) INTO v_late FROM v_input_vat_tracker
     WHERE stage IN ('needs_receipt', 'in_review', 'unflagged') AND (declare_ec_year, declare_ec_month) < (p_ec_year, p_ec_month);
    v_orders := COALESCE((f->'unscheduled'->'open_orders'->>'vat')::numeric, 0);
    SELECT COALESCE(sum(e.amount_etb), 0) * r / (1 + r) INTO v_switch
      FROM expenses e LEFT JOIN vendors vd ON vd.id = e.vendor_id
     WHERE e.payment_state = 'approved_to_pay' AND NOT COALESCE(e.payment_status, false) AND NOT COALESCE(e.is_archived, false)
       AND COALESCE(vd.vendor_type::text, '') IN ('Supplier with no receipt', 'Supplier', 'Individual', 'Supplier with TOT');
  ELSE
    v_late := 0; v_orders := 0; v_switch := 0;
  END IF;
  -- Purchases expected in other forecast months that could be brought into this one
  SELECT COALESCE(sum((x->>'vat')::numeric), 0) INTO v_move_in
    FROM jsonb_array_elements(f->'months') mx, jsonb_array_elements(mx->'expectations') x
   WHERE x->>'kind' = 'purchase' AND NOT ((mx->>'ec_year')::int = p_ec_year AND (mx->>'ec_month')::int = p_ec_month)
     AND ((mx->>'ec_year')::int * 12 + (mx->>'ec_month')::int) > (p_ec_year * 12 + p_ec_month);

  v_left := GREATEST(v_need, 0);
  FOR l IN
    SELECT * FROM (VALUES
      (1, 'paperwork', 'capture_receipts', 'Capture and review this month''s VAT receipts',
          'Purchases this return should claim whose receipts are not captured or reviewed yet. Free — it only needs the receipts in on time.',
          (vat->>'input_waiting_receipts')::numeric, NULL::text, '/vat-tracker'),
      (2, 'paperwork', 'late_claims', 'Claim VAT on earlier purchases never claimed',
          'Purchases from earlier months whose receipts were never captured or flagged. Only if the law still allows claiming them in this return — check the claim window with the tax officer before counting on it.',
          v_late, 'Depends on the claim window', '/vat-tracker'),
      (3, 'timing', 'pay_approved', 'Pay the approved bills to VAT suppliers before the month ends',
          'Their VAT is claimed in the month they are paid. It moves cash out earlier; it is not a saving, only the month the VAT is claimed.',
          CASE WHEN v_current THEN (vat->>'input_approved_bills')::numeric ELSE 0 END, 'Cash goes out sooner', '/finance/payments'),
      (4, 'timing', 'open_orders', 'Raise and pay open orders to VAT suppliers this month',
          'Orders placed with VAT suppliers that have no payment request yet. Only for goods needed now — paying early to claim early only moves VAT between months.',
          v_orders, 'Only for goods needed now', '/sourcing'),
      (5, 'timing', 'bring_forward', 'Bring planned purchases forward into this month',
          'Purchases you expect in later months, from VAT suppliers. Same caution: only if they are needed now.',
          v_move_in, 'Moves VAT from a later month', NULL),
      (6, 'procurement', 'switch_suppliers', 'Buy the approved no-receipt purchases from VAT suppliers instead',
          'Approved purchases from suppliers who give no VAT receipt. From a VAT supplier at the same total price, the VAT in it could be claimed. If the VAT supplier is dearer by the VAT, nothing is gained.',
          v_switch, 'Only at the same total price', '/finance/payments'),
      (7, 'sales_timing', 'invoice_later', 'Invoice later — move sales out of this month',
          'VAT falls due when a sale is invoiced (or paid). Holding an invoice back only moves its VAT to next month, delays the client''s payment and may breach the contract. A last resort, not a saving.',
          (vat->>'sales_to_invoice')::numeric + (vat->>'sales_expected')::numeric, 'Delays cash from the client', '/invoices')
    ) AS t(ord, tier, code, title, detail, capacity, caveat, link)
    ORDER BY ord
  LOOP
    CONTINUE WHEN COALESCE(l.capacity, 0) <= 0.5;
    v_use := LEAST(l.capacity, v_left);
    v_left := v_left - v_use;
    v_total := v_total + l.capacity;
    IF v_reached IS NULL AND v_need > 0 AND v_left <= 0.5 THEN v_reached := l.tier; END IF;
    v_levers := v_levers || jsonb_build_object('code', l.code, 'tier', l.tier, 'title', l.title, 'detail', l.detail,
      'capacity', round(l.capacity, 2), 'used', round(v_use, 2), 'caveat', l.caveat, 'link', l.link);
  END LOOP;

  IF v_need <= 0 THEN v_reached := 'already'; END IF;
  v_closest := round(v_course - v_total, 2);
  v_remaining := CASE WHEN v_reached IS NULL THEN round(v_closest - p_target, 2) ELSE 0 END;

  -- How fast a credit at the target would be used up by the months after
  IF p_target < 0 THEN
    v_cum := -p_target;
    FOR mm IN SELECT x FROM jsonb_array_elements(f->'months') x LOOP
      v_idx := (mm->>'ec_year')::int * 12 + (mm->>'ec_month')::int;
      CONTINUE WHEN v_idx <= p_ec_year * 12 + p_ec_month;
      v_credit_months := v_credit_months || jsonb_build_object('label', mm->>'label',
        'vat', round((mm->'vat'->>'with_steps')::numeric, 2),
        'credit_left', round(GREATEST(v_cum - GREATEST((mm->'vat'->>'with_steps')::numeric, 0), 0), 2));
      v_cum := v_cum - GREATEST((mm->'vat'->>'with_steps')::numeric, 0);
      IF v_used_up IS NULL AND v_cum <= 0 THEN v_used_up := mm->>'label'; END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('ec_year', p_ec_year, 'ec_month', p_ec_month, 'label', mo->>'label', 'is_current', v_current),
    'rate', r, 'target', p_target,
    'course', v_course, 'with_steps', (vat->>'with_steps')::numeric, 'need', v_need,
    'parts', vat,
    'reached_with', v_reached,          -- already | paperwork | timing | procurement | sales_timing | null (not reachable)
    'levers', v_levers,
    'closest', v_closest,
    'remaining', v_remaining,
    -- If it can't be reached: what closing the rest would take
    'would_take', CASE WHEN v_reached IS NULL THEN jsonb_build_object(
        'purchases_incl_vat', round(v_remaining * (1 + r) / r, 2),
        'cash_cost', round(v_remaining / r, 2),
        'invoicing_incl_vat', round(v_remaining * (1 + r) / r, 2)) END,
    'credit', CASE WHEN p_target < 0 THEN jsonb_build_object(
        'amount', -p_target, 'used_up_in', v_used_up, 'months', v_credit_months) END);
END $fn$;
REVOKE ALL ON FUNCTION tax_vat_goal(int, int, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_vat_goal(int, int, numeric) TO authenticated;
