-- 200 — Post-commit bank statement rematch.
--
-- Bug: auto_match_statement_import() only ever runs once, right after the
-- CSV is parsed — before an expense with a matching bank_ref necessarily
-- exists yet. commit_statement_import() creates the real transfer rows and
-- calls match_expense_to_transfer() for whatever was matched AT THAT MOMENT,
-- then flips the import to 'committed'. If finance later backfills the
-- missing expense (sets its bank_ref to the same reference_code), nothing
-- ever revisits the now-committed statement lines — there is no code path
-- that both (a) re-checks unmatched committed lines against current
-- expenses and (b) actually calls match_expense_to_transfer to flip
-- payment_state. So the expense never surfaces as paid even though the
-- money is unambiguously sitting in a committed transfer already.
--
-- Two RPCs close that gap, both reusing the existing match_expense_to_transfer
-- (migration 138) so the same role checks, batch-payment guard, and
-- payment-lifecycle triggers apply as any other match:
--
-- 1. match_expense_to_statement_line(line_id, expense_id) — manual pairing
--    for a specific committed line + specific expense (mirrors the existing
--    match_line_to_payroll pattern for payroll's off-payments-page flow).
--
-- 2. rematch_committed_statement_lines(import_id DEFAULT NULL) — automatic
--    sweep: for every unmatched line on a committed import (or all
--    committed imports if import_id is omitted), look for an expense whose
--    bank_ref equals the line's reference_code and that isn't already
--    matched to a transfer, then match it. This is auto_match_statement_import's
--    matching rule, just re-runnable after commit and actually wired to
--    flip payment status.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.match_expense_to_statement_line(
  p_line_id uuid,
  p_expense_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_line   bank_statement_lines%ROWTYPE;
  v_amount numeric;
  v_line_amount numeric;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match an expense to a bank line';
  END IF;

  SELECT * INTO v_line FROM bank_statement_lines WHERE id = p_line_id;
  IF v_line.id IS NULL THEN
    RAISE EXCEPTION 'Statement line % not found', p_line_id;
  END IF;
  IF v_line.transfer_id IS NULL THEN
    RAISE EXCEPTION 'This line''s import has not been committed yet — commit it first, then match';
  END IF;
  IF v_line.match_status = 'duplicate' THEN
    RAISE EXCEPTION 'Cannot match a line already flagged as a duplicate';
  END IF;

  SELECT amount_etb INTO v_amount FROM expenses WHERE id = p_expense_id;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'Expense % not found', p_expense_id;
  END IF;

  -- Reuses the existing matcher: role check, batch-payment guard, and the
  -- payment_state='paid' flip (which cascades to payment_status via
  -- enforce_expense_payment_lifecycle) all happen inside this call.
  PERFORM match_expense_to_transfer(p_expense_id, v_line.transfer_id);

  v_line_amount := COALESCE(NULLIF(v_line.debit_amount, 0), v_line.credit_amount, 0);

  UPDATE bank_statement_lines
     SET matched_expense_id     = p_expense_id,
         matched_expense_amount = v_amount,
         match_status           = 'matched_expense',
         variance_amount        = v_line_amount - v_amount
   WHERE id = p_line_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.match_expense_to_statement_line(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rematch_committed_statement_lines(
  p_import_id uuid DEFAULT NULL
) RETURNS TABLE(matched_count integer, skipped_count integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_line RECORD;
  v_expense_id uuid;
  v_matched int := 0;
  v_skipped int := 0;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can rematch statement lines';
  END IF;

  FOR v_line IN
    SELECT bl.* FROM bank_statement_lines bl
    WHERE bl.match_status = 'unmatched'
      AND bl.transfer_id IS NOT NULL
      AND bl.reference_code IS NOT NULL
      AND (p_import_id IS NULL OR bl.import_id = p_import_id)
  LOOP
    SELECT id INTO v_expense_id
      FROM expenses
     WHERE bank_ref = v_line.reference_code
       AND transfer_id IS NULL
     LIMIT 1;

    IF v_expense_id IS NOT NULL THEN
      BEGIN
        PERFORM match_expense_to_statement_line(v_line.id, v_expense_id);
        v_matched := v_matched + 1;
      EXCEPTION WHEN OTHERS THEN
        -- An expense with the right bank_ref exists but can't legally
        -- transition yet (e.g. missing finance_approved_by, no GRN for a
        -- pay-on-delivery PO). Leave it unmatched rather than fail the
        -- whole sweep — the per-line manual matcher surfaces the same
        -- error if someone tries it by hand.
        v_skipped := v_skipped + 1;
      END;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_skipped;
END $fn$;

GRANT EXECUTE ON FUNCTION public.rematch_committed_statement_lines(uuid) TO authenticated;
