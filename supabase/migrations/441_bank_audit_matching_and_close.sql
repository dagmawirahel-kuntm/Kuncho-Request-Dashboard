-- 441 — Matching confirms; the bank audit reaches people
--
-- Builds on 440 (the audit views). From here a statement line confirms a
-- payment rather than paying it:
--
--   match_expense_to_transfer        a bill already paid (or paid ahead) is
--                                    linked to its line and nothing else
--                                    changes — an advance is never closed by
--                                    a match
--   match_expense_part_to_transfer   the same for a part paid with its own
--                                    reference; undoing such a part's line
--                                    leaves it paid
--   bank_link_reference()            a line is linked to every open payment
--                                    carrying its reference — one outright,
--                                    several together only when they tie to it
--   bank_try_link_reference()        used when a payment is marked paid with a
--                                    reference whose statement is already in
--   apply / unmatch / auto-reconcile book (or take back) the bank's charge on
--                                    the line
--
-- And the flags reach people: a bank period cannot close while flags dated
-- in it are open; the month-end checklist gains "the bank agrees with the
-- payments"; ops health carries each flag once it is a week old (big ones at
-- once, to management) and a prompt when an account's statement is due.
--
-- Applied in two parts: 441_bank_audit_matching_and_close_1_matching
-- (section 1, with its grants) and
-- 441_bank_audit_matching_and_close_2_close_monthend_ops (sections 2–5).

SET search_path TO public;

-- ── 1. Matching confirms; it no longer pays ───────────────────────────────
-- A bill already paid (or paid ahead) is linked to its line and nothing else
-- changes — no state change, so an advance is never closed by a match. A bill
-- still only sent is paid by the match, as before.
CREATE OR REPLACE FUNCTION match_expense_to_transfer(p_expense_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from_account_id uuid; v_state text;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match an expense to a bank line';
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense belongs to a batch payment — match the batch to a bank line instead';
  END IF;
  IF EXISTS (SELECT 1 FROM expenses WHERE id = p_expense_id AND in_parts) THEN
    RAISE EXCEPTION 'This expense is paid in parts — match the bank line to the part it paid';
  END IF;
  SELECT payment_state INTO v_state FROM expenses WHERE id = p_expense_id;
  SELECT from_account_id INTO v_from_account_id FROM transfers WHERE id = p_transfer_id;
  UPDATE expenses
  SET payment_state = CASE WHEN v_state IN ('paid', 'advance') THEN payment_state ELSE 'paid' END,
      transfer_id   = p_transfer_id,
      account_id    = COALESCE(account_id, v_from_account_id)
  WHERE id = p_expense_id;
END $$;

-- A part already paid by its reference is confirmed by the line; a part only
-- sent is paid by it, on the line's date, as before.
CREATE OR REPLACE FUNCTION match_expense_part_to_transfer(p_payment_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p expense_payments%ROWTYPE; t transfers%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a payment to a bank line';
  END IF;
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
  IF p.state NOT IN ('sent', 'paid') THEN
    RAISE EXCEPTION 'Only a sent or paid part can be matched to a bank line (this one is %)', p.state;
  END IF;
  SELECT * INTO t FROM transfers WHERE id = p_transfer_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Bank line not found'; END IF;
  IF p.state = 'paid' THEN
    UPDATE expense_payments SET transfer_id = t.id, account_id = COALESCE(account_id, t.from_account_id)
    WHERE id = p.id;
  ELSE
    UPDATE expense_payments SET
      transfer_id = t.id, state = 'paid', paid_date = COALESCE(t.date, CURRENT_DATE),
      account_id = COALESCE(account_id, t.from_account_id), confirmed_by = auth.uid()
    WHERE id = p.id;
  END IF;
END $$;

-- Undoing a part's line takes it back to sent only when the line was what
-- made it paid; a part paid with its own reference stays paid.
CREATE OR REPLACE FUNCTION trg_expense_part_unmatched()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.transfer_id IS NOT NULL AND NEW.transfer_id IS NULL AND NEW.state = 'paid'
     AND bank_ref_norm(NEW.bank_ref) IS NULL THEN
    NEW.state := 'sent'; NEW.paid_date := NULL; NEW.confirmed_by := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION apply_bank_line_match(p_line_id uuid, p_kind text, p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_amt numeric; f record; ex record; q expense_payments%ROWTYPE;
BEGIN
  l := bank_line_guard(p_line_id);
  IF p_kind IN ('expense', 'expense_part', 'batch', 'vrf', 'payroll') AND l.direction <> 'debit' THEN
    RAISE EXCEPTION 'Money coming in cannot pay a %', replace(p_kind, '_', ' ');
  END IF;
  IF p_kind = 'sale' AND l.direction <> 'credit' THEN RAISE EXCEPTION 'Money going out cannot settle a sale'; END IF;
  IF p_kind = 'expense' THEN
    SELECT COALESCE(net_payable, amount_etb) INTO v_amt FROM expenses WHERE id = p_target_id AND transfer_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That expense is not open for a bank line'; END IF;
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
  -- The automatic pass books every line's charge once, at its end.
  IF COALESCE(current_setting('kuncho.bank_auto', true), '') <> 'on' THEN
    PERFORM sync_bank_line_charges(NULL, p_line_id);
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION unmatch_bank_line(p_line_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_label text;
BEGIN
  l := bank_line_guard(p_line_id, true);
  IF l.reconciled_as IS NULL THEN RAISE EXCEPTION 'This line is not reconciled — nothing to undo'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why this is being undone'; END IF;
  IF l.reconciled_as = 'opening_balance' THEN
    RAISE EXCEPTION 'This is the balance the statement started from — reopen the import instead';
  END IF;
  IF l.reconciled_as = 'vrf_return' THEN
    RAISE EXCEPTION 'Undo the return on its vendor request';
  END IF;
  v_label := bank_line_target_label(l);
  PERFORM set_config('kuncho.bank_event_logged', 'on', true);

  IF l.reconciled_as IN ('classified', 'internal') THEN
    PERFORM unclassify_bank_line(p_line_id);
  ELSE
    UPDATE batch_payments SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    UPDATE expenses SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    -- A part the line paid goes back to sent (its posting is reversed); a
    -- part paid with its own reference stays paid.
    UPDATE expense_payments SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    UPDATE sales SET transfer_id = NULL, amount_received = NULL, withheld_by_client = NULL WHERE transfer_id = l.transfer_id;
    UPDATE payroll SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    IF EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE out_transfer_id = l.transfer_id) THEN
      PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
      UPDATE vendor_receipt_facilitation SET out_transfer_id = NULL WHERE out_transfer_id = l.transfer_id;
      PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
    END IF;
    UPDATE bank_statement_lines SET matched_expense_id = NULL, matched_sale_id = NULL, matched_payroll_id = NULL,
      matched_expense_amount = NULL, variance_amount = NULL, match_status = 'unmatched'
    WHERE id = p_line_id;
  END IF;
  -- Whatever charge it carried is taken back with the match.
  PERFORM sync_bank_line_charges(NULL, p_line_id);

  INSERT INTO bank_line_events (line_id, account_id, action, kind, target_label, note)
  VALUES (p_line_id, l.account_id, 'unmatched', l.reconciled_as, v_label, btrim(p_reason));
  PERFORM set_config('kuncho.bank_event_logged', 'off', true);
END $function$;

-- Suggestions: a part already paid by its reference is a candidate too, and
-- references compare as the bank prints them.
CREATE OR REPLACE FUNCTION suggest_bank_line_matches(p_line_id uuid)
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
      (bank_ref_norm(e.bank_ref) IS NOT NULL AND bank_ref_norm(e.bank_ref) = bank_ref_norm(l.reference_code)) AS ref_hit,
      (bank_text_names_code(v_text, e.expense_code)
        OR EXISTS (SELECT 1 FROM sourcing_bundles sb WHERE (sb.expense_id = e.id OR sb.id = e.sourcing_bundle_id)
                   AND bank_text_names_code(v_text, sb.bundle_code))) AS code_hit,
      bank_amount_fit(l.amount, COALESCE(e.net_payable, e.amount_etb), 'debit') AS fit,
      CASE WHEN e.payment_state IN ('sent', 'paid', 'advance') THEN 10 WHEN e.payment_state = 'approved_to_pay' THEN 5 ELSE 0 END AS bonus
    FROM expenses e
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN staff st ON st.id = e.paid_to_staff_id
    WHERE l.direction = 'debit' AND e.transfer_id IS NULL AND NOT e.in_parts
      AND e.payment_state IN ('approved_to_pay', 'sent', 'paid', 'advance')
      AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation f
                      WHERE f.out_transfer_id IS NULL AND f.record_name IS NOT NULL AND e.expense_code LIKE '%' || f.record_name)
      AND e.date BETWEEN l.value_date - 120 AND l.value_date + 10
    UNION ALL
    SELECT 'expense_part', q.id,
      btrim(COALESCE(e.expense_code, '') || format(' part %s of %s ', pos.part_no, pos.part_count) || COALESCE(e.item_service_description, '')),
      COALESCE(v.vendor_name, st.employee_name, '') || CASE WHEN q.state = 'paid' THEN ' · part paid' ELSE ' · part sent' END,
      q.cash_etb, COALESCE(q.paid_date, q.sent_at::date, e.date),
      (bank_ref_norm(q.bank_ref) IS NOT NULL AND bank_ref_norm(q.bank_ref) = bank_ref_norm(l.reference_code)),
      (bank_text_names_code(v_text, e.expense_code)
        OR EXISTS (SELECT 1 FROM sourcing_bundles sb WHERE (sb.expense_id = e.id OR sb.id = e.sourcing_bundle_id)
                   AND bank_text_names_code(v_text, sb.bundle_code))),
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
      (bank_ref_norm(b.bank_ref) IS NOT NULL AND bank_ref_norm(b.bank_ref) = bank_ref_norm(l.reference_code)),
      bank_text_names_code(v_text, b.payment_code),
      bank_amount_fit(l.amount, t.total, 'debit'), 5
    FROM batch_payments b
    CROSS JOIN LATERAL (SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), 0) AS total
                        FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id WHERE x.batch_payment_id = b.id) t
    WHERE l.direction = 'debit' AND b.transfer_id IS NULL
      AND COALESCE(b.paid_date, b.created_at::date) BETWEEN l.value_date - 60 AND l.value_date + 10
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
      (bank_ref_norm(s.bank_ref) IS NOT NULL AND bank_ref_norm(s.bank_ref) = bank_ref_norm(l.reference_code)),
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

