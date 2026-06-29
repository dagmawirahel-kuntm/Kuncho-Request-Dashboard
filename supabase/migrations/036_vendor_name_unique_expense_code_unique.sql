-- Add unique constraints needed for idempotent Airtable migration upserts.
-- Both are idempotent via IF NOT EXISTS equivalent (DO block).

-- Normalize any existing vendor names that differ only by trailing whitespace
-- before adding the unique constraint.
UPDATE vendors
SET vendor_name = trim(vendor_name)
WHERE vendor_name != trim(vendor_name);

-- Deduplicate: if two vendors have the same trimmed name, keep the one with
-- the earlier created_at and merge the other's non-null fields into it.
WITH ranked AS (
  SELECT id,
         vendor_name,
         row_number() OVER (PARTITION BY lower(trim(vendor_name)) ORDER BY created_at) AS rn
  FROM vendors
),
dupes AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM vendors WHERE id IN (SELECT id FROM dupes);

-- Now safe to add the unique constraint
ALTER TABLE vendors
  DROP CONSTRAINT IF EXISTS vendors_vendor_name_unique;

ALTER TABLE vendors
  ADD CONSTRAINT vendors_vendor_name_unique UNIQUE (vendor_name);

-- Deduplicate expense_code: keep the row with the earliest created_at,
-- delete the rest. NULL expense_codes are left untouched.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lower(trim(expense_code))
           ORDER BY created_at
         ) AS rn
  FROM expenses
  WHERE expense_code IS NOT NULL
),
dupes AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM expenses WHERE id IN (SELECT id FROM dupes);

-- Also normalise whitespace on expense_code values
UPDATE expenses
SET expense_code = trim(expense_code)
WHERE expense_code IS NOT NULL AND expense_code != trim(expense_code);

-- Now safe to add the unique constraint on non-null codes
ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_expense_code_unique;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_expense_code_unique UNIQUE (expense_code);
