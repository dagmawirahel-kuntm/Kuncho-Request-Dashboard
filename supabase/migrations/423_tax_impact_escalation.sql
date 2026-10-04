-- 423 — Tax impact: rank, escalate and age the expenses that move the VAT goal
--
-- 103 unpaid expenses carry 2.18M of claimable VAT and the ten biggest hold
-- 64% of it, but the approval and payment queues are oldest-first, so a
-- 2.5M bill with 326K of VAT waited 15 days behind small ones. This gives
-- every open item a place in one ranking for the month and lets the big
-- ones jump the line, without changing who approves or how.
--
--   T-tags     every item that brings claimable VAT this month gets a rank,
--              T1 the biggest. Items are unpaid expenses (waiting for
--              approval, or approved and waiting for payment) and purchase
--              orders with no payment request yet, so a PO and the expense
--              raised from it carry the same tag. The rank is the same on
--              every screen: queues, PO list, expense page, the table.
--   Impact     VAT as a share of the gap to the month's saved VAT goal (or,
--              with no goal or the goal already met, of all VAT waiting).
--              5% or more is high impact.
--   Escalated  a high-impact expense that entered its queue in the last 7
--              days, after others
--              that bring less VAT: it goes ahead of them, and says which
--              one it overtook. Order only — approval rules are unchanged.
--   Overdue    high impact and waiting more than 3 days for approval or 5
--              days for payment; shown on Operations health.
--   Countdown  in the month's last 7 days, the VAT still waiting to be paid
--              or approved, with the last day to pay it.
--
-- VAT counts only from suppliers who give VAT receipts. Vendors listed just
-- as "Supplier" are not ranked: the step is to ask them for one.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS tax_impact_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  high_share numeric NOT NULL DEFAULT 0.05 CHECK (high_share > 0 AND high_share < 1),
  approve_age_days int NOT NULL DEFAULT 3 CHECK (approve_age_days >= 1),
  pay_age_days int NOT NULL DEFAULT 5 CHECK (pay_age_days >= 1),
  countdown_days int NOT NULL DEFAULT 7 CHECK (countdown_days BETWEEN 1 AND 30),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO tax_impact_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE tax_impact_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tis_read ON tax_impact_settings FOR SELECT USING (tax_plan_reader());
CREATE POLICY tis_manage ON tax_impact_settings FOR UPDATE
  USING (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role]));
GRANT SELECT, UPDATE ON tax_impact_settings TO authenticated;

