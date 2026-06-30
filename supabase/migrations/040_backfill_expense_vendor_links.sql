-- ============================================================
-- Backfill vendor_id on pre-existing expenses using the free-text
-- vendors_name field, matched against the vendors table.
--
-- These are the 1,754 expenses that existed before the KUNCH_11
-- Airtable seed (migration 038) and were never linked to a vendor
-- record. ~196 unique vendors_name values appear on them; many are
-- messy free text (e.g. "Sleshi Girma 1000311511851" with a bank
-- account number appended), so this only links rows where the text
-- exactly matches a vendor name, or starts with a vendor name
-- followed by a space (safe prefix match — avoids false positives
-- from short/ambiguous substrings).
--
-- Safe to re-run: only touches rows where vendor_id IS NULL.
-- ============================================================

UPDATE expenses e
SET vendor_id = v.id
FROM vendors v
WHERE e.vendor_id IS NULL
  AND e.vendors_name IS NOT NULL
  AND (
    lower(trim(e.vendors_name)) = lower(trim(v.vendor_name))
    OR lower(trim(e.vendors_name)) LIKE lower(trim(v.vendor_name)) || ' %'
  );

-- Verify
SELECT
  count(*) FILTER (WHERE vendor_id IS NOT NULL)                              AS now_linked,
  count(*) FILTER (WHERE vendor_id IS NULL AND vendors_name IS NOT NULL)     AS still_unlinked_with_name,
  count(*) FILTER (WHERE vendor_id IS NULL AND vendors_name IS NULL)         AS no_vendor_name_at_all
FROM expenses;
