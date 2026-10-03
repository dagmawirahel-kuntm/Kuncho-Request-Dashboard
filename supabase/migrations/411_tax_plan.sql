-- 411 — A monthly tax plan: the goal, the benchmark, and the policies that move it
--
-- Management sets a goal for each tax period (VAT, WHT, Sch-A, pension).
-- Beside it the system works out a benchmark: what the period should come
-- to, from what is already in the books plus what is on its way (invoices
-- issued, payments approved, payroll still to run), with the company's tax
-- policies applied. Each policy can be switched on, off or adjusted, and the
-- page shows what that does to the benchmark before anything is saved.
--
-- What the data showed (Meskerem 2019): Nehase's VAT return showed 3.93M
-- payable because no purchase receipt had been through tax review, while
-- 1.30M of input VAT sat flagged on the VAT tracker. In Nehase 33 vendor
-- payments over 10,000 (2.19M) were paid with nothing withheld. Spend splits
-- cleanly by vendor type — "Supplier with VAT" against "Supplier with no
-- receipt" — so buying from VAT suppliers is a lever that can be measured.
--
-- Policies change what has not happened yet. A purchase already paid to a
-- supplier without a receipt stays that way; the benchmark only moves the
-- payments still to make, the receipts still to review and the invoices
-- still to raise. What already happened shows up as suggestions instead.
--
--   tax_plan_goals      the goal per period and tax, set by management
--   tax_policies        the levers, with a log of every change
--   tax_plan(y, m, what_if)   the plan for one period as JSON: per tax the
--                       recorded figure, the benchmark, the goal, what was
--                       declared and paid; each policy's effect; suggestions
--   tax_plan_history(n) the last n periods and the next two, in totals
--
-- Readers are the tax read set of 313 (tax officer, admin, finance,
-- executive). Goals and policies are set by admin or executive.

SET search_path TO public;

CREATE OR REPLACE FUNCTION tax_plan_reader()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT auth.uid() IS NOT NULL AND (is_tax_officer() OR COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false));
$fn$;
CREATE OR REPLACE FUNCTION tax_plan_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT auth.uid() IS NOT NULL AND COALESCE(get_user_role()::text IN ('admin', 'executive'), false);
$fn$;
REVOKE ALL ON FUNCTION tax_plan_reader() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tax_plan_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_plan_reader() TO authenticated;
GRANT EXECUTE ON FUNCTION tax_plan_manager() TO authenticated;

-- ── Goals ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_plan_goals (
  ec_year       int  NOT NULL,
  ec_month      int  NOT NULL CHECK (ec_month BETWEEN 1 AND 12),
  schedule_code text NOT NULL CHECK (schedule_code IN ('VAT', 'WHT', 'SCH_A', 'PENSION')),
  goal_amount   numeric NOT NULL CHECK (goal_amount >= 0),
  note          text,
  set_by        uuid DEFAULT auth.uid(),
  set_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ec_year, ec_month, schedule_code)
);
ALTER TABLE tax_plan_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_plan_goals_read  ON tax_plan_goals FOR SELECT USING (tax_plan_reader());
CREATE POLICY tax_plan_goals_write ON tax_plan_goals FOR ALL USING (tax_plan_manager()) WITH CHECK (tax_plan_manager());
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_plan_goals TO authenticated;

