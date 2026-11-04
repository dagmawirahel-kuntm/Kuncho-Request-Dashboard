-- 498: more bank lines match themselves, and the rest are quicker to settle.
--
-- 1. Codes typed into the narration. CBE's narration box takes no special
--    characters, so finance types the purchase order or payment request
--    without its dashes: PO20260380 is PO-2026-0380 (the order a purchaser
--    sent to finance), PRQ20260130 is PRQ-2026-0130 (anything requested
--    some other way and paid through a payment request: an expense, a batch,
--    payroll, a vendor request or one part of an expense). A zero dropped
--    while typing still reads: PO2026383 is PO-2026-0383.
-- 2. Who made a payment. An approved expense reaches paid only with a payer
--    who isn't its approver (the two-person rule), and a bank line doesn't
--    say who it was — so automatic matching failed on every approved
--    expense with no payer recorded. Each account can now name who usually
--    makes its payments, and the match screen can say who did.
-- 3. Bank charges on a line of their own (the RTGS charge and its VAT, a
--    service fee, the 165 after each Awash transfer) settle as bank charges.
-- 4. Money moved between Kuncho's own accounts pairs itself: the narration
--    names the other account's number, or the same amount left one account
--    and reached another the same day with nothing else to explain it.
-- 5. Cheque numbers in the narration ("CHEQUE NO :- 6402764") match the
--    payment or receipt carrying that cheque number as its bank reference.
-- 6. An expense can be recorded straight from its bank line.
-- 7. The reconciliation statement for an account on a date: the bank's
--    balance against the books', every difference named.

