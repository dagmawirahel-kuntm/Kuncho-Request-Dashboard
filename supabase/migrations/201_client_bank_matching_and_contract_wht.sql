-- 201 — Client-side bank matching by reference, contracts surfaced on the
-- client page, and a per-contract WHT deduction mode.
--
-- Three coupled pieces:
--
-- 1. Bank matching for incoming money (client payments/sales), mirroring
--    the existing expense-side matching exactly: sales.transfer_id,
--    match_sale_to_transfer() (parallel to match_expense_to_transfer),
--    a new 'matched_sale' status + matched_sale_id on bank_statement_lines,
--    and auto_match_statement_import / commit_statement_import /
--    rematch_committed_statement_lines all extended to route credit lines
--    (money in) at a sale's bank_ref, the same way debit lines already
--    route to an expense's bank_ref.
--
-- 2. contracts already exists (BD module) with a client_id — nothing to
--    add there structurally; the client page just needs to query it.
--    (Done in the frontend, no schema change required for this part.)
--
-- 3. contracts.wht_deduction_mode ('per_payment' default | 'final_only').
--    sales.contract_id links an invoice to the contract it's raised
--    against; sales.is_final_payment flags the invoice that closes out a
--    final_only contract. When a contract is final_only, WHT is 3% (or
--    the contract's own wht_rate) of the CONTRACT'S TOTAL VALUE, withheld
--    once against the flagged final invoice — not on every qualifying
--    sale as the default per_payment mode does.

SET search_path TO public;

-- ── 1a) sales: transfer_id + contract linkage ────────────────────────────────
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS transfer_id      uuid REFERENCES transfers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_id      uuid REFERENCES contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_final_payment boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sales.contract_id IS
  'Contract this invoice is raised against. Drives WHT behavior when the contract is wht_deduction_mode=final_only.';
COMMENT ON COLUMN sales.is_final_payment IS
  'Marks the invoice that closes out a final_only contract — WHT is computed on the contract total and attached to this sale only.';

-- ── 1b) contracts: WHT deduction mode ────────────────────────────────────────
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS wht_deduction_mode text NOT NULL DEFAULT 'per_payment';

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_wht_deduction_mode_chk;
ALTER TABLE contracts
  ADD CONSTRAINT contracts_wht_deduction_mode_chk
  CHECK (wht_deduction_mode IN ('per_payment', 'final_only'));

COMMENT ON COLUMN contracts.wht_deduction_mode IS
  'per_payment (default): every qualifying sale (>=20k) against this client needs its own WHT receipt. final_only: WHT is deducted once, on the invoice flagged is_final_payment, computed on the full contract_value.';

-- ── 1c) bank_statement_lines: matched_sale_id + matched_sale status ──────────
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS matched_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL;

ALTER TABLE bank_statement_lines DROP CONSTRAINT IF EXISTS bank_statement_lines_match_status_check;
ALTER TABLE bank_statement_lines
  ADD CONSTRAINT bank_statement_lines_match_status_check
  CHECK (match_status = ANY (ARRAY['unmatched'::text, 'matched_expense'::text, 'matched_sale'::text, 'duplicate'::text, 'manual'::text]));

COMMENT ON COLUMN bank_statement_lines.matched_sale_id IS
  'Set when a credit (incoming) line matches a sale by bank_ref. Mutually exclusive with matched_expense_id — matched_expense_amount/variance_amount are reused generically for whichever side matched.';

