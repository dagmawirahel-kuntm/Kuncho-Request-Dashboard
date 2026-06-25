SET search_path TO public;

-- ── Account Balances View ──────────────────────────────────────────
-- Aggregates money flow into and out of each account:
--   Inflows  : sales (sales_status = 'Paid') + incoming transfers
--   Outflows : paid expenses + finance-approved cash advances + outgoing transfers

CREATE OR REPLACE VIEW public.v_account_balances AS
WITH
  sales_in AS (
    SELECT account_id, COALESCE(SUM(amount), 0) AS total
    FROM public.sales
    WHERE account_id IS NOT NULL AND sales_status = 'Paid'
    GROUP BY account_id
  ),
  expenses_out AS (
    SELECT account_id, COALESCE(SUM(amount_etb), 0) AS total
    FROM public.expenses
    WHERE account_id IS NOT NULL AND payment_status = true
    GROUP BY account_id
  ),
  advances_out AS (
    SELECT account_used_id AS account_id, COALESCE(SUM(amount_advanced), 0) AS total
    FROM public.cash_advances
    WHERE account_used_id IS NOT NULL AND approval_status = 'finance_approved'
    GROUP BY account_used_id
  ),
  transfers_in AS (
    SELECT to_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
    FROM public.transfers
    WHERE to_account_id IS NOT NULL
    GROUP BY to_account_id
  ),
  transfers_out AS (
    SELECT from_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
    FROM public.transfers
    WHERE from_account_id IS NOT NULL
    GROUP BY from_account_id
  )
SELECT
  a.id,
  a.account_name,
  a.type,
  a.status,
  COALESCE(si.total, 0) + COALESCE(ti.total, 0)
    - COALESCE(eo.total, 0)
    - COALESCE(ao.total, 0)
    - COALESCE(to2.total, 0)  AS balance,
  COALESCE(si.total,  0)      AS total_sales_in,
  COALESCE(ti.total,  0)      AS total_transfers_in,
  COALESCE(eo.total,  0)      AS total_expenses_out,
  COALESCE(ao.total,  0)      AS total_advances_out,
  COALESCE(to2.total, 0)      AS total_transfers_out
FROM public.accounts a
LEFT JOIN sales_in      si   ON si.account_id  = a.id
LEFT JOIN expenses_out  eo   ON eo.account_id  = a.id
LEFT JOIN advances_out  ao   ON ao.account_id  = a.id
LEFT JOIN transfers_in  ti   ON ti.account_id  = a.id
LEFT JOIN transfers_out to2  ON to2.account_id = a.id;

GRANT SELECT ON public.v_account_balances TO authenticated;
