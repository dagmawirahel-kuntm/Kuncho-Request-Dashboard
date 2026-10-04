-- Daily site report: more questions for the foreman, and nudges for the
-- project manager when working days go by without a report.
--
-- Only one report had been submitted since the form went live (8 Aug), so
-- the gap is as much about follow-up as about the questions:
--   * The form now asks what a PM needs from the day: was the site working
--     (and if not, why), hours on site, progress per open work order, idle
--     crews, what is blocking work, client visits and instructions, toolbox
--     talk and PPE, rework, equipment, materials needed soon, and what the
--     site needs from the office.
--   * site_report_gaps() works out, for each live site, the working days
--     that have no submitted report. A site is live while it has a foreman
--     assigned, has not been handed over, and either has an open work order
--     or had work logged that day. Sundays, company holidays, paused sites
--     and days the PM excused are skipped.
--   * The PM sees those days (banner, bell, reports page) and can remind the
--     foreman, excuse a day, or pause reporting for a site on hold. The
--     foreman sees the reminder with the PM's message until the days are in.
--   * Sites three or more working days behind show on Operations health.
--   * Submitting a report records each work order's new progress through
--     wo_progress_updates, so work order progress moves with the report.
--   * PMs whose app role is not project_manager (a technician, an executive
--     or an admin managing a project) can now read their sites' reports.

-- ── Report questions ─────────────────────────────────────────────────────
ALTER TABLE site_daily_reports
  ADD COLUMN IF NOT EXISTS site_status text NOT NULL DEFAULT 'working'
    CHECK (site_status IN ('working', 'partial', 'no_work')),
  ADD COLUMN IF NOT EXISTS no_work_reason text
    CHECK (no_work_reason IN ('rain', 'holiday', 'waiting_materials', 'waiting_client', 'no_labour', 'payment', 'access', 'other')),
  ADD COLUMN IF NOT EXISTS on_site_from time,
  ADD COLUMN IF NOT EXISTS on_site_to time,
  ADD COLUMN IF NOT EXISTS work_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS subcontractor_headcount integer CHECK (subcontractor_headcount >= 0),
  ADD COLUMN IF NOT EXISTS idle_hours numeric CHECK (idle_hours >= 0),
  ADD COLUMN IF NOT EXISTS idle_reason text,
  ADD COLUMN IF NOT EXISTS blocked boolean,
  ADD COLUMN IF NOT EXISTS blocker_causes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS blocker_notes text,
  ADD COLUMN IF NOT EXISTS delay_days numeric CHECK (delay_days >= 0),
  ADD COLUMN IF NOT EXISTS client_visit boolean,
  ADD COLUMN IF NOT EXISTS client_visit_notes text,
  ADD COLUMN IF NOT EXISTS variation_instructed boolean,
  ADD COLUMN IF NOT EXISTS variation_notes text,
  ADD COLUMN IF NOT EXISTS toolbox_talk boolean,
  ADD COLUMN IF NOT EXISTS ppe_compliance text CHECK (ppe_compliance IN ('all', 'most', 'few')),
  ADD COLUMN IF NOT EXISTS quality_issues text,
  ADD COLUMN IF NOT EXISTS equipment_issues text,
  ADD COLUMN IF NOT EXISTS materials_needed_soon text,
  ADD COLUMN IF NOT EXISTS office_needs text;

COMMENT ON COLUMN site_daily_reports.work_items IS
  'Progress per open work order: [{work_order_id, label, progress_before, progress_after, note}]. Written to wo_progress_updates on submit.';

-- PMs read their sites' reports whatever their app role.
ALTER POLICY sdr_pm_read ON site_daily_reports
  USING (manages_project(project_id));

-- On submit, push each work order's new progress through wo_progress_updates
-- (its trigger moves work_orders.current_progress_pct).
CREATE OR REPLACE FUNCTION site_report_apply_work_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  it jsonb;
  v_pct numeric;
  v_wo uuid;
