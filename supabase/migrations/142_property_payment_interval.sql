-- ============================================================
-- Rent payment interval — not every lease pays monthly. A property's
-- lease can specify quarterly, semi-annual, or annual payment, while
-- monthly_rent_amount stays the lease's quoted monthly RATE (matches
-- how landlords typically state rent, and keeps the property card's
-- "Monthly Rent" figure meaningful regardless of billing cadence).
-- The amount actually requested is monthly_rent_amount * this
-- interval — computed client-side at request time, same as every
-- other figure on this page (nothing here is a generated/stored
-- column, consistent with the "derived, never stored" pattern used
-- throughout this project).
--
-- Defaults to 1 (monthly) — the 3 existing properties are unaffected
-- unless someone explicitly sets a different interval.
-- ============================================================

SET search_path TO public;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS payment_interval_months INTEGER NOT NULL DEFAULT 1 CHECK (payment_interval_months > 0);

-- Verify
SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'payment_interval_months';
