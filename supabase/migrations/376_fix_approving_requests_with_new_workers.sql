-- 376 — Approving a labour request with new workers failed
--
-- Hiring the new people on a request ran BEFORE the approval was saved.
-- It creates each worker's allocation, and since 362 an allocation updates
-- its request's filled count — the very row still being saved — so every
-- approval of a request naming new people failed with "tuple to be updated
-- was already modified". It now runs after the approval is saved.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.on_labor_req_approved_promote_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_row      labor_requisition_candidates%ROWTYPE;
  v_cand     candidates%ROWTYPE;
  v_new_id   uuid;
  v_rate     numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    v_rate := CASE WHEN NEW.payment_basis = 'per_volume' THEN NEW.unit_rate
                   WHEN NEW.payment_basis = 'per_day' THEN NEW.estimated_day_rate END;
    FOR v_row IN
      SELECT * FROM labor_requisition_candidates
       WHERE requisition_id = NEW.id AND promoted_staff_id IS NULL
    LOOP
      SELECT * INTO v_cand FROM candidates WHERE id = v_row.candidate_id;
      IF v_cand.id IS NULL THEN
        RAISE EXCEPTION 'Candidate % not found for requisition %', v_row.candidate_id, NEW.id;
      END IF;

      INSERT INTO staff (employee_name, phone_number, email, employment_type, status, trade_tag, day_rate, first_engaged_at)
      VALUES (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
              NEW.trade_tag, v_rate, COALESCE(NEW.start_date, CURRENT_DATE))
      RETURNING id INTO v_new_id;

      UPDATE candidates
         SET outcome = 'hired', provisioned_staff_id = v_new_id,
             outcome_notes = COALESCE(outcome_notes, '') ||
               CASE WHEN outcome_notes IS NULL OR outcome_notes = '' THEN '' ELSE E'\n' END ||
               'Hired via labor requisition ' || NEW.id::text,
             updated_at = now()
       WHERE id = v_row.candidate_id;

      UPDATE labor_requisition_candidates SET promoted_staff_id = v_new_id
       WHERE requisition_id = NEW.id AND candidate_id = v_row.candidate_id;

      INSERT INTO labor_allocations (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
      VALUES (v_new_id, NEW.project_id, COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date, v_rate, 'active',
              'Auto-created from approved requisition ' || NEW.id::text || ' · candidate ' || v_row.candidate_id::text, NEW.id);
    END LOOP;

    IF NEW.specific_staff_id IS NOT NULL AND EXISTS (SELECT 1 FROM labor_requisition_candidates WHERE requisition_id = NEW.id) THEN
      UPDATE labor_requisitions SET specific_staff_id = NULL WHERE id = NEW.id;
    END IF;
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_labor_req_promote_candidate ON labor_requisitions;
CREATE TRIGGER trg_labor_req_promote_candidate AFTER UPDATE OF status ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION on_labor_req_approved_promote_candidate();
