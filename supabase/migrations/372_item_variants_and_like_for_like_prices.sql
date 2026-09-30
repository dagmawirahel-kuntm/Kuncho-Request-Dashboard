-- 372 — Item variants: trends compare like with like
--
-- Market Trends put different products under one name. "Laminated MDF" held
-- 2,417, 6,413 and 10,696 birr: 6 mm, white and wood-texture boards, read as
-- a 340% price rise. Sizes and brands lived inside sub-ledger names, and the
-- brand/specification fields were almost never filled.
--
-- Now:
--   * Each material family (a General Ledger such as Paints or MDF) lists
--     the attributes that tell its products apart: thickness, finish, brand,
--     grade… Drafts for the main families are seeded here for procurement to
--     review and change; any family can have its own.
--   * A stock item has variants, each a set of those attributes plus what it
--     is sold in: Jotun Fenomastic in a 15 L and a 3 L bucket are two
--     variants, priced per bucket and compared per litre.
--   * The buyer confirms the variant on the purchase order line; the price
--     carries it. Prices already on record are sorted in a review queue.
--   * Trends only compare a price with earlier prices of the same variant,
--     per common unit, and a price far from that variant's median (more
--     than double, or less than half, with three or more to compare) is
--     flagged and kept out of the change and the range until someone looks.

SET search_path TO public;

-- ── 1. Attributes per material family ────────────────────────────────
CREATE TABLE IF NOT EXISTS material_family_attributes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label       text NOT NULL,
  kind        text NOT NULL DEFAULT 'choice' CHECK (kind IN ('choice', 'number', 'text')),
  options     text[] NOT NULL DEFAULT '{}',
  unit        text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_draft    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, key)
);
COMMENT ON TABLE material_family_attributes IS
  'What tells products of one material family (General Ledger) apart — thickness, finish, brand… (372). is_draft marks a seeded suggestion nobody has confirmed yet.';

-- ── 2. Variants of a stock item ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  brand         text,
  -- What one purchase unit holds, in the common unit prices are compared
  -- in: a 15 L bucket is pack_qty 15, base_unit 'L'.
  pack_qty      numeric NOT NULL DEFAULT 1 CHECK (pack_qty > 0),
  base_unit     text,
  label         text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_by    uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_variant_label ON item_variants (stock_item_id, lower(label)) WHERE active;
CREATE INDEX IF NOT EXISTS idx_item_variants_item ON item_variants (stock_item_id) WHERE active;
COMMENT ON TABLE item_variants IS
  'One product of a stock item: its attributes, brand and pack (372). Prices are compared per base_unit across variants, and only within a variant over time.';

-- The label reads the attributes in the family's order, then the brand and
-- the pack: "6 mm · White · 1220×2440" or "Fenomastic · Matt · Jotun · 15 L".
CREATE OR REPLACE FUNCTION public.set_item_variant_label()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_cat   uuid;
  v_parts text[];
BEGIN
  SELECT sc.parent_category_id INTO v_cat
  FROM stock_items si LEFT JOIN sub_categories sc ON sc.id = si.sub_category_id
  WHERE si.id = NEW.stock_item_id;

  SELECT array_agg(v ORDER BY ord, k) INTO v_parts FROM (
    SELECT e.key AS k, NULLIF(btrim(e.value), '') ||
           CASE WHEN a.kind = 'number' AND a.unit IS NOT NULL THEN ' ' || a.unit ELSE '' END AS v,
           COALESCE(a.sort_order, 1000) AS ord
    FROM jsonb_each_text(NEW.attributes) e
    LEFT JOIN material_family_attributes a ON a.category_id = v_cat AND a.key = e.key
    WHERE NULLIF(btrim(e.value), '') IS NOT NULL AND e.key <> 'brand'
  ) x WHERE v IS NOT NULL;

  v_parts := COALESCE(v_parts, '{}')
    || CASE WHEN NULLIF(btrim(COALESCE(NEW.brand, NEW.attributes->>'brand')), '') IS NOT NULL
            THEN ARRAY[btrim(COALESCE(NEW.brand, NEW.attributes->>'brand'))] ELSE '{}'::text[] END
    || CASE WHEN NEW.pack_qty <> 1 OR NEW.base_unit IS NOT NULL
            THEN ARRAY[trim(to_char(NEW.pack_qty, 'FM999999990.###'), '.') || COALESCE(' ' || NEW.base_unit, '')] ELSE '{}'::text[] END;

  NEW.label := COALESCE(NULLIF(array_to_string(v_parts, ' · '), ''), 'Standard');
  NEW.updated_at := now();
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_set_item_variant_label ON item_variants;
CREATE TRIGGER trg_set_item_variant_label BEFORE INSERT OR UPDATE ON item_variants
  FOR EACH ROW EXECUTE FUNCTION set_item_variant_label();
