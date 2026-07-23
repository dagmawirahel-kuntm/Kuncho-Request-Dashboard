-- ============================================================
-- Payment reconciliation links: exact bank-reference matching (not
-- fuzzy amount/date), VRF as a real linked payment mode, and cash/VRF
-- receipt-photo evidence — for both expenses and payroll.
--
-- Confirmed real state before this migration:
--   - expenses.transfer_id has existed since migration 004 but is
--     rarely populated; migration 099 already built the matching RPCs
--     (match_expense_to_transfer / match_batch_to_transfer) — this
--     migration doesn't touch those, it adds the missing piece: an
--     EXACT reference-code lookup instead of manually browsing every
--     transfer in a picker.
--   - payroll has no transfer_id, no vrf_id, and no equivalent
--     reconciliation path at all — "paid by bank transfer" today is
--     just a free-text payment_method label with zero linkage to the
--     transfers table.
--   - vendor_receipt_facilitation exists (migration 001/025) but
--     nothing links back to it from either expenses or payroll — it
--     has no answer today for "what did this actually fund".
--
-- Per user decision: Cash and VRF are DISTINCT payment methods (Petty
-- Cash already covers small day-to-day cash spend separately; VRF is
-- for larger vendor-facilitated cash payments) — 'cash' and 'vrf' are
-- added as two separate real values, not combined into one.
--
-- Bridge rule (same as every other one this project has made): current
-- FY forward only. No historical expenses/payroll row is touched —
-- 2,317 existing null payment_method rows on expenses stay null.
-- ============================================================

SET search_path TO public;

-- ── 1. Linking columns — mirror expenses onto payroll ───────────────
ALTER TABLE payroll  ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES transfers(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vrf_id      UUID REFERENCES vendor_receipt_facilitation(id) ON DELETE SET NULL;
ALTER TABLE payroll  ADD COLUMN IF NOT EXISTS vrf_id      UUID REFERENCES vendor_receipt_facilitation(id) ON DELETE SET NULL;

-- ── 2. expenses.payment_method: add 'cash' and 'vrf' as real values ─
-- Named constraint confirmed via local replay (Postgres's default name
-- for the unnamed CHECK migration 097 added inline).
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_payment_method_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('transfer', 'batch_wire', 'cpo', 'cheque', 'cash', 'vrf', 'other'));

-- ── 3. Extend the existing finance-only field lock (098) to cover the
-- new vrf_id column, same as transfer_id already is. ─────────────────
CREATE OR REPLACE FUNCTION enforce_expense_finance_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    IF NEW.payment_status        IS DISTINCT FROM OLD.payment_status
    OR NEW.paid_date             IS DISTINCT FROM OLD.paid_date
    OR NEW.bank_ref               IS DISTINCT FROM OLD.bank_ref
    OR NEW.partially_paid        IS DISTINCT FROM OLD.partially_paid
    OR NEW.partial_paid_amount   IS DISTINCT FROM OLD.partial_paid_amount
    OR NEW.partial_payment_date  IS DISTINCT FROM OLD.partial_payment_date
    OR NEW.partial_payment_notes IS DISTINCT FROM OLD.partial_payment_notes
    OR NEW.total_payment_date    IS DISTINCT FROM OLD.total_payment_date
    OR NEW.account_id            IS DISTINCT FROM OLD.account_id
    OR NEW.transfer_id           IS DISTINCT FROM OLD.transfer_id
    OR NEW.vrf_id                IS DISTINCT FROM OLD.vrf_id
    OR NEW.tax_summary_id        IS DISTINCT FROM OLD.tax_summary_id
    OR NEW.verify_wht            IS DISTINCT FROM OLD.verify_wht
    OR NEW.wht_handling_method   IS DISTINCT FROM OLD.wht_handling_method
    OR NEW.wht_fund              IS DISTINCT FROM OLD.wht_fund
    OR NEW.payment_state         IS DISTINCT FROM OLD.payment_state
    OR NEW.disbursed_by          IS DISTINCT FROM OLD.disbursed_by
    OR NEW.payment_method        IS DISTINCT FROM OLD.payment_method
    THEN
      RAISE EXCEPTION 'Only Finance or Admin can modify payment and finance-linked fields on an expense';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 4. Cash / VRF receipt photos — evidence that matches the payment
