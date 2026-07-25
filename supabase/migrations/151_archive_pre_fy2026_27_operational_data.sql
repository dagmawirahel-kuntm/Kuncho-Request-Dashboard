-- ============================================================
-- Fresh start at FY2026/27 (2026-07-08): soft-archive every
-- operational row that predates the current fiscal year.
--
-- Per user decision: this app covers FY2026/27 forward. The full
-- historical record lives in the KUNCH_10 Airtable base and is
-- retrievable there whenever it's needed, so the dashboard no longer
-- needs to carry ~2,300 imported expenses, 732 imported bank lines and
-- the rest of the pre-cutoff operational history in its day-to-day
-- lists, pickers and dashboards.
--
-- SOFT archive, not a delete, and deliberately so:
--   - Nothing is destroyed. Every row stays in Postgres, queryable,
--     with its foreign keys intact.
--   - The 439 vendors, 86 projects, clients, staff and categories that
--     exist largely BECAUSE those old rows referenced them are left
--     completely untouched. A hard delete would have orphaned them.
--   - Reversible in one statement (UPDATE ... SET is_archived = false).
--
-- What archiving does and does not change:
--   - Lists, pickers and dashboard aggregates filter archived rows out.
--   - Fetching a single row BY ID still works, so an old link or a
--     drill-through from a report does not 404.
--   - Account balances are NOT affected either way. They already start
--     from the FY2026/27 anchor (migration 134) and count only activity
--     dated after 2026-07-07, so every row archived here was already
--     excluded from every balance figure before this migration ran.
--     This migration is a UI/reporting cleanup, not a financial change.
--
-- Archive rule: COALESCE(<the row's own business date>, created_at)
-- earlier than 2026-07-08. The COALESCE fallback matters — a chunk of
-- imported rows carry no business date at all (6 expenses, 136 payroll,
-- 30 VRF, 40 timesheet). All of them were created between 2026-06-16
-- and 2026-06-30, i.e. squarely in the Airtable-import window and
-- comfortably before the cutoff, so created_at classifies them
-- correctly rather than leaving them stranded and visible.
-- ============================================================

SET search_path TO public;

-- ── 1. The flag ─────────────────────────────────────────────────────
ALTER TABLE expenses                    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE transfers                   ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sales                       ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cash_advances               ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payroll                     ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders                      ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE timesheet                   ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendor_receipt_facilitation ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN expenses.is_archived IS
  'True for pre-FY2026/27 rows carried over from the Airtable import. Hidden from lists, pickers and dashboard aggregates; still fetchable by id. Does not affect account balances (those anchor at 2026-07-07 already).';

-- ── 2. Backfill ─────────────────────────────────────────────────────
-- DEFAULT false means new rows are active without anyone thinking about
-- it; only the historical set is flipped here. Each statement is
-- naturally idempotent (re-running sets the same rows to the same value).
UPDATE expenses                    SET is_archived = true WHERE COALESCE(date,       created_at::date) < DATE '2026-07-08' AND NOT is_archived;
UPDATE transfers                   SET is_archived = true WHERE COALESCE(date,       created_at::date) < DATE '2026-07-08' AND NOT is_archived;
UPDATE sales                       SET is_archived = true WHERE COALESCE(date,       created_at::date) < DATE '2026-07-08' AND NOT is_archived;
UPDATE cash_advances               SET is_archived = true WHERE COALESCE(date_given, created_at::date) < DATE '2026-07-08' AND NOT is_archived;
UPDATE payroll                     SET is_archived = true WHERE COALESCE(end_date,   created_at::date) < DATE '2026-07-08' AND NOT is_archived;
UPDATE orders                      SET is_archived = true WHERE COALESCE(order_date, created_at::date) < DATE '2026-07-08' AND NOT is_archived;
UPDATE timesheet                   SET is_archived = true WHERE COALESCE(date,       created_at::date) < DATE '2026-07-08' AND NOT is_archived;
UPDATE vendor_receipt_facilitation SET is_archived = true WHERE COALESCE(trxn_date,  created_at::date) < DATE '2026-07-08' AND NOT is_archived;

-- ── 3. Indexes ──────────────────────────────────────────────────────
-- Partial, on the active side only: every list query filters
-- is_archived = false, and after this migration that is the small
-- minority of rows (4 of 2,320 expenses, 27 of 759 transfers).
CREATE INDEX IF NOT EXISTS idx_expenses_active      ON expenses(date)                    WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_transfers_active     ON transfers(date)                   WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_sales_active         ON sales(date)                       WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_cash_advances_active ON cash_advances(date_given)         WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_payroll_active       ON payroll(end_date)                 WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_orders_active        ON orders(order_date)                WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_timesheet_active     ON timesheet(date)                   WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_vrf_active           ON vendor_receipt_facilitation(trxn_date) WHERE NOT is_archived;

-- ── 4. What's hidden, at a glance ───────────────────────────────────
-- So "where did my data go?" has a one-query answer, and so anyone can
-- confirm the archive did what it claims before trusting it.
CREATE OR REPLACE VIEW v_archive_summary
WITH (security_invoker = true) AS
SELECT 'expenses' AS table_name,
       count(*) FILTER (WHERE is_archived)     AS archived,
       count(*) FILTER (WHERE NOT is_archived) AS active,
       count(*)                                AS total
FROM expenses
UNION ALL SELECT 'transfers',                   count(*) FILTER (WHERE is_archived), count(*) FILTER (WHERE NOT is_archived), count(*) FROM transfers
UNION ALL SELECT 'sales',                       count(*) FILTER (WHERE is_archived), count(*) FILTER (WHERE NOT is_archived), count(*) FROM sales
UNION ALL SELECT 'cash_advances',               count(*) FILTER (WHERE is_archived), count(*) FILTER (WHERE NOT is_archived), count(*) FROM cash_advances
UNION ALL SELECT 'payroll',                     count(*) FILTER (WHERE is_archived), count(*) FILTER (WHERE NOT is_archived), count(*) FROM payroll
UNION ALL SELECT 'orders',                      count(*) FILTER (WHERE is_archived), count(*) FILTER (WHERE NOT is_archived), count(*) FROM orders
UNION ALL SELECT 'timesheet',                   count(*) FILTER (WHERE is_archived), count(*) FILTER (WHERE NOT is_archived), count(*) FROM timesheet
UNION ALL SELECT 'vendor_receipt_facilitation', count(*) FILTER (WHERE is_archived), count(*) FILTER (WHERE NOT is_archived), count(*) FROM vendor_receipt_facilitation;

GRANT SELECT ON v_archive_summary TO authenticated;

-- ── 5. Un-archive escape hatch ──────────────────────────────────────
-- The reversal this migration promises, as a real callable rather than
-- a comment telling someone to hand-write UPDATEs against 8 tables.
CREATE OR REPLACE FUNCTION unarchive_all()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can un-archive historical data';
  END IF;

  UPDATE expenses                    SET is_archived = false WHERE is_archived;
  UPDATE transfers                   SET is_archived = false WHERE is_archived;
  UPDATE sales                       SET is_archived = false WHERE is_archived;
  UPDATE cash_advances               SET is_archived = false WHERE is_archived;
  UPDATE payroll                     SET is_archived = false WHERE is_archived;
  UPDATE orders                      SET is_archived = false WHERE is_archived;
  UPDATE timesheet                   SET is_archived = false WHERE is_archived;
  UPDATE vendor_receipt_facilitation SET is_archived = false WHERE is_archived;
END;
$$;

GRANT EXECUTE ON FUNCTION unarchive_all() TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
-- Expect roughly: expenses 2316/4, transfers 732/27, sales 125/0,
-- cash_advances 9/0, payroll 216/1, timesheet 1314/0, vrf 30/0.
SELECT * FROM v_archive_summary ORDER BY table_name;

-- Nothing dated on or after the cutoff may be archived, and nothing
-- before it may be left active. Both expect zero rows.
SELECT 'wrongly archived' AS problem, id, date FROM expenses
WHERE is_archived AND COALESCE(date, created_at::date) >= DATE '2026-07-08'
UNION ALL
SELECT 'wrongly active', id, date FROM expenses
WHERE NOT is_archived AND COALESCE(date, created_at::date) < DATE '2026-07-08';

-- Balances must be identical before and after this migration.
SELECT account_name, balance FROM v_account_balances
WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';