-- ── Policies ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_policies (
  code          text PRIMARY KEY,
  area          text NOT NULL CHECK (area IN ('procurement', 'sales', 'payroll', 'compliance')),
  name          text NOT NULL,
  description   text,
  unit          text NOT NULL CHECK (unit IN ('pct', 'etb')),
  value         numeric NOT NULL,
  is_active     boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 0,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tax_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_policies_read  ON tax_policies FOR SELECT USING (tax_plan_reader());
CREATE POLICY tax_policies_write ON tax_policies FOR UPDATE USING (tax_plan_manager()) WITH CHECK (tax_plan_manager());
GRANT SELECT, UPDATE ON tax_policies TO authenticated;

CREATE TABLE IF NOT EXISTS tax_policy_log (
  id            bigserial PRIMARY KEY,
  code          text NOT NULL REFERENCES tax_policies(code) ON DELETE CASCADE,
  old_is_active boolean, old_value numeric,
  is_active     boolean, value numeric,
  changed_by    uuid DEFAULT auth.uid(),
  changed_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tax_policy_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_policy_log_read ON tax_policy_log FOR SELECT USING (tax_plan_reader());
GRANT SELECT ON tax_policy_log TO authenticated;

CREATE OR REPLACE FUNCTION log_tax_policy_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  IF NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.value IS DISTINCT FROM OLD.value THEN
    INSERT INTO tax_policy_log (code, old_is_active, old_value, is_active, value)
    VALUES (NEW.code, OLD.is_active, OLD.value, NEW.is_active, NEW.value);
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_log_tax_policy_change BEFORE UPDATE ON tax_policies
  FOR EACH ROW EXECUTE FUNCTION log_tax_policy_change();

INSERT INTO tax_policies (code, area, name, description, unit, value, is_active, display_order) VALUES
  ('review_receipts', 'compliance', 'Review VAT receipts before the return',
   'Input VAT only counts once the tax officer has reviewed the receipt. This is the share of VAT-carrying purchases expected to be reviewed in time.',
   'pct', 100, true, 1),
  ('vat_supplier_min', 'procurement', 'Buy from VAT-registered suppliers from this amount',
   'Purchases still to be paid at or above this amount go to a supplier who gives a VAT receipt, so their VAT can be claimed back.',
   'etb', 20000, false, 2),
  ('withhold_all', 'compliance', 'Withhold on every payment over the threshold',
   'Vendor payments over the withholding threshold (goods 20,000, services 10,000 before VAT) have 3% withheld. Withholding is the vendor''s tax collected for the government — it is not a cost to the company.',
   'pct', 100, true, 3),
  ('invoice_on_issue', 'sales', 'Invoice payment requests in the month they are issued',
   'A payment request sent to a client becomes a sales invoice, and its VAT is due, in the month it is invoiced. This is the share expected to be invoiced this month.',
   'pct', 100, true, 4),
  ('payroll_change', 'payroll', 'Payroll compared with last month',
   'When this month''s payroll has not run yet, it is projected from the last one, changed by this much (headcount or pay changes).',
   'pct', 0, true, 5)
ON CONFLICT (code) DO NOTHING;

-- ── The numbers for one period ───────────────────────────────────────
-- p_pol: {code: {"on": bool, "v": number}}, merged over the saved policies.
CREATE OR REPLACE FUNCTION tax_plan_compute(p_y int, p_m int, p_pol jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s date; v_e date;
  v_cur record;
  v_is_current boolean; v_is_future boolean;
  v_pol jsonb;
  v_vat_r numeric; v_wht jsonb; v_wht_r numeric; v_goods numeric; v_services numeric;
  f_review numeric; f_invoice numeric; f_withhold numeric; v_min numeric; v_min_on boolean; v_pay_chg numeric;
  -- VAT
  v_out_recorded numeric; v_sales_n int;
  v_in_claimed numeric;
  v_pending_vat numeric; v_pending_n int;
  v_unknown_vat numeric; v_unknown_n int; v_unknown_amt numeric;
  v_up_vat numeric; v_up_n int;
  v_moved_vat numeric; v_moved_n int; v_moved_amt numeric;
  v_pipe_vat numeric; v_pipe_n int; v_pipe_amt numeric;
  -- WHT
  v_wht_recorded numeric; v_wht_up numeric; v_wht_up_missing numeric; v_wht_up_missing_n int;
  v_wht_paid_missing numeric; v_wht_paid_missing_n int; v_wht_paid_missing_amt numeric;
  v_no_tin_n int; v_no_tin_amt numeric;
  -- Payroll
  v_paye_paid numeric; v_paye_all numeric; v_pen_paid numeric; v_pen_all numeric; v_net_unpaid numeric;
  v_pay_rows int; v_proj_from text; v_paye_base numeric := 0; v_pen_base numeric := 0;
  v_vat_bench numeric; v_wht_bench numeric; v_paye_bench numeric; v_pen_bench numeric;
BEGIN
  SELECT start_greg, end_greg INTO v_s, v_e FROM tax_period_bounds(p_y, p_m);
  SELECT * INTO v_cur FROM tax_period_for_date(current_date);
  v_is_current := (p_y, p_m) = (v_cur.ec_year, v_cur.ec_month);
  v_is_future  := (p_y, p_m) > (v_cur.ec_year, v_cur.ec_month);

  SELECT COALESCE(jsonb_object_agg(code, jsonb_build_object('on', is_active, 'v', value)), '{}'::jsonb)
    INTO v_pol FROM tax_policies;
  v_pol := v_pol || COALESCE(p_pol, '{}'::jsonb);
  f_review   := CASE WHEN (v_pol->'review_receipts'->>'on')::boolean  THEN LEAST(GREATEST((v_pol->'review_receipts'->>'v')::numeric, 0), 100) / 100 ELSE 0 END;
  f_invoice  := CASE WHEN (v_pol->'invoice_on_issue'->>'on')::boolean THEN LEAST(GREATEST((v_pol->'invoice_on_issue'->>'v')::numeric, 0), 100) / 100 ELSE 0 END;
  f_withhold := CASE WHEN (v_pol->'withhold_all'->>'on')::boolean     THEN LEAST(GREATEST((v_pol->'withhold_all'->>'v')::numeric, 0), 100) / 100 ELSE 0 END;
  v_min_on   := COALESCE((v_pol->'vat_supplier_min'->>'on')::boolean, false);
  v_min      := GREATEST(COALESCE((v_pol->'vat_supplier_min'->>'v')::numeric, 0), 0);
  v_pay_chg  := CASE WHEN (v_pol->'payroll_change'->>'on')::boolean THEN COALESCE((v_pol->'payroll_change'->>'v')::numeric, 0) / 100 ELSE 0 END;

  v_vat_r    := COALESCE((tax_rate_note('VAT', v_s)->>'standard_rate')::numeric, 0.15);
  v_wht      := tax_rate_note('WHT', v_s);
  v_wht_r    := COALESCE((v_wht->>'rate')::numeric, 0.03);
  v_goods    := COALESCE((v_wht->>'goods_threshold_etb')::numeric, 20000);
  v_services := COALESCE((v_wht->>'services_threshold_etb')::numeric, 10000);

  -- ── VAT on sales ──
  SELECT COALESCE(sum(output_vat), 0), COALESCE(sum(sale_count), 0) INTO v_out_recorded, v_sales_n
    FROM v_vat_output_by_ec_period WHERE ec_year = p_y AND ec_month = p_m;

  -- Payment requests sent but not invoiced yet (amounts include VAT, 340).
  -- Those issued this period, plus for the current period any still open
  -- from before — they will be invoiced now if at all.
  SELECT COALESCE(sum(round(r.amount * v_vat_r / (1 + v_vat_r), 2)), 0), count(*), COALESCE(sum(r.amount), 0)
    INTO v_pipe_vat, v_pipe_n, v_pipe_amt
    FROM client_payment_requests r
    CROSS JOIN LATERAL tax_period_for_date(r.request_date) tp
   WHERE r.status = 'issued' AND r.sale_id IS NULL
     AND ((tp.ec_year = p_y AND tp.ec_month = p_m) OR (v_is_current AND (tp.ec_year, tp.ec_month) < (p_y, p_m)));

  -- ── VAT on purchases ──
  SELECT COALESCE(sum(input_vat), 0) INTO v_in_claimed
    FROM v_vat_input_by_ec_period WHERE ec_year = p_y AND ec_month = p_m;

  -- Paid purchases this return claims (the VAT tracker's declaration month),
  -- not reviewed yet: those known to carry VAT, and those nobody has looked at.
  WITH t AS (
    SELECT t.*, v.vendor_type::text AS vtype, e.receipt_is_vat
      FROM v_input_vat_tracker t
      JOIN expenses e ON e.id = t.expense_id
      LEFT JOIN vendors v ON v.id = t.vendor_id
     WHERE t.declare_ec_year = p_y AND t.declare_ec_month = p_m AND NOT COALESCE(t.claimable, false)
  ), c AS (
    SELECT t.*, CASE
        WHEN t.vat_applicable = false THEN 'none'
        WHEN t.vat_applicable = true OR t.receipt_is_vat OR t.vtype = 'Supplier with VAT' THEN 'vat'
        WHEN t.vtype IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff', 'Refundee', 'Government') THEN 'none'
        ELSE 'unknown' END AS cls
      FROM t
  )
  SELECT COALESCE(sum(vat_amount) FILTER (WHERE cls = 'vat'), 0), count(*) FILTER (WHERE cls = 'vat'),
         COALESCE(sum(vat_amount) FILTER (WHERE cls = 'unknown'), 0), count(*) FILTER (WHERE cls = 'unknown'),
         COALESCE(sum(amount_etb) FILTER (WHERE cls = 'unknown'), 0)
    INTO v_pending_vat, v_pending_n, v_unknown_vat, v_unknown_n, v_unknown_amt
    FROM c;

  -- Payments approved and still to make: they land in the current period.
  -- Those to VAT suppliers bring VAT to claim; those to suppliers without a
  -- receipt would, under the VAT-supplier policy, if at or above its amount.
  WITH up AS (
    SELECT e.amount_etb AS amt, CASE
        WHEN ivi.vat_applicable = false THEN 'none'
        WHEN ivi.vat_applicable = true OR e.receipt_is_vat OR v.vendor_type::text = 'Supplier with VAT' THEN 'vat'
        ELSE 'other' END AS cls
      FROM expenses e
      LEFT JOIN vendors v ON v.id = e.vendor_id
      LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
     WHERE v_is_current AND e.payment_state = 'approved_to_pay' AND NOT COALESCE(e.payment_status, false)
       AND NOT COALESCE(e.is_archived, false) AND e.vendor_receipt_facilitation_id IS NULL
       AND e.expense_type IS DISTINCT FROM 'vrf'
       AND COALESCE(v.vendor_type::text, '') NOT IN ('Staff', 'Refundee', 'Government')
  )
  SELECT COALESCE(sum(round(amt * v_vat_r / (1 + v_vat_r), 2)) FILTER (WHERE cls = 'vat'), 0), count(*) FILTER (WHERE cls = 'vat'),
         COALESCE(sum(round(amt * v_vat_r / (1 + v_vat_r), 2)) FILTER (WHERE cls = 'other' AND amt >= v_min), 0),
         count(*) FILTER (WHERE cls = 'other' AND amt >= v_min),
         COALESCE(sum(amt) FILTER (WHERE cls = 'other' AND amt >= v_min), 0)
    INTO v_up_vat, v_up_n, v_moved_vat, v_moved_n, v_moved_amt
    FROM up;

  -- ── Withholding ──
  SELECT COALESCE(sum(wht_withheld), 0) INTO v_wht_recorded
    FROM v_wht_payable_by_ec_period WHERE ec_year = p_y AND ec_month = p_m;

  WITH l AS (
    SELECT e.payment_status AS paid, COALESCE(e.wht_amount, 0) AS wht, v.tin,
           CASE WHEN e.receipt_is_vat OR v.vendor_type::text = 'Supplier with VAT' THEN e.amount_etb / (1 + v_vat_r) ELSE e.amount_etb END AS base,
           CASE WHEN v.vendor_type::text IN ('Service Provider', 'Contractor', 'Labor Broker') THEN v_services ELSE v_goods END AS threshold
      FROM expenses e
      LEFT JOIN vendors v ON v.id = e.vendor_id
     WHERE NOT COALESCE(e.is_archived, false) AND e.vendor_receipt_facilitation_id IS NULL
       AND e.expense_type IS DISTINCT FROM 'vrf'
       AND e.vendor_id IS NOT NULL
       AND COALESCE(v.vendor_type::text, '') NOT IN ('Staff', 'Refundee', 'Government')
       AND ((e.payment_status AND EXISTS (SELECT 1 FROM tax_period_for_date(COALESCE(e.total_payment_date, e.paid_date::date, e.date)) tp
                                          WHERE tp.ec_year = p_y AND tp.ec_month = p_m))
            OR (v_is_current AND e.payment_state = 'approved_to_pay' AND NOT COALESCE(e.payment_status, false)))
  )
  SELECT COALESCE(sum(wht) FILTER (WHERE NOT paid), 0),
         COALESCE(sum(round(base * v_wht_r, 2)) FILTER (WHERE NOT paid AND wht = 0 AND base >= threshold), 0),
         count(*) FILTER (WHERE NOT paid AND wht = 0 AND base >= threshold),
         COALESCE(sum(round(base * v_wht_r, 2)) FILTER (WHERE paid AND wht = 0 AND base >= threshold), 0),
         count(*) FILTER (WHERE paid AND wht = 0 AND base >= threshold),
         COALESCE(sum(base) FILTER (WHERE paid AND wht = 0 AND base >= threshold), 0),
         count(*) FILTER (WHERE base >= threshold AND NULLIF(btrim(tin), '') IS NULL),
         COALESCE(sum(base) FILTER (WHERE base >= threshold AND NULLIF(btrim(tin), '') IS NULL), 0)
    INTO v_wht_up, v_wht_up_missing, v_wht_up_missing_n, v_wht_paid_missing, v_wht_paid_missing_n, v_wht_paid_missing_amt, v_no_tin_n, v_no_tin_amt
    FROM l;

  -- ── Payroll tax and pension ──
  SELECT count(*), COALESCE(sum(paye_paid), 0), COALESCE(sum(paye_incl_unpaid), 0),
         COALESCE(sum(pension_employee_paid + pension_employer_paid), 0),
         COALESCE(sum(pension_employee_incl_unpaid + pension_employer_incl_unpaid), 0),
         COALESCE(sum(net_all - net_paid), 0)
    INTO v_pay_rows, v_paye_paid, v_paye_all, v_pen_paid, v_pen_all, v_net_unpaid
    FROM v_payroll_tax_by_staff_period WHERE ec_year = p_y AND ec_month = p_m;

  -- No payroll yet this period: project the last one that ran.
  IF v_pay_rows = 0 AND (v_is_current OR v_is_future) THEN
    SELECT min(period_label), COALESCE(sum(paye_incl_unpaid), 0), COALESCE(sum(pension_employee_incl_unpaid + pension_employer_incl_unpaid), 0)
      INTO v_proj_from, v_paye_base, v_pen_base
      FROM v_payroll_tax_by_staff_period
     WHERE (ec_year, ec_month) = (SELECT ec_year, ec_month FROM v_payroll_tax_by_staff_period
                                   WHERE (ec_year, ec_month) < (p_y, p_m) AND net_all > 0
                                   ORDER BY ec_year DESC, ec_month DESC LIMIT 1);
  END IF;

  v_vat_bench  := round(v_out_recorded + f_invoice * v_pipe_vat
                        - (v_in_claimed + f_review * (v_pending_vat + v_up_vat) + CASE WHEN v_min_on THEN f_review * v_moved_vat ELSE 0 END), 2);
  v_wht_bench  := round(v_wht_recorded + v_wht_up + f_withhold * v_wht_up_missing, 2);
  v_paye_bench := round(CASE WHEN v_pay_rows > 0 THEN v_paye_all ELSE v_paye_base * (1 + v_pay_chg) END, 2);
  v_pen_bench  := round(CASE WHEN v_pay_rows > 0 THEN v_pen_all  ELSE v_pen_base  * (1 + v_pay_chg) END, 2);

  RETURN jsonb_build_object(
    'ec_year', p_y, 'ec_month', p_m, 'label', ec_month_name(p_m) || ' ' || p_y,
    'start', v_s, 'end', v_e, 'is_current', v_is_current, 'is_future', v_is_future,
    'rates', jsonb_build_object('vat', v_vat_r, 'wht', v_wht_r, 'wht_goods', v_goods, 'wht_services', v_services),
    'schedules', jsonb_build_object(
      'VAT', jsonb_build_object(
        'recorded', round(v_out_recorded - v_in_claimed, 2), 'benchmark', v_vat_bench,
        'parts', jsonb_build_array(
          jsonb_build_object('label', 'VAT on sales invoiced', 'amount', v_out_recorded, 'count', v_sales_n),
          jsonb_build_object('label', 'VAT on payment requests still to invoice', 'amount', round(f_invoice * v_pipe_vat, 2), 'count', v_pipe_n, 'full', v_pipe_vat),
          jsonb_build_object('label', 'Input VAT on reviewed receipts', 'amount', -v_in_claimed),
          jsonb_build_object('label', 'Input VAT on purchases awaiting review', 'amount', -round(f_review * v_pending_vat, 2), 'count', v_pending_n, 'full', v_pending_vat),
          jsonb_build_object('label', 'Input VAT on approved payments to VAT suppliers', 'amount', -round(f_review * v_up_vat, 2), 'count', v_up_n, 'full', v_up_vat),
          jsonb_build_object('label', 'Input VAT from moving purchases to VAT suppliers', 'amount', -round(CASE WHEN v_min_on THEN f_review * v_moved_vat ELSE 0 END, 2), 'count', v_moved_n, 'full', v_moved_vat)),
        'effects', jsonb_build_object(
          'review_receipts', -round(f_review * (v_pending_vat + v_up_vat + CASE WHEN v_min_on THEN v_moved_vat ELSE 0 END), 2),
          'vat_supplier_min', -round(CASE WHEN v_min_on THEN f_review * v_moved_vat ELSE 0 END, 2),
          'invoice_on_issue', round(f_invoice * v_pipe_vat, 2))),
      'WHT', jsonb_build_object(
        'recorded', v_wht_recorded, 'benchmark', v_wht_bench,
        'parts', jsonb_build_array(
          jsonb_build_object('label', 'Withheld on payments made', 'amount', v_wht_recorded),
          jsonb_build_object('label', 'Already set on approved payments', 'amount', v_wht_up),
          jsonb_build_object('label', 'Still to set on approved payments over the threshold', 'amount', round(f_withhold * v_wht_up_missing, 2), 'count', v_wht_up_missing_n, 'full', v_wht_up_missing)),
        'effects', jsonb_build_object('withhold_all', round(f_withhold * v_wht_up_missing, 2))),
      'SCH_A', jsonb_build_object(
        'recorded', v_paye_paid, 'benchmark', v_paye_bench,
        'parts', CASE WHEN v_pay_rows > 0 THEN jsonb_build_array(
            jsonb_build_object('label', 'On salaries paid', 'amount', v_paye_paid),
            jsonb_build_object('label', 'On salaries still to pay', 'amount', round(v_paye_all - v_paye_paid, 2)))
          ELSE jsonb_build_array(jsonb_build_object('label', COALESCE('Projected from ' || v_proj_from, 'No payroll recorded'), 'amount', v_paye_bench)) END,
        'effects', jsonb_build_object('payroll_change', round(CASE WHEN v_pay_rows > 0 THEN 0 ELSE v_paye_base * v_pay_chg END, 2))),
      'PENSION', jsonb_build_object(
        'recorded', v_pen_paid, 'benchmark', v_pen_bench,
        'parts', CASE WHEN v_pay_rows > 0 THEN jsonb_build_array(
            jsonb_build_object('label', 'On salaries paid (7% + 11%)', 'amount', v_pen_paid),
            jsonb_build_object('label', 'On salaries still to pay', 'amount', round(v_pen_all - v_pen_paid, 2)))
          ELSE jsonb_build_array(jsonb_build_object('label', COALESCE('Projected from ' || v_proj_from, 'No payroll recorded'), 'amount', v_pen_bench)) END,
        'effects', jsonb_build_object('payroll_change', round(CASE WHEN v_pay_rows > 0 THEN 0 ELSE v_pen_base * v_pay_chg END, 2)))),
    'facts', jsonb_build_object(
      'pending_vat', v_pending_vat, 'pending_n', v_pending_n,
      'unknown_vat', v_unknown_vat, 'unknown_n', v_unknown_n, 'unknown_amt', v_unknown_amt,
      'moved_vat', v_moved_vat, 'moved_n', v_moved_n, 'moved_amt', v_moved_amt, 'vat_supplier_min', v_min,
      'pipe_vat', v_pipe_vat, 'pipe_n', v_pipe_n, 'pipe_amt', v_pipe_amt,
      'wht_up_missing', v_wht_up_missing, 'wht_up_missing_n', v_wht_up_missing_n,
      'wht_paid_missing', v_wht_paid_missing, 'wht_paid_missing_n', v_wht_paid_missing_n, 'wht_paid_missing_amt', v_wht_paid_missing_amt,
      'no_tin_n', v_no_tin_n, 'no_tin_amt', v_no_tin_amt,
      'payroll_rows', v_pay_rows, 'payroll_projected_from', v_proj_from, 'net_unpaid', v_net_unpaid));
END $fn$;
REVOKE ALL ON FUNCTION tax_plan_compute(int, int, jsonb) FROM PUBLIC, anon, authenticated;

-- ── The plan for a period ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tax_plan(p_ec_year int DEFAULT NULL, p_ec_month int DEFAULT NULL, p_what_if jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_y int := p_ec_year; v_m int := p_ec_month;
  c jsonb; f jsonb; v_sched jsonb := '[]'::jsonb; v_pol jsonb; v_sugg jsonb := '[]'::jsonb; v_due jsonb;
  v_code text; v_label text; s jsonb; g record; fl record;
  t_rec numeric := 0; t_bench numeric := 0; t_goal numeric; t_decl numeric; t_paid numeric; t_bench_goaled numeric := 0;
  v_vat_due date; v_gap numeric; v_min_on boolean;
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see the tax plan';
  END IF;
  IF v_y IS NULL OR v_m IS NULL THEN
    SELECT ec_year, ec_month INTO v_y, v_m FROM tax_period_for_date(current_date);
  END IF;

  c := tax_plan_compute(v_y, v_m, p_what_if);
  f := c->'facts';

  FOREACH v_code IN ARRAY ARRAY['VAT', 'WHT', 'SCH_A', 'PENSION'] LOOP
    s := c->'schedules'->v_code;
    SELECT display_label INTO v_label FROM tax_schedules WHERE code = v_code;
    SELECT goal_amount, note INTO g FROM tax_plan_goals WHERE ec_year = v_y AND ec_month = v_m AND schedule_code = v_code;
    SELECT id, status, declared_amount, paid_amount, due_date_greg, payment_date INTO fl
      FROM tax_filings WHERE schedule_code = v_code AND period_ec_year = v_y AND period_ec_month = v_m LIMIT 1;
    IF v_code = 'VAT' THEN v_vat_due := fl.due_date_greg; END IF;
    v_sched := v_sched || jsonb_build_array(s || jsonb_build_object(
      'code', v_code, 'label', COALESCE(v_label, v_code),
      'goal', g.goal_amount, 'goal_note', g.note,
      'filing_id', fl.id, 'filing_status', fl.status, 'declared', fl.declared_amount, 'paid', fl.paid_amount,
      'due_date', fl.due_date_greg, 'payment_date', fl.payment_date));
    -- A VAT credit is carried forward, not paid back: totals count what is paid.
    t_rec   := t_rec + GREATEST((s->>'recorded')::numeric, 0);
    t_bench := t_bench + GREATEST((s->>'benchmark')::numeric, 0);
    IF g.goal_amount IS NOT NULL THEN
      t_goal := COALESCE(t_goal, 0) + g.goal_amount;
      t_bench_goaled := t_bench_goaled + GREATEST((s->>'benchmark')::numeric, 0);
    END IF;
    IF fl.declared_amount IS NOT NULL THEN t_decl := COALESCE(t_decl, 0) + fl.declared_amount; END IF;
    IF fl.paid_amount IS NOT NULL THEN t_paid := COALESCE(t_paid, 0) + fl.paid_amount; END IF;
  END LOOP;

  -- Policies with what each does to this period.
  SELECT jsonb_agg(jsonb_build_object(
           'code', p.code, 'area', p.area, 'name', p.name, 'description', p.description, 'unit', p.unit,
           'saved_value', p.value, 'saved_active', p.is_active,
           'value', COALESCE((p_what_if->p.code->>'v')::numeric, p.value),
           'is_active', COALESCE((p_what_if->p.code->>'on')::boolean, p.is_active),
           'updated_at', p.updated_at,
           'effect', COALESCE((c->'schedules'->'VAT'->'effects'->>p.code)::numeric, 0)
                   + COALESCE((c->'schedules'->'WHT'->'effects'->>p.code)::numeric, 0)
                   + COALESCE((c->'schedules'->'SCH_A'->'effects'->>p.code)::numeric, 0)
                   + COALESCE((c->'schedules'->'PENSION'->'effects'->>p.code)::numeric, 0))
         ORDER BY p.display_order)
    INTO v_pol FROM tax_policies p;

  -- ── Suggestions ──
  IF (f->>'pending_n')::int > 0 THEN
    v_sugg := v_sugg || jsonb_build_array(jsonb_build_object('key', 'review', 'tone', 'save',
      'title', 'Review ' || (f->>'pending_n') || ' VAT receipt' || CASE WHEN (f->>'pending_n')::int = 1 THEN '' ELSE 's' END || ' before the return',
      'detail', 'These purchases carry VAT but no receipt has been through tax review, so none of it can be claimed yet.'
                || CASE WHEN v_vat_due IS NOT NULL THEN ' The VAT return is due ' || to_char(v_vat_due, 'DD Mon') || '.' ELSE '' END,
      'amount', round((f->>'pending_vat')::numeric, 2), 'amount_label', 'less VAT to pay', 'link', '/vat-tracker'));
  END IF;
  IF (f->>'unknown_n')::int > 0 THEN
    v_sugg := v_sugg || jsonb_build_array(jsonb_build_object('key', 'unknown', 'tone', 'save',
      'title', 'Find out whether ' || (f->>'unknown_n') || ' purchase' || CASE WHEN (f->>'unknown_n')::int = 1 THEN '' ELSE 's' END || ' carry VAT',
      'detail', 'Paid to suppliers whose VAT status isn''t recorded (' || to_char(round((f->>'unknown_amt')::numeric), 'FM999,999,999') || ' in all). If they gave VAT receipts, this much can be claimed. Mark them on the VAT tracker.',
      'amount', round((f->>'unknown_vat')::numeric, 2), 'amount_label', 'possible VAT to claim', 'link', '/vat-tracker'));
  END IF;
  IF (f->>'moved_n')::int > 0 THEN
    v_min_on := COALESCE((p_what_if->'vat_supplier_min'->>'on')::boolean, (SELECT is_active FROM tax_policies WHERE code = 'vat_supplier_min'), false);
    v_sugg := v_sugg || jsonb_build_array(jsonb_build_object('key', 'vat_supplier', 'tone', 'save',
      'title', (f->>'moved_n') || ' approved payment' || CASE WHEN (f->>'moved_n')::int = 1 THEN '' ELSE 's' END || ' of ' || to_char((f->>'vat_supplier_min')::numeric, 'FM999,999,999') || '+ go to suppliers without a VAT receipt',
      'detail', 'Buying the same from a VAT-registered supplier would let the VAT inside ' || to_char(round((f->>'moved_amt')::numeric), 'FM999,999,999') || ' be claimed back.'
                || CASE WHEN v_min_on THEN ' The procurement policy counts on it — send these to VAT suppliers.' ELSE ' Switch on the procurement policy to plan with it.' END,
      'amount', round((f->>'moved_vat')::numeric, 2), 'amount_label', 'VAT that could be claimed', 'link', '/finance/payments'));
  END IF;
  IF (f->>'wht_up_missing_n')::int > 0 THEN
    v_sugg := v_sugg || jsonb_build_array(jsonb_build_object('key', 'wht_up', 'tone', 'risk',
      'title', 'Set withholding on ' || (f->>'wht_up_missing_n') || ' approved payment' || CASE WHEN (f->>'wht_up_missing_n')::int = 1 THEN '' ELSE 's' END || ' before paying',
      'detail', 'They are over the withholding threshold and have nothing withheld. Withheld tax comes out of the vendor''s payment, not the company''s pocket — but if it isn''t withheld the company owes it.',
      'amount', round((f->>'wht_up_missing')::numeric, 2), 'amount_label', 'to withhold', 'link', '/finance/payments'));
  END IF;
  IF (f->>'wht_paid_missing_n')::int > 0 THEN
    v_sugg := v_sugg || jsonb_build_array(jsonb_build_object('key', 'wht_paid', 'tone', 'risk',
      'title', (f->>'wht_paid_missing_n') || ' payment' || CASE WHEN (f->>'wht_paid_missing_n')::int = 1 THEN ' was' ELSE 's were' END || ' made over the threshold with nothing withheld',
      'detail', to_char(round((f->>'wht_paid_missing_amt')::numeric), 'FM999,999,999') || ' paid this period. Check whether withholding was recorded somewhere else; if not, the company is liable for it.',
      'amount', round((f->>'wht_paid_missing')::numeric, 2), 'amount_label', 'not withheld', 'link', '/expenses'));
  END IF;
  IF (f->>'no_tin_n')::int > 0 THEN
    v_sugg := v_sugg || jsonb_build_array(jsonb_build_object('key', 'no_tin', 'tone', 'risk',
      'title', (f->>'no_tin_n') || ' payment' || CASE WHEN (f->>'no_tin_n')::int = 1 THEN '' ELSE 's' END || ' over the threshold to vendors with no TIN on file',
      'detail', 'Without a TIN their input VAT can''t be claimed and withholding may be at the higher rate. Add the TIN on the vendor.',
      'amount', round((f->>'no_tin_amt')::numeric, 2), 'amount_label', 'paid, before VAT', 'link', '/vendors'));
  END IF;
  IF (f->>'pipe_n')::int > 0 THEN
    v_sugg := v_sugg || jsonb_build_array(jsonb_build_object('key', 'pipeline', 'tone', 'info',
      'title', (f->>'pipe_n') || ' payment request' || CASE WHEN (f->>'pipe_n')::int = 1 THEN '' ELSE 's' END || ' sent, not invoiced yet',
      'detail', 'Its VAT is due in the month it is invoiced. Invoicing early in a month gives the most time before the return; invoicing on the 1st of next month moves the VAT a whole return later.',
      'amount', round((f->>'pipe_vat')::numeric, 2), 'amount_label', 'VAT on it', 'link', '/invoices'));
  END IF;
  -- Only the taxes that have a goal are measured against it.
  IF t_goal IS NOT NULL THEN
    v_gap := t_bench_goaled - t_goal;
    v_sugg := jsonb_build_array(jsonb_build_object('key', 'goal', 'tone', CASE WHEN v_gap > 0 THEN 'risk' ELSE 'good' END,
      'title', CASE WHEN v_gap > 0 THEN 'The benchmark is ' || to_char(round(v_gap), 'FM999,999,999') || ' above the goal'
                    ELSE 'On track: the benchmark is within the goal' END,
      'detail', CASE WHEN v_gap > 0 THEN 'The policies and the suggestions below are the levers that bring it down.'
                     ELSE to_char(round(-v_gap), 'FM999,999,999') || ' of room left this month.' END,
      'amount', round(abs(v_gap), 2), 'amount_label', CASE WHEN v_gap > 0 THEN 'over the goal' ELSE 'under the goal' END)) || v_sugg;
  END IF;

  -- What falls due for payment inside this period, whatever period it is for.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'filing_id', tf.id, 'code', tf.schedule_code, 'period_label', tf.period_label,
           'ec_year', tf.period_ec_year, 'ec_month', tf.period_ec_month,
           'due_date', tf.due_date_greg, 'status', tf.status, 'declared', tf.declared_amount, 'paid', tf.paid_amount,
           'expected', CASE WHEN tf.period_ec_month IS NOT NULL AND tf.schedule_code IN ('VAT', 'WHT', 'SCH_A', 'PENSION')
                            THEN GREATEST((tax_plan_compute(tf.period_ec_year, tf.period_ec_month, p_what_if)->'schedules'->tf.schedule_code->>'benchmark')::numeric, 0) END)
         ORDER BY tf.due_date_greg, tf.schedule_code), '[]'::jsonb)
    INTO v_due
    FROM tax_filings tf
   WHERE tf.due_date_greg BETWEEN (c->>'start')::date AND (c->>'end')::date;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('ec_year', v_y, 'ec_month', v_m, 'label', c->>'label', 'start', c->'start', 'end', c->'end',
                                 'is_current', c->'is_current', 'is_future', c->'is_future'),
    'rates', c->'rates',
    'schedules', v_sched,
    'totals', jsonb_build_object('recorded', round(t_rec, 2), 'benchmark', round(t_bench, 2), 'goal', t_goal, 'declared', t_decl, 'paid', t_paid),
    'policies', COALESCE(v_pol, '[]'::jsonb),
    'suggestions', v_sugg,
    'due_in_period', v_due,
    'facts', f,
    'can_manage', tax_plan_manager());
END $fn$;
REVOKE ALL ON FUNCTION tax_plan(int, int, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_plan(int, int, jsonb) TO authenticated;

-- ── The months around now, in totals ─────────────────────────────────
CREATE OR REPLACE FUNCTION tax_plan_history(p_back int DEFAULT 5)
RETURNS TABLE (ec_year int, ec_month int, label text, is_current boolean,
               recorded numeric, benchmark numeric, goal numeric, declared numeric, paid numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_cur record; v_i int; v_y int; v_m int; c jsonb; v_code text; s jsonb;
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see the tax plan';
  END IF;
  SELECT * INTO v_cur FROM tax_period_for_date(current_date);
  FOR v_i IN REVERSE LEAST(GREATEST(p_back, 0), 24)..-2 LOOP
    v_m := ((v_cur.ec_month - 1 - v_i) % 12 + 12) % 12 + 1;
    v_y := v_cur.ec_year + floor((v_cur.ec_month - 1 - v_i)::numeric / 12)::int;
    c := tax_plan_compute(v_y, v_m, NULL);
    ec_year := v_y; ec_month := v_m; label := c->>'label'; is_current := (c->>'is_current')::boolean;
    recorded := 0; benchmark := 0;
    FOREACH v_code IN ARRAY ARRAY['VAT', 'WHT', 'SCH_A', 'PENSION'] LOOP
      s := c->'schedules'->v_code;
      recorded  := recorded  + GREATEST((s->>'recorded')::numeric, 0);
      benchmark := benchmark + GREATEST((s->>'benchmark')::numeric, 0);
    END LOOP;
    SELECT sum(g.goal_amount) INTO goal FROM tax_plan_goals g WHERE g.ec_year = v_y AND g.ec_month = v_m;
    SELECT sum(tf.declared_amount), sum(tf.paid_amount) INTO declared, paid
      FROM tax_filings tf WHERE tf.period_ec_year = v_y AND tf.period_ec_month = v_m
       AND tf.schedule_code IN ('VAT', 'WHT', 'SCH_A', 'PENSION');
    RETURN NEXT;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION tax_plan_history(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_plan_history(int) TO authenticated;
