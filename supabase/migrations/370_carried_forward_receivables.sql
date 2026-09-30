-- 370 — Money still owed from last year
--
-- Contracts finished last year with part of the price still unpaid had no
-- honest home. A sale dated this year booked the collection as this year's
-- revenue and put its VAT in this year's return — counting both twice when
-- the invoice went out last year. A sale dated last year was skipped by the
-- ledger altogether (post_sale_payment_to_ledger only posts current-year
-- sales), so the money arriving now never reached the books.
--
-- Now:
--   * sales.carried_forward marks an invoice issued before this fiscal year
--     and still owed at its start. It is an ordinary sale in every other
--     way, so the client page, AR aging, cash forecast, bank matching and
--     the WHT tracker all see it.
--   * Accounts Receivable (1050) and Withholding Tax Receivable (1090) join
--     the chart of accounts.
--   * Any sale invoiced before this fiscal year and paid in it posts
--     Dr Cash (what the bank got) + Dr WHT receivable (what the client kept
--     back) / Cr Accounts Receivable — settling the debt, not new revenue.
--   * Carried-forward invoices stay out of the VAT output figures: that VAT
--     belonged to the return of the month they were invoiced in.
--   * Bank matching suggests a carried-forward invoice however old it is.
--   * add_carried_forward_receivable() records one (optionally with the
--     finished contract it came from), remove_… takes back a mistake, and
--     set_opening_receivables_balance() writes their total into the opening
--     balances as the Accounts Receivable line.

SET search_path TO public;

-- ── 1. The flag ──────────────────────────────────────────────────────
ALTER TABLE sales ADD COLUMN IF NOT EXISTS carried_forward boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN sales.carried_forward IS
  'Invoiced before the current fiscal year and still owed at its start (migration 370). Its VAT was declared in the month it was invoiced; its collection settles Accounts Receivable.';
CREATE INDEX IF NOT EXISTS idx_sales_carried_forward ON sales (client_id) WHERE carried_forward;

-- ── 2. Accounts ──────────────────────────────────────────────────────
INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section)
SELECT v.code, v.name, 'Asset', p.id, true, true, 'operating'
FROM (VALUES ('1050', 'Accounts Receivable'), ('1090', 'Withholding Tax Receivable')) v(code, name)
CROSS JOIN (SELECT id FROM chart_of_accounts WHERE account_code = '1000') p
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.account_code = v.code);

-- ── 3. Posting a payment ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_sale_payment_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_current_fy UUID;
  v_fy_start   DATE;
  v_row_fy     UUID;
  v_cash_account_id    UUID;
  v_revenue_account_id UUID;
  v_ar_account_id      UUID;
  v_wht_account_id     UUID;
  v_entry_id   UUID;
  v_paid_on    DATE;
  v_cash       NUMERIC;
  v_wht        NUMERIC;
BEGIN
  IF NEW.sales_status IS DISTINCT FROM 'Paid' THEN
    RETURN NEW;
  END IF;

  SELECT id, start_date INTO v_current_fy, v_fy_start FROM fiscal_periods WHERE is_current;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Invoiced before this year, paid this year: the revenue was last year's,
  -- so this payment settles what the client owed.
  IF NEW.date < v_fy_start THEN
    v_paid_on := COALESCE(NEW.payment_date, CURRENT_DATE);
    IF fiscal_period_for_date(v_paid_on) IS DISTINCT FROM v_current_fy THEN
      RETURN NEW;
    END IF;
    BEGIN
      SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code = '1050';
      SELECT id INTO v_wht_account_id FROM chart_of_accounts WHERE account_code = '1090';
      SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;

      IF v_cash_account_id IS NULL OR NEW.amount IS NULL THEN
        PERFORM log_posting_failure('sales', NEW.id, format(
          'Cannot post: account_id=%s -> cash account %s, amount=%s', NEW.account_id, v_cash_account_id, NEW.amount));
        RETURN NEW;
      END IF;

      v_cash := COALESCE(NEW.amount_received, NEW.amount);
      v_wht  := GREATEST(COALESCE(NEW.withheld_by_client, 0), 0);

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (v_paid_on, 'operational', 'sales', NEW.id,
              'Collected from last year: ' || COALESCE(NEW.invoice_number || ' ', '') || COALESCE(NEW.sales_description, ''))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_cash_account_id, v_cash, 0, 'Received via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));
      IF v_wht > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (v_entry_id, v_wht_account_id, v_wht, 0, 'Withheld by the client — certificate due');
      END IF;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
      VALUES (v_entry_id, v_ar_account_id, 0, v_cash + v_wht, 'Settles ' || COALESCE(NEW.invoice_number, 'invoice'));

      SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
      SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
    EXCEPTION WHEN OTHERS THEN
      PERFORM log_posting_failure('sales', NEW.id, SQLERRM);
    END;
    RETURN NEW;
  END IF;

  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_revenue_account_id FROM chart_of_accounts WHERE account_code = '4010';
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;

    IF v_cash_account_id IS NULL OR NEW.amount IS NULL THEN
      PERFORM log_posting_failure('sales', NEW.id, format(
        'Cannot post: account_id=%s -> cash account %s, amount=%s', NEW.account_id, v_cash_account_id, NEW.amount));
      RETURN NEW;
    END IF;

    INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
    VALUES (NEW.date, 'operational', 'sales', NEW.id, 'Sale paid: ' || COALESCE(NEW.sales_description, NEW.id::text))
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry_id, v_cash_account_id, NEW.amount, 0, 'Received via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id)),
      (v_entry_id, v_revenue_account_id, 0, NEW.amount, NEW.product_or_service);

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('sales', NEW.id, SQLERRM);
  END;

  RETURN NEW;
