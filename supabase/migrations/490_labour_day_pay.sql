-- 490: pay from the day sheets (489).
-- The PM confirms pay for their locked days up to a date. Each worker is
-- paid their own day rate for each half or whole day, plus overtime at the
-- company rates; the cost lands on the projects the day went to — one
-- labour payable per project (internal ones for workshop, stock production
-- and idle time), each with its own pay sheet. From there it is the same
-- road as today: the PM puts the payables in a payment request with the
-- signed attendance sheet, finance approves and pays, HR's hold applies.
-- Also: the daily request notifies through the existing labour kinds.

-- The request's notifications use the labour kinds people already have
-- settings for.
CREATE OR REPLACE FUNCTION public.labour_day_request_save(p_pm uuid, p_date date, p_lines jsonb, p_note text DEFAULT NULL, p_submit boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_day_settings%ROWTYPE; r labour_day_requests%ROWTYPE;
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  v_bad text;
BEGIN
  IF NOT labour_day_can_run(p_pm) THEN RAISE EXCEPTION 'You send the daily labour request for your own workers'; END IF;
  SELECT * INTO s FROM labour_day_settings WHERE id;
  IF s.starts_on IS NULL THEN RAISE EXCEPTION 'The daily labour request hasn''t started yet — admin sets its start date'; END IF;
  IF p_date < s.starts_on THEN RAISE EXCEPTION 'Daily labour requests start on %', to_char(s.starts_on, 'DD Mon YYYY'); END IF;
  IF p_date <= bot_today() THEN
    RAISE EXCEPTION 'Ask before the day: a request for % had to be approved by the end of the day before', to_char(p_date, 'DD Mon');
  END IF;
  SELECT string_agg(DISTINCT x->>'trade', ', ') INTO v_bad FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) x
   WHERE NOT EXISTS (SELECT 1 FROM tier2_trade_roster t WHERE t.trade_tag = x->>'trade');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown trade: %', v_bad; END IF;

  SELECT * INTO r FROM labour_day_requests WHERE pm_staff_id = p_pm AND work_date = p_date FOR UPDATE;
  IF r.id IS NULL THEN
    INSERT INTO labour_day_requests (code, pm_staff_id, work_date, created_by, created_by_name)
    VALUES ('LDR-' || to_char(p_date, 'YYYY') || '-' || lpad(nextval('labour_day_request_seq')::text, 4, '0'),
            p_pm, p_date, auth.uid(), v_name)
    RETURNING * INTO r;
  END IF;
  -- A change after a decision goes back for approval.
  UPDATE labour_day_requests
     SET note = NULLIF(btrim(p_note), ''),
         status = CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END,
         submitted_at = CASE WHEN p_submit THEN now() END,
         decided_by = NULL, decided_by_name = NULL, decided_at = NULL,
         decision_note = CASE WHEN r.status = 'rejected' THEN decision_note END,
         updated_at = now()
   WHERE id = r.id;
  DELETE FROM labour_day_request_lines WHERE request_id = r.id;
  INSERT INTO labour_day_request_lines (request_id, trade_tag, headcount)
  SELECT r.id, x->>'trade', sum((x->>'headcount')::int)
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) x
   WHERE COALESCE(NULLIF(x->>'headcount', '')::int, 0) > 0
   GROUP BY 2;
  IF p_submit AND NOT EXISTS (SELECT 1 FROM labour_day_request_lines WHERE request_id = r.id) THEN
    RAISE EXCEPTION 'Add at least one trade and how many';
  END IF;
  IF p_submit THEN
    INSERT INTO notifications (user_id, kind, title, body, link, entity_type, entity_id, actor_id, dedupe_key)
    SELECT u.id, 'labour.requested', 'Daily labour request to approve',
           format('%s · %s · %s workers', (SELECT employee_name FROM staff WHERE id = p_pm), to_char(p_date, 'Dy DD Mon'),
                  (SELECT sum(headcount) FROM labour_day_request_lines WHERE request_id = r.id)),
           '/labour/day-requests', 'labour_day_request', r.id, auth.uid(), 'ldr-' || r.id || '-' || extract(epoch FROM now())::bigint
      FROM user_profiles u
     WHERE u.account_status = 'active' AND (u.role = 'operations_manager' OR u.is_operations_manager) AND u.id IS DISTINCT FROM auth.uid()
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN r.id;
END $f$;

