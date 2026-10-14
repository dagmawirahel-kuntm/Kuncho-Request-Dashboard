-- 451: Tax impact follows the bank's date.
--
-- The tax impact list put every open expense in the current month: a bill
-- the bank shows was paid on 23 Meskerem, but whose payment was never
-- recorded in the system, still wore a Tikimt tag and was ranked as if it
-- could still be paid this month. 62 items were in that state.
--
-- Now each expense keeps the system's date (the current month) until a
-- bank statement line confirms the payment — matched to the expense, or to
-- the transfer it was paid with. From then on it goes by the bank's value
-- date:
--   · queue 'bank' — "paid per the bank, record it" — instead of approve /
--     pay, so it no longer counts as VAT still to be won this month;
--   · its own period (the Ethiopian month of the bank date) and bank_date,
--     so its tag reads Meskerem, not Tikimt;
--   · not ranked, not in the month's gap, never escalated or overdue.
-- Everything else is as in 423/431.

CREATE OR REPLACE FUNCTION public.tax_impact_compute()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cur record; b record; s record; v jsonb; r numeric; v_today date;
  v_goal numeric; v_course numeric; v_need numeric;
  v_items jsonb;
  v_label text;
BEGIN
  SELECT * INTO s FROM tax_impact_settings;
  v_today := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  SELECT ec_year, ec_month INTO cur FROM tax_period_for_date(v_today);
  SELECT start_greg, end_greg INTO b FROM tax_period_bounds(cur.ec_year, cur.ec_month);
  v_label := ec_month_name(cur.ec_month) || ' ' || cur.ec_year;
  v := tax_forecast_vat_month(cur.ec_year, cur.ec_month);
  r := COALESCE((v->>'rate')::numeric, 0.15);
  v_course := (v->>'course')::numeric;
  SELECT goal_amount INTO v_goal FROM tax_plan_goals WHERE ec_year = cur.ec_year AND ec_month = cur.ec_month AND schedule_code = 'VAT';
  v_need := CASE WHEN v_goal IS NULL THEN NULL ELSE round(v_course - v_goal, 2) END;

  WITH ex0 AS (
    SELECT e.id, e.expense_code AS code, COALESCE(e.item_service_description, e.expense_code) AS label,
           COALESCE(vd.vendor_name, e.vendors_name) AS vendor, vd.vendor_type::text AS vtype,
           expense_due_base(e, b.end_greg) AS amount,
           CASE WHEN e.approval_status IN ('pending', 'manager_approved') THEN 'approve' ELSE 'pay' END AS queue0,
           CASE WHEN e.approval_status IN ('pending', 'manager_approved') THEN e.created_at
                ELSE COALESCE(e.finance_approved_at, e.updated_at, e.created_at) END AS entered_at,
           CASE
             WHEN ivi.vat_applicable = false THEN 'none'
             WHEN ivi.vat_applicable OR e.receipt_is_vat OR vd.vendor_type::text = 'Supplier with VAT' THEN 'vat'
             WHEN vd.vendor_type::text IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff',
                                           'Refundee', 'Government', 'Facilitation') THEN 'none'
             WHEN e.vendor_id IS NULL THEN 'none'
             ELSE 'unknown' END AS cls,
           sb.id AS po_id, sb.bundle_code AS po_code,
           -- The bank's word on when it was paid: a statement line matched to
           -- this expense, or the line for the transfer it was paid with.
           COALESCE(
             (SELECT min(l.value_date) FROM bank_statement_lines l WHERE l.matched_expense_id = e.id),
             (SELECT min(l.value_date) FROM bank_statement_lines l WHERE e.transfer_id IS NOT NULL AND l.transfer_id = e.transfer_id)
           ) AS bank_date
      FROM expenses e
      LEFT JOIN vendors vd ON vd.id = e.vendor_id
      LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
      LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
     WHERE NOT COALESCE(e.is_archived, false) AND NOT COALESCE(e.payment_status, false)
       AND e.expense_type IS DISTINCT FROM 'vrf' AND e.vendor_receipt_facilitation_id IS NULL
       AND e.date >= financials_cutover_date()
       AND (e.approval_status IN ('pending', 'manager_approved')
            OR (e.approval_status = 'finance_approved' AND COALESCE(e.payment_state, 'unpaid') IN ('unpaid', 'approved_to_pay', 'advance')))
  ),
  ex AS (
    SELECT x.id, x.code, x.label, x.vendor, x.vtype, x.amount,
           CASE WHEN x.bank_date IS NOT NULL THEN 'bank' ELSE x.queue0 END AS queue,
           x.entered_at, x.cls, x.po_id, x.po_code, x.bank_date,
           bp.ec_year AS p_year, bp.ec_month AS p_month
      FROM ex0 x
      LEFT JOIN LATERAL tax_period_for_date(x.bank_date) bp ON x.bank_date IS NOT NULL
  ),
  po AS (
    SELECT sb.id, sb.bundle_code AS code, COALESCE(vd.vendor_name, sb.vendor_name) AS label,
           COALESCE(vd.vendor_name, sb.vendor_name) AS vendor, vd.vendor_type::text AS vtype,
           round(COALESCE(sb.total_value, 0) * (1 + r), 2) AS amount,
           'raise'::text AS queue,
           COALESCE(sb.ordered_at, sb.approved_at, sb.submitted_at, sb.created_at) AS entered_at,
           CASE WHEN vd.vendor_type::text = 'Supplier with VAT' THEN 'vat'
                WHEN vd.vendor_type::text IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff',
                                              'Refundee', 'Government', 'Facilitation') OR sb.vendor_id IS NULL THEN 'none'
                ELSE 'unknown' END AS cls,
           sb.id AS po_id, sb.bundle_code AS po_code,
           NULL::date AS bank_date, NULL::int AS p_year, NULL::int AS p_month
      FROM sourcing_bundles sb LEFT JOIN vendors vd ON vd.id = sb.vendor_id
     WHERE sb.status::text IN ('submitted', 'approved', 'ordered') AND COALESCE(sb.total_value, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.sourcing_bundle_id = sb.id AND NOT COALESCE(e.is_archived, false))
  ),
  allx AS (
    SELECT 'expense'::text AS kind, ex.* FROM ex
    UNION ALL
    SELECT 'po', po.* FROM po
  ),
  valued AS (
    SELECT a.*, CASE WHEN a.cls IN ('vat', 'unknown') THEN round(a.amount * r / (1 + r), 2) ELSE 0 END AS vat,
           (a.queue <> 'bank') AS open_now
      FROM allx a
  ),
  den AS (
    SELECT CASE WHEN v_need IS NOT NULL AND v_need > 0 THEN v_need
                ELSE NULLIF(sum(vat) FILTER (WHERE cls = 'vat' AND open_now), 0) END AS d,
           CASE WHEN v_need IS NOT NULL AND v_need > 0 THEN 'goal' ELSE 'queue' END AS basis
      FROM valued
  ),
  ranked AS (
    SELECT x.*, den.d, den.basis,
           CASE WHEN x.cls = 'vat' AND x.vat > 0.5 AND x.open_now
                THEN rank() OVER (PARTITION BY (x.cls = 'vat' AND x.vat > 0.5 AND x.open_now) ORDER BY x.vat DESC, x.entered_at) END AS rnk,
           CASE WHEN x.cls = 'vat' AND x.open_now AND den.d > 0 THEN round(x.vat / den.d, 4) END AS share
      FROM valued x, den
  ),
  cum AS (
    SELECT r2.*,
           CASE WHEN r2.rnk IS NOT NULL AND r2.d > 0
                THEN round(sum(r2.vat) FILTER (WHERE r2.rnk IS NOT NULL) OVER (ORDER BY r2.rnk NULLS LAST, r2.entered_at ROWS UNBOUNDED PRECEDING) / r2.d, 4) END AS cum_share,
           r2.cls = 'vat' AND r2.open_now AND COALESCE(r2.share, 0) >= s.high_share AS high,
           GREATEST(v_today - (r2.entered_at AT TIME ZONE 'Africa/Addis_Ababa')::date, 0) AS age_days
      FROM ranked r2
  ),
  esc AS (
    SELECT c.*,
           (SELECT jsonb_build_object('id', o.id, 'code', o.code, 'vat', o.vat, 'rank', o.rnk)
              FROM cum o WHERE o.queue = c.queue AND o.kind = 'expense' AND o.id <> c.id AND o.entered_at < c.entered_at
                           AND o.vat < c.vat AND o.cls = 'vat'
             ORDER BY o.vat DESC LIMIT 1) AS overtook,
           (SELECT count(*) FROM cum o WHERE o.queue = c.queue AND o.kind = 'expense' AND o.id <> c.id
                                        AND o.entered_at < c.entered_at AND o.vat < c.vat) AS jumped
      FROM cum c
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', kind, 'id', id, 'code', code, 'label', label, 'vendor', vendor, 'vendor_type', vtype,
           'amount', round(amount, 2), 'vat', vat, 'cls', cls, 'queue', queue,
           'entered_at', entered_at, 'age_days', age_days,
           'rank', rnk, 'share', share, 'cum_share', cum_share, 'high', high,
           'reaches_goal', basis = 'goal' AND cum_share >= 1 AND cum_share - share < 1,
           'escalated', high AND kind = 'expense' AND overtook IS NOT NULL AND entered_at > now() - interval '7 days',
           'overtook', CASE WHEN high AND kind = 'expense' THEN overtook END,
           'jumped', CASE WHEN high AND kind = 'expense' THEN jumped ELSE 0 END,
           'overdue', high AND ((queue = 'approve' AND age_days >= s.approve_age_days) OR (queue = 'pay' AND age_days >= s.pay_age_days)),
           'po_id', po_id, 'po_code', po_code,
           'bank_date', bank_date,
           'period', jsonb_build_object(
             'ec_year', COALESCE(p_year, cur.ec_year), 'ec_month', COALESCE(p_month, cur.ec_month),
             'label', CASE WHEN p_month IS NULL THEN v_label ELSE ec_month_name(p_month) || ' ' || p_year END,
             'from_bank', bank_date IS NOT NULL))
         ORDER BY (queue = 'bank'), rnk NULLS LAST, (cls = 'unknown') DESC, vat DESC, entered_at), '[]'::jsonb)
    INTO v_items
    FROM esc
   WHERE cls IN ('vat', 'unknown') AND vat > 0.5;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('ec_year', cur.ec_year, 'ec_month', cur.ec_month,
      'label', v_label, 'end', b.end_greg, 'days_left', b.end_greg - v_today),
    'rate', r, 'goal', v_goal, 'course', v_course, 'need', v_need,
    'basis', CASE WHEN v_need IS NOT NULL AND v_need > 0 THEN 'goal' ELSE 'queue' END,
    'settings', jsonb_build_object('high_share', s.high_share, 'approve_age_days', s.approve_age_days,
      'pay_age_days', s.pay_age_days, 'countdown_days', s.countdown_days),
    'items', v_items);
END $function$;
