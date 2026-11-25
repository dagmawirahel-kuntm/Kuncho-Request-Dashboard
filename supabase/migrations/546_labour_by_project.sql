-- 546 — labour belongs to the project, not the PM
--
-- Workers work on a project; the PM manages them. Until now the crew request,
-- the day sheet and the weekly pay were the PM's: when a project changed PM,
-- its labour stayed with the old one. Now each is the project's:
--
--   labour_days.project_id           one sheet per project per day
--   labour_day_requests.project_id   the project's standing crew
--   labour_day_pay_runs.project_id   a project's week of pay
--   labour_pay_requests.project_id   …and its request (LPR)
--
-- pm_staff_id stays on these rows as the project's PM, kept in step by a
-- trigger: when a project gets a new PM, its days, crew and unsent pay move
-- to them. Every sheet function now takes the project.

SET LOCAL check_function_bodies = off;

-- ── 1. Who runs a project's labour ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.labour_project_pm(p_project uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT project_manager_id FROM projects WHERE id = p_project;
$f$;

CREATE OR REPLACE FUNCTION public.labour_project_can_run(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p_project IS NOT NULL AND (labour_day_is_approver()
         OR (current_staff_id() IS NOT NULL AND current_staff_id() = labour_project_pm(p_project))
         OR COALESCE(manages_project(p_project), false));
$f$;

CREATE OR REPLACE FUNCTION public.labour_project_can_see(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT labour_project_can_run(p_project) OR COALESCE(get_user_role()::text IN ('finance', 'executive'), false);
$f$;

-- Projects whose labour this person runs (for the pickers).
CREATE OR REPLACE FUNCTION public.labour_my_projects()
RETURNS TABLE(project_id uuid, project_name text, pm_staff_id uuid, pm_name text, internal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p.id, btrim(p.project_name), p.project_manager_id, btrim(st.employee_name), COALESCE(p.is_internal, false)
    FROM projects p LEFT JOIN staff st ON st.id = p.project_manager_id
   WHERE p.costing_closed_at IS NULL AND labour_project_can_see(p.id)
     AND (COALESCE(p.active_for_year, true) OR EXISTS (SELECT 1 FROM labour_days d WHERE d.project_id = p.id AND d.work_date >= bot_today() - 60))
     AND (NOT COALESCE(p.is_internal, false) OR p.id IN (SELECT unnest(ARRAY[s.workshop_project_id, s.stock_project_id, s.idle_project_id]) FROM labour_day_settings s))
   ORDER BY COALESCE(p.is_internal, false), btrim(p.project_name);
$f$;

-- ── 2. The columns ──────────────────────────────────────────────────────────
ALTER TABLE public.labour_days ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.labour_day_requests ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.labour_day_pay_runs ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.labour_pay_requests ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.labour_days DROP CONSTRAINT IF EXISTS labour_days_pm_staff_id_work_date_key;
ALTER TABLE public.labour_day_requests DROP CONSTRAINT IF EXISTS labour_day_requests_pm_staff_id_work_date_key;

-- ── 3. Each day sheet becomes one per project ───────────────────────────────
-- Where each worker's day went (no worker is split across projects), and each
-- piece job's project.
CREATE TEMP TABLE m546_worker ON COMMIT DROP AS
SELECT w.day_id, w.staff_id,
       (SELECT a.project_id FROM labour_day_allocations a WHERE a.day_id = w.day_id AND a.staff_id = w.staff_id AND a.bucket IN ('build', 'repair')
         ORDER BY a.days DESC LIMIT 1) AS project_id
  FROM labour_day_workers w;
CREATE TEMP TABLE m546_job ON COMMIT DROP AS
SELECT DISTINCT x.day_id, r.id AS requisition_id, r.project_id FROM (
  SELECT c.day_id, c.labor_requisition_id FROM labour_day_job_crew c
  UNION SELECT e.labour_day_id, e.labor_requisition_id FROM labour_work_entries e WHERE e.labour_day_id IS NOT NULL) x
  JOIN labor_requisitions r ON r.id = x.labor_requisition_id;
-- The day's own project: where most of its workers went; else its first piece job's; else the PM's project.
UPDATE public.labour_days d SET project_id = COALESCE(
  (SELECT mw.project_id FROM m546_worker mw WHERE mw.day_id = d.id AND mw.project_id IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1),
  (SELECT mj.project_id FROM m546_job mj WHERE mj.day_id = d.id ORDER BY 1 LIMIT 1),
  (SELECT p.id FROM projects p WHERE p.project_manager_id = d.pm_staff_id AND NOT COALESCE(p.is_internal, false) ORDER BY p.created_at LIMIT 1))
 WHERE d.project_id IS NULL;
-- A sheet for each other project the day covered, with the same state…
CREATE TEMP TABLE m546_split ON COMMIT DROP AS
SELECT y.from_day, y.project_id, gen_random_uuid() AS new_day FROM (
  SELECT DISTINCT d.id AS from_day, x.project_id
    FROM labour_days d
    JOIN (SELECT day_id, project_id FROM m546_worker WHERE project_id IS NOT NULL UNION SELECT day_id, project_id FROM m546_job) x ON x.day_id = d.id
   WHERE x.project_id <> d.project_id) y;
INSERT INTO public.labour_days (id, pm_staff_id, project_id, work_date, status, saved_at, saved_by, saved_by_name, submitted_at, submitted_by_name,
                                locked_at, locked_by, locked_by_name, review_note, created_at)
SELECT s.new_day, d.pm_staff_id, s.project_id, d.work_date, d.status, d.saved_at, d.saved_by, d.saved_by_name, d.submitted_at, d.submitted_by_name,
       d.locked_at, d.locked_by, d.locked_by_name, d.review_note, d.created_at
  FROM m546_split s JOIN labour_days d ON d.id = s.from_day;
-- …and its workers, their columns, and its piece jobs move there.
-- (Only the sheet they sit on changes — project and date stay — so the triggers that react to new work are paused.)
ALTER TABLE public.labour_work_entries DISABLE TRIGGER trg_work_entry_starts_order;
ALTER TABLE public.labour_day_allocations DISABLE TRIGGER trg_zz_salary_allocation_days;
UPDATE public.labour_day_allocations a SET day_id = s.new_day
  FROM m546_split s, m546_worker mw
 WHERE a.day_id = s.from_day AND mw.day_id = s.from_day AND mw.staff_id = a.staff_id AND mw.project_id = s.project_id;
UPDATE public.labour_day_workers w SET day_id = s.new_day
  FROM m546_split s, m546_worker mw
 WHERE w.day_id = s.from_day AND mw.day_id = s.from_day AND mw.staff_id = w.staff_id AND mw.project_id = s.project_id;
UPDATE public.labour_day_job_crew c SET day_id = s.new_day
  FROM m546_split s, m546_job mj
 WHERE c.day_id = s.from_day AND mj.day_id = s.from_day AND mj.requisition_id = c.labor_requisition_id AND mj.project_id = s.project_id;
UPDATE public.labour_work_entries e SET labour_day_id = s.new_day
  FROM m546_split s, m546_job mj
 WHERE e.labour_day_id = s.from_day AND mj.day_id = s.from_day AND mj.requisition_id = e.labor_requisition_id AND mj.project_id = s.project_id;
ALTER TABLE public.labour_work_entries ENABLE TRIGGER trg_work_entry_starts_order;
ALTER TABLE public.labour_day_allocations ENABLE TRIGGER trg_zz_salary_allocation_days;

-- Where each PM's crew worked over the last three weeks, by trade and project
-- (taken before the sheets move to the projects' PMs).
CREATE TEMP TABLE m546_share ON COMMIT DROP AS
SELECT d.pm_staff_id AS old_pm, s.trade_tag, d.project_id, count(*)::numeric AS n
  FROM labour_days d JOIN labour_day_workers w ON w.day_id = d.id JOIN staff s ON s.id = w.staff_id
 WHERE d.work_date >= bot_today() - 21
 GROUP BY 1, 2, 3;

-- Each project's sheet sits with the project's PM.
UPDATE public.labour_days d SET pm_staff_id = p.project_manager_id
  FROM projects p WHERE p.id = d.project_id AND p.project_manager_id IS NOT NULL AND d.pm_staff_id IS DISTINCT FROM p.project_manager_id;
ALTER TABLE public.labour_days ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.labour_days ADD CONSTRAINT labour_days_project_work_date_key UNIQUE (project_id, work_date);
CREATE INDEX IF NOT EXISTS labour_days_project_idx ON public.labour_days (project_id, work_date);

-- ── 4. Crew requests become the project's ───────────────────────────────────
-- A PM whose crew worked on one project: that project. On several: the crew is
-- shared out by where each trade worked (each trade's total stays the same).
-- No sheets at all: the one project they manage. Otherwise it stays on file,
-- on no project.
CREATE TEMP TABLE m546_req_proj ON COMMIT DROP AS
SELECT r.id AS req, sh.project_id, sum(sh.n) AS tot
  FROM labour_day_requests r JOIN m546_share sh ON sh.old_pm = r.pm_staff_id GROUP BY 1, 2;
UPDATE public.labour_day_requests r
   SET project_id = (SELECT x.project_id FROM m546_req_proj x WHERE x.req = r.id ORDER BY x.tot DESC, x.project_id LIMIT 1)
 WHERE r.project_id IS NULL;
UPDATE public.labour_day_requests r
   SET project_id = (SELECT p.id FROM projects p WHERE p.project_manager_id = r.pm_staff_id AND NOT COALESCE(p.is_internal, false) AND p.costing_closed_at IS NULL)
 WHERE r.project_id IS NULL
   AND (SELECT count(*) FROM projects p WHERE p.project_manager_id = r.pm_staff_id AND NOT COALESCE(p.is_internal, false) AND p.costing_closed_at IS NULL) = 1;

CREATE TEMP TABLE m546_lines ON COMMIT DROP AS
WITH multi AS (SELECT req FROM m546_req_proj GROUP BY req HAVING count(*) > 1),
l AS (SELECT l.request_id AS req, l.trade_tag, l.headcount AS h, r.pm_staff_id AS old_pm
        FROM labour_day_request_lines l JOIN labour_day_requests r ON r.id = l.request_id WHERE l.request_id IN (SELECT req FROM multi)),
sh AS (SELECT l.req, l.trade_tag, l.h, x.project_id, x.tot,
              COALESCE((SELECT s.n FROM m546_share s WHERE s.old_pm = l.old_pm AND s.trade_tag IS NOT DISTINCT FROM l.trade_tag AND s.project_id = x.project_id), 0) AS n_tr
         FROM l JOIN m546_req_proj x ON x.req = l.req),
w AS (SELECT sh.*, CASE WHEN sum(n_tr) OVER (PARTITION BY req, trade_tag) > 0 THEN n_tr / sum(n_tr) OVER (PARTITION BY req, trade_tag)
                        ELSE tot / sum(tot) OVER (PARTITION BY req, trade_tag) END AS share FROM sh),
b AS (SELECT w.*, floor(h * share) AS base, h * share - floor(h * share) AS frac FROM w),
rr AS (SELECT b.*, h - sum(base) OVER (PARTITION BY req, trade_tag) AS rem,
              row_number() OVER (PARTITION BY req, trade_tag ORDER BY frac DESC, share DESC, project_id) AS rn FROM b)
SELECT req, trade_tag, project_id, (base + CASE WHEN rn <= rem THEN 1 ELSE 0 END)::int AS headcount FROM rr;

CREATE TEMP TABLE m546_req_split ON COMMIT DROP AS
SELECT x.req, x.project_id, gen_random_uuid() AS new_req FROM (
  SELECT DISTINCT r.id AS req, ml.project_id
    FROM labour_day_requests r JOIN m546_lines ml ON ml.req = r.id WHERE ml.project_id <> r.project_id AND ml.headcount > 0) x;
INSERT INTO public.labour_day_requests (id, code, pm_staff_id, project_id, work_date, ends_on, weekdays, status, note, created_by, created_by_name,
                                        submitted_at, decided_by, decided_by_name, decided_at, decision_note, created_at, updated_at)
SELECT s.new_req, 'LDR-' || to_char(r.work_date, 'YYYY') || '-' || lpad(nextval('labour_day_request_seq')::text, 4, '0'),
       r.pm_staff_id, s.project_id, r.work_date, r.ends_on, r.weekdays, r.status,
       concat_ws(' ', r.note, '(Split from ' || r.code || ' when crews moved to projects.)'),
       r.created_by, r.created_by_name, r.submitted_at, r.decided_by, r.decided_by_name, r.decided_at, r.decision_note, r.created_at, now()
  FROM m546_req_split s JOIN labour_day_requests r ON r.id = s.req;
DELETE FROM public.labour_day_request_lines l WHERE l.request_id IN (SELECT req FROM m546_req_split);
INSERT INTO public.labour_day_request_lines (request_id, trade_tag, headcount)
SELECT COALESCE(s.new_req, ml.req), ml.trade_tag, ml.headcount
  FROM m546_lines ml
  JOIN labour_day_requests r ON r.id = ml.req
  LEFT JOIN m546_req_split s ON s.req = ml.req AND s.project_id = ml.project_id
 WHERE ml.headcount > 0 AND (s.new_req IS NOT NULL OR ml.project_id = r.project_id);

-- Two crews for one project starting the same day: the bigger stays; the other stays on file, on no project.
UPDATE public.labour_day_requests r SET project_id = NULL
 WHERE r.project_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM labour_day_requests o WHERE o.project_id = r.project_id AND o.work_date = r.work_date AND o.id <> r.id
      AND ((SELECT COALESCE(sum(headcount), 0) FROM labour_day_request_lines WHERE request_id = o.id),  o.id::text)
        > ((SELECT COALESCE(sum(headcount), 0) FROM labour_day_request_lines WHERE request_id = r.id), r.id::text));
UPDATE public.labour_day_requests r SET pm_staff_id = p.project_manager_id
  FROM projects p WHERE p.id = r.project_id AND p.project_manager_id IS NOT NULL AND r.pm_staff_id IS DISTINCT FROM p.project_manager_id;
CREATE UNIQUE INDEX IF NOT EXISTS labour_day_requests_project_date_key ON public.labour_day_requests (project_id, work_date) WHERE project_id IS NOT NULL;

-- ── 5. A new PM takes over the project's labour ─────────────────────────────
-- Days, crew and unsent pay move to them; pay already sent or paid stays as
-- signed.
CREATE OR REPLACE FUNCTION public.trg_project_pm_labour()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.project_manager_id IS NOT NULL AND NEW.project_manager_id IS DISTINCT FROM OLD.project_manager_id THEN
    UPDATE labour_days SET pm_staff_id = NEW.project_manager_id WHERE project_id = NEW.id;
    UPDATE labour_day_requests SET pm_staff_id = NEW.project_manager_id WHERE project_id = NEW.id;
    UPDATE labour_day_pay_runs SET pm_staff_id = NEW.project_manager_id WHERE project_id = NEW.id;
    UPDATE labour_pay_requests SET prepared_for = NEW.project_manager_id, updated_at = now()
     WHERE project_id = NEW.id AND status IN ('draft', 'returned');
  END IF;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS trg_project_pm_labour ON public.projects;
CREATE TRIGGER trg_project_pm_labour AFTER UPDATE OF project_manager_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.trg_project_pm_labour();

-- Pay already made: a run (and its request) covering one project is that project's.
UPDATE public.labour_day_pay_runs r SET project_id = x.project_id
  FROM (SELECT w.pay_run_id, min(d.project_id::text)::uuid AS project_id FROM labour_day_workers w JOIN labour_days d ON d.id = w.day_id
         WHERE w.pay_run_id IS NOT NULL GROUP BY 1 HAVING count(DISTINCT d.project_id) = 1) x
 WHERE x.pay_run_id = r.id AND r.project_id IS NULL;

-- ── 6. The day sheet, by project ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.labour_day_pay_request(uuid, date, text);
DROP FUNCTION IF EXISTS public.labour_day_pay_preview(uuid, date);
DROP FUNCTION IF EXISTS public.labour_week_save(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.labour_day_save(uuid, date, jsonb, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.labour_day_get(uuid, date);
DROP FUNCTION IF EXISTS public.labour_day_jobs(uuid, date);
DROP FUNCTION IF EXISTS public.labour_day_projects(uuid, date);
DROP FUNCTION IF EXISTS public.labour_day_expected(uuid, date);
DROP FUNCTION IF EXISTS public.labour_day_new_worker(uuid, text, text, numeric, text, text);

-- The project's crew in effect on a day.
CREATE OR REPLACE FUNCTION public.labour_day_expected(p_project uuid, p_date date)
RETURNS TABLE(request_id uuid, works boolean, headcount integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT r.id, extract(isodow FROM p_date)::smallint = ANY (r.weekdays),
         CASE WHEN extract(isodow FROM p_date)::smallint = ANY (r.weekdays)
              THEN (SELECT COALESCE(sum(l.headcount), 0)::int FROM labour_day_request_lines l WHERE l.request_id = r.id) ELSE 0 END
    FROM labour_day_requests r
   WHERE r.project_id = p_project AND r.status = 'approved' AND r.work_date <= p_date AND (r.ends_on IS NULL OR r.ends_on >= p_date)
   ORDER BY r.work_date DESC
   LIMIT 1;
$f$;

-- The project's open piece jobs on a day, with who is on each crew.
CREATE OR REPLACE FUNCTION public.labour_day_jobs(p_project uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE d labour_days%ROWTYPE; v_src uuid; v jsonb;
BEGIN
  IF NOT labour_project_can_see(p_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO d FROM labour_days WHERE project_id = p_project AND work_date = p_date;
  -- Crew ticks start as the last day recorded on this project.
  v_src := CASE WHEN d.saved_at IS NOT NULL THEN d.id
                ELSE (SELECT x.id FROM labour_days x WHERE x.project_id = p_project AND x.work_date < p_date
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
         ORDER BY r.role_needed), '[]'::jsonb)
    INTO v
    FROM labor_requisitions r
    JOIN projects p ON p.id = r.project_id
    LEFT JOIN work_orders w ON w.id = r.work_order_id
    LEFT JOIN vendors v ON v.id = r.gang_leader_vendor_id
   WHERE r.payment_basis IN ('per_volume', 'fixed_price') AND r.project_id = p_project
     AND (EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.labour_day_id = d.id)
          OR (r.status = 'approved' AND r.start_date <= p_date AND (r.closed_at IS NULL OR (r.closed_at AT TIME ZONE 'Africa/Addis_Ababa')::date >= p_date)
              AND p.costing_closed_at IS NULL
              AND NOT (r.payment_basis = 'fixed_price'
                       AND (SELECT COALESCE(sum(e.percent_done), 0) FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.work_date < p_date) >= 100)));
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.labour_day_get(p_project uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s labour_day_settings%ROWTYPE; d labour_days%ROWTYPE; v_src labour_days%ROWTYPE; v_from uuid; v_prefill boolean := false; v jsonb;
  x record; pr projects%ROWTYPE;
BEGIN
  IF NOT labour_project_can_see(p_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO pr FROM projects WHERE id = p_project;
  SELECT * INTO s FROM labour_day_settings WHERE id;
  SELECT * INTO d FROM labour_days WHERE project_id = p_project AND work_date = p_date;
  IF d.id IS NOT NULL AND (d.saved_at IS NOT NULL OR EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id)) THEN
    v_from := d.id;
  ELSE
    SELECT y.* INTO v_src FROM labour_days y
     WHERE y.project_id = p_project AND y.work_date < p_date AND EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = y.id)
     ORDER BY y.work_date DESC LIMIT 1;
    v_from := v_src.id; v_prefill := v_src.id IS NOT NULL;
  END IF;
  SELECT * INTO x FROM labour_day_expected(p_project, p_date);

  SELECT jsonb_build_object(
    'project', jsonb_build_object('id', pr.id, 'name', btrim(pr.project_name), 'internal', COALESCE(pr.is_internal, false)),
    'pm', jsonb_build_object('id', pr.project_manager_id, 'name', (SELECT btrim(employee_name) FROM staff WHERE id = pr.project_manager_id)),
    'date', p_date,
    'starts_on', s.starts_on,
    'can_edit', labour_project_can_run(p_project) AND (d.id IS NULL OR d.status <> 'locked' OR labour_day_is_approver()),
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
                               WHERE w2.staff_id = w.staff_id AND d2.work_date = p_date AND d2.project_id <> p_project),
                'alloc', (SELECT COALESCE(jsonb_agg(jsonb_build_object('project_id', a.project_id, 'bucket', a.bucket, 'days', a.days)), '[]'::jsonb)
                            FROM labour_day_allocations a JOIN projects p ON p.id = a.project_id
                           WHERE a.day_id = w.day_id AND a.staff_id = w.staff_id
                             AND (NOT v_prefill OR p.costing_closed_at IS NULL)))
              ORDER BY st.employee_name)
         FROM labour_day_workers w JOIN staff st ON st.id = w.staff_id
        WHERE w.day_id = v_from
          AND (NOT v_prefill OR (st.employment_type = 'tier_2_casual' AND COALESCE(st.status, 'active') = 'active'))), '[]'::jsonb),
    -- A project's sheet takes its own build and repair columns (none for an internal project).
    'projects', CASE WHEN COALESCE(pr.is_internal, false) THEN '[]'::jsonb
                     ELSE jsonb_build_array(jsonb_build_object('id', pr.id, 'name', btrim(pr.project_name), 'mine', true, 'delivered', pr.delivered_at IS NOT NULL)) END,
    'buckets', jsonb_build_object(
       'workshop', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.workshop_project_id),
       'stock', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.stock_project_id),
       'idle', (SELECT jsonb_build_object('id', id, 'name', project_name) FROM projects WHERE id = s.idle_project_id)),
    'request', (SELECT jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'decided_by_name', r.decided_by_name, 'decision_note', r.decision_note,
                  'starts_on', r.work_date, 'ends_on', r.ends_on, 'weekdays', r.weekdays, 'works_today', x.works,
                  'lines', CASE WHEN x.works THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('trade', l.trade_tag, 'headcount', l.headcount)), '[]'::jsonb)
                                                     FROM labour_day_request_lines l WHERE l.request_id = r.id) ELSE '[]'::jsonb END)
                  FROM labour_day_requests r WHERE r.id = x.request_id),
    'jobs', labour_day_jobs(p_project, p_date))
  INTO v;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.labour_day_save(p_project uuid, p_date date, p_workers jsonb, p_submit boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_jobs jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s labour_day_settings%ROWTYPE; d labour_days%ROWTYPE; st staff%ROWTYPE; p projects%ROWTYPE; pr projects%ROWTYPE; r labor_requisitions%ROWTYPE;
  w jsonb; a jsonb; j jsonb; v_staff uuid; v_paid numeric; v_other numeric; v_ot numeric; v_night numeric;
  v_bucket text; v_days numeric; v_proj uuid; v_before jsonb; v_mis int; v_seen uuid[] := '{}'; v_jobs_seen uuid[] := '{}';
  v_allowed uuid[]; v_qty numeric; v_pct numeric; v_before_pct numeric; v_has_jobs boolean; v_pm uuid; v_elsewhere text;
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT labour_project_can_run(p_project) THEN RAISE EXCEPTION 'You record the day for the projects you manage'; END IF;
  SELECT * INTO pr FROM projects WHERE id = p_project;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'Project not found — refresh the page'; END IF;
  IF pr.costing_closed_at IS NOT NULL THEN RAISE EXCEPTION 'Costing on % is closed — no more labour can go to it', pr.project_name; END IF;
  SELECT * INTO s FROM labour_day_settings WHERE id;
  IF s.starts_on IS NULL THEN RAISE EXCEPTION 'The day sheet hasn''t started yet — admin sets its start date'; END IF;
  IF p_date < s.starts_on THEN RAISE EXCEPTION 'Day sheets start on % — earlier days are recorded on their labour requests', to_char(s.starts_on, 'DD Mon YYYY'); END IF;
  IF p_date > bot_today() THEN RAISE EXCEPTION 'A day is recorded at its end — % hasn''t happened yet', to_char(p_date, 'DD Mon'); END IF;
  IF p_date < bot_today() - 60 AND NOT labour_day_is_approver() THEN RAISE EXCEPTION 'That is more than 60 days ago — ask operations to record it'; END IF;
  v_pm := COALESCE(pr.project_manager_id, current_staff_id());
  IF v_pm IS NULL THEN RAISE EXCEPTION '% has no PM — set the project''s PM first', pr.project_name; END IF;

  INSERT INTO labour_days (project_id, pm_staff_id, work_date) VALUES (p_project, v_pm, p_date) ON CONFLICT (project_id, work_date) DO NOTHING;
  SELECT * INTO d FROM labour_days WHERE project_id = p_project AND work_date = p_date FOR UPDATE;
  IF labour_day_is_paid(d.id) THEN RAISE EXCEPTION 'Pay for this day is already confirmed — undo that week''s pay first'; END IF;
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
    SELECT COALESCE(sum(w2.paid_days), 0), string_agg(DISTINCT btrim(p2.project_name), ', ') INTO v_other, v_elsewhere
      FROM labour_day_workers w2 JOIN labour_days d2 ON d2.id = w2.day_id JOIN projects p2 ON p2.id = d2.project_id
     WHERE w2.staff_id = v_staff AND d2.work_date = p_date AND d2.id <> d.id;
    IF v_other + v_paid > 1 THEN
      RAISE EXCEPTION '% is already on the % sheet for % day on % — nobody is paid more than one day', st.employee_name, v_elsewhere, trim_scale(v_other), to_char(p_date, 'DD Mon');
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
        IF p.id <> p_project THEN
          RAISE EXCEPTION '%: a day on % goes on % own sheet', st.employee_name, btrim(p.project_name), btrim(p.project_name);
        END IF;
        IF COALESCE(p.is_internal, false) THEN
          RAISE EXCEPTION '% is internal — use Workshop maintenance, Stock fixture production or General / idle', p.project_name;
        END IF;
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
  SELECT array_agg((x->>'id')::uuid) INTO v_allowed FROM jsonb_array_elements(labour_day_jobs(p_project, p_date)) x;
  DELETE FROM labour_day_job_crew WHERE day_id = d.id;
  DELETE FROM labour_work_entries WHERE labour_day_id = d.id AND pay_sheet_id IS NULL;
  FOR j IN SELECT * FROM jsonb_array_elements(COALESCE(p_jobs, '[]'::jsonb)) LOOP
    SELECT * INTO r FROM labor_requisitions WHERE id = NULLIF(j->>'id', '')::uuid;
    IF r.id IS NULL OR r.payment_basis NOT IN ('per_volume', 'fixed_price') THEN RAISE EXCEPTION 'A piece job on this sheet no longer exists — refresh the page'; END IF;
    IF NOT (r.id = ANY (COALESCE(v_allowed, '{}'))) THEN RAISE EXCEPTION '% isn''t one of this project''s open piece jobs on %', r.role_needed, to_char(p_date, 'DD Mon'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.labour_week_save(p_project uuid, p_days jsonb, p_submit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE x jsonb; v_date date; v_res jsonb; v_out jsonb := '[]'::jsonb; v_mis int := 0;
BEGIN
  IF NOT labour_project_can_run(p_project) THEN RAISE EXCEPTION 'You record the week for the projects you manage'; END IF;
  IF jsonb_array_length(COALESCE(p_days, '[]'::jsonb)) > 7 THEN RAISE EXCEPTION 'A week has at most 7 days'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb)) LOOP
    v_date := (x->>'date')::date;
    BEGIN
      v_res := labour_day_save(p_project, v_date, COALESCE(x->'workers', '[]'::jsonb), p_submit, NULL, COALESCE(x->'jobs', '[]'::jsonb));
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%: %', to_char(v_date, 'Dy DD Mon'), SQLERRM;
    END;
    v_mis := v_mis + COALESCE((v_res->>'mismatches')::int, 0);
    v_out := v_out || jsonb_build_object('date', v_date, 'status', v_res->>'status', 'mismatches', v_res->'mismatches');
  END LOOP;
  RETURN jsonb_build_object('days', v_out, 'mismatches', v_mis);
END $function$;

CREATE OR REPLACE FUNCTION public.labour_day_new_worker(p_project uuid, p_name text, p_trade text, p_day_rate numeric, p_phone text DEFAULT NULL::text, p_photo text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_photo text := CASE WHEN p_photo ~ '^https://' THEN btrim(p_photo) END;
  v_rate numeric := NULLIF(p_day_rate, 0);
  v_me text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  s staff%ROWTYPE;
BEGIN
  IF NOT labour_project_can_run(p_project) THEN RAISE EXCEPTION 'You add workers to the projects you manage'; END IF;
  IF (SELECT starts_on FROM labour_day_settings WHERE id) IS NULL THEN RAISE EXCEPTION 'The day sheet hasn''t started yet'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Give the worker''s full name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tier2_trade_roster WHERE trade_tag = p_trade) THEN RAISE EXCEPTION 'Pick their trade'; END IF;
  IF v_rate < 0 THEN RAISE EXCEPTION 'A day rate is more than 0'; END IF;
  IF v_phone IS NOT NULL AND length(regexp_replace(v_phone, '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'That phone number looks too short'; END IF;
  IF v_phone IS NOT NULL THEN
    SELECT * INTO s FROM staff WHERE regexp_replace(COALESCE(phone_number, ''), '[^0-9+]', '', 'g') = v_phone ORDER BY (status = 'active') DESC LIMIT 1;
    IF s.id IS NOT NULL THEN
      IF COALESCE(s.employment_type, '') <> 'tier_2_casual' THEN
        RAISE EXCEPTION 'That phone belongs to % (%), who isn''t a casual worker', s.employee_name, COALESCE(s.employment_type, 'staff');
      END IF;
      UPDATE staff SET status = 'active', day_rate = COALESCE(NULLIF(day_rate, 0), v_rate), trade_tag = COALESCE(trade_tag, p_trade),
             photo_url = COALESCE(photo_url, v_photo), last_engaged_at = CURRENT_DATE, updated_at = now()
       WHERE id = s.id RETURNING * INTO s;
      RETURN jsonb_build_object('staff_id', s.id, 'name', s.employee_name, 'existing', true, 'day_rate', s.day_rate, 'trade', s.trade_tag);
    END IF;
  END IF;
  INSERT INTO staff (employee_name, phone_number, employment_type, status, trade_tag, day_rate, payment_frequency,
                     first_engaged_at, last_engaged_at, photo_url, details_by, details_by_name, details_at)
  VALUES (btrim(p_name), v_phone, 'tier_2_casual', 'active', p_trade, v_rate, 'Daily', CURRENT_DATE, CURRENT_DATE, v_photo, auth.uid(), v_me, now())
  RETURNING * INTO s;
  RETURN jsonb_build_object('staff_id', s.id, 'name', s.employee_name, 'existing', false, 'day_rate', s.day_rate, 'trade', s.trade_tag);
END $function$;

-- ── 7. Review board and flags: one row per project per day ──────────────────
DROP FUNCTION IF EXISTS public.labour_day_board(date, date);
CREATE OR REPLACE FUNCTION public.labour_day_board(p_from date, p_to date)
RETURNS TABLE(pm_staff_id uuid, pm_name text, work_date date, day_id uuid, status text, workers integer, paid_days numeric,
              allocated_days numeric, mismatched integer, request_id uuid, request_code text, request_status text, requested integer, changes integer,
              jobs integer, project_id uuid, project_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH s AS (SELECT starts_on FROM labour_day_settings WHERE id),
  keys AS (
    SELECT d.project_id, d.work_date FROM labour_days d WHERE d.work_date BETWEEN p_from AND p_to
    UNION SELECT r.project_id, r.work_date FROM labour_day_requests r
           WHERE r.project_id IS NOT NULL AND r.work_date BETWEEN p_from AND p_to AND r.status IN ('submitted', 'rejected')
    -- Days the standing crew was expected, up to today.
    UNION SELECT pj.project_id, g::date
      FROM (SELECT DISTINCT r.project_id FROM labour_day_requests r WHERE r.status = 'approved' AND r.project_id IS NOT NULL) pj
      CROSS JOIN s
      CROSS JOIN generate_series(GREATEST(p_from, s.starts_on), LEAST(p_to, bot_today()), interval '1 day') g
     WHERE s.starts_on IS NOT NULL AND (SELECT e.headcount FROM labour_day_expected(pj.project_id, g::date) e) > 0
  )
  SELECT p.project_manager_id, btrim(st.employee_name), k.work_date, d.id, COALESCE(d.status, 'none'),
         (SELECT count(*)::int FROM labour_day_workers w WHERE w.day_id = d.id),
         (SELECT COALESCE(sum(w.paid_days), 0) FROM labour_day_workers w WHERE w.day_id = d.id),
         (SELECT COALESCE(sum(a.days), 0) FROM labour_day_allocations a WHERE a.day_id = d.id),
         CASE WHEN d.id IS NULL THEN 0 ELSE labour_day_mismatches(d.id) END,
         r.id, r.code, r.status,
         CASE WHEN r.id = e.request_id THEN e.headcount
              ELSE (SELECT COALESCE(sum(l.headcount), 0)::int FROM labour_day_request_lines l WHERE l.request_id = r.id) END,
         (SELECT count(*)::int FROM labour_day_changes c WHERE c.day_id = d.id),
         (SELECT count(DISTINCT x.rid)::int FROM (SELECT c.labor_requisition_id AS rid FROM labour_day_job_crew c WHERE c.day_id = d.id
                                                  UNION SELECT le.labor_requisition_id FROM labour_work_entries le WHERE le.labour_day_id = d.id) x),
         k.project_id, btrim(p.project_name)
    FROM keys k
    JOIN projects p ON p.id = k.project_id
    LEFT JOIN staff st ON st.id = p.project_manager_id
    LEFT JOIN labour_days d ON d.project_id = k.project_id AND d.work_date = k.work_date
    LEFT JOIN LATERAL (SELECT * FROM labour_day_expected(k.project_id, k.work_date)) e ON true
    LEFT JOIN labour_day_requests r ON r.id = COALESCE(
         (SELECT q.id FROM labour_day_requests q WHERE q.project_id = k.project_id AND q.work_date = k.work_date AND q.status IN ('submitted', 'rejected')),
         e.request_id)
   WHERE labour_project_can_see(k.project_id)
   ORDER BY k.work_date DESC, btrim(p.project_name);
$f$;

CREATE OR REPLACE FUNCTION public.labour_flags()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    'day_mismatches', COALESCE((SELECT jsonb_agg(jsonb_build_object('pm_staff_id', b.pm_staff_id, 'pm', b.pm_name, 'project_id', b.project_id, 'project', b.project_name,
                          'date', b.work_date, 'status', b.status,
                          'why', CASE WHEN b.mismatched > 0 THEN format('%s worker%s don''t add up', b.mismatched, CASE WHEN b.mismatched = 1 THEN '' ELSE 's' END)
                                      WHEN b.status = 'none' OR (b.workers = 0 AND b.jobs = 0) THEN format('%s asked for, nothing recorded by %s', b.requested, to_char(labour_day_due(b.work_date), 'Dy DD Mon'))
                                      WHEN b.status = 'open' THEN format('Not sent by %s', to_char(labour_day_due(b.work_date), 'Dy DD Mon'))
                                      ELSE 'Sent, not reviewed yet' END) ORDER BY b.work_date DESC, b.project_name)
                        FROM board b
                       WHERE (v_all OR b.pm_staff_id = v_me)
                         AND ((b.mismatched > 0 AND (b.status = 'submitted' OR labour_day_due(b.work_date) < bot_today()))
                              OR (labour_day_due(b.work_date) < bot_today() AND b.request_status = 'approved' AND b.requested > 0 AND (b.status = 'none' OR (b.workers = 0 AND b.jobs = 0)))
                              OR (labour_day_due(b.work_date) < bot_today() AND b.status = 'open' AND (b.workers > 0 OR b.jobs > 0))
                              OR (b.status = 'submitted' AND labour_day_due(b.work_date) < bot_today() - 1))), '[]'::jsonb),
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
END $function$;

-- ── 8. Crew requests, by project ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.labour_day_request_save(uuid, date, jsonb, text, boolean, date, smallint[]);
CREATE OR REPLACE FUNCTION public.labour_day_request_save(p_project uuid, p_date date, p_lines jsonb, p_note text DEFAULT NULL::text, p_submit boolean DEFAULT false, p_ends_on date DEFAULT NULL::date, p_weekdays smallint[] DEFAULT '{1,2,3,4,5,6}'::smallint[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s labour_day_settings%ROWTYPE; r labour_day_requests%ROWTYPE; pr projects%ROWTYPE;
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  v_bad text; v_n int; v_days smallint[] := COALESCE(p_weekdays, '{1,2,3,4,5,6}'); v_pm uuid;
BEGIN
  IF NOT labour_project_can_run(p_project) THEN RAISE EXCEPTION 'You ask for the crew of the projects you manage'; END IF;
  SELECT * INTO pr FROM projects WHERE id = p_project;
  v_pm := COALESCE(pr.project_manager_id, current_staff_id());
  IF v_pm IS NULL THEN RAISE EXCEPTION '% has no PM — set the project''s PM first', pr.project_name; END IF;
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

  SELECT * INTO r FROM labour_day_requests WHERE project_id = p_project AND work_date = p_date FOR UPDATE;
  IF r.id IS NULL THEN
    INSERT INTO labour_day_requests (code, pm_staff_id, project_id, work_date, created_by, created_by_name)
    VALUES ('LDR-' || to_char(p_date, 'YYYY') || '-' || lpad(nextval('labour_day_request_seq')::text, 4, '0'), v_pm, p_project, p_date, auth.uid(), v_name)
    RETURNING * INTO r;
  END IF;
  DELETE FROM labour_day_request_lines WHERE request_id = r.id;
  INSERT INTO labour_day_request_lines (request_id, trade_tag, headcount)
  SELECT r.id, x->>'trade', sum((x->>'headcount')::int)
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) x
   WHERE COALESCE(NULLIF(x->>'headcount', '')::int, 0) > 0
   GROUP BY 2;
  SELECT COALESCE(sum(headcount), 0) INTO v_n FROM labour_day_request_lines WHERE request_id = r.id;
  UPDATE labour_day_requests
     SET note = NULLIF(btrim(p_note), ''), ends_on = p_ends_on, weekdays = (SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(v_days) d),
         status = CASE WHEN NOT p_submit THEN 'draft' WHEN v_n = 0 THEN 'approved' ELSE 'submitted' END,
         submitted_at = CASE WHEN p_submit THEN now() END,
         decided_by = NULL, decided_by_name = CASE WHEN p_submit AND v_n = 0 THEN v_name END,
         decided_at = CASE WHEN p_submit AND v_n = 0 THEN now() END,
         decision_note = CASE WHEN p_submit AND v_n = 0 THEN 'No crew from this day' WHEN r.status = 'rejected' THEN decision_note END,
         pm_staff_id = v_pm, updated_at = now()
   WHERE id = r.id;
  IF p_submit AND v_n > 0 THEN
    INSERT INTO notifications (user_id, kind, title, body, link, entity_type, entity_id, actor_id, dedupe_key)
    SELECT u.id, 'labour.requested', 'Labour request to approve',
           format('%s · from %s, %s%s · %s workers', btrim(pr.project_name), to_char(p_date, 'Dy DD Mon'),
                  labour_day_weekdays_label(v_days), CASE WHEN p_ends_on IS NULL THEN ' until changed' WHEN p_ends_on = p_date THEN ' (one day)'
                                                         ELSE ' to ' || to_char(p_ends_on, 'DD Mon') END, v_n),
           '/labour/day-requests', 'labour_day_request', r.id, auth.uid(), 'ldr-' || r.id || '-' || extract(epoch FROM now())::bigint
      FROM user_profiles u
     WHERE u.account_status = 'active' AND (u.role = 'operations_manager' OR u.is_operations_manager) AND u.id IS DISTINCT FROM auth.uid()
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN r.id;
END $function$;

CREATE OR REPLACE FUNCTION public.labour_crew_auto_approve(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r labour_day_requests%ROWTYPE; v_prev uuid; v_more text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO r FROM labour_day_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT labour_project_can_run(r.project_id) THEN RAISE EXCEPTION 'This is not a crew of a project you manage'; END IF;
  IF r.status <> 'submitted' THEN RETURN jsonb_build_object('approved', false, 'why', 'it is not waiting for approval'); END IF;
  IF NOT COALESCE((SELECT auto_approve FROM labour_terms_settings WHERE id), false) THEN
    RETURN jsonb_build_object('approved', false, 'why', 'every request is approved by a person');
  END IF;
  IF r.work_date <= bot_today() THEN RETURN jsonb_build_object('approved', false, 'why', 'its first day has already started'); END IF;
  SELECT p.id INTO v_prev FROM labour_day_requests p
   WHERE p.project_id = r.project_id AND p.status = 'approved' AND p.id <> r.id AND p.work_date <= r.work_date
     AND EXISTS (SELECT 1 FROM labour_day_request_lines l WHERE l.request_id = p.id)
   ORDER BY p.work_date DESC, p.decided_at DESC NULLS LAST LIMIT 1;
  IF v_prev IS NULL THEN RETURN jsonb_build_object('approved', false, 'why', 'no crew has been approved for this project before'); END IF;
  SELECT string_agg(l.trade_tag::text || ': ' || l.headcount || ' (' || COALESCE(o.headcount, 0) || ' approved)', ', ') INTO v_more
    FROM labour_day_request_lines l
    LEFT JOIN labour_day_request_lines o ON o.request_id = v_prev AND o.trade_tag IS NOT DISTINCT FROM l.trade_tag
   WHERE l.request_id = r.id AND l.headcount > COALESCE(o.headcount, 0);
  IF v_more IS NOT NULL THEN RETURN jsonb_build_object('approved', false, 'why', 'it asks for more people than the crew approved before: ' || v_more); END IF;
  UPDATE labour_day_requests SET status = 'approved', decided_by = NULL, decided_by_name = 'Kuncho (automatic)', decided_at = now(),
         decision_note = 'Approved automatically: no more people than the crew already approved', updated_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('approved', true, 'why', 'it asks for no more people than the crew already approved');
END $function$;

-- ── 9. Pay by project and week ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.confirm_labour_day_pay(uuid, date, text, date);
CREATE OR REPLACE FUNCTION public.confirm_labour_day_pay(p_project uuid, p_to date, p_note text DEFAULT NULL::text, p_from date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run uuid; v_code text; v_from date; v_last date; v_total numeric; v_n int; v_jobs int; v_missing text; v_cat uuid; v_exp uuid; v_sheet uuid;
  v_pm uuid := labour_project_pm(p_project);
  v_pm_name text := (SELECT btrim(project_name) FROM projects WHERE id = p_project);
  v_name text := COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), 'Kuncho (automatic)');
  prj record; job record; v_lines jsonb;
BEGIN
  IF NOT (labour_project_can_run(p_project) OR labour_is_system()) THEN RAISE EXCEPTION 'The project''s PM confirms what is owed for its workers'; END IF;
  IF v_pm IS NULL THEN RAISE EXCEPTION 'This project has no PM — set one first'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('labour_day_pay:' || p_project::text));
  PERFORM 1 FROM labour_day_workers w JOIN labour_days d ON d.id = w.day_id
   WHERE d.project_id = p_project AND d.status = 'locked' AND d.work_date <= p_to AND (p_from IS NULL OR d.work_date >= p_from) AND w.pay_run_id IS NULL
   FOR UPDATE OF w;

  SELECT string_agg(DISTINCT s.employee_name, ', ') INTO v_missing
    FROM labour_days d JOIN labour_day_workers w ON w.day_id = d.id JOIN staff s ON s.id = w.staff_id
   WHERE d.project_id = p_project AND d.status = 'locked' AND d.work_date <= p_to AND (p_from IS NULL OR d.work_date >= p_from)
     AND w.pay_run_id IS NULL AND COALESCE(s.day_rate, 0) <= 0
     AND EXISTS (SELECT 1 FROM labour_day_allocations a WHERE a.day_id = d.id AND a.staff_id = w.staff_id AND a.days > 0);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'No day rate on file for %. HR adds it on the worker''s record first', v_missing; END IF;

  SELECT count(*), min(c.work_date), max(c.work_date) INTO v_n, v_from, v_last
    FROM labour_day_costs(NULL, p_from, p_to) c JOIN labour_days pd ON pd.id = c.day_id AND pd.project_id = p_project WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL;
  SELECT count(DISTINCT labor_requisition_id), LEAST(v_from, min(work_date)), GREATEST(v_last, max(work_date)) INTO v_jobs, v_from, v_last
    FROM labour_day_job_costs(NULL, p_to) WHERE project_id = p_project HAVING sum(amount) > 0;
  IF COALESCE(v_n, 0) = 0 AND COALESCE(v_jobs, 0) = 0 THEN RAISE EXCEPTION 'No locked days to pay up to %', to_char(p_to, 'DD Mon'); END IF;
  IF v_from IS NULL THEN
    SELECT min(c.work_date), max(c.work_date) INTO v_from, v_last FROM labour_day_costs(NULL, p_from, p_to) c JOIN labour_days pd ON pd.id = c.day_id AND pd.project_id = p_project WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL;
  END IF;

  v_code := 'LDP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_day_pay_run_seq')::text, 4, '0');
  INSERT INTO labour_day_pay_runs (code, pm_staff_id, project_id, period_start, period_end, total, note, confirmed_by, confirmed_by_name, week_of)
  VALUES (v_code, v_pm, p_project, v_from, v_last, 0, NULLIF(btrim(p_note), ''), auth.uid(), v_name,
          CASE WHEN p_from IS NOT NULL AND p_from = labour_week_of(p_from) AND p_to = p_from + 6 THEN p_from END)
  RETURNING id INTO v_run;

  v_cat := COALESCE((SELECT c.id FROM categories c WHERE c.category_name = 'Labor' AND c.parent_type = 'Project' ORDER BY c.created_at LIMIT 1),
                    (SELECT c.id FROM categories c WHERE c.category_name = 'Labor' ORDER BY c.created_at LIMIT 1));

  -- Day workers: one payable per project.
  FOR prj IN
    SELECT c.project_id, p.project_name, sum(c.amount) AS amount, min(c.work_date) AS first_day, max(c.work_date) AS last_day,
           count(DISTINCT c.staff_id) AS workers, (array_agg(DISTINCT c.staff_id))[1] AS one_staff
      FROM labour_day_costs(NULL, p_from, p_to) c JOIN labour_days pd ON pd.id = c.day_id AND pd.project_id = p_project JOIN projects p ON p.id = c.project_id
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
              FROM labour_day_costs(NULL, p_from, p_to, prj.project_id) c JOIN labour_days pd ON pd.id = c.day_id AND pd.project_id = p_project
             WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL AND c.project_id = prj.project_id
             GROUP BY c.staff_id) x
      JOIN staff s ON s.id = x.staff_id;

    INSERT INTO expenses (
      item_service_description, amount_etb, expense_type, category_id, project_id, date,
      paid_to_staff_id, approval_status, payment_state, rollup_period_start, rollup_period_end)
    VALUES (
      format('Labour %s · day sheets · %s · %s to %s', v_code, prj.project_name,
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
      auth.uid(), v_name, NULLIF(btrim(p_note), ''), v_run, v_pm);
  END LOOP;

  -- Piece jobs: each on its own payable, the same way as before.
  FOR job IN SELECT labor_requisition_id AS id FROM labour_day_job_costs(NULL, p_to) WHERE project_id = p_project GROUP BY 1 HAVING sum(amount) > 0 LOOP
    v_sheet := confirm_labour_pay(job.id, p_to, p_note);
    UPDATE labour_pay_sheets SET day_pay_run_id = v_run, pm_staff_id = v_pm WHERE id = v_sheet;
  END LOOP;

  UPDATE labour_day_pay_runs r
     SET total = (SELECT COALESCE(sum(ps.total), 0) FROM labour_pay_sheets ps WHERE ps.day_pay_run_id = v_run),
         lines = COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'worker_name', s.employee_name, 'days', x.days,
                                   'rate', x.rate, 'overtime_amount', x.ot, 'amount', x.amount) ORDER BY s.employee_name)
                             FROM (SELECT c.staff_id, sum(c.days) AS days, max(c.day_rate) AS rate, sum(c.overtime) AS ot, sum(c.amount) AS amount
                                     FROM labour_day_costs(NULL, p_from, p_to) c JOIN labour_days pd ON pd.id = c.day_id AND pd.project_id = p_project WHERE c.day_status = 'locked' AND c.pay_run_id IS NULL
                                    GROUP BY c.staff_id) x JOIN staff s ON s.id = x.staff_id), '[]'::jsonb)
                 || COALESCE((SELECT jsonb_agg(jsonb_build_object('job_id', ps.labor_requisition_id, 'worker_name', q.role_needed, 'amount', ps.total) ORDER BY q.role_needed)
                                FROM labour_pay_sheets ps JOIN labor_requisitions q ON q.id = ps.labor_requisition_id
                               WHERE ps.day_pay_run_id = v_run), '[]'::jsonb)
   WHERE r.id = v_run;

  UPDATE labour_day_workers w SET pay_run_id = v_run
    FROM labour_days d
   WHERE d.id = w.day_id AND d.project_id = p_project AND d.status = 'locked' AND d.work_date <= p_to
     AND (p_from IS NULL OR d.work_date >= p_from) AND w.pay_run_id IS NULL;
  RETURN v_run;
