-- 506: Who each bank line paid or came from.
--
-- Some statement exports name the other party of every line: CBE's gives the
-- beneficiary's name and account for money out, and the sender's for money
-- in. A narration like "260709ALU" says little; "ALUMINUM WORLD TRADING PLC,
-- account 1000036168777" says who was paid. Most of those accounts are the
-- bank accounts already on record for vendors and staff.
--
--   * bank_statement_lines keeps the other party's name and account.
--   * bank_lines_add_names() writes them onto lines from a statement file,
--     new or already imported (matched the same way the import matches a
--     line it has seen: date, amount and running balance).
--   * bank_line_party() names the vendor, staff member or client a line's
--     other party is, by bank account first, then by name.
--   * suggest_bank_line_matches() runs as before, then weighs who the bank
--     paid: a record for that payee with a fitting amount is near certain
--     (so automatic matching settles it when it is the only one); a record
--     for someone else, whose account on record isn't this one, is pushed
--     down.

-- ── 506a (applied on its own) ───────────────────────────────────────────────
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS counterparty_name text,
  ADD COLUMN IF NOT EXISTS counterparty_account text;
COMMENT ON COLUMN public.bank_statement_lines.counterparty_name IS 'Who the line paid (money out) or came from (money in), when the statement says (506).';
COMMENT ON COLUMN public.bank_statement_lines.counterparty_account IS 'That party''s bank account number, when the statement says (506).';

-- ── 506b ────────────────────────────────────────────────────────────────────
-- A name as banks and records both write it: lower case, no title, no
-- punctuation, no PLC / S.C. at the end.
CREATE OR REPLACE FUNCTION public.bank_party_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(COALESCE(p, '')), '^\s*(mr|mrs|ms|miss|dr|ato|w/ro|wro)\.?\s+', ''),
             '[^a-z0-9]+', ' ', 'g'),
           '\s(plc|s c|sc)\s*$', '')), '');
$f$;

CREATE OR REPLACE FUNCTION public.bank_party_digits(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT NULLIF(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), '');
$f$;

