-- ============================================================
-- GRN -> stock integration, direction 1: an already-catalogued item.
--
-- The gap: migration 092's auto_catalog_new_stock_item() trigger only
-- fires when propose_new_stock_item is true AND stock_item_id is
-- still NULL (a brand-new item). The far more common case — a PR
-- line linked to an item that's ALREADY in the catalog
-- (order_items.stock_item_id already set, via StockLinkControl on the
-- PR form) — was never handled: that trigger explicitly returns early
-- for it (`... OR v_order_item.stock_item_id IS NOT NULL THEN RETURN
-- NEW`), and nothing else writes a stock_receipts row on GRN receipt.
-- Receiving goods via a GRN has been invisible to the warehouse for
-- this entire class of purchase — a received material stays at
-- qty_on_hand = 0 in v_stock_on_hand and gets re-ordered. This
-- migration is the missing other half.
--
-- The other direction (checking stock BEFORE buying) already exists
-- — check_and_fulfill_from_stock(), migration 091, wired into
-- OrderFormPage. Nothing to build there; noted so both directions of
-- this integration are visibly accounted for in one place.
-- ============================================================

SET search_path TO public;

-- ── Traceability: which GRN delivery produced this receipt ────────
-- order_item_id alone doesn't distinguish a PR line received across
-- multiple partial GRNs; this closes that gap for both directions
-- (auto-catalog's opening-balance receipt and this migration's own).
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS grn_item_id UUID REFERENCES goods_received_note_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_receipts_grn_item ON stock_receipts(grn_item_id);

CREATE OR REPLACE FUNCTION receipt_catalogued_stock_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_item   RECORD;
  v_unit_price   NUMERIC;
  v_destination  TEXT;
  v_grn_date     DATE;
BEGIN
  SELECT oi.*, o.project_id AS req_project_id
  INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  LEFT JOIN orders o ON o.id = oi.order_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  -- Already-catalogued items only — a null stock_item_id here is
  -- either not stock-tracked at all, or the propose-new-item path
  -- (migration 092's own trigger), which handles itself.
  IF NOT FOUND OR v_order_item.stock_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sbi.unit_price_actual INTO v_unit_price
  FROM sourcing_bundle_items sbi WHERE sbi.id = NEW.sourcing_bundle_item_id;

  SELECT received_at::date INTO v_grn_date FROM goods_received_notes WHERE id = NEW.grn_id;

  -- Project-linked PR -> the material was requested for a specific
  -- site, so it lands there; anything else (office/workshop/general
  -- stock replenishment) lands in the warehouse. A heuristic, not a
  -- field anyone fills in explicitly — the only signal available at
  -- GRN time is which PR line this traces back to.
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
    'Received via GRN'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_catalogued_stock_item ON goods_received_note_items;
CREATE TRIGGER trg_receipt_catalogued_stock_item
  AFTER INSERT ON goods_received_note_items
  FOR EACH ROW EXECUTE FUNCTION receipt_catalogued_stock_item();

-- ============================================================
-- Duplicate/misspelling guard — a soft warning at entry, not a hard
-- block. pg_trgm confirmed not installed anywhere in this project.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_stock_items_name_trgm ON stock_items USING gin (item_name gin_trgm_ops);

-- SECURITY INVOKER (default) — stock_items read is already open to any
-- authenticated user (migration 022b), so this needs no elevation; it
-- exists purely so the frontend can call one RPC instead of hand-
-- rolling a similarity query, and so the 0.3 threshold lives in one
-- place instead of copy-pasted into every caller.
CREATE OR REPLACE FUNCTION find_similar_stock_items(p_name TEXT)
RETURNS TABLE (id UUID, item_name TEXT, catalog_status TEXT, similarity REAL)
LANGUAGE sql STABLE AS $$
  SELECT si.id, si.item_name, si.catalog_status, similarity(si.item_name, p_name) AS similarity
  FROM stock_items si
  WHERE si.item_name % p_name
  ORDER BY similarity DESC
  LIMIT 5
$$;

GRANT EXECUTE ON FUNCTION find_similar_stock_items(TEXT) TO authenticated;

-- Verify: trigger + extension + function present
SELECT tgname FROM pg_trigger WHERE tgrelid = 'goods_received_note_items'::regclass AND NOT tgisinternal ORDER BY tgname;
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
SELECT proname FROM pg_proc WHERE proname = 'find_similar_stock_items';
SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_receipts' AND column_name = 'grn_item_id';
