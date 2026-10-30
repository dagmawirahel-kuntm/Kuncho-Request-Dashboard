-- 492: one place for all of a PM's labour.
-- 1. The daily request becomes a standing crew: headcount by trade from a
--    date, on chosen weekdays, until changed. A newer approved request takes
--    over from its start date; a one-day request covers just its day.
-- 2. Piece work (by volume or fixed price) is recorded on the PM's day sheet
--    too: who of the crew was there each day, and how much was done when it
--    is measured. It locks with the day.
-- 3. One weekly pay confirmation covers both: day workers as one payable per
--    project, each piece job on its own payable (its crew leader may be the
--    payee), all under the same run.
-- From the start date, piece work is no longer recorded on the work-order
-- screens. A piece job no longer needs a work order (the form only).

-- ── 1. Standing crew ──────────────────────────────────────────────────
ALTER TABLE labour_day_requests
  ADD COLUMN IF NOT EXISTS ends_on date,
  ADD COLUMN IF NOT EXISTS weekdays smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}';
ALTER TABLE labour_day_requests DROP CONSTRAINT IF EXISTS labour_day_requests_range_ck;
ALTER TABLE labour_day_requests ADD CONSTRAINT labour_day_requests_range_ck
  CHECK ((ends_on IS NULL OR ends_on >= work_date) AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]);
COMMENT ON COLUMN labour_day_requests.work_date IS 'The first day the request covers';

-- The approved request that sets a PM's crew for a day: the latest-starting
-- one whose range covers the day. If that day isn't one of its weekdays (or
-- it has no lines) nobody is expected.
CREATE OR REPLACE FUNCTION public.labour_day_expected(p_pm uuid, p_date date)
RETURNS TABLE(request_id uuid, works boolean, headcount integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT r.id, extract(isodow FROM p_date)::smallint = ANY (r.weekdays),
         CASE WHEN extract(isodow FROM p_date)::smallint = ANY (r.weekdays)
              THEN (SELECT COALESCE(sum(l.headcount), 0)::int FROM labour_day_request_lines l WHERE l.request_id = r.id) ELSE 0 END
    FROM labour_day_requests r
   WHERE r.pm_staff_id = p_pm AND r.status = 'approved' AND r.work_date <= p_date AND (r.ends_on IS NULL OR r.ends_on >= p_date)
   ORDER BY r.work_date DESC
   LIMIT 1;
$f$;

CREATE OR REPLACE FUNCTION public.labour_day_weekdays_label(p_days smallint[])
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_days @> '{1,2,3,4,5,6,7}' THEN 'every day'
              WHEN p_days @> '{1,2,3,4,5,6}' AND cardinality(p_days) = 6 THEN 'Mon–Sat'
              WHEN p_days @> '{1,2,3,4,5}' AND cardinality(p_days) = 5 THEN 'Mon–Fri'
              ELSE (SELECT string_agg((ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[d], ' ' ORDER BY d) FROM unnest(p_days) d) END;
$f$;

DROP FUNCTION IF EXISTS public.labour_day_request_save(uuid, date, jsonb, text, boolean);
CREATE OR REPLACE FUNCTION public.labour_day_request_save(p_pm uuid, p_date date, p_lines jsonb, p_note text DEFAULT NULL, p_submit boolean DEFAULT false,
                                                         p_ends_on date DEFAULT NULL, p_weekdays smallint[] DEFAULT '{1,2,3,4,5,6}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_day_settings%ROWTYPE; r labour_day_requests%ROWTYPE;
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  v_bad text; v_n int; v_days smallint[] := COALESCE(p_weekdays, '{1,2,3,4,5,6}');
BEGIN
  IF NOT labour_day_can_run(p_pm) THEN RAISE EXCEPTION 'You send the labour request for your own workers'; END IF;
  SELECT * INTO s FROM labour_day_settings WHERE id;
  IF s.starts_on IS NULL THEN RAISE EXCEPTION 'The labour request hasn''t started yet — admin sets its start date'; END IF;
  IF p_date < s.starts_on THEN RAISE EXCEPTION 'Labour requests start on %', to_char(s.starts_on, 'DD Mon YYYY'); END IF;
  IF p_date <= bot_today() THEN
    RAISE EXCEPTION 'Ask before the day: a crew starting % had to be approved by the end of the day before', to_char(p_date, 'DD Mon');
  END IF;
  IF p_ends_on IS NOT NULL AND p_ends_on < p_date THEN RAISE EXCEPTION 'The last day is before the first'; END IF;
  IF cardinality(v_days) = 0 OR NOT v_days <@ '{1,2,3,4,5,6,7}'::smallint[] THEN RAISE EXCEPTION 'Pick the days of the week they work'; END IF;
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
  DELETE FROM labour_day_request_lines WHERE request_id = r.id;
  INSERT INTO labour_day_request_lines (request_id, trade_tag, headcount)
  SELECT r.id, x->>'trade', sum((x->>'headcount')::int)
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) x
   WHERE COALESCE(NULLIF(x->>'headcount', '')::int, 0) > 0
   GROUP BY 2;
  SELECT COALESCE(sum(headcount), 0) INTO v_n FROM labour_day_request_lines WHERE request_id = r.id;

  -- A change after a decision goes back for approval. Stopping the crew
  -- (nobody from this date) needs no approval.
  UPDATE labour_day_requests
     SET note = NULLIF(btrim(p_note), ''), ends_on = p_ends_on, weekdays = (SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(v_days) d),
         status = CASE WHEN NOT p_submit THEN 'draft' WHEN v_n = 0 THEN 'approved' ELSE 'submitted' END,
         submitted_at = CASE WHEN p_submit THEN now() END,
         decided_by = NULL, decided_by_name = CASE WHEN p_submit AND v_n = 0 THEN v_name END,
         decided_at = CASE WHEN p_submit AND v_n = 0 THEN now() END,
         decision_note = CASE WHEN p_submit AND v_n = 0 THEN 'No crew from this day' WHEN r.status = 'rejected' THEN decision_note END,
         updated_at = now()
   WHERE id = r.id;
  IF p_submit AND v_n > 0 THEN
    INSERT INTO notifications (user_id, kind, title, body, link, entity_type, entity_id, actor_id, dedupe_key)
    SELECT u.id, 'labour.requested', 'Labour request to approve',
           format('%s · from %s, %s%s · %s workers', (SELECT employee_name FROM staff WHERE id = p_pm), to_char(p_date, 'Dy DD Mon'),
                  labour_day_weekdays_label(v_days), CASE WHEN p_ends_on IS NULL THEN ' until changed' WHEN p_ends_on = p_date THEN ' (one day)'
                                                         ELSE ' to ' || to_char(p_ends_on, 'DD Mon') END, v_n),
           '/labour/day-requests', 'labour_day_request', r.id, auth.uid(), 'ldr-' || r.id || '-' || extract(epoch FROM now())::bigint
      FROM user_profiles u
     WHERE u.account_status = 'active' AND (u.role = 'operations_manager' OR u.is_operations_manager) AND u.id IS DISTINCT FROM auth.uid()
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN r.id;
END $f$;

-- ── 2. Piece work on the day sheet ────────────────────────────────────
ALTER TABLE labour_work_entries ADD COLUMN IF NOT EXISTS labour_day_id uuid REFERENCES labour_days(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS labour_work_entries_day_idx ON labour_work_entries (labour_day_id);

-- Who of a piece job's crew was there that day (attendance only — piece
-- work is paid on what was done).
CREATE TABLE IF NOT EXISTS public.labour_day_job_crew (
  day_id uuid NOT NULL REFERENCES labour_days(id) ON DELETE CASCADE,
  labor_requisition_id uuid NOT NULL REFERENCES labor_requisitions(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  PRIMARY KEY (day_id, labor_requisition_id, staff_id)
);
ALTER TABLE labour_day_job_crew ENABLE ROW LEVEL SECURITY;
CREATE POLICY labour_day_job_crew_read ON labour_day_job_crew FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM labour_days d WHERE d.id = day_id AND labour_day_can_see(d.pm_staff_id)));

-- An entry on a day sheet is paid only once that day is locked.
CREATE OR REPLACE FUNCTION public.labour_entry_payable(p_day uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p_day IS NULL OR EXISTS (SELECT 1 FROM labour_days d WHERE d.id = p_day AND d.status = 'locked');
$f$;

-- The piece jobs a PM's sheet shows for a day: approved volume and
-- fixed-price jobs on the projects they run (or asked for), not ended,
-- plus any already on that day's sheet.
CREATE OR REPLACE FUNCTION public.labour_day_jobs(p_pm uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE d labour_days%ROWTYPE; v_src uuid; v jsonb;
BEGIN
  IF NOT labour_day_can_see(p_pm) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO d FROM labour_days WHERE pm_staff_id = p_pm AND work_date = p_date;
  -- Crew ticks start as the last day this PM recorded.
  v_src := CASE WHEN d.saved_at IS NOT NULL THEN d.id
                ELSE (SELECT x.id FROM labour_days x WHERE x.pm_staff_id = p_pm AND x.work_date < p_date
                         AND EXISTS (SELECT 1 FROM labour_day_job_crew c WHERE c.day_id = x.id)
                       ORDER BY x.work_date DESC LIMIT 1) END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'what', r.role_needed, 'scope', r.scope_of_work, 'basis', r.payment_basis,
           'project_id', r.project_id, 'project', p.project_name,
           'work_order_id', r.work_order_id, 'work_order', w.title,
           'unit', r.volume_unit, 'unit_rate', r.unit_rate, 'fixed_price', r.fixed_price_amount, 'planned_volume', r.estimated_total_volume,
           'crew_leader', v.vendor_name,
           'done_before', (SELECT CASE r.payment_basis WHEN 'per_volume' THEN COALESCE(sum(e.quantity), 0) ELSE COALESCE(sum(e.percent_done), 0) END
                             FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.work_date <> p_date),
           'today', (SELECT CASE r.payment_basis WHEN 'per_volume' THEN sum(e.quantity) ELSE sum(e.percent_done) END
                       FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.work_date = p_date),
           'today_paid', EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.work_date = p_date AND e.pay_sheet_id IS NOT NULL),
           'crew', (SELECT COALESCE(jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.employee_name,
                                     'present', EXISTS (SELECT 1 FROM labour_day_job_crew c WHERE c.day_id = v_src AND c.labor_requisition_id = r.id AND c.staff_id = s.id))
                                   ORDER BY s.employee_name), '[]'::jsonb)
                      FROM staff s
                     WHERE s.id IN (SELECT a.staff_id FROM labor_allocations a WHERE a.labor_requisition_id = r.id AND a.status = 'active'
                                    UNION SELECT w2.staff_id FROM labor_requisition_workers w2 WHERE w2.requisition_id = r.id
                                    UNION SELECT c.staff_id FROM labour_day_job_crew c WHERE c.day_id = d.id AND c.labor_requisition_id = r.id)))
         ORDER BY p.project_name, r.role_needed), '[]'::jsonb)
    INTO v
    FROM labor_requisitions r
    JOIN projects p ON p.id = r.project_id
    LEFT JOIN work_orders w ON w.id = r.work_order_id
    LEFT JOIN vendors v ON v.id = r.gang_leader_vendor_id
   WHERE r.payment_basis IN ('per_volume', 'fixed_price')
     AND (EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.labour_day_id = d.id)
          OR (r.status = 'approved' AND r.start_date <= p_date AND (r.closed_at IS NULL OR (r.closed_at AT TIME ZONE 'Africa/Addis_Ababa')::date >= p_date)
              AND p.costing_closed_at IS NULL
              AND (p.project_manager_id = p_pm OR r.requested_by_staff_id = p_pm)
              AND NOT (r.payment_basis = 'fixed_price'
                       AND (SELECT COALESCE(sum(e.percent_done), 0) FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.work_date < p_date) >= 100)));
  RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION public.labour_day_snapshot(p_day uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT jsonb_build_object(
    'workers', COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', w.staff_id, 'name', s.employee_name, 'paid_days', w.paid_days,
           'overtime_hours', w.overtime_hours, 'overtime_night_hours', w.overtime_night_hours, 'note', w.note,
           'alloc', (SELECT COALESCE(jsonb_agg(jsonb_build_object('project_id', a.project_id, 'project', p.project_name, 'bucket', a.bucket, 'days', a.days)
                                               ORDER BY p.project_name, a.bucket), '[]'::jsonb)
                       FROM labour_day_allocations a JOIN projects p ON p.id = a.project_id
                      WHERE a.day_id = w.day_id AND a.staff_id = w.staff_id))
           ORDER BY s.employee_name)
      FROM labour_day_workers w JOIN staff s ON s.id = w.staff_id WHERE w.day_id = p_day), '[]'::jsonb),
    'jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'what', r.role_needed, 'quantity', e.quantity, 'percent_done', e.percent_done,
           'present', (SELECT COALESCE(jsonb_agg(s.employee_name ORDER BY s.employee_name), '[]'::jsonb) FROM labour_day_job_crew c JOIN staff s ON s.id = c.staff_id
                        WHERE c.day_id = p_day AND c.labor_requisition_id = r.id)) ORDER BY r.role_needed)
      FROM labor_requisitions r
      LEFT JOIN labour_work_entries e ON e.labor_requisition_id = r.id AND e.labour_day_id = p_day AND e.staff_id IS NULL
     WHERE r.id IN (SELECT labor_requisition_id FROM labour_day_job_crew WHERE day_id = p_day
                    UNION SELECT labor_requisition_id FROM labour_work_entries WHERE labour_day_id = p_day)), '[]'::jsonb));
