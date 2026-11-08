-- 505: Bank charges from the bank reconciliation count in their cost bucket.
--
-- The bank reconciliation books every bank charge to Bank Charges (6301):
--   * the charge a bank takes with a transfer (bank_line_charge, 440);
--   * a charge or VAT-on-charge line on the statement (bank_statement_lines,
--     classified bank_charge);
--   * a charge kept back from a client receipt (sale_receipt_split).
-- None of these is an expense, so the Overhead page never saw them. A bucket
-- now takes them by itself with the 'bank_charges' kind in
-- bucket_expense_types (503j): they count in its months, its usual month, its
-- year so far and its latest spending, grouped by bank and by how they were
-- taken. They need no approval: the bank has already taken them.
-- Only these three sources are read, never an expense, so nothing is counted
-- twice.

-- The bucket that takes bank charges; one out of use keeps its history.
CREATE OR REPLACE FUNCTION public.bank_charges_bucket()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT id FROM projects
   WHERE is_internal AND 'bank_charges' = ANY(bucket_expense_types)
   ORDER BY active_for_year DESC, project_name LIMIT 1;
$f$;

-- Spending that lands in a bucket from outside expenses: one row per ledger
-- entry. Internal: the overhead functions below read it.
CREATE OR REPLACE FUNCTION public.overhead_feed(p_from date, p_to date)
RETURNS TABLE(project_id uuid, date date, amount numeric, kind text, account_id uuid, account_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH k AS (SELECT bank_charges_bucket() AS bucket, bank_classification_coa('bank_charge', 'debit') AS coa)
  SELECT k.bucket, je.entry_date, sum(jl.debit - jl.credit),
         CASE je.source_table WHEN 'bank_line_charge' THEN 'with_transfer'
                              WHEN 'bank_statement_lines' THEN 'charge_line' ELSE 'client_receipt' END,
         l.account_id, a.account_name
    FROM k
    JOIN journal_lines jl ON jl.account_id = k.coa
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    LEFT JOIN bank_statement_lines l ON je.source_table IN ('bank_line_charge', 'bank_statement_lines') AND l.id = je.source_id
    LEFT JOIN accounts a ON a.id = l.account_id
   WHERE k.bucket IS NOT NULL
     AND je.source_table IN ('bank_line_charge', 'bank_statement_lines', 'sale_receipt_split')
     AND je.entry_date BETWEEN p_from AND p_to
   GROUP BY k.bucket, je.id, je.entry_date, je.source_table, l.account_id, a.account_name
  HAVING sum(jl.debit - jl.credit) <> 0;
$f$;
REVOKE EXECUTE ON FUNCTION public.overhead_feed(date, date) FROM PUBLIC, anon, authenticated;

-- How a group of bank charges reads in a list.
CREATE OR REPLACE FUNCTION public.overhead_feed_label(p_kind text, p_n bigint)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE p_kind WHEN 'with_transfer' THEN 'Bank charges taken with transfers'
                     WHEN 'charge_line' THEN 'Bank charge lines on the statement'
                     ELSE 'Bank charges kept from client receipts' END
         || ' (' || p_n || ')';
$f$;

CREATE OR REPLACE FUNCTION public.overhead_summary(p_months integer DEFAULT 12)
RETURNS TABLE(id uuid, name text, in_use boolean, owner_id uuid, owner_name text, monthly_budget numeric, category_id uuid, category_name text, months jsonb, this_month numeric, same_month_last_year numeric, last_12 numeric, n_costs integer, waiting_owner integer, to_sort boolean, suggested_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid, COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false) AS sees_all
  ), cur AS (
    SELECT date_trunc('month', bot_today())::date AS m
  ), ms AS (
    SELECT (cur.m - make_interval(months => k))::date AS m FROM cur, generate_series(0, GREATEST(p_months, 1) - 1) k
  ), b AS (
    SELECT p.id, btrim(p.project_name) AS name, p.active_for_year AS in_use, p.bucket_owner_id, p.bucket_monthly_budget,
           p.bucket_category_id, p.kind_sorted_at IS NULL AND p.suggested_kind IS NOT NULL AS to_sort, p.suggested_kind
      FROM projects p, me WHERE p.is_internal AND (me.sees_all OR p.bucket_owner_id = me.uid)
    UNION ALL
    SELECT NULL, 'Other company overhead', true, NULL, NULL, NULL, false, NULL FROM me WHERE me.sees_all
  ), e AS (
    SELECT x.project_id, date_trunc('month', x.date)::date AS m, x.amount_etb
      FROM expenses x, cur
     WHERE NOT COALESCE(x.is_archived, false) AND x.approval_status::text <> 'rejected' AND COALESCE(x.payment_state, '') <> 'void'
       AND (x.project_id IN (SELECT id FROM b WHERE id IS NOT NULL) OR (x.project_id IS NULL AND x.is_overhead))
       AND x.date >= (cur.m - make_interval(months => GREATEST(p_months, 13)))::date
    UNION ALL
    SELECT f.project_id, date_trunc('month', f.date)::date, f.amount
      FROM cur, overhead_feed((cur.m - make_interval(months => GREATEST(p_months, 13)))::date, (cur.m + interval '1 month')::date) f
     WHERE f.project_id IN (SELECT id FROM b WHERE id IS NOT NULL)
  )
  SELECT b.id, b.name, b.in_use, b.bucket_owner_id, u.full_name, b.bucket_monthly_budget, b.bucket_category_id, c.category_name,
         (SELECT jsonb_agg(jsonb_build_object('month', ms.m,
                   'spent', COALESCE((SELECT sum(e.amount_etb) FROM e WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m = ms.m), 0)) ORDER BY ms.m)
            FROM ms),
         COALESCE((SELECT sum(e.amount_etb) FROM e, cur WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m = cur.m), 0),
         COALESCE((SELECT sum(e.amount_etb) FROM e, cur WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m = (cur.m - interval '12 months')::date), 0),
         COALESCE((SELECT sum(e.amount_etb) FROM e, cur WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m > (cur.m - interval '12 months')::date), 0),
         (SELECT count(*)::int FROM e, cur WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m > (cur.m - interval '12 months')::date),
         (SELECT count(*)::int FROM expenses x WHERE b.bucket_owner_id IS NOT NULL AND x.project_id = b.id
             AND x.approval_status = 'pending' AND NOT COALESCE(x.is_archived, false)),
         b.to_sort, b.suggested_kind
    FROM b LEFT JOIN user_profiles u ON u.id = b.bucket_owner_id LEFT JOIN categories c ON c.id = b.bucket_category_id
   ORDER BY b.id IS NULL, b.in_use DESC, 12 DESC, b.name;
