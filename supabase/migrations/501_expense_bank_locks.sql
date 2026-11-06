-- 501: which bank transaction locks an expense.
--
-- Once the bank statement confirms a payment, the expense can no longer be
-- reversed, unapproved or deleted (expense_bank_match, used by
-- expense_admin_guard, guard_expense_delete and expense_reversal_preview).
-- The refusal named only a transfer code. Now:
--   · expense_bank_locks(expense) lists every statement line that settles
--     the expense: paid directly, in a batch, in parts, or through its
--     vendor request, with the bank, date, amount, reference, narration and
--     whether that line's period is closed;
--   · expense_bank_lock_index() gives the first such line for every locked
--     expense, for the expenses list;
--   · the refusal names the line: bank, date, amount and reference.

CREATE OR REPLACE FUNCTION public.expense_bank_locks(p_expense_id uuid)
RETURNS TABLE(how text, via text, line_id uuid, account_id uuid, account_name text, value_date date, amount numeric,
              reference text, narration text, period_closed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH e AS (
    SELECT x.* FROM expenses x
     WHERE x.id = p_expense_id AND get_user_role()::text IN ('admin', 'finance', 'executive')
  ), links AS (
    SELECT 1 AS ord, 'direct'::text AS how, NULL::text AS via, l.id AS line_id
      FROM e JOIN bank_statement_lines l ON l.transfer_id = e.transfer_id
    UNION ALL
    -- A line pointing at the expense: a part or batch label wins over this.
    SELECT 5, 'direct', NULL, l.id FROM e JOIN bank_statement_lines l ON l.matched_expense_id = e.id
    UNION ALL
    SELECT 2, 'batch', 'Batch ' || COALESCE(b.payment_code, 'payment'), l.id
      FROM e JOIN batch_payment_expenses x ON x.expense_id = e.id JOIN batch_payments b ON b.id = x.batch_payment_id
      JOIN bank_statement_lines l ON l.transfer_id = b.transfer_id
    UNION ALL
    SELECT 3, 'part', format('Part %s of %s', pos.part_no, pos.part_count), l.id
      FROM e JOIN expense_payments q ON q.expense_id = e.id
      CROSS JOIN LATERAL expense_part_position(q.id) pos
      JOIN bank_statement_lines l ON l.transfer_id = q.transfer_id
    UNION ALL
    SELECT 4, 'vrf', 'Vendor request ' || COALESCE(v.record_name, ''), l.id
      FROM e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id)
      JOIN bank_statement_lines l ON l.transfer_id = v.out_transfer_id
    UNION ALL
    SELECT 4, 'vrf', 'Vendor request ' || COALESCE(v.record_name, '') || ' (part)', l.id
      FROM e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id)
      JOIN vrf_payment_parts p ON p.vrf_id = v.id AND p.reversed_at IS NULL
      JOIN bank_statement_lines l ON l.transfer_id = p.transfer_id
  ), one AS (
    SELECT DISTINCT ON (line_id) * FROM links ORDER BY line_id, ord
  )
  SELECT o.how, o.via, l.id, l.account_id, a.account_name, l.value_date,
         COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount), COALESCE(l.reference_code, l.reference), l.narration,
         bank_period_closed(l.account_id, l.value_date)
    FROM one o JOIN bank_statement_lines l ON l.id = o.line_id JOIN accounts a ON a.id = l.account_id
   ORDER BY o.ord, l.value_date, l.line_no
$f$;

