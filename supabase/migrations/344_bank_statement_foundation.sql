-- 344 — Bank statements, phase 1: one copy of each bank line, statements
--       that join up, and a status that can't go stale
--
-- What was wrong:
--   * The same statement could be imported again and again. "export 13"
--     and "export 15" were each imported twice and "export 18" sat as two
--     drafts over periods already committed; export 15 also repeated the
--     last four 22 Jul lines of export 13.
--   * A line was a "duplicate" when its reference already had a transfer —
--     and every committed line has one (its own). rematch therefore flagged
--     committed lines as duplicates of themselves: 60 lines lost the match
--     they had (9 of export 13's were paying expenses) or were never offered
--     for matching again.
--   * match_status was written once and never followed what happened later
--     (a payment matched from the Payments page never updated it).
--   * Nothing checked that a statement opened where the previous one closed.
--
-- What this does:
--   1. Clears the stale drafts and the lines that were copies of lines
--      already in the system.
--   2. Every line carries its account and a fingerprint — date, amount,
--      direction and the running balance after it (or, where a statement
--      has no balance column, its reference and narration). One fingerprint
--      per account: re-uploading a statement, or one that overlaps, only
--      adds the lines not already there.
--   3. import_bank_statement(): one step. A dry run says how many lines are
--      new, how many are already in, and whether the statement joins the
--      lines around it; the real run records the new lines, their bank
--      transactions and the exact-reference matches. No drafts.
--   4. v_bank_line_status: a line's status is read from what points at its
--      bank transaction (an expense, a batch, a sale, payroll, a vendor
--      request, an opening balance) or from how it was explained — never
--      stored, so it can't drift.
--   5. bank_period_closes and bank_period_closed(): the lock that phase 3's
--      period close uses; created here so every function can respect it.

SET search_path TO public;

-- ── 1. Fingerprints ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bank_line_fingerprint(p_date date, p_debit numeric, p_credit numeric,
  p_balance numeric, p_reference text, p_narration text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(concat_ws('|',
    p_date::text,
    CASE WHEN COALESCE(p_debit, 0) > 0 THEN 'D' || round(p_debit, 2)::text ELSE 'C' || round(COALESCE(p_credit, 0), 2)::text END,
    COALESCE('B' || round(p_balance, 2)::text,
             'R' || upper(COALESCE(btrim(p_reference), '')) || '/' || upper(COALESCE(btrim(p_narration), '')))))
$$;

ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS fingerprint text;
UPDATE bank_statement_lines l SET account_id = i.account_id
  FROM bank_statement_imports i WHERE i.id = l.import_id AND l.account_id IS NULL;
UPDATE bank_statement_lines SET fingerprint = bank_line_fingerprint(value_date, debit_amount, credit_amount,
  running_balance, reference_code, narration) WHERE fingerprint IS NULL;

-- ── 2. Clear what was never real ────────────────────────────────────────
-- Drafts: nothing hangs off them (no bank transaction was ever written).
DELETE FROM bank_statement_lines l USING bank_statement_imports i
  WHERE i.id = l.import_id AND i.status = 'draft';
DELETE FROM bank_statement_imports WHERE status = 'draft';
-- Committed lines that never got a bank transaction because they were a
-- copy of a line that did.
DELETE FROM bank_statement_lines l
  WHERE l.transfer_id IS NULL
    AND EXISTS (SELECT 1 FROM bank_statement_lines o
                WHERE o.account_id = l.account_id AND o.fingerprint = l.fingerprint
                  AND o.transfer_id IS NOT NULL AND o.id <> l.id);
DELETE FROM bank_statement_imports i
  WHERE NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.import_id = i.id);

ALTER TABLE bank_statement_lines ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE bank_statement_lines ALTER COLUMN fingerprint SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_account_fingerprint_key
  ON bank_statement_lines (account_id, fingerprint);
CREATE INDEX IF NOT EXISTS bank_statement_lines_account_date_idx ON bank_statement_lines (account_id, value_date);
CREATE INDEX IF NOT EXISTS bank_statement_lines_transfer_idx ON bank_statement_lines (transfer_id);

-- What each import found, for the history.
ALTER TABLE bank_statement_imports ADD COLUMN IF NOT EXISTS source_format text;
ALTER TABLE bank_statement_imports ADD COLUMN IF NOT EXISTS lines_in_file int;
ALTER TABLE bank_statement_imports ADD COLUMN IF NOT EXISTS lines_skipped int;
ALTER TABLE bank_statement_imports ADD COLUMN IF NOT EXISTS continuity_gap numeric;

-- How a line was explained when it pays or brings in nothing on record
-- (bank charge, tax, loan, owner money, other income, …). Replaces
-- credit_classification, which only ever covered money in.
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS classification text;
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS classification_note text;
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS classified_by uuid;
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS classified_at timestamptz;
UPDATE bank_statement_lines SET classification = credit_classification
  WHERE classification IS NULL AND credit_classification IS NOT NULL;

-- ── 3. Period close (the lock; phase 3 adds the close itself) ───────────
CREATE TABLE IF NOT EXISTS bank_period_closes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id),
  closed_through     date NOT NULL,
  statement_balance  numeric NOT NULL,
  system_balance     numeric,
  variance           numeric,
  reconciliation_id  uuid,
  note               text,
  closed_by          uuid DEFAULT auth.uid(),
  closed_at          timestamptz NOT NULL DEFAULT now(),
  reopened_by        uuid,
  reopened_at        timestamptz,
  reopen_reason      text
);
CREATE INDEX IF NOT EXISTS bank_period_closes_account_idx ON bank_period_closes (account_id, closed_through);
ALTER TABLE bank_period_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_period_closes_read ON bank_period_closes;
CREATE POLICY bank_period_closes_read ON bank_period_closes FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'finance', 'executive']::user_role[]));
REVOKE ALL ON bank_period_closes FROM anon;
GRANT SELECT ON bank_period_closes TO authenticated;

