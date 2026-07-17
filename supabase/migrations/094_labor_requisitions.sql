-- ============================================================
-- Labor, Tier 2: genuinely new labor cost — casual/day hires, a
-- specialist not on the roster. One approval tier, deliberately
-- lighter than the Materials PO chain (no multi-step approval), but
-- a real gate unlike Tier 1's routine assignment logging.
--
-- estimated_total_cost needs headcount x estimated_day_rate x "days",
-- but the spec's own field list leaves end_date nullable (open-ended
-- engagements are real — a casual hire without a fixed known end
-- date). Deriving days from start_date/end_date would make the
-- generated column undefined whenever end_date is null. Added an
-- explicit estimated_days input instead of deriving one, so an
-- open-ended requisition can still carry a cost estimate.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS labor_requisitions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_needed          TEXT NOT NULL,
  headcount            INT NOT NULL DEFAULT 1 CHECK (headcount > 0),
  is_casual_or_new     BOOLEAN NOT NULL DEFAULT TRUE,
  start_date           DATE NOT NULL,
  end_date             DATE,
  estimated_day_rate   NUMERIC(12,2) NOT NULL,
  estimated_days       NUMERIC(6,1),
  estimated_total_cost NUMERIC(14,2) GENERATED ALWAYS AS
    (headcount * estimated_day_rate * COALESCE(estimated_days, 0)) STORED,
  requested_by         UUID REFERENCES user_profiles(id),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by          UUID REFERENCES user_profiles(id),
  approved_at          TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labor_requisitions_project ON labor_requisitions(project_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE labor_requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "labor_requisitions_read" ON labor_requisitions;
CREATE POLICY "labor_requisitions_read" ON labor_requisitions FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "labor_requisitions_request" ON labor_requisitions;
CREATE POLICY "labor_requisitions_request" ON labor_requisitions FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'manager', 'project_manager', 'operations_manager', 'hr_officer'));

-- Only the approving roles (or admin) can change status — matches the
-- "one approval tier, reuse operations_manager/hr_officer" decision.
DROP POLICY IF EXISTS "labor_requisitions_approve" ON labor_requisitions;
CREATE POLICY "labor_requisitions_approve" ON labor_requisitions FOR UPDATE
  USING (get_user_role() IN ('admin', 'operations_manager', 'hr_officer'));

DROP POLICY IF EXISTS "labor_requisitions_delete" ON labor_requisitions;
CREATE POLICY "labor_requisitions_delete" ON labor_requisitions FOR DELETE
  USING (get_user_role() IN ('admin', 'operations_manager', 'hr_officer'));

-- Verify
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'labor_requisitions';
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'labor_requisitions' ORDER BY policyname;
