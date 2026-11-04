-- 499: salaries matched the way they are paid.
--
-- A payroll run is paid in pieces: a bulk transfer from Zemen for the staff
-- banking there ("Salary payment … to VARIOUS account"), one CBE transfer per
-- person for the rest (each with its 6.00 fee), each tagged with the payment
-- request typed into the narration (PRQ20260074). Until now a bank line could
-- only be tied to a whole run, so a 30,006 line "paid" a 514,000 run, the
-- difference showed as a variance, nothing said who was paid, and nothing
-- reached the books (no payroll run has ever posted: they are paid from
-- several accounts, and the posting needed one).
--
-- Now each line pays particular people on a run:
--   · payroll_staff.bank_line_id records the line that paid each person;
--   · payroll_line_plan works out who a line paid: everyone on the payment
--     request it names (a voided request still names its run), one person
--     on it, everyone on that bank's request, everyone not on another bank's
--     request, everyone still unpaid, or one person whose pay (plus the fee)
--     is the line;
--   · match_bank_line_to_payroll ties a line to the people picked, posts it
--     (salaries against that bank's cash), and marks the run paid once
--     everyone is covered and it is approved;
--   · undoing the match frees them and takes the posting back.
-- Automatic matching settles a salary line when its payment request names it.

ALTER TABLE payroll_staff ADD COLUMN IF NOT EXISTS bank_line_id uuid REFERENCES bank_statement_lines(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payroll_staff_bank_line_idx ON payroll_staff (bank_line_id) WHERE bank_line_id IS NOT NULL;
COMMENT ON COLUMN payroll_staff.bank_line_id IS 'The bank statement line that paid this person on this run (499).';

-- The people a payment request lists, with what it pays each.
CREATE OR REPLACE FUNCTION public.payment_request_staff(p_request_id uuid)
RETURNS TABLE(staff_id uuid, amount numeric, bank_name text) LANGUAGE sql STABLE SET search_path TO 'public' AS $f$
  SELECT substring(x->>'key' FROM '^worker:([0-9a-f-]{36})$')::uuid, NULLIF(x->>'amount', '')::numeric, x->>'bankName'
  FROM payment_requests pr
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(pr.payee_lines) = 'array' THEN pr.payee_lines ELSE '[]'::jsonb END) x
  WHERE pr.id = p_request_id AND x->>'key' ~ '^worker:[0-9a-f-]{36}$'
$f$;

-- Whether these people's pay is the line: the same, or the line plus the bank's fee.
CREATE OR REPLACE FUNCTION public.payroll_staff_fit(p_payroll_id uuid, p_staff uuid[], p_amount numeric)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $f$
  SELECT COALESCE(cardinality(p_staff), 0) > 0
     AND p_amount - (SELECT COALESCE(sum(net_amount), 0) FROM payroll_staff WHERE payroll_id = p_payroll_id AND staff_id = ANY (p_staff))
         BETWEEN -0.01 AND 25
$f$;

-- Who on a run a bank line paid, if it can be told; nobody already paid by another line.
CREATE OR REPLACE FUNCTION public.payroll_line_plan(p_line_id uuid, p_payroll_id uuid)
RETURNS TABLE(staff_id uuid, employee_name text, net numeric, how text, request_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l record; v_codes text[]; v_ids uuid[]; v_how text; v_code text; r record; v_others uuid[];
BEGIN
  SELECT b.id, b.account_id, b.value_date, COALESCE(b.debit_amount, 0) AS amount,
         COALESCE(b.narration, '') || ' ' || COALESCE(b.reference, '') AS txt, a.account_name
    INTO l FROM bank_statement_lines b JOIN accounts a ON a.id = b.account_id WHERE b.id = p_line_id;
  IF l.id IS NULL OR l.amount <= 0 THEN RETURN; END IF;
  v_codes := bank_doc_codes(l.txt);

  -- 1. The payment request the narration names (voided or replaced ones too:
  --    the code was typed when the money was sent).
  FOR r IN SELECT pr.id, pr.request_code FROM payment_requests pr
           WHERE pr.payroll_id = p_payroll_id AND pr.request_code = ANY (v_codes)
           ORDER BY (pr.status::text = 'issued') DESC, pr.issued_at DESC NULLS LAST LOOP
    SELECT array_agg(ps.staff_id) INTO v_ids FROM payroll_staff ps
      WHERE ps.payroll_id = p_payroll_id AND ps.bank_line_id IS NULL
        AND ps.staff_id IN (SELECT q.staff_id FROM payment_request_staff(r.id) q);
    IF payroll_staff_fit(p_payroll_id, v_ids, l.amount) THEN v_how := 'Everyone on ' || r.request_code; v_code := r.request_code; EXIT; END IF;
    SELECT ARRAY[ps.staff_id] INTO v_ids FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
      WHERE ps.payroll_id = p_payroll_id AND ps.bank_line_id IS NULL
        AND ps.staff_id IN (SELECT q.staff_id FROM payment_request_staff(r.id) q)
        AND l.amount - ps.net_amount BETWEEN -0.01 AND 25
      ORDER BY ps.net_amount DESC, st.employee_name LIMIT 1;
    IF v_ids IS NOT NULL THEN v_how := 'On ' || r.request_code; v_code := r.request_code; EXIT; END IF;
  END LOOP;

  -- 2. The payment request for this bank: everyone on it.
  IF v_how IS NULL THEN
    FOR r IN SELECT pr.id, pr.request_code FROM payment_requests pr
             WHERE pr.payroll_id = p_payroll_id AND pr.bank_id = l.account_id AND pr.status::text = 'issued'
             ORDER BY pr.issued_at DESC NULLS LAST LOOP
      SELECT array_agg(ps.staff_id) INTO v_ids FROM payroll_staff ps
        WHERE ps.payroll_id = p_payroll_id AND ps.bank_line_id IS NULL
          AND ps.staff_id IN (SELECT q.staff_id FROM payment_request_staff(r.id) q);
      IF payroll_staff_fit(p_payroll_id, v_ids, l.amount) THEN
        v_how := 'Everyone on ' || r.request_code || ' (' || l.account_name || ')'; v_code := r.request_code; EXIT;
      END IF;
    END LOOP;
  END IF;

  -- 3. Everyone not paid through another bank's payment request.
  IF v_how IS NULL THEN
    SELECT array_agg(DISTINCT q.staff_id) INTO v_others FROM payment_requests pr CROSS JOIN LATERAL payment_request_staff(pr.id) q
      WHERE pr.payroll_id = p_payroll_id AND pr.status::text = 'issued' AND pr.bank_id IS NOT NULL AND pr.bank_id <> l.account_id;
    IF v_others IS NOT NULL THEN
      SELECT array_agg(ps.staff_id) INTO v_ids FROM payroll_staff ps
        WHERE ps.payroll_id = p_payroll_id AND ps.bank_line_id IS NULL AND ps.staff_id <> ALL (v_others);
      IF payroll_staff_fit(p_payroll_id, v_ids, l.amount) THEN v_how := 'Everyone not paid through another bank'; END IF;
    END IF;
  END IF;

  -- 4. Everyone still unpaid on the run.
  IF v_how IS NULL THEN
    SELECT array_agg(ps.staff_id) INTO v_ids FROM payroll_staff ps WHERE ps.payroll_id = p_payroll_id AND ps.bank_line_id IS NULL;
    IF payroll_staff_fit(p_payroll_id, v_ids, l.amount) THEN
      v_how := CASE WHEN EXISTS (SELECT 1 FROM payroll_staff WHERE payroll_id = p_payroll_id AND bank_line_id IS NOT NULL)
                    THEN 'Everyone still unpaid' ELSE 'The whole run' END;
    END IF;
  END IF;

  -- 5. Everyone with their pay account at this bank.
  IF v_how IS NULL THEN
    SELECT array_agg(ps.staff_id) INTO v_ids FROM payroll_staff ps JOIN staff_bank_accounts sba ON sba.id = ps.staff_bank_account_id
      WHERE ps.payroll_id = p_payroll_id AND ps.bank_line_id IS NULL AND sba.bank_id = l.account_id;
    IF payroll_staff_fit(p_payroll_id, v_ids, l.amount) THEN v_how := 'Everyone paid at ' || l.account_name; END IF;
  END IF;

  -- 6. One person whose pay, plus the fee, is the line.
  IF v_how IS NULL THEN
    SELECT ARRAY[ps.staff_id] INTO v_ids FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
      LEFT JOIN staff_bank_accounts sba ON sba.id = ps.staff_bank_account_id
      WHERE ps.payroll_id = p_payroll_id AND ps.bank_line_id IS NULL AND l.amount - ps.net_amount BETWEEN -0.01 AND 25
      ORDER BY (sba.bank_id = l.account_id) DESC NULLS LAST, ps.net_amount DESC, st.employee_name LIMIT 1;
    IF v_ids IS NOT NULL THEN v_how := 'One person''s pay'; END IF;
  END IF;

  IF v_how IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT ps.staff_id, st.employee_name, ps.net_amount, v_how, v_code
    FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
    WHERE ps.payroll_id = p_payroll_id AND ps.staff_id = ANY (v_ids)
    ORDER BY ps.net_amount DESC, st.employee_name;
END $f$;

-- A salary line in the books: the pay of the people it paid, from that bank.
CREATE OR REPLACE FUNCTION public.post_payroll_bank_line(p_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l bank_statement_lines%ROWTYPE; v_gross numeric; v_net numeric; v_n int; v_cash uuid; v_record text; v_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO l FROM bank_statement_lines WHERE id = p_line_id;
  IF l.id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(sum(ps.gross_amount), 0), COALESCE(sum(ps.net_amount), 0), count(*), max(p.payroll_record)
    INTO v_gross, v_net, v_n, v_record
    FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
   WHERE ps.bank_line_id = p_line_id
     -- A run already posted as a whole (from one account) isn't posted again.
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'payroll' AND je.source_id = p.id);
  BEGIN
    IF v_n > 0 AND fiscal_period_for_date(l.value_date) = (SELECT id FROM fiscal_periods WHERE is_current) THEN
      SELECT id INTO v_cash FROM chart_of_accounts WHERE linked_account_id = l.account_id;
      IF v_cash IS NULL THEN
        PERFORM log_posting_failure('payroll_bank_line', p_line_id, 'No ledger cash account is linked to this bank account');
        RETURN;
      END IF;
      v_lines := jsonb_build_array(ledger_line((SELECT id FROM chart_of_accounts WHERE account_code = '6101'), round(GREATEST(v_gross, v_net), 2),
                                               'Salaries: ' || v_n || CASE WHEN v_n = 1 THEN ' person' ELSE ' people' END),
                                   ledger_line(v_cash, -round(v_net, 2), 'Net pay sent'));
      IF v_gross - v_net > 0.005 THEN
        v_lines := v_lines || jsonb_build_array(ledger_line((SELECT id FROM chart_of_accounts WHERE account_code = '2020'),
                                                            -round(v_gross - v_net, 2), 'Withheld from their pay'));
      END IF;
    END IF;
    PERFORM ledger_sync('payroll_bank_line', p_line_id, l.value_date, 'Salaries paid: ' || COALESCE(v_record, 'payroll'), v_lines);
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('payroll_bank_line', p_line_id, SQLERRM);
  END;
END $f$;

-- Tie a bank line to the people on a run it paid.
CREATE OR REPLACE FUNCTION public.match_bank_line_to_payroll(p_line_id uuid, p_payroll_id uuid, p_staff_ids uuid[], p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l v_bank_line_status; p payroll%ROWTYPE; v_ids uuid[]; v_n int; v_net numeric; v_diff numeric; v_taken text;
BEGIN
  l := bank_line_guard(p_line_id);
  IF l.direction <> 'debit' THEN RAISE EXCEPTION 'Money coming in cannot pay salaries'; END IF;
  SELECT * INTO p FROM payroll WHERE id = p_payroll_id;
  IF p.id IS NULL OR COALESCE(p.is_archived, false) THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_staff_ids) x WHERE x IS NOT NULL;
  IF v_ids IS NULL THEN RAISE EXCEPTION 'Pick who this line paid'; END IF;
  SELECT count(*), COALESCE(sum(net_amount), 0) INTO v_n, v_net FROM payroll_staff WHERE payroll_id = p.id AND staff_id = ANY (v_ids);
  IF v_n <> cardinality(v_ids) THEN RAISE EXCEPTION 'Someone picked is not on %', COALESCE(p.payroll_record, 'this run'); END IF;
  SELECT string_agg(st.employee_name, ', ') INTO v_taken FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
   WHERE ps.payroll_id = p.id AND ps.staff_id = ANY (v_ids) AND ps.bank_line_id IS NOT NULL;
  IF v_taken IS NOT NULL THEN RAISE EXCEPTION '% already paid by another bank line', v_taken; END IF;
  v_diff := round(l.amount - v_net, 2);
  IF v_diff < -0.01 THEN
    RAISE EXCEPTION 'The people picked get %, more than the line (%)', to_char(v_net, 'FM999,999,999,990.00'), to_char(l.amount, 'FM999,999,999,990.00');
  END IF;
  IF v_diff > 25 AND NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'The line is % more than their pay — pick who else it paid, or say why in a note', to_char(v_diff, 'FM999,999,990.00');
  END IF;

  UPDATE payroll_staff SET bank_line_id = p_line_id WHERE payroll_id = p.id AND staff_id = ANY (v_ids);
  UPDATE bank_statement_lines SET matched_payroll_id = p.id, matched_expense_amount = v_net, variance_amount = v_diff,
    match_status = 'manual' WHERE id = p_line_id;
  PERFORM post_payroll_bank_line(p_line_id);
  IF NULLIF(btrim(p_note), '') IS NOT NULL THEN
    UPDATE journal_entries SET description = description || ' — ' || btrim(p_note)
     WHERE source_table = 'payroll_bank_line' AND source_id = p_line_id;
  END IF;

  -- Everyone covered and the run approved: it is paid.
  IF p.approval_status::text = 'finance_approved' AND p.payment_status IS DISTINCT FROM 'paid'
     AND NOT EXISTS (SELECT 1 FROM payroll_staff WHERE payroll_id = p.id AND bank_line_id IS NULL) THEN
    UPDATE payroll SET payment_status = 'paid', payment_method = COALESCE(payment_method, 'Bank Transfer') WHERE id = p.id;
  END IF;
  IF COALESCE(current_setting('kuncho.bank_auto', true), '') <> 'on' THEN
    PERFORM sync_bank_line_charges(NULL, p_line_id);
  END IF;
END $f$;

-- Undoing a salary line frees the people it paid and takes its posting back.
CREATE OR REPLACE FUNCTION public.release_payroll_bank_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.matched_payroll_id IS NOT NULL AND NEW.matched_payroll_id IS DISTINCT FROM OLD.matched_payroll_id) THEN
    UPDATE payroll_staff SET bank_line_id = NULL WHERE bank_line_id = OLD.id;
    DELETE FROM journal_entries WHERE source_table = 'payroll_bank_line' AND source_id = OLD.id;
  END IF;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS trg_release_payroll_bank_line ON bank_statement_lines;
CREATE TRIGGER trg_release_payroll_bank_line AFTER UPDATE OF matched_payroll_id OR DELETE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION release_payroll_bank_line();

-- A run paid through its bank lines is posted line by line, not as a whole.
CREATE OR REPLACE FUNCTION public.post_payroll_payment_to_ledger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy   UUID;
  v_row_fy       UUID;
  v_posting_date DATE;
  v_gross NUMERIC;
  v_net   NUMERIC;
  v_tax_sum   NUMERIC;
  v_liability NUMERIC;
  v_salary_account_id  UUID;
  v_cash_account_id    UUID;
  v_payable_account_id UUID;
  v_entry_id UUID;
BEGIN
  IF NEW.payment_status IS DISTINCT FROM 'paid' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM payroll_staff WHERE payroll_id = NEW.id AND bank_line_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  v_posting_date := COALESCE(NEW.end_date, NEW.start_date);
  IF v_posting_date IS NULL THEN
    PERFORM log_posting_failure('payroll', NEW.id, 'Cannot post: no start_date/end_date to key the fiscal period on');
    RETURN NEW;
  END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(v_posting_date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'payroll' AND source_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT COALESCE(SUM(gross_amount), 0), COALESCE(SUM(net_amount), 0)
    INTO v_gross, v_net FROM payroll_staff WHERE payroll_id = NEW.id;

    SELECT COALESCE(SUM(tax_amount), 0) INTO v_tax_sum FROM payroll_taxes WHERE payroll_id = NEW.id;

    v_liability := v_gross - v_net;

    IF v_gross = 0 THEN
      PERFORM log_posting_failure('payroll', NEW.id, 'Cannot post: no payroll_staff rows with a gross_amount for this payroll_id');
      RETURN NEW;
    END IF;

    SELECT id INTO v_salary_account_id  FROM chart_of_accounts WHERE account_code = '6101';
    SELECT id INTO v_payable_account_id FROM chart_of_accounts WHERE account_code = '2020';
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;

    IF v_cash_account_id IS NULL THEN
      PERFORM log_posting_failure('payroll', NEW.id, format(
        'Cannot post: account_id=%s has no Cash at Bank chart_of_accounts row', NEW.account_id));
      RETURN NEW;
    END IF;

    INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
    VALUES (v_posting_date, 'operational', 'payroll', NEW.id, 'Payroll paid: ' || COALESCE(NEW.payroll_record, NEW.id::text))
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry_id, v_salary_account_id, v_gross, 0, 'Gross payroll' || CASE WHEN NEW.pay_period IS NOT NULL THEN ', ' || NEW.pay_period ELSE '' END);

    IF v_net > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_cash_account_id, 0, v_net, 'Net paid via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));
    END IF;

    IF v_liability > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_payable_account_id, 0, v_liability, format('Withheld from gross (payroll_taxes on record for this run: %s)', v_tax_sum));
    END IF;

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('payroll', NEW.id, SQLERRM);
  END;

  RETURN NEW;
