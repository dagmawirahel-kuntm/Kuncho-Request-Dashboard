-- 350 — Bank ↔ ledger tie-out and the month-end checklist
--
-- Three balances describe one bank account: what the bank says (the last
-- imported statement), what the app says (v_account_balances), and what the
-- general ledger says (its Cash at Bank account). The bank reconciliation
-- ties the first two together line by line; this ties the ledger in.
--
--   v_cash_ledger_lines   every ledger line on a bank's cash account, and
--                         whether a statement line stands behind it
--   v_bank_line_ledger    every statement line, and whether the ledger has
--                         the entry that settles it
--   v_account_ledger_tieout
--                         per account, at the statement date:
--                           bank − ledger = lines the ledger doesn't have
--                                         − ledger entries the bank doesn't have
--                                         + what's left unexplained
--                         The unexplained part is where amounts differ
--                         (an entry for the gross when the bank paid the net,
--                         say) or an entry landed on the wrong bank.
--   month_end_checklist(from, to)
--                         what is left before the month can be signed off,
--                         account by account. Months are Ethiopian; the page
--                         passes the month's first and last day.

SET search_path TO public;

-- ── 1. Ledger lines on cash accounts ───────────────────────────────────
CREATE OR REPLACE VIEW v_cash_ledger_lines WITH (security_invoker = true) AS
SELECT jl.id AS journal_line_id, je.id AS journal_entry_id,
  c.linked_account_id AS account_id, c.id AS coa_id, c.account_code,
  je.entry_date, je.entry_type, je.source_table, je.source_id, je.description,
  jl.debit - jl.credit AS amount,
  CASE
    WHEN je.source_table = 'bank_statement_lines' THEN true
    WHEN je.source_table = 'transfers' THEN EXISTS (
      SELECT 1 FROM bank_statement_lines bl
      WHERE bl.account_id = c.linked_account_id
        AND bl.transfer_id IN (je.source_id, (SELECT t.counterpart_id FROM transfers t WHERE t.id = je.source_id)))
    -- An expense's own entry and its later adjustments (PO VAT, WHT reclass).
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
REVOKE ALL ON v_cash_ledger_lines FROM PUBLIC, anon;
GRANT SELECT ON v_cash_ledger_lines TO authenticated;

-- ── 2. Statement lines and the ledger ──────────────────────────────────
CREATE OR REPLACE VIEW v_bank_line_ledger WITH (security_invoker = true) AS
WITH x AS (
  SELECT s.line_id, s.account_id, s.value_date, s.direction, s.amount, s.reconciled_as, s.narration, s.reference,
    CASE WHEN s.direction = 'credit' THEN s.amount ELSE -s.amount END AS signed_amount,
    CASE s.reconciled_as
      WHEN 'expense' THEN NOT EXISTS (
        SELECT 1 FROM expenses e WHERE e.transfer_id = s.transfer_id
          AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expenses' AND je.source_id = e.id))
      WHEN 'batch' THEN NOT EXISTS (
        SELECT 1 FROM batch_payments bp JOIN batch_payment_expenses bpe ON bpe.batch_payment_id = bp.id
        WHERE bp.transfer_id = s.transfer_id
          AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expenses' AND je.source_id = bpe.expense_id))
      WHEN 'sale' THEN NOT EXISTS (
        SELECT 1 FROM sales sa WHERE sa.transfer_id = s.transfer_id
          AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'sales' AND je.source_id = sa.id))
      WHEN 'payroll' THEN EXISTS (
        SELECT 1 FROM journal_entries je WHERE je.source_table = 'payroll' AND je.source_id = (s.payroll ->> 'id')::uuid)
      WHEN 'vrf' THEN EXISTS (
        SELECT 1 FROM journal_entries je WHERE je.source_table = 'vendor_receipt_facilitation' AND je.source_id = (s.vrf ->> 'id')::uuid)
      WHEN 'vrf_return' THEN EXISTS (
        SELECT 1 FROM journal_entries je JOIN vrf_returns r ON r.vrf_id = je.source_id
        WHERE je.source_table = 'vendor_receipt_facilitation' AND r.transfer_id = s.transfer_id)
      WHEN 'classified' THEN EXISTS (
        SELECT 1 FROM journal_entries je WHERE je.source_table = 'bank_statement_lines' AND je.source_id = s.line_id)
      WHEN 'internal' THEN EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE (je.source_table = 'bank_statement_lines' AND je.source_id IN (s.line_id, (s.internal ->> 'line_id')::uuid))
           OR (je.source_table = 'transfers' AND je.source_id IN (s.transfer_id, (SELECT t.counterpart_id FROM transfers t WHERE t.id = s.transfer_id))))
      ELSE false
    END AS in_ledger
  FROM v_bank_line_status s
)
SELECT x.*,
  CASE
    WHEN x.in_ledger THEN NULL
    WHEN x.reconciled_as IS NULL THEN 'Not explained yet'
    WHEN x.reconciled_as = 'opening_balance' THEN 'Opening balance'
    WHEN x.reconciled_as = 'payroll' THEN 'Payroll not posted'
    WHEN x.reconciled_as IN ('expense', 'batch') THEN 'Expense not posted'
    WHEN x.reconciled_as = 'sale' THEN 'Invoice not posted'
    WHEN x.reconciled_as IN ('vrf', 'vrf_return') THEN 'Vendor request not posted'
    ELSE 'No ledger entry'
  END AS ledger_gap
