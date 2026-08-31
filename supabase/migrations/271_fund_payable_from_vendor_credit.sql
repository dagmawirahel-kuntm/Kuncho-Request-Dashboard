-- 271 — Let a vendor credit fund a payable that has not been wired yet
--
-- Reported: a new pay-in-advance purchase from Abduselam (PO-2026-0115,
-- 54,665.04) could not have the vendor's 6,173.94 credit applied to it.
--
-- The cause is that the whole apply-credit path is pinned to
-- payment_state = 'advance', which in this system means the advance has
-- ALREADY been wired:
--
--   · the picker lists targets from v_open_vendor_advances, which filters
--     payment_state = 'advance' — so an approved-but-unpaid PO never
--     appears, which is literally why it could not be selected;
--   · apply_vendor_credit() raises unless the target is in that state.
--
-- So the one moment when a credit is most obviously useful — the payment
-- is approved, nothing has left the bank, and we could simply send less
-- money — is the moment the feature refuses.
--
-- ── Why this is not just a widened WHERE clause ──────────────────────────────
--
-- apply_vendor_credit() works by reducing expenses.amount_etb. That is
-- right for its own job (an agreed discount on an advance already paid)
-- and wrong here. Discounting PO-2026-0115 to 48,491.10 would mean:
-- wire 48,491.10, receive goods worth 54,665.04, and close the advance
-- Dr Electrical 48,491.10 / Cr 1080 48,491.10 — leaving the 6,173.94
-- stranded in Vendor Advances permanently and understating the materials
-- cost by the same amount.
--
-- The credit is not a price reduction. It is money of ours already
-- sitting with the vendor, recorded as a debit in Vendor Advances (1080)
-- from the PO-2026-0082 overpayment. It should FUND part of the advance:
--
--   purchase stays          54,665.04
--   cash actually wired     48,491.10   -> Dr 1080 / Cr Bank
--   funded from credit       6,173.94   -> already in 1080, no new entry
--   advance closes          54,665.04   -> Dr Electrical / Cr 1080
--   1080 for this vendor            0   -> credit fully consumed
--
-- Same distinction drawn for PO-2026-0102 in migration 269: a credit is a
-- means of payment, not a discount. 269 settled a delivered payable in
-- full; this handles the part-funded, not-yet-paid case it deferred.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS credit_applied_etb numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN expenses.credit_applied_etb IS
  'Portion of this payable funded from a vendor credit rather than cash. Deliberately does not reduce amount_etb — the purchase still cost what it cost. Cash to send = amount_etb - wht_amount - credit_applied_etb.';

