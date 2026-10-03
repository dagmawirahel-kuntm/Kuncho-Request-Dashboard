-- 408 — One labour picture per work order
--
-- What the data showed (Oct 2026):
--   * The work-order board read labour cost only from the new labour
--     entries (375) — one entry so far — so every order showed 0, while the
--     attendance foremen logged against orders from 3 Aug to 10 Sep came to
--     1.18M. The order page added the two together; the list, the project
--     page and the workshop view each read a different one.
--   * 13 of 81 labour requests had no work order, although 4 of them were
--     only ever worked on one order.
--   * 16 approved requests were still open on orders already completed or
--     cancelled — nothing closed them when the job ended.
--   * A worker given to a labour request for an order did not join that
--     order's crew.
--
-- Now:
--   * v_work_order_cost.labor_cost = attendance logged on the order (by the
--     order it was logged on) + the new labour entries and confirmed pay of
--     the order's labour requests. The board's labour_cost is that same
--     figure, so the list, the order page, the project page and the
--     workshop view agree. The two parts stay visible as separate columns.
--   * v_work_order_labour_history: the attendance logged before the new
--     labour screens, per order and worker, including days that were paid
--     under another order's request.
--   * The 4 requests worked on a single order are linked to it.
--   * A worker assigned through an order's labour request joins its crew.
--   * finish_work_order() completes or cancels an order and ends its labour
--     requests; close_labour_of_finished_orders() does the same for orders
--     already finished (16 requests).

SET search_path TO public;

-- ── 1. Attendance history per order and worker ────────────────────────
CREATE OR REPLACE VIEW v_work_order_labour_history WITH (security_invoker = true) AS
SELECT l.work_order_id,
       l.staff_id,
       s.employee_name AS worker_name,
       count(DISTINCT l.log_date)::int AS days,
       min(l.log_date) AS first_day,
       max(l.log_date) AS last_day,
       round(sum(COALESCE(ts.days_worked, 0) * COALESCE(ts.day_rate, 0)
                 + COALESCE(ts.volume_completed, 0) * COALESCE(ts.day_rate, 0)
                 + COALESCE(ts.overtime_amount, 0)), 2) AS cost,
       round(sum(CASE WHEN ts.rolled_up_expense_id IS NOT NULL THEN
                   COALESCE(ts.days_worked, 0) * COALESCE(ts.day_rate, 0)
                   + COALESCE(ts.volume_completed, 0) * COALESCE(ts.day_rate, 0)
                   + COALESCE(ts.overtime_amount, 0) ELSE 0 END), 2) AS drafted_for_pay,
       round(sum(CASE WHEN r.work_order_id IS DISTINCT FROM l.work_order_id THEN
                   COALESCE(ts.days_worked, 0) * COALESCE(ts.day_rate, 0)
                   + COALESCE(ts.volume_completed, 0) * COALESCE(ts.day_rate, 0)
                   + COALESCE(ts.overtime_amount, 0) ELSE 0 END), 2) AS paid_under_other_order
FROM wo_attendance_log l
JOIN timesheet ts ON ts.id = l.synced_timesheet_id
LEFT JOIN labor_requisitions r ON r.id = ts.labor_requisition_id
LEFT JOIN staff s ON s.id = l.staff_id
WHERE l.work_order_id IS NOT NULL
GROUP BY l.work_order_id, l.staff_id, s.employee_name;

GRANT SELECT ON v_work_order_labour_history TO authenticated;

