-- 440 — The bank as the audit, not the gate
--
-- Until now a bank payment could only be called paid once it was matched to
-- a line on an imported statement, so "paid" waited on the statement. From
-- 442 the payment workflow owns "paid": finance enters the bank reference
-- (the FT number) when the money goes. This migration is the check that
-- comes after, from the statement:
--
--   bank_audit_settings     the thresholds, as data: when a flag turns amber
--                           or red, what is big enough for the admin, how
--                           often a statement is due, how far a statement must
--                           run past a payment before its absence counts
--   bank_charge_rules       the bank's own charges that ride on a transfer
--                           line (CBE: 6 local, 290 outward). A line that is
--                           its payments plus one of these ties, and the
--                           charge is booked to Bank Charges
--   v_payment_bank_check    every bank payment and whether the bank agrees:
--                           confirmed / not yet checked / problem
--   v_bank_audit_flags      what needs a look —
--                             paid by the bank, not in the system
--                             money in, no sale
--                             paid in the system, not in the bank
--                             amount doesn't tie
--                             same reference twice
--                           each with its age (under a week is normal, over
--                           two weeks amber, over a month red) and whether it
--                           is big enough to go to the admin
--   v_bank_audit_accounts   per account: statement through, bank-checked
--                           through, closed through, statement due, flags
--   bank_audit_scorecard()  share of money out the bank confirms, value
--                           still unchecked, problems — per account and payer
--
-- 441 makes matching confirm rather than pay, and puts the flags in front of
-- people (period close, month-end, ops health); 442 moves "paid" to the bank
-- reference.
--
-- Applied in three parts (440_bank_audit_1_settings_and_charges,
-- 440_bank_audit_2_views_and_scorecard, 440_bank_audit_3_book_charges): the
-- tables, functions and columns; the views and scorecard; then the charge
-- backfill. The backfill booked 175 charges, 3,606.44 in all.

SET search_path TO public;

-- ── 1. Settings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_audit_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  new_within_days      integer NOT NULL DEFAULT 7  CHECK (new_within_days >= 0),
  amber_after_days     integer NOT NULL DEFAULT 14 CHECK (amber_after_days >= 0),
  red_after_days       integer NOT NULL DEFAULT 30 CHECK (red_after_days >= 0),
  big_amount           numeric(14,2) NOT NULL DEFAULT 100000 CHECK (big_amount > 0),
  grace_days           integer NOT NULL DEFAULT 3  CHECK (grace_days >= 0),
  tie_tolerance        numeric(10,2) NOT NULL DEFAULT 1 CHECK (tie_tolerance >= 0),
  statement_every_days integer NOT NULL DEFAULT 14 CHECK (statement_every_days > 0),
  updated_by           uuid REFERENCES user_profiles(id),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE bank_audit_settings IS
  'One row. How the bank audit (440) ages and escalates its flags, and how often a statement is due.';
INSERT INTO bank_audit_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE bank_audit_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_audit_settings_read ON bank_audit_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY bank_audit_settings_admin ON bank_audit_settings FOR UPDATE TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
REVOKE ALL ON bank_audit_settings FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON bank_audit_settings TO authenticated;

-- new: under a week · open: up to two weeks · amber: over two weeks · red: over a month
CREATE OR REPLACE FUNCTION bank_flag_severity(p_age integer)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_age IS NULL THEN 'new'
              WHEN p_age > s.red_after_days THEN 'red'
              WHEN p_age > s.amber_after_days THEN 'amber'
              WHEN p_age >= s.new_within_days THEN 'open'
              ELSE 'new' END
  FROM bank_audit_settings s
$$;

-- ── 2. The bank's charges ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_charge_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  amount     numeric(12,2) NOT NULL CHECK (amount > 0),
  label      text NOT NULL CHECK (btrim(label) <> ''),
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES user_profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE bank_charge_rules IS
  'Charges a bank adds to a transfer line on top of what it pays. account_id NULL applies to every account.';
CREATE UNIQUE INDEX IF NOT EXISTS bank_charge_rules_uniq
  ON bank_charge_rules (COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), amount);
ALTER TABLE bank_charge_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_charge_rules_read ON bank_charge_rules FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'finance', 'executive'));
CREATE POLICY bank_charge_rules_write ON bank_charge_rules FOR ALL TO authenticated
  USING (get_user_role() IN ('admin', 'finance')) WITH CHECK (get_user_role() IN ('admin', 'finance'));
REVOKE ALL ON bank_charge_rules FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_charge_rules TO authenticated;

INSERT INTO bank_charge_rules (account_id, amount, label, created_by)
SELECT NULL, x.amount, x.label, NULL
FROM (VALUES (6.00, 'Local transfer charge'), (290.00, 'Outward transfer (MT103) charge')) x(amount, label)
WHERE NOT EXISTS (SELECT 1 FROM bank_charge_rules r WHERE r.account_id IS NULL AND r.amount = x.amount);

