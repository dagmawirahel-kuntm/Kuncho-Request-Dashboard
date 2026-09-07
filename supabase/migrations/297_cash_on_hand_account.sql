-- 297 — Give cash payments somewhere to post
--
-- 44 paid expenses totalling 976,355.40 ETB have no journal entry at
-- all. Every one is payment_method = 'cash' with account_id NULL, and
-- they all fail the same way:
--
--   Cannot post: category_id=… -> expense account …, account_id= ->
--   cash account , amount_etb=…
--
-- The expense account resolves fine in every case. What cannot resolve
-- is the credit side. post_expense_payment_to_ledger() finds the cash
-- account via chart_of_accounts.linked_account_id = expenses.account_id,
-- and a cash payment has no bank account to name — correctly, because no
-- bank was involved. So account_id is NULL, the lookup returns nothing,
-- and the posting is abandoned.
--
-- There is also nowhere for it to go even in principle: every 11xxx
-- account is "Cash at Bank — <bank>" bound to a real bank row, and the
-- only cash-sounding account, 51038 PETTY, is an Expense, so it cannot
-- carry a cash balance. This is a gap in the chart, not bad data entry.
--
-- ── What this adds ───────────────────────────────────────────────────────────
--
-- 11000 Cash on Hand — an asset, postable, no linked bank row, coded
-- below 11001 so it sorts ahead of the bank accounts the way a chart of
-- accounts conventionally reads. Classified as 'cash' for the cash flow
-- statement (296), so cash spending starts appearing there.
--
-- The posting trigger now falls back to it, but only when the normal
-- lookup finds nothing AND the payment was made in cash. An expense that
-- names an account still posts to that account — the fallback fills a
-- gap, it never overrides an explicit choice.
--
-- ── A consequence worth stating plainly ──────────────────────────────────────
--
-- Cash payments credit Cash on Hand. Nothing yet debits it, because
-- drawing cash from the bank is not recorded anywhere — there is no
-- withdrawal step in the system. So once the stuck postings are retried
-- this account will sit at roughly -976,355.40: a credit balance on an
-- asset account.
--
-- That is deliberate and it is an improvement. Today the money is
-- invisible: the P&L is understated by the full amount and nothing
-- anywhere says so. Afterwards the expense is recorded correctly and the
-- negative balance quantifies exactly how much cash left the business
-- without a matching withdrawal from a bank account. It reads as a
-- standing question on the trial balance rather than silence, and it
-- closes when withdrawals start being recorded as
-- Dr Cash on Hand / Cr Bank.
--
-- This migration does not retry the stuck postings. It makes them
-- possible; replaying 976k into the P&L is a separate, deliberate step.

INSERT INTO chart_of_accounts
  (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section)
SELECT '11000', 'Cash on Hand', 'Asset',
       (SELECT parent_account_id FROM chart_of_accounts WHERE account_code = '11013'),
       true, true, 'cash'
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '11000');

COMMENT ON TABLE chart_of_accounts IS
  'General ledger accounts. 11000 Cash on Hand is the credit side for cash payments — it has no linked bank row on purpose, and the posting trigger falls back to it only when a cash payment names no account.';

-- ── The posting trigger ──────────────────────────────────────────────────────
--
-- Only the cash-account resolution changes. Everything else — the
-- advance/close/paid branches, the GRN category resolution, the
-- vendor-credit split from 277 — is carried through unchanged.

CREATE OR REPLACE FUNCTION public.post_expense_payment_to_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy UUID;
  v_row_fy     UUID;
  v_effective_category_id UUID;
  v_expense_account_id UUID;
  v_cash_account_id    UUID;
  v_advance_account_id UUID;
  v_entry_id   UUID;
  v_is_advance_close BOOLEAN;
  v_existing_count INT;
  v_credit     NUMERIC;
  v_cash       NUMERIC;
  v_cash_label TEXT;