$f$;

-- Is anything on this day already confirmed for pay?
CREATE OR REPLACE FUNCTION public.labour_day_is_paid(p_day uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = p_day AND w.pay_run_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labour_day_id = p_day AND e.pay_sheet_id IS NOT NULL);
$f$;

CREATE OR REPLACE FUNCTION public.labour_day_get(p_pm uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_day_settings%ROWTYPE; d labour_days%ROWTYPE; v_src labour_days%ROWTYPE; v_from uuid; v_prefill boolean := false; v jsonb;
  x record;
BEGIN
  IF NOT labour_day_can_see(p_pm) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO s FROM labour_day_settings WHERE id;
  SELECT * INTO d FROM labour_days WHERE pm_staff_id = p_pm AND work_date = p_date;
  IF d.id IS NOT NULL AND (d.saved_at IS NOT NULL OR EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id)) THEN
    v_from := d.id;
  ELSE
    SELECT y.* INTO v_src FROM labour_days y
     WHERE y.pm_staff_id = p_pm AND y.work_date < p_date AND EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = y.id)
     ORDER BY y.work_date DESC LIMIT 1;
    v_from := v_src.id; v_prefill := v_src.id IS NOT NULL;
  END IF;
  SELECT * INTO x FROM labour_day_expected(p_pm, p_date);

  SELECT jsonb_build_object(
    'pm', jsonb_build_object('id', p_pm, 'name', (SELECT employee_name FROM staff WHERE id = p_pm)),
    'date', p_date,
    'starts_on', s.starts_on,
    'can_edit', labour_day_can_run(p_pm) AND (d.id IS NULL OR d.status <> 'locked' OR labour_day_is_approver()),
    'is_approver', labour_day_is_approver(),
    'day', CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('id', d.id, 'status', d.status, 'saved_at', d.saved_at, 'saved_by_name', d.saved_by_name,
             'submitted_at', d.submitted_at, 'locked_at', d.locked_at, 'locked_by_name', d.locked_by_name, 'review_note', d.review_note,
             'changes', (SELECT count(*) FROM labour_day_changes c WHERE c.day_id = d.id),
             'paid', labour_day_is_paid(d.id)) END,
    'prefilled_from', CASE WHEN v_prefill THEN v_src.work_date END,
    'workers', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'staff_id', w.staff_id, 'name', st.employee_name, 'trade', st.trade_tag, 'day_rate', st.day_rate, 'photo_url', st.photo_url,
                'verified', st.verified_at IS NOT NULL,
                'paid_days', w.paid_days,
                'overtime_hours', CASE WHEN v_prefill THEN 0 ELSE w.overtime_hours END,
                'overtime_night_hours', CASE WHEN v_prefill THEN 0 ELSE w.overtime_night_hours END,
                'note', CASE WHEN v_prefill THEN NULL ELSE w.note END,
                'paid', NOT v_prefill AND w.pay_run_id IS NOT NULL,
                'elsewhere', (SELECT COALESCE(sum(w2.paid_days), 0) FROM labour_day_workers w2 JOIN labour_days d2 ON d2.id = w2.day_id
                               WHERE w2.staff_id = w.staff_id AND d2.work_date = p_date AND d2.pm_staff_id <> p_pm),
                'alloc', (SELECT COALESCE(jsonb_agg(jsonb_build_object('project_id', a.project_id, 'bucket', a.bucket, 'days', a.days)), '[]'::jsonb)
                            FROM labour_day_allocations a JOIN projects p ON p.id = a.project_id
                           WHERE a.day_id = w.day_id AND a.staff_id = w.staff_id
                             AND (NOT v_prefill OR p.costing_closed_at IS NULL)))
              ORDER BY st.employee_name)
         FROM labour_day_workers w JOIN staff st ON st.id = w.staff_id
        WHERE w.day_id = v_from
          AND (NOT v_prefill OR (st.employment_type = 'tier_2_casual' AND COALESCE(st.status, 'active') = 'active'))), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', y.project_id, 'name', y.project_name, 'mine', y.mine, 'delivered', y.delivered))
                            FROM (SELECT * FROM labour_day_projects(p_pm, p_date)
                                  UNION
                                  SELECT p.id, p.project_name, p.project_manager_id IS NOT DISTINCT FROM p_pm, p.delivered_at IS NOT NULL
                                    FROM labour_day_allocations a JOIN projects p ON p.id = a.project_id
                                   WHERE a.day_id = v_from AND a.bucket IN ('build', 'repair')) y), '[]'::jsonb),
    'buckets', jsonb_build_object(
       'workshop', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.workshop_project_id),
       'stock', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.stock_project_id),
       'idle', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.idle_project_id)),
    'request', (SELECT jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'decided_by_name', r.decided_by_name, 'decision_note', r.decision_note,
                  'starts_on', r.work_date, 'ends_on', r.ends_on, 'weekdays', r.weekdays, 'works_today', x.works,
                  'lines', CASE WHEN x.works THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('trade', l.trade_tag, 'headcount', l.headcount)), '[]'::jsonb)
                                                     FROM labour_day_request_lines l WHERE l.request_id = r.id) ELSE '[]'::jsonb END)
                  FROM labour_day_requests r WHERE r.id = x.request_id),
    'jobs', labour_day_jobs(p_pm, p_date))
  INTO v;
  RETURN v;
