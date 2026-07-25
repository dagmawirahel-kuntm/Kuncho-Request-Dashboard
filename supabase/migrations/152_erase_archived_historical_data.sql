-- ============================================================
-- Hard-delete every row soft-archived by migration 151 (everything
-- dated before FY2026/27, 2026-07-08) plus their now-orphaned
-- purchase_allocation children. Per user decision: the historical
-- record lives in the KUNCH_10 Airtable base, so it does not need to
-- also live in this app's database — a genuine fresh start, not a
-- hidden one. Includes pending/unpaid historical expenses (577) and
-- pending historical orders (50): if that spend still needs to
-- happen, it is requested fresh under current rules, not carried
-- forward from before the cutoff.
--
-- What is explicitly NOT touched: vendors, projects, clients, staff,
-- categories, accounts, chart_of_accounts, bank_balance_anchors,
-- opening_balances, fiscal_periods. These are the reference data and
-- the anchors this reset is built on top of, not history being erased.
--
-- Confirmed against live data before writing this (see session):
--   - Zero of the FK-protected "real asset" children (tool_units,
--     vehicle_maintenance_requests, vehicle_penalties, stock_receipts,
--     cpo_bonds, vendor_receipts, transportation_requests,
--     emergency_payroll_summary, payroll_taxes) reference anything
--     being deleted here. Nothing gets orphaned or silently lost.
--   - Zero ACTIVE (non-archived) row anywhere references anything
--     being deleted here.
--   - purchase_allocation is the one exception: 428 of its 621 rows
--     point at an archived expense via parent_purchase_id (NO ACTION,
--     no cascade), and 100% of those 428 point at an expense being
--     deleted. They are pure sub-allocations of a purchase that is
--     about to stop existing, so they are deleted too. The other 193
--     rows (no parent_purchase_id) are untouched.
--   - One bank_balance_anchors row (the FY2025/26 CBE anchor, migration
--     106) points at a transfer being deleted here. Detached below
--     (transfer_id -> NULL) rather than deleted — the anchor's own
--     balance/date/source is real, already-known data and stays
--     exactly as recorded; it just stops pointing at a transfer row
--     that no longer exists.
--
-- Ordering below follows the NO ACTION foreign keys actually found in
-- the schema (children deleted before the parents they point at):
-- cash_advances/timesheet before payroll; purchase_allocation and
-- expenses before transfers and vendor_receipt_facilitation.
-- Everything else the schema handles itself via ON DELETE CASCADE/
-- SET NULL, so no explicit cleanup is written for those tables.
--
-- Backups are plain tables inside a Postgres-only schema, not files —
-- this repo is public, and this data includes vendor bank accounts,
-- staff advances, and salaries. Never exported to git.
-- ============================================================

SET search_path TO public;

-- ── 1. In-database backup (Postgres-only, never touches git) ────────
CREATE SCHEMA IF NOT EXISTS erased_history_20260725;

CREATE TABLE erased_history_20260725.expenses                    AS SELECT * FROM expenses                    WHERE is_archived;
CREATE TABLE erased_history_20260725.transfers                   AS SELECT * FROM transfers                   WHERE is_archived;
CREATE TABLE erased_history_20260725.sales                       AS SELECT * FROM sales                       WHERE is_archived;
CREATE TABLE erased_history_20260725.cash_advances                AS SELECT * FROM cash_advances               WHERE is_archived;
CREATE TABLE erased_history_20260725.payroll                     AS SELECT * FROM payroll                     WHERE is_archived;
CREATE TABLE erased_history_20260725.orders                      AS SELECT * FROM orders                      WHERE is_archived;
CREATE TABLE erased_history_20260725.timesheet                   AS SELECT * FROM timesheet                   WHERE is_archived;
CREATE TABLE erased_history_20260725.vendor_receipt_facilitation AS SELECT * FROM vendor_receipt_facilitation WHERE is_archived;
CREATE TABLE erased_history_20260725.purchase_allocation AS
  SELECT * FROM purchase_allocation WHERE parent_purchase_id IN (SELECT id FROM expenses WHERE is_archived);

REVOKE ALL ON SCHEMA erased_history_20260725 FROM PUBLIC, authenticated, anon;

