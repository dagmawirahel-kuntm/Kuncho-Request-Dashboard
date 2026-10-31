-- 489: labour is costed to the project, a day at a time.
-- Day-rate workers are no longer asked for and recorded job by job. Each PM
-- sends one request a day (headcount by trade, approved by operations before
-- the day), and at the end of the day fills one sheet: who was present (a
-- half or a whole day) and how that day split across projects — build or
-- post-event repair — or the workshop, stock fixture production, or idle.
-- Each worker's columns must add up to their day; operations locks the sheet
-- after review, and a change after that needs a reason and is logged.
-- Work orders are untouched; volume and fixed-price labour stays on them.
-- Nothing changes until admin sets the start date.

-- Where the non-project columns are costed, and when the new way starts.
CREATE TABLE IF NOT EXISTS public.labour_day_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  starts_on date,
  workshop_project_id uuid REFERENCES projects(id),
  stock_project_id uuid REFERENCES projects(id),
  idle_project_id uuid REFERENCES projects(id),
  costing_open_days integer NOT NULL DEFAULT 14 CHECK (costing_open_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL
);
INSERT INTO labour_day_settings (id, workshop_project_id, stock_project_id, idle_project_id)
SELECT true,
  (SELECT id FROM projects WHERE is_internal AND btrim(project_name) ILIKE 'Workshop Maintenance' ORDER BY created_at LIMIT 1),
  (SELECT id FROM projects WHERE is_internal AND btrim(project_name) ILIKE 'Company Stock' ORDER BY created_at LIMIT 1),
  (SELECT id FROM projects WHERE is_internal AND btrim(project_name) ILIKE 'Workshop' ORDER BY created_at LIMIT 1)
ON CONFLICT (id) DO NOTHING;

-- The two closing points of a project (set in 491) and its damage terms.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivered_by_name text,
  ADD COLUMN IF NOT EXISTS costing_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS costing_closed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS costing_closed_by_name text,
  ADD COLUMN IF NOT EXISTS damage_chargeable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS damage_terms text;

-- Who may run a PM's day, and who approves and locks.
CREATE OR REPLACE FUNCTION public.labour_day_is_approver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'hr_officer', 'operations_manager'), false) OR COALESCE(is_ops_manager(), false);
$f$;
CREATE OR REPLACE FUNCTION public.labour_day_can_run(p_pm uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p_pm IS NOT NULL AND (p_pm = current_staff_id() OR labour_day_is_approver());
$f$;
CREATE OR REPLACE FUNCTION public.labour_day_can_see(p_pm uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT labour_day_can_run(p_pm) OR COALESCE(get_user_role()::text IN ('finance', 'executive'), false);
$f$;

-- 1. The daily request: headcount by trade, no project.
CREATE SEQUENCE IF NOT EXISTS labour_day_request_seq;
CREATE TABLE IF NOT EXISTS public.labour_day_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  pm_staff_id uuid NOT NULL REFERENCES staff(id),
  work_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  note text,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_by_name text,
  submitted_at timestamptz,
  decided_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pm_staff_id, work_date)
);
CREATE TABLE IF NOT EXISTS public.labour_day_request_lines (
  request_id uuid NOT NULL REFERENCES labour_day_requests(id) ON DELETE CASCADE,
  trade_tag text NOT NULL REFERENCES tier2_trade_roster(trade_tag) ON UPDATE CASCADE,
  headcount integer NOT NULL CHECK (headcount > 0),
  PRIMARY KEY (request_id, trade_tag)
);
CREATE INDEX IF NOT EXISTS labour_day_requests_date_idx ON labour_day_requests (work_date, status);

