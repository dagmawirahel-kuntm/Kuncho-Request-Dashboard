-- 496: confirm pay and make the payment request in one step.
-- After confirming a PM's locked days the payables go straight into a draft
-- payment request; the PM attaches the signed attendance sheet and signs it
-- off. The preview also says up front which pay will be held at approval for
-- workers HR hasn't verified (day workers and piece jobs), and how much.

CREATE OR REPLACE FUNCTION public.labour_day_pay_preview(p_pm uuid, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v jsonb;
BEGIN
  IF NOT labour_day_can_see(p_pm) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  WITH c AS (SELECT * FROM labour_day_costs(p_pm, NULL, p_to) x WHERE x.day_status = 'locked' AND x.pay_run_id IS NULL),
  j AS (SELECT * FROM labour_day_job_costs(p_pm, p_to))
  SELECT jsonb_build_object(
    'pm', jsonb_build_object('id', p_pm, 'name', (SELECT employee_name FROM staff WHERE id = p_pm)),
    'to', p_to,
    'from', (SELECT min(work_date) FROM (SELECT work_date FROM c UNION ALL SELECT work_date FROM j) x),
    'last', (SELECT max(work_date) FROM (SELECT work_date FROM c UNION ALL SELECT work_date FROM j) x),
    'total', (SELECT COALESCE(sum(amount), 0) FROM c) + (SELECT COALESCE(sum(amount), 0) FROM j),
    'days', (SELECT count(DISTINCT day_id) FROM c),
    'workers', COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.employee_name, 'days', x.days, 'rate', x.rate,
                           'overtime_hours', x.ot_h, 'overtime', x.ot, 'amount', x.amount, 'verified', s.verified_at IS NOT NULL,
                           'held', worker_pay_held(s.id), 'no_rate', COALESCE(s.day_rate, 0) <= 0) ORDER BY s.employee_name)
                          FROM (SELECT staff_id, sum(days) AS days, max(day_rate) AS rate, sum(overtime_hours) AS ot_h, sum(overtime) AS ot, sum(amount) AS amount
                                  FROM c GROUP BY staff_id) x JOIN staff s ON s.id = x.staff_id), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', p.id, 'name', p.project_name, 'internal', COALESCE(p.is_internal, false),
                            'amount', x.amount, 'build_days', x.build, 'repair_days', x.repair, 'other_days', x.other) ORDER BY COALESCE(p.is_internal, false), p.project_name)
                           FROM (SELECT project_id, sum(amount) AS amount, sum(days) FILTER (WHERE bucket = 'build') AS build,
                                        sum(days) FILTER (WHERE bucket = 'repair') AS repair,
                                        sum(days) FILTER (WHERE bucket NOT IN ('build', 'repair')) AS other
                                   FROM c GROUP BY project_id) x JOIN projects p ON p.id = x.project_id), '[]'::jsonb),
    'jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'what', r.role_needed, 'project', p.project_name, 'basis', r.payment_basis,
                         'unit', r.volume_unit, 'quantity', x.qty, 'percent', x.pct, 'rate', x.rate, 'amount', x.amount,
                         'paid_to', COALESCE(v.vendor_name, CASE WHEN r.payment_model = 'gang_leader' THEN 'the crew leader' ELSE 'the crew' END),
                         -- Held at approval when the worker it's paid to isn't verified by HR (not crew-leader pay).
                         'held', r.payment_model <> 'gang_leader' AND EXISTS (SELECT 1 FROM labor_allocations a WHERE a.labor_requisition_id = r.id AND a.status = 'active' AND worker_pay_held(a.staff_id)),
                         'held_names', (SELECT string_agg(s.employee_name, ', ') FROM labor_allocations a JOIN staff s ON s.id = a.staff_id
                                         WHERE a.labor_requisition_id = r.id AND a.status = 'active' AND r.payment_model <> 'gang_leader' AND worker_pay_held(a.staff_id)))
                       ORDER BY p.project_name, r.role_needed)
                       FROM (SELECT labor_requisition_id, sum(quantity) AS qty, sum(percent_done) AS pct, max(rate) AS rate, sum(amount) AS amount
                               FROM j GROUP BY labor_requisition_id) x
                       JOIN labor_requisitions r ON r.id = x.labor_requisition_id JOIN projects p ON p.id = r.project_id
                       LEFT JOIN vendors v ON v.id = r.gang_leader_vendor_id), '[]'::jsonb),
    'not_locked', (SELECT count(*) FROM labour_days d WHERE d.pm_staff_id = p_pm AND d.work_date <= p_to AND d.status <> 'locked'
                     AND (EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id)
                          OR EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labour_day_id = d.id))))
  INTO v;
  RETURN v;
END $f$;

-- Confirm pay up to a date and put the payables into a new payment request.
CREATE OR REPLACE FUNCTION public.labour_day_pay_request(p_pm uuid, p_to date, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_run uuid; v_req uuid; v_exp uuid[]; v_total numeric; v_held numeric; v_names text;
BEGIN
  v_run := confirm_labour_day_pay(p_pm, p_to, p_note);
  SELECT array_agg(ps.expense_id), sum(ps.total) INTO v_exp, v_total
    FROM labour_pay_sheets ps WHERE ps.day_pay_run_id = v_run AND ps.expense_id IS NOT NULL;
  IF v_exp IS NULL THEN RAISE EXCEPTION 'Nothing to put in a payment request'; END IF;
  v_req := create_labour_pay_request(v_exp, p_note);
  SELECT COALESCE(sum(w.subtotal), 0), string_agg(DISTINCT s.employee_name, ', ') INTO v_held, v_names
    FROM labor_expense_workers w JOIN expenses e ON e.id = w.expense_id JOIN staff s ON s.id = w.staff_id
   WHERE w.expense_id = ANY (v_exp) AND e.vendor_id IS NULL AND worker_pay_held(w.staff_id);
  RETURN jsonb_build_object('run_id', v_run, 'request_id', v_req, 'request_code', (SELECT code FROM labour_pay_requests WHERE id = v_req),
                            'total', v_total, 'held', v_held, 'held_names', v_names);
END $f$;
