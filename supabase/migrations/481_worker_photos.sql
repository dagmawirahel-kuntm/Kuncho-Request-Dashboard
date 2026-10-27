-- 481: A casual worker's photo, taken when they are hired.
--
-- 0 of 139 casual workers had a photo, so nobody on site or in HR could tell
-- whether the person recorded was the person paid. The photo is now taken
-- at the point of hiring — when the PM or foreman adds someone new on a
-- labour request (Ask for labour, or the request page) — and can be added
-- later by the site team or HR. A candidate's photo carries over to the
-- staff record when HR hires them. Photos sit with the existing staff
-- photos (documents bucket, staff-photos/), which the worker ID cards read.
--
-- Replacing a verified worker's photo needs HR to verify them again, like a
-- new name, ID or bank account (477).

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS photo_url text;
COMMENT ON COLUMN candidates.photo_url IS 'Photo taken when the worker was named on a labour request (481); copied to staff.photo_url on hiring.';

-- ── A replaced photo un-verifies, like a new name, ID or bank account ──
CREATE OR REPLACE FUNCTION public.trg_staff_identity_change_unverifies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
     AND (NEW.employee_name IS DISTINCT FROM OLD.employee_name OR NEW.national_id IS DISTINCT FROM OLD.national_id
          OR NEW.bank_account IS DISTINCT FROM OLD.bank_account OR NEW.bank_id IS DISTINCT FROM OLD.bank_id
          OR (OLD.photo_url IS NOT NULL AND NEW.photo_url IS DISTINCT FROM OLD.photo_url)) THEN
    NEW.verified_at := NULL;
    NEW.verification_note := 'Name, ID, photo or bank account changed — verify again';
  END IF;
  RETURN NEW;
END $function$;

-- ── Who may photograph a worker: HR and operations, or the team of a site
-- the worker is (or was) on ──
CREATE OR REPLACE FUNCTION public.can_photo_worker(p_staff uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false) OR is_ops_manager()
      OR EXISTS (SELECT 1 FROM labor_allocations a WHERE a.staff_id = p_staff AND can_run_labour_site(a.project_id))
      OR EXISTS (SELECT 1 FROM labor_requisition_workers w JOIN labor_requisitions r ON r.id = w.requisition_id
                  WHERE w.staff_id = p_staff AND can_run_labour_site(r.project_id));
$function$;

-- Set the photo of a worker (staff) or of someone named but not hired yet (candidate).
CREATE OR REPLACE FUNCTION public.set_worker_photo(p_staff uuid, p_candidate uuid, p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NULLIF(btrim(p_url), '') IS NULL OR p_url !~ '^https://' THEN RAISE EXCEPTION 'Take or choose a photo first'; END IF;
  IF p_staff IS NOT NULL THEN
    IF NOT can_photo_worker(p_staff) THEN RAISE EXCEPTION 'Only HR, operations or the team of their site can change this photo'; END IF;
    UPDATE staff SET photo_url = btrim(p_url), updated_at = now() WHERE id = p_staff;
    IF NOT FOUND THEN RAISE EXCEPTION 'Worker not found'; END IF;
  ELSIF p_candidate IS NOT NULL THEN
    IF NOT (COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false) OR is_ops_manager()
            OR EXISTS (SELECT 1 FROM labor_requisition_candidates c JOIN labor_requisitions r ON r.id = c.requisition_id
                        WHERE c.candidate_id = p_candidate AND can_run_labour_site(r.project_id))) THEN
      RAISE EXCEPTION 'Only HR, operations or the team of their site can change this photo';
    END IF;
    UPDATE candidates SET photo_url = btrim(p_url), updated_at = now() WHERE id = p_candidate;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person not found'; END IF;
  ELSE
    RAISE EXCEPTION 'Whose photo is this?';
  END IF;
END $function$;

