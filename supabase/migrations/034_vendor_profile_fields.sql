-- Extend vendors table with richer profile fields for vendor profiling upgrade.
-- All columns use ADD COLUMN IF NOT EXISTS so this migration is idempotent.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS email         TEXT,
  ADD COLUMN IF NOT EXISTS address       TEXT,
  ADD COLUMN IF NOT EXISTS contact_person TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms  TEXT,
  ADD COLUMN IF NOT EXISTS website        TEXT,
  ADD COLUMN IF NOT EXISTS notes          TEXT;
