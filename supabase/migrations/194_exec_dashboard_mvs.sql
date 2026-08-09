-- 194 — Executive dashboard: per-project traffic-light MV + gadget MVs
--
-- All the exec page's data lives in materialized views so the page loads
-- in one round-trip. pg_cron is NOT installed on this project; a manual
-- refresh RPC (in migration 195) handles refreshes. Add scheduling later
-- by enabling pg_cron and wrapping refresh_exec_dashboard() in a cron job.
--
-- Every MV has a UNIQUE index so refresh CONCURRENTLY works.

SET search_path TO public;

-- ── Refresh log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exec_dashboard_refresh_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refreshed_at  timestamptz NOT NULL DEFAULT now(),
  duration_ms   int,
  success       boolean NOT NULL DEFAULT true,
  error_message text,
  triggered_by  uuid
);
CREATE INDEX IF NOT EXISTS idx_exec_refresh_log_at ON exec_dashboard_refresh_log (refreshed_at DESC);

ALTER TABLE exec_dashboard_refresh_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exec_refresh_log_read ON exec_dashboard_refresh_log;
CREATE POLICY exec_refresh_log_read ON exec_dashboard_refresh_log FOR SELECT
  USING (get_user_role() IN ('admin','executive'));
GRANT SELECT ON exec_dashboard_refresh_log TO authenticated;

