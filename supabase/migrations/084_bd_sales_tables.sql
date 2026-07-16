-- ============================================================
-- Business Development / Sales tables.
--
-- `contracts` structures the KUN/CON contracts that today only exist
-- as Word documents — feeds the Stage 1 (contract signed) gate and
-- is the intended source of truth for projects.contract_value going
-- forward (this migration does not touch projects.contract_value
-- itself, which stays manually entered for now).
--
-- `opportunities` is the pre-sale pipeline that doesn't exist
-- anywhere today (proformas has exactly 1 row and isn't a pipeline).
--
-- Requires migration 081 (adds the `sales` role) to have already
-- committed — this migration's write policies reference it.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS contracts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_no        TEXT UNIQUE,
  client_id          UUID NOT NULL REFERENCES clients(id),
  project_id         UUID REFERENCES projects(id),
  contract_value     NUMERIC(14,2),
  signed_date        DATE,
  payment_terms      TEXT,
  wht_rate           NUMERIC(5,2),
  retention_percent  NUMERIC(5,2),
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'signed', 'active', 'completed', 'terminated')),
  document_url       TEXT,
  document_name      TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                TEXT NOT NULL,
  client_id            UUID REFERENCES clients(id),
  prospect_name        TEXT,
  estimated_value      NUMERIC(14,2),
  stage                TEXT NOT NULL DEFAULT 'lead'
                       CHECK (stage IN ('lead', 'qualified', 'quoted', 'won', 'lost')),
  owner_staff_id       UUID REFERENCES staff(id),
  expected_close_date  DATE,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_client ON opportunities(client_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Read: any authenticated user. Write: the owning department (sales)
-- plus admin/manager, per the §1 department->role map.
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_read" ON contracts;
CREATE POLICY "contracts_read" ON contracts FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "contracts_write" ON contracts;
CREATE POLICY "contracts_write" ON contracts FOR ALL
  USING (get_user_role() IN ('sales', 'admin', 'manager'));

DROP POLICY IF EXISTS "opportunities_read" ON opportunities;
CREATE POLICY "opportunities_read" ON opportunities FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "opportunities_write" ON opportunities;
CREATE POLICY "opportunities_write" ON opportunities FOR ALL
  USING (get_user_role() IN ('sales', 'admin', 'manager'));

-- Verify
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('contracts', 'opportunities') ORDER BY relname;
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('contracts', 'opportunities') ORDER BY tablename, policyname;
