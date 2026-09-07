-- 291 — Aragaw Welde is paid to Mesfin Bekele's CBE account
--
-- 288 split staff.bank_account into a bank and a number, but left three rows
-- for a person to settle rather than guessing. This settles one of them.
--
-- His record read "1000070442648 Mesfin Bekele/ 155083603-BOA" — two accounts
-- at two banks in one field, with no way to tell from the data which one the
-- money actually goes through. 288 took the CBE number because it led the
-- string, and kept the whole original in bank_account_note so nothing was
-- lost and nothing was asserted.
--
-- Confirmed: he is paid to Mesfin Bekele's CBE account, 1000070442648. The
-- account and bank 288 chose were right, so neither changes here. What
-- changes is the note, which until now repeated the raw original and so still
-- showed the BOA account as though it were live. It now says what the row
-- means: whose account this is, and that the BOA one is not used.
--
-- Kedir's row has the same shape ("1000671632738 asenaku besher") and is
-- deliberately left as it stands — nobody has confirmed it, and a note that
-- reads as confirmed when it isn't is worse than a raw one.

UPDATE staff
   SET bank_account_note =
       'Paid via Mesfin Bekele''s CBE account (confirmed). The original record also listed 155083603 at BOA; that account is not used.'
 WHERE id = 'e4ebb9a7-02b1-4fdf-9b3c-50c5e0c7a464'
   AND bank_account = '1000070442648';

-- The four "<number> - BOA" rows are a different case: everything their old
-- text carried is now in bank_account and bank_id, so the preserved original
-- is pure duplication. Left in place it reads as an unresolved annotation —
-- the payroll page prints the note in amber precisely because a note usually
-- means something is unsettled — against records that are in fact complete.
-- Cleared where the note is exactly "<the number> - BOA" and the row already
-- resolves to BOA, so only the redundant ones go.
UPDATE staff s
   SET bank_account_note = NULL
  FROM accounts a
 WHERE a.id = s.bank_id
   AND a.account_name = 'BOA'
   AND s.bank_account_note = s.bank_account || ' - BOA';