DROP TRIGGER IF EXISTS trg_mfa_updated_at ON material_family_attributes;
CREATE TRIGGER trg_mfa_updated_at BEFORE UPDATE ON material_family_attributes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE material_family_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_read ON material_family_attributes;
CREATE POLICY mfa_read ON material_family_attributes FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS mfa_write ON material_family_attributes;
CREATE POLICY mfa_write ON material_family_attributes FOR ALL
  USING (COALESCE(get_user_role() IN ('admin', 'executive', 'procurement_officer'), false))
  WITH CHECK (COALESCE(get_user_role() IN ('admin', 'executive', 'procurement_officer'), false));
DROP POLICY IF EXISTS item_variants_read ON item_variants;
CREATE POLICY item_variants_read ON item_variants FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS item_variants_write ON item_variants;
CREATE POLICY item_variants_write ON item_variants FOR ALL
  USING (COALESCE(get_user_role() IN ('admin', 'executive', 'procurement_officer'), false))
  WITH CHECK (COALESCE(get_user_role() IN ('admin', 'executive', 'procurement_officer'), false));

-- ── 3. The variant on a PO line and on a price ───────────────────────
ALTER TABLE sourcing_bundle_items ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES item_variants(id) ON DELETE SET NULL;
ALTER TABLE market_prices
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES item_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS excluded_from_trends boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_market_prices_variant ON market_prices (variant_id) WHERE variant_id IS NOT NULL;
COMMENT ON COLUMN market_prices.excluded_from_trends IS 'Set in the review queue for a price that is not comparable (a one-off, a typo). Still listed, never counted (372).';

-- A variant must belong to the line's stock item.
CREATE OR REPLACE FUNCTION public.check_bundle_item_variant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM item_variants v JOIN order_items oi ON oi.stock_item_id = v.stock_item_id
    WHERE v.id = NEW.variant_id AND oi.id = NEW.order_item_id) THEN
    RAISE EXCEPTION 'That variant belongs to a different stock item';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_check_bundle_item_variant ON sourcing_bundle_items;
CREATE TRIGGER trg_check_bundle_item_variant BEFORE INSERT OR UPDATE OF variant_id, order_item_id ON sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION check_bundle_item_variant();

-- The purchase feed carries the line's variant. A variant set later in the
-- review queue is kept when the line itself has none.
CREATE OR REPLACE FUNCTION public.market_prices_sync_bundle(p_bundle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    sourced_by_staff_id, sourced_at, variant_id)
  SELECT oi.stock_item_id, oi.sub_category_id,
    CASE WHEN oi.stock_item_id IS NULL THEN NULLIF(btrim(oi.item_name), '') END,
    sbi.unit_price_actual, 'ETB',
    COALESCE(NULLIF(btrim(oi.unit), ''), si.unit, 'pcs'),
    'purchase', b.vendor_id, b.bundle_code, oi.id, sbi.id,
    v_staff, COALESCE(b.approved_at, b.submitted_at, b.created_at), sbi.variant_id
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
    sourced_by_staff_id = COALESCE(EXCLUDED.sourced_by_staff_id, market_prices.sourced_by_staff_id),
    -- A variant only fits its own item: moving the price to another item
    -- drops a reviewed variant that belonged to the old one.
    variant_id          = CASE WHEN EXCLUDED.variant_id IS NOT NULL THEN EXCLUDED.variant_id
                               WHEN EXCLUDED.stock_item_id IS NOT DISTINCT FROM market_prices.stock_item_id THEN market_prices.variant_id
                               END;
