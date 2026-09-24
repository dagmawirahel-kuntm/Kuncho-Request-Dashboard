-- Pagume is not a tax period of its own. For each fiscal year Kuncho decides
-- whether its 5 (or 6) days are declared with Nehase or with Meskerem, and
-- every return, figure and due date follows that choice.
--
-- ── Before ──────────────────────────────────────────────────────────────
-- Pagume was generated as a 13th monthly filing per schedule (4 in
-- FY2026/27), and every view grouped by the raw Ethiopian month, so a
-- payment on 8 Sep 2026 landed in a 5-day "Pagume 2018" return. It also
-- made Nehase's VAT return due at the end of Pagume -- 5 days after the
-- period closed.
--
-- ── The rule ────────────────────────────────────────────────────────────
--   fiscal_periods.pagume_attaches_to  'nehase' | 'meskerem'
--
-- The Pagume of Ethiopian year Y belongs to the fiscal year that starts
-- Hamle Y (Pagume 2018 -> FY2026/27), and both Nehase Y and Meskerem Y+1
-- are in that same year, so the choice never moves money across fiscal
-- years.
--
--   tax_period_for_date(d)    the (year, month) a date is DECLARED in:
--                             Pagume Y -> Nehase Y, or Meskerem Y+1
--   tax_period_bounds(y, m)   that tax period's first and last Gregorian day:
--                             'nehase'   Nehase 2018 = 7 Aug - 10 Sep 2026
--                             'meskerem' Meskerem 2019 = 6 Sep - 10 Oct 2026
--
-- Every tax view now groups by tax_period_for_date() instead of the raw
-- calendar month, the filing generator never creates a Pagume filing, and
-- due dates are measured from the NEXT TAX PERIOD rather than the next
-- calendar month -- so Nehase's return is due in Meskerem, not in Pagume.
--
-- set_pagume_attachment(fy, choice) is the one way to change it. It
-- reshapes that year's Nehase / Pagume / Meskerem filings in one
-- transaction and refuses if any of them is past draft or a Pagume filing
-- holds anything, so a choice can never rewrite a return already submitted.
--
-- Additive for the deployed frontend: views keep their columns, and
-- v_tax_filings only gains one at the end.

SET search_path TO public;

ALTER TABLE fiscal_periods
  ADD COLUMN IF NOT EXISTS pagume_attaches_to text NOT NULL DEFAULT 'nehase'
    CHECK (pagume_attaches_to IN ('nehase', 'meskerem'));

COMMENT ON COLUMN fiscal_periods.pagume_attaches_to IS
  'Which tax month this fiscal year''s Pagume is declared with: nehase (the preceding month) or meskerem (the following one). Change only through set_pagume_attachment().';

-- ── Helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pagume_target(p_ec_year int)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT fp.pagume_attaches_to FROM fiscal_periods fp
     WHERE ec_to_gregorian(p_ec_year, 13, 1) BETWEEN fp.start_date AND fp.end_date
     LIMIT 1),
    'nehase');
$$;

CREATE OR REPLACE FUNCTION tax_period_for_date(p_date date)
RETURNS TABLE (ec_year int, ec_month int)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN g.ec_month = 13 AND pagume_target(g.ec_year) = 'meskerem'
              THEN g.ec_year + 1 ELSE g.ec_year END,
         CASE WHEN g.ec_month <> 13 THEN g.ec_month
              WHEN pagume_target(g.ec_year) = 'meskerem' THEN 1
              ELSE 12 END
  FROM gregorian_to_ec(p_date) g;
$$;

CREATE OR REPLACE FUNCTION tax_period_bounds(p_ec_year int, p_ec_month int)
RETURNS TABLE (start_greg date, end_greg date)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_ec_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Month % is not a tax period: Pagume is declared with Nehase or Meskerem', p_ec_month;
  END IF;
  RETURN QUERY SELECT
    CASE WHEN p_ec_month = 1 AND pagume_target(p_ec_year - 1) = 'meskerem'
         THEN ec_month_start_greg(p_ec_year - 1, 13)
         ELSE ec_month_start_greg(p_ec_year, p_ec_month) END,
    CASE WHEN p_ec_month = 12 AND pagume_target(p_ec_year) = 'nehase'
         THEN ec_month_end_greg(p_ec_year, 13)
         ELSE ec_month_end_greg(p_ec_year, p_ec_month) END;
