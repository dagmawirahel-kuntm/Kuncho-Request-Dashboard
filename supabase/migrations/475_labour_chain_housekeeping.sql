-- 475: Project → work order → people → work done: the housekeeping.
--
-- "Assigned to a work order" means being on its crew. People join the crew
-- when their labour request is approved (allocation triggers, 408); until
-- now nothing took them off again, so a finished job kept its crew, a
-- worker ended on a request stayed on the job, and the crew list stopped
-- saying who is really there (49 crew places on finished or cancelled
-- orders, 19 workers on three or more open orders). Labour requests were
-- never closed (127 open), and orders worked on stayed "Not started".
--
-- So the database now keeps the chain straight:
--   1. The first day recorded on a work order starts it (requested → in progress).
--   2. Completing or cancelling a work order closes its labour requests and
--      takes everyone off its crew. finish_work_order's "close labour" is
--      therefore always on.
--   3. Ending a worker on a request (or closing the request) takes them off
--      that order's crew, unless another open request still puts them there.
--   4. labour_day_clashes(): who recorded on a site for a day is also
--      recorded somewhere else that day, for the Record screen to warn.
-- And a one-off tidy-up of what had piled up (see the end).

-- ── helpers ──────────────────────────────────────────────────────────
-- Take a worker off a work order's crew if nothing still puts them there.
CREATE OR REPLACE FUNCTION public.release_crew_if_unlinked(p_wo uuid, p_staff uuid, p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF p_wo IS NULL OR p_staff IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM labor_allocations a JOIN labor_requisitions r ON r.id = a.labor_requisition_id
              WHERE a.staff_id = p_staff AND r.work_order_id = p_wo AND a.status = 'active'
                AND r.status = 'approved' AND r.closed_at IS NULL) THEN
    RETURN false;
  END IF;
  UPDATE work_order_crew SET removed_at = now(), removed_by_staff_id = current_staff_id()
   WHERE work_order_id = p_wo AND staff_id = p_staff AND removed_at IS NULL;
  RETURN FOUND;
