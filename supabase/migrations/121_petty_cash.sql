-- ============================================================
-- Petty cash: float, spend, replenishment (spec §1).
--
-- The 'Petty' category already exists and is mapped to the Overhead
-- cost group (072) — this does NOT re-map it. What's missing is the
-- mechanism itself:
--   - petty_cash_floats: a fixed sum handed to a custodian (staff),
--     optionally scoped to one project, with a running current_balance.
--   - petty_cash_transactions: ordinary spends out of a float —
--     immediate, no approval (small, receipted, already the fast path
--     the spec asks for), each one debits the float's current_balance
--     via trigger.
--   - petty_cash_replenishments: a distinct "top the float back up"
--     request, single-tier per the manual's authority limit — up to
--     ETB 5,000 approvable by admin/manager/finance (standing in for
--     the manual's "Site/Office Admin", since no such system role
--     exists — see the requires_pm_approval note below), above that
--     only admin or project_manager can approve. On approval, credits
--     the float's current_balance via trigger. Deliberately NOT a
--     multi-tier chain like cash_advances' manager->finance sequence.
--
-- Aggregation: v_project_cost_group_budget (096) is re-declared here,
-- verbatim, with one new CTE (petty_cash_transaction_actual) added to
-- the `combined` UNION ALL so project-scoped petty spend lands in
-- Overhead's Actual alongside normal expenses — same shape as every
-- other source CTE in that view (hardcoded cost_group lookup,
-- project_id IS NOT NULL). Floats with no project_id (office-wide,
-- not tied to one project) simply don't have a project home in this
-- per-project view, same as every other source here.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS petty_cash_floats (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custodian_staff_id UUID NOT NULL REFERENCES staff(id),
  project_id         UUID REFERENCES projects(id),
  float_amount       NUMERIC(12,2) NOT NULL,
  current_balance    NUMERIC(12,2) NOT NULL DEFAULT 0,
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_floats_custodian ON petty_cash_floats(custodian_staff_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_floats_project ON petty_cash_floats(project_id);

CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  float_id         UUID NOT NULL REFERENCES petty_cash_floats(id),
  amount           NUMERIC(12,2) NOT NULL,
  purpose          TEXT NOT NULL,
  receipt_attached BOOLEAN NOT NULL DEFAULT false,
  recorded_by      UUID REFERENCES user_profiles(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_transactions_float ON petty_cash_transactions(float_id);

CREATE TABLE IF NOT EXISTS petty_cash_replenishments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  float_id            UUID NOT NULL REFERENCES petty_cash_floats(id),
  amount_requested    NUMERIC(12,2) NOT NULL,
  requires_pm_approval BOOLEAN GENERATED ALWAYS AS (amount_requested > 5000) STORED,
  requested_by        UUID REFERENCES user_profiles(id),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by         UUID REFERENCES user_profiles(id),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_replenishments_float ON petty_cash_replenishments(float_id);

-- ── Balance maintenance ──────────────────────────────────────────────
-- SECURITY DEFINER: a custodian can insert their own spend/replenishment
-- rows (per the RLS policies below) but has no UPDATE policy on
-- petty_cash_floats itself — without running as definer, this trigger's
-- own UPDATE would silently affect 0 rows under the invoker's RLS,
-- leaving current_balance never actually adjusted.
CREATE OR REPLACE FUNCTION debit_petty_cash_on_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE petty_cash_floats SET current_balance = current_balance - NEW.amount WHERE id = NEW.float_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_debit_petty_cash_on_transaction ON petty_cash_transactions;
CREATE TRIGGER trg_debit_petty_cash_on_transaction
  AFTER INSERT ON petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION debit_petty_cash_on_transaction();

CREATE OR REPLACE FUNCTION credit_petty_cash_on_replenishment_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    UPDATE petty_cash_floats SET current_balance = current_balance + NEW.amount_requested WHERE id = NEW.float_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_credit_petty_cash_on_replenishment_approval ON petty_cash_replenishments;
CREATE TRIGGER trg_credit_petty_cash_on_replenishment_approval
  AFTER UPDATE OF status ON petty_cash_replenishments
  FOR EACH ROW EXECUTE FUNCTION credit_petty_cash_on_replenishment_approval();

-- Above ETB 5,000, only admin or project_manager can approve — the
-- system-role stand-in for "escalating to PM"; below that, admin/
-- manager/finance can (standing in for "Site/Office Admin", which
-- isn't a real user_role value in this codebase).
--
-- Checks NEW.amount_requested > 5000 directly rather than
-- NEW.requires_pm_approval: GENERATED ALWAYS AS ... STORED columns
-- are not yet computed when a BEFORE trigger runs (Postgres computes
-- them after BEFORE triggers, right before the write) — NEW on a
-- generated column reads as NULL there, which would have silently
-- defeated this check.
CREATE OR REPLACE FUNCTION enforce_petty_replenishment_approval_authority()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.amount_requested > 5000 AND get_user_role() NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Replenishments over ETB 5,000 need Project Manager (or admin) approval';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_petty_replenishment_approval_authority ON petty_cash_replenishments;
CREATE TRIGGER trg_enforce_petty_replenishment_approval_authority
  BEFORE UPDATE OF status ON petty_cash_replenishments
  FOR EACH ROW EXECUTE FUNCTION enforce_petty_replenishment_approval_authority();

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE petty_cash_floats ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_replenishments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "petty_floats_manage" ON petty_cash_floats;
CREATE POLICY "petty_floats_manage" ON petty_cash_floats FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'project_manager'));

DROP POLICY IF EXISTS "petty_floats_own_select" ON petty_cash_floats;
CREATE POLICY "petty_floats_own_select" ON petty_cash_floats FOR SELECT
  USING (
    custodian_staff_id IN (
      SELECT id FROM staff WHERE user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "petty_transactions_manage" ON petty_cash_transactions;
CREATE POLICY "petty_transactions_manage" ON petty_cash_transactions FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'project_manager'));

DROP POLICY IF EXISTS "petty_transactions_own" ON petty_cash_transactions;
CREATE POLICY "petty_transactions_own" ON petty_cash_transactions FOR SELECT
  USING (
    float_id IN (
      SELECT id FROM petty_cash_floats WHERE custodian_staff_id IN (
        SELECT id FROM staff WHERE user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email')
      )
    )
  );

DROP POLICY IF EXISTS "petty_transactions_own_insert" ON petty_cash_transactions;
CREATE POLICY "petty_transactions_own_insert" ON petty_cash_transactions FOR INSERT
  WITH CHECK (
    float_id IN (
      SELECT id FROM petty_cash_floats WHERE active AND custodian_staff_id IN (
        SELECT id FROM staff WHERE user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email')
      )
    )
  );

DROP POLICY IF EXISTS "petty_replenishments_manage" ON petty_cash_replenishments;
CREATE POLICY "petty_replenishments_manage" ON petty_cash_replenishments FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'project_manager'));

