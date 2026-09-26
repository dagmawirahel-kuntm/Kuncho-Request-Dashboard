-- 342 — Bank statements, phase 2: one review queue with suggestions
--
-- A line is reconciled by pointing a record at its bank transaction (an
-- expense, a batch, a sale, a payroll run, a vendor request) or by saying
-- what it is when nothing on record explains it. Until now the only
-- automatic rule was "reference = an expense's bank reference", credits were
-- the only lines that could be explained, and payroll had its own panel.
--
-- 1. Suggestions (suggest_bank_line_matches) ranked by:
--      * the reference being a record's bank reference            (100)
--      * the narration naming the record — CBE narrations carry the
--        expense code (GENOTHE20260824 → GEN-OTHE-20260824-01), the vendor
--        request (GENVRF2026082801 → VRF-20260828-01) or the purchase order
--        (PO20260097 → PO-2026-0097)                 (95 with the amount)
--      * the amount: exact, or the amount plus the bank's transfer fee
--        (CBE adds a few birr to each debit), or near it; for sales, the
--        amount after the client's withholding
--      * payroll: SALARY narrations against a run's staff net pay
--      * the other side of a move between Kuncho's own accounts: an equal,
--        opposite line on another account within five days, or a credit
--        whose narration names another bank (TSEDEY… → Tsedey Bank)
-- 2. apply_bank_line_match(): one call for every kind, reusing the existing
--    matchers so payment states move exactly as they do elsewhere.
-- 3. classify_bank_line() / unclassify_bank_line(): explain a debit or a
--    credit (bank charge, withholding or payroll tax, loan, owner money,
--    other income or expense), posted to the ledger. A new "Bank Charges"
--    ledger account (51065) takes the charges.
-- 4. Internal transfers (pair_internal_transfer): Kuncho collects on other
--    banks and moves the money to CBE. Both lines of such a move are paired;
--    when the other bank's statement isn't in yet, a counterpart transaction
--    is recorded on that account so its balance still drops, and the other
--    bank's line takes its place when that statement arrives (343).
-- 5. Rules (bank_line_rules): "narration contains SERVICE CHARGE → bank
--    charge", "credit mentioning TSEDEY → internal from Tsedey Bank". Applied
--    on every import, after the reference and narration matches; a
--    narration match is applied automatically only when it is the single
--    best candidate and the amount fits.
-- 6. Balances counted a movement twice when a statement line and the record
--    it pays were both counted: a sale matched to its credit, a payroll run
--    paid by salary lines, a vendor request matched to the line that sent
--    it. account_balances_asof now counts the bank line once.
-- 7. v_paid_without_bank_line: payments marked paid on an account whose
--    statements cover the date, with no bank line behind them.

SET search_path TO public;

-- ── Ledger account for bank charges ─────────────────────────────────────
INSERT INTO chart_of_accounts (account_code, account_name, nature, category_id, parent_account_id, cash_flow_section)
SELECT '51065', 'Bank Charges', c.nature, c.category_id, c.parent_account_id, c.cash_flow_section
FROM chart_of_accounts c WHERE c.account_code = '51026'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '51065');

-- ── Transfers know where they came from and their other side ────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_source_check;
ALTER TABLE transfers ADD CONSTRAINT transfers_source_check CHECK (source IN ('statement', 'counterpart', 'manual'));
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS counterpart_id uuid REFERENCES transfers(id) ON DELETE SET NULL;
UPDATE transfers t SET source = 'statement'
  WHERE EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.transfer_id = t.id) AND t.source <> 'statement';

