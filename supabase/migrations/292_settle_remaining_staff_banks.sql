-- 292 — the last three staff bank rows, settled
--
-- 288 split staff.bank_account into a bank and a number and deliberately left
-- three rows for someone who knew rather than guessing. 291 settled Aragaw
-- Welde; these are the other two, plus Kedir's payee.
--
--   Kedir   1000671632738, CBE — confirmed paid via asenaku besher. The bank
--           and number were already right; only the note changes, from the
--           raw original to what the row actually means.
--   Girma   01320652937800 — confirmed Awash. 288 saw a 013 prefix matching
--           the pattern of the company's own Awash account and refused to
--           treat that as evidence; now it is confirmed, the bank is set.
--   Mahlet  0071454911001 — confirmed Ahadu Bank. Nothing in the row had ever
--           named a bank.
--
-- Girma's note is deliberately left as it stands. What was confirmed is the
-- bank, not whether the account is his or Adunga's, and the note is the only
-- place that question is visible. Ahadu Bank's own row in `accounts` carries
-- status 'inactive' — that describes the company's account there, not the
-- bank, and the account lookup does not filter on it, so it is left alone.
--
-- After this every staff bank_account resolves to a bank except none, and the
-- two notes that remain both describe whose account is used rather than
-- anything unresolved about the bank.

UPDATE staff
   SET bank_account_note = 'Paid via asenaku besher''s CBE account (confirmed).'
 WHERE id = '076d926c-947f-4a57-999c-00f8deea8816'
   AND bank_account = '1000671632738';

UPDATE staff
   SET bank_id = '9e90c20f-882d-4a80-b605-ef46c2266838'  -- AWBNK (Awash)
 WHERE id = 'e89a372b-8a35-4f17-b07d-9e0607bd892c'
   AND bank_account = '01320652937800';

UPDATE staff
   SET bank_id = '09266b53-a4cf-4600-8992-f31c1a891c2c'  -- Ahadu Bank
 WHERE id = '8600b212-658d-4fd1-8ce8-f367d783ec16'
   AND bank_account = '0071454911001';
