-- 422 — What each purchase order could do for a month's saved VAT goal
--
-- The tax plan (411, 419) says how far a month's VAT is from the goal
-- management saved for it, and lists the ways to close the gap in total.
-- This breaks the purchase side down by purchase order, for the admin
-- toggle on the Purchase orders pages: for each PO, the input VAT it could
-- still bring into that month and the one step that gets it there.
--
-- A PO's input VAT is claimed in the month it is paid, against a VAT
-- receipt. So, for the chosen month:
--   counted   paid, receipt reviewed, claimed in this month — already in
--             the month's course
--   receipt   paid and due in this month's return, receipt not captured or
--             reviewed yet — free to claim
--   pay       payment approved (or sent, or an advance to settle) — claimed
--             if paid before the month ends (this month only)
--   raise     no payment request yet, or not approved — claimed only if
--             raised, approved and paid in the month
--   later     paid and declared in another month — nothing for this one
-- and by supplier:
--   vat       a VAT supplier, or the receipt is a VAT receipt
--   unknown   vendor type does not say ("Supplier") — ask for a VAT receipt
--   none      no VAT receipt (no-receipt supplier, TOT, individual …): could
--             only claim if bought from a VAT supplier at the same total
--
-- Like the goal page, the gap is measured from the month's course (nothing
-- more done) to the saved goal, so receipts and approved bills count as
-- PO contributions here. Buying more to create input VAT is never the
-- point: every 1.15 spent brings back 0.15.
--
-- Also corrects tax_forecast's open-orders VAT: PO totals are before VAT,
-- so the VAT on them is total x 15%, not total x 15/115 (it was 13% low).

SET search_path TO public;