-- Whether a line's other party is this vendor, staff member or client:
-- 'account' when the bank account matches (8 digits or more), 'name' when the
-- names agree (one may be cut short, as banks cut long names), else null.
CREATE OR REPLACE FUNCTION public.bank_party_is(p_cp_name text, p_cp_acct text, p_name text, p_acct text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN length(bank_party_digits(p_cp_acct)) >= 8 AND bank_party_digits(p_cp_acct) = bank_party_digits(p_acct) THEN 'account'
    WHEN bank_party_norm(p_cp_name) IS NOT NULL AND bank_party_norm(p_name) IS NOT NULL AND (
         bank_party_norm(p_cp_name) = bank_party_norm(p_name)
      OR (length(bank_party_norm(p_name)) >= 8 AND bank_party_norm(p_cp_name) LIKE '%' || bank_party_norm(p_name) || '%')
      OR (length(bank_party_norm(p_cp_name)) >= 8 AND bank_party_norm(p_name) LIKE bank_party_norm(p_cp_name) || '%')) THEN 'name'
  END;
$f$;

-- Names from a statement file onto its lines, new or already imported.
-- p_lines is the same list import_bank_statement takes, with
-- counterparty_name and counterparty_account on each line.
CREATE OR REPLACE FUNCTION public.bank_lines_add_names(p_account_id uuid, p_lines jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_n int;
BEGIN
  IF NOT COALESCE(get_user_role()::text IN ('admin', 'finance'), false) THEN
    RAISE EXCEPTION 'Only admin or finance can import a bank statement';
  END IF;
  WITH s AS (
    SELECT bank_line_fingerprint((x->>'value_date')::date, NULLIF((x->>'debit')::numeric, 0), NULLIF((x->>'credit')::numeric, 0),
             (x->>'balance')::numeric, NULLIF(btrim(split_part(COALESCE(x->>'reference', ''), E'\\', 1)), ''),
             NULLIF(btrim(x->>'narration'), '')) AS fp,
           NULLIF(btrim(x->>'counterparty_name'), '') AS cp_name,
           NULLIF(regexp_replace(COALESCE(x->>'counterparty_account', ''), '\s', '', 'g'), '') AS cp_acct
      FROM jsonb_array_elements(p_lines) x
  ), u AS (
    UPDATE bank_statement_lines l SET counterparty_name = s.cp_name, counterparty_account = s.cp_acct
      FROM s
     WHERE l.account_id = p_account_id AND l.fingerprint = s.fp
       AND (s.cp_name IS NOT NULL OR s.cp_acct IS NOT NULL)
       AND (l.counterparty_name IS DISTINCT FROM s.cp_name OR l.counterparty_account IS DISTINCT FROM s.cp_acct)
       AND NOT bank_period_closed(l.account_id, l.value_date)
    RETURNING l.id)
  SELECT count(*) INTO v_n FROM u;
  RETURN v_n;
END $f$;
GRANT EXECUTE ON FUNCTION public.bank_lines_add_names(uuid, jsonb) TO authenticated;

-- The vendor, staff member or client a line's other party is: by bank account
-- first, then by name. Money out looks at vendors and staff; money in at
-- clients first, then vendors (a refund).
CREATE OR REPLACE FUNCTION public.bank_line_party(p_line_id uuid)
RETURNS TABLE(kind text, id uuid, name text, how text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH l AS (
    SELECT b.counterparty_name AS n, b.counterparty_account AS a, COALESCE(b.debit_amount, 0) > 0 AS money_out
      FROM bank_statement_lines b
     WHERE b.id = p_line_id AND (b.counterparty_name IS NOT NULL OR b.counterparty_account IS NOT NULL)
       AND COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false)
  ), c AS (
    SELECT 'vendor'::text AS kind, v.id, btrim(v.vendor_name) AS name, bank_party_is(l.n, l.a, v.vendor_name, v.bank_account) AS how,
           CASE WHEN l.money_out THEN 1 ELSE 3 END AS pref
      FROM l, vendors v
    UNION ALL
    SELECT 'staff', s.id, btrim(s.employee_name), bank_party_is(l.n, l.a, s.employee_name, s.bank_account), 2
      FROM l, staff s WHERE l.money_out
    UNION ALL
    SELECT 'client', k.id, btrim(k.client_name), bank_party_is(l.n, NULL, k.client_name, NULL), 1
      FROM l, clients k WHERE NOT l.money_out
  )
  SELECT c.kind, c.id, c.name, c.how FROM c WHERE c.how IS NOT NULL
   ORDER BY c.how = 'account' DESC, c.pref, length(c.name) DESC
   LIMIT 1;
$f$;
GRANT EXECUTE ON FUNCTION public.bank_line_party(uuid) TO authenticated;

-- The line, with its other party (appended, so nothing reading the view changes).
CREATE OR REPLACE VIEW public.v_bank_line_status WITH (security_invoker = true) AS
 WITH base AS (
         SELECT l.id, l.import_id, l.line_no, l.value_date, l.post_date, l.transaction_type, l.narration,
            l.debit_amount, l.credit_amount, l.running_balance, l.reference, l.reference_code, l.matched_expense_id,
            l.transfer_id, l.match_status, l.created_at, l.matched_expense_amount, l.variance_amount,
            l.matched_payroll_id, l.matched_sale_id, l.credit_classification, l.account_id, l.fingerprint,
            l.classification, l.classification_note, l.classified_by, l.classified_at,
                CASE
                    WHEN (COALESCE(l.debit_amount, (0)::numeric) > (0)::numeric) THEN 'debit'::text
                    ELSE 'credit'::text
                END AS direction,
            COALESCE(NULLIF(l.debit_amount, (0)::numeric), l.credit_amount, (0)::numeric) AS amount,
            l.counterparty_name, l.counterparty_account
           FROM bank_statement_lines l
        ), links AS MATERIALIZED (
         SELECT b_1.id,
            ( SELECT jsonb_build_object('id', bp.id, 'label', COALESCE(bp.payment_code, 'Batch payment'::text), 'amount', ( SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), (0)::numeric) AS "coalesce"
                           FROM (batch_payment_expenses x
                             JOIN expenses e ON ((e.id = x.expense_id)))
                          WHERE (x.batch_payment_id = bp.id))) AS jsonb_build_object
                   FROM batch_payments bp
                  WHERE (bp.transfer_id = b_1.transfer_id)
                 LIMIT 1) AS batch,
            ( SELECT jsonb_agg(z.j) AS jsonb_agg
                   FROM ( SELECT jsonb_build_object('id', e.id, 'label', ((COALESCE(e.expense_code, ''::text) || ' '::text) || COALESCE(e.item_service_description, ''::text)), 'amount', COALESCE(e.net_payable, e.amount_etb)) AS j
                           FROM expenses e
                          WHERE ((e.transfer_id = b_1.transfer_id) AND (NOT (EXISTS ( SELECT 1
                                   FROM batch_payments bp
                                  WHERE (bp.transfer_id = b_1.transfer_id)))))
                        UNION ALL
                         SELECT jsonb_build_object('id', e.id, 'part_id', q.id, 'label', ((COALESCE(e.expense_code, ''::text) || format(' part %s of %s '::text, pos.part_no, pos.part_count)) || COALESCE(e.item_service_description, ''::text)), 'amount', q.cash_etb) AS jsonb_build_object
                           FROM ((expense_payments q
                             JOIN expenses e ON ((e.id = q.expense_id)))
                             CROSS JOIN LATERAL expense_part_position(q.id) pos(part_no, part_count))
                          WHERE (q.transfer_id = b_1.transfer_id)) z) AS expenses,
            ( SELECT jsonb_agg(jsonb_build_object('id', s.id, 'label', ((COALESCE(s.invoice_number, ''::text) || ' '::text) || COALESCE(s.sales_description, ''::text)), 'amount', s.amount)) AS jsonb_agg
                   FROM sales s
                  WHERE (s.transfer_id = b_1.transfer_id)) AS sales,
            ( SELECT jsonb_build_object('id', p.id, 'label', payroll_line_label(b_1.id, p.id), 'amount', payroll_line_amount(b_1.id, p.id)) AS jsonb_build_object
                   FROM payroll p
                  WHERE ((p.transfer_id = b_1.transfer_id) OR (p.id = b_1.matched_payroll_id))
                 LIMIT 1) AS payroll,
            ( SELECT jsonb_build_object('id', v.id, 'label', COALESCE(v.record_name, 'Vendor request'::text), 'amount', COALESCE(( SELECT sum(p.amount) AS sum
                           FROM vrf_payment_parts p
                          WHERE ((p.vrf_id = v.id) AND (p.transfer_id = b_1.transfer_id) AND (p.reversed_at IS NULL))), v.net_sent, v.amount_transferred)) AS jsonb_build_object
                   FROM (( SELECT COALESCE(( SELECT f.id
                                   FROM vendor_receipt_facilitation f
                                  WHERE (f.out_transfer_id = b_1.transfer_id)
                                 LIMIT 1), ( SELECT p.vrf_id
                                   FROM vrf_payment_parts p
                                  WHERE ((p.transfer_id = b_1.transfer_id) AND (p.reversed_at IS NULL))
                                 LIMIT 1)) AS vid
                          WHERE (b_1.transfer_id IS NOT NULL)
                         OFFSET 0) k
                     JOIN vendor_receipt_facilitation v ON ((v.id = k.vid)))) AS vrf,
            ( SELECT jsonb_build_object('account_id', a.id, 'account_name', a.account_name, 'source', ct.source, 'line_id', ( SELECT x.id
                           FROM bank_statement_lines x
                          WHERE (x.transfer_id = ct.id)
                         LIMIT 1)) AS jsonb_build_object
                   FROM ((transfers t
                     JOIN transfers ct ON ((ct.id = t.counterpart_id)))
                     JOIN accounts a ON ((a.id = COALESCE(ct.from_account_id, ct.to_account_id))))
                  WHERE (t.id = b_1.transfer_id)) AS internal,
            (EXISTS ( SELECT 1
                   FROM vrf_returns r
                  WHERE (r.transfer_id = b_1.transfer_id))) AS vrf_return,
            (EXISTS ( SELECT 1
                   FROM bank_balance_anchors a
                  WHERE (a.transfer_id = b_1.transfer_id))) AS opening_balance
           FROM base b_1
        )
 SELECT b.id AS line_id, b.import_id, b.account_id, b.line_no, b.value_date, b.transaction_type, b.narration, b.reference,
    b.reference_code, b.debit_amount, b.credit_amount, b.running_balance, b.transfer_id, b.direction, b.amount,
    b.classification, b.classification_note, lk.batch, lk.expenses, lk.sales, lk.payroll, lk.vrf,
        CASE
            WHEN (lk.batch IS NOT NULL) THEN 'batch'::text
            WHEN (lk.expenses IS NOT NULL) THEN 'expense'::text
            WHEN (lk.sales IS NOT NULL) THEN 'sale'::text
            WHEN (lk.payroll IS NOT NULL) THEN 'payroll'::text
            WHEN (lk.vrf IS NOT NULL) THEN 'vrf'::text
            WHEN lk.vrf_return THEN 'vrf_return'::text
            WHEN lk.opening_balance THEN 'opening_balance'::text
            WHEN (b.classification = 'internal_transfer'::text) THEN 'internal'::text
            WHEN (b.classification IS NOT NULL) THEN 'classified'::text
            ELSE NULL::text
        END AS reconciled_as,
        CASE
            WHEN (lk.batch IS NOT NULL) THEN ((lk.batch ->> 'amount'::text))::numeric
            WHEN (lk.expenses IS NOT NULL) THEN ( SELECT sum(((x.value ->> 'amount'::text))::numeric) AS sum
               FROM jsonb_array_elements(lk.expenses) x(value))
            WHEN (lk.sales IS NOT NULL) THEN ( SELECT sum(((x.value ->> 'amount'::text))::numeric) AS sum
               FROM jsonb_array_elements(lk.sales) x(value))
            WHEN (lk.payroll IS NOT NULL) THEN ((lk.payroll ->> 'amount'::text))::numeric
            WHEN (lk.vrf IS NOT NULL) THEN ((lk.vrf ->> 'amount'::text))::numeric
            ELSE NULL::numeric
        END AS linked_amount,
    lk.internal,
    b.counterparty_name,
    b.counterparty_account
   FROM (base b
     JOIN links lk ON ((lk.id = b.id)));

