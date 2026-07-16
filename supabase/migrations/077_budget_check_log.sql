-- ============================================================
-- Audit trail for point-of-spend budget checks on PR/PO creation.
-- Written client-side at submit time (the check itself runs against
-- v_project_cost_group_budget, computed in the browser before the
-- real PR/PO insert) — this just records what the check found, for
-- every submission, regardless of outcome. In warn-only mode nothing
-- here ever blocks anything; it's the evidence trail that will let a
-- human confirm Phase 1's numbers are trustworthy before the
-- (not-yet-built) enforcing path ships.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS budget_check_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  source            TEXT NOT NULL CHECK (source IN ('pr', 'po')),
  source_ref        TEXT,                                    -- e.g. request_code / bundle_code, for a human-readable trail
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  cost_group_id     UUID REFERENCES cost_groups(id),
  requested_amount  NUMERIC(14,2) NOT NULL,
  remaining_before  NUMERIC(14,2),
  outcome           TEXT NOT NULL CHECK (outcome IN ('allow', 'warn', 'block', 'unavailable')),
  mode              TEXT NOT NULL CHECK (mode IN ('warn_only', 'enforcing')),
  created_by        UUID REFERENCES user_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_budget_check_log_project ON budget_check_log(project_id);

ALTER TABLE budget_check_log ENABLE ROW LEVEL SECURITY;

-- Anyone who can raise a PR or PO needs to be able to write the log
-- entry for their own submission
DROP POLICY IF EXISTS "budget_check_log_insert" ON budget_check_log;
CREATE POLICY "budget_check_log_insert" ON budget_check_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "budget_check_log_read" ON budget_check_log;
CREATE POLICY "budget_check_log_read" ON budget_check_log FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance'));

GRANT SELECT, INSERT ON budget_check_log TO authenticated;

-- Verify
SELECT table_name FROM information_schema.tables WHERE table_name = 'budget_check_log';