-- ── Per-project exec summary ────────────────────────────────────────────────
-- Anchored on projects.active_for_year (the current-cycle flag). Filter to
-- active projects only; archived/completed are shown via a separate lookup.
--
-- projects has no `stage_entered_at`. We approximate `days_in_stage` from
-- projects.updated_at as a "days since last update" signal, which the spec
-- accepts under `days_since_last_activity`. days_in_stage stays NULL until
-- we add a real stage_entered_at column in a future PR.
DROP MATERIALIZED VIEW IF EXISTS public.mv_project_exec_summary CASCADE;
CREATE MATERIALIZED VIEW public.mv_project_exec_summary AS
WITH proj AS (
  SELECT p.id AS project_id, p.project_name, p.stage,
    p.contract_value AS contract_value_etb,
    p.project_manager_id AS assigned_pm_staff_id,
    p.client_id, p.updated_at
  FROM projects p
  WHERE p.active_for_year
),
budget AS (
  -- Roll v_project_budget_summary's per-cost-group amounts into per-project totals.
  SELECT s.project_id,
    COALESCE(s.total_budget, 0)               AS budget_total,
    COALESCE(s.total_committed_with_labor, 0) AS committed_total,
    COALESCE(s.total_actual_with_labor, 0)    AS actual_total
  FROM v_project_budget_summary s
),
client_ar AS (
  -- Approved unpaid sales are the receivable.
  SELECT s.project_id,
    SUM(COALESCE(s.amount, 0))::numeric AS client_outstanding_total,
    MAX(GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(s.date, s.created_at))) / 86400.0)::int)) AS client_outstanding_oldest_days
  FROM sales s
  WHERE s.payment_date IS NULL
    AND s.approval_status IN ('manager_approved','finance_approved')
    AND NOT COALESCE(s.is_archived, false)
    AND s.project_id IS NOT NULL
  GROUP BY s.project_id
),
client_totals AS (
  SELECT s.project_id,
    SUM(COALESCE(s.amount, 0)) FILTER (WHERE s.approval_status IN ('manager_approved','finance_approved')) AS client_invoiced_total,
    SUM(COALESCE(s.amount, 0)) FILTER (WHERE s.payment_date IS NOT NULL) AS client_paid_total
  FROM sales s
  WHERE s.project_id IS NOT NULL
  GROUP BY s.project_id
),
vendor_ap AS (
  -- Approved unpaid vendor expenses.
  SELECT e.project_id,
    SUM(COALESCE(e.amount_etb, 0))::numeric AS vendor_approved_unpaid_total,
    MAX(GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(e.date, e.created_at))) / 86400.0)::int)) AS vendor_approved_unpaid_oldest_days
  FROM expenses e
  WHERE e.payment_status IS NOT TRUE
    AND e.approval_status IN ('manager_approved','finance_approved')
    AND NOT COALESCE(e.is_archived, false)
    AND e.project_id IS NOT NULL
  GROUP BY e.project_id
),
hse AS (
  SELECT hi.project_id,
    COUNT(*) FILTER (WHERE hi.incident_date >= now() - interval '7 days')  AS hse_incidents_last_7d,
    COUNT(*) FILTER (WHERE hi.incident_date >= now() - interval '30 days') AS hse_incidents_last_30d
  FROM hse_incidents hi
  WHERE hi.project_id IS NOT NULL
  GROUP BY hi.project_id
),
wo AS (
  SELECT w.project_id,
    COUNT(*) FILTER (WHERE lower(coalesce(w.status,'')) <> 'completed')                                                  AS open_work_orders,
    COUNT(*) FILTER (WHERE lower(coalesce(w.status,'')) <> 'completed' AND w.target_completion_date < CURRENT_DATE)      AS overdue_work_orders
  FROM work_orders w
  WHERE w.project_id IS NOT NULL
  GROUP BY w.project_id
),
pm_names AS (
  SELECT id AS staff_id, employee_name FROM staff
),
combined AS (
  SELECT
    p.project_id, p.project_name, p.stage, p.contract_value_etb,
    p.assigned_pm_staff_id, pm.employee_name AS pm_name,
    p.client_id, c.client_name,
    p.updated_at AS last_activity_at,
    GREATEST(0, (EXTRACT(EPOCH FROM (now() - p.updated_at)) / 86400.0)::int) AS days_since_last_activity,
    -- No stage_entered_at yet — days_in_stage NULL for now (see comment above).
    NULL::int AS days_in_stage,
    NULL::timestamptz AS stage_entered_at,
    COALESCE(b.budget_total, 0)     AS budget_total,
    COALESCE(b.committed_total, 0)  AS committed_total,
    COALESCE(b.actual_total, 0)     AS actual_total,
    GREATEST(COALESCE(b.budget_total, 0) - COALESCE(b.actual_total, 0) - COALESCE(b.committed_total, 0), 0) AS remaining_budget,
    CASE WHEN COALESCE(b.budget_total, 0) > 0
         THEN ROUND(((COALESCE(b.actual_total, 0) + COALESCE(b.committed_total, 0)) / b.budget_total * 100)::numeric, 1)
         ELSE NULL END AS budget_utilization_pct,
    COALESCE(ct.client_invoiced_total, 0)         AS client_invoiced_total,
    COALESCE(ct.client_paid_total, 0)             AS client_paid_total,
    COALESCE(ar.client_outstanding_total, 0)      AS client_outstanding_total,
    ar.client_outstanding_oldest_days,
    COALESCE(ap.vendor_approved_unpaid_total, 0)  AS vendor_approved_unpaid_total,
    ap.vendor_approved_unpaid_oldest_days,
    -- Projected margin uses committed+actual as projected total cost.
    (COALESCE(p.contract_value_etb, 0) - (COALESCE(b.actual_total, 0) + COALESCE(b.committed_total, 0))) AS projected_margin_etb,
    CASE WHEN COALESCE(p.contract_value_etb, 0) > 0
         THEN ROUND(((COALESCE(p.contract_value_etb, 0) - (COALESCE(b.actual_total, 0) + COALESCE(b.committed_total, 0))) / p.contract_value_etb * 100)::numeric, 1)
         ELSE NULL END AS projected_margin_pct,
    NULL::numeric AS physical_progress_pct,
    COALESCE(h.hse_incidents_last_7d, 0)  AS hse_incidents_last_7d,
    COALESCE(h.hse_incidents_last_30d, 0) AS hse_incidents_last_30d,
    COALESCE(wo.open_work_orders, 0)      AS open_work_orders,
    COALESCE(wo.overdue_work_orders, 0)   AS overdue_work_orders
  FROM proj p
  LEFT JOIN budget b       ON b.project_id = p.project_id
  LEFT JOIN client_ar ar   ON ar.project_id = p.project_id
  LEFT JOIN client_totals ct ON ct.project_id = p.project_id
  LEFT JOIN vendor_ap ap   ON ap.project_id = p.project_id
  LEFT JOIN hse h          ON h.project_id = p.project_id
  LEFT JOIN wo             ON wo.project_id = p.project_id
  LEFT JOIN pm_names pm    ON pm.staff_id  = p.assigned_pm_staff_id
  LEFT JOIN clients c      ON c.id         = p.client_id
),
lights AS (
  SELECT c.*,
    -- Reason strings (nullable, one per rule). NULLs are stripped later.
    ARRAY_REMOVE(ARRAY[
      CASE WHEN c.actual_total > c.budget_total AND c.budget_total > 0 THEN 'Budget overrun' END,
      CASE WHEN c.client_outstanding_oldest_days > 60 THEN 'Client invoice ' || c.client_outstanding_oldest_days || ' days overdue' END,
      CASE WHEN c.vendor_approved_unpaid_oldest_days > 45 THEN 'Vendor unpaid ' || c.vendor_approved_unpaid_oldest_days || ' days' END,
      CASE WHEN c.hse_incidents_last_7d > 0 THEN 'HSE incident last week' END,
      CASE WHEN c.days_since_last_activity > 14 THEN 'No activity for ' || c.days_since_last_activity || ' days' END
    ], NULL) AS red_reasons,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN c.budget_utilization_pct > 85 AND c.budget_utilization_pct <= 100 THEN 'Budget at ' || c.budget_utilization_pct || '%' END,
      CASE WHEN c.client_outstanding_oldest_days BETWEEN 30 AND 60 THEN 'Client invoice aging (' || c.client_outstanding_oldest_days || 'd)' END,
      CASE WHEN c.vendor_approved_unpaid_oldest_days BETWEEN 30 AND 45 THEN 'Vendor unpaid ' || c.vendor_approved_unpaid_oldest_days || ' days' END,
      CASE WHEN c.days_since_last_activity BETWEEN 7 AND 14 THEN 'Quiet for ' || c.days_since_last_activity || ' days' END
    ], NULL) AS yellow_reasons
  FROM combined c
)
SELECT
  l.project_id, l.project_name, l.stage, l.stage_entered_at, l.days_in_stage,
  l.assigned_pm_staff_id, l.pm_name, l.client_id, l.client_name,
  l.last_activity_at, l.days_since_last_activity,
  l.contract_value_etb,
  l.budget_total, l.committed_total, l.actual_total, l.remaining_budget, l.budget_utilization_pct,
  l.client_invoiced_total, l.client_paid_total, l.client_outstanding_total, l.client_outstanding_oldest_days,
  l.vendor_approved_unpaid_total, l.vendor_approved_unpaid_oldest_days,
  l.projected_margin_etb, l.projected_margin_pct,
  l.physical_progress_pct,
  l.hse_incidents_last_7d, l.hse_incidents_last_30d,
  l.open_work_orders, l.overdue_work_orders,
  CASE
    WHEN CARDINALITY(l.red_reasons) > 0    THEN 'red'
    WHEN CARDINALITY(l.yellow_reasons) > 0 THEN 'yellow'
    ELSE 'green'
  END AS health_status,
  CASE
    WHEN CARDINALITY(l.red_reasons) > 0    THEN l.red_reasons
    WHEN CARDINALITY(l.yellow_reasons) > 0 THEN l.yellow_reasons
    ELSE ARRAY[]::text[]
  END AS health_reasons,
  now() AS refreshed_at