FROM x;
REVOKE ALL ON v_bank_line_ledger FROM PUBLIC, anon;
GRANT SELECT ON v_bank_line_ledger TO authenticated;

-- ── 3. Tie-out per account, at the statement date ──────────────────────
CREATE OR REPLACE VIEW v_account_ledger_tieout WITH (security_invoker = true) AS
WITH acct AS (
  SELECT a.id AS account_id, a.account_name, a.role, c.id AS coa_id, c.account_code,
    ov.statement_date, ov.statement_balance, ov.first_date
  FROM accounts a
  JOIN chart_of_accounts c ON c.linked_account_id = a.id
  LEFT JOIN v_bank_account_overview ov ON ov.account_id = a.id
), gl AS (
  SELECT l.account_id,
    sum(l.amount) AS ledger_balance,
    sum(l.amount) FILTER (WHERE l.entry_date <= a.statement_date) AS ledger_at_statement,
    sum(l.amount) FILTER (WHERE NOT l.on_bank AND l.entry_date <= a.statement_date AND l.entry_date < a.first_date) AS before_statements,
    sum(l.amount) FILTER (WHERE NOT l.on_bank AND l.entry_date <= a.statement_date AND l.entry_date >= a.first_date) AS not_on_bank,
    count(*) FILTER (WHERE NOT l.on_bank AND l.entry_date <= a.statement_date AND l.entry_date >= a.first_date) AS not_on_bank_count
  FROM v_cash_ledger_lines l JOIN acct a ON a.account_id = l.account_id
  GROUP BY l.account_id
), bl AS (
  SELECT account_id,
    sum(signed_amount) FILTER (WHERE reconciled_as IS DISTINCT FROM 'opening_balance') AS lines_net,
    sum(signed_amount) FILTER (WHERE NOT in_ledger AND reconciled_as IS NULL) AS open_net,
    count(*) FILTER (WHERE NOT in_ledger AND reconciled_as IS NULL) AS open_count,
    sum(signed_amount) FILTER (WHERE NOT in_ledger AND reconciled_as IS NOT NULL AND reconciled_as <> 'opening_balance') AS unposted_net,
    count(*) FILTER (WHERE NOT in_ledger AND reconciled_as IS NOT NULL AND reconciled_as <> 'opening_balance') AS unposted_count
  FROM v_bank_line_ledger GROUP BY account_id
), t AS (
  SELECT a.*, COALESCE(g.ledger_balance, 0) AS ledger_balance,
    CASE WHEN a.statement_date IS NOT NULL THEN COALESCE(g.ledger_at_statement, 0) END AS ledger_at_statement,
    -- The balance the statements started from: not a ledger entry.
    CASE WHEN a.statement_date IS NOT NULL THEN a.statement_balance - COALESCE(b.lines_net, 0) END AS opening_net,
    COALESCE(b.open_net, 0) AS open_net, COALESCE(b.open_count, 0) AS open_count,
    COALESCE(b.unposted_net, 0) AS unposted_net, COALESCE(b.unposted_count, 0) AS unposted_count,
    COALESCE(g.before_statements, 0) AS before_statements,
    COALESCE(g.not_on_bank, 0) AS not_on_bank, COALESCE(g.not_on_bank_count, 0) AS not_on_bank_count
  FROM acct a LEFT JOIN gl g ON g.account_id = a.account_id LEFT JOIN bl b ON b.account_id = a.account_id
)
SELECT t.account_id, t.account_name, t.role, t.coa_id, t.account_code, t.statement_date, t.statement_balance,
  t.ledger_balance, t.ledger_at_statement,
  round(t.statement_balance - t.ledger_at_statement, 2) AS difference,
  round(t.opening_net, 2) AS opening_net,
  round(t.open_net, 2) AS open_net, t.open_count,
  round(t.unposted_net, 2) AS unposted_net, t.unposted_count,
  round(t.before_statements, 2) AS before_statements,
  round(t.not_on_bank, 2) AS not_on_bank, t.not_on_bank_count,
  round((t.statement_balance - t.ledger_at_statement)
        - (t.opening_net + t.open_net + t.unposted_net)
        + (t.before_statements + t.not_on_bank), 2) AS unexplained
