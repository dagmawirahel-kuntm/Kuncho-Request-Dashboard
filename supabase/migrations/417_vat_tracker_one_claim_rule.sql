-- 417 — One rule for claiming input VAT, and where each purchase stands
--
-- The VAT tracker showed the Nehase return at 3.93M payable with no input
-- VAT against it, and 1.30M "awaiting review". Two things were wrong with
-- that picture:
--
--   * Two rules. The return (v_vat_input_by_ec_period, read by the tax
--     position, the filing and the tax plan) claimed every tax-reviewed
--     receipt, even on a purchase marked "no VAT". The ledger posting and
--     the per-expense input VAT (sync_tax_filing_ledger,
--     sync_expense_input_vat) claimed only purchases also flagged as
--     carrying VAT. The return and the books could disagree.
--   * "Awaiting review" lumped two different states. None of those 38
--     purchases had a receipt in review; every one was still waiting for
--     its receipt to be captured at all.
--
-- Now:
--   * Claimable = the receipt has passed tax review and the purchase is not
--     marked "no VAT". A tax-reviewed VAT receipt no longer also needs the
--     purchase flagged by hand. The tracker carries the rule; the return
--     sums the tracker, so the return, the ledger and the plan agree.
--     Tax-reviewed receipts recorded against a GRN with no expense still
--     count, as before.
--   * Each purchase has a stage: needs_receipt (flagged, nothing captured),
--     in_review (receipt captured, not yet through review), claimed,
--     rejected, not_vat, unflagged.
--   * The VAT position carries input VAT in review and input VAT still
--     needing a receipt, and what the period would come to if every
--     flagged purchase were claimed. The current period always shows.
--
-- The three-party review (156) is unchanged: only tax-reviewed receipts are
-- claimed.

SET search_path TO public;

-- ── 1. The tracker: one claim rule, and a stage ──────────────────────
CREATE OR REPLACE VIEW v_input_vat_tracker
WITH (security_invoker = true) AS
WITH base AS (
  SELECT e.id AS expense_id,
    e.expense_code,
    e.date AS expense_date,
    e.amount_etb,
    e.vendor_id,
    v.vendor_name,
    v.tin AS vendor_tin,
    e.project_id,
    p.project_name,
    e.receipt_url,
    vr.id AS receipt_id,
    vr.status AS receipt_status,
    vr.vat_amount AS receipt_vat,
    vr.document_url AS receipt_document,
    COALESCE(vr.receipt_date, e.date) AS anchor_date,
    i.vat_applicable,
    i.declare_ec_year,
    i.declare_ec_month,
    i.copy_status AS copy_status_set,
    i.vat_amount AS vat_amount_set,
    i.notes
  FROM expenses e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN input_vat_items i ON i.expense_id = e.id
  LEFT JOIN LATERAL (
    SELECT r_1.id, r_1.status, r_1.vat_amount, r_1.document_url, r_1.receipt_date
    FROM vendor_receipts r_1
    WHERE r_1.expense_id = e.id
    ORDER BY (r_1.status = 'tax_reviewed') DESC, r_1.created_at DESC
    LIMIT 1
  ) vr ON true
  WHERE e.payment_status = true
    AND NOT COALESCE(e.is_archived, false)
    AND e.date >= financials_cutover_date()
    AND e.vendor_receipt_facilitation_id IS NULL
    AND e.expense_type IS DISTINCT FROM 'vrf'::expense_category
), r AS (
  SELECT b.*,
    COALESCE(b.vat_applicable, true) AND COALESCE(b.receipt_status = 'tax_reviewed', false) AS is_claimable
  FROM base b
)
SELECT b.expense_id,
  b.expense_code,
  b.expense_date,
  b.amount_etb,
  b.vendor_id,
  b.vendor_name,
  b.vendor_tin,
  b.project_id,
  b.project_name,
  b.vat_applicable,
  b.anchor_date,
  dp.ec_year AS default_ec_year,
  dp.ec_month AS default_ec_month,
  COALESCE(b.declare_ec_year, dp.ec_year) AS declare_ec_year,
  COALESCE(b.declare_ec_month, dp.ec_month) AS declare_ec_month,
  (ec_month_name(COALESCE(b.declare_ec_month, dp.ec_month)) || ' ') || COALESCE(b.declare_ec_year, dp.ec_year) AS declare_period_label,
  b.declare_ec_year IS NOT NULL AS declare_overridden,
  COALESCE(b.vat_amount_set, b.receipt_vat, round(b.amount_etb * rt.rate / (1 + rt.rate), 2)) AS vat_amount,
  CASE
    WHEN b.vat_amount_set IS NOT NULL THEN 'entered'
    WHEN b.receipt_vat IS NOT NULL THEN 'receipt'
    ELSE 'estimated'
  END AS vat_source,
  b.receipt_id,
  b.receipt_status,
  COALESCE(b.copy_status_set,
    CASE WHEN b.receipt_document IS NOT NULL OR b.receipt_url IS NOT NULL THEN 'uploaded' ELSE 'not_uploaded' END) AS copy_status,
  b.copy_status_set IS NOT NULL AS copy_status_set,
  b.is_claimable AS claimable,
  b.notes,
  CASE
    WHEN b.vat_applicable = false THEN 'not_vat'
    WHEN b.is_claimable THEN 'claimed'
    WHEN b.receipt_status IN ('pending_verification', 'verified') THEN 'in_review'
    WHEN b.receipt_status = 'rejected' THEN 'rejected'
    WHEN b.vat_applicable = true THEN 'needs_receipt'
    ELSE 'unflagged'
  END AS stage
