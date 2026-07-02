-- Migration 045: Database-side aggregation views for financial reports
--
-- Root cause fix: the P&L page fetched every paid sale/expense row and
-- summed them in the browser. Supabase returns at most 1,000 rows per
-- query, so any year with >1,000 paid records was silently undercounted
-- (2025 showed 59.1M instead of the true 99.3M). These views make
-- Postgres do the summing and return a handful of rows instead.

SET search_path TO public;

-- ── Monthly P&L: revenue (paid sales) vs expenses (paid expenses) ────
CREATE OR REPLACE VIEW public.v_pl_monthly
WITH (security_invoker = true) AS
SELECT
  year,
  month,
  COALESCE(SUM(revenue), 0)  AS revenue,
  COALESCE(SUM(expenses), 0) AS expenses
FROM (
  SELECT
    EXTRACT(YEAR  FROM date)::int AS year,
    EXTRACT(MONTH FROM date)::int AS month,
    amount AS revenue,
    0::numeric AS expenses
  FROM public.sales
  WHERE sales_status = 'Paid' AND date IS NOT NULL

  UNION ALL

  SELECT
    EXTRACT(YEAR  FROM date)::int,
    EXTRACT(MONTH FROM date)::int,
    0::numeric,
    amount_etb
  FROM public.expenses
  WHERE payment_status = true AND date IS NOT NULL
) t
GROUP BY year, month;

-- ── Paid expenses by category, per year (P&L breakdown table) ────────
CREATE OR REPLACE VIEW public.v_expenses_by_category
WITH (security_invoker = true) AS
SELECT
  EXTRACT(YEAR FROM e.date)::int          AS year,
  COALESCE(c.category_name, 'Uncategorized') AS category_name,
  SUM(e.amount_etb)                       AS total_etb,
  COUNT(*)                                AS records
FROM public.expenses e
LEFT JOIN public.categories c ON c.id = e.category_id
WHERE e.payment_status = true AND e.date IS NOT NULL
GROUP BY 1, 2;

-- ── Pending (unpaid) expense totals for dashboards ───────────────────
CREATE OR REPLACE VIEW public.v_expense_pending_totals
WITH (security_invoker = true) AS
SELECT
  COUNT(*)                        AS pending_count,
  COALESCE(SUM(amount_etb), 0)    AS pending_total_etb
FROM public.expenses
WHERE payment_status = false;

GRANT SELECT ON public.v_pl_monthly TO authenticated;
GRANT SELECT ON public.v_expenses_by_category TO authenticated;
GRANT SELECT ON public.v_expense_pending_totals TO authenticated;
