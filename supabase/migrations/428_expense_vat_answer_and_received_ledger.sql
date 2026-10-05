-- 428 — Expenses: VAT asked up front, and the ledger from what was received
--
-- 1. VAT on expenses entered by hand
--    Until now the only VAT question on an expense came after a receipt
--    photo was attached ("Is it a VAT invoice?"). An expense paid before
--    its receipt arrived never said whether VAT was in the payment, so the
--    VAT tracker listed it as "unflagged" and its input VAT was never
--    chased or claimed.
--
--    expenses.vat_included   the submitter's answer to "Does this amount
--                            include VAT?" — true, false, or null (not
--                            sure; finance decides on the tracker).
--
--    trg_expense_receipt_to_vat now flags the purchase from that answer,
--    receipt or not: yes → input_vat_items.vat_applicable = true, so a
--    paid one shows on the tracker as needs_receipt until the receipt is
--    captured, then in_review, then claimed; no → not_vat. A receipt
--    attached to a VAT expense goes into review as before. Changing the
--    answer on the expense updates the flag, except once the receipt has
--    passed tax review — then the tax officer's decision stands.
--
--    When a VAT expense is paid with no receipt yet, the person who raised
--    it is notified to bring the receipt (expense.vat_receipt_due).
--
-- 2. The general ledger from the GRN / SDN
--    Purchase-order postings already follow the received lines
--    (resolve_po_posting_category, from goods_received_note_items), but
--    the expense itself kept the ledger guessed from the purchase request —
--    often "Multiple" — or none at all, and only an empty one was ever
--    filled (backfill_po_expense_category_from_grn).
--
--    expenses.category_source      where the ledger came from: manual,
--                                  default (the expense type's), po (the
--                                  purchase request lines), grn, sdn.
--    expenses.category_source_ref  the GRN / SDN code(s) behind it.
--
--    received_ledger(bundle)       the ledger the received lines point to:
--                                  the GRN lines' ledgers first (the same
--                                  rule as the posting), else the lines of
--                                  a received site delivery note. One
--                                  ledger → that one; several → Multiple.
--    fill_expense_ledger_from_receipts(bundle)
--                                  writes it onto the PO's expense(s) when
--                                  their ledger is empty, "Multiple", or
--                                  only the automatic guess. A ledger a
--                                  person chose is never overwritten.
--
--    Called when GRN lines are recorded or changed (the existing trigger's
--    function is replaced) and when an SDN is marked received. The expense
--    update re-syncs its accrual, so the books follow the expense.
--
-- 3. Backfill, as agreed
--    * Expenses whose purchase order has received lines are filled now.
--      When applied (5 Oct 2026): 36 purchase-order expenses tagged with
--      their GRN — 17 kept the same ledger, 7 moved from a wrong guess to
--      the received ledger, 12 from a single guess to "Multiple" (their
--      GRN lines span several ledgers). All 36 now match the ledger their
--      posting already used (resolve_po_posting_category), so the books
--      did not move; no posting failures.
--    * Paid expenses entered by hand (not purchase orders or labour) whose
--      vendor has a TIN and that the tracker had never flagged are marked
--      VAT included, so they show as needing a receipt — 2 that day.
--
-- The Supabase tool holds removal statements for a confirmation, so triggers are
-- created with CREATE OR REPLACE TRIGGER (Postgres 14+).

SET search_path TO public;
SET lock_timeout = '10s';

-- ── 1. Columns ───────────────────────────────────────────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_included boolean;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_source text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_source_ref text;

COMMENT ON COLUMN expenses.vat_included IS 'Does the amount include VAT? true / false / null = not sure (migration 428).';
COMMENT ON COLUMN expenses.category_source IS 'Where the general ledger came from: manual, default, po, grn, sdn (428). Null on rows from before 428 — read as "a guess" only if it matches the automatic default.';
COMMENT ON COLUMN expenses.category_source_ref IS 'The GRN / SDN code(s) the ledger was read from (428).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_category_source_check') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_category_source_check
      CHECK (category_source IS NULL OR category_source IN ('manual', 'default', 'po', 'grn', 'sdn'));
  END IF;
END $$;

