-- 330 — Record withholding properly, and give vendors a bank
--
-- ── 1. Withholding never reached the books ───────────────────────────────────
--
-- Withholding tax lives on the expense (wht_amount), and the rest of the
-- app already treats it as money that does not go to the payee: the To-Pay
-- queue's cash_to_send takes it off, the Payment Request prints the net, and
-- v_wht_payable_by_ec_period (311) reports it for the WHT return.
--
-- The ledger was the exception. post_expense_payment_to_ledger() credited
-- cash for the full amount_etb and ignored wht_amount entirely. So for every
-- payment with withholding:
--
--   · the books said the gross left the bank, while the bank only moved the
--     net — every one of the 10 paid with WHT matches its bank line at the
--     net, e.g. GEN-PRIN-20260827-01: gross 1,622,631.35, net 1,580,301.84,
--     bank line 1,580,307.84;
--   · the tax withheld, which Kuncho owes the authority, appeared nowhere
--     as a liability.
--
-- Across those 10 that is 158,013.71 ETB booked as cash out that never
-- left, and the same 158,013.71 missing from liabilities.
--
-- This adds 2025 Withholding Tax Payable, posts withholding to it from now
-- on, and reclassifies the ten that already posted wrong.
--
-- ── 2. Marking a payment as having WHT deducted ─────────────────────────────
--
-- Two fields had to be kept in step by hand: verify_wht (a tick box) and
-- wht_amount (the figure). They had drifted — 29 expenses ticked with no
-- amount, so nothing was actually withheld, and 8 with an amount but no
-- tick. set_expense_withholding() sets both at once, in the only window
-- where it is still true: before the payment is sent. After that the wire
-- has left for a fixed amount and changing the deduction would make the
-- records disagree with the bank.
--
-- The rate is not decided here. Every WHT amount on file is 3% of the
-- VAT-exclusive amount, and that is what the app proposes — but a payee with
-- no TIN is withheld at a higher rate, and whether an amount includes VAT is
-- not recorded anywhere, so the person marking it confirms the figure. The
-- function validates it, it does not second-guess it.
--
-- ── 3. Vendors had an account number and no bank ────────────────────────────
--
-- Staff record which bank holds their account (staff.bank_id -> accounts);
-- vendors only had free text. A Payment Request splits its schedule by bank
-- — a CBE bulk transfer cannot carry an Awash account — so every vendor
-- landed under "No bank recorded", account number and all.
--
-- vendors.bank_id mirrors staff.bank_id. Backfilled only where the evidence
-- is certain:
--
--   · 412 vendors whose account is a bare 13-digit number starting 1000 —
--     Commercial Bank of Ethiopia's format. Tested against staff, where the
--     bank IS recorded: all 78 CBE staff accounts match it and none of the
--     29 at Zemen, BOA or Awash do.
--   · 3 vendors whose single account names its bank outright
--     ("BOA - 226001522", "248243341 - BOA", "01304821175200 (Awash)").
--
-- The 14 others hold free text — several accounts, several banks (one lists
-- eleven) — and are left for a person to choose.

-- ── Vendor bank ──────────────────────────────────────────────────────────────

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES accounts(id);

COMMENT ON COLUMN vendors.bank_id IS
  'Which bank holds bank_account — the same registry staff.bank_id uses. A Payment Request groups its disbursement schedule by it.';

UPDATE vendors SET bank_id = '890c3473-dc57-4c01-9f39-17518047c463'   -- Commercial Bank of Ethiopia
 WHERE bank_id IS NULL AND bank_account ~ '^\s*1000\d{9}\s*$';

UPDATE vendors SET bank_id = '20835a83-e3b2-4677-9528-76707056730f'   -- BOA
 WHERE bank_id IS NULL
   AND (bank_account ~* '^\s*BOA\s*-\s*\d+\s*$' OR bank_account ~* '^\s*\d+\s*-\s*BOA\s*$');

UPDATE vendors SET bank_id = '9e90c20f-882d-4a80-b605-ef46c2266838'   -- AWBNK (Awash)
 WHERE bank_id IS NULL AND bank_account ~* '^\s*\d+\s*\(\s*Awash\s*\)\s*$';

-- ── WHT Payable ──────────────────────────────────────────────────────────────

INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section)
SELECT '2025', 'Withholding Tax Payable', 'Liability',
       (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), true, true, 'operating'
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '2025');

-- ── Posting ──────────────────────────────────────────────────────────────────
--
-- Only the WHT is new. The vendor-credit split (277) and the Cash on Hand
-- fallback (297) are carried through unchanged.
--
--   paid:     Dr expense  amount   / Cr cash  amount - credit - WHT
--                                  / Cr 1080  credit
--                                  / Cr 2025  WHT
--   advance:  Dr 1080     amount - credit
--                                  / Cr cash  amount - credit - WHT
--                                  / Cr 2025  WHT
--   close:    unchanged — the advance already carried the withholding.

