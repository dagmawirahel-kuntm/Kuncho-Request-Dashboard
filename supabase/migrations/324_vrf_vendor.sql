-- 324 — The vendor on each VRF
--
-- A VRF has two parties: the facilitator, the individual who arranges it and
-- takes the commission, and the vendor, the company that issues the receipt
-- and is paid for it. Kuncho withholds WHT from the vendor, so the vendor's
-- TIN is what its WHT certificate carries. Until now only the facilitator was
-- on the VRF; the vendor sat on the (now archived) VRF payment.
--
-- - vendor_id on vendor_receipt_facilitation, filled from the archived VRF
--   payment where it named a vendor (18 of 21). A VRF with no vendor on
--   record gets "Which vendor issued the receipt?" on its review list.
-- - Facilitator names are trimmed, so the same person groups as one.
-- - v_vrf_register gains vendor_id, vendor_name and vendor_tin at the end.
--
-- Additive for the deployed frontend. 325 (post-merge) makes the vendor
-- required on new VRFs once the form that asks for it is live.

SET search_path TO public;

-- The ledger re-posts on every VRF update and posts as a person.
DO $$
DECLARE v_admin uuid;
BEGIN
  SELECT id INTO v_admin FROM user_profiles WHERE role = 'admin' ORDER BY created_at NULLS LAST LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
END $$;

ALTER TABLE vendor_receipt_facilitation
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id);
CREATE INDEX IF NOT EXISTS idx_vrf_vendor ON vendor_receipt_facilitation(vendor_id);

UPDATE vendor_receipt_facilitation f SET vendor_id = (
  SELECT x.vendor_id FROM expenses x
  WHERE x.vendor_receipt_facilitation_id = f.id AND x.vendor_id IS NOT NULL
  ORDER BY x.created_at LIMIT 1)
WHERE f.vendor_id IS NULL
  AND EXISTS (SELECT 1 FROM expenses x WHERE x.vendor_receipt_facilitation_id = f.id AND x.vendor_id IS NOT NULL);

UPDATE vendor_receipt_facilitation SET facilitator_name = btrim(facilitator_name)
WHERE facilitator_name IS DISTINCT FROM btrim(facilitator_name);

UPDATE vendor_receipt_facilitation
SET review_notes = review_notes || 'Which vendor issued the receipt?'::text,
    needs_review = true
WHERE vendor_id IS NULL AND NOT is_archived
  AND NOT ('Which vendor issued the receipt?' = ANY (review_notes));

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
  COALESCE(f.receipt_amount, f.amount_transferred, 0)::numeric AS receipt_amount,
  COALESCE(f.amount_transferred, 0)::numeric AS transferred,
  COALESCE(f.wht_amount, 0)::numeric AS wht_recorded,
  COALESCE(f.commission_amount, 0)::numeric AS commission,
  COALESCE(f.money_returned, 0)::numeric AS returned,
  (COALESCE(f.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0))::numeric AS kept_back,
  (COALESCE(f.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0)
    - COALESCE(f.wht_amount, 0) - COALESCE(f.commission_amount, 0))::numeric AS unaccounted,
  fs.company_expense_drawn,
  fs.payroll_drawn,
  fs.personal_drawn,
  fs.fund_available AS held,
  round(COALESCE(f.receipt_amount, f.amount_transferred, 0) * COALESCE(r.rate, 0) / (1 + COALESCE(r.rate, 0)), 2) AS vat_on_receipt,
  f.net_sent::numeric AS net_sent,
  f.expected_return::numeric AS expected_return,
  f.needs_review,
  f.review_notes,
  f.structured,
  f.supply_kind,
  f.commission_basis,
  f.commission_rate::numeric AS commission_rate,
  f.wht_overridden,
  f.return_account_id,
  ra.account_name AS holding_account_name,
  f.initial_account_id,
  ia.account_name AS sent_from_account_name,
  f.out_transfer_id,
  f.vendor_id,
  vd.vendor_name,
  vd.tin AS vendor_tin
FROM vendor_receipt_facilitation f
CROSS JOIN LATERAL (
  SELECT (tax_rate_note('VAT', COALESCE(f.trxn_date, CURRENT_DATE)) ->> 'standard_rate')::numeric AS rate
) r
LEFT JOIN LATERAL gregorian_to_ec(f.trxn_date) ec ON f.trxn_date IS NOT NULL
LEFT JOIN fiscal_periods fp ON f.trxn_date >= fp.start_date AND f.trxn_date <= fp.end_date
LEFT JOIN v_vrf_fund_status fs ON fs.vrf_id = f.id
LEFT JOIN accounts ra ON ra.id = f.return_account_id
LEFT JOIN accounts ia ON ia.id = f.initial_account_id
LEFT JOIN vendors vd ON vd.id = f.vendor_id
WHERE NOT COALESCE(f.is_archived, false);
REVOKE ALL ON v_vrf_register FROM PUBLIC, anon;
GRANT SELECT ON v_vrf_register TO authenticated;
