-- 347 — Accounts as the cash control centre
--
-- 1. One balance. The Accounts page read v_account_balances (vendor
--    requests counted once they were sent, personal draws) while
--    reconciliation and the balance sheet read account_balances_asof(), an
--    older copy of the same sums. account_balances_asof(date) is now the one
--    calculation — the view's rules, as of any date, plus 345's "count a
--    matched sale or salary line once" — and v_account_balances is today's
--    row of it.
-- 2. What each account is for (accounts.role): the main account payments go
--    out of (CBE), collection accounts at other banks where clients pay and
--    the money is moved on to CBE, wallets, cash, other. Tsedey Bank was
--    marked inactive while a client paid 11.15M into it; it's active.
-- 3. v_account_control: per account, the app's balance beside the
--    bank's (the last statement line), how old that statement is, the
--    difference on that date, lines still to reconcile, the period closed
--    through, payments sent but not yet on the bank — and, for a collection
--    account, what is waiting to move to the main account and since when.

SET search_path TO public;

-- ── 1. One balance ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS account_balances_asof(date);
CREATE FUNCTION account_balances_asof(p_cutoff date)
RETURNS TABLE(id uuid, account_name text, type text, status text, balance numeric, opening_balance numeric,
  opening_balance_as_of date, total_sales_in numeric, total_transfers_in numeric, total_vrf_returned_in numeric,
  total_expenses_out numeric, total_advances_out numeric, total_payroll_out numeric,
  total_vrf_transferred_out numeric, total_transfers_out numeric, total_vrf_draws_out numeric)