-- ── 2. Detach the one historical anchor from the transfer it points
-- at. The anchor row itself (balance, date, source) is untouched. ───
UPDATE bank_balance_anchors
SET transfer_id = NULL
WHERE transfer_id IN (SELECT id FROM transfers WHERE is_archived);

-- ── 3. Stand down two business-rule guards for the duration of this
-- one deliberate purge, then restore them. Both were hit for real when
-- this migration was first run and are NOT optional:
--
--   trg_prevent_paid_payroll_delete — refuses to delete any payroll run
--     with payment_status = 'paid'. Correct for day-to-day use; every
--     historical payroll run here is paid, so the DELETE below cannot
--     proceed with it armed.
--   trg_enforce_bundle_items_drafting_only — refuses to remove line
--     items from a sourcing bundle that has left drafting. Reached
--     indirectly: deleting orders cascades to order_items, which
--     cascades to sourcing_bundle_items, and the surviving bundles are
--     'fulfilled'/'cancelled', not 'drafting'.
--
-- Both are single-purpose RAISE-EXCEPTION guards with no side effects
-- (verified by reading pg_get_functiondef before touching them), so
-- disabling them changes nothing beyond letting these specific deletes
-- through. They are re-enabled immediately below, and the final
-- verification block asserts both are armed again before this
-- migration is considered done.
ALTER TABLE payroll              DISABLE TRIGGER trg_prevent_paid_payroll_delete;
ALTER TABLE sourcing_bundle_items DISABLE TRIGGER trg_enforce_bundle_items_drafting_only;

-- ── 4. Delete in NO ACTION-respecting order ──────────────────────────
DELETE FROM purchase_allocation WHERE parent_purchase_id IN (SELECT id FROM expenses WHERE is_archived);
DELETE FROM cash_advances WHERE is_archived;
DELETE FROM timesheet     WHERE is_archived;
DELETE FROM expenses      WHERE is_archived;
DELETE FROM payroll       WHERE is_archived;
DELETE FROM transfers     WHERE is_archived;
DELETE FROM vendor_receipt_facilitation WHERE is_archived;
DELETE FROM orders WHERE is_archived;
DELETE FROM sales  WHERE is_archived;

-- ── 5. Re-arm the guards ─────────────────────────────────────────────
ALTER TABLE payroll              ENABLE TRIGGER trg_prevent_paid_payroll_delete;
ALTER TABLE sourcing_bundle_items ENABLE TRIGGER trg_enforce_bundle_items_drafting_only;

-- ── Verify ──────────────────────────────────────────────────────────
-- Every archived table should now be empty of what it used to hold;
-- v_archive_summary's "archived" columns should all read 0.
SELECT * FROM v_archive_summary ORDER BY table_name;

-- Backups landed and are sized as expected.
SELECT 'expenses' t, count(*) FROM erased_history_20260725.expenses
UNION ALL SELECT 'transfers', count(*) FROM erased_history_20260725.transfers
UNION ALL SELECT 'sales', count(*) FROM erased_history_20260725.sales
UNION ALL SELECT 'cash_advances', count(*) FROM erased_history_20260725.cash_advances
UNION ALL SELECT 'payroll', count(*) FROM erased_history_20260725.payroll
UNION ALL SELECT 'orders', count(*) FROM erased_history_20260725.orders
UNION ALL SELECT 'timesheet', count(*) FROM erased_history_20260725.timesheet
UNION ALL SELECT 'vendor_receipt_facilitation', count(*) FROM erased_history_20260725.vendor_receipt_facilitation
UNION ALL SELECT 'purchase_allocation', count(*) FROM erased_history_20260725.purchase_allocation;

-- Reference data untouched.
SELECT 'vendors' t, count(*) FROM vendors
UNION ALL SELECT 'projects', count(*) FROM projects
UNION ALL SELECT 'bank_balance_anchors', count(*) FROM bank_balance_anchors;

-- CBE balance must be unchanged by this migration — every row deleted
-- here was already excluded from the balance calculation by migration
-- 134's anchor, so this is purely a data-erasure step, not a financial
-- one.
SELECT account_name, balance FROM v_account_balances
WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';

-- Both guards must read 'O' (enabled). A 'D' here means the purge left
-- a safety rail down — do not leave the database in that state.
SELECT
  (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_prevent_paid_payroll_delete')        AS payroll_guard_expect_O,
  (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_enforce_bundle_items_drafting_only') AS bundle_guard_expect_O;
