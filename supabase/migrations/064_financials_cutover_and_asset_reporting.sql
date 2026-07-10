-- Migration 064: Financials cutover — nature-aware Asset/Expense split
--
-- Neither the Balance Sheet nor the P&L ever looked at categories.nature.
-- Every unpaid expense became a Liability regardless of what it was for;
-- every paid expense hit the P&L regardless of what it was for. There was
-- no way for a purchase to be capitalized as an Asset instead of expensed.
--
-- Per the business decision: don't retroactively recompute historical
-- reports (the numbers people have already seen stay as they are).
-- Instead:
--   - A fixed cutover date marks where the new nature-aware treatment
--     starts. Before it, expenses keep being treated exactly as before
--     (paid -> P&L, unpaid -> Accounts Payable) with no Asset carve-out.
--   - From the cutover forward, an Asset-nature expense (the kind GRN
--     produces) is capitalized: it shows as a real Balance Sheet Asset
--     line and is EXCLUDED from the P&L / retained earnings expense
--     total, instead of being expensed like everything else.
--   - Historical (pre-cutover) data is archived into three lifetime
--     rollups instead of continuing to feed the period-by-period reports.
--
-- Accounts Payable is intentionally left untouched by the cutover — an
-- unpaid bill from before the cutover is still a real debt today and must
-- keep showing as a Liability regardless of when this feature shipped.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.financials_cutover_date()
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT DATE '2026-07-10' $$;

GRANT EXECUTE ON FUNCTION public.financials_cutover_date() TO authenticated;

