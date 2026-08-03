-- ============================================================
-- Retires the last historical data the FY2026/27 reset missed: the
-- pre-cutoff tax records.
--
-- Migrations 151/152 archived and then erased the operational tables,
-- but tax_summary and payroll_taxes were never in scope — they carry
-- free-text Ethiopian-calendar periods rather than a DATE column, so
-- the "dated before 2026-07-08" rule the purge was built on simply
-- didn't reach them. They have been sitting in the consolidated
-- liability view ever since, which is why every figure on Tax
-- Management until now described a fiscal year the rest of the app no
-- longer contains.
--
-- What goes, confirmed against live data rather than by name pattern:
--   tax_summary    6 rows — ሚያዚያ/ግንቦት/ሰኔ/ሀምሌ/ነሐሴ 2017 EC and መስከረም 2018 EC
--   payroll_taxes 42 rows — ሀምሌ 2017 EC (33) and መስከረም 2018 EC (9)
--
-- Every one of those 48 rows was created 2026-06-16, inside the
-- Airtable import window and months before the 2026-07-08 cutoff, so
-- the classification does not rest on reading the Amharic month names.
--
-- NOT touched: tax_engagements. Its single row is dated 2026-07-25 —
-- current fiscal year, not historical — so it falls outside "retire
-- the historical data" even though it looks like a test entry (period,
-- due and filed dates all identical, no reference number, no document).
-- Deleting it is a separate call for a human to make, not something to
-- fold in here silently.
--
-- No view changes needed: v_tax_liability_summary reads both tables
-- through UNION branches that simply return no rows once they are
-- empty, and v_tax_position never depended on either.
-- ============================================================

SET search_path TO public;

-- ── Backup first, same posture as 152 ───────────────────────────────
-- Postgres-only, revoked from every app role. Not a git-committed
-- export: this is salary-level payroll tax detail. Table names carry
-- their own date because the schema was created for the earlier purge
-- and these rows are being retired later.
CREATE SCHEMA IF NOT EXISTS erased_history_20260725;

CREATE TABLE IF NOT EXISTS erased_history_20260725.tax_summary_20260727   AS SELECT * FROM tax_summary;
CREATE TABLE IF NOT EXISTS erased_history_20260725.payroll_taxes_20260727 AS SELECT * FROM payroll_taxes;

REVOKE ALL ON SCHEMA erased_history_20260725 FROM PUBLIC, authenticated, anon;

-- ── Retire ──────────────────────────────────────────────────────────
-- payroll_taxes first: it references payroll and tax_summary, and
-- expenses.tax_summary_id points at tax_summary. Clearing the
-- referencing side before the referenced one keeps the deletes from
-- tripping a foreign key.
UPDATE expenses SET tax_summary_id = NULL WHERE tax_summary_id IS NOT NULL;
UPDATE sales    SET tax_summary_id = NULL WHERE tax_summary_id IS NOT NULL;

DELETE FROM payroll_taxes;
DELETE FROM tax_summary;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM tax_summary)   AS tax_summary_expect_0,
  (SELECT count(*) FROM payroll_taxes) AS payroll_taxes_expect_0,
  (SELECT count(*) FROM erased_history_20260725.tax_summary_20260727)   AS backed_up_tax_summary_expect_6,
  (SELECT count(*) FROM erased_history_20260725.payroll_taxes_20260727) AS backed_up_payroll_taxes_expect_42,
  (SELECT count(*) FROM tax_engagements) AS engagements_untouched_expect_1;

-- The consolidated view should now be empty rather than full of
-- 2017/2018 EC figures — nothing current has been entered yet.
SELECT category, period, amount FROM v_tax_liability_summary ORDER BY category, period;

-- Balances must not move: none of this fed a balance.
SELECT account_name, balance FROM v_account_balances
WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';
