-- 302 — an expense is paid to a vendor or to a person, not both
--
-- expenses.paid_to_staff_id has existed since the labor rollup was built, but
-- rollup_labor_timesheets_to_expense was the only thing in the database that
-- wrote it and no screen offered the field. So every other expense that
-- carries a payee — 19 of them, the hand-entered labor payments among them —
-- got it by someone writing to the table directly.
--
-- The form now has the field (this migration's companion change). That makes
-- it worth stating the rule the rest of the system already assumes: the
-- Payment Request document resolves its payee as
--
--     vendor_name ?? vendors_name ?? paidToStaffName
--
-- so an expense carrying both would print the vendor and silently ignore the
-- staff member. Not an error anywhere — just the wrong name and the wrong
-- account number on the instruction handed to the bank.
--
-- A CHECK is the right home for it rather than the form handler alone,
-- precisely because direct writes are how this column has mostly been set.
-- The constraint holds whichever way the row arrives.
--
-- The rollup cannot violate it: its two payee expressions are branches of the
-- same payment_model, gang_leader filling vendor_id and individual filling
-- paid_to_staff_id, so at most one is ever non-null.
--
-- Verified against live data before adding: 0 of the current expenses set
-- both, so nothing has to be cleaned up first and the constraint validates
-- against the existing table as-is.

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_one_payee_ck;
ALTER TABLE expenses ADD CONSTRAINT expenses_one_payee_ck
  CHECK (vendor_id IS NULL OR paid_to_staff_id IS NULL);

COMMENT ON COLUMN expenses.paid_to_staff_id IS
  'The person this expense pays, when the money goes to someone on staff rather than a vendor — a casual worker''s day, a one-off site payment. Mutually exclusive with vendor_id (expenses_one_payee_ck). Set by the labor rollup for a single-worker individual requisition, or on the expense form.';

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM expenses
   WHERE vendor_id IS NOT NULL AND paid_to_staff_id IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% expense(s) name both a vendor and a staff payee', v_bad;
  END IF;
END $$;