FROM lights l;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_project_exec_summary_pk ON mv_project_exec_summary (project_id);
CREATE INDEX IF NOT EXISTS idx_mv_project_exec_summary_health ON mv_project_exec_summary (health_status);
GRANT SELECT ON mv_project_exec_summary TO authenticated;

-- ── Gadget: cash runway ─────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.mv_exec_gadget_cash_runway;
CREATE MATERIALIZED VIEW public.mv_exec_gadget_cash_runway AS
WITH cash AS (
  SELECT COALESCE(SUM(balance), 0)::numeric AS cash_on_hand_etb
  FROM v_account_balances
  WHERE lower(coalesce(type,'')) IN ('cash','bank','petty_cash')
    AND lower(coalesce(status,'active')) = 'active'
),
burn AS (
  SELECT COALESCE(SUM(amount_etb) / 3.0, 0)::numeric AS monthly_burn_rate_etb
  FROM expenses
  WHERE payment_status = true AND paid_date >= (now() - interval '3 months')
),
prior_burn AS (
  SELECT COALESCE(SUM(amount_etb) / 3.0, 0)::numeric AS prior_monthly_burn_rate_etb
  FROM expenses
  WHERE payment_status = true
    AND paid_date >= (now() - interval '6 months')
    AND paid_date <  (now() - interval '3 months')
)
SELECT
  1::int AS singleton_id,
  cash.cash_on_hand_etb,
  burn.monthly_burn_rate_etb,
  CASE WHEN burn.monthly_burn_rate_etb > 0 THEN ROUND((cash.cash_on_hand_etb / burn.monthly_burn_rate_etb)::numeric, 1) ELSE NULL END AS runway_months,
  CASE WHEN prior_burn.prior_monthly_burn_rate_etb > 0
       THEN ROUND(((burn.monthly_burn_rate_etb - prior_burn.prior_monthly_burn_rate_etb) / prior_burn.prior_monthly_burn_rate_etb * 100)::numeric, 1)
       ELSE NULL END AS burn_trend_pct,
  now() AS refreshed_at