END $f$;

-- Save a PM's day: the day workers (as before) and the piece jobs —
-- p_jobs: [{id, present: [staff_id], quantity (volume measured that day),
-- percent_total (fixed price: how far along it is now)}].
DROP FUNCTION IF EXISTS public.labour_day_save(uuid, date, jsonb, boolean, text);
CREATE OR REPLACE FUNCTION public.labour_day_save(p_pm uuid, p_date date, p_workers jsonb, p_submit boolean DEFAULT false, p_reason text DEFAULT NULL,
                                                 p_jobs jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_day_settings%ROWTYPE; d labour_days%ROWTYPE; st staff%ROWTYPE; p projects%ROWTYPE; r labor_requisitions%ROWTYPE;
  w jsonb; a jsonb; j jsonb; v_staff uuid; v_paid numeric; v_other numeric; v_ot numeric; v_night numeric;
  v_bucket text; v_days numeric; v_proj uuid; v_before jsonb; v_mis int; v_seen uuid[] := '{}'; v_jobs_seen uuid[] := '{}';
  v_allowed uuid[]; v_qty numeric; v_pct numeric; v_before_pct numeric; v_has_jobs boolean;
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT labour_day_can_run(p_pm) THEN RAISE EXCEPTION 'You record the day for your own workers'; END IF;
  SELECT * INTO s FROM labour_day_settings WHERE id;
  IF s.starts_on IS NULL THEN RAISE EXCEPTION 'The day sheet hasn''t started yet — admin sets its start date'; END IF;
  IF p_date < s.starts_on THEN RAISE EXCEPTION 'Day sheets start on % — earlier days are recorded on their labour requests', to_char(s.starts_on, 'DD Mon YYYY'); END IF;
  IF p_date > bot_today() THEN RAISE EXCEPTION 'A day is recorded at its end — % hasn''t happened yet', to_char(p_date, 'DD Mon'); END IF;
  IF p_date < bot_today() - 60 AND NOT labour_day_is_approver() THEN RAISE EXCEPTION 'That is more than 60 days ago — ask operations to record it'; END IF;

  INSERT INTO labour_days (pm_staff_id, work_date) VALUES (p_pm, p_date) ON CONFLICT (pm_staff_id, work_date) DO NOTHING;
  SELECT * INTO d FROM labour_days WHERE pm_staff_id = p_pm AND work_date = p_date FOR UPDATE;
  IF labour_day_is_paid(d.id) THEN RAISE EXCEPTION 'Pay for this day is already confirmed — reopen that pay first'; END IF;
  IF d.status = 'locked' THEN
    IF NOT labour_day_is_approver() THEN RAISE EXCEPTION 'This day is locked — ask operations to change it'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why you are changing a locked day'; END IF;
    v_before := labour_day_snapshot(d.id);
  END IF;

  -- Day workers.
  DELETE FROM labour_day_allocations WHERE day_id = d.id;
  DELETE FROM labour_day_workers WHERE day_id = d.id;
  FOR w IN SELECT * FROM jsonb_array_elements(COALESCE(p_workers, '[]'::jsonb)) LOOP
    v_staff := NULLIF(w->>'staff_id', '')::uuid;
    SELECT * INTO st FROM staff WHERE id = v_staff;
    IF st.id IS NULL THEN RAISE EXCEPTION 'A worker on this sheet no longer exists — refresh the page'; END IF;
    IF v_staff = ANY (v_seen) THEN RAISE EXCEPTION '% is on the sheet twice', st.employee_name; END IF;
    v_seen := v_seen || v_staff;
    IF COALESCE(st.employment_type, '') <> 'tier_2_casual' THEN
      RAISE EXCEPTION '% isn''t a casual worker — only casual workers go on the day sheet', st.employee_name;
    END IF;
    v_paid := NULLIF(w->>'paid_days', '')::numeric;
    IF v_paid IS NULL OR v_paid NOT IN (0.5, 1) THEN RAISE EXCEPTION '%: a day is a half (0.5) or whole (1)', st.employee_name; END IF;
    SELECT COALESCE(sum(w2.paid_days), 0) INTO v_other
      FROM labour_day_workers w2 JOIN labour_days d2 ON d2.id = w2.day_id
     WHERE w2.staff_id = v_staff AND d2.work_date = p_date AND d2.id <> d.id;
    IF v_other + v_paid > 1 THEN
      RAISE EXCEPTION '% is already on another PM''s sheet for % day on % — nobody is paid more than one day', st.employee_name, trim_scale(v_other), to_char(p_date, 'DD Mon');
    END IF;
    v_ot := COALESCE(NULLIF(w->>'overtime_hours', '')::numeric, 0);
    v_night := LEAST(COALESCE(NULLIF(w->>'overtime_night_hours', '')::numeric, 0), v_ot);
    INSERT INTO labour_day_workers (day_id, staff_id, paid_days, overtime_hours, overtime_night_hours, note)
    VALUES (d.id, v_staff, v_paid, v_ot, v_night, NULLIF(btrim(w->>'note'), ''));

    FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(w->'alloc', '[]'::jsonb)) LOOP
      v_bucket := a->>'bucket';
      v_days := COALESCE(NULLIF(a->>'days', '')::numeric, 0);
      IF v_days = 0 THEN CONTINUE; END IF;
      IF v_days NOT IN (0.5, 1) THEN RAISE EXCEPTION '%: each column takes a half (0.5) or whole (1) day', st.employee_name; END IF;
      IF v_bucket IN ('build', 'repair') THEN
        SELECT * INTO p FROM projects WHERE id = NULLIF(a->>'project_id', '')::uuid;
        IF p.id IS NULL THEN RAISE EXCEPTION 'A project on this sheet no longer exists — refresh the page'; END IF;
        IF COALESCE(p.is_internal, false) THEN
          RAISE EXCEPTION '% is internal — use Workshop maintenance, Stock fixture production or General / idle', p.project_name;
        END IF;
        IF p.costing_closed_at IS NOT NULL THEN RAISE EXCEPTION 'Costing on % is closed — no more labour can go to it', p.project_name; END IF;
        v_proj := p.id;
      ELSIF v_bucket IN ('workshop', 'stock', 'idle') THEN
        v_proj := CASE v_bucket WHEN 'workshop' THEN s.workshop_project_id WHEN 'stock' THEN s.stock_project_id ELSE s.idle_project_id END;
        IF v_proj IS NULL THEN
          RAISE EXCEPTION 'Admin hasn''t set which internal project % is costed to', CASE v_bucket WHEN 'workshop' THEN 'workshop maintenance'
            WHEN 'stock' THEN 'stock fixture production' ELSE 'idle time' END;
        END IF;
      ELSE
        RAISE EXCEPTION 'Unknown column on the sheet — refresh the page';
      END IF;
      INSERT INTO labour_day_allocations (day_id, staff_id, project_id, bucket, days)
      VALUES (d.id, v_staff, v_proj, v_bucket, v_days)
      ON CONFLICT (day_id, staff_id, project_id, bucket) DO UPDATE SET days = LEAST(labour_day_allocations.days + EXCLUDED.days, 1);
    END LOOP;
  END LOOP;

  -- Piece jobs: crew there today, and what was measured.
  SELECT array_agg((x->>'id')::uuid) INTO v_allowed FROM jsonb_array_elements(labour_day_jobs(p_pm, p_date)) x;
  DELETE FROM labour_day_job_crew WHERE day_id = d.id;
  DELETE FROM labour_work_entries WHERE labour_day_id = d.id AND pay_sheet_id IS NULL;
  FOR j IN SELECT * FROM jsonb_array_elements(COALESCE(p_jobs, '[]'::jsonb)) LOOP
    SELECT * INTO r FROM labor_requisitions WHERE id = NULLIF(j->>'id', '')::uuid;
    IF r.id IS NULL OR r.payment_basis NOT IN ('per_volume', 'fixed_price') THEN RAISE EXCEPTION 'A piece job on this sheet no longer exists — refresh the page'; END IF;
    IF NOT (r.id = ANY (COALESCE(v_allowed, '{}'))) THEN RAISE EXCEPTION '% isn''t one of your open piece jobs on %', r.role_needed, to_char(p_date, 'DD Mon'); END IF;
    IF r.id = ANY (v_jobs_seen) THEN RAISE EXCEPTION '% is on the sheet twice', r.role_needed; END IF;
    v_jobs_seen := v_jobs_seen || r.id;

    INSERT INTO labour_day_job_crew (day_id, labor_requisition_id, staff_id)
    SELECT d.id, r.id, sid FROM (SELECT DISTINCT (x #>> '{}')::uuid AS sid FROM jsonb_array_elements(COALESCE(j->'present', '[]'::jsonb)) x) y
     WHERE EXISTS (SELECT 1 FROM staff WHERE id = y.sid);

    IF r.payment_basis = 'per_volume' THEN
      v_qty := NULLIF(j->>'quantity', '')::numeric;
      IF v_qty < 0 THEN RAISE EXCEPTION '%: the amount measured can''t be negative', r.role_needed; END IF;
      IF COALESCE(v_qty, 0) > 0 THEN
        INSERT INTO labour_work_entries (labor_requisition_id, project_id, work_date, staff_id, quantity, overtime_hours, recorded_by, recorded_by_name, recorded_via, labour_day_id)
        VALUES (r.id, r.project_id, p_date, NULL, v_qty, 0, auth.uid(), v_name, 'day_sheet', d.id)
        ON CONFLICT (labor_requisition_id, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid), work_date)
        DO UPDATE SET quantity = EXCLUDED.quantity, recorded_by = EXCLUDED.recorded_by, recorded_by_name = EXCLUDED.recorded_by_name,
                      recorded_at = now(), recorded_via = 'day_sheet', labour_day_id = EXCLUDED.labour_day_id
        WHERE labour_work_entries.pay_sheet_id IS NULL;
      END IF;
    ELSE
      v_pct := NULLIF(j->>'percent_total', '')::numeric;
      IF v_pct IS NOT NULL THEN
        SELECT COALESCE(sum(percent_done), 0) INTO v_before_pct FROM labour_work_entries WHERE labor_requisition_id = r.id AND work_date <> p_date;
        IF v_pct > 100 THEN RAISE EXCEPTION '%: a job can''t be more than 100%% done', r.role_needed; END IF;
        IF v_pct < v_before_pct THEN
          RAISE EXCEPTION '% was already % %% done before % — it can''t go back to % %%', r.role_needed, trim_scale(v_before_pct), to_char(p_date, 'DD Mon'), trim_scale(v_pct);
        END IF;
        IF v_pct > v_before_pct THEN
          INSERT INTO labour_work_entries (labor_requisition_id, project_id, work_date, staff_id, percent_done, overtime_hours, recorded_by, recorded_by_name, recorded_via, labour_day_id)
          VALUES (r.id, r.project_id, p_date, NULL, v_pct - v_before_pct, 0, auth.uid(), v_name, 'day_sheet', d.id)
          ON CONFLICT (labor_requisition_id, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid), work_date)
          DO UPDATE SET percent_done = EXCLUDED.percent_done, recorded_by = EXCLUDED.recorded_by, recorded_by_name = EXCLUDED.recorded_by_name,
                        recorded_at = now(), recorded_via = 'day_sheet', labour_day_id = EXCLUDED.labour_day_id
          WHERE labour_work_entries.pay_sheet_id IS NULL;
        END IF;
      END IF;
    END IF;
  END LOOP;
  v_has_jobs := EXISTS (SELECT 1 FROM labour_day_job_crew WHERE day_id = d.id) OR EXISTS (SELECT 1 FROM labour_work_entries WHERE labour_day_id = d.id);

  v_mis := labour_day_mismatches(d.id);
  IF d.status = 'locked' THEN
    IF v_mis > 0 THEN RAISE EXCEPTION 'A locked day must still add up: % worker% don''t', v_mis, CASE WHEN v_mis = 1 THEN '' ELSE 's' END; END IF;
    INSERT INTO labour_day_changes (day_id, kind, changed_by, changed_by_name, reason, before, after)
    VALUES (d.id, 'edit', auth.uid(), v_name, btrim(p_reason), v_before, labour_day_snapshot(d.id));
  ELSIF p_submit THEN
    IF NOT EXISTS (SELECT 1 FROM labour_day_workers WHERE day_id = d.id) AND NOT v_has_jobs THEN RAISE EXCEPTION 'Add who was present first'; END IF;
    IF v_mis > 0 THEN
      RAISE EXCEPTION '% worker% don''t add up — each worker''s columns must come to their day (0.5 or 1)', v_mis, CASE WHEN v_mis = 1 THEN '' ELSE 's' END;
    END IF;
    UPDATE labour_days SET status = 'submitted', submitted_at = now(), submitted_by_name = v_name WHERE id = d.id;
  ELSE
    UPDATE labour_days SET status = 'open' WHERE id = d.id;
  END IF;
  UPDATE labour_days SET saved_at = now(), saved_by = auth.uid(), saved_by_name = v_name WHERE id = d.id;
  RETURN jsonb_build_object('day_id', d.id, 'status', (SELECT status FROM labour_days WHERE id = d.id), 'mismatches', v_mis,
                            'workers', (SELECT count(*) FROM labour_day_workers WHERE day_id = d.id),
                            'jobs', (SELECT count(*) FROM (SELECT labor_requisition_id FROM labour_day_job_crew WHERE day_id = d.id
                                                           UNION SELECT labor_requisition_id FROM labour_work_entries WHERE labour_day_id = d.id) x));
