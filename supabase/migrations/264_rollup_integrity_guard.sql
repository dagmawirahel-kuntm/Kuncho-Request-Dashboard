-- 264 — Finish the rollup fan-out fix: remaining duplicate rows + a guard
--
-- Follow-up to 263, after auditing every project rather than just the one
-- the problem was reported on.
--
-- What the audit found:
--
--   * The fan-out is LATENT ON EVERY PROJECT, not specific to Solomon
--     Apartment. The trigger condition is simply a worker holding more
--     than one labor_allocation on the same project — which is what
--     happens the moment a project runs a SECOND week for the same
--     person: week 1's requisition creates one allocation, week 2's
--     creates another. Nothing about it is anomalous data.
--     Solomon Apartment (42 workers / 69 allocations, 21 requisitions) is
--     simply the only project so far to have reached a second week. Every
--     other project currently has exactly one allocation per worker, and
--     would have hit the same inflation on its next week.
--
--   * No EXISTING rollup expense was overstated. Comparing what each
--     rollup recorded in labor_expense_workers against the attendance rows
--     actually stamped to it, all 18 surviving per-day rollups match
--     exactly. The inflated ones were the nine Solomon drafts for
--     2026-08-24 → 2026-08-29, which were already removed in 262/263 —
--     the earlier weeks were rolled up before anyone held a second
--     allocation, so they were computed correctly.
--
-- So no financial correction is needed. What remains is (1) the same
-- duplicate-row cleanup on the other projects, and (2) a standing check so
-- a silent inflation of this kind can't go unnoticed again.

-- ── 1. Duplicate worker-day rows on the remaining projects
-- Same predicate as 263, minus the project filter: a timesheet row that
-- merely restates a timesheet_attendance row for the same worker, day and
-- requisition, and carries nothing of its own. Rows with volume_completed,
-- overtime, notes, gang data, a payroll link, non-unit days_worked, or an
-- existing rollup link are all preserved.
DELETE FROM timesheet ts
WHERE EXISTS (
    SELECT 1 FROM timesheet_attendance att
    WHERE att.staff_id = ts.staff_id
      AND att.work_date = ts.date
      AND att.labor_requisition_id IS NOT DISTINCT FROM ts.labor_requisition_id
  )
  AND ts.check_in_time IS NULL AND ts.check_out_time IS NULL
  AND COALESCE(ts.volume_completed, 0) = 0
  AND ts.rolled_up_expense_id IS NULL
  AND ts.payroll_id IS NULL
  AND COALESCE(ts.overtime_hours, 0) = 0
  AND COALESCE(ts.overtime_amount, 0) = 0
  AND ts.notes IS NULL
  AND ts.gang_size IS NULL
  AND COALESCE(ts.days_worked, 1) = 1;

-- ── 2. Standing integrity check
-- The fan-out was invisible: it inflated money with no error, no failed
-- constraint and nothing out of place on screen — it was only found by
-- someone noticing a total looked doubled. This view is the check that
-- would have caught it immediately, and will catch anything similar.
--
-- The principle: a per-day rollup's recorded days must equal the
-- attendance actually stamped to that rollup. The rollup writes both, so
-- they can only disagree if the computation and the stamping disagree —
-- which is precisely the fan-out signature (the buggy join inflated the
-- computed days while the stamping, joining nothing, stayed correct).
--
-- Per-volume rollups are excluded: they measure volume_completed, not
-- days, so row counts are not the right comparison.
CREATE OR REPLACE VIEW public.v_rollup_integrity_check
WITH (security_invoker = true) AS
WITH per_day_rollups AS (
  SELECT e.id, e.expense_code, e.amount_etb, e.payment_state, e.is_archived,
         e.project_id, e.rollup_period_start, e.rollup_period_end
  FROM expenses e
  JOIN labor_requisitions r ON r.id = e.rolled_up_from_requisition_id
  WHERE e.rolled_up_from_requisition_id IS NOT NULL
    AND r.payment_basis = 'per_day'
),
recorded AS (
  SELECT expense_id, SUM(days_worked) AS recorded_days,
         SUM(days_worked * COALESCE(day_rate, 0)) AS recorded_value
  FROM labor_expense_workers GROUP BY expense_id
),
stamped AS (
  SELECT rolled_up_expense_id AS expense_id, count(*)::numeric AS stamped_days
  FROM timesheet_attendance WHERE rolled_up_expense_id IS NOT NULL
  GROUP BY rolled_up_expense_id
),
stamped_ts AS (
  SELECT rolled_up_expense_id AS expense_id, count(*)::numeric AS stamped_ts_days
  FROM timesheet
  WHERE rolled_up_expense_id IS NOT NULL
    AND check_in_time IS NOT NULL AND check_out_time IS NOT NULL
  GROUP BY rolled_up_expense_id
)
SELECT
  pr.id AS expense_id, pr.expense_code, p.project_name, pr.project_id,
  pr.rollup_period_start, pr.rollup_period_end,
  pr.amount_etb, pr.payment_state, pr.is_archived,
  COALESCE(rec.recorded_days, 0) AS recorded_days,
  COALESCE(st.stamped_days, 0) + COALESCE(sts.stamped_ts_days, 0) AS source_days,
  COALESCE(rec.recorded_days, 0) - (COALESCE(st.stamped_days, 0) + COALESCE(sts.stamped_ts_days, 0)) AS extra_days,
  -- What the discrepancy is worth, at the rates actually used.
  ROUND(
    CASE WHEN COALESCE(rec.recorded_days, 0) = 0 THEN 0
         ELSE COALESCE(rec.recorded_value, 0)
              / NULLIF(rec.recorded_days, 0)
              * (COALESCE(rec.recorded_days, 0) - (COALESCE(st.stamped_days, 0) + COALESCE(sts.stamped_ts_days, 0)))
    END, 2) AS overstated_etb
FROM per_day_rollups pr
LEFT JOIN projects p   ON p.id = pr.project_id
LEFT JOIN recorded rec ON rec.expense_id = pr.id
LEFT JOIN stamped st   ON st.expense_id  = pr.id
LEFT JOIN stamped_ts sts ON sts.expense_id = pr.id
WHERE COALESCE(rec.recorded_days, 0)
      <> COALESCE(st.stamped_days, 0) + COALESCE(sts.stamped_ts_days, 0);

COMMENT ON VIEW public.v_rollup_integrity_check IS
  'Per-day labor rollups whose recorded days do not match the attendance actually stamped to them — the signature of a computation/stamping disagreement such as a join fan-out. Empty is healthy. Read-only.';
