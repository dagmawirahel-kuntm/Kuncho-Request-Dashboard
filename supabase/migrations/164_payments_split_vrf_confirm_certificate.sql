-- ============================================================
-- Payments cluster: partial-payment split (#5), VRF-manager
-- confirmation (#7), and payment-verification certificates (#6).
--
-- payment_state runs unpaid -> approved_to_pay -> sent -> paid (text,
-- not an enum). There is no notifications table — the bell is
-- query-driven counts — so "notify the VRF manager" is a queue the
-- badge holder sees, not a pushed row.
-- ============================================================

SET search_path TO public;

-- ── New columns ─────────────────────────────────────────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_parent_id          UUID REFERENCES expenses(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_confirmed_by     UUID REFERENCES user_profiles(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_confirmed_at     TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_certificate_url  TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_certificate_name TEXT;
ALTER TABLE vendors  ADD COLUMN IF NOT EXISTS requires_payment_confirmation BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_expenses_split_parent ON expenses(split_parent_id) WHERE split_parent_id IS NOT NULL;

COMMENT ON COLUMN vendors.requires_payment_confirmation IS
  'This vendor releases goods only against proof of payment. A bank payment to them should carry a payment_certificate before the goods are collected (GRN).';
COMMENT ON COLUMN expenses.split_parent_id IS
  'Set on the remainder expense created when a parent was paid only in part (split_expense_partial_payment). Points at the now-paid original.';

-- ── #5 Partial-payment split ────────────────────────────────────────
-- The paid portion is retired (the original is reduced to what was paid
-- and marked paid) and the unpaid remainder becomes a NEW expense that
-- re-enters the queue. The two rows sum to the original total, so the
-- ledger is unchanged in aggregate — this splits one obligation into a
-- settled part and an outstanding part, it does not create money.
--
-- The remainder's expense_code is left to the existing generator
-- (generate_expense_code fires BEFORE INSERT); lineage is carried by
-- split_parent_id and a note rather than by fighting that trigger for a
-- "-R1" suffix. Batch-payment and already-split guards refuse the cases
-- where a clean split isn't well-defined.
CREATE OR REPLACE FUNCTION split_expense_partial_payment(p_expense_id UUID, p_paid_amount NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orig     expenses%ROWTYPE;
  v_remainder NUMERIC;
  v_new_id   UUID;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can split a partial payment';
  END IF;

  SELECT * INTO v_orig FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;

  IF v_orig.amount_etb IS NULL THEN
    RAISE EXCEPTION 'Expense has no amount to split';
  END IF;
  IF p_paid_amount <= 0 OR p_paid_amount >= v_orig.amount_etb THEN
    RAISE EXCEPTION 'Paid amount (%) must be greater than 0 and less than the full amount (%)', p_paid_amount, v_orig.amount_etb;
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense is in a batch payment — split it out of the batch first';
  END IF;
  IF v_orig.payment_state = 'paid' THEN
    RAISE EXCEPTION 'This expense is already fully paid';
  END IF;

  v_remainder := v_orig.amount_etb - p_paid_amount;

  -- The remainder: a clone carrying the same attribution, unpaid, linked
  -- back to the original. Payment/reconciliation fields are deliberately
  -- reset so it starts clean in the queue.
  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, purchase_type, quantity, uom,
    category_id, sub_category_id, vendor_id, project_id, staff_id, purchaser_user_id,
    account_id, location_id, vehicle_id, property_id,
    requested, payment_status, partially_paid, payment_state,
    approval_status, requires_finance_approval, split_parent_id, notes
  )
  SELECT
    v_orig.item_service_description, v_remainder, v_orig.expense_type, v_orig.purchase_type, v_orig.quantity, v_orig.uom,
    v_orig.category_id, v_orig.sub_category_id, v_orig.vendor_id, v_orig.project_id, v_orig.staff_id, v_orig.purchaser_user_id,
    v_orig.account_id, v_orig.location_id, v_orig.vehicle_id, v_orig.property_id,
    true, false, false, 'unpaid',
    v_orig.approval_status, v_orig.requires_finance_approval, v_orig.id,
    COALESCE(v_orig.notes || ' | ', '') || 'Remainder of ' || COALESCE(v_orig.expense_code, v_orig.id::text) || ' after partial payment'
  RETURNING id INTO v_new_id;

  -- The original: reduced to what was actually paid, and marked paid.
  UPDATE expenses SET
    amount_etb          = p_paid_amount,
    payment_status      = true,
    partially_paid      = false,
    payment_state       = 'paid',
    paid_date           = COALESCE(paid_date, CURRENT_DATE),
    notes               = COALESCE(notes || ' | ', '') || 'Partially paid; remainder moved to a new expense'
  WHERE id = p_expense_id;

  RETURN v_new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION split_expense_partial_payment(UUID, NUMERIC) TO authenticated;

-- ── #7 VRF-manager confirmation ─────────────────────────────────────
-- A payment sent via VRF is not paid until the VRF-manager badge holder
-- confirms the facilitator actually processed it. Gated to the badge
-- (or admin); refuses anything not a VRF payment sitting at 'sent'.
CREATE OR REPLACE FUNCTION confirm_vrf_payment(p_expense_id UUID, p_vrf_id UUID DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_vrf_mgr BOOLEAN;
  v_state      TEXT;
  v_method     TEXT;
BEGIN
  SELECT is_vrf_manager INTO v_is_vrf_mgr FROM user_profiles WHERE id = auth.uid();
  IF NOT (COALESCE(v_is_vrf_mgr, false) OR get_user_role() = 'admin') THEN
    RAISE EXCEPTION 'Only the VRF Manager (or an admin) can confirm a VRF payment';
  END IF;

  SELECT payment_state, payment_method INTO v_state, v_method FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_method IS DISTINCT FROM 'vrf' THEN
    RAISE EXCEPTION 'This is not a VRF payment';
  END IF;
  IF v_state <> 'sent' THEN
    RAISE EXCEPTION 'Only a sent VRF payment can be confirmed (current: %)', v_state;
  END IF;

  UPDATE expenses SET
    payment_state        = 'paid',
    payment_status       = true,
    vrf_id               = COALESCE(p_vrf_id, vrf_id),
    payment_confirmed_by = auth.uid(),
    payment_confirmed_at = NOW()
  WHERE id = p_expense_id;
END;
$$;
GRANT EXECUTE ON FUNCTION confirm_vrf_payment(UUID, UUID) TO authenticated;

-- ── #6 Certificate visibility for goods release ─────────────────────
-- A view the sourcing / GRN side reads: for each sourcing bundle whose
-- vendor requires payment confirmation, whether the linked expense yet
-- carries a payment certificate. Surfaced (not hard-blocked) so the
-- person receiving goods sees "vendor needs proof of payment first"
-- rather than being silently stopped by a trigger on a flow with
-- several entry points.
CREATE OR REPLACE VIEW v_bundle_payment_release_status
WITH (security_invoker = true) AS
SELECT
  sb.id AS sourcing_bundle_id,
  sb.bundle_code,
  v.id AS vendor_id, v.vendor_name, v.requires_payment_confirmation,
  e.id AS expense_id, e.expense_code, e.payment_state,
  e.payment_certificate_url,
  CASE
    WHEN NOT COALESCE(v.requires_payment_confirmation, false) THEN 'not_required'
    WHEN e.payment_certificate_url IS NOT NULL THEN 'certified'
    WHEN e.payment_state = 'paid' THEN 'paid_no_certificate'
    ELSE 'awaiting_payment'
  END AS release_status
FROM sourcing_bundles sb
LEFT JOIN vendors v ON v.id = sb.vendor_id
LEFT JOIN expenses e ON e.sourcing_bundle_id = sb.id;

GRANT SELECT ON v_bundle_payment_release_status TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT proname FROM pg_proc WHERE proname IN ('split_expense_partial_payment','confirm_vrf_payment') ORDER BY proname;
SELECT count(*) AS new_expense_cols FROM information_schema.columns WHERE table_name='expenses'
  AND column_name IN ('split_parent_id','payment_confirmed_by','payment_confirmed_at','payment_certificate_url','payment_certificate_name');
SELECT count(*) AS vendor_flag FROM information_schema.columns WHERE table_name='vendors' AND column_name='requires_payment_confirmation';
