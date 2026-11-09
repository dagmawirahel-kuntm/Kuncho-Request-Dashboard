-- 510: A VAT receipt can be collected as a picture.
--
-- A receipt is often collected as a photo — taken on a phone when the
-- supplier hands it over, or sent by the supplier — rather than as paper
-- reaching finance. A photo of the VAT receipt now counts as the receipt
-- in hand (507): its input VAT is claimed from then, on the next return
-- still to declare if its own month's is declared. The photo is kept with
-- the purchase's VAT record, in the private tax-documents store under
-- vendor-receipts/, where finance, the tax officer and management can open
-- it. Saying the receipt isn't in hand after all takes the photo off too.

SET search_path TO public;

ALTER TABLE public.input_vat_items
  ADD COLUMN IF NOT EXISTS receipt_photo_path text,
  ADD COLUMN IF NOT EXISTS receipt_photo_name text;
COMMENT ON COLUMN public.input_vat_items.receipt_photo_path IS
  'A picture of the VAT receipt, in the tax-documents bucket (510). Having one counts as the receipt in hand.';

-- "Not in hand after all" clears the picture with the tick.
CREATE OR REPLACE FUNCTION public.tax_receipt_held(p_expense_ids uuid[], p_action text, p_receipt_no text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_id uuid; v_n int := 0; v_y int; v_m int; v_dy int; v_dm int;
BEGIN
  IF NOT tax_recorder() THEN RAISE EXCEPTION 'Finance, the tax officer or an admin marks VAT receipts'; END IF;
  IF p_action NOT IN ('held', 'not_held', 'no_vat', 'vat') THEN RAISE EXCEPTION 'Unknown action %', p_action; END IF;
  FOREACH v_id IN ARRAY COALESCE(p_expense_ids, '{}') LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM expenses WHERE id = v_id);
    INSERT INTO input_vat_items (expense_id, vat_applicable, updated_by, updated_at)
    VALUES (v_id, p_action <> 'no_vat', auth.uid(), now())
    ON CONFLICT (expense_id) DO NOTHING;
    IF p_action = 'held' THEN
      -- The month it would be claimed in, and whether that return is still open.
      SELECT t.declare_ec_year, t.declare_ec_month INTO v_dy, v_dm
        FROM v_input_vat_tracker t WHERE t.expense_id = v_id ORDER BY t.part_no NULLS FIRST LIMIT 1;
      v_y := NULL; v_m := NULL;
      IF v_dy IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM tax_filings f WHERE f.schedule_code = 'VAT' AND f.status = 'draft'
              AND f.period_ec_year = v_dy AND f.period_ec_month = v_dm) THEN
        SELECT f.period_ec_year, f.period_ec_month INTO v_y, v_m FROM tax_filings f
         WHERE f.schedule_code = 'VAT' AND f.status = 'draft' AND f.period_ec_month IS NOT NULL
           AND (f.period_ec_year, f.period_ec_month) >= (v_dy, v_dm)
         ORDER BY f.period_start_greg LIMIT 1;
      END IF;
      UPDATE input_vat_items SET vat_applicable = true, receipt_held_at = now(), receipt_held_by = auth.uid(),
             receipt_no = COALESCE(NULLIF(btrim(p_receipt_no), ''), receipt_no),
             declare_ec_year = COALESCE(v_y, declare_ec_year), declare_ec_month = COALESCE(v_m, declare_ec_month),
             updated_by = auth.uid(), updated_at = now()
       WHERE expense_id = v_id;
    ELSIF p_action = 'not_held' THEN
      UPDATE input_vat_items SET receipt_held_at = NULL, receipt_held_by = NULL, receipt_no = NULL,
             receipt_photo_path = NULL, receipt_photo_name = NULL,
             updated_by = auth.uid(), updated_at = now()
       WHERE expense_id = v_id;
    ELSE
      UPDATE input_vat_items SET vat_applicable = (p_action = 'vat'),
             receipt_held_at = CASE WHEN p_action = 'no_vat' THEN NULL ELSE receipt_held_at END,
             updated_by = auth.uid(), updated_at = now()
       WHERE expense_id = v_id;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $f$;

-- A picture of the receipt: in hand from now. With no path, the picture is
-- taken off and the receipt stays as it was (in hand by its tick).
CREATE OR REPLACE FUNCTION public.tax_receipt_photo(p_expense uuid, p_path text, p_name text DEFAULT NULL, p_receipt_no text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT tax_recorder() THEN RAISE EXCEPTION 'Finance, the tax officer or an admin collects VAT receipts'; END IF;
  IF NOT EXISTS (SELECT 1 FROM expenses WHERE id = p_expense) THEN RAISE EXCEPTION 'Purchase not found'; END IF;
  IF p_path IS NULL THEN
    UPDATE input_vat_items SET receipt_photo_path = NULL, receipt_photo_name = NULL, updated_by = auth.uid(), updated_at = now()
     WHERE expense_id = p_expense;
    RETURN;
  END IF;
  IF p_path NOT LIKE 'vendor-receipts/%' THEN RAISE EXCEPTION 'The picture must be in the tax documents store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM input_vat_items WHERE expense_id = p_expense AND receipt_held_at IS NOT NULL) THEN
    PERFORM tax_receipt_held(ARRAY[p_expense], 'held', p_receipt_no);
  ELSIF NULLIF(btrim(p_receipt_no), '') IS NOT NULL THEN
    UPDATE input_vat_items SET receipt_no = btrim(p_receipt_no) WHERE expense_id = p_expense;
  END IF;
  UPDATE input_vat_items SET receipt_photo_path = p_path, receipt_photo_name = NULLIF(btrim(p_name), ''),
         updated_by = auth.uid(), updated_at = now()
   WHERE expense_id = p_expense;
END $f$;
REVOKE EXECUTE ON FUNCTION public.tax_receipt_photo(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_receipt_photo(uuid, text, text, text) TO authenticated;