-- ── Status view learns internal transfers ───────────────────────────────
CREATE OR REPLACE VIEW v_bank_line_status WITH (security_invoker = true) AS
WITH base AS (
  SELECT l.*,
    CASE WHEN COALESCE(l.debit_amount, 0) > 0 THEN 'debit' ELSE 'credit' END AS direction,
    COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount, 0) AS amount
  FROM bank_statement_lines l
), links AS (
  SELECT b.id,
    (SELECT jsonb_build_object('id', bp.id, 'label', COALESCE(bp.payment_code, 'Batch payment'),
        'amount', (SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), 0) FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id WHERE x.batch_payment_id = bp.id))
     FROM batch_payments bp WHERE bp.transfer_id = b.transfer_id LIMIT 1) AS batch,
    (SELECT jsonb_agg(jsonb_build_object('id', e.id, 'label', COALESCE(e.expense_code, '') || ' ' || COALESCE(e.item_service_description, ''),
        'amount', COALESCE(e.net_payable, e.amount_etb)))
     FROM expenses e WHERE e.transfer_id = b.transfer_id
       AND NOT EXISTS (SELECT 1 FROM batch_payments bp WHERE bp.transfer_id = b.transfer_id)) AS expenses,
    (SELECT jsonb_agg(jsonb_build_object('id', s.id, 'label', COALESCE(s.invoice_number, '') || ' ' || COALESCE(s.sales_description, ''), 'amount', s.amount))
     FROM sales s WHERE s.transfer_id = b.transfer_id) AS sales,
    (SELECT jsonb_build_object('id', p.id, 'label', COALESCE(p.payroll_record, 'Payroll'),
        'amount', (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id))
     FROM payroll p WHERE p.transfer_id = b.transfer_id OR p.id = b.matched_payroll_id LIMIT 1) AS payroll,
    (SELECT jsonb_build_object('id', v.id, 'label', COALESCE(v.record_name, 'Vendor request'), 'amount', COALESCE(v.net_sent, v.amount_transferred))
     FROM vendor_receipt_facilitation v WHERE v.out_transfer_id = b.transfer_id LIMIT 1) AS vrf,
    (SELECT jsonb_build_object('account_id', a.id, 'account_name', a.account_name, 'source', ct.source,
        'line_id', (SELECT x.id FROM bank_statement_lines x WHERE x.transfer_id = ct.id LIMIT 1))
     FROM transfers t JOIN transfers ct ON ct.id = t.counterpart_id
     JOIN accounts a ON a.id = COALESCE(ct.from_account_id, ct.to_account_id)
     WHERE t.id = b.transfer_id) AS internal,
    EXISTS (SELECT 1 FROM vrf_returns r WHERE r.transfer_id = b.transfer_id) AS vrf_return,
    EXISTS (SELECT 1 FROM bank_balance_anchors a WHERE a.transfer_id = b.transfer_id) AS opening_balance
  FROM base b
)
SELECT b.id AS line_id, b.import_id, b.account_id, b.line_no, b.value_date, b.transaction_type, b.narration,
  b.reference, b.reference_code, b.debit_amount, b.credit_amount, b.running_balance, b.transfer_id,
  b.direction, b.amount, b.classification, b.classification_note,
  lk.batch, lk.expenses, lk.sales, lk.payroll, lk.vrf,
  CASE
    WHEN lk.batch IS NOT NULL      THEN 'batch'
    WHEN lk.expenses IS NOT NULL   THEN 'expense'
    WHEN lk.sales IS NOT NULL      THEN 'sale'
    WHEN lk.payroll IS NOT NULL    THEN 'payroll'
    WHEN lk.vrf IS NOT NULL        THEN 'vrf'
    WHEN lk.vrf_return             THEN 'vrf_return'
    WHEN lk.opening_balance        THEN 'opening_balance'
    WHEN b.classification = 'internal_transfer' THEN 'internal'
    WHEN b.classification IS NOT NULL THEN 'classified'
  END AS reconciled_as,
  CASE
    WHEN lk.batch IS NOT NULL    THEN (lk.batch->>'amount')::numeric
    WHEN lk.expenses IS NOT NULL THEN (SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(lk.expenses) x)
    WHEN lk.sales IS NOT NULL    THEN (SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(lk.sales) x)
    WHEN lk.payroll IS NOT NULL  THEN (lk.payroll->>'amount')::numeric
    WHEN lk.vrf IS NOT NULL      THEN (lk.vrf->>'amount')::numeric
  END AS linked_amount,
  lk.internal
FROM base b JOIN links lk ON lk.id = b.id;

-- ── Helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bank_norm(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(COALESCE(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Does a narration name this code? Either the code appears in one of its
-- words, or a word of 8+ characters is the start of the code (banks cut
-- narrations short), or the word carries the code without its trailing
-- sequence number (GENVRF20260901 for VRF-20260901-01).
CREATE OR REPLACE FUNCTION bank_text_names_code(p_text text, p_code text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  WITH c AS (SELECT bank_norm(p_code) AS code,
    CASE WHEN p_code ~ '-\d{1,2}$' THEN bank_norm(regexp_replace(p_code, '-\d{1,2}$', '')) END AS stem)
  SELECT length(c.code) >= 6 AND EXISTS (
    SELECT 1 FROM regexp_split_to_table(upper(COALESCE(p_text, '')), '[^A-Z0-9]+') w
    WHERE length(w) >= 8 AND (c.code LIKE w || '%' OR w LIKE '%' || c.code || '%'
      OR (length(c.stem) >= 8 AND w LIKE '%' || c.stem || '%')))
  FROM c
$$;

-- How well an amount fits a line: exact, the amount plus the bank's fee on
-- a debit, or near it.
CREATE OR REPLACE FUNCTION bank_amount_fit(p_line numeric, p_target numeric, p_direction text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_target IS NULL OR p_target <= 0 THEN 0
    WHEN abs(p_line - p_target) <= 0.01 THEN 60
    WHEN p_direction = 'debit' AND p_line - p_target > 0 AND p_line - p_target <= 25 THEN 55
    WHEN abs(p_line - p_target) <= greatest(1, p_target * 0.005) THEN 40
    WHEN abs(p_line - p_target) <= p_target * 0.02 THEN 20
    ELSE 0 END
$$;

-- The ledger account each explanation posts to.
CREATE OR REPLACE FUNCTION bank_classification_coa(p_classification text, p_direction text) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM chart_of_accounts WHERE account_code = CASE
    WHEN p_direction = 'debit' THEN CASE p_classification
      WHEN 'bank_charge' THEN '51065' WHEN 'withholding_tax' THEN '2025' WHEN 'payroll_tax' THEN '2020'
      WHEN 'loan_repayment' THEN '2030' WHEN 'owner_drawing' THEN '51037' WHEN 'other_expense' THEN '51026' END
    ELSE CASE p_classification
      WHEN 'other_income' THEN '4020' WHEN 'owner_injection' THEN '3020' WHEN 'loan_received' THEN '2030'
      WHEN 'vendor_refund' THEN '4020' WHEN 'wht_refund' THEN '2025' END
  END
$$;

CREATE OR REPLACE FUNCTION bank_line_guard(p_line_id uuid, p_allow_reconciled boolean DEFAULT false)
RETURNS v_bank_line_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT * INTO l FROM v_bank_line_status WHERE line_id = p_line_id;
  IF l.line_id IS NULL THEN RAISE EXCEPTION 'Bank line % not found', p_line_id; END IF;
  IF l.transfer_id IS NULL THEN RAISE EXCEPTION 'This line has no bank transaction'; END IF;
  IF bank_period_closed(l.account_id, l.value_date) THEN
    RAISE EXCEPTION 'The period this line is in (%) is closed — reopen it to change it', l.value_date;
  END IF;
  IF NOT p_allow_reconciled AND l.reconciled_as IS NOT NULL THEN
    RAISE EXCEPTION 'This line is already reconciled (%)', l.reconciled_as;
  END IF;
  RETURN l;
END; $$;

-- ── Explaining a line ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION classify_bank_line(p_line_id uuid, p_classification text, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status; v_cash uuid; v_other uuid; v_entry uuid; v_label text;
BEGIN
  l := bank_line_guard(p_line_id);
  IF p_classification = 'internal_transfer' THEN
    RAISE EXCEPTION 'Use pair_internal_transfer for a move between your own accounts';
  END IF;
  v_other := bank_classification_coa(p_classification, l.direction);
  IF v_other IS NULL THEN
    RAISE EXCEPTION '"%" is not a way to explain a % line', p_classification, l.direction;
  END IF;
  SELECT id INTO v_cash FROM chart_of_accounts WHERE linked_account_id = l.account_id;
  IF v_cash IS NULL THEN RAISE EXCEPTION 'No ledger cash account is linked to this bank account'; END IF;
  v_label := initcap(replace(p_classification, '_', ' '));

  INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
  VALUES (l.value_date, 'operational', 'bank_statement_lines', p_line_id,
    v_label || COALESCE(' — ' || NULLIF(btrim(p_note), ''), '') || COALESCE(' (' || NULLIF(l.narration, '') || ')', ''), auth.uid())
  RETURNING id INTO v_entry;
  IF l.direction = 'debit' THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry, v_other, l.amount, 0, v_label), (v_entry, v_cash, 0, l.amount, 'Paid from bank');
  ELSE
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry, v_cash, l.amount, 0, 'Received into bank'), (v_entry, v_other, 0, l.amount, v_label);
  END IF;

  UPDATE bank_statement_lines SET classification = p_classification, classification_note = NULLIF(btrim(p_note), ''),
    classified_by = auth.uid(), classified_at = now(), match_status = 'manual'
  WHERE id = p_line_id;
  RETURN v_entry;
END; $$;

-- Undo an explanation or an internal pairing (both sides of a pair).
CREATE OR REPLACE FUNCTION unclassify_bank_line(p_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status; v_other_tr uuid; v_other_line uuid;
BEGIN
  l := bank_line_guard(p_line_id, true);
  IF l.classification IS NULL THEN RAISE EXCEPTION 'This line is not explained — nothing to undo'; END IF;
  IF l.classification = 'internal_transfer' THEN
    SELECT counterpart_id INTO v_other_tr FROM transfers WHERE id = l.transfer_id;
    SELECT id INTO v_other_line FROM bank_statement_lines WHERE transfer_id = v_other_tr;
    IF v_other_line IS NOT NULL THEN
      IF bank_period_closed((SELECT account_id FROM bank_statement_lines WHERE id = v_other_line),
                            (SELECT value_date FROM bank_statement_lines WHERE id = v_other_line)) THEN
        RAISE EXCEPTION 'The other side of this transfer is in a closed period';
      END IF;
      DELETE FROM journal_entries WHERE source_table = 'bank_statement_lines' AND source_id = v_other_line;
      UPDATE bank_statement_lines SET classification = NULL, classification_note = NULL, classified_by = NULL,
        classified_at = NULL, match_status = 'unmatched' WHERE id = v_other_line;
    END IF;
    UPDATE transfers SET counterpart_id = NULL WHERE id IN (l.transfer_id, v_other_tr);
    -- A counterpart recorded only to stand in for the other bank's line goes.
    DELETE FROM transfers t WHERE t.id = v_other_tr AND t.source = 'counterpart'
      AND NOT EXISTS (SELECT 1 FROM bank_statement_lines x WHERE x.transfer_id = t.id);
  END IF;
  DELETE FROM journal_entries WHERE source_table = 'bank_statement_lines' AND source_id = p_line_id;
  UPDATE bank_statement_lines SET classification = NULL, classification_note = NULL, classified_by = NULL,
    classified_at = NULL, credit_classification = NULL, match_status = 'unmatched' WHERE id = p_line_id;
END; $$;

-- ── Moves between Kuncho's own accounts ─────────────────────────────────
-- Pair a line with the other bank's line, or — when that statement isn't
-- in — with a counterpart transaction on the other account.
CREATE OR REPLACE FUNCTION pair_internal_transfer(p_line_id uuid, p_other_line_id uuid DEFAULT NULL,
  p_other_account_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status; o v_bank_line_status; v_other_tr uuid; v_other_acct uuid;
  v_from uuid; v_to uuid; v_from_coa uuid; v_to_coa uuid; v_entry uuid;
BEGIN
  l := bank_line_guard(p_line_id);
  IF p_other_line_id IS NOT NULL THEN
    o := bank_line_guard(p_other_line_id);
    IF o.account_id = l.account_id THEN RAISE EXCEPTION 'Both lines are on the same account'; END IF;
    IF o.direction = l.direction THEN RAISE EXCEPTION 'A transfer is money out of one account and into another — these lines go the same way'; END IF;
    IF abs(o.amount - l.amount) > 0.01 THEN
      RAISE EXCEPTION 'The amounts differ (% vs %) — a fee charged on the same line can be explained separately', l.amount, o.amount;
    END IF;
    v_other_tr := o.transfer_id; v_other_acct := o.account_id;
    UPDATE bank_statement_lines SET classification = 'internal_transfer', classification_note = NULLIF(btrim(p_note), ''),
      classified_by = auth.uid(), classified_at = now(), match_status = 'manual' WHERE id = o.line_id;
  ELSE
    IF p_other_account_id IS NULL THEN RAISE EXCEPTION 'Pick the other account, or its line'; END IF;
    IF p_other_account_id = l.account_id THEN RAISE EXCEPTION 'The other account cannot be this one'; END IF;
    v_other_acct := p_other_account_id;
    INSERT INTO transfers (transfer_id_code, date, from_account_id, to_account_id, amount, notes, source, counterpart_id)
    VALUES (l.reference_code, l.value_date,
      CASE WHEN l.direction = 'credit' THEN v_other_acct END,
      CASE WHEN l.direction = 'debit' THEN v_other_acct END,
      l.amount, 'Other side of ' || COALESCE(l.reference, 'a transfer') || ' — until that bank''s statement is imported',
      'counterpart', l.transfer_id)
    RETURNING id INTO v_other_tr;
  END IF;
  UPDATE transfers SET counterpart_id = v_other_tr WHERE id = l.transfer_id;
  UPDATE transfers SET counterpart_id = l.transfer_id WHERE id = v_other_tr;
  UPDATE bank_statement_lines SET classification = 'internal_transfer', classification_note = NULLIF(btrim(p_note), ''),
    classified_by = auth.uid(), classified_at = now(), match_status = 'manual' WHERE id = p_line_id;

  -- One ledger entry for the move: into the receiving bank, out of the sender.
  v_to   := CASE WHEN l.direction = 'credit' THEN l.account_id ELSE v_other_acct END;
  v_from := CASE WHEN l.direction = 'credit' THEN v_other_acct ELSE l.account_id END;
  SELECT id INTO v_to_coa FROM chart_of_accounts WHERE linked_account_id = v_to;
  SELECT id INTO v_from_coa FROM chart_of_accounts WHERE linked_account_id = v_from;
  IF v_to_coa IS NULL OR v_from_coa IS NULL THEN RAISE EXCEPTION 'Both accounts need a linked ledger cash account'; END IF;
  INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
  VALUES (l.value_date, 'operational', 'bank_statement_lines', p_line_id,
    'Transfer ' || (SELECT account_name FROM accounts WHERE id = v_from) || ' → ' || (SELECT account_name FROM accounts WHERE id = v_to)
      || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''), auth.uid())
  RETURNING id INTO v_entry;
  INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
    (v_entry, v_to_coa, l.amount, 0, 'Transfer in'), (v_entry, v_from_coa, 0, l.amount, 'Transfer out');
END; $$;

-- ── Suggestions ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION suggest_bank_line_matches(p_line_id uuid)
RETURNS TABLE(kind text, target_id uuid, label text, detail text, amount numeric, target_date date, score int, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    -- Expenses not in a batch (a batch is matched as a whole).
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
      -- A vendor request's settlement expense is the same payment as the
      -- request; the request is offered and matching it takes both.
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
    -- Payroll: salary transfers go out one person at a time.
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
    -- Sales: the invoice amount, or what's left after the client's withholding.
    SELECT 'sale', s.id, btrim(COALESCE(s.invoice_number, '') || ' ' || COALESCE(s.sales_description, '')),
      COALESCE(c.client_name, '') || ' · ' || s.sales_status::text,
      s.amount, s.date,
      (s.bank_ref IS NOT NULL AND s.bank_ref = l.reference_code), bank_text_names_code(v_text, s.invoice_number),
      greatest(bank_amount_fit(l.amount, s.amount, 'credit'),
               bank_amount_fit(l.amount, s.amount - COALESCE(w.expected_wht, 0), 'credit'),
               -- Less than the invoice by up to 15%: the client held something back.
               CASE WHEN l.amount < s.amount AND l.amount >= s.amount * 0.85 THEN 30 ELSE 0 END),
      CASE WHEN c.client_name IS NOT NULL AND upper(v_text) LIKE '%' || upper(split_part(c.client_name, ' ', 1)) || '%' THEN 15 ELSE 0 END
    FROM sales s
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN v_sale_wht w ON w.sale_id = s.id
    WHERE l.direction = 'credit' AND s.transfer_id IS NULL AND NOT COALESCE(s.is_archived, false)
      AND s.date BETWEEN l.value_date - 180 AND l.value_date + 10
    UNION ALL
    -- The other side of an internal move, already on another statement.
    SELECT 'internal_line', o.line_id, 'Transfer ' || CASE WHEN o.direction = 'debit' THEN 'from ' ELSE 'to ' END || a.account_name,
      COALESCE(o.narration, o.reference, ''), o.amount, o.value_date,
      false, false, CASE WHEN abs(o.amount - l.amount) <= 0.01 THEN 80 ELSE 0 END, 0
    FROM v_bank_line_status o JOIN accounts a ON a.id = o.account_id
    WHERE o.account_id <> l.account_id AND o.direction <> l.direction AND o.reconciled_as IS NULL
      AND abs(o.amount - l.amount) <= 0.01 AND o.value_date BETWEEN l.value_date - 5 AND l.value_date + 5
    UNION ALL
    -- A credit naming another bank Kuncho holds an account at.
    SELECT 'internal_account', a.id, 'Transfer ' || CASE WHEN l.direction = 'credit' THEN 'from ' ELSE 'to ' END || a.account_name,
      'Kuncho''s own account', l.amount, l.value_date, false, false, 60, 0
    FROM accounts a
    WHERE a.id <> l.account_id AND length(split_part(a.account_name, ' ', 1)) >= 4
      AND upper(v_text) LIKE '%' || upper(split_part(a.account_name, ' ', 1)) || '%'
    UNION ALL
    -- A purchase order the narration names but that has no expense to match:
    -- its payment was never recorded.
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
END; $$;

-- ── Applying a match ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_bank_line_match(p_line_id uuid, p_kind text, p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status; v_amt numeric; f record; ex record;
BEGIN
  l := bank_line_guard(p_line_id);
  IF p_kind IN ('expense', 'batch', 'vrf', 'payroll') AND l.direction <> 'debit' THEN
    RAISE EXCEPTION 'Money coming in cannot pay a %', p_kind;
  END IF;
  IF p_kind = 'sale' AND l.direction <> 'credit' THEN RAISE EXCEPTION 'Money going out cannot settle a sale'; END IF;

  IF p_kind = 'expense' THEN
    SELECT COALESCE(net_payable, amount_etb) INTO v_amt FROM expenses WHERE id = p_target_id AND transfer_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That expense is not open for a bank line'; END IF;
    PERFORM match_expense_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET matched_expense_id = p_target_id, matched_expense_amount = v_amt,
      variance_amount = l.amount - v_amt, match_status = 'matched_expense' WHERE id = p_line_id;
  ELSIF p_kind = 'batch' THEN
    IF EXISTS (SELECT 1 FROM batch_payments WHERE id = p_target_id AND transfer_id IS NOT NULL) THEN
      RAISE EXCEPTION 'That batch already has a bank line';
    END IF;
    PERFORM match_batch_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET match_status = 'matched_expense' WHERE id = p_line_id;
  ELSIF p_kind = 'sale' THEN
    SELECT amount INTO v_amt FROM sales WHERE id = p_target_id AND transfer_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That sale is not open for a bank line'; END IF;
    PERFORM match_sale_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET matched_sale_id = p_target_id, matched_expense_amount = v_amt,
      variance_amount = l.amount - v_amt, match_status = 'matched_sale' WHERE id = p_line_id;
  ELSIF p_kind = 'payroll' THEN
    IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_target_id) THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
    -- A run is paid by one line or by one line per person.
    UPDATE bank_statement_lines SET matched_payroll_id = p_target_id, match_status = 'manual' WHERE id = p_line_id;
  ELSIF p_kind = 'vrf' THEN
    SELECT * INTO f FROM vendor_receipt_facilitation WHERE id = p_target_id AND NOT is_archived;
    IF NOT FOUND THEN RAISE EXCEPTION 'Vendor request not found'; END IF;
    IF f.out_transfer_id IS NOT NULL THEN RAISE EXCEPTION 'That vendor request already has a bank line'; END IF;
    IF f.payment_state = 'approved' THEN
      PERFORM mark_vrf_sent(p_target_id, l.transfer_id, NULL);
    ELSE
      -- Already marked sent (or further) by date: attach the line.
      PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
      UPDATE vendor_receipt_facilitation SET out_transfer_id = l.transfer_id WHERE id = p_target_id;
      PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
    END IF;
    -- Its settlement expense (GEN-VRF-… for VRF-…) is the same payment.
    FOR ex IN SELECT e.id FROM expenses e
              WHERE f.record_name IS NOT NULL AND e.transfer_id IS NULL AND e.expense_code LIKE '%' || f.record_name
                AND abs(COALESCE(e.net_payable, e.amount_etb) - COALESCE(f.net_sent, f.amount_transferred)) <= 1 LOOP
      PERFORM match_expense_to_transfer(ex.id, l.transfer_id);
    END LOOP;
    UPDATE bank_statement_lines SET match_status = 'manual' WHERE id = p_line_id;
  ELSIF p_kind = 'internal_line' THEN
    PERFORM pair_internal_transfer(p_line_id, p_target_id, NULL, NULL);
  ELSIF p_kind = 'internal_account' THEN
    PERFORM pair_internal_transfer(p_line_id, NULL, p_target_id, NULL);
  ELSIF p_kind = 'purchase_order' THEN
    RAISE EXCEPTION 'This purchase order has no payment recorded — record the payment on the order first, then match the line to it';
  ELSE
    RAISE EXCEPTION 'Unknown match kind %', p_kind;
  END IF;
END; $$;

-- ── Rules ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_line_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_text         text NOT NULL CHECK (length(btrim(match_text)) >= 3),
  direction          text CHECK (direction IN ('debit', 'credit')),
  account_id         uuid REFERENCES accounts(id) ON DELETE CASCADE,
  classification     text NOT NULL,
  counter_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  note               text,
  is_active          boolean NOT NULL DEFAULT true,
  times_applied      int NOT NULL DEFAULT 0,
  last_applied_at    timestamptz,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (classification <> 'internal_transfer' OR counter_account_id IS NOT NULL)
);
ALTER TABLE bank_line_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_line_rules_rw ON bank_line_rules;
CREATE POLICY bank_line_rules_rw ON bank_line_rules FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]));
REVOKE ALL ON bank_line_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_line_rules TO authenticated;

-- ── Automatic reconciliation (on import, or on demand) ──────────────────
-- 1. exact bank reference; 2. a narration that names a single record whose
-- amount fits; 3. rules. Everything else waits in the queue.
CREATE OR REPLACE FUNCTION auto_reconcile_bank_lines(p_import_id uuid DEFAULT NULL, p_account_id uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; s record; s2 record; v_expense uuid; v_batch uuid; v_sale uuid; v_done int := 0; ru record;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  FOR r IN
    SELECT st.* FROM v_bank_line_status st
    WHERE st.reconciled_as IS NULL AND st.transfer_id IS NOT NULL
      AND (p_import_id IS NULL OR st.import_id = p_import_id)
      AND (p_account_id IS NULL OR st.account_id = p_account_id)
      AND NOT bank_period_closed(st.account_id, st.value_date)
    ORDER BY st.value_date, st.line_no
  LOOP
    -- 1. The reference is the record's bank reference.
    v_expense := NULL; v_batch := NULL; v_sale := NULL;
    -- Each step leaves a line for review if a payment rule stops it (a
    -- purchase with no goods received yet, say) instead of failing the run.
    IF r.reference_code IS NOT NULL THEN
      IF r.direction = 'debit' THEN
        SELECT e.id, x.batch_payment_id INTO v_expense, v_batch FROM expenses e
          LEFT JOIN batch_payment_expenses x ON x.expense_id = e.id
          WHERE e.bank_ref = r.reference_code AND e.transfer_id IS NULL LIMIT 1;
      ELSE
        SELECT id INTO v_sale FROM sales WHERE bank_ref = r.reference_code AND transfer_id IS NULL LIMIT 1;
      END IF;
      IF COALESCE(v_batch, v_expense, v_sale) IS NOT NULL THEN
        BEGIN
          IF v_batch IS NOT NULL THEN PERFORM apply_bank_line_match(r.line_id, 'batch', v_batch);
          ELSIF v_expense IS NOT NULL THEN PERFORM apply_bank_line_match(r.line_id, 'expense', v_expense);
          ELSE PERFORM apply_bank_line_match(r.line_id, 'sale', v_sale); END IF;
          v_done := v_done + 1; CONTINUE;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END IF;
    END IF;

    -- 2. The narration names one record and the amount fits.
    SELECT * INTO s FROM suggest_bank_line_matches(r.line_id) x ORDER BY x.score DESC LIMIT 1;
    SELECT * INTO s2 FROM suggest_bank_line_matches(r.line_id) x ORDER BY x.score DESC OFFSET 1 LIMIT 1;
    IF s.score >= 95 AND s.kind IN ('expense', 'batch', 'vrf', 'sale') AND (s2.score IS NULL OR s2.score < 95) THEN
      BEGIN
        PERFORM apply_bank_line_match(r.line_id, s.kind, s.target_id); v_done := v_done + 1; CONTINUE;
      EXCEPTION WHEN OTHERS THEN NULL;  -- leave it for review
      END;
    END IF;

    -- 3. A rule.
    SELECT * INTO ru FROM bank_line_rules b
      WHERE b.is_active AND (b.direction IS NULL OR b.direction = r.direction)
        AND (b.account_id IS NULL OR b.account_id = r.account_id)
        AND upper(COALESCE(r.narration, '') || ' ' || COALESCE(r.reference, '') || ' ' || COALESCE(r.transaction_type, ''))
            LIKE '%' || upper(btrim(b.match_text)) || '%'
      ORDER BY length(b.match_text) DESC LIMIT 1;
    IF ru.id IS NOT NULL THEN
      BEGIN
        IF ru.classification = 'internal_transfer' THEN
          PERFORM pair_internal_transfer(r.line_id, NULL, ru.counter_account_id, ru.note);
        ELSE
          PERFORM classify_bank_line(r.line_id, ru.classification, ru.note);
        END IF;
        UPDATE bank_line_rules SET times_applied = times_applied + 1, last_applied_at = now() WHERE id = ru.id;
        v_done := v_done + 1;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;
  RETURN v_done;
END; $$;

-- ── Paid in the app, but no bank line behind it ─────────────────────────
CREATE OR REPLACE VIEW v_paid_without_bank_line WITH (security_invoker = true) AS
WITH coverage AS (
  SELECT account_id, min(value_date) AS first_date, max(value_date) AS last_date
  FROM bank_statement_lines GROUP BY account_id
)
SELECT 'expense'::text AS kind, e.id, e.expense_code AS code, e.item_service_description AS description,
  COALESCE(e.net_payable, e.amount_etb) AS amount, e.account_id, a.account_name,
  COALESCE(e.payment_state_changed_at::date, e.date) AS paid_on, e.payment_method::text AS method
FROM expenses e
JOIN coverage c ON c.account_id = e.account_id
JOIN accounts a ON a.id = e.account_id
WHERE e.payment_state = 'paid' AND e.transfer_id IS NULL
  AND e.payment_method IN ('transfer', 'cpo', 'cheque')
  AND COALESCE(e.payment_state_changed_at::date, e.date) BETWEEN c.first_date AND c.last_date
UNION ALL
SELECT 'sale', s.id, s.invoice_number, s.sales_description, s.amount, s.account_id, a.account_name,
  COALESCE(s.payment_date, s.date), s.payment_method
FROM sales s
JOIN coverage c ON c.account_id = s.account_id
JOIN accounts a ON a.id = s.account_id
WHERE s.sales_status = 'Paid' AND s.transfer_id IS NULL AND NOT COALESCE(s.is_archived, false)
  AND COALESCE(s.payment_date, s.date) BETWEEN c.first_date AND c.last_date;
REVOKE ALL ON v_paid_without_bank_line FROM PUBLIC, anon;
GRANT SELECT ON v_paid_without_bank_line TO authenticated;

-- ── Count each bank movement once ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_balances_asof(p_cutoff date)
 RETURNS TABLE(id uuid, account_name text, type text, status text, balance numeric, opening_balance numeric, opening_balance_as_of date, total_sales_in numeric, total_transfers_in numeric, total_vrf_returned_in numeric, total_expenses_out numeric, total_advances_out numeric, total_payroll_out numeric, total_vrf_transferred_out numeric, total_transfers_out numeric)
 LANGUAGE sql STABLE
AS $function$
  WITH
    latest_anchor AS (
      SELECT DISTINCT ON (account_id) account_id, as_of_date, balance, transfer_id
      FROM bank_balance_anchors
      WHERE as_of_date <= p_cutoff
      ORDER BY account_id, as_of_date DESC
    ),
    counted_out AS (
      SELECT t.id, t.from_account_id AS account_id, t.amount
      FROM public.transfers t
      LEFT JOIN latest_anchor la ON la.account_id = t.from_account_id
      WHERE t.from_account_id IS NOT NULL AND t.date <= p_cutoff
        AND (
          la.as_of_date IS NULL
          OR t.date > la.as_of_date
          OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
        )
    ),
    counted_in AS (
      SELECT t.id, t.to_account_id AS account_id, t.amount
      FROM public.transfers t
      LEFT JOIN latest_anchor la ON la.account_id = t.to_account_id
      WHERE t.to_account_id IS NOT NULL AND t.date <= p_cutoff
        AND (
          la.as_of_date IS NULL
          OR t.date > la.as_of_date
          OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
        )
    ),
    counted_vrf_out AS (
      SELECT v.id, v.initial_account_id AS account_id, v.amount_transferred AS amount, v.out_transfer_id
      FROM public.vendor_receipt_facilitation v
      LEFT JOIN latest_anchor la ON la.account_id = v.initial_account_id
      WHERE v.initial_account_id IS NOT NULL AND v.trxn_date <= p_cutoff
        AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
    ),
    transfers_out AS (SELECT account_id, COALESCE(SUM(amount), 0) AS total FROM counted_out     GROUP BY account_id),
    transfers_in  AS (SELECT account_id, COALESCE(SUM(amount), 0) AS total FROM counted_in      GROUP BY account_id),
    -- A vendor request whose bank line is counted is already out of the account.
    vrf_out       AS (SELECT cv.account_id, COALESCE(SUM(cv.amount), 0) AS total FROM counted_vrf_out cv
                      WHERE NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = cv.out_transfer_id AND co.account_id = cv.account_id)
                      GROUP BY cv.account_id),
    vrf_in AS (
      SELECT v.return_account_id AS account_id, COALESCE(SUM(v.money_returned), 0) AS total
      FROM public.vendor_receipt_facilitation v
      LEFT JOIN latest_anchor la ON la.account_id = v.return_account_id
      WHERE v.return_account_id IS NOT NULL AND v.trxn_date <= p_cutoff
        AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
      GROUP BY v.return_account_id
    ),
    sales_in AS (
      SELECT s.account_id, COALESCE(SUM(s.amount), 0) AS total
      FROM public.sales s
      LEFT JOIN latest_anchor la ON la.account_id = s.account_id
      WHERE s.account_id IS NOT NULL AND s.sales_status = 'Paid'
        AND s.date <= p_cutoff
        AND (la.as_of_date IS NULL OR s.date > la.as_of_date)
        -- A sale matched to its bank credit is counted by that credit.
        AND NOT EXISTS (SELECT 1 FROM counted_in ci WHERE ci.id = s.transfer_id AND ci.account_id = s.account_id)
      GROUP BY s.account_id
    ),
    expenses_out AS (
      SELECT e.account_id, COALESCE(SUM(e.amount_etb), 0) AS total
      FROM public.expenses e
      LEFT JOIN latest_anchor la ON la.account_id = e.account_id
      WHERE e.account_id IS NOT NULL AND e.payment_status = true
        AND e.date <= p_cutoff
        AND (la.as_of_date IS NULL OR e.date > la.as_of_date)
        AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = e.transfer_id AND co.account_id = e.account_id)
        AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = e.vrf_id     AND cv.account_id = e.account_id)
        AND NOT EXISTS (
          SELECT 1 FROM batch_payment_expenses bpe
          JOIN batch_payments bp ON bp.id = bpe.batch_payment_id
          JOIN counted_out co ON co.id = bp.transfer_id AND co.account_id = e.account_id
          WHERE bpe.expense_id = e.id
        )
      GROUP BY e.account_id
    ),
    payroll_out AS (
      SELECT p.account_id, COALESCE(SUM(ps.net_amount), 0) AS total
      FROM public.payroll p
      JOIN public.payroll_staff ps ON ps.payroll_id = p.id
      LEFT JOIN latest_anchor la ON la.account_id = p.account_id
      WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid'
        AND p.end_date <= p_cutoff
        AND (la.as_of_date IS NULL OR p.end_date > la.as_of_date)
        AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = p.transfer_id AND co.account_id = p.account_id)
        AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = p.vrf_id     AND cv.account_id = p.account_id)
        -- A run paid by salary lines is counted by those lines.
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines bl JOIN counted_out co ON co.id = bl.transfer_id
                        WHERE bl.matched_payroll_id = p.id AND co.account_id = p.account_id)
      GROUP BY p.account_id
    ),
    advances_out AS (
      SELECT ca.account_used_id AS account_id, COALESCE(SUM(ca.amount_advanced), 0) AS total
      FROM public.cash_advances ca
      LEFT JOIN latest_anchor la ON la.account_id = ca.account_used_id
      WHERE ca.account_used_id IS NOT NULL AND ca.approval_status = 'finance_approved'
        AND ca.date_given <= p_cutoff
        AND (la.as_of_date IS NULL OR ca.date_given > la.as_of_date)
      GROUP BY ca.account_used_id
    )
  SELECT
    a.id, a.account_name, a.type, a.status,
    COALESCE(la.balance, 0) + COALESCE(si.total, 0) + COALESCE(ti.total, 0) + COALESCE(vi.total, 0)
      - COALESCE(eo.total, 0) - COALESCE(ao.total, 0)
      - COALESCE(po.total, 0) - COALESCE(vo.total, 0) - COALESCE(to2.total, 0) AS balance,
    COALESCE(la.balance, 0)  AS opening_balance,
    la.as_of_date            AS opening_balance_as_of,
    COALESCE(si.total, 0), COALESCE(ti.total, 0), COALESCE(vi.total, 0),
    COALESCE(eo.total, 0), COALESCE(ao.total, 0), COALESCE(po.total, 0),
    COALESCE(vo.total, 0), COALESCE(to2.total, 0)
  FROM public.accounts a
  LEFT JOIN latest_anchor la  ON la.account_id  = a.id
  LEFT JOIN sales_in      si  ON si.account_id  = a.id
  LEFT JOIN expenses_out  eo  ON eo.account_id  = a.id
  LEFT JOIN advances_out  ao  ON ao.account_id  = a.id
  LEFT JOIN payroll_out   po  ON po.account_id  = a.id
  LEFT JOIN vrf_out       vo  ON vo.account_id  = a.id
  LEFT JOIN vrf_in        vi  ON vi.account_id  = a.id
  LEFT JOIN transfers_in  ti  ON ti.account_id  = a.id
  LEFT JOIN transfers_out to2 ON to2.account_id = a.id;