CREATE OR REPLACE FUNCTION public.labour_day_request_decide(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r labour_day_requests%ROWTYPE; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT labour_day_is_approver() THEN RAISE EXCEPTION 'Only the operations manager, HR or admin approve labour requests'; END IF;
  SELECT * INTO r FROM labour_day_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found — refresh'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'Only a sent request can be approved or rejected'; END IF;
  IF p_approve AND r.work_date <= bot_today() THEN
    RAISE EXCEPTION 'Too late: % has started. A request is approved before its day', to_char(r.work_date, 'DD Mon');
  END IF;
  IF NOT p_approve AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why it''s rejected'; END IF;
  UPDATE labour_day_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
         decision_note = NULLIF(btrim(p_note), ''), updated_at = now()
   WHERE id = p_id;
  INSERT INTO notifications (user_id, kind, title, body, link, entity_type, entity_id, actor_id, dedupe_key)
  SELECT s.user_id, 'labour.decided',
         CASE WHEN p_approve THEN 'Labour request approved' ELSE 'Labour request rejected' END,
         format('%s · %s%s', r.code, to_char(r.work_date, 'Dy DD Mon'), CASE WHEN NULLIF(btrim(p_note), '') IS NOT NULL THEN ' · ' || btrim(p_note) ELSE '' END),
         '/labour/day-requests', 'labour_day_request', r.id, auth.uid(), 'ldr-decided-' || r.id || '-' || extract(epoch FROM now())::bigint
    FROM staff s WHERE s.id = r.pm_staff_id AND s.user_id IS NOT NULL AND s.user_id IS DISTINCT FROM auth.uid()
  ON CONFLICT DO NOTHING;
END $f$;

-- A confirmed run of day-sheet pay for one PM.
CREATE SEQUENCE IF NOT EXISTS labour_day_pay_run_seq;
CREATE TABLE IF NOT EXISTS public.labour_day_pay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  pm_staff_id uuid NOT NULL REFERENCES staff(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  total numeric NOT NULL DEFAULT 0,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  confirmed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  confirmed_by_name text,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE labour_day_pay_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY labour_day_pay_runs_read ON labour_day_pay_runs FOR SELECT TO authenticated USING (labour_day_can_see(pm_staff_id));

ALTER TABLE labour_day_workers
  ADD CONSTRAINT labour_day_workers_pay_run_fkey FOREIGN KEY (pay_run_id) REFERENCES labour_day_pay_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS labour_day_workers_pay_run_idx ON labour_day_workers (pay_run_id);

-- A day-sheet pay sheet belongs to a run, not to a work order's request.
ALTER TABLE labour_pay_sheets ALTER COLUMN labor_requisition_id DROP NOT NULL;
ALTER TABLE labour_pay_sheets
  ADD COLUMN IF NOT EXISTS day_pay_run_id uuid REFERENCES labour_day_pay_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS pm_staff_id uuid REFERENCES staff(id);
CREATE INDEX IF NOT EXISTS labour_pay_sheets_day_run_idx ON labour_pay_sheets (day_pay_run_id);

-- What each worker's day costs, split over where it went: their day rate per
-- half or whole day, plus overtime at the company rates (day kind from the
-- project the most of the day went to).
CREATE OR REPLACE FUNCTION public.labour_day_costs(p_pm uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_project uuid DEFAULT NULL)
RETURNS TABLE(day_id uuid, pm_staff_id uuid, work_date date, day_status text, staff_id uuid, project_id uuid, bucket text,
              days numeric, day_rate numeric, overtime_hours numeric, base numeric, overtime numeric, amount numeric, pay_run_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH w AS (
    SELECT d.id AS day_id, d.pm_staff_id, d.work_date, d.status, w.staff_id, w.paid_days, w.overtime_hours AS ot_h,
           w.overtime_night_hours AS night_h, w.pay_run_id, COALESCE(s.day_rate, 0) AS rate,
           (SELECT a.project_id FROM labour_day_allocations a WHERE a.day_id = d.id AND a.staff_id = w.staff_id
             ORDER BY a.days DESC, a.bucket LIMIT 1) AS main_project
      FROM labour_days d
      JOIN labour_day_workers w ON w.day_id = d.id
      JOIN staff s ON s.id = w.staff_id
     WHERE (p_pm IS NULL OR d.pm_staff_id = p_pm)
       AND (p_from IS NULL OR d.work_date >= p_from)
       AND (p_to IS NULL OR d.work_date <= p_to)
       AND (p_project IS NULL OR EXISTS (SELECT 1 FROM labour_day_allocations a WHERE a.day_id = d.id AND a.staff_id = w.staff_id AND a.project_id = p_project))
  ), priced AS (
    SELECT w.*,
           CASE WHEN w.ot_h = 0 THEN 0
                ELSE (w.ot_h - w.night_h) * w.rate / 8 * m.mult + w.night_h * w.rate / 8 * GREATEST(o.night_multiplier, m.mult) END AS ot
      FROM w
      CROSS JOIN labour_overtime_settings o
      CROSS JOIN LATERAL labour_overtime_day(w.main_project, w.work_date) k
      CROSS JOIN LATERAL (SELECT CASE k.day_kind WHEN 'holiday' THEN o.holiday_multiplier WHEN 'rest_day' THEN o.rest_day_multiplier
                                                 ELSE o.evening_multiplier END AS mult) m
     WHERE o.id
  )
  SELECT p.day_id, p.pm_staff_id, p.work_date, p.status, p.staff_id, a.project_id, a.bucket, a.days, p.rate,
         round(p.ot_h * a.days / p.paid_days, 2),
         round(a.days * p.rate, 2),
         round(p.ot * a.days / p.paid_days, 2),
         round(a.days * p.rate, 2) + round(p.ot * a.days / p.paid_days, 2),
         p.pay_run_id
    FROM priced p
    JOIN labour_day_allocations a ON a.day_id = p.day_id AND a.staff_id = p.staff_id
   WHERE p_project IS NULL OR a.project_id = p_project;
$f$;
REVOKE EXECUTE ON FUNCTION labour_day_costs(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;

-- What confirming pay up to a date would pay, before anything is written.
CREATE OR REPLACE FUNCTION public.labour_day_pay_preview(p_pm uuid, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v jsonb;
BEGIN
  IF NOT labour_day_can_see(p_pm) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  WITH c AS (SELECT * FROM labour_day_costs(p_pm, NULL, p_to) x WHERE x.day_status = 'locked' AND x.pay_run_id IS NULL)
  SELECT jsonb_build_object(
    'pm', jsonb_build_object('id', p_pm, 'name', (SELECT employee_name FROM staff WHERE id = p_pm)),
    'to', p_to,
    'from', (SELECT min(work_date) FROM c),
    'last', (SELECT max(work_date) FROM c),
    'total', (SELECT COALESCE(sum(amount), 0) FROM c),
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
    'not_locked', (SELECT count(*) FROM labour_days d WHERE d.pm_staff_id = p_pm AND d.work_date <= p_to AND d.status <> 'locked'
                     AND EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id)))
  INTO v;
  RETURN v;
END $f$;


-- Confirm pay for a PM's locked days up to a date: one labour payable and
-- pay sheet per project the days went to, all under one run.
CREATE OR REPLACE FUNCTION public.confirm_labour_day_pay(p_pm uuid, p_to date, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_run uuid; v_code text; v_from date; v_last date; v_total numeric; v_n int; v_missing text; v_cat uuid; v_exp uuid; v_one uuid;
  v_pm_name text := (SELECT employee_name FROM staff WHERE id = p_pm);
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  prj record; v_lines jsonb;
BEGIN
  IF NOT labour_day_can_run(p_pm) THEN RAISE EXCEPTION 'The PM confirms what is owed for their workers'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('labour_day_pay:' || p_pm::text));
  PERFORM 1 FROM labour_day_workers w JOIN labour_days d ON d.id = w.day_id
   WHERE d.pm_staff_id = p_pm AND d.status = 'locked' AND d.work_date <= p_to AND w.pay_run_id IS NULL
   FOR UPDATE OF w;

  SELECT string_agg(DISTINCT s.employee_name, ', ') INTO v_missing
    FROM labour_days d JOIN labour_day_workers w ON w.day_id = d.id JOIN staff s ON s.id = w.staff_id
   WHERE d.pm_staff_id = p_pm AND d.status = 'locked' AND d.work_date <= p_to AND w.pay_run_id IS NULL AND COALESCE(s.day_rate, 0) <= 0;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'No day rate on file for %. HR adds it on the worker''s record first', v_missing; END IF;

  SELECT count(*), min(work_date), max(work_date), sum(amount) INTO v_n, v_from, v_last, v_total
    FROM labour_day_costs(p_pm, NULL, p_to) c WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL;
  IF COALESCE(v_n, 0) = 0 THEN RAISE EXCEPTION 'No locked days to pay up to %', to_char(p_to, 'DD Mon'); END IF;

  v_code := 'LDP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_day_pay_run_seq')::text, 4, '0');
  INSERT INTO labour_day_pay_runs (code, pm_staff_id, period_start, period_end, total, note, confirmed_by, confirmed_by_name)
  VALUES (v_code, p_pm, v_from, v_last, v_total, NULLIF(btrim(p_note), ''), auth.uid(), v_name)
  RETURNING id INTO v_run;

  v_cat := COALESCE((SELECT c.id FROM categories c WHERE c.category_name = 'Labor' AND c.parent_type = 'Project' ORDER BY c.created_at LIMIT 1),
                    (SELECT c.id FROM categories c WHERE c.category_name = 'Labor' ORDER BY c.created_at LIMIT 1));

  FOR prj IN
    SELECT c.project_id, p.project_name, sum(c.amount) AS amount, min(c.work_date) AS first_day, max(c.work_date) AS last_day,
           count(DISTINCT c.staff_id) AS workers, (array_agg(DISTINCT c.staff_id))[1] AS one_staff
      FROM labour_day_costs(p_pm, NULL, p_to) c JOIN projects p ON p.id = c.project_id
     WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL
     GROUP BY c.project_id, p.project_name
    HAVING sum(c.amount) > 0
     ORDER BY p.project_name
  LOOP
    SELECT jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'worker_name', s.employee_name, 'first_day', x.first_day, 'last_day', x.last_day,
             'days', x.days, 'hours', x.days * 8, 'overtime_hours', x.ot_h, 'quantity', NULL, 'percent_done', NULL, 'rate', x.rate,
             'overtime_amount', x.ot, 'amount', x.amount, 'build_days', x.build, 'repair_days', x.repair, 'other_days', x.other) ORDER BY s.employee_name)
      INTO v_lines
      FROM (SELECT c.staff_id, min(c.work_date) AS first_day, max(c.work_date) AS last_day, sum(c.days) AS days, max(c.day_rate) AS rate,
                   sum(c.overtime_hours) AS ot_h, sum(c.overtime) AS ot, sum(c.amount) AS amount,
                   sum(c.days) FILTER (WHERE c.bucket = 'build') AS build, sum(c.days) FILTER (WHERE c.bucket = 'repair') AS repair,
                   sum(c.days) FILTER (WHERE c.bucket NOT IN ('build', 'repair')) AS other
              FROM labour_day_costs(p_pm, NULL, p_to, prj.project_id) c
             WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL AND c.project_id = prj.project_id
             GROUP BY c.staff_id) x
      JOIN staff s ON s.id = x.staff_id;

    INSERT INTO expenses (
      item_service_description, amount_etb, expense_type, category_id, project_id, date,
      paid_to_staff_id, approval_status, payment_state, rollup_period_start, rollup_period_end)
    VALUES (
      format('Labour %s · day sheets · %s · %s · %s to %s', v_code, COALESCE(v_pm_name, '—'), prj.project_name,
             to_char(prj.first_day, 'DD Mon'), to_char(prj.last_day, 'DD Mon YYYY')),
      prj.amount, 'labor_payment'::expense_category, v_cat, prj.project_id, prj.last_day,
      CASE WHEN prj.workers = 1 THEN prj.one_staff END,
      'pending'::expense_approval_status, 'unpaid', prj.first_day, prj.last_day)
    RETURNING id INTO v_exp;

    INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, overtime_hours, overtime_amount)
    SELECT v_exp, (x->>'staff_id')::uuid, (x->>'days')::numeric, (x->>'rate')::numeric, (x->>'amount')::numeric, 1,
           NULLIF((x->>'overtime_hours')::numeric, 0), NULLIF((x->>'overtime_amount')::numeric, 0)
      FROM jsonb_array_elements(v_lines) x;

    INSERT INTO labour_pay_sheets (code, labor_requisition_id, project_id, period_start, period_end, total, lines, expense_id,
      confirmed_by, confirmed_by_name, note, day_pay_run_id, pm_staff_id)
    VALUES ('LPS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_pay_sheet_seq')::text, 4, '0'),
      NULL, prj.project_id, prj.first_day, prj.last_day, prj.amount, v_lines, v_exp,
      auth.uid(), v_name, NULLIF(btrim(p_note), ''), v_run, p_pm);
  END LOOP;

  UPDATE labour_day_pay_runs r
     SET lines = COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'worker_name', s.employee_name, 'days', x.days,
                                   'rate', x.rate, 'overtime_amount', x.ot, 'amount', x.amount) ORDER BY s.employee_name)
                             FROM (SELECT c.staff_id, sum(c.days) AS days, max(c.day_rate) AS rate, sum(c.overtime) AS ot, sum(c.amount) AS amount
                                     FROM labour_day_costs(p_pm, NULL, p_to) c WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL
                                    GROUP BY c.staff_id) x JOIN staff s ON s.id = x.staff_id), '[]'::jsonb)
   WHERE r.id = v_run;

  UPDATE labour_day_workers w SET pay_run_id = v_run
    FROM labour_days d
   WHERE d.id = w.day_id AND d.pm_staff_id = p_pm AND d.status = 'locked' AND d.work_date <= p_to AND w.pay_run_id IS NULL;
  RETURN v_run;