END;
$function$;

-- ── 4. VAT output leaves carried-forward invoices out ────────────────
CREATE OR REPLACE VIEW v_output_vat_by_sale WITH (security_invoker = true) AS
SELECT s.id,
    s.invoice_number,
    s.date,
    s.sales_status,
    s.amount AS gross_amount,
    s.is_vat_exempt,
    CASE WHEN s.is_vat_exempt THEN 0::numeric ELSE round(s.amount * 15.0 / 115.0, 2) END AS output_vat,
    CASE WHEN s.is_vat_exempt THEN s.amount ELSE round(s.amount * 100.0 / 115.0, 2) END AS net_of_vat,
    s.client_id,
    c.client_name,
    s.project_id
FROM sales s
LEFT JOIN clients c ON c.id = s.client_id
WHERE NOT s.carried_forward;

CREATE OR REPLACE VIEW v_vat_output_by_ec_period WITH (security_invoker = true) AS
SELECT tp.ec_year,
    tp.ec_month,
    count(*) AS sale_count,
    sum(s.amount) AS gross_total,
    sum(round(s.amount * r.rate / (1::numeric + r.rate), 2)) AS output_vat
FROM sales s
CROSS JOIN LATERAL tax_period_for_date(s.date) tp(ec_year, ec_month)
CROSS JOIN LATERAL (SELECT (tax_rate_note('VAT'::text, s.date) ->> 'standard_rate')::numeric AS rate) r
WHERE s.date IS NOT NULL AND NOT s.is_vat_exempt AND NOT s.carried_forward
  AND s.sales_status = ANY (ARRAY['Invoiced'::sale_lifecycle_status, 'Paid'::sale_lifecycle_status])
GROUP BY tp.ec_year, tp.ec_month;