-- Every open payment carrying a reference: what a line with that reference
-- pays.
CREATE OR REPLACE FUNCTION bank_reference_claims(p_ref text, p_direction text)
RETURNS TABLE(kind text, target_id uuid, amount numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'expense_part'::text, q.id, q.cash_etb
  FROM expense_payments q
  WHERE p_direction = 'debit' AND q.state IN ('sent', 'paid') AND q.transfer_id IS NULL AND NOT q.legacy_entry
    AND bank_ref_norm(q.bank_ref) = bank_ref_norm(p_ref)
  UNION ALL
  SELECT 'batch', b.id,
    (SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), 0)
       FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id WHERE x.batch_payment_id = b.id)
  FROM batch_payments b
  WHERE p_direction = 'debit' AND b.transfer_id IS NULL
    AND (bank_ref_norm(b.bank_ref) = bank_ref_norm(p_ref)
         OR EXISTS (SELECT 1 FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id
                    WHERE x.batch_payment_id = b.id AND bank_ref_norm(e.bank_ref) = bank_ref_norm(p_ref)))
    AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id
                    WHERE x.batch_payment_id = b.id AND e.payment_state NOT IN ('sent', 'paid', 'advance'))
  UNION ALL
  SELECT 'expense', e.id, COALESCE(e.net_payable, e.amount_etb)
  FROM expenses e
  WHERE p_direction = 'debit' AND e.transfer_id IS NULL AND NOT e.in_parts AND NOT COALESCE(e.is_archived, false)
    AND e.payment_state IN ('sent', 'paid', 'advance') AND bank_ref_norm(e.bank_ref) = bank_ref_norm(p_ref)
    AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id)
  UNION ALL
  SELECT 'sale', s.id, s.amount
  FROM sales s
  WHERE p_direction = 'credit' AND s.transfer_id IS NULL AND NOT COALESCE(s.is_archived, false)
    AND bank_ref_norm(s.bank_ref) = bank_ref_norm(p_ref)
$$;

