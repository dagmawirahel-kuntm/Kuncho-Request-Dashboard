-- Run this FIRST. Creates a staging table for the expense→project merge.
-- Run parts 01-08 next (each adds a batch of rows), then part09_apply
-- last (which applies everything to the real expenses table and cleans up).
--
-- This is a regular table (not TEMP) so it survives across the separate
-- "Run" executions needed to paste this large dataset in small pieces.

CREATE TABLE IF NOT EXISTS _exp_project_import (
  expense_code TEXT,
  project_name TEXT
);

TRUNCATE _exp_project_import;