CREATE OR REPLACE FUNCTION public.post_expense_payment_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy UUID; v_row_fy UUID; v_effective_category_id UUID;
  v_expense_account_id UUID; v_cash_account_id UUID; v_advance_account_id UUID; v_wht_account_id UUID;
  v_entry_id UUID; v_is_advance_close BOOLEAN; v_existing_count INT;
  v_credit NUMERIC; v_wht NUMERIC; v_advance NUMERIC; v_cash NUMERIC; v_cash_label TEXT;
BEGIN
  v_is_advance_close := (TG_OP='UPDATE' AND OLD.payment_state='advance' AND NEW.payment_state='paid');
  IF NEW.payment_state NOT IN ('paid','advance') THEN RETURN NEW; END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_existing_count FROM journal_entries WHERE source_table='expenses' AND source_id=NEW.id;
  IF NEW.payment_state='advance' AND v_existing_count > 0 THEN RETURN NEW; END IF;
  IF NEW.payment_state='paid' AND v_is_advance_close AND v_existing_count <> 1 THEN RETURN NEW; END IF;
  IF NEW.payment_state='paid' AND NOT v_is_advance_close AND v_existing_count > 0 THEN RETURN NEW; END IF;

  v_effective_category_id := NEW.category_id;
  IF NEW.expense_type='purchase_order' THEN
    v_effective_category_id := COALESCE(resolve_po_posting_category(NEW.sourcing_bundle_id), NEW.category_id);
  END IF;

  v_credit  := COALESCE(NEW.credit_applied_etb, 0);
  v_wht     := COALESCE(NEW.wht_amount, 0);
  v_advance := COALESCE(NEW.amount_etb, 0) - v_credit;   -- what the vendor is owed in new money
  v_cash    := v_advance - v_wht;                         -- what actually leaves the account

  BEGIN
    SELECT coa.id INTO v_expense_account_id FROM chart_of_accounts coa WHERE coa.category_id=v_effective_category_id;
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id=NEW.account_id;
    SELECT id INTO v_advance_account_id FROM chart_of_accounts WHERE account_code='1080';
    SELECT id INTO v_wht_account_id FROM chart_of_accounts WHERE account_code='2025';

    IF v_cash_account_id IS NULL AND NEW.payment_method='cash' THEN
      SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE account_code='11000';
    END IF;

    v_cash_label := COALESCE(
      (SELECT account_name FROM accounts WHERE id=NEW.account_id),
      (SELECT account_name FROM chart_of_accounts WHERE id=v_cash_account_id));

    IF v_cash < 0 OR (v_wht > 0 AND v_wht_account_id IS NULL) THEN
      PERFORM log_posting_failure('expenses', NEW.id, format(
        'Cannot post: withholding %s exceeds the %s left after credit, or no Withholding Tax Payable account (2025)',
        v_wht, v_advance));
      RETURN NEW;
    END IF;

    IF NEW.payment_state='advance' THEN
      IF v_advance_account_id IS NULL OR NEW.amount_etb IS NULL OR (v_cash>0 AND v_cash_account_id IS NULL) THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post advance: advance account %s, account_id=%s -> cash account %s, amount_etb=%s',
          v_advance_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;
      IF v_advance > 0 THEN
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
        VALUES (NEW.date,'operational','expenses',NEW.id,'Vendor advance recorded: '||COALESCE(NEW.expense_code,NEW.id::text))
        RETURNING id INTO v_entry_id;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_advance_account_id, v_advance, 0,
           'Advance - goods not yet received: '||COALESCE(NEW.item_service_description,'')
             || CASE WHEN v_credit>0 THEN format(' (%s funded from vendor credit)', v_credit) ELSE '' END);
        IF v_cash > 0 THEN
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
            (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via '||COALESCE(v_cash_label,'cash'));
        END IF;
        IF v_wht > 0 THEN
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
            (v_entry_id, v_wht_account_id, 0, v_wht, 'Withholding tax withheld, owed to the tax authority');
        END IF;
      END IF;

    ELSIF v_is_advance_close THEN
      IF v_expense_account_id IS NULL OR v_advance_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot close advance: category_id=%s -> expense account %s, advance account %s, amount_etb=%s',
          v_effective_category_id, v_expense_account_id, v_advance_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date,'operational','expenses',NEW.id,'Vendor advance closed (GRN received): '||COALESCE(NEW.expense_code,NEW.id::text))
      RETURNING id INTO v_entry_id;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description),
        (v_entry_id, v_advance_account_id, 0, NEW.amount_etb, 'Advance closed - goods received');

    ELSE
      IF v_expense_account_id IS NULL OR NEW.amount_etb IS NULL
         OR (v_cash>0 AND v_cash_account_id IS NULL)
         OR (v_credit>0 AND v_advance_account_id IS NULL) THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post: category_id=%s -> expense account %s, account_id=%s -> cash account %s, amount_etb=%s',
          v_effective_category_id, v_expense_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date,'operational','expenses',NEW.id,'Expense paid: '||COALESCE(NEW.expense_code,NEW.id::text))
      RETURNING id INTO v_entry_id;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description);
      IF v_cash > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via '||COALESCE(v_cash_label,'cash'));
      END IF;
      IF v_credit > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_advance_account_id, 0, v_credit, 'Funded from vendor credit held in Vendor Advances');
      END IF;
      IF v_wht > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_wht_account_id, 0, v_wht, 'Withholding tax withheld, owed to the tax authority');
      END IF;
    END IF;

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('expenses', NEW.id, SQLERRM);
  END;

  RETURN NEW;
