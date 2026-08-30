-- 265 — Batch drafts BEFORE finance approval, and allow un-approving
--
-- Two related gaps in the labor payment flow.
--
-- 1. Batching required prior approval.
--    create_batch_payment refused anything not already 'approved_to_pay',
--    so a week of labor drafts had to be approved one by one and only then
--    grouped. That is backwards for the actual review: finance wants to
--    assemble the week's payment first, look at it as one total, and
--    approve that. Now a batch can be built from still-pending drafts and
--    approved as a unit via approve_batch_payment().
--
-- 2. An approval could not be taken back.
--    enforce_expense_approval_transitions allows pending → finance_approved
--    and rejected → pending, but nothing out of finance_approved, so a
--    mis-click was permanent — the only escape was rejecting the expense
--    outright, which is a different (and visible) statement. Finance/admin
--    can now return an approved-but-unpaid expense to pending.

-- ── 1. Permit finance_approved → pending (un-approve)
-- Mirrors the existing rejected → pending path, including clearing the
-- approval trail so the row is genuinely back to un-reviewed rather than
-- carrying a stale approver. Still finance/admin only, and the payment-side
-- guards in unapprove_expense() below decide when it's actually safe.
CREATE OR REPLACE FUNCTION public.enforce_expense_approval_transitions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN

    -- The live gate: finance releases the expense to payment.
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can approve or reject an expense';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    -- Legacy path: drains rows stranded in manager_approved by the
    -- retired first rung. No new row can reach this state.
    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can approve or reject an expense';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      -- Resubmission after a rejection clears the prior approval trail.
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;

    ELSIF OLD.approval_status = 'finance_approved' AND NEW.approval_status = 'pending' THEN
      -- Un-approve: taking back an approval that hasn't been paid.
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can withdraw an approval';
      END IF;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;

    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. Un-approve one expense
