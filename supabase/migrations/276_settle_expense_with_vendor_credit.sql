-- 276 — Settle a payable out of a vendor credit
--
-- apply_vendor_credit() (migration 260) was deliberately built for one
-- job: knocking an agreed discount off an *open advance*, before the
-- goods land. It refuses anything else — the target must be in
-- payment_state 'advance', and it will not let the applied amount reach
-- the target's full value, because zeroing an advance that way would
-- destroy the cost record rather than discount it.
--
-- That is not this. PO-2026-0102 is a delivered, finance-approved
-- payable that is being settled *using* the credit balance the vendor
-- already holds. The credit is the means of payment, not a price
-- reduction, and the distinction matters in the ledger:
--
--   · Discounting would reduce expenses.amount_etb, understating what
--     the electrical materials actually cost.
--   · Settling leaves the cost at its true figure and records that no
--     cash moved, because the money left the bank weeks ago.
--
-- The second reading is the correct one, and it happens to have an
-- exact ledger shape already in the system. A vendor credit here is not
-- an abstraction — it is a real debit balance sitting in Vendor
-- Advances (1080). On PO-2026-0082 we wired 551,869.46 and closed the
-- advance at the discounted true cost of 488,478.14, leaving 63,391.32
-- of company money parked with the vendor. Spending that balance is the
-- same entry as closing an advance:
--
--   Dr  <expense account, resolved the usual way>   57,217.38
--     Cr  Vendor Advances (1080)                      57,217.38
--
-- After which 1080 holds 6,173.94 for this vendor, matching what the
-- credit says remains. The subsidiary record and the general ledger
-- agree without anyone reconciling them by hand.
--
-- The posting is done here rather than left to
-- post_expense_payment_to_ledger(), because that trigger's 'paid'
-- branch credits a *cash* account and would report money leaving the
-- bank that never did. Writing the entry first also disarms the
-- trigger: it skips any expense that already has a journal entry, so
-- there is no double post. That coupling is load-bearing, hence the
-- explicit re-check below rather than a silent assumption.

-- ── A truthful payment method ────────────────────────────────────────────────
--
-- 'other' would have fit the CHECK, but every downstream reader — the
-- payment lifecycle, the Payment Request document, the payments
-- dashboard — would then describe a credit settlement as an unspecified
-- payment. Naming it costs one constraint and makes the record explain
-- itself.

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_payment_method_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_payment_method_check
  CHECK (payment_method IS NULL OR payment_method = ANY (ARRAY[
    'transfer', 'batch_wire', 'cpo', 'cheque', 'cash', 'vrf', 'vendor_credit', 'other'
  ]));