END; $function$;

-- ── Marking withholding ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_expense_withholding(
  p_expense_id uuid,
  p_withheld boolean,
  p_wht_amount numeric DEFAULT NULL,
  p_method text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exp expenses%ROWTYPE;
  v_room numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can record withholding';
  END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF v_exp.id IS NULL THEN RAISE EXCEPTION 'Expense % not found', p_expense_id; END IF;

  IF v_exp.payment_state NOT IN ('unpaid', 'approved_to_pay') THEN
    RAISE EXCEPTION 'Withholding can only be set before payment — % is already %, and the amount sent to the payee can no longer change',
      COALESCE(v_exp.expense_code, p_expense_id::text), v_exp.payment_state;
  END IF;

  IF NOT p_withheld THEN
    UPDATE expenses
       SET verify_wht = false, wht_amount = NULL,
           wht_handling_method = COALESCE(p_method, 'Not Applicable')
     WHERE id = p_expense_id;
    RETURN 0;
  END IF;

  v_room := COALESCE(v_exp.amount_etb, 0) - COALESCE(v_exp.credit_applied_etb, 0);
  IF p_wht_amount IS NULL OR p_wht_amount <= 0 THEN
    RAISE EXCEPTION 'Enter the withholding amount';
  END IF;
  IF round(p_wht_amount, 2) >= v_room THEN
    RAISE EXCEPTION 'Withholding % would leave nothing to pay — the payment is %', round(p_wht_amount, 2), v_room;
  END IF;

  UPDATE expenses
     SET verify_wht = true, wht_amount = round(p_wht_amount, 2),
         wht_handling_method = COALESCE(p_method, 'Withheld & Remitted')
   WHERE id = p_expense_id;
  RETURN round(p_wht_amount, 2);
END;
$$;

COMMENT ON FUNCTION public.set_expense_withholding(uuid, boolean, numeric, text) IS
  'Marks whether withholding is deducted from a payment, setting verify_wht and wht_amount together. Only before the payment is sent — after that the wire has left for a fixed amount.';

REVOKE ALL ON FUNCTION public.set_expense_withholding(uuid, boolean, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_expense_withholding(uuid, boolean, numeric, text) TO authenticated;

-- ── Reclassify what already posted wrong ─────────────────────────────────────
--
-- One adjusting entry per paid expense whose withholding was booked as cash:
-- Dr the same cash account its payment entry credited / Cr 2025. Dated with
-- that payment entry, so it lands in the same period. Its own source_table
-- keeps it out of the posting trigger's per-expense entry count.

DO $$
DECLARE
  r record;
  v_wht_account uuid := (SELECT id FROM chart_of_accounts WHERE account_code = '2025');
  v_entry uuid;
BEGIN
  FOR r IN
    SELECT e.id, e.expense_code, e.wht_amount, cash.account_id AS cash_account, cash.entry_date
    FROM expenses e
    CROSS JOIN LATERAL (
      SELECT jl.account_id, je.entry_date
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
      JOIN chart_of_accounts c ON c.id = jl.account_id
      WHERE je.source_table = 'expenses' AND je.source_id = e.id
        AND c.cash_flow_section = 'cash' AND jl.credit > 0
      ORDER BY je.created_at LIMIT 1
    ) cash
    WHERE e.payment_state = 'paid' AND COALESCE(e.wht_amount, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.source_table = 'expense_wht_reclass' AND x.source_id = e.id)
      -- only where the cash credit really was the gross
      AND (SELECT sum(jl.credit) FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id
             JOIN chart_of_accounts c ON c.id = jl.account_id
            WHERE je.source_table = 'expenses' AND je.source_id = e.id AND c.cash_flow_section = 'cash')
          = COALESCE(e.amount_etb, 0) - COALESCE(e.credit_applied_etb, 0)
  LOOP
    INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
    VALUES (r.entry_date, 'adjusting', 'expense_wht_reclass', r.id,
            'Withholding reclassified from cash to WHT Payable: ' || COALESCE(r.expense_code, r.id::text))
    RETURNING id INTO v_entry;
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry, r.cash_account, r.wht_amount, 0, 'Withholding was booked as paid out, but only the net left the bank'),
      (v_entry, v_wht_account, 0, r.wht_amount, 'Withholding tax owed to the tax authority');
  END LOOP;
END $$;