-- ── 2. One labour cost per order ─────────────────────────────────────
CREATE OR REPLACE VIEW v_work_order_cost WITH (security_invoker = on) AS
 WITH linked_alloc AS (
         SELECT wol.work_order_id, la.id AS labor_allocation_id, la.staff_id, la.labor_requisition_id,
            la.day_rate_snapshot, la.start_date, la.end_date
           FROM work_order_labor wol
             JOIN labor_allocations la ON la.id = wol.labor_allocation_id
        ), crew_fallback AS (
         SELECT DISTINCT ON (wc.work_order_id, wc.staff_id) wc.work_order_id, wc.staff_id,
            la.id AS labor_allocation_id, la.labor_requisition_id, la.day_rate_snapshot, la.start_date, la.end_date
           FROM work_order_crew wc
             JOIN work_orders wo2 ON wo2.id = wc.work_order_id
             LEFT JOIN labor_allocations la ON la.staff_id = wc.staff_id AND la.project_id = wo2.project_id AND la.status = 'active'
          WHERE wc.removed_at IS NULL AND NOT EXISTS (
                  SELECT 1 FROM linked_alloc x WHERE x.work_order_id = wc.work_order_id AND x.staff_id = wc.staff_id)
          ORDER BY wc.work_order_id, wc.staff_id, la.start_date DESC NULLS LAST
        ), crew_alloc AS (
         SELECT work_order_id, staff_id, labor_allocation_id, labor_requisition_id, day_rate_snapshot, start_date, end_date FROM linked_alloc
        UNION ALL
         SELECT work_order_id, staff_id, labor_allocation_id, labor_requisition_id, day_rate_snapshot, start_date, end_date FROM crew_fallback
        ), req_estimate AS (
         SELECT DISTINCT crew_alloc.work_order_id, crew_alloc.labor_requisition_id
           FROM crew_alloc WHERE crew_alloc.labor_requisition_id IS NOT NULL
        ), no_req_estimate AS (
         SELECT ca.work_order_id, ca.staff_id,
            ((COALESCE(ca.end_date, CURRENT_DATE) - ca.start_date) + 1)::numeric * COALESCE(ca.day_rate_snapshot, s.day_rate, 0::numeric) AS est
           FROM crew_alloc ca LEFT JOIN staff s ON s.id = ca.staff_id
          WHERE ca.labor_requisition_id IS NULL AND ca.labor_allocation_id IS NOT NULL
        ), estimate AS (
         SELECT x.work_order_id, sum(x.total) AS total
           FROM ( SELECT re.work_order_id,
                    COALESCE(NULLIF(req.estimated_total_cost, 0::numeric),
                        CASE WHEN req.payment_basis = 'per_volume' THEN req.unit_rate * COALESCE(req.estimated_total_volume, 0::numeric)
                             ELSE req.estimated_day_rate * COALESCE(req.estimated_days, 0::numeric) * req.headcount::numeric END,
                        0::numeric) AS total
                   FROM req_estimate re JOIN labor_requisitions req ON req.id = re.labor_requisition_id
                UNION ALL
                 SELECT no_req_estimate.work_order_id, no_req_estimate.est FROM no_req_estimate) x
          GROUP BY x.work_order_id
        ), actual AS (
         SELECT wal.work_order_id,
            sum(COALESCE(ts.days_worked, 0::numeric) * COALESCE(ts.day_rate, 0::numeric)
                + COALESCE(ts.volume_completed, 0::numeric) * COALESCE(ts.day_rate, 0::numeric)
                + COALESCE(ts.overtime_amount, 0::numeric)) AS total
           FROM wo_attendance_log wal JOIN timesheet ts ON ts.id = wal.synced_timesheet_id
          WHERE wal.work_order_id IS NOT NULL
          GROUP BY wal.work_order_id
        ), recorded AS (
         SELECT l.work_order_id, sum(l.confirmed_cost + l.recorded_cost) AS total
           FROM v_work_order_labour l
          GROUP BY l.work_order_id
        ), materials AS (
         SELECT wom.work_order_id, sum(si.total_cost) AS total
           FROM work_order_materials wom JOIN stock_issues si ON si.id = wom.stock_issue_id
          GROUP BY wom.work_order_id
        )
 SELECT wo.id AS work_order_id,
    COALESCE(actual.total, 0::numeric) + COALESCE(recorded.total, 0::numeric) AS labor_cost,
    COALESCE(estimate.total, 0::numeric) AS labor_cost_estimated,
    COALESCE(materials.total, 0::numeric) AS materials_cost,
    COALESCE(actual.total, 0::numeric) + COALESCE(recorded.total, 0::numeric) + COALESCE(materials.total, 0::numeric) AS total_cost,
    COALESCE(estimate.total, 0::numeric) + COALESCE(materials.total, 0::numeric) AS total_cost_estimated,
    COALESCE(actual.total, 0::numeric) AS labor_cost_attendance,
    COALESCE(recorded.total, 0::numeric) AS labor_cost_recorded
   FROM work_orders wo
     LEFT JOIN estimate ON estimate.work_order_id = wo.id
     LEFT JOIN actual ON actual.work_order_id = wo.id
     LEFT JOIN recorded ON recorded.work_order_id = wo.id
     LEFT JOIN materials ON materials.work_order_id = wo.id;

