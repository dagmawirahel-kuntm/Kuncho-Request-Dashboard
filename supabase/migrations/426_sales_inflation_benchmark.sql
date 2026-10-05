-- Inflation to collection: what today's price is worth when the money comes in.
--
-- A proforma is priced at today's costs, but the money arrives over the
-- project: an advance at signing, progress payments over the months of the
-- work, the final payment after handover. With prices rising, every birr
-- collected later buys less, and the materials still to be bought cost more.
-- This sets a benchmark for that and records, per proforma, the collection
-- timing it was priced for and the allowance it carries.
--
--   sales_inflation_settings   the benchmark: a yearly rate for materials and
--                              one for everything else (labour, services),
--                              the default materials share, project length
--                              and how long after handover the final payment
--                              comes. Admin, executive and finance set it.
--   sales_inflation_observed() evidence from our own purchases: for each item
--                              bought at least twice, 30+ days apart, its
--                              yearly price change; the median and spread.
--                              Shown beside the benchmark, never applied on
--                              its own: until there is a year of history it
--                              is a hint, not a rate.
--   proformas.collect_*        the timing a proforma was priced for, the rate
--                              used and the allowance (%), and how it was
--                              applied: not at all, spread into the unit
--                              prices, or as its own line.
--
-- The arithmetic lives in src/lib/inflation.ts so the editor can show it
-- live; the database only stores the inputs and the result.

CREATE TABLE IF NOT EXISTS sales_inflation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  materials_rate numeric NOT NULL DEFAULT 0.18 CHECK (materials_rate BETWEEN -0.5 AND 3),
  general_rate numeric NOT NULL DEFAULT 0.13 CHECK (general_rate BETWEEN -0.5 AND 3),
  default_materials_share numeric NOT NULL DEFAULT 0.6 CHECK (default_materials_share BETWEEN 0 AND 1),
  default_months numeric NOT NULL DEFAULT 4 CHECK (default_months BETWEEN 0 AND 60),
  default_final_lag_months numeric NOT NULL DEFAULT 1 CHECK (default_final_lag_months BETWEEN 0 AND 24),
  rate_note text DEFAULT 'Set from the latest CPI release and what suppliers are quoting; review monthly.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES user_profiles(id)
);
INSERT INTO sales_inflation_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE sales_inflation_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_inflation_settings' AND policyname = 'sis_read') THEN
    CREATE POLICY sis_read ON sales_inflation_settings FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
GRANT SELECT ON sales_inflation_settings TO authenticated;

CREATE OR REPLACE FUNCTION sales_inflation_save(
  p_materials_rate numeric, p_general_rate numeric, p_default_materials_share numeric,
  p_default_months numeric, p_default_final_lag_months numeric, p_rate_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can set the inflation benchmark';
  END IF;
  UPDATE sales_inflation_settings SET
    materials_rate = COALESCE(p_materials_rate, materials_rate),
    general_rate = COALESCE(p_general_rate, general_rate),
    default_materials_share = COALESCE(p_default_materials_share, default_materials_share),
    default_months = COALESCE(p_default_months, default_months),
    default_final_lag_months = COALESCE(p_default_final_lag_months, default_final_lag_months),
    rate_note = COALESCE(p_rate_note, rate_note),
    updated_at = now(), updated_by = auth.uid()
  WHERE id;
END $$;
GRANT EXECUTE ON FUNCTION sales_inflation_save(numeric, numeric, numeric, numeric, numeric, text) TO authenticated;

-- Our own purchase prices: how fast are they moving?
CREATE OR REPLACE FUNCTION sales_inflation_observed()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH p AS (
    SELECT COALESCE(stock_item_id::text, description_key) AS k, lower(COALESCE(unit, '')) AS u,
           unit_price, sourced_at
    FROM market_prices
    WHERE NOT COALESCE(excluded_from_trends, false) AND unit_price > 0
      AND sourced_at > now() - interval '365 days'
      AND COALESCE(stock_item_id::text, description_key) IS NOT NULL
  ),
  ends AS (
    SELECT k, u,
           (array_agg(unit_price ORDER BY sourced_at))[1] AS first_price,
           (array_agg(unit_price ORDER BY sourced_at DESC))[1] AS last_price,
           min(sourced_at) AS first_at, max(sourced_at) AS last_at, count(*) AS n
    FROM p GROUP BY k, u
  ),
  rates AS (
    SELECT k, extract(epoch FROM last_at - first_at) / 86400 AS days,
           power(last_price / first_price, 365.0 / (extract(epoch FROM last_at - first_at) / 86400)) - 1 AS yearly
    FROM ends
    WHERE n >= 2 AND last_at - first_at >= interval '30 days'
  ),
  sane AS (SELECT * FROM rates WHERE yearly BETWEEN -0.9 AND 3)
  SELECT jsonb_build_object(
    'items', (SELECT count(*) FROM sane),
    'median', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY yearly) FROM sane),
    'p25', (SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY yearly) FROM sane),
    'p75', (SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY yearly) FROM sane),
    'rising', (SELECT count(*) FROM sane WHERE yearly > 0.02),
    'falling', (SELECT count(*) FROM sane WHERE yearly < -0.02),
    'avg_days', (SELECT round(avg(days)) FROM sane),
    'history_days', (SELECT extract(day FROM max(sourced_at) - min(sourced_at))::int FROM p),
    'prices', (SELECT count(*) FROM p)
  ) $$;
GRANT EXECUTE ON FUNCTION sales_inflation_observed() TO authenticated;

-- What each proforma was priced for.
ALTER TABLE proformas
  ADD COLUMN IF NOT EXISTS collect_months numeric CHECK (collect_months IS NULL OR collect_months BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS collect_advance_pct numeric CHECK (collect_advance_pct IS NULL OR collect_advance_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS collect_final_pct numeric CHECK (collect_final_pct IS NULL OR collect_final_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS collect_final_lag_months numeric CHECK (collect_final_lag_months IS NULL OR collect_final_lag_months BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS inflation_rate numeric,
  ADD COLUMN IF NOT EXISTS inflation_allowance_pct numeric,
  ADD COLUMN IF NOT EXISTS inflation_applied text CHECK (inflation_applied IS NULL OR inflation_applied IN ('none', 'spread', 'line'));
COMMENT ON COLUMN proformas.collect_months IS 'Months of work the price assumes; progress payments spread over them (migration 426).';
COMMENT ON COLUMN proformas.inflation_rate IS 'Yearly rate used: materials and other rates blended by the materials share.';
COMMENT ON COLUMN proformas.inflation_allowance_pct IS 'Uplift that keeps the collections worth today''s price, in percent.';