-- The charge, if any, that explains what a line carries over its payments:
-- 0 when they tie within the tolerance, the rule's amount when the excess is
-- one of the bank's charges, NULL when nothing explains it.
CREATE OR REPLACE FUNCTION bank_line_charge(p_account_id uuid, p_excess numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_excess IS NULL THEN NULL
    WHEN abs(p_excess) <= s.tie_tolerance THEN 0
    ELSE (SELECT r.amount FROM bank_charge_rules r
           WHERE r.is_active AND (r.account_id IS NULL OR r.account_id = p_account_id)
             AND abs(p_excess - r.amount) <= s.tie_tolerance
           ORDER BY abs(p_excess - r.amount), r.account_id NULLS LAST
           LIMIT 1)
  END
  FROM bank_audit_settings s
$$;

-- A reference as the bank prints it: no spaces, upper case.
CREATE OR REPLACE FUNCTION bank_ref_norm(p_ref text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_ref, ''), '\s+', '', 'g')), '')
$$;

-- ── 3. Where a payment keeps its proof ─────────────────────────────────────
-- A whole bill keeps its transfer screenshot in payment_certificate_url; a
-- part and a batch get their own.
ALTER TABLE expense_payments
  ADD COLUMN IF NOT EXISTS proof_url text,
  ADD COLUMN IF NOT EXISTS proof_name text;
ALTER TABLE batch_payments
  ADD COLUMN IF NOT EXISTS bank_ref text,
  ADD COLUMN IF NOT EXISTS paid_date date,
  ADD COLUMN IF NOT EXISTS proof_url text,
  ADD COLUMN IF NOT EXISTS proof_name text;
COMMENT ON COLUMN batch_payments.bank_ref IS 'The bank reference (FT number) of the one transfer that paid the batch.';

-- ── 4. Each statement line against what it pays ────────────────────────────
CREATE OR REPLACE VIEW v_bank_line_audit WITH (security_invoker = true) AS
SELECT l.line_id, l.import_id, l.account_id, l.value_date, l.direction, l.amount, l.reference_code, l.reference,
  l.narration, l.transaction_type, l.reconciled_as, l.linked_amount, l.transfer_id,
  l.batch, l.expenses, l.sales, l.payroll, l.vrf,
  CASE WHEN l.direction = 'debit' AND l.reconciled_as IN ('expense', 'batch', 'vrf', 'payroll') AND l.linked_amount IS NOT NULL
       THEN round(l.amount - l.linked_amount, 2) END AS difference,
  CASE WHEN l.direction = 'debit' AND l.reconciled_as IN ('expense', 'batch', 'vrf', 'payroll') AND l.linked_amount IS NOT NULL
       THEN bank_line_charge(l.account_id, round(l.amount - l.linked_amount, 2)) END AS charge,
  -- Payroll is left out of the tie: a run is often paid one line per person.
  CASE WHEN l.direction = 'debit' AND l.reconciled_as IN ('expense', 'batch', 'vrf') AND l.linked_amount IS NOT NULL
       THEN bank_line_charge(l.account_id, round(l.amount - l.linked_amount, 2)) IS NOT NULL
       ELSE true END AS ties
FROM v_bank_line_status l;

