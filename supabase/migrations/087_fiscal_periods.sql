-- ============================================================
-- fiscal_periods: the Ethiopian fiscal year backbone for the
-- "fresh platform" default view and future tax/audit reporting.
--
-- Boundaries are Hamle 1 -> Sene 30 (the Ethiopian government/business
-- fiscal year), NOT the Ethiopian new year (Meskerem 1) and NOT a
-- fixed "1 July" assumption. Computed with this repo's own verified
-- Gregorian<->Ethiopian conversion (src/lib/ethiopianCalendar.ts,
-- Fliegel & Van Flandern JDN algorithm, round-trip tested 1980-2040):
--   FY2024/25: Hamle 1, 2016 EC -> Sene 30, 2017 EC = 2024-07-08 to 2025-07-07
--   FY2025/26: Hamle 1, 2017 EC -> Sene 30, 2018 EC = 2025-07-08 to 2026-07-07
--   FY2026/27: Hamle 1, 2018 EC -> Sene 30, 2019 EC = 2026-07-08 to 2027-07-07
-- Confirmed against live data: the earliest genuine transaction date
-- anywhere in the database is 2025-04-09 (transfers, cash_advances),
-- which falls in FY2024/25 -- so that's as far back as this seeds.
-- A new row must be added before 2027-07-08 for FY2027/28, same as
-- any other year-rollover reference table.
--
-- is_current is enforced single-row via a partial unique index rather
-- than application logic, so it can never silently drift to zero or
-- multiple true rows.
--
-- This table is NEW, so per the standing RLS-governance rule it is
-- enabled with a real policy from creation -- not added to the
-- already-flagged 24-table RLS gap. Read is open to any authenticated
-- user (every dashboard needs to read it for its default-view logic);
-- write (adding a new FY, flipping is_current) is admin-only, since
-- this is a rarely-touched structural reference table, same posture
-- as cost_groups.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT UNIQUE NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date > start_date)
);

-- One current period at a time, enforced at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_periods_one_current
  ON fiscal_periods (is_current) WHERE is_current;

-- Non-overlapping ranges, enforced at the DB level (requires btree_gist)
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE fiscal_periods DROP CONSTRAINT IF EXISTS fiscal_periods_no_overlap;
ALTER TABLE fiscal_periods ADD CONSTRAINT fiscal_periods_no_overlap
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&);

INSERT INTO fiscal_periods (label, start_date, end_date, is_current) VALUES
  ('FY2024/25', '2024-07-08', '2025-07-07', FALSE),
  ('FY2025/26', '2025-07-08', '2026-07-07', FALSE),
  ('FY2026/27', '2026-07-08', '2027-07-07', TRUE)
ON CONFLICT (label) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fiscal_periods_read" ON fiscal_periods;
CREATE POLICY "fiscal_periods_read" ON fiscal_periods FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "fiscal_periods_admin_write" ON fiscal_periods;
CREATE POLICY "fiscal_periods_admin_write" ON fiscal_periods FOR ALL
  USING (get_user_role() = 'admin');

-- Verify: 3 rows, exactly one is_current, no gaps/overlaps
SELECT label, start_date, end_date, is_current FROM fiscal_periods ORDER BY start_date;
SELECT count(*) FILTER (WHERE is_current) AS current_count FROM fiscal_periods;
