-- ============================================================
-- HSE (Health, Safety & Environment) department tables — no tables
-- exist today; the mandate is safety, inductions, and incidents.
--
-- Requires migration 081 (adds the `hse_officer` role) to have
-- already committed — this migration's write policies reference it.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS hse_incidents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID REFERENCES projects(id),
  location_id       UUID REFERENCES locations(id),
  incident_date     DATE NOT NULL,
  incident_type     TEXT NOT NULL
                    CHECK (incident_type IN ('near_miss', 'first_aid', 'injury', 'property_damage', 'environmental', 'other')),
  severity          TEXT NOT NULL
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description       TEXT,
  immediate_action  TEXT,
  reported_by       UUID REFERENCES user_profiles(id),
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'investigating', 'closed')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hse_incidents_project ON hse_incidents(project_id);

CREATE TABLE IF NOT EXISTS hse_inductions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id              UUID REFERENCES staff(id),
  person_name           TEXT,
  project_id            UUID REFERENCES projects(id),
  induction_date        DATE NOT NULL,
  inducted_by_staff_id  UUID REFERENCES staff(id),
  valid_until           DATE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hse_inductions_project ON hse_inductions(project_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Read: any authenticated user. Write: the owning department
-- (hse_officer) plus admin/manager, per the §1 department->role map.
ALTER TABLE hse_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hse_inductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hse_incidents_read" ON hse_incidents;
CREATE POLICY "hse_incidents_read" ON hse_incidents FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "hse_incidents_write" ON hse_incidents;
CREATE POLICY "hse_incidents_write" ON hse_incidents FOR ALL
  USING (get_user_role() IN ('hse_officer', 'admin', 'manager'));

DROP POLICY IF EXISTS "hse_inductions_read" ON hse_inductions;
CREATE POLICY "hse_inductions_read" ON hse_inductions FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "hse_inductions_write" ON hse_inductions;
CREATE POLICY "hse_inductions_write" ON hse_inductions FOR ALL
  USING (get_user_role() IN ('hse_officer', 'admin', 'manager'));

-- Verify
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('hse_incidents', 'hse_inductions') ORDER BY relname;
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('hse_incidents', 'hse_inductions') ORDER BY tablename, policyname;