END $f$;

-- Undo a day-sheet pay confirmation while nothing has moved on from it.
CREATE OR REPLACE FUNCTION public.reopen_labour_day_pay(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r labour_day_pay_runs%ROWTYPE; v_exp uuid[];
BEGIN
  SELECT * INTO r FROM labour_day_pay_runs WHERE id = p_run FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Pay run not found — refresh'; END IF;
  IF NOT (labour_day_can_run(r.pm_staff_id) OR COALESCE(get_user_role()::text IN ('admin', 'finance'), false)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT array_agg(ps.expense_id) INTO v_exp FROM labour_pay_sheets ps WHERE ps.day_pay_run_id = p_run AND ps.expense_id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM expenses e WHERE e.id = ANY (COALESCE(v_exp, '{}'))
              AND (COALESCE(e.payment_state, 'unpaid') <> 'unpaid' OR e.approval_status::text NOT IN ('pending', 'rejected'))) THEN
    RAISE EXCEPTION 'Finance has already approved or paid part of this — ask finance to withdraw the approval first';
  END IF;
  IF EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
              WHERE i.expense_id = ANY (COALESCE(v_exp, '{}')) AND i.removed_at IS NULL AND q.status::text <> 'cancelled')
     OR EXISTS (SELECT 1 FROM payment_requests pr WHERE pr.expense_id = ANY (COALESCE(v_exp, '{}')))
     OR EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = ANY (COALESCE(v_exp, '{}'))) THEN
    RAISE EXCEPTION 'This pay is already in a payment request — take it out of the request first';
  END IF;
  UPDATE labour_day_workers SET pay_run_id = NULL WHERE pay_run_id = p_run;
  DELETE FROM labour_pay_sheets WHERE day_pay_run_id = p_run;
  DELETE FROM expenses WHERE id = ANY (COALESCE(v_exp, '{}'));
  DELETE FROM labour_day_pay_runs WHERE id = p_run;
