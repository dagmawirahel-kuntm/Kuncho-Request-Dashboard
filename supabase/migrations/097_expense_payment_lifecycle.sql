-- ============================================================
-- Expense payment lifecycle: replaces the single payment_status
-- boolean with a real state machine, because a boolean cannot
-- represent the three states finance actually lives in (approved &
-- awaiting payment, sent to bank, confirmed) — the to-pay queue had
-- nowhere to exist. payment_status stays as a column (migration 098
-- keeps it in sync via trigger, one-directional from payment_state,
-- for anything still reading it) but payment_state becomes the
-- source of truth from here on.
--
-- This migration ONLY adds columns and backfills them — no
-- enforcement trigger yet. That's deliberate sequencing, not an
-- oversight: migration 098 adds a trigger that blocks a current-FY
-- row from reaching approved_to_pay/sent/paid without real
-- finance_approved_by/disbursed_by identities. If that trigger
-- existed during THIS migration's backfill, it would block the
-- backfill from setting the very state it's trying to establish.
-- Running the backfill first, trigger-free, then adding enforcement
-- in 098 for everything going forward, sidesteps that entirely.
--
-- payment_state_changed_at is separate from expenses.updated_at
-- (which changes on ANY edit) — it's stamped only when payment_state
-- itself changes, so "this week's payments made" (finance dashboard,
-- migration 100) can filter on a meaningful timestamp.
-- ============================================================

SET search_path TO public;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_state TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_state IN ('unpaid', 'approved_to_pay', 'sent', 'paid', 'void'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS disbursed_by UUID REFERENCES user_profiles(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method TEXT
  CHECK (payment_method IS NULL OR payment_method IN ('transfer', 'batch_wire', 'cpo', 'cheque', 'other'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_state_changed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_expenses_payment_state ON expenses(payment_state);

-- ── Backfill from existing payment_status / approval_status ──────
-- Real data going in: 2,316 expenses, 1,739 paid, 408 labeled
-- approval_status='finance_approved' with ZERO having a real
-- finance_approved_by (that label was set by direct INSERT during an
-- earlier data import, which never ran through the UPDATE-transition
-- trigger in migration 006 that actually stamps the approver — the
-- stamping trigger only fires on a genuine manager_approved ->
-- finance_approved UPDATE, never on INSERT).
--
-- Per explicit decision: a current-FY row (dated on/after whatever
-- fiscal_periods row is_current) carrying that label but NO real
-- finance_approved_by is capped at 'unpaid', not trusted into
-- 'approved_to_pay' — it goes back through the queue for a real
-- re-approval with a real identity, since enforcement begins in
-- current FY per this batch's own rule. A historical (pre-current-FY)
-- row with the same label is grandfathered into 'approved_to_pay' as
-- entered — its nulls are expected and permitted, not touched again
-- unless someone edits it, at which point 098's trigger evaluates it
-- as historical and lets the edit through unchanged.
UPDATE expenses e
SET payment_state = CASE
  WHEN e.payment_status THEN 'paid'
  WHEN e.approval_status = 'finance_approved' THEN
    CASE
      WHEN e.finance_approved_by IS NOT NULL THEN 'approved_to_pay'
      WHEN fiscal_period_for_date(e.date) = (SELECT id FROM fiscal_periods WHERE is_current) THEN 'unpaid'
      ELSE 'approved_to_pay'
    END
  ELSE 'unpaid'
END,
payment_state_changed_at = COALESCE(e.paid_date, e.finance_approved_at, e.updated_at);

-- Verify: distribution should show ~1,739 paid, the 408 finance_approved
-- rows split between approved_to_pay (historical, grandfathered) and
-- unpaid (current-FY, capped pending re-approval), rest unpaid.
SELECT payment_state, count(*) FROM expenses GROUP BY payment_state ORDER BY payment_state;

-- Verify: how many of the "capped" rows are there, for a sanity check
-- against the expected small number (this fiscal year is 9 days old
-- as of this migration).
SELECT count(*) AS capped_pending_reapproval
FROM expenses
WHERE payment_state = 'unpaid'
  AND approval_status = 'finance_approved'
  AND finance_approved_by IS NULL
  AND fiscal_period_for_date(date) = (SELECT id FROM fiscal_periods WHERE is_current);