END $function$;
REVOKE EXECUTE ON FUNCTION public.confirm_labour_day_pay(uuid, date, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_labour_day_pay(uuid, date, text, date) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.labour_week_request(uuid, date, text);
DROP FUNCTION IF EXISTS public.labour_week_pay_prepare(uuid, date, text);
DROP FUNCTION IF EXISTS public.labour_week_pay_undo(uuid, date, text, boolean);
DROP FUNCTION IF EXISTS public.labour_pay_weeks(date, uuid);

-- The project's draft request for a week, made if there isn't one; it is the project's PM's to sign.
CREATE OR REPLACE FUNCTION public.labour_week_request(p_project uuid, p_week date, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v uuid; w date := labour_week_of(p_week); v_pm uuid := labour_project_pm(p_project);
BEGIN
  SELECT r.id INTO v FROM labour_pay_requests r
   WHERE r.project_id = p_project AND r.week_of = w AND r.status = 'draft' ORDER BY r.created_at DESC LIMIT 1;
  IF v IS NULL THEN
    INSERT INTO labour_pay_requests (code, note, created_by, created_by_name, prepared_for, project_id, week_to, week_of)
    VALUES ('LPR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_pay_request_seq')::text, 4, '0'),
            (SELECT btrim(project_name) FROM projects WHERE id = p_project) || ' · week of ' || to_char(w, 'DD Mon') || ' – ' || to_char(w + 6, 'DD Mon YYYY')
              || COALESCE('. ' || NULLIF(btrim(p_note), '') || '.', ''),
            auth.uid(), COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), 'Kuncho (automatic)'), v_pm, p_project, w + 6, w)
    RETURNING id INTO v;
  ELSE
    UPDATE labour_pay_requests SET updated_at = now(), prepared_for = COALESCE(v_pm, prepared_for) WHERE id = v;
  END IF;
  RETURN v;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_request(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- Prepare one project's week: its locked days, and nothing from other weeks or projects.
CREATE OR REPLACE FUNCTION public.labour_week_pay_prepare(p_project uuid, p_week date, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  w date := labour_week_of(p_week); v_run uuid; v_req uuid; v_exp uuid[]; v_total numeric; v_workers int;
  v_note text := COALESCE(NULLIF(btrim(p_note), ''), CASE WHEN labour_is_system() THEN 'Prepared at the weekly cut-off' ELSE 'Prepared by hand' END);
BEGIN
  IF NOT (labour_project_can_run(p_project) OR labour_is_system()) THEN RAISE EXCEPTION 'The project''s PM prepares its pay'; END IF;
  IF w > labour_week_of((now() AT TIME ZONE 'Africa/Addis_Ababa')::date) THEN RAISE EXCEPTION 'That week hasn''t started yet'; END IF;
  IF EXISTS (SELECT 1 FROM labour_days d JOIN labour_day_workers x ON x.day_id = d.id
              WHERE d.project_id = p_project AND d.status = 'locked' AND d.work_date BETWEEN w AND w + 6 AND x.pay_run_id IS NULL)
     OR EXISTS (SELECT 1 FROM labour_day_job_costs(NULL, w + 6) j WHERE j.project_id = p_project HAVING sum(j.amount) > 0) THEN
    v_run := confirm_labour_day_pay(p_project, w + 6, v_note, w);
  END IF;
  -- This week's payables not in a request yet: the run's, and any other of the project's whose period ends this week.
  SELECT array_agg(DISTINCT x.expense_id) INTO v_exp
    FROM labour_payable_of(NULL) x
    JOIN expenses e ON e.id = x.expense_id
    LEFT JOIN labour_pay_sheets ps ON ps.expense_id = e.id
   WHERE (v_run IS NOT NULL AND ps.day_pay_run_id = v_run)
      OR (e.project_id = p_project AND labour_week_of(COALESCE(e.rollup_period_end, e.date)) = w);
  IF v_exp IS NULL THEN
    SELECT r.id INTO v_req FROM labour_pay_requests r WHERE r.project_id = p_project AND r.week_of = w AND r.status <> 'cancelled'
     ORDER BY r.created_at DESC LIMIT 1;
    IF v_req IS NULL THEN RAISE EXCEPTION 'Nothing to pay for the week of % — lock its days first', to_char(w, 'DD Mon'); END IF;
  ELSE
    v_req := labour_week_request(p_project, w, v_note);
    INSERT INTO labour_pay_request_items (request_id, expense_id) SELECT v_req, unnest(v_exp)
    ON CONFLICT (request_id, expense_id) DO UPDATE SET removed_at = NULL;
  END IF;
  SELECT COALESCE(sum(e.amount_etb), 0) INTO v_total FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
   WHERE i.request_id = v_req AND i.removed_at IS NULL;
  SELECT count(DISTINCT lw.staff_id) INTO v_workers FROM labour_pay_request_items i JOIN labor_expense_workers lw ON lw.expense_id = i.expense_id
   WHERE i.request_id = v_req AND i.removed_at IS NULL;
  RETURN jsonb_build_object('request_id', v_req, 'code', (SELECT code FROM labour_pay_requests WHERE id = v_req), 'week_of', w,
                            'added', COALESCE(cardinality(v_exp), 0), 'total', v_total, 'workers', v_workers,
                            'run_code', (SELECT code FROM labour_day_pay_runs WHERE id = v_run));
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_pay_prepare(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_pay_prepare(uuid, date, text) TO authenticated, service_role;

-- The cut-off: project by project, week by week.
CREATE OR REPLACE FUNCTION public.labour_week_close(p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s labour_pay_week_settings%ROWTYPE;
  v_system boolean := auth.uid() IS NULL;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_cut date; v_to date; pj record; q record; wk record; r jsonb;
  v_skipped text[] := '{}'; v_req uuid; v_out jsonb := '[]'::jsonb; v_reqs uuid[] := '{}'; v_note text;
BEGIN
  IF NOT v_system AND NOT (COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()) THEN
    RAISE EXCEPTION 'Only admin or operations can prepare the pay by hand';
  END IF;
  SELECT * INTO s FROM labour_pay_week_settings WHERE id FOR UPDATE;
  v_cut := labour_last_cutoff();
  IF p_force AND NOT v_system THEN
    v_to := v_today;
  ELSIF NOT s.auto_prepare OR (s.last_closed_to IS NOT NULL AND s.last_closed_to >= v_cut) THEN
    RETURN jsonb_build_object('ran', false);
  ELSE
    v_to := v_cut;
  END IF;
  IF v_system THEN PERFORM set_config('kuncho.labour_system', 'on', true); END IF;
  v_note := CASE WHEN v_system THEN 'Prepared at the weekly cut-off' ELSE 'Prepared by hand' END;

  -- 1. Each project's weeks with locked days or piece work not paid yet, oldest first.
  FOR pj IN
    SELECT DISTINCT x.project_id, x.w FROM (
      SELECT d.project_id, labour_week_of(d.work_date) AS w FROM labour_days d JOIN labour_day_workers lw ON lw.day_id = d.id
       WHERE d.status = 'locked' AND d.work_date <= v_to AND lw.pay_run_id IS NULL
      UNION SELECT j.project_id, labour_week_of(max(j.work_date)) FROM labour_day_job_costs(NULL, v_to) j GROUP BY j.project_id HAVING sum(j.amount) > 0) x
     ORDER BY 2, 1
  LOOP
    BEGIN
      r := labour_week_pay_prepare(pj.project_id, pj.w, v_note);
      v_reqs := v_reqs || (r->>'request_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped || ((SELECT btrim(project_name) FROM projects WHERE id = pj.project_id) || ', week of ' || to_char(pj.w, 'DD Mon') || ': ' || SQLERRM);
    END;
  END LOOP;
  -- 2. Day work recorded on a request: crew-leader jobs, and anything from before day sheets.
  FOR q IN SELECT u.labor_requisition_id, u.role_needed FROM v_labour_unpaid u
            WHERE u.payment_basis = 'per_day' AND u.first_day <= v_to
              AND EXISTS (SELECT 1 FROM labour_pay_lines(u.labor_requisition_id, v_to) l WHERE l.amount > 0)
  LOOP
    BEGIN
      PERFORM confirm_labour_pay(q.labor_requisition_id, v_to, v_note);
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped || (q.role_needed || ': ' || SQLERRM);
    END;
  END LOOP;
  -- 3. Anything else payable in no request yet: into its project's request of the week it ends in.
  FOR wk IN SELECT e.project_id, labour_week_of(COALESCE(e.rollup_period_end, e.date)) AS w, array_agg(x.expense_id) AS ids
              FROM labour_payable_of(NULL) x JOIN expenses e ON e.id = x.expense_id
             WHERE e.project_id IS NOT NULL AND labour_project_pm(e.project_id) IS NOT NULL
             GROUP BY 1, 2 ORDER BY 2, 1
  LOOP
    v_req := labour_week_request(wk.project_id, wk.w, v_note);
    INSERT INTO labour_pay_request_items (request_id, expense_id) SELECT v_req, unnest(wk.ids)
    ON CONFLICT (request_id, expense_id) DO UPDATE SET removed_at = NULL;
    v_reqs := v_reqs || v_req;
  END LOOP;

  IF cardinality(v_skipped) > 0 THEN
    v_out := v_out || jsonb_build_object('pm', 'Left out', 'skipped', to_jsonb(v_skipped));
  END IF;
  FOR q IN
    SELECT rq.id, rq.code, rq.week_of, rq.project_id, btrim(p.project_name) AS project, btrim(st.employee_name) AS pm,
           COALESCE(st.user_id, (SELECT u.id FROM auth.users u WHERE st.email IS NOT NULL AND lower(u.email) = lower(st.email) LIMIT 1)) AS user_id,
           (SELECT COALESCE(sum(e.amount_etb), 0) FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
             WHERE i.request_id = rq.id AND i.removed_at IS NULL) AS total,
           (SELECT count(DISTINCT lw.staff_id) FROM labour_pay_request_items i JOIN labor_expense_workers lw ON lw.expense_id = i.expense_id
             WHERE i.request_id = rq.id AND i.removed_at IS NULL)::int AS workers
      FROM labour_pay_requests rq JOIN projects p ON p.id = rq.project_id LEFT JOIN staff st ON st.id = rq.prepared_for
     WHERE rq.id = ANY (SELECT DISTINCT unnest(v_reqs)) ORDER BY rq.week_of, p.project_name
  LOOP
    IF q.user_id IS NOT NULL THEN
      PERFORM notify(ARRAY[q.user_id], 'labour.week_ready',
        'Labour pay is ready to sign: ' || notify_etb(q.total) || CASE WHEN q.workers > 0 THEN ' for ' || q.workers || ' worker' || CASE WHEN q.workers = 1 THEN '' ELSE 's' END ELSE '' END,
        q.code || ' · ' || q.project || COALESCE(', week of ' || to_char(q.week_of, 'DD Mon'), '') || '. Attach the signed attendance sheet and send it to finance.',
        '/labour/requests/' || q.id, 'labour_pay_request', q.id, NULL, 'labour.week_ready:' || q.id || ':' || v_to, '{}'::jsonb, true);
    END IF;
    v_out := v_out || jsonb_build_object('pm', q.pm, 'project', q.project, 'request_id', q.id, 'code', q.code, 'week_of', q.week_of,
                                         'total', q.total, 'workers', q.workers, 'skipped', '[]'::jsonb);
  END LOOP;

  IF v_to = v_cut AND NOT (p_force AND NOT v_system) THEN
    UPDATE labour_pay_week_settings SET last_closed_to = v_cut, last_closed_at = now() WHERE id;
  END IF;
  RETURN jsonb_build_object('ran', true, 'to', v_to, 'requests', v_out);
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_close(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_close(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.labour_week_pay_undo(p_project uuid, p_week date, p_reason text, p_send_back boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  w date := labour_week_of(p_week);
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  v_runs uuid[]; v_exp uuid[]; v_reqs uuid[]; v_from date; v_to date; v_total numeric; v_codes text; v_bad text; v_back int := 0; d record;
BEGIN
  IF NOT labour_day_is_approver() THEN RAISE EXCEPTION 'Only admin, HR or operations undo a week''s pay'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why the week''s pay is undone'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('labour_day_pay:' || p_project::text));

  SELECT array_agg(DISTINCT x.id) INTO v_runs FROM (
    SELECT lw.pay_run_id AS id FROM labour_day_workers lw JOIN labour_days dd ON dd.id = lw.day_id
     WHERE dd.project_id = p_project AND dd.work_date BETWEEN w AND w + 6 AND lw.pay_run_id IS NOT NULL
    UNION SELECT ps.day_pay_run_id FROM labour_work_entries e JOIN labour_days dd ON dd.id = e.labour_day_id JOIN labour_pay_sheets ps ON ps.id = e.pay_sheet_id
     WHERE dd.project_id = p_project AND dd.work_date BETWEEN w AND w + 6 AND ps.day_pay_run_id IS NOT NULL
    UNION SELECT r.id FROM labour_day_pay_runs r WHERE r.project_id = p_project AND r.week_of = w) x;

  IF v_runs IS NULL THEN RAISE EXCEPTION 'The week of % has no pay to undo', to_char(w, 'DD Mon'); END IF;

  SELECT min(r.period_start), max(r.period_end), sum(r.total) INTO v_from, v_to, v_total FROM labour_day_pay_runs r WHERE r.id = ANY (v_runs);
  SELECT array_agg(ps.expense_id) INTO v_exp FROM labour_pay_sheets ps WHERE ps.day_pay_run_id = ANY (v_runs) AND ps.expense_id IS NOT NULL;
  v_exp := COALESCE(v_exp, '{}');

  IF EXISTS (SELECT 1 FROM expenses e WHERE e.id = ANY (v_exp)
              AND (COALESCE(e.payment_state, 'unpaid') <> 'unpaid' OR e.approval_status::text NOT IN ('pending', 'rejected'))) THEN
    RAISE EXCEPTION 'Finance has already approved or paid part of this week — ask finance to withdraw the approval first';
  END IF;
  SELECT string_agg(DISTINCT q.code, ', ') INTO v_bad FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
   WHERE i.expense_id = ANY (v_exp) AND i.removed_at IS NULL AND q.status NOT IN ('draft', 'returned', 'cancelled');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'This week''s pay is already with finance in % — ask finance to send it back first', v_bad; END IF;
  IF EXISTS (SELECT 1 FROM payment_requests pr WHERE pr.expense_id = ANY (v_exp))
     OR EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = ANY (v_exp)) THEN
    RAISE EXCEPTION 'This week''s pay is already on a payment request or batch — take it off first';
  END IF;

  -- Out of the draft requests; a draft left with nothing in it is cancelled.
  SELECT array_agg(DISTINCT i.request_id), string_agg(DISTINCT q.code, ', ') INTO v_reqs, v_codes
    FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
   WHERE i.expense_id = ANY (v_exp) AND i.removed_at IS NULL;
  UPDATE labour_pay_request_items SET removed_at = now() WHERE expense_id = ANY (v_exp) AND removed_at IS NULL;
  UPDATE labour_pay_request_deductions dd SET amount = 0 WHERE dd.request_id = ANY (COALESCE(v_reqs, '{}')) AND dd.amount > 0
     AND NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labor_expense_workers lw ON lw.expense_id = i.expense_id
                      WHERE i.request_id = dd.request_id AND i.removed_at IS NULL AND lw.staff_id = dd.staff_id);
  UPDATE labour_pay_requests q SET status = CASE WHEN EXISTS (SELECT 1 FROM labour_pay_request_items i WHERE i.request_id = q.id AND i.removed_at IS NULL)
                                                 THEN q.status ELSE 'cancelled' END,
         updated_at = now()
   WHERE q.id = ANY (COALESCE(v_reqs, '{}')) AND q.status IN ('draft', 'returned');

  -- The pay itself, as reopen_labour_day_pay does.
  UPDATE labour_day_workers SET pay_run_id = NULL WHERE pay_run_id = ANY (v_runs);
  DELETE FROM labour_pay_sheets WHERE day_pay_run_id = ANY (v_runs);
  DELETE FROM expenses WHERE id = ANY (v_exp);
  DELETE FROM labour_day_pay_runs WHERE id = ANY (v_runs);

  -- The days: noted, and back to the PM if asked.
  FOR d IN SELECT dd.id, dd.status FROM labour_days dd WHERE dd.project_id = p_project AND dd.work_date BETWEEN COALESCE(v_from, w) AND COALESCE(v_to, w + 6) LOOP
    INSERT INTO labour_day_changes (day_id, kind, changed_by, changed_by_name, reason, before)
    VALUES (d.id, CASE WHEN p_send_back AND d.status <> 'open' THEN 'unlock' ELSE 'edit' END, auth.uid(), v_name,
            'Pay undone: ' || btrim(p_reason), labour_day_snapshot(d.id));
    IF p_send_back AND d.status <> 'open' THEN
      UPDATE labour_days SET status = 'open', locked_at = NULL, locked_by = NULL, locked_by_name = NULL, review_note = btrim(p_reason) WHERE id = d.id;
      v_back := v_back + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('runs', cardinality(v_runs), 'from', v_from, 'to', v_to, 'total', v_total, 'requests', v_codes, 'sent_back', v_back);
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_week_pay_undo(uuid, date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_week_pay_undo(uuid, date, text, boolean) TO authenticated, service_role;

-- One line per project per week ('pm' inside is the project).
CREATE OR REPLACE FUNCTION public.labour_pay_weeks(p_from date, p_project uuid DEFAULT NULL)
RETURNS TABLE(pm_staff_id uuid, pm_name text, week_of date, days_open integer, days_review integer, days_locked integer,
              amount numeric, to_prepare numeric, projects jsonb, requests jsonb, run_from date, run_to date, stage text,
              project_id uuid, project_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH f AS (SELECT labour_week_of(p_from) AS f),
  dy AS (
    SELECT d.id, d.project_id AS pm, labour_week_of(d.work_date) AS w, d.status
      FROM labour_days d, f
     WHERE d.work_date >= f.f AND (p_project IS NULL OR d.project_id = p_project) AND labour_project_can_see(d.project_id)
       AND (EXISTS (SELECT 1 FROM labour_day_workers x WHERE x.day_id = d.id) OR EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labour_day_id = d.id))
  ),
  money AS (   -- day workers and piece work on these days
    SELECT dd.project_id AS pm, labour_week_of(c.work_date) AS w, c.project_id, c.amount,
           (c.day_status = 'locked' AND c.pay_run_id IS NULL) AS unpaid_locked
      FROM labour_day_costs(NULL, (SELECT f FROM f), NULL) c JOIN labour_days dd ON dd.id = c.day_id WHERE c.day_id IN (SELECT id FROM dy)
    UNION ALL
    SELECT dd.project_id, labour_week_of(e.work_date), e.project_id,
           round(CASE r.payment_basis WHEN 'per_volume' THEN COALESCE(e.quantity, 0) * COALESCE(r.unit_rate, 0)
                      ELSE COALESCE(e.percent_done, 0) / 100 * COALESCE(r.fixed_price_amount, 0) END, 2),
           (dd.status = 'locked' AND e.pay_sheet_id IS NULL)
      FROM labour_work_entries e
      JOIN labor_requisitions r ON r.id = e.labor_requisition_id AND r.payment_basis IN ('per_volume', 'fixed_price')
      JOIN labour_days dd ON dd.id = e.labour_day_id
     WHERE dd.id IN (SELECT id FROM dy)
  ),
  runs AS (    -- pay runs holding these weeks' days
    SELECT DISTINCT dy.pm, dy.w, lw.pay_run_id AS run FROM dy JOIN labour_day_workers lw ON lw.day_id = dy.id WHERE lw.pay_run_id IS NOT NULL
    UNION SELECT dy.pm, dy.w, ps.day_pay_run_id FROM dy JOIN labour_work_entries e ON e.labour_day_id = dy.id JOIN labour_pay_sheets ps ON ps.id = e.pay_sheet_id
     WHERE ps.day_pay_run_id IS NOT NULL
  ),
  exps AS (    -- their payables (plus piece pay sheets made outside a run)
    SELECT runs.pm, runs.w, ps.expense_id FROM runs JOIN labour_pay_sheets ps ON ps.day_pay_run_id = runs.run WHERE ps.expense_id IS NOT NULL
    UNION SELECT dy.pm, dy.w, ps.expense_id FROM dy JOIN labour_work_entries e ON e.labour_day_id = dy.id JOIN labour_pay_sheets ps ON ps.id = e.pay_sheet_id
     WHERE ps.expense_id IS NOT NULL
  ),
  reqs AS (
    SELECT DISTINCT x.pm, x.w, q.id, q.code, q.status FROM exps x
      JOIN labour_pay_request_items i ON i.expense_id = x.expense_id AND i.removed_at IS NULL
      JOIN labour_pay_requests q ON q.id = i.request_id AND q.status <> 'cancelled'
  ),
  keys AS (SELECT DISTINCT pm, w FROM dy)
  SELECT p0.project_manager_id, btrim(st.employee_name), k.w,
         (SELECT count(*)::int FROM dy WHERE dy.pm = k.pm AND dy.w = k.w AND dy.status = 'open'),
         (SELECT count(*)::int FROM dy WHERE dy.pm = k.pm AND dy.w = k.w AND dy.status = 'submitted'),
         (SELECT count(*)::int FROM dy WHERE dy.pm = k.pm AND dy.w = k.w AND dy.status = 'locked'),
         (SELECT COALESCE(sum(m.amount), 0) FROM money m WHERE m.pm = k.pm AND m.w = k.w),
         (SELECT COALESCE(sum(m.amount), 0) FROM money m WHERE m.pm = k.pm AND m.w = k.w AND m.unpaid_locked),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', y.project_id, 'name', p.project_name, 'amount', y.amount) ORDER BY y.amount DESC)
                     FROM (SELECT m.project_id, sum(m.amount) AS amount FROM money m WHERE m.pm = k.pm AND m.w = k.w GROUP BY 1 HAVING sum(m.amount) > 0) y
                     JOIN projects p ON p.id = y.project_id), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status,
                     'total', (SELECT COALESCE(sum(e.amount_etb), 0) FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
                                WHERE i.request_id = r.id AND i.removed_at IS NULL)) ORDER BY r.code)
                     FROM reqs r WHERE r.pm = k.pm AND r.w = k.w), '[]'::jsonb),
         (SELECT min(pr.period_start) FROM runs JOIN labour_day_pay_runs pr ON pr.id = runs.run WHERE runs.pm = k.pm AND runs.w = k.w),
         (SELECT max(pr.period_end) FROM runs JOIN labour_day_pay_runs pr ON pr.id = runs.run WHERE runs.pm = k.pm AND runs.w = k.w),
         CASE
           WHEN EXISTS (SELECT 1 FROM dy WHERE dy.pm = k.pm AND dy.w = k.w AND dy.status <> 'locked') THEN 'days'
           WHEN EXISTS (SELECT 1 FROM money m WHERE m.pm = k.pm AND m.w = k.w AND m.unpaid_locked AND m.amount > 0) THEN 'prepare'
           WHEN NOT EXISTS (SELECT 1 FROM exps x WHERE x.pm = k.pm AND x.w = k.w) THEN 'nothing'
           WHEN NOT EXISTS (SELECT 1 FROM exps x JOIN expenses e ON e.id = x.expense_id
                             WHERE x.pm = k.pm AND x.w = k.w AND COALESCE(e.payment_state, 'unpaid') <> 'paid') THEN 'paid'
           WHEN EXISTS (SELECT 1 FROM reqs r WHERE r.pm = k.pm AND r.w = k.w AND r.status IN ('draft', 'returned'))
             OR EXISTS (SELECT 1 FROM exps x WHERE x.pm = k.pm AND x.w = k.w
                         AND NOT EXISTS (SELECT 1 FROM reqs r JOIN labour_pay_request_items i ON i.request_id = r.id AND i.removed_at IS NULL
                                          WHERE i.expense_id = x.expense_id)) THEN 'send'
           ELSE 'finance'
         END,
         k.pm, btrim(p0.project_name)
    FROM keys k JOIN projects p0 ON p0.id = k.pm LEFT JOIN staff st ON st.id = p0.project_manager_id
   ORDER BY k.w DESC, btrim(p0.project_name);
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_pay_weeks(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_pay_weeks(date, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.labour_project_pm(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_project_can_run(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_project_can_see(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_my_projects() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_project_pm_labour() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.labour_day_expected(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_day_jobs(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_day_get(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_day_save(uuid, date, jsonb, boolean, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_week_save(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_day_new_worker(uuid, text, text, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_day_board(date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_day_request_save(uuid, date, jsonb, text, boolean, date, smallint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_project_pm(uuid), public.labour_project_can_run(uuid), public.labour_project_can_see(uuid),
  public.labour_my_projects(), public.labour_day_expected(uuid, date), public.labour_day_jobs(uuid, date), public.labour_day_get(uuid, date),
  public.labour_day_save(uuid, date, jsonb, boolean, text, jsonb), public.labour_week_save(uuid, jsonb, boolean),
  public.labour_day_new_worker(uuid, text, text, numeric, text, text), public.labour_day_board(date, date),
  public.labour_day_request_save(uuid, date, jsonb, text, boolean, date, smallint[]) TO authenticated, service_role;

-- ── 10. Checks: nothing lost, everything in its project ─────────────────────
DO $chk$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM labour_day_allocations a JOIN labour_days d ON d.id = a.day_id
   WHERE a.bucket IN ('build', 'repair') AND a.project_id <> d.project_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '546 check: % allocations on another project''s sheet', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM labour_work_entries e JOIN labour_days d ON d.id = e.labour_day_id JOIN labor_requisitions r ON r.id = e.labor_requisition_id
   WHERE r.project_id <> d.project_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '546 check: % piece entries on another project''s sheet', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM labour_days d JOIN projects p ON p.id = d.project_id
   WHERE p.project_manager_id IS NOT NULL AND d.pm_staff_id <> p.project_manager_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '546 check: % sheets not with their project''s PM', v_bad; END IF;
END $chk$;

-- ── 11. Smoke test: the new functions run on the data as it now is ──────────
-- Run as an admin; anything that writes is undone. A failure here rolls the
-- whole migration back.
DO $smoke$
DECLARE v jsonb; pj uuid; dt date; wk date; adm uuid;
BEGIN
  SELECT id INTO adm FROM user_profiles WHERE role::text = 'admin' AND account_status = 'active' ORDER BY created_at LIMIT 1;
  IF adm IS NULL THEN RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', adm::text, true);
  SELECT project_id, work_date INTO pj, dt FROM labour_days ORDER BY work_date DESC LIMIT 1;
  IF pj IS NULL THEN RETURN; END IF;
  v := labour_day_get(pj, dt);
  PERFORM count(*) FROM labour_day_board(dt - 7, dt);
  PERFORM labour_flags();
  PERFORM count(*) FROM labour_pay_weeks(dt - 14);
  PERFORM count(*) FROM labour_my_projects();
  BEGIN
    -- Save an open day back as it is.
    SELECT project_id, work_date INTO pj, dt FROM labour_days WHERE status = 'open' ORDER BY work_date DESC LIMIT 1;
    IF pj IS NOT NULL THEN
      v := labour_day_get(pj, dt);
      v := labour_day_save(pj, dt,
             (SELECT COALESCE(jsonb_agg(jsonb_build_object('staff_id', w->>'staff_id', 'paid_days', w->'paid_days', 'overtime_hours', w->'overtime_hours',
                     'overtime_night_hours', w->'overtime_night_hours', 'note', w->>'note', 'alloc', w->'alloc')), '[]'::jsonb)
                FROM jsonb_array_elements(v->'workers') w), false, NULL, '[]'::jsonb);
    END IF;
    -- Prepare a week's pay, undo it, and run the cut-off.
    SELECT d.project_id, labour_week_of(d.work_date) INTO pj, wk
      FROM labour_days d JOIN labour_day_workers w ON w.day_id = d.id JOIN staff s ON s.id = w.staff_id
     WHERE d.status = 'locked' AND w.pay_run_id IS NULL
     GROUP BY 1, 2 HAVING bool_and(COALESCE(s.day_rate, 0) > 0) ORDER BY 2 DESC LIMIT 1;
    IF pj IS NOT NULL THEN
      v := labour_week_pay_prepare(pj, wk);
      v := labour_week_pay_undo(pj, wk, 'Migration check');
    END IF;
    v := labour_week_close(true);
    RAISE EXCEPTION 'undo the check' USING ERRCODE = 'TR546';
  EXCEPTION WHEN SQLSTATE 'TR546' THEN NULL;
  END;
END $smoke$;
