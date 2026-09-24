-- Aligning the tax pages with Tax Filings, part 5: what each filing should
-- declare, computed from the books, next to what was declared.
--
-- tax_filing_computed(fiscal_period) returns one row per filing in that
-- fiscal year with the amount the system computes for it and the figures it
-- was built from:
--
--   VAT      net VAT for the period       v_vat_position_by_ec_period (309)
--   WHT      WHT withheld on paid vendor
--            payments in the period       v_wht_payable_by_ec_period  (311)
--   SCH_A    PAYE on paid payroll          v_payroll_tax_by_ec_period  (312)
--   PENSION  employee 7% + employer 11%    v_payroll_tax_by_ec_period  (312)
--   SCH_C    not computed -- profit tax comes from the audited annual
--            accounts. The basis carries the year's WHT credits (what
--            clients should have withheld from Kuncho, v_sale_wht, 310)
--            and the deductible-expense total (the Government Statement),
--            which are the two inputs the return needs from this system.
--
-- A period with no activity computes as 0, not NULL -- the sources are
-- complete, so "nothing happened" is a real answer. NULL is reserved for
-- "this system does not compute that schedule". The basis says how many
-- payroll runs fell in the period, so a Schedule A of 0 because no payroll
-- was recorded (Hamle 2018, today) is distinguishable from a genuine 0.
--
-- SECURITY DEFINER because the inputs sit behind different RLS: an
-- executive can read tax_filings but not every payroll line, and a partial
-- read would silently understate the figure. It returns AGGREGATES ONLY --
-- no individual salary leaves the function -- and only to the tax read set
-- (tax officer, admin, finance, executive), checked inside.
--
-- Also here: the Government Statement re-keyed to Ethiopian periods and
-- fiscal years, as a new view beside the old one.
--
-- Additive only (see 309).

SET search_path TO public;

CREATE OR REPLACE VIEW v_government_expense_statement_by_ec_period
WITH (security_invoker = true) AS
SELECT fp.id                                   AS fiscal_period_id,
       fp.label                                AS fiscal_year,
       ec.ec_year, ec.ec_month,
       ec_month_name(ec.ec_month) || ' ' || ec.ec_year AS period_label,
       c.category_name, c.nature, c.asset_class,
       CASE WHEN c.nature = 'Expense' THEN 'operating_expense' ELSE 'consumable_inventory' END AS gov_treatment,
       count(*)                                AS line_count,
       sum(e.amount_etb)                       AS amount
FROM expenses e
JOIN categories c ON c.id = e.category_id
CROSS JOIN LATERAL gregorian_to_ec(e.date) ec
LEFT JOIN fiscal_periods fp ON e.date BETWEEN fp.start_date AND fp.end_date
WHERE e.payment_status = true
  AND e.date >= financials_cutover_date()
  AND (c.nature = 'Expense' OR (c.nature = 'Asset' AND c.asset_class = 'Inventory'))
GROUP BY fp.id, fp.label, ec.ec_year, ec.ec_month, c.category_name, c.nature, c.asset_class,
         CASE WHEN c.nature = 'Expense' THEN 'operating_expense' ELSE 'consumable_inventory' END;

GRANT SELECT ON v_government_expense_statement_by_ec_period TO authenticated;

CREATE OR REPLACE FUNCTION tax_filing_computed(p_fiscal_period_id uuid)
RETURNS TABLE (filing_id uuid, schedule_code text, computed_amount numeric, basis jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fy fiscal_periods%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false)) THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see computed tax amounts';
  END IF;

  SELECT * INTO v_fy FROM fiscal_periods WHERE id = p_fiscal_period_id;
  IF v_fy.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;

  RETURN QUERY
  SELECT f.id,
         f.schedule_code,
         CASE f.schedule_code
           WHEN 'VAT'     THEN COALESCE(v.net_vat, 0)
           WHEN 'WHT'     THEN COALESCE(w.wht_withheld, 0)
           WHEN 'SCH_A'   THEN COALESCE(pt.paye_paid, 0)
           WHEN 'PENSION' THEN COALESCE(pt.pension_employee_paid, 0) + COALESCE(pt.pension_employer_paid, 0)
           ELSE NULL
         END,
         CASE f.schedule_code
           WHEN 'VAT' THEN jsonb_build_object(
             'output_vat',             COALESCE(v.output_vat, 0),
             'input_vat',              COALESCE(v.input_vat_reclaimable, 0),
             'sale_count',             COALESCE(v.sale_count, 0),
             'reviewed_receipt_count', COALESCE(v.reviewed_receipt_count, 0))
           WHEN 'WHT' THEN jsonb_build_object(
             'paid_expense_count',     COALESCE(w.paid_expense_count, 0),
             'pending_expense_count',  COALESCE(w.pending_expense_count, 0),
             'wht_pending_unpaid',     COALESCE(w.wht_pending_unpaid, 0))
           WHEN 'SCH_A' THEN jsonb_build_object(
             'payroll_runs',           runs.n,
             'paid_staff_count',       COALESCE(pt.paid_staff_count, 0),
             'net_paid',               COALESCE(pt.net_paid, 0),
             'gross_paid',             COALESCE(pt.gross_paid, 0),
             'net_unpaid',             COALESCE(pt.net_unpaid, 0),
             'paye_incl_unpaid',       COALESCE(pt.paye_incl_unpaid, 0))
           WHEN 'PENSION' THEN jsonb_build_object(
             'payroll_runs',           runs.n,
             'employee_share',         COALESCE(pt.pension_employee_paid, 0),
             'employer_share',         COALESCE(pt.pension_employer_paid, 0),
             'gross_paid',             COALESCE(pt.gross_paid, 0))
           WHEN 'SCH_C' THEN jsonb_build_object(
             'client_wht_credits_expected',
               (SELECT COALESCE(sum(sw.expected_wht), 0)
                FROM v_sale_wht sw JOIN sales s ON s.id = sw.sale_id
                WHERE sw.qualifies AND s.date BETWEEN v_fy.start_date AND v_fy.end_date),
             'deductible_expenses',
               (SELECT COALESCE(sum(g.amount), 0)
                FROM v_government_expense_statement_by_ec_period g
                WHERE g.fiscal_period_id = v_fy.id),
             'note', 'Profit tax is computed from the annual accounts, not by this system.')
           ELSE NULL
         END
  FROM tax_filings f
  LEFT JOIN v_vat_position_by_ec_period v
    ON f.schedule_code = 'VAT' AND v.ec_year = f.period_ec_year AND v.ec_month = f.period_ec_month
  LEFT JOIN v_wht_payable_by_ec_period w
    ON f.schedule_code = 'WHT' AND w.ec_year = f.period_ec_year AND w.ec_month = f.period_ec_month
  LEFT JOIN v_payroll_tax_by_ec_period pt
    ON f.schedule_code IN ('SCH_A', 'PENSION') AND pt.ec_year = f.period_ec_year AND pt.ec_month = f.period_ec_month
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM payroll p
    WHERE f.period_ec_month IS NOT NULL
      AND p.start_date BETWEEN f.period_start_greg AND f.period_end_greg
      AND NOT COALESCE(p.is_archived, false)
  ) runs ON true
  WHERE f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date;
END;
$$;
REVOKE EXECUTE ON FUNCTION tax_filing_computed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_filing_computed(uuid) TO authenticated;

COMMENT ON FUNCTION tax_filing_computed(uuid) IS
  'Per filing in a fiscal year: the amount computed from sales, receipts, expenses and payroll, with the figures behind it. Aggregates only; tax read set only.';
