-- 342 — Prepare the expense when a pay-in-advance PO is ordered
--
-- A PO's expense has been raised two ways:
--
--   pay on delivery   automatically, when the GRN is recorded (136, 341)
--   pay in advance    by hand: someone opens the PO and clicks "Record
--                     Advance Payment for this PO", then saves the form
--
-- The second waits on a person remembering. On 26 September 35 ordered
-- pay-in-advance POs, 3.82M ETB before VAT, had no expense, so finance had
-- nothing to approve or pay for them.
--
-- Now marking a pay-in-advance PO ordered prepares its expense straight
-- away, exactly as the GRN does for pay on delivery: gross with VAT, WHT
-- set where it applies (341), pending finance approval. Nothing is paid by
-- this — the expense still goes through approval and the To-Pay queue, and
-- lands as an advance that closes against the GRN (110). Pay on delivery
-- keeps its expense at the GRN: before delivery there is nothing to pay,
-- and the payment lifecycle refuses to pay one without a GRN anyway.
--
-- The same happens when an ordered PO's pattern is switched to pay in
-- advance. The 35 waiting now are prepared by this migration, dated the day
-- each was ordered.
--
-- If an ordered PO is cancelled while its prepared expense is still
-- untouched — pending, unpaid, on no payment request or batch — the
-- expense is removed with it, so cancelling does not leave finance an
-- approval for goods that will never come. Anything further along is left
-- for a person.
--
-- create_po_expense() is the one place a PO's expense is built; the GRN
-- trigger now calls it too.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.create_po_expense(p_bundle_id uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle          sourcing_bundles%ROWTYPE;
  v_item_names      TEXT;
  v_project_id      UUID;
  v_project_count   INT;
  v_expense_id      UUID;
  v_tax             RECORD;
BEGIN
  SELECT * INTO v_bundle FROM sourcing_bundles WHERE id = p_bundle_id FOR UPDATE;
  IF v_bundle.id IS NULL OR v_bundle.expense_id IS NOT NULL THEN
    RETURN v_bundle.expense_id;
  END IF;

  SELECT string_agg(DISTINCT oi.item_name, ', ')
  INTO v_item_names
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.bundle_id = v_bundle.id;

  SELECT count(*) INTO v_project_count FROM (
    SELECT DISTINCT o.project_id
    FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = v_bundle.id AND o.project_id IS NOT NULL
  ) distinct_projects;

  IF v_project_count = 1 THEN
    SELECT o.project_id INTO v_project_id
    FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = v_bundle.id AND o.project_id IS NOT NULL
    LIMIT 1;
  END IF;

  -- The expense is the PO's gross (subtotal + VAT); the WHT is withheld from
  -- it at payment, so net_payable is what the vendor receives.
  SELECT * INTO v_tax FROM po_expense_tax(
    COALESCE(v_bundle.total_value, 0),
    (SELECT wth_eligible FROM vendors WHERE id = v_bundle.vendor_id));

  INSERT INTO expenses (
    item_service_description, amount_etb, date, expense_type,
    vendor_id, vendors_name, project_id, sourcing_bundle_id, requested,
    wht_amount, verify_wht, wht_handling_method, notes
  ) VALUES (
    'PO ' || v_bundle.bundle_code || COALESCE(' — ' || v_item_names, ''),
    v_tax.gross, COALESCE(p_date, CURRENT_DATE), 'purchase_order',
    v_bundle.vendor_id, CASE WHEN v_bundle.vendor_id IS NULL THEN v_bundle.vendor_name END,
    v_project_id, v_bundle.id, true,
    NULLIF(v_tax.wht, 0), v_tax.wht > 0, CASE WHEN v_tax.wht > 0 THEN 'Withheld & Remitted' END,
    concat_ws(E'\n',
      CASE WHEN v_bundle.payment_pattern = 'pay_in_advance'
                AND NOT EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.sourcing_bundle_id = v_bundle.id) THEN
        'Prepared when the PO was ordered: the vendor is paid in advance, and this closes against the GRN once goods arrive.'
      END,
      CASE WHEN COALESCE(v_bundle.discount_etb, 0) > 0 THEN
        format('Vendor discount of %s ETB applied: %s before discount, %s billed.%s',
               v_bundle.discount_etb, v_bundle.items_subtotal_etb, v_bundle.total_value,
               COALESCE(' ' || v_bundle.discount_reason, ''))
      END,
      format('PO subtotal %s + VAT 15%% %s = %s.%s',
             COALESCE(v_bundle.total_value, 0), v_tax.vat, v_tax.gross,
             CASE WHEN v_tax.wht > 0 THEN format(' WHT 3%% %s withheld; %s to the vendor.', v_tax.wht, v_tax.gross - v_tax.wht) ELSE '' END))
  ) RETURNING id INTO v_expense_id;

  UPDATE sourcing_bundles SET expense_id = v_expense_id WHERE id = v_bundle.id;

  RETURN v_expense_id;
