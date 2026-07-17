-- ============================================================
-- §1a: new items with no catalogued stock_item_id.
--
-- Default is NO behavior change — an order_item with no stock_item_id
-- proceeds straight to external procurement exactly as today, per
-- check_and_fulfill_from_stock() already no-op'ing on a null
-- stock_item_id (091). This migration only adds the OPT-IN path: a
-- single checkbox the requester/procurement officer can tick when an
-- item is worth cataloging for reorder, not a form and not an
-- approval gate — same "must be as fast as saying it out loud"
-- reasoning as everywhere else in this batch.
--
-- Auto-cataloging happens at GRN receipt, not at PR time, because the
-- requester shouldn't be expected to know item_code/warehouse_zone/
-- reorder_level — those are put on the one role equipped to set them
-- (stock_manager), after the purchase already happened. The new
-- catalog row starts life in 'pending_setup' and is excluded from
-- v_stock_on_hand / future stock-checks until a stock_manager
-- finishes it — an incomplete catalog entry must never silently make
-- a future PR think stock exists when nobody's actually verified it.
-- ============================================================

SET search_path TO public;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS propose_new_stock_item BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS catalog_status TEXT NOT NULL DEFAULT 'active'
  CHECK (catalog_status IN ('pending_setup', 'active', 'inactive'));

-- Backfill existing 57 rows from the current `active` boolean so
-- nothing that's already in use looks unset.
UPDATE stock_items SET catalog_status = CASE WHEN active THEN 'active' ELSE 'inactive' END;

-- Dropped and recreated, not CREATE OR REPLACE — Postgres only allows
-- REPLACE to append columns at the end of the existing list, and
-- catalog_status needs to sit next to the other stock_items columns,
-- not tacked on after avg_unit_cost. GRANT is re-issued after re-
-- creating since DROP VIEW clears it.
DROP VIEW IF EXISTS v_stock_on_hand;
CREATE VIEW v_stock_on_hand
WITH (security_invoker = true) AS
SELECT
  si.id AS stock_item_id,
  si.item_name,
  si.warehouse_zone,
  si.unit,
  si.reorder_level,
  si.active,
  si.catalog_status,
  COALESCE(r.total_received, 0) - COALESCE(iss.total_issued, 0) AS qty_on_hand,
  stock_item_avg_cost(si.id) AS avg_unit_cost
FROM stock_items si
LEFT JOIN (SELECT stock_item_id, SUM(quantity) AS total_received FROM stock_receipts GROUP BY stock_item_id) r
  ON r.stock_item_id = si.id
LEFT JOIN (SELECT stock_item_id, SUM(quantity) AS total_issued FROM stock_issues GROUP BY stock_item_id) iss
  ON iss.stock_item_id = si.id
WHERE si.catalog_status = 'active';

GRANT SELECT ON v_stock_on_hand TO authenticated;

-- check_and_fulfill_from_stock (091) already queries v_stock_on_hand
-- by stock_item_id and gets NULL/0 for anything not in it, so a
-- pending_setup item's own order_items.stock_item_id (if it somehow
-- got linked early) safely yields "no stock available" rather than a
-- false positive — no change needed there.

-- ── Auto-catalog on GRN receipt ──────────────────────────────────
CREATE OR REPLACE FUNCTION auto_catalog_new_stock_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_item         RECORD;
  v_new_stock_item_id  UUID;
  v_grn_date           DATE;
BEGIN
  SELECT oi.* INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  IF NOT FOUND OR NOT v_order_item.propose_new_stock_item OR v_order_item.stock_item_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT received_at::date INTO v_grn_date FROM goods_received_notes WHERE id = NEW.grn_id;

  INSERT INTO stock_items (item_name, unit, sub_category_id, catalog_status, active, notes)
  VALUES (
    v_order_item.item_name, v_order_item.unit, v_order_item.sub_category_id, 'pending_setup', TRUE,
    'Auto-created from PR line ' || v_order_item.id || ' — needs item_code, warehouse_zone, and reorder_level set before it counts toward future stock-checks.'
  )
  RETURNING id INTO v_new_stock_item_id;

  INSERT INTO stock_receipts (stock_item_id, quantity, unit_price, receipt_type, destination, order_item_id, received_date, notes)
  VALUES (
    v_new_stock_item_id, COALESCE(NEW.quantity_received, v_order_item.quantity), v_order_item.unit_price_est,
    'opening_balance', 'warehouse', v_order_item.id, COALESCE(v_grn_date, CURRENT_DATE),
    'Opening balance — first receipt of a newly proposed catalog item'
  );

  UPDATE order_items SET stock_item_id = v_new_stock_item_id WHERE id = v_order_item.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_catalog_new_stock_item ON goods_received_note_items;
CREATE TRIGGER trg_auto_catalog_new_stock_item
  AFTER INSERT ON goods_received_note_items
  FOR EACH ROW EXECUTE FUNCTION auto_catalog_new_stock_item();

-- ── Pending-setup list for stock_manager ─────────────────────────
CREATE OR REPLACE VIEW v_stock_items_pending_setup
WITH (security_invoker = true) AS
SELECT id, item_name, unit, sub_category_id, notes, created_at
FROM stock_items
WHERE catalog_status = 'pending_setup'
ORDER BY created_at;

GRANT SELECT ON v_stock_items_pending_setup TO authenticated;

-- Verify
SELECT catalog_status, count(*) FROM stock_items GROUP BY catalog_status;
SELECT proname FROM pg_proc WHERE proname = 'auto_catalog_new_stock_item';
