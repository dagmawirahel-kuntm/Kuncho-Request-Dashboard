-- 494: PMs record their week, by a weekly deadline.
-- PMs fill in attendance at the end of the week. A week can be entered on one
-- grid and sent in one go (the day sheet still works day by day), and each
-- day is due by the end of its week's deadline day — Saturday unless
-- operations changes it. Flags wait for the deadline instead of the next
-- morning. Operations can lock every sent day that adds up in one go.

ALTER TABLE labour_day_settings ADD COLUMN IF NOT EXISTS week_due_dow smallint NOT NULL DEFAULT 6 CHECK (week_due_dow BETWEEN 1 AND 7);

-- The deadline for a day: the first deadline weekday on or after it.
CREATE OR REPLACE FUNCTION public.labour_day_due(p_date date)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p_date + ((COALESCE((SELECT week_due_dow FROM labour_day_settings WHERE id), 6) - extract(isodow FROM p_date)::int + 7) % 7);
$f$;

-- Operations sets the weekday a week's days are due by.
CREATE OR REPLACE FUNCTION public.set_labour_week_due(p_dow smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'operations_manager') AND NOT COALESCE(is_ops_manager(), false) THEN
    RAISE EXCEPTION 'Only admin or operations change the daily labour settings';
  END IF;
  IF p_dow NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'Pick a day of the week'; END IF;
  UPDATE labour_day_settings SET week_due_dow = p_dow, updated_at = now(), updated_by = auth.uid() WHERE id;
END $f$;

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
                                      WHEN b.status = 'none' OR (b.workers = 0 AND b.jobs = 0) THEN format('%s asked for, nothing recorded by %s', b.requested, to_char(labour_day_due(b.work_date), 'Dy DD Mon'))
                                      WHEN b.status = 'open' THEN format('Not sent by %s', to_char(labour_day_due(b.work_date), 'Dy DD Mon'))
                                      ELSE 'Sent, not reviewed yet' END) ORDER BY b.work_date DESC, b.pm_name)
                        FROM board b
                       WHERE (v_all OR b.pm_staff_id = v_me)
                         -- A PM has until their week's deadline (494) to record and send a day.
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
END $f$;

-- Save a PM's week: each day as labour_day_save would (the same checks), in
-- one go. p_days: [{date, workers, jobs}]. A day that fails names its date.
CREATE OR REPLACE FUNCTION public.labour_week_save(p_pm uuid, p_days jsonb, p_submit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE x jsonb; v_date date; v_res jsonb; v_out jsonb := '[]'::jsonb; v_mis int := 0;
BEGIN
  IF NOT labour_day_can_run(p_pm) THEN RAISE EXCEPTION 'You record the week for your own workers'; END IF;
  IF jsonb_array_length(COALESCE(p_days, '[]'::jsonb)) > 7 THEN RAISE EXCEPTION 'A week has at most 7 days'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb)) LOOP
    v_date := (x->>'date')::date;
    BEGIN
      v_res := labour_day_save(p_pm, v_date, COALESCE(x->'workers', '[]'::jsonb), p_submit, NULL, COALESCE(x->'jobs', '[]'::jsonb));
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%: %', to_char(v_date, 'Dy DD Mon'), SQLERRM;
    END;
    v_mis := v_mis + COALESCE((v_res->>'mismatches')::int, 0);
    v_out := v_out || jsonb_build_object('date', v_date, 'status', v_res->>'status', 'mismatches', v_res->'mismatches');
  END LOOP;
  RETURN jsonb_build_object('days', v_out, 'mismatches', v_mis);
END $f$;

-- Operations locks every sent day in the list that adds up; returns how many.
CREATE OR REPLACE FUNCTION public.labour_days_lock_many(p_days uuid[], p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v uuid; n int := 0;
BEGIN
  IF NOT labour_day_is_approver() THEN RAISE EXCEPTION 'Operations locks the day after review'; END IF;
  FOREACH v IN ARRAY COALESCE(p_days, '{}') LOOP
    IF EXISTS (SELECT 1 FROM labour_days d WHERE d.id = v AND d.status = 'submitted') AND labour_day_mismatches(v) = 0 THEN
      PERFORM labour_day_lock(v, p_note);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $f$;