-- ── 5. Bank matching: an old invoice is suggested however old ────────
CREATE OR REPLACE FUNCTION public.suggest_bank_line_matches(p_line_id uuid)
 RETURNS TABLE(kind text, target_id uuid, label text, detail text, amount numeric, target_date date, score integer, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_text text;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT * INTO l FROM v_bank_line_status WHERE line_id = p_line_id;
  IF l.line_id IS NULL THEN RETURN; END IF;
  v_text := COALESCE(l.narration, '') || ' ' || COALESCE(l.reference, '');
  RETURN QUERY
  WITH cand AS (
    SELECT 'expense'::text AS kind, e.id AS target_id,
      btrim(COALESCE(e.expense_code, '') || ' ' || COALESCE(e.item_service_description, '')) AS label,
      COALESCE(v.vendor_name, st.employee_name, '') || ' · ' || replace(e.payment_state::text, '_', ' ') AS detail,
      COALESCE(e.net_payable, e.amount_etb) AS amount, e.date AS target_date,
      (e.bank_ref IS NOT NULL AND e.bank_ref = l.reference_code) AS ref_hit,
      (bank_text_names_code(v_text, e.expense_code)
        OR EXISTS (SELECT 1 FROM sourcing_bundles sb WHERE (sb.expense_id = e.id OR sb.id = e.sourcing_bundle_id)
                   AND bank_text_names_code(v_text, sb.bundle_code))) AS code_hit,
      bank_amount_fit(l.amount, COALESCE(e.net_payable, e.amount_etb), 'debit') AS fit,
      CASE WHEN e.payment_state = 'sent' THEN 10 WHEN e.payment_state = 'approved_to_pay' THEN 5 ELSE 0 END AS bonus
    FROM expenses e
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN staff st ON st.id = e.paid_to_staff_id
    WHERE l.direction = 'debit' AND e.transfer_id IS NULL
      AND e.payment_state IN ('approved_to_pay', 'sent', 'paid', 'advance')
      AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation f
                      WHERE f.out_transfer_id IS NULL AND f.record_name IS NOT NULL AND e.expense_code LIKE '%' || f.record_name)
      AND e.date BETWEEN l.value_date - 120 AND l.value_date + 10
    UNION ALL
    SELECT 'batch', b.id, COALESCE(b.payment_code, 'Batch payment'),
      (SELECT count(*) FROM batch_payment_expenses x WHERE x.batch_payment_id = b.id)::text || ' payments',
      t.total, b.created_at::date,
      false, bank_text_names_code(v_text, b.payment_code),
      bank_amount_fit(l.amount, t.total, 'debit'), 5
    FROM batch_payments b
    CROSS JOIN LATERAL (SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), 0) AS total
                        FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id WHERE x.batch_payment_id = b.id) t
    WHERE l.direction = 'debit' AND b.transfer_id IS NULL
      AND b.created_at::date BETWEEN l.value_date - 60 AND l.value_date + 10
    UNION ALL
    SELECT 'vrf', f.id, COALESCE(f.record_name, 'Vendor request'),
      COALESCE(f.facilitator_name, '') || ' · ' || COALESCE(f.payment_state, ''),
      COALESCE(f.net_sent, f.amount_transferred), f.trxn_date,
      false, bank_text_names_code(v_text, f.record_name),
      bank_amount_fit(l.amount, COALESCE(f.net_sent, f.amount_transferred), 'debit'),
      CASE WHEN f.initial_account_id = l.account_id THEN 5 ELSE 0 END
    FROM vendor_receipt_facilitation f
    WHERE l.direction = 'debit' AND f.out_transfer_id IS NULL AND NOT f.is_archived
      AND f.trxn_date BETWEEN l.value_date - 60 AND l.value_date + 10
    UNION ALL
    SELECT 'payroll', p.id, COALESCE(p.payroll_record, 'Payroll run'),
      COALESCE((SELECT st.employee_name FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
                WHERE ps.payroll_id = p.id AND bank_amount_fit(l.amount, ps.net_amount, 'debit') >= 55 LIMIT 1), 'run')
        || ' · ' || COALESCE(p.payment_status, ''),
      (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id), p.end_date,
      false, false,
      greatest(bank_amount_fit(l.amount, (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id), 'debit'),
               CASE WHEN EXISTS (SELECT 1 FROM payroll_staff ps WHERE ps.payroll_id = p.id AND bank_amount_fit(l.amount, ps.net_amount, 'debit') >= 55)
                    THEN 45 ELSE 0 END),
      CASE WHEN upper(v_text) ~ '(SALARY|\mSAL\M|PAYROLL|WAGE)' THEN 25 ELSE 0 END
    FROM payroll p
    WHERE l.direction = 'debit' AND p.transfer_id IS NULL
      AND p.end_date BETWEEN l.value_date - 60 AND l.value_date + 30
    UNION ALL
    SELECT 'sale', s.id, btrim(COALESCE(s.invoice_number, '') || ' ' || COALESCE(s.sales_description, '')),
      COALESCE(c.client_name, '') || ' · ' || CASE WHEN s.carried_forward THEN 'owed from last year' ELSE s.sales_status::text END,
      s.amount, s.date,
      (s.bank_ref IS NOT NULL AND s.bank_ref = l.reference_code), bank_text_names_code(v_text, s.invoice_number),
      greatest(bank_amount_fit(l.amount, s.amount, 'credit'),
               bank_amount_fit(l.amount, s.amount - COALESCE(w.expected_wht, 0), 'credit'),
               CASE WHEN l.amount < s.amount AND l.amount >= s.amount * 0.85 THEN 30 ELSE 0 END),
      CASE WHEN c.client_name IS NOT NULL AND upper(v_text) LIKE '%' || upper(split_part(c.client_name, ' ', 1)) || '%' THEN 15 ELSE 0 END
    FROM sales s
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN v_sale_wht w ON w.sale_id = s.id
    WHERE l.direction = 'credit' AND s.transfer_id IS NULL AND NOT COALESCE(s.is_archived, false)
      AND (s.date BETWEEN l.value_date - 180 AND l.value_date + 10
           OR (s.carried_forward AND s.sales_status = 'Invoiced'))
    UNION ALL
    SELECT 'internal_line', o.line_id, 'Transfer ' || CASE WHEN o.direction = 'debit' THEN 'from ' ELSE 'to ' END || a.account_name,
      COALESCE(o.narration, o.reference, ''), o.amount, o.value_date,
      false, false, CASE WHEN abs(o.amount - l.amount) <= 0.01 THEN 80 ELSE 0 END, 0
    FROM v_bank_line_status o JOIN accounts a ON a.id = o.account_id
    WHERE o.account_id <> l.account_id AND o.direction <> l.direction AND o.reconciled_as IS NULL
      AND abs(o.amount - l.amount) <= 0.01 AND o.value_date BETWEEN l.value_date - 5 AND l.value_date + 5
    UNION ALL
    SELECT 'internal_account', a.id, 'Transfer ' || CASE WHEN l.direction = 'credit' THEN 'from ' ELSE 'to ' END || a.account_name,
      'Kuncho''s own account', l.amount, l.value_date, false, false, 60, 0
    FROM accounts a
    WHERE a.id <> l.account_id AND length(split_part(a.account_name, ' ', 1)) >= 4
      AND upper(v_text) LIKE '%' || upper(split_part(a.account_name, ' ', 1)) || '%'
    UNION ALL
    SELECT 'purchase_order', sb.id, sb.bundle_code, COALESCE(sb.vendor_name, '') || ' · no expense recorded',
      sb.total_value, sb.created_at::date, false, true, bank_amount_fit(l.amount, sb.total_value, l.direction), -30
    FROM sourcing_bundles sb
    WHERE l.direction = 'debit' AND bank_text_names_code(v_text, sb.bundle_code)
      AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = sb.expense_id OR e.sourcing_bundle_id = sb.id)
  )
  SELECT c.kind, c.target_id, c.label, c.detail, round(c.amount, 2), c.target_date,
    (CASE WHEN c.ref_hit THEN 100
          WHEN c.code_hit AND c.fit >= 40 THEN 95
          WHEN c.code_hit THEN 70
          ELSE c.fit END + c.bonus)::int AS score,
    CASE WHEN c.ref_hit THEN 'Reference is its bank reference'
         WHEN c.kind = 'purchase_order' THEN 'Narration names this purchase order, but its payment was never recorded — record it on the order, then match'
         WHEN c.code_hit AND c.fit >= 55 AND abs(l.amount - c.amount) > 0.01 THEN 'Narration names it; amount plus a ' || round(l.amount - c.amount, 2) || ' fee'
         WHEN c.code_hit AND c.fit >= 40 THEN 'Narration names it and the amount fits'
         WHEN c.code_hit THEN 'Narration names it, but the amount differs'
         WHEN c.kind = 'payroll' THEN CASE WHEN c.bonus > 0 THEN 'Salary narration; ' ELSE '' END || c.detail
         WHEN c.kind = 'sale' AND c.fit = 30 THEN 'Less than the invoice by ' || round(c.amount - l.amount, 2) || ' — withholding or deductions?'
         WHEN c.kind = 'internal_line' THEN 'Same amount, opposite direction, on another account'
         WHEN c.kind = 'internal_account' THEN 'Narration mentions this bank'
         WHEN c.fit >= 60 THEN 'Same amount'
         WHEN c.fit >= 55 THEN 'Amount plus a ' || round(l.amount - c.amount, 2) || ' fee'
         ELSE 'Amount is close' END
  FROM cand c
  WHERE c.ref_hit OR c.code_hit OR c.fit >= 20
  ORDER BY 7 DESC, abs(c.target_date - l.value_date)
  LIMIT 10;