CREATE OR REPLACE FUNCTION public.unapprove_expense(p_expense_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exp expenses%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can withdraw an approval';
  END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id;
  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_exp.approval_status <> 'finance_approved' THEN
    RAISE EXCEPTION 'Expense % is % — only a finance-approved expense can be un-approved',
      COALESCE(v_exp.expense_code, p_expense_id::text), v_exp.approval_status;
  END IF;

  -- Everything below is money that has already moved, or is committed to
  -- moving. Withdrawing the approval underneath it would leave the payment
  -- with no authority behind it.
  IF v_exp.payment_state <> 'approved_to_pay' THEN
    RAISE EXCEPTION 'Expense % is %, not merely approved — un-approve only applies before the payment is sent',
      COALESCE(v_exp.expense_code, p_expense_id::text), v_exp.payment_state;
  END IF;
  IF v_exp.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'Expense % is matched to a bank line', COALESCE(v_exp.expense_code, p_expense_id::text);
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'Expense % is in a batch payment — remove it from the batch first', COALESCE(v_exp.expense_code, p_expense_id::text);
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    RAISE EXCEPTION 'Expense % has already posted to the ledger', COALESCE(v_exp.expense_code, p_expense_id::text);
  END IF;

  UPDATE expenses
     SET approval_status = 'pending',
         payment_state = 'unpaid',
         payment_state_changed_at = NOW()
   WHERE id = p_expense_id;

  RETURN format('Approval withdrawn on %s (%s ETB) — back to pending review',
                COALESCE(v_exp.expense_code, p_expense_id::text), v_exp.amount_etb);
END;
$function$;

COMMENT ON FUNCTION public.unapprove_expense IS
  'Returns a finance-approved but unpaid expense to pending review. Refuses anything sent/paid, bank-matched, batched, or ledger-posted. admin/finance only.';

-- ── 3. Batching before approval
-- Accepts expenses that are still pending review as well as already
-- approved ones. Behaviour is unchanged for a fully-approved selection —
-- it still dispatches straight to 'sent'. A selection containing anything
-- unpaid instead parks the batch: the expenses keep their state and the
-- batch waits for approve_batch_payment().
CREATE OR REPLACE FUNCTION public.create_batch_payment(
  p_expense_ids uuid[], p_assignee_id uuid, p_account_id uuid DEFAULT NULL::uuid,
  p_payment_method text DEFAULT 'batch_wire'::text, p_payment_code text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch_id  UUID;
  v_bad_count INT;
  v_pending   INT;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can create a batch payment';
  END IF;

  IF p_expense_ids IS NULL OR array_length(p_expense_ids, 1) IS NULL OR array_length(p_expense_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one expense must be selected';
  END IF;

  -- Anything already sent/paid/advance/void can't be batched at all.
  SELECT count(*) INTO v_bad_count
  FROM expenses WHERE id = ANY(p_expense_ids) AND payment_state NOT IN ('unpaid', 'approved_to_pay');
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'Every selected expense must be awaiting approval or approved to pay';
  END IF;

  SELECT count(*) INTO v_pending
  FROM expenses WHERE id = ANY(p_expense_ids) AND payment_state = 'unpaid';

  -- Funding account is only needed at the point money actually moves. A
  -- pre-approval batch defers that to approve_batch_payment().
  IF v_pending = 0 AND p_account_id IS NULL AND p_payment_method <> 'cash' THEN
    RAISE EXCEPTION 'An account must be selected to fund a % batch payment', p_payment_method;
  END IF;

  INSERT INTO batch_payments (payment_code, assignee_id, notes)
  VALUES (p_payment_code, p_assignee_id, p_notes)
  RETURNING id INTO v_batch_id;

  INSERT INTO batch_payment_expenses (batch_payment_id, expense_id)
  SELECT v_batch_id, unnest(p_expense_ids);

  IF v_pending = 0 THEN
    UPDATE expenses
       SET payment_state = 'sent',
           disbursed_by = p_assignee_id,
           payment_method = p_payment_method,
           account_id = p_account_id
     WHERE id = ANY(p_expense_ids);
  END IF;

  RETURN v_batch_id;
END;
$function$;

COMMENT ON FUNCTION public.create_batch_payment IS
  'Groups expenses into one batch payment. A fully approved_to_pay selection dispatches immediately to sent (original behaviour); a selection still awaiting finance approval parks the batch for approve_batch_payment().';

-- ── 4. Approve a whole batch, then dispatch it
CREATE OR REPLACE FUNCTION public.approve_batch_payment(
  p_batch_payment_id uuid, p_assignee_id uuid, p_account_id uuid DEFAULT NULL::uuid,
  p_payment_method text DEFAULT 'batch_wire'::text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids       uuid[];
  v_approved  INT := 0;
  v_total     numeric;
  v_blocked   INT;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can approve a batch payment';
  END IF;

  SELECT array_agg(expense_id) INTO v_ids
  FROM batch_payment_expenses WHERE batch_payment_id = p_batch_payment_id;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Batch payment % has no expenses', p_batch_payment_id;
  END IF;

  SELECT count(*) INTO v_blocked
  FROM expenses WHERE id = ANY(v_ids) AND payment_state NOT IN ('unpaid', 'approved_to_pay');
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'This batch has already been dispatched';
  END IF;

  IF p_account_id IS NULL AND p_payment_method <> 'cash' THEN
    RAISE EXCEPTION 'An account must be selected to fund a % batch payment', p_payment_method;
  END IF;

  -- Approve everything still pending. The approval trigger stamps
  -- finance_approved_by/at, and its sibling moves payment_state to
  -- approved_to_pay.
  UPDATE expenses SET approval_status = 'finance_approved'
   WHERE id = ANY(v_ids) AND approval_status = 'pending';
  GET DIAGNOSTICS v_approved = ROW_COUNT;

  -- Then dispatch, exactly as an already-approved batch would have been.
  -- The payment lifecycle trigger enforces separation of duties here: the
  -- approver and the payer cannot be the same person.
  UPDATE expenses
     SET payment_state = 'sent',
         disbursed_by = p_assignee_id,
         payment_method = p_payment_method,
         account_id = p_account_id
   WHERE id = ANY(v_ids) AND payment_state = 'approved_to_pay';

  UPDATE batch_payments SET assignee_id = p_assignee_id, updated_at = NOW()
   WHERE id = p_batch_payment_id;

  SELECT COALESCE(SUM(amount_etb), 0) INTO v_total FROM expenses WHERE id = ANY(v_ids);

  RETURN format('Batch approved and sent: %s expense(s), %s newly approved, %s ETB total',
                array_length(v_ids, 1), v_approved, v_total);
END;
$function$;

COMMENT ON FUNCTION public.approve_batch_payment IS
  'Finance-approves every still-pending expense in a batch, then dispatches the whole batch to sent. The payment lifecycle trigger still enforces that the approver and the payer are different people. admin/finance only.';
