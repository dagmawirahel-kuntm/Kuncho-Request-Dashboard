-- Confirmed live: the entire Tier 2 casual roster was silently doubled
-- -- 73 staff rows down to 44 after cleanup, one duplicate pair per
-- name. provision_tier_2_worker_from_candidate() always minted a fresh
-- `staff` row on approval, with no check for whether that person was
-- already on the roster (e.g. re-submitted as a "new" candidate for a
-- different trade/project). Each duplicate then sat as an untraceable
-- ghost with zero linked activity -- except when something picked the
-- wrong copy, like a work order's assigned_lead_staff_id, which is
-- exactly what made this visible: Besufekad's own work order pointed
-- at his duplicate rather than the real record with his attendance
-- history, which is why the two looked impossible to tell apart.
--
-- Fix: de-dupe by phone number (the one field that reliably identifies
-- the same real person) before inserting a new staff row. Name alone
-- isn't used as a match key -- two different real people can share a
-- name, and wrongly merging them would be worse than a duplicate.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.provision_tier_2_worker_from_candidate(p_candidate_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_role     user_role;
  v_cand     candidates%ROWTYPE;
  v_req      labor_requisitions%ROWTYPE;
  v_new_id   uuid;
  v_actor_id uuid;
BEGIN
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'executive', 'hr_officer') THEN
    RAISE EXCEPTION 'Only admin/executive/HR may approve and provision a Tier 2 candidate';
  END IF;

  SELECT * INTO v_cand FROM candidates WHERE id = p_candidate_id;
  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'Candidate % not found', p_candidate_id;
  END IF;
  IF v_cand.candidate_type <> 'tier_2_casual' THEN
    RAISE EXCEPTION 'Candidate % is not a Tier 2 casual candidate', p_candidate_id;
  END IF;
  IF v_cand.outcome <> 'pending' THEN
    RAISE EXCEPTION 'Candidate % has already been decided (outcome: %)', p_candidate_id, v_cand.outcome;
  END IF;

  IF v_cand.labor_requisition_id IS NOT NULL THEN
    SELECT * INTO v_req FROM labor_requisitions WHERE id = v_cand.labor_requisition_id;
  END IF;

  v_actor_id := public.current_staff_id();

  IF v_cand.phone IS NOT NULL AND btrim(v_cand.phone) <> '' THEN
    SELECT id INTO v_new_id FROM staff
     WHERE employment_type = 'tier_2_casual' AND status = 'active'
       AND phone_number = v_cand.phone
     LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    INSERT INTO staff
      (employee_name, phone_number, email, employment_type, status,
       trade_tag, day_rate, first_engaged_at)
    VALUES
      (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
       v_cand.trade_tag, v_req.estimated_day_rate, CURRENT_DATE)
    RETURNING id INTO v_new_id;
  END IF;

  UPDATE candidates
     SET outcome = 'hired',
         hr_approved_by_staff_id = v_actor_id,
         hr_approved_at = now(),
         provisioned_staff_id = v_new_id,
         updated_at = now()
   WHERE id = p_candidate_id;

  IF v_req.id IS NOT NULL THEN
    INSERT INTO labor_allocations
      (staff_id, project_id, start_date, status, assigned_by, notes, labor_requisition_id)
    VALUES
      (v_new_id, v_req.project_id, CURRENT_DATE, 'active', auth.uid(),
       'Provisioned via Tier 2 HR queue from candidate ' || p_candidate_id::text ||
       ' for requisition ' || v_req.id::text,
       v_req.id);
  END IF;

  RETURN v_new_id;
END $function$;