FROM r b
CROSS JOIN LATERAL tax_period_for_date(b.anchor_date) dp(ec_year, ec_month)
CROSS JOIN LATERAL (SELECT (tax_rate_note('VAT', b.anchor_date) ->> 'standard_rate')::numeric AS rate) rt;

-- ── 2. Input VAT per period: the tracker's rule ──────────────────────
CREATE OR REPLACE VIEW v_vat_input_by_ec_period
WITH (security_invoker = true) AS
WITH claimed AS (
  SELECT ec_year, ec_month, count(*) AS receipt_count, sum(vat) AS input_vat
  FROM (
    SELECT t.declare_ec_year AS ec_year, t.declare_ec_month AS ec_month, t.vat_amount AS vat
    FROM v_input_vat_tracker t
    WHERE t.claimable
    UNION ALL
    -- Tax-reviewed receipts recorded against a GRN, with no expense.
    SELECT tp.ec_year, tp.ec_month, vr.vat_amount
    FROM vendor_receipts vr
    CROSS JOIN LATERAL tax_period_for_date(vr.receipt_date) tp(ec_year, ec_month)
    WHERE vr.status = 'tax_reviewed' AND vr.receipt_date IS NOT NULL AND vr.expense_id IS NULL
  ) x
  GROUP BY ec_year, ec_month
), pending AS (
  SELECT t.declare_ec_year AS ec_year,
    t.declare_ec_month AS ec_month,
    count(*) FILTER (WHERE t.vat_applicable AND NOT t.claimable) AS pending_count,
    sum(t.vat_amount) FILTER (WHERE t.vat_applicable AND NOT t.claimable) AS pending_vat,
    count(*) FILTER (WHERE t.stage = 'in_review') AS in_review_count,
    sum(t.vat_amount) FILTER (WHERE t.stage = 'in_review') AS in_review_vat,
    count(*) FILTER (WHERE t.stage = 'needs_receipt') AS needs_receipt_count,
    sum(t.vat_amount) FILTER (WHERE t.stage = 'needs_receipt') AS needs_receipt_vat
  FROM v_input_vat_tracker t
  WHERE t.stage IN ('in_review', 'needs_receipt') OR (t.vat_applicable AND NOT t.claimable)
  GROUP BY t.declare_ec_year, t.declare_ec_month
)
SELECT COALESCE(c.ec_year, p.ec_year) AS ec_year,
  COALESCE(c.ec_month, p.ec_month) AS ec_month,
  COALESCE(c.receipt_count, 0::bigint) AS receipt_count,
  COALESCE(c.input_vat, 0::numeric) AS input_vat,
  COALESCE(p.pending_count, 0::bigint) AS pending_review_count,
  COALESCE(p.pending_vat, 0::numeric) AS input_vat_pending_review,
  COALESCE(p.in_review_count, 0::bigint) AS in_review_count,
  COALESCE(p.in_review_vat, 0::numeric) AS input_vat_in_review,
  COALESCE(p.needs_receipt_count, 0::bigint) AS needs_receipt_count,
  COALESCE(p.needs_receipt_vat, 0::numeric) AS input_vat_needs_receipt