CREATE OR REPLACE VIEW v_work_order_board WITH (security_invoker = true) AS
 SELECT w.id AS work_order_id,
    ( SELECT count(*) FROM work_order_items i WHERE i.work_order_id = w.id) AS items_total,
    ( SELECT count(*) FROM work_order_items i
          WHERE i.work_order_id = w.id AND
                CASE WHEN i.quantity IS NULL THEN i.done_quantity > 0::numeric ELSE i.done_quantity >= i.quantity END) AS items_done,
    GREATEST(( SELECT max(u.created_at) FROM wo_progress_updates u WHERE u.work_order_id = w.id),
             ( SELECT max(e.recorded_at) FROM labour_work_entries e JOIN labor_requisitions r ON r.id = e.labor_requisition_id
                WHERE r.work_order_id = w.id)) AS last_update_at,
    ( SELECT count(*) FROM labor_requisitions r
          WHERE r.work_order_id = w.id AND r.status <> 'rejected' AND r.closed_at IS NULL) AS open_labour_requests,
    COALESCE(c.labor_cost, 0::numeric) AS labour_cost,
    ( SELECT count(*) FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL) AS open_blockers,
    ( SELECT count(*) FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL AND b.stops_work) AS stopping_blockers,
    ( SELECT min(b.raised_at) FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL AND b.stops_work) AS blocked_since,
    ( SELECT b.kind FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL
          ORDER BY b.stops_work DESC, b.raised_at LIMIT 1) AS main_blocker_kind,
    ( SELECT b.description FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL
          ORDER BY b.stops_work DESC, b.raised_at LIMIT 1) AS main_blocker,
    work_order_days_lost(w.id) AS days_lost,
    CASE WHEN w.target_completion_date IS NOT NULL THEN w.target_completion_date + work_order_days_lost(w.id) ELSE NULL::date END AS adjusted_due_date,
    COALESCE(c.labor_cost_estimated, 0::numeric) AS labour_estimate,
    ( SELECT count(DISTINCT x.staff_id) FROM (
        SELECT l.staff_id FROM wo_attendance_log l WHERE l.work_order_id = w.id
        UNION SELECT e.staff_id FROM labour_work_entries e JOIN labor_requisitions r ON r.id = e.labor_requisition_id
               WHERE r.work_order_id = w.id AND e.staff_id IS NOT NULL) x) AS workers_logged
   FROM work_orders w
   LEFT JOIN v_work_order_cost c ON c.work_order_id = w.id;

-- ── 3. Requests worked on a single order belong to it ────────────────
UPDATE labor_requisitions r
   SET work_order_id = h.wo
  FROM (SELECT ts.labor_requisition_id AS req, min(l.work_order_id::text)::uuid AS wo
          FROM timesheet ts JOIN wo_attendance_log l ON l.synced_timesheet_id = ts.id
         WHERE l.work_order_id IS NOT NULL
         GROUP BY ts.labor_requisition_id
        HAVING count(DISTINCT l.work_order_id) = 1) h
  JOIN work_orders w ON w.id = h.wo
 WHERE r.id = h.req AND r.work_order_id IS NULL AND w.project_id = r.project_id;

-- ── 4. Workers given to an order's labour request join its crew ──────
CREATE OR REPLACE FUNCTION labour_allocation_joins_crew()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_wo uuid; v_role text;
BEGIN
  IF NEW.status <> 'active' OR NEW.labor_requisition_id IS NULL THEN RETURN NEW; END IF;
  SELECT work_order_id, role_needed INTO v_wo, v_role FROM labor_requisitions WHERE id = NEW.labor_requisition_id;
  IF v_wo IS NULL THEN RETURN NEW; END IF;
  INSERT INTO work_order_crew (work_order_id, staff_id, role_on_wo, assigned_by_staff_id)
  SELECT v_wo, NEW.staff_id, v_role, current_staff_id()
   WHERE NOT EXISTS (SELECT 1 FROM work_order_crew c WHERE c.work_order_id = v_wo AND c.staff_id = NEW.staff_id AND c.removed_at IS NULL);
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_labour_allocation_joins_crew
  AFTER INSERT OR UPDATE OF status, labor_requisition_id ON labor_allocations
  FOR EACH ROW EXECUTE FUNCTION labour_allocation_joins_crew();