LANGUAGE sql STABLE SET search_path = public AS $function$
  WITH latest_anchor AS (
    SELECT DISTINCT ON (account_id) account_id, as_of_date, balance, transfer_id
    FROM bank_balance_anchors WHERE as_of_date <= p_cutoff
    ORDER BY account_id, as_of_date DESC
  ), counted_out AS (
    SELECT t.id, t.from_account_id AS account_id, t.amount
    FROM transfers t LEFT JOIN latest_anchor la ON la.account_id = t.from_account_id
    WHERE t.from_account_id IS NOT NULL AND t.date <= p_cutoff
      AND (la.as_of_date IS NULL OR t.date > la.as_of_date
           OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id))
  ), counted_in AS (
    SELECT t.id, t.to_account_id AS account_id, t.amount
    FROM transfers t LEFT JOIN latest_anchor la ON la.account_id = t.to_account_id
    WHERE t.to_account_id IS NOT NULL AND t.date <= p_cutoff
      AND (la.as_of_date IS NULL OR t.date > la.as_of_date
           OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id))
  ), counted_vrf_out AS (
    -- A vendor request leaves the bank when it is sent; once its bank line is
    -- matched, that line counts it instead.
    SELECT v.id, v.initial_account_id AS account_id, v.amount_transferred AS amount
    FROM vendor_receipt_facilitation v LEFT JOIN latest_anchor la ON la.account_id = v.initial_account_id
    WHERE v.initial_account_id IS NOT NULL AND NOT v.is_archived AND v.payment_state = 'sent'
      AND v.out_transfer_id IS NULL AND COALESCE(v.sent_date, v.trxn_date) <= p_cutoff
      AND (la.as_of_date IS NULL OR COALESCE(v.sent_date, v.trxn_date) > la.as_of_date)
  ), transfers_out AS (SELECT account_id, sum(amount) AS total FROM counted_out GROUP BY account_id),
  transfers_in AS (SELECT account_id, sum(amount) AS total FROM counted_in GROUP BY account_id),
  vrf_out AS (SELECT account_id, sum(amount) AS total FROM counted_vrf_out GROUP BY account_id),
  vrf_in AS (
    SELECT x.account_id, sum(x.amount) AS total
    FROM (SELECT r.account_id, r.amount, r.return_date AS d
          FROM vrf_returns r JOIN vendor_receipt_facilitation v ON v.id = r.vrf_id
          WHERE v.structured AND NOT v.is_archived AND r.account_id IS NOT NULL AND r.transfer_id IS NULL
          UNION ALL
          SELECT v.return_account_id, v.money_returned, v.trxn_date
          FROM vendor_receipt_facilitation v
          WHERE NOT v.structured AND NOT v.is_archived AND v.return_account_id IS NOT NULL) x
    LEFT JOIN latest_anchor la ON la.account_id = x.account_id
    WHERE x.d <= p_cutoff AND (la.as_of_date IS NULL OR x.d > la.as_of_date)
    GROUP BY x.account_id
  ), sales_in AS (
    SELECT s.account_id, sum(s.amount) AS total
    FROM sales s LEFT JOIN latest_anchor la ON la.account_id = s.account_id
    WHERE s.account_id IS NOT NULL AND s.sales_status = 'Paid' AND s.date <= p_cutoff
      AND (la.as_of_date IS NULL OR s.date > la.as_of_date)
      -- A sale matched to its bank credit is counted by that credit.
      AND NOT EXISTS (SELECT 1 FROM counted_in ci WHERE ci.id = s.transfer_id AND ci.account_id = s.account_id)
    GROUP BY s.account_id
  ), expenses_out AS (
    SELECT e.account_id, sum(e.amount_etb) AS total
    FROM expenses e LEFT JOIN latest_anchor la ON la.account_id = e.account_id
    WHERE e.account_id IS NOT NULL AND e.payment_status = true AND e.date <= p_cutoff
      AND (la.as_of_date IS NULL OR e.date > la.as_of_date)
      AND e.vendor_receipt_facilitation_id IS NULL AND e.expense_type IS DISTINCT FROM 'vrf'
      AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = e.transfer_id AND co.account_id = e.account_id)
      AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = e.vrf_id AND cv.account_id = e.account_id)
      AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses bpe JOIN batch_payments bp ON bp.id = bpe.batch_payment_id
                      JOIN counted_out co ON co.id = bp.transfer_id AND co.account_id = e.account_id
                      WHERE bpe.expense_id = e.id)
    GROUP BY e.account_id
  ), payroll_out AS (
    SELECT p.account_id, sum(ps.net_amount) AS total
    FROM payroll p JOIN payroll_staff ps ON ps.payroll_id = p.id
    LEFT JOIN latest_anchor la ON la.account_id = p.account_id
    WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid' AND p.end_date <= p_cutoff
      AND (la.as_of_date IS NULL OR p.end_date > la.as_of_date)
      AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = p.transfer_id AND co.account_id = p.account_id)
      AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = p.vrf_id AND cv.account_id = p.account_id)
      -- A run paid by salary lines is counted by those lines.
      AND NOT EXISTS (SELECT 1 FROM bank_statement_lines bl JOIN counted_out co ON co.id = bl.transfer_id
                      WHERE bl.matched_payroll_id = p.id AND co.account_id = p.account_id)
    GROUP BY p.account_id
  ), advances_out AS (
    SELECT ca.account_used_id AS account_id, sum(ca.amount_advanced) AS total
    FROM cash_advances ca LEFT JOIN latest_anchor la ON la.account_id = ca.account_used_id
    WHERE ca.account_used_id IS NOT NULL AND ca.approval_status = 'finance_approved' AND ca.date_given <= p_cutoff
      AND (la.as_of_date IS NULL OR ca.date_given > la.as_of_date)
    GROUP BY ca.account_used_id
  ), draws_out AS (
    SELECT d.account_id, sum(d.amount) AS total
    FROM vrf_personal_draws d LEFT JOIN latest_anchor la ON la.account_id = d.account_id
    WHERE d.account_id IS NOT NULL AND d.draw_date <= p_cutoff AND (la.as_of_date IS NULL OR d.draw_date > la.as_of_date)
    GROUP BY d.account_id
  )
  SELECT a.id, a.account_name, a.type, a.status,
    COALESCE(la.balance, 0) + COALESCE(si.total, 0) + COALESCE(ti.total, 0) + COALESCE(vi.total, 0)
      - COALESCE(eo.total, 0) - COALESCE(ao.total, 0) - COALESCE(po.total, 0) - COALESCE(vo.total, 0)
      - COALESCE(to2.total, 0) - COALESCE(dr.total, 0),
    COALESCE(la.balance, 0), la.as_of_date,
    COALESCE(si.total, 0), COALESCE(ti.total, 0), COALESCE(vi.total, 0), COALESCE(eo.total, 0),
    COALESCE(ao.total, 0), COALESCE(po.total, 0), COALESCE(vo.total, 0), COALESCE(to2.total, 0), COALESCE(dr.total, 0)
  FROM accounts a
  LEFT JOIN latest_anchor la ON la.account_id = a.id
  LEFT JOIN sales_in si ON si.account_id = a.id
  LEFT JOIN expenses_out eo ON eo.account_id = a.id
  LEFT JOIN advances_out ao ON ao.account_id = a.id
  LEFT JOIN payroll_out po ON po.account_id = a.id
  LEFT JOIN vrf_out vo ON vo.account_id = a.id
  LEFT JOIN vrf_in vi ON vi.account_id = a.id
  LEFT JOIN transfers_in ti ON ti.account_id = a.id
  LEFT JOIN transfers_out to2 ON to2.account_id = a.id
  LEFT JOIN draws_out dr ON dr.account_id = a.id
