-- ============================================================
-- Fix: finance-approving an expense never actually moved it into the
-- to-pay queue.
--
-- Both approval call sites in the app (PaymentsDashboardPage's
-- "Approve" button, ExpenseFormPage's "Give Final Approval" button)
-- only ever UPDATE approval_status. Nothing bridges approval_status
-- -> payment_state going forward — migration 097's backfill of
-- payment_state was a ONE-TIME fix for rows that existed at the time
-- it ran, not an ongoing sync. So every expense finance-approved
-- since then has been stuck at payment_state = 'unpaid' forever,
-- despite approval_status = 'finance_approved' — invisible to BOTH
-- v_finance_pending_approval (which excludes approval_status =
-- 'finance_approved' from its WHERE clause, since that view is
-- "awaiting a decision") AND v_to_pay_queue (which requires
-- payment_state = 'approved_to_pay'). The expense effectively vanishes
-- the moment it's approved. This is the real cause behind newly
-- approved expenses (e.g. Total Energies) not showing anywhere.
--
-- Fix: a trigger that auto-transitions payment_state the moment
-- approval_status reaches 'finance_approved', so this can't be missed
-- again regardless of which UI path performs the approval. Registered
-- on UPDATE OF approval_status specifically, which runs alongside (and
-- after, by trigger-name alphabetical order) 006's
-- trg_enforce_expense_approval_transitions, so NEW.finance_approved_by
-- is already stamped by the time this fires — 006's trigger is the
-- ONLY path that sets approval_status to 'finance_approved' (it
-- RAISE EXCEPTIONs on any other transition), and always stamps
-- finance_approved_by := auth.uid() in the same statement, so the
-- 098 "current-FY row needs a real finance_approved_by" invariant is
-- already satisfied before this trigger ever runs.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION sync_expense_payment_state_on_finance_approval()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approval_status = 'finance_approved'
     AND OLD.approval_status IS DISTINCT FROM 'finance_approved'
     AND NEW.payment_state = 'unpaid' THEN
    NEW.payment_state := 'approved_to_pay';
    NEW.payment_state_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_expense_payment_state_on_finance_approval ON expenses;
CREATE TRIGGER trg_sync_expense_payment_state_on_finance_approval
  BEFORE UPDATE OF approval_status ON expenses
  FOR EACH ROW EXECUTE FUNCTION sync_expense_payment_state_on_finance_approval();

-- One-time backfill: un-stick every expense that's been silently
-- stranded by this gap since migration 097 ran. Only touches rows with
-- a real finance_approved_by (i.e. genuinely finance-approved through
-- the app, not a stale/imported label) — the same guard 097 itself
-- used, and what 098's enforcement trigger would require for a
-- current-FY row anyway.
UPDATE expenses
SET payment_state = 'approved_to_pay',
    payment_state_changed_at = COALESCE(payment_state_changed_at, finance_approved_at, NOW())
WHERE approval_status = 'finance_approved'
  AND payment_state = 'unpaid'
  AND finance_approved_by IS NOT NULL;

-- Verify: how many rows this un-stuck, and confirm none remain stranded
SELECT count(*) AS newly_moved_to_to_pay_queue FROM expenses
WHERE approval_status = 'finance_approved' AND payment_state = 'approved_to_pay';

SELECT count(*) AS still_stuck_unpaid_but_finance_approved FROM expenses
WHERE approval_status = 'finance_approved' AND payment_state = 'unpaid';