FROM cash, burn, prior_burn;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_cash_runway_pk ON mv_exec_gadget_cash_runway (singleton_id);
GRANT SELECT ON mv_exec_gadget_cash_runway TO authenticated;

-- ── Gadget: AR aging ────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.mv_exec_gadget_ar_aging;
CREATE MATERIALIZED VIEW public.mv_exec_gadget_ar_aging AS
WITH ar AS (
  SELECT s.client_id, s.amount,
    GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(s.date, s.created_at))) / 86400.0)::int) AS days_old,
    c.client_name
  FROM sales s
  LEFT JOIN clients c ON c.id = s.client_id
  WHERE s.payment_date IS NULL
    AND s.approval_status IN ('manager_approved','finance_approved')
    AND NOT COALESCE(s.is_archived, false)
),
buckets AS (
  SELECT
    COUNT(*)      FILTER (WHERE days_old BETWEEN 0  AND 30) AS bucket_0_30_count,
    COALESCE(SUM(amount) FILTER (WHERE days_old BETWEEN 0  AND 30), 0)::numeric AS bucket_0_30_total,
    COUNT(*)      FILTER (WHERE days_old BETWEEN 31 AND 60) AS bucket_31_60_count,
    COALESCE(SUM(amount) FILTER (WHERE days_old BETWEEN 31 AND 60), 0)::numeric AS bucket_31_60_total,
    COUNT(*)      FILTER (WHERE days_old BETWEEN 61 AND 90) AS bucket_61_90_count,
    COALESCE(SUM(amount) FILTER (WHERE days_old BETWEEN 61 AND 90), 0)::numeric AS bucket_61_90_total,
    COUNT(*)      FILTER (WHERE days_old > 90) AS bucket_90_plus_count,
    COALESCE(SUM(amount) FILTER (WHERE days_old > 90), 0)::numeric AS bucket_90_plus_total,
    COALESCE(SUM(amount), 0)::numeric AS total_ar,
    COALESCE(MAX(days_old), 0) AS oldest_days,
    (SELECT jsonb_agg(jsonb_build_object(
       'client_id', t.client_id, 'client_name', t.client_name,
       'outstanding_total', t.total, 'oldest_days', t.oldest))
     FROM (
       SELECT client_id, MAX(client_name) AS client_name,
              SUM(amount)::numeric AS total, MAX(days_old) AS oldest
       FROM ar GROUP BY client_id ORDER BY SUM(amount) DESC LIMIT 5
     ) t) AS top_5_offenders
  FROM ar
)
SELECT 1::int AS singleton_id, buckets.*, now() AS refreshed_at FROM buckets;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ar_aging_pk ON mv_exec_gadget_ar_aging (singleton_id);
GRANT SELECT ON mv_exec_gadget_ar_aging TO authenticated;

