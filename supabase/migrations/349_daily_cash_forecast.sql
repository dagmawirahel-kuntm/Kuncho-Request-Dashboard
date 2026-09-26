-- 349 — Daily cash position and forecast
--
-- Finance plans payments every day. The forecast starts from each account's
-- balance today (v_account_balances) and lays out what is still to move:
--
--   Money out (committed)
--     * expenses approved to pay but not sent yet            — due today
--     * expenses sent after the account's last imported statement (anything
--       sent before it is already on that statement, so in the balance)
--     * vendor requests approved but not sent                — due today
--     * payroll runs not paid yet                            — their end date
--   Money in
--     * invoices not paid yet (expected)                     — due date, or 30 days after the invoice
--     * payment requests issued but not invoiced (expected)  — 14 days after the request
--     * milestones due (advance on signing, or progress met) with no
--       request yet (possible)                               — 14 days out
--
-- Anything whose date has passed lands on today, marked overdue. Items with
-- no account are planned on the main account (CBE), where payments go out.
--
-- v_cash_forecast_items lists them; cash_forecast(days, account) gives the
-- day-by-day opening, in, out and closing, with or without "possible" items.

SET search_path TO public;

CREATE OR REPLACE VIEW v_cash_forecast_items WITH (security_invoker = true) AS
WITH main AS (SELECT id FROM accounts WHERE role = 'main' LIMIT 1),
last_stmt AS (SELECT account_id, max(value_date) AS d FROM bank_statement_lines GROUP BY account_id),
items AS (
  -- Approved, not sent.
  SELECT 'expense'::text AS kind, e.id AS source_id,
    COALESCE(e.expense_code, 'Expense') AS label,
    COALESCE(v.vendor_name, st.employee_name, e.item_service_description) AS detail,
    e.account_id, current_date AS due_date,
    -COALESCE(e.net_payable, e.amount_etb) AS amount, 'committed'::text AS certainty,
    'Approved to pay' AS stage, '/expenses/' || e.id AS link
  FROM expenses e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN staff st ON st.id = e.paid_to_staff_id
  WHERE e.payment_state = 'approved_to_pay' AND NOT COALESCE(e.is_archived, false)
  UNION ALL
  -- Sent after the last statement: still to clear the bank.
  SELECT 'expense', e.id, COALESCE(e.expense_code, 'Expense'),
    COALESCE(v.vendor_name, st.employee_name, e.item_service_description),
    e.account_id, COALESCE(e.payment_state_changed_at::date, e.date),
    -COALESCE(e.net_payable, e.amount_etb), 'committed', 'Sent, not on a statement yet', '/expenses/' || e.id
  FROM expenses e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN staff st ON st.id = e.paid_to_staff_id
  LEFT JOIN last_stmt ls ON ls.account_id = COALESCE(e.account_id, (SELECT id FROM main))
  WHERE e.payment_state = 'sent' AND e.transfer_id IS NULL AND NOT COALESCE(e.is_archived, false)
    AND (ls.d IS NULL OR COALESCE(e.payment_state_changed_at::date, e.date) > ls.d)
  UNION ALL
  SELECT 'vrf', f.id, COALESCE(f.record_name, 'Vendor request'), f.facilitator_name,
    f.initial_account_id, current_date, -COALESCE(f.net_sent, f.amount_transferred), 'committed',
    'Approved, not sent', '/vendor-receipts/' || f.id
  FROM vendor_receipt_facilitation f
  WHERE f.payment_state = 'approved' AND NOT f.is_archived
  UNION ALL
  SELECT 'payroll', p.id, COALESCE(p.payroll_record, 'Payroll'), p.pay_period,
    p.account_id, COALESCE(p.end_date, current_date),
    -- Salary lines already on a statement are in the balance.
    -greatest((SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id)
      - (SELECT COALESCE(sum(bl.debit_amount), 0) FROM bank_statement_lines bl WHERE bl.matched_payroll_id = p.id), 0), 'committed',
    'Payroll ' || COALESCE(p.payment_status, ''), '/payroll/' || p.id
  FROM payroll p
  WHERE COALESCE(p.payment_status, '') <> 'paid' AND NOT COALESCE(p.is_archived, false)
  UNION ALL
  -- Invoiced, not paid.
  SELECT 'sale', s.id, COALESCE(s.invoice_number, 'Invoice'), c.client_name,
    s.account_id, COALESCE(s.due_date, s.date + 30),
    s.amount - COALESCE(w.expected_wht, 0), 'expected', 'Invoiced', '/sales/' || s.id
  FROM sales s
  LEFT JOIN clients c ON c.id = s.client_id
  LEFT JOIN v_sale_wht w ON w.sale_id = s.id AND w.qualifies
  WHERE s.sales_status = 'Invoiced' AND NOT COALESCE(s.is_archived, false)
  UNION ALL
  -- Requested, not invoiced yet.
  SELECT 'payment_request', r.id, r.request_number, c.client_name,
    NULL::uuid, r.request_date + 14, r.amount, 'expected', 'Payment requested',
    '/clients/' || r.client_id || '/payment-request?request_id=' || r.id
  FROM client_payment_requests r
  LEFT JOIN clients c ON c.id = r.client_id
  WHERE r.status = 'issued'
  UNION ALL
  -- Due but not requested yet.
  SELECT 'milestone', m.id, m.title, COALESCE(ct.contract_no, '') || COALESCE(' · ' || cl.client_name, ''),
    NULL::uuid, current_date + 14, m.net_payable_etb, 'possible',
    CASE WHEN m.kind = 'advance' THEN 'Advance due' ELSE 'Progress met' END,
    '/projects/' || m.project_id
  FROM payment_milestones m
  JOIN contracts ct ON ct.id = m.contract_id
  LEFT JOIN clients cl ON cl.id = ct.client_id
  WHERE (m.status = 'progress_met' OR (m.kind = 'advance' AND m.status = 'pending' AND ct.status IN ('signed', 'active')))
    AND NOT EXISTS (SELECT 1 FROM client_payment_requests r WHERE r.milestone_id = m.id AND r.status <> 'cancelled')
)
SELECT i.kind, i.source_id, i.label, i.detail,
  COALESCE(i.account_id, (SELECT id FROM main)) AS account_id,
  a.account_name, i.due_date,
  greatest(i.due_date, current_date) AS expected_date,
  i.due_date < current_date AS overdue,
  round(i.amount, 2) AS amount, i.certainty, i.stage, i.link
