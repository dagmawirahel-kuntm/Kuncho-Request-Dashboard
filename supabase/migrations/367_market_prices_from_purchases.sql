-- 367: Market prices come from what we actually buy.
--
-- Market Trends was fed only by orders.approval_status, using the
-- requester's *estimate* (order_items.unit_price_est), which is almost never
-- filled in. The prices Kuncho really pays live on purchase orders
-- (sourcing_bundle_items.unit_price_actual), so the page, the order-form
-- hint, the catalog costing and the proforma had nothing to go on.
--
-- 1. market_prices takes a new source, 'purchase': one row per priced line
--    of an approved / ordered / fulfilled purchase order, kept in step by
--    triggers (a cancelled PO takes its prices back out, a line matched to a
--    stock item later moves its price onto the item). Lines not linked to a
--    stock item are kept as free-text prices so they still count.
-- 2. The estimate trigger on orders is dropped — an estimate isn't a price.
-- 3. v_stock_item_latest_price: the newest real price wins (a purchase or a
--    verified quote, whichever is newer), prices in another unit are left
--    out, and each item carries its 6-month range, previous price, number
--    of purchases, vendors and the vendor of the latest price.
-- 4. v_market_free_text_prices: the same for prices with no stock item.
-- 5. market_price_search(): one search over both, for the proforma's price
--    guide and anywhere else a price needs looking up.
-- 6. proforma_item_costs: what a proforma line costs us and where that
--    figure came from, readable only by the roles that see margin.

SET search_path TO public;