-- Links a line to every open payment carrying its reference. One claim is
-- linked outright (its amount is checked by the audit). Several are linked
-- together only when, between them, they tie to the line — one transfer for
-- several bills; otherwise the line is left for a person.
CREATE OR REPLACE FUNCTION bank_link_reference(p_line_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status; c record; v_n int; v_total numeric; v_first boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  l := bank_line_guard(p_line_id);
  IF l.reference_code IS NULL THEN RETURN false; END IF;
  SELECT count(*), COALESCE(sum(x.amount), 0) INTO v_n, v_total FROM bank_reference_claims(l.reference_code, l.direction) x;
  IF v_n = 0 THEN RETURN false; END IF;
  IF v_n = 1 THEN
    SELECT * INTO c FROM bank_reference_claims(l.reference_code, l.direction) x;
    PERFORM apply_bank_line_match(p_line_id, c.kind, c.target_id);
    RETURN true;
  END IF;
  IF l.direction <> 'debit' OR bank_line_charge(l.account_id, l.amount - v_total) IS NULL THEN RETURN false; END IF;
  FOR c IN SELECT * FROM bank_reference_claims(l.reference_code, l.direction) x ORDER BY x.kind, x.target_id LOOP
    IF v_first THEN
      PERFORM apply_bank_line_match(p_line_id, c.kind, c.target_id);
      v_first := false;
    ELSIF c.kind = 'expense' THEN PERFORM match_expense_to_transfer(c.target_id, l.transfer_id);
    ELSIF c.kind = 'expense_part' THEN PERFORM match_expense_part_to_transfer(c.target_id, l.transfer_id);
    ELSIF c.kind = 'batch' THEN PERFORM match_batch_to_transfer(c.target_id, l.transfer_id);
    END IF;
  END LOOP;
  IF COALESCE(current_setting('kuncho.bank_auto', true), '') <> 'on' THEN
    PERFORM sync_bank_line_charges(NULL, p_line_id);
  END IF;
  RETURN true;
END $$;

-- After a payment is marked paid with its reference: if the statement with
-- that reference is already in, link it now. Never stops the payment.
CREATE OR REPLACE FUNCTION bank_try_link_reference(p_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_line uuid; v_ok boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF bank_ref_norm(p_ref) IS NULL THEN RETURN false; END IF;
  FOR v_line IN SELECT bl.id FROM bank_statement_lines bl
                WHERE bl.reference_code IS NOT NULL AND bank_ref_norm(bl.reference_code) = bank_ref_norm(p_ref)
                  AND bl.transfer_id IS NOT NULL
                ORDER BY bl.value_date LOOP
    BEGIN
      v_ok := bank_link_reference(v_line);
    EXCEPTION WHEN OTHERS THEN v_ok := false;
    END;
    EXIT WHEN v_ok;
  END LOOP;
  RETURN v_ok;
END $$;

CREATE OR REPLACE FUNCTION auto_reconcile_bank_lines_pass(p_import_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; s record; s2 record; v_done int := 0; ru record; v_linked boolean;
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
    -- 1. The reference: whatever payment (or payments) carry it.
    IF r.reference_code IS NOT NULL THEN
      BEGIN
        v_linked := bank_link_reference(r.line_id);
      EXCEPTION WHEN OTHERS THEN v_linked := false;
      END;
      IF v_linked THEN v_done := v_done + 1; CONTINUE; END IF;
    END IF;
    -- 2. A suggestion so strong nothing else comes close.
    SELECT * INTO s FROM suggest_bank_line_matches(r.line_id) x ORDER BY x.score DESC LIMIT 1;
    SELECT * INTO s2 FROM suggest_bank_line_matches(r.line_id) x ORDER BY x.score DESC OFFSET 1 LIMIT 1;
    IF s.score >= 95 AND s.kind IN ('expense', 'expense_part', 'batch', 'vrf', 'sale') AND (s2.score IS NULL OR s2.score < 95) THEN
      BEGIN
        PERFORM apply_bank_line_match(r.line_id, s.kind, s.target_id); v_done := v_done + 1; CONTINUE;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    -- 3. A rule someone saved.
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
END; $function$;

-- The automatic pass, then the charges every matched line carries.
CREATE OR REPLACE FUNCTION auto_reconcile_bank_lines(p_import_id uuid DEFAULT NULL, p_account_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_done int; v_account uuid := p_account_id;
BEGIN
  PERFORM set_config('kuncho.bank_auto', 'on', true);
  v_done := auto_reconcile_bank_lines_pass(p_import_id, p_account_id);
  PERFORM set_config('kuncho.bank_auto', 'off', true);
  IF v_account IS NULL AND p_import_id IS NOT NULL THEN
    SELECT account_id INTO v_account FROM bank_statement_imports WHERE id = p_import_id;
  END IF;
  PERFORM sync_bank_line_charges(v_account, NULL);
  RETURN v_done;
END $$;

-- ── 2. A period closes only when the bank and the payments agree ─────────
CREATE OR REPLACE FUNCTION close_bank_period(p_account_id uuid, p_through date, p_note text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_open int; v_flags int; v_balance numeric; v_recon uuid; r bank_reconciliations%ROWTYPE; v_close uuid;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can close a bank period';
  END IF;
  IF bank_period_closed(p_account_id, p_through) THEN
    RAISE EXCEPTION 'This account is already closed through % or later', p_through;
  END IF;
  SELECT count(*) INTO v_open FROM v_bank_line_status
    WHERE account_id = p_account_id AND value_date <= p_through AND reconciled_as IS NULL;
  IF v_open > 0 THEN
    RAISE EXCEPTION '% line(s) up to % are not reconciled yet — match or explain them first', v_open, p_through;
  END IF;
  -- Paid but not in the bank, amounts that don't tie, a reference used twice.
  SELECT count(*) INTO v_flags FROM v_bank_audit_flags f
    WHERE f.account_id = p_account_id AND f.ref_date <= p_through;
  IF v_flags > 0 THEN
    RAISE EXCEPTION '% bank audit flag(s) up to % are still open — clear them on the Audit tab first', v_flags, p_through;
  END IF;
  SELECT running_balance INTO v_balance FROM bank_statement_lines
    WHERE account_id = p_account_id AND value_date <= p_through AND running_balance IS NOT NULL
    ORDER BY value_date DESC, created_at DESC, line_no DESC LIMIT 1;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'No statement line with a balance on or before % — import the statement first', p_through;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bank_balance_anchors WHERE account_id = p_account_id AND as_of_date >= p_through) THEN
    v_recon := reconcile_account(p_account_id, p_through, v_balance, NULL, 'Bank statement close', p_note);
    SELECT * INTO r FROM bank_reconciliations WHERE id = v_recon;
  END IF;
  INSERT INTO bank_period_closes (account_id, closed_through, statement_balance, system_balance, variance, reconciliation_id, note)
  VALUES (p_account_id, p_through, v_balance, r.system_balance_at_date, r.variance, v_recon, NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_close;
  RETURN v_close;
END; $function$;

-- ── 3. Month-end ──────────────────────────────────────────────────────────
-- Adds, per account, "the bank agrees with the payments"; the global check on
-- payments with no bank line now reads the bank check.
CREATE OR REPLACE FUNCTION month_end_checklist(p_from date, p_to date)
 RETURNS TABLE(account_id uuid, account_name text, check_key text, state text, title text, detail text, amount numeric, item_count integer, link text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE a record; v_n int; v_amt numeric; v_unposted int; v_red int; v_paid int; v_tie int; v_dup int;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can see the month-end checklist';
  END IF;

  FOR a IN
    SELECT c.*, (EXISTS (SELECT 1 FROM sales s WHERE s.account_id = c.account_id AND COALESCE(s.payment_date, s.date) BETWEEN p_from AND p_to)
              OR EXISTS (SELECT 1 FROM expenses e WHERE e.account_id = c.account_id AND e.payment_status AND COALESCE(e.paid_date::date, e.date) BETWEEN p_from AND p_to)
              OR EXISTS (SELECT 1 FROM transfers t WHERE c.account_id IN (t.from_account_id, t.to_account_id) AND t.date BETWEEN p_from AND p_to)) AS moved
    FROM v_account_control c
    WHERE NOT c.not_opened AND (c.has_activity OR c.app_balance <> 0)
    ORDER BY (c.role = 'main') DESC, c.account_name
  LOOP
    CONTINUE WHEN a.statement_date IS NULL AND NOT a.moved AND a.app_balance = 0;

    account_id := a.account_id; account_name := a.account_name; link := '/accounts/' || a.account_id;

    check_key := 'statement'; amount := NULL; item_count := NULL; title := 'Statement imported to month end';
    IF a.statement_date IS NULL THEN
      state := 'todo'; detail := 'No statement imported for this account yet.';
    ELSIF a.statement_date < p_to THEN
      state := 'todo'; detail := 'Statement runs to ' || to_char(a.statement_date, 'DD Mon YYYY') || '; import through ' || to_char(p_to, 'DD Mon YYYY') || '.';
    ELSE
      state := 'ok'; detail := 'Statement runs to ' || to_char(a.statement_date, 'DD Mon YYYY') || '.';
    END IF;
    RETURN NEXT;

    IF a.statement_date IS NOT NULL THEN
      SELECT count(*), COALESCE(sum(l.amount), 0) INTO v_n, v_amt FROM v_bank_line_status l
      WHERE l.account_id = a.account_id AND l.reconciled_as IS NULL AND l.value_date <= p_to;
      check_key := 'open_lines'; title := 'Every bank line explained';
      state := CASE WHEN v_n = 0 THEN 'ok' ELSE 'todo' END;
      detail := CASE WHEN v_n = 0 THEN 'All lines to month end are matched or explained.'
                     ELSE v_n || ' line' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' still to explain.' END;
      amount := v_amt; item_count := v_n; link := '/bank-statement-import?account=' || a.account_id;
      RETURN NEXT;

      SELECT count(*) FILTER (WHERE f.kind = 'paid_not_in_bank'), count(*) FILTER (WHERE f.kind = 'amount_mismatch'),
             count(*) FILTER (WHERE f.kind = 'duplicate_ref'), count(*) FILTER (WHERE f.severity = 'red'),
             COALESCE(sum(f.amount), 0)
        INTO v_paid, v_tie, v_dup, v_red, v_amt
        FROM v_bank_audit_flags f
       WHERE f.account_id = a.account_id AND f.ref_date <= p_to
         AND f.kind IN ('paid_not_in_bank', 'amount_mismatch', 'duplicate_ref');
      v_n := v_paid + v_tie + v_dup;
      check_key := 'bank_audit'; title := 'The bank agrees with the payments';
      state := CASE WHEN v_n = 0 THEN 'ok' WHEN v_red > 0 THEN 'todo' ELSE 'warn' END;
      detail := CASE WHEN v_n = 0 THEN 'Every payment the statement covers is on it, at its amount.'
                     ELSE concat_ws(', ',
                       CASE WHEN v_paid > 0 THEN v_paid || ' paid but not on the statement' END,
                       CASE WHEN v_tie > 0 THEN v_tie || ' amount' || CASE WHEN v_tie = 1 THEN '' ELSE 's' END || ' that don''t tie' END,
                       CASE WHEN v_dup > 0 THEN v_dup || ' reference' || CASE WHEN v_dup = 1 THEN '' ELSE 's' END || ' used twice' END) || '.' END;
      amount := v_amt; item_count := v_n; link := '/bank-statement-import?tab=audit&account=' || a.account_id;
      RETURN NEXT;

      SELECT count(*) INTO v_unposted FROM v_bank_line_ledger l
      WHERE l.account_id = a.account_id AND NOT l.in_ledger AND l.reconciled_as IS NOT NULL
        AND l.reconciled_as <> 'opening_balance' AND l.value_date <= p_to;
      check_key := 'ledger'; title := 'Explained lines are in the ledger';
      state := CASE WHEN v_unposted = 0 THEN 'ok' ELSE 'warn' END;
      detail := CASE WHEN v_unposted = 0 THEN 'Every explained line has its ledger entry.'
                     ELSE v_unposted || ' explained line' || CASE WHEN v_unposted = 1 THEN ' has' ELSE 's have' END || ' no ledger entry (see the tie-out).' END;
      amount := NULL; item_count := v_unposted; link := '/accounts/' || a.account_id;
      RETURN NEXT;

      check_key := 'closed'; title := 'Period closed'; amount := NULL; item_count := NULL;
      state := CASE WHEN a.closed_through >= p_to THEN 'ok' ELSE 'todo' END;
      detail := CASE WHEN a.closed_through IS NULL THEN 'Never closed.'
                     ELSE 'Closed through ' || to_char(a.closed_through, 'DD Mon YYYY') || '.' END;
      link := '/bank-statement-import?account=' || a.account_id;
      RETURN NEXT;
    END IF;

    SELECT count(*), COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), 0) INTO v_n, v_amt FROM expenses e
    WHERE e.account_id = a.account_id AND e.payment_state = 'sent' AND e.transfer_id IS NULL
      AND NOT COALESCE(e.is_archived, false) AND COALESCE(e.payment_state_changed_at::date, e.date) <= p_to
      AND (a.statement_date IS NULL OR COALESCE(e.payment_state_changed_at::date, e.date) <= a.statement_date);
    IF v_n > 0 OR a.statement_date IS NOT NULL THEN
      check_key := 'awaiting_bank'; title := 'Sent payments marked paid';
      state := CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END;
      detail := CASE WHEN v_n = 0 THEN 'Nothing sent is still waiting to be marked paid.'
                     ELSE v_n || ' sent payment' || CASE WHEN v_n = 1 THEN ' still needs' ELSE 's still need' END
                          || ' its bank reference (or the cash confirmed).' END;
      amount := v_amt; item_count := v_n; link := '/finance/payments?tab=confirm';
      RETURN NEXT;
    END IF;

    IF a.role = 'collection' THEN
      check_key := 'swept'; title := 'Money moved on to CBE'; item_count := NULL;
      IF a.waiting_to_move > 0 AND a.waiting_since <= p_to THEN
        state := 'warn'; amount := a.waiting_to_move;
        detail := 'Waiting since ' || to_char(a.waiting_since, 'DD Mon YYYY') || '.';
      ELSE
        state := 'ok'; amount := NULL; detail := 'Nothing left waiting.';
      END IF;
      link := '/accounts/' || a.account_id;
      RETURN NEXT;
    END IF;
  END LOOP;

  account_id := NULL; account_name := NULL;

  SELECT count(*) INTO v_n FROM ledger_posting_failures f WHERE NOT COALESCE(f.resolved, false);
  check_key := 'posting_failures'; title := 'Ledger postings went through'; amount := NULL; item_count := v_n;
  state := CASE WHEN v_n = 0 THEN 'ok' ELSE 'todo' END;
  detail := CASE WHEN v_n = 0 THEN 'No failed postings.' ELSE v_n || ' record' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' could not be posted to the ledger.' END;
  link := '/finance/ledger';
  RETURN NEXT;

  SELECT count(*), COALESCE(sum(x.amount), 0) INTO v_n, v_amt FROM (
    SELECT c.amount FROM v_payment_bank_check c WHERE c.problem = 'not_in_bank' AND c.paid_on BETWEEN p_from AND p_to
    UNION ALL
    SELECT p.amount FROM v_paid_without_bank_line p WHERE p.kind = 'sale' AND p.paid_on BETWEEN p_from AND p_to
  ) x;
  check_key := 'paid_without_bank'; title := 'Payments marked paid are on the bank';
  state := CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END;
  detail := CASE WHEN v_n = 0 THEN 'Everything paid this month that a statement covers is on it.'
                 ELSE v_n || ' marked paid this month but not on the statement that covers it.' END;
  amount := v_amt; item_count := v_n; link := '/bank-statement-import?tab=audit';
  RETURN NEXT;
END $function$;

-- ── 4. Ops health ─────────────────────────────────────────────────────────
-- The bank flags replace "bank line not matched": each flag once it is a week
-- old (big ones at once, and to management), plus a prompt when an account's
-- statement is due. "Sent, not on a bank statement" now asks for the
-- reference, which is what makes a bank payment paid.
CREATE OR REPLACE VIEW v_ops_health_items WITH (security_invoker = true) AS
 SELECT 'po_not_received'::text AS kind,
    b.id::text AS ref_id,
    (COALESCE(b.bundle_code, 'PO'::text) || ' · '::text) || COALESCE(v.vendor_name, b.vendor_name, 'no vendor'::text) AS title,
    ('Expected '::text || to_char(b.expected_delivery_date::timestamp with time zone, 'DD Mon'::text)) ||
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM expenses e
              WHERE e.sourcing_bundle_id = b.id AND (e.payment_state = ANY (ARRAY['paid'::text, 'sent'::text, 'advance'::text])))) THEN ' · already paid'::text
            ELSE ''::text
        END AS detail,
    b.total_value AS amount,
    b.expected_delivery_date AS since,
    'procurement'::text AS owner_team,
    up.full_name AS owner_name,
    b.procurement_officer_id AS owner_user_id,
    '/sourcing/'::text || b.id AS link,
    (EXISTS ( SELECT 1
           FROM expenses e
          WHERE e.sourcing_bundle_id = b.id AND (e.payment_state = ANY (ARRAY['paid'::text, 'sent'::text, 'advance'::text])))) AS urgent
   FROM sourcing_bundles b
     LEFT JOIN vendors v ON v.id = b.vendor_id
     LEFT JOIN user_profiles up ON up.id = b.procurement_officer_id
  WHERE b.status::text = 'ordered'::text AND b.expected_delivery_date < CURRENT_DATE
UNION ALL
 SELECT 'po_not_ordered'::text AS kind,
    b.id::text AS ref_id,
    (COALESCE(b.bundle_code, 'PO'::text) || ' · '::text) || COALESCE(v.vendor_name, b.vendor_name, 'no vendor'::text) AS title,
        CASE b.status::text
            WHEN 'submitted'::text THEN 'Waiting for approval'::text
            ELSE 'Approved, not ordered'::text
        END AS detail,
    b.total_value AS amount,
    COALESCE(b.approved_at, b.submitted_at, b.created_at)::date AS since,
    'procurement'::text AS owner_team,
    up.full_name AS owner_name,
    b.procurement_officer_id AS owner_user_id,
    '/sourcing/'::text || b.id AS link,
    false AS urgent
   FROM sourcing_bundles b
     LEFT JOIN vendors v ON v.id = b.vendor_id
     LEFT JOIN user_profiles up ON up.id = b.procurement_officer_id
  WHERE (b.status::text = ANY (ARRAY['submitted'::text, 'approved'::text])) AND COALESCE(b.approved_at, b.submitted_at, b.created_at) < (now() - '7 days'::interval)
UNION ALL
 SELECT 'pr_not_sourced'::text AS kind,
    o.id::text AS ref_id,
    (COALESCE(o.request_code, 'PR'::text) || ' · '::text) || COALESCE(o.order_name, 'Purchase request'::text) AS title,
    ((( SELECT count(*) AS count
           FROM order_items oi
          WHERE oi.order_id = o.id AND oi.status = 'pending'::text)) || ' line(s) not sourced'::text) || COALESCE(' · needed by '::text || to_char(o.required_by_date::timestamp with time zone, 'DD Mon'::text), ''::text) AS detail,
    ( SELECT sum(oi.quantity * oi.unit_price_est) AS sum
           FROM order_items oi
          WHERE oi.order_id = o.id AND oi.status = 'pending'::text) AS amount,
    o.created_at::date AS since,
    'procurement'::text AS owner_team,
    s.employee_name AS owner_name,
    s.user_id AS owner_user_id,
    '/purchase-requests/'::text || o.id AS link,
    o.required_by_date < CURRENT_DATE AS urgent
   FROM orders o
     LEFT JOIN staff s ON s.id = o.staff_id
  WHERE NOT COALESCE(o.is_archived, false) AND o.approval_status::text <> 'rejected'::text AND o.created_at < (now() - '14 days'::interval) AND (EXISTS ( SELECT 1
           FROM order_items oi
          WHERE oi.order_id = o.id AND oi.status = 'pending'::text))
UNION ALL
 SELECT 'payment_unconfirmed'::text AS kind,
    e.id::text AS ref_id,
    COALESCE(v.vendor_name, e.vendors_name, e.item_service_description, 'Payment'::text) || COALESCE(' · '::text || e.expense_code, ''::text) AS title,
    ('Sent '::text || to_char(e.payment_state_changed_at, 'DD Mon'::text)) ||
        CASE
            WHEN e.payment_method = ANY (ARRAY['transfer'::text, 'cpo'::text, 'cheque'::text, 'batch_wire'::text]) THEN ' — add its bank reference to mark it paid'::text
            WHEN e.payment_method = 'cash'::text THEN ' — confirm the cash was handed over'::text
            ELSE ' — confirm it was paid'::text
        END AS detail,
    e.amount_etb AS amount,
    e.payment_state_changed_at::date AS since,
    'finance'::text AS owner_team,
    NULL::text AS owner_name,
    e.disbursed_by AS owner_user_id,
    '/expenses/'::text || e.id AS link,
    e.payment_state_changed_at < (now() - '21 days'::interval) AS urgent
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
  WHERE e.payment_state = 'sent'::text AND e.payment_state_changed_at < (now() - '7 days'::interval)
UNION ALL
 SELECT 'expense_not_approved'::text AS kind,
    e.id::text AS ref_id,
    COALESCE(v.vendor_name, e.vendors_name, e.item_service_description, 'Expense'::text) || COALESCE(' · '::text || e.expense_code, ''::text) AS title,
    COALESCE(p.project_name, 'No project'::text) AS detail,
    e.amount_etb AS amount,
    e.created_at::date AS since,
    'finance'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    '/expenses/'::text || e.id AS link,
    e.created_at < (now() - '30 days'::interval) AS urgent
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN projects p ON p.id = e.project_id
  WHERE (e.approval_status::text = ANY (ARRAY['pending'::text, 'manager_approved'::text])) AND NOT COALESCE(e.is_archived, false) AND e.created_at < (now() - '7 days'::interval)
UNION ALL
 SELECT 'receipt_missing'::text AS kind,
    e.id::text AS ref_id,
    COALESCE(v.vendor_name, e.vendors_name, e.item_service_description, 'Expense'::text) || COALESCE(' · '::text || e.expense_code, ''::text) AS title,
    ('Paid '::text || COALESCE(to_char(e.paid_date, 'DD Mon'::text), ''::text)) || ' · no receipt attached'::text AS detail,
    e.amount_etb AS amount,
    COALESCE(e.paid_date::date, e.date) AS since,
    'finance'::text AS owner_team,
    buyer.full_name AS owner_name,
    e.purchaser_user_id AS owner_user_id,
    '/expenses/'::text || e.id AS link,
    e.amount_etb >= 100000::numeric AS urgent
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN user_profiles buyer ON buyer.id = e.purchaser_user_id
  WHERE e.payment_state = 'paid'::text AND e.receipt_url IS NULL AND NOT COALESCE(e.is_archived, false)
UNION ALL
 SELECT 'wht_missing'::text AS kind,
    e.id::text AS ref_id,
    v.vendor_name || COALESCE(' · '::text || e.expense_code, ''::text) AS title,
    ((('WHT-eligible vendor, no withholding recorded ('::text || round(wr.rate * 100, 1)) || '% ≈ '::text)
      || to_char(round(e.amount_etb * wr.rate), 'FM999,999,990'::text)) || ')'::text AS detail,
    e.amount_etb AS amount,
    COALESCE(e.paid_date::date, e.date) AS since,
    'finance'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    '/expenses/'::text || e.id AS link,
    true AS urgent
   FROM expenses e
     JOIN vendors v ON v.id = e.vendor_id
     CROSS JOIN LATERAL ( SELECT (tax_rate_note('WHT'::text, COALESCE(e.paid_date::date, e.date)) ->> 'rate'::text)::numeric AS rate) wr
  WHERE v.wth_eligible AND e.amount_etb >= 10000::numeric AND COALESCE(e.wht_amount, 0::numeric) = 0::numeric AND (e.payment_state = ANY (ARRAY['paid'::text, 'sent'::text])) AND NOT COALESCE(e.is_archived, false)
UNION ALL
 SELECT CASE f.kind
            WHEN 'bank_not_recorded'::text THEN 'bank_out_unrecorded'::text
            WHEN 'money_in_no_sale'::text THEN 'bank_in_unrecorded'::text
            WHEN 'paid_not_in_bank'::text THEN 'bank_paid_not_on_bank'::text
            WHEN 'amount_mismatch'::text THEN 'bank_amount_mismatch'::text
            ELSE 'bank_duplicate_ref'::text
        END AS kind,
    f.flag_id AS ref_id,
    (COALESCE(f.account_name, 'Bank'::text) || ' · '::text) || "left"(f.title, 70) AS title,
    f.detail,
    f.amount,
    f.ref_date AS since,
    CASE WHEN f.big THEN 'management'::text ELSE 'finance'::text END AS owner_team,
    f.payer_name AS owner_name,
    f.payer_id AS owner_user_id,
    f.link,
    f.severity = 'red'::text OR f.big AS urgent
   FROM v_bank_audit_flags f
  WHERE (get_user_role() = ANY (ARRAY['admin'::user_role, 'finance'::user_role])) AND (f.severity <> 'new'::text OR f.big)
UNION ALL
 SELECT 'statement_due'::text AS kind,
    a.id::text AS ref_id,
    a.account_name || ' statement'::text AS title,
        CASE
            WHEN o.last_date IS NULL THEN 'No statement imported yet'::text
            ELSE (('Runs to '::text || to_char(o.last_date::timestamp with time zone, 'DD Mon YYYY'::text)) || ' — import one every '::text) || s.statement_every_days || ' days'::text
        END AS detail,
    NULL::numeric AS amount,
    o.last_date AS since,
    'finance'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    '/bank-statement-import?tab=import&account='::text || a.id AS link,
    o.last_date IS NULL OR o.last_date < (CURRENT_DATE - 2 * s.statement_every_days) AS urgent
   FROM accounts a
     CROSS JOIN bank_audit_settings s
     LEFT JOIN v_bank_account_overview o ON o.account_id = a.id
  WHERE (get_user_role() = ANY (ARRAY['admin'::user_role, 'finance'::user_role]))
    AND a.type ~~* 'bank%'::text AND lower(COALESCE(a.status, 'active'::text)) = 'active'::text
    AND (o.last_date IS NULL OR o.last_date < (CURRENT_DATE - s.statement_every_days))
    AND (COALESCE(o.line_count, 0::bigint) > 0 OR (EXISTS ( SELECT 1
           FROM expenses e
          WHERE e.account_id = a.id AND (e.payment_method = ANY (ARRAY['transfer'::text, 'cpo'::text, 'cheque'::text, 'batch_wire'::text]))
            AND (e.payment_state = ANY (ARRAY['sent'::text, 'paid'::text, 'advance'::text]))
            AND COALESCE(e.paid_date::date, e.payment_state_changed_at::date, e.date) >= (CURRENT_DATE - 90))))
UNION ALL
 SELECT 'transport_open'::text AS kind,
    t.id::text AS ref_id,
    COALESCE(t.request_name, 'Transport job'::text) || COALESCE(' · '::text || p.project_name, ''::text) AS title,
    initcap(replace(COALESCE(t.job_status, 'requested'::text), '_'::text, ' '::text)) || COALESCE(' · '::text || s.employee_name, ''::text) AS detail,
    t.amount,
    t.created_at::date AS since,
    'logistics'::text AS owner_team,
    s.employee_name AS owner_name,
    s.user_id AS owner_user_id,
    ('/transportation/'::text || t.id) || '/edit'::text AS link,
    t.created_at < (now() - '21 days'::interval) AS urgent
   FROM transportation_requests t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN staff s ON s.id = t.assigned_staff_id
  WHERE (COALESCE(t.job_status, ''::text) <> ALL (ARRAY['completed'::text, 'cancelled'::text])) AND t.created_at < (now() - '7 days'::interval)
UNION ALL
 SELECT 'labor_not_decided'::text AS kind,
    r.id::text AS ref_id,
    (((r.role_needed || ' ×'::text) || r.headcount) || ' · '::text) || COALESCE(p.project_name, ''::text) AS title,
    ('Starts '::text || to_char(r.start_date::timestamp with time zone, 'DD Mon'::text)) || COALESCE((' · '::text || to_char(r.estimated_total_cost, 'FM999,999,990'::text)) || ' ETB'::text, ''::text) AS detail,
    r.estimated_total_cost AS amount,
    r.created_at::date AS since,
    'hr'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    '/labor-requisitions/'::text || r.id AS link,
    r.start_date <= CURRENT_DATE AS urgent
   FROM labor_requisitions r
     LEFT JOIN projects p ON p.id = r.project_id
  WHERE r.status = 'pending'::text AND r.created_at < (now() - '3 days'::interval)
UNION ALL
 SELECT 'labor_overstay'::text AS kind,
    a.id::text AS ref_id,
    (((COALESCE(s.employee_name, 'Worker'::text) || ' · '::text) || r.role_needed) || ' · '::text) || COALESCE(p.project_name, ''::text) AS title,
    ((('Requisition ended '::text || to_char(r.end_date::timestamp with time zone, 'DD Mon'::text)) || ' — still active at '::text) || COALESCE(to_char(a.day_rate_snapshot, 'FM999,990'::text), '?'::text)) || '/day'::text AS detail,
    a.day_rate_snapshot * (CURRENT_DATE - r.end_date)::numeric AS amount,
    r.end_date AS since,
    'project'::text AS owner_team,
    pm.employee_name AS owner_name,
    pm.user_id AS owner_user_id,
    '/labor-requisitions/'::text || r.id AS link,
    (CURRENT_DATE - r.end_date) > 14 AS urgent
   FROM labor_allocations a
     JOIN labor_requisitions r ON r.id = a.labor_requisition_id
     LEFT JOIN staff s ON s.id = a.staff_id
     LEFT JOIN projects p ON p.id = r.project_id
     LEFT JOIN staff pm ON pm.id = p.project_manager_id
  WHERE a.status = 'active'::text AND r.end_date < CURRENT_DATE AND (a.end_date IS NULL OR a.end_date > r.end_date)
UNION ALL
 SELECT 'labor_unfilled'::text AS kind,
    r.id::text AS ref_id,
    (r.role_needed || ' · '::text) || COALESCE(p.project_name, ''::text) AS title,
    (((COALESCE(r.slots_filled, 0) || ' of '::text) || r.headcount) || ' filled · started '::text) || to_char(r.start_date::timestamp with time zone, 'DD Mon'::text) AS detail,
    r.estimated_total_cost AS amount,
    r.start_date AS since,
    'hr'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    '/labor-requisitions/'::text || r.id AS link,
    false AS urgent
   FROM labor_requisitions r
     LEFT JOIN projects p ON p.id = r.project_id
  WHERE r.status = 'approved'::text AND r.closed_at IS NULL AND COALESCE(r.slots_filled, 0) < r.headcount AND r.start_date < (CURRENT_DATE - 3) AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)
UNION ALL
 SELECT 'vendor_unverified'::text AS kind,
    v.id::text AS ref_id,
    v.vendor_name AS title,
    ('Bank details not verified · '::text || to_char(m.owed, 'FM999,999,990'::text)) || ' ETB approved to pay'::text AS detail,
    m.owed AS amount,
    v.entered_at::date AS since,
    'finance'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    '/vendors/review?vendor='::text || v.id AS link,
    true AS urgent
   FROM vendors v
     JOIN v_vendor_money m ON m.vendor_id = v.id
  WHERE v.verification_status = 'pending_verification'::text AND m.owed > 0::numeric
UNION ALL
 SELECT 'project_no_pm'::text AS kind,
    p.id::text AS ref_id,
    p.project_name AS title,
    'No project manager assigned'::text AS detail,
    p.contract_value AS amount,
    p.created_at::date AS since,
    'management'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    '/projects/'::text || p.id AS link,
    false AS urgent
   FROM projects p
  WHERE p.project_manager_id IS NULL AND COALESCE(p.active_for_year, false) AND NOT COALESCE(p.is_internal, false)
UNION ALL
 SELECT 'sdn_to_confirm'::text AS kind,
    s.id::text AS ref_id,
    (s.sdn_code || ' · '::text) || COALESCE(s.project_name, 'site'::text) AS title,
    ((COALESCE(s.vendor_name, ''::text) || ' · signed by '::text) || COALESCE(s.signed_by_name, 'the site'::text)) || ' with exceptions'::text AS detail,
    NULL::numeric AS amount,
    s.signed_at::date AS since,
    'procurement'::text AS owner_team,
    up.full_name AS owner_name,
    sb.procurement_officer_id AS owner_user_id,
    '/site-deliveries/'::text || s.id AS link,
    false AS urgent
   FROM site_delivery_notes s
     JOIN sourcing_bundles sb ON sb.id = s.sourcing_bundle_id
     LEFT JOIN user_profiles up ON up.id = sb.procurement_officer_id
  WHERE s.status = 'exceptions'::text
UNION ALL
 SELECT 'sdn_unsigned'::text AS kind,
    s.id::text AS ref_id,
    (s.sdn_code || ' · '::text) || COALESCE(s.project_name, 'site'::text) AS title,
    (COALESCE(s.vendor_name, ''::text) || ' · expected '::text) || to_char(COALESCE(s.expected_on, s.issued_at::date)::timestamp with time zone, 'DD Mon'::text) AS detail,
    NULL::numeric AS amount,
    COALESCE(s.expected_on, s.issued_at::date) AS since,
    'project'::text AS owner_team,
    st.employee_name AS owner_name,
    st.user_id AS owner_user_id,
    '/site-deliveries/'::text || s.id AS link,
    COALESCE(s.expected_on, s.issued_at::date) < (CURRENT_DATE - 3) AS urgent
   FROM site_delivery_notes s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN staff st ON st.id = p.project_manager_id
  WHERE s.status = 'issued'::text AND COALESCE(s.expected_on, s.issued_at::date + 1) < CURRENT_DATE
UNION ALL
 SELECT 'site_report_missing'::text AS kind,
    g.project_id::text AS ref_id,
    min(g.project_name) AS title,
    (count(*) || ' working days without a report · since '::text) || to_char(min(g.report_date)::timestamp with time zone, 'DD Mon'::text) AS detail,
    NULL::numeric AS amount,
    min(g.report_date) AS since,
    'project'::text AS owner_team,
    min(g.pm_name) AS owner_name,
    (array_agg(g.pm_user_id))[1] AS owner_user_id,
    '/site-foreman/reports?project='::text || g.project_id AS link,
    count(*) >= (2 * (( SELECT site_report_settings.escalate_after_days
           FROM site_report_settings))) AS urgent
   FROM site_report_gaps(NULL::uuid) g(project_id, project_name, report_date, state, draft_id, had_activity, foreman_staff_ids, foreman_names, pm_staff_id, pm_name, pm_user_id, last_reminded_at)
  GROUP BY g.project_id
 HAVING count(*) >= (( SELECT site_report_settings.escalate_after_days
           FROM site_report_settings))
UNION ALL
 SELECT 'tax_impact_stuck'::text AS kind,
    t.id::text AS ref_id,
    ((('T'::text || t.rnk) || ' · '::text) || COALESCE(t.code, ''::text)) || COALESCE(' · '::text || t.vendor, ''::text) AS title,
    ((((
        CASE
            WHEN t.queue = 'approve'::text THEN 'Waiting for approval '::text
            ELSE 'Approved, not paid '::text
        END || t.age_days) || ' days · '::text) || to_char(t.vat, 'FM999,999,990'::text)) || ' VAT for '::text) || t.period AS detail,
    t.vat AS amount,
    CURRENT_DATE - t.age_days AS since,
    'finance'::text AS owner_team,
    NULL::text AS owner_name,
    NULL::uuid AS owner_user_id,
    '/expenses/'::text || t.id AS link,
    true AS urgent
   FROM tax_impact_overdue() t(id, code, label, vendor, queue, vat, share, rnk, age_days, period);

-- ── 5. Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON v_ops_health_items FROM PUBLIC, anon;
GRANT SELECT ON v_ops_health_items TO authenticated;

REVOKE ALL ON FUNCTION bank_reference_claims(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bank_reference_claims(text, text) TO authenticated;
-- Internal: reached only through the reconciliation functions.
REVOKE ALL ON FUNCTION bank_link_reference(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bank_try_link_reference(text) FROM PUBLIC, anon, authenticated;
-- Redefined above; their grants stand, restated for clarity.
REVOKE ALL ON FUNCTION apply_bank_line_match(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION unmatch_bank_line(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION suggest_bank_line_matches(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION auto_reconcile_bank_lines_pass(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION auto_reconcile_bank_lines(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION match_expense_to_transfer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION match_expense_part_to_transfer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION close_bank_period(uuid, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION month_end_checklist(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_bank_line_match(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION unmatch_bank_line(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION suggest_bank_line_matches(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION auto_reconcile_bank_lines(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION match_expense_to_transfer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION match_expense_part_to_transfer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION close_bank_period(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION month_end_checklist(date, date) TO authenticated;