-- Escalations a person has already seen (the nudge stops repeating).
CREATE TABLE IF NOT EXISTS tax_impact_seen (
  user_id uuid NOT NULL DEFAULT auth.uid(),
  item_id uuid NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
ALTER TABLE tax_impact_seen ENABLE ROW LEVEL SECURITY;
CREATE POLICY tise_own ON tax_impact_seen FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, DELETE ON tax_impact_seen TO authenticated;

-- ── The ranking (no access check: callers check) ─────────────────────────
CREATE OR REPLACE FUNCTION tax_impact_compute()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  cur record; b record; s record; v jsonb; r numeric; v_today date;
  v_goal numeric; v_course numeric; v_need numeric; v_den numeric; v_basis text;
  v_items jsonb;
BEGIN
  SELECT * INTO s FROM tax_impact_settings;
  v_today := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  SELECT ec_year, ec_month INTO cur FROM tax_period_for_date(v_today);
  SELECT start_greg, end_greg INTO b FROM tax_period_bounds(cur.ec_year, cur.ec_month);
  v := tax_forecast_vat_month(cur.ec_year, cur.ec_month);
  r := COALESCE((v->>'rate')::numeric, 0.15);
  v_course := (v->>'course')::numeric;
  SELECT goal_amount INTO v_goal FROM tax_plan_goals WHERE ec_year = cur.ec_year AND ec_month = cur.ec_month AND schedule_code = 'VAT';
  v_need := CASE WHEN v_goal IS NULL THEN NULL ELSE round(v_course - v_goal, 2) END;

  WITH ex AS (
    SELECT e.id, e.expense_code AS code, COALESCE(e.item_service_description, e.expense_code) AS label,
           COALESCE(vd.vendor_name, e.vendors_name) AS vendor, vd.vendor_type::text AS vtype,
           COALESCE(e.amount_etb, 0) AS amount,
           CASE WHEN e.approval_status IN ('pending', 'manager_approved') THEN 'approve' ELSE 'pay' END AS queue,
           CASE WHEN e.approval_status IN ('pending', 'manager_approved') THEN e.created_at
                ELSE COALESCE(e.finance_approved_at, e.updated_at, e.created_at) END AS entered_at,
           CASE
             WHEN ivi.vat_applicable = false THEN 'none'
             WHEN ivi.vat_applicable OR e.receipt_is_vat OR vd.vendor_type::text = 'Supplier with VAT' THEN 'vat'
             WHEN vd.vendor_type::text IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff',
                                           'Refundee', 'Government', 'Facilitation') THEN 'none'
             WHEN e.vendor_id IS NULL THEN 'none'
             ELSE 'unknown' END AS cls,
           sb.id AS po_id, sb.bundle_code AS po_code
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
  po AS (
    SELECT sb.id, sb.bundle_code AS code, COALESCE(vd.vendor_name, sb.vendor_name) AS label,
           COALESCE(vd.vendor_name, sb.vendor_name) AS vendor, vd.vendor_type::text AS vtype,
           round(COALESCE(sb.total_value, 0) * (1 + r), 2) AS amount,   -- PO totals are before VAT
           'raise'::text AS queue,
           COALESCE(sb.ordered_at, sb.approved_at, sb.submitted_at, sb.created_at) AS entered_at,
           CASE WHEN vd.vendor_type::text = 'Supplier with VAT' THEN 'vat'
                WHEN vd.vendor_type::text IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff',
                                              'Refundee', 'Government', 'Facilitation') OR sb.vendor_id IS NULL THEN 'none'
                ELSE 'unknown' END AS cls,
           sb.id AS po_id, sb.bundle_code AS po_code
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
    SELECT a.*, CASE WHEN a.cls IN ('vat', 'unknown') THEN round(a.amount * r / (1 + r), 2) ELSE 0 END AS vat
      FROM allx a
  ),
  den AS (
    SELECT CASE WHEN v_need IS NOT NULL AND v_need > 0 THEN v_need
                ELSE NULLIF(sum(vat) FILTER (WHERE cls = 'vat'), 0) END AS d,
           CASE WHEN v_need IS NOT NULL AND v_need > 0 THEN 'goal' ELSE 'queue' END AS basis
      FROM valued
  ),
  ranked AS (
    SELECT x.*, den.d, den.basis,
           CASE WHEN x.cls = 'vat' AND x.vat > 0.5 THEN rank() OVER (PARTITION BY (x.cls = 'vat' AND x.vat > 0.5) ORDER BY x.vat DESC, x.entered_at) END AS rnk,
           CASE WHEN x.cls = 'vat' AND den.d > 0 THEN round(x.vat / den.d, 4) END AS share
      FROM valued x, den
  ),
  cum AS (
    SELECT r2.*,
           CASE WHEN r2.rnk IS NOT NULL AND r2.d > 0
                THEN round(sum(r2.vat) FILTER (WHERE r2.rnk IS NOT NULL) OVER (ORDER BY r2.rnk NULLS LAST, r2.entered_at ROWS UNBOUNDED PRECEDING) / r2.d, 4) END AS cum_share,
           r2.cls = 'vat' AND COALESCE(r2.share, 0) >= s.high_share AS high,
           GREATEST(v_today - (r2.entered_at AT TIME ZONE 'Africa/Addis_Ababa')::date, 0) AS age_days
      FROM ranked r2
  ),
  esc AS (
    -- The item it overtook: the biggest earlier entrant in the same queue that brings less
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
           'po_id', po_id, 'po_code', po_code)
         ORDER BY rnk NULLS LAST, (cls = 'unknown') DESC, vat DESC, entered_at), '[]'::jsonb)
    INTO v_items
    FROM esc
   WHERE cls IN ('vat', 'unknown') AND vat > 0.5;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('ec_year', cur.ec_year, 'ec_month', cur.ec_month,
      'label', ec_month_name(cur.ec_month) || ' ' || cur.ec_year, 'end', b.end_greg, 'days_left', b.end_greg - v_today),
    'rate', r, 'goal', v_goal, 'course', v_course, 'need', v_need,
    'basis', (SELECT CASE WHEN v_need IS NOT NULL AND v_need > 0 THEN 'goal' ELSE 'queue' END),
    'settings', jsonb_build_object('high_share', s.high_share, 'approve_age_days', s.approve_age_days,
      'pay_age_days', s.pay_age_days, 'countdown_days', s.countdown_days),
    'items', v_items);
END $fn$;
REVOKE ALL ON FUNCTION tax_impact_compute() FROM PUBLIC, anon, authenticated;

