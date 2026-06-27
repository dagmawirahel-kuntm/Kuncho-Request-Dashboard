-- Sourcing Bundles: procurement officer consolidates multiple PR line items
-- into a single vendor purchase, generating a formal Purchase Order for finance.

DO $$ BEGIN
  CREATE TYPE sourcing_bundle_status AS ENUM (
    'drafting', 'submitted', 'approved', 'ordered', 'fulfilled', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-increment sequence for PO codes (PO-YYYY-0001)
CREATE SEQUENCE IF NOT EXISTS sourcing_bundle_seq START 1;

CREATE TABLE IF NOT EXISTS sourcing_bundles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_code            TEXT UNIQUE,
  vendor_id              UUID REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name            TEXT,                        -- override / free-text vendor
  status                 sourcing_bundle_status NOT NULL DEFAULT 'drafting',
  procurement_officer_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  submitted_at           TIMESTAMPTZ,
  approved_by            UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_at            TIMESTAMPTZ,
  ordered_at             TIMESTAMPTZ,
  fulfilled_at           TIMESTAMPTZ,
  expected_delivery_date DATE,
  notes                  TEXT,
  finance_notes          TEXT,
  expense_id             UUID REFERENCES expenses(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate bundle_code on insert
CREATE OR REPLACE FUNCTION set_bundle_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bundle_code IS NULL THEN
    NEW.bundle_code := 'PO-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('sourcing_bundle_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_bundle_code ON sourcing_bundles;
CREATE TRIGGER trg_set_bundle_code
  BEFORE INSERT ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION set_bundle_code();

-- Updated-at trigger
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_bundle_updated_at ON sourcing_bundles;
CREATE TRIGGER trg_bundle_updated_at
  BEFORE UPDATE ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Line items linking to PR order_items
CREATE TABLE IF NOT EXISTS sourcing_bundle_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id         UUID NOT NULL REFERENCES sourcing_bundles(id) ON DELETE CASCADE,
  order_item_id     UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity_actual   NUMERIC(10,3),
  unit_price_actual NUMERIC(14,2),
  notes             TEXT,
  sort_order        INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bundle_id, order_item_id)
);

-- RLS: management roles only
ALTER TABLE sourcing_bundles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sourcing_bundle_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS sourcing_bundles_policy      ON sourcing_bundles;
  DROP POLICY IF EXISTS sourcing_bundle_items_policy ON sourcing_bundle_items;

  CREATE POLICY sourcing_bundles_policy ON sourcing_bundles
    USING (
      EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin','manager','finance','procurement_officer')
      )
    );

  CREATE POLICY sourcing_bundle_items_policy ON sourcing_bundle_items
    USING (
      EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin','manager','finance','procurement_officer')
      )
    );
EXCEPTION WHEN others THEN NULL; END $$;
