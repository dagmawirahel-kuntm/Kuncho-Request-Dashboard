-- Run this FIRST. Creates a staging table for the expense->project merge.
-- Run parts 01-10 next (each adds a batch of rows), then part11_apply
-- last (which applies everything to the real expenses table and cleans up).
--
-- IMPORTANT: run migration 067 (fix_expense_code_immutable_on_update)
-- BEFORE this, if you haven't already. Without it, the UPDATE in
-- part11_apply (which sets project_id) will silently rewrite
-- expense_code again via the old buggy trigger.
--
-- This is a regular table (not TEMP) so it survives across the separate
-- "Run" executions needed to paste this large dataset in small pieces.

CREATE TABLE IF NOT EXISTS _exp_project_import (
  expense_code      TEXT,
  project_name      TEXT,
  vendor_name_norm  TEXT,
  expense_date      DATE,
  amount            NUMERIC,
  composite_unique  BOOLEAN
);

TRUNCATE _exp_project_import;
