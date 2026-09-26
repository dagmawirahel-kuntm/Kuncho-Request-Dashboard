-- 353 — Staff records: what the fields mean, what they may hold, and a list
-- of what still needs fixing
--
-- A review of the staff table found:
--
--  * "Termination date" held contract end dates. All 40 were in the future
--    (2026–2034), each exactly 4 or 8 years after the start date, and every
--    one of the 165 staff was 'active' — nobody who left had ever been
--    marked as leaving. Those dates move to a new contract_end_date, and
--    termination_date goes back to meaning the day someone left. Setting
--    it to today or earlier marks them terminated.
--  * Free text drifting into near-duplicates: "Carpenter" / "carpenter " /
--    "Ass. Carpenter" / "Ass. carpenter " / "Ass. carpenters ", trailing
--    spaces on 16 names, "Upper Level Managment" while management_level
--    was empty for everyone, "tier2" used as a staff type (a place of work)
--    rather than an employment type, a payment frequency of '', phones of
--    "no". Normalised here; status, employment type, staff type and
--    payment frequency are held to the values the staff form offers.
--  * "Natnael" and "Natnael Deriba" are one person: the same bank account,
--    trade and day rate, on consecutive days of the same job. Merged with
--    merge_staff_records() (267), which moves every reference first.
--    The two "Belay" records are NOT merged — they worked the same days in
--    different trades, so they are two people who share a first name.
--  * Nothing stopped two staff records sharing a login or a national ID.
--  * The anon role held full grants on staff (RLS blocked it; it shouldn't
--    have to), and the HR policy was defined twice.
--
-- What can't be fixed from the data — no pay rate, two people on one bank
-- account, missing departments or phones — is listed in v_staff_data_issues
-- for HR, with contracts ending in the next 60 days.

SET search_path TO public;

-- ── 1. The duplicate Natnael ──────────────────────────────────────────────
DO $$
DECLARE v_keep uuid; v_merge uuid; v_admin uuid;
BEGIN
  SELECT id INTO v_keep FROM staff WHERE employee_name = 'Natnael Deriba' AND bank_account = '1000374771028';
  SELECT id INTO v_merge FROM staff WHERE btrim(employee_name) = 'Natnael' AND bank_account = '1000374771028';
  IF v_keep IS NOT NULL AND v_merge IS NOT NULL THEN
    -- merge_staff_records() is for admin/HR; run it as an admin, for this
    -- transaction only.
    SELECT id INTO v_admin FROM user_profiles WHERE role = 'admin' AND account_status = 'active' ORDER BY created_at LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    -- Both records hold the same account; the merge would collide on it.
    -- Keep the surviving record's row and point anything at the other to it.
    UPDATE payroll_staff p SET staff_bank_account_id = k.id
      FROM staff_bank_accounts d, staff_bank_accounts k
     WHERE p.staff_bank_account_id = d.id AND d.staff_id = v_merge AND k.staff_id = v_keep
       AND regexp_replace(k.account_number, '\D', '', 'g') = regexp_replace(d.account_number, '\D', '', 'g');
    DELETE FROM staff_bank_accounts d
     WHERE d.staff_id = v_merge
       AND EXISTS (SELECT 1 FROM staff_bank_accounts k WHERE k.staff_id = v_keep
                   AND regexp_replace(k.account_number, '\D', '', 'g') = regexp_replace(d.account_number, '\D', '', 'g'));
    PERFORM merge_staff_records(v_keep, v_merge);
    PERFORM set_config('request.jwt.claims', '', true);
  END IF;
END $$;

-- ── 2. Contract end vs the day someone left ───────────────────────────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS contract_end_date date;
COMMENT ON COLUMN staff.contract_end_date IS 'When the employment contract runs to.';
COMMENT ON COLUMN staff.termination_date IS 'The day the person left. On or before today, status is terminated.';

UPDATE staff SET contract_end_date = termination_date, termination_date = NULL
WHERE termination_date > current_date AND contract_end_date IS NULL;

-- ── 3. Normalise the text ─────────────────────────────────────────────────
UPDATE staff SET employee_name = btrim(regexp_replace(employee_name, '\s+', ' ', 'g'))
WHERE employee_name <> btrim(regexp_replace(employee_name, '\s+', ' ', 'g'));