END;
$$;

REVOKE EXECUTE ON FUNCTION pagume_target(int)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION tax_period_for_date(date)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION tax_period_bounds(int, int)   FROM PUBLIC, anon;

-- ── Due dates: measured from the next TAX period ────────────────────────
-- Was: the next calendar month, so Nehase -> Pagume. Now the tax period
-- after (y, m) -- Nehase -> Meskerem, always -- and a "day N" rule counts
-- from that period's own first day. STABLE rather than IMMUTABLE because
-- the bounds read the fiscal-year setting.
CREATE OR REPLACE FUNCTION tax_filing_due_date(
  p_rule JSONB, p_ec_year INT, p_ec_month INT, p_fy_end DATE
)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_kind text := p_rule->>'kind';
  v_ny   int;
  v_nm   int;
  v_b    record;
BEGIN
  IF v_kind = 'months_after_fy_end' THEN
    RETURN (p_fy_end + ((p_rule->>'months')::int || ' months')::interval)::date;
  END IF;
  IF p_ec_month IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_ec_month >= 12 THEN
    v_ny := p_ec_year + 1; v_nm := 1;
  ELSE
    v_ny := p_ec_year;     v_nm := p_ec_month + 1;
  END IF;

  SELECT * INTO v_b FROM tax_period_bounds(v_ny, v_nm);

  IF v_kind = 'following_month_day' THEN
    RETURN v_b.start_greg + ((p_rule->>'day')::int - 1);
  ELSIF v_kind = 'following_month_end' THEN
    RETURN v_b.end_greg;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION tax_filing_due_date(jsonb, int, int, date) FROM PUBLIC, anon;