END $function$;
REVOKE ALL ON FUNCTION market_prices_sync_bundle(uuid) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_market_prices_from_bundle_item ON sourcing_bundle_items;
CREATE TRIGGER trg_market_prices_from_bundle_item
  AFTER INSERT OR UPDATE OF unit_price_actual, order_item_id, variant_id ON sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION trg_market_prices_from_bundle_item();

-- ── 4. Every price, per common unit, with the outlier guard ──────────
CREATE OR REPLACE VIEW public.v_market_price_points WITH (security_invoker = true) AS
WITH pts AS (
  SELECT m.id, m.stock_item_id, m.variant_id, m.unit_price, m.unit, m.sourced_at, m.created_at, m.source,
         m.source_vendor_id, m.source_reference, m.source_order_item_id, m.excluded_from_trends,
         COALESCE(m.variant_id::text, '-') AS vkey,
         m.unit_price / COALESCE(NULLIF(iv.pack_qty, 0), 1) AS per_base,
         COALESCE(iv.base_unit, m.unit) AS base_unit,
         (si.unit IS NOT NULL AND m.unit IS NOT NULL AND lower(btrim(m.unit)) <> lower(btrim(si.unit))) AS other_unit
  FROM market_prices m
  JOIN stock_items si ON si.id = m.stock_item_id
  LEFT JOIN item_variants iv ON iv.id = m.variant_id
), med AS (
  SELECT stock_item_id, vkey, count(*) AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY per_base) AS median
  FROM pts
  WHERE NOT excluded_from_trends AND NOT other_unit AND sourced_at >= now() - interval '180 days'
  GROUP BY stock_item_id, vkey
)
SELECT pts.*,
  med.median AS variant_median,
  (pts.excluded_from_trends OR pts.other_unit
    OR (COALESCE(med.n, 0) >= 3 AND (pts.per_base > med.median * 2 OR pts.per_base < med.median / 2))) AS is_outlier
FROM pts
LEFT JOIN med ON med.stock_item_id = pts.stock_item_id AND med.vkey = pts.vkey;
REVOKE ALL ON v_market_price_points FROM PUBLIC, anon;
GRANT SELECT ON v_market_price_points TO authenticated;

