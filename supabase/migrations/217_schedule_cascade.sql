-- ============================================================
-- Schedule (PR 9b), migration group (b) of 4: dependency cascade.
-- Working-day calendar functions already landed in group (a)
-- (216_schedule_core_schema.sql), so this is just the cascade
-- trigger.
--
-- Lag semantics, resolved with the user before writing this (item 12
-- of the prompt, taken literally, produced a same-day-as-predecessor-
-- finish result at lag_days=0 under the inclusive add_working_days
-- convention from group (a) — inconsistent with the field's own
-- description, "buffer AFTER predecessor finishes BEFORE this can
-- start"). Confirmed: lag_days=0 means the successor's earliest
-- allowed start is the next working day after the predecessor
-- finishes (standard finish-to-start), with lag_days as extra buffer
-- on top of that one-day gap. Under the inclusive convention this
-- means add_working_days(pred_end, lag_days + 2, schedule_id), not
-- the "+ 1" in the prompt's literal text.
--
-- Depth-guard interaction with group (a)'s sync trigger: the sync
-- trigger (sync_task_dates_and_duration) skips recompute entirely at
-- nested trigger depth (pg_trigger_depth() > 1), on the documented
-- assumption that whatever issues a nested UPDATE on schedule_tasks
-- sets current_start_date AND current_end_date explicitly and
-- consistently itself. This trigger is that nested-UPDATE issuer —
-- it MUST compute and set both columns together in the same
-- statement (never start alone), or the successor's current_end_date
-- would go stale and the chain would silently stop propagating past
-- the first hop.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION cascade_schedule_dates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_successor       RECORD;
  v_earliest_start  DATE;
  v_new_end         DATE;
BEGIN
  IF pg_trigger_depth() > 50 THEN
    RAISE EXCEPTION 'cascade_schedule_dates: recursion depth exceeded 50 — this indicates a dependency cycle that should have been rejected by prevent_predecessor_cycles';
  END IF;

  FOR v_successor IN
    SELECT id, current_start_date, current_duration_days, lag_days, schedule_id
    FROM schedule_tasks
    WHERE predecessor_task_id = NEW.id AND auto_cascade = true
  LOOP
    v_earliest_start := add_working_days(NEW.current_end_date, v_successor.lag_days + 2, v_successor.schedule_id);

    IF v_successor.current_start_date < v_earliest_start THEN
      v_new_end := add_working_days(v_earliest_start, v_successor.current_duration_days, v_successor.schedule_id);
      UPDATE schedule_tasks
      SET current_start_date = v_earliest_start,
          current_end_date   = v_new_end
      WHERE id = v_successor.id;
      -- This UPDATE re-fires trg_sync_task_dates_and_duration (BEFORE,
      -- depth > 1 — no-op, both columns already consistent above) and
      -- this same AFTER trigger on the successor row, continuing the
      -- cascade to its own successors. Only current_* columns are ever
      -- touched here — planned_* stays frozen regardless of cascading.
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_cascade_schedule_dates
  AFTER UPDATE OF current_end_date ON schedule_tasks
  FOR EACH ROW
  WHEN (NEW.current_end_date IS DISTINCT FROM OLD.current_end_date)
  EXECUTE FUNCTION cascade_schedule_dates();

-- Verify.
SELECT proname FROM pg_proc WHERE proname = 'cascade_schedule_dates';
