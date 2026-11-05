-- 499b: what a salary line settles is the pay of the people it paid (499),
-- and its posting counts as in the books and on the bank.

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
