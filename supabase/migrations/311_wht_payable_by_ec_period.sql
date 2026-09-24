-- Aligning the tax pages with Tax Filings, part 3: the WHT Kuncho owes the
-- authority, per Ethiopian period.
--
-- Source: expenses.wht_amount (migration 175) -- the withholding actually
-- levied on each vendor payment, entered at payment time. It is used as
-- recorded rather than re-derived from a rate: what the WHT return must
-- declare is what was withheld, and every non-zero value on file today is
-- exactly 3% of the pre-VAT amount, so the two agree anyway.
--
-- Nothing is withheld until the vendor is paid, so only paid expenses count
-- toward a period. Unpaid expenses that already carry a wht_amount are
-- reported separately as pending, so they are visible without inflating a
-- return.
--
-- Period date: the payment date when one was recorded, else the expense
-- date. Checked against production: of the 10 paid expenses with WHT, 8 have
-- no payment date at all, so the expense date is the only date there is.
-- vendor_receipts.withholding_amount is deliberately NOT added -- it is the
-- same withholding as printed on the vendor's receipt, and adding it would
-- count it twice.
--
-- Additive only (see 309).

SET search_path TO public;

CREATE OR REPLACE VIEW v_wht_payable_by_ec_period
WITH (security_invoker = true) AS
SELECT ec.ec_year, ec.ec_month,
       ec_month_name(ec.ec_month) || ' ' || ec.ec_year                      AS period_label,
       count(*) FILTER (WHERE e.payment_status)                             AS paid_expense_count,
       COALESCE(sum(e.wht_amount) FILTER (WHERE e.payment_status), 0)       AS wht_withheld,
       count(*) FILTER (WHERE NOT e.payment_status)                         AS pending_expense_count,
       COALESCE(sum(e.wht_amount) FILTER (WHERE NOT e.payment_status), 0)   AS wht_pending_unpaid
FROM expenses e
CROSS JOIN LATERAL gregorian_to_ec(COALESCE(e.total_payment_date, e.paid_date::date, e.date)) ec
WHERE COALESCE(e.wht_amount, 0) > 0
  AND COALESCE(e.total_payment_date, e.paid_date::date, e.date) IS NOT NULL
  AND NOT COALESCE(e.is_archived, false)
GROUP BY ec.ec_year, ec.ec_month;

GRANT SELECT ON v_wht_payable_by_ec_period TO authenticated;