$function$;

CREATE OR REPLACE FUNCTION public.overhead_variance(p_period uuid DEFAULT NULL::uuid)
RETURNS TABLE(id uuid, name text, in_use boolean, monthly_budget numeric, usual numeric, months jsonb, fytd numeric, last_fytd numeric, fy_label text, cur_idx integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid, COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false) AS sees_all
  ), fy AS (
    SELECT f.label, f.start_date, f.end_date FROM fiscal_periods f
     WHERE (p_period IS NULL AND f.is_current) OR f.id = p_period
     ORDER BY f.start_date DESC LIMIT 1
  ), t AS (
    SELECT fy.label, fy.start_date, fy.end_date, (fy.start_date - interval '1 year')::date AS prev_start,
           LEAST(bot_today(), fy.end_date) AS today,
           (to_ethiopian(fy.start_date)).year AS ec_year
      FROM fy
  ), t2 AS (
    SELECT t.*, fiscal_month_index(t.today) AS cur_idx,
           ec_month_start_greg((to_ethiopian(t.today)).year, LEAST((to_ethiopian(t.today)).month, 12)) AS cur_month_start,
           GREATEST(1, (overhead_history(p_period)->>'usual_months')::int) AS usual_months
      FROM t
  ), b AS (
    SELECT p.id, btrim(p.project_name) AS name, p.active_for_year AS in_use, p.bucket_monthly_budget
      FROM projects p, me WHERE p.is_internal AND (me.sees_all OR p.bucket_owner_id = me.uid)
    UNION ALL
    SELECT NULL, 'Other company overhead', true, NULL FROM me WHERE me.sees_all
  ), e AS (
    SELECT x.project_id, x.date, x.amount_etb, fiscal_month_index(x.date) AS idx,
           CASE WHEN x.date BETWEEN t2.start_date AND t2.end_date THEN 'cur'
                WHEN x.date >= t2.prev_start AND x.date < t2.start_date THEN 'prev' END AS yr
      FROM expenses x, t2
     WHERE NOT COALESCE(x.is_archived, false) AND x.approval_status::text <> 'rejected' AND COALESCE(x.payment_state, '') <> 'void'
       AND (x.project_id IN (SELECT id FROM b WHERE id IS NOT NULL) OR (x.project_id IS NULL AND x.is_overhead))
       AND x.date >= LEAST(t2.prev_start, t2.cur_month_start - 366) AND x.date <= t2.end_date
    UNION ALL
    SELECT f.project_id, f.date, f.amount, fiscal_month_index(f.date),
           CASE WHEN f.date BETWEEN t2.start_date AND t2.end_date THEN 'cur'
                WHEN f.date >= t2.prev_start AND f.date < t2.start_date THEN 'prev' END
      FROM t2, overhead_feed(LEAST(t2.prev_start, t2.cur_month_start - 366), t2.end_date) f
     WHERE f.project_id IN (SELECT id FROM b WHERE id IS NOT NULL)
  )
  SELECT b.id, b.name, b.in_use, b.bucket_monthly_budget,
         round(COALESCE((SELECT sum(e.amount_etb) FROM e WHERE e.project_id IS NOT DISTINCT FROM b.id
                           AND e.date >= t2.cur_month_start - 365 AND e.date < t2.cur_month_start), 0) / t2.usual_months, 2),
         (SELECT jsonb_agg(jsonb_build_object(
                   'idx', k,
                   'start', ec_month_start_greg(CASE WHEN k < 2 THEN t2.ec_year ELSE t2.ec_year + 1 END, CASE WHEN k < 2 THEN k + 11 ELSE k - 1 END),
                   'spent', COALESCE((SELECT sum(e.amount_etb) FROM e WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.yr = 'cur' AND e.idx = k), 0),
                   'last_year', COALESCE((SELECT sum(e.amount_etb) FROM e WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.yr = 'prev' AND e.idx = k), 0))
                 ORDER BY k)
            FROM generate_series(0, 11) k),
         COALESCE((SELECT sum(e.amount_etb) FROM e WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.yr = 'cur' AND e.date <= t2.today), 0),
         COALESCE((SELECT sum(e.amount_etb) FROM e WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.yr = 'prev'
                     AND e.date <= t2.prev_start + (t2.today - t2.start_date)), 0),
         t2.label, t2.cur_idx
    FROM b, t2
   ORDER BY b.id IS NULL, b.in_use DESC, 7 DESC, b.name;