END $f$;

CREATE OR REPLACE FUNCTION public.labour_day_return(p_day uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE d labour_days%ROWTYPE; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT labour_day_is_approver() THEN RAISE EXCEPTION 'Operations sends a day back'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say what the PM should fix'; END IF;
  SELECT * INTO d FROM labour_days WHERE id = p_day FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Day not found — refresh'; END IF;
  IF d.status = 'open' THEN RAISE EXCEPTION 'This day is already with the PM'; END IF;
  IF labour_day_is_paid(d.id) THEN RAISE EXCEPTION 'Pay for this day is already confirmed — reopen that pay first'; END IF;
  IF d.status = 'locked' THEN
    INSERT INTO labour_day_changes (day_id, kind, changed_by, changed_by_name, reason, before)
    VALUES (d.id, 'unlock', auth.uid(), v_name, btrim(p_reason), labour_day_snapshot(d.id));
  END IF;
  UPDATE labour_days SET status = 'open', locked_at = NULL, locked_by = NULL, locked_by_name = NULL,
         review_note = btrim(p_reason)
   WHERE id = p_day;
END $f$;

-- From the start date piece work is recorded on the day sheet only.
CREATE OR REPLACE FUNCTION public.trg_work_entry_day_rate_moved()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE v_start date := (SELECT starts_on FROM labour_day_settings WHERE id); r labor_requisitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = NEW.labor_requisition_id;
  IF v_start IS NOT NULL AND NEW.work_date >= v_start AND r.payment_basis = 'per_day' AND r.payment_model = 'individual' THEN
    RAISE EXCEPTION 'From %, day-rate work is recorded on the end-of-day sheet (Labour → Day sheet)', to_char(v_start, 'DD Mon YYYY');
  END IF;
  IF v_start IS NOT NULL AND NEW.work_date >= v_start AND r.payment_basis IN ('per_volume', 'fixed_price')
     AND NEW.recorded_via IS DISTINCT FROM 'day_sheet' THEN
    RAISE EXCEPTION 'From %, piece work is recorded on the PM''s day sheet (Labour → Day sheet)', to_char(v_start, 'DD Mon YYYY');
  END IF;
  IF (SELECT costing_closed_at FROM projects WHERE id = NEW.project_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Costing on this project is closed — no more labour can be recorded on it';
  END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_work_entry_day_rate_moved BEFORE INSERT OR UPDATE OF work_date, hours, overtime_hours, quantity, percent_done ON labour_work_entries
  FOR EACH ROW EXECUTE FUNCTION trg_work_entry_day_rate_moved();

-- ── 3. Review board and flags count piece work and the standing crew ──
DROP FUNCTION IF EXISTS public.labour_day_board(date, date);
CREATE OR REPLACE FUNCTION public.labour_day_board(p_from date, p_to date)
RETURNS TABLE(pm_staff_id uuid, pm_name text, work_date date, day_id uuid, status text, workers integer, paid_days numeric,
              allocated_days numeric, mismatched integer, request_id uuid, request_code text, request_status text, requested integer, changes integer,
              jobs integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH s AS (SELECT starts_on FROM labour_day_settings WHERE id),
  keys AS (
    SELECT d.pm_staff_id, d.work_date FROM labour_days d WHERE d.work_date BETWEEN p_from AND p_to
    UNION SELECT r.pm_staff_id, r.work_date FROM labour_day_requests r WHERE r.work_date BETWEEN p_from AND p_to AND r.status IN ('submitted', 'rejected')
    -- Days the standing crew was expected, up to today.
    UNION SELECT pm.pm_staff_id, g::date
      FROM (SELECT DISTINCT r.pm_staff_id FROM labour_day_requests r WHERE r.status = 'approved') pm
      CROSS JOIN s
      CROSS JOIN generate_series(GREATEST(p_from, s.starts_on), LEAST(p_to, bot_today()), interval '1 day') g
     WHERE s.starts_on IS NOT NULL AND (SELECT e.headcount FROM labour_day_expected(pm.pm_staff_id, g::date) e) > 0
  )
  SELECT k.pm_staff_id, st.employee_name, k.work_date, d.id, COALESCE(d.status, 'none'),
         (SELECT count(*)::int FROM labour_day_workers w WHERE w.day_id = d.id),
         (SELECT COALESCE(sum(w.paid_days), 0) FROM labour_day_workers w WHERE w.day_id = d.id),
         (SELECT COALESCE(sum(a.days), 0) FROM labour_day_allocations a WHERE a.day_id = d.id),
         CASE WHEN d.id IS NULL THEN 0 ELSE labour_day_mismatches(d.id) END,
         r.id, r.code, r.status,
         CASE WHEN r.id = e.request_id THEN e.headcount
              ELSE (SELECT COALESCE(sum(l.headcount), 0)::int FROM labour_day_request_lines l WHERE l.request_id = r.id) END,
         (SELECT count(*)::int FROM labour_day_changes c WHERE c.day_id = d.id),
         (SELECT count(DISTINCT x.rid)::int FROM (SELECT c.labor_requisition_id AS rid FROM labour_day_job_crew c WHERE c.day_id = d.id
                                                  UNION SELECT le.labor_requisition_id FROM labour_work_entries le WHERE le.labour_day_id = d.id) x)
    FROM keys k
    JOIN staff st ON st.id = k.pm_staff_id
    LEFT JOIN labour_days d ON d.pm_staff_id = k.pm_staff_id AND d.work_date = k.work_date
    LEFT JOIN LATERAL (SELECT * FROM labour_day_expected(k.pm_staff_id, k.work_date)) e ON true
    -- A change waiting for approval from this day shows; otherwise the crew that applies.
    LEFT JOIN labour_day_requests r ON r.id = COALESCE(
         (SELECT q.id FROM labour_day_requests q WHERE q.pm_staff_id = k.pm_staff_id AND q.work_date = k.work_date AND q.status IN ('submitted', 'rejected')),
         e.request_id)
   WHERE labour_day_can_see(k.pm_staff_id)
   ORDER BY k.work_date DESC, st.employee_name;
$f$;

CREATE OR REPLACE FUNCTION public.labour_flags()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_all boolean := labour_day_is_approver() OR COALESCE(get_user_role()::text IN ('finance', 'executive'), false);
  v_me uuid := current_staff_id(); v_days int := (SELECT costing_open_days FROM labour_day_settings WHERE id); v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  WITH board AS (SELECT * FROM labour_day_board(bot_today() - 30, bot_today())),
  mine AS (SELECT p.id FROM projects p WHERE v_all OR p.project_manager_id = v_me),
  costs AS (SELECT c.project_id, sum(c.cost) AS cost FROM labour_entry_costs(NULL, NULL) c WHERE c.project_id IN (SELECT id FROM mine) GROUP BY 1),
  budgets AS (SELECT pb.project_id, sum(pb.budgeted_amount) AS budget FROM project_budgets pb JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
               JOIN cost_groups g ON g.id = pb.cost_group_id AND g.name = 'Labor' GROUP BY 1)
  SELECT jsonb_build_object(
    'costing_open_days', v_days,
    'day_mismatches', COALESCE((SELECT jsonb_agg(jsonb_build_object('pm_staff_id', b.pm_staff_id, 'pm', b.pm_name, 'date', b.work_date, 'status', b.status,
                          'why', CASE WHEN b.mismatched > 0 THEN format('%s worker%s don''t add up', b.mismatched, CASE WHEN b.mismatched = 1 THEN '' ELSE 's' END)
                                      WHEN b.status = 'none' OR (b.workers = 0 AND b.jobs = 0) THEN format('%s asked for, nobody recorded', b.requested)
                                      ELSE 'Sent, not reviewed yet' END) ORDER BY b.work_date DESC, b.pm_name)
                        FROM board b
                       WHERE (v_all OR b.pm_staff_id = v_me)
                         AND (b.mismatched > 0
                              OR (b.work_date < bot_today() AND b.request_status = 'approved' AND b.requested > 0 AND (b.status = 'none' OR (b.workers = 0 AND b.jobs = 0)))
                              OR (b.status = 'submitted' AND b.work_date < bot_today() - 1))), '[]'::jsonb),
    'over_budget', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', p.id, 'project', p.project_name, 'cost', c.cost, 'budget', b.budget,
                          'over', c.cost - b.budget) ORDER BY c.cost - b.budget DESC)
                        FROM costs c JOIN budgets b ON b.project_id = c.project_id JOIN projects p ON p.id = c.project_id
                       WHERE b.budget > 0 AND c.cost > b.budget AND labour_can_see_costs(p.id)), '[]'::jsonb),
    'costing_open', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', p.id, 'project', p.project_name,
                          'delivered_at', p.delivered_at, 'days', bot_today() - (p.delivered_at AT TIME ZONE 'Africa/Addis_Ababa')::date) ORDER BY p.delivered_at)
                        FROM projects p
                       WHERE p.id IN (SELECT id FROM mine) AND p.delivered_at IS NOT NULL AND p.costing_closed_at IS NULL
                         AND (p.delivered_at AT TIME ZONE 'Africa/Addis_Ababa')::date < bot_today() - v_days), '[]'::jsonb),
    'awaiting_inspection', COALESCE((SELECT jsonb_agg(jsonb_build_object('check_id', c.id, 'code', c.code, 'project_id', c.project_id, 'project', p.project_name,
                          'received_at', c.checked_at, 'items', (SELECT sum(l.quantity) FROM fixture_check_lines l WHERE l.check_id = c.id)) ORDER BY c.checked_at)
                        FROM fixture_checks c JOIN projects p ON p.id = c.project_id
                       WHERE c.kind = 'return' AND c.status = 'received'
                         AND (v_all OR fixture_inspector(c.project_id))), '[]'::jsonb))
  INTO v;
  RETURN v;
