-- 429 — Purchase-order expenses: VAT read from the purchase order
--
-- 428 asked "Does this amount include VAT?" on expenses entered by hand.
-- A purchase-order expense is created from the PO, and the PO already says
-- whether VAT was charged: since 341 its expense is the PO's gross, so
-- when the amount is the items' subtotal (less any discount) plus 15%, VAT
-- was charged; when it is the subtotal itself, it was not.
--
-- 1. From now on: po_expense_vat_from_po() sets vat_included on a
--    purchase-order expense whose answer is still blank, when its amount
--    matches the PO subtotal × 1.15 (yes) or × 1.00 (no), within half a
--    percent for rounding. Part-payments, advances and anything else stay
--    blank — "not sure" — for finance. A person's answer is never changed.
--    Through trg_expense_receipt_to_vat (428) the answer flags the
--    purchase for the VAT tracker.
--
-- 2. Paid PO expenses the tracker had never flagged, when applied
--    (5 Oct 2026):
--      31  the PO shows +15% VAT                → VAT included
--       7  no PO subtotal, vendor has a TIN     → VAT included (428's rule)
--      32  no PO subtotal, no TIN               → left for finance
--       1  amount 1.12 × subtotal               → left for finance
--    The 38 now show on the VAT tracker as needing a receipt. Nothing is
--    claimed until a receipt passes tax review; no notification is sent
--    (the reminder fires only when an expense is paid).

SET search_path TO public;
SET lock_timeout = '10s';

-- The PO's own VAT, read from its subtotal: true / false / null.
CREATE OR REPLACE FUNCTION public.po_vat_from_amount(p_bundle uuid, p_amount numeric) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE
           WHEN net IS NULL OR net <= 0 OR p_amount IS NULL THEN NULL
           WHEN abs(p_amount / net - 1.15) <= 0.005 THEN true
           WHEN abs(p_amount / net - 1.00) <= 0.005 THEN false
         END
    FROM (SELECT COALESCE(sb.items_subtotal_etb, 0) - COALESCE(sb.discount_etb, 0) AS net
            FROM sourcing_bundles sb WHERE sb.id = p_bundle) x
$function$;

CREATE OR REPLACE FUNCTION public.po_expense_vat_from_po() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.expense_type = 'purchase_order' AND NEW.vat_included IS NULL THEN
    NEW.vat_included := po_vat_from_amount(
      COALESCE(NEW.sourcing_bundle_id, (SELECT b.id FROM sourcing_bundles b WHERE b.expense_id = NEW.id LIMIT 1)),
      NEW.amount_etb);
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_po_expense_vat_from_po
  BEFORE INSERT OR UPDATE OF amount_etb, sourcing_bundle_id, expense_type ON expenses
  FOR EACH ROW EXECUTE FUNCTION po_expense_vat_from_po();

-- ── Backfill: paid PO expenses the tracker had never flagged ─────────
WITH unflagged AS (
  SELECT e.id,
         po_vat_from_amount(COALESCE(e.sourcing_bundle_id, (SELECT b.id FROM sourcing_bundles b WHERE b.expense_id = e.id LIMIT 1)),
                            e.amount_etb) AS from_po,
         NULLIF(btrim(v.tin), '') IS NOT NULL AS has_tin
    FROM expenses e
    LEFT JOIN vendors v ON v.id = e.vendor_id
   WHERE e.expense_type = 'purchase_order'
     AND e.payment_status = true
     AND NOT COALESCE(e.is_archived, false)
     AND e.date >= financials_cutover_date()
     AND e.vendor_receipt_facilitation_id IS NULL
     AND e.vat_included IS NULL
     AND NOT EXISTS (SELECT 1 FROM input_vat_items i WHERE i.expense_id = e.id AND i.vat_applicable IS NOT NULL)
)
UPDATE expenses e
   SET vat_included = COALESCE(u.from_po, CASE WHEN u.has_tin THEN true END)
  FROM unflagged u
 WHERE e.id = u.id
   AND COALESCE(u.from_po, CASE WHEN u.has_tin THEN true END) IS NOT NULL;
