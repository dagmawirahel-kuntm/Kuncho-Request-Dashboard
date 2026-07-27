-- ============================================================
-- Four related corrections to the materials chain, all confirmed
-- against the shipped schema and live data before writing:
--
--   1. GRN CARRIED ONE GL FOR THE WHOLE DELIVERY.
--      goods_received_notes.category_id (063) is a single header
--      field, but a sourcing bundle is a cart — one PO routinely
--      contains items belonging to different ledgers (Steel, Paints,
--      Electrical). Forcing one GL onto the whole GRN misclassifies
--      every line that isn't the one the receiver picked. The GL moves
--      to the line.
--
--      Worth stating plainly: the header category_id is read by
--      NOTHING today — not by 109's stock-receipt trigger, not by the
--      Balance Sheet, not by any view. It has been collected as a
--      required field on the GRN form and then ignored. So this is
--      not only a split, it is the first time a GRN's GL is actually
--      recorded somewhere usable.
--
--   2. NO QUALITY VERDICT PER LINE.
--      goods_received_note_items.condition_notes (063) is free text
--      and optional — fine as a note, useless as a control. There was
--      no way to say "this line was rejected", and no consequence if
--      it had been: 109's trigger receipts every line into stock
--      regardless. Goods you refused still increased stock on hand.
--
--   3. RETURN TO STOCK ACCEPTED ANY ITEM IN THE CATALOGUE.
--      stock_return_requests (148) has no link to what was actually
--      issued to the project, and ProjectWorkspacePage's picker offers
--      the entire stock_items catalogue. A project could "return"
--      material it was never sent, inventing stock out of nothing on
--      confirmation.
--
--   4. MATERIAL COULD ONLY GO BACK TO THE WAREHOUSE.
--      confirm_stock_return (148) hardcodes destination 'warehouse'.
--      Moving surplus straight from one site to another — the common
--      case, and the cheap one, since it skips a round trip — had to
--      be faked as a return plus a fresh issue, or not recorded at all.
--
-- Migration 148 is on main but has NEVER been applied to this
-- database, so §3–§5 below alter tables that may not exist yet at run
-- time. Every statement here is written to be order-independent with
-- respect to 148 (IF NOT EXISTS / CREATE OR REPLACE), and 148 runs
-- first in sequence anyway.
-- ============================================================

SET search_path TO public;

-- ── 1. GRN: general ledger per line, not per delivery ────────────────
ALTER TABLE goods_received_note_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_grn_items_category ON goods_received_note_items(category_id);

COMMENT ON COLUMN goods_received_note_items.category_id IS
  'General ledger this received line belongs to. Replaces the single header-level goods_received_notes.category_id, since one bundle can carry items from several ledgers.';

-- Existing lines inherit whatever the header said, so no historical
-- GRN loses its (such as it was) classification.
UPDATE goods_received_note_items gi
SET category_id = g.category_id
FROM goods_received_notes g
WHERE gi.grn_id = g.id
  AND gi.category_id IS NULL
  AND g.category_id IS NOT NULL;

-- Deliberately NOT dropped: it holds the historical value the backfill
-- above just read, and dropping a shipped column to save a few bytes
-- would break any environment mid-upgrade. New GRNs stop writing it.
COMMENT ON COLUMN goods_received_notes.category_id IS
  'DEPRECATED — superseded by goods_received_note_items.category_id. Retained for historical rows only; the GRN form no longer writes it.';

-- ── 2. GRN: a quality verdict per line, with the note optional ───────
-- Three states, because that is what receiving actually distinguishes:
--   accepted — took it, goes into stock
--   damaged  — took it anyway (it is physically on site) but flagged,
--              so a shortfall or a claim can be traced later
--   rejected — refused at the door, goes back with the driver
-- Defaulting to 'accepted' keeps every existing row meaning exactly
-- what it meant before this migration.
ALTER TABLE goods_received_note_items
  ADD COLUMN IF NOT EXISTS quality_status TEXT NOT NULL DEFAULT 'accepted';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grn_items_quality_status_check'
  ) THEN
    ALTER TABLE goods_received_note_items
      ADD CONSTRAINT grn_items_quality_status_check
      CHECK (quality_status IN ('accepted', 'damaged', 'rejected'));
  END IF;
