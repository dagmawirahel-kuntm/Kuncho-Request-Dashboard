-- PR 9c group (a): physical progress columns on schedule_tasks + manual-edit guard.
--
-- progress_pct is either set directly by a PM/admin ("manual") or derived
-- automatically from linked work order reports ("derived") in group (b).
-- Once a task has a live (non-cancelled) work order linked to it, direct
-- edits to progress_pct are blocked -- the number must come from the field,
-- not from someone typing over it in the schedule table.
--
-- pg_trigger_depth() is how the guard tells the two write paths apart:
-- depth = 1 is a direct client UPDATE (RLS already gated who can even reach
-- this trigger); depth > 1 means this UPDATE was fired from inside another
-- trigger -- i.e. group (b)'s derive trigger cascading in -- and is let
-- through. Same cooperation pattern as cascade_schedule_dates /
-- sync_task_dates_and_duration in migration 217.

ALTER TABLE schedule_tasks
  ADD COLUMN progress_pct numeric(5,2) NOT NULL DEFAULT 0
    CHECK (progress_pct >= 0 AND progress_pct <= 100),
  ADD COLUMN progress_source text NOT NULL DEFAULT 'manual'
    CHECK (progress_source IN ('manual', 'derived'));

CREATE OR REPLACE FUNCTION block_manual_progress_when_wo_linked()
RETURNS TRIGGER AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    NEW.progress_source := 'derived';
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM work_orders
    WHERE schedule_task_id = NEW.id AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Cannot manually edit progress on a task with an active linked work order; progress is derived automatically from work order reports.';
  END IF;

  NEW.progress_source := 'manual';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_manual_progress_when_wo_linked
  BEFORE UPDATE OF progress_pct ON schedule_tasks
  FOR EACH ROW
  WHEN (NEW.progress_pct IS DISTINCT FROM OLD.progress_pct)
  EXECUTE FUNCTION block_manual_progress_when_wo_linked();