FROM claimed c
FULL JOIN pending p ON p.ec_year = c.ec_year AND p.ec_month = c.ec_month;

-- ── 3. The position, with what is still to come ──────────────────────
CREATE OR REPLACE VIEW v_vat_position_by_ec_period
WITH (security_invoker = true) AS
SELECT p.ec_year,
  p.ec_month,
  (ec_month_name(p.ec_month) || ' ') || p.ec_year AS period_label,
  b.start_greg AS period_start_greg,
  b.end_greg AS period_end_greg,
  COALESCE(o.output_vat, 0::numeric) AS output_vat,
  COALESCE(i.input_vat, 0::numeric) AS input_vat_reclaimable,
  COALESCE(o.output_vat, 0::numeric) - COALESCE(i.input_vat, 0::numeric) AS net_vat,
  CASE WHEN COALESCE(o.output_vat, 0::numeric) - COALESCE(i.input_vat, 0::numeric) >= 0 THEN 'payable' ELSE 'reclaimable' END AS "position",
  COALESCE(o.sale_count, 0::bigint) AS sale_count,
  COALESCE(i.receipt_count, 0::bigint) AS reviewed_receipt_count,
  f.id AS vat_filing_id,
  f.status AS vat_filing_status,
  COALESCE(i.input_vat_pending_review, 0::numeric) AS input_vat_pending_review,
  COALESCE(i.pending_review_count, 0::bigint) AS pending_review_count,
  COALESCE(i.input_vat_in_review, 0::numeric) AS input_vat_in_review,
  COALESCE(i.in_review_count, 0::bigint) AS in_review_count,
  COALESCE(i.input_vat_needs_receipt, 0::numeric) AS input_vat_needs_receipt,
  COALESCE(i.needs_receipt_count, 0::bigint) AS needs_receipt_count,
  COALESCE(o.output_vat, 0::numeric) - COALESCE(i.input_vat, 0::numeric)
    - COALESCE(i.input_vat_in_review, 0::numeric) - COALESCE(i.input_vat_needs_receipt, 0::numeric) AS net_vat_if_all_claimed,
  (p.ec_year, p.ec_month) = (SELECT cp.ec_year, cp.ec_month FROM tax_period_for_date(CURRENT_DATE) cp(ec_year, ec_month)) AS is_current
FROM (
  SELECT ec_year, ec_month FROM v_vat_output_by_ec_period
  UNION
  SELECT ec_year, ec_month FROM v_vat_input_by_ec_period
  UNION
  SELECT cp.ec_year, cp.ec_month FROM tax_period_for_date(CURRENT_DATE) cp(ec_year, ec_month)
) p
CROSS JOIN LATERAL tax_period_bounds(p.ec_year, p.ec_month) b(start_greg, end_greg)
LEFT JOIN v_vat_output_by_ec_period o USING (ec_year, ec_month)
LEFT JOIN v_vat_input_by_ec_period i USING (ec_year, ec_month)
LEFT JOIN tax_filings f ON f.schedule_code = 'VAT' AND f.period_ec_year = p.ec_year AND f.period_ec_month = p.ec_month;

REVOKE ALL ON v_input_vat_tracker, v_vat_input_by_ec_period, v_vat_position_by_ec_period FROM PUBLIC, anon;
GRANT SELECT ON v_input_vat_tracker, v_vat_input_by_ec_period, v_vat_position_by_ec_period TO authenticated;
