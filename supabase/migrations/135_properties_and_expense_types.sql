-- ============================================================
-- Typed expenses + Properties & Rent (spec round: "Confirmed real
-- state" — expense_type is 2,315/2,316 'general', separate purpose-
-- built tables already exist per request type, Property Rent has zero
-- vendor/landlord structure today).
--
-- This migration is schema only: enum extension, the new properties
-- table (seeded with names/purpose only — landlord, rent, and lease
-- dates are genuinely unknown from the 17 historical rows, which all
-- have vendor_id null, so they're left blank for a human to fill in,
-- not guessed), and the two new nullable FK columns. The auto-creation
-- triggers for each gate (materials/GRN, subcontract, CPO, maintenance,
-- VRF, property rent) land in a follow-up migration once each gate's
-- exact current mechanism is confirmed — this one only builds the
-- destination shape they'll all point at.
--
-- Per user decision: property_id tagging extends to work_orders now
-- (not deferred until Leather Workshop's separation becomes concrete)
-- — a nullable FK costs nothing structurally and null for every
-- non-Leather work order, but retrofitting it under time pressure
-- later is exactly the archaeology §3 exists to avoid.
--
-- Per user decision: renewal alerts are set manually per property
-- (renewal_notice_days), not a fixed universal lead time — most lease
-- agreements specify their own notice period, so a single hardcoded
-- number (e.g. 60 days for everyone) would be wrong for whichever
-- property's real agreement says otherwise.
--
-- No retrofit of the 17 historical Property Rent expenses — same
-- grandfathering discipline as every other legacy-data decision this
-- project has made (098, 105, 129 and others): nothing here touches
-- an existing expenses row. Only new rent expenses, going forward,
-- link to a property.
-- ============================================================

SET search_path TO public;

-- ── 1. Real, meaningful expense_type values ─────────────────────────
-- Already exist (027, 062a): general, purchase_order, vrf, cpo_bond, fuel.
-- Adding the three this round's gates need. Postgres requires each
-- ALTER TYPE ... ADD VALUE in its own transaction/statement outside a
-- DO block that also uses the new value in the same transaction — this
-- migration only adds the values; nothing below references them in a
-- way that would violate that (no CASE/comparison against the new
-- labels in this same file).
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'subcontract';
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'maintenance';
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'property_rent';

-- ── 2. Properties ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_name        TEXT NOT NULL,
  property_type        TEXT,
  purpose              TEXT,
  address              TEXT,
  landlord_vendor_id   UUID REFERENCES vendors(id) ON DELETE SET NULL,
  monthly_rent_amount  NUMERIC(12,2),
  lease_start_date     DATE,
  lease_end_date       DATE,
  deposit_amount       NUMERIC(12,2),
  -- Per user decision: manually set, per property, from that
  -- property's own lease agreement — not a single fixed lead time,
  -- since agreements specify their own notice periods.
  renewal_notice_days  INTEGER,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'vacated')),
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION touch_properties_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION touch_properties_updated_at();

-- Seed the three real leased workshops — names/purpose only. Landlord,
-- rent, and lease dates are unknown (all 17 historical rent expenses
-- have vendor_id null) and are deliberately left null for a human to
-- enter, not guessed.
INSERT INTO properties (property_name, property_type, purpose)
SELECT 'Main Workshop', 'workshop', 'Primary fabrication workshop'
WHERE NOT EXISTS (SELECT 1 FROM properties WHERE property_name = 'Main Workshop');

INSERT INTO properties (property_name, property_type, purpose)
SELECT 'Painting & Finishing Workshop', 'workshop', 'Painting and finishing'
WHERE NOT EXISTS (SELECT 1 FROM properties WHERE property_name = 'Painting & Finishing Workshop');

INSERT INTO properties (property_name, property_type, purpose)
SELECT 'Leather Workshop', 'workshop', 'Leather — expected to branch into a separate sister company'
WHERE NOT EXISTS (SELECT 1 FROM properties WHERE property_name = 'Leather Workshop');

-- ── 3. New linkage: expenses.property_id, work_orders.property_id ──
ALTER TABLE expenses    ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "properties_read" ON properties;
CREATE POLICY "properties_read" ON properties FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'operations_manager'));

DROP POLICY IF EXISTS "properties_manage" ON properties;
CREATE POLICY "properties_manage" ON properties FOR ALL
  USING (get_user_role() IN ('admin', 'operations_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'operations_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON properties TO authenticated;

-- Verify
SELECT property_name, property_type, purpose, status FROM properties ORDER BY property_name;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'expense_category'::regtype ORDER BY enumsortorder;
SELECT column_name FROM information_schema.columns WHERE table_name IN ('expenses', 'work_orders') AND column_name = 'property_id';