END $f$;

-- ── 4. One pay round ──────────────────────────────────────────────────
-- Per-job pay leaves out entries on day sheets that aren't locked yet.
CREATE OR REPLACE FUNCTION public.labour_pay_lines(p_req uuid, p_to date)
 RETURNS TABLE(staff_id uuid, worker_name text, first_day date, last_day date, days numeric, hours numeric, overtime_hours numeric, quantity numeric, percent_done numeric, rate numeric, overtime_amount numeric, amount numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH r AS (SELECT * FROM labor_requisitions WHERE id = p_req),
  e AS (
    SELECT e.* FROM labour_work_entries e
    WHERE e.labor_requisition_id = p_req AND e.pay_sheet_id IS NULL AND e.work_date <= p_to AND labour_entry_payable(e.labour_day_id)
  ), agg AS (
    SELECT e.staff_id, min(e.work_date) AS first_day, max(e.work_date) AS last_day,
      sum(COALESCE(e.hours, 0)) AS hours, sum(e.overtime_hours) AS ot,
      sum(COALESCE(e.quantity, 0)) AS qty, sum(COALESCE(e.percent_done, 0)) AS pct
    FROM e GROUP BY e.staff_id
  ), ot AS (
    SELECT o.staff_id, sum(o.amount) AS amount FROM labour_overtime_lines(p_req, p_to) o GROUP BY o.staff_id
  ), priced AS (
    SELECT a.*, s.employee_name,
      CASE r.payment_basis
        WHEN 'per_day' THEN labour_worker_day_rate(p_req, a.staff_id)
        WHEN 'per_volume' THEN r.unit_rate
        ELSE r.fixed_price_amount END AS rate,
      r.payment_basis,
      COALESCE(ot.amount, 0) AS ot_amount
    FROM agg a CROSS JOIN r LEFT JOIN staff s ON s.id = a.staff_id
    LEFT JOIN ot ON ot.staff_id IS NOT DISTINCT FROM a.staff_id
  )
  SELECT p.staff_id,
    COALESCE(p.employee_name, CASE WHEN p.payment_basis = 'fixed_price' THEN 'Task' ELSE 'Crew' END),
    p.first_day, p.last_day,
    CASE WHEN p.payment_basis = 'per_day' THEN round(p.hours / 8, 3) END,
    CASE WHEN p.payment_basis = 'per_day' THEN p.hours END,
    p.ot,
    CASE WHEN p.payment_basis = 'per_volume' THEN p.qty END,
    CASE WHEN p.payment_basis = 'fixed_price' THEN p.pct END,
    p.rate,
    CASE WHEN p.payment_basis = 'per_day' THEN round(p.ot_amount, 2) ELSE 0 END,
    round(CASE p.payment_basis
      WHEN 'per_day'    THEN p.hours / 8 * p.rate + p.ot_amount
      WHEN 'per_volume' THEN p.qty * p.rate
      ELSE p.pct / 100 * p.rate END, 2)
  FROM priced p
  ORDER BY 2;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_labour_pay(p_req uuid, p_to date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r         labor_requisitions%ROWTYPE;
  v_lines   jsonb;
  v_total   numeric;
  v_from    date;
  v_last    date;
  v_sheet   uuid;
  v_code    text;
  v_expense uuid;
  v_project text;
  v_count   int;
  v_labor_category_id uuid := 'd9f67bf3-38ef-49d6-ad77-2869af9b6c82';
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (manages_project(r.project_id) OR COALESCE((get_user_role() IN ('admin', 'operations_manager') OR is_ops_manager()), false)
          OR (r.requested_by_staff_id IS NOT NULL AND r.requested_by_staff_id = current_staff_id())) THEN
    RAISE EXCEPTION 'The project manager confirms what is owed on their site';
  END IF;

  SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('overtime_detail',
           (SELECT jsonb_agg(jsonb_build_object('date', o.work_date, 'hours', o.overtime_hours, 'night_hours', o.night_hours,
                    'rule', o.rule, 'basis', o.basis, 'amount', o.amount) ORDER BY o.work_date)
              FROM labour_overtime_lines(p_req, p_to) o WHERE o.staff_id IS NOT DISTINCT FROM l.staff_id))),
         sum(l.amount), min(l.first_day), max(l.last_day), count(*)
    INTO v_lines, v_total, v_from, v_last, v_count
  FROM labour_pay_lines(p_req, p_to) l;
  IF COALESCE(v_count, 0) = 0 THEN RAISE EXCEPTION 'Nothing recorded to pay up to %', to_char(p_to, 'DD Mon'); END IF;
  IF COALESCE(v_total, 0) <= 0 THEN RAISE EXCEPTION 'What is recorded comes to nothing — check the rates on this request'; END IF;

  SELECT project_name INTO v_project FROM projects WHERE id = r.project_id;
  v_code := 'LPS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_pay_sheet_seq')::text, 4, '0');

  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, category_id, project_id, date,
    vendor_id, paid_to_staff_id, approval_status, payment_state,
    rolled_up_from_requisition_id, rollup_period_start, rollup_period_end)
  VALUES (
    format('Labour %s · %s · %s · %s to %s', v_code, r.role_needed, COALESCE(v_project, '—'),
           to_char(v_from, 'DD Mon'), to_char(v_last, 'DD Mon YYYY')),
    v_total, 'labor_payment'::expense_category, v_labor_category_id, r.project_id, v_last,
    CASE WHEN r.payment_model = 'gang_leader' THEN r.gang_leader_vendor_id END,
    CASE WHEN r.payment_model = 'individual' AND v_count = 1 THEN (SELECT (x->>'staff_id')::uuid FROM jsonb_array_elements(v_lines) x LIMIT 1) END,
    'pending'::expense_approval_status, 'unpaid', p_req, v_from, v_last)
  RETURNING id INTO v_expense;

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_staff_ids, overtime_hours, overtime_amount)
  SELECT v_expense,
    COALESCE((x->>'staff_id')::uuid,
      (SELECT a.staff_id FROM labor_allocations a WHERE a.labor_requisition_id = p_req ORDER BY (a.status = 'active') DESC, a.created_at LIMIT 1)),
    COALESCE((x->>'days')::numeric, (x->>'quantity')::numeric, (x->>'percent_done')::numeric, 0),
    COALESCE((x->>'rate')::numeric, 0), (x->>'amount')::numeric,
    CASE WHEN x->>'staff_id' IS NULL THEN GREATEST((SELECT count(DISTINCT a.staff_id) FROM labor_allocations a WHERE a.labor_requisition_id = p_req AND a.status = 'active'), 1) ELSE 1 END,
    CASE WHEN x->>'staff_id' IS NULL THEN (SELECT array_agg(DISTINCT a.staff_id) FROM labor_allocations a WHERE a.labor_requisition_id = p_req AND a.status = 'active') END,
    NULLIF((x->>'overtime_hours')::numeric, 0), NULLIF((x->>'overtime_amount')::numeric, 0)
  FROM jsonb_array_elements(v_lines) x
  WHERE (x->>'staff_id') IS NOT NULL
     OR EXISTS (SELECT 1 FROM labor_allocations a WHERE a.labor_requisition_id = p_req);

  INSERT INTO labour_pay_sheets (code, labor_requisition_id, project_id, period_start, period_end, total, lines, expense_id,
    confirmed_by, confirmed_by_name, note)
  VALUES (v_code, p_req, r.project_id, v_from, v_last, v_total, v_lines, v_expense,
    auth.uid(), (SELECT full_name FROM user_profiles WHERE id = auth.uid()), NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_sheet;

  UPDATE labour_work_entries SET pay_sheet_id = v_sheet
   WHERE labor_requisition_id = p_req AND pay_sheet_id IS NULL AND work_date <= p_to AND labour_entry_payable(labour_day_id);

  PERFORM log_labour_event(p_req, 'pay_confirmed',
    format('%s · %s ETB · %s to %s', v_code, to_char(v_total, 'FM999,999,990.00'), to_char(v_from, 'DD Mon'), to_char(v_last, 'DD Mon')));
  RETURN v_sheet;
END $function$;

-- Piece work ready to pay: on a PM's locked days, plus anything recorded
-- the old way on their jobs and never paid (it goes out in the same run).
CREATE OR REPLACE FUNCTION public.labour_day_job_costs(p_pm uuid DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(pm_staff_id uuid, labor_requisition_id uuid, project_id uuid, work_date date, quantity numeric, percent_done numeric, rate numeric, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT x.* FROM (
    SELECT COALESCE(d.pm_staff_id, p.project_manager_id, r.requested_by_staff_id) AS pm_staff_id, e.labor_requisition_id, e.project_id, e.work_date,
           e.quantity, e.percent_done,
           CASE r.payment_basis WHEN 'per_volume' THEN r.unit_rate ELSE r.fixed_price_amount END AS rate,
           round(CASE r.payment_basis WHEN 'per_volume' THEN COALESCE(e.quantity, 0) * COALESCE(r.unit_rate, 0)
                      ELSE COALESCE(e.percent_done, 0) / 100 * COALESCE(r.fixed_price_amount, 0) END, 2) AS amount
      FROM labour_work_entries e
      JOIN labor_requisitions r ON r.id = e.labor_requisition_id
      JOIN projects p ON p.id = r.project_id
      LEFT JOIN labour_days d ON d.id = e.labour_day_id
     WHERE e.pay_sheet_id IS NULL AND r.payment_basis IN ('per_volume', 'fixed_price')
       AND (e.labour_day_id IS NULL OR d.status = 'locked')
       AND (p_to IS NULL OR e.work_date <= p_to)) x
   WHERE p_pm IS NULL OR x.pm_staff_id = p_pm;
$f$;
REVOKE EXECUTE ON FUNCTION labour_day_job_costs(uuid, date) FROM PUBLIC, anon, authenticated;

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
                         'paid_to', COALESCE(v.vendor_name, CASE WHEN r.payment_model = 'gang_leader' THEN 'the crew leader' ELSE 'the crew' END))
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

-- Confirm pay for a PM's locked days up to a date: day workers as one
-- payable per project, each piece job as its own payable, all in one run.
CREATE OR REPLACE FUNCTION public.confirm_labour_day_pay(p_pm uuid, p_to date, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_run uuid; v_code text; v_from date; v_last date; v_total numeric; v_n int; v_jobs int; v_missing text; v_cat uuid; v_exp uuid; v_sheet uuid;
  v_pm_name text := (SELECT employee_name FROM staff WHERE id = p_pm);
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  prj record; job record; v_lines jsonb;
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

  SELECT count(*), min(work_date), max(work_date) INTO v_n, v_from, v_last
    FROM labour_day_costs(p_pm, NULL, p_to) c WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL;
  SELECT count(DISTINCT labor_requisition_id), LEAST(v_from, min(work_date)), GREATEST(v_last, max(work_date)) INTO v_jobs, v_from, v_last
    FROM labour_day_job_costs(p_pm, p_to) HAVING sum(amount) > 0;
  IF COALESCE(v_n, 0) = 0 AND COALESCE(v_jobs, 0) = 0 THEN RAISE EXCEPTION 'No locked days to pay up to %', to_char(p_to, 'DD Mon'); END IF;
  IF v_from IS NULL THEN
    SELECT min(work_date), max(work_date) INTO v_from, v_last FROM labour_day_costs(p_pm, NULL, p_to) c WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL;
  END IF;

  v_code := 'LDP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_day_pay_run_seq')::text, 4, '0');
  INSERT INTO labour_day_pay_runs (code, pm_staff_id, period_start, period_end, total, note, confirmed_by, confirmed_by_name)
  VALUES (v_code, p_pm, v_from, v_last, 0, NULLIF(btrim(p_note), ''), auth.uid(), v_name)
  RETURNING id INTO v_run;

  v_cat := COALESCE((SELECT c.id FROM categories c WHERE c.category_name = 'Labor' AND c.parent_type = 'Project' ORDER BY c.created_at LIMIT 1),
                    (SELECT c.id FROM categories c WHERE c.category_name = 'Labor' ORDER BY c.created_at LIMIT 1));

  -- Day workers: one payable per project.
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

  -- Piece jobs: each on its own payable, the same way as before.
  FOR job IN SELECT labor_requisition_id AS id FROM labour_day_job_costs(p_pm, p_to) GROUP BY 1 HAVING sum(amount) > 0 LOOP
    v_sheet := confirm_labour_pay(job.id, p_to, p_note);
    UPDATE labour_pay_sheets SET day_pay_run_id = v_run, pm_staff_id = p_pm WHERE id = v_sheet;
  END LOOP;

  UPDATE labour_day_pay_runs r
     SET total = (SELECT COALESCE(sum(ps.total), 0) FROM labour_pay_sheets ps WHERE ps.day_pay_run_id = v_run),
         lines = COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'worker_name', s.employee_name, 'days', x.days,
                                   'rate', x.rate, 'overtime_amount', x.ot, 'amount', x.amount) ORDER BY s.employee_name)
                             FROM (SELECT c.staff_id, sum(c.days) AS days, max(c.day_rate) AS rate, sum(c.overtime) AS ot, sum(c.amount) AS amount
                                     FROM labour_day_costs(p_pm, NULL, p_to) c WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL
                                    GROUP BY c.staff_id) x JOIN staff s ON s.id = x.staff_id), '[]'::jsonb)
                 || COALESCE((SELECT jsonb_agg(jsonb_build_object('job_id', ps.labor_requisition_id, 'worker_name', q.role_needed, 'amount', ps.total) ORDER BY q.role_needed)
                                FROM labour_pay_sheets ps JOIN labor_requisitions q ON q.id = ps.labor_requisition_id
                               WHERE ps.day_pay_run_id = v_run), '[]'::jsonb)
   WHERE r.id = v_run;

  UPDATE labour_day_workers w SET pay_run_id = v_run
    FROM labour_days d
   WHERE d.id = w.day_id AND d.pm_staff_id = p_pm AND d.status = 'locked' AND d.work_date <= p_to AND w.pay_run_id IS NULL;
  RETURN v_run;
