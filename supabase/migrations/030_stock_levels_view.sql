-- Aggregate view: current stock level per active item
-- Uses subqueries to avoid cartesian product from joining both receipts and issues

CREATE OR REPLACE VIEW v_stock_levels AS
SELECT
  si.id,
  COALESCE(r.total_in,  0)::numeric AS total_in,
  COALESCE(i.total_out, 0)::numeric AS total_out,
  (COALESCE(r.total_in, 0) - COALESCE(i.total_out, 0))::numeric AS current_stock
FROM stock_items si
LEFT JOIN (
  SELECT stock_item_id, SUM(quantity)::numeric AS total_in
  FROM   stock_receipts
  GROUP  BY stock_item_id
) r ON r.stock_item_id = si.id
LEFT JOIN (
  SELECT stock_item_id, SUM(quantity)::numeric AS total_out
  FROM   stock_issues
  GROUP  BY stock_item_id
) i ON i.stock_item_id = si.id
WHERE si.active = true;
