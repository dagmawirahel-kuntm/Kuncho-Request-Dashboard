-- Aligning the tax pages with Tax Filings, part 1: a rate lookup every
-- calculation shares, and VAT computed per Ethiopian period.
--
-- ADDITIVE ONLY. Nothing the currently deployed frontend reads is dropped or
-- redefined here; the old Gregorian-month views (v_monthly_output_vat,
-- v_monthly_vat_from_receipts, v_tax_position, v_tax_liability_summary) are
-- dropped in 314, which is applied only after the frontend that stops
-- reading them is merged. (308 dropped two views the live app was still
-- using; this sequencing is so that does not happen again.)

SET search_path TO public;

-- ── 1. Rates are public law: let any signed-in user read them ───────────
-- 301 limited tax_rate_references to the tax read set. The calculations
-- below run as the viewer (security_invoker views), and the VAT tracker is
-- used by procurement, who are outside that set -- under the old policy the
-- rate lookup would silently return NULL for them and every VAT figure would
-- vanish. Statutory rates carry nothing confidential. Writes are unchanged
-- (tax officer or admin).
DROP POLICY IF EXISTS tax_rate_references_select ON tax_rate_references;
CREATE POLICY tax_rate_references_select ON tax_rate_references FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- The lookup joins tax_schedules to resolve a code, so the same applies.
DROP POLICY IF EXISTS tax_schedules_select ON tax_schedules;
CREATE POLICY tax_schedules_select ON tax_schedules FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ── 2. tax_rate_note(code, date) ────────────────────────────────────────
-- The rate reference in force for a schedule on a date. Every computation in
-- 309-313 reads its rates through this, so a proclamation that changes a
-- rate is one new effective-dated row, and periods before it keep the old
-- rate. Returns NULL when no reference covers the date -- callers let that
-- propagate so a missing rate shows as a missing figure, never as zero.
CREATE OR REPLACE FUNCTION tax_rate_note(p_code text, p_on date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.rate_note
  FROM tax_rate_references r
  JOIN tax_schedules s ON s.id = r.tax_schedule_id
  WHERE s.code = p_code
    AND r.effective_from <= p_on
    AND (r.effective_to IS NULL OR r.effective_to >= p_on)
  ORDER BY r.effective_from DESC
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION tax_rate_note(text, date) FROM PUBLIC, anon;

-- ── 3. VAT per Ethiopian period ─────────────────────────────────────────
-- Replaces the 'YYYY-MM' grouping of v_monthly_output_vat /
-- v_monthly_vat_from_receipts. A VAT return covers an Ethiopian month
-- (Hamle 2018 = 8 Jul - 6 Aug 2026); a Gregorian-month total straddles two
-- returns and matches neither.
--
-- Output VAT: sales.amount is VAT-inclusive (the old view's 15/115 said so),
-- so the VAT inside it is amount * r / (1 + r), with r the standard rate in
-- force on the sale date instead of a literal 15.
CREATE OR REPLACE VIEW v_vat_output_by_ec_period
WITH (security_invoker = true) AS
SELECT ec.ec_year, ec.ec_month,
       count(*)                                          AS sale_count,
       sum(s.amount)                                     AS gross_total,
       sum(round(s.amount * r.rate / (1 + r.rate), 2))   AS output_vat
FROM sales s
CROSS JOIN LATERAL gregorian_to_ec(s.date) ec
CROSS JOIN LATERAL (SELECT (tax_rate_note('VAT', s.date) ->> 'standard_rate')::numeric AS rate) r
WHERE s.date IS NOT NULL
  AND NOT s.is_vat_exempt
  AND s.sales_status IN ('Invoiced', 'Paid')
GROUP BY ec.ec_year, ec.ec_month;

-- Input VAT: only tax-reviewed receipts, same rule as before.
CREATE OR REPLACE VIEW v_vat_input_by_ec_period
WITH (security_invoker = true) AS
SELECT ec.ec_year, ec.ec_month,
       count(*)                 AS receipt_count,
       sum(vr.vat_amount)       AS input_vat
FROM vendor_receipts vr
CROSS JOIN LATERAL gregorian_to_ec(vr.receipt_date) ec
WHERE vr.status = 'tax_reviewed'
  AND vr.receipt_date IS NOT NULL
GROUP BY ec.ec_year, ec.ec_month;

-- The VAT position per return, and the filing it belongs to. The LEFT JOIN
-- to tax_filings returns NULL for anyone outside the tax read set (e.g.
-- procurement on the VAT tracker) -- they see the position, just not the
-- link to the filing.
CREATE OR REPLACE VIEW v_vat_position_by_ec_period
WITH (security_invoker = true) AS
SELECT p.ec_year, p.ec_month,
       ec_month_name(p.ec_month) || ' ' || p.ec_year      AS period_label,
       ec_month_start_greg(p.ec_year, p.ec_month)          AS period_start_greg,
       ec_month_end_greg(p.ec_year, p.ec_month)            AS period_end_greg,
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
LEFT JOIN v_vat_output_by_ec_period o USING (ec_year, ec_month)
LEFT JOIN v_vat_input_by_ec_period  i USING (ec_year, ec_month)
LEFT JOIN tax_filings f
  ON f.schedule_code = 'VAT' AND f.period_ec_year = p.ec_year AND f.period_ec_month = p.ec_month;

GRANT SELECT ON v_vat_output_by_ec_period, v_vat_input_by_ec_period, v_vat_position_by_ec_period TO authenticated;
