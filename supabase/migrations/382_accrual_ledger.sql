-- 382 — The books on accrual: bills, invoices, VAT, advances, floats, assets
--
-- Until now an expense reached the ledger only when it was paid, and a sale
-- only when the money came in. What was owed either way was nowhere in the
-- books. From here:
--
--   Bill approved by finance   Dr its cost account        Cr 2010 Accounts payable (the vendor)
--                              (labour: Cr 2015 Wages payable — the worker or crew leader)
--   Bill paid                  Dr 2010 / 2015             Cr the bank or cash box (or the staff
--                                                          member's cash advance it was spent from)
--                                                         Cr 2025 WHT withheld · Cr 1080 vendor credit
--   Sale invoiced              Dr 1050 Receivable (client) Cr 4010 Sales (net) · Cr 2040 VAT payable
--   Sale paid                  Dr the bank · Dr 1090 WHT the client withheld   Cr 1050
--   Receipt passes tax review  Dr 1410 Input VAT          Cr the cost account it came out of
--   Cash advance approved      Dr 1210 Staff advances     Cr the bank it came from
--   Petty cash float / top-up  Dr 1150 Float (custodian)  Cr 11000 Cash on hand
--   Petty cash spent           Dr 6208 Petty cash expenses Cr 1150
--   Asset bought on a bill     Dr 1610 PPE                Cr the cost account the bill went to
--   Depreciation (month end)   Dr 6900                    Cr 1690
--
-- ── How it stays right ───────────────────────────────────────────────────────
--
-- ledger_sync(source, id, …, lines) is told what the ledger should hold for
-- one record and posts only the difference from what it holds now. Approve
-- a bill and it is posted; change its amount, vendor or category and the
-- difference is posted; reject or archive it and it is reversed. Nothing is
-- deleted or edited — every change is an entry of its own.
--
-- Records the ledger already holds the old way (paid before today, or
-- advanced to a vendor before approval) stay on the old path; so does
-- anything dated in an earlier fiscal year (the opening balances, 383, carry
-- those). Sales already posted straight to revenue get their VAT moved to
-- 2040 instead.
--
-- A problem never blocks the work: it is logged to ledger_posting_failures
-- as before.

SET search_path TO public;

-- ── 1. Post the difference ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_sync(
  p_source_table text, p_source_id uuid, p_date date, p_description text, p_lines jsonb,
  p_entry_type text DEFAULT 'operational')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_entry uuid;
  v_had   boolean;
  r       record;
BEGIN
  v_had := EXISTS (SELECT 1 FROM journal_entries WHERE source_table = p_source_table AND source_id = p_source_id);
  FOR r IN
    WITH want AS (
      SELECT (x->>'account')::uuid AS account_id, NULLIF(x->>'party_type', '') AS party_type,
             NULLIF(x->>'party_id', '')::uuid AS party_id, NULLIF(x->>'project_id', '')::uuid AS project_id,
             round(COALESCE((x->>'amount')::numeric, 0), 2) AS amount, x->>'notes' AS notes, ord
        FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t(x, ord)
    ), w AS (
      SELECT account_id, party_type, party_id, project_id, sum(amount) AS amount,
             (array_agg(notes ORDER BY ord))[1] AS notes, min(ord) AS ord
        FROM want GROUP BY 1, 2, 3, 4
    ), h AS (
      SELECT l.account_id, l.party_type, l.party_id, l.project_id, sum(l.debit - l.credit) AS amount
        FROM journal_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
       WHERE je.source_table = p_source_table AND je.source_id = p_source_id
       GROUP BY 1, 2, 3, 4
    )
    SELECT COALESCE(w.account_id, h.account_id) AS account_id,
           COALESCE(w.party_type, h.party_type) AS party_type,
           COALESCE(w.party_id, h.party_id) AS party_id,
           COALESCE(w.project_id, h.project_id) AS project_id,
           COALESCE(w.amount, 0) - COALESCE(h.amount, 0) AS delta,
           w.notes, COALESCE(w.ord, 999) AS ord
      FROM w FULL JOIN h
        ON h.account_id = w.account_id
       AND h.party_type IS NOT DISTINCT FROM w.party_type
       AND h.party_id   IS NOT DISTINCT FROM w.party_id
       AND h.project_id IS NOT DISTINCT FROM w.project_id
     ORDER BY 7
  LOOP
    IF abs(r.delta) < 0.005 THEN CONTINUE; END IF;
    IF v_entry IS NULL THEN
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (p_date, CASE WHEN v_had THEN 'adjusting' ELSE p_entry_type END, p_source_table, p_source_id,
              CASE WHEN v_had THEN 'Changed — ' ELSE '' END || p_description)
      RETURNING id INTO v_entry;
    END IF;
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes, party_type, party_id, project_id)
    VALUES (v_entry, r.account_id, GREATEST(r.delta, 0), GREATEST(-r.delta, 0),
            COALESCE(r.notes, 'Reversed'), r.party_type, r.party_id, r.project_id);
  END LOOP;
  IF v_entry IS NOT NULL THEN
    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  END IF;
  RETURN v_entry;
