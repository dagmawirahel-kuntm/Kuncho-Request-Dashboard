-- 295 — each payroll line says which of the person's accounts it pays into
--
-- 294 let a staff member hold accounts at several banks. This is the half
-- that makes that useful: a payroll line records which one this run pays,
-- rather than every run silently taking whatever happens to be primary.
--
-- That matters because the primary moves. When the workshop salary went to
-- Zemen, 22 people's primary changed — and any payroll run already recorded
-- against their old CBE account would have started reporting a Zemen account
-- retroactively, including on a Payment Request already issued and handed to
-- the bank. Pinning the account on the line is what stops a historical
-- document rewriting itself.
--
-- Null means "whatever is primary", which is the right default for a run
-- being drafted and keeps every existing line valid without a backfill
-- inventing a choice nobody made.
--
-- Also clears Kedir's note. 294 moved "paid via asenaku besher" into the
-- account_holder column where the document can use it, so the note is now
-- the same fact in prose. Aragaw Welde's note stays: it additionally records
-- a BOA account that is deliberately not used, which no column captures.
-- Girma's stays: still unconfirmed.

ALTER TABLE payroll_staff
  ADD COLUMN IF NOT EXISTS staff_bank_account_id uuid REFERENCES staff_bank_accounts(id);

COMMENT ON COLUMN payroll_staff.staff_bank_account_id IS
  'Which of the employee''s accounts this run pays into. Null means their primary at the time of reading.';

CREATE INDEX IF NOT EXISTS payroll_staff_bank_account
  ON payroll_staff (staff_bank_account_id);

-- Resolves a payroll line to the account it actually pays, so the payroll
-- page, the Payment Request and any report all answer the question the same
-- way instead of each re-deriving the fallback.
CREATE OR REPLACE VIEW v_payroll_staff_accounts AS
SELECT ps.payroll_id,
       ps.staff_id,
       ps.gross_amount,
       ps.deductions,
       ps.net_amount,
       ps.staff_bank_account_id,
       COALESCE(chosen.id, prim.id)                         AS resolved_account_id,
       COALESCE(chosen.account_number, prim.account_number)  AS account_number,
       COALESCE(chosen.account_holder, prim.account_holder)  AS account_holder,
       COALESCE(chosen.bank_id, prim.bank_id)                AS bank_id,
       b.account_name                                        AS bank_name,
       (ps.staff_bank_account_id IS NOT NULL)                AS account_was_chosen
FROM payroll_staff ps
LEFT JOIN staff_bank_accounts chosen ON chosen.id = ps.staff_bank_account_id
LEFT JOIN staff_bank_accounts prim
       ON prim.staff_id = ps.staff_id AND prim.is_primary
LEFT JOIN accounts b ON b.id = COALESCE(chosen.bank_id, prim.bank_id);

UPDATE staff
   SET bank_account_note = NULL
 WHERE bank_account_note = 'Paid via asenaku besher''s CBE account (confirmed).';