-- ── Applying the credit ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fund_payable_from_vendor_credit(
  p_vendor_credit_id uuid,
  p_expense_id       uuid,
  p_amount_etb       numeric DEFAULT NULL,   -- NULL = as much as both sides allow
  p_notes            text    DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_credit    vendor_credits%ROWTYPE;
  v_exp       expenses%ROWTYPE;
  v_applied   numeric;
  v_remaining numeric;
  v_already   numeric;
  v_max       numeric;
  v_amount    numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can apply a vendor credit';
  END IF;

  SELECT * INTO v_credit FROM vendor_credits WHERE id = p_vendor_credit_id;
  IF v_credit.id IS NULL THEN RAISE EXCEPTION 'Vendor credit not found'; END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id;
  IF v_exp.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;

  IF v_exp.vendor_id IS DISTINCT FROM v_credit.vendor_id THEN
    RAISE EXCEPTION 'This credit belongs to a different vendor than the payable';
  END IF;

  -- Only money that has not moved yet. Once the payment is sent or an
  -- advance is wired there is a ledger entry against it, and reducing the
  -- cash after the fact would contradict it — those cases belong to
  -- settle_expense_with_vendor_credit() or a reversal.
  IF v_exp.payment_state NOT IN ('unpaid', 'approved_to_pay') THEN
    RAISE EXCEPTION
      'Expense % is %; a credit can only fund a payable that has not been paid out yet. Use settle_expense_with_vendor_credit() for a delivered payable, or apply_vendor_credit() to discount an already-wired advance.',
      COALESCE(v_exp.expense_code, v_exp.id::text), v_exp.payment_state;
  END IF;

  SELECT COALESCE(SUM(amount_etb), 0) INTO v_applied
  FROM vendor_credit_applications WHERE vendor_credit_id = p_vendor_credit_id;
  v_remaining := v_credit.amount_etb - v_applied;

  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'This credit is fully used';
  END IF;

  v_already := COALESCE(v_exp.credit_applied_etb, 0);
  -- Never let credit exceed what is actually payable in cash: WHT is
  -- withheld, not paid to the vendor, so it cannot be settled by a credit.
  v_max := COALESCE(v_exp.amount_etb, 0) - COALESCE(v_exp.wht_amount, 0) - v_already;

  IF v_max <= 0 THEN
    RAISE EXCEPTION 'Expense % already has its full payable amount covered by credit',
      COALESCE(v_exp.expense_code, v_exp.id::text);
  END IF;

  v_amount := COALESCE(p_amount_etb, LEAST(v_remaining, v_max));

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Amount to apply must be positive';
  END IF;
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'Only % ETB remains on this credit (requested %)', v_remaining, v_amount;
  END IF;
  IF v_amount > v_max THEN
    RAISE EXCEPTION 'Only % ETB of % is still payable in cash (requested %)',
      v_max, COALESCE(v_exp.expense_code, v_exp.id::text), v_amount;
  END IF;

  INSERT INTO vendor_credit_applications (vendor_credit_id, applied_to_expense_id, amount_etb, applied_by, notes)
  VALUES (p_vendor_credit_id, p_expense_id, v_amount, auth.uid(),
          COALESCE(p_notes, 'Funded from vendor credit — reduces the cash to be sent, not the purchase cost'));

  UPDATE expenses
     SET credit_applied_etb = COALESCE(credit_applied_etb, 0) + v_amount
   WHERE id = p_expense_id;

  RETURN format('Applied %s ETB of credit to %s — purchase stays %s, cash to send is now %s; %s ETB of credit left',
    v_amount, COALESCE(v_exp.expense_code, v_exp.id::text), v_exp.amount_etb,
    COALESCE(v_exp.amount_etb,0) - COALESCE(v_exp.wht_amount,0) - v_already - v_amount,
    v_remaining - v_amount);
END $function$;

COMMENT ON FUNCTION public.fund_payable_from_vendor_credit IS
  'Applies a vendor credit to an approved-but-unpaid payable, reducing the cash to be sent while leaving amount_etb (the real cost) intact. Partial application is supported. For an already-wired advance use apply_vendor_credit(); for a delivered payable settled outright use settle_expense_with_vendor_credit().';

-- ── The ledger has to send less cash too ─────────────────────────────────────
--
-- Both money-out branches previously credited the bank for the whole
-- amount_etb. With part of the payable funded by credit that would
-- report more leaving the bank than actually did.
--
--   advance : Dr 1080 / Cr Bank, for the CASH portion only. The credit
--             portion is already a debit in 1080 from the earlier
--             overpayment, so re-posting it would double it.
--   paid    : Dr expense (full cost), Cr Bank (cash), Cr 1080 (credit) —
--             a three-line entry that consumes the credit as it pays.
--
-- The advance-close branch is untouched: it debits the expense and
-- credits 1080 for the full amount, which is exactly what clears both
-- the cash advance and the credit portion sitting in that account.

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

    IF NEW.payment_state = 'advance' THEN
      IF v_advance_account_id IS NULL OR NEW.amount_etb IS NULL
         OR (v_cash > 0 AND v_cash_account_id IS NULL) THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post advance: advance account %s, account_id=%s -> cash account %s, amount_etb=%s',
          v_advance_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      -- Wholly credit-funded: the money is already in Vendor Advances,
      -- nothing moves, so there is nothing to post.
      IF v_cash > 0 THEN
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
        VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Vendor advance recorded: ' || COALESCE(NEW.expense_code, NEW.id::text))
        RETURNING id INTO v_entry_id;

        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_advance_account_id, v_cash, 0,
           'Advance — goods not yet received: ' || COALESCE(NEW.item_service_description, '')
             || CASE WHEN v_credit > 0 THEN format(' (%s funded from vendor credit)', v_credit) ELSE '' END),
          (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));
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
          (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));
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

-- ── What the picker should offer ─────────────────────────────────────────────
--
-- v_open_vendor_advances stays as it is — apply_vendor_credit() still
-- needs exactly that list. This is the companion for the not-yet-paid
-- side, which had no list at all.

CREATE OR REPLACE VIEW public.v_credit_applicable_payables
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.wht_amount,
  COALESCE(e.credit_applied_etb, 0) AS credit_applied_etb,
  COALESCE(e.amount_etb, 0) - COALESCE(e.wht_amount, 0) - COALESCE(e.credit_applied_etb, 0) AS cash_payable,
  e.vendor_id,
  v.vendor_name,
  e.payment_state,
  e.sourcing_bundle_id,
  sb.bundle_code,
  sb.payment_pattern,
  e.date
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
WHERE e.payment_state IN ('unpaid', 'approved_to_pay')
  AND e.vendor_id IS NOT NULL
  AND COALESCE(e.amount_etb, 0) - COALESCE(e.wht_amount, 0) - COALESCE(e.credit_applied_etb, 0) > 0
ORDER BY e.date DESC;

COMMENT ON VIEW public.v_credit_applicable_payables IS
  'Approved-but-unpaid payables a vendor credit can still fund. cash_payable is what would actually be wired after WHT and any credit already applied.';

GRANT SELECT ON public.v_credit_applicable_payables TO authenticated;
