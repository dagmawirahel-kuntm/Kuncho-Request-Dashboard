-- ============================================================
-- Extend the Phase 1 budgeting views with the three new cost sources
-- from this batch — stock issues (Materials), labor allocations/
-- requisitions/timesheet (Labor), subcontractor engagements/
-- certificates (Subcontract) — without touching project_budgets, the
-- views' overall shape, or budget_check_mode. Every existing CTE
-- (budgets, expense_amounts, bundle_amounts) is reproduced verbatim
-- from migration 070; only new CTEs are added to the UNION ALL that
-- feeds `combined`.
--
-- ── New Committed/Actual sources, and the reasoning behind each ──
--
-- Materials (stock_issue_actual): a stock_issues row with
-- issue_type = 'project_use' is immediate Actual cost the moment it's
-- issued (unit_cost_snapshot × quantity, stamped once at issue time by
-- 090/091's check_and_fulfill_from_stock — never recomputed live, so a
-- later receipt-price change can't rewrite a historical issue's cost).
-- No Committed counterpart — stock fulfillment never creates a future
-- obligation the way a PO does.
--
-- Labor (labor_allocation_committed + timesheet_actual +
-- labor_requisition_committed): this is the one genuine "conversion"
-- pattern in this batch, matching the same allocate-then-realize shape
-- Materials already uses (a sourcing_bundle's committed value
-- disappears the instant it becomes a paid expense — see 070's header).
-- An allocation's Committed is its full planned span (day_rate_snapshot
-- x days from start_date to end_date, or to CURRENT_DATE if still
-- open) MINUS however many of those days already have a completed
-- timesheet entry (both check_in_time and check_out_time set) for that
-- same staff+project — so Committed shrinks toward zero as real
-- attendance is logged, and Actual (timesheet_actual, day_rate x one
-- day per completed shift) grows to take its place. This is a
-- documented approximation, not a precise payroll calculation: "one
-- completed shift = one day at the staff member's day rate," not a
-- hilarious-to-get-wrong fractional-hour computation, since nothing in
-- this schema defines a standard shift length to divide by.
-- labor_requisitions only contributes once approved (status =
-- 'approved') — pending/rejected requisitions are not a commitment.
--
-- Subcontract (subcontract_engagement_committed): agreed_amount minus
-- whatever's already flowed into a linked expense (paid or unpaid) is
-- the remaining Committed headroom on the contract; any linked expense
-- itself is already bucketed into Actual/Committed by the EXISTING,
-- unmodified expense_amounts CTE below (category-driven, same as every
-- other cost group) — no special-casing needed there. Because
-- migration 095's trigger makes it impossible to create an expense
-- against an engagement with zero certificates, any expense that shows
-- up here already implies "certified" by construction; combined with
-- expense_amounts' existing paid/unpaid split, the two CTEs together
-- correctly reproduce "certified + paid = Actual, agreed minus
-- certified-and-paid = Committed" without needing a third bucket.
--
-- Labor's is_provisional flag is DELIBERATELY left exactly as it was
-- (cost_group_name = 'Labor', still true) even though this migration
-- makes it meaningfully less understated than before — this table now
-- has real timesheet-derived Actual, not just whatever ad-hoc
-- Labor-category expenses existed. Promoting Labor out of "provisional"
-- (which would pull it into the headline core totals/margin) is a
-- separate decision, made only after a real project's numbers are
-- hand-checked, per the standing rule that nothing changes what feeds
-- enforcing/headline figures without that check first.
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
-- ── New: stock issued straight to a project (Materials Actual) ──────
stock_issue_actual AS (
  SELECT
    si.project_id,
    (SELECT id FROM cost_groups WHERE name = 'Materials') AS cost_group_id,
    COALESCE(si.total_cost, 0) AS actual_amount,
    0::numeric AS committed_amount
  FROM stock_issues si
  WHERE si.project_id IS NOT NULL AND si.issue_type = 'project_use'
),
-- ── New: routine staff assignments (Labor Committed, shrinking as
-- timesheet days are logged for the same staff+project) ─────────────
labor_allocation_committed AS (
  SELECT
    la.project_id,
    (SELECT id FROM cost_groups WHERE name = 'Labor') AS cost_group_id,
    0::numeric AS actual_amount,
    GREATEST(
      (COALESCE(la.end_date, CURRENT_DATE) - la.start_date + 1)
      - COALESCE((
          SELECT count(*) FROM timesheet t
          WHERE t.staff_id = la.staff_id AND t.project_id = la.project_id
            AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
            AND t.date BETWEEN la.start_date AND COALESCE(la.end_date, CURRENT_DATE)
        ), 0),
      0
    ) * COALESCE(la.day_rate_snapshot, 0) AS committed_amount
  FROM labor_allocations la
  WHERE la.status IN ('planned', 'active') AND la.project_id IS NOT NULL
),
-- ── New: completed shifts (Labor Actual) — one completed shift (both
-- check_in_time and check_out_time set) = one day at the staff
-- member's effective day rate ─────────────────────────────────────
timesheet_actual AS (
  SELECT
    t.project_id,
    (SELECT id FROM cost_groups WHERE name = 'Labor') AS cost_group_id,
    COALESCE(staff_effective_day_rate(t.staff_id), 0) AS actual_amount,
    0::numeric AS committed_amount
  FROM timesheet t
  WHERE t.project_id IS NOT NULL AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
),
-- ── New: approved new/casual-labor requisitions (Labor Committed) ───
labor_requisition_committed AS (
  SELECT
    lr.project_id,
    (SELECT id FROM cost_groups WHERE name = 'Labor') AS cost_group_id,
    0::numeric AS actual_amount,
    COALESCE(lr.estimated_total_cost, 0) AS committed_amount
  FROM labor_requisitions lr
  WHERE lr.status = 'approved'
),
-- ── New: subcontract engagements not yet fully absorbed into expenses
-- (Subcontract Committed headroom on the agreed contract value) ─────
subcontract_engagement_committed AS (
  SELECT
    se.project_id,
    se.cost_group_id,
    0::numeric AS actual_amount,
    GREATEST(se.agreed_amount - COALESCE(spent.total, 0), 0) AS committed_amount
  FROM subcontractor_engagements se
  LEFT JOIN (
    SELECT subcontractor_engagement_id, SUM(COALESCE(amount_etb, 0)) AS total
    FROM expenses
    WHERE subcontractor_engagement_id IS NOT NULL
    GROUP BY subcontractor_engagement_id
  ) spent ON spent.subcontractor_engagement_id = se.id
  WHERE se.status IN ('agreed', 'in_progress') AND se.project_id IS NOT NULL
),
combined AS (
  SELECT project_id, cost_group_id, SUM(actual_amount) AS actual_amount, SUM(committed_amount) AS committed_amount
  FROM (
    SELECT * FROM expense_amounts
    UNION ALL
    SELECT * FROM bundle_amounts
    UNION ALL
    SELECT * FROM stock_issue_actual
    UNION ALL
    SELECT * FROM labor_allocation_committed
    UNION ALL
    SELECT * FROM timesheet_actual
    UNION ALL
    SELECT * FROM labor_requisition_committed
    UNION ALL
    SELECT * FROM subcontract_engagement_committed
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

-- v_project_budget_summary is unchanged — it aggregates whatever
-- v_project_cost_group_budget produces, so it inherits the new sources
-- automatically with zero edits needed here. Re-declared with CREATE
-- OR REPLACE anyway, verbatim from 070, so this migration is a
-- complete, self-contained statement of both views' current state.
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

-- Verify: same hand-check targets as 070, so any drift for Endale
-- House / Solomon Apartment (which per this session's earlier fiscal
-- discovery have NO labor_allocations/labor_requisitions/
-- subcontractor_engagements/stock_issues rows yet, since those tables
-- are brand new) should show IDENTICAL figures to before this
-- migration — the only source of any drift for these two specific
-- projects would be pre-existing timesheet rows with project_id set,
-- which now (correctly, intentionally) contribute to Labor Actual for
-- the first time.
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
