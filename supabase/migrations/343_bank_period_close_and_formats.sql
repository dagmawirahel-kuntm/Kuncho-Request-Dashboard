-- 343 — Bank statements, phase 3: closing a period, other banks' formats,
--       and the other side of internal transfers
--
-- 1. close_bank_period(): when every line up to a date is reconciled, the
--    period is closed at the statement's balance on that date. The close
--    goes through reconcile_account(), so the account's balance is anchored
--    to the bank's figure from then on and the difference the app had is
--    recorded. reopen_bank_period() (admin) lifts it.
-- 2. The lock: once a period is closed, its lines, their bank
--    transactions, and which payment each one settles can't be changed —
--    not from the reconciliation screen and not from anywhere else.
-- 3. bank_statement_formats: the column layout of an account's Excel or
--    PDF statements, saved the first time finance maps it, so the next file
--    from that bank reads itself.
-- 4. Internal transfers across two statements: when a CBE credit was paired
--    with "transfer from Tsedey Bank" before Tsedey's statement was in, a
--    counterpart transaction stood in on Tsedey. When that statement is
--    imported, its matching debit takes the counterpart's place instead of
--    adding a second transaction, and is marked as the same transfer.
-- 5. v_bank_account_overview: per account, how far its statements run,
--    where they close, what's still open and where it was last closed.

SET search_path TO public;