$function$;

-- A month's spending: its expenses, then its bank charges grouped by bank
-- and by how they were taken (approval_status 'bank').
CREATE OR REPLACE FUNCTION public.overhead_month_lines(p_project uuid, p_month date)
RETURNS TABLE(id uuid, expense_code text, date date, description text, amount numeric, payee text, approval_status text, payment_state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH ok AS (
    SELECT COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false)
           OR (p_project IS NOT NULL AND bucket_owner_of(p_project) = auth.uid()) AS yes
  )
  SELECT e.id, e.expense_code, e.date, e.item_service_description, e.amount_etb,
         COALESCE(v.vendor_name, s.employee_name, e.vendors_name), e.approval_status::text, e.payment_state
    FROM ok, expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN staff s ON s.id = e.paid_to_staff_id
   WHERE ok.yes
     AND (CASE WHEN p_project IS NULL THEN e.project_id IS NULL AND e.is_overhead ELSE e.project_id = p_project END)
     AND e.date BETWEEN p_month - 40 AND p_month + 40
     AND fiscal_month_ord(e.date) = fiscal_month_ord(p_month)
     AND NOT COALESCE(e.is_archived, false) AND e.approval_status::text <> 'rejected' AND COALESCE(e.payment_state, '') <> 'void'
  UNION ALL
  SELECT md5(p_project::text || f.kind || COALESCE(f.account_id::text, '') || fiscal_month_ord(p_month)::text)::uuid,
         NULL, max(f.date), overhead_feed_label(f.kind, count(*)), sum(f.amount),
         COALESCE(f.account_name, 'Client receipts'), 'bank', 'paid'
    FROM ok, overhead_feed(p_month - 40, p_month + 40) f
   WHERE ok.yes AND p_project IS NOT NULL AND f.project_id = p_project
     AND fiscal_month_ord(f.date) = fiscal_month_ord(p_month)
   GROUP BY f.kind, f.account_id, f.account_name
  ORDER BY 3 DESC, 5 DESC;