$function$;
REVOKE ALL ON FUNCTION account_balances_asof(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION account_balances_asof(date) TO authenticated;

CREATE OR REPLACE VIEW v_account_balances WITH (security_invoker = true) AS
SELECT * FROM account_balances_asof(current_date);
REVOKE ALL ON v_account_balances FROM anon;
GRANT SELECT ON v_account_balances TO authenticated;

-- ── 2. What each account is for ─────────────────────────────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role text;
UPDATE accounts SET role = CASE
    WHEN account_name ILIKE 'commercial bank of ethiopia%' OR account_name ILIKE 'cbe%' THEN 'main'
    WHEN is_vrf_holding OR type ILIKE '%personal%' OR account_name ILIKE '%wallet%' THEN 'wallet'
    WHEN type ILIKE '%cash%' OR account_name ILIKE '%cash%' THEN 'cash'
    WHEN type ILIKE '%bank%' THEN 'collection'
    ELSE 'other' END
  WHERE role IS NULL;
ALTER TABLE accounts ALTER COLUMN role SET DEFAULT 'collection';
ALTER TABLE accounts ALTER COLUMN role SET NOT NULL;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_role_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK (role IN ('main', 'collection', 'wallet', 'cash', 'other'));
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_main ON accounts ((role)) WHERE role = 'main';

-- An account a client paid into is open, whatever it was marked.
UPDATE accounts a SET status = 'active'
  WHERE lower(COALESCE(a.status, '')) = 'inactive'
    AND (EXISTS (SELECT 1 FROM sales s WHERE s.account_id = a.id)
         OR EXISTS (SELECT 1 FROM expenses e WHERE e.account_id = a.id)
         OR EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.account_id = a.id));

