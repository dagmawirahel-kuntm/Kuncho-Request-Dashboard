-- 270 — Repair the column-shifted statement import, and two matcher faults
--
-- ── Part 1: the shifted import ───────────────────────────────────────────────
--
-- Import 8688873f (account-statement-2026-08-11-to-2026-08-19.csv, committed
-- 27 Aug) was parsed by a parser that assumed a fixed column order and
-- ignored the file's header. CBE issued that statement in a different
-- layout, so every row landed one column to the left:
--
--     stored debit_amount    <- (nothing)
--     stored credit_amount   <- the real DEBIT
--     stored running_balance <- the real CREDIT
--     stored reference       <- the real BALANCE
--
-- The result: 46 outgoing payments totalling 5,069,507.93 ETB were
-- recorded as money coming *in*, and the two genuine deposits
-- (7,148,083.00) were recorded as nothing at all. Nothing errored.
--
-- The shift is provable, not inferred. Reading each column one position
-- back and replaying the bank's own arithmetic — balance = previous
-- balance − debit + credit — reconciles all 48 lines with zero
-- mismatches, and the final balance lands on 6,581,513.73, which is
-- exactly the ending balance recorded independently by the "export 18"
-- import covering the same period. The verification block below re-runs
-- that check and aborts the migration if it does not hold, so this
-- cannot silently repair the wrong rows if it is ever re-applied.
--
-- What cannot be recovered: the bank reference. The new layout carries
-- it in a column the old parser never read, so it is not in the stored
-- data to shift back. These lines will therefore stay unmatched until
-- the file is re-imported with the fixed parser. The amounts are what
-- matter for the cash position, and those are restored exactly.
--
-- Nothing downstream consumed the bad values: all 48 lines are
-- match_status 'unmatched' with no expense, sale, payroll or credit
-- classification attached, so no journal entry was ever posted from
-- them. This is a contained repair of the import itself.

DO $repair$
DECLARE
  v_import   uuid := '8688873f-541e-4614-9cfc-ff98cbf40f12';
  v_mismatch int;
  v_touched  int;
  v_last     numeric;
BEGIN
  -- Only act on the specific corruption this migration describes: every
  -- line has a credit and none has a debit. If the data does not look
  -- like that any more, someone has already dealt with it.
  IF NOT EXISTS (SELECT 1 FROM bank_statement_lines WHERE import_id = v_import) THEN
    RAISE NOTICE '270: import % not present, nothing to repair', v_import;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM bank_statement_lines
              WHERE import_id = v_import AND debit_amount IS NOT NULL) THEN
    RAISE NOTICE '270: import % already has debits, skipping repair', v_import;
    RETURN;
  END IF;

  -- Verify the reconstruction against the bank's own running balance
  -- BEFORE writing anything.
  WITH r AS (
    SELECT line_no,
           credit_amount                                    AS new_debit,
           running_balance                                  AS new_credit,
           NULLIF(replace(reference, ',', ''), '')::numeric  AS new_balance
    FROM bank_statement_lines WHERE import_id = v_import
  ), chk AS (
    SELECT r.*,
           lag(new_balance) OVER (ORDER BY line_no) AS prev_balance,
           lag(new_balance) OVER (ORDER BY line_no)
             - COALESCE(new_debit, 0) + COALESCE(new_credit, 0) AS expected
    FROM r
  )
  SELECT count(*) FILTER (WHERE prev_balance IS NOT NULL AND abs(expected - new_balance) > 0.01)
    INTO v_mismatch FROM chk;

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION '270: refusing to repair import % — the shifted reading does not reconcile (% mismatching lines). Investigate by hand.',
      v_import, v_mismatch;
  END IF;

  UPDATE bank_statement_lines
     SET debit_amount    = credit_amount,
         credit_amount   = running_balance,
         running_balance = NULLIF(replace(reference, ',', ''), '')::numeric,
         -- The real reference was in a column the old parser never read;
         -- what sits here is the balance, which must not be left behind
         -- masquerading as a matchable bank reference.
         reference       = NULL,
         reference_code  = NULL
   WHERE import_id = v_import;
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  SELECT running_balance INTO v_last
    FROM bank_statement_lines WHERE import_id = v_import ORDER BY line_no DESC LIMIT 1;

  IF v_last IS NULL OR abs(v_last - 6581513.73) > 0.01 THEN
    RAISE EXCEPTION '270: post-repair closing balance is %, expected 6581513.73 — rolling back', v_last;
  END IF;

  -- The import row never captured the sentinels either.
  UPDATE bank_statement_imports
     SET ending_balance = COALESCE(ending_balance, v_last)
   WHERE id = v_import;

  RAISE NOTICE '270: repaired % line(s); closing balance % confirmed', v_touched, v_last;
END $repair$;

-- ── Part 2: auto-match must not overwrite a human decision ───────────────────
--
-- auto_match_statement_import() loops every line in the import and
-- rewrites match_status unconditionally. On a fresh import that is
-- harmless, but re-running it over an import someone has already worked
-- replaces their 'manual' resolutions with whatever the reference-code
-- rule concludes. Verified: re-running it over import 5ede4d42 turned
-- 25 unmatched + 2 manual into 27 duplicate — the two manual matches
-- were destroyed.
--
-- 'manual' exists precisely because the automatic rule could not settle
-- the line, so the automatic rule is never the better answer for it.