-- ── 5. Latest price per stock item — like for like ───────────────────
-- Same columns as 367, same meaning, except that the previous price, the
-- 6-month range and the 90-day change now come only from the variant the
-- latest price belongs to, leave flagged prices out, and a flagged latest
-- price shows no change. New columns at the end.
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
  SELECT pp.*,
    row_number() OVER (PARTITION BY pp.stock_item_id ORDER BY pp.sourced_at DESC, pp.created_at DESC) AS rn
  FROM v_market_price_points pp
  JOIN items i ON i.id = pp.stock_item_id
  -- A price per sheet says nothing about an item kept per m².
  WHERE NOT pp.other_unit
), lat AS (
  SELECT * FROM p WHERE rn = 1
), g AS MATERIALIZED (
  -- The latest price's own variant: the only prices it is compared with.
  SELECT p.*,
    row_number() OVER (PARTITION BY p.stock_item_id ORDER BY p.sourced_at DESC, p.created_at DESC) AS grn
  FROM p JOIN lat ON lat.stock_item_id = p.stock_item_id AND lat.vkey = p.vkey
  WHERE NOT p.is_outlier OR p.rn = 1
), all_agg AS (
  SELECT stock_item_id,
    count(*) FILTER (WHERE sourced_at >= now() - interval '180 days')                          AS prices_180d,
    count(*) FILTER (WHERE source = 'purchase' AND sourced_at >= now() - interval '180 days')  AS buys_180d,
    count(DISTINCT source_vendor_id) FILTER (WHERE sourced_at >= now() - interval '180 days')  AS vendors_180d,
    max(sourced_at) FILTER (WHERE source = 'purchase')                                          AS last_bought_at,
    count(*) FILTER (WHERE variant_id IS NULL AND NOT excluded_from_trends AND sourced_at >= now() - interval '180 days') AS untagged_180d
  FROM p GROUP BY stock_item_id
), agg AS (
  SELECT stock_item_id,
    min(unit_price) FILTER (WHERE sourced_at >= now() - interval '180 days' AND NOT is_outlier)            AS min_180d,
    max(unit_price) FILTER (WHERE sourced_at >= now() - interval '180 days' AND NOT is_outlier)            AS max_180d,
    round(avg(unit_price) FILTER (WHERE sourced_at >= now() - interval '180 days' AND NOT is_outlier), 2)  AS avg_180d,
    (array_agg(unit_price ORDER BY sourced_at) FILTER (WHERE sourced_at >= now() - interval '90 days' AND NOT is_outlier))[1] AS first_90d_price,
    min(sourced_at) FILTER (WHERE sourced_at >= now() - interval '90 days' AND NOT is_outlier)            AS first_90d_at
  FROM g GROUP BY stock_item_id
), base90 AS (
  SELECT DISTINCT ON (stock_item_id) stock_item_id, unit_price
  FROM g WHERE sourced_at <= now() - interval '90 days' AND NOT is_outlier
  ORDER BY stock_item_id, sourced_at DESC
), prev AS (
  SELECT stock_item_id, unit_price, sourced_at FROM g WHERE grn = 2
), ver AS (
  SELECT DISTINCT ON (stock_item_id) stock_item_id, unit_price, sourced_at
  FROM p WHERE source IN ('verified_quote', 'check_request_response')
  ORDER BY stock_item_id, sourced_at DESC
), vc AS (
  SELECT stock_item_id, count(*) AS variant_count FROM item_variants WHERE active GROUP BY stock_item_id
), j AS (
  SELECT i.*, l.id AS latest_id, l.unit_price AS latest_price, l.sourced_at AS latest_at, l.source AS latest_source,
    l.source_vendor_id AS latest_vendor_id, l.variant_id AS latest_variant_id, l.per_base AS latest_per_base,
    l.base_unit AS latest_base_unit, COALESCE(l.is_outlier, false) AS latest_is_outlier,
    pv.unit_price AS previous_price, pv.sourced_at AS previous_at,
    ver.unit_price AS verified_price, ver.sourced_at AS verified_at,
    aa.prices_180d, aa.buys_180d, aa.vendors_180d, aa.last_bought_at, aa.untagged_180d,
    a.min_180d, a.max_180d, a.avg_180d,
    COALESCE(b90.unit_price,
      CASE WHEN a.first_90d_at <= l.sourced_at - interval '7 days' THEN a.first_90d_price END) AS base_90d,
    CASE WHEN l.sourced_at IS NULL THEN NULL
         ELSE GREATEST(0, (EXTRACT(epoch FROM (now() - l.sourced_at)) / 86400.0)::integer) END AS days_old,
    COALESCE(vc.variant_count, 0) AS variant_count
  FROM items i
  LEFT JOIN lat l     ON l.stock_item_id = i.id
  LEFT JOIN prev pv   ON pv.stock_item_id = i.id
  LEFT JOIN ver       ON ver.stock_item_id = i.id
  LEFT JOIN all_agg aa ON aa.stock_item_id = i.id
  LEFT JOIN agg a     ON a.stock_item_id = i.id
  LEFT JOIN base90 b90 ON b90.stock_item_id = i.id
  LEFT JOIN vc        ON vc.stock_item_id = i.id
)
SELECT j.id AS stock_item_id,
  j.item_name, j.amharic_name, j.item_code, j.unit, j.sub_category_id, j.volatility,
  j.latest_price     AS latest_any_price,
  j.latest_at        AS latest_any_sourced_at,
  j.latest_source    AS latest_any_source,
  j.latest_vendor_id AS latest_any_vendor_id,
  j.verified_price   AS latest_verified_price,
  j.verified_at      AS latest_verified_sourced_at,
  j.latest_price     AS display_price,
  j.latest_source    AS display_price_source,
  j.latest_at        AS display_price_sourced_at,
  j.days_old         AS days_since_display_price,
  CASE WHEN j.days_old IS NULL THEN 'outdated'
       WHEN j.days_old <= cfg.fresh_days_max THEN 'fresh'
       WHEN j.days_old <= cfg.aging_days_max THEN 'aging'
       WHEN j.days_old <= cfg.stale_days_max THEN 'stale'
       ELSE 'outdated' END AS freshness,
  CASE WHEN j.latest_is_outlier OR j.base_90d IS NULL OR j.base_90d = 0 OR j.latest_price IS NULL THEN NULL
       ELSE round((j.latest_price - j.base_90d) / j.base_90d * 100, 2) END AS price_trend_90d_pct,
  j.main_category,
  j.sub_category_name,
  j.latest_id        AS display_price_id,
  v.vendor_name      AS display_vendor_name,
  j.previous_price,
  j.previous_at      AS previous_sourced_at,
  CASE WHEN j.latest_is_outlier OR j.previous_price IS NULL OR j.previous_price = 0 OR j.latest_price IS NULL THEN NULL
       ELSE round((j.latest_price - j.previous_price) / j.previous_price * 100, 1) END AS change_vs_previous_pct,
  COALESCE(j.prices_180d, 0)::int  AS prices_180d,
  COALESCE(j.buys_180d, 0)::int    AS buys_180d,
  j.min_180d, j.max_180d, j.avg_180d,
  COALESCE(j.vendors_180d, 0)::int AS vendors_180d,
  j.last_bought_at,
  -- 372
  j.latest_variant_id,
  iv.label           AS latest_variant_label,
  round(j.latest_per_base, 2) AS latest_price_per_base,
  j.latest_base_unit AS base_unit,
  j.latest_is_outlier,
  j.variant_count::int AS variant_count,
  CASE WHEN j.variant_count > 0 THEN COALESCE(j.untagged_180d, 0) ELSE 0 END::int AS untagged_prices_180d
