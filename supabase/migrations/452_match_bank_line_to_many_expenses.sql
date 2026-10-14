-- 452 — One bank line that paid several expenses
--
-- Often several bills go out in one transfer (one cheque or one wire for
-- three invoices from the same supplier, or a labour run). A bank line could
-- only be matched to one expense, or to a batch someone had built before
-- paying. Now, from the line itself:
--   • match_bank_line_to_expenses() — pick the expenses the line paid. They
--     must add up to the line's amount (within 1 ETB); a real difference
--     (a charge, a rounding by the bank) is accepted only with a reason.
--     Each expense becomes paid by that line and takes its bank account;
--     the group is kept as a batch payment, so it shows on the line, in
--     Batch Payments, and an undo releases the line and keeps the group.
--     Expenses still "approved to pay" take a payer (p_paid_by, default the
--     person reconciling) — never the person who approved them.
--   • suggest_bank_line_combinations() — sets of 2–4 open expenses that add
--     up to the line, same-vendor sets first.

SET search_path TO public;

-- A first version without the payer was briefly live; set it aside.
DO $$
BEGIN
  IF to_regprocedure('public.match_bank_line_to_expenses(uuid, uuid[], text, boolean)') IS NOT NULL THEN
    ALTER FUNCTION public.match_bank_line_to_expenses(uuid, uuid[], text, boolean) RENAME TO match_bank_line_to_expenses_v0;
    REVOKE EXECUTE ON FUNCTION public.match_bank_line_to_expenses_v0(uuid, uuid[], text, boolean) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.match_bank_line_to_expenses(p_line_id uuid, p_expense_ids uuid[],
  p_note text DEFAULT NULL, p_accept_difference boolean DEFAULT false, p_paid_by uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE l v_bank_line_status; v_ids uuid[]; v_bad text; v_total numeric; v_diff numeric; v_batch uuid; v_code text;
        x record; v_payer uuid := COALESCE(p_paid_by, auth.uid());
BEGIN
  l := bank_line_guard(p_line_id);
  IF l.direction <> 'debit' THEN RAISE EXCEPTION 'Money coming in cannot pay expenses'; END IF;
  v_ids := ARRAY(SELECT DISTINCT unnest(p_expense_ids));
  IF COALESCE(array_length(v_ids, 1), 0) < 2 THEN
    RAISE EXCEPTION 'Pick at least two expenses — for one, match it directly';
  END IF;
  IF (SELECT count(*) FROM expenses WHERE id = ANY (v_ids)) <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'One of the expenses no longer exists';
  END IF;

  SELECT string_agg(COALESCE(e.expense_code, 'an expense') || ' (' ||
           CASE WHEN COALESCE(e.is_archived, false) THEN 'archived'
                WHEN e.transfer_id IS NOT NULL THEN 'already has a bank line'
                WHEN COALESCE(e.in_parts, false) THEN 'paid in parts — match its parts'
                WHEN EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = e.id) THEN 'in a batch payment — match the batch'
                ELSE 'not approved to pay' END || ')', ', ')
    INTO v_bad
    FROM expenses e
   WHERE e.id = ANY (v_ids)
     AND (COALESCE(e.is_archived, false) OR e.transfer_id IS NOT NULL OR COALESCE(e.in_parts, false)
          OR EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = e.id)
          OR e.payment_state NOT IN ('approved_to_pay', 'sent', 'paid', 'advance'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Cannot match: %', v_bad; END IF;

  SELECT sum(COALESCE(net_payable, amount_etb, 0)) INTO v_total FROM expenses WHERE id = ANY (v_ids);
  v_diff := l.amount - v_total;
  IF abs(v_diff) > 1 THEN
    IF NOT p_accept_difference THEN
      RAISE EXCEPTION 'These expenses add up to % but the bank line is % (a difference of %). Change the selection, or accept the difference with a reason',
        to_char(v_total, 'FM999,999,999,990.00'), to_char(l.amount, 'FM999,999,999,990.00'), to_char(v_diff, 'FM999,999,999,990.00');
    END IF;
    IF NULLIF(btrim(p_note), '') IS NULL THEN
      RAISE EXCEPTION 'Say why the bank line and the expenses differ by %', to_char(v_diff, 'FM999,999,999,990.00');
    END IF;
  END IF;

  -- Not yet sent: record who paid. The approver cannot also be the payer.
  IF EXISTS (SELECT 1 FROM expenses WHERE id = ANY (v_ids) AND disbursed_by IS NULL) THEN
    IF COALESCE((SELECT role::text FROM user_profiles WHERE id = v_payer), '') NOT IN ('admin', 'finance') THEN
      RAISE EXCEPTION 'Who paid must be an admin or finance user';
    END IF;
    SELECT string_agg(COALESCE(expense_code, 'an expense'), ', ') INTO v_bad
      FROM expenses WHERE id = ANY (v_ids) AND disbursed_by IS NULL AND finance_approved_by = v_payer;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '% approved % — pick someone else as who paid', COALESCE((SELECT full_name FROM user_profiles WHERE id = v_payer), 'The payer'), v_bad;
    END IF;
    UPDATE expenses SET disbursed_by = v_payer WHERE id = ANY (v_ids) AND disbursed_by IS NULL;
  END IF;

  -- Each expense: paid by this line, from its bank account (the same rules
  -- as matching one expense, before it joins the group).
  FOR x IN SELECT id, expense_code FROM expenses WHERE id = ANY (v_ids) ORDER BY expense_code LOOP
    BEGIN
      PERFORM match_expense_to_transfer(x.id, l.transfer_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%: %', COALESCE(x.expense_code, 'An expense'), SQLERRM;
    END;
  END LOOP;

  v_code := 'BANK-' || to_char(l.value_date, 'YYYYMMDD') || '-' ||
            (SELECT count(*) + 1 FROM batch_payments WHERE payment_code LIKE 'BANK-' || to_char(l.value_date, 'YYYYMMDD') || '-%');
  INSERT INTO batch_payments (payment_code, notes, transfer_id, paid_date, bank_ref)
  VALUES (v_code,
          concat_ws(' — ', format('%s expenses paid in one bank transfer of %s', array_length(v_ids, 1), to_char(l.amount, 'FM999,999,999,990.00')),
                    NULLIF(btrim(p_note), '')),
          l.transfer_id, l.value_date, NULLIF(btrim(COALESCE(l.reference, l.reference_code)), ''))
  RETURNING id INTO v_batch;
  INSERT INTO batch_payment_expenses (batch_payment_id, expense_id) SELECT v_batch, unnest(v_ids);

  UPDATE bank_statement_lines
     SET match_status = 'matched_expense', matched_expense_amount = v_total, variance_amount = v_diff
   WHERE id = p_line_id;

  IF COALESCE(current_setting('kuncho.bank_auto', true), '') <> 'on' THEN
    PERFORM sync_bank_line_charges(NULL, p_line_id);
  END IF;
  RETURN v_batch;
END $function$;

-- Sets of open expenses that add up to an outgoing bank line.
CREATE OR REPLACE FUNCTION public.suggest_bank_line_combinations(p_line_id uuid)
RETURNS TABLE (expense_ids uuid[], total numeric, difference numeric, n integer, same_vendor boolean,
               vendor_names text, codes text, score integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE l v_bank_line_status;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT * INTO l FROM v_bank_line_status WHERE line_id = p_line_id;
  IF l.line_id IS NULL OR l.direction <> 'debit' OR l.reconciled_as IS NOT NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH RECURSIVE cand AS (
    SELECT e.id, e.vendor_id, e.expense_code, COALESCE(e.net_payable, e.amount_etb) AS amt,
           row_number() OVER (ORDER BY abs(COALESCE(e.paid_date::date, e.payment_state_changed_at::date, e.date) - l.value_date), e.id) AS rn
      FROM expenses e
     WHERE e.transfer_id IS NULL AND e.payment_state IN ('approved_to_pay', 'sent', 'paid', 'advance')
       AND NOT COALESCE(e.in_parts, false) AND NOT COALESCE(e.is_archived, false)
       AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = e.id)
       AND COALESCE(e.net_payable, e.amount_etb) > 0 AND COALESCE(e.net_payable, e.amount_etb) < l.amount
       AND COALESCE(e.paid_date::date, e.payment_state_changed_at::date, e.date) BETWEEN l.value_date - 60 AND l.value_date + 10
  ), c AS (SELECT * FROM cand WHERE cand.rn <= 30),
  combo (last_rn, ids, vendors, tot, k) AS (
    SELECT c.rn, ARRAY[c.id], ARRAY[c.vendor_id], c.amt, 1 FROM c
    UNION ALL
    SELECT x.rn, combo.ids || x.id, combo.vendors || x.vendor_id, combo.tot + x.amt, combo.k + 1
      FROM combo JOIN c x ON x.rn > combo.last_rn
     WHERE combo.k < 4 AND combo.tot + x.amt <= l.amount + 1
  ), hits AS (
    SELECT combo.ids, combo.tot, combo.k,
           (SELECT count(DISTINCT v) FROM unnest(combo.vendors) v) = 1 AND combo.vendors[1] IS NOT NULL AS one_vendor
      FROM combo WHERE combo.k >= 2 AND abs(combo.tot - l.amount) <= 1
  )
  SELECT h.ids, h.tot, l.amount - h.tot, h.k, h.one_vendor,
         (SELECT string_agg(DISTINCT COALESCE(v.vendor_name, 'no vendor'), ', ') FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id WHERE e.id = ANY (h.ids)),
         (SELECT string_agg(COALESCE(e.expense_code, '—'), ', ' ORDER BY e.expense_code) FROM expenses e WHERE e.id = ANY (h.ids)),
         (CASE WHEN h.one_vendor THEN 90 ELSE 60 END - (h.k - 2) * 5)::integer
    FROM hits h
   ORDER BY h.one_vendor DESC, h.k, h.tot DESC
   LIMIT 6;
END $function$;

REVOKE EXECUTE ON FUNCTION match_bank_line_to_expenses(uuid, uuid[], text, boolean, uuid), suggest_bank_line_combinations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_bank_line_to_expenses(uuid, uuid[], text, boolean, uuid), suggest_bank_line_combinations(uuid) TO authenticated;
