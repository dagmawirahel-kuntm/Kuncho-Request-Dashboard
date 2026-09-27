-- 363 — Attendance on per-volume requisitions is not pay
--
-- A per-volume requisition is paid on the volume in its timesheets; the
-- attendance days recorded against it never price anything (the rollup and
-- its preview ignore them). labor_owed_by_week and v_labor_requisition_money
-- counted them as work not yet drafted, which listed 55 already-paid days
-- as outstanding. Only per-day requisitions count attendance now.

SET search_path TO public;

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
              JOIN labor_requisitions q ON q.id = t.labor_requisition_id AND q.payment_basis = 'per_day'
             WHERE t.rolled_up_expense_id IS NULL
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

CREATE OR REPLACE VIEW v_labor_requisition_money WITH (security_invoker = on) AS
SELECT r.id AS labor_requisition_id,
  COALESCE(r.estimated_total_cost, c.committed_amount) AS estimated,
  c.committed_amount,
  c.status AS commitment_status,
  COALESCE(SUM(e.amount_etb) FILTER (WHERE e.payment_state = 'paid'), 0) AS paid,
  COALESCE(SUM(e.amount_etb) FILTER (WHERE e.payment_state IN ('approved_to_pay', 'sent')), 0) AS approved_unpaid,
  COALESCE(SUM(e.amount_etb) FILTER (WHERE e.payment_state = 'unpaid' AND e.approval_status::text <> 'rejected'), 0) AS drafted,
  count(e.id) FILTER (WHERE e.payment_state <> 'void' AND e.approval_status::text <> 'rejected')::int AS rollups,
  (CASE WHEN r.payment_basis = 'per_day'
        THEN (SELECT count(*) FROM timesheet_attendance t WHERE t.labor_requisition_id = r.id AND t.rolled_up_expense_id IS NULL)
        ELSE 0 END)::int
    + (SELECT count(*) FROM timesheet t WHERE t.labor_requisition_id = r.id AND t.rolled_up_expense_id IS NULL AND t.staff_id IS NOT NULL)::int
    AS undrafted_entries,
  GREATEST(
    (SELECT max(t.work_date) FROM timesheet_attendance t WHERE t.labor_requisition_id = r.id),
    (SELECT max(t.date) FROM timesheet t WHERE t.labor_requisition_id = r.id)) AS last_work_date
FROM labor_requisitions r
LEFT JOIN labor_commitments c ON c.labor_requisition_id = r.id
LEFT JOIN expenses e ON e.rolled_up_from_requisition_id = r.id
GROUP BY r.id, r.estimated_total_cost, r.payment_basis, c.committed_amount, c.status;