END $f$;

-- A day-sheet pay sheet is reopened with its whole run.
CREATE OR REPLACE FUNCTION public.reopen_labour_pay(p_sheet uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s labour_pay_sheets%ROWTYPE;
  e expenses%ROWTYPE;
BEGIN
  SELECT * INTO s FROM labour_pay_sheets WHERE id = p_sheet;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pay sheet not found'; END IF;
  IF s.day_pay_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'This pay sheet came from the day sheets — reopen its pay run (%) instead', (SELECT code FROM labour_day_pay_runs WHERE id = s.day_pay_run_id);
  END IF;
  IF NOT (manages_project(s.project_id) OR COALESCE(get_user_role() IN ('admin', 'operations_manager', 'finance'), false)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT * INTO e FROM expenses WHERE id = s.expense_id;
  IF e.id IS NOT NULL AND (e.payment_state <> 'unpaid' OR e.approval_status::text NOT IN ('pending', 'rejected')) THEN
    RAISE EXCEPTION 'Finance has already approved or paid this — ask finance to withdraw the approval first';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_requests pr WHERE pr.expense_id = e.id)
     OR EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = e.id) THEN
    RAISE EXCEPTION 'This payable is already on a payment request or batch';
  END IF;
  UPDATE labour_work_entries SET pay_sheet_id = NULL WHERE pay_sheet_id = p_sheet;
  DELETE FROM labour_pay_sheets WHERE id = p_sheet;
  IF e.id IS NOT NULL THEN DELETE FROM expenses WHERE id = e.id; END IF;
  PERFORM log_labour_event(s.labor_requisition_id, 'pay_reopened', s.code);
