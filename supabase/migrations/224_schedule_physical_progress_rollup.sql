-- PR 9c group (c): BOQ-value-weighted physical progress rollup views, wired
-- into mv_project_exec_summary's previously-hardcoded NULL placeholder.
--
-- boqs.grand_total_etb is already a stored, trigger-maintained column
-- (recalc_boq_grand_totals) -- no need to recompute a "weight_pct" per item
-- inline; the weighting here is just total_etb / SUM(total_etb) over the
-- same node_type IN ('line_item','lump_sum') scope recalc_boq_grand_totals
-- and v_boq_items_flat already use for "priced" items.
--
-- Both views stay default SECURITY INVOKER per plan -- they only read
-- boq_items/boqs/schedules/schedule_tasks, all of which are already
-- RLS-gated for their own SELECT policies, so there is no privilege gap to
-- close here the way there was for the group (b) write-side trigger.

CREATE VIEW v_boq_item_physical_progress
WITH (security_invoker = true) AS
WITH tracked_tasks AS (
  -- Only tasks belonging to a schedule whose boq_id matches the project's
  -- CURRENT approved BOQ count -- same staleness rule as
  -- v_schedule_tasks_with_stale_boq_links (PR 9b, migration 219). A task
  -- linked through a superseded schedule/BOQ pairing contributes nothing.
  SELECT st.progress_pct, stbi.boq_item_id
  FROM schedule_tasks st
  JOIN schedules s ON s.id = st.schedule_id
  JOIN v_boq_current_per_project cur ON cur.project_id = s.project_id AND cur.boq_id = s.boq_id
  JOIN schedule_task_boq_items stbi ON stbi.schedule_task_id = st.id
)
SELECT
  bi.id AS item_id,
  bi.boq_id,
  b.project_id,
  bi.name,
  bi.node_type,
  bi.total_etb,
  (SELECT AVG(tt.progress_pct) FROM tracked_tasks tt WHERE tt.boq_item_id = bi.id) AS progress_pct,
  (SELECT COUNT(*) FROM tracked_tasks tt WHERE tt.boq_item_id = bi.id) AS linked_task_count
FROM boq_items bi
JOIN boqs b ON b.id = bi.boq_id
WHERE bi.node_type IN ('line_item', 'lump_sum') AND b.status = 'approved';

COMMENT ON VIEW v_boq_item_physical_progress IS
  'Per-item physical progress from linked, non-stale schedule tasks. progress_pct is NULL when no current schedule tracks the item -- distinct from a confirmed 0%.';

-- Project-level rollup, weighted by each item's share of the BOQ's total
-- value -- NOT a naive average across items. Untracked items count as 0%
-- of their own value rather than being excluded from the denominator:
-- leaving them out would inflate the percentage the moment any scope goes
-- unscheduled, which is the opposite of what an exec-facing number should do.
--
-- NULL when the project has no current approved BOQ, or when nothing in it
-- has ever been linked to a schedule task yet -- "not tracked" is kept
-- distinct from "tracked and genuinely at 0%", consistent with the same
-- principle behind the staleness NULL in v_boq_item_physical_progress: a
-- wrong-but-present percentage is worse than a visible "unavailable" state.
CREATE VIEW v_project_physical_progress
WITH (security_invoker = true) AS
WITH project_totals AS (
  SELECT
    ip.project_id,
    ip.boq_id,
    SUM(ip.total_etb) AS total_value,
    SUM(ip.total_etb * COALESCE(ip.progress_pct, 0)) AS weighted_progress_numerator,
    bool_or(ip.linked_task_count > 0) AS has_any_tracking
  FROM v_boq_item_physical_progress ip
  GROUP BY ip.project_id, ip.boq_id
)
SELECT
  pt.project_id,
  pt.boq_id,
  CASE
    WHEN NOT pt.has_any_tracking OR pt.total_value = 0 THEN NULL
    ELSE round(pt.weighted_progress_numerator / pt.total_value, 2)
  END AS physical_progress_pct
FROM project_totals pt;

COMMENT ON VIEW v_project_physical_progress IS
  'Value-weighted physical progress per project (total_etb-weighted, not a naive average). NULL when there is no current approved BOQ or nothing in it is tracked by a schedule yet.';