-- ── Settlement ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.settle_expense_with_vendor_credit(
  p_vendor_credit_id uuid,
  p_expense_id       uuid,
  p_disbursed_by     uuid,
  p_notes            text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_credit        vendor_credits%ROWTYPE;
  v_exp           expenses%ROWTYPE;
  v_applied       numeric;
  v_remaining     numeric;
  v_amount        numeric;
  v_category_id   uuid;
  v_expense_acct  uuid;
  v_advance_acct  uuid;
  v_entry_id      uuid;
  v_existing      int;
  v_in_current_fy boolean;
  v_posted        text := 'not posted (expense falls outside the current fiscal year)';
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can settle an expense from a vendor credit';
  END IF;

  SELECT * INTO v_credit FROM vendor_credits WHERE id = p_vendor_credit_id;
  IF v_credit.id IS NULL THEN
    RAISE EXCEPTION 'Vendor credit not found';
  END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id;
  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF v_exp.vendor_id IS DISTINCT FROM v_credit.vendor_id THEN
    RAISE EXCEPTION 'This credit belongs to a different vendor than the expense being settled';
  END IF;

  IF v_exp.payment_state IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Expense % is already %', COALESCE(v_exp.expense_code, v_exp.id::text), v_exp.payment_state;
  END IF;

  -- An open advance is apply_vendor_credit()'s territory: there the
  -- credit is a discount on a payment not yet consumed, and reducing the
  -- advance is the right move. Sending it here instead would post a cost
  -- that the advance close is going to post again.
  IF v_exp.payment_state = 'advance' THEN
    RAISE EXCEPTION 'Expense % is an open advance — use apply_vendor_credit() to discount it, not this',
      COALESCE(v_exp.expense_code, v_exp.id::text);
  END IF;

  v_amount := v_exp.amount_etb;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Expense % has no positive amount to settle', COALESCE(v_exp.expense_code, v_exp.id::text);
  END IF;

  SELECT COALESCE(SUM(amount_etb), 0) INTO v_applied
  FROM vendor_credit_applications WHERE vendor_credit_id = p_vendor_credit_id;
  v_remaining := v_credit.amount_etb - v_applied;

  -- Partial settlement is deliberately not supported. Splitting a
  -- payable across a credit and a bank payment needs a part-paid state
  -- and a second posting, and guessing at that here would produce a
  -- half-settled expense nobody can reconcile. Fail plainly instead.
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'Credit has only % ETB remaining — not enough to settle % (% ETB). Partial settlement from a credit is not supported.',
      v_remaining, COALESCE(v_exp.expense_code, v_exp.id::text), v_amount;
  END IF;

  IF p_disbursed_by IS NULL THEN
    RAISE EXCEPTION 'A payer identity (disbursed_by) is required';
  END IF;
  IF p_disbursed_by = v_exp.finance_approved_by THEN
    RAISE EXCEPTION 'The same person cannot both approve and settle an expense';
  END IF;

  -- ── Ledger ────────────────────────────────────────────────────────────────
  --
  -- Same account resolution the normal posting path uses, so a credit
  -- settlement lands in the same GL account the expense would have hit
  -- had it been paid by bank — including the GRN-line category
  -- resolution for purchase orders.
  v_category_id := v_exp.category_id;
  IF v_exp.expense_type = 'purchase_order' THEN
    v_category_id := COALESCE(resolve_po_posting_category(v_exp.sourcing_bundle_id), v_exp.category_id);
  END IF;

  SELECT id INTO v_expense_acct FROM chart_of_accounts WHERE category_id = v_category_id;
  SELECT id INTO v_advance_acct FROM chart_of_accounts WHERE account_code = '1080';

  SELECT count(*) INTO v_existing FROM journal_entries
   WHERE source_table = 'expenses' AND source_id = v_exp.id;
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Expense % already has ledger entries — settle it manually rather than posting twice',
      COALESCE(v_exp.expense_code, v_exp.id::text);
  END IF;

  v_in_current_fy := (fiscal_period_for_date(v_exp.date) IS NOT DISTINCT FROM
                      (SELECT id FROM fiscal_periods WHERE is_current));

  IF v_in_current_fy THEN
    IF v_expense_acct IS NULL OR v_advance_acct IS NULL THEN
      -- Consistent with post_expense_payment_to_ledger: record why it
      -- could not post rather than blocking the settlement, so the row
      -- shows up in the posting-failures queue like any other.
      PERFORM log_posting_failure('expenses', v_exp.id, format(
        'Cannot settle from vendor credit: category %s -> expense account %s, advance account %s',
        v_category_id, v_expense_acct, v_advance_acct));
      v_posted := 'NOT posted — logged to ledger_posting_failures';
    ELSE
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (v_exp.date, 'operational', 'expenses', v_exp.id,
              'Settled from vendor credit: ' || COALESCE(v_exp.expense_code, v_exp.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_expense_acct, v_amount, 0, v_exp.item_service_description),
        (v_entry_id, v_advance_acct, 0, v_amount,
         'Settled against vendor credit balance held in Vendor Advances — no cash movement');

      SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
      SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
      v_posted := format('posted Dr %s / Cr 1080', (SELECT account_code FROM chart_of_accounts WHERE id = v_expense_acct));
    END IF;
  END IF;

  INSERT INTO vendor_credit_applications (vendor_credit_id, applied_to_expense_id, amount_etb, applied_by, notes)
  VALUES (p_vendor_credit_id, p_expense_id, v_amount, auth.uid(),
          COALESCE(p_notes, 'Settled in full from vendor credit — no cash movement'));

  -- account_id stays NULL on purpose: no bank account funded this, and
  -- naming one would put the settlement in that account's cash position.
  UPDATE expenses
     SET payment_state  = 'paid',
         payment_method = 'vendor_credit',
         disbursed_by   = p_disbursed_by,
         paid_date      = COALESCE(paid_date, CURRENT_DATE)
   WHERE id = p_expense_id;

  RETURN format('Settled %s (%s ETB) from credit %s — %s ETB remaining; ledger %s',
    COALESCE(v_exp.expense_code, v_exp.id::text), v_amount,
    COALESCE(v_credit.reason, v_credit.id::text), v_remaining - v_amount, v_posted);
END $function$;

COMMENT ON FUNCTION public.settle_expense_with_vendor_credit IS
  'Settles a delivered, finance-approved payable in full out of a vendor credit. Posts Dr expense / Cr Vendor Advances (1080) — the credit is a real debit balance there, so no cash moves — then marks the expense paid with payment_method vendor_credit. Distinct from apply_vendor_credit(), which discounts an open advance instead.';
