-- ============================================================
-- Materials stock-first check, part 1: on-hand visibility.
--
-- PREREQUISITE, flagged explicitly: stock_items (57 rows) has no
-- quantity column by design — on-hand is the running balance of
-- stock_receipts (in) minus stock_issues (out), a ledger, not a
-- stored counter, to avoid balance drift. Both tables currently have
-- ZERO rows. Until someone enters opening-balance stock_receipts rows
-- for what's physically in the warehouse today (receipt_type =
-- 'opening_balance', which already exists as a valid value on that
-- column), v_stock_on_hand below will correctly return zero for
-- everything, and every PR will silently fall through to external
-- procurement — not a bug, a real data-entry pass that has to happen
-- before this feature does anything visible. This migration does not
-- attempt that data entry; it only builds the plumbing.
--
-- Grouped by stock_item only, not by warehouse_zone, despite
-- stock_items/stock_receipts both carrying a zone: stock_issues has
-- no warehouse_zone column at all, so an issue can't be attributed to
-- a specific zone's balance — a per-zone on-hand figure would be
-- unverifiable (received-per-zone minus issued-from-nowhere-in-
-- particular). stock_items.warehouse_zone (the item's single declared
-- home zone) is surfaced for reference, not summed.
-- ============================================================

SET search_path TO public;

-- ── order_items: a request line fully covered by stock, no PO needed ──
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('pending', 'sourced', 'partially_sourced', 'unfulfilled', 'cancelled', 'stock_fulfilled'));

-- ── stock_issues: a cost basis, stamped once at issue time (never
-- recomputed live) so a later change to receipt pricing can't
-- retroactively rewrite a historical issue's cost — same reasoning as
-- labor_allocations.day_rate_snapshot later in this batch. ──────────
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS unit_cost_snapshot NUMERIC(12,2);
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS total_cost NUMERIC(14,2)
  GENERATED ALWAYS AS (quantity * COALESCE(unit_cost_snapshot, 0)) STORED;

-- ── Quantity-weighted average cost across all receipts for an item —
-- the "simple moving-average across receipts if multiple exist" the
-- spec asked for, done as SUM(qty*price)/SUM(qty) rather than a naive
-- average of unit_price values (correct when receipt sizes differ). ──
CREATE OR REPLACE FUNCTION stock_item_avg_cost(p_stock_item_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN SUM(quantity) > 0 THEN SUM(quantity * COALESCE(unit_price, 0)) / SUM(quantity) ELSE NULL END
  FROM stock_receipts
  WHERE stock_item_id = p_stock_item_id
$$;

-- ── On-hand view ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_stock_on_hand
WITH (security_invoker = true) AS
SELECT
  si.id AS stock_item_id,
  si.item_name,
  si.warehouse_zone,
  si.unit,
  si.reorder_level,
  si.active,
  COALESCE(r.total_received, 0) - COALESCE(iss.total_issued, 0) AS qty_on_hand,
  stock_item_avg_cost(si.id) AS avg_unit_cost
FROM stock_items si
LEFT JOIN (SELECT stock_item_id, SUM(quantity) AS total_received FROM stock_receipts GROUP BY stock_item_id) r
  ON r.stock_item_id = si.id
LEFT JOIN (SELECT stock_item_id, SUM(quantity) AS total_issued FROM stock_issues GROUP BY stock_item_id) iss
  ON iss.stock_item_id = si.id;

GRANT SELECT ON v_stock_on_hand TO authenticated;

-- Verify: every stock item, its computed on-hand (should be 0 for all
-- 57 rows until the opening-balance pass happens), and the new
-- order_items status value is accepted.
SELECT stock_item_id, item_name, warehouse_zone, qty_on_hand, avg_unit_cost FROM v_stock_on_hand ORDER BY item_name;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'order_items_status_check';
