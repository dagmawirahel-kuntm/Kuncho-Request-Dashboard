-- Fix to v_input_vat_tracker (317): `claimable` was NULL, not false, for a
-- flagged purchase with no receipt yet.
--
--   COALESCE(vat_applicable, false) AND receipt_status = 'tax_reviewed'
--
-- With no vendor_receipts row, receipt_status is NULL, so the expression is
-- true AND NULL = NULL. v_vat_input_by_ec_period then filters pending items
-- with `vat_applicable AND NOT claimable`, and NOT NULL is NULL -- so every
-- flagged purchase still waiting for a receipt dropped out of "awaiting
-- review", which is exactly the list the tracker exists to show. Found by
-- flagging a real purchase in a rolled-back test and seeing the Nehase 2018
-- pending figure stay empty.

SET search_path TO public;

CREATE OR REPLACE VIEW v_input_vat_tracker
WITH (security_invoker = true) AS
WITH base AS (
  SELECT e.id AS expense_id, e.expense_code, e.date AS expense_date, e.amount_etb,
         e.vendor_id, v.vendor_name, v.tin AS vendor_tin,
         e.project_id, p.project_name,
         e.receipt_url,
         vr.id AS receipt_id, vr.status AS receipt_status, vr.vat_amount AS receipt_vat,
         vr.document_url AS receipt_document,
         COALESCE(vr.receipt_date, e.date) AS anchor_date,
         i.vat_applicable, i.declare_ec_year, i.declare_ec_month,
         i.copy_status AS copy_status_set, i.vat_amount AS vat_amount_set, i.notes
  FROM expenses e
  LEFT JOIN vendors  v ON v.id = e.vendor_id
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN input_vat_items i ON i.expense_id = e.id
  LEFT JOIN LATERAL (
    SELECT r.id, r.status, r.vat_amount, r.document_url, r.receipt_date
    FROM vendor_receipts r
    WHERE r.expense_id = e.id
    ORDER BY (r.status = 'tax_reviewed') DESC, r.created_at DESC
    LIMIT 1
  ) vr ON true
  WHERE e.payment_status = true
    AND NOT COALESCE(e.is_archived, false)
    AND e.date >= financials_cutover_date()
)
SELECT b.expense_id, b.expense_code, b.expense_date, b.amount_etb,
       b.vendor_id, b.vendor_name, b.vendor_tin, b.project_id, b.project_name,
       b.vat_applicable,
       b.anchor_date,
       dp.ec_year                                        AS default_ec_year,
       dp.ec_month                                       AS default_ec_month,
       COALESCE(b.declare_ec_year,  dp.ec_year)          AS declare_ec_year,
       COALESCE(b.declare_ec_month, dp.ec_month)         AS declare_ec_month,
       ec_month_name(COALESCE(b.declare_ec_month, dp.ec_month)) || ' ' || COALESCE(b.declare_ec_year, dp.ec_year)
                                                         AS declare_period_label,
       (b.declare_ec_year IS NOT NULL)                   AS declare_overridden,
       COALESCE(b.vat_amount_set, b.receipt_vat,
                round(b.amount_etb * r.rate / (1 + r.rate), 2)) AS vat_amount,
       CASE WHEN b.vat_amount_set IS NOT NULL THEN 'entered'
            WHEN b.receipt_vat   IS NOT NULL THEN 'receipt'
            ELSE 'estimated' END                         AS vat_source,
       b.receipt_id, b.receipt_status,
       COALESCE(b.copy_status_set,
                CASE WHEN b.receipt_document IS NOT NULL OR b.receipt_url IS NOT NULL
                     THEN 'uploaded' ELSE 'not_uploaded' END) AS copy_status,
       (b.copy_status_set IS NOT NULL)                   AS copy_status_set,
       (COALESCE(b.vat_applicable, false)
        AND COALESCE(b.receipt_status = 'tax_reviewed', false)) AS claimable,
       b.notes
FROM base b
CROSS JOIN LATERAL tax_period_for_date(b.anchor_date) dp
CROSS JOIN LATERAL (SELECT (tax_rate_note('VAT', b.anchor_date) ->> 'standard_rate')::numeric AS rate) r;
