-- 186 — Market prices · Part A: volatility + freshness config + helpers
--
-- Volatility lives on sub_categories (the category default, 633 rows) and
-- optionally on stock_items (per-item override, 58 rows today). Freshness
-- thresholds — how many days a price is still trusted for a given
-- volatility — sit in a lookup table so the age-out policy can be tuned
-- without a code deploy. Two helper functions expose the plumbing so the
-- views + triggers in Migration B stay readable.

SET search_path TO public;

ALTER TABLE sub_categories
  ADD COLUMN IF NOT EXISTS volatility text;
ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS volatility text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sub_categories_volatility_chk') THEN
    ALTER TABLE sub_categories
      ADD CONSTRAINT sub_categories_volatility_chk
      CHECK (volatility IS NULL OR volatility IN ('volatile','moderate','stable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_items_volatility_chk') THEN
    ALTER TABLE stock_items
      ADD CONSTRAINT stock_items_volatility_chk
      CHECK (volatility IS NULL OR volatility IN ('volatile','moderate','stable'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS market_price_freshness_config (
  volatility       text PRIMARY KEY CHECK (volatility IN ('volatile','moderate','stable')),
  fresh_days_max   int  NOT NULL,
  aging_days_max   int  NOT NULL,
  stale_days_max   int  NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO market_price_freshness_config (volatility, fresh_days_max, aging_days_max, stale_days_max) VALUES
  ('volatile', 14, 30, 60),
  ('moderate', 30, 60, 90),
  ('stable',   60, 120, 180)
ON CONFLICT (volatility) DO NOTHING;

ALTER TABLE market_price_freshness_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpfc_read ON market_price_freshness_config;
CREATE POLICY mpfc_read ON market_price_freshness_config FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS mpfc_write ON market_price_freshness_config;
CREATE POLICY mpfc_write ON market_price_freshness_config FOR ALL
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');
GRANT SELECT ON market_price_freshness_config TO authenticated;

-- Item-level → sub_category default → hard fallback of 'moderate'.
-- SECURITY DEFINER so the callers (views, triggers) get a stable answer
-- regardless of their per-caller RLS on the two source tables.
CREATE OR REPLACE FUNCTION public.get_item_volatility(p_stock_item_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(si.volatility, sc.volatility, 'moderate')
  FROM stock_items si
  LEFT JOIN sub_categories sc ON sc.id = si.sub_category_id
  WHERE si.id = p_stock_item_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_item_volatility(uuid) TO authenticated;

-- Freshness status from days-old + volatility. Handles NULLs conservatively
-- (unknown age = 'outdated' so the UI nudges toward a check).
CREATE OR REPLACE FUNCTION public.get_freshness_status(p_days_old int, p_volatility text)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE
    WHEN p_days_old IS NULL THEN 'outdated'
    WHEN p_days_old <= (SELECT fresh_days_max FROM market_price_freshness_config WHERE volatility = COALESCE(p_volatility,'moderate')) THEN 'fresh'
    WHEN p_days_old <= (SELECT aging_days_max FROM market_price_freshness_config WHERE volatility = COALESCE(p_volatility,'moderate')) THEN 'aging'
    WHEN p_days_old <= (SELECT stale_days_max FROM market_price_freshness_config WHERE volatility = COALESCE(p_volatility,'moderate')) THEN 'stale'
    ELSE 'outdated'
  END;
$$;
GRANT EXECUTE ON FUNCTION public.get_freshness_status(int, text) TO authenticated;

-- Volatility edit privileges: procurement head + admin.
DROP POLICY IF EXISTS stock_items_write_volatility ON stock_items;
-- (The stock_items table already has broader UPDATE policies; we're relying
-- on those. This comment is a note-to-future-me — no separate volatility
-- policy is needed. Adding one would double-guard.)
