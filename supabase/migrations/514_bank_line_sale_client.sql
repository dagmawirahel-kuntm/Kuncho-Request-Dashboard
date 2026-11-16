-- 514: A bank line settled by a sale names the sale's client and project.
--
-- The Reconciled list on bank review showed a sale as its invoice number and
-- description only, and its search looked at the bank's own text (narration,
-- reference, amount). Client payments mostly arrive as "A2A TRANSFER" or a
-- string of digits, so a paid EFF booth sale could not be found by searching
-- "Dashen" or "EFF". Each sale on a line now carries its client and project,
-- for the screen to show and search. Only the sales part of the view changes.

SET search_path TO public;

CREATE OR REPLACE VIEW public.v_bank_line_status WITH (security_invoker = true) AS
 WITH base AS (
         SELECT l.id,
            l.import_id,
            l.line_no,
            l.value_date,
            l.post_date,
            l.transaction_type,
            l.narration,
            l.debit_amount,
            l.credit_amount,
            l.running_balance,
            l.reference,
            l.reference_code,
            l.matched_expense_id,
            l.transfer_id,
            l.match_status,
            l.created_at,
            l.matched_expense_amount,
            l.variance_amount,
            l.matched_payroll_id,
            l.matched_sale_id,
            l.credit_classification,
            l.account_id,
            l.fingerprint,
            l.classification,
            l.classification_note,
            l.classified_by,
            l.classified_at,
                CASE
                    WHEN (COALESCE(l.debit_amount, (0)::numeric) > (0)::numeric) THEN 'debit'::text
                    ELSE 'credit'::text
                END AS direction,
            COALESCE(NULLIF(l.debit_amount, (0)::numeric), l.credit_amount, (0)::numeric) AS amount,
            l.counterparty_name,
            l.counterparty_account
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
            ( SELECT jsonb_agg(jsonb_build_object('id', s.id, 'label', ((COALESCE(s.invoice_number, ''::text) || ' '::text) || COALESCE(s.sales_description, ''::text)), 'amount', s.amount,
                       'client', ( SELECT cl.client_name FROM clients cl WHERE (cl.id = s.client_id)),
                       'project', ( SELECT pj.project_name FROM projects pj WHERE (pj.id = s.project_id)))) AS jsonb_agg
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
 SELECT b.id AS line_id,
    b.import_id,
    b.account_id,
    b.line_no,
    b.value_date,
    b.transaction_type,
    b.narration,
    b.reference,
    b.reference_code,
    b.debit_amount,
    b.credit_amount,
    b.running_balance,
    b.transfer_id,
    b.direction,
    b.amount,
    b.classification,
    b.classification_note,
    lk.batch,
    lk.expenses,
    lk.sales,
    lk.payroll,
    lk.vrf,
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