-- The first locking line of every locked expense (for the expenses list).
CREATE OR REPLACE FUNCTION public.expense_bank_lock_index()
RETURNS TABLE(expense_id uuid, how text, n integer, account_name text, value_date date, amount numeric, reference text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH k AS (
    SELECT e.id AS expense_id, 1 AS ord, 'direct'::text AS how, l.id AS line_id
      FROM expenses e JOIN bank_statement_lines l ON l.transfer_id = e.transfer_id
    UNION
    SELECT l.matched_expense_id, 5, 'direct', l.id FROM bank_statement_lines l WHERE l.matched_expense_id IS NOT NULL
    UNION
    SELECT x.expense_id, 2, 'batch', l.id
      FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id JOIN bank_statement_lines l ON l.transfer_id = b.transfer_id
    UNION
    SELECT q.expense_id, 3, 'part', l.id FROM expense_payments q JOIN bank_statement_lines l ON l.transfer_id = q.transfer_id
    UNION
    SELECT e.id, 4, 'vrf', l.id
      FROM expenses e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id)
      JOIN bank_statement_lines l ON l.transfer_id = v.out_transfer_id
  ), lines AS (
    SELECT expense_id, line_id, min(ord) AS ord, (array_agg(how ORDER BY ord))[1] AS how FROM k GROUP BY expense_id, line_id
  ), ranked AS (
    SELECT x.*, count(*) OVER (PARTITION BY x.expense_id) AS n,
           row_number() OVER (PARTITION BY x.expense_id ORDER BY x.ord, x.line_id) AS rn
      FROM lines x
  )
  SELECT r.expense_id, r.how, r.n::int, a.account_name, l.value_date,
         COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount), COALESCE(l.reference_code, l.reference)
    FROM ranked r JOIN bank_statement_lines l ON l.id = r.line_id JOIN accounts a ON a.id = l.account_id
   WHERE r.rn = 1 AND get_user_role()::text IN ('admin', 'finance', 'executive')
$f$;

-- The refusal names the line, not a transfer code.
CREATE OR REPLACE FUNCTION public.expense_bank_match(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH k AS (
    SELECT 1 AS ord, 'it is matched to' AS how, l.id AS line_id FROM expenses e JOIN bank_statement_lines l ON l.transfer_id = e.transfer_id WHERE e.id = p_id
    UNION ALL
    SELECT 1, 'it is matched to', l.id FROM bank_statement_lines l WHERE l.matched_expense_id = p_id
    UNION ALL
    SELECT 2, 'it was paid in batch ' || COALESCE(b.payment_code, '') || ', matched to', l.id
      FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id JOIN bank_statement_lines l ON l.transfer_id = b.transfer_id
     WHERE x.expense_id = p_id
    UNION ALL
    SELECT 3, 'its vendor request ' || COALESCE(v.record_name, '') || ' was paid by', l.id
      FROM expenses e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id)
      JOIN bank_statement_lines l ON l.transfer_id = v.out_transfer_id WHERE e.id = p_id
  )
  SELECT COALESCE(
    (SELECT k.how || ' the ' || a.account_name || ' line of ' || to_char(l.value_date, 'DD Mon YYYY') || ' ('
            || to_char(COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount), 'FM999,999,999,990.00')
            || COALESCE(', ' || COALESCE(l.reference_code, l.reference), '') || ') — undo that match in Bank reconciliation to change it'
       FROM k JOIN bank_statement_lines l ON l.id = k.line_id JOIN accounts a ON a.id = l.account_id
      ORDER BY k.ord LIMIT 1),
    -- A transfer with no statement line yet still holds it (as before 501).
    (SELECT 'it is matched to bank transfer ' || COALESCE(t.transfer_id_code, '(no code)')
       FROM expenses e LEFT JOIN transfers t ON t.id = e.transfer_id WHERE e.id = p_id AND e.transfer_id IS NOT NULL),
    (SELECT 'it was paid in batch ' || COALESCE(b.payment_code, '') || ', which is matched to the bank'
       FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id
      WHERE x.expense_id = p_id AND b.transfer_id IS NOT NULL LIMIT 1),
    (SELECT 'its vendor request ' || COALESCE(v.record_name, '') || ' was paid and matched to the bank'
       FROM expenses e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id)
      WHERE e.id = p_id AND v.out_transfer_id IS NOT NULL))
$f$;

GRANT EXECUTE ON FUNCTION public.expense_bank_locks(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_bank_lock_index() TO authenticated;
