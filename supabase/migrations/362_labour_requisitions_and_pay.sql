-- 362 — Labour requisitions and labour pay
--
-- 1. Commitments counted each paid rollup twice. release_labor_commitment_
--    on_expense_paid added the amount every time an expense became 'paid',
--    and a rollup can become 'paid' more than once (bank confirmation re-sets
--    it), so released ran to 1.88M against 0.89M committed. Released is now
--    worked out from the paid rollups each time, never added to.
-- 2. slots_filled only counted hired candidates. Roster workers allocated
--    straight onto a requisition never counted, so filled requisitions read
--    as empty. It now counts the distinct workers allocated as well.
-- 3. A requisition can be closed (stop filling it, release the workers) and
--    extended (new end date, carried to its active workers), with a reason.
--    It stays 'approved' so the work already done can still be paid.
-- 4. Allocations still 'active' long after their requisition ended are
--    completed, when nobody has recorded work after the end date. Those
--    who have are left for a person to extend or end.
-- 5. v_labor_requisition_money: estimate, committed, paid, approved and
--    drafted per requisition, and work recorded but not yet drafted.
-- 6. labor_owed_by_week(): every approved requisition's recorded work that
--    no draft covers yet, by Monday-to-Sunday week, priced exactly as the
--    rollup would price it (preview_labor_rollup).

SET search_path TO public;

