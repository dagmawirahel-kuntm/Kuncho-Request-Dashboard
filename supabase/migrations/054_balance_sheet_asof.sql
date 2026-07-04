-- Migration 054: "As of" Balance Sheet — dual-calendar period-end snapshots
--
-- The Balance Sheet was an all-time snapshot with no cutoff date at all.
-- Real balance sheets are prepared "as of" a specific date — an Ethiopian
-- fiscal year-end for tax filing, a Gregorian year-end for budgeting —
-- so this adds date-parameterized versions of the same aggregation
-- already used by v_account_balances, plus AR/AP/retained-earnings
-- reconstruction as of that date, using the real payment_date/paid_date
-- columns so a since-settled item still counts correctly if it was
-- outstanding on the chosen date. Recognition timing (which `date` +
-- status flag counts a sale/expense) matches v_pl_monthly exactly, so
-- Retained Earnings as of any date reconciles with cumulative P&L.
--
-- Functions run with the caller's own privileges (no SECURITY DEFINER),
-- matching the security_invoker views elsewhere — RLS still applies.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.account_balances_asof(p_cutoff date)
RETURNS TABLE (
  id uuid,
  account_name text,
  type text,
  status text,
  balance numeric,
  total_sales_in numeric,
  total_transfers_in numeric,
  total_expenses_out numeric,
  total_advances_out numeric,
  total_payroll_out numeric,
  total_transfers_out numeric
) LANGUAGE sql STABLE AS $$
  WITH
    sales_in AS (
      SELECT account_id, COALESCE(SUM(amount), 0) AS total
      FROM public.sales
      WHERE account_id IS NOT NULL AND sales_status = 'Paid' AND date <= p_cutoff
      GROUP BY account_id
    ),
    expenses_out AS (
      SELECT account_id, COALESCE(SUM(amount_etb), 0) AS total
      FROM public.expenses
      WHERE account_id IS NOT NULL AND payment_status = true AND date <= p_cutoff
      GROUP BY account_id
    ),
    advances_out AS (
      SELECT account_used_id AS account_id, COALESCE(SUM(amount_advanced), 0) AS total
      FROM public.cash_advances
      WHERE account_used_id IS NOT NULL AND approval_status = 'finance_approved' AND date_given <= p_cutoff
      GROUP BY account_used_id
    ),
    payroll_out AS (
      SELECT p.account_id, COALESCE(SUM(ps.net_amount), 0) AS total
      FROM public.payroll p
      JOIN public.payroll_staff ps ON ps.payroll_id = p.id
      WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid' AND p.end_date <= p_cutoff
      GROUP BY p.account_id
    ),
    transfers_in AS (
      SELECT to_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
      FROM public.transfers
      WHERE to_account_id IS NOT NULL AND date <= p_cutoff
      GROUP BY to_account_id
    ),
    transfers_out AS (
      SELECT from_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
      FROM public.transfers
      WHERE from_account_id IS NOT NULL AND date <= p_cutoff
      GROUP BY from_account_id
    )
  SELECT
    a.id, a.account_name, a.type, a.status,
    COALESCE(si.total, 0) + COALESCE(ti.total, 0)
      - COALESCE(eo.total, 0) - COALESCE(ao.total, 0)
      - COALESCE(po.total, 0) - COALESCE(to2.total, 0) AS balance,
    COALESCE(si.total, 0), COALESCE(ti.total, 0), COALESCE(eo.total, 0),
    COALESCE(ao.total, 0), COALESCE(po.total, 0), COALESCE(to2.total, 0)
  FROM public.accounts a
  LEFT JOIN sales_in      si  ON si.account_id  = a.id
  LEFT JOIN expenses_out  eo  ON eo.account_id  = a.id
  LEFT JOIN advances_out  ao  ON ao.account_id  = a.id
  LEFT JOIN payroll_out   po  ON po.account_id  = a.id
  LEFT JOIN transfers_in  ti  ON ti.account_id  = a.id
  LEFT JOIN transfers_out to2 ON to2.account_id = a.id;
$$;

-- Accounts Receivable: invoiced/paid sales dated on/before cutoff that
-- were still unpaid AS OF that date (a since-paid sale still counts if
-- its real payment_date falls after the cutoff).
CREATE OR REPLACE FUNCTION public.ar_total_asof(p_cutoff date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM public.sales
  WHERE date <= p_cutoff
    AND sales_status IN ('Invoiced', 'Paid')
    AND (payment_date IS NULL OR payment_date > p_cutoff);
$$;

-- Accounts Payable by category: expenses dated on/before cutoff still
-- unpaid as of that date (same since-paid-later logic via paid_date).
CREATE OR REPLACE FUNCTION public.ap_by_category_asof(p_cutoff date)
RETURNS TABLE (category_name text, total_etb numeric) LANGUAGE sql STABLE AS $$
  SELECT COALESCE(c.category_name, 'Uncategorized'), COALESCE(SUM(e.amount_etb), 0)
  FROM public.expenses e
  LEFT JOIN public.categories c ON c.id = e.category_id
  WHERE e.date <= p_cutoff
    AND (e.paid_date IS NULL OR e.paid_date > p_cutoff)
  GROUP BY 1;
$$;

-- Retained earnings as of cutoff: cumulative Paid-sales revenue minus
-- cumulative paid expenses, using the SAME date+status recognition as
-- v_pl_monthly, so this always reconciles with cumulative P&L net income.
CREATE OR REPLACE FUNCTION public.retained_earnings_asof(p_cutoff date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE((SELECT SUM(amount) FROM public.sales WHERE date <= p_cutoff AND sales_status = 'Paid'), 0)
    - COALESCE((SELECT SUM(amount_etb) FROM public.expenses WHERE date <= p_cutoff AND payment_status = true), 0);
$$;

GRANT EXECUTE ON FUNCTION public.account_balances_asof(date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.ar_total_asof(date)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.ap_by_category_asof(date)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.retained_earnings_asof(date) TO authenticated;
