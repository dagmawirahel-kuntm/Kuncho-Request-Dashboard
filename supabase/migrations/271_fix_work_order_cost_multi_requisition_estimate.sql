-- v_work_order_cost undercounted the "Estimated" side whenever one crew
-- member had more than one labor_requisition linked to the same work
-- order (e.g. a gang leader with a per-day task, a per-volume task and a
-- lump-sum task all under one work order). The old crew_alloc CTE did
-- DISTINCT ON (work_order_id, staff_id), picking only the allocation with
-- the latest start_date and silently dropping every other requisition
-- for that person from the estimate.
--
-- Fix: source the estimate from work_order_labor — the explicit,
-- authoritative link between a work order and a labor_allocation (the
-- same table the "Linked Labor" UI panel reads) — so every distinct
-- linked requisition is counted, not just one per person. Work orders
-- that predate that feature and never got an explicit link keep the old
-- crew+project heuristic as a fallback, so their estimate doesn't drop
-- to zero.
CREATE OR REPLACE VIEW v_work_order_cost AS
WITH linked_alloc AS (
  SELECT wol.work_order_id, la.id AS labor_allocation_id, la.staff_id,
         la.labor_requisition_id, la.day_rate_snapshot, la.start_date, la.end_date
  FROM work_order_labor wol
  JOIN labor_allocations la ON la.id = wol.labor_allocation_id
),
crew_fallback AS (
  SELECT DISTINCT ON (wc.work_order_id, wc.staff_id) wc.work_order_id,
    wc.staff_id,
    la.id AS labor_allocation_id,
    la.labor_requisition_id,
    la.day_rate_snapshot,
    la.start_date,
    la.end_date
  FROM work_order_crew wc
  JOIN work_orders wo2 ON wo2.id = wc.work_order_id
  LEFT JOIN labor_allocations la ON la.staff_id = wc.staff_id AND la.project_id = wo2.project_id AND la.status = 'active'
  WHERE wc.removed_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM linked_alloc x WHERE x.work_order_id = wc.work_order_id AND x.staff_id = wc.staff_id
    )
  ORDER BY wc.work_order_id, wc.staff_id, la.start_date DESC NULLS LAST
),
crew_alloc AS (
  SELECT work_order_id, staff_id, labor_allocation_id, labor_requisition_id, day_rate_snapshot, start_date, end_date FROM linked_alloc
  UNION ALL
  SELECT work_order_id, staff_id, labor_allocation_id, labor_requisition_id, day_rate_snapshot, start_date, end_date FROM crew_fallback
), req_estimate AS (
  SELECT DISTINCT crew_alloc.work_order_id,
    crew_alloc.labor_requisition_id
   FROM crew_alloc
  WHERE crew_alloc.labor_requisition_id IS NOT NULL
), no_req_estimate AS (
  SELECT ca.work_order_id,
    ca.staff_id,
    (COALESCE(ca.end_date, CURRENT_DATE) - ca.start_date + 1)::numeric * COALESCE(ca.day_rate_snapshot, s.day_rate, 0::numeric) AS est
   FROM crew_alloc ca
     LEFT JOIN staff s ON s.id = ca.staff_id
  WHERE ca.labor_requisition_id IS NULL AND ca.labor_allocation_id IS NOT NULL
), estimate AS (
  SELECT x.work_order_id,
    sum(x.total) AS total
   FROM ( SELECT re.work_order_id,
            COALESCE(NULLIF(req.estimated_total_cost, 0::numeric),
                CASE
                    WHEN req.payment_basis = 'per_volume'::text THEN req.unit_rate * COALESCE(req.estimated_total_volume, 0::numeric)
                    ELSE req.estimated_day_rate * COALESCE(req.estimated_days, 0::numeric) * req.headcount::numeric
                END, 0::numeric) AS total
           FROM req_estimate re
             JOIN labor_requisitions req ON req.id = re.labor_requisition_id
        UNION ALL
         SELECT no_req_estimate.work_order_id,
            no_req_estimate.est
           FROM no_req_estimate) x
  GROUP BY x.work_order_id
), actual AS (
  SELECT wal.work_order_id,
    sum(COALESCE(ts.days_worked, 0::numeric) * COALESCE(ts.day_rate, 0::numeric) + COALESCE(ts.volume_completed, 0::numeric) * COALESCE(ts.day_rate, 0::numeric) + COALESCE(ts.overtime_amount, 0::numeric)) AS total
   FROM wo_attendance_log wal
     JOIN timesheet ts ON ts.id = wal.synced_timesheet_id
  WHERE wal.work_order_id IS NOT NULL
  GROUP BY wal.work_order_id
), materials AS (
  SELECT wom.work_order_id,
    sum(si.total_cost) AS total
   FROM work_order_materials wom
     JOIN stock_issues si ON si.id = wom.stock_issue_id
  GROUP BY wom.work_order_id
)
SELECT wo.id AS work_order_id,
  COALESCE(actual.total, 0::numeric) AS labor_cost,
  COALESCE(estimate.total, 0::numeric) AS labor_cost_estimated,
  COALESCE(materials.total, 0::numeric) AS materials_cost,
  COALESCE(actual.total, 0::numeric) + COALESCE(materials.total, 0::numeric) AS total_cost,
  COALESCE(estimate.total, 0::numeric) + COALESCE(materials.total, 0::numeric) AS total_cost_estimated
 FROM work_orders wo
   LEFT JOIN estimate ON estimate.work_order_id = wo.id
   LEFT JOIN actual ON actual.work_order_id = wo.id
   LEFT JOIN materials ON materials.work_order_id = wo.id;