-- ── 1. Commitments ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_labor_commitment(p_req uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE labor_commitments c
     SET released_amount = x.paid,
         status = CASE
           WHEN c.status = 'closed' THEN 'closed'
           WHEN x.paid > 0 AND x.paid >= c.committed_amount THEN 'released'
           ELSE 'active' END,
         updated_at = now()
    FROM (SELECT COALESCE(SUM(e.amount_etb), 0) AS paid
            FROM expenses e
           WHERE e.rolled_up_from_requisition_id = p_req AND e.payment_state = 'paid') x
   WHERE c.labor_requisition_id = p_req;
$$;

CREATE OR REPLACE FUNCTION release_labor_commitment_on_expense_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.rolled_up_from_requisition_id IS NOT NULL AND (
       TG_OP = 'DELETE'
       OR OLD.payment_state IS DISTINCT FROM NEW.payment_state
       OR OLD.amount_etb IS DISTINCT FROM NEW.amount_etb
       OR OLD.rolled_up_from_requisition_id IS DISTINCT FROM NEW.rolled_up_from_requisition_id) THEN
    PERFORM recompute_labor_commitment(OLD.rolled_up_from_requisition_id);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.rolled_up_from_requisition_id IS NOT NULL
     AND NEW.rolled_up_from_requisition_id IS DISTINCT FROM OLD.rolled_up_from_requisition_id THEN
    PERFORM recompute_labor_commitment(NEW.rolled_up_from_requisition_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_release_labor_commitment ON expenses;
CREATE TRIGGER trg_release_labor_commitment
  AFTER UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION release_labor_commitment_on_expense_paid();

SELECT recompute_labor_commitment(labor_requisition_id) FROM labor_commitments;

-- ── 2. Filled slots ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_requisition_slots(p_req uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE labor_requisitions r
     SET slots_filled = x.n
    FROM (SELECT GREATEST(
            (SELECT count(*) FROM candidates c WHERE c.labor_requisition_id = p_req AND c.outcome = 'hired'),
            (SELECT count(DISTINCT a.staff_id) FROM labor_allocations a
              WHERE a.labor_requisition_id = p_req AND a.status <> 'cancelled'))::int AS n) x
   WHERE r.id = p_req AND r.slots_filled IS DISTINCT FROM x.n;
$$;

CREATE OR REPLACE FUNCTION update_requisition_slot_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.labor_requisition_id IS NOT NULL THEN
    PERFORM refresh_requisition_slots(OLD.labor_requisition_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.labor_requisition_id IS NOT NULL THEN
    PERFORM refresh_requisition_slots(NEW.labor_requisition_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_allocation_refresh_slots ON labor_allocations;
CREATE TRIGGER trg_allocation_refresh_slots
  AFTER INSERT OR DELETE OR UPDATE OF labor_requisition_id, status ON labor_allocations
  FOR EACH ROW EXECUTE FUNCTION update_requisition_slot_status();

SELECT refresh_requisition_slots(id) FROM labor_requisitions;

-- ── 3. Decisions, closing and extending ────────────────────────────────────
ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS decision_note text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS close_reason text;

CREATE OR REPLACE FUNCTION can_manage_labor_requisition(p_req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'hr_officer', 'operations_manager'), false)
      OR EXISTS (SELECT 1 FROM labor_requisitions r WHERE r.id = p_req AND manages_project(r.project_id));
$$;

CREATE OR REPLACE FUNCTION extend_labor_requisition(p_id uuid, p_new_end date, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req labor_requisitions%ROWTYPE; v_n int;
BEGIN
  IF NOT can_manage_labor_requisition(p_id) THEN
    RAISE EXCEPTION 'Only HR, operations, admin or the project''s manager may extend this requisition';
  END IF;
  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition not found'; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved requisition can be extended'; END IF;
  IF p_new_end IS NULL OR p_new_end < v_req.start_date THEN
    RAISE EXCEPTION 'The new end date must be on or after the start date (%)', v_req.start_date;
  END IF;

  UPDATE labor_requisitions
     SET end_date = p_new_end, closed_at = NULL, closed_by = NULL, close_reason = NULL,
         notes = concat_ws(E'\n', NULLIF(notes, ''),
                   'Extended ' || COALESCE(to_char(v_req.end_date, 'DD Mon YYYY'), 'open') || ' → ' || to_char(p_new_end, 'DD Mon YYYY')
                   || COALESCE(': ' || NULLIF(trim(p_note), ''), ''))
   WHERE id = p_id;

  -- Workers still on it carry on to the new date.
  UPDATE labor_allocations
     SET end_date = p_new_end
   WHERE labor_requisition_id = p_id AND status IN ('active', 'planned');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE labor_commitments SET status = 'active', updated_at = now()
   WHERE labor_requisition_id = p_id AND status = 'closed';
  PERFORM recompute_labor_commitment(p_id);
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION close_labor_requisition(p_id uuid, p_reason text, p_end_workers boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req labor_requisitions%ROWTYPE; v_n int := 0;
BEGIN
  IF NOT can_manage_labor_requisition(p_id) THEN
    RAISE EXCEPTION 'Only HR, operations, admin or the project''s manager may close this requisition';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why the requisition is being closed'; END IF;
  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition not found'; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved requisition can be closed — reject a pending one instead'; END IF;

  UPDATE labor_requisitions
     SET closed_at = now(), closed_by = auth.uid(), close_reason = trim(p_reason),
         end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
   WHERE id = p_id;

  IF p_end_workers THEN
    UPDATE labor_allocations
       SET status = 'completed', end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
     WHERE labor_requisition_id = p_id AND status IN ('active', 'planned');
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  -- What was never spent is no longer committed.
  UPDATE labor_commitments SET status = 'closed', updated_at = now() WHERE labor_requisition_id = p_id;
  RETURN v_n;
END $$;

-- ── 4. Allocations left running after their requisition ended ──────────────
CREATE OR REPLACE FUNCTION complete_expired_labor_allocations(p_req uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF p_req IS NULL THEN
    IF COALESCE(get_user_role()::text NOT IN ('admin', 'executive', 'hr_officer', 'operations_manager'), true)
       AND current_user NOT IN ('postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'Only HR, operations or admin may close out expired allocations everywhere';
    END IF;
  ELSIF NOT can_manage_labor_requisition(p_req) THEN
    RAISE EXCEPTION 'Not allowed on this requisition';
  END IF;

  WITH done AS (
    UPDATE labor_allocations a
       SET status = 'completed', end_date = LEAST(COALESCE(a.end_date, r.end_date), r.end_date)
      FROM labor_requisitions r
     WHERE r.id = a.labor_requisition_id
       AND (p_req IS NULL OR r.id = p_req)
       AND a.status IN ('active', 'planned')
       AND r.end_date < CURRENT_DATE
       AND NOT EXISTS (SELECT 1 FROM timesheet_attendance t
                        WHERE t.staff_id = a.staff_id AND t.project_id = a.project_id AND t.work_date > r.end_date)
       AND NOT EXISTS (SELECT 1 FROM timesheet t
                        WHERE t.staff_id = a.staff_id AND t.project_id = a.project_id AND t.date > r.end_date)
    RETURNING 1)
  SELECT count(*) INTO v_n FROM done;
  RETURN v_n;
END $$;

SELECT complete_expired_labor_allocations();

-- ── 5. Money per requisition ───────────────────────────────────────────────
CREATE OR REPLACE VIEW v_labor_requisition_money WITH (security_invoker = on) AS
SELECT r.id AS labor_requisition_id,
  COALESCE(r.estimated_total_cost, c.committed_amount) AS estimated,
  c.committed_amount,
  c.status AS commitment_status,
  COALESCE(SUM(e.amount_etb) FILTER (WHERE e.payment_state = 'paid'), 0) AS paid,
  COALESCE(SUM(e.amount_etb) FILTER (WHERE e.payment_state IN ('approved_to_pay', 'sent')), 0) AS approved_unpaid,
  COALESCE(SUM(e.amount_etb) FILTER (WHERE e.payment_state = 'unpaid' AND e.approval_status::text <> 'rejected'), 0) AS drafted,
  count(e.id) FILTER (WHERE e.payment_state <> 'void' AND e.approval_status::text <> 'rejected')::int AS rollups,
  (SELECT count(*) FROM timesheet_attendance t WHERE t.labor_requisition_id = r.id AND t.rolled_up_expense_id IS NULL)::int
    + (SELECT count(*) FROM timesheet t WHERE t.labor_requisition_id = r.id AND t.rolled_up_expense_id IS NULL AND t.staff_id IS NOT NULL)::int
    AS undrafted_entries,
  GREATEST(
    (SELECT max(t.work_date) FROM timesheet_attendance t WHERE t.labor_requisition_id = r.id),
    (SELECT max(t.date) FROM timesheet t WHERE t.labor_requisition_id = r.id)) AS last_work_date
FROM labor_requisitions r
LEFT JOIN labor_commitments c ON c.labor_requisition_id = r.id
LEFT JOIN expenses e ON e.rolled_up_from_requisition_id = r.id
GROUP BY r.id, r.estimated_total_cost, c.committed_amount, c.status;

GRANT SELECT ON v_labor_requisition_money TO authenticated;

-- ── 6. Work recorded but not drafted, by week ──────────────────────────────
CREATE OR REPLACE FUNCTION labor_owed_by_week(p_until date DEFAULT NULL)
RETURNS TABLE (labor_requisition_id uuid, week_start date, week_end date, first_day date, last_day date,
               entries integer, worker_count integer, total_units numeric, unit_label text, total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k record; p record;
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'executive', 'finance', 'hr_officer') THEN
    RAISE EXCEPTION 'Only admin, executive, finance, or HR may see labour owed';
  END IF;
  FOR k IN
    SELECT u.req, date_trunc('week', u.d)::date AS ws, min(u.d) AS f, max(u.d) AS l, count(*)::int AS n
      FROM (SELECT t.labor_requisition_id AS req, t.work_date AS d FROM timesheet_attendance t
             WHERE t.rolled_up_expense_id IS NULL AND t.labor_requisition_id IS NOT NULL
            UNION ALL
            SELECT t.labor_requisition_id, t.date FROM timesheet t
             WHERE t.rolled_up_expense_id IS NULL AND t.labor_requisition_id IS NOT NULL AND t.staff_id IS NOT NULL) u
      JOIN labor_requisitions r ON r.id = u.req AND r.status = 'approved'
     WHERE p_until IS NULL OR u.d <= p_until
     GROUP BY 1, 2
     ORDER BY 2, 1
  LOOP
    SELECT * INTO p FROM preview_labor_rollup(k.req, k.ws, k.ws + 6);
    labor_requisition_id := k.req; week_start := k.ws; week_end := k.ws + 6;
    first_day := k.f; last_day := k.l; entries := k.n;
    worker_count := p.worker_count; total_units := p.total_units; unit_label := p.unit_label; total_amount := p.total_amount;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION labor_owed_by_week(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION labor_owed_by_week(date) TO authenticated;
GRANT EXECUTE ON FUNCTION extend_labor_requisition(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION close_labor_requisition(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_expired_labor_allocations(uuid) TO authenticated;
REVOKE ALL ON FUNCTION extend_labor_requisition(uuid, date, text), close_labor_requisition(uuid, text, boolean), complete_expired_labor_allocations(uuid) FROM anon;
REVOKE ALL ON FUNCTION recompute_labor_commitment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refresh_requisition_slots(uuid) FROM PUBLIC, anon, authenticated;

-- ── Operations health: a closed requisition is no longer "unfilled" ────────
DO $$
DECLARE d text := pg_get_viewdef('v_ops_health_items'::regclass, true);
BEGIN
  IF strpos(d, 'r.closed_at IS NULL') = 0 THEN
    d := replace(d, 'AND COALESCE(r.slots_filled, 0) < r.headcount', 'AND r.closed_at IS NULL AND COALESCE(r.slots_filled, 0) < r.headcount');
    EXECUTE 'CREATE OR REPLACE VIEW v_ops_health_items WITH (security_invoker = on) AS ' || d;
  END IF;
END $$;
