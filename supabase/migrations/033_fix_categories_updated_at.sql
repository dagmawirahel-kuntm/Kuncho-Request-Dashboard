-- Fix: "record 'new' has no field 'updated_at'" on General Ledger (categories) edits.
--
-- Root cause: migration 001 created the `categories` table WITHOUT an `updated_at`
-- column, but the generic set_updated_at trigger was applied to it in the same
-- migration. Any UPDATE on categories fires the trigger, which tries to write
-- NEW.updated_at and crashes.
--
-- This migration is idempotent — safe to run whether or not migration 008 was
-- applied previously.

-- 1. Add the missing column (no-op if already exists)
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Back-fill existing rows so updated_at is never NULL
UPDATE categories SET updated_at = created_at WHERE updated_at IS NULL;

-- 2. Remove the broken trigger installed by migration 001 (it references a
--    column that didn't exist at the time).
DROP TRIGGER IF EXISTS set_updated_at ON categories;

-- 3. Remove the trigger from migration 008 if it was already applied, then
--    recreate it cleanly so we end up with exactly one trigger.
DROP TRIGGER IF EXISTS set_categories_updated_at ON categories;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