-- The suggestions as before (kept whole, renamed), then weighed by who the
-- bank paid.
ALTER FUNCTION public.suggest_bank_line_matches(uuid) RENAME TO suggest_bank_line_matches_core;

CREATE OR REPLACE FUNCTION public.suggest_bank_line_matches(p_line_id uuid)
RETURNS TABLE(kind text, target_id uuid, label text, detail text, amount numeric, target_date date, score integer, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l record; v_known boolean;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT b.counterparty_name AS cp_name, b.counterparty_account AS cp_acct, b.value_date,
         CASE WHEN COALESCE(b.debit_amount, 0) > 0 THEN 'debit' ELSE 'credit' END AS direction,
         COALESCE(NULLIF(b.debit_amount, 0), b.credit_amount, 0) AS amount
    INTO l FROM bank_statement_lines b WHERE b.id = p_line_id;
  -- No other party on the line: the suggestions as they were.
  IF l.cp_name IS NULL AND l.cp_acct IS NULL THEN
    RETURN QUERY SELECT * FROM suggest_bank_line_matches_core(p_line_id);
    RETURN;
  END IF;
  -- The bank paid an account we know: a record for someone else is unlikely.
  v_known := NOT bank_party_clearing(l.cp_name) AND length(bank_party_digits(l.cp_acct)) >= 8 AND (
       EXISTS (SELECT 1 FROM vendors v WHERE bank_party_digits(v.bank_account) = bank_party_digits(l.cp_acct))
    OR EXISTS (SELECT 1 FROM staff s WHERE bank_party_digits(s.bank_account) = bank_party_digits(l.cp_acct)));
  RETURN QUERY
  WITH s AS (
    SELECT * FROM suggest_bank_line_matches_core(p_line_id)
  ), w AS (
    SELECT s.*,
      CASE s.kind
        WHEN 'expense' THEN (SELECT least(bank_party_is(l.cp_name, l.cp_acct, v.vendor_name, v.bank_account),
                                          bank_party_is(l.cp_name, l.cp_acct, st.employee_name, st.bank_account),
                                          bank_party_is(l.cp_name, NULL, e.vendors_name, NULL))
                               FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN staff st ON st.id = e.paid_to_staff_id
                              WHERE e.id = s.target_id)
        WHEN 'expense_part' THEN (SELECT least(bank_party_is(l.cp_name, l.cp_acct, v.vendor_name, v.bank_account),
                                               bank_party_is(l.cp_name, l.cp_acct, st.employee_name, st.bank_account),
                                               bank_party_is(l.cp_name, NULL, e.vendors_name, NULL))
                                    FROM expense_payments q JOIN expenses e ON e.id = q.expense_id
                                    LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN staff st ON st.id = e.paid_to_staff_id
                                   WHERE q.id = s.target_id)
        WHEN 'batch' THEN (SELECT min(bank_party_is(l.cp_name, l.cp_acct, v.vendor_name, v.bank_account))
                             FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id JOIN vendors v ON v.id = e.vendor_id
                            WHERE x.batch_payment_id = s.target_id)
        WHEN 'vrf' THEN (SELECT least(bank_party_is(l.cp_name, l.cp_acct, v.vendor_name, v.bank_account),
                                      bank_party_is(l.cp_name, NULL, f.facilitator_name, NULL))
                           FROM vendor_receipt_facilitation f LEFT JOIN vendors v ON v.id = f.vendor_id
                          WHERE f.id = s.target_id)
        WHEN 'payroll' THEN COALESCE(
          (SELECT min(bank_party_is(l.cp_name, l.cp_acct, st.employee_name, st.bank_account))
             FROM payroll_line_plan(p_line_id, s.target_id) x JOIN staff st ON st.id = x.staff_id),
          (SELECT min(bank_party_is(l.cp_name, l.cp_acct, st.employee_name, st.bank_account))
             FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
            WHERE ps.payroll_id = s.target_id AND ps.bank_line_id IS NULL AND s.detail = 'pick who this line paid'))
        WHEN 'sale' THEN (SELECT bank_party_is(l.cp_name, NULL, c.client_name, NULL)
                            FROM sales x JOIN clients c ON c.id = x.client_id WHERE x.id = s.target_id)
        WHEN 'purchase_order' THEN (SELECT bank_party_is(l.cp_name, NULL, sb.vendor_name, NULL)
                                      FROM sourcing_bundles sb WHERE sb.id = s.target_id)
      END AS who,
      -- A record for a payee whose account on record isn't the one paid.
      (v_known AND s.kind IN ('expense', 'expense_part') AND EXISTS (
         SELECT 1 FROM expenses e
           LEFT JOIN expense_payments q ON q.id = s.target_id AND s.kind = 'expense_part'
           LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN staff st ON st.id = e.paid_to_staff_id
          WHERE e.id = CASE WHEN s.kind = 'expense' THEN s.target_id ELSE q.expense_id END
            AND (length(bank_party_digits(v.bank_account)) >= 8 OR length(bank_party_digits(st.bank_account)) >= 8))) AS elsewhere,
      bank_amount_fit(l.amount, s.amount, l.direction) AS fit
    FROM s
  )
  SELECT w.kind, w.target_id, w.label, w.detail, w.amount, w.target_date,
    (CASE
       WHEN w.who IS NOT NULL AND w.score >= 95 THEN w.score
       WHEN w.who = 'account' AND w.fit >= 55 THEN greatest(w.score, 97)
       WHEN w.who = 'name' AND w.fit >= 55 THEN greatest(w.score, 95)
       WHEN w.who IS NOT NULL THEN least(w.score + 20, 90)
       WHEN w.elsewhere AND w.score < 95 THEN least(w.score, 45)
       ELSE w.score END)::int,
    CASE
       WHEN w.who IS NOT NULL AND w.score >= 95 THEN w.reason
       WHEN w.who IS NOT NULL THEN
         CASE l.direction WHEN 'debit' THEN 'Paid to ' ELSE 'Paid by ' END || COALESCE(l.cp_name, 'their account')
         || CASE WHEN w.who = 'account' THEN ' (their account on record)' ELSE '' END
         || CASE WHEN w.fit >= 60 THEN ', same amount'
                 WHEN w.fit >= 55 THEN ', amount plus a ' || round(l.amount - w.amount, 2) || ' fee'
                 ELSE ', but the amount differs' END
         || CASE WHEN w.kind = 'payroll' THEN ' · ' || w.detail ELSE '' END
       WHEN w.elsewhere AND w.score < 95 THEN w.reason || ', but the bank paid ' || COALESCE(l.cp_name, 'another account')
       ELSE w.reason END
  FROM w
  ORDER BY 7 DESC, abs(w.target_date - l.value_date);
END $f$;
GRANT EXECUTE ON FUNCTION public.suggest_bank_line_matches(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.suggest_bank_line_matches_core(uuid) FROM PUBLIC, anon, authenticated;

-- ── 506c ────────────────────────────────────────────────────────────────────
-- (suggest_bank_line_matches above carries the same guard: it was re-created
-- with 506c.)
-- A clearing party says nothing about who was paid: transfers to other banks
-- go through the National Bank's account, wallets through their depository,
-- cheques through CPO payable. (A vendor record that holds the National
-- Bank's account, as ERCA's does, would otherwise claim every one of them.)
CREATE OR REPLACE FUNCTION public.bank_party_clearing(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT COALESCE(p_name, '') ~* '(national bank of ethiopia|\mnbe\M|e[ -]?money|depository|telebirr|inter ?bank|\mcpo|rtgs|settlement|\mswitch\M|payable account|payable$)';
$f$;

CREATE OR REPLACE FUNCTION public.bank_party_is(p_cp_name text, p_cp_acct text, p_name text, p_acct text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN bank_party_clearing(p_cp_name) THEN NULL
    WHEN length(bank_party_digits(p_cp_acct)) >= 8 AND bank_party_digits(p_cp_acct) = bank_party_digits(p_acct) THEN 'account'
    WHEN bank_party_norm(p_cp_name) IS NOT NULL AND bank_party_norm(p_name) IS NOT NULL AND (
         bank_party_norm(p_cp_name) = bank_party_norm(p_name)
      OR (length(bank_party_norm(p_name)) >= 8 AND bank_party_norm(p_cp_name) LIKE '%' || bank_party_norm(p_name) || '%')
      OR (length(bank_party_norm(p_cp_name)) >= 8 AND bank_party_norm(p_name) LIKE bank_party_norm(p_cp_name) || '%')) THEN 'name'
  END;
$f$;
