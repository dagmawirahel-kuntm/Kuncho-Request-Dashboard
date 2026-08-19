-- PR 9c fix: block_manual_progress_when_wo_linked's WHEN clause
-- (NEW.progress_pct IS DISTINCT FROM OLD.progress_pct) skipped the trigger
-- whenever the derive trigger (222) recomputed a task's progress to the
-- SAME value it already had -- e.g. a freshly-linked work order starting
-- at 0 against a task whose progress_pct column default is already 0.
-- progress_source never flipped to 'derived' in that case, even though the
-- task genuinely had a linked work order from that point on. Found via the
-- group (b) integration test, not read-through.
--
-- Fix: drop the WHEN clause. "UPDATE OF progress_pct" alone already scopes
-- the trigger to statements that assign that column, regardless of whether
-- the assigned value differs from the current one -- which is what's
-- actually needed here.

DROP TRIGGER IF EXISTS trg_block_manual_progress_when_wo_linked ON schedule_tasks;

CREATE TRIGGER trg_block_manual_progress_when_wo_linked
  BEFORE UPDATE OF progress_pct ON schedule_tasks
  FOR EACH ROW
  EXECUTE FUNCTION block_manual_progress_when_wo_linked();