BEGIN
  IF NEW.submitted_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.submitted_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(NEW.work_items, '[]'::jsonb)) LOOP
    v_wo := nullif(it->>'work_order_id', '')::uuid;
    v_pct := nullif(it->>'progress_after', '')::numeric;
    CONTINUE WHEN v_wo IS NULL OR v_pct IS NULL;
    CONTINUE WHEN v_pct IS NOT DISTINCT FROM nullif(it->>'progress_before', '')::numeric
      AND coalesce(it->>'note', '') = '';
    -- Only the report's own project, and never backwards.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM work_orders w WHERE w.id = v_wo AND w.project_id = NEW.project_id
        AND coalesce(w.current_progress_pct, 0) <= v_pct);
    INSERT INTO wo_progress_updates (work_order_id, progress_pct, note, updated_by_staff_id)
    VALUES (v_wo, least(v_pct, 100),
            coalesce(nullif(it->>'note', ''), 'From the daily site report of ' || to_char(NEW.report_date, 'DD Mon')),
            NEW.foreman_staff_id);
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_site_report_apply_work_items
  AFTER INSERT OR UPDATE OF submitted_at ON site_daily_reports
  FOR EACH ROW EXECUTE FUNCTION site_report_apply_work_items();

-- ── Which days need a report ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_report_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Days before this are never counted as missing.
  tracking_from date NOT NULL,
  -- ISO weekdays that need a report (1 = Monday … 7 = Sunday).
  work_days integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  lookback_days integer NOT NULL DEFAULT 14 CHECK (lookback_days BETWEEN 1 AND 60),
  -- Working days behind before a site shows on Operations health.
  escalate_after_days integer NOT NULL DEFAULT 3 CHECK (escalate_after_days >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO site_report_settings (id, tracking_from)
VALUES (true, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date - 7)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE site_report_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY srs_read ON site_report_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY srs_manage ON site_report_settings FOR UPDATE
  USING (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role]));
GRANT SELECT, UPDATE ON site_report_settings TO authenticated;

-- A site on hold: no reports expected between these dates.
CREATE TABLE IF NOT EXISTS site_report_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paused_from date NOT NULL,
  paused_until date,
  reason text NOT NULL,
  created_by_staff_id uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (paused_until IS NULL OR paused_until >= paused_from)
);
CREATE INDEX IF NOT EXISTS idx_srp_project ON site_report_pauses(project_id);

-- A single day the PM confirmed needed no report (site closed, no work).
CREATE TABLE IF NOT EXISTS site_report_excused_days (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  reason text NOT NULL,
  excused_by_staff_id uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, report_date)
);

-- A reminder from the PM (or management) to a foreman.
CREATE TABLE IF NOT EXISTS site_report_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_dates date[] NOT NULL,
  from_staff_id uuid REFERENCES staff(id),
  to_staff_id uuid NOT NULL REFERENCES staff(id),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_srn_to ON site_report_nudges(to_staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_srn_project ON site_report_nudges(project_id, created_at DESC);

ALTER TABLE site_report_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_report_excused_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_report_nudges ENABLE ROW LEVEL SECURITY;
CREATE POLICY srp_read ON site_report_pauses FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sred_read ON site_report_excused_days FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY srn_read ON site_report_nudges FOR SELECT USING (
  to_staff_id = current_staff_id() OR from_staff_id = current_staff_id() OR manages_project(project_id)
  OR get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role]));
GRANT SELECT ON site_report_pauses, site_report_excused_days, site_report_nudges TO authenticated;
-- Writes go through the functions below.

CREATE OR REPLACE FUNCTION site_report_can_manage(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role])
      OR manages_project(p_project_id);
$$;