-- ── New: Asset-nature purchases, dated on/after the cutover, as of a
-- given date — grouped by raw category, and separately by asset_class ──
CREATE OR REPLACE FUNCTION public.assets_by_category_asof(p_cutoff date)
RETURNS TABLE (category_name text, total_etb numeric) LANGUAGE sql STABLE AS $$
  SELECT COALESCE(c.category_name, 'Uncategorized'), COALESCE(SUM(e.amount_etb), 0)
  FROM public.expenses e
  JOIN public.categories c ON c.id = e.category_id
  WHERE c.nature = 'Asset'
    AND e.date >= public.financials_cutover_date()
    AND e.date <= p_cutoff
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.assets_by_class_asof(p_cutoff date)
RETURNS TABLE (asset_class text, total_etb numeric) LANGUAGE sql STABLE AS $$
  SELECT COALESCE(c.asset_class, 'Unclassified'), COALESCE(SUM(e.amount_etb), 0)
  FROM public.expenses e
  JOIN public.categories c ON c.id = e.category_id
  WHERE c.nature = 'Asset'
    AND e.date >= public.financials_cutover_date()
    AND e.date <= p_cutoff
  GROUP BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.assets_by_category_asof(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assets_by_class_asof(date)    TO authenticated;

-- ── Retained earnings: exclude Asset-nature expenses dated on/after the
-- cutover from the expense side, since those are now capitalized instead
-- of expensed. Pre-cutover expenses keep the old (no exclusion) treatment.
CREATE OR REPLACE FUNCTION public.retained_earnings_asof(p_cutoff date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE((SELECT SUM(amount) FROM public.sales WHERE date <= p_cutoff AND sales_status = 'Paid'), 0)
    - COALESCE((
        SELECT SUM(e.amount_etb)
        FROM public.expenses e
        LEFT JOIN public.categories c ON c.id = e.category_id
        WHERE e.date <= p_cutoff
          AND e.payment_status = true
          AND NOT (e.date >= public.financials_cutover_date() AND c.nature = 'Asset')
      ), 0);
$$;

-- ── P&L views: same Asset carve-out, plus limited to cutover-forward so
-- the period-by-period P&L only shows the new regime going forward ──────
CREATE OR REPLACE VIEW public.v_pl_monthly
WITH (security_invoker = true) AS
SELECT
  year, month,
  COALESCE(SUM(revenue), 0)  AS revenue,
  COALESCE(SUM(expenses), 0) AS expenses
FROM (
  SELECT
    EXTRACT(YEAR  FROM date)::int AS year,
    EXTRACT(MONTH FROM date)::int AS month,
    amount AS revenue,
    0::numeric AS expenses
  FROM public.sales
  WHERE sales_status = 'Paid' AND date >= public.financials_cutover_date()

  UNION ALL

  SELECT
    EXTRACT(YEAR  FROM e.date)::int,
    EXTRACT(MONTH FROM e.date)::int,
    0::numeric,
    e.amount_etb
  FROM public.expenses e
  LEFT JOIN public.categories c ON c.id = e.category_id
  WHERE e.payment_status = true AND e.date >= public.financials_cutover_date()
    AND COALESCE(c.nature, 'Expense') <> 'Asset'
) t
GROUP BY year, month;

CREATE OR REPLACE VIEW public.v_expenses_by_category
WITH (security_invoker = true) AS
SELECT
  EXTRACT(YEAR FROM e.date)::int             AS year,
  COALESCE(c.category_name, 'Uncategorized') AS category_name,
  SUM(e.amount_etb)                          AS total_etb,
  COUNT(*)                                   AS records
FROM public.expenses e
LEFT JOIN public.categories c ON c.id = e.category_id
WHERE e.payment_status = true AND e.date >= public.financials_cutover_date()
  AND COALESCE(c.nature, 'Expense') <> 'Asset'
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.v_pl_monthly_et
WITH (security_invoker = true) AS
SELECT
  et.year AS et_year, et.month AS et_month,
  COALESCE(SUM(t.revenue), 0)  AS revenue,
  COALESCE(SUM(t.expenses), 0) AS expenses
FROM (
  SELECT date, amount AS revenue, 0::numeric AS expenses
  FROM public.sales
  WHERE sales_status = 'Paid' AND date >= public.financials_cutover_date()

  UNION ALL

  SELECT e.date, 0::numeric AS revenue, e.amount_etb AS expenses
  FROM public.expenses e
  LEFT JOIN public.categories c ON c.id = e.category_id
  WHERE e.payment_status = true AND e.date >= public.financials_cutover_date()
    AND COALESCE(c.nature, 'Expense') <> 'Asset'
) t
CROSS JOIN LATERAL public.to_ethiopian(t.date) AS et
GROUP BY et.year, et.month;

CREATE OR REPLACE VIEW public.v_expenses_by_category_et
WITH (security_invoker = true) AS
SELECT
  et.year AS et_year,
  COALESCE(c.category_name, 'Uncategorized') AS category_name,
  SUM(e.amount_etb) AS total_etb,
  COUNT(*) AS records
FROM public.expenses e
LEFT JOIN public.categories c ON c.id = e.category_id
CROSS JOIN LATERAL public.to_ethiopian(e.date) AS et
WHERE e.payment_status = true AND e.date >= public.financials_cutover_date()
  AND COALESCE(c.nature, 'Expense') <> 'Asset'
GROUP BY et.year, 2;

-- ── Archive views: pre-cutover history, frozen as lifetime rollups ──────
CREATE OR REPLACE VIEW public.v_archive_vendor_engagements
WITH (security_invoker = true) AS
SELECT
  v.id AS vendor_id,
  COALESCE(v.vendor_name, e.vendors_name, 'Unknown vendor') AS vendor_name,
  COUNT(*) AS total_engagements,
  COALESCE(SUM(e.amount_etb), 0) AS total_amount_etb
FROM public.expenses e
LEFT JOIN public.vendors v ON v.id = e.vendor_id
WHERE e.date < public.financials_cutover_date()
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.v_archive_project_purchases
WITH (security_invoker = true) AS
SELECT
  p.id AS project_id,
  p.project_name,
  COUNT(e.id) AS total_purchases,
  COALESCE(SUM(e.amount_etb), 0) AS total_amount_etb
FROM public.expenses e
JOIN public.projects p ON p.id = e.project_id
WHERE e.date < public.financials_cutover_date()
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.v_archive_client_engagement
WITH (security_invoker = true) AS
SELECT
  c.id AS client_id,
  c.client_name,
  COUNT(s.id) AS total_engagements,
  COALESCE(SUM(s.amount), 0) AS total_amount_etb
FROM public.sales s
JOIN public.clients c ON c.id = s.client_id
WHERE s.date < public.financials_cutover_date()
GROUP BY 1, 2;

GRANT SELECT ON public.v_archive_vendor_engagements  TO authenticated;
GRANT SELECT ON public.v_archive_project_purchases   TO authenticated;
GRANT SELECT ON public.v_archive_client_engagement   TO authenticated;
