-- 358 — "In stock" means in the warehouse
--
-- Stock on hand was every receipt minus every issue. But 280 of the 349
-- receipts (4,690 of 5,245 units) are goods delivered straight to a project
-- site (destination = 'site'), and nothing ever issues them out — so they
-- sat in "stock" for good: "Africa Gypsum — 27 in stock" was gypsum that
-- went to the sites. v_project_material_balance already counts those
-- deliveries as placed at the project, so the same units were counted
-- twice. Stock on hand now counts warehouse receipts only; site deliveries
-- are reported separately as delivered to sites.
--
-- Average cost ignored nothing: 14 opening-balance receipts have no price
-- and were averaged in at 0. It now averages priced receipts only.
--
-- Everything reading these — the dispatch check on purchase requests
-- (check_and_fulfill_from_stock, sign_off_stock_dispatch via
-- v_stock_on_hand), the stock list (v_stock_levels), the request-form search
-- and the review views from 354 — follows.

SET search_path TO public;

CREATE OR REPLACE FUNCTION stock_item_avg_cost(p_stock_item_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN SUM(quantity) > 0 THEN SUM(quantity * unit_price) / SUM(quantity) END
  FROM stock_receipts
  WHERE stock_item_id = p_stock_item_id AND unit_price > 0
$$;

CREATE OR REPLACE VIEW v_stock_on_hand WITH (security_invoker = on) AS
SELECT si.id AS stock_item_id,
    si.item_name,
    si.warehouse_zone,
    si.unit,
    si.reorder_level,
    si.active,
    si.catalog_status,
    COALESCE(r.wh_in, 0) - COALESCE(iss.total_out, 0) AS qty_on_hand,
    stock_item_avg_cost(si.id) AS avg_unit_cost,
    COALESCE(r.site_in, 0) AS qty_delivered_to_sites
FROM stock_items si
LEFT JOIN (
  SELECT stock_item_id,
         sum(quantity) FILTER (WHERE destination = 'warehouse') AS wh_in,
         sum(quantity) FILTER (WHERE destination = 'site') AS site_in
  FROM stock_receipts GROUP BY stock_item_id
) r ON r.stock_item_id = si.id
LEFT JOIN (SELECT stock_item_id, sum(quantity) AS total_out FROM stock_issues GROUP BY stock_item_id) iss ON iss.stock_item_id = si.id
WHERE si.catalog_status = 'active';

CREATE OR REPLACE VIEW v_stock_levels WITH (security_invoker = on) AS
SELECT si.id,
    COALESCE(r.wh_in, 0) AS total_in,
    COALESCE(i.total_out, 0) AS total_out,
    COALESCE(r.wh_in, 0) - COALESCE(i.total_out, 0) AS current_stock,
    COALESCE(r.site_in, 0) AS delivered_to_sites
FROM stock_items si
LEFT JOIN (
  SELECT stock_item_id,
         sum(quantity) FILTER (WHERE destination = 'warehouse') AS wh_in,
         sum(quantity) FILTER (WHERE destination = 'site') AS site_in
  FROM stock_receipts GROUP BY stock_item_id
) r ON r.stock_item_id = si.id
LEFT JOIN (SELECT stock_item_id, sum(quantity) AS total_out FROM stock_issues GROUP BY stock_item_id) i ON i.stock_item_id = si.id
WHERE si.active = true;

CREATE OR REPLACE VIEW v_stock_item_usage WITH (security_invoker = on) AS
SELECT si.id, si.item_code, si.item_name, si.unit, si.catalog_status, si.is_tool, si.created_at,
       si.sub_category_id, si.warehouse_zone,
       (SELECT count(*) FROM order_items x WHERE x.stock_item_id = si.id)    AS request_lines,
       (SELECT count(*) FROM stock_receipts x WHERE x.stock_item_id = si.id) AS receipts,
       (SELECT count(*) FROM stock_issues x WHERE x.stock_item_id = si.id)   AS issues,
       (SELECT count(*) FROM tool_units x WHERE x.stock_item_id = si.id)     AS tool_units,
       COALESCE((SELECT sum(quantity) FROM stock_receipts x WHERE x.stock_item_id = si.id AND x.destination = 'warehouse'), 0)
         - COALESCE((SELECT sum(quantity) FROM stock_issues x WHERE x.stock_item_id = si.id), 0) AS qty_on_hand,
       (si.notes LIKE 'Auto-created on receipt%') AS from_receipt,
       COALESCE((SELECT sum(quantity) FROM stock_receipts x WHERE x.stock_item_id = si.id AND x.destination = 'site'), 0) AS qty_delivered_to_sites
FROM stock_items si
WHERE si.active AND si.catalog_status <> 'inactive';

-- The request-form search: warehouse quantity, plus what went to sites.
DROP FUNCTION IF EXISTS match_stock_items(text, int);
CREATE FUNCTION match_stock_items(p_query text, p_limit int DEFAULT 8)
RETURNS TABLE (
  id uuid, item_code text, item_name text, unit text, catalog_status text,
  sub_category_id uuid, qty_on_hand numeric, last_price numeric, last_price_date date,
  match text, score numeric, alias_name text, qty_delivered_to_sites numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (
    SELECT stock_name_key(p_query) AS k, stock_name_numbers(stock_name_key(p_query)) AS n,
           lower(btrim(p_query)) AS raw
  ),
  c AS (
    SELECT si.id, si.item_code, si.item_name, si.unit, si.catalog_status, si.sub_category_id,
           al.alias_name,
           CASE WHEN si.name_key = q.k OR al.alias_key IS NOT NULL THEN 1::real
                ELSE greatest(similarity(si.name_key, q.k), word_similarity(q.k, si.name_key)) END AS sc,
           stock_name_numbers(si.name_key) = q.n AS same_nums,
           (si.name_key = q.k OR al.alias_key IS NOT NULL) AS same_key,
           strpos(lower(si.item_name), q.raw) > 0 OR lower(si.item_code) = q.raw AS contains
    FROM stock_items si
    CROSS JOIN q
    LEFT JOIN stock_item_aliases al ON al.stock_item_id = si.id AND al.alias_key = q.k
    WHERE auth.uid() IS NOT NULL
      AND q.k <> ''
      AND si.active AND si.catalog_status <> 'inactive'
  )
  SELECT c.id, c.item_code, c.item_name, c.unit, c.catalog_status, c.sub_category_id,
         COALESCE((SELECT sum(r.quantity) FROM stock_receipts r WHERE r.stock_item_id = c.id AND r.destination = 'warehouse'), 0)
           - COALESCE((SELECT sum(i.quantity) FROM stock_issues i WHERE i.stock_item_id = c.id), 0),
         lp.unit_price, lp.received_date,
         CASE WHEN c.same_key THEN 'same'
              WHEN c.same_nums AND c.sc >= 0.5 THEN 'close'
              ELSE 'partial' END,
         round(c.sc::numeric, 2), c.alias_name,
         COALESCE((SELECT sum(r.quantity) FROM stock_receipts r WHERE r.stock_item_id = c.id AND r.destination = 'site'), 0)
  FROM c
  LEFT JOIN LATERAL (
    SELECT r.unit_price, r.received_date FROM stock_receipts r
     WHERE r.stock_item_id = c.id AND r.unit_price > 0
     ORDER BY r.received_date DESC, r.created_at DESC LIMIT 1
  ) lp ON true
  WHERE c.same_key OR c.contains OR c.sc >= 0.35
  ORDER BY c.same_key DESC, (c.same_nums AND c.sc >= 0.5) DESC, c.sc DESC,
           (c.catalog_status = 'active') DESC, c.item_name
  LIMIT greatest(1, least(COALESCE(p_limit, 8), 25))
$$;
REVOKE ALL ON FUNCTION match_stock_items(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_stock_items(text, int) TO authenticated;
