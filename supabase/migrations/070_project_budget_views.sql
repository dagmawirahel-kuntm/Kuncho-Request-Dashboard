-- ============================================================
-- Project budgeting: derived Actual / Committed / Remaining views.
--
-- A line counts in exactly ONE bucket, never both:
--   - Actual:    paid expenses at full amount; partially-paid expenses
--                at their partial_paid_amount only.
--   - Committed: (a) the still-unpaid remainder of an approved-but-
--                unpaid expense (full amount if untouched, or
--                amount_etb - partial_paid_amount if partially paid),
--                PLUS (b) the value of an ordered/fulfilled sourcing
--                bundle that hasn't yet been converted into an expense
--                (sourcing_bundles.expense_id IS NULL). The moment a
--                bundle becomes a real expense, its value stops being
--                counted here and flows through (a)/Actual instead —
--                bundles with expense_id set are excluded from this
--                query entirely, so nothing is ever counted twice.
--
-- Grouped at the cost_group level (migration 068). A category with no
-- cost_group_id (or an expense/PO line whose category itself has none)
-- rolls into a synthetic "Unallocated" row per project — surfaced only
-- when it actually has activity, so mapping gaps are visible instead
-- of silently dropped or silently absorbed into some other bucket.
--
-- Labor is flagged is_provisional = true on every row: the aggregate
-- payroll/timesheet system isn't linked to projects yet (see 069's
-- header), so Labor's actual/committed here only reflects whatever
-- ad-hoc "Labor"-mapped expenses/POs already exist through the normal
-- pipeline — real data, but likely an UNDERSTATEMENT of true labor
-- cost. v_project_budget_summary excludes provisional rows from its
-- headline totals/margin for that reason and exposes a separate
-- "with_labor" figure alongside.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE VIEW v_project_cost_group_budget
WITH (security_invoker = true) AS
WITH
budgets AS (
  SELECT pb.project_id, pb.cost_group_id, pb.budgeted_amount
  FROM project_budgets pb
  JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
),
expense_amounts AS (
  SELECT
    e.project_id,
    c.cost_group_id,
    CASE
      WHEN e.payment_status THEN COALESCE(e.amount_etb, 0)
      WHEN e.partially_paid THEN COALESCE(e.partial_paid_amount, 0)
      ELSE 0
    END AS actual_amount,
    CASE
      WHEN e.payment_status THEN 0
      WHEN e.partially_paid THEN GREATEST(COALESCE(e.amount_etb, 0) - COALESCE(e.partial_paid_amount, 0), 0)
      WHEN e.approval_status IN ('manager_approved', 'finance_approved') THEN COALESCE(e.amount_etb, 0)
      ELSE 0
    END AS committed_amount
  FROM expenses e
  LEFT JOIN categories c ON c.id = e.category_id
  WHERE e.project_id IS NOT NULL
),
bundle_amounts AS (
  SELECT
    o.project_id,
    cat.cost_group_id,
    0::numeric AS actual_amount,
    COALESCE(sbi.quantity_actual, 0) * COALESCE(sbi.unit_price_actual, 0) AS committed_amount
  FROM sourcing_bundles sb
  JOIN sourcing_bundle_items sbi ON sbi.bundle_id = sb.id
  JOIN order_items oi ON oi.id = sbi.order_item_id
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
  LEFT JOIN categories cat ON cat.id = sc.parent_category_id
  WHERE sb.status IN ('ordered', 'fulfilled')
    AND sb.expense_id IS NULL
    AND o.project_id IS NOT NULL
),
combined AS (
  SELECT project_id, cost_group_id, SUM(actual_amount) AS actual_amount, SUM(committed_amount) AS committed_amount
  FROM (
    SELECT * FROM expense_amounts
    UNION ALL
    SELECT * FROM bundle_amounts
  ) u
  GROUP BY project_id, cost_group_id
),
per_group AS (
  -- One row per (project, real cost group), always present even at zero
  SELECT
    p.id AS project_id,
    g.id AS cost_group_id,
    g.name AS cost_group_name,
    g.sort_order,
    COALESCE(b.budgeted_amount, 0) AS budgeted_amount,
    COALESCE(c.actual_amount, 0) AS actual_amount,
    COALESCE(c.committed_amount, 0) AS committed_amount
  FROM projects p
  CROSS JOIN cost_groups g
  LEFT JOIN budgets b ON b.project_id = p.id AND b.cost_group_id = g.id
  LEFT JOIN combined c ON c.project_id = p.id AND c.cost_group_id = g.id

  UNION ALL

  -- Unallocated: only surfaced when a project actually has activity
  -- in categories with no cost_group mapping
  SELECT
    p.id, NULL::uuid, 'Unallocated', 999,
    0::numeric,
    COALESCE(c.actual_amount, 0),
    COALESCE(c.committed_amount, 0)
  FROM projects p
  JOIN combined c ON c.project_id = p.id AND c.cost_group_id IS NULL
  WHERE COALESCE(c.actual_amount, 0) <> 0 OR COALESCE(c.committed_amount, 0) <> 0
)
SELECT
  project_id,
  cost_group_id,
  cost_group_name,
  sort_order,
  budgeted_amount,
  actual_amount,
  committed_amount,
  budgeted_amount - actual_amount - committed_amount AS remaining_amount,
  (actual_amount + committed_amount) > budgeted_amount AS over_budget,
  (cost_group_name = 'Labor') AS is_provisional