CREATE OR REPLACE FUNCTION bank_period_closed(p_account_id uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM bank_period_closes
                 WHERE account_id = p_account_id AND reopened_at IS NULL AND closed_through >= p_date)
$$;
REVOKE ALL ON FUNCTION bank_period_closed(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bank_period_closed(uuid, date) TO authenticated;

-- ── 4. A line's status, read from what points at it ─────────────────────
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
    WHEN b.classification IS NOT NULL THEN 'classified'
  END AS reconciled_as,
  -- What the linked records add up to, and the difference from the line.
  CASE
    WHEN lk.batch IS NOT NULL    THEN (lk.batch->>'amount')::numeric
    WHEN lk.expenses IS NOT NULL THEN (SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(lk.expenses) x)
    WHEN lk.sales IS NOT NULL    THEN (SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(lk.sales) x)
    WHEN lk.payroll IS NOT NULL  THEN (lk.payroll->>'amount')::numeric
    WHEN lk.vrf IS NOT NULL      THEN (lk.vrf->>'amount')::numeric
  END AS linked_amount
FROM base b JOIN links lk ON lk.id = b.id;
REVOKE ALL ON v_bank_line_status FROM PUBLIC, anon;
GRANT SELECT ON v_bank_line_status TO authenticated;

-- The per-account summary the Payments dashboard reads, now from the
-- derived status (same columns as before).
CREATE OR REPLACE VIEW v_account_statement_summary WITH (security_invoker = true) AS
SELECT a.id AS account_id,
  (SELECT max(i.committed_at) FROM bank_statement_imports i WHERE i.account_id = a.id) AS last_import_at,
  count(s.line_id) AS committed_lines,
  count(s.line_id) FILTER (WHERE s.reconciled_as IS NULL) AS unmatched_lines,
  count(s.line_id) FILTER (WHERE s.reconciled_as IS NOT NULL) AS matched_lines
FROM accounts a
LEFT JOIN v_bank_line_status s ON s.account_id = a.id
GROUP BY a.id;

-- Keep the old column honest for anything still reading it.
UPDATE bank_statement_lines l SET match_status = CASE
    WHEN s.reconciled_as IN ('expense', 'batch') THEN 'matched_expense'
    WHEN s.reconciled_as = 'sale' THEN 'matched_sale'
    WHEN s.reconciled_as IS NOT NULL THEN 'manual'
    ELSE 'unmatched' END
  FROM v_bank_line_status s WHERE s.line_id = l.id;

-- ── 5. Exact-reference matching, for one import or every open line ──────
-- A line whose reference is an expense's or a sale's bank reference is that
-- payment. Only lines nothing points at yet are considered, so a line is
-- never compared with its own bank transaction.
CREATE OR REPLACE FUNCTION auto_reconcile_bank_lines(p_import_id uuid DEFAULT NULL, p_account_id uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_expense uuid; v_batch uuid; v_sale uuid; v_done int := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  FOR r IN
    SELECT s.* FROM v_bank_line_status s
    WHERE s.reconciled_as IS NULL AND s.transfer_id IS NOT NULL AND s.reference_code IS NOT NULL
      AND (p_import_id IS NULL OR s.import_id = p_import_id)
      AND (p_account_id IS NULL OR s.account_id = p_account_id)
      AND NOT bank_period_closed(s.account_id, s.value_date)
  LOOP
    v_expense := NULL; v_batch := NULL; v_sale := NULL;
    IF r.direction = 'debit' THEN
      SELECT e.id, x.batch_payment_id INTO v_expense, v_batch FROM expenses e
        LEFT JOIN batch_payment_expenses x ON x.expense_id = e.id
        WHERE e.bank_ref = r.reference_code AND e.transfer_id IS NULL LIMIT 1;
      IF v_batch IS NOT NULL THEN
        PERFORM match_batch_to_transfer(v_batch, r.transfer_id); v_done := v_done + 1;
      ELSIF v_expense IS NOT NULL THEN
        PERFORM match_expense_to_transfer(v_expense, r.transfer_id); v_done := v_done + 1;
      END IF;
    ELSE
      SELECT id INTO v_sale FROM sales WHERE bank_ref = r.reference_code AND transfer_id IS NULL LIMIT 1;
      IF v_sale IS NOT NULL THEN
        PERFORM match_sale_to_transfer(v_sale, r.transfer_id); v_done := v_done + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN v_done;
END; $$;
REVOKE ALL ON FUNCTION auto_reconcile_bank_lines(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auto_reconcile_bank_lines(uuid, uuid) TO authenticated;

-- ── 6. Import in one step ───────────────────────────────────────────────
-- p_lines: [{value_date, post_date, transaction_type, narration, debit,
--            credit, balance, reference}], in statement order.
CREATE OR REPLACE FUNCTION import_bank_statement(
  p_account_id uuid, p_file_name text, p_source_format text,
  p_starting_balance numeric, p_ending_balance numeric, p_lines jsonb,
  p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int; v_new int;
  f_ord int; f_date date; f_debit numeric; f_credit numeric; f_bal numeric;
  e_ord int; e_date date; e_bal numeric;
  v_prev_bal numeric; v_prev_date date; n_bal numeric; n_debit numeric; n_credit numeric;
  v_gap_before numeric; v_gap_after numeric; v_import uuid; v_matched int := 0;
  v_closed_hit int; r record; v_transfer uuid; v_no int := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can import a bank statement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id) THEN RAISE EXCEPTION 'Account not found'; END IF;

  DROP TABLE IF EXISTS _stmt;
  CREATE TEMP TABLE _stmt ON COMMIT DROP AS
  SELECT ord::int AS ord,
    (x->>'value_date')::date AS value_date,
    COALESCE((x->>'post_date')::date, (x->>'value_date')::date) AS post_date,
    NULLIF(btrim(x->>'transaction_type'), '') AS transaction_type,
    NULLIF(btrim(x->>'narration'), '') AS narration,
    NULLIF((x->>'debit')::numeric, 0) AS debit_amount,
    NULLIF((x->>'credit')::numeric, 0) AS credit_amount,
    (x->>'balance')::numeric AS running_balance,
    NULLIF(btrim(x->>'reference'), '') AS reference,
    NULLIF(btrim(split_part(COALESCE(x->>'reference', ''), E'\\', 1)), '') AS reference_code,
    NULL::text AS fingerprint, false AS is_new
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, ord);

  IF EXISTS (SELECT 1 FROM _stmt WHERE value_date IS NULL) THEN RAISE EXCEPTION 'Every line needs a date'; END IF;
  IF EXISTS (SELECT 1 FROM _stmt WHERE debit_amount IS NULL AND credit_amount IS NULL) THEN
    RAISE EXCEPTION 'Line % has neither a debit nor a credit', (SELECT min(ord) FROM _stmt WHERE debit_amount IS NULL AND credit_amount IS NULL);
  END IF;

  UPDATE _stmt SET fingerprint = bank_line_fingerprint(value_date, debit_amount, credit_amount, running_balance, reference_code, narration);
  -- New = not already on this account, and the first of any repeats in the file.
  UPDATE _stmt s SET is_new = true
  WHERE NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.account_id = p_account_id AND l.fingerprint = s.fingerprint)
    AND s.ord = (SELECT min(o.ord) FROM _stmt o WHERE o.fingerprint = s.fingerprint);

  SELECT count(*), count(*) FILTER (WHERE is_new) INTO v_total, v_new FROM _stmt;
  SELECT ord, value_date, debit_amount, credit_amount, running_balance INTO f_ord, f_date, f_debit, f_credit, f_bal
    FROM _stmt WHERE is_new ORDER BY ord LIMIT 1;
  SELECT ord, value_date, running_balance INTO e_ord, e_date, e_bal
    FROM _stmt WHERE is_new ORDER BY ord DESC LIMIT 1;

  -- Does it join what is already there? The balance before the first new
  -- line should be the balance after the last line already recorded before
  -- it; the balance after the last new line should be what the next
  -- recorded line started from.
  IF f_ord IS NOT NULL AND f_bal IS NOT NULL THEN
    SELECT l.running_balance, l.value_date INTO v_prev_bal, v_prev_date FROM bank_statement_lines l
      WHERE l.account_id = p_account_id AND l.value_date <= f_date AND l.running_balance IS NOT NULL
      ORDER BY l.value_date DESC, l.created_at DESC, l.line_no DESC LIMIT 1;
    IF v_prev_bal IS NOT NULL THEN
      v_gap_before := (f_bal + COALESCE(f_debit, 0) - COALESCE(f_credit, 0)) - v_prev_bal;
    END IF;
  END IF;
  IF e_ord IS NOT NULL AND e_bal IS NOT NULL THEN
    SELECT l.running_balance, l.debit_amount, l.credit_amount INTO n_bal, n_debit, n_credit FROM bank_statement_lines l
      WHERE l.account_id = p_account_id AND l.value_date >= e_date AND l.running_balance IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM _stmt s WHERE s.fingerprint = l.fingerprint)
      ORDER BY l.value_date, l.created_at, l.line_no LIMIT 1;
    IF n_bal IS NOT NULL THEN
      v_gap_after := (n_bal + COALESCE(n_debit, 0) - COALESCE(n_credit, 0)) - e_bal;
    END IF;
  END IF;

  SELECT count(*) INTO v_closed_hit FROM _stmt WHERE is_new AND bank_period_closed(p_account_id, value_date);

  IF p_dry_run OR v_new = 0 THEN
    RETURN jsonb_build_object('dry_run', p_dry_run, 'total', v_total, 'new', v_new, 'already_imported', v_total - v_new,
      'first_new_date', f_date, 'last_new_date', e_date,
      'gap_before', round(v_gap_before, 2), 'gap_after', round(v_gap_after, 2),
      'previous_balance', v_prev_bal, 'previous_date', v_prev_date,
      'in_closed_period', v_closed_hit, 'import_id', NULL);
  END IF;
  IF v_closed_hit > 0 THEN
    RAISE EXCEPTION '% new line(s) fall in a period already closed for this account — reopen it first', v_closed_hit;
  END IF;

  INSERT INTO bank_statement_imports (account_id, file_name, period_start, period_end, starting_balance, ending_balance,
    status, uploaded_by, committed_at, source_format, lines_in_file, lines_skipped, continuity_gap)
  SELECT p_account_id, p_file_name, min(value_date), max(value_date), p_starting_balance, p_ending_balance,
    'committed', auth.uid(), now(), p_source_format, v_total, v_total - v_new, COALESCE(v_gap_before, v_gap_after)
  FROM _stmt
  RETURNING id INTO v_import;

  FOR r IN SELECT * FROM _stmt WHERE is_new ORDER BY ord LOOP
    v_no := v_no + 1;
    INSERT INTO transfers (transfer_id_code, date, from_account_id, to_account_id, amount, notes)
    VALUES (r.reference_code, r.value_date,
      CASE WHEN r.debit_amount IS NOT NULL THEN p_account_id END,
      CASE WHEN r.debit_amount IS NULL THEN p_account_id END,
      COALESCE(r.debit_amount, r.credit_amount),
      COALESCE(r.narration, '') || ' (ref: ' || COALESCE(r.reference, '') || ')')
    RETURNING id INTO v_transfer;
    INSERT INTO bank_statement_lines (import_id, account_id, line_no, value_date, post_date, transaction_type, narration,
      debit_amount, credit_amount, running_balance, reference, reference_code, fingerprint, transfer_id, match_status)
    VALUES (v_import, p_account_id, v_no, r.value_date, r.post_date, r.transaction_type, r.narration,
      r.debit_amount, r.credit_amount, r.running_balance, r.reference, r.reference_code, r.fingerprint, v_transfer, 'unmatched');
  END LOOP;

  v_matched := auto_reconcile_bank_lines(v_import, NULL);

  RETURN jsonb_build_object('dry_run', false, 'total', v_total, 'new', v_new, 'already_imported', v_total - v_new,
    'first_new_date', f_date, 'last_new_date', e_date,
    'gap_before', round(v_gap_before, 2), 'gap_after', round(v_gap_after, 2),
    'previous_balance', v_prev_bal, 'previous_date', v_prev_date,
    'in_closed_period', 0, 'import_id', v_import, 'auto_reconciled', v_matched);
END; $$;
REVOKE ALL ON FUNCTION import_bank_statement(uuid, text, text, numeric, numeric, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION import_bank_statement(uuid, text, text, numeric, numeric, jsonb, boolean) TO authenticated;

-- ── 7. Retire the two-step import and the self-duplicating rematch ──────
DROP FUNCTION IF EXISTS commit_statement_import(uuid);
DROP FUNCTION IF EXISTS auto_match_statement_import(uuid);
DROP FUNCTION IF EXISTS rematch_committed_statement_lines(uuid);