-- ── Generator: twelve monthly periods, never a Pagume one ───────────────
CREATE OR REPLACE FUNCTION generate_tax_filing_periods(p_fiscal_period_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_fy      fiscal_periods%ROWTYPE;
  v_sched   RECORD;
  v_y       INT;
  v_m       INT;
  v_b       RECORD;
  v_cursor  DATE;
  v_created INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_fy FROM fiscal_periods WHERE id = p_fiscal_period_id;
  IF v_fy.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;

  FOR v_sched IN
    SELECT * FROM tax_schedules WHERE is_active AND applies_to_kuncho ORDER BY display_order
  LOOP
    IF v_sched.periodicity = 'annual' THEN
      SELECT g.ec_year INTO v_y FROM gregorian_to_ec(v_fy.start_date) g;
      INSERT INTO tax_filings (tax_schedule_id, schedule_code, fiscal_period_id,
        period_ec_year, period_ec_month, period_start_greg, period_end_greg, due_date_greg)
      VALUES (v_sched.id, v_sched.code, v_fy.id, v_y, NULL,
        v_fy.start_date, v_fy.end_date,
        tax_filing_due_date(v_sched.default_due_rule, v_y, NULL, v_fy.end_date))
      ON CONFLICT ON CONSTRAINT tax_filings_one_per_period DO NOTHING;
      IF FOUND THEN v_created := v_created + 1; END IF;

    ELSIF v_sched.periodicity = 'monthly' THEN
      v_cursor := v_fy.start_date;
      WHILE v_cursor <= v_fy.end_date LOOP
        SELECT t.ec_year, t.ec_month INTO v_y, v_m FROM tax_period_for_date(v_cursor) t;
        SELECT * INTO v_b FROM tax_period_bounds(v_y, v_m);

        INSERT INTO tax_filings (tax_schedule_id, schedule_code, fiscal_period_id,
          period_ec_year, period_ec_month, period_start_greg, period_end_greg, due_date_greg)
        VALUES (v_sched.id, v_sched.code, v_fy.id, v_y, v_m,
          v_b.start_greg, v_b.end_greg,
          tax_filing_due_date(v_sched.default_due_rule, v_y, v_m, v_fy.end_date))
        ON CONFLICT ON CONSTRAINT tax_filings_one_per_period DO NOTHING;
        IF FOUND THEN v_created := v_created + 1; END IF;

        v_cursor := v_b.end_greg + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_created;
END;
$$;
REVOKE EXECUTE ON FUNCTION generate_tax_filing_periods(UUID) FROM PUBLIC, anon;

-- ── set_pagume_attachment ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_pagume_attachment(p_fiscal_period_id uuid, p_attaches_to text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fy        fiscal_periods%ROWTYPE;
  v_y         int;
  v_blocking  text;
  v_f         tax_filings%ROWTYPE;
  v_b         record;
  v_removed   int := 0;
  v_reshaped  int := 0;
  v_rule      jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false)) THEN
    RAISE EXCEPTION 'Only the tax officer or an admin can change where Pagume is declared';
  END IF;
  IF p_attaches_to NOT IN ('nehase', 'meskerem') THEN
    RAISE EXCEPTION 'Pagume attaches to nehase or meskerem, not %', p_attaches_to;
  END IF;

  SELECT * INTO v_fy FROM fiscal_periods WHERE id = p_fiscal_period_id;
  IF v_fy.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;

  -- The fiscal year starts Hamle Y, so its Pagume is Pagume Y.
  SELECT g.ec_year INTO v_y FROM gregorian_to_ec(v_fy.start_date) g;

  -- Refuse before touching anything if a return in the affected months has
  -- moved past draft, or a Pagume filing holds anything worth keeping.
  SELECT string_agg(DISTINCT f.schedule_code || ' ' || f.period_label || ' (' || f.status || ')', ', ')
    INTO v_blocking
  FROM tax_filings f
  WHERE (f.fiscal_period_id = v_fy.id OR f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date)
    AND ((f.period_ec_year = v_y AND f.period_ec_month IN (12, 13)) OR (f.period_ec_year = v_y + 1 AND f.period_ec_month = 1))
    AND (f.status <> 'draft'
         OR (f.period_ec_month = 13 AND (f.declared_amount IS NOT NULL OR f.paid_amount IS NOT NULL
             OR f.government_reference_no IS NOT NULL OR f.notes IS NOT NULL
             OR EXISTS (SELECT 1 FROM tax_filing_documents d WHERE d.tax_filing_id = f.id))));
  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot move Pagume: these returns are past draft or hold entries — %', v_blocking;
  END IF;

  UPDATE fiscal_periods SET pagume_attaches_to = p_attaches_to WHERE id = v_fy.id;

  -- Any standalone Pagume filing goes, with the usual audit snapshot.
  FOR v_f IN
    SELECT * FROM tax_filings f
    WHERE (f.fiscal_period_id = v_fy.id OR f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date)
      AND f.period_ec_year = v_y AND f.period_ec_month = 13
  LOOP
    INSERT INTO tax_filing_deletions (deleted_filing_snapshot, schedule_code, period_label, reason, deleted_by)
    VALUES (to_jsonb(v_f) || jsonb_build_object('documents', '[]'::jsonb), v_f.schedule_code, v_f.period_label,
            'Pagume ' || v_y || ' folded into ' || CASE p_attaches_to WHEN 'nehase' THEN 'Nehase ' || v_y ELSE 'Meskerem ' || (v_y + 1) END
            || ' by the ' || v_fy.label || ' Pagume setting', auth.uid());
    DELETE FROM tax_filings WHERE id = v_f.id;
    v_removed := v_removed + 1;
  END LOOP;

  -- Nehase Y and Meskerem Y+1 take their new bounds and due dates. Hamle's
  -- due date depends on Nehase's START, which never moves, so it is not
  -- touched.
  FOR v_f IN
    SELECT * FROM tax_filings f
    WHERE (f.fiscal_period_id = v_fy.id OR f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date)
      AND ((f.period_ec_year = v_y AND f.period_ec_month = 12) OR (f.period_ec_year = v_y + 1 AND f.period_ec_month = 1))
  LOOP
    SELECT * INTO v_b FROM tax_period_bounds(v_f.period_ec_year, v_f.period_ec_month);
    SELECT default_due_rule INTO v_rule FROM tax_schedules WHERE id = v_f.tax_schedule_id;
    UPDATE tax_filings
    SET period_start_greg = v_b.start_greg,
        period_end_greg   = v_b.end_greg,
        due_date_greg     = tax_filing_due_date(v_rule, v_f.period_ec_year, v_f.period_ec_month, v_fy.end_date),
        updated_at        = now()
    WHERE id = v_f.id;
    v_reshaped := v_reshaped + 1;
  END LOOP;

  RETURN jsonb_build_object('fiscal_year', v_fy.label, 'pagume_attaches_to', p_attaches_to,
                            'pagume_filings_removed', v_removed, 'filings_reshaped', v_reshaped);