-- ── 1. Close and reopen ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION close_bank_period(p_account_id uuid, p_through date, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_open int; v_balance numeric; v_recon uuid; r bank_reconciliations%ROWTYPE; v_close uuid;
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
  SELECT running_balance INTO v_balance FROM bank_statement_lines
    WHERE account_id = p_account_id AND value_date <= p_through AND running_balance IS NOT NULL
    ORDER BY value_date DESC, created_at DESC, line_no DESC LIMIT 1;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'No statement line with a balance on or before % — import the statement first', p_through;
  END IF;

  -- Anchor the balance to the statement — unless the account is already
  -- anchored at or after this date (closing older history only locks it).
  IF NOT EXISTS (SELECT 1 FROM bank_balance_anchors WHERE account_id = p_account_id AND as_of_date >= p_through) THEN
    v_recon := reconcile_account(p_account_id, p_through, v_balance, NULL, 'Bank statement close', p_note);
    SELECT * INTO r FROM bank_reconciliations WHERE id = v_recon;
  END IF;
  INSERT INTO bank_period_closes (account_id, closed_through, statement_balance, system_balance, variance, reconciliation_id, note)
  VALUES (p_account_id, p_through, v_balance, r.system_balance_at_date, r.variance, v_recon, NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_close;
  RETURN v_close;
END; $$;
REVOKE ALL ON FUNCTION close_bank_period(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_bank_period(uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION reopen_bank_period(p_close_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only an admin can reopen a closed bank period'; END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why the period is being reopened'; END IF;
  UPDATE bank_period_closes SET reopened_at = now(), reopened_by = auth.uid(), reopen_reason = btrim(p_reason)
    WHERE id = p_close_id AND reopened_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That close is not open to reopen'; END IF;
END; $$;
REVOKE ALL ON FUNCTION reopen_bank_period(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reopen_bank_period(uuid, text) TO authenticated;

-- ── 2. The lock ─────────────────────────────────────────────────────────
-- A bank transaction is in a closed period when its statement line is.
CREATE OR REPLACE FUNCTION transfer_in_closed_period(p_transfer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_transfer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bank_statement_lines l
    WHERE l.transfer_id = p_transfer_id AND bank_period_closed(l.account_id, l.value_date))
$$;

CREATE OR REPLACE FUNCTION guard_closed_bank_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF bank_period_closed(OLD.account_id, OLD.value_date) THEN
    RAISE EXCEPTION 'This bank line (%) is in a closed period — reopen it to change it', OLD.value_date;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_closed_bank_line ON bank_statement_lines;
CREATE TRIGGER trg_guard_closed_bank_line BEFORE UPDATE OR DELETE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_line();

CREATE OR REPLACE FUNCTION guard_closed_bank_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF transfer_in_closed_period(OLD.id) THEN
    RAISE EXCEPTION 'This bank transaction is in a closed period — reopen it to change it';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_closed_bank_transfer ON transfers;
CREATE TRIGGER trg_guard_closed_bank_transfer BEFORE UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_transfer();

-- What a closed line settles can't be moved off it (or onto it).
CREATE OR REPLACE FUNCTION guard_closed_bank_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old uuid; v_new uuid;
BEGIN
  IF TG_TABLE_NAME = 'vendor_receipt_facilitation' THEN
    v_old := OLD.out_transfer_id; v_new := NEW.out_transfer_id;
  ELSE
    v_old := OLD.transfer_id; v_new := NEW.transfer_id;
  END IF;
  IF v_old IS DISTINCT FROM v_new AND (transfer_in_closed_period(v_old) OR transfer_in_closed_period(v_new)) THEN
    RAISE EXCEPTION 'That bank line is in a closed period — reopen it to change what it pays';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_closed_bank_match ON expenses;
CREATE TRIGGER trg_guard_closed_bank_match BEFORE UPDATE OF transfer_id ON expenses
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_match();
DROP TRIGGER IF EXISTS trg_guard_closed_bank_match ON sales;
CREATE TRIGGER trg_guard_closed_bank_match BEFORE UPDATE OF transfer_id ON sales
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_match();
DROP TRIGGER IF EXISTS trg_guard_closed_bank_match ON batch_payments;
CREATE TRIGGER trg_guard_closed_bank_match BEFORE UPDATE OF transfer_id ON batch_payments
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_match();
DROP TRIGGER IF EXISTS trg_guard_closed_bank_match ON payroll;
CREATE TRIGGER trg_guard_closed_bank_match BEFORE UPDATE OF transfer_id ON payroll
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_match();
DROP TRIGGER IF EXISTS trg_guard_closed_bank_match ON vendor_receipt_facilitation;
CREATE TRIGGER trg_guard_closed_bank_match BEFORE UPDATE OF out_transfer_id ON vendor_receipt_facilitation
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_match();

-- ── 3. Saved statement layouts ──────────────────────────────────────────
-- mapping: {"header_row": n, "columns": {"date": i, "narration": i,
--   "debit": i, "credit": i, "amount": i, "balance": i, "reference": i, …},
--   "date_format": "…"}; header_signature identifies the layout.
CREATE TABLE IF NOT EXISTS bank_statement_formats (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_format    text NOT NULL CHECK (source_format IN ('csv', 'xlsx', 'pdf')),
  header_signature text NOT NULL,
  mapping          jsonb NOT NULL,
  updated_by       uuid DEFAULT auth.uid(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, source_format, header_signature)
);
ALTER TABLE bank_statement_formats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_statement_formats_rw ON bank_statement_formats;
CREATE POLICY bank_statement_formats_rw ON bank_statement_formats FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]));
REVOKE ALL ON bank_statement_formats FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statement_formats TO authenticated;

-- ── 4. Import: statement transactions, and counterparts taken over ──────
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
  v_gap_before numeric; v_gap_after numeric; v_import uuid; v_matched int := 0; v_paired int := 0;
  v_closed_hit int; r record; v_transfer uuid; v_counter uuid; v_no int := 0; v_line uuid;
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
  UPDATE _stmt s SET is_new = true
  WHERE NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.account_id = p_account_id AND l.fingerprint = s.fingerprint)
    AND s.ord = (SELECT min(o.ord) FROM _stmt o WHERE o.fingerprint = s.fingerprint);

  SELECT count(*), count(*) FILTER (WHERE is_new) INTO v_total, v_new FROM _stmt;
  SELECT ord, value_date, debit_amount, credit_amount, running_balance INTO f_ord, f_date, f_debit, f_credit, f_bal
    FROM _stmt WHERE is_new ORDER BY ord LIMIT 1;
  SELECT ord, value_date, running_balance INTO e_ord, e_date, e_bal
    FROM _stmt WHERE is_new ORDER BY ord DESC LIMIT 1;

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
    -- The other side of a transfer already recorded from another account's
    -- statement: this line is that transaction.
    SELECT t.id INTO v_counter FROM transfers t
      WHERE t.source = 'counterpart'
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines x WHERE x.transfer_id = t.id)
        AND CASE WHEN r.debit_amount IS NOT NULL THEN t.from_account_id ELSE t.to_account_id END = p_account_id
        AND abs(t.amount - COALESCE(r.debit_amount, r.credit_amount)) <= 0.01
        AND t.date BETWEEN r.value_date - 5 AND r.value_date + 5
      ORDER BY abs(t.date - r.value_date) LIMIT 1;
    IF v_counter IS NOT NULL THEN
      UPDATE transfers SET source = 'statement', date = r.value_date, transfer_id_code = r.reference_code,
        notes = COALESCE(r.narration, '') || ' (ref: ' || COALESCE(r.reference, '') || ')'
      WHERE id = v_counter;
      v_transfer := v_counter;
    ELSE
      INSERT INTO transfers (transfer_id_code, date, from_account_id, to_account_id, amount, notes, source)
      VALUES (r.reference_code, r.value_date,
        CASE WHEN r.debit_amount IS NOT NULL THEN p_account_id END,
        CASE WHEN r.debit_amount IS NULL THEN p_account_id END,
        COALESCE(r.debit_amount, r.credit_amount),
        COALESCE(r.narration, '') || ' (ref: ' || COALESCE(r.reference, '') || ')', 'statement')
      RETURNING id INTO v_transfer;
    END IF;
    INSERT INTO bank_statement_lines (import_id, account_id, line_no, value_date, post_date, transaction_type, narration,
      debit_amount, credit_amount, running_balance, reference, reference_code, fingerprint, transfer_id, match_status,
      classification, classification_note, classified_at)
    VALUES (v_import, p_account_id, v_no, r.value_date, r.post_date, r.transaction_type, r.narration,
      r.debit_amount, r.credit_amount, r.running_balance, r.reference, r.reference_code, r.fingerprint, v_transfer,
      CASE WHEN v_counter IS NOT NULL THEN 'manual' ELSE 'unmatched' END,
      CASE WHEN v_counter IS NOT NULL THEN 'internal_transfer' END,
      CASE WHEN v_counter IS NOT NULL THEN 'Other side of a transfer already recorded' END,
      CASE WHEN v_counter IS NOT NULL THEN now() END)
    RETURNING id INTO v_line;
    IF v_counter IS NOT NULL THEN v_paired := v_paired + 1; END IF;
    v_counter := NULL;
  END LOOP;

  v_matched := auto_reconcile_bank_lines(v_import, NULL);

  RETURN jsonb_build_object('dry_run', false, 'total', v_total, 'new', v_new, 'already_imported', v_total - v_new,
    'first_new_date', f_date, 'last_new_date', e_date,
    'gap_before', round(v_gap_before, 2), 'gap_after', round(v_gap_after, 2),
    'previous_balance', v_prev_bal, 'previous_date', v_prev_date,
    'in_closed_period', 0, 'import_id', v_import, 'auto_reconciled', v_matched + v_paired);
END; $$;
REVOKE ALL ON FUNCTION import_bank_statement(uuid, text, text, numeric, numeric, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION import_bank_statement(uuid, text, text, numeric, numeric, jsonb, boolean) TO authenticated;

-- ── 5. Per-account overview ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_bank_account_overview WITH (security_invoker = true) AS
WITH lines AS (
  SELECT account_id, min(value_date) AS first_date, max(value_date) AS last_date, count(*) AS line_count,
    count(*) FILTER (WHERE reconciled_as IS NULL) AS open_count,
    min(value_date) FILTER (WHERE reconciled_as IS NULL) AS oldest_open
  FROM v_bank_line_status GROUP BY account_id
), last_line AS (
  SELECT DISTINCT ON (account_id) account_id, running_balance AS statement_balance, value_date AS statement_date
  FROM bank_statement_lines WHERE running_balance IS NOT NULL
  ORDER BY account_id, value_date DESC, created_at DESC, line_no DESC
), closes AS (
  SELECT DISTINCT ON (account_id) account_id, id AS close_id, closed_through, statement_balance AS closed_balance,
    variance AS close_variance, closed_at
  FROM bank_period_closes WHERE reopened_at IS NULL
  ORDER BY account_id, closed_through DESC
)
SELECT a.id AS account_id, a.account_name, a.status, a.type,
  l.first_date, l.last_date, COALESCE(l.line_count, 0) AS line_count, COALESCE(l.open_count, 0) AS open_count, l.oldest_open,
  ll.statement_balance, ll.statement_date,
  c.close_id, c.closed_through, c.closed_balance, c.close_variance, c.closed_at,
  (SELECT max(i.committed_at) FROM bank_statement_imports i WHERE i.account_id = a.id) AS last_import_at
FROM accounts a
LEFT JOIN lines l ON l.account_id = a.id
LEFT JOIN last_line ll ON ll.account_id = a.id
LEFT JOIN closes c ON c.account_id = a.id;
REVOKE ALL ON v_bank_account_overview FROM PUBLIC, anon;
GRANT SELECT ON v_bank_account_overview TO authenticated;

-- ── 6. Transfers entered by hand ────────────────────────────────────────
-- The Transfers form wrote one row with both accounts. Once either bank's
-- statement was imported its line added a second transaction for the same
-- money. A hand-entered transfer is now its two sides, each standing in
-- until that bank's statement line takes its place (as in section 4), and
-- one ledger entry for the move.
CREATE OR REPLACE FUNCTION record_internal_transfer(p_from_account_id uuid, p_to_account_id uuid,
  p_amount numeric, p_date date, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out uuid; v_in uuid; v_from_coa uuid; v_to_coa uuid; v_entry uuid; v_label text;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can record a transfer';
  END IF;
  IF p_from_account_id IS NULL OR p_to_account_id IS NULL THEN RAISE EXCEPTION 'Both accounts are required'; END IF;
  IF p_from_account_id = p_to_account_id THEN RAISE EXCEPTION 'From and To accounts must be different'; END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Amount must be greater than 0'; END IF;
  IF bank_period_closed(p_from_account_id, p_date) OR bank_period_closed(p_to_account_id, p_date) THEN
    RAISE EXCEPTION 'That date is in a closed period for one of the accounts';
  END IF;
  v_label := (SELECT account_name FROM accounts WHERE id = p_from_account_id) || ' → ' || (SELECT account_name FROM accounts WHERE id = p_to_account_id);
  INSERT INTO transfers (date, from_account_id, amount, notes, source)
  VALUES (p_date, p_from_account_id, p_amount, 'Transfer ' || v_label || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''), 'counterpart')
  RETURNING id INTO v_out;
  INSERT INTO transfers (date, to_account_id, amount, notes, source, counterpart_id)
  VALUES (p_date, p_to_account_id, p_amount, 'Transfer ' || v_label || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''), 'counterpart', v_out)
  RETURNING id INTO v_in;
  UPDATE transfers SET counterpart_id = v_in WHERE id = v_out;

  SELECT id INTO v_from_coa FROM chart_of_accounts WHERE linked_account_id = p_from_account_id;
  SELECT id INTO v_to_coa FROM chart_of_accounts WHERE linked_account_id = p_to_account_id;
  IF v_from_coa IS NOT NULL AND v_to_coa IS NOT NULL THEN
    INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
    VALUES (p_date, 'operational', 'transfers', v_out, 'Transfer ' || v_label || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''), auth.uid())
    RETURNING id INTO v_entry;
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry, v_to_coa, p_amount, 0, 'Transfer in'), (v_entry, v_from_coa, 0, p_amount, 'Transfer out');
  END IF;
  RETURN v_out;
