-- ============================================================
-- Finance dashboard supporting views — queue-first, matching the
-- ranked order finance asked for: to-pay queue, pending approval,
-- cash position, recent payments.
-- ============================================================

SET search_path TO public;

-- ── 1. To-pay queue (the headline) — approved, awaiting transfer ──
CREATE OR REPLACE VIEW v_to_pay_queue
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.project_id,
  p.project_name,
  c.cost_group_id,
  cg.name AS cost_group_name,
  e.verify_wht,
  e.finance_approved_by,
  e.finance_approved_at,
  EXTRACT(DAY FROM (NOW() - e.finance_approved_at)) AS days_since_approval
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN categories c ON c.id = e.category_id
LEFT JOIN cost_groups cg ON cg.id = c.cost_group_id
WHERE e.payment_state = 'approved_to_pay'
  AND fiscal_period_for_date(e.date) = (SELECT id FROM fiscal_periods WHERE is_current);

GRANT SELECT ON v_to_pay_queue TO authenticated;

-- ── 2. Pending approval — awaiting a finance sign-off ──────────────
-- Interpretation note: "unpaid/approval_status='pending'" in the
-- source spec is read broadly here as "not yet finance_approved" —
-- pending (awaiting manager) AND manager_approved (awaiting finance)
-- both show, since finance benefits from seeing the whole backlog,
-- not just the exact rows they can act on this second. Approving from
-- here (an app-level action, not a DB object) stamps finance_approved_by
-- via the existing migration-006 trigger, which is what unlocks
-- payment_state -> approved_to_pay per migration 098's gate.
CREATE OR REPLACE VIEW v_finance_pending_approval
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.project_id,
  p.project_name,
  e.approval_status,
  e.manager_approved_by,
  e.manager_approved_at,
  e.created_at
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
WHERE e.payment_state = 'unpaid'
  AND e.approval_status IN ('pending', 'manager_approved');

GRANT SELECT ON v_finance_pending_approval TO authenticated;

-- ── 3. Cash position per account — bank statement only ─────────────
-- Deliberately narrower than the existing v_account_balances (migration
-- 009), which blends in recorded sales/expenses/advances to compute a
-- "book" balance. This one is purely credits minus debits from the
-- imported transfers (bank statement) lines — the "what does the bank
-- actually say" figure finance needs before releasing a batch, kept
-- separate so neither view's meaning gets diluted.
CREATE OR REPLACE VIEW v_account_cash_position
WITH (security_invoker = true) AS
SELECT
  a.id AS account_id,
  a.account_name,
  COALESCE(credits.total, 0) AS total_credits,
  COALESCE(debits.total, 0) AS total_debits,
  COALESCE(credits.total, 0) - COALESCE(debits.total, 0) AS cash_position
FROM accounts a
LEFT JOIN (
  SELECT to_account_id AS account_id, SUM(amount) AS total
  FROM transfers WHERE to_account_id IS NOT NULL
  GROUP BY to_account_id
) credits ON credits.account_id = a.id
LEFT JOIN (
  SELECT from_account_id AS account_id, SUM(amount) AS total
  FROM transfers WHERE from_account_id IS NOT NULL
  GROUP BY from_account_id
) debits ON debits.account_id = a.id;

GRANT SELECT ON v_account_cash_position TO authenticated;

-- ── 4. This week's payments made — confirmation / reconciliation ──
CREATE OR REPLACE VIEW v_recent_payments
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.payment_state,
  e.payment_method,
  e.disbursed_by,
  e.payment_state_changed_at,
  e.transfer_id,
  t.transfer_id_code,
  t.notes AS transfer_notes,
  bpe.batch_payment_id
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN transfers t ON t.id = e.transfer_id
LEFT JOIN batch_payment_expenses bpe ON bpe.expense_id = e.id
WHERE e.payment_state IN ('sent', 'paid')
  AND e.payment_state_changed_at >= NOW() - INTERVAL '7 days';

GRANT SELECT ON v_recent_payments TO authenticated;

-- Verify: row counts per view
SELECT 'v_to_pay_queue' AS view, count(*) FROM v_to_pay_queue
UNION ALL
SELECT 'v_finance_pending_approval', count(*) FROM v_finance_pending_approval
UNION ALL
SELECT 'v_account_cash_position', count(*) FROM v_account_cash_position
UNION ALL
SELECT 'v_recent_payments', count(*) FROM v_recent_payments;

-- Verify: cash position reconciles to the imported CBE statement — spot
-- check the CBE account specifically.
SELECT account_name, total_credits, total_debits, cash_position
FROM v_account_cash_position
WHERE account_name ILIKE '%CBE%';