END $function$;

-- Confirmed pay waiting to go in a payment request: day-sheet pay is the
-- PM's to send, whichever projects the days went to.
CREATE OR REPLACE FUNCTION public.labour_payable_drafts()
 RETURNS TABLE(expense_id uuid, expense_code text, project_id uuid, project_name text, what text, period_start date, period_end date, amount numeric, workers integer, unverified integer, held boolean, pay_sheet_code text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT e.id, e.expense_code, e.project_id, p.project_name,
         COALESCE(r.role_needed, CASE WHEN ps.day_pay_run_id IS NOT NULL THEN 'Day sheets · ' || COALESCE(pm.employee_name, '') END, e.item_service_description),
         COALESCE(e.rollup_period_start, h.period_start), COALESCE(e.rollup_period_end, h.period_end), e.amount_etb,
         (SELECT count(*)::int FROM labor_expense_workers w WHERE w.expense_id = e.id),
         (SELECT count(*)::int FROM labor_expense_workers w JOIN staff s ON s.id = w.staff_id
           WHERE w.expense_id = e.id AND s.verified_at IS NULL AND e.vendor_id IS NULL),
         h.expense_id IS NOT NULL, ps.code
    FROM expenses e
    LEFT JOIN labour_pay_sheets ps ON ps.expense_id = e.id
    LEFT JOIN labour_pay_holds h ON h.expense_id = e.id
    LEFT JOIN labor_requisitions r ON r.id = COALESCE(e.rolled_up_from_requisition_id, h.labor_requisition_id)
    LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN staff pm ON pm.id = ps.pm_staff_id
   WHERE (ps.id IS NOT NULL OR h.expense_id IS NOT NULL)
     AND e.approval_status = 'pending' AND COALESCE(e.payment_state, 'unpaid') = 'unpaid'
     AND NOT COALESCE(e.is_archived, false)
     AND NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
                      WHERE i.expense_id = e.id AND i.removed_at IS NULL AND q.status NOT IN ('cancelled'))
     AND (manages_project(e.project_id) OR (ps.pm_staff_id IS NOT NULL AND ps.pm_staff_id = current_staff_id())
          OR COALESCE(get_user_role()::text IN ('admin', 'operations_manager', 'finance'), false) OR is_ops_manager())
   ORDER BY p.project_name, COALESCE(e.rollup_period_end, h.period_end);
