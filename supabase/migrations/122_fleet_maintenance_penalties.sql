-- ============================================================
-- Fleet: maintenance requests + traffic penalties (spec §2).
--
-- vehicles (3 rows, 059) has no maintenance or penalty tracking today.
--
-- vehicle_maintenance_requests: single-tier approval (pending ->
-- approved/rejected -> completed), matching labor_requisitions'
-- shape. "Feeds Transport cost group" is satisfied the SAME way
-- Transport already works everywhere else in this codebase — neither
-- TransportPaymentFormPage nor FuelRequestFormPage auto-generate a
-- categorized expense; a human sets categories.category_id ('Transportation',
-- mapped to the Transport cost group in 072) on a real expenses row.
-- So this adds expense_id (nullable, reverse-linked once an expense is
-- created for the completed repair) rather than a second shadow ledger
-- or a new CTE in v_project_cost_group_budget — the latter would need
-- project_id, which fleet maintenance (shared infrastructure, not tied
-- to one project) generally doesn't have.
--
-- vehicle_penalties: track only, no GL posting — the user explicitly
-- deferred the tax-deductibility question (fines are often
-- non-deductible per ERCA) to an accountant, so this does NOT wire any
-- expense/GL link at all, just a record with a paid flag.
--
-- Both single-approval/no-approval-at-all and lightweight, matching
-- fleet's small scale (3 vehicles) — role set mirrors the existing
-- fleet access model (vehicles_manage / logistics_officer_all_transport
-- from 060b): admin/manager/logistics_officer (role or badge).
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS vehicle_maintenance_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        UUID NOT NULL REFERENCES vehicles(id),
  requested_by      UUID REFERENCES user_profiles(id),
  issue_description TEXT NOT NULL,
  estimated_cost    NUMERIC(12,2),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  approved_by       UUID REFERENCES user_profiles(id),
  approved_at       TIMESTAMPTZ,
  actual_cost       NUMERIC(12,2),
  completed_at      TIMESTAMPTZ,
  expense_id        UUID REFERENCES expenses(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_requests_vehicle ON vehicle_maintenance_requests(vehicle_id);

CREATE TABLE IF NOT EXISTS vehicle_penalties (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       UUID NOT NULL REFERENCES vehicles(id),
  driver_staff_id  UUID REFERENCES staff(id),
  penalty_date     DATE NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,
  reason           TEXT,
  paid             BOOLEAN NOT NULL DEFAULT false,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_penalties_vehicle ON vehicle_penalties(vehicle_id);

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE vehicle_maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_penalties ENABLE ROW LEVEL SECURITY;

-- Read: everyone (matches every other fleet/ops table's broad-read
-- convention — hse_incidents, onboarding_tasks, etc.)
DROP POLICY IF EXISTS "vehicle_maintenance_read" ON vehicle_maintenance_requests;
CREATE POLICY "vehicle_maintenance_read" ON vehicle_maintenance_requests FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Report an issue: any authenticated user can raise a maintenance
-- request against a vehicle they use — matches the spirit of "single
-- approval, lightweight," the request itself is open, only the
-- decision is gated.
DROP POLICY IF EXISTS "vehicle_maintenance_insert" ON vehicle_maintenance_requests;
CREATE POLICY "vehicle_maintenance_insert" ON vehicle_maintenance_requests FOR INSERT
  WITH CHECK (status = 'pending');

-- Approve/reject/complete/edit/delete: fleet's existing access model.
DROP POLICY IF EXISTS "vehicle_maintenance_manage" ON vehicle_maintenance_requests;
CREATE POLICY "vehicle_maintenance_manage" ON vehicle_maintenance_requests FOR ALL
  USING (
    get_user_role() IN ('admin', 'manager', 'logistics_officer')
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true)
  );

DROP POLICY IF EXISTS "vehicle_penalties_read" ON vehicle_penalties;
CREATE POLICY "vehicle_penalties_read" ON vehicle_penalties FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "vehicle_penalties_manage" ON vehicle_penalties;
CREATE POLICY "vehicle_penalties_manage" ON vehicle_penalties FOR ALL
  USING (
    get_user_role() IN ('admin', 'manager', 'logistics_officer')
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true)
  );

-- Verify
SELECT policyname, cmd FROM pg_policies WHERE tablename IN ('vehicle_maintenance_requests', 'vehicle_penalties') ORDER BY tablename, policyname;
