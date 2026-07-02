-- ═══════════════════════════════════════════════════════════════════
-- EXPENSE ANOMALY AUDIT
-- Context: between Jun 30 and Jul 1 2026, "paid expenses" in the 2026
-- P&L jumped from ETB 72.2M to 127.6M (+55M), flipping net profit to a
-- 34M loss. The P&L counts: expenses WHERE payment_status = true,
-- bucketed by the `date` column. Run each section in the Supabase SQL
-- editor and read the notes to interpret.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Where does the 2026 expense total actually sit, month by month?
--    A single month holding tens of millions is the first place to look.
SELECT
  to_char(date, 'YYYY-MM')            AS month,
  COUNT(*)                            AS paid_expenses,
  SUM(amount_etb)                     AS total_etb
FROM expenses
WHERE payment_status = true
  AND date >= '2026-01-01' AND date <= '2026-12-31'
GROUP BY 1
ORDER BY 1;

-- 2) What changed recently? Expenses touched between Jun 30 and Jul 2
--    that are paid and dated 2026 — these ARE the +55M swing.
SELECT
  id, expense_code, date, amount_etb, payment_status,
  approval_status, created_at, updated_at
FROM expenses
WHERE payment_status = true
  AND date >= '2026-01-01'
  AND updated_at >= '2026-06-30'
ORDER BY amount_etb DESC
LIMIT 50;

-- 3) Sanity: future-dated expenses (dated after today).
--    Cash-basis P&L should not contain expenses dated in the future.
SELECT id, expense_code, date, amount_etb, payment_status, created_at
FROM expenses
WHERE date > CURRENT_DATE
ORDER BY date DESC
LIMIT 50;

-- 4) Possible duplicates from the Airtable import: same date + same
--    amount + same description appearing more than once.
SELECT
  date, amount_etb, LEFT(COALESCE(item_service_description, ''), 60) AS item,
  COUNT(*) AS copies,
  SUM(amount_etb) AS combined_etb,
  array_agg(expense_code) AS codes
FROM expenses
WHERE payment_status = true
GROUP BY date, amount_etb, LEFT(COALESCE(item_service_description, ''), 60)
HAVING COUNT(*) > 1
ORDER BY combined_etb DESC
LIMIT 40;

-- 5) The biggest single paid expenses in 2026 — eyeball for typos
--    (an extra zero on one record can be millions on its own).
SELECT id, expense_code, date, amount_etb, item_service_description, payment_status
FROM expenses
WHERE payment_status = true
  AND date >= '2026-01-01' AND date <= '2026-12-31'
ORDER BY amount_etb DESC
LIMIT 25;

-- 6) Split of paid vs unpaid by year — confirms how much each year's
--    P&L would move if records were mis-flagged.
SELECT
  EXTRACT(YEAR FROM date)::int AS year,
  payment_status,
  COUNT(*)                     AS records,
  SUM(amount_etb)              AS total_etb
FROM expenses
WHERE date IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- ── Interpreting results ─────────────────────────────────────────────
-- • Section 2 lists exactly which records created the jump (they were
--   updated in the window and count toward 2026 paid expenses).
-- • If Section 4 shows large "copies" counts, the Airtable import
--   double-inserted; delete the duplicate ids (keep the earliest).
-- • If Section 3 returns rows, those records have wrong dates — fix
--   the date rather than deleting.
-- • If Section 5 shows an implausible outlier, correct amount_etb.
-- Fix records with UPDATE statements, or share the output here and
-- I'll write the exact corrective SQL.