END; $$;
REVOKE ALL ON FUNCTION record_internal_transfer(uuid, uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_internal_transfer(uuid, uuid, numeric, date, text) TO authenticated;

-- Undoing an internal pairing also removes a hand-entered transfer's entry.
CREATE OR REPLACE FUNCTION unclassify_bank_line(p_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status; v_other_tr uuid; v_other_line uuid;
BEGIN
  l := bank_line_guard(p_line_id, true);
  IF l.classification IS NULL THEN RAISE EXCEPTION 'This line is not explained — nothing to undo'; END IF;
  IF l.classification = 'internal_transfer' THEN
    SELECT counterpart_id INTO v_other_tr FROM transfers WHERE id = l.transfer_id;
    SELECT id INTO v_other_line FROM bank_statement_lines WHERE transfer_id = v_other_tr;
    IF v_other_line IS NOT NULL THEN
      IF bank_period_closed((SELECT account_id FROM bank_statement_lines WHERE id = v_other_line),
                            (SELECT value_date FROM bank_statement_lines WHERE id = v_other_line)) THEN
        RAISE EXCEPTION 'The other side of this transfer is in a closed period';
      END IF;
      DELETE FROM journal_entries WHERE source_table = 'bank_statement_lines' AND source_id = v_other_line;
      UPDATE bank_statement_lines SET classification = NULL, classification_note = NULL, classified_by = NULL,
        classified_at = NULL, match_status = 'unmatched' WHERE id = v_other_line;
    END IF;
    DELETE FROM journal_entries WHERE source_table = 'transfers' AND source_id IN (l.transfer_id, v_other_tr);
    UPDATE transfers SET counterpart_id = NULL WHERE id IN (l.transfer_id, v_other_tr);
    DELETE FROM transfers t WHERE t.id = v_other_tr AND t.source = 'counterpart'
      AND NOT EXISTS (SELECT 1 FROM bank_statement_lines x WHERE x.transfer_id = t.id);
  END IF;
  DELETE FROM journal_entries WHERE source_table = 'bank_statement_lines' AND source_id = p_line_id;
  UPDATE bank_statement_lines SET classification = NULL, classification_note = NULL, classified_by = NULL,
    classified_at = NULL, credit_classification = NULL, match_status = 'unmatched' WHERE id = p_line_id;
END; $$;
REVOKE ALL ON FUNCTION unclassify_bank_line(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION unclassify_bank_line(uuid) TO authenticated;