END;
$function$;

COMMENT ON FUNCTION public.create_po_expense(uuid, date) IS
  'Builds the expense for a PO (gross with VAT, WHT where it applies) and links it, unless it already has one. Called by the GRN trigger and when a pay-in-advance PO is ordered.';

-- Only the triggers call it.
REVOKE ALL ON FUNCTION public.create_po_expense(uuid, date) FROM PUBLIC, anon, authenticated;

-- GRN: pay on delivery (and any PO that somehow reached a GRN without one).
CREATE OR REPLACE FUNCTION public.auto_create_purchase_order_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM create_po_expense(NEW.sourcing_bundle_id);
  RETURN NEW;
END;
$function$;

-- Ordered: pay in advance.
CREATE OR REPLACE FUNCTION public.prepare_po_expense_on_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expense expenses%ROWTYPE;
BEGIN
  IF NEW.status = 'ordered' AND NEW.payment_pattern = 'pay_in_advance' AND NEW.expense_id IS NULL
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.payment_pattern IS DISTINCT FROM NEW.payment_pattern) THEN
    PERFORM create_po_expense(NEW.id);
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND NEW.expense_id IS NOT NULL THEN
    SELECT * INTO v_expense FROM expenses WHERE id = NEW.expense_id;
    IF v_expense.approval_status = 'pending' AND v_expense.payment_state = 'unpaid'
       AND NOT EXISTS (SELECT 1 FROM payment_requests pr WHERE pr.expense_id = v_expense.id)
       AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses bpe WHERE bpe.expense_id = v_expense.id)
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = v_expense.id) THEN
      -- Anything else pointing at it (a receipt, say) keeps it: the
      -- cancellation goes through and the expense stays for a person.
      BEGIN
        UPDATE sourcing_bundles SET expense_id = NULL WHERE id = NEW.id;
        DELETE FROM expenses WHERE id = v_expense.id;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prepare_po_expense_on_order ON sourcing_bundles;
CREATE TRIGGER trg_prepare_po_expense_on_order
  AFTER UPDATE OF status, payment_pattern ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION prepare_po_expense_on_order();

-- The ones already waiting.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT b.id, b.ordered_at FROM sourcing_bundles b
    WHERE b.status = 'ordered' AND b.payment_pattern = 'pay_in_advance' AND b.expense_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.sourcing_bundle_id = b.id)
      AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.sourcing_bundle_id = b.id)
    ORDER BY b.ordered_at
  LOOP
    PERFORM create_po_expense(r.id, COALESCE((r.ordered_at AT TIME ZONE 'Africa/Addis_Ababa')::date, CURRENT_DATE));
    n := n + 1;
  END LOOP;
  IF n <> 35 THEN
    RAISE EXCEPTION 'Expected to prepare 35 advance expenses, prepared %', n;
  END IF;
END $$;
