-- Piece workers carry no day rate (535), but three places still asked for one:
--  * HR verification listed "day rate" as missing for every casual worker, so
--    a piece worker could never be verified and their pay stayed held;
--  * adding someone new from a day sheet or a pasted report demanded a rate;
--  * confirming a PM's day pay stopped on anyone present without a rate, even
--    when none of their day went to day work.
-- A day rate is now asked for only where day work is paid.

-- 1. Verification: no day rate needed. Day pay itself still blocks a worker
--    with day work and no rate (no_rate / confirm_labour_day_pay).
CREATE OR REPLACE FUNCTION public.staff_verification_gaps(p_staff uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT array_remove(ARRAY[
    CASE WHEN worker_id_needed(s.id) AND NULLIF(btrim(s.phone_number), '') IS NULL THEN 'phone' END,
    CASE WHEN worker_id_needed(s.id) AND NULLIF(btrim(s.national_id), '') IS NULL AND s.id_document_url IS NULL THEN 'ID' END,
    CASE WHEN s.employment_type = 'tier_2_casual' AND s.trade_tag IS NULL THEN 'trade' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM staff_bank_accounts b
                           WHERE b.staff_id = s.id AND b.is_active AND b.bank_id IS NOT NULL
                             AND NULLIF(btrim(b.account_number), '') IS NOT NULL) THEN 'bank account' END
  ], NULL)
  FROM staff s WHERE s.id = p_staff;
$function$;

-- 2. A new worker can be added without a day rate (piece work); one given
--    must still be more than 0.
CREATE OR REPLACE FUNCTION public.labour_day_new_worker(p_pm uuid, p_name text, p_trade text, p_day_rate numeric, p_phone text DEFAULT NULL::text, p_photo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_photo text := CASE WHEN p_photo ~ '^https://' THEN btrim(p_photo) END;
  v_rate numeric := NULLIF(p_day_rate, 0);
  v_me text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  s staff%ROWTYPE;
BEGIN
  IF NOT labour_day_can_run(p_pm) THEN RAISE EXCEPTION 'You add workers to your own day sheet'; END IF;
  IF (SELECT starts_on FROM labour_day_settings WHERE id) IS NULL THEN RAISE EXCEPTION 'The day sheet hasn''t started yet'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Give the worker''s full name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tier2_trade_roster WHERE trade_tag = p_trade) THEN RAISE EXCEPTION 'Pick their trade'; END IF;
  IF v_rate < 0 THEN RAISE EXCEPTION 'A day rate is more than 0'; END IF;
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
      UPDATE staff SET status = 'active', day_rate = COALESCE(NULLIF(day_rate, 0), v_rate), trade_tag = COALESCE(trade_tag, p_trade),
             photo_url = COALESCE(photo_url, v_photo), last_engaged_at = CURRENT_DATE, updated_at = now()
       WHERE id = s.id;
      RETURN jsonb_build_object('staff_id', s.id, 'name', s.employee_name, 'existing', true,
                                'day_rate', COALESCE(NULLIF(s.day_rate, 0), v_rate), 'trade', COALESCE(s.trade_tag, p_trade));
    END IF;
  END IF;

  INSERT INTO staff (employee_name, phone_number, employment_type, status, trade_tag, day_rate, payment_frequency,
                     first_engaged_at, last_engaged_at, photo_url, details_by, details_by_name, details_at)
  VALUES (btrim(p_name), v_phone, 'tier_2_casual', 'active', p_trade, v_rate, 'Daily',
          CURRENT_DATE, CURRENT_DATE, v_photo, auth.uid(), v_me, now())
  RETURNING * INTO s;
  RETURN jsonb_build_object('staff_id', s.id, 'name', s.employee_name, 'existing', false, 'day_rate', s.day_rate, 'trade', s.trade_tag);
END $function$;

-- 3. Day pay: a missing rate stops the run only for someone with day work
--    (days put to a project), not for a piece worker who was just present.
DO $mig$
DECLARE
  v_old text := pg_get_functiondef('public.confirm_labour_day_pay(uuid, date, text)'::regprocedure);
  v_new text := replace(v_old,
    'AND w.pay_run_id IS NULL AND COALESCE(s.day_rate, 0) <= 0;',
    'AND w.pay_run_id IS NULL AND COALESCE(s.day_rate, 0) <= 0
       AND EXISTS (SELECT 1 FROM labour_day_allocations a WHERE a.day_id = d.id AND a.staff_id = w.staff_id AND a.days > 0);');
BEGIN
  IF v_new = v_old THEN RAISE EXCEPTION 'confirm_labour_day_pay: rate check not found'; END IF;
  EXECUTE v_new;
END $mig$;