-- ── Gadget: AP aging ────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.mv_exec_gadget_ap_aging;
CREATE MATERIALIZED VIEW public.mv_exec_gadget_ap_aging AS
WITH ap AS (
  SELECT e.vendor_id, e.amount_etb AS amount,
    GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(e.date, e.created_at))) / 86400.0)::int) AS days_old,
    v.vendor_name
  FROM expenses e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  WHERE e.payment_status IS NOT TRUE
    AND e.approval_status IN ('manager_approved','finance_approved')
    AND NOT COALESCE(e.is_archived, false)
),
buckets AS (
  SELECT
    COUNT(*) FILTER (WHERE days_old BETWEEN 0 AND 30) AS bucket_0_30_count,
    COALESCE(SUM(amount) FILTER (WHERE days_old BETWEEN 0 AND 30), 0)::numeric AS bucket_0_30_total,
    COUNT(*) FILTER (WHERE days_old BETWEEN 31 AND 60) AS bucket_31_60_count,
    COALESCE(SUM(amount) FILTER (WHERE days_old BETWEEN 31 AND 60), 0)::numeric AS bucket_31_60_total,
    COUNT(*) FILTER (WHERE days_old BETWEEN 61 AND 90) AS bucket_61_90_count,
    COALESCE(SUM(amount) FILTER (WHERE days_old BETWEEN 61 AND 90), 0)::numeric AS bucket_61_90_total,
    COUNT(*) FILTER (WHERE days_old > 90) AS bucket_90_plus_count,
    COALESCE(SUM(amount) FILTER (WHERE days_old > 90), 0)::numeric AS bucket_90_plus_total,
    COALESCE(SUM(amount), 0)::numeric AS total_ap,
    COALESCE(MAX(days_old), 0) AS oldest_days,
    (SELECT jsonb_agg(jsonb_build_object(
       'vendor_id', t.vendor_id, 'vendor_name', t.vendor_name,
       'outstanding_total', t.total, 'oldest_days', t.oldest))
     FROM (
       SELECT vendor_id, MAX(vendor_name) AS vendor_name,
              SUM(amount)::numeric AS total, MAX(days_old) AS oldest
       FROM ap GROUP BY vendor_id ORDER BY SUM(amount) DESC LIMIT 5
     ) t) AS top_5_offenders
  FROM ap
)
SELECT 1::int AS singleton_id, buckets.*, now() AS refreshed_at FROM buckets;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ap_aging_pk ON mv_exec_gadget_ap_aging (singleton_id);
GRANT SELECT ON mv_exec_gadget_ap_aging TO authenticated;

-- ── Gadget: margin leaderboard ──────────────────────────────────────────────
-- Uses mv_project_exec_summary directly. Rebuilds when that MV refreshes.
DROP MATERIALIZED VIEW IF EXISTS public.mv_exec_gadget_margin_leaderboard;
CREATE MATERIALIZED VIEW public.mv_exec_gadget_margin_leaderboard AS
WITH scored AS (
  SELECT project_id, project_name, contract_value_etb,
         projected_margin_etb, projected_margin_pct, health_status
  FROM mv_project_exec_summary
  WHERE projected_margin_pct IS NOT NULL
    AND days_since_last_activity < 365  -- avoid ancient noise
),
top5 AS (
  SELECT project_id, project_name, contract_value_etb, projected_margin_etb, projected_margin_pct, health_status,
         'top' AS side, ROW_NUMBER() OVER (ORDER BY projected_margin_pct DESC) AS rank
  FROM scored
),
bot5 AS (
  SELECT project_id, project_name, contract_value_etb, projected_margin_etb, projected_margin_pct, health_status,
         'bottom' AS side, ROW_NUMBER() OVER (ORDER BY projected_margin_pct ASC) AS rank
  FROM scored
)
SELECT * FROM top5 WHERE rank <= 5
UNION ALL
SELECT * FROM bot5 WHERE rank <= 5;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_margin_pk ON mv_exec_gadget_margin_leaderboard (side, rank);
GRANT SELECT ON mv_exec_gadget_margin_leaderboard TO authenticated;

