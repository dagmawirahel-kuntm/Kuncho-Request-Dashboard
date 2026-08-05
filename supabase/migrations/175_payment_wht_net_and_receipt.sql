-- 175 — Payments carry a total (incl VAT + WHT), a net, and a WHT receipt cue
--
-- A payment is requested as a total amount (VAT- and withholding-inclusive).
-- wht_amount is the levied withholding; net_payable is what actually leaves to
-- the payee. When a WHT-bearing payment is paid, finance and the tax officer
-- are cued to prepare the withholding receipt.

SET search_path TO public;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS wht_amount           numeric(14,2),
  ADD COLUMN IF NOT EXISTS wht_receipt_prepared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wht_receipt_url      text,
  ADD COLUMN IF NOT EXISTS wht_receipt_name     text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='net_payable') THEN
    ALTER TABLE expenses ADD COLUMN net_payable numeric(14,2)
      GENERATED ALWAYS AS (COALESCE(amount_etb,0) - COALESCE(wht_amount,0)) STORED;
  END IF;
END $$;

COMMENT ON COLUMN expenses.wht_amount IS 'Withholding tax levied on this payment; net_payable = amount_etb (total incl VAT+WHT) minus this.';

CREATE OR REPLACE VIEW v_wht_receipts_to_prepare
WITH (security_invoker = true) AS
SELECT
  e.id AS expense_id, e.expense_code, e.date, e.paid_date,
  e.amount_etb, e.wht_amount, e.net_payable,
  e.vendor_id, v.vendor_name, v.tin AS vendor_tin,
  e.project_id, p.project_name,
  e.disbursed_by
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
WHERE e.payment_state = 'paid'
  AND COALESCE(e.wht_amount,0) > 0
  AND e.wht_receipt_prepared = false;
GRANT SELECT ON v_wht_receipts_to_prepare TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_wht_receipt_prepared(
  p_expense_id uuid, p_receipt_url text DEFAULT NULL, p_receipt_name text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_is_tax_officer boolean;
BEGIN
  SELECT COALESCE(is_tax_officer,false) INTO v_is_tax_officer FROM user_profiles WHERE id = auth.uid();
  IF get_user_role() NOT IN ('admin','finance') AND NOT COALESCE(v_is_tax_officer,false) THEN
    RAISE EXCEPTION 'Only finance, the tax officer, or an admin can prepare a withholding receipt';
  END IF;
  UPDATE expenses SET wht_receipt_prepared = true,
    wht_receipt_url = COALESCE(p_receipt_url, wht_receipt_url),
    wht_receipt_name = COALESCE(p_receipt_name, wht_receipt_name)
  WHERE id = p_expense_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.mark_wht_receipt_prepared(uuid, text, text) TO authenticated;
