-- 417 — The stock page as a warehouse, apart from what is bought for sites
--
-- Of 351 receipts since 25 July, 280 went straight to project sites (ETB
-- 8.7M) and 71 to the warehouse (ETB 1.3M); 205 of 315 catalogue items have
-- only ever gone to sites. The 56 items held in the warehouse (ETB 1.5M on
-- paper) have never been issued out — one issue has ever been recorded —
-- and no item has ever been counted. So the page splits the two, and puts
-- what moved last, what was counted last and what it is worth on each row.
--
--   v_stock_catalog          one row per active item: warehouse quantity,
--                            average cost and value; first and last time it
--                            came in, last time it went out; last posted
--                            count and any count in progress; what was bought
--                            for sites (quantity, spend, projects, last
--                            delivery); latest price and how fresh it is;
--                            the material section (migration 416).
--   start_stock_count_items  start a count of chosen items — the ones worth
--                            the most — rather than a whole location.

SET search_path TO public;

CREATE OR REPLACE VIEW v_stock_catalog WITH (security_invoker = true) AS
WITH rc AS (
  SELECT stock_item_id,
         sum(quantity) FILTER (WHERE destination = 'warehouse') AS wh_in,
         sum(quantity * unit_price) FILTER (WHERE unit_price > 0) AS priced_value,
         sum(quantity) FILTER (WHERE unit_price > 0) AS priced_qty,
         min(received_date) FILTER (WHERE destination = 'warehouse' AND receipt_type <> 'adjustment' AND reversal_of IS NULL) AS first_in,
         max(received_date) FILTER (WHERE destination = 'warehouse' AND receipt_type <> 'adjustment' AND reversal_of IS NULL AND reversed_at IS NULL) AS last_in,
         sum(quantity) FILTER (WHERE destination = 'site') AS site_qty,
         sum(quantity * unit_price) FILTER (WHERE destination = 'site' AND unit_price > 0) AS site_spend,
         count(DISTINCT project_id) FILTER (WHERE destination = 'site') AS site_projects,
         max(received_date) FILTER (WHERE destination = 'site') AS last_site
    FROM stock_receipts GROUP BY stock_item_id),
iss AS (
  SELECT stock_item_id,
         sum(quantity) AS out_qty,
         max(issued_date) FILTER (WHERE issue_type <> 'adjustment' AND reversal_of IS NULL AND reversed_at IS NULL) AS last_out,
         count(*) FILTER (WHERE issue_type <> 'adjustment' AND reversal_of IS NULL AND reversed_at IS NULL) AS issues
    FROM stock_issues GROUP BY stock_item_id),
cnt AS (
  SELECT l.stock_item_id,
         max(c.count_date) FILTER (WHERE c.status = 'posted') AS last_counted,
         (array_agg(c.id ORDER BY c.started_at DESC) FILTER (WHERE c.status = 'counting'))[1] AS open_count_id,
         (array_agg(c.code ORDER BY c.started_at DESC) FILTER (WHERE c.status = 'counting'))[1] AS open_count_code
    FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id
   GROUP BY l.stock_item_id)
SELECT si.id, si.item_name, si.amharic_name, si.item_code, si.unit, si.main_category, si.item_type, si.is_tool,
       si.catalog_status, si.warehouse_zone, si.reorder_level, si.quality_grade, si.sub_category_id, si.structure_type,
       material_section(si.item_name, si.main_category::text) AS section,
       COALESCE(rc.wh_in, 0) - COALESCE(iss.out_qty, 0) AS qty_on_hand,
       round(rc.priced_value / NULLIF(rc.priced_qty, 0), 2) AS avg_unit_cost,
       round(GREATEST(COALESCE(rc.wh_in, 0) - COALESCE(iss.out_qty, 0), 0) * COALESCE(rc.priced_value / NULLIF(rc.priced_qty, 0), 0)) AS value_on_hand,
       rc.first_in, rc.last_in, iss.last_out, COALESCE(iss.issues, 0) AS issues,
       GREATEST(rc.last_in, iss.last_out) AS last_moved,
       cnt.last_counted, cnt.open_count_id, cnt.open_count_code,
       COALESCE(rc.site_qty, 0) AS site_qty, round(COALESCE(rc.site_spend, 0)) AS site_spend,
       COALESCE(rc.site_projects, 0) AS site_projects, rc.last_site,
       lp.display_price AS last_price, lp.display_price_sourced_at AS price_at, lp.freshness AS price_freshness
  FROM stock_items si
  LEFT JOIN rc ON rc.stock_item_id = si.id
  LEFT JOIN iss ON iss.stock_item_id = si.id
  LEFT JOIN cnt ON cnt.stock_item_id = si.id
  LEFT JOIN v_stock_item_latest_price lp ON lp.stock_item_id = si.id
 WHERE si.active;

GRANT SELECT ON v_stock_catalog TO authenticated;

-- A count of chosen items. Same rules as start_stock_count: stock keepers
-- only, tools left to the Tools page, and what the system holds frozen now.
CREATE OR REPLACE FUNCTION start_stock_count_items(p_items uuid[], p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid; v_n int;
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may start a count'; END IF;
  IF p_items IS NULL OR cardinality(p_items) = 0 THEN RAISE EXCEPTION 'Choose the items to count'; END IF;
  INSERT INTO stock_counts (warehouse_zone, notes) VALUES (NULL, NULLIF(trim(p_notes), '')) RETURNING id INTO v_id;
  INSERT INTO stock_count_lines (count_id, stock_item_id, system_qty, unit_cost)
  SELECT v_id, u.id, COALESCE(u.qty_on_hand, 0), stock_item_avg_cost(u.id)
    FROM v_stock_item_usage u
    JOIN stock_items si ON si.id = u.id
   WHERE u.id = ANY (p_items) AND si.catalog_status <> 'inactive' AND NOT si.is_tool;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'None of those items can be counted here (tools are checked on the Tools page)'; END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION start_stock_count_items(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION start_stock_count_items(uuid[], text) TO authenticated;