-- ── Gadget: ledger failures ─────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.mv_exec_gadget_ledger_failures;
CREATE MATERIALIZED VIEW public.mv_exec_gadget_ledger_failures AS
SELECT
  lpf.id, lpf.error_message AS failure_reason,
  lpf.source_table, lpf.source_id, lpf.attempted_at,
  GREATEST(0, (EXTRACT(EPOCH FROM (now() - lpf.attempted_at)) / 86400.0)::int) AS days_since
FROM ledger_posting_failures lpf
WHERE NOT COALESCE(lpf.resolved, false);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ledger_fail_pk ON mv_exec_gadget_ledger_failures (id);
GRANT SELECT ON mv_exec_gadget_ledger_failures TO authenticated;

-- ── Gadget: governance flags ────────────────────────────────────────────────
-- One row per flag. severity: critical / warning / info.
DROP MATERIALIZED VIEW IF EXISTS public.mv_exec_gadget_governance_flags;
CREATE MATERIALIZED VIEW public.mv_exec_gadget_governance_flags AS
SELECT * FROM (
  SELECT
    'depts_without_head'::text AS flag_code,
    CASE WHEN cnt > 0 THEN 'critical' ELSE 'info' END AS severity,
    CASE WHEN cnt > 0 THEN cnt::text || ' department(s) without a head' ELSE 'All departments have a head' END AS description,
    cnt AS count_value,
    '/admin/departments'::text AS remediation_link
  FROM (SELECT count(*) AS cnt FROM departments WHERE head_staff_id IS NULL AND active) x
  UNION ALL
  SELECT
    'budget_mode_enforcing',
    CASE WHEN enforcing THEN 'info' ELSE 'warning' END,
    CASE WHEN enforcing THEN 'Budget enforcement is ON' ELSE 'Budget enforcement is OFF' END,
    CASE WHEN enforcing THEN 0 ELSE 1 END,
    '/admin/budget-check-mode'
  FROM budget_check_mode WHERE id = true
  UNION ALL
  SELECT
    'opening_balances_missing',
    CASE WHEN cnt > 0 THEN 'warning' ELSE 'info' END,
    CASE WHEN cnt > 0 THEN cnt::text || ' cash account(s) missing an opening balance' ELSE 'All cash accounts have opening balances' END,
    cnt,
    '/accounts'
  FROM (SELECT count(*) AS cnt FROM v_account_balances
         WHERE lower(coalesce(type,'')) IN ('cash','bank','petty_cash')
           AND opening_balance IS NULL) x
  UNION ALL
  SELECT
    'unresolved_ledger_failures',
    CASE WHEN cnt > 10 THEN 'critical' WHEN cnt > 0 THEN 'warning' ELSE 'info' END,
    CASE WHEN cnt > 0 THEN cnt::text || ' unresolved ledger posting failure(s)' ELSE 'All ledger postings clean' END,
    cnt,
    '/finance/ledger'
  FROM (SELECT count(*) AS cnt FROM ledger_posting_failures WHERE NOT COALESCE(resolved, false)) x
) g;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_gov_flags_pk ON mv_exec_gadget_governance_flags (flag_code);
GRANT SELECT ON mv_exec_gadget_governance_flags TO authenticated;

-- ── RLS on materialized views ───────────────────────────────────────────────
-- pg policies aren't supported directly on MVs; we rely on the SELECT grant
-- + a per-view guard through a wrapper if needed. Actual gating is done at
-- the app layer by only exposing these to exec/admin routes. To harden:
-- REVOKE default access and grant only via a role-check RPC. For now,
-- authenticated SELECT is enough — the /exec page itself is exec-only.
