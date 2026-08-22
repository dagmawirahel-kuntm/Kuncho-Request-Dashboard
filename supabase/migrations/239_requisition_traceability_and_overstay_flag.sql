-- Labor requisition traceability + a passive signal for the "what's
-- the point of the time frame" question.
--
-- 1. `labor_allocations.labor_requisition_id` already exists and is
--    what everything downstream (attendance pay terms, rollup, auto-
--    crew) keys off — but it was only ever populated by the two
--    requisition-driven paths (Tier 2 HR candidate provisioning, roster
--    "Request for project"). The generic "Assign staff" form on the
--    Project Workspace page never asked for it, so any Tier 2 hire made
--    that way was untraceable back to a requisition. Enforced here at
--    INSERT time only (not UPDATE, so editing an existing legacy
--    allocation that predates this doesn't suddenly start failing).
--
-- 2. `labor_requisitions.start_date/end_date` only ever fed the
--    original budget estimate — nothing compared it against how long a
--    worker's actual allocation ran. Adds a read-only view flagging an
--    active allocation whose requisition's window has already closed
--    but the allocation itself has no end date, or one that runs past
--    it — informational only, no blocking, per the "passive flag"
--    option discussed (a hard block risks stopping real payroll over a
--    paperwork lag, which is the actual failure mode seen live today).

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.enforce_tier2_allocation_requisition_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_emp_type text;
BEGIN
  SELECT employment_type INTO v_emp_type FROM staff WHERE id = NEW.staff_id;
  IF v_emp_type = 'tier_2_casual' AND NEW.labor_requisition_id IS NULL THEN
    RAISE EXCEPTION 'A Tier 2 casual worker must be allocated from an approved labor requisition — pick one instead of assigning directly';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_enforce_tier2_allocation_requisition_link ON labor_allocations;
CREATE TRIGGER trg_enforce_tier2_allocation_requisition_link
  BEFORE INSERT ON labor_allocations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tier2_allocation_requisition_link();

CREATE OR REPLACE VIEW public.v_overstayed_labor_allocations AS
SELECT
  la.id AS allocation_id,
  la.staff_id,
  s.employee_name,
  la.project_id,
  p.project_name,
  la.start_date AS allocation_start,
  la.end_date AS allocation_end,
  lr.id AS requisition_id,
  lr.role_needed,
  lr.end_date AS requisition_end,
  (CURRENT_DATE - lr.end_date) AS days_past_requisition
FROM labor_allocations la
JOIN labor_requisitions lr ON lr.id = la.labor_requisition_id
JOIN staff s ON s.id = la.staff_id
LEFT JOIN projects p ON p.id = la.project_id
WHERE la.status = 'active'
  AND lr.end_date IS NOT NULL
  AND lr.end_date < CURRENT_DATE
  AND (la.end_date IS NULL OR la.end_date > lr.end_date);

GRANT SELECT ON public.v_overstayed_labor_allocations TO authenticated;