-- Every working day, per live site the viewer can see, that has no
-- submitted report. state: 'missing' (nothing) or 'draft' (saved, not sent).
CREATE OR REPLACE FUNCTION site_report_gaps(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  project_id uuid,
  project_name text,
  report_date date,
  state text,
  draft_id uuid,
  had_activity boolean,
  foreman_staff_ids uuid[],
  foreman_names text[],
  pm_staff_id uuid,
  pm_name text,
  pm_user_id uuid,
  last_reminded_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH cfg AS (
    SELECT s.*, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date AS today FROM site_report_settings s
  ),
  me AS (
    SELECT current_staff_id() AS staff_id,
           get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role]) AS is_exec
  ),
  foremen AS (
    SELECT a.project_id, array_agg(DISTINCT s.id) AS ids, array_agg(DISTINCT s.employee_name) AS names
    FROM staff_assignments a JOIN staff s ON s.id = a.staff_id
    WHERE a.active AND a.project_id IS NOT NULL
      AND (lower(s.role) = 'site_foreman' OR lower(replace(a.role, ' ', '_')) = 'site_foreman')
    GROUP BY a.project_id
  ),
  sites AS (
    SELECT p.id, p.project_name, p.start_date, p.project_manager_id, f.ids, f.names,
           EXISTS (SELECT 1 FROM work_orders w WHERE w.project_id = p.id
                   AND w.status NOT IN ('completed', 'cancelled')) AS has_open_wo
    FROM projects p JOIN foremen f ON f.project_id = p.id, me
    WHERE p.handed_over_at IS NULL
      AND (p_project_id IS NULL OR p.id = p_project_id)
      AND (me.is_exec OR p.project_manager_id = me.staff_id OR f.ids @> ARRAY[me.staff_id])
  ),
  days AS (
    SELECT s.*, d::date AS day
    FROM sites s, cfg,
         generate_series(greatest(cfg.tracking_from, cfg.today - cfg.lookback_days, coalesce(s.start_date, cfg.tracking_from)),
                         cfg.today - 1, interval '1 day') d
    WHERE extract(isodow FROM d)::int = ANY (cfg.work_days)
      AND NOT EXISTS (SELECT 1 FROM company_events e
                      WHERE e.event_type = 'holiday' AND e.recipient_staff_id IS NULL AND e.event_date = d::date)
  ),
  scored AS (
    SELECT dd.*,
      (EXISTS (SELECT 1 FROM wo_attendance_log l WHERE l.project_id = dd.id AND l.log_date = dd.day)
       OR EXISTS (SELECT 1 FROM wo_progress_updates u JOIN work_orders w ON w.id = u.work_order_id
                  WHERE w.project_id = dd.id AND (u.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date = dd.day)
       OR EXISTS (SELECT 1 FROM site_material_receipts r
                  WHERE r.project_id = dd.id AND (coalesce(r.received_at, r.created_at) AT TIME ZONE 'Africa/Addis_Ababa')::date = dd.day)
      ) AS activity
    FROM days dd
  )
  SELECT sc.id, sc.project_name, sc.day,
         CASE WHEN dr.id IS NOT NULL THEN 'draft' ELSE 'missing' END,
         dr.id,
         sc.activity,
         sc.ids, sc.names,
         sc.project_manager_id, pm.employee_name, pm.user_id,
         (SELECT max(n.created_at) FROM site_report_nudges n
           WHERE n.project_id = sc.id AND sc.day = ANY (n.report_dates))
  FROM scored sc
  LEFT JOIN staff pm ON pm.id = sc.project_manager_id
  LEFT JOIN LATERAL (
    SELECT r.id FROM site_daily_reports r
    WHERE r.project_id = sc.id AND r.report_date = sc.day AND r.submitted_at IS NULL
    ORDER BY r.updated_at DESC NULLS LAST LIMIT 1
  ) dr ON true
  WHERE (sc.has_open_wo OR sc.activity)
    AND NOT EXISTS (SELECT 1 FROM site_daily_reports r
                    WHERE r.project_id = sc.id AND r.report_date = sc.day AND r.submitted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM site_report_excused_days x WHERE x.project_id = sc.id AND x.report_date = sc.day)
    AND NOT EXISTS (SELECT 1 FROM site_report_pauses ps
                    WHERE ps.project_id = sc.id
                      AND sc.day >= ps.paused_from AND (ps.paused_until IS NULL OR sc.day <= ps.paused_until))
  ORDER BY sc.project_name, sc.day;
$$;
GRANT EXECUTE ON FUNCTION site_report_gaps(uuid) TO authenticated;

-- What the signed-in user should be nudged about: days behind on sites they
-- manage, and days (plus reminders) on sites where they are the foreman.
CREATE OR REPLACE FUNCTION site_report_nudge_summary()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (SELECT current_staff_id() AS staff_id),
  g AS (SELECT * FROM site_report_gaps(NULL)),
  today AS (SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date AS d)
  SELECT jsonb_build_object(
    'as_pm', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'oldest')
      FROM (
        SELECT jsonb_build_object(
          'project_id', g.project_id,
          'project_name', min(g.project_name),
          'dates', jsonb_agg(g.report_date ORDER BY g.report_date),
          'drafts', count(*) FILTER (WHERE g.state = 'draft'),
          'with_activity', count(*) FILTER (WHERE g.had_activity),
          'oldest', min(g.report_date),
          'foremen', jsonb_agg(to_jsonb(g.foreman_names))->0,
          'last_reminded_at', max(g.last_reminded_at)
        ) AS x
        FROM g, me WHERE g.pm_staff_id = me.staff_id
        GROUP BY g.project_id
      ) s), '[]'::jsonb),
    'as_foreman', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'oldest')
      FROM (
        SELECT jsonb_build_object(
          'project_id', g.project_id,
          'project_name', min(g.project_name),
          'days', jsonb_agg(jsonb_build_object('date', g.report_date, 'draft_id', g.draft_id) ORDER BY g.report_date),
          'oldest', min(g.report_date),
          'pm_name', min(g.pm_name),
          'reminder', (
            SELECT jsonb_build_object('from', coalesce(fs.employee_name, 'Management'), 'message', n.message, 'at', n.created_at)
            FROM site_report_nudges n LEFT JOIN staff fs ON fs.id = n.from_staff_id
            WHERE n.project_id = g.project_id AND n.to_staff_id = me.staff_id
              AND n.report_dates && array_agg(g.report_date)
            ORDER BY n.created_at DESC LIMIT 1)
        ) AS x
        FROM g, me WHERE g.foreman_staff_ids @> ARRAY[me.staff_id]
        GROUP BY g.project_id, me.staff_id
      ) s), '[]'::jsonb),
    -- Sites where the foreman has not sent today's report yet (not late).
    'due_today', coalesce((
      SELECT jsonb_agg(jsonb_build_object('project_id', p.id, 'project_name', p.project_name))
      FROM projects p, me, today, site_report_settings cfg
      WHERE p.handed_over_at IS NULL
        AND is_site_foreman_for_project(p.id)
        AND extract(isodow FROM today.d)::int = ANY (cfg.work_days)
        AND EXISTS (SELECT 1 FROM work_orders w WHERE w.project_id = p.id AND w.status NOT IN ('completed', 'cancelled'))
        AND NOT EXISTS (SELECT 1 FROM site_daily_reports r WHERE r.project_id = p.id AND r.report_date = today.d AND r.submitted_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM site_report_pauses ps WHERE ps.project_id = p.id
                          AND today.d >= ps.paused_from AND (ps.paused_until IS NULL OR today.d <= ps.paused_until))
    ), '[]'::jsonb)
  );