-- ── 2. Where a ledger came from ──────────────────────────────────────
-- Runs after trg_apply_default_expense_category (BEFORE triggers fire in
-- name order). A ledger equal to the automatic one is a guess; any other
-- is a person's choice. The GRN / SDN fill sets its own source and says
-- so with app.ledger_fill.
CREATE OR REPLACE FUNCTION public.stamp_expense_category_source() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(current_setting('app.ledger_fill', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
    RETURN NEW;
  END IF;
  IF NEW.category_id IS NULL THEN
    NEW.category_source := NULL;
  ELSIF NEW.category_id IS NOT DISTINCT FROM resolve_expense_category(NEW.expense_type, NEW.sourcing_bundle_id) THEN
    NEW.category_source := CASE WHEN NEW.expense_type = 'purchase_order' THEN 'po' ELSE 'default' END;
  ELSE
    NEW.category_source := 'manual';
  END IF;
  NEW.category_source_ref := NULL;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_category_source
  BEFORE INSERT OR UPDATE OF category_id, expense_type, sourcing_bundle_id ON expenses
  FOR EACH ROW EXECUTE FUNCTION stamp_expense_category_source();

-- ── 3. The ledger the received lines point to ────────────────────────
CREATE OR REPLACE FUNCTION public.received_ledger(p_bundle uuid,
  OUT category_id uuid, OUT ledgers int, OUT source text, OUT ref text)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  v_multiple uuid := (SELECT c.id FROM categories c WHERE c.category_name = 'Multiple' LIMIT 1);
  v_one uuid;
BEGIN
  ledgers := 0;
  IF p_bundle IS NULL THEN RETURN; END IF;

  -- GRN lines: the posting's own rule (resolve_po_posting_category), with
  -- the purchase-request or stock item's ledger only where a line has none.
  SELECT count(DISTINCT x.cat), min(x.cat::text)::uuid,
         string_agg(DISTINCT x.code, ', ')
    INTO ledgers, v_one, ref
    FROM (
      SELECT COALESCE(gi.category_id, sc.parent_category_id, ssc.parent_category_id) AS cat, g.grn_code AS code
        FROM goods_received_notes g
        JOIN goods_received_note_items gi ON gi.grn_id = g.id
        LEFT JOIN sourcing_bundle_items sbi ON sbi.id = gi.sourcing_bundle_item_id
        LEFT JOIN order_items oi ON oi.id = sbi.order_item_id
        LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
        LEFT JOIN stock_items si ON si.id = oi.stock_item_id
        LEFT JOIN sub_categories ssc ON ssc.id = si.sub_category_id
       WHERE g.sourcing_bundle_id = p_bundle
    ) x
   WHERE x.cat IS NOT NULL;
  IF ledgers > 0 THEN
    source := 'grn';
  ELSE
    -- No GRN yet: a site delivery note that has been received.
    SELECT count(DISTINCT x.cat), min(x.cat::text)::uuid, string_agg(DISTINCT x.code, ', ')
      INTO ledgers, v_one, ref
      FROM (
        SELECT COALESCE(sc.parent_category_id, ssc.parent_category_id) AS cat, s.sdn_code AS code
          FROM site_delivery_notes s
          JOIN site_delivery_note_items it ON it.sdn_id = s.id
          LEFT JOIN sourcing_bundle_items sbi ON sbi.id = it.sourcing_bundle_item_id
          LEFT JOIN order_items oi ON oi.id = sbi.order_item_id
          LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
          LEFT JOIN stock_items si ON si.id = oi.stock_item_id
          LEFT JOIN sub_categories ssc ON ssc.id = si.sub_category_id
         WHERE s.sourcing_bundle_id = p_bundle
           AND s.status IN ('received', 'exceptions')
           AND COALESCE(it.quantity_received, 0) > 0
      ) x
     WHERE x.cat IS NOT NULL;
    IF ledgers > 0 THEN source := 'sdn'; ELSE ref := NULL; RETURN; END IF;
  END IF;

  category_id := CASE WHEN ledgers = 1 THEN v_one ELSE v_multiple END;
END $function$;

-- ── 4. Fill the PO's expense(s) from it ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_expense_ledger_from_receipts(p_bundle uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r record;
  n integer;
  v_multiple uuid := (SELECT id FROM categories WHERE category_name = 'Multiple' LIMIT 1);
BEGIN
  SELECT * INTO r FROM received_ledger(p_bundle);
  IF r.category_id IS NULL THEN RETURN 0; END IF;

  PERFORM set_config('app.ledger_fill', 'on', true);
  UPDATE expenses e
     SET category_id = r.category_id,
         category_source = r.source,
         category_source_ref = r.ref
   WHERE (e.sourcing_bundle_id = p_bundle
          OR e.id IN (SELECT b.expense_id FROM sourcing_bundles b WHERE b.id = p_bundle AND b.expense_id IS NOT NULL))
     AND NOT COALESCE(e.is_archived, false)
     AND COALESCE(e.payment_state, '') <> 'void'
     -- Only an empty ledger, "Multiple", or a guess — never a person's choice.
     AND (e.category_id IS NULL
          OR e.category_id = v_multiple
          OR e.category_source IN ('default', 'po', 'grn', 'sdn')
          OR (e.category_source IS NULL
              AND e.category_id IS NOT DISTINCT FROM resolve_expense_category(e.expense_type, e.sourcing_bundle_id)))
     AND (e.category_id IS DISTINCT FROM r.category_id
          OR e.category_source IS DISTINCT FROM r.source
          OR e.category_source_ref IS DISTINCT FROM r.ref);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.ledger_fill', 'off', true);
  RETURN n;
END $function$;

REVOKE EXECUTE ON FUNCTION public.fill_expense_ledger_from_receipts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fill_expense_ledger_from_receipts(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.received_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.received_ledger(uuid) TO authenticated;

-- The GRN-line trigger (trg_backfill_po_expense_category, unchanged) now
-- fills through the one rule above instead of only filling empty ledgers.
CREATE OR REPLACE FUNCTION public.backfill_po_expense_category_from_grn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM fill_expense_ledger_from_receipts(
    (SELECT gn.sourcing_bundle_id FROM goods_received_notes gn WHERE gn.id = NEW.grn_id));
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_sdn_fills_expense_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.status IN ('received', 'exceptions') AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM fill_expense_ledger_from_receipts(NEW.sourcing_bundle_id);
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER trg_sdn_fills_expense_ledger
  AFTER UPDATE OF status ON site_delivery_notes
  FOR EACH ROW EXECUTE FUNCTION trg_sdn_fills_expense_ledger();

-- ── 5. VAT: the answer flags the purchase, receipt or not ────────────
CREATE OR REPLACE FUNCTION public.trg_expense_receipt_to_vat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r vendor_receipts%ROWTYPE;
  v_vat boolean := COALESCE(NEW.vat_included, NEW.receipt_is_vat);
  v_answer_changed boolean;
BEGIN
  SELECT * INTO r FROM vendor_receipts WHERE expense_id = NEW.id ORDER BY created_at DESC LIMIT 1;

  -- A receipt on a VAT expense goes into the three-party review.
  IF NEW.receipt_url IS NOT NULL AND v_vat IS TRUE THEN
    IF r.id IS NULL THEN
      INSERT INTO vendor_receipts (expense_id, vendor_id, project_id, receipt_no, receipt_date, vat_amount,
                                   document_url, document_name, notes, from_expense_form)
      VALUES (NEW.id, NEW.vendor_id, NEW.project_id, NULLIF(btrim(NEW.receipt_no), ''), NEW.date, NEW.receipt_vat_amount,
              NEW.receipt_url, NEW.receipt_name, 'Attached on the expense', true);
    ELSIF r.from_expense_form AND r.status = 'pending_verification' THEN
      UPDATE vendor_receipts
         SET vendor_id = NEW.vendor_id, project_id = NEW.project_id,
             receipt_no = NULLIF(btrim(NEW.receipt_no), ''), receipt_date = NEW.date,
             vat_amount = NEW.receipt_vat_amount, document_url = NEW.receipt_url, document_name = NEW.receipt_name
       WHERE id = r.id;
    END IF;
  ELSIF r.id IS NOT NULL AND r.from_expense_form AND r.status = 'pending_verification' THEN
    DELETE FROM vendor_receipts WHERE id = r.id;
  END IF;

  -- The answer flags the purchase for the VAT tracker. A changed answer
  -- wins over an earlier flag, unless the receipt has passed tax review.
  IF v_vat IS NOT NULL THEN
    v_answer_changed := TG_OP = 'INSERT'
      OR OLD.vat_included IS DISTINCT FROM NEW.vat_included
      OR OLD.receipt_is_vat IS DISTINCT FROM NEW.receipt_is_vat;
    INSERT INTO input_vat_items (expense_id, vat_applicable, updated_by, updated_at)
    VALUES (NEW.id, v_vat, auth.uid(), now())
    ON CONFLICT (expense_id) DO UPDATE
       SET vat_applicable = v_vat, updated_by = auth.uid(), updated_at = now()
     WHERE input_vat_items.vat_applicable IS NULL
        OR (v_answer_changed
            AND input_vat_items.vat_applicable IS DISTINCT FROM v_vat
            AND NOT EXISTS (SELECT 1 FROM vendor_receipts x WHERE x.expense_id = NEW.id AND x.status = 'tax_reviewed'));
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER trg_expense_receipt_to_vat
  AFTER INSERT OR UPDATE OF receipt_url, receipt_name, receipt_is_vat, receipt_no, receipt_vat_amount,
                            vendor_id, project_id, date, vat_included ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_expense_receipt_to_vat();

-- ── 6. Paid with VAT, no receipt yet: tell the person who raised it ──
INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order)
VALUES ('expense.vat_receipt_due', 'Expenses', 'Bring the VAT receipt',
        'Your expense included VAT and was paid — the receipt is needed to claim it back', 'high', 18)
ON CONFLICT (kind) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_vat_receipt_due() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.payment_state = 'paid' AND OLD.payment_state IS DISTINCT FROM 'paid'
     AND COALESCE(NEW.vat_included, NEW.receipt_is_vat) IS TRUE
     AND NEW.receipt_url IS NULL
     AND NOT EXISTS (SELECT 1 FROM vendor_receipts r WHERE r.expense_id = NEW.id)
     AND NEW.purchaser_user_id IS NOT NULL
     AND NOT COALESCE(NEW.is_archived, false) THEN
    PERFORM notify(ARRAY[NEW.purchaser_user_id], 'expense.vat_receipt_due', 'Bring the VAT receipt',
      concat_ws(' · ', NEW.expense_code, notify_short(NEW.item_service_description, 60), notify_etb(NEW.amount_etb))
        || ' was paid with VAT. Upload the VAT receipt on the expense so the VAT can be claimed back.',
      '/expenses/' || NEW.id || '/edit', 'expense', NEW.id, NULL, 'expense.vat_receipt_due:' || NEW.id);
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER trg_zz_vat_receipt_due
  AFTER UPDATE OF payment_state ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_vat_receipt_due();

REVOKE EXECUTE ON FUNCTION public.trg_vat_receipt_due() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_sdn_fills_expense_ledger() FROM PUBLIC, anon;

-- ── 7. Backfill ──────────────────────────────────────────────────────
-- Ledgers from what was received.
SELECT fill_expense_ledger_from_receipts(b.bid)
  FROM (SELECT DISTINCT COALESCE(e.sourcing_bundle_id, sb.id) AS bid
          FROM expenses e
          LEFT JOIN sourcing_bundles sb ON sb.expense_id = e.id
         WHERE NOT COALESCE(e.is_archived, false)
           AND COALESCE(e.sourcing_bundle_id, sb.id) IS NOT NULL) b;

-- Paid, entered by hand, vendor with a TIN, never flagged: VAT included.
UPDATE expenses e
   SET vat_included = true
  FROM vendors v
 WHERE v.id = e.vendor_id
   AND NULLIF(btrim(v.tin), '') IS NOT NULL
   AND e.payment_status = true
   AND NOT COALESCE(e.is_archived, false)
   AND e.date >= financials_cutover_date()
   AND e.vendor_receipt_facilitation_id IS NULL
   AND e.expense_type::text NOT IN ('purchase_order', 'labor_payment', 'vrf')
   AND e.vat_included IS NULL
   AND NOT EXISTS (SELECT 1 FROM input_vat_items i WHERE i.expense_id = e.id AND i.vat_applicable IS NOT NULL);
