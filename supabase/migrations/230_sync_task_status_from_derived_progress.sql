-- Fix: schedule_tasks.status and progress_pct are independent columns, and
-- nothing synced them. A task whose progress is derived from work orders
-- (progress_source='derived') could sit at progress_pct=100 while status
-- stayed at its original 'not_started' -- confirmed live on a real task
-- (b505c068-dd45-4b35-b4ba-76e750bb345f: progress_pct 100.00, status
-- 'not_started'). The Gantt/table views color and label bars by `status`,
-- so this read as "0% complete" even though the field data said done.
--
-- recompute_task_progress_from_work_orders() now also advances status
-- forward when work-order progress moves it: not_started -> in_progress on
-- any progress, and -> completed at 100%. It never overrides 'blocked' or
-- 'on_hold' (a PM/foreman set those for a reason unrelated to the progress
-- number) and never moves status backward if reported progress later drops
-- (e.g. a new phase of work reopens a nearly-done task) -- that direction
-- needs a human decision, not a silent auto-revert.
--
-- actual_start_date/actual_end_date get the same treatment: stamp them the
-- first time progress crosses into "started"/"done" if not already set,
-- since nothing else in the schema populates them from field data.

CREATE OR REPLACE FUNCTION recompute_task_progress_from_work_orders(p_task_id uuid)
RETURNS void AS $$
DECLARE
  v_avg numeric;
  v_active_count int;
BEGIN
  SELECT AVG(current_progress_pct), COUNT(*) INTO v_avg, v_active_count
  FROM work_orders
  WHERE schedule_task_id = p_task_id AND status <> 'cancelled';

  IF v_active_count > 0 THEN
    UPDATE schedule_tasks SET
      progress_pct = round(v_avg, 2),
      status = CASE
        WHEN round(v_avg, 2) >= 100 AND status IN ('not_started', 'in_progress') THEN 'completed'
        WHEN round(v_avg, 2) > 0 AND status = 'not_started' THEN 'in_progress'
        ELSE status
      END,
      actual_start_date = CASE
        WHEN actual_start_date IS NULL AND round(v_avg, 2) > 0 THEN CURRENT_DATE
        ELSE actual_start_date
      END,
      actual_end_date = CASE
        WHEN actual_end_date IS NULL AND round(v_avg, 2) >= 100 AND status IN ('not_started', 'in_progress') THEN CURRENT_DATE
        ELSE actual_end_date
      END
    WHERE id = p_task_id;
  ELSE
    -- No active work orders remain linked. Freeze progress at whatever it
    -- last derived to and hand control back to manual editing -- a WO being
    -- cancelled or unlinked doesn't erase the work that was already reported.
    UPDATE schedule_tasks SET progress_source = 'manual'
    WHERE id = p_task_id AND progress_source = 'derived';
  END IF;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION recompute_task_progress_from_work_orders(uuid) FROM PUBLIC;

-- One-time backfill for tasks already stuck in this state from before the
-- fix (same forward-only rule as above, applied retroactively).
UPDATE schedule_tasks
SET status = 'completed',
    actual_end_date = COALESCE(actual_end_date, CURRENT_DATE)
WHERE progress_pct >= 100 AND status IN ('not_started', 'in_progress');

UPDATE schedule_tasks
SET status = 'in_progress'
WHERE progress_pct > 0 AND progress_pct < 100 AND status = 'not_started';
