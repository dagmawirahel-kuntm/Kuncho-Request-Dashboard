-- 459 — The bank reconciliation screens stop timing out
--
-- From 19 Oct the Bank reconciliation page, its Audit tab, the month-end
-- checklist and the ops-health feed failed with "canceling statement due to
-- statement timeout" (logged-in users are cut off at 8 seconds). The newest
-- statement had taken the lines from 238 to 497, and everything that matches a
-- line to its payment — v_bank_line_status — had grown past the limit:
--
--   v_bank_line_status   2.6 s as finance, 4.2 s as admin
--   v_bank_audit_flags   4.7 s    v_bank_audit_accounts  6.3 s
--   bank_audit_scorecard 7.9 s    (each rebuilds the line status, some twice)
--
-- Two things made it slow, neither visible in the results:
--
--   1. The lookup "which vendor receipt is this line?" joined on
--      out_transfer_id = X OR EXISTS (a part with transfer X). That can't use
--      an index — an OR can't, and on a table with access rules neither can a
--      comparison that holds a subquery — so every line scanned every vendor
--      receipt and ran the access rules on each row (1.7 s of admin's 2 s).
--   2. The per-line lookups sit in a CTE that is read from several places —
--      the label, the amount, the status — and Postgres pastes a CTE that is
--      read once into each place it's used, so each lookup ran three or four
--      times a line. MATERIALIZED makes it run once.
--
-- And the joins from a line to its payment had no index on the transfer
-- column of the tables they look in.
--
-- Same columns, same results (all 497 lines compared); only how they are found
-- changes. After, as admin: line status 0.27 s, flags 1.3 s, accounts 2.1 s,
-- scorecard 0.9 s, month-end checklist 3.7 s, ops health 3.3 s.
--
-- Applied live in two parts: 459_bank_views_faster_1_line_status and
-- 459_bank_views_faster_2_vrf_lookup.

SET search_path TO public;

-- ── 1. Indexes on what a bank line is matched to ───────────────────────────
CREATE INDEX IF NOT EXISTS expenses_transfer_id_idx ON expenses (transfer_id);
CREATE INDEX IF NOT EXISTS sales_transfer_id_idx ON sales (transfer_id);
CREATE INDEX IF NOT EXISTS payroll_transfer_id_idx ON payroll (transfer_id);
CREATE INDEX IF NOT EXISTS batch_payments_transfer_id_idx ON batch_payments (transfer_id);
CREATE INDEX IF NOT EXISTS transfers_counterpart_id_idx ON transfers (counterpart_id);
CREATE INDEX IF NOT EXISTS bank_balance_anchors_transfer_id_idx ON bank_balance_anchors (transfer_id);
CREATE INDEX IF NOT EXISTS batch_payment_expenses_expense_id_idx ON batch_payment_expenses (expense_id);
CREATE INDEX IF NOT EXISTS bank_statement_lines_matched_payroll_idx ON bank_statement_lines (matched_payroll_id);

-- ── 2. The line status: look things up once, and the vendor receipt by index ─
CREATE OR REPLACE VIEW v_bank_line_status WITH (security_invoker = true) AS
WITH base AS (
  SELECT l.id, l.import_id, l.line_no, l.value_date, l.post_date, l.transaction_type, l.narration,
    l.debit_amount, l.credit_amount, l.running_balance, l.reference, l.reference_code, l.matched_expense_id,
    l.transfer_id, l.match_status, l.created_at, l.matched_expense_amount, l.variance_amount, l.matched_payroll_id,
    l.matched_sale_id, l.credit_classification, l.account_id, l.fingerprint, l.classification, l.classification_note,
    l.classified_by, l.classified_at,
    CASE WHEN COALESCE(l.debit_amount, 0::numeric) > 0::numeric THEN 'debit'::text ELSE 'credit'::text END AS direction,
    COALESCE(NULLIF(l.debit_amount, 0::numeric), l.credit_amount, 0::numeric) AS amount
  FROM bank_statement_lines l
), links AS MATERIALIZED (
  SELECT b_1.id,
    ( SELECT jsonb_build_object('id', bp.id, 'label', COALESCE(bp.payment_code, 'Batch payment'::text), 'amount',
             ( SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), 0::numeric)
                 FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id
                WHERE x.batch_payment_id = bp.id))
        FROM batch_payments bp WHERE bp.transfer_id = b_1.transfer_id LIMIT 1) AS batch,
    ( SELECT jsonb_agg(z.j)
        FROM ( SELECT jsonb_build_object('id', e.id, 'label', (COALESCE(e.expense_code, ''::text) || ' '::text) || COALESCE(e.item_service_description, ''::text), 'amount', COALESCE(e.net_payable, e.amount_etb)) AS j
                 FROM expenses e
                WHERE e.transfer_id = b_1.transfer_id
                  AND NOT EXISTS (SELECT 1 FROM batch_payments bp WHERE bp.transfer_id = b_1.transfer_id)
               UNION ALL
               SELECT jsonb_build_object('id', e.id, 'part_id', q.id,
                        'label', (COALESCE(e.expense_code, ''::text) || format(' part %s of %s '::text, pos.part_no, pos.part_count)) || COALESCE(e.item_service_description, ''::text),
                        'amount', q.cash_etb)
                 FROM expense_payments q
                 JOIN expenses e ON e.id = q.expense_id
                 CROSS JOIN LATERAL expense_part_position(q.id) pos(part_no, part_count)
                WHERE q.transfer_id = b_1.transfer_id) z) AS expenses,
    ( SELECT jsonb_agg(jsonb_build_object('id', s.id, 'label', (COALESCE(s.invoice_number, ''::text) || ' '::text) || COALESCE(s.sales_description, ''::text), 'amount', s.amount))
        FROM sales s WHERE s.transfer_id = b_1.transfer_id) AS sales,
    ( SELECT jsonb_build_object('id', p.id, 'label', COALESCE(p.payroll_record, 'Payroll'::text), 'amount',
             ( SELECT COALESCE(sum(ps.net_amount), 0::numeric) FROM payroll_staff ps WHERE ps.payroll_id = p.id))
        FROM payroll p WHERE p.transfer_id = b_1.transfer_id OR p.id = b_1.matched_payroll_id LIMIT 1) AS payroll,
    -- The receipt this line paid: the one sent with its transfer, else the one with a
    -- part on it. Two index lookups rather than one OR, and nothing at all for a
    -- line with no transfer. The id is worked out first (OFFSET 0 keeps it apart):
    -- a comparison holding a subquery can't go ahead of the access rules, so it
    -- would scan every receipt; against a plain id it's a primary-key lookup.
    ( SELECT jsonb_build_object('id', v.id, 'label', COALESCE(v.record_name, 'Vendor request'::text), 'amount',
             COALESCE(( SELECT sum(p.amount) FROM vrf_payment_parts p
                         WHERE p.vrf_id = v.id AND p.transfer_id = b_1.transfer_id AND p.reversed_at IS NULL),
                      v.net_sent, v.amount_transferred))
        FROM ( SELECT COALESCE(
                 ( SELECT f.id FROM vendor_receipt_facilitation f WHERE f.out_transfer_id = b_1.transfer_id LIMIT 1),
                 ( SELECT p.vrf_id FROM vrf_payment_parts p WHERE p.transfer_id = b_1.transfer_id AND p.reversed_at IS NULL LIMIT 1)) AS vid
               WHERE b_1.transfer_id IS NOT NULL
               OFFSET 0) k
        JOIN vendor_receipt_facilitation v ON v.id = k.vid) AS vrf,
    ( SELECT jsonb_build_object('account_id', a.id, 'account_name', a.account_name, 'source', ct.source, 'line_id',
             ( SELECT x.id FROM bank_statement_lines x WHERE x.transfer_id = ct.id LIMIT 1))
        FROM transfers t
        JOIN transfers ct ON ct.id = t.counterpart_id
        JOIN accounts a ON a.id = COALESCE(ct.from_account_id, ct.to_account_id)
       WHERE t.id = b_1.transfer_id) AS internal,
    (EXISTS (SELECT 1 FROM vrf_returns r WHERE r.transfer_id = b_1.transfer_id)) AS vrf_return,
    (EXISTS (SELECT 1 FROM bank_balance_anchors a WHERE a.transfer_id = b_1.transfer_id)) AS opening_balance
  FROM base b_1
)
SELECT b.id AS line_id, b.import_id, b.account_id, b.line_no, b.value_date, b.transaction_type, b.narration,
  b.reference, b.reference_code, b.debit_amount, b.credit_amount, b.running_balance, b.transfer_id,
  b.direction, b.amount, b.classification, b.classification_note,
  lk.batch, lk.expenses, lk.sales, lk.payroll, lk.vrf,
  CASE
    WHEN lk.batch IS NOT NULL THEN 'batch'::text
    WHEN lk.expenses IS NOT NULL THEN 'expense'::text
    WHEN lk.sales IS NOT NULL THEN 'sale'::text
    WHEN lk.payroll IS NOT NULL THEN 'payroll'::text
    WHEN lk.vrf IS NOT NULL THEN 'vrf'::text
    WHEN lk.vrf_return THEN 'vrf_return'::text
    WHEN lk.opening_balance THEN 'opening_balance'::text
    WHEN b.classification = 'internal_transfer'::text THEN 'internal'::text
    WHEN b.classification IS NOT NULL THEN 'classified'::text
    ELSE NULL::text
  END AS reconciled_as,
  CASE
    WHEN lk.batch IS NOT NULL THEN (lk.batch ->> 'amount'::text)::numeric
    WHEN lk.expenses IS NOT NULL THEN ( SELECT sum((x.value ->> 'amount'::text)::numeric) FROM jsonb_array_elements(lk.expenses) x(value))
    WHEN lk.sales IS NOT NULL THEN ( SELECT sum((x.value ->> 'amount'::text)::numeric) FROM jsonb_array_elements(lk.sales) x(value))
    WHEN lk.payroll IS NOT NULL THEN (lk.payroll ->> 'amount'::text)::numeric
    WHEN lk.vrf IS NOT NULL THEN (lk.vrf ->> 'amount'::text)::numeric
    ELSE NULL::numeric
  END AS linked_amount,
  lk.internal
FROM base b
JOIN links lk ON lk.id = b.id;

ANALYZE bank_statement_lines, expenses, sales, payroll, batch_payments, transfers,
  bank_balance_anchors, batch_payment_expenses, vendor_receipt_facilitation, vrf_payment_parts;