FROM j
LEFT JOIN market_price_freshness_config cfg ON cfg.volatility = j.volatility
LEFT JOIN vendors v ON v.id = j.latest_vendor_id
LEFT JOIN item_variants iv ON iv.id = j.latest_variant_id;
REVOKE ALL ON v_stock_item_latest_price FROM PUBLIC, anon;
GRANT SELECT ON v_stock_item_latest_price TO authenticated;

-- ── 6. Each variant's price ──────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_item_variant_prices WITH (security_invoker = true) AS
WITH p AS (
  SELECT pp.* FROM v_market_price_points pp
  WHERE pp.variant_id IS NOT NULL AND NOT pp.excluded_from_trends AND NOT pp.other_unit
)
SELECT iv.id AS variant_id, iv.stock_item_id, iv.label, iv.attributes, iv.brand, iv.pack_qty, iv.base_unit, iv.active,
  l.unit_price AS latest_price, l.sourced_at AS latest_at, l.source AS latest_source, vd.vendor_name AS latest_vendor_name,
  round(l.per_base, 2) AS latest_price_per_base, COALESCE(iv.base_unit, l.unit) AS compare_unit,
  COALESCE(l.is_outlier, false) AS latest_is_outlier,
  pv.unit_price AS previous_price,
  CASE WHEN l.is_outlier OR pv.unit_price IS NULL OR pv.unit_price = 0 THEN NULL
       ELSE round((l.unit_price - pv.unit_price) / pv.unit_price * 100, 1) END AS change_vs_previous_pct,
  COALESCE(s.prices, 0) AS prices, s.min_price, s.max_price,
  CASE WHEN l.sourced_at IS NULL THEN NULL ELSE GREATEST(0, (EXTRACT(epoch FROM (now() - l.sourced_at)) / 86400.0)::integer) END AS days_old