UPDATE staff SET role = NULLIF(btrim(regexp_replace(role, '\s+', ' ', 'g')), '') WHERE role IS NOT NULL;
UPDATE staff SET role = CASE lower(role)
    WHEN 'carpenter' THEN 'Carpenter'
    WHEN 'ass. carpenter' THEN 'Ass. Carpenter'
    WHEN 'ass. carpenters' THEN 'Ass. Carpenter'
    WHEN 'painter' THEN 'Painter'
    WHEN 'upper level managment' THEN 'Upper Level Management'
    ELSE role END
WHERE lower(role) IN ('carpenter', 'ass. carpenter', 'ass. carpenters', 'painter', 'upper level managment');
UPDATE staff SET management_level = 'upper' WHERE role = 'Upper Level Management' AND management_level IS NULL;

-- "tier2" is how someone is employed, not where they work.
UPDATE staff SET employment_type = COALESCE(employment_type, 'tier_2_casual'), staff_type = NULL WHERE staff_type = 'tier2';

UPDATE staff SET payment_frequency = NULL WHERE btrim(coalesce(payment_frequency, '')) = '';
UPDATE staff SET payment_frequency = initcap(btrim(payment_frequency)) WHERE payment_frequency IS NOT NULL;
UPDATE staff SET phone_number = NULL WHERE phone_number IS NOT NULL AND regexp_replace(phone_number, '\D', '', 'g') = '';
UPDATE staff SET email = NULLIF(lower(btrim(email)), '') WHERE email IS NOT NULL;
UPDATE staff SET national_id = NULLIF(btrim(national_id), '') WHERE national_id IS NOT NULL;

-- ── 4. What the fields may hold ───────────────────────────────────────────
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_status_check;
ALTER TABLE staff ADD CONSTRAINT staff_status_check CHECK (status IN ('active', 'on_leave', 'terminated'));
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_employment_type_check;
ALTER TABLE staff ADD CONSTRAINT staff_employment_type_check
  CHECK (employment_type IS NULL OR employment_type IN ('Full Time', 'Part Time', 'Contract', 'Freelance', 'tier_2_casual'));
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_staff_type_check;
ALTER TABLE staff ADD CONSTRAINT staff_staff_type_check
  CHECK (staff_type IS NULL OR staff_type IN ('Office', 'Work Shop', 'Field', 'Leather Workshop', 'Site'));
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_payment_frequency_check;
ALTER TABLE staff ADD CONSTRAINT staff_payment_frequency_check
  CHECK (payment_frequency IS NULL OR payment_frequency IN ('Monthly', 'Bi-Weekly', 'Weekly', 'Daily'));
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_dates_check;
ALTER TABLE staff ADD CONSTRAINT staff_dates_check
  CHECK (termination_date IS NULL OR starting_date IS NULL OR termination_date >= starting_date);

-- One staff record per login, and per national ID.
CREATE UNIQUE INDEX IF NOT EXISTS staff_user_id_unique ON staff (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_national_id_unique ON staff (national_id) WHERE national_id IS NOT NULL;

-- ── 5. Keeping it that way ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tidy_staff_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.employee_name := btrim(regexp_replace(NEW.employee_name, '\s+', ' ', 'g'));
  NEW.role := NULLIF(btrim(regexp_replace(coalesce(NEW.role, ''), '\s+', ' ', 'g')), '');
  NEW.payment_frequency := NULLIF(btrim(coalesce(NEW.payment_frequency, '')), '');
  NEW.phone_number := NULLIF(btrim(coalesce(NEW.phone_number, '')), '');
  NEW.email := NULLIF(lower(btrim(coalesce(NEW.email, ''))), '');
  NEW.national_id := NULLIF(btrim(coalesce(NEW.national_id, '')), '');
  NEW.bank_account := NULLIF(btrim(coalesce(NEW.bank_account, '')), '');
  -- Someone whose leaving day has come has left.
  IF NEW.termination_date IS NOT NULL AND NEW.termination_date <= current_date AND NEW.status <> 'terminated' THEN
    NEW.status := 'terminated';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tidy_staff_record ON staff;
CREATE TRIGGER trg_tidy_staff_record BEFORE INSERT OR UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION tidy_staff_record();

-- A bank account typed on a new staff record becomes their primary account
-- in staff_bank_accounts (294), the one place accounts are kept; the
-- mirror trigger then keeps staff.bank_account showing it.
CREATE OR REPLACE FUNCTION staff_bank_account_from_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.bank_account IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM staff_bank_accounts b WHERE b.staff_id = NEW.id) THEN
    INSERT INTO staff_bank_accounts (staff_id, bank_id, account_number, is_primary, is_active)
    VALUES (NEW.id, NEW.bank_id, NEW.bank_account, true, true);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_staff_bank_account_from_record ON staff;
