-- 294 — a staff member can hold accounts at several banks, and payroll picks one
--
-- 288 gave staff.bank_account a bank beside it, which fixed the immediate
-- problem: a number with no bank is not a payment instruction. It kept one
-- account per person, and 293 showed what that costs. Importing the Zemen
-- workshop salary sheet did not add an account to those 22 people — it
-- overwrote the one they had. Fourteen CBE numbers and Mahlet Tsegaye's
-- Ahadu number were displaced, and survive only as prose in
-- bank_account_note. That is not somewhere payroll can select from.
--
-- People genuinely do hold more than one account: a CBE account from before
-- the workshop moved to Zemen, an account in a relative's name, a second bank
-- for a particular kind of payment. The record has to hold all of them and
-- let whoever prepares a payment say which one this payment uses.
--
-- WHAT THIS ADDS
--
--   staff_bank_accounts   every account a person holds, one row each, with
--                         the bank, the number, and — where the account is
--                         not in their own name — whose it is. Exactly one
--                         per person is the primary, enforced by a partial
--                         unique index rather than by convention.
--
-- staff.bank_id and staff.bank_account are kept, and kept correct: a trigger
-- mirrors the primary account back onto them. Every existing reader — the
-- Payment Request document, the payroll page, the disbursement schedule —
-- keeps working untouched and keeps showing the primary. Nothing has to move
-- to the new table in the same change that introduces it.
--
-- WHAT IT RECOVERS
--
-- The 14 accounts 293 displaced are read back out of their notes and
-- inserted as real, non-primary accounts. They stop being prose. The note
-- itself is cleared on those rows, because the account it described now
-- exists as a row — leaving both would be the same fact in two places, and
-- the payroll page prints a note in amber as though something were unsettled.
--
-- Three notes are deliberately NOT parsed into accounts:
--   * Aragaw Welde's says the BOA account "is not used" — recording it as an
--     account he holds would contradict the only thing anyone confirmed.
--   * Kedir's and Aragaw's both name whose account the money goes through.
--     That is the account_holder column's job, and both are set from it.
--   * Girma's is still the raw "01320652937800 - Adunga", never confirmed.
--     It stays a note until someone says whether Adunga holds that account.

CREATE TABLE IF NOT EXISTS staff_bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  bank_id         uuid REFERENCES accounts(id),
  account_number  text NOT NULL,
  -- Set only when the account is in someone else's name; the Payment Request
  -- needs it, because "pay Aragaw" against an account titled Mesfin Bekele is
  -- what a bank bounces.
  account_holder  text,
  label           text,
  is_primary      boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_bank_accounts_number_not_blank CHECK (btrim(account_number) <> '')
);

COMMENT ON TABLE staff_bank_accounts IS
  'Every bank account a staff member holds. staff.bank_id/bank_account mirror whichever row is primary.';

CREATE UNIQUE INDEX IF NOT EXISTS staff_bank_accounts_unique_per_bank
  ON staff_bank_accounts (staff_id, COALESCE(bank_id::text, ''), account_number);