END $$;

COMMENT ON COLUMN goods_received_note_items.quality_status IS
  'Per-line quality verdict at receipt. condition_notes carries the optional free-text detail alongside it.';

-- Rejected goods must not become stock. 109's trigger receipted every
-- line unconditionally; this adds the one guard it was missing.
-- 'damaged' still receipts — the material is on site and has to be
-- accounted for; the flag is what makes it findable.
CREATE OR REPLACE FUNCTION receipt_catalogued_stock_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_order_item   RECORD;
  v_unit_price   NUMERIC;
  v_destination  TEXT;
  v_grn_date     DATE;
BEGIN
  IF NEW.quality_status = 'rejected' THEN
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

  INSERT INTO stock_receipts (
    stock_item_id, quantity, unit_price, receipt_type, destination,
    order_item_id, grn_item_id, received_date, notes
  ) VALUES (
    v_order_item.stock_item_id,
    COALESCE(NEW.quantity_received, v_order_item.quantity),
    v_unit_price,
    'purchase',
    v_destination,
    v_order_item.id,
    NEW.id,
    COALESCE(v_grn_date, CURRENT_DATE),
    'Received via GRN' || CASE WHEN NEW.quality_status = 'damaged' THEN ' (flagged damaged)' ELSE '' END
  );

  RETURN NEW;
END;
$fn$;

-- ── 3. What is actually sitting on a project right now ───────────────
-- Issued to the project, less what has already gone back or moved on.
-- Pending requests count against the balance too, so the same surplus
-- can't be promised twice while the first request is still unconfirmed.
CREATE OR REPLACE VIEW v_project_material_balance
WITH (security_invoker = true) AS
WITH issued AS (
  SELECT si.project_id, si.stock_item_id, SUM(si.quantity) AS qty_issued
  FROM stock_issues si
  WHERE si.issue_type = 'project_use' AND si.project_id IS NOT NULL
  GROUP BY si.project_id, si.stock_item_id
),
moved AS (
  SELECT r.project_id, r.stock_item_id,
         SUM(COALESCE(r.quantity_received, r.quantity_requested)) FILTER (WHERE r.status = 'received') AS qty_returned,
         SUM(r.quantity_requested) FILTER (WHERE r.status = 'pending')  AS qty_pending
  FROM stock_return_requests r
  WHERE r.project_id IS NOT NULL
  GROUP BY r.project_id, r.stock_item_id
)
SELECT
  i.project_id,
  p.project_name,
  i.stock_item_id,
  st.item_name,
  st.unit,
  i.qty_issued,
  COALESCE(m.qty_returned, 0) AS qty_returned,
  COALESCE(m.qty_pending, 0)  AS qty_pending,
  i.qty_issued - COALESCE(m.qty_returned, 0) - COALESCE(m.qty_pending, 0) AS qty_available_to_return
FROM issued i
JOIN stock_items st ON st.id = i.stock_item_id
LEFT JOIN projects p ON p.id = i.project_id
LEFT JOIN moved m ON m.project_id = i.project_id AND m.stock_item_id = i.stock_item_id;

GRANT SELECT ON v_project_material_balance TO authenticated;

-- ── 4. Where the material is going ───────────────────────────────────
-- NULL = back to the warehouse (what 148 always did). Set = straight to
-- another site, no warehouse round trip.
ALTER TABLE stock_return_requests
  ADD COLUMN IF NOT EXISTS destination_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_return_destination_not_self'
  ) THEN
    ALTER TABLE stock_return_requests
      ADD CONSTRAINT stock_return_destination_not_self
      CHECK (destination_project_id IS NULL OR destination_project_id IS DISTINCT FROM project_id);
  END IF;
END $$;

COMMENT ON COLUMN stock_return_requests.destination_project_id IS
  'NULL returns the material to the warehouse. Set transfers it directly to another project, with no warehouse leg.';