CREATE TRIGGER trg_staff_bank_account_from_record AFTER INSERT ON staff
  FOR EACH ROW EXECUTE FUNCTION staff_bank_account_from_record();

-- ── 6. Access ─────────────────────────────────────────────────────────────
REVOKE ALL ON staff FROM anon;
DROP POLICY IF EXISTS hr_officer_all_staff ON staff;   -- same as hr_officer_all

-- ── 7. What still needs a person to fix ───────────────────────────────────
CREATE OR REPLACE VIEW v_staff_data_issues WITH (security_invoker = true) AS
WITH s AS (SELECT * FROM staff WHERE status <> 'terminated'),
acct AS (
  SELECT regexp_replace(b.account_number, '\D', '', 'g') AS n, array_agg(DISTINCT b.staff_id) AS ids
  FROM staff_bank_accounts b JOIN s ON s.id = b.staff_id
  WHERE b.is_active AND coalesce(b.account_holder, '') = '' AND regexp_replace(b.account_number, '\D', '', 'g') <> ''
  GROUP BY 1 HAVING count(DISTINCT b.staff_id) > 1
)
SELECT 'contract_ending'::text AS kind, 'high'::text AS severity, s.id AS staff_id, s.employee_name,
  'Contract ends ' || to_char(s.contract_end_date, 'DD Mon YYYY') AS detail
FROM s WHERE s.contract_end_date BETWEEN current_date AND current_date + 60
UNION ALL
SELECT 'contract_ended', 'high', s.id, s.employee_name,
  'Contract ended ' || to_char(s.contract_end_date, 'DD Mon YYYY') || ' — renew it, or record the day they left'
FROM s WHERE s.contract_end_date < current_date
UNION ALL
SELECT 'no_pay_rate', 'high', s.id, s.employee_name, 'No monthly salary or day rate'
FROM s WHERE coalesce(s.monthly_salary, 0) = 0 AND coalesce(s.day_rate, 0) = 0
UNION ALL
SELECT 'shared_bank_account', 'high', s.id, s.employee_name,
  'Bank account ' || a.n || ' is also recorded as the own account of ' ||
  (SELECT string_agg(o.employee_name, ', ') FROM staff o WHERE o.id = ANY (a.ids) AND o.id <> s.id) ||
  ' — set whose name it is in'
FROM acct a JOIN s ON s.id = ANY (a.ids)
UNION ALL
SELECT 'same_name', 'medium', s.id, s.employee_name, 'Another active record has the same name — add a surname to tell them apart'
FROM s WHERE EXISTS (SELECT 1 FROM s o WHERE o.id <> s.id AND lower(o.employee_name) = lower(s.employee_name))
UNION ALL
SELECT 'no_employment_type', 'medium', s.id, s.employee_name, 'Employment type not set'
FROM s WHERE s.employment_type IS NULL
UNION ALL
SELECT 'no_department', 'medium', s.id, s.employee_name, 'No department'
FROM s WHERE s.department_id IS NULL AND s.employment_type IS DISTINCT FROM 'tier_2_casual'
UNION ALL
SELECT 'no_start_date', 'low', s.id, s.employee_name, 'No start date'
FROM s WHERE s.starting_date IS NULL AND s.employment_type IS DISTINCT FROM 'tier_2_casual'
UNION ALL
SELECT 'phone', 'low', s.id, s.employee_name,
  CASE WHEN s.phone_number IS NULL THEN 'No phone number' ELSE 'Phone number ' || s.phone_number || ' does not look right' END
FROM s WHERE (s.phone_number IS NULL AND s.employment_type IS DISTINCT FROM 'tier_2_casual')
   OR (s.phone_number IS NOT NULL AND length(regexp_replace(s.phone_number, '\D', '', 'g')) NOT IN (9, 10, 12));
REVOKE ALL ON v_staff_data_issues FROM PUBLIC, anon;
GRANT SELECT ON v_staff_data_issues TO authenticated;