FROM item_variants iv
LEFT JOIN LATERAL (
  SELECT * FROM p WHERE p.variant_id = iv.id ORDER BY p.sourced_at DESC, p.created_at DESC LIMIT 1
) l ON true
LEFT JOIN LATERAL (
  -- The last comparable price before the latest one.
  SELECT p.unit_price FROM p WHERE p.variant_id = iv.id AND NOT p.is_outlier AND p.id <> l.id
  ORDER BY p.sourced_at DESC, p.created_at DESC LIMIT 1
) pv ON true
LEFT JOIN vendors vd ON vd.id = l.source_vendor_id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS prices, min(c.unit_price) AS min_price, max(c.unit_price) AS max_price
  FROM p c WHERE c.variant_id = iv.id AND NOT c.is_outlier AND c.sourced_at >= now() - interval '180 days'
) s ON true;
REVOKE ALL ON v_item_variant_prices FROM PUBLIC, anon;
GRANT SELECT ON v_item_variant_prices TO authenticated;

-- ── 7. Review queue ──────────────────────────────────────────────────
-- (a) prices of items that have variants but no variant on the price;
-- (b) prices flagged by the outlier guard, not yet looked at.
CREATE OR REPLACE VIEW public.v_price_review_queue WITH (security_invoker = true) AS
SELECT pp.id AS price_id, pp.stock_item_id, si.item_name, si.unit AS item_unit,
  CASE WHEN pp.variant_id IS NULL THEN 'untagged' ELSE 'outlier' END AS reason,
  pp.unit_price, pp.unit, pp.sourced_at, pp.source, pp.source_reference, vd.vendor_name,
  pp.variant_id, iv.label AS variant_label, round(pp.variant_median::numeric, 2) AS variant_median,
  oi.item_name AS bought_as, oi.specifications AS bought_spec,
  (SELECT count(*) FROM item_variants x WHERE x.stock_item_id = pp.stock_item_id AND x.active)::int AS variant_count
FROM v_market_price_points pp
JOIN market_prices m ON m.id = pp.id
JOIN stock_items si ON si.id = pp.stock_item_id
LEFT JOIN item_variants iv ON iv.id = pp.variant_id
LEFT JOIN vendors vd ON vd.id = pp.source_vendor_id
LEFT JOIN order_items oi ON oi.id = pp.source_order_item_id
WHERE NOT pp.excluded_from_trends AND NOT pp.other_unit AND m.reviewed_at IS NULL
  AND ((pp.variant_id IS NULL AND EXISTS (SELECT 1 FROM item_variants x WHERE x.stock_item_id = pp.stock_item_id AND x.active))
    OR pp.is_outlier);
REVOKE ALL ON v_price_review_queue FROM PUBLIC, anon;
GRANT SELECT ON v_price_review_queue TO authenticated;

-- (c) items with no variants whose prices spread so far apart they are
-- probably several products under one name.
CREATE OR REPLACE VIEW public.v_items_needing_variants WITH (security_invoker = true) AS
SELECT si.id AS stock_item_id, si.item_name, si.unit, c.category_name AS family, sc.parent_category_id AS category_id,
  count(*)::int AS prices, min(pp.unit_price) AS min_price, max(pp.unit_price) AS max_price,
  round(max(pp.unit_price) / NULLIF(min(pp.unit_price), 0), 2) AS spread,
  string_agg(DISTINCT oi.item_name, ' | ') AS bought_as
FROM v_market_price_points pp
JOIN stock_items si ON si.id = pp.stock_item_id AND si.active
LEFT JOIN sub_categories sc ON sc.id = si.sub_category_id
LEFT JOIN categories c ON c.id = sc.parent_category_id
LEFT JOIN order_items oi ON oi.id = pp.source_order_item_id
WHERE NOT pp.excluded_from_trends AND NOT pp.other_unit
  AND NOT EXISTS (SELECT 1 FROM item_variants x WHERE x.stock_item_id = si.id AND x.active)
