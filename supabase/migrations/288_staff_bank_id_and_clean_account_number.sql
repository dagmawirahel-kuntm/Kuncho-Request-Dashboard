-- 288 — staff.bank_account was one free-text column doing three jobs
--
-- A payment instruction needs to say which bank as well as which account, and
-- there was nowhere to put the bank. So people put it in the account number,
-- and the live data shows exactly that:
--
--   75 rows  a clean 13-digit CBE number ("1000008120076")
--    4 rows  "238615879 - BOA", "264049954 - BOA", "231019928 - BOA"
--    1 row   "0071454911001"                        — a bank we can't name
--    1 row   "01320652937800 - Adunga"              — account + a person
--    1 row   "1000671632738 asenaku besher"         — account + a person
--    1 row   "1000070442648 Mesfin Bekele/ 155083603-BOA"
--                                                   — two accounts, one field
--
-- On a Payment Request that column prints straight into "Bank Account", so
-- four staff hand the bank an instruction it cannot act on and one hands it
-- two accounts at once. It matters most on a payroll run, where one document
-- covers many payees and a CBE bulk transfer cannot carry a BOA account.
--
-- This splits the field in two: bank_id names the bank, bank_account holds
-- the number and nothing else. bank_id points at `accounts`, which is already
-- serving as the bank directory — twenty-odd rows (Abay, Dashen, Enat, Nib,
-- Wegagen …) exist there with no account number and no activity, purely to
-- list a bank. Rows like CBE and BOA are the company's own account at that
-- bank and double as its directory entry; that overloading predates this
-- change and is left alone.
--
-- Nothing is discarded. Where the old text carried more than a number, the
-- original string is kept verbatim in bank_account_note, because a holder
-- name is not noise — it says the money reaches this person through someone
-- else's account, which is a fact about how they get paid.
--
-- Deliberately NOT guessed:
--   * "0071454911001" — no bank named anywhere in the row. bank_id left null.
--   * Girma's "01320652937800 - Adunga" — the 013 prefix matches the pattern
--     of the company's own Awash account (013041355816000), but "matches a
--     prefix" is not evidence, and "Adunga" is a person, not a bank. Number
--     kept, bank left null, original preserved.
--   * Aragaw Welde's second account (155083603 at BOA) — the CBE number is
--     taken as the account and the whole original preserved. Which of the two
--     he is actually paid through is not something to infer.
--
-- Also worth someone's attention, and not touched here: Semengew Yetayh and
-- Wude Shumet are two different people recorded against the same account,
-- 238615879 at BOA.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES accounts(id);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_account_note text;

COMMENT ON COLUMN staff.bank_id IS
  'Bank holding this staff member''s account, referencing the bank directory in accounts.';
COMMENT ON COLUMN staff.bank_account IS
  'Account number only. The bank belongs in bank_id; anything else the original text carried is in bank_account_note.';
COMMENT ON COLUMN staff.bank_account_note IS
  'Verbatim original of a bank_account value that carried more than a number — typically the name of the person whose account is used.';

DO $$
DECLARE
  v_cbe uuid := '890c3473-dc57-4c01-9f39-17518047c463';
  v_boa uuid := '20835a83-e3b2-4677-9528-76707056730f';
  v_cbe_n int; v_boa_n int; v_kept int; v_left int;
BEGIN
  -- Preserve the original wherever it was more than digits, before any edit.
  UPDATE staff
     SET bank_account_note = trim(bank_account)
   WHERE bank_account IS NOT NULL
     AND trim(bank_account) <> ''
     AND NOT trim(bank_account) ~ '^[0-9]+$'
     AND bank_account_note IS NULL;
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  UPDATE staff SET bank_account = trim(bank_account)
   WHERE bank_account IS DISTINCT FROM trim(bank_account);
  UPDATE staff SET bank_account = NULL WHERE bank_account = '';

  -- "<digits> - BOA" — the bank is named, so the split is unambiguous.
  UPDATE staff
     SET bank_id      = v_boa,
         bank_account = (regexp_match(trim(bank_account), '^([0-9]+)'))[1]
   WHERE trim(bank_account) ~* '^[0-9]+\s*-\s*BOA$';
  GET DIAGNOSTICS v_boa_n = ROW_COUNT;

  -- A bare 13-digit 1000-series number is CBE's format, and every one of
  -- these staff is paid from the CBE account today.
  UPDATE staff
     SET bank_id = v_cbe
   WHERE bank_id IS NULL
     AND trim(bank_account) ~ '^1000[0-9]{9}$';
  GET DIAGNOSTICS v_cbe_n = ROW_COUNT;

  -- Two rows lead with a clean CBE number and then a name; take the number,
  -- keep the whole original in the note (already saved above).
  UPDATE staff
     SET bank_id      = v_cbe,
         bank_account = (regexp_match(trim(bank_account), '^(1000[0-9]{9})'))[1]
   WHERE bank_id IS NULL
     AND trim(bank_account) ~ '^1000[0-9]{9}[^0-9]';

  -- Girma: number kept, bank not guessed (see header).
  UPDATE staff
     SET bank_account = (regexp_match(trim(bank_account), '^([0-9]+)'))[1]
   WHERE bank_id IS NULL
     AND trim(bank_account) ~ '^[0-9]+\s*-\s*[A-Za-z]';

  SELECT count(*) INTO v_left
    FROM staff
   WHERE bank_account IS NOT NULL AND trim(bank_account) <> '' AND bank_id IS NULL;

  IF EXISTS (SELECT 1 FROM staff
              WHERE bank_account IS NOT NULL AND trim(bank_account) <> ''
                AND NOT trim(bank_account) ~ '^[0-9]+$') THEN
    RAISE EXCEPTION 'A bank_account still holds something other than digits — aborting';
  END IF;

  RAISE NOTICE 'bank set: % CBE, % BOA; % originals preserved; % accounts still without a bank',
    v_cbe_n, v_boa_n, v_kept, v_left;
END $$;
