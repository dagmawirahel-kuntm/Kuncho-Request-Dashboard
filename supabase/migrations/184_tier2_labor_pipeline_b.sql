-- 184 — Tier 2 labor pipeline · Part B: commitments audit + approval guard
--
-- The existing `v_project_cost_group_budget` view already pulls approved
-- labor_requisitions into the Labor cost group as committed_amount, so this
-- migration does NOT add a second parallel path into the budget view (that
-- would double-count). Instead:
--
-- * `labor_commitments` is an audit-trail table that records who approved a
--   requisition, how much was locked, and tracks the release lifecycle
--   (active → released once paid off, or closed if the requisition is voided).
-- * A BEFORE UPDATE trigger enforces the spec's rule that only HR/admin may
--   push a requisition to status='approved' — that flip is what commits money
--   against the project budget.
-- * The approval AFTER-trigger inserts the audit row.
--
-- The lifecycle transitions labor_commitments.status → 'released' are the
-- rollup RPC's job (Migration C) — that side of the loop needs the RPC to
-- exist first.

SET search_path TO public;

-- ── labor_commitments (audit) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_commitments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  labor_requisition_id  uuid NOT NULL REFERENCES labor_requisitions(id) ON DELETE CASCADE,
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  committed_amount      numeric NOT NULL,
  released_amount       numeric NOT NULL DEFAULT 0,
  committed_at          timestamptz NOT NULL DEFAULT now(),
  committed_by          uuid,
  status                text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','closed')),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (labor_requisition_id)
);

CREATE INDEX IF NOT EXISTS idx_labor_commitments_project ON labor_commitments (project_id, status);

-- ── approval guard (BEFORE): only HR / admin may push to approved ────────────
CREATE OR REPLACE FUNCTION public.enforce_labor_req_approval_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_role user_role;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    v_role := public.get_user_role();
    IF v_role NOT IN ('admin','hr_officer') THEN
      RAISE EXCEPTION 'Only HR or admin may approve a labor requisition';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_labor_req_approval_authority ON labor_requisitions;
CREATE TRIGGER trg_labor_req_approval_authority
  BEFORE UPDATE OF status ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_labor_req_approval_authority();

-- ── commitment insert (AFTER approval) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_insert_commitment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_amount numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    v_amount := COALESCE(NEW.estimated_total_cost,
                         NEW.estimated_day_rate * COALESCE(NEW.estimated_days, 0) * NEW.headcount);
    INSERT INTO labor_commitments
      (labor_requisition_id, project_id, committed_amount, committed_by, status, notes)
    VALUES
      (NEW.id, NEW.project_id, v_amount, NEW.approved_by, 'active',
       'Auto-committed on approval')
    ON CONFLICT (labor_requisition_id) DO UPDATE
      SET committed_amount = EXCLUDED.committed_amount,
          committed_at     = now(),
          committed_by     = EXCLUDED.committed_by,
          status           = 'active',
          updated_at       = now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_labor_req_commit_on_approval ON labor_requisitions;
CREATE TRIGGER trg_labor_req_commit_on_approval
  AFTER UPDATE OF status ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.on_labor_req_approved_insert_commitment();

-- ── v_project_labor_commitments — reporting view ─────────────────────────────
CREATE OR REPLACE VIEW public.v_project_labor_commitments AS
SELECT
  c.id                     AS commitment_id,
  c.project_id,
  p.project_name,
  c.labor_requisition_id,
  lr.role_needed,
  lr.headcount,
  lr.payment_model,
  lr.gang_leader_vendor_id,
  v.vendor_name            AS gang_leader_vendor_name,
  lr.pay_cycle,
  lr.start_date            AS req_start_date,
  lr.end_date              AS req_end_date,
  c.committed_amount,
  c.released_amount,
  (c.committed_amount - c.released_amount) AS outstanding_amount,
  c.status,
  c.committed_at,
  c.committed_by
FROM labor_commitments c
JOIN projects          p  ON p.id  = c.project_id
JOIN labor_requisitions lr ON lr.id = c.labor_requisition_id
LEFT JOIN vendors      v  ON v.id  = lr.gang_leader_vendor_id;

GRANT SELECT ON public.v_project_labor_commitments TO authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE labor_commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lc_read ON labor_commitments;
CREATE POLICY lc_read ON labor_commitments FOR SELECT
  USING (
    public.get_user_role() IN ('admin','executive','hr_officer','finance')
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = labor_commitments.project_id
        AND p.project_manager_id = public.current_staff_id()
    )
  );

-- No direct INSERT/UPDATE/DELETE for authenticated users — trigger managed.
GRANT SELECT ON labor_commitments TO authenticated;