-- mode (a physical receipt, not a bank reference). One or more photos
-- per payment; exactly one parent (expense or payroll), never both,
-- never neither. ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_payment_receipts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID REFERENCES expenses(id) ON DELETE CASCADE,
  payroll_id   UUID REFERENCES payroll(id) ON DELETE CASCADE,
  photo_url    TEXT NOT NULL,
  uploaded_by  UUID REFERENCES user_profiles(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT,
  CHECK ((expense_id IS NOT NULL)::int + (payroll_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS idx_cash_payment_receipts_expense ON cash_payment_receipts(expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_payment_receipts_payroll ON cash_payment_receipts(payroll_id) WHERE payroll_id IS NOT NULL;

ALTER TABLE cash_payment_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_payment_receipts_all" ON cash_payment_receipts;
CREATE POLICY "cash_payment_receipts_all" ON cash_payment_receipts FOR ALL
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

GRANT SELECT, INSERT, UPDATE, DELETE ON cash_payment_receipts TO authenticated;

-- ── 5. Exact bank-reference lookup — the join key is the bank's own
-- reference (the FT-code), copied in by whoever processed the payment.
-- No fuzzy amount/date guessing: an exact match against
-- transfers.transfer_id_code, or against the reference embedded in
-- notes using the existing "(ref: FT...)" convention established by
-- the CBE backfill (migration 129). Plain (not SECURITY DEFINER) —
-- relies entirely on the caller's own RLS read access to transfers,
-- which finance/admin/manager already have.
--
-- strpos(), not LIKE: real FT-codes contain a literal backslash (e.g.
-- "FT25188XDGM2\MEX") — LIKE treats backslash as its escape character,
-- so a naive "LIKE '%(ref: '||p_reference||')%'" silently fails to
-- match any reference containing one. Confirmed by testing, not
-- assumed. strpos() is a plain substring search with no escape
-- semantics at all, so it can't have this class of bug.
CREATE OR REPLACE FUNCTION find_transfer_by_reference(p_reference TEXT)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM transfers
  WHERE transfer_id_code = p_reference
     OR strpos(notes, '(ref: ' || p_reference || ')') > 0
  ORDER BY date DESC NULLS LAST
  LIMIT 1;
$$;

-- ── 6. Link a sent expense to the VRF that actually funded it, mirror
-- of match_expense_to_transfer (099) but for the VRF payment mode
-- instead of a bank line. Same batch-payment guard for consistency,
-- even though batch payments are always payment_method='batch_wire'
-- in practice and would never reach here.
CREATE OR REPLACE FUNCTION link_expense_vrf(p_expense_id UUID, p_vrf_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can link an expense to a VRF settlement';
  END IF;

  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense belongs to a batch payment — match the batch to a bank line instead';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE id = p_vrf_id) THEN
    RAISE EXCEPTION 'VRF record not found';
  END IF;

  UPDATE expenses SET payment_state = 'paid', vrf_id = p_vrf_id WHERE id = p_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION link_expense_vrf(UUID, UUID) TO authenticated;

-- ── 7. Confirm a cash payment as settled — no bank line or VRF to
-- link, the receipt photo (cash_payment_receipts) is the evidence.
CREATE OR REPLACE FUNCTION confirm_expense_cash_payment(p_expense_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can confirm a cash payment';
  END IF;

  UPDATE expenses SET payment_state = 'paid' WHERE id = p_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_expense_cash_payment(UUID) TO authenticated;

-- ── 8. Same two reconciliation actions for payroll, which has no
-- 'sent' intermediate state — approval_status='finance_approved' is
-- the gate (enforced by 046's own trigger), payment_status='paid' is
-- the target either way.
CREATE OR REPLACE FUNCTION match_payroll_to_transfer(p_payroll_id UUID, p_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match payroll to a bank line';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_payroll_id AND approval_status = 'finance_approved') THEN
    RAISE EXCEPTION 'Payroll must be finance-approved before matching to a bank line';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM transfers WHERE id = p_transfer_id) THEN
    RAISE EXCEPTION 'Transfer (bank line) not found';
  END IF;

  UPDATE payroll SET transfer_id = p_transfer_id, payment_method = 'Bank Transfer', payment_status = 'paid' WHERE id = p_payroll_id;
END;
$$;

GRANT EXECUTE ON FUNCTION match_payroll_to_transfer(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION link_payroll_vrf(p_payroll_id UUID, p_vrf_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can link payroll to a VRF settlement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_payroll_id AND approval_status = 'finance_approved') THEN
    RAISE EXCEPTION 'Payroll must be finance-approved before linking a VRF settlement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE id = p_vrf_id) THEN
    RAISE EXCEPTION 'VRF record not found';
  END IF;

  UPDATE payroll SET vrf_id = p_vrf_id, payment_method = 'VRF', payment_status = 'paid' WHERE id = p_payroll_id;
END;
$$;

GRANT EXECUTE ON FUNCTION link_payroll_vrf(UUID, UUID) TO authenticated;

-- ── 9. Payment Hub visibility: v_recent_payments (100) needs vrf_id +
-- the VRF's own label so the Payment Hub can show/filter by payment
-- method with something meaningful for VRF-settled rows, the same way
-- it already does for transfer_id_code.
--
-- New columns appended AFTER batch_payment_id, not inserted before it:
-- CREATE OR REPLACE VIEW requires existing columns to keep their
-- ordinal position — inserting a column in the middle is read as
-- "rename the column already at that position" and fails. Confirmed
-- by testing (a full local replay), not assumed.
CREATE OR REPLACE VIEW v_recent_payments
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.payment_state,
  e.payment_method,
  e.disbursed_by,
  e.payment_state_changed_at,
  e.transfer_id,
  t.transfer_id_code,
  t.notes AS transfer_notes,
  bpe.batch_payment_id,
  e.vrf_id,
  vrf.record_name AS vrf_record_name
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN transfers t ON t.id = e.transfer_id
LEFT JOIN vendor_receipt_facilitation vrf ON vrf.id = e.vrf_id
LEFT JOIN batch_payment_expenses bpe ON bpe.expense_id = e.id
WHERE e.payment_state IN ('sent', 'paid')
  AND e.payment_state_changed_at >= NOW() - INTERVAL '7 days';

GRANT SELECT ON v_recent_payments TO authenticated;

-- Verify
SELECT column_name, table_name FROM information_schema.columns
WHERE (table_name = 'payroll' AND column_name IN ('transfer_id', 'vrf_id'))
   OR (table_name = 'expenses' AND column_name = 'vrf_id')
ORDER BY table_name, column_name;

SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'expenses'::regclass AND conname = 'expenses_payment_method_check';

SELECT tgname FROM pg_trigger WHERE tgrelid = 'cash_payment_receipts'::regclass AND NOT tgisinternal;

SELECT proname FROM pg_proc
WHERE proname IN ('find_transfer_by_reference', 'link_expense_vrf', 'confirm_expense_cash_payment', 'match_payroll_to_transfer', 'link_payroll_vrf')
ORDER BY proname;