END;
$function$;

-- What a salary line settles: the pay of the people it paid, named.
CREATE OR REPLACE FUNCTION public.payroll_line_amount(p_line_id uuid, p_payroll_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $f$
  SELECT COALESCE((SELECT sum(net_amount) FROM payroll_staff WHERE payroll_id = p_payroll_id AND bank_line_id = p_line_id),
                  (SELECT COALESCE(sum(net_amount), 0) FROM payroll_staff WHERE payroll_id = p_payroll_id))
$f$;
CREATE OR REPLACE FUNCTION public.payroll_line_label(p_line_id uuid, p_payroll_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $f$
  SELECT COALESCE(p.payroll_record, 'Payroll') || COALESCE(' · ' || (
    SELECT CASE WHEN count(*) <= 3 THEN string_agg(st.employee_name, ', ' ORDER BY ps.net_amount DESC, st.employee_name)
                ELSE count(*) || ' people' END
      FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
     WHERE ps.payroll_id = p.id AND ps.bank_line_id = p_line_id HAVING count(*) > 0), '')
  FROM payroll p WHERE p.id = p_payroll_id
$f$;

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_viewdef('public.v_bank_line_status'::regclass, true);
  n := regexp_replace(d,
    $re$jsonb_build_object\('id', p\.id, 'label', COALESCE\(p\.payroll_record, 'Payroll'::text\), 'amount', \( SELECT COALESCE\(sum\(ps\.net_amount\), 0::numeric\) AS "coalesce"\s+FROM payroll_staff ps\s+WHERE ps\.payroll_id = p\.id\)\)$re$,
    $new$jsonb_build_object('id', p.id, 'label', payroll_line_label(b_1.id, p.id), 'amount', payroll_line_amount(b_1.id, p.id))$new$);
  IF n = d THEN RAISE EXCEPTION 'v_bank_line_status: payroll link not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_bank_line_status WITH (security_invoker = true) AS ' || n;

  d := pg_get_viewdef('public.v_bank_line_ledger'::regclass, true);
  n := replace(d, $o$WHERE je.source_table = 'payroll'::text AND je.source_id = ((s.payroll ->> 'id'::text)::uuid)$o$,
                  $o$WHERE je.source_table = 'payroll'::text AND je.source_id = ((s.payroll ->> 'id'::text)::uuid) OR je.source_table = 'payroll_bank_line'::text AND je.source_id = s.line_id$o$);
  IF n = d THEN RAISE EXCEPTION 'v_bank_line_ledger: payroll check not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_bank_line_ledger WITH (security_invoker = true) AS ' || n;

  d := pg_get_viewdef('public.v_cash_ledger_lines'::regclass, true);
  n := replace(d, $o$ARRAY['bank_statement_lines'::text, 'bank_line_charge'::text]$o$,
                  $o$ARRAY['bank_statement_lines'::text, 'bank_line_charge'::text, 'payroll_bank_line'::text]$o$);
  IF n = d THEN RAISE EXCEPTION 'v_cash_ledger_lines: on-bank sources not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_cash_ledger_lines WITH (security_invoker = true) AS ' || n;
END $do$;

-- ── Matching ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_bank_line_match(p_line_id uuid, p_kind text, p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_amt numeric; f record; ex record; q expense_payments%ROWTYPE; e expenses%ROWTYPE;
        v_payer uuid; v_fee record; v_staff uuid[];
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
    -- Who on the run this line paid (499); the screen can pick them by hand.
    SELECT array_agg(x.staff_id) INTO v_staff FROM payroll_line_plan(p_line_id, p_target_id) x;
    IF v_staff IS NULL THEN
      RAISE EXCEPTION 'Nobody still unpaid on % adds up to this line — pick who it paid',
        COALESCE((SELECT payroll_record FROM payroll WHERE id = p_target_id), 'this payroll run');
    END IF;
    PERFORM match_bank_line_to_payroll(p_line_id, p_target_id, v_staff, NULL);
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
    SELECT pr.* FROM payment_requests pr WHERE pr.request_code = ANY (v_codes)
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
    SELECT 'payroll', p.id,
      COALESCE(p.payroll_record, 'Payroll run') || ' · ' || pl.n || CASE WHEN pl.n = 1 THEN ' person' ELSE ' people' END,
      pl.how || ': ' || pl.names || CASE WHEN p.approval_status::text <> 'finance_approved' THEN ' · run not approved yet' ELSE '' END,
      pl.total, p.end_date,
      false, (pl.code IS NOT NULL OR EXISTS (SELECT 1 FROM prq WHERE prq.payroll_id = p.id)),
      bank_amount_fit(l.amount, pl.total, 'debit'),
      CASE WHEN upper(v_text) ~ '(SALARY|\mSAL\M|PAYROLL|WAGE)' THEN 25 ELSE 0 END
    FROM payroll p
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS n, sum(x.net) AS total, max(x.how) AS how, max(x.request_code) AS code,
             CASE WHEN count(*) <= 3 THEN string_agg(x.employee_name, ', ' ORDER BY x.net DESC, x.employee_name)
                  ELSE (array_agg(x.employee_name ORDER BY x.net DESC, x.employee_name))[1] || ' and ' || (count(*) - 1) || ' more' END AS names
      FROM payroll_line_plan(l.line_id, p.id) x HAVING count(*) > 0) pl
    WHERE l.direction = 'debit' AND p.transfer_id IS NULL AND NOT COALESCE(p.is_archived, false)
      AND (p.end_date BETWEEN l.value_date - 60 AND l.value_date + 30 OR EXISTS (SELECT 1 FROM prq WHERE prq.payroll_id = p.id))
    UNION ALL
    -- A run the narration names, when nobody unpaid on it adds up to the line: pick them by hand.
    SELECT 'payroll', p.id, COALESCE(p.payroll_record, 'Payroll run'), 'pick who this line paid',
      (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id AND ps.bank_line_id IS NULL), p.end_date,
      false, true, 0, 0
    FROM payroll p
    WHERE l.direction = 'debit' AND p.transfer_id IS NULL AND NOT COALESCE(p.is_archived, false)
      AND EXISTS (SELECT 1 FROM prq WHERE prq.payroll_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM payroll_line_plan(l.line_id, p.id))
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
    IF s_score >= 95 AND s_kind IN ('expense', 'expense_part', 'batch', 'vrf', 'sale', 'payroll') AND (s2_score IS NULL OR s2_score < 95) THEN
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

GRANT EXECUTE ON FUNCTION public.payroll_line_plan(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_bank_line_to_payroll(uuid, uuid, uuid[], text) TO authenticated;