$function$;

-- Each PM's day sheets still to pay: locked and ready, waiting on review,
-- or still open.
CREATE OR REPLACE FUNCTION public.labour_day_unpaid()
RETURNS TABLE(pm_staff_id uuid, pm_name text, locked_days integer, first_day date, last_day date, workers integer, amount numeric,
              waiting_review integer, open_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH d AS (
    SELECT d.* FROM labour_days d
     WHERE labour_day_can_see(d.pm_staff_id)
       AND EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id AND w.pay_run_id IS NULL)
  ), c AS (
    SELECT c.* FROM labour_day_costs(NULL, NULL, NULL) c JOIN d ON d.id = c.day_id WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL
  )
  SELECT s.id, s.employee_name,
         (SELECT count(*)::int FROM d x WHERE x.pm_staff_id = s.id AND x.status = 'locked'),
         (SELECT min(work_date) FROM c WHERE c.pm_staff_id = s.id),
         (SELECT max(work_date) FROM c WHERE c.pm_staff_id = s.id),
         (SELECT count(DISTINCT staff_id)::int FROM c WHERE c.pm_staff_id = s.id),
         (SELECT COALESCE(sum(amount), 0) FROM c WHERE c.pm_staff_id = s.id),
         (SELECT count(*)::int FROM d x WHERE x.pm_staff_id = s.id AND x.status = 'submitted'),
         (SELECT count(*)::int FROM d x WHERE x.pm_staff_id = s.id AND x.status = 'open')
    FROM staff s
   WHERE s.id IN (SELECT pm_staff_id FROM d)
   ORDER BY s.employee_name;
$f$;