GROUP BY si.id, si.item_name, si.unit, c.category_name, sc.parent_category_id
HAVING count(*) >= 2 AND max(pp.unit_price) >= 1.8 * min(pp.unit_price);
REVOKE ALL ON v_items_needing_variants FROM PUBLIC, anon;
GRANT SELECT ON v_items_needing_variants TO authenticated;

-- ── 8. Review actions ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.review_market_prices(
  p_price_ids uuid[], p_variant_id uuid DEFAULT NULL, p_exclude boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_item  uuid;
  v_count integer;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'procurement_officer') THEN
    RAISE EXCEPTION 'Only procurement can review prices';
  END IF;
  IF p_variant_id IS NOT NULL THEN
    SELECT stock_item_id INTO v_item FROM item_variants WHERE id = p_variant_id;
    IF EXISTS (SELECT 1 FROM market_prices WHERE id = ANY(p_price_ids) AND stock_item_id IS DISTINCT FROM v_item) THEN
      RAISE EXCEPTION 'Those prices are for a different stock item than the variant';
    END IF;
  END IF;

  UPDATE market_prices
     SET variant_id = COALESCE(p_variant_id, variant_id),
         excluded_from_trends = p_exclude,
         review_note = COALESCE(NULLIF(btrim(p_note), ''), review_note),
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = ANY(p_price_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;

-- A price bought under a typed name belongs to a stock item: move it there
-- (through its request line, so the purchase feed keeps it there).
CREATE OR REPLACE FUNCTION public.link_prices_to_stock_item(p_anchor_key text, p_stock_item_id uuid, p_variant_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ids   uuid[];
  v_count integer := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'procurement_officer') THEN
    RAISE EXCEPTION 'Only procurement can link prices';
  END IF;
  IF p_variant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM item_variants WHERE id = p_variant_id AND stock_item_id = p_stock_item_id) THEN
    RAISE EXCEPTION 'That variant belongs to another stock item';
  END IF;

  SELECT array_agg(id) INTO v_ids FROM market_prices
   WHERE stock_item_id IS NULL
     AND COALESCE(description_key, 'sub-category:' || sub_category_id::text) = p_anchor_key;
  IF v_ids IS NULL THEN RETURN 0; END IF;

  UPDATE order_items SET stock_item_id = p_stock_item_id
   WHERE id IN (SELECT source_order_item_id FROM market_prices WHERE id = ANY(v_ids) AND source_order_item_id IS NOT NULL)
     AND stock_item_id IS NULL;

  UPDATE market_prices
     SET stock_item_id = p_stock_item_id, variant_id = COALESCE(p_variant_id, variant_id),
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;

