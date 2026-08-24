-- GRN acceptance/rejection could only be recorded as one all-or-nothing
-- verdict per line (goods_received_note_items.quality_status, 159) that
-- applies to the entire quantity_received. Real deliveries split: e.g.
-- 350 MDF delivered, 20 refused at the door, 330 taken. There was no way
-- to record that without either lying about quantity_received or lying
-- about the verdict — the form (GoodsReceivedNoteFormPage) only ever
-- wrote one number and one status per line.
--
-- Fix: replace the single verdict with a per-line quantity split.
-- quantity_received keeps meaning what showed up on the truck;
-- quantity_rejected and quantity_damaged are carved out of it, and
-- quantity_accepted (generated) is what's left. quality_status stays as
-- a derived summary label — kept for the two things that already read
-- it (v_grn_register's sort/filter, the register's condition badge) —
-- now auto-computed from the quantities via trigger instead of being
-- the source of truth.
--
-- Per the agreed policy: damaged means it was still accepted (it's
-- physically on site, so it still enters stock and is still billed —
-- unchanged from 159's original behavior). Rejected means refused, so
-- it neither enters stock nor gets billed — UNLESS the PO is
-- pay-in-advance, where the vendor was already paid before delivery and
-- a rejection can't just silently rewrite the amount; that case is left
-- for finance to resolve by hand (credit note / replacement / refund).

SET search_path TO public;

-- ── 1. Per-line quantity split ───────────────────────────────────────
ALTER TABLE goods_received_note_items
  ADD COLUMN IF NOT EXISTS quantity_rejected NUMERIC(10,3) NOT NULL DEFAULT 0;
ALTER TABLE goods_received_note_items
  ADD COLUMN IF NOT EXISTS quantity_damaged  NUMERIC(10,3) NOT NULL DEFAULT 0;

-- Existing rows: a whole-line 'rejected'/'damaged' verdict carves out
-- its full quantity_received, exactly matching what that verdict meant
-- before this migration. Nothing changes for any historical line.
UPDATE goods_received_note_items
SET quantity_rejected = CASE WHEN quality_status = 'rejected' THEN COALESCE(quantity_received, 0) ELSE 0 END,
    quantity_damaged  = CASE WHEN quality_status = 'damaged'  THEN COALESCE(quantity_received, 0) ELSE 0 END
WHERE quantity_rejected = 0 AND quantity_damaged = 0;

ALTER TABLE goods_received_note_items
  ADD COLUMN IF NOT EXISTS quantity_accepted NUMERIC(10,3)
    GENERATED ALWAYS AS (COALESCE(quantity_received, 0) - quantity_rejected - quantity_damaged) STORED;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grn_items_split_qty_chk') THEN
    ALTER TABLE goods_received_note_items
      ADD CONSTRAINT grn_items_split_qty_chk
      CHECK (quantity_rejected >= 0 AND quantity_damaged >= 0
             AND (quantity_rejected + quantity_damaged) <= COALESCE(quantity_received, 0));
  END IF;
END $$;

COMMENT ON COLUMN goods_received_note_items.quantity_rejected IS
  'Delivered but refused at the door — carved out of quantity_received, never enters stock, never billed (except pay-in-advance POs, handled by hand).';
COMMENT ON COLUMN goods_received_note_items.quantity_damaged IS
  'Delivered and kept despite being flagged damaged — still enters stock and is still billed; the flag is for traceability only.';
COMMENT ON COLUMN goods_received_note_items.quantity_accepted IS
  'quantity_received minus quantity_rejected minus quantity_damaged. What was taken in good condition.';

-- 'partial' covers a line with a real mix (some good, some not) that
-- neither 'accepted' nor a whole-line 'damaged'/'rejected' can express.
ALTER TABLE goods_received_note_items DROP CONSTRAINT IF EXISTS grn_items_quality_status_check;
ALTER TABLE goods_received_note_items
  ADD CONSTRAINT grn_items_quality_status_check
  CHECK (quality_status IN ('accepted', 'damaged', 'rejected', 'partial'));

-- ── 2. quality_status becomes a derived label, not an input ──────────
CREATE OR REPLACE FUNCTION public.sync_grn_item_quality_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF COALESCE(NEW.quantity_received, 0) > 0 AND NEW.quantity_rejected = NEW.quantity_received AND NEW.quantity_damaged = 0 THEN
    NEW.quality_status := 'rejected';
  ELSIF COALESCE(NEW.quantity_received, 0) > 0 AND NEW.quantity_damaged = NEW.quantity_received AND NEW.quantity_rejected = 0 THEN
    NEW.quality_status := 'damaged';
  ELSIF NEW.quantity_rejected > 0 OR NEW.quantity_damaged > 0 THEN
    NEW.quality_status := 'partial';
  ELSE
    NEW.quality_status := 'accepted';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sync_grn_item_quality_status ON goods_received_note_items;
CREATE TRIGGER trg_sync_grn_item_quality_status
  BEFORE INSERT OR UPDATE OF quantity_received, quantity_rejected, quantity_damaged
  ON goods_received_note_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_grn_item_quality_status();

-- Re-derive every existing row through the same logic the trigger now
-- uses, so historical rows read identically to how a fresh insert would.
UPDATE goods_received_note_items SET quantity_rejected = quantity_rejected;

-- ── 3. Stock only receives what was actually kept ────────────────────
CREATE OR REPLACE FUNCTION receipt_catalogued_stock_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_order_item   RECORD;
  v_unit_price   NUMERIC;
  v_destination  TEXT;
  v_grn_date     DATE;
  v_qty_kept     NUMERIC;
  v_note         TEXT;
BEGIN
  v_qty_kept := COALESCE(NEW.quantity_accepted, 0) + COALESCE(NEW.quantity_damaged, 0);
  IF v_qty_kept <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT oi.*, o.project_id AS req_project_id
  INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  LEFT JOIN orders o ON o.id = oi.order_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  IF NOT FOUND OR v_order_item.stock_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sbi.unit_price_actual INTO v_unit_price
  FROM sourcing_bundle_items sbi WHERE sbi.id = NEW.sourcing_bundle_item_id;

  SELECT received_at::date INTO v_grn_date FROM goods_received_notes WHERE id = NEW.grn_id;

  v_destination := CASE WHEN v_order_item.req_project_id IS NOT NULL THEN 'site' ELSE 'warehouse' END;

  v_note := 'Received via GRN';
  IF NEW.quantity_damaged > 0 THEN v_note := v_note || format(' (%s flagged damaged)', NEW.quantity_damaged); END IF;
  IF NEW.quantity_rejected > 0 THEN v_note := v_note || format(' (%s rejected, excluded)', NEW.quantity_rejected); END IF;

  INSERT INTO stock_receipts (
    stock_item_id, quantity, unit_price, receipt_type, destination,
    order_item_id, grn_item_id, received_date, notes, project_id
  ) VALUES (
    v_order_item.stock_item_id,
    v_qty_kept,
    v_unit_price,
    'purchase',
    v_destination,
    v_order_item.id,
    NEW.id,
    COALESCE(v_grn_date, CURRENT_DATE),
    v_note,
    v_order_item.req_project_id
  );

  RETURN NEW;
END;
$fn$;

-- ── 4. Vendor billing follows the accepted quantity, except when the
--    PO already paid in advance ──────────────────────────────────────
-- Deliberately incremental, not a full recompute from
-- sourcing_bundle_items: the expense's amount_etb can already differ
-- from SUM(quantity_actual * unit_price_actual) for reasons that have
-- nothing to do with rejections (a manual edit, a negotiated total, PO
-- lines changed after the expense was created). Recomputing from
-- scratch each time would silently clobber that drift along with
-- applying the rejection deduction. Instead this tracks how much has
-- already been deducted for rejections on this bundle
-- (sourcing_bundles.rejection_deduction_etb) and only applies the
-- delta between the old and new rejected total, leaving everything
-- else about amount_etb untouched.
ALTER TABLE sourcing_bundles
  ADD COLUMN IF NOT EXISTS rejection_deduction_etb NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN sourcing_bundles.rejection_deduction_etb IS
  'Total ETB already subtracted from this PO''s linked expense for rejected GRN quantity. Lets adjust_po_expense_for_rejected_qty() apply only the incremental delta on each change instead of recomputing amount_etb from scratch.';

CREATE OR REPLACE FUNCTION public.adjust_po_expense_for_rejected_qty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_bundle_id       UUID;
  v_payment_pattern TEXT;
  v_expense_id      UUID;
  v_expense_state   TEXT;
  v_old_amount      NUMERIC;
  v_prior_deduction NUMERIC;
  v_rejected_total  NUMERIC;
  v_delta           NUMERIC;
  v_new_amount      NUMERIC;
BEGIN
  SELECT sbi.bundle_id INTO v_bundle_id
  FROM sourcing_bundle_items sbi
  WHERE sbi.id = COALESCE(NEW.sourcing_bundle_item_id, OLD.sourcing_bundle_item_id);

  IF v_bundle_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT payment_pattern, expense_id, rejection_deduction_etb
  INTO v_payment_pattern, v_expense_id, v_prior_deduction
  FROM sourcing_bundles WHERE id = v_bundle_id;

  IF v_expense_id IS NULL OR v_payment_pattern = 'pay_in_advance' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT amount_etb, payment_state INTO v_old_amount, v_expense_state
  FROM expenses WHERE id = v_expense_id;

  -- Once the expense has moved past 'unpaid' it's already committed to
  -- a payment flow — adjust it by hand rather than have this trigger
  -- silently rewrite a number finance is already acting on.
  IF v_expense_state IS DISTINCT FROM 'unpaid' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(gi.quantity_rejected * COALESCE(sbi2.unit_price_actual, 0)), 0)
  INTO v_rejected_total
  FROM goods_received_note_items gi
  JOIN sourcing_bundle_items sbi2 ON sbi2.id = gi.sourcing_bundle_item_id
  WHERE sbi2.bundle_id = v_bundle_id;

  v_delta := v_rejected_total - COALESCE(v_prior_deduction, 0);

  IF v_delta <> 0 THEN
    v_new_amount := GREATEST(v_old_amount - v_delta, 0);
    UPDATE expenses
    SET amount_etb = v_new_amount,
        notes = COALESCE(notes || E'\n', '') ||
          format('Auto-adjusted %s → %s ETB: %s change in rejected quantity on the linked GRN, not billed.', v_old_amount, v_new_amount, v_delta)
    WHERE id = v_expense_id;

    UPDATE sourcing_bundles SET rejection_deduction_etb = v_rejected_total WHERE id = v_bundle_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_adjust_po_expense_for_rejected_qty ON goods_received_note_items;