END;
$$;
REVOKE EXECUTE ON FUNCTION set_pagume_attachment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_pagume_attachment(uuid, text) TO authenticated;

-- ── Re-key every tax view from calendar month to tax period ─────────────
CREATE OR REPLACE VIEW v_vat_output_by_ec_period
WITH (security_invoker = true) AS
SELECT tp.ec_year, tp.ec_month,
       count(*)                                          AS sale_count,
       sum(s.amount)                                     AS gross_total,
       sum(round(s.amount * r.rate / (1 + r.rate), 2))   AS output_vat
FROM sales s
CROSS JOIN LATERAL tax_period_for_date(s.date) tp
CROSS JOIN LATERAL (SELECT (tax_rate_note('VAT', s.date) ->> 'standard_rate')::numeric AS rate) r
WHERE s.date IS NOT NULL
  AND NOT s.is_vat_exempt
  AND s.sales_status IN ('Invoiced', 'Paid')
GROUP BY tp.ec_year, tp.ec_month;

CREATE OR REPLACE VIEW v_vat_input_by_ec_period
WITH (security_invoker = true) AS
SELECT tp.ec_year, tp.ec_month,
       count(*)           AS receipt_count,
       sum(vr.vat_amount) AS input_vat
FROM vendor_receipts vr
CROSS JOIN LATERAL tax_period_for_date(vr.receipt_date) tp
WHERE vr.status = 'tax_reviewed'
  AND vr.receipt_date IS NOT NULL
GROUP BY tp.ec_year, tp.ec_month;

CREATE OR REPLACE VIEW v_vat_position_by_ec_period
WITH (security_invoker = true) AS
SELECT p.ec_year, p.ec_month,
       ec_month_name(p.ec_month) || ' ' || p.ec_year      AS period_label,
       b.start_greg                                        AS period_start_greg,
       b.end_greg                                          AS period_end_greg,
       COALESCE(o.output_vat, 0)                           AS output_vat,
       COALESCE(i.input_vat, 0)                            AS input_vat_reclaimable,
       COALESCE(o.output_vat, 0) - COALESCE(i.input_vat, 0) AS net_vat,
       CASE WHEN COALESCE(o.output_vat, 0) - COALESCE(i.input_vat, 0) >= 0
            THEN 'payable' ELSE 'reclaimable' END           AS position,
       COALESCE(o.sale_count, 0)                           AS sale_count,
       COALESCE(i.receipt_count, 0)                        AS reviewed_receipt_count,
       f.id                                                AS vat_filing_id,
       f.status                                            AS vat_filing_status
FROM (SELECT ec_year, ec_month FROM v_vat_output_by_ec_period
      UNION SELECT ec_year, ec_month FROM v_vat_input_by_ec_period) p
CROSS JOIN LATERAL tax_period_bounds(p.ec_year, p.ec_month) b
LEFT JOIN v_vat_output_by_ec_period o USING (ec_year, ec_month)
LEFT JOIN v_vat_input_by_ec_period  i USING (ec_year, ec_month)
LEFT JOIN tax_filings f
  ON f.schedule_code = 'VAT' AND f.period_ec_year = p.ec_year AND f.period_ec_month = p.ec_month;

CREATE OR REPLACE VIEW v_wht_payable_by_ec_period
WITH (security_invoker = true) AS
SELECT tp.ec_year, tp.ec_month,
       ec_month_name(tp.ec_month) || ' ' || tp.ec_year                      AS period_label,
       count(*) FILTER (WHERE e.payment_status)                             AS paid_expense_count,
       COALESCE(sum(e.wht_amount) FILTER (WHERE e.payment_status), 0)       AS wht_withheld,
       count(*) FILTER (WHERE NOT e.payment_status)                         AS pending_expense_count,
       COALESCE(sum(e.wht_amount) FILTER (WHERE NOT e.payment_status), 0)   AS wht_pending_unpaid
FROM expenses e
CROSS JOIN LATERAL tax_period_for_date(COALESCE(e.total_payment_date, e.paid_date::date, e.date)) tp
WHERE COALESCE(e.wht_amount, 0) > 0
  AND COALESCE(e.total_payment_date, e.paid_date::date, e.date) IS NOT NULL
  AND NOT COALESCE(e.is_archived, false)
GROUP BY tp.ec_year, tp.ec_month;

