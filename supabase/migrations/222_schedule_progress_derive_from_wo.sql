-- PR 9c group (b): derive schedule_tasks.progress_pct from linked work orders.
--
-- Deviation from the "avoid new SECURITY DEFINER" preference, flagged
-- explicitly: work_orders can be updated directly by roles that have NO
-- write access to schedule_tasks under its existing RLS (site_foreman_wo_update
-- lets a Site Foreman update their project's work orders; work_orders_manage
-- also covers operations_manager/executive) -- but schedule_tasks_write only
-- allows admin or the schedule's owning PM. A plain SECURITY INVOKER trigger
-- would silently fail under RLS the moment a Site Foreman (the actual source
-- of field progress) touches a work order. sync_wo_progress_pct(), which
-- already feeds work_orders.current_progress_pct from progress reports, is
-- SECURITY DEFINER for this exact reason -- this trigger has to be too.

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
    UPDATE schedule_tasks SET progress_pct = round(v_avg, 2) WHERE id = p_task_id;
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

CREATE OR REPLACE FUNCTION derive_task_progress_from_work_orders()
RETURNS TRIGGER AS $$
DECLARE
  v_task_id uuid;
  v_other_task_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_task_id := OLD.schedule_task_id;
  ELSE
    v_task_id := NEW.schedule_task_id;
    IF TG_OP = 'UPDATE' THEN
      v_other_task_id := OLD.schedule_task_id;
    END IF;
  END IF;

  IF v_task_id IS NOT NULL THEN
    PERFORM recompute_task_progress_from_work_orders(v_task_id);
  END IF;

  IF v_other_task_id IS NOT NULL AND v_other_task_id IS DISTINCT FROM v_task_id THEN
    PERFORM recompute_task_progress_from_work_orders(v_other_task_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION derive_task_progress_from_work_orders() FROM PUBLIC;

CREATE TRIGGER trg_derive_task_progress_from_work_orders
  AFTER INSERT OR UPDATE OF current_progress_pct, status, schedule_task_id OR DELETE
  ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION derive_task_progress_from_work_orders();
