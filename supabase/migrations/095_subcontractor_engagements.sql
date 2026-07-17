-- ============================================================
-- Subcontract: its own lightweight engagement object, not riding on
-- the generic orders/expenses path anymore.
--
-- subcontractor_engagements is the Subcontract-cost-group equivalent
-- of a PO. subcontractor_completion_certificates is the equivalent of
-- a GRN — proof of delivered work before payment.
--
-- IMPORTANT CORRECTION vs. the original ask: there is no existing
-- "an expense requires a GRN" hard block to mirror — a GRN existing
-- only flips a sourcing_bundle to 'fulfilled' (migration 063,
-- mark_bundle_fulfilled_on_grn, AFTER INSERT); nothing today stops an
-- expense being created with no bundle/GRN link at all. The trigger
-- below is a genuinely new kind of gate on the expenses table, not a
-- mirror of something that already existed.
--
-- Per explicit decision: only admin can push an expense through
-- without a certificate (not manager/finance, unlike most other
-- override-capable triggers in this schema), and doing so is
-- permanently timestamped on the expense row itself
-- (subcontract_cert_override_by/_at) — a visible admission that this
-- particular expense bypassed the check, not a silent pass-through.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION default_subcontract_cost_group_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM cost_groups WHERE name = 'Subcontract' LIMIT 1
$$;

CREATE TABLE IF NOT EXISTS subcontractor_engagements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id              UUID NOT NULL REFERENCES vendors(id),
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_group_id          UUID REFERENCES cost_groups(id) DEFAULT default_subcontract_cost_group_id(),
  scope_of_work          TEXT,
  agreed_amount          NUMERIC(14,2) NOT NULL,
  start_date             DATE,
  target_completion_date DATE,
  percent_complete       NUMERIC(5,2) NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'drafting'
    CHECK (status IN ('drafting', 'agreed', 'in_progress', 'completed', 'terminated')),
  approved_by            UUID REFERENCES user_profiles(id),
  approved_at            TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontractor_engagements_project ON subcontractor_engagements(project_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_engagements_vendor ON subcontractor_engagements(vendor_id);

DROP TRIGGER IF EXISTS trg_subcontractor_engagements_updated_at ON subcontractor_engagements;
CREATE TRIGGER trg_subcontractor_engagements_updated_at
  BEFORE UPDATE ON subcontractor_engagements
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS subcontractor_completion_certificates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          UUID NOT NULL REFERENCES subcontractor_engagements(id) ON DELETE CASCADE,
  certified_amount       NUMERIC(14,2) NOT NULL,
  percent_of_scope_at_cert NUMERIC(5,2),
  certified_by           UUID REFERENCES user_profiles(id),
  certified_at           TIMESTAMPTZ DEFAULT NOW(),
  notes                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontractor_certs_engagement ON subcontractor_completion_certificates(engagement_id);

-- ── expenses: link to an engagement, and the certificate gate ──────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subcontractor_engagement_id UUID REFERENCES subcontractor_engagements(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subcontract_cert_override_by UUID REFERENCES user_profiles(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subcontract_cert_override_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION require_subcontract_certificate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_has_cert BOOLEAN;
BEGIN
  -- Only applies to expenses actually tagged against an engagement —
  -- every other expense (Materials, Labor, Transport, Overhead, and
  -- any subcontract expense not yet linked) is completely unaffected.
  IF NEW.subcontractor_engagement_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM subcontractor_completion_certificates
    WHERE engagement_id = NEW.subcontractor_engagement_id
  ) INTO v_has_cert;

  IF v_has_cert THEN
    RETURN NEW;
  END IF;

  IF get_user_role() = 'admin' THEN
    NEW.subcontract_cert_override_by := auth.uid();
    NEW.subcontract_cert_override_at := NOW();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This subcontractor engagement has no completion certificate on record yet — an expense cannot be recorded against it until one exists';
END;
$$;

DROP TRIGGER IF EXISTS trg_require_subcontract_certificate ON expenses;
CREATE TRIGGER trg_require_subcontract_certificate
  BEFORE INSERT OR UPDATE OF subcontractor_engagement_id ON expenses
  FOR EACH ROW EXECUTE FUNCTION require_subcontract_certificate();

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE subcontractor_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_completion_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subcontractor_engagements_read" ON subcontractor_engagements;
CREATE POLICY "subcontractor_engagements_read" ON subcontractor_engagements FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "subcontractor_engagements_write" ON subcontractor_engagements;
CREATE POLICY "subcontractor_engagements_write" ON subcontractor_engagements FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'project_manager', 'procurement_officer'));

DROP POLICY IF EXISTS "subcontractor_certs_read" ON subcontractor_completion_certificates;
CREATE POLICY "subcontractor_certs_read" ON subcontractor_completion_certificates FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "subcontractor_certs_write" ON subcontractor_completion_certificates;
CREATE POLICY "subcontractor_certs_write" ON subcontractor_completion_certificates FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'project_manager', 'procurement_officer'));

-- Verify
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('subcontractor_engagements', 'subcontractor_completion_certificates');
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('subcontractor_engagements', 'subcontractor_completion_certificates') ORDER BY tablename, policyname;
