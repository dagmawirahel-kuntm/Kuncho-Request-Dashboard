-- uq_wo_attendance_allocated enforced at most one allocated attendance row
-- per (work_order_id, staff_id, log_date), full stop — no room for a
-- crew member who holds more than one distinct task on the same work
-- order (e.g. Besufekad: a lump-sum Ceramic Works day, a Silcon Works day
-- rate, and a per-volume Worker task, all under one "Ceramic Works" WO).
-- LogAttendancePage's MultiTaskRow now renders one input per task, keyed
-- by labor_requisition_id, but every save past the first for the same
-- day would have hit this index and failed outright.
--
-- Split it in two: rows with no linked requisition (the plain single-task
-- case — the vast majority of crew) keep the original one-row-per-day
-- guarantee; rows tied to a specific requisition get one row per
-- (work_order, staff, day, requisition) instead, so a person can hold
-- several requisitions' worth of same-day rows without colliding, while
-- still being blocked from double-logging the same task twice.
DROP INDEX IF EXISTS uq_wo_attendance_allocated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_attendance_allocated_no_req
  ON wo_attendance_log (work_order_id, staff_id, log_date)
  WHERE is_unallocated = false AND labor_requisition_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_attendance_allocated_per_req
  ON wo_attendance_log (work_order_id, staff_id, log_date, labor_requisition_id)
  WHERE is_unallocated = false AND labor_requisition_id IS NOT NULL;
