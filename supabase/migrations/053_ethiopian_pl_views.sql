-- Migration 053: Ethiopian-calendar P&L views
--
-- Ethiopian tax law buckets by the Ethiopian fiscal year/month, so the
-- P&L needs a real per-Ethiopian-month breakdown, not just a Gregorian
-- label with an Ethiopian caption. This ports the same Gregorian<->
-- Ethiopian conversion used in src/lib/ethiopianCalendar.ts into
-- Postgres, then builds Ethiopian-bucketed aggregation views alongside
-- the existing Gregorian ones (v_pl_monthly / v_expenses_by_category
-- stay untouched — Gregorian remains available for budgeting).

SET search_path TO public;

DO $$ BEGIN
  CREATE TYPE public.ethiopian_date AS (year int, month int, day int);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.greg_to_jdn(y int, m int, d int)
RETURNS int LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  a int; yy int; mm int;
BEGIN
  a := (14 - m) / 12;
  yy := y + 4800 - a;
  mm := m + 12 * a - 3;
  RETURN d + (153 * mm + 2) / 5 + 365 * yy + yy / 4 - yy / 100 + yy / 400 - 32045;
END;
$$;

CREATE OR REPLACE FUNCTION public.jdn_to_ethiopian(jdn int)
RETURNS public.ethiopian_date LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  epoch_jdn CONSTANT int := 1724221;  -- 1 Meskerem, Ethiopian year 1
  n int; cyc int; rem int; yr int; is_leap boolean; year_len int; mo int; da int;
BEGIN
  n := jdn - epoch_jdn;
  cyc := n / 1461;
  rem := n - cyc * 1461;
  yr := cyc * 4 + 1;
  LOOP
    is_leap := (yr % 4 = 3);
    year_len := CASE WHEN is_leap THEN 366 ELSE 365 END;
    EXIT WHEN rem < year_len;
    rem := rem - year_len;
    yr := yr + 1;
  END LOOP;
  mo := rem / 30 + 1;
  da := rem % 30 + 1;
  RETURN ROW(yr, mo, da)::public.ethiopian_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.to_ethiopian(d date)
RETURNS public.ethiopian_date LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT public.jdn_to_ethiopian(
    public.greg_to_jdn(EXTRACT(YEAR FROM d)::int, EXTRACT(MONTH FROM d)::int, EXTRACT(DAY FROM d)::int)
  );
$$;

-- ── Ethiopian-bucketed monthly P&L ────────────────────────────────
CREATE OR REPLACE VIEW public.v_pl_monthly_et
WITH (security_invoker = true) AS
SELECT
  et.year  AS et_year,
  et.month AS et_month,
  COALESCE(SUM(t.revenue), 0)  AS revenue,
  COALESCE(SUM(t.expenses), 0) AS expenses
FROM (
  SELECT date, amount AS revenue, 0::numeric AS expenses
  FROM public.sales
  WHERE sales_status = 'Paid' AND date IS NOT NULL

  UNION ALL

  SELECT date, 0::numeric AS revenue, amount_etb AS expenses
  FROM public.expenses
  WHERE payment_status = true AND date IS NOT NULL
) t
CROSS JOIN LATERAL public.to_ethiopian(t.date) AS et
GROUP BY et.year, et.month;

-- ── Ethiopian-bucketed expense-by-category breakdown ──────────────
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
WHERE e.payment_status = true AND e.date IS NOT NULL
GROUP BY et.year, 2;

GRANT SELECT ON public.v_pl_monthly_et TO authenticated;
GRANT SELECT ON public.v_expenses_by_category_et TO authenticated;
