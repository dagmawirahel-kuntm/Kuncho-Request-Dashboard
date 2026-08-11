-- ============================================================
-- Lets a vehicle be given real depreciation: `vehicles` keeps its own
-- table for everything operational (energy logs, maintenance, driver
-- assignment, capacity class) — that stays untouched, per the fixed
-- asset register's original "additive only" guardrail. What's new is
-- a nullable link column on `vehicles` pointing at a `fixed_assets`
-- row, so a vehicle CAN optionally get a purchase cost, a
-- depreciation method, and a schedule the same way any other asset
-- does, without the two tables merging.
--
-- category gets a 'vehicle' value so a linked vehicle's fixed_assets
-- row is tagged correctly rather than shoehorned into
-- 'site_equipment'. Default useful life for that category (5 years)
-- is this migration's own call — the original spec never covered
-- vehicles, so there's no useful_life_years figure to inherit from
-- it; 5 years matches the existing site_equipment default and is a
-- reasonable stand-in until Finance says otherwise.
-- ============================================================

SET search_path TO public;

ALTER TABLE fixed_assets DROP CONSTRAINT fixed_assets_category_check;
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_category_check
  CHECK (category IN ('it_equipment', 'office_furniture', 'site_equipment', 'workshop_machinery', 'vehicle'));

ALTER TABLE vehicles ADD COLUMN fixed_asset_id UUID REFERENCES fixed_assets(id) ON DELETE SET NULL;

-- Partial unique index (not a plain UNIQUE constraint) so multiple
-- vehicles can each sit at fixed_asset_id = NULL — a bare UNIQUE
-- would only allow that for one row, since NULL <> NULL doesn't hold
-- everywhere consistently across index types worth relying on here.
CREATE UNIQUE INDEX idx_vehicles_fixed_asset_id ON vehicles(fixed_asset_id) WHERE fixed_asset_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fixed_assets_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT;
  v_seq    TEXT;
  v_next   BIGINT;
BEGIN
  IF NEW.useful_life_years IS NULL THEN
    NEW.useful_life_years := CASE NEW.category
      WHEN 'it_equipment'       THEN 4
      WHEN 'office_furniture'   THEN 10
      WHEN 'site_equipment'     THEN 5
      WHEN 'workshop_machinery' THEN 10
      WHEN 'vehicle'            THEN 5
    END;
  END IF;

  IF NEW.depreciation_start_date IS NULL THEN
    NEW.depreciation_start_date := NEW.purchase_date;
  END IF;

  IF NEW.asset_code IS NULL THEN
    CASE NEW.category
      WHEN 'it_equipment'       THEN v_prefix := 'IT'; v_seq := 'fixed_asset_seq_it';
      WHEN 'office_furniture'   THEN v_prefix := 'FR'; v_seq := 'fixed_asset_seq_fr';
      WHEN 'site_equipment'     THEN v_prefix := 'SE'; v_seq := 'fixed_asset_seq_se';
      WHEN 'workshop_machinery' THEN v_prefix := 'WM'; v_seq := 'fixed_asset_seq_wm';
      WHEN 'vehicle'            THEN v_prefix := 'VH'; v_seq := 'fixed_asset_seq_vh';
    END CASE;
    v_next := nextval(v_seq);
    NEW.asset_code := 'FA-' || v_prefix || '-' || LPAD(v_next::TEXT, 4, '0');
  END IF;

  RETURN NEW;
END;
$$;

CREATE SEQUENCE fixed_asset_seq_vh;

-- Once a vehicle is linked to a fixed_assets row, its real financial
-- data lives there — drop it from the 'vehicle' branch so the
-- unified view (and anything summing it) doesn't double-count.
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
WHERE v.fixed_asset_id IS NULL

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

-- Verify.
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'fixed_assets_category_check';
SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'fixed_asset_id';