$$;
GRANT EXECUTE ON FUNCTION site_report_nudge_summary() TO authenticated;

-- PM → foremen: "please send these days".
CREATE OR REPLACE FUNCTION site_report_remind(p_project_id uuid, p_dates date[], p_message text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT site_report_can_manage(p_project_id) THEN
    RAISE EXCEPTION 'Only the project manager or management can send reminders for this site';
  END IF;
  IF p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RAISE EXCEPTION 'Pick at least one day';
  END IF;
  INSERT INTO site_report_nudges (project_id, report_dates, from_staff_id, to_staff_id, message)
  SELECT p_project_id, p_dates, current_staff_id(), s.id, nullif(trim(p_message), '')
  FROM (SELECT DISTINCT s.id
        FROM staff_assignments a JOIN staff s ON s.id = a.staff_id
        WHERE a.active AND a.project_id = p_project_id
          AND (lower(s.role) = 'site_foreman' OR lower(replace(a.role, ' ', '_')) = 'site_foreman')
          AND s.id IS DISTINCT FROM current_staff_id()) s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
GRANT EXECUTE ON FUNCTION site_report_remind(uuid, date[], text) TO authenticated;

-- PM: these days needed no report (site closed, no work).
CREATE OR REPLACE FUNCTION site_report_excuse(p_project_id uuid, p_dates date[], p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT site_report_can_manage(p_project_id) THEN
    RAISE EXCEPTION 'Only the project manager or management can excuse days for this site';
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Say why no report was needed';
  END IF;
  INSERT INTO site_report_excused_days (project_id, report_date, reason, excused_by_staff_id)
  SELECT p_project_id, d, trim(p_reason), current_staff_id() FROM unnest(p_dates) d
  ON CONFLICT (project_id, report_date) DO UPDATE SET reason = EXCLUDED.reason, excused_by_staff_id = EXCLUDED.excused_by_staff_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
GRANT EXECUTE ON FUNCTION site_report_excuse(uuid, date[], text) TO authenticated;

-- PM: the site is on hold; stop expecting reports (until a date, or until resumed).
CREATE OR REPLACE FUNCTION site_report_pause(p_project_id uuid, p_reason text, p_from date DEFAULT NULL, p_until date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT site_report_can_manage(p_project_id) THEN
    RAISE EXCEPTION 'Only the project manager or management can pause reporting for this site';
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Say why the site is on hold';
  END IF;
  INSERT INTO site_report_pauses (project_id, paused_from, paused_until, reason, created_by_staff_id)
  VALUES (p_project_id, coalesce(p_from, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date - 60), p_until, trim(p_reason), current_staff_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION site_report_pause(uuid, text, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION site_report_resume(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF NOT site_report_can_manage(p_project_id) THEN
    RAISE EXCEPTION 'Only the project manager or management can resume reporting for this site';
  END IF;
  -- The days on hold stay excused; reports are expected again from today.
  UPDATE site_report_pauses SET ended_at = now(), paused_until = greatest(paused_from, v_today - 1)
  WHERE project_id = p_project_id AND ended_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
GRANT EXECUTE ON FUNCTION site_report_resume(uuid) TO authenticated;

-- ── Operations health: sites falling behind ──────────────────────────────
DO $$
DECLARE
  d text := pg_get_viewdef('v_ops_health_items'::regclass);
BEGIN
  IF position('site_report_missing' IN d) > 0 THEN
    RETURN;
  END IF;
  d := rtrim(rtrim(d), ';') || $branch$
UNION ALL
 SELECT 'site_report_missing'::text AS kind,
    (g.project_id)::text AS ref_id,
    min(g.project_name) AS title,
    ((count(*) || ' working days without a report · since '::text) || to_char(min(g.report_date)::timestamp with time zone, 'DD Mon'::text)) AS detail,
    NULL::numeric AS amount,
    min(g.report_date) AS since,
    'project'::text AS owner_team,
    min(g.pm_name) AS owner_name,
    (array_agg(g.pm_user_id))[1] AS owner_user_id,
    ('/site-foreman/reports?project='::text || g.project_id) AS link,
    (count(*) >= 2 * (SELECT escalate_after_days FROM site_report_settings)) AS urgent
   FROM site_report_gaps(NULL::uuid) g
  GROUP BY g.project_id
 HAVING count(*) >= (SELECT escalate_after_days FROM site_report_settings)
$branch$;
  EXECUTE 'CREATE OR REPLACE VIEW v_ops_health_items WITH (security_invoker = on) AS ' || d;
END $$;