END $function$;
REVOKE EXECUTE ON FUNCTION release_crew_if_unlinked(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 1. First recorded day starts the order ───────────────────────────
CREATE OR REPLACE FUNCTION public.trg_work_entry_starts_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(NEW.hours, 0) > 0 OR COALESCE(NEW.overtime_hours, 0) > 0 OR COALESCE(NEW.quantity, 0) > 0 OR COALESCE(NEW.percent_done, 0) > 0 THEN
    UPDATE work_orders SET status = 'in_progress'
     WHERE status = 'requested'
       AND id = (SELECT work_order_id FROM labor_requisitions WHERE id = NEW.labor_requisition_id);
  END IF;
  RETURN NULL;
END $function$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_work_entry_starts_order') THEN
    EXECUTE 'CREATE TRIGGER trg_work_entry_starts_order AFTER INSERT OR UPDATE ON public.labour_work_entries
             FOR EACH ROW EXECUTE FUNCTION trg_work_entry_starts_order()';
  END IF;
END $$;

-- ── 2. A finished order closes its labour and releases its crew ──────
CREATE OR REPLACE FUNCTION public.trg_order_finish_closes_labour()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record;
BEGIN
  IF NEW.status NOT IN ('completed', 'cancelled') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  FOR r IN SELECT id FROM labor_requisitions WHERE work_order_id = NEW.id AND status = 'approved' AND closed_at IS NULL LOOP
    UPDATE labor_requisitions
       SET closed_at = now(), closed_by = auth.uid(), close_reason = 'Work order ' || NEW.status,
           end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
     WHERE id = r.id;
    UPDATE labor_allocations SET status = 'completed', end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
     WHERE labor_requisition_id = r.id AND status IN ('active', 'planned');
    UPDATE labor_commitments SET status = 'closed', updated_at = now() WHERE labor_requisition_id = r.id;
    PERFORM log_labour_event(r.id, 'closed', 'Work order ' || NEW.status);
  END LOOP;
  UPDATE work_order_crew SET removed_at = now(), removed_by_staff_id = current_staff_id()
   WHERE work_order_id = NEW.id AND removed_at IS NULL;
  RETURN NULL;
END $function$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_order_finish_closes_labour') THEN
    EXECUTE 'CREATE TRIGGER trg_order_finish_closes_labour AFTER UPDATE OF status ON public.work_orders
             FOR EACH ROW EXECUTE FUNCTION trg_order_finish_closes_labour()';
  END IF;
END $$;

-- finish_work_order: labour always closes now; it returns how many requests did.
CREATE OR REPLACE FUNCTION public.finish_work_order(p_wo uuid, p_status text, p_note text, p_close_labour boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_open int;
BEGIN
  IF p_status NOT IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'finish_work_order completes or cancels an order'; END IF;
  SELECT count(*) INTO v_open FROM labor_requisitions WHERE work_order_id = p_wo AND status = 'approved' AND closed_at IS NULL;
  PERFORM set_work_order_status(p_wo, p_status, p_note);
  RETURN v_open;
END $function$;

-- ── 3. Ending a worker on a request takes them off the crew ──────────
CREATE OR REPLACE FUNCTION public.trg_allocation_end_leaves_crew()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF OLD.status = 'active' AND NEW.status IS DISTINCT FROM 'active' AND NEW.labor_requisition_id IS NOT NULL THEN
    PERFORM release_crew_if_unlinked((SELECT work_order_id FROM labor_requisitions WHERE id = NEW.labor_requisition_id), NEW.staff_id);
  END IF;
  RETURN NULL;
END $function$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_allocation_end_leaves_crew') THEN
    EXECUTE 'CREATE TRIGGER trg_allocation_end_leaves_crew AFTER UPDATE OF status ON public.labor_allocations
             FOR EACH ROW EXECUTE FUNCTION trg_allocation_end_leaves_crew()';
  END IF;
END $$;

-- A request closed without ending its workers still stops putting them on the job.
CREATE OR REPLACE FUNCTION public.trg_request_close_leaves_crew()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s uuid;
BEGIN
  IF NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL AND NEW.work_order_id IS NOT NULL THEN
    FOR s IN SELECT DISTINCT staff_id FROM labor_allocations WHERE labor_requisition_id = NEW.id LOOP
      PERFORM release_crew_if_unlinked(NEW.work_order_id, s);
    END LOOP;
  END IF;
  RETURN NULL;
END $function$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_request_close_leaves_crew') THEN
    EXECUTE 'CREATE TRIGGER trg_request_close_leaves_crew AFTER UPDATE OF closed_at ON public.labor_requisitions
             FOR EACH ROW EXECUTE FUNCTION trg_request_close_leaves_crew()';
  END IF;
END $$;

-- ── 4. Recorded in two places the same day ───────────────────────────
-- For each worker on this site's day: their records elsewhere that day
-- (another site, or another work order here) and the day's total hours.
CREATE OR REPLACE FUNCTION public.labour_day_clashes(p_project uuid, p_date date)
RETURNS TABLE (staff_id uuid, worker_name text, total_hours numeric, elsewhere jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH mine AS (
    SELECT DISTINCT e.staff_id FROM labour_work_entries e
     WHERE e.project_id = p_project AND e.work_date = p_date AND e.staff_id IS NOT NULL AND can_run_labour_site(p_project)
  ), allx AS (
    SELECT e.staff_id, e.project_id, p.project_name, r.work_order_id, COALESCE(w.title, r.role_needed) AS what,
           COALESCE(e.hours, 0) + COALESCE(e.overtime_hours, 0) AS hours
      FROM labour_work_entries e
      JOIN mine m ON m.staff_id = e.staff_id
      JOIN labor_requisitions r ON r.id = e.labor_requisition_id
      LEFT JOIN work_orders w ON w.id = r.work_order_id
      LEFT JOIN projects p ON p.id = e.project_id
     WHERE e.work_date = p_date
  )
  SELECT a.staff_id, s.employee_name, sum(a.hours),
         jsonb_agg(jsonb_build_object('project', a.project_name, 'what', a.what, 'hours', a.hours) ORDER BY a.project_name, a.what)
    FROM allx a JOIN staff s ON s.id = a.staff_id
   GROUP BY a.staff_id, s.employee_name
  HAVING count(DISTINCT (a.project_id, a.work_order_id)) > 1 OR sum(a.hours) > 12;
$function$;
GRANT EXECUTE ON FUNCTION labour_day_clashes(uuid, date) TO authenticated;

-- ── One-off tidy-up ──────────────────────────────────────────────────
-- (a) Labour requests on orders already completed or cancelled: closed.
-- (b) Crew still on completed or cancelled orders: released.
-- (c) Casual workers on an open order's crew with no active labour on that
--     project at all: released.
-- (d) Orders worked on but still "Not started": in progress.
-- Requests that have simply gone quiet are left open; the Labour screen
-- lists them to end by hand.
-- Applied once on 27 Oct 2026 as a finance login (20 requests closed, 88
-- crew places released, 25 orders started). Changing a work order's status
-- needs a signed-in user (derive_task_progress_from_work_orders), so on a
-- replay without one this block does nothing.
DO $$
DECLARE r record; n_req int := 0; n_crew int; n_idle int; n_wo int;
BEGIN
  IF auth.uid() IS NULL AND NOT notify_is_service() THEN
    RAISE NOTICE 'tidy-up skipped: run it signed in';
    RETURN;
  END IF;
  FOR r IN SELECT q.id, w.status FROM labor_requisitions q JOIN work_orders w ON w.id = q.work_order_id
            WHERE w.status IN ('completed', 'cancelled') AND q.status = 'approved' AND q.closed_at IS NULL LOOP
    UPDATE labor_requisitions SET closed_at = now(), close_reason = 'Work order ' || r.status,
           end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE) WHERE id = r.id;
    UPDATE labor_allocations SET status = 'completed', end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
     WHERE labor_requisition_id = r.id AND status IN ('active', 'planned');
    UPDATE labor_commitments SET status = 'closed', updated_at = now() WHERE labor_requisition_id = r.id;
    PERFORM log_labour_event(r.id, 'closed', 'Work order ' || r.status || ' (tidy-up)');
    n_req := n_req + 1;
  END LOOP;

  UPDATE work_order_crew c SET removed_at = now()
    FROM work_orders w WHERE w.id = c.work_order_id AND c.removed_at IS NULL AND w.status IN ('completed', 'cancelled');
  GET DIAGNOSTICS n_crew = ROW_COUNT;

  UPDATE work_order_crew c SET removed_at = now()
    FROM work_orders w, staff s
   WHERE w.id = c.work_order_id AND s.id = c.staff_id AND c.removed_at IS NULL
     AND w.status IN ('requested', 'in_progress') AND s.employment_type = 'tier_2_casual'
     AND NOT EXISTS (SELECT 1 FROM labor_allocations a WHERE a.staff_id = c.staff_id AND a.project_id = w.project_id AND a.status = 'active');
  GET DIAGNOSTICS n_idle = ROW_COUNT;

  UPDATE work_orders w SET status = 'in_progress'
   WHERE w.status = 'requested'
     AND (EXISTS (SELECT 1 FROM labour_work_entries e JOIN labor_requisitions q ON q.id = e.labor_requisition_id WHERE q.work_order_id = w.id)
          OR EXISTS (SELECT 1 FROM wo_attendance_log l WHERE l.work_order_id = w.id AND (l.hours_logged > 0 OR l.volume_completed > 0)));
  GET DIAGNOSTICS n_wo = ROW_COUNT;

  RAISE NOTICE 'tidy-up: % requests closed, % crew released from finished orders, % idle crew released, % orders started', n_req, n_crew, n_idle, n_wo;
END $$;