-- A request given a work order later brings its workers along.
CREATE OR REPLACE FUNCTION labour_request_order_brings_crew()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.work_order_id IS NULL OR NEW.work_order_id IS NOT DISTINCT FROM OLD.work_order_id THEN RETURN NEW; END IF;
  INSERT INTO work_order_crew (work_order_id, staff_id, role_on_wo, assigned_by_staff_id)
  SELECT DISTINCT NEW.work_order_id, la.staff_id, NEW.role_needed, current_staff_id()
    FROM labor_allocations la
   WHERE la.labor_requisition_id = NEW.id AND la.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM work_order_crew c WHERE c.work_order_id = NEW.work_order_id AND c.staff_id = la.staff_id AND c.removed_at IS NULL);
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_labour_request_order_brings_crew
  AFTER UPDATE OF work_order_id ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION labour_request_order_brings_crew();

-- Bring the crews up to date once.
INSERT INTO work_order_crew (work_order_id, staff_id, role_on_wo)
SELECT DISTINCT ON (r.work_order_id, la.staff_id) r.work_order_id, la.staff_id, r.role_needed
  FROM labor_allocations la JOIN labor_requisitions r ON r.id = la.labor_requisition_id
 WHERE la.status = 'active' AND r.work_order_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM work_order_crew c WHERE c.work_order_id = r.work_order_id AND c.staff_id = la.staff_id AND c.removed_at IS NULL);

-- ── 5. Finishing an order can end its labour requests ────────────────
-- A separate function rather than a new parameter on set_work_order_status:
-- dropping/re-creating that function stalls on this database (the DDL drop
-- hooks), and keeping its signature leaves every existing caller alone.
CREATE OR REPLACE FUNCTION finish_work_order(p_wo uuid, p_status text, p_note text, p_close_labour boolean DEFAULT true)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r record; v_closed int := 0;
BEGIN
  IF p_status NOT IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'finish_work_order completes or cancels an order'; END IF;
  PERFORM set_work_order_status(p_wo, p_status, p_note);
  IF p_close_labour THEN
    FOR r IN SELECT id FROM labor_requisitions WHERE work_order_id = p_wo AND status = 'approved' AND closed_at IS NULL LOOP
      UPDATE labor_requisitions
         SET closed_at = now(), closed_by = auth.uid(),
             close_reason = 'Work order ' || p_status,
             end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
       WHERE id = r.id;
      UPDATE labor_allocations SET status = 'completed', end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
       WHERE labor_requisition_id = r.id AND status IN ('active', 'planned');
      UPDATE labor_commitments SET status = 'closed', updated_at = now() WHERE labor_requisition_id = r.id;
      v_closed := v_closed + 1;
    END LOOP;
  END IF;
  RETURN v_closed;
END $fn$;
REVOKE ALL ON FUNCTION finish_work_order(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finish_work_order(uuid, text, text, boolean) TO authenticated;

-- Orders already finished, with labour still open: ended the same way.
CREATE OR REPLACE FUNCTION close_labour_of_finished_orders()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r record; v int := 0;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'operations_manager', 'hr_officer') THEN
    RAISE EXCEPTION 'Only admin, operations or HR can close labour in bulk';
  END IF;
  FOR r IN SELECT q.id, w.status FROM labor_requisitions q JOIN work_orders w ON w.id = q.work_order_id
            WHERE w.status IN ('completed', 'cancelled') AND q.status = 'approved' AND q.closed_at IS NULL LOOP
    UPDATE labor_requisitions
       SET closed_at = now(), closed_by = auth.uid(), close_reason = 'Work order ' || r.status,
           end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
     WHERE id = r.id;
    UPDATE labor_allocations SET status = 'completed', end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
     WHERE labor_requisition_id = r.id AND status IN ('active', 'planned');
    UPDATE labor_commitments SET status = 'closed', updated_at = now() WHERE labor_requisition_id = r.id;
    v := v + 1;
  END LOOP;
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION close_labour_of_finished_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_labour_of_finished_orders() TO authenticated;
