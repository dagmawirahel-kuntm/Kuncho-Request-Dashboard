-- A VAT receipt per payment (follows 430 payments in parts, 431 VAT by part).
--
-- Vendors paid in parts often issue a VAT receipt for each payment rather
-- than one for the whole bill. A receipt can now name the part it was issued
-- for (vendor_receipts.expense_payment_id). For a paid part, the VAT tracker
-- then uses that part's own receipt — its VAT as printed, its review status
-- for whether the claim stands — and only falls back to the bill's receipt
-- (times the part's share of the bill) when the part has none. Bills paid in
-- one go, and receipts not tied to a part, are unchanged.

ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS expense_payment_id uuid REFERENCES expense_payments(id);
CREATE INDEX IF NOT EXISTS vendor_receipts_expense_payment_idx ON vendor_receipts (expense_payment_id) WHERE expense_payment_id IS NOT NULL;
COMMENT ON COLUMN vendor_receipts.expense_payment_id IS
  'The part payment this receipt was issued for, when a bill is paid in parts (migration 432)';

-- A receipt for a part belongs to that part's bill.
CREATE OR REPLACE FUNCTION vendor_receipt_part_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_exp uuid;
BEGIN
  IF NEW.expense_payment_id IS NOT NULL THEN
    SELECT expense_id INTO v_exp FROM expense_payments WHERE id = NEW.expense_payment_id;
    IF v_exp IS NULL THEN RAISE EXCEPTION 'That part payment does not exist'; END IF;
    IF NEW.expense_id IS NULL THEN
      NEW.expense_id := v_exp;
    ELSIF NEW.expense_id <> v_exp THEN
      RAISE EXCEPTION 'That part payment belongs to another expense';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_vendor_receipt_part_check BEFORE INSERT OR UPDATE OF expense_payment_id, expense_id ON vendor_receipts
  FOR EACH ROW EXECUTE FUNCTION vendor_receipt_part_check();

CREATE OR REPLACE VIEW v_input_vat_tracker WITH (security_invoker = true) AS
 WITH src AS (
         SELECT e.id AS expense_id, NULL::uuid AS part_id, NULL::integer AS part_no, NULL::integer AS part_count,
            e.amount_etb AS amount, 1::numeric AS share, NULL::date AS part_paid_date
           FROM expenses e
          WHERE e.payment_status = true AND NOT e.in_parts
        UNION ALL
         SELECT p.expense_id, p.id, pos.part_no, pos.part_count,
            p.amount_etb, p.amount_etb / NULLIF(expense_parts_payable(e), 0), p.paid_date
           FROM expense_payments p
           JOIN expenses e ON e.id = p.expense_id
           CROSS JOIN LATERAL expense_part_position(p.id) pos
          WHERE p.state = 'paid' AND e.in_parts
        ), base AS (
         SELECT e.id AS expense_id,
            e.expense_code,
            e.date AS expense_date,
            s.amount::numeric(12,2) AS amount_etb,
            e.amount_etb AS bill_amount,
            s.share,
            s.part_id, s.part_no, s.part_count,
            e.vendor_id,
            v.vendor_name,
            v.tin AS vendor_tin,
            e.project_id,
            p.project_name,
            e.receipt_url,
            (pr.id IS NOT NULL) AS own_receipt,
            COALESCE(pr.id, vr.id) AS receipt_id,
            CASE WHEN pr.id IS NOT NULL THEN pr.status ELSE vr.status END AS receipt_status,
            CASE WHEN pr.id IS NOT NULL THEN pr.vat_amount ELSE vr.vat_amount END AS receipt_vat,
            CASE WHEN pr.id IS NOT NULL THEN pr.document_url ELSE vr.document_url END AS receipt_document,
            CASE WHEN s.part_id IS NULL THEN COALESCE(vr.receipt_date, e.date)
                 ELSE COALESCE(s.part_paid_date, e.date) END AS anchor_date,
            i.vat_applicable,
            i.declare_ec_year,
            i.declare_ec_month,
            i.copy_status AS copy_status_set,
            i.vat_amount AS vat_amount_set,
            i.notes
           FROM src s
             JOIN expenses e ON e.id = s.expense_id
             LEFT JOIN vendors v ON v.id = e.vendor_id
             LEFT JOIN projects p ON p.id = e.project_id
             LEFT JOIN input_vat_items i ON i.expense_id = e.id
             -- The part's own receipt, when the vendor issued one for it.
             LEFT JOIN LATERAL ( SELECT r_0.id, r_0.status, r_0.vat_amount, r_0.document_url, r_0.receipt_date
                   FROM vendor_receipts r_0
                  WHERE s.part_id IS NOT NULL AND r_0.expense_payment_id = s.part_id
                  ORDER BY (r_0.status = 'tax_reviewed'::text) DESC, r_0.created_at DESC
                 LIMIT 1) pr ON true
             -- The bill's receipt: any for a bill paid in one go; for a part,
             -- only a receipt not issued for some other part.
             LEFT JOIN LATERAL ( SELECT r_1.id, r_1.status, r_1.vat_amount, r_1.document_url, r_1.receipt_date
                   FROM vendor_receipts r_1
                  WHERE r_1.expense_id = e.id AND (s.part_id IS NULL OR r_1.expense_payment_id IS NULL)
                  ORDER BY (r_1.status = 'tax_reviewed'::text) DESC, r_1.created_at DESC
                 LIMIT 1) vr ON true
          WHERE NOT COALESCE(e.is_archived, false) AND e.date >= financials_cutover_date()
            AND e.vendor_receipt_facilitation_id IS NULL AND e.expense_type IS DISTINCT FROM 'vrf'::expense_category
        ), r AS (
         SELECT b_1.*,
            (COALESCE(b_1.vat_applicable, true) AND COALESCE((b_1.receipt_status = 'tax_reviewed'::text), false)) AS is_claimable
           FROM base b_1
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
    ((ec_month_name(COALESCE(b.declare_ec_month, dp.ec_month)) || ' '::text) || COALESCE(b.declare_ec_year, dp.ec_year)) AS declare_period_label,
    (b.declare_ec_year IS NOT NULL) AS declare_overridden,
    -- VAT entered for the bill (times the share), else the part's own
    -- receipt as printed, else the bill's receipt or estimate times the share.
    CASE WHEN b.vat_amount_set IS NOT NULL THEN round(b.share * b.vat_amount_set, 2)
         WHEN b.own_receipt AND b.receipt_vat IS NOT NULL THEN round(b.receipt_vat, 2)
         ELSE round(b.share * COALESCE(b.receipt_vat, round(((b.bill_amount * rt.rate) / ((1)::numeric + rt.rate)), 2)), 2)
    END AS vat_amount,
        CASE
            WHEN (b.vat_amount_set IS NOT NULL) THEN 'entered'::text
            WHEN (b.receipt_vat IS NOT NULL) THEN 'receipt'::text
            ELSE 'estimated'::text
        END AS vat_source,
    b.receipt_id,
    b.receipt_status,
    COALESCE(b.copy_status_set,
        CASE
            WHEN ((b.receipt_document IS NOT NULL) OR (b.receipt_url IS NOT NULL)) THEN 'uploaded'::text
            ELSE 'not_uploaded'::text
        END) AS copy_status,
    (b.copy_status_set IS NOT NULL) AS copy_status_set,
    b.is_claimable AS claimable,
    b.notes,
        CASE
            WHEN (b.vat_applicable = false) THEN 'not_vat'::text
            WHEN b.is_claimable THEN 'claimed'::text
            WHEN (b.receipt_status = ANY (ARRAY['pending_verification'::text, 'verified'::text])) THEN 'in_review'::text
            WHEN (b.receipt_status = 'rejected'::text) THEN 'rejected'::text
            WHEN (b.vat_applicable = true) THEN 'needs_receipt'::text
            ELSE 'unflagged'::text
        END AS stage,
    b.part_id,
    b.part_no,
    b.part_count,
    b.own_receipt AS part_receipt
   FROM ((r b
     CROSS JOIN LATERAL tax_period_for_date(b.anchor_date) dp(ec_year, ec_month))
     CROSS JOIN LATERAL ( SELECT ((tax_rate_note('VAT'::text, b.anchor_date) ->> 'standard_rate'::text))::numeric AS rate) rt);
