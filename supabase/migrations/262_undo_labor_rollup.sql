-- 262 — Undo a labor rollup so it can be re-run after fixing timesheet data
--
-- rollup_labor_timesheets_to_expense is idempotent by design: it returns
-- the existing expense when one already covers that requisition + period,
-- rather than creating a second one. That's right for accidental
-- double-clicks, but it also means a rollup built on wrong timesheet data
-- can never be corrected — "Roll up now" silently hands back the same bad
-- expense, and the only way out was deleting rows by hand in SQL.
--
-- These two RPCs make the fix → redo cycle a normal, guarded operation.
--
-- What a rollup writes, and therefore what undoing must reverse:
--   1. the expenses row (rolled_up_from_requisition_id + period)
--   2. its labor_expense_workers breakdown
--   3. timesheet.rolled_up_expense_id            stamps
--   4. timesheet_attendance.rolled_up_expense_id stamps
-- Deleting the expense does all four in one atomic step: (2) is ON DELETE
-- CASCADE and (3)/(4) are ON DELETE SET NULL, which is exactly the
-- un-stamping the re-run needs to pick those rows up again.
--
-- Guards — an undo is refused unless the rollup is genuinely still a draft:
--   * payment_state must be 'unpaid' or 'void' (never sent/paid/advance)
--   * no bank transfer matched
--   * no journal entry posted
--   * not attached to a batch payment
-- so this can never quietly erase a payment that actually left the bank.

CREATE OR REPLACE FUNCTION public.undo_labor_rollup(p_expense_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exp      expenses%ROWTYPE;
  v_workers  int;
  v_ts       int;
  v_att      int;
BEGIN
  -- Same authority as running a rollup (251): if you can create it, you
  -- can take it back while it's still a draft.
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin','executive','finance','hr_officer') THEN
    RAISE EXCEPTION 'Only admin, executive, finance, or HR may undo a labor rollup';
  END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id;
  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense % not found', p_expense_id;
  END IF;
  IF v_exp.rolled_up_from_requisition_id IS NULL THEN
    RAISE EXCEPTION 'Expense % is not a labor rollup — refusing to delete it', COALESCE(v_exp.expense_code, p_expense_id::text);
  END IF;

  IF v_exp.payment_state NOT IN ('unpaid', 'void') THEN
    RAISE EXCEPTION 'Rollup % is %, not a draft — undo only applies to an unpaid rollup, otherwise this would erase a real payment',
      COALESCE(v_exp.expense_code, p_expense_id::text), v_exp.payment_state;
  END IF;
  IF v_exp.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'Rollup % is matched to a bank statement line — undo would orphan that match', COALESCE(v_exp.expense_code, p_expense_id::text);
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    RAISE EXCEPTION 'Rollup % has already posted to the ledger — reverse the journal entry first', COALESCE(v_exp.expense_code, p_expense_id::text);
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'Rollup % belongs to a batch payment — remove it from the batch first', COALESCE(v_exp.expense_code, p_expense_id::text);
  END IF;

  SELECT count(*) INTO v_workers FROM labor_expense_workers      WHERE expense_id = p_expense_id;
  SELECT count(*) INTO v_ts      FROM timesheet                  WHERE rolled_up_expense_id = p_expense_id;
  SELECT count(*) INTO v_att     FROM timesheet_attendance       WHERE rolled_up_expense_id = p_expense_id;

  -- Cascades labor_expense_workers; nulls both rolled_up_expense_id
  -- stamps, releasing those rows for the next rollup run.
  DELETE FROM expenses WHERE id = p_expense_id;

  RETURN format('Undid %s (%s ETB): %s worker row(s) removed, %s timesheet + %s attendance row(s) released for re-rollup',
                COALESCE(v_exp.expense_code, p_expense_id::text), v_exp.amount_etb, v_workers, v_ts, v_att);
END $function$;

COMMENT ON FUNCTION public.undo_labor_rollup IS
  'Deletes a still-draft labor rollup expense so its timesheets can be corrected and rolled up again. Refuses anything paid/sent, bank-matched, ledger-posted, or in a batch payment. admin/executive/finance/hr_officer only.';

-- Batch variant for a whole payroll week. Each rollup is undone in its own
-- sub-block, so one ineligible expense (already paid, say) reports its
-- reason and the rest still go — rather than aborting the run.
CREATE OR REPLACE FUNCTION public.undo_labor_rollups_for_period(
  p_project_id uuid, p_period_start date, p_period_end date
)
RETURNS TABLE(expense_code text, amount_etb numeric, result text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin','executive','finance','hr_officer') THEN
    RAISE EXCEPTION 'Only admin, executive, finance, or HR may undo a labor rollup';
  END IF;

  FOR v_row IN
    SELECT e.id, e.expense_code AS code, e.amount_etb AS amt
    FROM expenses e
    WHERE e.project_id = p_project_id
      AND e.rolled_up_from_requisition_id IS NOT NULL
      AND e.rollup_period_start = p_period_start
      AND e.rollup_period_end   = p_period_end
    ORDER BY e.expense_code
  LOOP
    expense_code := v_row.code;
    amount_etb   := v_row.amt;
    BEGIN
      result := undo_labor_rollup(v_row.id);
    EXCEPTION WHEN OTHERS THEN
      result := 'SKIPPED — ' || SQLERRM;
    END;
    RETURN NEXT;
  END LOOP;
END $function$;

COMMENT ON FUNCTION public.undo_labor_rollups_for_period IS
  'Undoes every still-draft labor rollup for one project and rollup period. Ineligible rollups are reported as SKIPPED with the reason rather than aborting the batch.';
