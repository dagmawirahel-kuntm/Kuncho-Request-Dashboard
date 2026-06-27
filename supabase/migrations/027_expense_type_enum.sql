-- Convert expense_type from free-text to a controlled enum
-- and add FK columns for CPO bond and sourcing bundle linkage

DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM ('general', 'purchase_order', 'vrf', 'cpo_bond');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Convert the existing TEXT column to the new enum
-- All legacy free-text values (Operational, Capital, Payroll, etc.) → 'general'
ALTER TABLE expenses
  ALTER COLUMN expense_type DROP DEFAULT,
  ALTER COLUMN expense_type TYPE expense_category
    USING CASE
      WHEN expense_type IN ('vrf','VRF') THEN 'vrf'::expense_category
      WHEN expense_type IN ('cpo_bond','CPO Bond','CPO') THEN 'cpo_bond'::expense_category
      WHEN expense_type IN ('purchase_order','Purchase Order') THEN 'purchase_order'::expense_category
      ELSE 'general'::expense_category
    END,
  ALTER COLUMN expense_type SET NOT NULL,
  ALTER COLUMN expense_type SET DEFAULT 'general';

-- FK linkage columns
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS cpo_bond_id       UUID REFERENCES cpo_bonds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sourcing_bundle_id UUID REFERENCES sourcing_bundles(id) ON DELETE SET NULL;
