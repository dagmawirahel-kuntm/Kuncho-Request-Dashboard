-- ============================================================
-- Depreciation is computed on read, never posted to the ledger and
-- never stored as a column that could drift from the inputs it's
-- derived from (guardrail — no ledger entries, no cached book value).
-- Every number here is re-derived from purchase_cost_etb, the method,
-- and (for units_of_production) fixed_asset_usage_log on every call.
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

  -- date - date in Postgres already yields an integer day count, not an
  -- interval, so this is a plain numeric division — no EXTRACT/EPOCH.
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
    -- Usage-driven, not calendar-driven — approximate "this year's charge"
    -- from units logged in the trailing 12 months, for display purposes only.
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

-- ── Year-by-year projection, reusing calculate_depreciation at each
-- anniversary rather than re-deriving the per-method math a second
-- time (one call per year of useful life — cheap, typically 4-10).
CREATE OR REPLACE FUNCTION depreciation_schedule(p_fixed_asset_id UUID)
RETURNS TABLE (
  year_number             INT,
  year_end_date            DATE,
  yearly_depreciation      NUMERIC,
  cumulative_depreciation  NUMERIC,
  book_value               NUMERIC
) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_start DATE;
  v_life  INT;
  v_prev_accum NUMERIC := 0;
  v_row   RECORD;
  v_end   DATE;
  i       INT;
BEGIN
  SELECT depreciation_start_date, useful_life_years INTO v_start, v_life FROM fixed_assets WHERE id = p_fixed_asset_id;
  IF v_start IS NULL THEN
    RETURN;
  END IF;

  FOR i IN 1..v_life LOOP
    v_end := (v_start + (i || ' years')::INTERVAL)::DATE;
    SELECT * INTO v_row FROM calculate_depreciation(p_fixed_asset_id, v_end);
    year_number := i;
    year_end_date := v_end;
    cumulative_depreciation := v_row.accumulated_depreciation;
    yearly_depreciation := v_row.accumulated_depreciation - v_prev_accum;
    book_value := v_row.current_book_value;
    v_prev_accum := v_row.accumulated_depreciation;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION depreciation_schedule(UUID) TO authenticated;

-- ── Register view: one row per active asset + its computed depreciation ─
CREATE OR REPLACE VIEW v_fixed_asset_current
WITH (security_invoker = true) AS
SELECT
  fa.*,
  d.years_elapsed,
  d.accumulated_depreciation,
  d.current_book_value,
  d.remaining_useful_life_years,
  d.annual_depreciation_this_year,
  d.monthly_depreciation
FROM fixed_assets fa
CROSS JOIN LATERAL calculate_depreciation(fa.id, CURRENT_DATE) d
WHERE fa.is_active;

-- ── Org-wide roll-up ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_fixed_asset_register_summary
WITH (security_invoker = true) AS
WITH active AS (
  SELECT * FROM v_fixed_asset_current
),
by_category AS (
  SELECT category,
    COUNT(*) AS assets_count,
    SUM(purchase_cost_etb) AS original_cost,
    SUM(accumulated_depreciation) AS accumulated_depreciation,
    SUM(current_book_value) AS current_book_value
  FROM active
  GROUP BY category
),
disposed_this_fy AS (
  SELECT COUNT(*) AS count, COALESCE(SUM(disposal_value_etb), 0) AS value
  FROM fixed_assets fa
  JOIN fiscal_periods fp ON fp.is_current
  WHERE NOT fa.is_active AND fa.disposal_date IS NOT NULL
    AND fiscal_period_for_date(fa.disposal_date) = fp.id
)
SELECT
  (SELECT COUNT(*) FROM active) AS total_assets_count,
  (SELECT COALESCE(SUM(purchase_cost_etb), 0) FROM active) AS total_original_cost,
  (SELECT COALESCE(SUM(accumulated_depreciation), 0) FROM active) AS total_accumulated_depreciation,
  (SELECT COALESCE(SUM(current_book_value), 0) FROM active) AS total_current_book_value,
  (SELECT COALESCE(jsonb_agg(by_category), '[]'::jsonb) FROM by_category) AS by_category,
  (SELECT COUNT(*) FROM active WHERE last_verified_at IS NULL OR last_verified_at < (CURRENT_DATE - INTERVAL '90 days')) AS assets_due_for_verification,
  (SELECT count FROM disposed_this_fy) AS assets_disposed_this_fy_count,
  (SELECT value FROM disposed_this_fy) AS assets_disposed_this_fy_value;

-- ── Unified asset base: fixed_assets + vehicles + tool_units ────────
CREATE OR REPLACE VIEW v_asset_base_unified
WITH (security_invoker = true) AS
SELECT
  'fixed'::TEXT AS asset_source,
  fa.id,
  fa.asset_name AS name,
  fa.category,
  fa.purchase_cost_etb AS original_cost,
  d.current_book_value,
  fa.condition,
  s.employee_name AS custodian,
  l.location_name AS location,
  fa.is_active
FROM fixed_assets fa
CROSS JOIN LATERAL calculate_depreciation(fa.id, CURRENT_DATE) d
LEFT JOIN staff s ON s.id = fa.custodian_staff_id
LEFT JOIN locations l ON l.id = fa.location_id

UNION ALL

SELECT
  'vehicle'::TEXT AS asset_source,
  v.id,
  v.name,
  'vehicle'::TEXT AS category,
  NULL::NUMERIC AS original_cost,
  NULL::NUMERIC AS current_book_value,
  v.status::TEXT AS condition,
  s.employee_name AS custodian,
  NULL::TEXT AS location,
  v.active AS is_active
FROM vehicles v
LEFT JOIN staff s ON s.id = v.assigned_driver_id

UNION ALL

SELECT
  'tool'::TEXT AS asset_source,
  tu.id,
  si.item_name AS name,
  'tool'::TEXT AS category,
  NULL::NUMERIC AS original_cost,
  NULL::NUMERIC AS current_book_value,
  tu.condition::TEXT AS condition,
  s.employee_name AS custodian,
  NULL::TEXT AS location,
  tu.active AS is_active
FROM tool_units tu
LEFT JOIN stock_items si ON si.id = tu.stock_item_id
LEFT JOIN staff s ON s.id = tu.current_holder_id;

-- Verify: functions + views present.
SELECT proname FROM pg_proc WHERE proname IN ('calculate_depreciation', 'depreciation_schedule');
SELECT viewname FROM pg_views WHERE viewname IN ('v_fixed_asset_current', 'v_fixed_asset_register_summary', 'v_asset_base_unified');
