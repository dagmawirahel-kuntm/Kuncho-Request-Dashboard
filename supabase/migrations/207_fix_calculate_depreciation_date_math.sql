-- ============================================================
-- Fix migration 205: `date - date` in Postgres is already an integer
-- day count, not an interval — EXTRACT(EPOCH FROM ...) on it throws
-- "function pg_catalog.extract(unknown, integer) does not exist".
-- Caught by an actual test insert against the live function, not by
-- hand-checking the math on paper.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION calculate_depreciation(p_fixed_asset_id UUID, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  original_cost               NUMERIC,
  salvage_value                NUMERIC,
  useful_life_years            INT,
  depreciation_method          TEXT,
  years_elapsed                NUMERIC,
  accumulated_depreciation     NUMERIC,
  current_book_value           NUMERIC,
  remaining_useful_life_years  NUMERIC,
  annual_depreciation_this_year NUMERIC,
  monthly_depreciation         NUMERIC
) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_asset fixed_assets%ROWTYPE;
  v_years_elapsed NUMERIC;
  v_full_years    INT;
  v_frac          NUMERIC;
  v_accum         NUMERIC := 0;
  v_annual_this_year NUMERIC := 0;
  v_book          NUMERIC;
  v_book_start_of_year NUMERIC;
  v_dep           NUMERIC;
  v_syd_sum       NUMERIC;
  v_digit         NUMERIC;
  v_current_year_num INT;
  v_units         NUMERIC;
  v_units_trailing_year NUMERIC;
  v_rate_per_unit NUMERIC;
  i               INT;
BEGIN
  SELECT * INTO v_asset FROM fixed_assets WHERE id = p_fixed_asset_id;
  IF v_asset.id IS NULL THEN
    RETURN;
  END IF;

  v_years_elapsed := LEAST(
    GREATEST((p_as_of - v_asset.depreciation_start_date)::numeric / 365.25, 0),
    v_asset.useful_life_years
  );
  v_full_years := FLOOR(v_years_elapsed)::INT;
  v_frac := v_years_elapsed - v_full_years;

  IF v_asset.depreciation_method = 'straight_line' THEN
    v_annual_this_year := (v_asset.purchase_cost_etb - v_asset.salvage_value_etb) / v_asset.useful_life_years;
    v_accum := v_annual_this_year * v_years_elapsed;

  ELSIF v_asset.depreciation_method = 'declining_balance' THEN
    v_book := v_asset.purchase_cost_etb;
    FOR i IN 1..v_full_years LOOP
      v_dep := LEAST(v_book * v_asset.declining_balance_rate, v_book - v_asset.salvage_value_etb);
      v_dep := GREATEST(v_dep, 0);
      v_accum := v_accum + v_dep;
      v_book := v_book - v_dep;
    END LOOP;
    v_book_start_of_year := v_book;
    v_annual_this_year := GREATEST(LEAST(v_book_start_of_year * v_asset.declining_balance_rate, v_book_start_of_year - v_asset.salvage_value_etb), 0);
    v_accum := v_accum + v_annual_this_year * v_frac;

  ELSIF v_asset.depreciation_method = 'units_of_production' THEN
    SELECT COALESCE(SUM(units_produced), 0) INTO v_units
    FROM fixed_asset_usage_log WHERE fixed_asset_id = p_fixed_asset_id AND period_end_date <= p_as_of;
    v_rate_per_unit := (v_asset.purchase_cost_etb - v_asset.salvage_value_etb) / v_asset.total_expected_units;
    v_accum := LEAST(v_units * v_rate_per_unit, v_asset.purchase_cost_etb - v_asset.salvage_value_etb);
    SELECT COALESCE(SUM(units_produced), 0) INTO v_units_trailing_year
    FROM fixed_asset_usage_log
    WHERE fixed_asset_id = p_fixed_asset_id AND period_end_date <= p_as_of AND period_end_date > (p_as_of - INTERVAL '1 year');
    v_annual_this_year := v_units_trailing_year * v_rate_per_unit;

  ELSIF v_asset.depreciation_method = 'sum_of_years' THEN
    v_syd_sum := v_asset.useful_life_years * (v_asset.useful_life_years + 1) / 2.0;
    FOR i IN 1..v_full_years LOOP
      v_digit := v_asset.useful_life_years - i + 1;
      v_dep := (v_asset.purchase_cost_etb - v_asset.salvage_value_etb) * v_digit / v_syd_sum;
      v_accum := v_accum + v_dep;
    END LOOP;
    v_current_year_num := LEAST(v_full_years + 1, v_asset.useful_life_years);
    v_digit := GREATEST(v_asset.useful_life_years - v_current_year_num + 1, 0);
    v_annual_this_year := (v_asset.purchase_cost_etb - v_asset.salvage_value_etb) * v_digit / v_syd_sum;
    v_accum := v_accum + v_annual_this_year * v_frac;
  END IF;

  v_accum := LEAST(GREATEST(v_accum, 0), v_asset.purchase_cost_etb - v_asset.salvage_value_etb);

  RETURN QUERY SELECT
    v_asset.purchase_cost_etb,
    v_asset.salvage_value_etb,
    v_asset.useful_life_years,
    v_asset.depreciation_method,
    v_years_elapsed,
    v_accum,
    GREATEST(v_asset.purchase_cost_etb - v_accum, v_asset.salvage_value_etb),
    GREATEST(v_asset.useful_life_years - v_years_elapsed, 0),
    v_annual_this_year,
    v_annual_this_year / 12;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_depreciation(UUID, DATE) TO authenticated;