END; $function$;

-- ── 6. Recording one ─────────────────────────────────────────────────
-- p_new_contract, when given, records the finished contract the invoice
-- came from: {contract_no, contract_value, signed_date, completion_date,
-- scope_of_work}. It is saved as completed.
CREATE OR REPLACE FUNCTION add_carried_forward_receivable(
  p_client_id      uuid,
  p_invoice_date   date,
  p_amount         numeric,
  p_description    text,
  p_invoice_number text    DEFAULT NULL,
  p_contract_id    uuid    DEFAULT NULL,
  p_new_contract   jsonb   DEFAULT NULL,
  p_project_id     uuid    DEFAULT NULL,
  p_vat_exempt     boolean DEFAULT false,
  p_due_date       date    DEFAULT NULL,
  p_notes          text    DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fy_start date; v_contract uuid := p_contract_id; v_no text := NULLIF(btrim(p_invoice_number), '');
  v_id uuid; v_next int;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can record money owed from last year';
  END IF;
  SELECT start_date INTO v_fy_start FROM fiscal_periods WHERE is_current;
  IF p_invoice_date IS NULL OR p_invoice_date >= v_fy_start THEN
    RAISE EXCEPTION 'The invoice date must be before % — an invoice from this year is an ordinary sale', to_char(v_fy_start, 'DD Mon YYYY');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter the amount still owed';
  END IF;
  IF NULLIF(btrim(p_description), '') IS NULL THEN
    RAISE EXCEPTION 'Describe what the invoice was for';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Choose the client';
  END IF;
  IF v_no IS NOT NULL AND EXISTS (SELECT 1 FROM sales WHERE lower(invoice_number) = lower(v_no)) THEN
    RAISE EXCEPTION 'Invoice % is already recorded', v_no;
  END IF;

  IF v_contract IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contracts WHERE id = v_contract AND client_id = p_client_id) THEN
    RAISE EXCEPTION 'That contract belongs to another client';
  END IF;

  IF v_contract IS NULL AND p_new_contract IS NOT NULL AND NULLIF(btrim(p_new_contract->>'contract_no'), '') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM contracts WHERE lower(contract_no) = lower(btrim(p_new_contract->>'contract_no'))) THEN
      RAISE EXCEPTION 'Contract % is already recorded — choose it instead', btrim(p_new_contract->>'contract_no');
    END IF;
    INSERT INTO contracts (contract_no, client_id, project_id, contract_value, signed_date, completion_date,
                           scope_of_work, status, contract_value_includes_vat, wht_deduction_mode, retention_percent, notes)
    VALUES (btrim(p_new_contract->>'contract_no'), p_client_id, p_project_id,
            NULLIF(p_new_contract->>'contract_value', '')::numeric,
            NULLIF(p_new_contract->>'signed_date', '')::date,
            NULLIF(p_new_contract->>'completion_date', '')::date,
            NULLIF(btrim(p_new_contract->>'scope_of_work'), ''),
            'completed', true, 'per_payment', 0,
            'Finished before this fiscal year; recorded with the money still owed on it.')
    RETURNING id INTO v_contract;
  END IF;

  IF v_no IS NULL THEN
    SELECT COALESCE(max(CASE WHEN invoice_number ~ '^CF-\d+$' THEN split_part(invoice_number, '-', 2)::int END), 0) + 1
      INTO v_next FROM sales;
    v_no := 'CF-' || lpad(v_next::text, 3, '0');
  END IF;

  INSERT INTO sales (sales_description, sales_status, date, amount, product_or_service, notes, client_id, project_id,
                     contract_id, invoice_number, due_date, is_vat_exempt, is_project_funded, carried_forward,
                     approval_status, manager_approved_by, manager_approved_at, finance_approved_by, finance_approved_at)
  VALUES (btrim(p_description), 'Invoiced', p_invoice_date, round(p_amount, 2), 'Carried forward from last year',
          NULLIF(btrim(p_notes), ''), p_client_id, p_project_id, v_contract, v_no, p_due_date,
          COALESCE(p_vat_exempt, false), p_project_id IS NOT NULL, true,
          'finance_approved', auth.uid(), now(), auth.uid(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION add_carried_forward_receivable(uuid, date, numeric, text, text, uuid, jsonb, uuid, boolean, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_carried_forward_receivable(uuid, date, numeric, text, text, uuid, jsonb, uuid, boolean, date, text) TO authenticated;

-- A mistake can be taken back while nothing has been received against it.
CREATE OR REPLACE FUNCTION remove_carried_forward_receivable(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v sales%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can remove money owed from last year';
  END IF;
  SELECT * INTO v FROM sales WHERE id = p_sale_id;
  IF v.id IS NULL OR NOT v.carried_forward THEN
    RAISE EXCEPTION 'Not a carried-forward invoice';
  END IF;
  IF v.sales_status <> 'Invoiced' OR v.transfer_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'sales' AND source_id = p_sale_id) THEN
    RAISE EXCEPTION 'Money has already been received against %, so it stays on record', COALESCE(v.invoice_number, 'this invoice');
  END IF;
  DELETE FROM sales WHERE id = p_sale_id;
END $$;
REVOKE ALL ON FUNCTION remove_carried_forward_receivable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION remove_carried_forward_receivable(uuid) TO authenticated;

-- ── 7. The totals, and the opening balance ───────────────────────────
CREATE OR REPLACE FUNCTION carried_forward_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN get_user_role() IN ('admin', 'finance', 'executive') THEN jsonb_build_object(
    'year_start',       (SELECT start_date FROM fiscal_periods WHERE is_current),
    'invoices',         (SELECT count(*) FROM sales WHERE carried_forward AND NOT COALESCE(is_archived, false)),
    'owed_at_start',    (SELECT COALESCE(sum(amount), 0) FROM sales WHERE carried_forward AND NOT COALESCE(is_archived, false)),
    'collected',        (SELECT COALESCE(sum(COALESCE(amount_received, amount)), 0) FROM sales
                          WHERE carried_forward AND sales_status = 'Paid' AND NOT COALESCE(is_archived, false)),
    'withheld',         (SELECT COALESCE(sum(withheld_by_client), 0) FROM sales
                          WHERE carried_forward AND sales_status = 'Paid' AND NOT COALESCE(is_archived, false)),
    'still_owed',       (SELECT COALESCE(sum(amount), 0) FROM sales
                          WHERE carried_forward AND sales_status = 'Invoiced' AND NOT COALESCE(is_archived, false)),
    'opening_balance',  (SELECT sum(ob.amount) FROM opening_balances ob JOIN chart_of_accounts c ON c.id = ob.chart_of_accounts_id
                          WHERE c.account_code = '1050' AND ob.side = 'debit'),
    'opening_source',   (SELECT string_agg(ob.source, '; ') FROM opening_balances ob JOIN chart_of_accounts c ON c.id = ob.chart_of_accounts_id
                          WHERE c.account_code = '1050'),
    'opening_converted', EXISTS (SELECT 1 FROM journal_entries WHERE entry_type = 'opening_balance')
  ) END
$$;
REVOKE ALL ON FUNCTION carried_forward_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION carried_forward_summary() TO authenticated;

-- Writes the carried-forward total as the Accounts Receivable line of the
-- opening balances (replacing the one it wrote before). Refuses once the
-- opening balances have become a journal entry, and refuses to add a
-- second line beside one someone entered from the ERCA filing.
CREATE OR REPLACE FUNCTION set_opening_receivables_balance()
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ar uuid; v_total numeric; v_n int; v_start date; v_other text;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can set opening balances';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE entry_type = 'opening_balance') THEN
    RAISE EXCEPTION 'The opening balances are already posted to the ledger — change them with an adjusting entry instead';
  END IF;
  SELECT id INTO v_ar FROM chart_of_accounts WHERE account_code = '1050';
  SELECT string_agg(source, '; ') INTO v_other FROM opening_balances
   WHERE chart_of_accounts_id = v_ar AND source NOT LIKE 'Carried-forward receivables%';
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'An Accounts Receivable opening balance is already entered (%). Remove it first, or keep it and leave this one out', v_other;
  END IF;
  SELECT start_date INTO v_start FROM fiscal_periods WHERE is_current;
  SELECT COALESCE(sum(amount), 0), count(*) INTO v_total, v_n FROM sales WHERE carried_forward AND NOT COALESCE(is_archived, false);
  DELETE FROM opening_balances WHERE chart_of_accounts_id = v_ar AND source LIKE 'Carried-forward receivables%';
  IF v_total > 0 THEN
    INSERT INTO opening_balances (chart_of_accounts_id, amount, side, source, entered_by, notes)
    VALUES (v_ar, v_total, 'debit',
            'Carried-forward receivables: ' || v_n || ' invoice' || CASE WHEN v_n = 1 THEN '' ELSE 's' END
              || ' owed on ' || to_char(v_start, 'DD Mon YYYY'),
            auth.uid(), 'Written from the Owed from last year page (migration 370).');
  END IF;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION set_opening_receivables_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_opening_receivables_balance() TO authenticated;