$function$;

-- ── A payer's later role change doesn't undo their payment ─────────────
-- enforce_expense_payment_lifecycle checked the payer's *current* role on
-- every update, so once someone who sent payments moved from finance to
-- executive, none of their payments could be confirmed against the bank
-- (39 at the time). The role is checked when the payer is recorded.
CREATE OR REPLACE FUNCTION public.enforce_expense_payment_lifecycle()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy UUID; v_row_fy UUID; v_is_current BOOLEAN;
  v_payment_pattern TEXT; v_grn_exists BOOLEAN;
BEGIN
  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  v_is_current := (v_row_fy IS NOT NULL AND v_row_fy = v_current_fy);
  IF v_is_current THEN
    IF TG_OP = 'UPDATE' AND NEW.payment_status IS DISTINCT FROM OLD.payment_status
       AND NEW.payment_state IS NOT DISTINCT FROM OLD.payment_state THEN
      RAISE EXCEPTION 'payment_status can no longer be set directly on a current fiscal year expense — use payment_state instead';
    END IF;
    IF NEW.payment_state IN ('approved_to_pay','sent','paid','advance') AND NEW.finance_approved_by IS NULL THEN
      RAISE EXCEPTION 'A current fiscal year expense needs a real finance approver (finance_approved_by) before it can reach %', NEW.payment_state;
    END IF;
    IF NEW.payment_state IN ('sent','paid','advance') THEN
      IF NEW.disbursed_by IS NULL THEN
        RAISE EXCEPTION 'A current fiscal year expense needs a payer identity (disbursed_by) before it can reach %', NEW.payment_state;
      END IF;
      IF NEW.disbursed_by = NEW.finance_approved_by THEN
        RAISE EXCEPTION 'The same person cannot both approve (finance_approved_by) and pay (disbursed_by) an expense';
      END IF;
      IF (TG_OP = 'INSERT' OR NEW.disbursed_by IS DISTINCT FROM OLD.disbursed_by)
         AND (SELECT role FROM user_profiles WHERE id = NEW.disbursed_by) NOT IN ('admin','finance') THEN
        RAISE EXCEPTION 'disbursed_by must be an admin or finance user';
      END IF;
    END IF;
    IF NEW.payment_state = 'advance' AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance') THEN
      IF NEW.sourcing_bundle_id IS NULL THEN
        RAISE EXCEPTION 'advance is only meaningful for an expense linked to a sourcing_bundle (payment_pattern is declared there)';
      END IF;
      SELECT payment_pattern INTO v_payment_pattern FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
      IF v_payment_pattern IS DISTINCT FROM 'pay_in_advance' THEN
        RAISE EXCEPTION 'This purchase order is not marked pay-in-advance — set sourcing_bundles.payment_pattern first';
      END IF;
    END IF;
    IF NEW.payment_state = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'paid') THEN
      IF NEW.payment_method IN ('transfer','cpo','cheque')
         AND NEW.transfer_id IS NULL
         AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance') THEN
        RAISE EXCEPTION 'A % payment can only be confirmed by matching it to an imported bank statement line', NEW.payment_method;
      END IF;
      IF NEW.sourcing_bundle_id IS NOT NULL THEN
        SELECT payment_pattern INTO v_payment_pattern FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
        v_grn_exists := EXISTS (SELECT 1 FROM goods_received_notes WHERE sourcing_bundle_id = NEW.sourcing_bundle_id);
        IF v_payment_pattern = 'pay_in_advance' THEN
          IF TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance' THEN
            RAISE EXCEPTION 'This purchase is pay-in-advance — record the payment as payment_state = advance first, then close it via close_vendor_advance() once a GRN exists';
          END IF;
          IF NOT v_grn_exists THEN
            RAISE EXCEPTION 'Cannot close this advance: no GRN exists yet for the linked purchase order';
          END IF;
        ELSE
          IF NOT v_grn_exists THEN
            RAISE EXCEPTION 'This purchase is pay-on-delivery — a GRN must exist for its purchase order before the expense can be marked paid';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  NEW.payment_status := (NEW.payment_state = 'paid');
  IF TG_OP = 'INSERT' OR NEW.payment_state IS DISTINCT FROM OLD.payment_state THEN
    NEW.payment_state_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION bank_line_guard(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION classify_bank_line(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION classify_bank_line(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION unclassify_bank_line(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION unclassify_bank_line(uuid) TO authenticated;
REVOKE ALL ON FUNCTION pair_internal_transfer(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pair_internal_transfer(uuid, uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION suggest_bank_line_matches(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION suggest_bank_line_matches(uuid) TO authenticated;
REVOKE ALL ON FUNCTION apply_bank_line_match(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_bank_line_match(uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION auto_reconcile_bank_lines(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auto_reconcile_bank_lines(uuid, uuid) TO authenticated;