-- ── Adding someone new to a labour request, with their photo ──────────
-- labour_add_new_worker (kept: the Telegram bot calls it) now goes through here.
CREATE OR REPLACE FUNCTION public.labour_add_person(p_req uuid, p_name text, p_phone text DEFAULT NULL, p_day_rate numeric DEFAULT NULL, p_photo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r       labor_requisitions%ROWTYPE;
  v_staff uuid;
  v_cand  uuid;
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_photo text := CASE WHEN p_photo ~ '^https://' THEN btrim(p_photo) END;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT can_run_labour_site(r.project_id) THEN RAISE EXCEPTION 'Only the site''s team, operations or HR can add workers'; END IF;
  IF r.status = 'rejected' OR r.closed_at IS NOT NULL THEN RAISE EXCEPTION 'This request is closed'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Give the worker''s name'; END IF;

  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_staff FROM staff
     WHERE regexp_replace(COALESCE(phone_number, ''), '[^0-9+]', '', 'g') = v_phone
     ORDER BY (status = 'active') DESC LIMIT 1;
  END IF;

  IF v_staff IS NULL AND r.status = 'approved' THEN
    INSERT INTO staff (employee_name, phone_number, employment_type, status, trade_tag, day_rate, first_engaged_at, photo_url)
    VALUES (btrim(p_name), v_phone, 'tier_2_casual', 'active', r.trade_tag,
            COALESCE(p_day_rate, CASE WHEN r.payment_basis = 'per_day' THEN r.estimated_day_rate END), CURRENT_DATE, v_photo)
    RETURNING id INTO v_staff;
  END IF;

  IF v_staff IS NOT NULL THEN
    IF p_day_rate IS NOT NULL THEN UPDATE staff SET day_rate = COALESCE(day_rate, p_day_rate) WHERE id = v_staff; END IF;
    -- Someone already on file keeps their photo; one without gets this one.
    IF v_photo IS NOT NULL THEN UPDATE staff SET photo_url = v_photo WHERE id = v_staff AND photo_url IS NULL; END IF;
    PERFORM labour_add_worker(p_req, v_staff);
    RETURN jsonb_build_object('staff_id', v_staff);
  END IF;

  INSERT INTO candidates (full_name, phone, outcome, candidate_type, trade_tag, created_by, photo_url)
  VALUES (btrim(p_name), v_phone, 'pending',
          CASE WHEN r.trade_tag IS NULL THEN 'salaried_or_subcontractor' ELSE 'tier_2_casual' END, r.trade_tag, current_staff_id(), v_photo)
  RETURNING id INTO v_cand;
  INSERT INTO labor_requisition_candidates (requisition_id, candidate_id) VALUES (p_req, v_cand);
  UPDATE labor_requisitions SET headcount = GREATEST(headcount,
    (SELECT count(*) FROM labor_requisition_workers WHERE requisition_id = p_req)
    + (SELECT count(*) FROM labor_requisition_candidates WHERE requisition_id = p_req AND promoted_staff_id IS NULL))
   WHERE id = p_req;
  PERFORM log_labour_event(p_req, 'worker_added', btrim(p_name) || ' (new)');
  RETURN jsonb_build_object('candidate_id', v_cand);
END $function$;

CREATE OR REPLACE FUNCTION public.labour_add_new_worker(p_req uuid, p_name text, p_phone text DEFAULT NULL, p_day_rate numeric DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT (labour_add_person(p_req, p_name, p_phone, p_day_rate, NULL)->>'staff_id')::uuid;
$function$;

-- ── HR hiring a candidate: the photo comes along ─────────────────────
CREATE OR REPLACE FUNCTION public.provision_tier_2_worker_from_candidate(p_candidate_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_role     user_role;
  v_cand     candidates%ROWTYPE;
  v_req      labor_requisitions%ROWTYPE;
  v_new_id   uuid;
  v_actor_id uuid;
  v_rate     numeric;
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
  v_rate := CASE WHEN v_req.payment_basis = 'per_volume' THEN v_req.unit_rate ELSE v_req.estimated_day_rate END;

  IF v_cand.phone IS NOT NULL AND btrim(v_cand.phone) <> '' THEN
    SELECT id INTO v_new_id FROM staff
     WHERE employment_type = 'tier_2_casual' AND status = 'active'
       AND phone_number = v_cand.phone
     LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    INSERT INTO staff
      (employee_name, phone_number, email, employment_type, status,
       trade_tag, day_rate, first_engaged_at, photo_url)
    VALUES
      (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
       v_cand.trade_tag, v_rate, CURRENT_DATE, v_cand.photo_url)
    RETURNING id INTO v_new_id;
  ELSIF v_cand.photo_url IS NOT NULL THEN
    UPDATE staff SET photo_url = v_cand.photo_url WHERE id = v_new_id AND photo_url IS NULL;
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

-- ── Approving a request hires the people named on it: their photos come along ──
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

      INSERT INTO staff (employee_name, phone_number, email, employment_type, status, trade_tag, day_rate, first_engaged_at, photo_url)
      VALUES (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
              NEW.trade_tag, v_rate, COALESCE(NEW.start_date, CURRENT_DATE), v_cand.photo_url)
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

GRANT EXECUTE ON FUNCTION can_photo_worker(uuid), set_worker_photo(uuid, uuid, text),
  labour_add_person(uuid, text, text, numeric, text) TO authenticated;
