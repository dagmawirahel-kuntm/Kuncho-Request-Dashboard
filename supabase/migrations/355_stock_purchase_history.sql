-- 355 — What an item cost the last few times it was bought, and from whom
--
-- market_prices holds two rows, so the sourcing form had nothing to compare
-- a quoted price with. The real history is in the purchase orders:
-- sourcing_bundle_items.unit_price_actual, reached through the request line.
-- Most of those lines were never linked to a stock item (628 of 960), so a
-- line counts when it is linked to the item OR its typed name reduces to the
-- same key (354's stock_name_key) — "Clear silcon" bought in June shows up
-- when pricing "clear silicon" today.
--
-- SECURITY INVOKER: callers see only the purchase orders their role can
-- already read.

SET search_path TO public;

CREATE OR REPLACE FUNCTION stock_purchase_history(p_stock_item_id uuid, p_name text DEFAULT NULL, p_limit int DEFAULT 5)
RETURNS TABLE (
  bundle_id uuid, bundle_code text, vendor_name text, unit_price numeric, quantity numeric,
  unit text, bought_on date, status text, item_name text
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH keys AS (
    SELECT k FROM (
      SELECT si.name_key AS k FROM stock_items si WHERE si.id = p_stock_item_id
      UNION SELECT a.alias_key FROM stock_item_aliases a WHERE a.stock_item_id = p_stock_item_id
      UNION SELECT stock_name_key(p_name)
    ) t WHERE k IS NOT NULL AND k <> ''
  )
  SELECT b.id, b.bundle_code, COALESCE(v.vendor_name, b.vendor_name), sbi.unit_price_actual,
         sbi.quantity_actual, oi.unit, COALESCE(b.ordered_at, b.approved_at, b.created_at)::date, b.status::text,
         oi.item_name
  FROM sourcing_bundle_items sbi
  JOIN sourcing_bundles b ON b.id = sbi.bundle_id
  JOIN order_items oi ON oi.id = sbi.order_item_id
  LEFT JOIN vendors v ON v.id = b.vendor_id
  WHERE sbi.unit_price_actual > 0
    AND b.status::text NOT IN ('drafting', 'cancelled')
    AND ((p_stock_item_id IS NOT NULL AND oi.stock_item_id = p_stock_item_id)
         OR (oi.stock_item_id IS NULL AND stock_name_key(oi.item_name) IN (SELECT k FROM keys)))
  ORDER BY COALESCE(b.ordered_at, b.approved_at, b.created_at) DESC
  LIMIT greatest(1, least(COALESCE(p_limit, 5), 20))
$$;
REVOKE ALL ON FUNCTION stock_purchase_history(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stock_purchase_history(uuid, text, int) TO authenticated;
