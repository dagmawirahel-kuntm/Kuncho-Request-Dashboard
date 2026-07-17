-- ============================================================
-- Wires the two links that already existed but were unused:
-- expenses.transfer_id (bank reconciliation) and batch_payments/
-- batch_payment_expenses (the real BATCHPAYMENT wire pattern already
-- visible in the imported CBE statement — one wire, many vendors).
--
-- Three SECURITY DEFINER functions, matching the established pattern
-- for "a specific controlled event causes effect Y" — the caller
-- (finance) doesn't need direct multi-table write access; the
-- function does the atomic multi-row work and self-checks role.
-- All three still go through the same UPDATE path on `expenses` as a
-- plain client call would, so migration 098's segregation-of-duties
-- trigger fires exactly the same way regardless of which path was
-- used to get there — no separate enforcement needed here, it's
-- inherited automatically.
-- ============================================================

SET search_path TO public;

ALTER TABLE batch_payments ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES transfers(id);

-- ── Create a batch payment: one wire, many expenses ──────────────
-- Every selected expense must already be sitting in the to-pay queue
-- (approved_to_pay) — this is the queue-side action from the finance
-- dashboard's "To-pay queue" section. Moves every linked expense to
-- 'sent' with the same payer (assignee_id) and payment_method =
-- 'batch_wire'; migration 098's trigger validates that payer against
-- each expense's own finance_approved_by as it fires.
CREATE OR REPLACE FUNCTION create_batch_payment(
  p_expense_ids UUID[],
  p_assignee_id UUID,
  p_payment_code TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch_id UUID;
  v_bad_count INT;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can create a batch payment';
  END IF;

  IF p_expense_ids IS NULL OR array_length(p_expense_ids, 1) IS NULL OR array_length(p_expense_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one expense must be selected';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM expenses WHERE id = ANY(p_expense_ids) AND payment_state <> 'approved_to_pay';
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'All selected expenses must be in approved_to_pay state';
  END IF;

  INSERT INTO batch_payments (payment_code, assignee_id, notes)
  VALUES (p_payment_code, p_assignee_id, p_notes)
  RETURNING id INTO v_batch_id;

  INSERT INTO batch_payment_expenses (batch_payment_id, expense_id)
  SELECT v_batch_id, unnest(p_expense_ids);

  UPDATE expenses
  SET payment_state = 'sent',
      disbursed_by = p_assignee_id,
      payment_method = 'batch_wire'
  WHERE id = ANY(p_expense_ids);

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_batch_payment(UUID[], UUID, TEXT, TEXT) TO authenticated;

-- ── Match a whole batch to its single bank debit line ─────────────
-- The reconciliation-side action (finance dashboard's "This week's
-- payments made" section): moves every expense in the batch to
-- 'paid' and links each one to the same transfers row as the batch
-- itself, so the bank line and every expense it settled are
-- traversable in both directions.
CREATE OR REPLACE FUNCTION match_batch_to_transfer(p_batch_payment_id UUID, p_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a batch payment to a bank line';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM batch_payments WHERE id = p_batch_payment_id) THEN
    RAISE EXCEPTION 'Batch payment not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM transfers WHERE id = p_transfer_id) THEN
    RAISE EXCEPTION 'Transfer (bank line) not found';
  END IF;

  UPDATE batch_payments SET transfer_id = p_transfer_id WHERE id = p_batch_payment_id;

  UPDATE expenses e
  SET payment_state = 'paid', transfer_id = p_transfer_id
  FROM batch_payment_expenses bpe
  WHERE bpe.batch_payment_id = p_batch_payment_id AND e.id = bpe.expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION match_batch_to_transfer(UUID, UUID) TO authenticated;

-- ── Match a single (non-batch) expense to its bank line ────────────
-- The one-by-one-transfer payment method's reconciliation path.
-- Refuses an expense that belongs to a batch — that one settles
-- through match_batch_to_transfer instead, so a bank line is never
-- claimed by two different reconciliation paths for the same money.
CREATE OR REPLACE FUNCTION match_expense_to_transfer(p_expense_id UUID, p_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match an expense to a bank line';
  END IF;

  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense belongs to a batch payment — match the batch to a bank line instead';
  END IF;

  UPDATE expenses SET payment_state = 'paid', transfer_id = p_transfer_id WHERE id = p_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION match_expense_to_transfer(UUID, UUID) TO authenticated;

-- Verify
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN ('create_batch_payment', 'match_batch_to_transfer', 'match_expense_to_transfer')
ORDER BY proname;