CREATE OR REPLACE VIEW v_payroll_tax_by_staff_period
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT ps.staff_id, tp.ec_year, tp.ec_month,
         ps.net_amount,
         (p.payment_status = 'paid') AS is_paid
  FROM payroll_staff ps
  JOIN payroll p ON p.id = ps.payroll_id
  CROSS JOIN LATERAL tax_period_for_date(p.start_date) tp
  WHERE p.start_date IS NOT NULL
    AND NOT COALESCE(p.is_archived, false)
),
per_staff AS (
  SELECT staff_id, ec_year, ec_month,
         COALESCE(sum(net_amount) FILTER (WHERE is_paid), 0) AS net_paid,
         COALESCE(sum(net_amount), 0)                        AS net_all
  FROM lines
  GROUP BY staff_id, ec_year, ec_month
)
SELECT ps.staff_id, st.employee_name, st.employment_type,
       ps.ec_year, ps.ec_month,
       ec_month_name(ps.ec_month) || ' ' || ps.ec_year     AS period_label,
       (COALESCE(st.employment_type, '') <> 'tier_2_casual') AS pension_covered,
       ps.net_paid,
       paid.gross            AS gross_paid,
       paid.paye             AS paye_paid,
       paid.pension_employee AS pension_employee_paid,
       paid.pension_employer AS pension_employer_paid,
       ps.net_all,
       allp.gross            AS gross_incl_unpaid,
       allp.paye             AS paye_incl_unpaid
FROM per_staff ps
JOIN staff st ON st.id = ps.staff_id
CROSS JOIN LATERAL tax_period_bounds(ps.ec_year, ps.ec_month) b
LEFT JOIN LATERAL paye_gross_up(ps.net_paid, b.start_greg,
                                COALESCE(st.employment_type, '') <> 'tier_2_casual') paid ON true
LEFT JOIN LATERAL paye_gross_up(ps.net_all,  b.start_greg,
                                COALESCE(st.employment_type, '') <> 'tier_2_casual') allp ON true;

CREATE OR REPLACE VIEW v_government_expense_statement_by_ec_period
WITH (security_invoker = true) AS
SELECT fp.id                                   AS fiscal_period_id,
       fp.label                                AS fiscal_year,
       tp.ec_year, tp.ec_month,
       ec_month_name(tp.ec_month) || ' ' || tp.ec_year AS period_label,
       c.category_name, c.nature, c.asset_class,
       CASE WHEN c.nature = 'Expense' THEN 'operating_expense' ELSE 'consumable_inventory' END AS gov_treatment,
       count(*)                                AS line_count,
       sum(e.amount_etb)                       AS amount
FROM expenses e
JOIN categories c ON c.id = e.category_id
CROSS JOIN LATERAL tax_period_for_date(e.date) tp
LEFT JOIN fiscal_periods fp ON e.date BETWEEN fp.start_date AND fp.end_date
WHERE e.payment_status = true
  AND e.date >= financials_cutover_date()
  AND (c.nature = 'Expense' OR (c.nature = 'Asset' AND c.asset_class = 'Inventory'))
GROUP BY fp.id, fp.label, tp.ec_year, tp.ec_month, c.category_name, c.nature, c.asset_class,
         CASE WHEN c.nature = 'Expense' THEN 'operating_expense' ELSE 'consumable_inventory' END;

-- v_tax_filings gains includes_pagume, so the list can say "incl. Pagume".
CREATE OR REPLACE VIEW v_tax_filings
WITH (security_invoker = true) AS
SELECT f.*,
       s.display_label,
       s.name        AS schedule_name,
       s.authority,
       s.periodicity,
       s.statutory_reference,
       (f.status <> 'acknowledged'
        AND f.due_date_greg IS NOT NULL
        AND f.due_date_greg < CURRENT_DATE) AS is_overdue,
       (SELECT count(*) FROM tax_filing_documents d WHERE d.tax_filing_id = f.id) AS document_count,
       (f.period_ec_month IS NOT NULL AND f.period_ec_month <> 13
        AND (f.period_end_greg   > ec_month_end_greg(f.period_ec_year, f.period_ec_month)
          OR f.period_start_greg < ec_month_start_greg(f.period_ec_year, f.period_ec_month))) AS includes_pagume
FROM tax_filings f
JOIN tax_schedules s ON s.id = f.tax_schedule_id;
