-- Labor requisitions can optionally name a target work order. Once the
-- resulting labor_allocations row actually goes 'active' (not merely
-- 'planned' — the same distinction discussed with the user: committed
-- vs. actually on site), the named worker is auto-added to that work
-- order's crew. This closes the loop raised in conversation: today,
-- approving a requisition creates a project-level allocation but never
-- connects that person to any specific work order — someone always had
-- to do that by hand afterward, even when the requisition was clearly
-- for one particular job.

ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_labor_requisitions_work_order ON labor_requisitions (work_order_id);

COMMENT ON COLUMN labor_requisitions.work_order_id IS
  'Optional target work order this requisition is for. Must belong to the same project. Drives auto-crewing once the resulting allocation becomes active — see trg_auto_crew_on_allocation_active.';

-- Cross-table check (CHECK constraints can't reference other tables):
-- reject a work_order_id that doesn't belong to this requisition's own
-- project, so auto-crewing below never has to reconcile a mismatch.
CREATE OR REPLACE FUNCTION public.validate_labor_req_work_order_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_wo_project_id uuid;
BEGIN
  IF NEW.work_order_id IS NOT NULL THEN
    SELECT project_id INTO v_wo_project_id FROM work_orders WHERE id = NEW.work_order_id;
    IF v_wo_project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'The selected work order does not belong to this requisition''s project';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_validate_labor_req_wo_project ON labor_requisitions;
CREATE TRIGGER trg_validate_labor_req_wo_project
  BEFORE INSERT OR UPDATE OF work_order_id, project_id ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.validate_labor_req_work_order_project();

-- Fires whenever a labor_allocations row becomes 'active' — on INSERT
-- already-active (provision_tier_2_worker_from_candidate creates them
-- this way) or on a later UPDATE from 'planned' to 'active' (the manual
-- path via on_labor_req_approved_maybe_allocate /
-- on_labor_req_approved_promote_candidate, both of which still create
-- 'planned' allocations by design — a human confirms the worker is
-- actually starting before this fires). One trigger point covers every
-- allocation-creation path uniformly instead of duplicating the
-- auto-crew logic across each of them.
--
-- SECURITY DEFINER: needs to write work_order_crew regardless of the
-- caller's own RLS standing there (e.g. an hr_officer flipping an
-- allocation to active has no direct work_order_crew grant), and
-- enforce_wo_crew_allocation (the Tier 2 eligibility trigger on
-- work_order_crew) re-reads labor_allocations/staff itself, which is
-- safe to invoke from here since the allocation this fires from is, by
-- definition, already active.
CREATE OR REPLACE FUNCTION public.auto_crew_on_allocation_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_wo_id uuid;
BEGIN
  IF NEW.status = 'active' AND NEW.labor_requisition_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    SELECT work_order_id INTO v_wo_id FROM labor_requisitions WHERE id = NEW.labor_requisition_id;
    IF v_wo_id IS NOT NULL THEN
      INSERT INTO work_order_crew (work_order_id, staff_id)
      VALUES (v_wo_id, NEW.staff_id)
      ON CONFLICT (work_order_id, staff_id) WHERE removed_at IS NULL DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_auto_crew_on_allocation_active ON labor_allocations;
CREATE TRIGGER trg_auto_crew_on_allocation_active
  AFTER INSERT OR UPDATE OF status ON labor_allocations
  FOR EACH ROW EXECUTE FUNCTION public.auto_crew_on_allocation_active();
