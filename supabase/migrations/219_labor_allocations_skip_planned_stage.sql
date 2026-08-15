-- Removes the "planned" holding stage from requisition-driven labor
-- allocations. Confirmed with the user: today, approving a requisition
-- through either the "roster" (name a specific staff member) or
-- "new hire" (multi-candidate) path creates the allocation as 'planned'
-- — and nothing in the app can ever promote it to 'active', since no
-- UI exists for that (the only workaround is delete-and-recreate via
-- Assign Staff). Since 'active' is required before a Tier 2 worker can
-- be added to any work order crew, or show up in Log Attendance at
-- all, this was a real dead end for two of the three hiring paths.
--
-- The third path — provision_tier_2_worker_from_candidate, the Tier 2
-- HR queue's approve action — already creates allocations as 'active'
-- directly (migration 214). This migration brings the other two paths
-- in line with it, so approving any requisition now means "this person
-- can work" immediately, and — since trg_auto_crew_on_allocation_active
-- (218) fires on any INSERT of an active allocation — auto-crews them
-- onto the requisition's target work order in the same step, if one was
-- named.
--
-- Not touched: v_project_cost_group_budget's labor_allocation_committed
-- CTE already treats 'planned' and 'active' identically for budget
-- purposes (WHERE status = ANY ('planned','active')), so this has no
-- effect on committed-budget figures — only on crew/attendance
-- eligibility. Also not touched: the manual "Assign Staff" form on the
-- Project Workspace page still lets someone explicitly pick 'planned'
-- for a genuinely future-scheduled hire outside the requisition flow.

CREATE OR REPLACE FUNCTION public.on_labor_req_approved_maybe_allocate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_rate numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.specific_staff_id IS NOT NULL THEN
    SELECT day_rate INTO v_rate FROM staff WHERE id = NEW.specific_staff_id;
    INSERT INTO labor_allocations
      (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
    VALUES
      (NEW.specific_staff_id, NEW.project_id,
       COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
       COALESCE(NEW.estimated_day_rate, v_rate),
       'active',
       'Auto-created from approved roster request ' || NEW.id::text,
       NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.on_labor_req_approved_promote_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_row      labor_requisition_candidates%ROWTYPE;
  v_cand     candidates%ROWTYPE;
  v_new_id   uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    FOR v_row IN
      SELECT * FROM labor_requisition_candidates
       WHERE requisition_id = NEW.id
         AND promoted_staff_id IS NULL
    LOOP
      SELECT * INTO v_cand FROM candidates WHERE id = v_row.candidate_id;
      IF v_cand.id IS NULL THEN
        RAISE EXCEPTION 'Candidate % not found for requisition %', v_row.candidate_id, NEW.id;
      END IF;

      INSERT INTO staff
        (employee_name, phone_number, email, employment_type, status,
         trade_tag, day_rate, first_engaged_at)
      VALUES
        (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
         NEW.trade_tag, NEW.estimated_day_rate, COALESCE(NEW.start_date, CURRENT_DATE))
      RETURNING id INTO v_new_id;

      UPDATE candidates
         SET outcome = 'hired',
             outcome_notes = COALESCE(outcome_notes, '') ||
               CASE WHEN outcome_notes IS NULL OR outcome_notes = '' THEN '' ELSE E'\n' END ||
               'Hired via labor requisition ' || NEW.id::text,
             updated_at = now()
       WHERE id = v_row.candidate_id;

      UPDATE labor_requisition_candidates
         SET promoted_staff_id = v_new_id
       WHERE requisition_id = NEW.id AND candidate_id = v_row.candidate_id;

      INSERT INTO labor_allocations
        (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
      VALUES
        (v_new_id, NEW.project_id,
         COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
         NEW.estimated_day_rate,
         'active',
         'Auto-created from approved requisition ' || NEW.id::text
           || ' · candidate ' || v_row.candidate_id::text,
         NEW.id);
    END LOOP;

    IF EXISTS (SELECT 1 FROM labor_requisition_candidates WHERE requisition_id = NEW.id) THEN
      NEW.specific_staff_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
