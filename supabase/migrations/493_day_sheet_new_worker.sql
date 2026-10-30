-- 493: a PM adds a brand-new day worker from their day sheet.
-- From the start date day-rate workers are no longer named on work-order
-- requests, so the day sheet is where a new person first comes in: name,
-- trade and day rate (the PM proposes it; HR confirms or corrects it when
-- verifying), phone and photo if they have them. A phone already on file
-- brings back that person instead of making a second one. The PM can then
-- fill in the rest (ID, bank) like any of their workers, and HR verifies as
-- before — pay stays held until then.
-- Day sheets also count toward "phone and ID from the 4th hire": each week a
-- worker is on a day sheet counts as one hire.

CREATE OR REPLACE FUNCTION public.labour_day_new_worker(p_pm uuid, p_name text, p_trade text, p_day_rate numeric,
                                                       p_phone text DEFAULT NULL, p_photo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_photo text := CASE WHEN p_photo ~ '^https://' THEN btrim(p_photo) END;
  v_me text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  s staff%ROWTYPE;
BEGIN
  IF NOT labour_day_can_run(p_pm) THEN RAISE EXCEPTION 'You add workers to your own day sheet'; END IF;
  IF (SELECT starts_on FROM labour_day_settings WHERE id) IS NULL THEN RAISE EXCEPTION 'The day sheet hasn''t started yet'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Give the worker''s full name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tier2_trade_roster WHERE trade_tag = p_trade) THEN RAISE EXCEPTION 'Pick their trade'; END IF;
  IF COALESCE(p_day_rate, 0) <= 0 THEN RAISE EXCEPTION 'Give their day rate — HR confirms it when they verify the worker'; END IF;
  IF v_phone IS NOT NULL AND length(regexp_replace(v_phone, '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'That phone number looks too short'; END IF;

  -- Already on file under this phone: bring them back, don't make a second record.
  IF v_phone IS NOT NULL THEN
    SELECT * INTO s FROM staff
     WHERE regexp_replace(COALESCE(phone_number, ''), '[^0-9+]', '', 'g') = v_phone
     ORDER BY (status = 'active') DESC LIMIT 1;
    IF s.id IS NOT NULL THEN
      IF COALESCE(s.employment_type, '') <> 'tier_2_casual' THEN
        RAISE EXCEPTION 'That phone belongs to % (%), who isn''t a casual worker', s.employee_name, COALESCE(s.employment_type, 'staff');
      END IF;
      UPDATE staff SET status = 'active', day_rate = COALESCE(day_rate, p_day_rate), trade_tag = COALESCE(trade_tag, p_trade),
             photo_url = COALESCE(photo_url, v_photo), last_engaged_at = CURRENT_DATE, updated_at = now()
       WHERE id = s.id;
      RETURN jsonb_build_object('staff_id', s.id, 'name', s.employee_name, 'existing', true,
                                'day_rate', COALESCE(s.day_rate, p_day_rate), 'trade', COALESCE(s.trade_tag, p_trade));
    END IF;
  END IF;

  INSERT INTO staff (employee_name, phone_number, employment_type, status, trade_tag, day_rate, payment_frequency,
                     first_engaged_at, last_engaged_at, photo_url, details_by, details_by_name, details_at)
  VALUES (btrim(p_name), v_phone, 'tier_2_casual', 'active', p_trade, p_day_rate, 'Daily',
          CURRENT_DATE, CURRENT_DATE, v_photo, auth.uid(), v_me, now())
  RETURNING * INTO s;
  RETURN jsonb_build_object('staff_id', s.id, 'name', s.employee_name, 'existing', false, 'day_rate', s.day_rate, 'trade', s.trade_tag);
END $f$;

-- The PM can fill in the details of workers on their day sheets (and of
-- someone they just added, until HR verifies them).
CREATE OR REPLACE FUNCTION public.can_photo_worker(p_staff uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false) OR is_ops_manager()
      OR EXISTS (SELECT 1 FROM labor_allocations a WHERE a.staff_id = p_staff AND can_run_labour_site(a.project_id))
      OR EXISTS (SELECT 1 FROM labor_requisition_workers w JOIN labor_requisitions r ON r.id = w.requisition_id
                  WHERE w.staff_id = p_staff AND can_run_labour_site(r.project_id))
      OR EXISTS (SELECT 1 FROM labour_day_workers w JOIN labour_days d ON d.id = w.day_id
                  WHERE w.staff_id = p_staff AND d.pm_staff_id = current_staff_id() AND d.work_date >= CURRENT_DATE - 60)
      OR EXISTS (SELECT 1 FROM labour_day_job_crew c JOIN labour_days d ON d.id = c.day_id
                  WHERE c.staff_id = p_staff AND d.pm_staff_id = current_staff_id() AND d.work_date >= CURRENT_DATE - 60)
      OR EXISTS (SELECT 1 FROM staff s WHERE s.id = p_staff AND s.verified_at IS NULL AND s.details_by = auth.uid());
$function$;

-- A week on a day sheet counts as a hire for the phone-and-ID rule (483).
CREATE OR REPLACE FUNCTION public.worker_hire_count(p_staff uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (SELECT count(DISTINCT w.requisition_id)::int
            FROM labor_requisition_workers w
            JOIN labor_requisitions r ON r.id = w.requisition_id AND r.status = 'approved'
           WHERE w.staff_id = p_staff
             AND r.created_at >= timestamptz '2026-10-28 00:00+03')
       + (SELECT count(DISTINCT date_trunc('week', x.work_date))::int
            FROM (SELECT d.work_date FROM labour_day_workers w JOIN labour_days d ON d.id = w.day_id WHERE w.staff_id = p_staff
                  UNION ALL
                  SELECT d.work_date FROM labour_day_job_crew c JOIN labour_days d ON d.id = c.day_id WHERE c.staff_id = p_staff) x
           WHERE x.work_date >= date '2026-10-28');
$function$;

-- Worker details: the PM's list includes everyone on their day sheets in
-- the last 30 days and anyone they just added.
CREATE OR REPLACE FUNCTION public.my_workers_details()
 RETURNS TABLE(kind text, id uuid, name text, phone text, photo_url text, sites text, gaps text[], verified boolean, details_at timestamp with time zone, details_by_name text, returned_reason text, returned_by_name text, last_worked date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH mine AS (
    SELECT DISTINCT a.staff_id, p.project_name
      FROM labor_allocations a JOIN projects p ON p.id = a.project_id
     WHERE a.status = 'active' AND can_run_labour_site(a.project_id)
    UNION
    SELECT DISTINCT w.staff_id, p.project_name
      FROM labor_requisition_workers w JOIN labor_requisitions r ON r.id = w.requisition_id JOIN projects p ON p.id = r.project_id
     WHERE r.closed_at IS NULL AND r.status IN ('pending', 'approved') AND can_run_labour_site(r.project_id)
    UNION
    SELECT DISTINCT w.staff_id, p.project_name
      FROM labour_day_workers w JOIN labour_days d ON d.id = w.day_id
      JOIN labour_day_allocations a ON a.day_id = d.id AND a.staff_id = w.staff_id JOIN projects p ON p.id = a.project_id
     WHERE d.work_date >= CURRENT_DATE - 30 AND (d.pm_staff_id = current_staff_id() OR labour_day_is_approver())
    UNION
    SELECT DISTINCT c.staff_id, p.project_name
      FROM labour_day_job_crew c JOIN labour_days d ON d.id = c.day_id
      JOIN labor_requisitions r ON r.id = c.labor_requisition_id JOIN projects p ON p.id = r.project_id
     WHERE d.work_date >= CURRENT_DATE - 30 AND (d.pm_staff_id = current_staff_id() OR labour_day_is_approver())
    UNION
    SELECT s.id, 'New on the day sheet' FROM staff s
     WHERE s.details_by = auth.uid() AND s.verified_at IS NULL AND s.employment_type = 'tier_2_casual' AND s.created_at >= now() - interval '30 days'
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
         GREATEST((SELECT max(e.work_date) FROM labour_work_entries e WHERE e.staff_id = s.id),
                  (SELECT max(d.work_date) FROM labour_day_workers w JOIN labour_days d ON d.id = w.day_id WHERE w.staff_id = s.id))
    FROM people pp JOIN staff s ON s.id = pp.staff_id
   WHERE s.employment_type = 'tier_2_casual' AND s.status = 'active'
  UNION ALL
  SELECT 'candidate', c.id, c.full_name, c.phone, c.photo_url, cc.sites, candidate_detail_gaps(c.id), false,
         c.details_at, c.details_by_name, NULL, NULL, NULL
    FROM cands cc JOIN candidates c ON c.id = cc.id
   ORDER BY 11 NULLS LAST, 3;
$function$;

-- HR confirms or corrects the day rate the site proposed, without taking
-- over who filled in the details.
CREATE OR REPLACE FUNCTION public.worker_set_day_rate(p_staff uuid, p_rate numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer') THEN RAISE EXCEPTION 'HR sets the day rate'; END IF;
  IF COALESCE(p_rate, 0) <= 0 THEN RAISE EXCEPTION 'A day rate is more than 0'; END IF;
  UPDATE staff SET day_rate = p_rate, updated_at = now() WHERE id = p_staff AND employment_type = 'tier_2_casual';
  IF NOT FOUND THEN RAISE EXCEPTION 'Casual worker not found'; END IF;
END $f$;
