-- Run this LAST, after part00 and all of part01-part09 have succeeded.
-- Applies the staged Airtable data to the real expenses table and cleans up.

BEGIN;

-- Deduplicate import rows sharing the same expense_code (Airtable's formula
-- isn't guaranteed unique). Keep one row per code so the INSERT below can
-- never collide with itself within a single statement.
DELETE FROM _exp_import a
USING _exp_import b
WHERE a.ctid < b.ctid
  AND lower(trim(a.expense_code)) = lower(trim(b.expense_code));

-- Update existing rows (match on expense_code, preserve FK references)
UPDATE expenses e
SET
  vendor_id       = (SELECT id FROM vendors
                     WHERE lower(trim(vendor_name)) = lower(trim(i.vendor_name))
                     LIMIT 1),
  payment_status  = i.paid,
  approval_status = CASE WHEN i.paid THEN 'finance_approved'::expense_approval_status ELSE e.approval_status END,
  vendors_name    = i.vendor_name
FROM _exp_import i
WHERE lower(trim(e.expense_code)) = lower(trim(i.expense_code));

-- Insert rows that don't exist yet
INSERT INTO expenses (
  expense_code, item_service_description, amount_etb, date,
  payment_status, approval_status, expense_type, vendors_name, vendor_id
)
SELECT
  i.expense_code,
  i.description,
  i.amount,
  i.expense_date,
  i.paid,
  CASE WHEN i.paid THEN 'finance_approved'::expense_approval_status ELSE 'pending'::expense_approval_status END,
  i.expense_type::expense_category,
  i.vendor_name,
  (SELECT id FROM vendors
   WHERE lower(trim(vendor_name)) = lower(trim(i.vendor_name))
   LIMIT 1)
FROM _exp_import i
WHERE NOT EXISTS (
  SELECT 1 FROM expenses e
  WHERE lower(trim(e.expense_code)) = lower(trim(i.expense_code))
)
ON CONFLICT (expense_code) DO NOTHING;

DROP TABLE IF EXISTS _exp_import;

COMMIT;

-- Verify
SELECT
  approval_status,
  COUNT(*) AS count,
  SUM(amount_etb) AS total_etb
FROM expenses
WHERE vendor_id IS NOT NULL
GROUP BY approval_status
ORDER BY approval_status;

SELECT
  count(*) FILTER (WHERE vendor_id IS NOT NULL) AS linked_to_vendor,
  count(*) FILTER (WHERE vendor_id IS NULL)     AS no_vendor_link,
  count(*)                                       AS total
FROM expenses;
