-- Rolling slot fulfillment for labor requisitions (Tier 2 masons etc.):
-- each candidate clears HR approval independently and is immediately
-- allocatable — the requisition doesn't wait for every slot to fill.

ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS slots_filled int NOT NULL DEFAULT 0;

ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS slots_status text GENERATED ALWAYS AS (
    CASE
      WHEN slots_filled = 0 THEN 'open'
      WHEN slots_filled >= headcount THEN 'filled'
      ELSE 'partial'
    END
  ) STORED;

-- SECURITY DEFINER: fires on `candidates` writes, which project_manager
-- can perform (self-scoped INSERT per migration 198's candidates_insert
-- policy) but project_manager is not in labor_requisitions_update's role
-- list — under SECURITY INVOKER that write would fail RLS mid-trigger.
CREATE OR REPLACE FUNCTION public.update_requisition_slot_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_req_id uuid;
BEGIN
  v_req_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.labor_requisition_id ELSE NEW.labor_requisition_id END;

  IF v_req_id IS NOT NULL THEN
    UPDATE labor_requisitions SET slots_filled = (
      SELECT count(*) FROM candidates WHERE labor_requisition_id = v_req_id AND outcome = 'hired'
    ) WHERE id = v_req_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.labor_requisition_id IS DISTINCT FROM NEW.labor_requisition_id
     AND OLD.labor_requisition_id IS NOT NULL THEN
    UPDATE labor_requisitions SET slots_filled = (
      SELECT count(*) FROM candidates WHERE labor_requisition_id = OLD.labor_requisition_id AND outcome = 'hired'
    ) WHERE id = OLD.labor_requisition_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $fn$;

DROP TRIGGER IF EXISTS trg_update_requisition_slot_status ON candidates;
CREATE TRIGGER trg_update_requisition_slot_status
  AFTER INSERT OR DELETE OR UPDATE OF outcome, labor_requisition_id ON candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_requisition_slot_status();

COMMENT ON COLUMN labor_requisitions.slots_filled IS
  'Count of candidates linked via candidates.labor_requisition_id with outcome=hired. Maintained by trg_update_requisition_slot_status; do not write directly.';