-- 2. The end-of-day sheet: who was paid for the day, and where it went.
CREATE TABLE IF NOT EXISTS public.labour_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_staff_id uuid NOT NULL REFERENCES staff(id),
  work_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'locked')),
  saved_at timestamptz,
  saved_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  saved_by_name text,
  submitted_at timestamptz,
  submitted_by_name text,
  locked_at timestamptz,
  locked_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  locked_by_name text,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pm_staff_id, work_date)
);
CREATE INDEX IF NOT EXISTS labour_days_date_idx ON labour_days (work_date, status);
CREATE TABLE IF NOT EXISTS public.labour_day_workers (
  day_id uuid NOT NULL REFERENCES labour_days(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  paid_days numeric(3,1) NOT NULL CHECK (paid_days IN (0.5, 1.0)),
  overtime_hours numeric NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 16),
  overtime_night_hours numeric NOT NULL DEFAULT 0 CHECK (overtime_night_hours >= 0 AND overtime_night_hours <= overtime_hours),
  note text,
  pay_run_id uuid,
  PRIMARY KEY (day_id, staff_id)
);
CREATE INDEX IF NOT EXISTS labour_day_workers_staff_idx ON labour_day_workers (staff_id);
CREATE TABLE IF NOT EXISTS public.labour_day_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES labour_days(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES projects(id),
  bucket text NOT NULL CHECK (bucket IN ('build', 'repair', 'workshop', 'stock', 'idle')),
  days numeric(3,1) NOT NULL CHECK (days > 0 AND days <= 1 AND days * 2 = trunc(days * 2)),
  UNIQUE (day_id, staff_id, project_id, bucket)
);
CREATE INDEX IF NOT EXISTS labour_day_allocations_project_idx ON labour_day_allocations (project_id);
CREATE INDEX IF NOT EXISTS labour_day_allocations_staff_idx ON labour_day_allocations (staff_id);

-- 3. Changes to a locked day: why, by whom, before and after.
CREATE TABLE IF NOT EXISTS public.labour_day_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES labour_days(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'edit' CHECK (kind IN ('edit', 'unlock')),
  changed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  before jsonb,
  after jsonb
);
CREATE INDEX IF NOT EXISTS labour_day_changes_day_idx ON labour_day_changes (day_id);

-- Read access follows the PM; writes only through the functions below.
ALTER TABLE labour_day_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_day_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_day_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_day_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_day_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_day_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY labour_day_settings_read ON labour_day_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY labour_day_requests_read ON labour_day_requests FOR SELECT TO authenticated USING (labour_day_can_see(pm_staff_id));
CREATE POLICY labour_day_request_lines_read ON labour_day_request_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM labour_day_requests r WHERE r.id = request_id AND labour_day_can_see(r.pm_staff_id)));
CREATE POLICY labour_days_read ON labour_days FOR SELECT TO authenticated USING (labour_day_can_see(pm_staff_id));
CREATE POLICY labour_day_workers_read ON labour_day_workers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM labour_days d WHERE d.id = day_id AND labour_day_can_see(d.pm_staff_id)));
CREATE POLICY labour_day_allocations_read ON labour_day_allocations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM labour_days d WHERE d.id = day_id AND labour_day_can_see(d.pm_staff_id)) OR manages_project(project_id));
CREATE POLICY labour_day_changes_read ON labour_day_changes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM labour_days d WHERE d.id = day_id AND labour_day_can_see(d.pm_staff_id)));

CREATE OR REPLACE FUNCTION public.set_labour_day_settings(p_starts_on date, p_workshop uuid, p_stock uuid, p_idle uuid, p_costing_open_days integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'operations_manager') AND NOT COALESCE(is_ops_manager(), false) THEN
    RAISE EXCEPTION 'Only admin or operations change the daily labour settings';
  END IF;
  IF p_starts_on IS NOT NULL AND EXISTS (SELECT 1 FROM labour_days d WHERE d.work_date < p_starts_on
                                          AND EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id)) THEN
    RAISE EXCEPTION 'Days before % are already on day sheets — the start can''t move past them', to_char(p_starts_on, 'DD Mon YYYY');
  END IF;
  IF EXISTS (SELECT 1 FROM projects p WHERE p.id IN (p_workshop, p_stock, p_idle) AND NOT COALESCE(p.is_internal, false)) THEN
    RAISE EXCEPTION 'Workshop, stock production and idle time are costed to internal projects';
  END IF;
  UPDATE labour_day_settings SET starts_on = p_starts_on, workshop_project_id = p_workshop, stock_project_id = p_stock,
         idle_project_id = p_idle, costing_open_days = COALESCE(p_costing_open_days, costing_open_days),
         updated_at = now(), updated_by = auth.uid()
   WHERE id;
END $f$;