FROM items i
LEFT JOIN accounts a ON a.id = COALESCE(i.account_id, (SELECT id FROM main))
WHERE i.amount <> 0;
REVOKE ALL ON v_cash_forecast_items FROM PUBLIC, anon;
GRANT SELECT ON v_cash_forecast_items TO authenticated;

-- Day by day: opening, in, out, closing. Without an account, every account
-- counts except those never opened.
CREATE OR REPLACE FUNCTION cash_forecast(p_days int DEFAULT 30, p_account_id uuid DEFAULT NULL, p_include_possible boolean DEFAULT false)
RETURNS TABLE(day date, opening numeric, money_in numeric, money_out numeric, closing numeric, item_count int)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH start AS (
    SELECT COALESCE(sum(b.balance), 0) AS bal
    FROM v_account_balances b JOIN accounts a ON a.id = b.id
    WHERE (p_account_id IS NULL OR b.id = p_account_id)
  ), days AS (
    SELECT (current_date + g)::date AS day FROM generate_series(0, greatest(p_days, 1) - 1) g
  ), per_day AS (
    SELECT d.day,
      COALESCE(sum(i.amount) FILTER (WHERE i.amount > 0), 0) AS money_in,
      COALESCE(-sum(i.amount) FILTER (WHERE i.amount < 0), 0) AS money_out,
      count(i.*)::int AS item_count
    FROM days d
    LEFT JOIN v_cash_forecast_items i ON i.expected_date = d.day
      AND (p_account_id IS NULL OR i.account_id = p_account_id)
      AND (p_include_possible OR i.certainty <> 'possible')
    GROUP BY d.day
  )
  SELECT p.day,
    (SELECT bal FROM start) + COALESCE(sum(p.money_in - p.money_out) OVER (ORDER BY p.day ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0),
    p.money_in, p.money_out,
    (SELECT bal FROM start) + sum(p.money_in - p.money_out) OVER (ORDER BY p.day),
    p.item_count
  FROM per_day p ORDER BY p.day
$$;
REVOKE ALL ON FUNCTION cash_forecast(int, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cash_forecast(int, uuid, boolean) TO authenticated;
