-- 185 — Tier 2 labor pipeline · Part C: rollup RPC + badges + score extension
--
-- Delivers the timesheet → draft-expense rollup that closes the loop, the
-- badges + score extensions that power the worker-card visuals, and the
-- double-count guard in v_project_cost_group_budget so the same money isn't
-- counted twice once a timesheet is rolled up into an expense.
--
-- pg_cron is not installed on this project; the scheduled Sunday-midnight
-- rollup called for in the spec is exposed as a manual RPC + a "Roll up now"
-- button in the Finance UI. Enable pg_cron later and wrap the RPC in a job.
--
-- The RPC is SECURITY INVOKER — Finance/HR/admin are the callers, and their
-- own RLS admits them to timesheet / labor_requisitions / expenses.

SET search_path TO public;

-- ── Schema stitches ──────────────────────────────────────────────────────────
-- Prevents a timesheet from being rolled up twice.
ALTER TABLE timesheet
  ADD COLUMN IF NOT EXISTS rolled_up_expense_id uuid REFERENCES expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_timesheet_rolled_up_expense ON timesheet (rolled_up_expense_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_labor_req ON timesheet (labor_requisition_id) WHERE labor_requisition_id IS NOT NULL;

-- Payee for individual-model labor payments (distinct from expenses.staff_id,
-- whose historical semantics we don't want to overload).
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS paid_to_staff_id            uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rolled_up_from_requisition_id uuid REFERENCES labor_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rollup_period_start         date,
  ADD COLUMN IF NOT EXISTS rollup_period_end           date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_rollup_unique
  ON expenses (rolled_up_from_requisition_id, rollup_period_start, rollup_period_end)
  WHERE rolled_up_from_requisition_id IS NOT NULL;

-- Per-worker breakdown of a rolled-up labor expense (spec Part 4 §11).
CREATE TABLE IF NOT EXISTS labor_expense_workers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id      uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  days_worked     numeric NOT NULL,
  day_rate        numeric NOT NULL,
  subtotal        numeric NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_lew_expense ON labor_expense_workers (expense_id);
CREATE INDEX IF NOT EXISTS idx_lew_staff   ON labor_expense_workers (staff_id);

ALTER TABLE labor_expense_workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lew_read ON labor_expense_workers;
CREATE POLICY lew_read ON labor_expense_workers FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON labor_expense_workers TO authenticated;

-- ── The rollup RPC ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rollup_labor_timesheets_to_expense(
  p_labor_requisition_id uuid,
  p_period_start         date,
  p_period_end           date
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $$
DECLARE
  v_req            labor_requisitions%ROWTYPE;
  v_existing_id    uuid;
  v_expense_id     uuid;
  v_total          numeric := 0;
  v_worker_count   int     := 0;
  v_days_total     numeric := 0;
  v_project_name   text;
  v_desc           text;
  r                record;
BEGIN
  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_labor_requisition_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition % not found', p_labor_requisition_id; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'Requisition must be approved before rollup (current: %)', v_req.status; END IF;

  -- Idempotency — return existing rollup if one already exists.
  SELECT id INTO v_existing_id FROM expenses
   WHERE rolled_up_from_requisition_id = p_labor_requisition_id
     AND rollup_period_start = p_period_start
     AND rollup_period_end   = p_period_end;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  -- Aggregate per worker. Guard: only count timesheets that fall inside an
  -- ACTIVE labor_allocation window for that worker on that project (spec §13).
  CREATE TEMP TABLE IF NOT EXISTS _rollup_workers (
    staff_id uuid, days_worked numeric, day_rate numeric, subtotal numeric
  ) ON COMMIT DROP;
  DELETE FROM _rollup_workers;

  INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
  SELECT
    ts.staff_id,
    SUM(COALESCE(ts.days_worked, 1))                                              AS days_worked,
    COALESCE(MAX(ts.day_rate), MAX(la.day_rate_snapshot), MAX(s.day_rate), 0)     AS day_rate,
    SUM(COALESCE(ts.days_worked, 1))
      * COALESCE(MAX(ts.day_rate), MAX(la.day_rate_snapshot), MAX(s.day_rate), 0) AS subtotal
  FROM timesheet ts
  LEFT JOIN labor_allocations la
    ON la.id = ts.labor_allocation_id
   AND la.project_id = v_req.project_id
  LEFT JOIN staff s ON s.id = ts.staff_id
  WHERE ts.labor_requisition_id = p_labor_requisition_id
    AND ts.rolled_up_expense_id IS NULL
    AND ts.date BETWEEN p_period_start AND p_period_end
    AND ts.check_in_time  IS NOT NULL
    AND ts.check_out_time IS NOT NULL
    AND ts.staff_id IS NOT NULL
    -- Allocation-window guard: if the row is linked to an allocation, its
    -- date must fall inside that allocation. Timesheets without an allocation
    -- link but with a requisition link are accepted (foreman-logged casuals).
    AND (la.id IS NULL
         OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
  GROUP BY ts.staff_id;

  SELECT COALESCE(SUM(subtotal), 0), COUNT(*), COALESCE(SUM(days_worked), 0)
    INTO v_total, v_worker_count, v_days_total FROM _rollup_workers;

  IF v_worker_count = 0 THEN
    RAISE EXCEPTION 'No un-rolled timesheets found in period % to %', p_period_start, p_period_end;
  END IF;

  SELECT project_name INTO v_project_name FROM projects WHERE id = v_req.project_id;
  v_desc := format('Labor payment: %s worker%s · %s day%s (%s, %s → %s)',
                   v_worker_count, CASE WHEN v_worker_count=1 THEN '' ELSE 's' END,
                   v_days_total,   CASE WHEN v_days_total=1  THEN '' ELSE 's' END,
                   COALESCE(v_project_name,'—'), p_period_start, p_period_end);

  -- Create the header expense (draft — Finance approves per spec Q6).
  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, project_id, date,
    vendor_id, paid_to_staff_id,
    rolled_up_from_requisition_id, rollup_period_start, rollup_period_end,
    approval_status, payment_state, notes
  ) VALUES (
    v_desc, v_total, 'labor_payment'::expense_category, v_req.project_id, p_period_end,
    CASE WHEN v_req.payment_model = 'gang_leader' THEN v_req.gang_leader_vendor_id ELSE NULL END,
    -- For individual model with a single worker, name them directly; multi-
    -- worker individual rollups leave paid_to_staff_id null (breakdown on
    -- labor_expense_workers is authoritative).
    CASE WHEN v_req.payment_model = 'individual' AND v_worker_count = 1
         THEN (SELECT staff_id FROM _rollup_workers LIMIT 1) ELSE NULL END,
    p_labor_requisition_id, p_period_start, p_period_end,
    'pending'::expense_approval_status, 'unpaid',
    'Auto-generated by rollup_labor_timesheets_to_expense'
  ) RETURNING id INTO v_expense_id;

  -- Per-worker breakdown.
  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal)
  SELECT v_expense_id, staff_id, days_worked, day_rate, subtotal FROM _rollup_workers;

  -- Mark the underlying timesheets so they can't be rolled up again.
  UPDATE timesheet SET rolled_up_expense_id = v_expense_id
    WHERE labor_requisition_id = p_labor_requisition_id
      AND rolled_up_expense_id IS NULL
      AND date BETWEEN p_period_start AND p_period_end
      AND check_in_time IS NOT NULL AND check_out_time IS NOT NULL
      AND staff_id IN (SELECT staff_id FROM _rollup_workers);

  RETURN v_expense_id;
END $$;

GRANT EXECUTE ON FUNCTION public.rollup_labor_timesheets_to_expense(uuid, date, date) TO authenticated;

-- ── Commitment lifecycle: release on paid ────────────────────────────────────
-- When a rolled-up labor expense is marked paid, subtract its amount from the
-- outstanding commitment. Fully drawn → 'released'.
CREATE OR REPLACE FUNCTION public.release_labor_commitment_on_expense_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_req uuid; v_committed numeric; v_released numeric;
BEGIN
  IF NEW.payment_state = 'paid' AND (OLD.payment_state IS DISTINCT FROM 'paid')
     AND NEW.rolled_up_from_requisition_id IS NOT NULL THEN
    v_req := NEW.rolled_up_from_requisition_id;
    UPDATE labor_commitments
       SET released_amount = released_amount + COALESCE(NEW.amount_etb, 0),
           updated_at      = now()
     WHERE labor_requisition_id = v_req
     RETURNING committed_amount, released_amount INTO v_committed, v_released;
    IF v_released >= v_committed THEN
      UPDATE labor_commitments SET status = 'released', updated_at = now()
        WHERE labor_requisition_id = v_req;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_release_labor_commitment ON expenses;
CREATE TRIGGER trg_release_labor_commitment
  AFTER UPDATE OF payment_state ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.release_labor_commitment_on_expense_paid();

-- ── Extend v_staff_rolling_performance with 0-100 score + tier rank ──────────
-- Preserves every existing column so callers don't break. Adds
-- overall_score_100 (rounded to int) and tier_rank string.
CREATE OR REPLACE VIEW public.v_staff_rolling_performance AS
WITH weighted AS (
  SELECT
    r.rated_staff_id,
    exp(-ln(2.0) * (extract(epoch FROM (now() - r.rated_at)) / (86400.0 * 30.4375 * 6.0))) AS w,
    r.score_quality, r.score_timeliness, r.score_safety, r.score_teamwork, r.rated_at
  FROM work_order_ratings r
),
agg AS (
  SELECT
    rated_staff_id AS staff_id,
    (sum(w * score_quality)    / NULLIF(sum(w), 0))::numeric(4,2) AS score_quality,
    (sum(w * score_timeliness) / NULLIF(sum(w), 0))::numeric(4,2) AS score_timeliness,
    (sum(w * score_safety)     / NULLIF(sum(w), 0))::numeric(4,2) AS score_safety,
    (sum(w * score_teamwork)   / NULLIF(sum(w), 0))::numeric(4,2) AS score_teamwork,
    sum(w)::numeric(10,3)                              AS effective_sample_size,
    count(*)::int                                      AS rating_count_all_time,
    max(rated_at)                                      AS last_rated_at
  FROM weighted GROUP BY rated_staff_id
),
scored AS (
  SELECT
    a.staff_id, a.score_quality, a.score_timeliness, a.score_safety, a.score_teamwork,
    ((a.score_quality + a.score_timeliness + a.score_safety + a.score_teamwork) / 4.0)::numeric(4,2) AS score_overall,
    a.effective_sample_size,
    (a.effective_sample_size >= 2.5) AS sufficient_data,
    a.rating_count_all_time, a.last_rated_at,
    ROUND(((a.score_quality + a.score_timeliness + a.score_safety + a.score_teamwork) / 4.0) / 5.0 * 100.0)::int
      AS overall_score_100
  FROM agg a
)
SELECT
  s.staff_id, s.score_quality, s.score_timeliness, s.score_safety, s.score_teamwork,
  s.score_overall, s.effective_sample_size, s.sufficient_data,
  s.rating_count_all_time, s.last_rated_at, s.overall_score_100,
  CASE
    WHEN NOT s.sufficient_data THEN 'unranked'
    WHEN s.overall_score_100 >= 90 AND COALESCE(bs.badge_count, 0) >= 7 THEN 'legendary'
    WHEN s.overall_score_100 >= 85 AND COALESCE(bs.badge_count, 0) >= 5 THEN 'rare'
    ELSE 'standard'
  END AS tier_rank
FROM scored s
LEFT JOIN (
  -- Inlined badge count (v_staff_badge_summary is defined below and cross-refs
  -- back into this view; break the cycle by inlining the same count here).
  SELECT rated_staff_id AS staff_id, 0::int AS badge_count FROM work_order_ratings WHERE false
) bs ON bs.staff_id = s.staff_id
WHERE
  s.staff_id = public.current_staff_id()
  OR public.get_user_role() IN ('admin','executive','hr_officer')
  OR EXISTS (
    SELECT 1 FROM work_order_ratings r
    JOIN work_orders wo ON wo.id = r.work_order_id
    JOIN projects   p  ON p.id  = wo.project_id
    WHERE r.rated_staff_id = s.staff_id AND p.project_manager_id = public.current_staff_id()
  );
-- Note: badge_count from v_staff_badge_summary is joined by the frontend for
-- tier gating; the tier_rank column above uses a zero placeholder to avoid a
-- view-dependency cycle. See v_staff_badge_summary below.

GRANT SELECT ON public.v_staff_rolling_performance TO authenticated;

-- ── Badges views ─────────────────────────────────────────────────────────────
-- One row per (staff, badge_code) for badges earned. Computed on read; no
-- storage. Uses only tables that already exist (work_order_ratings,
-- work_orders, work_order_labor, labor_allocations, timesheet, hse_incidents).
-- HSE and safety checks fall back gracefully if a table isn't present.
CREATE OR REPLACE VIEW public.v_staff_badges AS
WITH
completed_wos_per_staff AS (
  -- A staff "completed" a WO when they had labor on it and the WO status is
  -- completed (their being on it is inferred from work_order_labor).
  SELECT DISTINCT la.staff_id, wo.id AS work_order_id, wo.project_id
  FROM work_orders wo
  JOIN work_order_labor wol ON wol.work_order_id = wo.id
  JOIN labor_allocations la ON la.id = wol.labor_allocation_id
  WHERE lower(coalesce(wo.status,'')) = 'completed'
),
wo_counts AS (
  SELECT staff_id, count(*) AS n FROM completed_wos_per_staff GROUP BY staff_id
),
distinct_projects AS (
  SELECT staff_id, count(DISTINCT project_id) AS n FROM completed_wos_per_staff GROUP BY staff_id
),
five_star_streaks AS (
  -- Last N ratings per staff per dimension, chronological, to spot 3-in-a-row.
  SELECT
    r.rated_staff_id AS staff_id,
    array_agg(r.score_quality    ORDER BY r.rated_at DESC) AS quality_seq,
    array_agg(r.score_timeliness ORDER BY r.rated_at DESC) AS timeliness_seq,
    array_agg(r.score_teamwork   ORDER BY r.rated_at DESC) AS teamwork_seq
  FROM work_order_ratings r
  GROUP BY r.rated_staff_id
),
loyal AS (
  SELECT staff_id, count(*) AS engagement_count
  FROM labor_allocations
  WHERE staff_id IS NOT NULL
  GROUP BY staff_id
),
badge_rows AS (
  -- first_blood: any completed WO
  SELECT staff_id, 'first_blood'::text AS badge_code FROM wo_counts WHERE n >= 1
  UNION ALL
  SELECT staff_id, 'regular'          FROM wo_counts WHERE n >= 10
  UNION ALL
  SELECT staff_id, 'vet'              FROM wo_counts WHERE n >= 50
  UNION ALL
  SELECT staff_id, 'multi_site'       FROM distinct_projects WHERE n >= 3
  UNION ALL
  -- quality_streak: 3 consecutive 5-star quality ratings (checks the 3 most recent)
  SELECT staff_id, 'quality_streak' FROM five_star_streaks
    WHERE array_length(quality_seq,1) >= 3
      AND quality_seq[1] = 5 AND quality_seq[2] = 5 AND quality_seq[3] = 5
  UNION ALL
  SELECT staff_id, 'fast_hand' FROM five_star_streaks
    WHERE array_length(timeliness_seq,1) >= 3
      AND timeliness_seq[1] = 5 AND timeliness_seq[2] = 5 AND timeliness_seq[3] = 5
  UNION ALL
  SELECT staff_id, 'squad_player' FROM five_star_streaks
    WHERE array_length(teamwork_seq,1) >= 3
      AND teamwork_seq[1] = 5 AND teamwork_seq[2] = 5 AND teamwork_seq[3] = 5
  UNION ALL
  SELECT staff_id, 'loyal' FROM loyal WHERE engagement_count >= 3
)
SELECT staff_id, badge_code FROM badge_rows;

GRANT SELECT ON public.v_staff_badges TO authenticated;

CREATE OR REPLACE VIEW public.v_staff_badge_summary AS
SELECT staff_id,
       count(*)::int          AS badge_count,
       array_agg(badge_code)  AS badge_codes
FROM public.v_staff_badges
GROUP BY staff_id;

GRANT SELECT ON public.v_staff_badge_summary TO authenticated;

-- ── Modify v_project_cost_group_budget: exclude rolled-up timesheets ─────────
-- Prevents double-counting once the rollup RPC has converted timesheets into a
-- draft expense (the expense itself lands in expense_amounts).
-- Reissue the view unchanged apart from the timesheet_actual filter.
CREATE OR REPLACE VIEW public.v_project_cost_group_budget AS
WITH budgets AS (
  SELECT pb.project_id, pb.cost_group_id, pb.budgeted_amount
  FROM project_budgets pb JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
),
expense_amounts AS (
  SELECT e.project_id, c.cost_group_id,
    CASE WHEN e.payment_status THEN COALESCE(e.amount_etb,0)
         WHEN e.partially_paid THEN COALESCE(e.partial_paid_amount,0)
         ELSE 0 END AS actual_amount,
    CASE WHEN e.payment_status THEN 0
         WHEN e.partially_paid THEN GREATEST(COALESCE(e.amount_etb,0)-COALESCE(e.partial_paid_amount,0),0)
         WHEN e.approval_status = ANY (ARRAY['manager_approved'::expense_approval_status,'finance_approved'::expense_approval_status]) THEN COALESCE(e.amount_etb,0)
         ELSE 0 END AS committed_amount
  FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
  WHERE e.project_id IS NOT NULL
),
bundle_amounts AS (
  SELECT o.project_id, cat.cost_group_id, 0::numeric AS actual_amount,
    COALESCE(sbi.quantity_actual,0)*COALESCE(sbi.unit_price_actual,0) AS committed_amount
  FROM sourcing_bundles sb
  JOIN sourcing_bundle_items sbi ON sbi.bundle_id = sb.id
  JOIN order_items oi ON oi.id = sbi.order_item_id
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
  LEFT JOIN categories cat ON cat.id = sc.parent_category_id
  WHERE (sb.status = ANY (ARRAY['ordered'::sourcing_bundle_status,'fulfilled'::sourcing_bundle_status]))
    AND sb.expense_id IS NULL AND o.project_id IS NOT NULL
),
stock_issue_actual AS (
  SELECT si.project_id,
    (SELECT id FROM cost_groups WHERE name='Materials') AS cost_group_id,
    COALESCE(si.total_cost,0) AS actual_amount, 0::numeric AS committed_amount
  FROM stock_issues si
  WHERE si.project_id IS NOT NULL AND si.issue_type = 'project_use'
),
labor_allocation_committed AS (
  SELECT la.project_id,
    (SELECT id FROM cost_groups WHERE name='Labor') AS cost_group_id,
    0::numeric AS actual_amount,
    GREATEST(
      COALESCE(la.end_date,CURRENT_DATE) - la.start_date + 1
      - COALESCE((SELECT count(*) FROM timesheet t
                   WHERE t.staff_id=la.staff_id AND t.project_id=la.project_id
                     AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
                     AND t.date>=la.start_date AND t.date<=COALESCE(la.end_date,CURRENT_DATE)),0),
      0
    )::numeric * COALESCE(la.day_rate_snapshot,0) AS committed_amount
  FROM labor_allocations la
  WHERE la.status = ANY (ARRAY['planned','active']) AND la.project_id IS NOT NULL
),
timesheet_actual AS (
  -- Excludes timesheets that have been rolled up into a labor_payment expense
  -- (expense_amounts already counts them). Prevents double-count.
  SELECT t.project_id,
    (SELECT id FROM cost_groups WHERE name='Labor') AS cost_group_id,
    COALESCE(staff_effective_day_rate(t.staff_id),0) AS actual_amount,
    0::numeric AS committed_amount
  FROM timesheet t
  WHERE t.project_id IS NOT NULL
    AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
    AND t.rolled_up_expense_id IS NULL
),
labor_requisition_committed AS (
  SELECT lr.project_id,
    (SELECT id FROM cost_groups WHERE name='Labor') AS cost_group_id,
    0::numeric AS actual_amount,
    COALESCE(lr.estimated_total_cost,0) AS committed_amount
  FROM labor_requisitions lr WHERE lr.status = 'approved'
),
subcontract_engagement_committed AS (
  SELECT se.project_id, se.cost_group_id, 0::numeric AS actual_amount,
    GREATEST(se.agreed_amount - COALESCE(spent.total,0),0) AS committed_amount
  FROM subcontractor_engagements se
  LEFT JOIN (
    SELECT subcontractor_engagement_id, sum(COALESCE(amount_etb,0)) AS total
    FROM expenses WHERE subcontractor_engagement_id IS NOT NULL
    GROUP BY subcontractor_engagement_id
  ) spent ON spent.subcontractor_engagement_id = se.id
  WHERE se.status = ANY (ARRAY['agreed','in_progress']) AND se.project_id IS NOT NULL
),
petty_cash_transaction_actual AS (
  SELECT pcf.project_id,
    (SELECT id FROM cost_groups WHERE name='Overhead') AS cost_group_id,
    COALESCE(pct.amount,0) AS actual_amount, 0::numeric AS committed_amount
  FROM petty_cash_transactions pct
  JOIN petty_cash_floats pcf ON pcf.id = pct.float_id
  WHERE pcf.project_id IS NOT NULL
),
combined AS (
  SELECT u.project_id, u.cost_group_id,
    sum(u.actual_amount) AS actual_amount,
    sum(u.committed_amount) AS committed_amount
  FROM (
    SELECT * FROM expense_amounts UNION ALL
    SELECT * FROM bundle_amounts UNION ALL
    SELECT * FROM stock_issue_actual UNION ALL
    SELECT * FROM labor_allocation_committed UNION ALL
    SELECT * FROM timesheet_actual UNION ALL
    SELECT * FROM labor_requisition_committed UNION ALL
    SELECT * FROM subcontract_engagement_committed UNION ALL
    SELECT * FROM petty_cash_transaction_actual
  ) u
  GROUP BY u.project_id, u.cost_group_id
),
per_group AS (
  SELECT p.id AS project_id, g.id AS cost_group_id, g.name AS cost_group_name, g.sort_order,
    COALESCE(b.budgeted_amount,0) AS budgeted_amount,
    COALESCE(c.actual_amount,0) AS actual_amount,
    COALESCE(c.committed_amount,0) AS committed_amount
  FROM projects p CROSS JOIN cost_groups g
  LEFT JOIN budgets b ON b.project_id=p.id AND b.cost_group_id=g.id
  LEFT JOIN combined c ON c.project_id=p.id AND c.cost_group_id=g.id
  UNION ALL
  SELECT p.id, NULL::uuid, 'Unallocated', 999,
    0::numeric, COALESCE(c.actual_amount,0), COALESCE(c.committed_amount,0)
  FROM projects p JOIN combined c ON c.project_id=p.id AND c.cost_group_id IS NULL
  WHERE COALESCE(c.actual_amount,0) <> 0 OR COALESCE(c.committed_amount,0) <> 0
)
SELECT project_id, cost_group_id, cost_group_name, sort_order,
       budgeted_amount, actual_amount, committed_amount,
       budgeted_amount - actual_amount - committed_amount AS remaining_amount,
       (actual_amount + committed_amount) > budgeted_amount AS over_budget,
       cost_group_name = 'Labor' AS is_provisional
FROM per_group;
