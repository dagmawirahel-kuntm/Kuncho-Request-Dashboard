-- 293 — 22 workshop salary accounts moved to Zemen Bank
--
-- From "Wshop Salary through zemen bank" (Google Sheets export), which lists
-- 24 people in two blocks totalling 160,000.00 and 325,000.00. Both totals
-- add up against their own rows, and every account number is a 16-digit
-- 1611… Zemen number.
--
-- 22 of the 24 resolve to a staff record. Two do not and are left alone —
-- see the end of this comment.
--
-- Name matching was exact for 20. Two needed a judgement, and both are
-- safe:
--
--   "Betelhem Sime"  -> Betelehem Sime. One letter, same surname, and the
--                       sheet's 13,000.00 is her recorded monthly salary.
--   "Addisu ████ol"  -> Addisu Chekol. Four glyphs in that name are missing
--                       from the PDF's ToUnicode map, so they extract as
--                       nothing; the gap is exactly four characters and the
--                       surviving tail is "ol". "Chek" is four characters,
--                       and Addisu Chekol is the only Addisu in the
--                       workshop.
--
-- REPLACING, NOT ADDING. staff holds one account, so a Zemen account
-- displaces whatever was there. Fourteen of these people had a CBE number
-- recorded and one had Ahadu; none of it is discarded — the previous bank
-- and number are written into bank_account_note, which is what that column
-- is for, so the change is visible and reversible.
--
-- Mahlet Tsegaye is the one to look at. 292 set her to Ahadu Bank
-- 0071454911001 on the strength of a direct instruction; this sheet gives
-- her Zemen 1611411247171010. Both may be real accounts, but the schema
-- keeps one, and this sheet is a salary payment document — which is what
-- the field is for — so Zemen wins and Ahadu is preserved in her note.
--
-- NOT DONE, deliberately: "Dawit Kassahun" (1611411329279017, 20,000.00) and
-- "Yonatan Nega" (1611411247188013, 10,000.00) have no staff record at all.
-- Both names extracted complete — no dropped glyphs — so they are not
-- mis-read versions of anyone here. Creating staff for them would mean
-- inventing a role, type and salary, so they are left for a person.

DO $$
DECLARE
  v_zemen uuid := '57593858-2bf0-4ff8-a6f4-5df8eb89fbe5';  -- ZMNBNK
  v_n int;
BEGIN
  CREATE TEMP TABLE _zemen (staff_id uuid, acct text) ON COMMIT DROP;
  INSERT INTO _zemen VALUES
    ('3eaec7c7-7ac3-4f21-b43d-ae1cd238fd8a','1611411247191018'), -- Abel Yohannes
    ('b27bcbf7-a865-4331-8eb3-c3089c8e66d8','1611411247166010'), -- Addisu Chekol
    ('986afb99-8bdb-4b84-a76d-dc08b121627c','1611411247184012'), -- Aschalew Sisay
    ('9cd5c951-86f8-42ba-9eca-bc6136fdd50f','1611411247168016'), -- Azmeraw Teshager
    ('45c6edd7-46c6-4e9a-af8c-706de6cba521','1611411329243018'), -- Bahiru Eiticha
    ('7bde45c3-69d7-458c-b57d-4b4ac094a973','1611411247161017'), -- Betelehem Sime
    ('04b42109-a0c4-4c09-bffc-95c0a8e5cfcb','1611111247137013'), -- Dagmawi Fitsum
    ('aad1454f-a1e0-4e4c-95c0-a1755070dabb','1611411247165018'), -- Dawit Abiy
    ('e29d9996-6c3d-4f49-97c6-44d868df03e0','1611411329250015'), -- Dawit Tsega
    ('8da8c3ee-c267-476e-9668-93a78762604f','1611411247189016'), -- Dawit Zeleke
    ('75ac7e01-9498-45f9-a7ce-a7b5d741465f','1611411247192010'), -- Desalew Kassahun
    ('ebff8ebe-7684-4b90-8130-ab10caeedb2b','1611411329244012'), -- Ermiyas Tiget
    ('7d2fb4ba-745f-46dc-9ed2-ba0be902f2fc','1611411247183018'), -- Ezra Ejigu
    ('c2b41769-2439-4f41-b5e9-9721664aefc7','1611411247181014'), -- Filimon Weleabzgi
    ('701aef2b-c9e2-4681-8ebc-bff3a5408c3d','1611411329249016'), -- Habteshet Kassaie
    ('c07d26b0-f4ad-410f-8810-570460541443','1611411247169019'), -- Hayat Seid
    ('2c662410-cbc3-4f27-a3ee-093227359ddf','1611411247190015'), -- Kassahun gezu
    ('8600b212-658d-4fd1-8ce8-f367d783ec16','1611411247171010'), -- Mahlet Tsegaye (was Ahadu)
    ('c6807e49-673d-4edf-940c-5b71f3b8e28d','1611411247182017'), -- Naif Tesfaye
    ('97a3bb65-481d-4635-a1d4-c6479f1e0274','1611411247180011'), -- Petros Geresu
    ('e992a049-31bd-4391-8ac7-ed18ae34101b','1611411247163012'), -- Tesfaye Yirku
    ('6a9867a2-b162-489e-8f5a-d0497a19bd1f','1611411247164015'); -- Yanet Tesfaye

  IF (SELECT count(*) FROM _zemen) <> 22
     OR (SELECT count(DISTINCT staff_id) FROM _zemen) <> 22
     OR (SELECT count(DISTINCT acct) FROM _zemen) <> 22 THEN
    RAISE EXCEPTION 'The Zemen list is not 22 distinct people with 22 distinct accounts — aborting';
  END IF;
  IF (SELECT count(*) FROM _zemen z JOIN staff s ON s.id = z.staff_id) <> 22 THEN
    RAISE EXCEPTION 'A staff id in the Zemen list does not exist — aborting';
  END IF;

  -- Preserve what is being displaced, before displacing it.
  UPDATE staff s
     SET bank_account_note =
           'Previously recorded: ' || s.bank_account
           || COALESCE(' at ' || (SELECT a.account_name FROM accounts a WHERE a.id = s.bank_id), '')
           || '. Replaced by the Zemen workshop salary account (Sep 2026).'
    FROM _zemen z
   WHERE s.id = z.staff_id
     AND s.bank_account IS NOT NULL
     AND s.bank_account IS DISTINCT FROM z.acct;

  UPDATE staff s
     SET bank_id = v_zemen, bank_account = z.acct
    FROM _zemen z
   WHERE s.id = z.staff_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> 22 THEN
    RAISE EXCEPTION 'Expected to move 22 staff to Zemen, moved % — aborting', v_n;
  END IF;
END $$;