-- ── Codes and cheque numbers in a narration ────────────────────────────
CREATE OR REPLACE FUNCTION public.bank_doc_codes(p_text text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT COALESCE(array_agg(DISTINCT format('%s-%s-%s', m[1], m[2], lpad(m[3]::int::text, 4, '0'))), '{}')
  FROM regexp_matches(upper(COALESCE(p_text, '')),
                      '(?<![A-Z0-9])(PRQ|PO)[^A-Z0-9]{0,2}(20[0-9]{2})[^A-Z0-9]{0,2}([0-9]{1,5})(?![0-9])', 'g') AS m
$f$;

CREATE OR REPLACE FUNCTION public.bank_cheque_numbers(p_text text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT COALESCE(array_agg(DISTINCT m[1]), '{}')
  FROM regexp_matches(upper(COALESCE(p_text, '')), '(?:CHEQUE|CHQ)[^0-9]{0,12}([0-9]{6,12})(?![0-9])', 'g') AS m
$f$;

-- ── Who makes an account's payments ────────────────────────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_payer_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL;
COMMENT ON COLUMN accounts.default_payer_id IS 'Who usually makes this account''s payments (admin or finance). Used as the payer when a bank line confirms an approved expense nobody is recorded as paying (498).';

CREATE OR REPLACE FUNCTION public.set_account_payer(p_account_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance set who makes an account''s payments';
  END IF;
  IF p_user_id IS NOT NULL AND COALESCE((SELECT role::text FROM user_profiles WHERE id = p_user_id), '') NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Who makes payments must be an admin or finance user';
  END IF;
  UPDATE accounts SET default_payer_id = p_user_id, updated_at = now() WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
END $f$;

-- ── A bank charge on a line of its own ─────────────────────────────────
-- Small money out that is the bank's own charge: it carries the reference
-- (or the narration) of a bigger payment the same day, or the bank's words.
CREATE OR REPLACE FUNCTION public.bank_line_fee(p_line_id uuid)
RETURNS TABLE(reason text, main_line_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH l AS (SELECT * FROM v_bank_line_status WHERE line_id = p_line_id AND direction = 'debit' AND amount <= 1000)
  SELECT x.reason, x.main_line_id FROM (
    SELECT 'Charge on the payment of ' || to_char(m.amount, 'FM999,999,999,990.00') || ' it shares '
             || CASE WHEN l.reference_code IS NOT NULL AND m.reference_code = l.reference_code THEN 'a reference with' ELSE 'a narration with' END AS reason,
           m.line_id AS main_line_id, 1 AS pri, abs(m.value_date - l.value_date) AS gap
      FROM l JOIN v_bank_line_status m
        ON m.account_id = l.account_id AND m.line_id <> l.line_id AND m.direction = 'debit'
       AND m.amount >= l.amount * 10 AND m.value_date BETWEEN l.value_date - 1 AND l.value_date + 1
       AND ((l.reference_code IS NOT NULL AND m.reference_code = l.reference_code)
            OR (length(btrim(COALESCE(l.narration, ''))) >= 8 AND m.narration = l.narration))
    UNION ALL
    SELECT 'The bank''s wording: a charge, fee or the VAT on one', NULL::uuid, 2, 0
      FROM l
     WHERE upper(COALESCE(l.narration, '') || ' ' || COALESCE(l.transaction_type, ''))
           ~ '(\mCHARGES?\M|COMMISSION|\mFEES?\M|\mVAT\M|\mSMS\M|STAMP DUTY|LEDGER FEE|S?TT?AT?E?MENT)'
  ) x
  ORDER BY x.pri, x.gap
  LIMIT 1
$f$;

-- ── The other side of a transfer between Kuncho's own accounts ─────────
CREATE OR REPLACE FUNCTION public.bank_own_transfer_partner(p_line_id uuid)
RETURNS TABLE(other_line_id uuid, other_account_id uuid, reason text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l v_bank_line_status; v_digits text; a record; v_line uuid; v_n int; v_back int; v_covered boolean;
BEGIN
  SELECT * INTO l FROM v_bank_line_status WHERE line_id = p_line_id AND reconciled_as IS NULL;
  IF l.line_id IS NULL THEN RETURN; END IF;
  v_digits := ' ' || regexp_replace(upper(COALESCE(l.narration, '') || ' ' || COALESCE(l.reference, '')), '[^0-9]+', ' ', 'g') || ' ';

  -- 1. The narration names another of Kuncho's accounts by its number.
  FOR a IN SELECT x.id, x.account_name, ltrim(regexp_replace(COALESCE(x.account_number, ''), '\D', '', 'g'), '0') AS num
             FROM accounts x WHERE x.id <> l.account_id AND x.type IN ('Bank', 'Bank Account', 'Personal Account') LOOP
    CONTINUE WHEN length(a.num) < 8 OR v_digits !~ (' 0*' || a.num || ' ');
    SELECT count(*), min(m.line_id::text)::uuid INTO v_n, v_line FROM v_bank_line_status m
     WHERE m.account_id = a.id AND m.direction <> l.direction AND m.reconciled_as IS NULL
       AND abs(m.amount - l.amount) <= 0.01 AND m.value_date BETWEEN l.value_date - 5 AND l.value_date + 5;
    IF v_n = 1 THEN
      RETURN QUERY SELECT v_line, NULL::uuid, 'The narration names ' || a.account_name || '''s account number'; RETURN;
    END IF;
    -- Its statement isn't in for those days: book this side, the other follows on import.
    v_covered := EXISTS (SELECT 1 FROM bank_statement_lines s WHERE s.account_id = a.id AND s.value_date BETWEEN l.value_date - 3 AND l.value_date + 3);
    IF v_n = 0 AND NOT v_covered THEN
      RETURN QUERY SELECT NULL::uuid, a.id, 'The narration names ' || a.account_name || '''s account number; its statement for those days isn''t imported yet'; RETURN;
    END IF;
  END LOOP;

  -- 2. The same amount left one account and reached another the same day,
  --    each the only candidate for the other, and nothing else names them.
  IF l.amount >= 1000 AND cardinality(bank_doc_codes(l.narration)) = 0 THEN
    SELECT count(*), min(m.line_id::text)::uuid INTO v_n, v_line FROM v_bank_line_status m JOIN accounts x ON x.id = m.account_id
     WHERE m.account_id <> l.account_id AND x.type IN ('Bank', 'Bank Account', 'Personal Account')
       AND m.direction <> l.direction AND m.reconciled_as IS NULL
       AND abs(m.amount - l.amount) <= 0.01 AND m.value_date = l.value_date
       AND cardinality(bank_doc_codes(m.narration)) = 0;
    IF v_n = 1 THEN
      SELECT count(*) INTO v_back FROM v_bank_line_status k, v_bank_line_status m
       WHERE m.line_id = v_line AND k.account_id <> m.account_id AND k.direction <> m.direction AND k.reconciled_as IS NULL
         AND abs(k.amount - m.amount) <= 0.01 AND k.value_date = m.value_date;
      IF v_back = 1 THEN
        RETURN QUERY SELECT v_line, NULL::uuid, 'The same amount left one of Kuncho''s accounts and reached another the same day'; RETURN;
      END IF;
    END IF;
  END IF;
END $f$;

-- ── Matching: who paid, and bank charges ───────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_bank_line_match(p_line_id uuid, p_kind text, p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_amt numeric; f record; ex record; q expense_payments%ROWTYPE; e expenses%ROWTYPE;
        v_payer uuid; v_fee record;
BEGIN
  l := bank_line_guard(p_line_id);
  IF p_kind IN ('expense', 'expense_part', 'batch', 'vrf', 'vrf_part', 'payroll', 'bank_charge') AND l.direction <> 'debit' THEN
    RAISE EXCEPTION 'Money coming in cannot pay a %', replace(p_kind, '_', ' ');
  END IF;
  IF p_kind = 'sale' AND l.direction <> 'credit' THEN RAISE EXCEPTION 'Money going out cannot settle a sale'; END IF;
  IF p_kind = 'expense' THEN
    SELECT * INTO e FROM expenses WHERE id = p_target_id AND transfer_id IS NULL;
    IF e.id IS NULL THEN RAISE EXCEPTION 'That expense is not open for a bank line'; END IF;
    IF e.payment_state NOT IN ('approved_to_pay', 'sent', 'paid', 'advance') THEN
      RAISE EXCEPTION '% isn''t approved for payment yet — approve it, then match the line', COALESCE(e.expense_code, 'This expense');
    END IF;
    -- The bank confirms the money left; the two-person rule still needs who paid.
    IF e.disbursed_by IS NULL AND e.payment_state = 'approved_to_pay' THEN
      v_payer := COALESCE(NULLIF(current_setting('kuncho.bank_payer', true), '')::uuid,
                          (SELECT default_payer_id FROM accounts WHERE id = l.account_id));
      IF v_payer IS NULL THEN
        RAISE EXCEPTION 'Say who made this payment: % is approved, but nobody is recorded as paying it', COALESCE(e.expense_code, 'the expense');
      END IF;
      IF v_payer = e.finance_approved_by THEN
        RAISE EXCEPTION '% approved % — say who else made the payment',
          COALESCE((SELECT full_name FROM user_profiles WHERE id = v_payer), 'The payer'), COALESCE(e.expense_code, 'this expense');
      END IF;
      IF COALESCE((SELECT role::text FROM user_profiles WHERE id = v_payer), '') NOT IN ('admin', 'finance') THEN
        RAISE EXCEPTION 'Who paid must be an admin or finance user';
      END IF;
      UPDATE expenses SET disbursed_by = v_payer WHERE id = e.id;
    END IF;
    v_amt := COALESCE(e.net_payable, e.amount_etb);
    PERFORM match_expense_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET matched_expense_id = p_target_id, matched_expense_amount = v_amt,
      variance_amount = l.amount - v_amt, match_status = 'matched_expense' WHERE id = p_line_id;
  ELSIF p_kind = 'expense_part' THEN
    SELECT * INTO q FROM expense_payments WHERE id = p_target_id AND transfer_id IS NULL AND state IN ('sent', 'paid');
    IF q.id IS NULL THEN RAISE EXCEPTION 'That part is not sent or paid, or already has a bank line'; END IF;
    PERFORM match_expense_part_to_transfer(q.id, l.transfer_id);
    UPDATE bank_statement_lines SET matched_expense_id = q.expense_id, matched_expense_amount = q.cash_etb,
      variance_amount = l.amount - q.cash_etb, match_status = 'matched_expense' WHERE id = p_line_id;
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
    UPDATE bank_statement_lines SET matched_payroll_id = p_target_id, match_status = 'manual' WHERE id = p_line_id;
  ELSIF p_kind = 'vrf' THEN
    SELECT * INTO f FROM vendor_receipt_facilitation WHERE id = p_target_id AND NOT is_archived;
    IF NOT FOUND THEN RAISE EXCEPTION 'Vendor request not found'; END IF;
    IF f.out_transfer_id IS NOT NULL THEN RAISE EXCEPTION 'That vendor request already has a bank line'; END IF;
    IF f.payment_state = 'approved' THEN
      PERFORM mark_vrf_sent(p_target_id, l.transfer_id, NULL);
    ELSE
      PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
      UPDATE vendor_receipt_facilitation SET out_transfer_id = l.transfer_id WHERE id = p_target_id;
      PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
    END IF;
    FOR ex IN SELECT x.id FROM expenses x
              WHERE f.record_name IS NOT NULL AND x.transfer_id IS NULL AND x.expense_code LIKE '%' || f.record_name
                AND abs(COALESCE(x.net_payable, x.amount_etb) - COALESCE(f.net_sent, f.amount_transferred)) <= 1 LOOP
      PERFORM match_expense_to_transfer(ex.id, l.transfer_id);
    END LOOP;
    UPDATE bank_statement_lines SET match_status = 'manual' WHERE id = p_line_id;
  ELSIF p_kind = 'vrf_part' THEN
    PERFORM match_vrf_part_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET match_status = 'manual' WHERE id = p_line_id;
  ELSIF p_kind = 'internal_line' THEN
    PERFORM pair_internal_transfer(p_line_id, p_target_id, NULL, NULL);
  ELSIF p_kind = 'internal_account' THEN
    PERFORM pair_internal_transfer(p_line_id, NULL, p_target_id, NULL);
  ELSIF p_kind = 'bank_charge' THEN
    SELECT * INTO v_fee FROM bank_line_fee(p_line_id);
    PERFORM classify_bank_line(p_line_id, 'bank_charge', COALESCE(v_fee.reason, 'Bank charge'));
  ELSIF p_kind = 'purchase_order' THEN
    RAISE EXCEPTION 'This purchase order has no payment recorded — record the payment on the order first, then match the line to it';
  ELSE
    RAISE EXCEPTION 'Unknown match kind %', p_kind;
  END IF;
  -- The automatic pass books every line's charge once, at its end.
  IF COALESCE(current_setting('kuncho.bank_auto', true), '') <> 'on' THEN
    PERFORM sync_bank_line_charges(NULL, p_line_id);
  END IF;
END; $function$;

-- The match screen says who made the payment.
CREATE OR REPLACE FUNCTION public.apply_bank_line_match_paid_by(p_line_id uuid, p_kind text, p_target_id uuid, p_paid_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  PERFORM set_config('kuncho.bank_payer', COALESCE(p_paid_by::text, ''), true);
  PERFORM apply_bank_line_match(p_line_id, p_kind, p_target_id);
  PERFORM set_config('kuncho.bank_payer', '', true);
END $f$;

-- ── Suggestions: codes, cheques, charges, own transfers ────────────────
CREATE OR REPLACE FUNCTION public.suggest_bank_line_matches(p_line_id uuid)
 RETURNS TABLE(kind text, target_id uuid, label text, detail text, amount numeric, target_date date, score integer, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_text text; v_codes text[]; v_cheques text[]; v_fee record; v_own record;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT * INTO l FROM v_bank_line_status WHERE line_id = p_line_id;
  IF l.line_id IS NULL THEN RETURN; END IF;
  v_text := COALESCE(l.narration, '') || ' ' || COALESCE(l.reference, '');
  v_codes := bank_doc_codes(v_text);
  v_cheques := bank_cheque_numbers(v_text);
  SELECT * INTO v_fee FROM bank_line_fee(p_line_id);
  SELECT * INTO v_own FROM bank_own_transfer_partner(p_line_id);
  RETURN QUERY
  WITH prq AS (
    -- Payment requests the narration names, and what each one pays.
    SELECT pr.* FROM payment_requests pr WHERE pr.request_code = ANY (v_codes) AND pr.status::text <> 'void'
  ), named AS (
    SELECT e.id FROM expenses e JOIN sourcing_bundles sb ON (sb.expense_id = e.id OR sb.id = e.sourcing_bundle_id)
     WHERE sb.bundle_code = ANY (v_codes)
    UNION SELECT prq.expense_id FROM prq WHERE prq.expense_id IS NOT NULL
  ), cand AS (
    SELECT 'expense'::text AS kind, e.id AS target_id,
      btrim(COALESCE(e.expense_code, '') || ' ' || COALESCE(e.item_service_description, '')) AS label,
      COALESCE(v.vendor_name, st.employee_name, '') || ' · ' || replace(e.payment_state::text, '_', ' ') AS detail,
      COALESCE(e.net_payable, e.amount_etb) AS amount, e.date AS target_date,
      (bank_ref_norm(e.bank_ref) IS NOT NULL
        AND (bank_ref_norm(e.bank_ref) = bank_ref_norm(l.reference_code) OR bank_ref_norm(e.bank_ref) = ANY (v_cheques))) AS ref_hit,
      (e.id IN (SELECT id FROM named) OR bank_text_names_code(v_text, e.expense_code)
        OR EXISTS (SELECT 1 FROM sourcing_bundles sb WHERE (sb.expense_id = e.id OR sb.id = e.sourcing_bundle_id)
                   AND bank_text_names_code(v_text, sb.bundle_code))) AS code_hit,
      bank_amount_fit(l.amount, COALESCE(e.net_payable, e.amount_etb), 'debit') AS fit,
      CASE WHEN e.payment_state IN ('sent', 'paid', 'advance') THEN 10 WHEN e.payment_state = 'approved_to_pay' THEN 5 ELSE -5 END AS bonus
    FROM expenses e
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN staff st ON st.id = e.paid_to_staff_id
    WHERE l.direction = 'debit' AND e.transfer_id IS NULL AND NOT e.in_parts
      AND (e.payment_state IN ('approved_to_pay', 'sent', 'paid', 'advance')
           OR (e.payment_state = 'unpaid' AND NOT COALESCE(e.is_archived, false) AND e.id IN (SELECT id FROM named)))
      AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation f
                      WHERE f.out_transfer_id IS NULL AND f.record_name IS NOT NULL AND e.expense_code LIKE '%' || f.record_name)
      AND (e.date BETWEEN l.value_date - 120 AND l.value_date + 10 OR e.id IN (SELECT id FROM named))
    UNION ALL
    SELECT 'expense_part', q.id,
      btrim(COALESCE(e.expense_code, '') || format(' part %s of %s ', pos.part_no, pos.part_count) || COALESCE(e.item_service_description, '')),
      COALESCE(v.vendor_name, st.employee_name, '') || CASE WHEN q.state = 'paid' THEN ' · part paid' ELSE ' · part sent' END,
      q.cash_etb, COALESCE(q.paid_date, q.sent_at::date, e.date),
      (bank_ref_norm(q.bank_ref) IS NOT NULL
        AND (bank_ref_norm(q.bank_ref) = bank_ref_norm(l.reference_code) OR bank_ref_norm(q.bank_ref) = ANY (v_cheques))),
      (EXISTS (SELECT 1 FROM prq WHERE prq.expense_payment_id = q.id) OR bank_text_names_code(v_text, e.expense_code)
        OR EXISTS (SELECT 1 FROM sourcing_bundles sb WHERE (sb.expense_id = e.id OR sb.id = e.sourcing_bundle_id)
                   AND (sb.bundle_code = ANY (v_codes) OR bank_text_names_code(v_text, sb.bundle_code)))),
      bank_amount_fit(l.amount, q.cash_etb, 'debit'),
      10
    FROM expense_payments q
    JOIN expenses e ON e.id = q.expense_id
    CROSS JOIN LATERAL expense_part_position(q.id) pos
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN staff st ON st.id = e.paid_to_staff_id
    WHERE l.direction = 'debit' AND q.state IN ('sent', 'paid') AND q.transfer_id IS NULL AND NOT q.legacy_entry
      AND COALESCE(q.paid_date, q.sent_at::date, e.date) BETWEEN l.value_date - 120 AND l.value_date + 10
    UNION ALL
    SELECT 'batch', b.id, COALESCE(b.payment_code, 'Batch payment'),
      (SELECT count(*) FROM batch_payment_expenses x WHERE x.batch_payment_id = b.id)::text || ' payments',
      t.total, COALESCE(b.paid_date, b.created_at::date),
      (bank_ref_norm(b.bank_ref) IS NOT NULL
        AND (bank_ref_norm(b.bank_ref) = bank_ref_norm(l.reference_code) OR bank_ref_norm(b.bank_ref) = ANY (v_cheques))),
      (bank_text_names_code(v_text, b.payment_code) OR EXISTS (SELECT 1 FROM prq WHERE prq.batch_payment_id = b.id)),
      bank_amount_fit(l.amount, t.total, 'debit'), 5
    FROM batch_payments b
    CROSS JOIN LATERAL (SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), 0) AS total
                        FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id WHERE x.batch_payment_id = b.id) t
    WHERE l.direction = 'debit' AND b.transfer_id IS NULL
      AND (COALESCE(b.paid_date, b.created_at::date) BETWEEN l.value_date - 60 AND l.value_date + 10
           OR EXISTS (SELECT 1 FROM prq WHERE prq.batch_payment_id = b.id))
    UNION ALL
    SELECT 'vrf', f.id, COALESCE(f.record_name, 'Vendor request'),
      COALESCE(f.facilitator_name, '') || ' · ' || COALESCE(f.payment_state, ''),
      COALESCE(f.net_sent, f.amount_transferred), f.trxn_date,
      false, (bank_text_names_code(v_text, f.record_name) OR EXISTS (SELECT 1 FROM prq WHERE prq.vrf_id = f.id)),
      bank_amount_fit(l.amount, COALESCE(f.net_sent, f.amount_transferred), 'debit'),
      CASE WHEN f.initial_account_id = l.account_id THEN 5 ELSE 0 END
    FROM vendor_receipt_facilitation f
    WHERE l.direction = 'debit' AND f.out_transfer_id IS NULL AND NOT f.is_archived
      AND (f.trxn_date BETWEEN l.value_date - 60 AND l.value_date + 10 OR EXISTS (SELECT 1 FROM prq WHERE prq.vrf_id = f.id))
    UNION ALL
    SELECT 'payroll', p.id, COALESCE(p.payroll_record, 'Payroll run'),
      COALESCE((SELECT st.employee_name FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
                WHERE ps.payroll_id = p.id AND bank_amount_fit(l.amount, ps.net_amount, 'debit') >= 55 LIMIT 1), 'run')
        || ' · ' || COALESCE(p.payment_status, ''),
      (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id), p.end_date,
      false, EXISTS (SELECT 1 FROM prq WHERE prq.payroll_id = p.id),
      greatest(bank_amount_fit(l.amount, (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id), 'debit'),
               CASE WHEN EXISTS (SELECT 1 FROM payroll_staff ps WHERE ps.payroll_id = p.id AND bank_amount_fit(l.amount, ps.net_amount, 'debit') >= 55)
                    THEN 45 ELSE 0 END),
      CASE WHEN upper(v_text) ~ '(SALARY|\mSAL\M|PAYROLL|WAGE)' THEN 25 ELSE 0 END
    FROM payroll p
    WHERE l.direction = 'debit' AND p.transfer_id IS NULL
      AND (p.end_date BETWEEN l.value_date - 60 AND l.value_date + 30 OR EXISTS (SELECT 1 FROM prq WHERE prq.payroll_id = p.id))
    UNION ALL
    SELECT 'sale', s.id, btrim(COALESCE(s.invoice_number, '') || ' ' || COALESCE(s.sales_description, '')),
      COALESCE(c.client_name, '') || ' · ' || CASE WHEN s.carried_forward THEN 'owed from last year' ELSE s.sales_status::text END,
      s.amount, s.date,
      (bank_ref_norm(s.bank_ref) IS NOT NULL
        AND (bank_ref_norm(s.bank_ref) = bank_ref_norm(l.reference_code) OR bank_ref_norm(s.bank_ref) = ANY (v_cheques))),
      bank_text_names_code(v_text, s.invoice_number),
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
      concat_ws(' · ', o.reference, NULLIF(o.narration, o.reference)), o.amount, o.value_date,
      false, false, CASE WHEN o.line_id = v_own.other_line_id THEN 92 WHEN abs(o.amount - l.amount) <= 0.01 THEN 80 ELSE 0 END, 0
    FROM v_bank_line_status o JOIN accounts a ON a.id = o.account_id
    WHERE o.account_id <> l.account_id AND o.direction <> l.direction AND o.reconciled_as IS NULL
      AND abs(o.amount - l.amount) <= 0.01 AND o.value_date BETWEEN l.value_date - 5 AND l.value_date + 5
    UNION ALL
    SELECT 'internal_account', a.id, 'Transfer ' || CASE WHEN l.direction = 'credit' THEN 'from ' ELSE 'to ' END || a.account_name,
      'Kuncho''s own account', l.amount, l.value_date, false, false,
      CASE WHEN a.id = v_own.other_account_id THEN 88 ELSE 60 END, 0
    FROM accounts a
    WHERE a.id <> l.account_id
      AND (a.id = v_own.other_account_id
           OR (length(split_part(a.account_name, ' ', 1)) >= 4 AND upper(v_text) LIKE '%' || upper(split_part(a.account_name, ' ', 1)) || '%'))
    UNION ALL
    SELECT 'bank_charge', COALESCE(v_fee.main_line_id, l.line_id), 'Bank charge', v_fee.reason, l.amount, l.value_date,
      false, false, CASE WHEN v_fee.main_line_id IS NOT NULL THEN 92 ELSE 88 END, 0
    WHERE v_fee.reason IS NOT NULL
    UNION ALL
    SELECT 'purchase_order', sb.id, sb.bundle_code, COALESCE(sb.vendor_name, '') || ' · no expense recorded',
      sb.total_value, sb.created_at::date, false, true, bank_amount_fit(l.amount, sb.total_value, l.direction), -30
    FROM sourcing_bundles sb
    WHERE l.direction = 'debit' AND (sb.bundle_code = ANY (v_codes) OR bank_text_names_code(v_text, sb.bundle_code))
      AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = sb.expense_id OR e.sourcing_bundle_id = sb.id)
  )
  SELECT c.kind, c.target_id, c.label, c.detail, round(c.amount, 2), c.target_date,
    (CASE WHEN c.ref_hit THEN 100
          WHEN c.code_hit AND c.fit >= 40 THEN 95
          WHEN c.code_hit THEN 70
          ELSE c.fit END + c.bonus)::int AS score,
    CASE WHEN c.ref_hit AND cardinality(v_cheques) > 0 THEN 'Its bank reference is this line''s reference or the cheque number in the narration'
         WHEN c.ref_hit THEN 'Reference is its bank reference'
         WHEN c.kind = 'purchase_order' THEN 'Narration names this purchase order, but its payment was never recorded — record it on the order, then match'
         WHEN c.kind = 'expense' AND c.bonus < 0 AND c.code_hit THEN 'Narration names it, but it isn''t approved for payment yet — approve it, then match'
         WHEN c.code_hit AND c.fit >= 55 AND abs(l.amount - c.amount) > 0.01 THEN 'Narration names it; amount plus a ' || round(l.amount - c.amount, 2) || ' fee'
         WHEN c.code_hit AND c.fit >= 40 THEN 'Narration names it and the amount fits'
         WHEN c.code_hit THEN 'Narration names it, but the amount differs'
         WHEN c.kind = 'payroll' THEN CASE WHEN c.bonus > 0 THEN 'Salary narration; ' ELSE '' END || c.detail
         WHEN c.kind = 'sale' AND c.fit = 30 THEN 'Less than the invoice by ' || round(c.amount - l.amount, 2) || ' — withholding or deductions?'
         WHEN c.kind = 'internal_line' AND c.target_id = v_own.other_line_id THEN v_own.reason
         WHEN c.kind = 'internal_line' THEN 'Same amount, opposite direction, on another account'
         WHEN c.kind = 'internal_account' AND c.target_id = v_own.other_account_id THEN v_own.reason
         WHEN c.kind = 'internal_account' THEN 'Narration mentions this bank'
         WHEN c.kind = 'bank_charge' THEN c.detail
         WHEN c.fit >= 60 THEN 'Same amount'
         WHEN c.fit >= 55 THEN 'Amount plus a ' || round(l.amount - c.amount, 2) || ' fee'
         ELSE 'Amount is close' END
  FROM cand c
  WHERE c.ref_hit OR c.code_hit OR c.fit >= 20
  ORDER BY 7 DESC, abs(c.target_date - l.value_date)
  LIMIT 10;
END; $function$;

-- ── The automatic pass: charges and own transfers too ──────────────────
CREATE OR REPLACE FUNCTION public.auto_reconcile_bank_lines_round(p_import_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_after_date date DEFAULT NULL::date, p_after_no integer DEFAULT NULL::integer, p_after_line uuid DEFAULT NULL::uuid, p_budget_ms integer DEFAULT 4000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; ru record; x record; v_linked boolean; v_done int := 0; v_tried int := 0; v_more boolean := false;
  v_date date := p_after_date; v_no int := p_after_no; v_line uuid := p_after_line; v_account uuid := p_account_id;
  v_budget interval := make_interval(secs => greatest(COALESCE(p_budget_ms, 4000), 500) / 1000.0);
  s_kind text; s_target uuid; s_score int; s2_score int; i int; v_fee record; v_own record; v_still boolean;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  PERFORM set_config('kuncho.bank_auto', 'on', true);
  FOR r IN
    SELECT st.* FROM v_bank_line_status st
    WHERE st.reconciled_as IS NULL AND st.transfer_id IS NOT NULL
      AND (p_import_id IS NULL OR st.import_id = p_import_id)
      AND (p_account_id IS NULL OR st.account_id = p_account_id)
      AND (p_after_date IS NULL
           OR (st.value_date, st.line_no, st.line_id)
              > (p_after_date, COALESCE(p_after_no, -1), COALESCE(p_after_line, '00000000-0000-0000-0000-000000000000'::uuid)))
      AND NOT bank_period_closed(st.account_id, st.value_date)
    ORDER BY st.value_date, st.line_no, st.line_id
  LOOP
    IF v_tried > 0 AND clock_timestamp() - statement_timestamp() > v_budget THEN v_more := true; EXIT; END IF;
    v_tried := v_tried + 1; v_date := r.value_date; v_no := r.line_no; v_line := r.line_id;
    -- An earlier line in this round may have settled this one (the other side of a transfer).
    SELECT reconciled_as IS NULL INTO v_still FROM v_bank_line_status WHERE line_id = r.line_id;
    CONTINUE WHEN NOT COALESCE(v_still, false);

    -- 1. The reference: whatever payment (or payments) carry it.
    IF r.reference_code IS NOT NULL THEN
      BEGIN
        v_linked := bank_link_reference(r.line_id);
      EXCEPTION WHEN OTHERS THEN v_linked := false;
      END;
      IF v_linked THEN v_done := v_done + 1; CONTINUE; END IF;
    END IF;

    -- 2. The bank's own charge, on a line of its own.
    IF r.direction = 'debit' AND r.amount <= 1000 THEN
      SELECT * INTO v_fee FROM bank_line_fee(r.line_id);
      IF v_fee.reason IS NOT NULL THEN
        BEGIN
          PERFORM classify_bank_line(r.line_id, 'bank_charge', v_fee.reason); v_done := v_done + 1; CONTINUE;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END IF;
    END IF;

    -- 3. A suggestion so strong nothing else comes close.
    s_kind := NULL; s_target := NULL; s_score := NULL; s2_score := NULL; i := 0;
    FOR x IN SELECT m.kind, m.target_id, m.score FROM suggest_bank_line_matches(r.line_id) m ORDER BY m.score DESC LIMIT 2 LOOP
      i := i + 1;
      IF i = 1 THEN s_kind := x.kind; s_target := x.target_id; s_score := x.score; ELSE s2_score := x.score; END IF;
    END LOOP;
    IF s_score >= 95 AND s_kind IN ('expense', 'expense_part', 'batch', 'vrf', 'sale') AND (s2_score IS NULL OR s2_score < 95) THEN
      BEGIN
        PERFORM apply_bank_line_match(r.line_id, s_kind, s_target); v_done := v_done + 1; CONTINUE;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    -- 4. Money moved between Kuncho's own accounts.
    SELECT * INTO v_own FROM bank_own_transfer_partner(r.line_id);
    IF v_own.other_line_id IS NOT NULL OR v_own.other_account_id IS NOT NULL THEN
      BEGIN
        PERFORM pair_internal_transfer(r.line_id, v_own.other_line_id, v_own.other_account_id, v_own.reason);
        v_done := v_done + 1; CONTINUE;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    -- 5. A rule someone saved.
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
  PERFORM set_config('kuncho.bank_auto', 'off', true);

  IF NOT v_more THEN
    IF v_account IS NULL AND p_import_id IS NOT NULL THEN
      SELECT account_id INTO v_account FROM bank_statement_imports WHERE id = p_import_id;
    END IF;
    PERFORM sync_bank_line_charges(v_account, NULL);
  END IF;

  RETURN jsonb_build_object('matched', v_done, 'tried', v_tried, 'more', v_more,
    'after_date', v_date, 'after_no', v_no, 'after_line', v_line);
END $function$;

-- ── Record an expense straight from its bank line ──────────────────────
-- Recorded, approved by whoever records it, paid by someone else (the
-- two-person rule), and matched to the line, in one step.
CREATE OR REPLACE FUNCTION public.record_expense_from_bank_line(
  p_line_id uuid, p_description text, p_category_id uuid, p_amount numeric DEFAULT NULL,
  p_project_id uuid DEFAULT NULL, p_is_overhead boolean DEFAULT false,
  p_vendor_id uuid DEFAULT NULL, p_payee_name text DEFAULT NULL, p_staff_id uuid DEFAULT NULL,
  p_paid_by uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l v_bank_line_status; v_id uuid; v_payer uuid; v_amount numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance record a payment from the bank';
  END IF;
  l := bank_line_guard(p_line_id);
  IF l.direction <> 'debit' THEN RAISE EXCEPTION 'Only money going out is an expense — money in is recorded as a sale'; END IF;
  IF NULLIF(btrim(p_description), '') IS NULL THEN RAISE EXCEPTION 'Say what the payment was for'; END IF;
  IF p_category_id IS NULL THEN RAISE EXCEPTION 'Pick its category'; END IF;
  IF p_project_id IS NULL AND NOT COALESCE(p_is_overhead, false) THEN RAISE EXCEPTION 'Pick the project, or mark it company overhead'; END IF;
  IF p_vendor_id IS NULL AND p_staff_id IS NULL AND NULLIF(btrim(p_payee_name), '') IS NULL THEN
    RAISE EXCEPTION 'Say who was paid — a vendor, a staff member, or their name';
  END IF;
  v_amount := round(COALESCE(p_amount, l.amount), 2);
  IF v_amount <= 0 OR v_amount > l.amount + 0.01 THEN
    RAISE EXCEPTION 'The amount paid is more than 0 and at most the bank line (%)', to_char(l.amount, 'FM999,999,999,990.00');
  END IF;
  v_payer := COALESCE(p_paid_by, (SELECT default_payer_id FROM accounts WHERE id = l.account_id));
  IF v_payer IS NULL THEN RAISE EXCEPTION 'Say who made this payment'; END IF;
  IF v_payer = auth.uid() THEN
    RAISE EXCEPTION 'You record and approve it, so the payment must have been made by someone else — pick who paid';
  END IF;

  INSERT INTO expenses (expense_type, item_service_description, amount_etb, date, project_id, is_overhead, category_id,
                        vendor_id, vendors_name, paid_to_staff_id, payment_method, bank_ref, account_id, notes)
  VALUES ('general', btrim(p_description), v_amount, l.value_date, p_project_id, COALESCE(p_is_overhead, false), p_category_id,
          p_vendor_id, NULLIF(btrim(p_payee_name), ''), p_staff_id, 'transfer', COALESCE(l.reference_code, l.reference), l.account_id,
          'Recorded from the bank: ' || to_char(l.amount, 'FM999,999,999,990.00') || ' paid ' || to_char(l.value_date, 'DD Mon YYYY')
            || COALESCE(' (' || COALESCE(l.reference_code, l.reference) || ')', '') || '.' || COALESCE(' ' || NULLIF(btrim(p_note), ''), ''))
  RETURNING id INTO v_id;
  -- Approved by the one recording it (the approval checks run: project, ledger).
  UPDATE expenses SET approval_status = 'finance_approved' WHERE id = v_id;
  PERFORM set_config('kuncho.bank_payer', v_payer::text, true);
  PERFORM apply_bank_line_match(p_line_id, 'expense', v_id);
  PERFORM set_config('kuncho.bank_payer', '', true);
  RETURN v_id;
END $f$;

-- ── The reconciliation statement ───────────────────────────────────────
-- The bank's balance on a date against the books', the way an accountant
-- lays it out: every difference named, with the entries behind it. The
-- same sums as v_account_ledger_tieout, on any date.
CREATE OR REPLACE FUNCTION public.bank_reconciliation_statement(p_account_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_first date; v_stmt numeric; v_stmt_date date; v_lines_net numeric; v_open_net numeric; v_unposted numeric;
        v_book numeric; v_before numeric; v_not_on_bank numeric; v_opening numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance', 'executive') THEN
    RAISE EXCEPTION 'Only admin, finance or executives see a reconciliation statement';
  END IF;
  SELECT min(value_date) INTO v_first FROM bank_statement_lines WHERE account_id = p_account_id;
  SELECT s.running_balance, s.value_date INTO v_stmt, v_stmt_date FROM bank_statement_lines s
   WHERE s.account_id = p_account_id AND s.value_date <= p_date AND s.running_balance IS NOT NULL
   ORDER BY s.value_date DESC, s.line_no DESC LIMIT 1;

  SELECT COALESCE(sum(signed_amount) FILTER (WHERE reconciled_as IS DISTINCT FROM 'opening_balance'), 0),
         COALESCE(sum(signed_amount) FILTER (WHERE NOT in_ledger AND reconciled_as IS NULL), 0),
         COALESCE(sum(signed_amount) FILTER (WHERE NOT in_ledger AND reconciled_as IS NOT NULL AND reconciled_as <> 'opening_balance'), 0)
    INTO v_lines_net, v_open_net, v_unposted
    FROM v_bank_line_ledger WHERE account_id = p_account_id AND value_date <= p_date;
  SELECT COALESCE(sum(amount), 0),
         COALESCE(sum(amount) FILTER (WHERE NOT on_bank AND entry_date < v_first), 0),
         COALESCE(sum(amount) FILTER (WHERE NOT on_bank AND entry_date >= v_first), 0)
    INTO v_book, v_before, v_not_on_bank
    FROM v_cash_ledger_lines WHERE account_id = p_account_id AND entry_date <= p_date;
  v_opening := COALESCE(v_stmt, 0) - v_lines_net;

  RETURN jsonb_build_object(
    'account_id', p_account_id, 'as_of', p_date, 'statement_date', v_stmt_date, 'first_statement_date', v_first,
    'statement_balance', round(COALESCE(v_stmt, 0), 2),
    'opening_not_in_books', round(v_opening, 2),
    'open_lines', round(v_open_net, 2),
    'unposted_lines', round(v_unposted, 2),
    'not_on_bank', round(v_not_on_bank, 2),
    'before_statements', round(v_before, 2),
    'book_balance', round(v_book, 2),
    'unexplained', round((COALESCE(v_stmt, 0) - v_book) - (v_opening + v_open_net + v_unposted) + (v_before + v_not_on_bank), 2),
    'open_line_items', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', b.value_date, 'direction', b.direction, 'amount', b.amount,
                           'signed', b.signed_amount, 'narration', b.narration, 'reference', b.reference) ORDER BY b.value_date, b.amount DESC)
                         FROM (SELECT * FROM v_bank_line_ledger WHERE account_id = p_account_id AND value_date <= p_date
                                 AND NOT in_ledger AND reconciled_as IS NULL ORDER BY value_date LIMIT 500) b), '[]'::jsonb),
    'not_on_bank_items', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', c.entry_date, 'amount', c.amount, 'description', c.description,
                           'source', c.source_table, 'source_id', c.source_id) ORDER BY c.entry_date, c.amount)
                         FROM (SELECT * FROM v_cash_ledger_lines WHERE account_id = p_account_id AND entry_date <= p_date
                                 AND NOT on_bank AND entry_date >= v_first ORDER BY entry_date LIMIT 500) c), '[]'::jsonb));
END $f$;

GRANT EXECUTE ON FUNCTION public.set_account_payer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_bank_line_match(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_bank_line_match_paid_by(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_bank_line_matches(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_reconcile_bank_lines_round(uuid, uuid, date, integer, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_from_bank_line(uuid, text, uuid, numeric, uuid, boolean, uuid, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_statement(uuid, date) TO authenticated;