DROP POLICY IF EXISTS "petty_replenishments_own_select" ON petty_cash_replenishments;
CREATE POLICY "petty_replenishments_own_select" ON petty_cash_replenishments FOR SELECT
  USING (
    float_id IN (
      SELECT id FROM petty_cash_floats WHERE custodian_staff_id IN (
        SELECT id FROM staff WHERE user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email')
      )
    )
  );

DROP POLICY IF EXISTS "petty_replenishments_own_insert" ON petty_cash_replenishments;
CREATE POLICY "petty_replenishments_own_insert" ON petty_cash_replenishments FOR INSERT
  WITH CHECK (
    status = 'pending'
    AND float_id IN (
      SELECT id FROM petty_cash_floats WHERE active AND custodian_staff_id IN (
        SELECT id FROM staff WHERE user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email')
      )
    )
  );

-- ── Aggregation: extend v_project_cost_group_budget (096), verbatim
-- plus one new CTE ──────────────────────────────────────────────────
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
stock_issue_actual AS (
  SELECT
    si.project_id,
    (SELECT id FROM cost_groups WHERE name = 'Materials') AS cost_group_id,
    COALESCE(si.total_cost, 0) AS actual_amount,
    0::numeric AS committed_amount
  FROM stock_issues si
  WHERE si.project_id IS NOT NULL AND si.issue_type = 'project_use'
),
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
timesheet_actual AS (
  SELECT
    t.project_id,
    (SELECT id FROM cost_groups WHERE name = 'Labor') AS cost_group_id,
    COALESCE(staff_effective_day_rate(t.staff_id), 0) AS actual_amount,
    0::numeric AS committed_amount
  FROM timesheet t
  WHERE t.project_id IS NOT NULL AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
),
labor_requisition_committed AS (
  SELECT
    lr.project_id,
    (SELECT id FROM cost_groups WHERE name = 'Labor') AS cost_group_id,
    0::numeric AS actual_amount,
    COALESCE(lr.estimated_total_cost, 0) AS committed_amount
  FROM labor_requisitions lr
  WHERE lr.status = 'approved'
),
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
-- ── New: petty cash spend against a project-scoped float (Overhead
-- Actual) — floats with no project_id have no home in this per-
-- project view, same as every other source above ──────────────────
petty_cash_transaction_actual AS (
  SELECT
    pcf.project_id,
    (SELECT id FROM cost_groups WHERE name = 'Overhead') AS cost_group_id,
    COALESCE(pct.amount, 0) AS actual_amount,
    0::numeric AS committed_amount
  FROM petty_cash_transactions pct
  JOIN petty_cash_floats pcf ON pcf.id = pct.float_id
  WHERE pcf.project_id IS NOT NULL
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
    UNION ALL
    SELECT * FROM petty_cash_transaction_actual
  ) u
  GROUP BY project_id, cost_group_id
),
per_group AS (
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

-- v_project_budget_summary is unchanged — re-declared verbatim from
-- 096 so this migration is a complete, self-contained statement.
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

-- Verify
SELECT count(*) AS petty_tables FROM information_schema.tables
WHERE table_name IN ('petty_cash_floats', 'petty_cash_transactions', 'petty_cash_replenishments');
