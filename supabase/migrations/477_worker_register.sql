-- 477: HR keeps the worker register straight; pay waits for it.
--
-- Of 140 active casual workers, 126 had no ID on file, 123 no phone, 76 no
-- bank account and 55 no trade; eight pairs looked like the same person
-- twice (Mngesha/Mengesha, four "Werkneh Fantu"s) and six bank accounts
-- were shared without a word on why. People are hired on site by name,
-- and nobody's job was to make the record right.
--
-- Now HR verifies each worker: name, phone, ID (number or a photo of it),
-- trade, day rate and where their pay goes (their own bank account, or
-- someone else's with the holder named). A change to the name, ID or bank
-- account after that takes the verification off again.
--
-- From labour_pay_hold_settings.hold_from (two weeks after this goes in),
-- pay for a worker who isn't verified is held: it stays out of the payment
-- until HR verifies them (migration 478 does the holding).
--
--   staff_verification_gaps(staff)  what is missing, as short words
--   verify_worker(staff, note)      HR marks them verified, if nothing is missing
--   unverify_worker(staff, reason)
--   worker_pay_held(staff)          true when their pay is held now
--   worker_register()               HR's queue: to verify, possible duplicates, counts
--   merge_workers(keep, merge)      merge_staff_records, plus the pay sheets' worker lines

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_by_name text,
  ADD COLUMN IF NOT EXISTS verification_note text;
COMMENT ON COLUMN staff.verified_at IS 'When HR last verified this worker''s identity, phone, trade, rate and bank (477). Cleared when the name, ID or bank account changes.';

CREATE TABLE IF NOT EXISTS labour_pay_hold_settings (
  id        boolean PRIMARY KEY DEFAULT true CHECK (id),
  hold_from date NOT NULL DEFAULT (CURRENT_DATE + 14),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL
);
INSERT INTO labour_pay_hold_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE labour_pay_hold_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'labour_pay_hold_settings' AND policyname = 'labour_pay_hold_read') THEN
    EXECUTE 'CREATE POLICY labour_pay_hold_read ON labour_pay_hold_settings FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_labour_pay_hold_from(p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer', 'finance') THEN
    RAISE EXCEPTION 'Only HR, finance or an admin can change when pay starts being held';
  END IF;
  UPDATE labour_pay_hold_settings SET hold_from = p_date, updated_at = now(), updated_by = auth.uid() WHERE id;
END $function$;

-- ── What's missing ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_verification_gaps(p_staff uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT array_remove(ARRAY[
    CASE WHEN NULLIF(btrim(s.phone_number), '') IS NULL THEN 'phone' END,
    CASE WHEN NULLIF(btrim(s.national_id), '') IS NULL AND s.id_document_url IS NULL THEN 'ID' END,
    CASE WHEN s.employment_type = 'tier_2_casual' AND s.trade_tag IS NULL THEN 'trade' END,
    CASE WHEN s.employment_type = 'tier_2_casual' AND COALESCE(s.day_rate, 0) <= 0 THEN 'day rate' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM staff_bank_accounts b
                           WHERE b.staff_id = s.id AND b.is_active AND b.bank_id IS NOT NULL
                             AND NULLIF(btrim(b.account_number), '') IS NOT NULL) THEN 'bank account' END
  ], NULL)
  FROM staff s WHERE s.id = p_staff;
$function$;

CREATE OR REPLACE FUNCTION public.verify_worker(p_staff uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_gaps text[];
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer') THEN
    RAISE EXCEPTION 'HR verifies workers';
  END IF;
  v_gaps := staff_verification_gaps(p_staff);
  IF v_gaps IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF cardinality(v_gaps) > 0 THEN
    RAISE EXCEPTION 'Still missing: %', array_to_string(v_gaps, ', ');
  END IF;
  UPDATE staff SET verified_at = now(), verified_by = auth.uid(),
         verified_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()),
         verification_note = NULLIF(btrim(p_note), '')
   WHERE id = p_staff;
END $function$;

