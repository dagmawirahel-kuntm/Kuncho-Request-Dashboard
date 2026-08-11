-- ============================================================
-- Fixed asset register: IT equipment, office furniture, site
-- equipment, and workshop machinery. Vehicles (`vehicles`) and tools
-- (`tool_units`) already have their own specialized lifecycle tables
-- and stay untouched — this is additive, for everything else.
--
-- Capitalization threshold: ETB 5,000, enforced at the register level
-- via a CHECK constraint. Below that, Finance keeps recording it as a
-- plain expense — that boundary is not enforced on the expense form
-- itself, by design (Finance's judgment call, not a hard system rule).
-- ============================================================

SET search_path TO public;

CREATE TABLE fixed_assets (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code                TEXT UNIQUE NOT NULL,
  asset_name                TEXT NOT NULL,
  category                  TEXT NOT NULL CHECK (category IN ('it_equipment', 'office_furniture', 'site_equipment', 'workshop_machinery')),
  serial_number             TEXT,
  manufacturer              TEXT,
  model                     TEXT,
  purchase_date             DATE NOT NULL,
  purchase_cost_etb         NUMERIC NOT NULL CHECK (purchase_cost_etb >= 5000),
  purchase_expense_id       UUID REFERENCES expenses(id),
  purchase_vendor_id        UUID REFERENCES vendors(id),
  useful_life_years         INT NOT NULL CHECK (useful_life_years > 0),
  depreciation_method       TEXT NOT NULL DEFAULT 'straight_line'
                             CHECK (depreciation_method IN ('straight_line', 'declining_balance', 'units_of_production', 'sum_of_years')),
  declining_balance_rate    NUMERIC CHECK (declining_balance_rate IS NULL OR (declining_balance_rate > 0 AND declining_balance_rate < 1)),
  total_expected_units      NUMERIC CHECK (total_expected_units IS NULL OR total_expected_units > 0),
  salvage_value_etb         NUMERIC NOT NULL DEFAULT 0 CHECK (salvage_value_etb >= 0),
  depreciation_start_date   DATE NOT NULL,
  location_id               UUID REFERENCES locations(id),
  custodian_staff_id        UUID REFERENCES staff(id),
  condition                 TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('new', 'good', 'fair', 'poor', 'under_repair', 'retired')),
  last_verified_at          DATE,
  last_verified_by_staff_id UUID REFERENCES staff(id),
  disposal_date             DATE,
  disposal_method           TEXT CHECK (disposal_method IS NULL OR disposal_method IN ('sold', 'scrapped', 'donated', 'lost')),
  disposal_value_etb        NUMERIC,
  disposal_notes            TEXT,
  notes                     TEXT,
  attachments                JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  created_by                UUID REFERENCES user_profiles(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fixed_assets_declining_balance_rate_required
    CHECK (depreciation_method <> 'declining_balance' OR declining_balance_rate IS NOT NULL),
  CONSTRAINT fixed_assets_total_expected_units_required
    CHECK (depreciation_method <> 'units_of_production' OR total_expected_units IS NOT NULL)
);

CREATE INDEX idx_fixed_assets_category ON fixed_assets(category);
CREATE INDEX idx_fixed_assets_custodian ON fixed_assets(custodian_staff_id) WHERE custodian_staff_id IS NOT NULL;
CREATE INDEX idx_fixed_assets_active ON fixed_assets(is_active);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Default useful life + asset code, both on INSERT only ─────────
-- One real sequence per category prefix (not a COUNT(*)+1 scan) so
-- codes stay gap-free and race-safe under concurrent inserts.
CREATE SEQUENCE fixed_asset_seq_it;
CREATE SEQUENCE fixed_asset_seq_fr;
CREATE SEQUENCE fixed_asset_seq_se;
CREATE SEQUENCE fixed_asset_seq_wm;

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
    END CASE;
    v_next := nextval(v_seq);
    NEW.asset_code := 'FA-' || v_prefix || '-' || LPAD(v_next::TEXT, 4, '0');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fixed_assets_before_insert
  BEFORE INSERT ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION fixed_assets_before_insert();

-- ── Usage log (units-of-production assets only) ────────────────────
CREATE TABLE fixed_asset_usage_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id   UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_start_date DATE NOT NULL,
  period_end_date   DATE NOT NULL,
  units_produced    NUMERIC NOT NULL CHECK (units_produced > 0),
  logged_by_staff_id UUID REFERENCES staff(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fixed_asset_usage_log_asset ON fixed_asset_usage_log(fixed_asset_id, period_end_date);

CREATE OR REPLACE FUNCTION enforce_usage_log_method()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_method TEXT;
BEGIN
  SELECT depreciation_method INTO v_method FROM fixed_assets WHERE id = NEW.fixed_asset_id;
  IF v_method IS DISTINCT FROM 'units_of_production' THEN
    RAISE EXCEPTION 'Usage can only be logged against an asset depreciated by units_of_production (this asset uses %)', v_method;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_usage_log_method
  BEFORE INSERT ON fixed_asset_usage_log
  FOR EACH ROW EXECUTE FUNCTION enforce_usage_log_method();

-- ── Movement log (immutable audit trail) ────────────────────────────
CREATE TABLE fixed_asset_movements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id         UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  movement_type          TEXT NOT NULL CHECK (movement_type IN ('custodian_change', 'location_change', 'condition_change', 'note')),
  from_custodian_staff_id UUID REFERENCES staff(id),
  to_custodian_staff_id   UUID REFERENCES staff(id),
  from_location_id       UUID REFERENCES locations(id),
  to_location_id         UUID REFERENCES locations(id),
  from_condition         TEXT,
  to_condition            TEXT,
  note                    TEXT,
  moved_by_staff_id       UUID REFERENCES staff(id),
  moved_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fixed_asset_movements_asset ON fixed_asset_movements(fixed_asset_id, moved_at DESC);

-- Auto-logs custodian/location/condition changes as movement rows.
-- Note-only movements (no field changed) are inserted directly by the
-- app, not by this trigger — there's nothing for it to diff.
CREATE OR REPLACE FUNCTION log_fixed_asset_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := current_staff_id();
BEGIN
  IF NEW.custodian_staff_id IS DISTINCT FROM OLD.custodian_staff_id THEN
    INSERT INTO fixed_asset_movements (fixed_asset_id, movement_type, from_custodian_staff_id, to_custodian_staff_id, moved_by_staff_id)
    VALUES (NEW.id, 'custodian_change', OLD.custodian_staff_id, NEW.custodian_staff_id, v_actor);
  END IF;

  IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    INSERT INTO fixed_asset_movements (fixed_asset_id, movement_type, from_location_id, to_location_id, moved_by_staff_id)
    VALUES (NEW.id, 'location_change', OLD.location_id, NEW.location_id, v_actor);
  END IF;

  IF NEW.condition IS DISTINCT FROM OLD.condition THEN
    INSERT INTO fixed_asset_movements (fixed_asset_id, movement_type, from_condition, to_condition, moved_by_staff_id)
    VALUES (NEW.id, 'condition_change', OLD.condition, NEW.condition, v_actor);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_fixed_asset_movement
  AFTER UPDATE OF custodian_staff_id, location_id, condition ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION log_fixed_asset_movement();

-- Verify: tables + triggers present.
SELECT tablename FROM pg_tables WHERE tablename IN ('fixed_assets', 'fixed_asset_usage_log', 'fixed_asset_movements');