$function$;

-- A bucket's latest spending: its expenses, and its bank charges grouped by
-- fiscal month, bank and how they were taken.
CREATE OR REPLACE FUNCTION public.bucket_recent(p_project uuid, p_limit integer DEFAULT 40)
RETURNS TABLE(id uuid, expense_code text, date date, description text, amount numeric, payee text, approval_status text, payment_state text, requested_by text, rejection_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH ok AS (
    SELECT EXISTS (SELECT 1 FROM projects p WHERE p.id = p_project AND p.is_internal)
           AND (COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false) OR bucket_owner_of(p_project) = auth.uid()) AS yes
  ), rows AS (
    SELECT e.id, e.expense_code, e.date, e.item_service_description AS description, e.amount_etb AS amount,
           COALESCE(v.vendor_name, s.employee_name, e.vendors_name) AS payee, e.approval_status::text AS approval_status, e.payment_state,
           up.full_name AS requested_by, e.rejection_reason, e.created_at
      FROM ok, expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN staff s ON s.id = e.paid_to_staff_id
      LEFT JOIN user_profiles up ON up.id = e.purchaser_user_id
     WHERE ok.yes AND e.project_id = p_project AND NOT COALESCE(e.is_archived, false)
    UNION ALL
    SELECT md5(p_project::text || f.kind || COALESCE(f.account_id::text, '') || fiscal_month_ord(f.date)::text)::uuid,
           NULL, max(f.date),
           overhead_feed_label(f.kind, count(*)) || ' · ' || ec_month_name(LEAST((to_ethiopian(max(f.date))).month, 12)),
           sum(f.amount), COALESCE(f.account_name, 'Client receipts'), 'bank', 'paid', NULL, NULL, max(f.date)::timestamptz
      FROM ok, overhead_feed((bot_today() - 400)::date, bot_today()) f
     WHERE ok.yes AND f.project_id = p_project
     GROUP BY f.kind, f.account_id, f.account_name, fiscal_month_ord(f.date)
  )
  SELECT r.id, r.expense_code, r.date, r.description, r.amount, r.payee, r.approval_status, r.payment_state, r.requested_by, r.rejection_reason
    FROM rows r
   ORDER BY r.date DESC, r.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 200);
$function$;

-- The Bank & Finance Charges bucket takes them, unless a bucket already does.
UPDATE public.projects SET bucket_expense_types = array_append(bucket_expense_types, 'bank_charges')
 WHERE is_internal AND btrim(project_name) = 'Bank & Finance Charges'
   AND NOT ('bank_charges' = ANY(bucket_expense_types))
   AND NOT EXISTS (SELECT 1 FROM public.projects q WHERE q.is_internal AND 'bank_charges' = ANY(q.bucket_expense_types));
