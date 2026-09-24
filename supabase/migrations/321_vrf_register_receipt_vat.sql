-- 321 — The VAT printed on each VRF receipt, as its own figure
--
-- v_vrf_register gains vat_on_receipt: the VAT a VRF receipt states, worked
-- out of the receipt amount (VAT-inclusive) at the standard rate in force on
-- the VRF's date, read from tax_rate_references like every other rate.
--
-- It is shown on the VRF register only. It is not input VAT Kuncho can
-- claim -- no goods were supplied -- and nothing in the tax module reads it
-- (migration 320 keeps VRF out of every tax view). Where VRF receipts have
-- been put on a VAT return, this is the amount of input VAT involved, which
-- is what a correction of that return would need.
--
-- Additive: the view keeps every column from 320 and adds one at the end.

SET search_path TO public;

CREATE OR REPLACE VIEW v_vrf_register
WITH (security_invoker = true) AS
SELECT
  f.id AS vrf_id,
  f.record_name,
  f.facilitator_name,
  f.status,
  f.trxn_date,
  ec.ec_year,
  ec.ec_month,
  CASE WHEN ec.ec_year IS NOT NULL THEN ec_month_name(ec.ec_month) || ' ' || ec.ec_year END AS period_label,
  fp.id AS fiscal_period_id,
  fp.label AS fiscal_year,
  COALESCE(rx.receipt_amount, f.amount_transferred, 0) AS receipt_amount,
  COALESCE(f.amount_transferred, 0) AS transferred,
  rx.wht_recorded,
  COALESCE(f.commission_amount, 0) AS commission,
  COALESCE(f.money_returned, 0) AS returned,
  COALESCE(rx.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0) AS kept_back,
  COALESCE(rx.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0)
    - rx.wht_recorded - COALESCE(f.commission_amount, 0) AS unaccounted,
  fs.company_expense_drawn,
  fs.payroll_drawn,
  fs.personal_drawn,
  fs.fund_available AS held,
  round(COALESCE(rx.receipt_amount, f.amount_transferred, 0) * COALESCE(r.rate, 0) / (1 + COALESCE(r.rate, 0)), 2) AS vat_on_receipt
FROM vendor_receipt_facilitation f
CROSS JOIN LATERAL (
  SELECT sum(e.amount_etb) AS receipt_amount, COALESCE(sum(e.wht_amount), 0) AS wht_recorded
  FROM expenses e
  WHERE e.vendor_receipt_facilitation_id = f.id AND NOT COALESCE(e.is_archived, false)
) rx
CROSS JOIN LATERAL (
  SELECT (tax_rate_note('VAT', COALESCE(f.trxn_date, CURRENT_DATE)) ->> 'standard_rate')::numeric AS rate
) r
LEFT JOIN LATERAL gregorian_to_ec(f.trxn_date) ec ON f.trxn_date IS NOT NULL
LEFT JOIN fiscal_periods fp ON f.trxn_date >= fp.start_date AND f.trxn_date <= fp.end_date
LEFT JOIN v_vrf_fund_status fs ON fs.vrf_id = f.id
WHERE NOT COALESCE(f.is_archived, false);

REVOKE ALL ON v_vrf_register FROM PUBLIC, anon;
GRANT SELECT ON v_vrf_register TO authenticated;
