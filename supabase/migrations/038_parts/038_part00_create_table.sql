-- Run this FIRST. Creates a staging table for the Airtable expense seed.
-- Run parts 01-09 next (each adds a batch of rows), then part10 last
-- (which applies everything to the real expenses table and cleans up).
--
-- This is a regular table (not TEMP) so it survives across the separate
-- "Run" executions needed to paste this large dataset in small pieces.

CREATE TABLE IF NOT EXISTS _exp_import (
  expense_code   TEXT,
  description    TEXT,
  amount         NUMERIC,
  expense_date   DATE,
  paid           BOOLEAN,
  vendor_name    TEXT,
  expense_type   TEXT
);