BEGIN
  v_is_advance_close := (TG_OP = 'UPDATE' AND OLD.payment_state = 'advance' AND NEW.payment_state = 'paid');

  IF NEW.payment_state NOT IN ('paid', 'advance') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_existing_count FROM journal_entries WHERE source_table = 'expenses' AND source_id = NEW.id;

  IF NEW.payment_state = 'advance' AND v_existing_count > 0 THEN RETURN NEW; END IF;
  IF NEW.payment_state = 'paid' AND v_is_advance_close AND v_existing_count <> 1 THEN RETURN NEW; END IF;
  IF NEW.payment_state = 'paid' AND NOT v_is_advance_close AND v_existing_count > 0 THEN RETURN NEW; END IF;

  v_effective_category_id := NEW.category_id;
  IF NEW.expense_type = 'purchase_order' THEN
    v_effective_category_id := COALESCE(resolve_po_posting_category(NEW.sourcing_bundle_id), NEW.category_id);
  END IF;

  v_credit := COALESCE(NEW.credit_applied_etb, 0);
  v_cash   := COALESCE(NEW.amount_etb, 0) - v_credit;

  BEGIN
    SELECT coa.id INTO v_expense_account_id FROM chart_of_accounts coa WHERE coa.category_id = v_effective_category_id;
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;
    SELECT id INTO v_advance_account_id FROM chart_of_accounts WHERE account_code = '1080';

    -- Cash paid out of hand names no bank account, so there is nothing to
    -- resolve above. Fall back to Cash on Hand — but only when the
    -- payment really was cash, so an expense that names an account is
    -- never quietly redirected.
    IF v_cash_account_id IS NULL AND NEW.payment_method = 'cash' THEN
      SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE account_code = '11000';
    END IF;

    v_cash_label := COALESCE(
      (SELECT account_name FROM accounts WHERE id = NEW.account_id),
      (SELECT account_name FROM chart_of_accounts WHERE id = v_cash_account_id)
    );

    IF NEW.payment_state = 'advance' THEN
      IF v_advance_account_id IS NULL OR NEW.amount_etb IS NULL
         OR (v_cash > 0 AND v_cash_account_id IS NULL) THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post advance: advance account %s, account_id=%s -> cash account %s, amount_etb=%s',
          v_advance_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      IF v_cash > 0 THEN
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
        VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Vendor advance recorded: ' || COALESCE(NEW.expense_code, NEW.id::text))
        RETURNING id INTO v_entry_id;

        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_advance_account_id, v_cash, 0,
           'Advance — goods not yet received: ' || COALESCE(NEW.item_service_description, '')
             || CASE WHEN v_credit > 0 THEN format(' (%s funded from vendor credit)', v_credit) ELSE '' END),
          (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via ' || COALESCE(v_cash_label, 'cash'));
      END IF;

    ELSIF v_is_advance_close THEN
      IF v_expense_account_id IS NULL OR v_advance_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot close advance: category_id=%s -> expense account %s, advance account %s, amount_etb=%s',
          v_effective_category_id, v_expense_account_id, v_advance_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Vendor advance closed (GRN received): ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description),
        (v_entry_id, v_advance_account_id, 0, NEW.amount_etb, 'Advance closed — goods received');

    ELSE
      IF v_expense_account_id IS NULL OR NEW.amount_etb IS NULL
         OR (v_cash > 0 AND v_cash_account_id IS NULL)
         OR (v_credit > 0 AND v_advance_account_id IS NULL) THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post: category_id=%s -> expense account %s, account_id=%s -> cash account %s, amount_etb=%s',
          v_effective_category_id, v_expense_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Expense paid: ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description);

      IF v_cash > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via ' || COALESCE(v_cash_label, 'cash'));
      END IF;
      IF v_credit > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_advance_account_id, 0, v_credit, 'Funded from vendor credit held in Vendor Advances');
      END IF;
    END IF;

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('expenses', NEW.id, SQLERRM);
  END;

  RETURN NEW;
END;
$function$;

-- ── The retry helper has to agree with the trigger ───────────────────────────
--
-- retry_expense_ledger_posting() refuses outright when account_id is
-- NULL. That was right when a NULL account meant the posting could not
-- resolve; it is now wrong for a cash payment, which resolves via the
-- fallback. Left as-is it would report "Still no payment account set" for
-- exactly the 44 rows this migration exists to unblock.

CREATE OR REPLACE FUNCTION public.retry_expense_ledger_posting(p_expense_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expense expenses%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can retry a ledger posting';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF v_expense.id IS NULL THEN
    RETURN 'Expense no longer exists';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    RETURN 'Already posted';
  END IF;

  IF v_expense.payment_state IS DISTINCT FROM 'paid' THEN
    RETURN 'Not paid — nothing to post';
  END IF;

  IF v_expense.category_id IS NULL
     AND COALESCE(resolve_po_posting_category(v_expense.sourcing_bundle_id), NULL) IS NULL THEN
    RETURN 'Still no general ledger set on this expense';
  END IF;

  -- A cash payment posts against Cash on Hand and needs no account_id.
  IF v_expense.account_id IS NULL AND v_expense.payment_method IS DISTINCT FROM 'cash' THEN
    RETURN 'Still no payment account set on this expense';
  END IF;

  -- Re-enter the trigger: setting payment_state to itself is not a
  -- DISTINCT change, so drop out of 'paid' and back within the same
  -- transaction. No other session observes the intermediate state.
  UPDATE expenses SET payment_state = 'sent' WHERE id = p_expense_id;
  UPDATE expenses SET payment_state = 'paid' WHERE id = p_expense_id;
  UPDATE expenses SET payment_state_changed_at = v_expense.payment_state_changed_at
  WHERE id = p_expense_id;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    UPDATE ledger_posting_failures
    SET resolved = TRUE, resolved_at = NOW(), resolved_by = auth.uid()
    WHERE source_table = 'expenses' AND source_id = p_expense_id AND NOT resolved;
    RETURN 'Posted';
  END IF;

  RETURN 'Still could not post — see the newest failure message for this expense';
END;
$function$;

COMMENT ON FUNCTION public.retry_expense_ledger_posting IS
  'Replays a failed expense posting by re-entering the trigger. Accepts a cash payment with no account_id, which posts against Cash on Hand (11000) — matching the trigger''s own fallback.';