-- Save (and optionally send) a PM's request for a day.
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
    SELECT u.id, 'labour_day_request', 'Daily labour request to approve',
           format('%s · %s · %s workers', (SELECT employee_name FROM staff WHERE id = p_pm), to_char(p_date, 'Dy DD Mon'),
                  (SELECT sum(headcount) FROM labour_day_request_lines WHERE request_id = r.id)),
           '/labour/day-requests', 'labour_day_request', r.id, auth.uid(), 'ldr-' || r.id
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
  SELECT s.user_id, 'labour_day_request',
         CASE WHEN p_approve THEN 'Labour request approved' ELSE 'Labour request rejected' END,
         format('%s · %s%s', r.code, to_char(r.work_date, 'Dy DD Mon'), CASE WHEN NULLIF(btrim(p_note), '') IS NOT NULL THEN ' · ' || btrim(p_note) ELSE '' END),
         '/labour/day-requests', 'labour_day_request', r.id, auth.uid(), 'ldr-decided-' || r.id || '-' || extract(epoch FROM now())::bigint
    FROM staff s WHERE s.id = r.pm_staff_id AND s.user_id IS NOT NULL AND s.user_id IS DISTINCT FROM auth.uid();
END $f$;

-- A day as a list of workers and where their day went.
CREATE OR REPLACE FUNCTION public.labour_day_snapshot(p_day uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('staff_id', w.staff_id, 'name', s.employee_name, 'paid_days', w.paid_days,
           'overtime_hours', w.overtime_hours, 'overtime_night_hours', w.overtime_night_hours, 'note', w.note,
           'alloc', (SELECT COALESCE(jsonb_agg(jsonb_build_object('project_id', a.project_id, 'project', p.project_name, 'bucket', a.bucket, 'days', a.days)
                                               ORDER BY p.project_name, a.bucket), '[]'::jsonb)
                       FROM labour_day_allocations a JOIN projects p ON p.id = a.project_id
                      WHERE a.day_id = w.day_id AND a.staff_id = w.staff_id))
           ORDER BY s.employee_name), '[]'::jsonb)
    FROM labour_day_workers w JOIN staff s ON s.id = w.staff_id
   WHERE w.day_id = p_day;
$f$;