FROM per_group;

GRANT SELECT ON v_project_cost_group_budget TO authenticated;

CREATE OR REPLACE VIEW v_project_budget_summary
WITH (security_invoker = true) AS
SELECT
  p.id AS project_id,
  p.contract_value,
  p.budget_version,
  p.budget_baseline_locked_at,
  COALESCE(SUM(g.budgeted_amount), 0) AS total_budget,
  COALESCE(SUM(g.actual_amount) FILTER (WHERE NOT g.is_provisional), 0)    AS total_actual_core,
  COALESCE(SUM(g.committed_amount) FILTER (WHERE NOT g.is_provisional), 0) AS total_committed_core,
  COALESCE(SUM(g.actual_amount), 0)    AS total_actual_with_labor,
  COALESCE(SUM(g.committed_amount), 0) AS total_committed_with_labor,
  COALESCE(bool_or(g.over_budget), false) AS any_group_over_budget,
  CASE WHEN COALESCE(p.contract_value, 0) > 0 THEN
    (p.contract_value - COALESCE(SUM(g.budgeted_amount), 0)) / p.contract_value
  ELSE NULL END AS bid_margin,
  CASE WHEN COALESCE(p.contract_value, 0) > 0 THEN
    (p.contract_value - (COALESCE(SUM(g.actual_amount) FILTER (WHERE NOT g.is_provisional), 0)
                        + COALESCE(SUM(g.committed_amount) FILTER (WHERE NOT g.is_provisional), 0))) / p.contract_value
  ELSE NULL END AS projected_margin_core
FROM projects p
LEFT JOIN v_project_cost_group_budget g ON g.project_id = p.id
GROUP BY p.id, p.contract_value, p.budget_version, p.budget_baseline_locked_at;

GRANT SELECT ON v_project_budget_summary TO authenticated;

-- Verify: budget-by-group for the first couple of named projects, for
-- hand-checking against Endale House / Solomon Apartment per the
-- Phase 1 rollout plan.
SELECT p.project_name, g.*
FROM v_project_cost_group_budget g
JOIN projects p ON p.id = g.project_id
WHERE p.project_name ILIKE '%Endale%' OR p.project_name ILIKE '%Solomon%'
ORDER BY p.project_name, g.sort_order;

SELECT p.project_name, s.*
FROM v_project_budget_summary s
JOIN projects p ON p.id = s.project_id
WHERE p.project_name ILIKE '%Endale%' OR p.project_name ILIKE '%Solomon%'
ORDER BY p.project_name;