-- ── 2) match_sale_to_transfer — mirrors match_expense_to_transfer ────────────
CREATE OR REPLACE FUNCTION public.match_sale_to_transfer(p_sale_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_to_account_id uuid;
  v_transfer_date  date;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a sale to a bank line';
  END IF;

  SELECT to_account_id, date INTO v_to_account_id, v_transfer_date FROM transfers WHERE id = p_transfer_id;
  IF v_to_account_id IS NULL AND v_transfer_date IS NULL THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  UPDATE sales
     SET sales_status  = 'Paid',
         transfer_id   = p_transfer_id,
         account_id    = COALESCE(account_id, v_to_account_id),
         payment_date  = COALESCE(payment_date, v_transfer_date)
   WHERE id = p_sale_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.match_sale_to_transfer(uuid, uuid) TO authenticated;

-- ── 3) match_sale_to_statement_line — manual pairing, mirrors the expense one ─
CREATE OR REPLACE FUNCTION public.match_sale_to_statement_line(p_line_id uuid, p_sale_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_line        bank_statement_lines%ROWTYPE;
  v_amount      numeric;
  v_line_amount numeric;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a sale to a bank line';
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

  SELECT amount INTO v_amount FROM sales WHERE id = p_sale_id;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'Sale % not found', p_sale_id;
  END IF;

  PERFORM match_sale_to_transfer(p_sale_id, v_line.transfer_id);

  v_line_amount := COALESCE(NULLIF(v_line.credit_amount, 0), v_line.debit_amount, 0);

  UPDATE bank_statement_lines
     SET matched_sale_id         = p_sale_id,
         matched_expense_amount  = v_amount,
         match_status            = 'matched_sale',
         variance_amount         = v_line_amount - v_amount
   WHERE id = p_line_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.match_sale_to_statement_line(uuid, uuid) TO authenticated;

-- ── 4) auto_match_statement_import — route by direction ──────────────────────
-- Debit lines (money out) try to match an expense by bank_ref, exactly as
-- before. Credit lines (money in) now also try to match a sale by bank_ref.
CREATE OR REPLACE FUNCTION public.auto_match_statement_import(p_import_id UUID)
RETURNS TABLE(matched_count integer, duplicate_count integer, unmatched_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
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
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can run statement matching';
  END IF;

  FOR v_line IN SELECT * FROM bank_statement_lines WHERE import_id = p_import_id LOOP
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
END $fn$;

-- ── 5) commit_statement_import — route the transfer link by match kind ──────
CREATE OR REPLACE FUNCTION public.commit_statement_import(p_import_id UUID)
RETURNS TABLE(transfers_created integer, expenses_matched integer, flagged_unmatched integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_import bank_statement_imports%ROWTYPE;
  v_line RECORD;
  v_transfer_id UUID;
  v_created INT := 0;
  v_matched INT := 0;
  v_flagged INT := 0;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can commit a statement import';
  END IF;

  SELECT * INTO v_import FROM bank_statement_imports WHERE id = p_import_id;
  IF v_import.id IS NULL THEN
    RAISE EXCEPTION 'Import not found';
  END IF;
  IF v_import.status = 'committed' THEN
    RAISE EXCEPTION 'This import has already been committed';
  END IF;

  FOR v_line IN SELECT * FROM bank_statement_lines WHERE import_id = p_import_id AND match_status <> 'duplicate' LOOP
    INSERT INTO transfers (transfer_id_code, date, from_account_id, to_account_id, amount, notes)
    VALUES (
      v_line.reference_code,
      COALESCE(v_line.value_date, v_line.post_date),
      CASE WHEN v_line.debit_amount IS NOT NULL AND v_line.debit_amount > 0 THEN v_import.account_id END,
      CASE WHEN v_line.credit_amount IS NOT NULL AND v_line.credit_amount > 0 THEN v_import.account_id END,
      COALESCE(v_line.debit_amount, v_line.credit_amount, 0),
      COALESCE(v_line.narration, '') || ' (ref: ' || COALESCE(v_line.reference, '') || ')'
    ) RETURNING id INTO v_transfer_id;

    v_created := v_created + 1;

    IF v_line.match_status = 'matched_expense' AND v_line.matched_expense_id IS NOT NULL THEN
      PERFORM match_expense_to_transfer(v_line.matched_expense_id, v_transfer_id);
      v_matched := v_matched + 1;
    ELSIF v_line.match_status = 'matched_sale' AND v_line.matched_sale_id IS NOT NULL THEN
      PERFORM match_sale_to_transfer(v_line.matched_sale_id, v_transfer_id);
      v_matched := v_matched + 1;
    ELSE
      v_flagged := v_flagged + 1;
    END IF;

    UPDATE bank_statement_lines SET transfer_id = v_transfer_id WHERE id = v_line.id;
  END LOOP;

  UPDATE bank_statement_imports SET status = 'committed', committed_at = NOW() WHERE id = p_import_id;

  RETURN QUERY SELECT v_created, v_matched, v_flagged;
END $fn$;

-- ── 6) rematch_committed_statement_lines — also sweep credit lines ──────────
CREATE OR REPLACE FUNCTION public.rematch_committed_statement_lines(
  p_import_id uuid DEFAULT NULL
) RETURNS TABLE(matched_count integer, skipped_count integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_line RECORD;
  v_expense_id uuid;
  v_sale_id uuid;
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
    v_expense_id := NULL; v_sale_id := NULL;

    IF COALESCE(v_line.debit_amount, 0) > 0 THEN
      SELECT id INTO v_expense_id FROM expenses
       WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL LIMIT 1;
    ELSIF COALESCE(v_line.credit_amount, 0) > 0 THEN
      SELECT id INTO v_sale_id FROM sales
       WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL LIMIT 1;
    END IF;

    IF v_expense_id IS NOT NULL THEN
      BEGIN
        PERFORM match_expense_to_statement_line(v_line.id, v_expense_id);
        v_matched := v_matched + 1;
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
      END;
    ELSIF v_sale_id IS NOT NULL THEN
      BEGIN
        PERFORM match_sale_to_statement_line(v_line.id, v_sale_id);
        v_matched := v_matched + 1;
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
      END;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_skipped;
END $fn$;
