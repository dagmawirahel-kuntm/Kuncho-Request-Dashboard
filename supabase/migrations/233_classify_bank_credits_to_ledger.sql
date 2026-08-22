-- Credit-side of the bank-reconciliation hub (part 2). Incoming money
-- that isn't a sale — an owner injection, a loan, a vendor refund, an
-- inter-account move, or other income — could be matched to nothing, so
-- it sat as an unmatched credit line and never reached the ledger. This
-- lets finance classify such a credit and BOOK it: a real journal entry
-- is posted, mirroring how post_sale_payment_to_ledger posts a sale, so
-- the money flows into the balance sheet / P&L instead of just the cash
-- view.
--
-- The chart of accounts had the Equity / Liability / Revenue parents but
-- no postable leaves for these, so three are added first.

SET search_path TO public;

-- ── 1. Postable COA leaves for the non-sale credit destinations ──────
INSERT INTO chart_of_accounts (account_code, account_name, nature, is_postable, parent_account_id)
SELECT '3020', 'Owner Contributions', 'Equity', true, (SELECT id FROM chart_of_accounts WHERE account_code='3000')
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code='3020');

INSERT INTO chart_of_accounts (account_code, account_name, nature, is_postable, parent_account_id)
SELECT '2030', 'Loans Payable', 'Liability', true, (SELECT id FROM chart_of_accounts WHERE account_code='2000')
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code='2030');

INSERT INTO chart_of_accounts (account_code, account_name, nature, is_postable, parent_account_id)
SELECT '4020', 'Other Income', 'Revenue', true, (SELECT id FROM chart_of_accounts WHERE account_code='4000')
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code='4020');

-- ── 2. Remember the classification on the line itself ────────────────
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS credit_classification TEXT;

-- ── 3. classify_bank_credit: validate, post the journal, mark line ───
CREATE OR REPLACE FUNCTION public.classify_bank_credit(
  p_line_id uuid,
  p_classification text,
  p_counter_account_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line          bank_statement_lines%ROWTYPE;
  v_account_id    uuid;
  v_amount        numeric;
  v_cash_coa      uuid;
  v_credit_coa    uuid;
  v_entry_id      uuid;
  v_entry_date    date;
  v_credit_name   text;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can classify a bank credit';
  END IF;

  SELECT * INTO v_line FROM bank_statement_lines WHERE id = p_line_id;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'Statement line % not found', p_line_id; END IF;
  IF v_line.transfer_id IS NULL THEN
    RAISE EXCEPTION 'This line''s import has not been committed yet — commit it first';
  END IF;
  IF COALESCE(v_line.credit_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Only an incoming (credit) line can be classified as income';
  END IF;
  IF v_line.match_status IN ('matched_sale', 'matched_expense') THEN
    RAISE EXCEPTION 'This line is already matched (%). Unmatch it before reclassifying', v_line.match_status;
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table='bank_statement_lines' AND source_id=p_line_id) THEN
    RAISE EXCEPTION 'This line already has a ledger posting';
  END IF;

  v_amount := v_line.credit_amount;
  v_entry_date := COALESCE(v_line.value_date, v_line.post_date, CURRENT_DATE);

  -- Cash account (debit side) = the COA leaf linked to the imported account
  SELECT bsi.account_id INTO v_account_id
  FROM bank_statement_imports bsi WHERE bsi.id = v_line.import_id;
  SELECT id INTO v_cash_coa FROM chart_of_accounts WHERE linked_account_id = v_account_id;
  IF v_cash_coa IS NULL THEN
    RAISE EXCEPTION 'No ledger cash account is linked to this bank account';
  END IF;

  -- Credit side depends on the classification
  IF p_classification = 'owner_injection' THEN
    SELECT id INTO v_credit_coa FROM chart_of_accounts WHERE account_code='3020';
    v_credit_name := 'Owner contribution';
  ELSIF p_classification = 'loan_received' THEN
    SELECT id INTO v_credit_coa FROM chart_of_accounts WHERE account_code='2030';
    v_credit_name := 'Loan received';
  ELSIF p_classification = 'other_income' THEN
    SELECT id INTO v_credit_coa FROM chart_of_accounts WHERE account_code='4020';
    v_credit_name := 'Other income';
  ELSIF p_classification = 'vendor_refund' THEN
    -- Refunds are treated as other income for now; a later pass can link
    -- a refund back to the original expense's account.
    SELECT id INTO v_credit_coa FROM chart_of_accounts WHERE account_code='4020';
    v_credit_name := 'Vendor refund';
  ELSIF p_classification = 'inter_account_transfer' THEN
    IF p_counter_account_id IS NULL THEN
      RAISE EXCEPTION 'An inter-account transfer needs the account the money came from';
    END IF;
    IF p_counter_account_id = v_account_id THEN
      RAISE EXCEPTION 'The source account cannot be the same as the receiving account';
    END IF;
    SELECT id INTO v_credit_coa FROM chart_of_accounts WHERE linked_account_id = p_counter_account_id;
    IF v_credit_coa IS NULL THEN
      RAISE EXCEPTION 'No ledger cash account is linked to the source account';
    END IF;
    v_credit_name := 'Inter-account transfer in';
  ELSE
    RAISE EXCEPTION 'Unknown classification: %', p_classification;
  END IF;

  INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
  VALUES (v_entry_date, 'operational', 'bank_statement_lines', p_line_id,
          v_credit_name || COALESCE(' — ' || NULLIF(btrim(p_notes), ''), '') ||
          COALESCE(' (' || NULLIF(v_line.narration, '') || ')', ''),
          auth.uid())
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
    (v_entry_id, v_cash_coa,   v_amount, 0, 'Received into ' || (SELECT account_name FROM accounts WHERE id = v_account_id)),
    (v_entry_id, v_credit_coa, 0, v_amount, v_credit_name);

  SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
  SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;

  UPDATE bank_statement_lines
     SET match_status = 'manual', credit_classification = p_classification
   WHERE id = p_line_id;

  RETURN v_entry_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.classify_bank_credit(uuid, text, uuid, text) TO authenticated;