-- One primary per person, enforced rather than assumed.
CREATE UNIQUE INDEX IF NOT EXISTS staff_bank_accounts_one_primary
  ON staff_bank_accounts (staff_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS staff_bank_accounts_staff ON staff_bank_accounts (staff_id);

DROP TRIGGER IF EXISTS set_updated_at ON staff_bank_accounts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Keep staff.bank_id/bank_account showing the primary, so every existing
-- reader stays correct without being rewritten.
CREATE OR REPLACE FUNCTION public.mirror_primary_staff_bank_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff uuid := COALESCE(NEW.staff_id, OLD.staff_id);
BEGIN
  UPDATE staff s
     SET bank_id      = p.bank_id,
         bank_account = p.account_number
    FROM staff_bank_accounts p
   WHERE p.staff_id = v_staff AND p.is_primary
     AND s.id = v_staff
     AND (s.bank_id IS DISTINCT FROM p.bank_id OR s.bank_account IS DISTINCT FROM p.account_number);

  -- The last account going away leaves the person with none, and the mirror
  -- has to say so rather than keep a stale number.
  IF NOT EXISTS (SELECT 1 FROM staff_bank_accounts WHERE staff_id = v_staff AND is_primary) THEN
    UPDATE staff SET bank_id = NULL, bank_account = NULL
     WHERE id = v_staff AND (bank_id IS NOT NULL OR bank_account IS NOT NULL);
  END IF;

  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_mirror_primary_staff_bank_account ON staff_bank_accounts;
CREATE TRIGGER trg_mirror_primary_staff_bank_account
  AFTER INSERT OR UPDATE OR DELETE ON staff_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION mirror_primary_staff_bank_account();

-- Switching the primary is two writes that must not be separable, so it gets
-- a function rather than being left to each caller.
CREATE OR REPLACE FUNCTION public.set_primary_staff_bank_account(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff uuid;
BEGIN
  SELECT staff_id INTO v_staff FROM staff_bank_accounts WHERE id = p_account_id;
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Bank account % not found', p_account_id;
  END IF;

  UPDATE staff_bank_accounts SET is_primary = false
   WHERE staff_id = v_staff AND is_primary AND id <> p_account_id;
  UPDATE staff_bank_accounts SET is_primary = true, is_active = true
   WHERE id = p_account_id;
END $function$;

ALTER TABLE staff_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_bank_accounts_read ON staff_bank_accounts;
CREATE POLICY staff_bank_accounts_read ON staff_bank_accounts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS staff_bank_accounts_write ON staff_bank_accounts;
CREATE POLICY staff_bank_accounts_write ON staff_bank_accounts
  FOR ALL TO authenticated
  USING (get_user_role() IN ('admin', 'executive', 'finance', 'hr_officer'))
  WITH CHECK (get_user_role() IN ('admin', 'executive', 'finance', 'hr_officer'));

-- ── Backfill ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_primary int; v_recovered int;
BEGIN
  -- Current account becomes the primary.
  INSERT INTO staff_bank_accounts (staff_id, bank_id, account_number, account_holder, is_primary, label)
  SELECT s.id, s.bank_id, s.bank_account,
         CASE
           WHEN s.bank_account_note ILIKE 'Paid via %' THEN
             btrim(substring(s.bank_account_note from 'Paid via (.*?)''s'))
           ELSE NULL
         END,
         true,
         CASE WHEN a.account_name = 'ZMNBNK' THEN 'Workshop salary' END
  FROM staff s
  LEFT JOIN accounts a ON a.id = s.bank_id
  WHERE s.bank_account IS NOT NULL AND btrim(s.bank_account) <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_primary = ROW_COUNT;

  -- The accounts 293 displaced, read back out of the note it left behind.
  INSERT INTO staff_bank_accounts (staff_id, bank_id, account_number, is_primary, is_active, label)
  SELECT s.id, a.id,
         substring(s.bank_account_note from 'Previously recorded: ([0-9]+)'),
         false, false,
         'Superseded by the Zemen workshop salary account (Sep 2026)'
  FROM staff s
  LEFT JOIN accounts a
    ON a.account_name = btrim(substring(s.bank_account_note from ' at (.*)\. Replaced'))
  WHERE s.bank_account_note LIKE 'Previously recorded:%'
    AND substring(s.bank_account_note from 'Previously recorded: ([0-9]+)') IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_recovered = ROW_COUNT;

  IF v_recovered <> 14 THEN
    RAISE EXCEPTION 'Expected to recover 14 displaced accounts, recovered % — aborting', v_recovered;
  END IF;

  -- That fact now lives in a row, so it should not also live in prose.
  UPDATE staff SET bank_account_note = NULL WHERE bank_account_note LIKE 'Previously recorded:%';

  RAISE NOTICE '% primary accounts, % recovered', v_primary, v_recovered;
END $$;