-- ── 5. You can only send back what you were actually sent ────────────
-- Enforced in the database, not just by narrowing the picker: the
-- picker is a convenience, this is the rule. Checked on the request,
-- so a project manager finds out immediately rather than at
-- confirmation time when the material has already been loaded.
CREATE OR REPLACE FUNCTION validate_stock_return_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_available NUMERIC;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW; -- warehouse-side adjustment, not a project return
  END IF;

  SELECT qty_available_to_return INTO v_available
  FROM v_project_material_balance
  WHERE project_id = NEW.project_id AND stock_item_id = NEW.stock_item_id;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'This item was never issued to this project — only material the project actually received can be sent back or transferred';
  END IF;

  IF NEW.quantity_requested > v_available THEN
    RAISE EXCEPTION 'Only % of that item remains on this project (already-pending requests included); % requested',
      v_available, NEW.quantity_requested;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_validate_stock_return_request ON stock_return_requests;
CREATE TRIGGER trg_validate_stock_return_request
  BEFORE INSERT ON stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION validate_stock_return_request();

-- ── 6. Confirming a move: warehouse, or straight to another site ─────
-- Under this project's stock model (v_stock_on_hand = SUM(receipts) -
-- SUM(issues)), a site-to-site transfer is a receipt from the source
-- plus an issue to the destination. Net warehouse effect is exactly
-- zero, while each project's own balance moves correctly — rather than
-- inventing a third movement table for something the existing two
-- already express.
CREATE OR REPLACE FUNCTION confirm_stock_return()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_receipt_id  UUID;
  v_from_name   TEXT;
  v_to_name     TEXT;
BEGIN
  IF NEW.status = 'received' AND OLD.status IS DISTINCT FROM 'received' THEN
    NEW.confirmed_by := auth.uid();
    NEW.confirmed_at := NOW();
    IF NEW.quantity_received IS NULL THEN
      NEW.quantity_received := NEW.quantity_requested;
    END IF;

    SELECT project_name INTO v_from_name FROM projects WHERE id = NEW.project_id;
    SELECT project_name INTO v_to_name   FROM projects WHERE id = NEW.destination_project_id;

    -- Source side: the material leaves the project either way.
    INSERT INTO stock_receipts (stock_item_id, quantity, receipt_type, destination, received_date, notes)
    VALUES (
      NEW.stock_item_id, NEW.quantity_received, 'site_return',
      CASE WHEN NEW.destination_project_id IS NULL THEN 'warehouse' ELSE 'site' END,
      CURRENT_DATE,
      CASE
        WHEN NEW.destination_project_id IS NULL
          THEN 'Return to stock' || COALESCE(' from ' || v_from_name, '') || COALESCE(' — ' || NEW.notes, '')
        ELSE 'Transfer out' || COALESCE(' from ' || v_from_name, '') || COALESCE(' to ' || v_to_name, '') || COALESCE(' — ' || NEW.notes, '')
      END
    )
    RETURNING id INTO v_receipt_id;

    NEW.stock_receipt_id := v_receipt_id;

    -- Destination side: only for a site-to-site transfer. Netting this
    -- issue against the receipt above leaves warehouse stock untouched.
    IF NEW.destination_project_id IS NOT NULL THEN
      INSERT INTO stock_issues (stock_item_id, quantity, issue_type, project_id, issued_date, notes)
      VALUES (
        NEW.stock_item_id, NEW.quantity_received, 'project_use', NEW.destination_project_id, CURRENT_DATE,
        'Transferred in' || COALESCE(' from ' || v_from_name, '') || COALESCE(' — ' || NEW.notes, '')
      );
    END IF;

  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    NEW.confirmed_by := auth.uid();
    NEW.confirmed_at := NOW();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_confirm_stock_return ON stock_return_requests;
CREATE TRIGGER trg_confirm_stock_return
  BEFORE UPDATE OF status ON stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION confirm_stock_return();

-- ── Verify ───────────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns
WHERE table_name = 'goods_received_note_items' AND column_name IN ('category_id', 'quality_status')
ORDER BY column_name;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'stock_return_requests' AND column_name = 'destination_project_id';

SELECT viewname FROM pg_views WHERE viewname = 'v_project_material_balance';

SELECT proname FROM pg_proc
WHERE proname IN ('receipt_catalogued_stock_item', 'validate_stock_return_request', 'confirm_stock_return')
ORDER BY proname;

-- Every existing GRN line inherited a GL and defaults to accepted.
SELECT quality_status, count(*) AS lines, count(category_id) AS with_ledger
FROM goods_received_note_items GROUP BY quality_status;
