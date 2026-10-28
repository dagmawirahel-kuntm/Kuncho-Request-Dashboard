-- 486: merging two worker records either finishes or changes nothing.
-- Before, rows the two records both had in the same place (both in one work
-- order's crew, both on one labour request) stopped the move half way: the
-- days and pay moved, the duplicate stayed, and HR saw "CONFLICT — resolve by
-- hand". Now those overlaps are settled first, the whole merge is undone if
-- anything still collides, and two records that worked the same day or were
-- paid on the same pay sheet can't be merged: they are two people.

-- Two records that worked the same day or sit on the same pay sheet are two
-- different people.
CREATE OR REPLACE FUNCTION public.workers_overlap(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM labor_expense_workers x JOIN labor_expense_workers y ON y.expense_id = x.expense_id
                  WHERE x.staff_id = p_a AND y.staff_id = p_b)
      OR EXISTS (SELECT 1 FROM labour_work_entries x JOIN labour_work_entries y ON y.work_date = x.work_date
                  WHERE x.staff_id = p_a AND y.staff_id = p_b)
      OR EXISTS (SELECT 1 FROM timesheet_attendance x JOIN timesheet_attendance y ON y.work_date = x.work_date
                  WHERE x.staff_id = p_a AND y.staff_id = p_b);
$function$;

CREATE OR REPLACE FUNCTION public.merge_workers(p_keep uuid, p_merge uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_keep staff%ROWTYPE; v_dup staff%ROWTYPE; v_out jsonb; v_conflicts text;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer') THEN RAISE EXCEPTION 'HR merges worker records'; END IF;
  SELECT * INTO v_keep FROM staff WHERE id = p_keep;
  SELECT * INTO v_dup FROM staff WHERE id = p_merge;
  IF v_keep.id IS NULL OR v_dup.id IS NULL THEN RAISE EXCEPTION 'Worker not found — refresh the page'; END IF;
  IF workers_overlap(p_keep, p_merge) THEN
    RAISE EXCEPTION '"%" and "%" worked on the same day or were paid on the same pay sheet, so they are two people. Tap "Different people" instead.',
      v_keep.employee_name, v_dup.employee_name;
  END IF;

  -- Rows both records have in the same place: keep one.
  UPDATE work_order_crew d SET removed_at = now()
   WHERE d.staff_id = p_merge AND d.removed_at IS NULL
     AND EXISTS (SELECT 1 FROM work_order_crew k WHERE k.staff_id = p_keep AND k.work_order_id = d.work_order_id AND k.removed_at IS NULL);
  DELETE FROM labor_requisition_workers d
   WHERE d.staff_id = p_merge
     AND EXISTS (SELECT 1 FROM labor_requisition_workers k WHERE k.staff_id = p_keep AND k.requisition_id = d.requisition_id);
  UPDATE labour_pay_request_deductions k SET amount = k.amount + d.amount,
         note = NULLIF(concat_ws('; ', k.note, d.note), '')
    FROM labour_pay_request_deductions d
   WHERE k.staff_id = p_keep AND d.staff_id = p_merge AND d.request_id = k.request_id;
  DELETE FROM labour_pay_request_deductions d
   WHERE d.staff_id = p_merge
     AND EXISTS (SELECT 1 FROM labour_pay_request_deductions k WHERE k.staff_id = p_keep AND k.request_id = d.request_id);
  DELETE FROM staff_bank_accounts d
   WHERE d.staff_id = p_merge
     AND EXISTS (SELECT 1 FROM staff_bank_accounts k WHERE k.staff_id = p_keep
                   AND COALESCE(k.bank_id::text, '') = COALESCE(d.bank_id::text, '') AND k.account_number = d.account_number);
  UPDATE staff_bank_accounts d SET is_primary = false
   WHERE d.staff_id = p_merge AND d.is_primary
     AND EXISTS (SELECT 1 FROM staff_bank_accounts k WHERE k.staff_id = p_keep AND k.is_primary);
  DELETE FROM bot_staff_links d WHERE d.staff_id = p_merge AND EXISTS (SELECT 1 FROM bot_staff_links k WHERE k.staff_id = p_keep);
  DELETE FROM work_order_ratings d
   WHERE d.rated_staff_id = p_merge
     AND EXISTS (SELECT 1 FROM work_order_ratings k WHERE k.rated_staff_id = p_keep AND k.work_order_id = d.work_order_id
                   AND k.rater_staff_id IS NOT DISTINCT FROM d.rater_staff_id);
  -- "Not the same person as X" carries over to the record kept.
  INSERT INTO staff_distinct_pairs (a, b, marked_by, marked_at)
  SELECT LEAST(p_keep, o), GREATEST(p_keep, o), marked_by, marked_at
    FROM (SELECT CASE WHEN a = p_merge THEN b ELSE a END AS o, marked_by, marked_at
            FROM staff_distinct_pairs WHERE p_merge IN (a, b)) x
   WHERE o <> p_keep
  ON CONFLICT DO NOTHING;
  DELETE FROM staff_distinct_pairs WHERE p_merge IN (a, b);

  -- Pay sheets keep each worker in their lines.
  UPDATE labour_pay_sheets
     SET lines = (SELECT jsonb_agg(CASE WHEN el->>'staff_id' = p_merge::text
                                        THEN el || jsonb_build_object('staff_id', p_keep, 'worker_name', v_keep.employee_name) ELSE el END ORDER BY ord)
                    FROM jsonb_array_elements(lines) WITH ORDINALITY t(el, ord))
   WHERE lines::text LIKE '%' || p_merge::text || '%';

  SELECT jsonb_agg(to_jsonb(m)), string_agg(DISTINCT m.table_name, ', ') FILTER (WHERE m.note LIKE 'CONFLICT%')
    INTO v_out, v_conflicts
    FROM merge_staff_records(p_keep, p_merge) m;
  IF v_conflicts IS NOT NULL OR EXISTS (SELECT 1 FROM staff WHERE id = p_merge) THEN
    -- Undo everything above: no half-merged records.
    RAISE EXCEPTION 'Nothing was merged: "%" still has records that clash with "%" (%). Tell the admin.',
      v_dup.employee_name, v_keep.employee_name, COALESCE(v_conflicts, 'labour records');
  END IF;

  -- What the kept record lacks, the merged one fills in.
  UPDATE staff SET photo_url = COALESCE(photo_url, v_dup.photo_url),
         national_id = COALESCE(national_id, v_dup.national_id),
         id_document_url = COALESCE(id_document_url, v_dup.id_document_url),
         id_document_name = CASE WHEN id_document_url IS NULL THEN v_dup.id_document_name ELSE id_document_name END,
         day_rate = COALESCE(day_rate, v_dup.day_rate)
   WHERE id = p_keep;
  RETURN v_out;
END $function$;

-- Look-alike names that worked the same day aren't offered as duplicates.
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
    SELECT a.id AS a_id, b.id AS b_id, 'name' AS why
      FROM w a JOIN w b ON a.id < b.id
     WHERE NOT EXISTS (SELECT 1 FROM staff_distinct_pairs d WHERE d.a = a.id AND d.b = b.id)
       AND (lower(regexp_replace(a.employee_name, '[^[:alpha:]]', '', 'g')) = lower(regexp_replace(b.employee_name, '[^[:alpha:]]', '', 'g'))
            OR similarity(lower(a.employee_name), lower(b.employee_name)) > 0.6)
       AND NOT workers_overlap(a.id, b.id)
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

REVOKE EXECUTE ON FUNCTION workers_overlap(uuid, uuid) FROM PUBLIC, anon, authenticated;