-- ── 5. Booking the charge a line carries ────────────────────────────────────
-- p_charge is what to book (0 takes back anything booked before).
CREATE OR REPLACE FUNCTION book_bank_line_charge(p_line_id uuid, p_charge numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l bank_statement_lines%ROWTYPE; v_cash uuid; v_lines jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO l FROM bank_statement_lines WHERE id = p_line_id;
  IF l.id IS NULL THEN RETURN; END IF;
  BEGIN
    IF COALESCE(p_charge, 0) > 0 THEN
      SELECT id INTO v_cash FROM chart_of_accounts WHERE linked_account_id = l.account_id;
      IF v_cash IS NULL THEN
        PERFORM log_posting_failure('bank_line_charge', p_line_id, 'No ledger cash account is linked to this bank account');
        RETURN;
      END IF;
      v_lines := jsonb_build_array(
        ledger_line(bank_classification_coa('bank_charge', 'debit'), round(p_charge, 2),
                    'Bank charge on ' || COALESCE(l.reference_code, 'a transfer')),
        ledger_line(v_cash, -round(p_charge, 2), 'Taken by the bank with the transfer'));
    END IF;
    PERFORM ledger_sync('bank_line_charge', p_line_id, l.value_date,
      'Bank charge: ' || COALESCE(l.reference_code, 'transfer'), v_lines);
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('bank_line_charge', p_line_id, SQLERRM);
  END;
END $$;

-- Brings the booked charges in line with what each matched line carries over
-- its payments. Touches only lines where the two differ.
CREATE OR REPLACE FUNCTION sync_bank_line_charges(p_account_id uuid DEFAULT NULL, p_line_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_n int := 0; v_coa uuid := bank_classification_coa('bank_charge', 'debit');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR r IN
    WITH want AS (
      SELECT a.line_id, a.account_id, a.value_date,
        CASE WHEN COALESCE(a.charge, 0) > 0 AND a.difference > 0 THEN a.difference ELSE 0 END AS charge
      FROM v_bank_line_audit a
      WHERE (p_account_id IS NULL OR a.account_id = p_account_id) AND (p_line_id IS NULL OR a.line_id = p_line_id)
    ), have AS (
      SELECT je.source_id AS line_id, sum(jl.debit - jl.credit) AS booked
      FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.account_id = v_coa
      WHERE je.source_table = 'bank_line_charge'
      GROUP BY je.source_id
    )
    SELECT w.line_id, w.charge FROM want w LEFT JOIN have h ON h.line_id = w.line_id
    WHERE abs(w.charge - COALESCE(h.booked, 0)) >= 0.005
      AND NOT bank_period_closed(w.account_id, w.value_date)
  LOOP
    PERFORM book_bank_line_charge(r.line_id, r.charge);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- The tie-out counts a booked charge as on the bank.
CREATE OR REPLACE VIEW v_cash_ledger_lines WITH (security_invoker = true) AS
SELECT jl.id AS journal_line_id, je.id AS journal_entry_id,
  c.linked_account_id AS account_id, c.id AS coa_id, c.account_code,
  je.entry_date, je.entry_type, je.source_table, je.source_id, je.description,
  jl.debit - jl.credit AS amount,
  CASE
    WHEN je.source_table IN ('bank_statement_lines', 'bank_line_charge') THEN true
    WHEN je.source_table = 'transfers' THEN EXISTS (
      SELECT 1 FROM bank_statement_lines bl
      WHERE bl.account_id = c.linked_account_id
        AND bl.transfer_id = ANY (ARRAY[je.source_id, (SELECT t.counterpart_id FROM transfers t WHERE t.id = je.source_id)]))
    WHEN je.source_table LIKE 'expense%' THEN EXISTS (
      SELECT 1 FROM expenses e JOIN bank_statement_lines bl ON bl.account_id = c.linked_account_id
        AND (bl.transfer_id = e.transfer_id
             OR bl.transfer_id IN (SELECT bp.transfer_id FROM batch_payment_expenses bpe
                                   JOIN batch_payments bp ON bp.id = bpe.batch_payment_id WHERE bpe.expense_id = e.id))
      WHERE e.id = je.source_id)
    WHEN je.source_table = 'sales' THEN EXISTS (
      SELECT 1 FROM sales s JOIN bank_statement_lines bl ON bl.account_id = c.linked_account_id AND bl.transfer_id = s.transfer_id
      WHERE s.id = je.source_id)
    WHEN je.source_table = 'payroll' THEN EXISTS (
      SELECT 1 FROM payroll p JOIN bank_statement_lines bl ON bl.account_id = c.linked_account_id
        AND (bl.matched_payroll_id = p.id OR bl.transfer_id = p.transfer_id)
      WHERE p.id = je.source_id)
    WHEN je.source_table = 'vendor_receipt_facilitation' THEN EXISTS (
      SELECT 1 FROM vendor_receipt_facilitation v JOIN bank_statement_lines bl ON bl.account_id = c.linked_account_id
        AND (bl.transfer_id = v.out_transfer_id
             OR bl.transfer_id IN (SELECT r.transfer_id FROM vrf_returns r WHERE r.vrf_id = v.id))
      WHERE v.id = je.source_id)
    ELSE false
  END AS on_bank
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
JOIN chart_of_accounts c ON c.id = jl.account_id
WHERE c.linked_account_id IS NOT NULL;

-- ── 6. Every bank payment, and whether the bank agrees ─────────────────────
--   confirmed          a statement line pays it, and the amounts tie
--   not_checked        no statement runs far enough past its date yet
--   before_statements  paid before the first imported statement
--   problem            amount     — its line doesn't tie
--                      duplicate_ref — its reference is on another payment too
--                      not_in_bank   — the statement covers its date and doesn't show it
CREATE OR REPLACE VIEW v_payment_bank_check WITH (security_invoker = true) AS
WITH s AS (SELECT * FROM bank_audit_settings LIMIT 1),
cov AS (
  SELECT account_id, min(value_date) AS first_date, max(value_date) AS last_date
  FROM bank_statement_lines GROUP BY account_id
),
-- Each computed once and joined by hash: the line audit is the costly part.
la AS MATERIALIZED (
  SELECT a.line_id, a.amount, a.value_date, a.difference, a.ties FROM v_bank_line_audit a
),
lt AS MATERIALIZED (
  SELECT DISTINCT ON (transfer_id) transfer_id, id FROM bank_statement_lines
  WHERE transfer_id IS NOT NULL ORDER BY transfer_id, value_date
),
lp AS MATERIALIZED (
  SELECT DISTINCT ON (matched_payroll_id) matched_payroll_id, id FROM bank_statement_lines
  WHERE matched_payroll_id IS NOT NULL ORDER BY matched_payroll_id, value_date
),
pay AS (
  -- A bill paid in one go, by bank, on its own.
  SELECT 'expense'::text AS kind, e.id, e.id AS expense_id, e.expense_code AS code,
    COALESCE(v.vendor_name, e.vendors_name, st.employee_name) AS payee, e.item_service_description AS description,
    COALESCE(e.net_payable, e.amount_etb)::numeric AS amount, e.account_id,
    COALESCE(e.paid_date::date, e.payment_state_changed_at::date, e.date) AS paid_on,
    e.disbursed_by AS payer_id, bank_ref_norm(e.bank_ref) AS bank_ref, e.transfer_id,
    e.payment_method AS method, e.payment_state AS state
  FROM expenses e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN staff st ON st.id = e.paid_to_staff_id
  WHERE e.payment_state IN ('paid', 'advance') AND NOT e.in_parts AND NOT COALESCE(e.is_archived, false)
    AND e.payment_method IN ('transfer', 'cpo', 'cheque')
    AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id)
  UNION ALL
  -- A batch: one transfer for several bills.
  SELECT 'batch', b.id, NULL::uuid, b.payment_code,
    CASE WHEN count(*) = 1 THEN min(COALESCE(v.vendor_name, e.vendors_name)) ELSE count(*) || ' payments' END,
    b.notes,
    sum(COALESCE(e.net_payable, e.amount_etb)), (array_agg(e.account_id ORDER BY e.account_id))[1],
    COALESCE(b.paid_date, max(COALESCE(e.paid_date::date, e.payment_state_changed_at::date, e.date))),
    COALESCE(b.assignee_id, (array_agg(e.disbursed_by ORDER BY e.disbursed_by))[1]),
    bank_ref_norm(COALESCE(b.bank_ref, max(e.bank_ref))),
    COALESCE(b.transfer_id, (array_agg(e.transfer_id) FILTER (WHERE e.transfer_id IS NOT NULL))[1]),
    max(e.payment_method), 'paid'
  FROM batch_payments b
  JOIN batch_payment_expenses x ON x.batch_payment_id = b.id
  JOIN expenses e ON e.id = x.expense_id
  LEFT JOIN vendors v ON v.id = e.vendor_id
  WHERE NOT COALESCE(e.is_archived, false)
  GROUP BY b.id
  HAVING bool_and(e.payment_state IN ('paid', 'advance'))
     AND bool_and(e.payment_method IN ('batch_wire', 'transfer', 'cpo', 'cheque'))
  UNION ALL
  -- A part of a bill paid in parts.
  SELECT 'part', q.id, q.expense_id, e.expense_code || format(' · part %s of %s', pos.part_no, pos.part_count),
    COALESCE(v.vendor_name, e.vendors_name, st.employee_name), e.item_service_description,
    q.cash_etb, COALESCE(q.account_id, e.account_id), q.paid_date, q.disbursed_by, bank_ref_norm(q.bank_ref), q.transfer_id,
    q.payment_method, q.state
  FROM expense_payments q
  JOIN expenses e ON e.id = q.expense_id
  CROSS JOIN LATERAL expense_part_position(q.id) pos
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN staff st ON st.id = e.paid_to_staff_id
  WHERE q.state = 'paid' AND NOT q.legacy_entry AND q.payment_method IN ('transfer', 'cpo', 'cheque')
    AND NOT COALESCE(e.is_archived, false)
  UNION ALL
  -- A vendor receipt facilitation sent out.
  SELECT 'vrf', f.id, NULL::uuid, f.record_name, f.facilitator_name, 'Vendor receipt facilitation',
    COALESCE(f.net_sent, f.amount_transferred), f.initial_account_id, COALESCE(f.sent_date, f.trxn_date),
    f.sent_by, NULL::text, f.out_transfer_id, 'transfer', f.payment_state
  FROM vendor_receipt_facilitation f
  WHERE f.payment_state = 'sent' AND NOT f.is_archived
  UNION ALL
  -- A payroll run paid by bank (often one line per person).
  SELECT 'payroll', p.id, NULL::uuid, p.payroll_record, p.pay_period, 'Payroll',
    (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id),
    p.account_id, p.end_date, NULL::uuid, NULL::text, p.transfer_id, p.payment_method, p.payment_status
  FROM payroll p
  WHERE p.payment_status = 'paid' AND p.payment_method ILIKE '%bank%' AND NOT COALESCE(p.is_archived, false)
),
refs AS (
  SELECT bank_ref, count(DISTINCT transfer_id) AS n_lines, bool_and(transfer_id IS NOT NULL) AS all_linked
  FROM pay WHERE bank_ref IS NOT NULL
  GROUP BY bank_ref HAVING count(*) > 1
),
chk AS (
  SELECT p.*,
    COALESCE(lt.id, CASE WHEN p.kind = 'payroll' THEN lp.id END) AS line_id,
    (r.bank_ref IS NOT NULL AND NOT (r.all_linked AND r.n_lines = 1)) AS dup
  FROM pay p
  LEFT JOIN refs r ON r.bank_ref = p.bank_ref
  LEFT JOIN lt ON lt.transfer_id = p.transfer_id
  LEFT JOIN lp ON lp.matched_payroll_id = p.id
)
SELECT c.kind, c.id, c.expense_id, c.code, c.payee, c.description, round(c.amount, 2) AS amount,
  c.account_id, a.account_name, c.paid_on, c.payer_id, notify_user_name(c.payer_id) AS payer_name,
  c.bank_ref, c.transfer_id, c.method, c.state,
  c.line_id, la.amount AS line_amount, la.value_date AS line_date, la.difference AS line_difference,
  cv.last_date AS statement_through,
  CASE
    WHEN c.line_id IS NOT NULL AND la.ties IS NOT FALSE THEN 'confirmed'
    WHEN c.line_id IS NOT NULL THEN 'problem'
    WHEN c.dup THEN 'problem'
    WHEN cv.first_date IS NULL OR c.paid_on IS NULL THEN 'not_checked'
    WHEN c.paid_on < cv.first_date THEN 'before_statements'
    WHEN cv.last_date >= c.paid_on + s.grace_days THEN 'problem'
    ELSE 'not_checked'
  END AS status,
  CASE
    WHEN c.line_id IS NOT NULL AND la.ties IS FALSE THEN 'amount'
    WHEN c.line_id IS NOT NULL THEN NULL
    WHEN c.dup THEN 'duplicate_ref'
    WHEN cv.first_date IS NOT NULL AND c.paid_on >= cv.first_date AND cv.last_date >= c.paid_on + s.grace_days THEN 'not_in_bank'
  END AS problem,
  CASE c.kind WHEN 'batch' THEN '/batch-payments/' || c.id WHEN 'vrf' THEN '/vendor-receipts/' || c.id
              WHEN 'payroll' THEN '/payroll/' || c.id ELSE '/expenses/' || c.expense_id END AS link
FROM chk c
CROSS JOIN s
LEFT JOIN cov cv ON cv.account_id = c.account_id
LEFT JOIN accounts a ON a.id = c.account_id
LEFT JOIN la ON la.line_id = c.line_id
-- Only Kuncho's bank accounts have statements; money from the owner's own
-- pocket or a wallet is not checked here.
WHERE c.account_id IS NULL OR a.type ILIKE 'bank%';

-- ── 7. What needs a look ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_bank_audit_flags WITH (security_invoker = true) AS
WITH s AS (SELECT * FROM bank_audit_settings LIMIT 1),
lines AS MATERIALIZED (SELECT * FROM v_bank_line_audit),
pc AS MATERIALIZED (SELECT * FROM v_payment_bank_check),
-- Records already carrying a reference but not linked to a line yet: a bill
-- recorded from the statement, still waiting for approval or payment.
recorded AS MATERIALIZED (
  SELECT x.ref, x.direction,
    jsonb_agg(jsonb_build_object('kind', x.kind, 'id', x.id, 'expense_id', x.expense_id, 'code', x.code,
                                 'amount', x.amount, 'state', x.state)) AS related
  FROM (
    SELECT bank_ref_norm(e.bank_ref) AS ref, 'debit'::text AS direction, 'expense'::text AS kind, e.id, e.id AS expense_id,
      e.expense_code AS code, COALESCE(e.net_payable, e.amount_etb) AS amount,
      CASE WHEN e.approval_status::text IN ('pending', 'manager_approved') THEN 'waiting for approval'
           ELSE replace(e.payment_state, '_', ' ') END AS state
    FROM expenses e
    WHERE bank_ref_norm(e.bank_ref) IS NOT NULL AND e.transfer_id IS NULL AND NOT COALESCE(e.is_archived, false)
    UNION ALL
    SELECT bank_ref_norm(q.bank_ref), 'debit', 'part', q.id, q.expense_id, e.expense_code, q.cash_etb, q.state
    FROM expense_payments q JOIN expenses e ON e.id = q.expense_id
    WHERE bank_ref_norm(q.bank_ref) IS NOT NULL AND q.transfer_id IS NULL AND q.state <> 'cancelled'
    UNION ALL
    SELECT bank_ref_norm(sa.bank_ref), 'credit', 'sale', sa.id, NULL::uuid, sa.invoice_number, sa.amount, sa.sales_status::text
    FROM sales sa
    WHERE bank_ref_norm(sa.bank_ref) IS NOT NULL AND sa.transfer_id IS NULL AND NOT COALESCE(sa.is_archived, false)
  ) x
  GROUP BY x.ref, x.direction
),
f AS (
  -- 1·2  Money the bank moved that nothing in the system accounts for. A
  --      record already carrying the reference comes along with it.
  SELECT CASE WHEN l.direction = 'debit' THEN 'bank_not_recorded' ELSE 'money_in_no_sale' END AS kind,
    'line:' || l.line_id AS flag_id, l.account_id, l.line_id,
    NULL::text AS record_kind, NULL::uuid AS record_id, NULL::uuid AS expense_id, l.reference_code AS reference,
    COALESCE(NULLIF(btrim(l.narration), ''), l.transaction_type, l.reference_code, 'Bank line') AS title,
    CASE WHEN l.direction = 'debit' THEN 'Paid by the bank — no expense, payment or explanation behind it'
         ELSE 'Received — not linked to a sale or explained' END AS detail,
    l.amount, NULL::numeric AS expected, NULL::numeric AS difference, l.value_date AS ref_date, NULL::uuid AS payer_id,
    rec.related
  FROM lines l
  LEFT JOIN recorded rec ON rec.ref = bank_ref_norm(l.reference_code) AND rec.direction = l.direction
  WHERE l.reconciled_as IS NULL
  UNION ALL
  -- 3  Paid in the system on a date the statement covers, and not on it.
  --    The open lines that look like it come along, to match in one click.
  SELECT 'paid_not_in_bank', c.kind || ':' || c.id, c.account_id, NULL::uuid, c.kind, c.id, c.expense_id, c.bank_ref,
    concat_ws(' · ', COALESCE(c.payee, c.description), c.code),
    'Marked paid ' || to_char(c.paid_on, 'DD Mon YYYY') || COALESCE(' as ' || c.bank_ref, ' with no bank reference')
      || ' — the statement runs to ' || to_char(c.statement_through, 'DD Mon YYYY') || ' and does not show it',
    c.amount, NULL::numeric, NULL::numeric, c.paid_on, c.payer_id,
    (SELECT jsonb_agg(jsonb_build_object('line_id', z.line_id, 'value_date', z.value_date, 'amount', z.amount,
                                         'reference', z.reference_code, 'narration', z.narration)
                      ORDER BY z.rank DESC, abs(z.value_date - c.paid_on))
       FROM (SELECT o.line_id, o.value_date, o.amount, o.reference_code, o.narration,
               CASE WHEN bank_ref_norm(o.reference_code) = c.bank_ref THEN 3
                    WHEN bank_line_charge(o.account_id, o.amount - c.amount) IS NOT NULL THEN 2
                    ELSE 1 END AS rank
             FROM lines o
             WHERE o.account_id = c.account_id AND o.direction = 'debit' AND o.reconciled_as IS NULL
               AND o.value_date BETWEEN c.paid_on - 10 AND c.paid_on + 30
               AND (bank_ref_norm(o.reference_code) = c.bank_ref
                    OR bank_line_charge(o.account_id, o.amount - c.amount) IS NOT NULL
                    OR bank_amount_fit(o.amount, c.amount, 'debit') >= 40)
             ORDER BY 6 DESC, abs(o.value_date - c.paid_on)
             LIMIT 3) z)
  FROM pc c WHERE c.problem = 'not_in_bank'
  UNION ALL
  -- 4  A line and what it pays that don't tie, beyond one of the bank's charges.
  SELECT 'amount_mismatch', 'tie:' || l.line_id, l.account_id, l.line_id, l.reconciled_as, NULL::uuid,
    CASE WHEN l.reconciled_as = 'expense' THEN (l.expenses -> 0 ->> 'id')::uuid END,
    l.reference_code,
    COALESCE(NULLIF(btrim(l.narration), ''), l.reference_code, 'Bank line'),
    'The bank paid ' || to_char(l.amount, 'FM999,999,999,990.00') || '; the system says '
      || to_char(l.linked_amount, 'FM999,999,999,990.00') || ' — ' || to_char(abs(l.difference), 'FM999,999,999,990.00')
      || CASE WHEN l.difference > 0 THEN ' more' ELSE ' less' END || ', which no bank charge explains',
    l.amount, l.linked_amount, l.difference, l.value_date, NULL::uuid,
    CASE l.reconciled_as
      WHEN 'expense' THEN (SELECT jsonb_agg(x || jsonb_build_object('kind', CASE WHEN x ? 'part_id' THEN 'part' ELSE 'expense' END))
                             FROM jsonb_array_elements(l.expenses) x)
      WHEN 'batch' THEN jsonb_build_array(l.batch || jsonb_build_object('kind', 'batch'))
      WHEN 'vrf' THEN jsonb_build_array(l.vrf || jsonb_build_object('kind', 'vrf'))
    END
  FROM lines l WHERE NOT l.ties
  UNION ALL
  -- 5  One bank reference on more than one payment, not settled by one line.
  SELECT 'duplicate_ref', 'ref:' || r.bank_ref, r.account_id,
    (SELECT o.line_id FROM lines o WHERE bank_ref_norm(o.reference_code) = r.bank_ref ORDER BY o.value_date LIMIT 1),
    'payments', NULL::uuid, NULL::uuid, r.bank_ref,
    r.bank_ref || ' is on ' || r.n || ' payments',
    'One transfer can pay several bills only when, together, they are what the bank line shows — check which of these it really paid',
    r.amount, NULL::numeric, NULL::numeric, r.ref_date, NULL::uuid, r.claims
  FROM (
    SELECT c.bank_ref, count(*) AS n, (array_agg(c.account_id ORDER BY c.paid_on))[1] AS account_id, sum(c.amount) AS amount,
      min(c.paid_on) AS ref_date,
      jsonb_agg(jsonb_build_object('kind', c.kind, 'id', c.id, 'expense_id', c.expense_id, 'code', c.code,
                                   'amount', c.amount, 'state', c.status, 'link', c.link) ORDER BY c.paid_on) AS claims
    FROM pc c
    WHERE c.bank_ref IN (SELECT x.bank_ref FROM pc x WHERE x.problem = 'duplicate_ref')
    GROUP BY c.bank_ref
  ) r
)
SELECT f.flag_id, f.kind, f.account_id, a.account_name, f.line_id, f.record_kind, f.record_id, f.expense_id,
  f.reference, f.title, f.detail,
  round(f.amount, 2) AS amount, round(f.expected, 2) AS expected, round(f.difference, 2) AS difference,
  f.ref_date, (CURRENT_DATE - f.ref_date) AS age_days,
  bank_flag_severity(CURRENT_DATE - f.ref_date) AS severity,
  (f.amount >= s.big_amount) AS big,
  f.payer_id, notify_user_name(f.payer_id) AS payer_name, f.related,
  CASE
    WHEN f.kind IN ('bank_not_recorded', 'money_in_no_sale') THEN
      '/bank-statement-import?tab=queue&account=' || f.account_id || '&line=' || f.line_id
    WHEN f.kind = 'duplicate_ref' THEN COALESCE(f.related -> 0 ->> 'link', '/bank-statement-import?tab=audit')
    WHEN f.record_kind = 'batch' THEN '/batch-payments/' || COALESCE(f.record_id::text, f.related -> 0 ->> 'id')
    WHEN f.record_kind = 'vrf' THEN '/vendor-receipts/' || COALESCE(f.record_id::text, f.related -> 0 ->> 'id')
    WHEN f.record_kind = 'payroll' THEN '/payroll/' || f.record_id
    WHEN f.expense_id IS NOT NULL THEN '/expenses/' || f.expense_id
    ELSE '/bank-statement-import?tab=audit'
  END AS link
FROM f
CROSS JOIN s
LEFT JOIN accounts a ON a.id = f.account_id;

-- ── 8. Per account ─────────────────────────────────────────────────────────
-- Bank-checked through: the day before the oldest open flag — up to then the
-- bank and the system agree. Empty while the very first day still has one.
CREATE OR REPLACE VIEW v_bank_audit_accounts WITH (security_invoker = true) AS
WITH s AS (SELECT * FROM bank_audit_settings LIMIT 1),
fl AS MATERIALIZED (
  SELECT account_id, count(*) AS flags,
    count(*) FILTER (WHERE severity = 'red') AS red,
    count(*) FILTER (WHERE severity = 'amber') AS amber,
    count(*) FILTER (WHERE big) AS big,
    COALESCE(sum(amount), 0) AS flag_amount, min(ref_date) AS oldest_flag
  FROM v_bank_audit_flags GROUP BY account_id
),
pc AS MATERIALIZED (
  SELECT account_id,
    count(*) FILTER (WHERE status = 'confirmed') AS confirmed_count,
    COALESCE(sum(amount) FILTER (WHERE status = 'confirmed'), 0) AS confirmed_amount,
    count(*) FILTER (WHERE status = 'not_checked') AS unchecked_count,
    COALESCE(sum(amount) FILTER (WHERE status = 'not_checked'), 0) AS unchecked_amount,
    count(*) FILTER (WHERE status = 'problem') AS problem_count,
    COALESCE(sum(amount) FILTER (WHERE status = 'problem'), 0) AS problem_amount,
    max(paid_on) AS last_paid_on
  FROM v_payment_bank_check GROUP BY account_id
)
SELECT a.id AS account_id, a.account_name, a.role,
  o.first_date, o.last_date AS statement_through, o.last_import_at, o.closed_through,
  COALESCE(o.line_count, 0)::int AS line_count, COALESCE(o.open_count, 0)::int AS open_count,
  CASE WHEN o.last_date IS NULL THEN NULL
       WHEN fl.oldest_flag IS NULL OR fl.oldest_flag > o.last_date THEN o.last_date
       WHEN fl.oldest_flag <= o.first_date THEN NULL
       ELSE fl.oldest_flag - 1 END AS checked_through,
  (CURRENT_DATE - o.last_date) AS statement_age_days,
  (o.last_date IS NULL OR o.last_date < CURRENT_DATE - s.statement_every_days) AS statement_due,
  s.statement_every_days,
  COALESCE(fl.flags, 0)::int AS flags, COALESCE(fl.red, 0)::int AS red, COALESCE(fl.amber, 0)::int AS amber,
  COALESCE(fl.big, 0)::int AS big, round(COALESCE(fl.flag_amount, 0), 2) AS flag_amount, fl.oldest_flag,
  COALESCE(pc.confirmed_count, 0)::int AS confirmed_count, round(COALESCE(pc.confirmed_amount, 0), 2) AS confirmed_amount,
  COALESCE(pc.unchecked_count, 0)::int AS unchecked_count, round(COALESCE(pc.unchecked_amount, 0), 2) AS unchecked_amount,
  COALESCE(pc.problem_count, 0)::int AS problem_count, round(COALESCE(pc.problem_amount, 0), 2) AS problem_amount
FROM accounts a
CROSS JOIN s
LEFT JOIN v_bank_account_overview o ON o.account_id = a.id
LEFT JOIN fl ON fl.account_id = a.id
LEFT JOIN pc ON pc.account_id = a.id
WHERE a.type ILIKE 'bank%' AND lower(COALESCE(a.status, 'active')) = 'active'
  AND (COALESCE(o.line_count, 0) > 0 OR pc.last_paid_on >= CURRENT_DATE - 90);

-- ── 9. Scorecard ───────────────────────────────────────────────────────────
-- Bank payments made in the window, by what the bank says about them: all
-- together, per account, and per person who paid them.
CREATE OR REPLACE FUNCTION bank_audit_scorecard(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(scope text, key uuid, label text, payments integer, amount numeric,
  confirmed_count integer, confirmed_amount numeric, unchecked_count integer, unchecked_amount numeric,
  problem_count integer, problem_amount numeric, before_count integer, before_amount numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_from date := COALESCE(p_from, CURRENT_DATE - 90); v_to date := COALESCE(p_to, CURRENT_DATE);
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can see the bank scorecard';
  END IF;
  RETURN QUERY
  WITH c AS (SELECT * FROM v_payment_bank_check WHERE paid_on BETWEEN v_from AND v_to),
  g AS (
    SELECT 'all'::text AS g_scope, NULL::uuid AS g_key, 'All bank payments'::text AS g_label, c.status AS g_status, c.amount AS g_amount FROM c
    UNION ALL
    SELECT 'account', c.account_id, COALESCE(c.account_name, 'No account recorded'), c.status, c.amount FROM c
    UNION ALL
    SELECT 'payer', c.payer_id, COALESCE(c.payer_name, 'Payer not recorded'), c.status, c.amount FROM c
  )
  SELECT g.g_scope, g.g_key, g.g_label, count(*)::int, round(COALESCE(sum(g.g_amount), 0), 2),
    (count(*) FILTER (WHERE g.g_status = 'confirmed'))::int, round(COALESCE(sum(g.g_amount) FILTER (WHERE g.g_status = 'confirmed'), 0), 2),
    (count(*) FILTER (WHERE g.g_status = 'not_checked'))::int, round(COALESCE(sum(g.g_amount) FILTER (WHERE g.g_status = 'not_checked'), 0), 2),
    (count(*) FILTER (WHERE g.g_status = 'problem'))::int, round(COALESCE(sum(g.g_amount) FILTER (WHERE g.g_status = 'problem'), 0), 2),
    (count(*) FILTER (WHERE g.g_status = 'before_statements'))::int, round(COALESCE(sum(g.g_amount) FILTER (WHERE g.g_status = 'before_statements'), 0), 2)
  FROM g
  GROUP BY g.g_scope, g.g_key, g.g_label
  ORDER BY CASE g.g_scope WHEN 'all' THEN 0 WHEN 'account' THEN 1 ELSE 2 END, 5 DESC;
END $$;

-- ── 10. Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON v_bank_line_audit, v_payment_bank_check, v_bank_audit_flags, v_bank_audit_accounts FROM PUBLIC, anon;
GRANT SELECT ON v_bank_line_audit, v_payment_bank_check, v_bank_audit_flags, v_bank_audit_accounts TO authenticated;
REVOKE ALL ON v_cash_ledger_lines FROM PUBLIC, anon;
GRANT SELECT ON v_cash_ledger_lines TO authenticated;

REVOKE ALL ON FUNCTION bank_flag_severity(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_line_charge(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_ref_norm(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_audit_scorecard(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bank_flag_severity(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_line_charge(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_ref_norm(text) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_audit_scorecard(date, date) TO authenticated;
-- Internal: reached only through the reconciliation functions.
REVOKE ALL ON FUNCTION book_bank_line_charge(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_bank_line_charges(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 11. Book the charges already on matched lines ──────────────────────────
-- The finance-side guards read the caller; act as an admin for the backfill.
DO $$
DECLARE v_admin uuid; v_n int;
BEGIN
  SELECT id INTO v_admin FROM user_profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  IF v_admin IS NULL THEN RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_n := sync_bank_line_charges(NULL, NULL);
  RAISE NOTICE 'Booked the bank charge on % matched line(s)', v_n;
END $$;