-- ── 1. market_prices ───────────────────────────────────────────────────
ALTER TABLE market_prices ALTER COLUMN sourced_by_staff_id DROP NOT NULL;
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS source_bundle_item_id uuid
  REFERENCES sourcing_bundle_items(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS market_prices_bundle_item_key
  ON market_prices (source_bundle_item_id) WHERE source_bundle_item_id IS NOT NULL;

ALTER TABLE market_prices DROP CONSTRAINT IF EXISTS market_prices_source_check;
ALTER TABLE market_prices ADD CONSTRAINT market_prices_source_check
  CHECK (source IN ('po_entry', 'verified_quote', 'check_request_response', 'purchase'));

ALTER TABLE market_prices DROP CONSTRAINT IF EXISTS market_prices_needs_anchor_chk;
ALTER TABLE market_prices ADD CONSTRAINT market_prices_needs_anchor_chk
  CHECK (stock_item_id IS NOT NULL OR sub_category_id IS NOT NULL OR NULLIF(btrim(item_description), '') IS NOT NULL);

-- Groups free-text prices of the same thing however it was typed.
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS description_key text
  GENERATED ALWAYS AS (lower(regexp_replace(btrim(item_description), '\s+', ' ', 'g'))) STORED;
CREATE INDEX IF NOT EXISTS market_prices_free_text_idx
  ON market_prices (description_key, sourced_at DESC) WHERE stock_item_id IS NULL;
CREATE INDEX IF NOT EXISTS market_prices_free_text_trgm
  ON market_prices USING gin (description_key gin_trgm_ops) WHERE stock_item_id IS NULL;

-- ── Purchase orders → market prices ─────────────────────────────────────
CREATE OR REPLACE FUNCTION market_prices_sync_bundle(p_bundle_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b sourcing_bundles%ROWTYPE;
  v_staff uuid;
BEGIN
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle_id;
  IF NOT FOUND OR b.status::text NOT IN ('approved', 'ordered', 'fulfilled') THEN
    DELETE FROM market_prices
     WHERE source = 'purchase'
       AND source_bundle_item_id IN (SELECT id FROM sourcing_bundle_items WHERE bundle_id = p_bundle_id);
    RETURN;
  END IF;

  SELECT s.id INTO v_staff FROM staff s WHERE s.user_id = b.procurement_officer_id LIMIT 1;

  DELETE FROM market_prices mp
   USING sourcing_bundle_items sbi
   WHERE mp.source_bundle_item_id = sbi.id
     AND sbi.bundle_id = p_bundle_id
     AND COALESCE(sbi.unit_price_actual, 0) <= 0;

  INSERT INTO market_prices (stock_item_id, sub_category_id, item_description, unit_price, currency, unit,
    source, source_vendor_id, source_reference, source_order_item_id, source_bundle_item_id,
    sourced_by_staff_id, sourced_at)
  SELECT oi.stock_item_id, oi.sub_category_id,
    CASE WHEN oi.stock_item_id IS NULL THEN NULLIF(btrim(oi.item_name), '') END,
    sbi.unit_price_actual, 'ETB',
    COALESCE(NULLIF(btrim(oi.unit), ''), si.unit, 'pcs'),
    'purchase', b.vendor_id, b.bundle_code, oi.id, sbi.id,
    v_staff, COALESCE(b.approved_at, b.submitted_at, b.created_at)
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  LEFT JOIN stock_items si ON si.id = oi.stock_item_id
  WHERE sbi.bundle_id = p_bundle_id
    AND COALESCE(sbi.unit_price_actual, 0) > 0
    AND (oi.stock_item_id IS NOT NULL OR oi.sub_category_id IS NOT NULL OR NULLIF(btrim(oi.item_name), '') IS NOT NULL)
  ON CONFLICT (source_bundle_item_id) WHERE source_bundle_item_id IS NOT NULL DO UPDATE SET
    stock_item_id       = EXCLUDED.stock_item_id,
    sub_category_id     = EXCLUDED.sub_category_id,
    item_description    = EXCLUDED.item_description,
    unit_price          = EXCLUDED.unit_price,
    unit                = EXCLUDED.unit,
    source_vendor_id    = EXCLUDED.source_vendor_id,
    source_reference    = EXCLUDED.source_reference,
    source_order_item_id = EXCLUDED.source_order_item_id,
    sourced_at          = EXCLUDED.sourced_at,
    sourced_by_staff_id = COALESCE(EXCLUDED.sourced_by_staff_id, market_prices.sourced_by_staff_id);
END $$;
REVOKE ALL ON FUNCTION market_prices_sync_bundle(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trg_market_prices_from_bundle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM market_prices_sync_bundle(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION trg_market_prices_from_bundle() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_market_prices_from_bundle ON sourcing_bundles;
CREATE TRIGGER trg_market_prices_from_bundle
  AFTER INSERT OR UPDATE OF status, vendor_id, approved_at, bundle_code ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION trg_market_prices_from_bundle();

CREATE OR REPLACE FUNCTION trg_market_prices_from_bundle_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM market_prices_sync_bundle(NEW.bundle_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION trg_market_prices_from_bundle_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_market_prices_from_bundle_item ON sourcing_bundle_items;
CREATE TRIGGER trg_market_prices_from_bundle_item
  AFTER INSERT OR UPDATE OF unit_price_actual, order_item_id ON sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION trg_market_prices_from_bundle_item();

-- A line matched to a stock item (or renamed) after it was bought.
CREATE OR REPLACE FUNCTION trg_market_prices_from_order_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT bundle_id FROM sourcing_bundle_items WHERE order_item_id = NEW.id LOOP
    PERFORM market_prices_sync_bundle(r.bundle_id);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION trg_market_prices_from_order_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_market_prices_from_order_item ON order_items;
CREATE TRIGGER trg_market_prices_from_order_item
  AFTER UPDATE OF stock_item_id, item_name, unit, sub_category_id ON order_items
  FOR EACH ROW
  WHEN (OLD.stock_item_id IS DISTINCT FROM NEW.stock_item_id
     OR OLD.item_name IS DISTINCT FROM NEW.item_name
     OR OLD.unit IS DISTINCT FROM NEW.unit
     OR OLD.sub_category_id IS DISTINCT FROM NEW.sub_category_id)
  EXECUTE FUNCTION trg_market_prices_from_order_item();

-- ── 2. Estimates are not prices ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_auto_log_market_price_po ON orders;

-- Backfill every purchase order already approved.
SELECT market_prices_sync_bundle(id) FROM sourcing_bundles WHERE status::text IN ('approved', 'ordered', 'fulfilled');

-- ── 3. Latest price per stock item ──────────────────────────────────────
CREATE OR REPLACE VIEW v_stock_item_latest_price
WITH (security_invoker = true) AS
WITH items AS (
  SELECT si.id, si.item_name, si.amharic_name, si.item_code, si.unit, si.sub_category_id, si.main_category,
    sc.item_name AS sub_category_name,
    COALESCE(si.volatility, sc.volatility, 'moderate') AS volatility
  FROM stock_items si
  LEFT JOIN sub_categories sc ON sc.id = si.sub_category_id
  WHERE si.active
), p AS MATERIALIZED (
  SELECT m.id, m.stock_item_id, m.unit_price, m.sourced_at, m.source, m.source_vendor_id,
    row_number() OVER (PARTITION BY m.stock_item_id ORDER BY m.sourced_at DESC, m.created_at DESC) AS rn
  FROM market_prices m
  JOIN items i ON i.id = m.stock_item_id
  -- A price per sheet says nothing about an item kept per m².
  WHERE i.unit IS NULL OR m.unit IS NULL OR lower(btrim(m.unit)) = lower(btrim(i.unit))
), agg AS (
  SELECT stock_item_id,
    count(*) FILTER (WHERE sourced_at >= now() - interval '180 days')                          AS prices_180d,
    count(*) FILTER (WHERE source = 'purchase' AND sourced_at >= now() - interval '180 days')  AS buys_180d,
    min(unit_price) FILTER (WHERE sourced_at >= now() - interval '180 days')                   AS min_180d,
    max(unit_price) FILTER (WHERE sourced_at >= now() - interval '180 days')                   AS max_180d,
    round(avg(unit_price) FILTER (WHERE sourced_at >= now() - interval '180 days'), 2)         AS avg_180d,
    count(DISTINCT source_vendor_id) FILTER (WHERE sourced_at >= now() - interval '180 days')  AS vendors_180d,
    max(sourced_at) FILTER (WHERE source = 'purchase')                                          AS last_bought_at,
    (array_agg(unit_price ORDER BY sourced_at) FILTER (WHERE sourced_at >= now() - interval '90 days'))[1] AS first_90d_price,
    min(sourced_at) FILTER (WHERE sourced_at >= now() - interval '90 days')                    AS first_90d_at
  FROM p GROUP BY stock_item_id
), base90 AS (
  SELECT DISTINCT ON (stock_item_id) stock_item_id, unit_price
  FROM p WHERE sourced_at <= now() - interval '90 days'
  ORDER BY stock_item_id, sourced_at DESC
), ver AS (
  SELECT DISTINCT ON (stock_item_id) stock_item_id, unit_price, sourced_at
  FROM p WHERE source IN ('verified_quote', 'check_request_response')
  ORDER BY stock_item_id, sourced_at DESC
), j AS (
  SELECT i.*, l.id AS latest_id, l.unit_price AS latest_price, l.sourced_at AS latest_at, l.source AS latest_source,
    l.source_vendor_id AS latest_vendor_id,
    pv.unit_price AS previous_price, pv.sourced_at AS previous_at,
    ver.unit_price AS verified_price, ver.sourced_at AS verified_at,
    a.prices_180d, a.buys_180d, a.min_180d, a.max_180d, a.avg_180d, a.vendors_180d, a.last_bought_at,
    -- Change over 90 days: against the price 90 days ago, or against the
    -- first price inside the window when there's no older one.
    COALESCE(b90.unit_price,
      CASE WHEN a.first_90d_at <= l.sourced_at - interval '7 days' THEN a.first_90d_price END) AS base_90d,
    CASE WHEN l.sourced_at IS NULL THEN NULL
         ELSE GREATEST(0, (EXTRACT(epoch FROM (now() - l.sourced_at)) / 86400.0)::integer) END AS days_old
  FROM items i
  LEFT JOIN p l   ON l.stock_item_id = i.id AND l.rn = 1
  LEFT JOIN p pv  ON pv.stock_item_id = i.id AND pv.rn = 2
  LEFT JOIN ver   ON ver.stock_item_id = i.id
  LEFT JOIN agg a ON a.stock_item_id = i.id
  LEFT JOIN base90 b90 ON b90.stock_item_id = i.id
)
SELECT j.id AS stock_item_id,
  j.item_name, j.amharic_name, j.item_code, j.unit, j.sub_category_id, j.volatility,
  j.latest_price     AS latest_any_price,
  j.latest_at        AS latest_any_sourced_at,
  j.latest_source    AS latest_any_source,
  j.latest_vendor_id AS latest_any_vendor_id,
  j.verified_price   AS latest_verified_price,
  j.verified_at      AS latest_verified_sourced_at,
  -- Both a purchase and a verified quote are real prices: the newer one wins.
  j.latest_price     AS display_price,
  j.latest_source    AS display_price_source,
  j.latest_at        AS display_price_sourced_at,
  j.days_old         AS days_since_display_price,
  CASE WHEN j.days_old IS NULL THEN 'outdated'
       WHEN j.days_old <= cfg.fresh_days_max THEN 'fresh'
       WHEN j.days_old <= cfg.aging_days_max THEN 'aging'
       WHEN j.days_old <= cfg.stale_days_max THEN 'stale'
       ELSE 'outdated' END AS freshness,
  CASE WHEN j.base_90d IS NULL OR j.base_90d = 0 OR j.latest_price IS NULL THEN NULL
       ELSE round((j.latest_price - j.base_90d) / j.base_90d * 100, 2) END AS price_trend_90d_pct,
  j.main_category,
  j.sub_category_name,
  j.latest_id        AS display_price_id,
  v.vendor_name      AS display_vendor_name,
  j.previous_price,
  j.previous_at      AS previous_sourced_at,
  CASE WHEN j.previous_price IS NULL OR j.previous_price = 0 OR j.latest_price IS NULL THEN NULL
       ELSE round((j.latest_price - j.previous_price) / j.previous_price * 100, 1) END AS change_vs_previous_pct,
  COALESCE(j.prices_180d, 0)::int  AS prices_180d,
  COALESCE(j.buys_180d, 0)::int    AS buys_180d,
  j.min_180d, j.max_180d, j.avg_180d,
  COALESCE(j.vendors_180d, 0)::int AS vendors_180d,
  j.last_bought_at
FROM j
LEFT JOIN market_price_freshness_config cfg ON cfg.volatility = j.volatility
LEFT JOIN vendors v ON v.id = j.latest_vendor_id;
REVOKE ALL ON v_stock_item_latest_price FROM PUBLIC, anon;
GRANT SELECT ON v_stock_item_latest_price TO authenticated;

-- ── 4. Prices with no stock item ────────────────────────────────────────
CREATE OR REPLACE VIEW v_market_free_text_prices
WITH (security_invoker = true) AS
WITH p AS MATERIALIZED (
  SELECT m.*,
    COALESCE(m.description_key, 'sub-category:' || m.sub_category_id::text) AS anchor_key,
    lower(btrim(m.unit)) AS unit_key,
    row_number() OVER (PARTITION BY COALESCE(m.description_key, 'sub-category:' || m.sub_category_id::text), lower(btrim(m.unit))
                       ORDER BY m.sourced_at DESC, m.created_at DESC) AS rn
  FROM market_prices m
  WHERE m.stock_item_id IS NULL
), agg AS (
  SELECT anchor_key, unit_key,
    count(*)::int AS prices,
    count(*) FILTER (WHERE source = 'purchase')::int AS buys,
    min(unit_price) AS min_price, max(unit_price) AS max_price, round(avg(unit_price), 2) AS avg_price,
    count(DISTINCT source_vendor_id)::int AS vendors,
    min(sourced_at) AS first_at
  FROM p GROUP BY anchor_key, unit_key
)
SELECT l.id AS latest_id,
  l.anchor_key,
  COALESCE(l.item_description, sc.item_name) AS name,
  (l.item_description IS NULL) AS is_sub_category_survey,
  l.sub_category_id, sc.item_name AS sub_category_name,
  l.brand, l.specification,
  l.unit, l.unit_price AS latest_price, l.currency, l.sourced_at, l.source,
  l.source_vendor_id AS vendor_id, v.vendor_name, l.source_reference,
  a.prices, a.buys, a.min_price, a.max_price, a.avg_price, a.vendors, a.first_at,
  pv.unit_price AS previous_price,
  CASE WHEN pv.unit_price IS NULL OR pv.unit_price = 0 THEN NULL
       ELSE round((l.unit_price - pv.unit_price) / pv.unit_price * 100, 1) END AS change_vs_previous_pct,
  GREATEST(0, (EXTRACT(epoch FROM (now() - l.sourced_at)) / 86400.0)::integer) AS days_old,
  CASE WHEN GREATEST(0, (EXTRACT(epoch FROM (now() - l.sourced_at)) / 86400.0)::integer) <= cfg.fresh_days_max THEN 'fresh'
       WHEN GREATEST(0, (EXTRACT(epoch FROM (now() - l.sourced_at)) / 86400.0)::integer) <= cfg.aging_days_max THEN 'aging'
       WHEN GREATEST(0, (EXTRACT(epoch FROM (now() - l.sourced_at)) / 86400.0)::integer) <= cfg.stale_days_max THEN 'stale'
       ELSE 'outdated' END AS freshness
FROM p l
JOIN agg a ON a.anchor_key = l.anchor_key AND a.unit_key IS NOT DISTINCT FROM l.unit_key
LEFT JOIN p pv ON pv.anchor_key = l.anchor_key AND pv.unit_key IS NOT DISTINCT FROM l.unit_key AND pv.rn = 2
LEFT JOIN sub_categories sc ON sc.id = l.sub_category_id
LEFT JOIN vendors v ON v.id = l.source_vendor_id
LEFT JOIN market_price_freshness_config cfg ON cfg.volatility = COALESCE(sc.volatility, 'moderate')
WHERE l.rn = 1;
REVOKE ALL ON v_market_free_text_prices FROM PUBLIC, anon;
GRANT SELECT ON v_market_free_text_prices TO authenticated;

-- History: now says which purchase order a price came from, and whether it
-- was in a different unit from the item's.
DROP FUNCTION IF EXISTS v_market_price_history(uuid, date, date);
CREATE FUNCTION v_market_price_history(p_stock_item_id uuid, p_from_date date DEFAULT NULL, p_to_date date DEFAULT NULL)
RETURNS TABLE(id uuid, unit_price numeric, currency text, unit text, source text, vendor_id uuid, vendor_name text,
  source_reference text, sourced_at timestamptz, sourced_by_staff_id uuid, sourced_by_name text, notes text,
  bundle_id uuid, other_unit boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT mp.id, mp.unit_price, mp.currency, mp.unit, mp.source,
    mp.source_vendor_id, v.vendor_name, mp.source_reference, mp.sourced_at,
    mp.sourced_by_staff_id, s.employee_name, mp.notes,
    sbi.bundle_id,
    (si.unit IS NOT NULL AND mp.unit IS NOT NULL AND lower(btrim(mp.unit)) <> lower(btrim(si.unit)))
  FROM market_prices mp
  JOIN stock_items si ON si.id = mp.stock_item_id
  LEFT JOIN vendors v ON v.id = mp.source_vendor_id
  LEFT JOIN staff s ON s.id = mp.sourced_by_staff_id
  LEFT JOIN sourcing_bundle_items sbi ON sbi.id = mp.source_bundle_item_id
  WHERE mp.stock_item_id = p_stock_item_id
    AND (p_from_date IS NULL OR mp.sourced_at::date >= p_from_date)
    AND (p_to_date IS NULL OR mp.sourced_at::date <= p_to_date)
  ORDER BY mp.sourced_at DESC LIMIT 500;
$$;
REVOKE ALL ON FUNCTION v_market_price_history(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v_market_price_history(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION market_price_history_free_text(p_anchor_key text)
RETURNS TABLE(id uuid, unit_price numeric, currency text, unit text, source text, vendor_id uuid, vendor_name text,
  source_reference text, sourced_at timestamptz, sourced_by_staff_id uuid, sourced_by_name text, notes text,
  bundle_id uuid, other_unit boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT mp.id, mp.unit_price, mp.currency, mp.unit, mp.source,
    mp.source_vendor_id, v.vendor_name, mp.source_reference, mp.sourced_at,
    mp.sourced_by_staff_id, s.employee_name, mp.notes, sbi.bundle_id, false
  FROM market_prices mp
  LEFT JOIN vendors v ON v.id = mp.source_vendor_id
  LEFT JOIN staff s ON s.id = mp.sourced_by_staff_id
  LEFT JOIN sourcing_bundle_items sbi ON sbi.id = mp.source_bundle_item_id
  WHERE mp.stock_item_id IS NULL
    AND COALESCE(mp.description_key, 'sub-category:' || mp.sub_category_id::text) = p_anchor_key
  ORDER BY mp.sourced_at DESC LIMIT 200;
$$;
REVOKE ALL ON FUNCTION market_price_history_free_text(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION market_price_history_free_text(text) TO authenticated;

-- Keep catalog recipes on prices in the item's own unit.
CREATE OR REPLACE VIEW v_catalog_costing
WITH (security_invoker = true) AS
SELECT p.id AS product_id,
  p.product_name, p.item_code, p.kind, p.unit, p.active,
  p.service_line_id, sl.name AS service_line,
  p.unit_price AS list_price,
  COALESCE(p.markup_percent, sl.markup_percent, 0) AS markup_percent,
  c.components,
  c.unpriced_components,
  CASE WHEN c.components > 0 THEN round(c.cost_per_unit, 2) END AS cost_per_unit,
  CASE WHEN c.components > 0 THEN round(c.cost_per_unit * (1 + COALESCE(p.markup_percent, sl.markup_percent, 0) / 100), 2) END AS suggested_price,
  CASE WHEN c.components > 0 AND COALESCE(p.unit_price, 0) > 0
       THEN round((p.unit_price - c.cost_per_unit) / p.unit_price * 100, 1) END AS margin_at_list_pct,
  c.oldest_market_price_at
FROM products p
LEFT JOIN catalog_service_lines sl ON sl.id = p.service_line_id
LEFT JOIN LATERAL (
  SELECT count(*) AS components,
    count(*) FILTER (WHERE x.cost IS NULL) AS unpriced_components,
    COALESCE(sum(x.qty * x.cost), 0) AS cost_per_unit,
    min(x.market_at) AS oldest_market_price_at
  FROM (
    SELECT k.qty_per_unit AS qty,
      COALESCE(k.unit_cost, mp.unit_price) AS cost,
      CASE WHEN k.unit_cost IS NULL THEN mp.sourced_at END AS market_at
    FROM catalog_item_components k
    LEFT JOIN stock_items si ON si.id = k.stock_item_id
    LEFT JOIN LATERAL (
      SELECT m.unit_price, m.sourced_at FROM market_prices m
      WHERE k.stock_item_id IS NOT NULL AND m.stock_item_id = k.stock_item_id
        AND (si.unit IS NULL OR m.unit IS NULL OR lower(btrim(m.unit)) = lower(btrim(si.unit)))
      ORDER BY m.sourced_at DESC LIMIT 1
    ) mp ON true
    WHERE k.product_id = p.id
  ) x
) c ON true;
REVOKE ALL ON v_catalog_costing FROM PUBLIC, anon;
GRANT SELECT ON v_catalog_costing TO authenticated;

-- ── 5. One search over every price ──────────────────────────────────────
CREATE OR REPLACE FUNCTION market_price_search(p_q text, p_limit int DEFAULT 12)
RETURNS TABLE(kind text, stock_item_id uuid, anchor_key text, price_id uuid, name text, detail text, unit text,
  latest_price numeric, sourced_at timestamptz, source text, vendor_name text, source_reference text,
  freshness text, days_old int, prices int, min_price numeric, max_price numeric, change_pct numeric, score real)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH q AS (SELECT lower(regexp_replace(btrim(COALESCE(p_q, '')), '\s+', ' ', 'g')) AS q)
  SELECT * FROM (
    SELECT 'stock'::text, l.stock_item_id, NULL::text, l.display_price_id, l.item_name,
      concat_ws(' · ', l.item_code, l.sub_category_name), l.unit,
      l.display_price, l.display_price_sourced_at, l.display_price_source, l.display_vendor_name, NULL::text,
      l.freshness, l.days_since_display_price, l.prices_180d, l.min_180d, l.max_180d, l.change_vs_previous_pct,
      GREATEST(similarity(lower(l.item_name), q.q), word_similarity(q.q, lower(l.item_name)), word_similarity(lower(l.item_name), q.q))
    FROM v_stock_item_latest_price l, q
    WHERE l.display_price IS NOT NULL AND length(q.q) >= 2
    UNION ALL
    SELECT 'free', NULL, f.anchor_key, f.latest_id, f.name,
      concat_ws(' · ', CASE WHEN f.is_sub_category_survey THEN 'category survey' ELSE 'not in the stock list' END, f.sub_category_name,
                NULLIF(concat_ws(' ', f.brand, f.specification), '')),
      f.unit, f.latest_price, f.sourced_at, f.source, f.vendor_name, f.source_reference,
      f.freshness, f.days_old, f.prices, f.min_price, f.max_price, f.change_vs_previous_pct,
      GREATEST(similarity(lower(f.name), q.q), word_similarity(q.q, lower(f.name)), word_similarity(lower(f.name), q.q))
    FROM v_market_free_text_prices f, q
    WHERE length(q.q) >= 2
  ) x(kind, stock_item_id, anchor_key, price_id, name, detail, unit, latest_price, sourced_at, source, vendor_name,
      source_reference, freshness, days_old, prices, min_price, max_price, change_pct, score)
  WHERE x.score >= 0.35
  -- Equal matches: the more specific name first ("Gypsum board" before "Board").
  ORDER BY round(x.score::numeric, 2) DESC, length(x.name) DESC, x.sourced_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
$$;
REVOKE ALL ON FUNCTION market_price_search(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION market_price_search(text, int) TO authenticated;

-- ── 6. What a proforma line costs us ────────────────────────────────────
CREATE TABLE IF NOT EXISTS proforma_item_costs (
  proforma_item_id uuid PRIMARY KEY REFERENCES proforma_items(id) ON DELETE CASCADE,
  cost_per_unit    numeric NOT NULL CHECK (cost_per_unit >= 0),
  cost_source      text NOT NULL CHECK (cost_source IN ('recipe', 'market', 'manual')),
  market_price_id  uuid REFERENCES market_prices(id) ON DELETE SET NULL,
  stock_item_id    uuid REFERENCES stock_items(id) ON DELETE SET NULL,
  basis_note       text,
  priced_at        timestamptz,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE proforma_item_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proforma_item_costs_cost_roles ON proforma_item_costs;
CREATE POLICY proforma_item_costs_cost_roles ON proforma_item_costs FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));
REVOKE ALL ON proforma_item_costs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON proforma_item_costs TO authenticated;