END $function$;
REVOKE EXECUTE ON FUNCTION ledger_sync(text, uuid, date, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- One line, the way ledger_sync wants it; the party only on a control account.
CREATE OR REPLACE FUNCTION public.ledger_line(p_account uuid, p_amount numeric, p_notes text,
  p_project uuid DEFAULT NULL, p_vendor uuid DEFAULT NULL, p_client uuid DEFAULT NULL, p_staff uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('account', p_account, 'amount', p_amount, 'notes', p_notes, 'project_id', p_project,
                            'party_type', p.party_type, 'party_id', p.party_id)
    FROM chart_of_accounts c
    CROSS JOIN LATERAL ledger_party_for(c.party_kinds, p_vendor, p_client, p_staff) p
   WHERE c.id = p_account
$$;

CREATE OR REPLACE FUNCTION public.in_current_fy(p_date date)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT p_date IS NOT NULL AND fiscal_period_for_date(p_date) IS NOT DISTINCT FROM (SELECT id FROM fiscal_periods WHERE is_current)
$$;

-- ── 2. Bills ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expense_cost_account(p_expense uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT c.id FROM expenses e
    JOIN chart_of_accounts c ON c.category_id = CASE WHEN e.expense_type = 'purchase_order'
                                                     THEN COALESCE(resolve_po_posting_category(e.sourcing_bundle_id), e.category_id)
                                                     ELSE e.category_id END
   WHERE e.id = p_expense
$$;

CREATE OR REPLACE FUNCTION public.expense_payable_account(p_type expense_category)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p_type = 'labor_payment' THEN coa_id('wages_payable') ELSE coa_id('ap') END
$$;

CREATE OR REPLACE FUNCTION public.sync_expense_accrual(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  e        expenses%ROWTYPE;
  v_lines  jsonb := '[]'::jsonb;
  v_cost   uuid;
  v_pay    uuid;
  v_accrued boolean;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_id;
  v_accrued := EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = p_id);
  -- Already in the ledger the old way (paid, or advanced before approval): leave it there.
  IF NOT v_accrued AND EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_id) THEN
    RETURN;
  END IF;

  IF e.id IS NOT NULL
     AND e.approval_status::text = 'finance_approved'
     AND NOT COALESCE(e.is_archived, false)
     AND COALESCE(e.payment_state, '') <> 'void'
     AND e.expense_type IS DISTINCT FROM 'vrf' AND e.vendor_receipt_facilitation_id IS NULL
     AND COALESCE(e.amount_etb, 0) > 0
     AND in_current_fy(e.date)
     AND (v_accrued OR COALESCE(e.payment_state, '') <> 'advance')
  THEN
    v_cost := expense_cost_account(p_id);
    v_pay  := expense_payable_account(e.expense_type);
    IF v_cost IS NULL THEN
      PERFORM log_posting_failure('expenses', p_id, format('Cannot record the bill: its General Ledger (category %s) has no account in the chart', e.category_id));
      RETURN;
    END IF;
    v_lines := jsonb_build_array(
      ledger_line(v_cost, e.amount_etb, e.item_service_description, e.project_id),
      ledger_line(v_pay, -e.amount_etb,
                  'Owed' || COALESCE(' to ' || COALESCE(ledger_party_name('vendor', e.vendor_id), ledger_party_name('staff', e.paid_to_staff_id), e.vendors_name), ''),
                  e.project_id, e.vendor_id, NULL, e.paid_to_staff_id));
  END IF;

  PERFORM ledger_sync('expense_accrual', p_id, COALESCE(e.date, CURRENT_DATE),
                      'Bill approved: ' || COALESCE(e.expense_code, p_id::text), v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('expenses', p_id, 'Recording the bill: ' || SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_ledger_expense_accrual()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM sync_expense_accrual(NEW.id);
  RETURN NULL;
END $function$;

-- Named to run before trg_post_expense_payment_to_ledger (AFTER triggers go
-- in name order), so a bill approved and paid at once is recorded first.
DROP TRIGGER IF EXISTS trg_ledger_expense_accrual ON expenses;
CREATE TRIGGER trg_ledger_expense_accrual AFTER INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_expense_accrual();

-- Paying: a recorded bill clears the payable; anything else posts as before.
CREATE OR REPLACE FUNCTION public.post_expense_payment_to_ledger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy UUID; v_row_fy UUID; v_effective_category_id UUID;
  v_expense_account_id UUID; v_cash_account_id UUID; v_advance_account_id UUID; v_wht_account_id UUID;
  v_entry_id UUID; v_is_advance_close BOOLEAN; v_existing_count INT;
  v_credit NUMERIC; v_wht NUMERIC; v_advance NUMERIC; v_cash NUMERIC; v_cash_label TEXT;
  v_adv_staff UUID; v_pay UUID;
BEGIN
  v_is_advance_close := (TG_OP='UPDATE' AND OLD.payment_state='advance' AND NEW.payment_state='paid');
  IF NEW.payment_state NOT IN ('paid','advance') THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_existing_count FROM journal_entries WHERE source_table='expenses' AND source_id=NEW.id;

  v_credit  := COALESCE(NEW.credit_applied_etb, 0);
  v_wht     := COALESCE(NEW.wht_amount, 0);
  v_advance := COALESCE(NEW.amount_etb, 0) - v_credit;
  v_cash    := v_advance - v_wht;
  v_advance_account_id := coa_id('vendor_advances');
  v_wht_account_id     := coa_id('wht_payable');

  -- Where the money came from: a staff member's cash advance, the bank
  -- account on the expense, or the cash box.
  SELECT ca.staff_id INTO v_adv_staff
    FROM cash_advance_expenses x JOIN cash_advances ca ON ca.id = x.cash_advance_id
   WHERE x.expense_id = NEW.id LIMIT 1;
  IF v_adv_staff IS NOT NULL THEN
    v_cash_account_id := coa_id('staff_advances');
    v_cash_label := 'the cash advance to ' || COALESCE(ledger_party_name('staff', v_adv_staff), 'a staff member');
  ELSE
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;
    IF v_cash_account_id IS NULL AND NEW.payment_method = 'cash' THEN v_cash_account_id := coa_id('cash_on_hand'); END IF;
    v_cash_label := COALESCE((SELECT account_name FROM accounts WHERE id = NEW.account_id), (SELECT account_name FROM chart_of_accounts WHERE id = v_cash_account_id), 'cash');
  END IF;

  -- ── A recorded bill (382): the payment clears what is owed ──
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = NEW.id) THEN
    IF v_existing_count > 0 THEN RETURN NEW; END IF;   -- already paid (or paid in advance)
    BEGIN
      v_pay := expense_payable_account(NEW.expense_type);
      IF v_cash < 0 OR (v_cash > 0 AND v_cash_account_id IS NULL) THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post the payment: %s', CASE WHEN v_cash < 0 THEN format('withholding %s and credit %s exceed the bill %s', v_wht, v_credit, NEW.amount_etb)
                                              ELSE format('no bank or cash account on the expense (account_id=%s)', NEW.account_id) END));
        RETURN NEW;
      END IF;
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (COALESCE(NEW.paid_date, NEW.payment_state_changed_at::date, CURRENT_DATE), 'operational', 'expenses', NEW.id,
              CASE WHEN NEW.payment_state = 'advance' THEN 'Paid ahead of delivery: ' ELSE 'Bill paid: ' END || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_pay, NEW.amount_etb, 0, 'Clears what was owed');
      IF v_cash > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes, party_type, party_id)
        VALUES (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via ' || v_cash_label,
                CASE WHEN v_adv_staff IS NOT NULL THEN 'staff' END, v_adv_staff);
      END IF;
      IF v_wht > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (v_entry_id, v_wht_account_id, 0, v_wht, 'Withholding tax withheld, owed to the tax authority');
      END IF;
      IF v_credit > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (v_entry_id, v_advance_account_id, 0, v_credit, 'Funded from vendor credit held in Vendor Advances');
      END IF;
      SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
      SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
    EXCEPTION WHEN OTHERS THEN
      PERFORM log_posting_failure('expenses', NEW.id, SQLERRM);
    END;
    RETURN NEW;
  END IF;

  -- ── Not recorded as a bill: straight to cost at payment, as before ──
  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN RETURN NEW; END IF;
  IF NEW.payment_state='advance' AND v_existing_count > 0 THEN RETURN NEW; END IF;
  IF NEW.payment_state='paid' AND v_is_advance_close AND v_existing_count <> 1 THEN RETURN NEW; END IF;
  IF NEW.payment_state='paid' AND NOT v_is_advance_close AND v_existing_count > 0 THEN RETURN NEW; END IF;
  v_effective_category_id := NEW.category_id;
  IF NEW.expense_type='purchase_order' THEN
    v_effective_category_id := COALESCE(resolve_po_posting_category(NEW.sourcing_bundle_id), NEW.category_id);
  END IF;
  BEGIN
    SELECT coa.id INTO v_expense_account_id FROM chart_of_accounts coa WHERE coa.category_id=v_effective_category_id;
    IF v_cash < 0 OR (v_wht > 0 AND v_wht_account_id IS NULL) THEN
      PERFORM log_posting_failure('expenses', NEW.id, format('Cannot post: withholding %s exceeds the %s left after credit, or no Withholding Tax Payable account (2025)', v_wht, v_advance));
      RETURN NEW;
    END IF;
    IF NEW.payment_state='advance' THEN
      IF v_advance_account_id IS NULL OR NEW.amount_etb IS NULL OR (v_cash>0 AND v_cash_account_id IS NULL) THEN
        PERFORM log_posting_failure('expenses', NEW.id, format('Cannot post advance: advance account %s, account_id=%s -> cash account %s, amount_etb=%s', v_advance_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;
      IF v_advance > 0 THEN
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
        VALUES (NEW.date,'operational','expenses',NEW.id,'Vendor advance recorded: '||COALESCE(NEW.expense_code,NEW.id::text)) RETURNING id INTO v_entry_id;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry_id, v_advance_account_id, v_advance, 0, 'Advance - goods not yet received: '||COALESCE(NEW.item_service_description,'') || CASE WHEN v_credit>0 THEN format(' (%s funded from vendor credit)', v_credit) ELSE '' END);
        IF v_cash > 0 THEN
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes, party_type, party_id)
          VALUES (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via '||v_cash_label, CASE WHEN v_adv_staff IS NOT NULL THEN 'staff' END, v_adv_staff);
        END IF;
        IF v_wht > 0 THEN
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES (v_entry_id, v_wht_account_id, 0, v_wht, 'Withholding tax withheld, owed to the tax authority');
        END IF;
      END IF;
    ELSIF v_is_advance_close THEN
      IF v_expense_account_id IS NULL OR v_advance_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format('Cannot close advance: category_id=%s -> expense account %s, advance account %s, amount_etb=%s', v_effective_category_id, v_expense_account_id, v_advance_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date,'operational','expenses',NEW.id,'Vendor advance closed (GRN received): '||COALESCE(NEW.expense_code,NEW.id::text)) RETURNING id INTO v_entry_id;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description),
        (v_entry_id, v_advance_account_id, 0, NEW.amount_etb, 'Advance closed - goods received');
    ELSE
      IF v_expense_account_id IS NULL OR NEW.amount_etb IS NULL OR (v_cash>0 AND v_cash_account_id IS NULL) OR (v_credit>0 AND v_advance_account_id IS NULL) THEN
        PERFORM log_posting_failure('expenses', NEW.id, format('Cannot post: category_id=%s -> expense account %s, account_id=%s -> cash account %s, amount_etb=%s', v_effective_category_id, v_expense_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date,'operational','expenses',NEW.id,'Expense paid: '||COALESCE(NEW.expense_code,NEW.id::text)) RETURNING id INTO v_entry_id;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description);
      IF v_cash > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes, party_type, party_id)
        VALUES (v_entry_id, v_cash_account_id, 0, v_cash, 'Paid via '||v_cash_label, CASE WHEN v_adv_staff IS NOT NULL THEN 'staff' END, v_adv_staff);
      END IF;
      IF v_credit > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES (v_entry_id, v_advance_account_id, 0, v_credit, 'Funded from vendor credit held in Vendor Advances');
      END IF;
      IF v_wht > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES (v_entry_id, v_wht_account_id, 0, v_wht, 'Withholding tax withheld, owed to the tax authority');
      END IF;
    END IF;
    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('expenses', NEW.id, SQLERRM);
  END;
  RETURN NEW;