FROM t;
REVOKE ALL ON v_account_ledger_tieout FROM PUBLIC, anon;
GRANT SELECT ON v_account_ledger_tieout TO authenticated;

-- ── 4. Month-end checklist ─────────────────────────────────────────────
-- One row per check. state: 'ok' | 'todo' | 'warn'. account_id is null for
-- checks that aren't about one bank.
CREATE OR REPLACE FUNCTION month_end_checklist(p_from date, p_to date)
RETURNS TABLE(account_id uuid, account_name text, check_key text, state text, title text, detail text,
              amount numeric, item_count int, link text)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE a record; v_n int; v_amt numeric; v_unposted int;
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
    -- Nothing to do for an account that neither moved nor has statements.
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
      check_key := 'awaiting_bank'; title := 'Sent payments found on the bank';
      state := CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END;
      detail := CASE WHEN v_n = 0 THEN 'Every payment sent is on the statement.'
                     ELSE v_n || ' sent payment' || CASE WHEN v_n = 1 THEN ' is' ELSE 's are' END || ' not on the statement.' END;
      amount := v_amt; item_count := v_n; link := '/accounts/' || a.account_id;
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

  -- Not about one bank.
  account_id := NULL; account_name := NULL;

  SELECT count(*) INTO v_n FROM ledger_posting_failures f WHERE NOT COALESCE(f.resolved, false);
  check_key := 'posting_failures'; title := 'Ledger postings went through'; amount := NULL; item_count := v_n;
  state := CASE WHEN v_n = 0 THEN 'ok' ELSE 'todo' END;
  detail := CASE WHEN v_n = 0 THEN 'No failed postings.' ELSE v_n || ' record' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' could not be posted to the ledger.' END;
  link := '/finance/ledger';
  RETURN NEXT;

  SELECT count(*), COALESCE(sum(p.amount), 0) INTO v_n, v_amt FROM v_paid_without_bank_line p
  WHERE p.paid_on BETWEEN p_from AND p_to;
  check_key := 'paid_without_bank'; title := 'Payments marked paid have a bank line';
  state := CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END;
  detail := CASE WHEN v_n = 0 THEN 'Everything paid this month is on a statement.'
                 ELSE v_n || ' marked paid this month with no bank line.' END;
  amount := v_amt; item_count := v_n; link := '/bank-statement-import';
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION month_end_checklist(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION month_end_checklist(date, date) TO authenticated;