CREATE OR REPLACE FUNCTION tax_po_goal_effect(p_ec_year int DEFAULT NULL, p_ec_month int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  cur record; y int; m int; v jsonb; r numeric; v_current boolean;
  v_goal numeric; v_course numeric; v_steps numeric; v_need numeric;
  v_goal_months jsonb; v_pos jsonb; v_label text;
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see the tax plan';
  END IF;
  SELECT ec_year, ec_month INTO cur FROM tax_period_for_date(current_date);

  -- Months in the forecast window (this one and the next five) with a saved VAT goal
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ec_year', g.ec_year, 'ec_month', g.ec_month,
           'label', ec_month_name(g.ec_month) || ' ' || g.ec_year, 'goal', g.goal_amount) ORDER BY g.ec_year, g.ec_month), '[]'::jsonb)
    INTO v_goal_months
    FROM tax_plan_goals g
   WHERE g.schedule_code = 'VAT'
     AND g.ec_year * 12 + g.ec_month BETWEEN cur.ec_year * 12 + cur.ec_month AND cur.ec_year * 12 + cur.ec_month + 5;

  -- Default: the first month with a goal, else this month
  y := COALESCE(p_ec_year, (v_goal_months->0->>'ec_year')::int, cur.ec_year);
  m := COALESCE(p_ec_month, (v_goal_months->0->>'ec_month')::int, cur.ec_month);
  IF y * 12 + m < cur.ec_year * 12 + cur.ec_month OR y * 12 + m > cur.ec_year * 12 + cur.ec_month + 5 THEN
    RAISE EXCEPTION 'Pick this month or one of the next five';
  END IF;
  v_current := (y, m) = (cur.ec_year, cur.ec_month);
  v_label := ec_month_name(m) || ' ' || y;

  v := tax_forecast_vat_month(y, m);
  r := COALESCE((v->>'rate')::numeric, 0.15);
  v_course := (v->>'course')::numeric;
  v_steps := (v->>'with_steps')::numeric;
  SELECT goal_amount INTO v_goal FROM tax_plan_goals WHERE ec_year = y AND ec_month = m AND schedule_code = 'VAT';
  v_need := CASE WHEN v_goal IS NULL THEN NULL ELSE round(v_course - v_goal, 2) END;

  WITH po AS (
    SELECT sb.id, sb.bundle_code, sb.status::text AS status, COALESCE(sb.total_value, 0) AS total,
           COALESCE(vd.vendor_name, sb.vendor_name) AS vendor, vd.vendor_type::text AS vtype
      FROM sourcing_bundles sb LEFT JOIN vendors vd ON vd.id = sb.vendor_id
     WHERE sb.status::text IN ('submitted', 'approved', 'ordered', 'fulfilled')
  ),
  ex AS (
    SELECT e.sourcing_bundle_id AS po_id, COALESCE(e.amount_etb, 0) AS amt, e.payment_state, COALESCE(e.payment_status, false) AS paid,
           CASE
             WHEN ivi.vat_applicable = false THEN 'none'
             WHEN ivi.vat_applicable OR e.receipt_is_vat OR po.vtype = 'Supplier with VAT' THEN 'vat'
             WHEN po.vtype IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff', 'Refundee', 'Government', 'Facilitation') THEN 'none'
             ELSE 'unknown' END AS cls,
           COALESCE(t.vat_amount, round(COALESCE(e.amount_etb, 0) * r / (1 + r), 2)) AS vat,
           CASE
             WHEN t.expense_id IS NOT NULL AND (t.declare_ec_year, t.declare_ec_month) = (y, m) AND COALESCE(t.claimable, false) THEN 'counted'
             WHEN t.expense_id IS NOT NULL AND (t.declare_ec_year, t.declare_ec_month) = (y, m) THEN 'receipt'
             WHEN t.expense_id IS NOT NULL OR COALESCE(e.payment_status, false) THEN 'later'
             -- approved or in flight: lands this month, so only counts for this month
             WHEN e.payment_state IN ('approved_to_pay', 'sent', 'advance') THEN CASE WHEN v_current THEN 'pay' ELSE 'later' END
             ELSE 'raise' END AS stage
      FROM expenses e
      JOIN po ON po.id = e.sourcing_bundle_id
      LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
      LEFT JOIN v_input_vat_tracker t ON t.expense_id = e.id
     WHERE NOT COALESCE(e.is_archived, false)
  ),
  -- What the PO is worth beyond its payment requests: still to be raised.
  -- PO totals are before VAT (the payment request is the total x 1.15 in
  -- 140 of 145 single-request POs), payment requests include it.
  rest AS (
    SELECT po.id AS po_id, GREATEST(po.total * (1 + r) - COALESCE((SELECT sum(amt) FROM ex WHERE ex.po_id = po.id), 0), 0) AS amt,
           CASE WHEN po.vtype = 'Supplier with VAT' THEN 'vat'
                WHEN po.vtype IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff', 'Refundee', 'Government', 'Facilitation') THEN 'none'
                ELSE 'unknown' END AS cls
      FROM po WHERE po.status <> 'fulfilled' OR NOT EXISTS (SELECT 1 FROM ex WHERE ex.po_id = po.id)
  ),
  parts AS (
    SELECT po_id, cls, stage, vat, amt FROM ex
    UNION ALL
    SELECT po_id, cls, 'raise', round(amt * r / (1 + r), 2), amt FROM rest WHERE amt > 0.5
  ),
  agg AS (
    SELECT po.id, po.bundle_code, po.status, po.total, po.vendor, po.vtype,
           COALESCE(sum(p.vat) FILTER (WHERE p.cls = 'vat' AND p.stage = 'counted'), 0) AS counted,
           COALESCE(sum(p.vat) FILTER (WHERE p.cls = 'vat' AND p.stage = 'receipt'), 0) AS receipt,
           COALESCE(sum(p.vat) FILTER (WHERE p.cls = 'vat' AND p.stage = 'pay'), 0) AS pay,
           COALESCE(sum(p.vat) FILTER (WHERE p.cls = 'vat' AND p.stage = 'raise'), 0) AS raise,
           COALESCE(sum(p.vat) FILTER (WHERE p.cls = 'unknown' AND p.stage IN ('receipt', 'pay', 'raise')), 0) AS ask,
           COALESCE(sum(p.vat) FILTER (WHERE p.cls = 'none' AND p.stage IN ('pay', 'raise')), 0) AS switch
      FROM po LEFT JOIN parts p ON p.po_id = po.id
     GROUP BY po.id, po.bundle_code, po.status, po.total, po.vendor, po.vtype
  ),
  ranked AS (
    SELECT a.*, a.receipt + a.pay + a.raise AS potential,
           sum(a.receipt + a.pay + a.raise) OVER (ORDER BY a.receipt + a.pay + a.raise DESC, a.bundle_code) AS running
      FROM agg a
     WHERE a.counted + a.receipt + a.pay + a.raise + a.ask + a.switch > 0.5
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'code', bundle_code, 'status', status, 'vendor', vendor, 'vendor_type', vtype, 'total', round(total, 2),
           'counted', round(counted, 2), 'receipt', round(receipt, 2), 'pay', round(pay, 2), 'raise', round(raise, 2),
           'ask', round(ask, 2), 'switch', round(switch, 2), 'potential', round(potential, 2),
           'share', CASE WHEN v_need > 0 THEN round(LEAST(potential, v_need) / v_need, 4) END,
           -- with this and every bigger PO done, is the goal reached?
           'reaches_goal', v_need IS NOT NULL AND v_need > 0 AND running >= v_need AND running - potential < v_need,
           'step', CASE
             WHEN potential > 0.5 AND receipt >= GREATEST(pay, raise) THEN 'receipt'
             WHEN potential > 0.5 AND pay >= raise THEN 'pay'
             WHEN potential > 0.5 THEN 'raise'
             WHEN ask > 0.5 THEN 'ask'
             WHEN switch > 0.5 THEN 'switch'
             ELSE 'counted' END)
         ORDER BY potential DESC, ask DESC, switch DESC, bundle_code), '[]'::jsonb)
    INTO v_pos
    FROM ranked;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('ec_year', y, 'ec_month', m, 'label', v_label, 'is_current', v_current),
    'rate', r,
    'goal', v_goal,
    'course', v_course,
    'with_steps', v_steps,
    'need', v_need,
    'goal_months', v_goal_months,
    'totals', (SELECT jsonb_build_object(
        'potential', COALESCE(round(sum((x->>'potential')::numeric), 2), 0),
        'receipt', COALESCE(round(sum((x->>'receipt')::numeric), 2), 0),
        'pay', COALESCE(round(sum((x->>'pay')::numeric), 2), 0),
        'raise', COALESCE(round(sum((x->>'raise')::numeric), 2), 0),
        'ask', COALESCE(round(sum((x->>'ask')::numeric), 2), 0),
        'switch', COALESCE(round(sum((x->>'switch')::numeric), 2), 0),
        'counted', COALESCE(round(sum((x->>'counted')::numeric), 2), 0),
        'pos', count(*) FILTER (WHERE (x->>'potential')::numeric > 0.5))
      FROM jsonb_array_elements(v_pos) x),
    'pos', v_pos);
END $fn$;
REVOKE ALL ON FUNCTION tax_po_goal_effect(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_po_goal_effect(int, int) TO authenticated;

-- tax_forecast: open orders' VAT on a before-VAT total
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('tax_forecast(int)'::regprocedure);
  n := replace(d, $o$'vat', round(COALESCE(sum(sb.total_value) FILTER (WHERE vd.vendor_type::text = 'Supplier with VAT'), 0) * r / (1 + r)))$o$,
                  $o$'vat', round(COALESCE(sum(sb.total_value) FILTER (WHERE vd.vendor_type::text = 'Supplier with VAT'), 0) * r))$o$);
  IF n = d AND position($o$0) * r))$o$ IN d) = 0 THEN RAISE EXCEPTION 'tax_forecast open-orders line not found'; END IF;
  EXECUTE n;
END $$;