CREATE OR REPLACE FUNCTION public.auto_match_statement_import(p_import_id uuid)
RETURNS TABLE(matched_count integer, duplicate_count integer, unmatched_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line RECORD;
  v_expense_id     UUID;
  v_expense_amount NUMERIC;
  v_sale_id        UUID;
  v_sale_amount    NUMERIC;
  v_line_amount    NUMERIC;
  v_matched   INT := 0;
  v_duplicate INT := 0;
  v_unmatched INT := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can run statement matching';
  END IF;

  FOR v_line IN
    SELECT * FROM bank_statement_lines
    -- Leave anything a person has already resolved by hand alone.
    WHERE import_id = p_import_id AND match_status IS DISTINCT FROM 'manual'
  LOOP
    IF EXISTS (SELECT 1 FROM transfers WHERE transfer_id_code = v_line.reference_code) THEN
      UPDATE bank_statement_lines
      SET match_status = 'duplicate', matched_expense_id = NULL, matched_sale_id = NULL,
          matched_expense_amount = NULL, variance_amount = NULL
      WHERE id = v_line.id;
      v_duplicate := v_duplicate + 1;
      CONTINUE;
    END IF;

    v_expense_id := NULL; v_expense_amount := NULL;
    v_sale_id := NULL; v_sale_amount := NULL;

    IF v_line.reference_code IS NOT NULL THEN
      IF COALESCE(v_line.debit_amount, 0) > 0 THEN
        SELECT id, amount_etb INTO v_expense_id, v_expense_amount
        FROM expenses
        WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL
        LIMIT 1;
      ELSIF COALESCE(v_line.credit_amount, 0) > 0 THEN
        SELECT id, amount INTO v_sale_id, v_sale_amount
        FROM sales
        WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL
        LIMIT 1;
      END IF;
    END IF;

    IF v_expense_id IS NOT NULL THEN
      v_line_amount := COALESCE(NULLIF(v_line.debit_amount, 0), v_line.credit_amount, 0);
      UPDATE bank_statement_lines
      SET match_status           = 'matched_expense',
          matched_expense_id     = v_expense_id,
          matched_sale_id        = NULL,
          matched_expense_amount = v_expense_amount,
          variance_amount        = CASE WHEN v_expense_amount IS NULL THEN NULL
                                        ELSE v_line_amount - v_expense_amount END
      WHERE id = v_line.id;
      v_matched := v_matched + 1;
    ELSIF v_sale_id IS NOT NULL THEN
      v_line_amount := COALESCE(NULLIF(v_line.credit_amount, 0), v_line.debit_amount, 0);
      UPDATE bank_statement_lines
      SET match_status           = 'matched_sale',
          matched_expense_id     = NULL,
          matched_sale_id        = v_sale_id,
          matched_expense_amount = v_sale_amount,
          variance_amount        = CASE WHEN v_sale_amount IS NULL THEN NULL
                                        ELSE v_line_amount - v_sale_amount END
      WHERE id = v_line.id;
      v_matched := v_matched + 1;
    ELSE
      UPDATE bank_statement_lines
      SET match_status = 'unmatched', matched_expense_id = NULL, matched_sale_id = NULL,
          matched_expense_amount = NULL, variance_amount = NULL
      WHERE id = v_line.id;
      v_unmatched := v_unmatched + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_duplicate, v_unmatched;
END $function$;

COMMENT ON FUNCTION public.auto_match_statement_import IS
  'Matches statement lines to expenses/sales by bank reference. Skips lines already resolved manually — a human resolution is never improved on by the automatic rule.';

-- ── Part 3: stop the unmatched queue lying ───────────────────────────────────
--
-- rematch_committed_statement_lines() looks for an expense with the
-- line's reference that has no transfer yet. When the expense has
-- ALREADY been reconciled, that lookup finds nothing and the line is
-- counted as "skipped" — so it stays in the unmatched queue forever
-- even though it is fully accounted for. Eight lines currently sit there
-- on that basis, each with a transfer whose code equals the line's own
-- reference.
--
-- Marking them 'duplicate' is what the import-time matcher would have
-- concluded had it run after the transfer existed; it is the same
-- reference-equals-transfer test, applied late.

CREATE OR REPLACE FUNCTION public.rematch_committed_statement_lines(
  p_import_id uuid DEFAULT NULL
) RETURNS TABLE(matched_count integer, reconciled_count integer, skipped_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_line RECORD;
  v_expense_id uuid;
  v_matched    int := 0;
  v_reconciled int := 0;
  v_skipped    int := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can rematch statement lines';
  END IF;

  FOR v_line IN
    SELECT bl.* FROM bank_statement_lines bl
    WHERE bl.match_status = 'unmatched'
      AND bl.transfer_id IS NOT NULL
      AND bl.reference_code IS NOT NULL
      AND (p_import_id IS NULL OR bl.import_id = p_import_id)
  LOOP
    -- Already reconciled: a transfer carrying this exact reference
    -- exists, so the money is accounted for and the line is not a
    -- pending item.
    IF EXISTS (SELECT 1 FROM transfers WHERE transfer_id_code = v_line.reference_code) THEN
      UPDATE bank_statement_lines
         SET match_status = 'duplicate', matched_expense_id = NULL, matched_sale_id = NULL,
             matched_expense_amount = NULL, variance_amount = NULL
       WHERE id = v_line.id;
      v_reconciled := v_reconciled + 1;
      CONTINUE;
    END IF;

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

  RETURN QUERY SELECT v_matched, v_reconciled, v_skipped;
END $fn$;

COMMENT ON FUNCTION public.rematch_committed_statement_lines IS
  'Re-runs reference matching over committed, still-unmatched lines. Lines whose reference already belongs to a recorded transfer are marked duplicate rather than skipped, so the unmatched queue reflects genuinely outstanding items.';

GRANT EXECUTE ON FUNCTION public.rematch_committed_statement_lines(uuid) TO authenticated;
