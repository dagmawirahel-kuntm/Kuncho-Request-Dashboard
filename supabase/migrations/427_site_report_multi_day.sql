-- Daily site report: one summary may cover up to three days.
--
-- A foreman or PM who could not report each evening (no signal, a long
-- pour, a holiday weekend) can send one report for the last 2 or 3 days
-- instead of three thin ones. The report keeps its report_date (the last
-- day it covers) and gains covers_from (the first). Every day in between
-- counts as reported for the missing-days checks, the PM's list and the
-- nudges (migration 421).
--
-- Rules, enforced here:
--   * at most 3 days: covers_from between report_date - 2 and report_date
--   * two sent reports from the same person for the same site never cover
--     the same day
--   * sending a summary marks that person's unsent drafts for the days it
--     covers as superseded_by it (kept for the record, no longer offered)

ALTER TABLE site_daily_reports
  ADD COLUMN IF NOT EXISTS covers_from date,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES site_daily_reports(id) ON DELETE SET NULL;
COMMENT ON COLUMN site_daily_reports.superseded_by IS
  'A draft replaced by a multi-day summary that covers its day (migration 427).';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_daily_reports_covers_3_days') THEN
    ALTER TABLE site_daily_reports ADD CONSTRAINT site_daily_reports_covers_3_days
      CHECK (covers_from IS NULL OR (covers_from >= report_date - 2 AND covers_from <= report_date));
  END IF;
END $$;
COMMENT ON COLUMN site_daily_reports.covers_from IS
  'First day a multi-day summary covers (up to 3 days, ending on report_date). NULL: just report_date (migration 427).';

CREATE INDEX IF NOT EXISTS idx_sdr_project_cover
  ON site_daily_reports (project_id, report_date, covers_from) WHERE submitted_at IS NOT NULL;

-- One sent report per person, site and day.
CREATE OR REPLACE FUNCTION site_report_cover_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_from date;
  v_clash date;
BEGIN
  IF NEW.covers_from = NEW.report_date THEN NEW.covers_from := NULL; END IF;
  IF NEW.submitted_at IS NULL THEN RETURN NEW; END IF;
  v_from := COALESCE(NEW.covers_from, NEW.report_date);

  SELECT r.report_date INTO v_clash FROM site_daily_reports r
  WHERE r.project_id = NEW.project_id AND r.foreman_staff_id = NEW.foreman_staff_id
    AND r.id <> NEW.id AND r.submitted_at IS NOT NULL
    AND COALESCE(r.covers_from, r.report_date) <= NEW.report_date
    AND r.report_date >= v_from
  LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'You already sent a report that covers %: pick days after it', to_char(v_clash, 'DD Mon');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_site_report_cover_guard
  BEFORE INSERT OR UPDATE OF submitted_at, covers_from, report_date ON site_daily_reports
  FOR EACH ROW EXECUTE FUNCTION site_report_cover_guard();

-- After a summary is sent: its drafts for the covered days are superseded.
CREATE OR REPLACE FUNCTION site_report_supersede_drafts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.submitted_at IS NULL OR NEW.covers_from IS NULL THEN RETURN NEW; END IF;
  UPDATE site_daily_reports r SET superseded_by = NEW.id
  WHERE r.project_id = NEW.project_id AND r.foreman_staff_id = NEW.foreman_staff_id
    AND r.id <> NEW.id AND r.submitted_at IS NULL AND r.superseded_by IS NULL
    AND r.report_date BETWEEN NEW.covers_from AND NEW.report_date;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_site_report_supersede_drafts
  AFTER INSERT OR UPDATE OF submitted_at ON site_daily_reports
  FOR EACH ROW EXECUTE FUNCTION site_report_supersede_drafts();

-- Which days need a report: a sent summary covers every day in its range.
-- (Same function as 421; only the "is this day reported" tests change.)
CREATE OR REPLACE FUNCTION site_report_gaps(p_project_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(project_id uuid, project_name text, report_date date, state text, draft_id uuid, had_activity boolean, foreman_staff_ids uuid[], foreman_names text[], pm_staff_id uuid, pm_name text, pm_user_id uuid, last_reminded_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    WHERE r.project_id = sc.id AND sc.day BETWEEN coalesce(r.covers_from, r.report_date) AND r.report_date
      AND r.submitted_at IS NULL AND r.superseded_by IS NULL
    ORDER BY r.updated_at DESC NULLS LAST LIMIT 1
  ) dr ON true
  WHERE (sc.has_open_wo OR sc.activity)
    AND NOT EXISTS (SELECT 1 FROM site_daily_reports r
                    WHERE r.project_id = sc.id AND r.submitted_at IS NOT NULL
                      AND sc.day BETWEEN coalesce(r.covers_from, r.report_date) AND r.report_date)
    AND NOT EXISTS (SELECT 1 FROM site_report_excused_days x WHERE x.project_id = sc.id AND x.report_date = sc.day)
    AND NOT EXISTS (SELECT 1 FROM site_report_pauses ps
                    WHERE ps.project_id = sc.id
                      AND sc.day >= ps.paused_from AND (ps.paused_until IS NULL OR sc.day <= ps.paused_until))
  ORDER BY sc.project_name, sc.day;
$function$;

-- "Due today" also counts a summary that ends today.
CREATE OR REPLACE FUNCTION site_report_nudge_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'due_today', coalesce((
      SELECT jsonb_agg(jsonb_build_object('project_id', p.id, 'project_name', p.project_name))
      FROM projects p, today, site_report_settings cfg
      WHERE p.handed_over_at IS NULL
        AND is_site_foreman_for_project(p.id)
        AND extract(isodow FROM today.d)::int = ANY (cfg.work_days)
        AND EXISTS (SELECT 1 FROM work_orders w WHERE w.project_id = p.id AND w.status NOT IN ('completed', 'cancelled'))
        AND NOT EXISTS (SELECT 1 FROM site_daily_reports r WHERE r.project_id = p.id AND r.submitted_at IS NOT NULL
                          AND today.d BETWEEN coalesce(r.covers_from, r.report_date) AND r.report_date)
        AND NOT EXISTS (SELECT 1 FROM site_report_pauses ps WHERE ps.project_id = p.id
                          AND today.d >= ps.paused_from AND (ps.paused_until IS NULL OR today.d <= ps.paused_until))
    ), '[]'::jsonb)
  );
$function$;