-- The ranking needs the month's VAT course (about half a second), and the
-- queues, the bell and Operations health all read it, so it is kept for up
-- to 10 minutes; approving or paying refreshes it at once.
CREATE TABLE IF NOT EXISTS tax_impact_cache (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  computed_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
ALTER TABLE tax_impact_cache ENABLE ROW LEVEL SECURITY;   -- read only through the functions below

CREATE OR REPLACE FUNCTION tax_impact_items()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE j jsonb; t timestamptz;
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see tax impact';
  END IF;
  SELECT payload, computed_at INTO j, t FROM tax_impact_cache;
  IF j IS NULL OR t < now() - interval '10 minutes' THEN
    j := tax_impact_compute(); t := now();
    INSERT INTO tax_impact_cache (id, computed_at, payload) VALUES (true, t, j)
    ON CONFLICT (id) DO UPDATE SET computed_at = EXCLUDED.computed_at, payload = EXCLUDED.payload;
  END IF;
  RETURN j || jsonb_build_object('computed_at', t,
    'seen', COALESCE((SELECT jsonb_agg(item_id) FROM tax_impact_seen WHERE user_id = auth.uid()), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION tax_impact_items() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_impact_items() TO authenticated;

CREATE OR REPLACE FUNCTION tax_impact_refresh()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see tax impact';
  END IF;
  UPDATE tax_impact_cache SET computed_at = timestamptz 'epoch' WHERE id;
  RETURN tax_impact_items();
END $fn$;
REVOKE ALL ON FUNCTION tax_impact_refresh() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_impact_refresh() TO authenticated;

CREATE OR REPLACE FUNCTION tax_impact_mark_seen(p_ids uuid[])
RETURNS int LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public AS $fn$
  WITH ins AS (
    INSERT INTO tax_impact_seen (user_id, item_id)
    SELECT auth.uid(), unnest(p_ids) WHERE auth.uid() IS NOT NULL
    ON CONFLICT DO NOTHING RETURNING 1)
  SELECT count(*)::int FROM ins;
$fn$;
GRANT EXECUTE ON FUNCTION tax_impact_mark_seen(uuid[]) TO authenticated;

-- Overdue high-impact items for Operations health (nothing for non-readers)
CREATE OR REPLACE FUNCTION tax_impact_overdue()
RETURNS TABLE (id uuid, code text, label text, vendor text, queue text, vat numeric, share numeric, rnk int, age_days int, period text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE j jsonb;
BEGIN
  IF NOT tax_plan_reader() THEN RETURN; END IF;
  SELECT payload INTO j FROM tax_impact_cache WHERE computed_at > now() - interval '1 day';
  IF j IS NULL THEN j := tax_impact_compute(); END IF;
  RETURN QUERY
    SELECT (x->>'id')::uuid, x->>'code', x->>'label', x->>'vendor', x->>'queue', (x->>'vat')::numeric,
           (x->>'share')::numeric, (x->>'rank')::int, (x->>'age_days')::int, j->'period'->>'label'
      FROM jsonb_array_elements(j->'items') x
     WHERE (x->>'overdue')::boolean;
END $fn$;
REVOKE ALL ON FUNCTION tax_impact_overdue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_impact_overdue() TO authenticated;

DO $$
DECLARE d text := pg_get_viewdef('v_ops_health_items'::regclass);
BEGIN
  IF position('tax_impact_stuck' IN d) > 0 THEN RETURN; END IF;
  d := rtrim(rtrim(d), ';') || $branch$
UNION ALL
 SELECT 'tax_impact_stuck'::text AS kind,
    (t.id)::text AS ref_id,
    ((('T'::text || t.rnk) || ' · '::text) || COALESCE(t.code, ''::text)) || COALESCE(' · '::text || t.vendor, ''::text) AS title,
    ((((CASE WHEN t.queue = 'approve' THEN 'Waiting for approval '::text ELSE 'Approved, not paid '::text END || t.age_days) || ' days · '::text)
      || to_char(t.vat, 'FM999,999,990'::text)) || ' VAT for '::text) || t.period AS detail,
    t.vat AS amount,
    (CURRENT_DATE - t.age_days) AS since,
    'finance'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    ('/expenses/'::text || t.id) AS link,
    true AS urgent
   FROM tax_impact_overdue() t
$branch$;
  EXECUTE 'CREATE OR REPLACE VIEW v_ops_health_items WITH (security_invoker = on) AS ' || d;
END $$;
