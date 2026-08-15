-- Two related bugs in labor budget tracking, both dormant until the
-- rollup RPC actually started succeeding (219/220/221/222 fixed the
-- chain of bugs blocking it):
--
-- 1. rollup_labor_timesheets_to_expense() never set category_id on the
--    expenses it creates. Without a category, v_project_cost_group_budget
--    can't map the expense to the Labor cost group, so its committed/
--    actual amount silently lands under "Unallocated" instead.
--
-- 2. v_project_cost_group_budget's labor_requisition_committed CTE
--    counts an approved requisition's full estimated_total_cost as
--    "committed" for as long as it stays approved, with no notion that
--    part (or all) of that estimate has since been realized as a real
--    expense row. Once a rollup succeeds, the same money gets counted
--    twice: once as the still-open estimate, once as the new expense's
--    own committed amount (which is now correctly bucketed into Labor
--    thanks to fix 1). Concretely, on Mesob Exhibition Center A: Gypsum
--    Board worker (30,000, not yet rolled up) + Welder (15,000
--    estimate, PLUS 15,000 again from its own rolled-up expense) = a
--    60,000 committed figure instead of the correct 45,000.
--
-- Fix: net out already-rolled-up amounts from the requisition's
-- estimate, but only the portion that's actually "realized" (paid,
-- partially paid, or approved) — matching exactly what expense_amounts
-- itself counts for that expense. A still-pending or rejected rollup
-- draft isn't yet contributing anything via expense_amounts, so it
-- must not shrink the estimate either, or that portion of the
-- commitment would vanish from the budget entirely until the draft
-- is approved.

-- Backfill: the 3 existing rollup-generated expenses missing a category.
UPDATE expenses
SET category_id = (SELECT id FROM categories WHERE category_name = 'Labor')
WHERE rolled_up_from_requisition_id IS NOT NULL AND category_id IS NULL;

