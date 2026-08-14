-- Live budget bug, pre-existing (migrations 185/189, predates this PR
-- series): v_project_cost_group_budget's `labor_allocation_committed`
-- and `labor_requisition_committed` CTEs both independently count the
-- same hire once a named-staff ("roster request") requisition is
-- approved — approval both adds the requisition's estimated_total_cost
-- AND auto-creates a labor_allocations row, and the view counts both,
-- roughly doubling the reported committed Labor cost for that hire.
-- Concretely verified live on Mesob Exhibition Center A: a 3-day/10,000
-- ETB hire showed as 60,000 of committed budget instead of 30,000.
--
-- Fix: labor_allocation_committed now excludes any allocation whose
-- labor_requisition_id points to a currently-approved requisition,
-- since that requisition's own line item already covers it. This
-- requires labor_requisition_id to actually be set on the allocation,
-- which on_labor_req_approved_maybe_allocate (189, the "name a specific
-- staff member" path) never did — patched here to match the other two
-- allocation-creating paths (this PR's provision_tier_2_worker_from_
-- candidate and on_labor_req_approved_promote_candidate), which already
-- set it.

CREATE OR REPLACE FUNCTION public.on_labor_req_approved_maybe_allocate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_rate numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.specific_staff_id IS NOT NULL THEN
    SELECT day_rate INTO v_rate FROM staff WHERE id = NEW.specific_staff_id;
    INSERT INTO labor_allocations
      (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
    VALUES
      (NEW.specific_staff_id, NEW.project_id,
       COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
       COALESCE(NEW.estimated_day_rate, v_rate),
       'planned',
       'Auto-created from approved roster request ' || NEW.id::text,
       NEW.id);
  END IF;
  RETURN NEW;
END $$;

-- Defensive backfill: any pre-existing allocation created by the
-- unpatched trigger above (identifiable by its notes text) but never
-- linked. No matching rows exist as of writing, but this keeps the fix
-- correct if any turn up in other environments.
UPDATE labor_allocations
   SET labor_requisition_id = substring(notes from 'roster request ([0-9a-f-]{36})')::uuid
 WHERE labor_requisition_id IS NULL
   AND notes LIKE 'Auto-created from approved roster request %';

CREATE OR REPLACE VIEW public.v_project_cost_group_budget AS
WITH budgets AS (
  SELECT pb.project_id, pb.cost_group_id, pb.budgeted_amount
  FROM project_budgets pb
  JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
), expense_amounts AS (
  SELECT e.project_id, c.cost_group_id,
    CASE
      WHEN e.payment_status THEN COALESCE(e.amount_etb, 0)
      WHEN e.partially_paid THEN COALESCE(e.partial_paid_amount, 0)
      ELSE 0
    END AS actual_amount,
    CASE
      WHEN e.payment_status THEN 0
      WHEN e.partially_paid THEN GREATEST(COALESCE(e.amount_etb, 0) - COALESCE(e.partial_paid_amount, 0), 0)
      WHEN e.approval_status = ANY (ARRAY['manager_approved'::expense_approval_status, 'finance_approved'::expense_approval_status]) THEN COALESCE(e.amount_etb, 0)
      ELSE 0
    END AS committed_amount
  FROM expenses e
  LEFT JOIN categories c ON c.id = e.category_id
  WHERE e.project_id IS NOT NULL
), bundle_amounts AS (
  SELECT o.project_id, cat.cost_group_id,
    0::numeric AS actual_amount,
    COALESCE(sbi.quantity_actual, 0) * COALESCE(sbi.unit_price_actual, 0) AS committed_amount
  FROM sourcing_bundles sb
  JOIN sourcing_bundle_items sbi ON sbi.bundle_id = sb.id
  JOIN order_items oi ON oi.id = sbi.order_item_id
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
  LEFT JOIN categories cat ON cat.id = sc.parent_category_id
  WHERE (sb.status = ANY (ARRAY['ordered'::sourcing_bundle_status, 'fulfilled'::sourcing_bundle_status]))
    AND sb.expense_id IS NULL AND o.project_id IS NOT NULL
), stock_issue_actual AS (
  SELECT si.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Materials') AS cost_group_id,
    COALESCE(si.total_cost, 0) AS actual_amount,
    0::numeric AS committed_amount
  FROM stock_issues si
  WHERE si.project_id IS NOT NULL AND si.issue_type = 'project_use'
), labor_allocation_committed AS (
  SELECT la.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Labor') AS cost_group_id,
    0::numeric AS actual_amount,
    GREATEST(
      COALESCE(la.end_date, CURRENT_DATE) - la.start_date + 1
        - COALESCE((
            SELECT count(*) FROM timesheet t
            WHERE t.staff_id = la.staff_id AND t.project_id = la.project_id
              AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
              AND t.date >= la.start_date AND t.date <= COALESCE(la.end_date, CURRENT_DATE)
          ), 0),
      0
    )::numeric * COALESCE(la.day_rate_snapshot, 0) AS committed_amount
  FROM labor_allocations la
  WHERE (la.status = ANY (ARRAY['planned'::text, 'active'::text]))
    AND la.project_id IS NOT NULL
    -- Skip allocations already counted via labor_requisition_committed
    -- below — an approved requisition's estimated_total_cost already
    -- covers the hire this allocation represents.
    AND NOT EXISTS (
      SELECT 1 FROM labor_requisitions lr
      WHERE lr.id = la.labor_requisition_id AND lr.status = 'approved'
    )
), timesheet_actual AS (
  SELECT t.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Labor') AS cost_group_id,
    COALESCE(staff_effective_day_rate(t.staff_id), 0) AS actual_amount,
    0::numeric AS committed_amount
  FROM timesheet t
  WHERE t.project_id IS NOT NULL AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
    AND t.rolled_up_expense_id IS NULL
), labor_requisition_committed AS (
  SELECT lr.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Labor') AS cost_group_id,
    0::numeric AS actual_amount,
    COALESCE(lr.estimated_total_cost, 0) AS committed_amount
  FROM labor_requisitions lr
  WHERE lr.status = 'approved'
), subcontract_engagement_committed AS (
  SELECT se.project_id, se.cost_group_id,
    0::numeric AS actual_amount,
    GREATEST(se.agreed_amount - COALESCE(spent.total, 0), 0) AS committed_amount
  FROM subcontractor_engagements se
  LEFT JOIN (
    SELECT expenses.subcontractor_engagement_id, sum(COALESCE(expenses.amount_etb, 0)) AS total
    FROM expenses
    WHERE expenses.subcontractor_engagement_id IS NOT NULL
    GROUP BY expenses.subcontractor_engagement_id
  ) spent ON spent.subcontractor_engagement_id = se.id
  WHERE (se.status = ANY (ARRAY['agreed'::text, 'in_progress'::text])) AND se.project_id IS NOT NULL
), petty_cash_transaction_actual AS (
  SELECT pcf.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Overhead') AS cost_group_id,
    COALESCE(pct.amount, 0) AS actual_amount,
    0::numeric AS committed_amount
  FROM petty_cash_transactions pct
  JOIN petty_cash_floats pcf ON pcf.id = pct.float_id
  WHERE pcf.project_id IS NOT NULL
), combined AS (
  SELECT u.project_id, u.cost_group_id, sum(u.actual_amount) AS actual_amount, sum(u.committed_amount) AS committed_amount
  FROM (
    SELECT * FROM expense_amounts
    UNION ALL SELECT * FROM bundle_amounts
    UNION ALL SELECT * FROM stock_issue_actual
    UNION ALL SELECT * FROM labor_allocation_committed
    UNION ALL SELECT * FROM timesheet_actual
    UNION ALL SELECT * FROM labor_requisition_committed
    UNION ALL SELECT * FROM subcontract_engagement_committed
    UNION ALL SELECT * FROM petty_cash_transaction_actual
  ) u
  GROUP BY u.project_id, u.cost_group_id
), per_group AS (
  SELECT p.id AS project_id, g.id AS cost_group_id, g.name AS cost_group_name, g.sort_order,
    COALESCE(b.budgeted_amount, 0) AS budgeted_amount,
    COALESCE(c.actual_amount, 0) AS actual_amount,
    COALESCE(c.committed_amount, 0) AS committed_amount
  FROM projects p
  CROSS JOIN cost_groups g
  LEFT JOIN budgets b ON b.project_id = p.id AND b.cost_group_id = g.id
  LEFT JOIN combined c ON c.project_id = p.id AND c.cost_group_id = g.id
  UNION ALL
  SELECT p.id, NULL::uuid, 'Unallocated', 999,
    0::numeric, COALESCE(c.actual_amount, 0), COALESCE(c.committed_amount, 0)
  FROM projects p
  JOIN combined c ON c.project_id = p.id AND c.cost_group_id IS NULL
  WHERE COALESCE(c.actual_amount, 0) <> 0 OR COALESCE(c.committed_amount, 0) <> 0
)
SELECT project_id, cost_group_id, cost_group_name, sort_order,
  budgeted_amount, actual_amount, committed_amount,
  budgeted_amount - actual_amount - committed_amount AS remaining_amount,
  (actual_amount + committed_amount) > budgeted_amount AS over_budget,
  cost_group_name = 'Labor' AS is_provisional
FROM per_group;

GRANT SELECT ON public.v_project_cost_group_budget TO authenticated;