END; $function$;

-- Settling a recorded bill from a vendor credit clears the payable, not cost.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('settle_expense_with_vendor_credit'::regproc);
  d := replace(d,
    'SELECT id INTO v_advance_acct FROM chart_of_accounts WHERE account_code = ''1080'';',
    'SELECT id INTO v_advance_acct FROM chart_of_accounts WHERE account_code = ''1080'';
  -- A bill already recorded (382) is owed, not yet costed at payment: clear the payable.
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = ''expense_accrual'' AND source_id = v_exp.id) THEN
    v_expense_acct := expense_payable_account(v_exp.expense_type);
  END IF;');
  IF d NOT LIKE '%expense_payable_account(v_exp.expense_type)%' THEN
    RAISE EXCEPTION 'settle_expense_with_vendor_credit did not take the change';
  END IF;
  EXECUTE d;
END $$;

-- ── 3. Sales ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sale_vat_amount(p_amount numeric, p_date date, p_exempt boolean)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN COALESCE(p_exempt, false) OR COALESCE(p_amount, 0) = 0 THEN 0
              ELSE round(p_amount * r / (1 + r), 2) END
    FROM (SELECT COALESCE((tax_rate_note('VAT', COALESCE(p_date, CURRENT_DATE)) ->> 'standard_rate')::numeric, 0.15) AS r) x