-- Fix 1: stamp category_id on future rollups.
CREATE OR REPLACE FUNCTION public.rollup_labor_timesheets_to_expense(p_labor_requisition_id uuid, p_period_start date, p_period_end date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req            labor_requisitions%ROWTYPE;
  v_existing_id    uuid;
  v_expense_id     uuid;
  v_total          numeric := 0;
  v_worker_count   int     := 0;
  v_days_or_vol    numeric := 0;
  v_project_name   text;
  v_desc           text;
  v_labor_cat_id   uuid;
BEGIN
  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_labor_requisition_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition % not found', p_labor_requisition_id; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'Requisition must be approved before rollup (current: %)', v_req.status; END IF;

  SELECT id INTO v_existing_id FROM expenses
   WHERE rolled_up_from_requisition_id = p_labor_requisition_id
     AND rollup_period_start = p_period_start AND rollup_period_end = p_period_end;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rollup_workers (
    staff_id uuid, days_worked numeric, day_rate numeric, subtotal numeric
  ) ON COMMIT DROP;
  DELETE FROM _rollup_workers WHERE true;

  IF v_req.payment_basis = 'per_volume' THEN
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
    SELECT
      ts.staff_id,
      SUM(COALESCE(ts.volume_completed, 0)) AS days_worked,
      v_req.unit_rate AS day_rate,
      SUM(COALESCE(ts.volume_completed, 0)) * v_req.unit_rate AS subtotal
    FROM timesheet ts
    LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
    WHERE ts.labor_requisition_id = p_labor_requisition_id
      AND ts.rolled_up_expense_id IS NULL
      AND ts.date BETWEEN p_period_start AND p_period_end
      AND ts.check_in_time IS NOT NULL AND ts.check_out_time IS NOT NULL
      AND ts.staff_id IS NOT NULL
      AND COALESCE(ts.volume_completed, 0) > 0
      AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
    GROUP BY ts.staff_id
    HAVING SUM(COALESCE(ts.volume_completed, 0)) > 0;
  ELSE
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
    SELECT
      combined.staff_id,
      SUM(combined.days_worked) AS days_worked,
      MAX(combined.day_rate)    AS day_rate,
      SUM(combined.days_worked) * MAX(combined.day_rate) AS subtotal
    FROM (
      SELECT
        ts.staff_id,
        COALESCE(ts.days_worked, 1)::numeric AS days_worked,
        COALESCE(ts.day_rate, la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
      FROM timesheet ts
      LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = ts.staff_id
      WHERE ts.labor_requisition_id = p_labor_requisition_id
        AND ts.rolled_up_expense_id IS NULL
        AND ts.date BETWEEN p_period_start AND p_period_end
        AND ts.check_in_time IS NOT NULL AND ts.check_out_time IS NOT NULL
        AND ts.staff_id IS NOT NULL
        AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
      UNION ALL
      SELECT
        att.staff_id,
        1::numeric AS days_worked,
        COALESCE(la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
      FROM timesheet_attendance att
      LEFT JOIN labor_allocations la ON la.staff_id = att.staff_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = att.staff_id
      WHERE att.labor_requisition_id = p_labor_requisition_id
        AND att.rolled_up_expense_id IS NULL
        AND att.work_date BETWEEN p_period_start AND p_period_end
    ) combined
    GROUP BY combined.staff_id;
  END IF;

  SELECT COALESCE(SUM(subtotal),0), COUNT(*), COALESCE(SUM(days_worked),0)
    INTO v_total, v_worker_count, v_days_or_vol FROM _rollup_workers;

  IF v_worker_count = 0 THEN
    RAISE EXCEPTION 'No un-rolled timesheets found in period % to %', p_period_start, p_period_end;
  END IF;

  SELECT project_name INTO v_project_name FROM projects WHERE id = v_req.project_id;
  v_desc := v_project_name || ' · Labor · ' || v_req.role_needed
    || ' · ' || to_char(p_period_start, 'YYYY-MM-DD') || '→' || to_char(p_period_end, 'YYYY-MM-DD');

  SELECT id INTO v_labor_cat_id FROM categories WHERE category_name = 'Labor';

  INSERT INTO expenses
    (item_service_description, amount_etb, expense_type, project_id, date,
     approval_status, payment_state, category_id,
     rolled_up_from_requisition_id, rollup_period_start, rollup_period_end)
  VALUES
    (v_desc, v_total, 'labor_payment'::expense_category, v_req.project_id, p_period_end,
     'pending'::expense_approval_status, 'unpaid', v_labor_cat_id,
     p_labor_requisition_id, p_period_start, p_period_end)
  RETURNING id INTO v_expense_id;

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal)
  SELECT v_expense_id, w.staff_id, w.days_worked, w.day_rate, w.subtotal FROM _rollup_workers w;

  UPDATE timesheet SET rolled_up_expense_id = v_expense_id
   WHERE labor_requisition_id = p_labor_requisition_id
     AND rolled_up_expense_id IS NULL
     AND date BETWEEN p_period_start AND p_period_end
     AND check_in_time IS NOT NULL AND check_out_time IS NOT NULL
     AND staff_id IS NOT NULL;

  IF v_req.payment_basis = 'per_day' THEN
    UPDATE timesheet_attendance SET rolled_up_expense_id = v_expense_id
     WHERE labor_requisition_id = p_labor_requisition_id
       AND rolled_up_expense_id IS NULL
       AND work_date BETWEEN p_period_start AND p_period_end;
  END IF;

  RETURN v_expense_id;
END $function$;

-- Fix 2: net out already-rolled-up (non-rejected) amounts from the
-- requisition's static estimate so it isn't double-counted alongside
-- the real expense's own committed/actual amount.
CREATE OR REPLACE VIEW public.v_project_cost_group_budget AS
WITH budgets AS (
  SELECT pb.project_id, pb.cost_group_id, pb.budgeted_amount
  FROM project_budgets pb
  JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
), expense_amounts AS (
  SELECT e.project_id, c.cost_group_id,
    CASE
      WHEN e.payment_status THEN COALESCE(e.amount_etb, 0::numeric)
      WHEN e.partially_paid THEN COALESCE(e.partial_paid_amount, 0::numeric)
      ELSE 0::numeric
    END AS actual_amount,
    CASE
      WHEN e.payment_status THEN 0::numeric
      WHEN e.partially_paid THEN GREATEST(COALESCE(e.amount_etb, 0::numeric) - COALESCE(e.partial_paid_amount, 0::numeric), 0::numeric)
      WHEN e.approval_status = ANY (ARRAY['manager_approved'::expense_approval_status, 'finance_approved'::expense_approval_status]) THEN COALESCE(e.amount_etb, 0::numeric)
      ELSE 0::numeric
    END AS committed_amount
  FROM expenses e
  LEFT JOIN categories c ON c.id = e.category_id
  WHERE e.project_id IS NOT NULL
), bundle_amounts AS (
  SELECT o.project_id, cat.cost_group_id,
    0::numeric AS actual_amount,
    COALESCE(sbi.quantity_actual, 0::numeric) * COALESCE(sbi.unit_price_actual, 0::numeric) AS committed_amount
  FROM sourcing_bundles sb
  JOIN sourcing_bundle_items sbi ON sbi.bundle_id = sb.id
  JOIN order_items oi ON oi.id = sbi.order_item_id
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
  LEFT JOIN categories cat ON cat.id = sc.parent_category_id
  WHERE (sb.status = ANY (ARRAY['ordered'::sourcing_bundle_status, 'fulfilled'::sourcing_bundle_status])) AND sb.expense_id IS NULL AND o.project_id IS NOT NULL
), stock_issue_actual AS (
  SELECT si.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Materials'::text) AS cost_group_id,
    COALESCE(si.total_cost, 0::numeric) AS actual_amount,
    0::numeric AS committed_amount
  FROM stock_issues si
  WHERE si.project_id IS NOT NULL AND si.issue_type = 'project_use'::text
), labor_allocation_committed AS (
  SELECT la.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Labor'::text) AS cost_group_id,
    0::numeric AS actual_amount,
    GREATEST(COALESCE(la.end_date, CURRENT_DATE) - la.start_date + 1 - COALESCE((
      SELECT count(*) AS count FROM timesheet t
      WHERE t.staff_id = la.staff_id AND t.project_id = la.project_id AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
        AND t.date >= la.start_date AND t.date <= COALESCE(la.end_date, CURRENT_DATE)
    ), 0::bigint), 0::bigint)::numeric * COALESCE(la.day_rate_snapshot, 0::numeric) AS committed_amount
  FROM labor_allocations la
  WHERE (la.status = ANY (ARRAY['planned'::text, 'active'::text])) AND la.project_id IS NOT NULL AND NOT (EXISTS (
    SELECT 1 FROM labor_requisitions lr WHERE lr.id = la.labor_requisition_id AND lr.status = 'approved'::text
  ))
), timesheet_actual AS (
  SELECT t.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Labor'::text) AS cost_group_id,
    COALESCE(staff_effective_day_rate(t.staff_id), 0::numeric) AS actual_amount,
    0::numeric AS committed_amount
  FROM timesheet t
  WHERE t.project_id IS NOT NULL AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL AND t.rolled_up_expense_id IS NULL
), labor_requisition_committed AS (
  SELECT lr.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Labor'::text) AS cost_group_id,
    0::numeric AS actual_amount,
    GREATEST(
      COALESCE(lr.estimated_total_cost, 0::numeric)
      - COALESCE((
          SELECT sum(e.amount_etb) FROM expenses e
          WHERE e.rolled_up_from_requisition_id = lr.id
            AND (e.payment_status OR e.partially_paid OR e.approval_status = ANY (ARRAY['manager_approved'::expense_approval_status, 'finance_approved'::expense_approval_status]))
        ), 0::numeric),
      0::numeric
    ) AS committed_amount
  FROM labor_requisitions lr
  WHERE lr.status = 'approved'::text
), subcontract_engagement_committed AS (
  SELECT se.project_id, se.cost_group_id,
    0::numeric AS actual_amount,
    GREATEST(se.agreed_amount - COALESCE(spent.total, 0::numeric), 0::numeric) AS committed_amount
  FROM subcontractor_engagements se
  LEFT JOIN (
    SELECT expenses.subcontractor_engagement_id, sum(COALESCE(expenses.amount_etb, 0::numeric)) AS total
    FROM expenses WHERE expenses.subcontractor_engagement_id IS NOT NULL
    GROUP BY expenses.subcontractor_engagement_id
  ) spent ON spent.subcontractor_engagement_id = se.id
  WHERE (se.status = ANY (ARRAY['agreed'::text, 'in_progress'::text])) AND se.project_id IS NOT NULL
), petty_cash_transaction_actual AS (
  SELECT pcf.project_id,
    (SELECT cost_groups.id FROM cost_groups WHERE cost_groups.name = 'Overhead'::text) AS cost_group_id,
    COALESCE(pct.amount, 0::numeric) AS actual_amount,
    0::numeric AS committed_amount
  FROM petty_cash_transactions pct
  JOIN petty_cash_floats pcf ON pcf.id = pct.float_id
  WHERE pcf.project_id IS NOT NULL
), combined AS (
  SELECT u.project_id, u.cost_group_id, sum(u.actual_amount) AS actual_amount, sum(u.committed_amount) AS committed_amount
  FROM (
    SELECT project_id, cost_group_id, actual_amount, committed_amount FROM expense_amounts
    UNION ALL SELECT project_id, cost_group_id, actual_amount, committed_amount FROM bundle_amounts
    UNION ALL SELECT project_id, cost_group_id, actual_amount, committed_amount FROM stock_issue_actual
    UNION ALL SELECT project_id, cost_group_id, actual_amount, committed_amount FROM labor_allocation_committed
    UNION ALL SELECT project_id, cost_group_id, actual_amount, committed_amount FROM timesheet_actual
    UNION ALL SELECT project_id, cost_group_id, actual_amount, committed_amount FROM labor_requisition_committed
    UNION ALL SELECT project_id, cost_group_id, actual_amount, committed_amount FROM subcontract_engagement_committed
    UNION ALL SELECT project_id, cost_group_id, actual_amount, committed_amount FROM petty_cash_transaction_actual
  ) u
  GROUP BY u.project_id, u.cost_group_id
), per_group AS (
  SELECT p.id AS project_id, g.id AS cost_group_id, g.name AS cost_group_name, g.sort_order,
    COALESCE(b.budgeted_amount, 0::numeric) AS budgeted_amount,
    COALESCE(c.actual_amount, 0::numeric) AS actual_amount,
    COALESCE(c.committed_amount, 0::numeric) AS committed_amount
  FROM projects p
  CROSS JOIN cost_groups g
  LEFT JOIN budgets b ON b.project_id = p.id AND b.cost_group_id = g.id
  LEFT JOIN combined c ON c.project_id = p.id AND c.cost_group_id = g.id
  UNION ALL
  SELECT p.id, NULL::uuid AS uuid, 'Unallocated'::text, 999,
    0::numeric AS "numeric",
    COALESCE(c.actual_amount, 0::numeric) AS "coalesce",
    COALESCE(c.committed_amount, 0::numeric) AS "coalesce"
  FROM projects p
  JOIN combined c ON c.project_id = p.id AND c.cost_group_id IS NULL
  WHERE COALESCE(c.actual_amount, 0::numeric) <> 0::numeric OR COALESCE(c.committed_amount, 0::numeric) <> 0::numeric
)
SELECT project_id, cost_group_id, cost_group_name, sort_order, budgeted_amount, actual_amount, committed_amount,
  budgeted_amount - actual_amount - committed_amount AS remaining_amount,
  (actual_amount + committed_amount) > budgeted_amount AS over_budget,
  cost_group_name = 'Labor'::text AS is_provisional
FROM per_group;
