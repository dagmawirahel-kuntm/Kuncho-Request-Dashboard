-- 482: The person hiring fills in the worker's details; HR only reviews.
--
-- With the site team typing some details and HR typing others, records came
-- out half-done, duplicated or overwritten. Now there is one point of entry:
-- whoever hires the worker (PM, foreman, site team) fills in everything —
-- photo, phone, ID number and ID photo, bank and account number — when they
-- add the person, or later from Labour → Worker details. HR does not type
-- details any more: it reviews what was submitted and either accepts it
-- (verify_worker, 477) or sends it back with a reason, which the person who
-- filled it in sees and is notified of.
--
-- Someone named on a request that is not approved yet is a candidate: their
-- details wait on the candidate and move to the staff record when they are
-- hired (on approval, or through HR's candidate queue).
--
-- The site team changing a verified worker's ID or bank account still
-- removes the verification (477), so the change goes back to HR and pay is
-- held until HR accepts it.

-- ── Columns ──────────────────────────────────────────────────────────
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS id_document_url text,
  ADD COLUMN IF NOT EXISTS id_document_name text,
  ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_holder text,
  ADD COLUMN IF NOT EXISTS details_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS details_by_name text,
  ADD COLUMN IF NOT EXISTS details_at timestamptz;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS details_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS details_by_name text,
  ADD COLUMN IF NOT EXISTS details_at timestamptz,
  ADD COLUMN IF NOT EXISTS details_returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS details_returned_reason text,
  ADD COLUMN IF NOT EXISTS details_returned_by_name text;
COMMENT ON COLUMN staff.details_by IS 'Who last filled in this worker''s details (482) — the site team; HR reviews them.';
COMMENT ON COLUMN staff.details_returned_reason IS 'HR sent the details back: what to fix (482). Cleared when they are filled in again.';

-- The site team uploads ID photos into the private staff documents, under onboarding/.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'staff_docs_onboarding_insert') THEN
    EXECUTE $p$CREATE POLICY staff_docs_onboarding_insert ON storage.objects FOR INSERT TO authenticated
             WITH CHECK (bucket_id = 'staff-documents' AND name LIKE 'onboarding/%')$p$;
  END IF;
END $$;

-- ── Who may fill in a candidate's details ───────────────────────────
CREATE OR REPLACE FUNCTION public.can_edit_candidate(p_candidate uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false) OR is_ops_manager()
      OR EXISTS (SELECT 1 FROM labor_requisition_candidates c JOIN labor_requisitions r ON r.id = c.requisition_id
                  WHERE c.candidate_id = p_candidate AND can_run_labour_site(r.project_id));
$function$;