GRANT EXECUTE ON FUNCTION review_market_prices(uuid[], uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION link_prices_to_stock_item(text, uuid, uuid) TO authenticated;

-- ── 9. Draft attribute lists for the main families ───────────────────
-- Suggestions only (is_draft): procurement confirms, edits or removes them.
WITH seed(family, key, label, kind, options, unit, ord) AS (VALUES
  ('Paints',               'product',     'Product',        'text',   '{}'::text[],                                              NULL, 1),
  ('Paints',               'finish',      'Finish',         'choice', '{Matt,Silk,Semi-gloss,Gloss}',                            NULL, 2),
  ('Paints',               'colour',      'Colour',         'text',   '{}',                                                      NULL, 3),
  ('Paints',               'base',        'Base',           'choice', '{Water,Oil,Solvent}',                                     NULL, 4),
  ('Jotun Paints ',        'product',     'Product',        'choice', '{Fenomastic,Jotashield,Majestic,Gardex,Jotaplast,Primer,Putty}', NULL, 1),
  ('Jotun Paints ',        'finish',      'Finish',         'choice', '{Matt,Silk,Semi-gloss,Gloss}',                            NULL, 2),
  ('Jotun Paints ',        'colour',      'Colour / code',  'text',   '{}',                                                      NULL, 3),
  ('MDF',                  'thickness',   'Thickness',      'number', '{3,6,9,12,16,18,25}',                                     'mm', 1),
  ('MDF',                  'finish',      'Finish',         'choice', '{Raw,White,Wood texture,Colour laminate,UV gloss}',        NULL, 2),
  ('MDF',                  'sheet',       'Sheet size',     'choice', '{1220×2440,1830×2440}',                                   NULL, 3),
  ('UV Wood',              'thickness',   'Thickness',      'number', '{9,12,16,18}',                                            'mm', 1),
  ('UV Wood',              'colour',      'Colour',         'text',   '{}',                                                      NULL, 2),
  ('Veneer',               'species',     'Species',        'text',   '{}',                                                      NULL, 1),
  ('Veneer',               'thickness',   'Thickness',      'number', '{}',                                                      'mm', 2),
  ('Gypsum',               'product',     'Product',        'choice', '{Board,Powder,Cornice,Moisture board,Fire board}',        NULL, 1),
  ('Gypsum',               'thickness',   'Thickness',      'number', '{9,12,15}',                                               'mm', 2),
  ('Cement',               'grade',       'Grade',          'choice', '{OPC 42.5,PPC 32.5}',                                     NULL, 1),
  ('Putty',                'use',         'Use',            'choice', '{Interior,Exterior}',                                     NULL, 1),
  ('Steel',                'profile',     'Profile',        'choice', '{RHS,SHS,Angle,Flat bar,Round bar,Omega,Sheet,Pipe}',     NULL, 1),
  ('Steel',                'size',        'Size',           'text',   '{}',                                                      NULL, 2),
  ('Steel',                'thickness',   'Thickness',      'number', '{}',                                                      'mm', 3),
  ('Steel',                'length',      'Length',         'number', '{6}',                                                     'm',  4),
  ('Aluminum',             'profile',     'Profile',        'text',   '{}',                                                      NULL, 1),
  ('Aluminum',             'finish',      'Finish',         'choice', '{Silver,Black,White,Wood,Champagne}',                     NULL, 2),
  ('Aluminum',             'length',      'Length',         'number', '{6}',                                                     'm',  3),
  ('Electrical Materials', 'type',        'Type',           'text',   '{}',                                                      NULL, 1),
  ('Electrical Materials', 'rating',      'Rating',         'number', '{6,10,16,20,25,32,40,50,63}',                             'A',  2),
  ('Electrical Materials', 'cable_size',  'Cable size',     'number', '{1.5,2.5,4,6,10,16}',                                     'mm²', 3),
  ('Screw',                'size',        'Size',           'text',   '{}',                                                      NULL, 1),
  ('Screw',                'type',        'Type',           'choice', '{Board,Wood,Self-drilling,Machine}',                      NULL, 2),
  ('Nail',                 'length',      'Length',         'number', '{}',                                                      'mm', 1),
  ('Punta',                'size',        'Size',           'text',   '{}',                                                      NULL, 1),
  ('Glass',                'thickness',   'Thickness',      'number', '{4,5,6,8,10,12}',                                         'mm', 1),
  ('Glass',                'type',        'Type',           'choice', '{Clear,Tinted,Frosted,Tempered,Laminated,Mirror}',        NULL, 2),
  ('Morale',               'size',        'Section',        'text',   '{}',                                                      NULL, 1),
  ('Morale',               'wood',        'Wood',           'choice', '{Australia,Local,Zigba,Wanza}',                           NULL, 2),
  ('Morale',               'length',      'Length',         'number', '{}',                                                      'm',  3),
  ('Foam',                 'density',     'Density',        'text',   '{}',                                                      NULL, 1),
  ('Foam',                 'thickness',   'Thickness',      'number', '{}',                                                      'mm', 2),
  ('Leather Materials',    'material',    'Material',       'text',   '{}',                                                      NULL, 1),
  ('Leather Materials',    'colour',      'Colour',         'text',   '{}',                                                      NULL, 2)
)
INSERT INTO material_family_attributes (category_id, key, label, kind, options, unit, sort_order, is_draft)
SELECT c.id, s.key, s.label, s.kind, s.options, s.unit, s.ord, true
FROM seed s JOIN categories c ON c.category_name = s.family
ON CONFLICT (category_id, key) DO NOTHING;