-- mv_project_exec_summary: replace the NULL::numeric placeholder with the
-- real value. DROP+CREATE is required (materialized view queries can't be
-- altered in place); the unique index backing REFRESH ... CONCURRENTLY and
-- the health_status index, plus the existing table-level grants, are
-- recreated identically afterward.
--
-- mv_exec_gadget_margin_leaderboard (PR #6, migration 195) selects FROM
-- mv_project_exec_summary, so a plain DROP fails on a dependency error;
-- CASCADE takes it down too, and it is recreated below with its own
-- unchanged definition, index, and grants -- refresh_exec_dashboard()
-- already refreshes mv_project_exec_summary before the gadget MVs, so
-- nothing there needs to change.

DROP MATERIALIZED VIEW mv_project_exec_summary CASCADE;

CREATE MATERIALIZED VIEW mv_project_exec_summary AS
WITH proj AS (
  SELECT p.id AS project_id,
    p.project_name,
    p.stage,
    p.contract_value AS contract_value_etb,
    p.project_manager_id AS assigned_pm_staff_id,
    p.client_id,
    p.updated_at
   FROM projects p
  WHERE p.active_for_year
), budget AS (
  SELECT s.project_id,
    COALESCE(s.total_budget, 0::numeric) AS budget_total,
    COALESCE(s.total_committed_with_labor, 0::numeric) AS committed_total,
    COALESCE(s.total_actual_with_labor, 0::numeric) AS actual_total
   FROM v_project_budget_summary s
), client_ar AS (
  SELECT s.project_id,
    sum(COALESCE(s.amount, 0::numeric)) AS client_outstanding_total,
    max(GREATEST(0, (EXTRACT(epoch FROM now() - COALESCE(s.date::timestamp with time zone, s.created_at)) / 86400.0)::integer)) AS client_outstanding_oldest_days
   FROM sales s
  WHERE s.payment_date IS NULL AND (s.approval_status = ANY (ARRAY['manager_approved'::sale_approval_status, 'finance_approved'::sale_approval_status])) AND NOT COALESCE(s.is_archived, false) AND s.project_id IS NOT NULL
  GROUP BY s.project_id
), client_totals AS (
  SELECT s.project_id,
    sum(COALESCE(s.amount, 0::numeric)) FILTER (WHERE s.approval_status = ANY (ARRAY['manager_approved'::sale_approval_status, 'finance_approved'::sale_approval_status])) AS client_invoiced_total,
    sum(COALESCE(s.amount, 0::numeric)) FILTER (WHERE s.payment_date IS NOT NULL) AS client_paid_total
   FROM sales s
  WHERE s.project_id IS NOT NULL
  GROUP BY s.project_id
), vendor_ap AS (
  SELECT e.project_id,
    sum(COALESCE(e.amount_etb, 0::numeric)) AS vendor_approved_unpaid_total,
    max(GREATEST(0, (EXTRACT(epoch FROM now() - COALESCE(e.date::timestamp with time zone, e.created_at)) / 86400.0)::integer)) AS vendor_approved_unpaid_oldest_days
   FROM expenses e
  WHERE e.payment_status IS NOT TRUE AND (e.approval_status = ANY (ARRAY['manager_approved'::expense_approval_status, 'finance_approved'::expense_approval_status])) AND NOT COALESCE(e.is_archived, false) AND e.project_id IS NOT NULL
  GROUP BY e.project_id
), hse AS (
  SELECT hi.project_id,
    count(*) FILTER (WHERE hi.incident_date >= (now() - '7 days'::interval)::date) AS hse_incidents_last_7d,
    count(*) FILTER (WHERE hi.incident_date >= (now() - '30 days'::interval)::date) AS hse_incidents_last_30d
   FROM hse_incidents hi
  WHERE hi.project_id IS NOT NULL
  GROUP BY hi.project_id
), wo AS (
  SELECT w.project_id,
    count(*) FILTER (WHERE lower(COALESCE(w.status, ''::text)) <> 'completed'::text) AS open_work_orders,
    count(*) FILTER (WHERE lower(COALESCE(w.status, ''::text)) <> 'completed'::text AND w.target_completion_date < CURRENT_DATE) AS overdue_work_orders
   FROM work_orders w
  WHERE w.project_id IS NOT NULL
  GROUP BY w.project_id
), phys AS (
  SELECT pp.project_id, pp.physical_progress_pct
  FROM v_project_physical_progress pp
), combined AS (
  SELECT p.project_id,
    p.project_name,
    p.stage,
    p.contract_value_etb,
    p.assigned_pm_staff_id,
    pm.employee_name AS pm_name,
    p.client_id,
    c.client_name,
    p.updated_at AS last_activity_at,
    GREATEST(0, (EXTRACT(epoch FROM now() - p.updated_at) / 86400.0)::integer) AS days_since_last_activity,
    NULL::integer AS days_in_stage,
    NULL::timestamp with time zone AS stage_entered_at,
    COALESCE(b.budget_total, 0::numeric) AS budget_total,
    COALESCE(b.committed_total, 0::numeric) AS committed_total,
    COALESCE(b.actual_total, 0::numeric) AS actual_total,
    GREATEST(COALESCE(b.budget_total, 0::numeric) - COALESCE(b.actual_total, 0::numeric) - COALESCE(b.committed_total, 0::numeric), 0::numeric) AS remaining_budget,
    CASE
      WHEN COALESCE(b.budget_total, 0::numeric) > 0::numeric THEN round((COALESCE(b.actual_total, 0::numeric) + COALESCE(b.committed_total, 0::numeric)) / b.budget_total * 100::numeric, 1)
      ELSE NULL::numeric
    END AS budget_utilization_pct,
    COALESCE(ct.client_invoiced_total, 0::numeric) AS client_invoiced_total,
    COALESCE(ct.client_paid_total, 0::numeric) AS client_paid_total,
    COALESCE(ar.client_outstanding_total, 0::numeric) AS client_outstanding_total,
    ar.client_outstanding_oldest_days,
    COALESCE(ap.vendor_approved_unpaid_total, 0::numeric) AS vendor_approved_unpaid_total,
    ap.vendor_approved_unpaid_oldest_days,
    COALESCE(p.contract_value_etb, 0::numeric) - (COALESCE(b.actual_total, 0::numeric) + COALESCE(b.committed_total, 0::numeric)) AS projected_margin_etb,
    CASE
      WHEN COALESCE(p.contract_value_etb, 0::numeric) > 0::numeric THEN round((COALESCE(p.contract_value_etb, 0::numeric) - (COALESCE(b.actual_total, 0::numeric) + COALESCE(b.committed_total, 0::numeric))) / p.contract_value_etb * 100::numeric, 1)
      ELSE NULL::numeric
    END AS projected_margin_pct,
    phys.physical_progress_pct,
    COALESCE(h.hse_incidents_last_7d, 0::bigint) AS hse_incidents_last_7d,
    COALESCE(h.hse_incidents_last_30d, 0::bigint) AS hse_incidents_last_30d,
    COALESCE(wo.open_work_orders, 0::bigint) AS open_work_orders,
    COALESCE(wo.overdue_work_orders, 0::bigint) AS overdue_work_orders
   FROM proj p
     LEFT JOIN budget b ON b.project_id = p.project_id
     LEFT JOIN client_ar ar ON ar.project_id = p.project_id
     LEFT JOIN client_totals ct ON ct.project_id = p.project_id
     LEFT JOIN vendor_ap ap ON ap.project_id = p.project_id
     LEFT JOIN hse h ON h.project_id = p.project_id
     LEFT JOIN wo ON wo.project_id = p.project_id
     LEFT JOIN staff pm ON pm.id = p.assigned_pm_staff_id
     LEFT JOIN clients c ON c.id = p.client_id
     LEFT JOIN phys ON phys.project_id = p.project_id
), lights AS (
  SELECT c.project_id,
    c.project_name,
    c.stage,
    c.contract_value_etb,
    c.assigned_pm_staff_id,
    c.pm_name,
    c.client_id,
    c.client_name,
    c.last_activity_at,
    c.days_since_last_activity,
    c.days_in_stage,
    c.stage_entered_at,
    c.budget_total,
    c.committed_total,
    c.actual_total,
    c.remaining_budget,
    c.budget_utilization_pct,
    c.client_invoiced_total,
    c.client_paid_total,
    c.client_outstanding_total,
    c.client_outstanding_oldest_days,
    c.vendor_approved_unpaid_total,
    c.vendor_approved_unpaid_oldest_days,
    c.projected_margin_etb,
    c.projected_margin_pct,
    c.physical_progress_pct,
    c.hse_incidents_last_7d,
    c.hse_incidents_last_30d,
    c.open_work_orders,
    c.overdue_work_orders,
    array_remove(ARRAY[
      CASE
        WHEN c.actual_total > c.budget_total AND c.budget_total > 0::numeric THEN 'Budget overrun'::text
        ELSE NULL::text
      END,
      CASE
        WHEN c.client_outstanding_oldest_days > 60 THEN ('Client invoice '::text || c.client_outstanding_oldest_days) || ' days overdue'::text
        ELSE NULL::text
      END,
      CASE
        WHEN c.vendor_approved_unpaid_oldest_days > 45 THEN ('Vendor unpaid '::text || c.vendor_approved_unpaid_oldest_days) || ' days'::text
        ELSE NULL::text
      END,
      CASE
        WHEN c.hse_incidents_last_7d > 0 THEN 'HSE incident last week'::text
        ELSE NULL::text
      END,
      CASE
        WHEN c.days_since_last_activity > 14 THEN ('No activity for '::text || c.days_since_last_activity) || ' days'::text
        ELSE NULL::text
      END], NULL::text) AS red_reasons,
    array_remove(ARRAY[
      CASE
        WHEN c.budget_utilization_pct > 85::numeric AND c.budget_utilization_pct <= 100::numeric THEN ('Budget at '::text || c.budget_utilization_pct) || '%'::text
        ELSE NULL::text
      END,
      CASE
        WHEN c.client_outstanding_oldest_days >= 30 AND c.client_outstanding_oldest_days <= 60 THEN ('Client invoice aging ('::text || c.client_outstanding_oldest_days) || 'd)'::text
        ELSE NULL::text
      END,
      CASE
        WHEN c.vendor_approved_unpaid_oldest_days >= 30 AND c.vendor_approved_unpaid_oldest_days <= 45 THEN ('Vendor unpaid '::text || c.vendor_approved_unpaid_oldest_days) || ' days'::text
        ELSE NULL::text
      END,
      CASE
        WHEN c.days_since_last_activity >= 7 AND c.days_since_last_activity <= 14 THEN ('Quiet for '::text || c.days_since_last_activity) || ' days'::text
        ELSE NULL::text
      END], NULL::text) AS yellow_reasons
   FROM combined c
)
SELECT project_id,
  project_name,
  stage,
  stage_entered_at,
  days_in_stage,
  assigned_pm_staff_id,
  pm_name,
  client_id,
  client_name,
  last_activity_at,
  days_since_last_activity,
  contract_value_etb,
  budget_total,
  committed_total,
  actual_total,
  remaining_budget,
  budget_utilization_pct,
  client_invoiced_total,
  client_paid_total,
  client_outstanding_total,
  client_outstanding_oldest_days,
  vendor_approved_unpaid_total,
  vendor_approved_unpaid_oldest_days,
  projected_margin_etb,
  projected_margin_pct,
  physical_progress_pct,
  hse_incidents_last_7d,
  hse_incidents_last_30d,
  open_work_orders,
  overdue_work_orders,
  CASE
    WHEN cardinality(red_reasons) > 0 THEN 'red'::text
    WHEN cardinality(yellow_reasons) > 0 THEN 'yellow'::text
    ELSE 'green'::text
  END AS health_status,
  CASE
    WHEN cardinality(red_reasons) > 0 THEN red_reasons
    WHEN cardinality(yellow_reasons) > 0 THEN yellow_reasons
    ELSE ARRAY[]::text[]
  END AS health_reasons,
  now() AS refreshed_at
 FROM lights l;

CREATE UNIQUE INDEX idx_mv_project_exec_summary_pk ON public.mv_project_exec_summary USING btree (project_id);
CREATE INDEX idx_mv_project_exec_summary_health ON public.mv_project_exec_summary USING btree (health_status);

GRANT ALL ON mv_project_exec_summary TO postgres, anon, authenticated, service_role;

-- Recreate mv_exec_gadget_margin_leaderboard, taken down by the CASCADE
-- above. Definition, index, and grants are unchanged from migration 195.

CREATE MATERIALIZED VIEW mv_exec_gadget_margin_leaderboard AS
WITH scored AS (
  SELECT mv_project_exec_summary.project_id,
    mv_project_exec_summary.project_name,
    mv_project_exec_summary.contract_value_etb,
    mv_project_exec_summary.projected_margin_etb,
    mv_project_exec_summary.projected_margin_pct,
    mv_project_exec_summary.health_status
   FROM mv_project_exec_summary
  WHERE mv_project_exec_summary.projected_margin_pct IS NOT NULL AND mv_project_exec_summary.days_since_last_activity < 365
), top5 AS (
  SELECT scored.project_id,
    scored.project_name,
    scored.contract_value_etb,
    scored.projected_margin_etb,
    scored.projected_margin_pct,
    scored.health_status,
    'top'::text AS side,
    row_number() OVER (ORDER BY scored.projected_margin_pct DESC) AS rank
   FROM scored
), bot5 AS (
  SELECT scored.project_id,
    scored.project_name,
    scored.contract_value_etb,
    scored.projected_margin_etb,
    scored.projected_margin_pct,
    scored.health_status,
    'bottom'::text AS side,
    row_number() OVER (ORDER BY scored.projected_margin_pct) AS rank
   FROM scored
)
SELECT top5.project_id,
  top5.project_name,
  top5.contract_value_etb,
  top5.projected_margin_etb,
  top5.projected_margin_pct,
  top5.health_status,
  top5.side,
  top5.rank
 FROM top5
WHERE top5.rank <= 5
UNION ALL
SELECT bot5.project_id,
  bot5.project_name,
  bot5.contract_value_etb,
  bot5.projected_margin_etb,
  bot5.projected_margin_pct,
  bot5.health_status,
  bot5.side,
  bot5.rank
 FROM bot5
WHERE bot5.rank <= 5;

CREATE UNIQUE INDEX idx_mv_margin_pk ON public.mv_exec_gadget_margin_leaderboard USING btree (side, rank);

GRANT ALL ON mv_exec_gadget_margin_leaderboard TO postgres, anon, authenticated, service_role;