-- Gaps for someone not hired yet: what the site team still has to fill in.
CREATE OR REPLACE FUNCTION public.candidate_detail_gaps(p_candidate uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT array_remove(ARRAY[
    CASE WHEN NULLIF(btrim(c.phone), '') IS NULL THEN 'phone' END,
    CASE WHEN NULLIF(btrim(c.national_id), '') IS NULL AND c.id_document_url IS NULL THEN 'ID' END,
    CASE WHEN c.bank_id IS NULL OR NULLIF(btrim(c.bank_account_number), '') IS NULL THEN 'bank account' END
  ], NULL)
  FROM candidates c WHERE c.id = p_candidate;
$function$;

-- A bank account for a worker, as the one they are paid into.
CREATE OR REPLACE FUNCTION public.worker_set_bank(p_staff uuid, p_bank uuid, p_number text, p_holder text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_num text := NULLIF(regexp_replace(COALESCE(p_number, ''), '\s', '', 'g'), ''); v_id uuid;
BEGIN
  IF p_bank IS NULL OR v_num IS NULL THEN RETURN; END IF;
  SELECT id INTO v_id FROM staff_bank_accounts WHERE staff_id = p_staff AND bank_id = p_bank AND account_number = v_num;
  -- One account they are paid into: the others stop being used (kept, not removed).
  UPDATE staff_bank_accounts SET is_primary = false WHERE staff_id = p_staff AND is_primary AND id IS DISTINCT FROM v_id;
  UPDATE staff_bank_accounts SET is_active = false WHERE staff_id = p_staff AND is_active AND id IS DISTINCT FROM v_id;
  IF v_id IS NULL THEN
    INSERT INTO staff_bank_accounts (staff_id, bank_id, account_number, account_holder, label, is_primary, is_active)
    VALUES (p_staff, p_bank, v_num, NULLIF(btrim(p_holder), ''), 'Filled in when hired', true, true);
  ELSE
    UPDATE staff_bank_accounts SET is_primary = true, is_active = true,
           account_holder = COALESCE(NULLIF(btrim(p_holder), ''), account_holder) WHERE id = v_id;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.worker_set_bank(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ── Fill in details (the site team) ─────────────────────────────────
-- p_d keys, each optional: name, phone, national_id, id_document_url,
-- id_document_name, photo_url, trade, day_rate, bank_id, account_number,
-- account_holder.
-- A key left out keeps what is there.
CREATE OR REPLACE FUNCTION public.worker_details_save(p_staff uuid, p_candidate uuid, p_d jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_me text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  v_phone text := CASE WHEN p_d ? 'phone' THEN NULLIF(regexp_replace(COALESCE(p_d->>'phone', ''), '[^0-9+]', '', 'g'), '') END;
  v_photo text := CASE WHEN p_d->>'photo_url' ~ '^https://' THEN btrim(p_d->>'photo_url') END;
  v_bank uuid := NULLIF(p_d->>'bank_id', '')::uuid;
BEGIN
  IF v_bank IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_bank AND type IN ('Bank', 'Bank Account')) THEN
    RAISE EXCEPTION 'Pick the bank from the list';
  END IF;
  IF p_staff IS NOT NULL THEN
    IF NOT can_photo_worker(p_staff) THEN RAISE EXCEPTION 'Only the team of their site, operations or HR can fill in this worker''s details'; END IF;
    UPDATE staff SET
      employee_name    = COALESCE(NULLIF(btrim(p_d->>'name'), ''), employee_name),
      phone_number     = CASE WHEN p_d ? 'phone' THEN v_phone ELSE phone_number END,
      national_id      = CASE WHEN p_d ? 'national_id' THEN NULLIF(btrim(p_d->>'national_id'), '') ELSE national_id END,
      id_document_url  = CASE WHEN p_d ? 'id_document_url' THEN NULLIF(p_d->>'id_document_url', '') ELSE id_document_url END,
      id_document_name = CASE WHEN p_d ? 'id_document_url' THEN NULLIF(p_d->>'id_document_name', '') ELSE id_document_name END,
      photo_url        = COALESCE(v_photo, photo_url),
      trade_tag        = CASE WHEN p_d ? 'trade' THEN NULLIF(p_d->>'trade', '') ELSE trade_tag END,
      day_rate         = CASE WHEN NULLIF(p_d->>'day_rate', '')::numeric > 0 THEN (p_d->>'day_rate')::numeric ELSE day_rate END,
      details_by = auth.uid(), details_by_name = v_me, details_at = now(),
      details_returned_at = NULL, details_returned_reason = NULL, details_returned_by_name = NULL,
      updated_at = now()
     WHERE id = p_staff;
    IF NOT FOUND THEN RAISE EXCEPTION 'Worker not found'; END IF;
    IF v_bank IS NOT NULL THEN PERFORM worker_set_bank(p_staff, v_bank, p_d->>'account_number', p_d->>'account_holder'); END IF;
    RETURN jsonb_build_object('gaps', to_jsonb(staff_verification_gaps(p_staff)));
  ELSIF p_candidate IS NOT NULL THEN
    IF NOT can_edit_candidate(p_candidate) THEN RAISE EXCEPTION 'Only the team of their site, operations or HR can fill in these details'; END IF;
    UPDATE candidates SET
      full_name           = COALESCE(NULLIF(btrim(p_d->>'name'), ''), full_name),
      phone               = CASE WHEN p_d ? 'phone' THEN v_phone ELSE phone END,
      national_id         = CASE WHEN p_d ? 'national_id' THEN NULLIF(btrim(p_d->>'national_id'), '') ELSE national_id END,
      id_document_url     = CASE WHEN p_d ? 'id_document_url' THEN NULLIF(p_d->>'id_document_url', '') ELSE id_document_url END,
      id_document_name    = CASE WHEN p_d ? 'id_document_url' THEN NULLIF(p_d->>'id_document_name', '') ELSE id_document_name END,
      photo_url           = COALESCE(v_photo, photo_url),
      trade_tag           = CASE WHEN p_d ? 'trade' THEN NULLIF(p_d->>'trade', '') ELSE trade_tag END,
      bank_id             = CASE WHEN v_bank IS NOT NULL THEN v_bank ELSE bank_id END,
      bank_account_number = CASE WHEN v_bank IS NOT NULL THEN NULLIF(regexp_replace(COALESCE(p_d->>'account_number', ''), '\s', '', 'g'), '') ELSE bank_account_number END,
      bank_account_holder = CASE WHEN v_bank IS NOT NULL THEN NULLIF(btrim(p_d->>'account_holder'), '') ELSE bank_account_holder END,
      details_by = auth.uid(), details_by_name = v_me, details_at = now(), updated_at = now()
     WHERE id = p_candidate;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person not found'; END IF;
    RETURN jsonb_build_object('gaps', to_jsonb(candidate_detail_gaps(p_candidate)));
  END IF;
  RAISE EXCEPTION 'Whose details are these?';
END $function$;

-- What is on file, to show in the form.
CREATE OR REPLACE FUNCTION public.worker_details_get(p_staff uuid, p_candidate uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  IF p_staff IS NOT NULL THEN
    IF NOT (can_photo_worker(p_staff) OR COALESCE(get_user_role()::text IN ('finance'), false)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT jsonb_build_object('name', s.employee_name, 'phone', s.phone_number, 'national_id', s.national_id,
             'id_document_url', s.id_document_url, 'id_document_name', s.id_document_name, 'photo_url', s.photo_url,
             'trade', s.trade_tag, 'day_rate', s.day_rate,
             'bank_id', b.bank_id, 'bank', a.account_name, 'account_number', b.account_number, 'account_holder', b.account_holder,
             'verified_at', s.verified_at, 'verified_by_name', s.verified_by_name, 'verification_note', s.verification_note,
             'details_at', s.details_at, 'details_by_name', s.details_by_name,
             'returned_at', s.details_returned_at, 'returned_reason', s.details_returned_reason, 'returned_by_name', s.details_returned_by_name,
             'gaps', to_jsonb(staff_verification_gaps(s.id)))
      INTO v
      FROM staff s
      LEFT JOIN LATERAL (SELECT * FROM staff_bank_accounts x WHERE x.staff_id = s.id AND x.is_active
                          ORDER BY x.is_primary DESC, x.created_at DESC LIMIT 1) b ON true
      LEFT JOIN accounts a ON a.id = b.bank_id
     WHERE s.id = p_staff;
  ELSE
    IF NOT can_edit_candidate(p_candidate) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT jsonb_build_object('name', c.full_name, 'phone', c.phone, 'national_id', c.national_id,
             'id_document_url', c.id_document_url, 'id_document_name', c.id_document_name, 'photo_url', c.photo_url,
             'trade', c.trade_tag, 'bank_id', c.bank_id, 'bank', a.account_name, 'account_number', c.bank_account_number,
             'account_holder', c.bank_account_holder, 'details_at', c.details_at, 'details_by_name', c.details_by_name,
             'gaps', to_jsonb(candidate_detail_gaps(c.id)))
      INTO v
      FROM candidates c LEFT JOIN accounts a ON a.id = c.bank_id
     WHERE c.id = p_candidate;
  END IF;
  RETURN v;
END $function$;

-- ── HR sends the details back ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.return_worker_details(p_staff uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s staff%ROWTYPE; v_to uuid[];
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer') THEN RAISE EXCEPTION 'HR reviews worker details'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say what needs fixing'; END IF;
  UPDATE staff SET details_returned_at = now(), details_returned_reason = btrim(p_reason),
         details_returned_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()),
         verified_at = NULL, updated_at = now()
   WHERE id = p_staff RETURNING * INTO s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker not found'; END IF;
  -- Tell whoever filled them in; failing that, the PMs of the sites they work on.
  v_to := CASE WHEN s.details_by IS NOT NULL THEN ARRAY[s.details_by] ELSE
            (SELECT array_agg(DISTINCT pm.user_id) FROM labor_allocations a JOIN projects p ON p.id = a.project_id
               JOIN staff pm ON pm.id = p.project_manager_id
              WHERE a.staff_id = p_staff AND a.status = 'active' AND pm.user_id IS NOT NULL) END;
  IF cardinality(v_to) > 0 THEN
    PERFORM bot_note(v_to, 'Worker details sent back: ' || s.employee_name, btrim(p_reason),
                     '/labour/workers?open=' || p_staff::text, 'staff', p_staff);
  END IF;
END $function$;

-- ── The site team's list: their sites' workers and the people named on their requests ──
CREATE OR REPLACE FUNCTION public.my_workers_details()
RETURNS TABLE (kind text, id uuid, name text, phone text, photo_url text, sites text, gaps text[], verified boolean,
  details_at timestamptz, details_by_name text, returned_reason text, returned_by_name text, last_worked date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH mine AS (
    SELECT DISTINCT a.staff_id, p.project_name
      FROM labor_allocations a JOIN projects p ON p.id = a.project_id
     WHERE a.status = 'active' AND can_run_labour_site(a.project_id)
    UNION
    SELECT DISTINCT w.staff_id, p.project_name
      FROM labor_requisition_workers w JOIN labor_requisitions r ON r.id = w.requisition_id JOIN projects p ON p.id = r.project_id
     WHERE r.closed_at IS NULL AND r.status IN ('pending', 'approved') AND can_run_labour_site(r.project_id)
  ), people AS (
    SELECT m.staff_id, string_agg(DISTINCT btrim(m.project_name), ', ') AS sites FROM mine m GROUP BY m.staff_id
  ), cands AS (
    SELECT c.id, string_agg(DISTINCT btrim(p.project_name), ', ') AS sites
      FROM labor_requisition_candidates lc JOIN candidates c ON c.id = lc.candidate_id
      JOIN labor_requisitions r ON r.id = lc.requisition_id JOIN projects p ON p.id = r.project_id
     WHERE lc.promoted_staff_id IS NULL AND c.outcome = 'pending' AND r.closed_at IS NULL AND can_run_labour_site(r.project_id)
     GROUP BY c.id
  )
  SELECT 'staff', s.id, s.employee_name, s.phone_number, s.photo_url, pp.sites, staff_verification_gaps(s.id), s.verified_at IS NOT NULL,
         s.details_at, s.details_by_name, s.details_returned_reason, s.details_returned_by_name,
         (SELECT max(e.work_date) FROM labour_work_entries e WHERE e.staff_id = s.id)
    FROM people pp JOIN staff s ON s.id = pp.staff_id
   WHERE s.employment_type = 'tier_2_casual' AND s.status = 'active'
  UNION ALL
  SELECT 'candidate', c.id, c.full_name, c.phone, c.photo_url, cc.sites, candidate_detail_gaps(c.id), false,
         c.details_at, c.details_by_name, NULL, NULL, NULL
    FROM cands cc JOIN candidates c ON c.id = cc.id
   ORDER BY 11 NULLS LAST, 3;
$function$;

-- Details HR is looking at, by worker: who filled them in, and any send-back.
CREATE OR REPLACE FUNCTION public.worker_details_status(p_ids uuid[])
RETURNS TABLE (id uuid, details_at timestamptz, details_by_name text, returned_at timestamptz, returned_reason text, returned_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT s.id, s.details_at, s.details_by_name, s.details_returned_at, s.details_returned_reason, s.details_returned_by_name
    FROM staff s WHERE s.id = ANY (p_ids)
     AND COALESCE(get_user_role()::text IN ('admin', 'executive', 'finance', 'hr_officer', 'operations_manager'), false);
$function$;

-- ── Hiring carries the details from the candidate to the staff record ──
CREATE OR REPLACE FUNCTION public.apply_candidate_details(p_candidate uuid, p_staff uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c candidates%ROWTYPE;
BEGIN
  SELECT * INTO c FROM candidates WHERE id = p_candidate;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE staff SET phone_number = COALESCE(phone_number, c.phone),
         national_id = COALESCE(national_id, c.national_id),
         id_document_url = COALESCE(id_document_url, c.id_document_url),
         id_document_name = CASE WHEN id_document_url IS NULL THEN c.id_document_name ELSE id_document_name END,
         photo_url = COALESCE(photo_url, c.photo_url),
         trade_tag = COALESCE(trade_tag, c.trade_tag),
         details_by = COALESCE(c.details_by, details_by), details_by_name = COALESCE(c.details_by_name, details_by_name),
         details_at = COALESCE(c.details_at, details_at)
   WHERE id = p_staff;
  IF c.bank_id IS NOT NULL AND c.bank_account_number IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM staff_bank_accounts WHERE staff_id = p_staff AND is_active) THEN
    PERFORM worker_set_bank(p_staff, c.bank_id, c.bank_account_number, c.bank_account_holder);
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.apply_candidate_details(uuid, uuid) FROM PUBLIC, anon, authenticated;

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
  END IF;
  PERFORM apply_candidate_details(p_candidate_id, v_new_id);

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
      PERFORM apply_candidate_details(v_row.candidate_id, v_new_id);

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

GRANT EXECUTE ON FUNCTION can_edit_candidate(uuid), candidate_detail_gaps(uuid), worker_details_save(uuid, uuid, jsonb),
  worker_details_get(uuid, uuid), return_worker_details(uuid, text), my_workers_details(), worker_details_status(uuid[]) TO authenticated;