-- Workers whose columns don't add up to the day they're paid.
CREATE OR REPLACE FUNCTION public.labour_day_mismatches(p_day uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT count(*)::int FROM labour_day_workers w
   WHERE w.day_id = p_day
     AND w.paid_days <> COALESCE((SELECT sum(a.days) FROM labour_day_allocations a WHERE a.day_id = w.day_id AND a.staff_id = w.staff_id), 0);
$f$;

-- Projects a PM's sheet offers as columns: their own live projects, and any
-- the sheet already uses.
CREATE OR REPLACE FUNCTION public.labour_day_projects(p_pm uuid, p_date date)
RETURNS TABLE(project_id uuid, project_name text, mine boolean, delivered boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p.id, p.project_name, p.project_manager_id IS NOT DISTINCT FROM p_pm, p.delivered_at IS NOT NULL
    FROM projects p
   WHERE NOT COALESCE(p.is_internal, false) AND p.costing_closed_at IS NULL
     AND ((p.project_manager_id = p_pm AND COALESCE(p.active_for_year, true)
           AND (EXISTS (SELECT 1 FROM work_orders w WHERE w.project_id = p.id AND w.status IN ('requested', 'in_progress'))
                OR EXISTS (SELECT 1 FROM labour_day_allocations a JOIN labour_days d ON d.id = a.day_id
                            WHERE a.project_id = p.id AND d.work_date >= p_date - 30)
                OR EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.project_id = p.id AND e.work_date >= p_date - 30)
                OR p.created_at >= p_date - 30))
          OR EXISTS (SELECT 1 FROM labour_day_allocations a JOIN labour_days d ON d.id = a.day_id
                      WHERE a.project_id = p.id AND d.pm_staff_id = p_pm AND d.work_date BETWEEN p_date - 7 AND p_date))
   ORDER BY (p.project_manager_id IS NOT DISTINCT FROM p_pm) DESC, p.project_name;
$f$;

-- The sheet for a PM and a day. Nothing saved yet: it starts as a copy of
-- the PM's last day (no overtime), for them to change what changed.
CREATE OR REPLACE FUNCTION public.labour_day_get(p_pm uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_day_settings%ROWTYPE; d labour_days%ROWTYPE; v_src labour_days%ROWTYPE; v_from uuid; v_prefill boolean := false; v jsonb;
BEGIN
  IF NOT labour_day_can_see(p_pm) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO s FROM labour_day_settings WHERE id;
  SELECT * INTO d FROM labour_days WHERE pm_staff_id = p_pm AND work_date = p_date;
  IF d.id IS NOT NULL AND (d.saved_at IS NOT NULL OR EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id)) THEN
    v_from := d.id;
  ELSE
    SELECT x.* INTO v_src FROM labour_days x
     WHERE x.pm_staff_id = p_pm AND x.work_date < p_date AND EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = x.id)
     ORDER BY x.work_date DESC LIMIT 1;
    v_from := v_src.id; v_prefill := v_src.id IS NOT NULL;
  END IF;

  SELECT jsonb_build_object(
    'pm', jsonb_build_object('id', p_pm, 'name', (SELECT employee_name FROM staff WHERE id = p_pm)),
    'date', p_date,
    'starts_on', s.starts_on,
    'can_edit', labour_day_can_run(p_pm) AND (d.id IS NULL OR d.status <> 'locked' OR labour_day_is_approver()),
    'is_approver', labour_day_is_approver(),
    'day', CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('id', d.id, 'status', d.status, 'saved_at', d.saved_at, 'saved_by_name', d.saved_by_name,
             'submitted_at', d.submitted_at, 'locked_at', d.locked_at, 'locked_by_name', d.locked_by_name, 'review_note', d.review_note,
             'changes', (SELECT count(*) FROM labour_day_changes c WHERE c.day_id = d.id),
             'paid', EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id AND w.pay_run_id IS NOT NULL)) END,
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
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.project_id, 'name', x.project_name, 'mine', x.mine, 'delivered', x.delivered))
                            FROM (SELECT * FROM labour_day_projects(p_pm, p_date)
                                  UNION
                                  SELECT p.id, p.project_name, p.project_manager_id IS NOT DISTINCT FROM p_pm, p.delivered_at IS NOT NULL
                                    FROM labour_day_allocations a JOIN projects p ON p.id = a.project_id
                                   WHERE a.day_id = v_from AND a.bucket IN ('build', 'repair')) x), '[]'::jsonb),
    'buckets', jsonb_build_object(
       'workshop', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.workshop_project_id),
       'stock', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.stock_project_id),
       'idle', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.idle_project_id)),
    'request', (SELECT jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'decided_by_name', r.decided_by_name, 'decision_note', r.decision_note,
                  'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('trade', l.trade_tag, 'headcount', l.headcount)), '[]'::jsonb)
                              FROM labour_day_request_lines l WHERE l.request_id = r.id))
                  FROM labour_day_requests r WHERE r.pm_staff_id = p_pm AND r.work_date = p_date))
  INTO v;
  RETURN v;
END $f$;

