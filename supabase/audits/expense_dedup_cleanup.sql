-- ═══════════════════════════════════════════════════════════════════
-- EXPENSE DE-DUPLICATION — staged cleanup
--
-- Diagnosis (from audit section 4): the Airtable import landed twice.
-- One pass kept proper type-coded expense codes (GEN-VRF-…, GEN-MDF-…),
-- the other got auto-stamped GEN-MISC-… codes by the code trigger.
-- Because the duplicate guard matched on expense_code, identical
-- expenses (same date, amount, description) exist twice under two codes,
-- inflating paid expense totals by millions across 2025 and 2026.
--
-- Run each step separately, in order. Step 3 deletes NOTHING it hasn't
-- first copied into a backup table, and never touches expenses that are
-- referenced by orders, batch payments, cash advances, or sourcing.
-- ═══════════════════════════════════════════════════════════════════

-- ── STEP 1: Quantify (read-only) ────────────────────────────────────
-- How many duplicate rows would be removed, and how much money is
-- currently double-counted, per year.
WITH ranked AS (
  SELECT id, date, amount_etb, payment_status,
    ROW_NUMBER() OVER (
      PARTITION BY date, amount_etb, COALESCE(item_service_description, '')
      ORDER BY (expense_code LIKE 'GEN-MISC-%'), created_at, id
    ) AS rn
  FROM expenses
)
SELECT
  EXTRACT(YEAR FROM date)::int AS year,
  payment_status,
  COUNT(*)        AS duplicate_rows_to_remove,
  SUM(amount_etb) AS overcounted_etb
FROM ranked
WHERE rn > 1
GROUP BY 1, 2
ORDER BY 1, 2;

-- ── STEP 2: Back up the rows that will be deleted ───────────────────
CREATE TABLE IF NOT EXISTS expenses_dedup_backup AS
WITH ranked AS (
  SELECT e.*,
    ROW_NUMBER() OVER (
      PARTITION BY date, amount_etb, COALESCE(item_service_description, '')
      ORDER BY (expense_code LIKE 'GEN-MISC-%'), created_at, id
    ) AS rn
  FROM expenses e
)
SELECT * FROM ranked WHERE rn > 1;

-- Sanity: how many rows are in the backup?
SELECT COUNT(*) AS backed_up_rows, SUM(amount_etb) AS backed_up_etb
FROM expenses_dedup_backup;

-- ── STEP 3: Delete the duplicates ───────────────────────────────────
-- Keeps, per duplicate group: the type-coded copy over the MISC copy,
-- then the earliest-created. Skips any row referenced elsewhere.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY date, amount_etb, COALESCE(item_service_description, '')
      ORDER BY (expense_code LIKE 'GEN-MISC-%'), created_at, id
    ) AS rn
  FROM expenses
),
deletable AS (
  SELECT id FROM ranked
  WHERE rn > 1
    AND id NOT IN (SELECT expense_id FROM order_expenses)
    AND id NOT IN (SELECT expense_id FROM batch_payment_expenses)
    AND id NOT IN (SELECT expense_id FROM cash_advance_expenses)
    AND id NOT IN (SELECT expense_id FROM expense_order_items)
    AND id NOT IN (SELECT expense_id FROM sourcing_bundles WHERE expense_id IS NOT NULL)
)
DELETE FROM expenses WHERE id IN (SELECT id FROM deletable);

-- ── STEP 4: Verify (read-only) ──────────────────────────────────────
-- Re-run the year split; compare against the pre-cleanup numbers
-- (2025 paid was 99.29M / 1,469 records; 2026 paid was 127.58M / 984).
SELECT
  EXTRACT(YEAR FROM date)::int AS year,
  payment_status,
  COUNT(*)        AS records,
  SUM(amount_etb) AS total_etb
FROM expenses
WHERE date IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- Any duplicate groups left? (should be near zero; leftovers are rows
-- protected by references — tell Claude and they'll be handled one by one)
SELECT COUNT(*) AS remaining_duplicate_groups FROM (
  SELECT 1
  FROM expenses
  GROUP BY date, amount_etb, COALESCE(item_service_description, '')
  HAVING COUNT(*) > 1
) g;

-- ═══════════════════════════════════════════════════════════════════
-- UNDO (only if something looks wrong afterwards):
--   INSERT INTO expenses SELECT <all original columns> FROM
--   expenses_dedup_backup;  -- ask Claude for the exact column list
-- The backup table is kept until you confirm the P&L looks right;
-- drop it later with: DROP TABLE expenses_dedup_backup;
-- ═══════════════════════════════════════════════════════════════════
