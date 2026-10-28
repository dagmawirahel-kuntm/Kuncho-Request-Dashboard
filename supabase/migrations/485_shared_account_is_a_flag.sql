-- 485: two workers paid into the same bank account is only a flag. Most
-- casual workers share an account with family or a workmate, so it no longer
-- puts the pair on HR's Possible duplicates list. It shows beside each worker
-- as a nudge: Kuncho should encourage them to open an account of their own.

-- Other active workers paid into this account number.
CREATE OR REPLACE FUNCTION public.account_used_by(p_number text, p_except uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(array_agg(DISTINCT s.employee_name ORDER BY s.employee_name), '{}')
    FROM staff_bank_accounts b
    JOIN staff s ON s.id = b.staff_id AND COALESCE(s.status, 'active') = 'active'
   WHERE b.is_active AND b.staff_id IS DISTINCT FROM p_except
     AND NULLIF(regexp_replace(COALESCE(p_number, ''), '\D', '', 'g'), '') IS NOT NULL
     AND regexp_replace(b.account_number, '\D', '', 'g') = regexp_replace(p_number, '\D', '', 'g');
$function$;

-- Who else this worker's pay account is used by.
CREATE OR REPLACE FUNCTION public.worker_account_shared_with(p_staff uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT account_used_by((SELECT b.account_number FROM staff_bank_accounts b WHERE b.staff_id = p_staff AND b.is_active
                           ORDER BY b.is_primary DESC, b.created_at DESC LIMIT 1), p_staff);
$function$;

CREATE OR REPLACE FUNCTION public.worker_register()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer', 'executive', 'finance', 'operations_manager') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  WITH w AS (
    SELECT s.*, staff_verification_gaps(s.id) AS gaps, worker_account_shared_with(s.id) AS shares_with,
           (SELECT max(e.work_date) FROM labour_work_entries e WHERE e.staff_id = s.id) AS last_worked,
           (SELECT p.project_name FROM labour_work_entries e JOIN projects p ON p.id = e.project_id
             WHERE e.staff_id = s.id ORDER BY e.work_date DESC LIMIT 1) AS last_site,
           (SELECT COALESCE(sum(x.subtotal), 0) FROM labor_expense_workers x JOIN expenses ex ON ex.id = x.expense_id
             WHERE x.staff_id = s.id AND COALESCE(ex.payment_state, 'unpaid') NOT IN ('paid', 'sent')
               AND ex.approval_status::text <> 'rejected') AS pay_waiting,
           (SELECT jsonb_build_object('bank', a.account_name, 'number', b.account_number, 'holder', b.account_holder)
              FROM staff_bank_accounts b LEFT JOIN accounts a ON a.id = b.bank_id
             WHERE b.staff_id = s.id AND b.is_active ORDER BY b.is_primary DESC, b.created_at DESC LIMIT 1) AS bank
      FROM staff s WHERE s.employment_type = 'tier_2_casual' AND COALESCE(s.status, 'active') = 'active'
  ), pairs AS (
    -- Look-alike names only: a shared bank account is a flag on the worker.
    SELECT a.id AS a_id, b.id AS b_id, 'name' AS why
      FROM w a JOIN w b ON a.id < b.id
     WHERE NOT EXISTS (SELECT 1 FROM staff_distinct_pairs d WHERE d.a = a.id AND d.b = b.id) AND (lower(regexp_replace(a.employee_name, '[^[:alpha:]]', '', 'g')) = lower(regexp_replace(b.employee_name, '[^[:alpha:]]', '', 'g'))
        OR similarity(lower(a.employee_name), lower(b.employee_name)) > 0.6)
  ), card AS (
    SELECT w.id, jsonb_build_object('id', w.id, 'name', w.employee_name, 'phone', w.phone_number, 'national_id', w.national_id,
             'has_id_photo', w.id_document_url IS NOT NULL, 'trade', w.trade_tag, 'day_rate', w.day_rate, 'bank', w.bank,
             'shares_with', to_jsonb(w.shares_with),
             'verified_at', w.verified_at, 'verified_by', w.verified_by_name, 'note', w.verification_note,
             'gaps', to_jsonb(w.gaps), 'last_worked', w.last_worked, 'last_site', w.last_site, 'pay_waiting', w.pay_waiting,
             'first_engaged_at', w.first_engaged_at) AS j
      FROM w
  )
  SELECT jsonb_build_object(
    'hold_from', (SELECT hold_from FROM labour_pay_hold_settings WHERE id),
    'counts', jsonb_build_object(
       'active', (SELECT count(*) FROM w),
       'verified', (SELECT count(*) FROM w WHERE verified_at IS NOT NULL),
       'ready', (SELECT count(*) FROM w WHERE verified_at IS NULL AND cardinality(gaps) = 0),
       'shared_accounts', (SELECT count(*) FROM w WHERE cardinality(shares_with) > 0),
       'pay_waiting_unverified', (SELECT COALESCE(sum(pay_waiting), 0) FROM w WHERE verified_at IS NULL)),
    'to_verify', COALESCE((SELECT jsonb_agg(c.j ORDER BY (w.pay_waiting > 0) DESC, w.last_worked DESC NULLS LAST, w.employee_name)
                             FROM w JOIN card c ON c.id = w.id WHERE w.verified_at IS NULL), '[]'::jsonb),
    'verified', COALESCE((SELECT jsonb_agg(c.j ORDER BY w.employee_name) FROM w JOIN card c ON c.id = w.id WHERE w.verified_at IS NOT NULL), '[]'::jsonb),
    'duplicates', COALESCE((SELECT jsonb_agg(jsonb_build_object('why', p.why, 'a', ca.j, 'b', cb.j))
                              FROM pairs p JOIN card ca ON ca.id = p.a_id JOIN card cb ON cb.id = p.b_id), '[]'::jsonb))
  INTO v;
  RETURN v;
END $function$;

-- The details form says who else is paid into the same account.
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
             'shares_with', to_jsonb(account_used_by(b.account_number, s.id)),
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
             'shares_with', to_jsonb(account_used_by(c.bank_account_number, NULL)),
             'hires', 0, 'id_needed', false,
             'gaps', to_jsonb(candidate_detail_gaps(c.id)))
      INTO v
      FROM candidates c LEFT JOIN accounts a ON a.id = c.bank_id
     WHERE c.id = p_candidate;
  END IF;
  RETURN v;
END $function$;

-- Only for the functions above: nobody looks names up by account number.
REVOKE EXECUTE ON FUNCTION account_used_by(text, uuid), worker_account_shared_with(uuid) FROM PUBLIC, anon, authenticated;
