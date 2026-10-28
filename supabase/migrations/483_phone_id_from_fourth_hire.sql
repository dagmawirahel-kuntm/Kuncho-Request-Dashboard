-- 483: a casual worker's phone and ID are needed only once they come back
-- often. Up to their third hire (approved labour requests, across all
-- projects) the site team can leave phone and ID empty; from the fourth they
-- are needed for HR to verify them. A verified worker reaching the fourth
-- hire without them goes back to the site team to fill them in.

-- Approved labour requests this worker was on, across all projects.
CREATE OR REPLACE FUNCTION public.worker_hire_count(p_staff uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT count(DISTINCT w.requisition_id)::int
    FROM labor_requisition_workers w
    JOIN labor_requisitions r ON r.id = w.requisition_id AND r.status = 'approved'
   WHERE w.staff_id = p_staff;
$function$;

-- Phone and ID are needed from the fourth hire.
CREATE OR REPLACE FUNCTION public.worker_id_needed(p_staff uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT worker_hire_count(p_staff) > 3;
$function$;

CREATE OR REPLACE FUNCTION public.staff_verification_gaps(p_staff uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT array_remove(ARRAY[
    CASE WHEN worker_id_needed(s.id) AND NULLIF(btrim(s.phone_number), '') IS NULL THEN 'phone' END,
    CASE WHEN worker_id_needed(s.id) AND NULLIF(btrim(s.national_id), '') IS NULL AND s.id_document_url IS NULL THEN 'ID' END,
    CASE WHEN s.employment_type = 'tier_2_casual' AND s.trade_tag IS NULL THEN 'trade' END,
    CASE WHEN s.employment_type = 'tier_2_casual' AND COALESCE(s.day_rate, 0) <= 0 THEN 'day rate' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM staff_bank_accounts b
                           WHERE b.staff_id = s.id AND b.is_active AND b.bank_id IS NOT NULL
                             AND NULLIF(btrim(b.account_number), '') IS NOT NULL) THEN 'bank account' END
  ], NULL)
  FROM staff s WHERE s.id = p_staff;
$function$;

-- Someone not hired yet has no hires, so only the bank account is needed.
CREATE OR REPLACE FUNCTION public.candidate_detail_gaps(p_candidate uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT array_remove(ARRAY[
    CASE WHEN c.bank_id IS NULL OR NULLIF(btrim(c.bank_account_number), '') IS NULL THEN 'bank account' END
  ], NULL)
  FROM candidates c WHERE c.id = p_candidate;
$function$;

-- The details form also says how often they have been hired and whether
-- phone and ID are needed yet.
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
             'hires', worker_hire_count(s.id), 'id_needed', worker_id_needed(s.id),
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
             'hires', 0, 'id_needed', false,
             'gaps', to_jsonb(candidate_detail_gaps(c.id)))
      INTO v
      FROM candidates c LEFT JOIN accounts a ON a.id = c.bank_id
     WHERE c.id = p_candidate;
  END IF;
  RETURN v;
END $function$;

-- A verified worker hired for the fourth time without a phone or ID goes
-- back to the site team: HR verifies them again once those are in.
CREATE OR REPLACE FUNCTION public.worker_check_id_needed(p_staff uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_gaps text[];
BEGIN
  IF NOT worker_id_needed(p_staff) THEN RETURN; END IF;
  v_gaps := array(SELECT g FROM unnest(staff_verification_gaps(p_staff)) g WHERE g IN ('phone', 'ID'));
  IF cardinality(v_gaps) = 0 THEN RETURN; END IF;
  UPDATE staff SET verified_at = NULL,
         verification_note = 'Hired ' || worker_hire_count(p_staff) || ' times: ' || array_to_string(v_gaps, ' and ') || ' now needed',
         details_returned_at = now(),
         details_returned_reason = 'Hired more than 3 times — add their ' || array_to_string(v_gaps, ' and '),
         details_returned_by_name = 'Kuncho'
   WHERE id = p_staff AND verified_at IS NOT NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_lrw_check_id_needed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.staff_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM labor_requisitions WHERE id = NEW.requisition_id AND status = 'approved') THEN
    PERFORM worker_check_id_needed(NEW.staff_id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS lrw_check_id_needed ON labor_requisition_workers;
CREATE TRIGGER lrw_check_id_needed AFTER INSERT ON labor_requisition_workers
  FOR EACH ROW EXECUTE FUNCTION trg_lrw_check_id_needed();

CREATE OR REPLACE FUNCTION public.trg_labreq_check_id_needed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_staff uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    FOR v_staff IN SELECT DISTINCT staff_id FROM labor_requisition_workers
                    WHERE requisition_id = NEW.id AND staff_id IS NOT NULL LOOP
      PERFORM worker_check_id_needed(v_staff);
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS labreq_check_id_needed ON labor_requisitions;
CREATE TRIGGER labreq_check_id_needed AFTER UPDATE OF status ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION trg_labreq_check_id_needed();

GRANT EXECUTE ON FUNCTION worker_hire_count(uuid), worker_id_needed(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION worker_check_id_needed(uuid) FROM PUBLIC, anon, authenticated;