-- Save a PM's day. p_submit sends it to operations for review; a locked day
-- changes only by operations, with a reason, and is logged.
CREATE OR REPLACE FUNCTION public.labour_day_save(p_pm uuid, p_date date, p_workers jsonb, p_submit boolean DEFAULT false, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_day_settings%ROWTYPE; d labour_days%ROWTYPE; st staff%ROWTYPE; p projects%ROWTYPE;
  w jsonb; a jsonb; v_staff uuid; v_paid numeric; v_other numeric; v_ot numeric; v_night numeric;
  v_bucket text; v_days numeric; v_proj uuid; v_before jsonb; v_mis int; v_seen uuid[] := '{}';
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
  IF EXISTS (SELECT 1 FROM labour_day_workers WHERE day_id = d.id AND pay_run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Pay for this day is already confirmed — reopen that pay first';
  END IF;
  IF d.status = 'locked' THEN
    IF NOT labour_day_is_approver() THEN RAISE EXCEPTION 'This day is locked — ask operations to change it'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why you are changing a locked day'; END IF;
    v_before := labour_day_snapshot(d.id);
  END IF;

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

  v_mis := labour_day_mismatches(d.id);
  IF d.status = 'locked' THEN
    IF v_mis > 0 THEN RAISE EXCEPTION 'A locked day must still add up: % worker% don''t', v_mis, CASE WHEN v_mis = 1 THEN '' ELSE 's' END; END IF;
    INSERT INTO labour_day_changes (day_id, kind, changed_by, changed_by_name, reason, before, after)
    VALUES (d.id, 'edit', auth.uid(), v_name, btrim(p_reason), v_before, labour_day_snapshot(d.id));
  ELSIF p_submit THEN
    IF NOT EXISTS (SELECT 1 FROM labour_day_workers WHERE day_id = d.id) THEN RAISE EXCEPTION 'Add who was present first'; END IF;
    IF v_mis > 0 THEN
      RAISE EXCEPTION '% worker% don''t add up — each worker''s columns must come to their day (0.5 or 1)', v_mis, CASE WHEN v_mis = 1 THEN '' ELSE 's' END;
    END IF;
    UPDATE labour_days SET status = 'submitted', submitted_at = now(), submitted_by_name = v_name WHERE id = d.id;
  ELSE
    -- Changed after sending: it goes back to the PM until sent again.
    UPDATE labour_days SET status = 'open' WHERE id = d.id;
  END IF;
  UPDATE labour_days SET saved_at = now(), saved_by = auth.uid(), saved_by_name = v_name WHERE id = d.id;
  RETURN jsonb_build_object('day_id', d.id, 'status', (SELECT status FROM labour_days WHERE id = d.id), 'mismatches', v_mis,
                            'workers', (SELECT count(*) FROM labour_day_workers WHERE day_id = d.id));
END $f$;

-- Operations' review: lock a sent day, or send it back.
CREATE OR REPLACE FUNCTION public.labour_day_lock(p_day uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE d labour_days%ROWTYPE;
BEGIN
  IF NOT labour_day_is_approver() THEN RAISE EXCEPTION 'Operations locks the day after review'; END IF;
  SELECT * INTO d FROM labour_days WHERE id = p_day FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Day not found — refresh'; END IF;
  IF d.status <> 'submitted' THEN RAISE EXCEPTION 'Only a sent day can be locked'; END IF;
  IF labour_day_mismatches(d.id) > 0 THEN RAISE EXCEPTION 'This day doesn''t add up — send it back to the PM'; END IF;
  UPDATE labour_days SET status = 'locked', locked_at = now(), locked_by = auth.uid(),
         locked_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()), review_note = NULLIF(btrim(p_note), '')
   WHERE id = p_day;
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
  IF EXISTS (SELECT 1 FROM labour_day_workers WHERE day_id = d.id AND pay_run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Pay for this day is already confirmed — reopen that pay first';
  END IF;
  IF d.status = 'locked' THEN
    INSERT INTO labour_day_changes (day_id, kind, changed_by, changed_by_name, reason, before)
    VALUES (d.id, 'unlock', auth.uid(), v_name, btrim(p_reason), labour_day_snapshot(d.id));
  END IF;
  UPDATE labour_days SET status = 'open', locked_at = NULL, locked_by = NULL, locked_by_name = NULL,
         review_note = btrim(p_reason)
   WHERE id = p_day;
END $f$;

-- Every PM's day in a range, for review and the flags: what was asked,
-- what was recorded, and whether it adds up.
CREATE OR REPLACE FUNCTION public.labour_day_board(p_from date, p_to date)
RETURNS TABLE(pm_staff_id uuid, pm_name text, work_date date, day_id uuid, status text, workers integer, paid_days numeric,
              allocated_days numeric, mismatched integer, request_id uuid, request_code text, request_status text, requested integer, changes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH keys AS (
    SELECT d.pm_staff_id, d.work_date FROM labour_days d WHERE d.work_date BETWEEN p_from AND p_to
    UNION SELECT r.pm_staff_id, r.work_date FROM labour_day_requests r WHERE r.work_date BETWEEN p_from AND p_to AND r.status <> 'draft'
  )
  SELECT k.pm_staff_id, s.employee_name, k.work_date, d.id, COALESCE(d.status, 'none'),
         (SELECT count(*)::int FROM labour_day_workers w WHERE w.day_id = d.id),
         (SELECT COALESCE(sum(w.paid_days), 0) FROM labour_day_workers w WHERE w.day_id = d.id),
         (SELECT COALESCE(sum(a.days), 0) FROM labour_day_allocations a WHERE a.day_id = d.id),
         CASE WHEN d.id IS NULL THEN 0 ELSE labour_day_mismatches(d.id) END,
         r.id, r.code, r.status,
         (SELECT COALESCE(sum(l.headcount), 0)::int FROM labour_day_request_lines l WHERE l.request_id = r.id),
         (SELECT count(*)::int FROM labour_day_changes c WHERE c.day_id = d.id)
    FROM keys k
    JOIN staff s ON s.id = k.pm_staff_id
    LEFT JOIN labour_days d ON d.pm_staff_id = k.pm_staff_id AND d.work_date = k.work_date
    LEFT JOIN labour_day_requests r ON r.pm_staff_id = k.pm_staff_id AND r.work_date = k.work_date
   WHERE labour_day_can_see(k.pm_staff_id)
   ORDER BY k.work_date DESC, s.employee_name;
$f$;

-- From the start date, day-rate workers come through the daily request and
-- the day sheet, not a work order's labour request. Volume, fixed-price and
-- crew-leader labour stays on work orders. A project whose costing is closed
-- takes no more labour.
CREATE OR REPLACE FUNCTION public.trg_labour_request_day_rate_moved()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE v_start date := (SELECT starts_on FROM labour_day_settings WHERE id);
BEGIN
  IF v_start IS NOT NULL AND NEW.payment_basis = 'per_day' AND NEW.payment_model = 'individual'
     AND COALESCE(NEW.start_date, bot_today()) >= v_start THEN
    RAISE EXCEPTION 'From %, day-rate workers are asked for in the daily labour request (Labour → Daily request). Work orders keep volume and fixed-price labour.',
      to_char(v_start, 'DD Mon YYYY');
  END IF;
  IF (SELECT costing_closed_at FROM projects WHERE id = NEW.project_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Costing on this project is closed — no more labour can go to it';
  END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_labour_request_day_rate_moved BEFORE INSERT ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION trg_labour_request_day_rate_moved();

CREATE OR REPLACE FUNCTION public.trg_work_entry_day_rate_moved()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE v_start date := (SELECT starts_on FROM labour_day_settings WHERE id); r labor_requisitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = NEW.labor_requisition_id;
  IF v_start IS NOT NULL AND NEW.work_date >= v_start AND r.payment_basis = 'per_day' AND r.payment_model = 'individual' THEN
    RAISE EXCEPTION 'From %, day-rate work is recorded on the end-of-day sheet (Labour → Day sheet)', to_char(v_start, 'DD Mon YYYY');
  END IF;
  IF (SELECT costing_closed_at FROM projects WHERE id = NEW.project_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Costing on this project is closed — no more labour can be recorded on it';
  END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_work_entry_day_rate_moved BEFORE INSERT OR UPDATE OF work_date, hours, overtime_hours, quantity, percent_done ON labour_work_entries
  FOR EACH ROW EXECUTE FUNCTION trg_work_entry_day_rate_moved();

-- The per-job day screen stops offering day-rate workers from the start date.
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
      AND NOT (r.payment_basis = 'per_day' AND r.payment_model = 'individual'
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

-- Two records on day sheets for the same date are two people (486).
CREATE OR REPLACE FUNCTION public.workers_overlap(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM labor_expense_workers x JOIN labor_expense_workers y ON y.expense_id = x.expense_id
                  WHERE x.staff_id = p_a AND y.staff_id = p_b)
      OR EXISTS (SELECT 1 FROM labour_work_entries x JOIN labour_work_entries y ON y.work_date = x.work_date
                  WHERE x.staff_id = p_a AND y.staff_id = p_b)
      OR EXISTS (SELECT 1 FROM timesheet_attendance x JOIN timesheet_attendance y ON y.work_date = x.work_date
                  WHERE x.staff_id = p_a AND y.staff_id = p_b)
      OR EXISTS (SELECT 1 FROM labour_day_workers x JOIN labour_days dx ON dx.id = x.day_id
                   JOIN labour_days dy ON dy.work_date = dx.work_date JOIN labour_day_workers y ON y.day_id = dy.id
                  WHERE x.staff_id = p_a AND y.staff_id = p_b);
$function$;

REVOKE EXECUTE ON FUNCTION labour_day_snapshot(uuid), labour_day_mismatches(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION trg_labour_request_day_rate_moved(), trg_work_entry_day_rate_moved() FROM PUBLIC, anon, authenticated;