$$;

CREATE OR REPLACE FUNCTION public.sync_sale_ledger(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s        sales%ROWTYPE;
  v_vat    numeric;
  v_lines  jsonb := '[]'::jsonb;
  v_invoiced boolean;
BEGIN
  SELECT * INTO s FROM sales WHERE id = p_id;
  v_invoiced := EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sale_invoice' AND source_id = p_id);
  v_vat := sale_vat_amount(s.amount, s.date, s.is_vat_exempt);

  -- Posted the old way, straight to revenue: move its VAT to VAT payable.
  IF NOT v_invoiced AND EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = p_id) THEN
    IF s.id IS NOT NULL AND v_vat > 0 AND NOT s.carried_forward
       AND EXISTS (SELECT 1 FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id
                    WHERE je.source_table = 'sales' AND je.source_id = p_id AND l.account_id = coa_id('sales')) THEN
      v_lines := jsonb_build_array(
        ledger_line(coa_id('sales'), v_vat, 'VAT in the amount received, not revenue', s.project_id),
        ledger_line(coa_id('vat_payable'), -v_vat, 'Output VAT on ' || COALESCE(s.invoice_number, 'the sale'), s.project_id));
    END IF;
    PERFORM ledger_sync('sale_vat_reclass', p_id, s.date, 'VAT out of revenue: ' || COALESCE(s.invoice_number, p_id::text), v_lines, 'adjusting');
    RETURN;
  END IF;

  IF s.id IS NOT NULL
     AND s.sales_status IN ('Invoiced', 'Paid')
     AND s.approval_status IS DISTINCT FROM 'rejected'
     AND NOT COALESCE(s.is_archived, false)
     AND NOT COALESCE(s.carried_forward, false)
     AND COALESCE(s.amount, 0) > 0
     AND in_current_fy(s.date)
  THEN
    v_lines := jsonb_build_array(
      ledger_line(coa_id('ar'), s.amount, 'Invoiced ' || COALESCE(s.invoice_number, ''), s.project_id, NULL, s.client_id),
      ledger_line(coa_id('sales'), -(s.amount - v_vat), COALESCE(s.product_or_service, s.sales_description), s.project_id),
      ledger_line(coa_id('vat_payable'), -v_vat, 'Output VAT', s.project_id));
  END IF;
  PERFORM ledger_sync('sale_invoice', p_id, COALESCE(s.date, CURRENT_DATE),
                      'Invoice ' || COALESCE(s.invoice_number, '') || COALESCE(': ' || s.sales_description, ''), v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('sales', p_id, 'Recording the invoice: ' || SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_ledger_sale_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM sync_sale_ledger(NEW.id);
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_ledger_sale_invoice ON sales;
CREATE TRIGGER trg_ledger_sale_invoice AFTER INSERT OR UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_sale_invoice();

-- Receiving: an invoiced sale clears the receivable; last year's (carried
-- forward) as before; anything else as before.
CREATE OR REPLACE FUNCTION public.post_sale_payment_to_ledger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy UUID; v_fy_start DATE; v_row_fy UUID;
  v_cash_account_id UUID; v_entry_id UUID; v_paid_on DATE; v_cash NUMERIC; v_wht NUMERIC;
BEGIN
  IF NEW.sales_status IS DISTINCT FROM 'Paid' THEN RETURN NEW; END IF;
  SELECT id, start_date INTO v_current_fy, v_fy_start FROM fiscal_periods WHERE is_current;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = NEW.id) THEN RETURN NEW; END IF;

  v_cash := COALESCE(NEW.amount_received, NEW.amount);
  v_wht  := GREATEST(COALESCE(NEW.withheld_by_client, 0), 0);
  SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;

  -- An invoice from this year, or last year's receivable: the money clears 1050.
  IF NEW.date < v_fy_start OR EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sale_invoice' AND source_id = NEW.id) THEN
    v_paid_on := COALESCE(NEW.payment_date, CASE WHEN NEW.date < v_fy_start THEN CURRENT_DATE ELSE NEW.date END);
    IF fiscal_period_for_date(v_paid_on) IS DISTINCT FROM v_current_fy THEN RETURN NEW; END IF;
    BEGIN
      IF v_cash_account_id IS NULL OR NEW.amount IS NULL THEN
        PERFORM log_posting_failure('sales', NEW.id, format('Cannot post: account_id=%s -> cash account %s, amount=%s', NEW.account_id, v_cash_account_id, NEW.amount));
        RETURN NEW;
      END IF;
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (v_paid_on, 'operational', 'sales', NEW.id,
              CASE WHEN NEW.date < v_fy_start THEN 'Collected from last year: ' ELSE 'Payment received: ' END
              || COALESCE(NEW.invoice_number || ' ', '') || COALESCE(NEW.sales_description, ''))
      RETURNING id INTO v_entry_id;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_cash_account_id, v_cash, 0, 'Received via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));
      IF v_wht > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (v_entry_id, coa_id('wht_receivable'), v_wht, 0, 'Withheld by the client — certificate due');
      END IF;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, coa_id('ar'), 0, v_cash + v_wht, 'Settles ' || COALESCE(NEW.invoice_number, 'invoice'));
      SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
      SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
    EXCEPTION WHEN OTHERS THEN
      PERFORM log_posting_failure('sales', NEW.id, SQLERRM);
    END;
    RETURN NEW;
  END IF;

  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN RETURN NEW; END IF;
  BEGIN
    IF v_cash_account_id IS NULL OR NEW.amount IS NULL THEN
      PERFORM log_posting_failure('sales', NEW.id, format('Cannot post: account_id=%s -> cash account %s, amount=%s', NEW.account_id, v_cash_account_id, NEW.amount));
      RETURN NEW;
    END IF;
    INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
    VALUES (NEW.date, 'operational', 'sales', NEW.id, 'Sale paid: ' || COALESCE(NEW.sales_description, NEW.id::text))
    RETURNING id INTO v_entry_id;
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry_id, v_cash_account_id, NEW.amount, 0, 'Received via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id)),
      (v_entry_id, coa_id('sales'), 0, NEW.amount, NEW.product_or_service);
    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('sales', NEW.id, SQLERRM);
  END;
  RETURN NEW;