-- ── 3. Cash position per account ────────────────────────────────────────
CREATE OR REPLACE VIEW v_account_control WITH (security_invoker = true) AS
WITH bal AS (SELECT id, balance FROM v_account_balances),
act AS (
  SELECT a.id,
    EXISTS (SELECT 1 FROM sales s WHERE s.account_id = a.id)
      OR EXISTS (SELECT 1 FROM expenses e WHERE e.account_id = a.id)
      OR EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.account_id = a.id)
      OR EXISTS (SELECT 1 FROM transfers t WHERE a.id IN (t.from_account_id, t.to_account_id))
      OR EXISTS (SELECT 1 FROM bank_balance_anchors b WHERE b.account_id = a.id) AS has_activity
  FROM accounts a
),
-- Money in and out by date, for "waiting since".
moves AS (
  SELECT account_id, COALESCE(payment_date, date) AS d, 'in'::text AS dir FROM sales WHERE sales_status = 'Paid' AND account_id IS NOT NULL
  UNION ALL SELECT to_account_id, date, 'in' FROM transfers WHERE to_account_id IS NOT NULL
  UNION ALL SELECT from_account_id, date, 'out' FROM transfers WHERE from_account_id IS NOT NULL
  UNION ALL SELECT account_id, COALESCE(paid_date::date, date), 'out' FROM expenses WHERE payment_status AND account_id IS NOT NULL
),
waiting AS (
  SELECT m.account_id,
    (SELECT min(i.d) FROM moves i WHERE i.account_id = m.account_id AND i.dir = 'in'
       AND i.d >= COALESCE((SELECT max(o.d) FROM moves o WHERE o.account_id = m.account_id AND o.dir = 'out'), '-infinity'::date)) AS since
  FROM (SELECT DISTINCT account_id FROM moves) m
),
awaiting AS (
  -- Sent by bank but no statement line yet.
  SELECT account_id, sum(amount) AS amount, count(*) AS n FROM (
    SELECT e.account_id, COALESCE(e.net_payable, e.amount_etb) AS amount FROM expenses e
    WHERE e.payment_state = 'sent' AND e.transfer_id IS NULL AND e.payment_method IN ('transfer', 'cpo', 'cheque') AND e.account_id IS NOT NULL
    UNION ALL
    SELECT v.initial_account_id, COALESCE(v.net_sent, v.amount_transferred) FROM vendor_receipt_facilitation v
    WHERE v.payment_state = 'sent' AND v.out_transfer_id IS NULL AND NOT v.is_archived AND v.initial_account_id IS NOT NULL
  ) x GROUP BY account_id
)
SELECT a.id AS account_id, a.account_name, a.role, a.status, a.type, a.account_number,
  (lower(COALESCE(a.status, '')) = 'inactive' AND NOT act.has_activity) AS not_opened,
  act.has_activity,
  COALESCE(bal.balance, 0) AS app_balance,
  ov.statement_balance, ov.statement_date,
  CASE WHEN ov.statement_date IS NOT NULL THEN current_date - ov.statement_date END AS statement_age_days,
  CASE WHEN ov.statement_date IS NOT NULL
       THEN (SELECT f.balance FROM account_balances_asof(ov.statement_date) f WHERE f.id = a.id) END AS app_balance_at_statement,
  ov.line_count, ov.open_count, ov.oldest_open, ov.closed_through, ov.closed_balance, ov.last_import_at,
  COALESCE(aw.amount, 0) AS awaiting_bank_amount, COALESCE(aw.n, 0) AS awaiting_bank_count,
  CASE WHEN a.role = 'collection' AND COALESCE(bal.balance, 0) > 0 THEN bal.balance ELSE 0 END AS waiting_to_move,
  CASE WHEN a.role = 'collection' AND COALESCE(bal.balance, 0) > 0 THEN w.since END AS waiting_since,
  CASE WHEN a.role = 'collection' AND COALESCE(bal.balance, 0) > 0 AND w.since IS NOT NULL THEN current_date - w.since END AS waiting_days
FROM accounts a
JOIN act ON act.id = a.id
LEFT JOIN bal ON bal.id = a.id
LEFT JOIN v_bank_account_overview ov ON ov.account_id = a.id
LEFT JOIN waiting w ON w.account_id = a.id
LEFT JOIN awaiting aw ON aw.account_id = a.id;
REVOKE ALL ON v_account_control FROM PUBLIC, anon;
GRANT SELECT ON v_account_control TO authenticated;