CREATE TRIGGER trg_adjust_po_expense_for_rejected_qty
  AFTER INSERT OR DELETE OR UPDATE OF quantity_rejected
  ON goods_received_note_items
  FOR EACH ROW EXECUTE FUNCTION public.adjust_po_expense_for_rejected_qty();

COMMENT ON FUNCTION public.adjust_po_expense_for_rejected_qty() IS
  'Keeps the PO''s auto-created vendor expense billed only for accepted quantity when goods are rejected. Skipped for pay-in-advance POs (already paid before delivery) and once the expense has left the unpaid state (already in a payment flow) — both need a human call, not a silent rewrite.';

-- ── 5. Register: quantities and the derived label, not the raw verdict
CREATE OR REPLACE VIEW v_grn_register
WITH (security_invoker = true) AS
SELECT
  g.id,
  g.grn_code,
  g.received_at,
  g.sourcing_bundle_id,
  sb.bundle_code,
  COALESCE(v.vendor_name, sb.vendor_name) AS vendor_name,
  g.received_by,
  up.full_name AS received_by_name,
  g.photo_url,
  g.notes,
  count(gi.id)                                    AS line_count,
  COALESCE(SUM(gi.quantity_received), 0)          AS total_quantity_received,
  count(*) FILTER (WHERE gi.quantity_damaged > 0)  AS damaged_lines,
  count(*) FILTER (WHERE gi.quantity_rejected > 0) AS rejected_lines,
  CASE
    WHEN count(*) FILTER (WHERE gi.quality_status = 'rejected') > 0 THEN 'rejected'
    WHEN count(*) FILTER (WHERE gi.quality_status = 'partial')  > 0 THEN 'partial'
    WHEN count(*) FILTER (WHERE gi.quality_status = 'damaged')  > 0 THEN 'damaged'
    ELSE 'accepted'
  END AS worst_quality,
  string_agg(DISTINCT c.category_name, ', ' ORDER BY c.category_name) AS ledgers,
  COALESCE(SUM(gi.quantity_accepted), 0) AS total_quantity_accepted,
  COALESCE(SUM(gi.quantity_rejected), 0) AS total_quantity_rejected,
  COALESCE(SUM(gi.quantity_damaged), 0)  AS total_quantity_damaged
FROM goods_received_notes g
LEFT JOIN goods_received_note_items gi ON gi.grn_id = g.id
LEFT JOIN sourcing_bundles sb ON sb.id = g.sourcing_bundle_id
LEFT JOIN vendors v ON v.id = sb.vendor_id
LEFT JOIN user_profiles up ON up.id = g.received_by
LEFT JOIN categories c ON c.id = gi.category_id
GROUP BY g.id, g.grn_code, g.received_at, g.sourcing_bundle_id, sb.bundle_code, v.vendor_name, sb.vendor_name,
         g.received_by, up.full_name, g.photo_url, g.notes;

GRANT SELECT ON v_grn_register TO authenticated;