END $f$;

-- Each PM's labour still to pay: locked and ready (day workers and piece
-- work), waiting on review, or still open.
CREATE OR REPLACE FUNCTION public.labour_day_unpaid()
RETURNS TABLE(pm_staff_id uuid, pm_name text, locked_days integer, first_day date, last_day date, workers integer, amount numeric,
              waiting_review integer, open_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH d AS (
    SELECT d.* FROM labour_days d
     WHERE labour_day_can_see(d.pm_staff_id)
       AND (EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id AND w.pay_run_id IS NULL)
            OR EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labour_day_id = d.id AND e.pay_sheet_id IS NULL))
  ), c AS (
    SELECT c.pm_staff_id, c.work_date, c.staff_id, c.amount FROM labour_day_costs(NULL, NULL, NULL) c JOIN d ON d.id = c.day_id
     WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL
    UNION ALL
    SELECT j.pm_staff_id, j.work_date, NULL, j.amount FROM labour_day_job_costs(NULL, NULL) j WHERE j.pm_staff_id IN (SELECT pm_staff_id FROM d)
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

-- The per-job record screen stops offering piece work from the start date
-- too: it is on the PM's day sheet.
CREATE OR REPLACE FUNCTION public.labour_day_sheet(p_project uuid, p_date date)
 RETURNS TABLE(labor_requisition_id uuid, role_needed text, payment_basis text, payment_model text, volume_unit text, unit_rate numeric, day_rate numeric, fixed_price_amount numeric, percent_so_far numeric, staff_id uuid, worker_name text, phone text, entry_id uuid, hours numeric, overtime_hours numeric, quantity numeric, percent_done numeric, note text, locked boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH reqs AS (
    SELECT r.* FROM labor_requisitions r
    WHERE r.project_id = p_project AND r.status = 'approved' AND r.closed_at IS NULL
      AND COALESCE(r.start_date, p_date) <= p_date
      AND (r.end_date IS NULL OR r.end_date >= p_date - 7)
      AND can_run_labour_site(p_project)
      AND NOT ((r.payment_basis = 'per_day' AND r.payment_model = 'individual' OR r.payment_basis IN ('per_volume', 'fixed_price'))
               AND p_date >= COALESCE((SELECT starts_on FROM labour_day_settings WHERE id), 'infinity'::date))
  ), people AS (
    SELECT r.id AS req_id, a.staff_id, a.day_rate_snapshot
    FROM reqs r JOIN labor_allocations a ON a.labor_requisition_id = r.id
    WHERE r.payment_basis = 'per_day'
       OR (r.payment_basis = 'per_volume' AND r.payment_model = 'individual')
    GROUP BY r.id, a.staff_id, a.day_rate_snapshot
    HAVING bool_or(a.status = 'active' OR EXISTS (
      SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.staff_id = a.staff_id AND e.work_date = p_date))
    UNION ALL
    SELECT r.id, NULL::uuid, NULL::numeric FROM reqs r
    WHERE r.payment_basis = 'fixed_price' OR (r.payment_basis = 'per_volume' AND r.payment_model = 'gang_leader')
  )
  SELECT r.id, r.role_needed, r.payment_basis, r.payment_model, r.volume_unit, r.unit_rate,
         COALESCE(p.day_rate_snapshot, s.day_rate, r.estimated_day_rate),
         r.fixed_price_amount,
         (SELECT COALESCE(sum(x.percent_done), 0) FROM labour_work_entries x WHERE x.labor_requisition_id = r.id AND x.work_date <> p_date),
         p.staff_id, COALESCE(s.employee_name, CASE WHEN r.payment_basis = 'fixed_price' THEN 'The task' ELSE 'The crew' END), s.phone_number,
         e.id, e.hours, e.overtime_hours, e.quantity, e.percent_done, e.note, (e.pay_sheet_id IS NOT NULL)
  FROM people p
  JOIN reqs r ON r.id = p.req_id
  LEFT JOIN staff s ON s.id = p.staff_id
  LEFT JOIN labour_work_entries e ON e.labor_requisition_id = r.id
       AND e.staff_id IS NOT DISTINCT FROM p.staff_id AND e.work_date = p_date
  ORDER BY r.role_needed, r.created_at, s.employee_name NULLS FIRST;
$function$;
