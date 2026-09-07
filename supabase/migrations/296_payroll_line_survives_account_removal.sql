-- 296 — removing a bank account must not be blocked by an old payroll line
--
-- 295 pointed payroll_staff.staff_bank_account_id at staff_bank_accounts with
-- no ON DELETE behaviour, which means NO ACTION: deleting an account a past
-- run happened to name fails with a foreign key violation. That is the wrong
-- answer for a mistyped account number — the correction is blocked by the
-- very history that recorded the mistake.
--
-- SET NULL is the right one, and it is already what the rest of the system
-- expects: null on a payroll line means "whatever is primary", and
-- v_payroll_staff_accounts resolves it that way. So a removed account leaves
-- its old lines falling back to the primary rather than dangling — which is
-- exactly what the Remove button on the staff page tells the user will happen.

ALTER TABLE payroll_staff
  DROP CONSTRAINT IF EXISTS payroll_staff_staff_bank_account_id_fkey;

ALTER TABLE payroll_staff
  ADD CONSTRAINT payroll_staff_staff_bank_account_id_fkey
  FOREIGN KEY (staff_bank_account_id) REFERENCES staff_bank_accounts(id)
  ON DELETE SET NULL;