CREATE OR REPLACE FUNCTION public.unverify_worker(p_staff uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer') THEN RAISE EXCEPTION 'HR verifies workers'; END IF;
  UPDATE staff SET verified_at = NULL, verification_note = NULLIF(btrim(p_reason), '') WHERE id = p_staff;
END $function$;

-- A change to who they are or where their pay goes needs HR to look again.
CREATE OR REPLACE FUNCTION public.trg_staff_identity_change_unverifies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
     AND (NEW.employee_name IS DISTINCT FROM OLD.employee_name OR NEW.national_id IS DISTINCT FROM OLD.national_id
          OR NEW.bank_account IS DISTINCT FROM OLD.bank_account OR NEW.bank_id IS DISTINCT FROM OLD.bank_id) THEN
    NEW.verified_at := NULL;
    NEW.verification_note := 'Name, ID or bank account changed — verify again';
  END IF;
  RETURN NEW;
END $function$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_identity_change_unverifies') THEN
    EXECUTE 'CREATE TRIGGER trg_staff_identity_change_unverifies BEFORE UPDATE ON public.staff
             FOR EACH ROW EXECUTE FUNCTION trg_staff_identity_change_unverifies()';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_bank_account_change_unverifies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s uuid := COALESCE(NEW.staff_id, OLD.staff_id);
BEGIN
  IF TG_OP = 'INSERT' OR NEW.account_number IS DISTINCT FROM OLD.account_number OR NEW.bank_id IS DISTINCT FROM OLD.bank_id
     OR NEW.account_holder IS DISTINCT FROM OLD.account_holder OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    UPDATE staff SET verified_at = NULL, verification_note = 'Bank account changed — verify again'
     WHERE id = s AND verified_at IS NOT NULL;
  END IF;
  RETURN NULL;
END $function$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bank_account_change_unverifies') THEN
    EXECUTE 'CREATE TRIGGER trg_bank_account_change_unverifies AFTER INSERT OR UPDATE ON public.staff_bank_accounts
             FOR EACH ROW EXECUTE FUNCTION trg_bank_account_change_unverifies()';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.worker_pay_held(p_staff uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(s.employment_type = 'tier_2_casual' AND s.verified_at IS NULL AND CURRENT_DATE >= h.hold_from, false)
    FROM staff s CROSS JOIN labour_pay_hold_settings h WHERE s.id = p_staff AND h.id;
$function$;

-- HR's answer that two look-alike records are different people.
CREATE TABLE IF NOT EXISTS staff_distinct_pairs (
  a uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  b uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  marked_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a, b), CHECK (a < b)
);
ALTER TABLE staff_distinct_pairs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mark_workers_distinct(p_a uuid, p_b uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer') THEN RAISE EXCEPTION 'HR decides this'; END IF;
  INSERT INTO staff_distinct_pairs (a, b, marked_by) VALUES (LEAST(p_a, p_b), GREATEST(p_a, p_b), auth.uid()) ON CONFLICT DO NOTHING;
END $function$;
GRANT EXECUTE ON FUNCTION mark_workers_distinct(uuid, uuid) TO authenticated;

-- ── HR's queue ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.worker_register()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer', 'executive', 'finance', 'operations_manager') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  WITH w AS (
    SELECT s.*, staff_verification_gaps(s.id) AS gaps,
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
     WHERE NOT EXISTS (SELECT 1 FROM staff_distinct_pairs d WHERE d.a = a.id AND d.b = b.id) AND (lower(regexp_replace(a.employee_name, '[^[:alpha:]]', '', 'g')) = lower(regexp_replace(b.employee_name, '[^[:alpha:]]', '', 'g'))
        OR similarity(lower(a.employee_name), lower(b.employee_name)) > 0.6)
    UNION
    SELECT a.staff_id, b.staff_id, 'bank'
      FROM staff_bank_accounts a JOIN staff_bank_accounts b
        ON a.staff_id < b.staff_id AND a.is_active AND b.is_active
       AND regexp_replace(a.account_number, '\D', '', 'g') = regexp_replace(b.account_number, '\D', '', 'g')
       AND NULLIF(regexp_replace(a.account_number, '\D', '', 'g'), '') IS NOT NULL
     WHERE a.account_holder IS NULL AND b.account_holder IS NULL
       AND NOT EXISTS (SELECT 1 FROM staff_distinct_pairs d WHERE d.a = a.staff_id AND d.b = b.staff_id)
       AND EXISTS (SELECT 1 FROM w WHERE w.id = a.staff_id) AND EXISTS (SELECT 1 FROM w WHERE w.id = b.staff_id)
  ), card AS (
    SELECT w.id, jsonb_build_object('id', w.id, 'name', w.employee_name, 'phone', w.phone_number, 'national_id', w.national_id,
             'has_id_photo', w.id_document_url IS NOT NULL, 'trade', w.trade_tag, 'day_rate', w.day_rate, 'bank', w.bank,
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
       'pay_waiting_unverified', (SELECT COALESCE(sum(pay_waiting), 0) FROM w WHERE verified_at IS NULL)),
    'to_verify', COALESCE((SELECT jsonb_agg(c.j ORDER BY (w.pay_waiting > 0) DESC, w.last_worked DESC NULLS LAST, w.employee_name)
                             FROM w JOIN card c ON c.id = w.id WHERE w.verified_at IS NULL), '[]'::jsonb),
    'verified', COALESCE((SELECT jsonb_agg(c.j ORDER BY w.employee_name) FROM w JOIN card c ON c.id = w.id WHERE w.verified_at IS NOT NULL), '[]'::jsonb),
    'duplicates', COALESCE((SELECT jsonb_agg(jsonb_build_object('why', p.why, 'a', ca.j, 'b', cb.j))
                              FROM pairs p JOIN card ca ON ca.id = p.a_id JOIN card cb ON cb.id = p.b_id), '[]'::jsonb))
  INTO v;
  RETURN v;
END $function$;

-- Merging also fixes the worker lines kept inside confirmed pay sheets.
CREATE OR REPLACE FUNCTION public.merge_workers(p_keep uuid, p_merge uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_name text; v_out jsonb;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer') THEN RAISE EXCEPTION 'HR merges worker records'; END IF;
  SELECT employee_name INTO v_name FROM staff WHERE id = p_keep;
  UPDATE labour_pay_sheets
     SET lines = (SELECT jsonb_agg(CASE WHEN el->>'staff_id' = p_merge::text
                                        THEN el || jsonb_build_object('staff_id', p_keep, 'worker_name', v_name) ELSE el END ORDER BY ord)
                    FROM jsonb_array_elements(lines) WITH ORDINALITY t(el, ord))
   WHERE lines::text LIKE '%' || p_merge::text || '%';
  SELECT jsonb_agg(to_jsonb(m)) INTO v_out FROM merge_staff_records(p_keep, p_merge) m;
  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION staff_verification_gaps(uuid), verify_worker(uuid, text), unverify_worker(uuid, text),
  worker_pay_held(uuid), worker_register(), merge_workers(uuid, uuid), set_labour_pay_hold_from(date) TO authenticated;