END; $function$;

-- ── 4. Input VAT ─────────────────────────────────────────────────────────────
-- Once the receipt passes tax review (v_input_vat_tracker.claimable) the VAT
-- comes out of the cost it was booked to and into 1410.
CREATE OR REPLACE FUNCTION public.sync_expense_input_vat(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  e       expenses%ROWTYPE;
  v_vat   numeric;
  v_cost  uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_id;
  SELECT t.vat_amount INTO v_vat FROM v_input_vat_tracker t WHERE t.expense_id = p_id AND t.claimable;
  -- The account the expense's cost sits in, however it got there.
  SELECT l.account_id INTO v_cost
    FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id
    JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
   WHERE je.source_table IN ('expense_accrual', 'expenses') AND je.source_id = p_id AND l.debit > 0
   ORDER BY je.created_at DESC LIMIT 1;
  IF e.id IS NOT NULL AND COALESCE(v_vat, 0) > 0 AND v_cost IS NOT NULL AND in_current_fy(e.date) THEN
    v_lines := jsonb_build_array(
      ledger_line(coa_id('input_vat'), v_vat, 'Input VAT on a tax-reviewed receipt', e.project_id),
      ledger_line(v_cost, -v_vat, 'VAT is reclaimable, not a cost', e.project_id));
  END IF;
  PERFORM ledger_sync('expense_input_vat', p_id, COALESCE(e.date, CURRENT_DATE),
                      'Input VAT: ' || COALESCE(e.expense_code, p_id::text), v_lines, 'adjusting');
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('expenses', p_id, 'Input VAT: ' || SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_ledger_input_vat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    PERFORM sync_expense_input_vat(NEW.id);
  ELSE
    IF TG_OP <> 'DELETE' AND NEW.expense_id IS NOT NULL THEN PERFORM sync_expense_input_vat(NEW.expense_id); END IF;
    IF TG_OP <> 'INSERT' AND OLD.expense_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.expense_id IS DISTINCT FROM NEW.expense_id) THEN
      PERFORM sync_expense_input_vat(OLD.expense_id);
    END IF;
  END IF;
  RETURN NULL;
END $function$;
-- After the payment trigger on expenses (name order), so a bill costed at payment is seen.
DROP TRIGGER IF EXISTS trg_zz_ledger_input_vat ON expenses;
CREATE TRIGGER trg_zz_ledger_input_vat AFTER UPDATE OF payment_state, approval_status, amount_etb, category_id, is_archived ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_input_vat();
DROP TRIGGER IF EXISTS trg_ledger_input_vat ON vendor_receipts;
CREATE TRIGGER trg_ledger_input_vat AFTER INSERT OR UPDATE OR DELETE ON vendor_receipts
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_input_vat();
DROP TRIGGER IF EXISTS trg_ledger_input_vat ON input_vat_items;
CREATE TRIGGER trg_ledger_input_vat AFTER INSERT OR UPDATE OR DELETE ON input_vat_items
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_input_vat();

-- ── 5. Staff: cash advances and petty cash ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_cash_advance_ledger(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a       cash_advances%ROWTYPE;
  v_bank  uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO a FROM cash_advances WHERE id = p_id;
  IF a.id IS NOT NULL AND a.approval_status = 'finance_approved' AND NOT COALESCE(a.is_archived, false)
     AND COALESCE(a.amount_advanced, 0) > 0 AND in_current_fy(a.date_given) THEN
    SELECT id INTO v_bank FROM chart_of_accounts WHERE linked_account_id = a.account_used_id;
    IF v_bank IS NULL THEN
      PERFORM log_posting_failure('cash_advances', p_id, 'Cannot post the cash advance: pick the account it was paid from');
      RETURN;
    END IF;
    v_lines := jsonb_build_array(
      ledger_line(coa_id('staff_advances'), a.amount_advanced, 'Advance to ' || COALESCE(ledger_party_name('staff', a.staff_id), 'staff'), NULL, NULL, NULL, a.staff_id),
      ledger_line(v_bank, -a.amount_advanced, 'Paid out'));
  END IF;
  PERFORM ledger_sync('cash_advances', p_id, COALESCE(a.date_given, CURRENT_DATE),
                      'Cash advance ' || COALESCE(a.advance_id_code, ''), v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('cash_advances', p_id, SQLERRM);
END $function$;

-- Floats are funded, and topped up, from the office cash box (11000); a
-- float paid from a bank is moved there by a manual journal.
CREATE OR REPLACE FUNCTION public.sync_petty_cash_ledger(p_kind text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  f       petty_cash_floats%ROWTYPE;
  v_amt   numeric;
  v_date  date;
  v_lines jsonb := '[]'::jsonb;
  v_desc  text;
BEGIN
  IF p_kind = 'petty_cash_floats' THEN
    SELECT * INTO f FROM petty_cash_floats WHERE id = p_id;
    v_amt := f.float_amount; v_date := f.created_at::date;
    v_desc := 'Petty cash float opened';
    IF f.id IS NOT NULL AND COALESCE(v_amt, 0) > 0 AND in_current_fy(v_date) THEN
      v_lines := jsonb_build_array(
        ledger_line(coa_id('petty_cash'), v_amt, 'Float held by ' || COALESCE(ledger_party_name('staff', f.custodian_staff_id), 'custodian'), f.project_id, NULL, NULL, f.custodian_staff_id),
        ledger_line(coa_id('cash_on_hand'), -v_amt, 'Handed out from the cash box', f.project_id));
    END IF;
  ELSIF p_kind = 'petty_cash_replenishments' THEN
    SELECT fl.* INTO f FROM petty_cash_replenishments r JOIN petty_cash_floats fl ON fl.id = r.float_id WHERE r.id = p_id;
    SELECT amount_requested, COALESCE(approved_at, created_at)::date INTO v_amt, v_date
      FROM petty_cash_replenishments WHERE id = p_id AND status = 'approved';
    v_desc := 'Petty cash float topped up';
    IF f.id IS NOT NULL AND COALESCE(v_amt, 0) > 0 AND in_current_fy(v_date) THEN
      v_lines := jsonb_build_array(
        ledger_line(coa_id('petty_cash'), v_amt, 'Top-up', f.project_id, NULL, NULL, f.custodian_staff_id),
        ledger_line(coa_id('cash_on_hand'), -v_amt, 'Handed out from the cash box', f.project_id));
    END IF;
  ELSIF p_kind = 'petty_cash_transactions' THEN
    SELECT fl.* INTO f FROM petty_cash_transactions t JOIN petty_cash_floats fl ON fl.id = t.float_id WHERE t.id = p_id;
    SELECT amount, created_at::date, purpose INTO v_amt, v_date, v_desc FROM petty_cash_transactions WHERE id = p_id;
    v_desc := 'Petty cash spent' || COALESCE(': ' || v_desc, '');
    IF f.id IS NOT NULL AND COALESCE(v_amt, 0) > 0 AND in_current_fy(v_date) THEN
      v_lines := jsonb_build_array(
        ledger_line(coa_id('petty_cash_expense'), v_amt, v_desc, f.project_id),
        ledger_line(coa_id('petty_cash'), -v_amt, 'Spent by ' || COALESCE(ledger_party_name('staff', f.custodian_staff_id), 'custodian'), f.project_id, NULL, NULL, f.custodian_staff_id));
    END IF;
  END IF;
  PERFORM ledger_sync(p_kind, p_id, COALESCE(v_date, CURRENT_DATE), COALESCE(v_desc, 'Petty cash'), v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure(p_kind, p_id, SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_ledger_staff_money()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
BEGIN
  IF TG_TABLE_NAME = 'cash_advances' THEN PERFORM sync_cash_advance_ledger(v_id);
  ELSE PERFORM sync_petty_cash_ledger(TG_TABLE_NAME, v_id);
  END IF;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_ledger_staff_money ON cash_advances;
CREATE TRIGGER trg_ledger_staff_money AFTER INSERT OR UPDATE OR DELETE ON cash_advances FOR EACH ROW EXECUTE FUNCTION trg_ledger_staff_money();
DROP TRIGGER IF EXISTS trg_ledger_staff_money ON petty_cash_floats;
CREATE TRIGGER trg_ledger_staff_money AFTER INSERT OR UPDATE OF float_amount, custodian_staff_id, project_id OR DELETE ON petty_cash_floats FOR EACH ROW EXECUTE FUNCTION trg_ledger_staff_money();
DROP TRIGGER IF EXISTS trg_ledger_staff_money ON petty_cash_replenishments;
CREATE TRIGGER trg_ledger_staff_money AFTER INSERT OR UPDATE OR DELETE ON petty_cash_replenishments FOR EACH ROW EXECUTE FUNCTION trg_ledger_staff_money();
DROP TRIGGER IF EXISTS trg_ledger_staff_money ON petty_cash_transactions;
CREATE TRIGGER trg_ledger_staff_money AFTER INSERT OR UPDATE OR DELETE ON petty_cash_transactions FOR EACH ROW EXECUTE FUNCTION trg_ledger_staff_money();

-- ── 6. Fixed assets ──────────────────────────────────────────────────────────
-- Bought on a bill this year: the bill's cost moves to 1610.
CREATE OR REPLACE FUNCTION public.sync_fixed_asset_ledger(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a       fixed_assets%ROWTYPE;
  v_cost  uuid;
  v_date  date;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO a FROM fixed_assets WHERE id = p_id;
  IF a.id IS NOT NULL AND a.purchase_expense_id IS NOT NULL AND COALESCE(a.purchase_cost_etb, 0) > 0 THEN
    SELECT l.account_id, je.entry_date INTO v_cost, v_date
      FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id
      JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
     WHERE je.source_table IN ('expense_accrual', 'expenses') AND je.source_id = a.purchase_expense_id AND l.debit > 0
     ORDER BY je.created_at LIMIT 1;
    IF v_cost IS NOT NULL AND in_current_fy(v_date) THEN
      v_lines := jsonb_build_array(
        ledger_line(coa_id('ppe'), a.purchase_cost_etb, a.asset_code || ' ' || a.asset_name),
        ledger_line(v_cost, -a.purchase_cost_etb, 'A fixed asset, not a cost'));
    END IF;
  END IF;
  PERFORM ledger_sync('fixed_assets', p_id, COALESCE(v_date, a.purchase_date, CURRENT_DATE),
                      'Fixed asset: ' || COALESCE(a.asset_code || ' ' || a.asset_name, p_id::text), v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('fixed_assets', p_id, SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_ledger_fixed_asset()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM sync_fixed_asset_ledger(CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_ledger_fixed_asset ON fixed_assets;
CREATE TRIGGER trg_ledger_fixed_asset AFTER INSERT OR UPDATE OF purchase_expense_id, purchase_cost_etb OR DELETE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_fixed_asset();

-- Straight-line depreciation to a date, whole months from the start date.
CREATE OR REPLACE FUNCTION public.asset_depreciation_to(a fixed_assets, p_date date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN a.depreciation_method IS DISTINCT FROM 'straight_line' OR COALESCE(a.useful_life_years, 0) <= 0
         OR COALESCE(a.depreciation_start_date, a.purchase_date) IS NULL
         OR p_date < COALESCE(a.depreciation_start_date, a.purchase_date) THEN 0
    ELSE round(LEAST(
      (COALESCE(a.purchase_cost_etb, 0) - COALESCE(a.salvage_value_etb, 0))
        * ((EXTRACT(year FROM age(p_date + 1, COALESCE(a.depreciation_start_date, a.purchase_date))) * 12
            + EXTRACT(month FROM age(p_date + 1, COALESCE(a.depreciation_start_date, a.purchase_date))))
           / (a.useful_life_years * 12.0)),
      COALESCE(a.purchase_cost_etb, 0) - COALESCE(a.salvage_value_etb, 0)), 2)
  END
$$;

-- This year's depreciation up to p_through: each run posts what is new since
-- the last one (month end runs it).
CREATE OR REPLACE FUNCTION public.post_depreciation(p_through date DEFAULT CURRENT_DATE)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a        fixed_assets%ROWTYPE;
  v_start  date;
  v_amount numeric;
  v_total  numeric := 0;
  v_before numeric;
BEGIN
  IF NOT COALESCE(get_user_role() IN ('admin', 'finance'), false) AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Only finance can post depreciation';
  END IF;
  SELECT start_date INTO v_start FROM fiscal_periods WHERE is_current;
  IF NOT in_current_fy(p_through) THEN RAISE EXCEPTION 'Post depreciation within the current fiscal year'; END IF;
  FOR a IN SELECT * FROM fixed_assets WHERE COALESCE(is_active, true) AND disposal_date IS NULL LOOP
    v_amount := asset_depreciation_to(a, p_through) - asset_depreciation_to(a, v_start - 1);
    SELECT COALESCE(sum(l.debit - l.credit), 0) INTO v_before
      FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id
     WHERE je.source_table = 'fixed_asset_depreciation' AND je.source_id = a.id AND l.account_id = coa_id('depreciation');
    IF v_amount > 0 THEN
      PERFORM ledger_sync('fixed_asset_depreciation', a.id, p_through,
        'Depreciation to ' || to_char(p_through, 'DD Mon YYYY') || ': ' || a.asset_code || ' ' || a.asset_name,
        jsonb_build_array(ledger_line(coa_id('depreciation'), v_amount, a.asset_name),
                          ledger_line(coa_id('acc_depreciation'), -v_amount, a.asset_name)));
      v_total := v_total + v_amount - v_before;
    END IF;
  END LOOP;
  RETURN v_total;
END $function$;
REVOKE EXECUTE ON FUNCTION post_depreciation(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION post_depreciation(date) TO authenticated;

-- ── 7. Re-run it all (finance, and this migration) ───────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_resync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_start date; v_before int; r record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE(get_user_role() IN ('admin', 'finance'), false) THEN
    RAISE EXCEPTION 'Only finance can re-run the ledger';
  END IF;
  SELECT start_date INTO v_start FROM fiscal_periods WHERE is_current;
  SELECT count(*) INTO v_before FROM journal_entries;
  FOR r IN SELECT id FROM expenses WHERE date >= v_start OR id IN (SELECT source_id FROM journal_entries WHERE source_table = 'expense_accrual') LOOP
    PERFORM sync_expense_accrual(r.id);
    PERFORM sync_expense_input_vat(r.id);
  END LOOP;
  FOR r IN SELECT id FROM sales WHERE date >= v_start OR id IN (SELECT source_id FROM journal_entries WHERE source_table IN ('sale_invoice', 'sale_vat_reclass')) LOOP
    PERFORM sync_sale_ledger(r.id);
  END LOOP;
  FOR r IN SELECT id FROM cash_advances LOOP PERFORM sync_cash_advance_ledger(r.id); END LOOP;
  FOR r IN SELECT id FROM petty_cash_floats LOOP PERFORM sync_petty_cash_ledger('petty_cash_floats', r.id); END LOOP;
  FOR r IN SELECT id FROM petty_cash_replenishments LOOP PERFORM sync_petty_cash_ledger('petty_cash_replenishments', r.id); END LOOP;
  FOR r IN SELECT id FROM petty_cash_transactions LOOP PERFORM sync_petty_cash_ledger('petty_cash_transactions', r.id); END LOOP;
  FOR r IN SELECT id FROM fixed_assets LOOP PERFORM sync_fixed_asset_ledger(r.id); END LOOP;
  RETURN jsonb_build_object('entries_posted', (SELECT count(*) FROM journal_entries) - v_before);
END $function$;
REVOKE EXECUTE ON FUNCTION ledger_resync() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ledger_resync() TO authenticated;

REVOKE EXECUTE ON FUNCTION sync_expense_accrual(uuid), sync_sale_ledger(uuid), sync_expense_input_vat(uuid),
  sync_cash_advance_ledger(uuid), sync_petty_cash_ledger(text, uuid), sync_fixed_asset_ledger(uuid)
  FROM PUBLIC, anon, authenticated;

SELECT ledger_resync();
