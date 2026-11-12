-- 514 — labour tidies itself, and says once a morning what's waiting
--
-- What the data said on 12 Nov:
--   * 120 approved labour requests were still open; 98 had ended more than
--     two weeks before and 75 never had a day recorded. Ending them was a
--     button someone had to remember (476).
--   * Money stalled between steps with nobody told: ETB 278,477 of
--     confirmed pay in no payment request (the oldest a month old), five
--     drafts never sent, an approved request unpaid for 13 days, seven
--     labour requests waiting over two months for a decision.
--   * The bell is noise: finance got ~450 notifications in a month and read
--     almost none; no project manager is linked to Telegram.
--
-- So:
--   labour_auto_close()     nightly: ends approved requests 14+ days past
--                           their end date with no unpaid work and nothing
--                           recorded for three weeks. Workers are released,
--                           the commitment closed; days already recorded can
--                           still be paid; "Reopen with a new end date"
--                           brings one back. Each requester gets one line.
--   labour_waiting_for()    what labour is waiting on one person, in words
--                           that say who is waiting and for how much.
--   labour_nudge_daily()    Monday to Saturday morning: one message each
--                           (the bell, Telegram where linked, the morning
--                           email), only when something is waiting.

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order) VALUES
  ('labour.waiting',     'Labour', 'Labour waiting on you',               'One message a morning: days not recorded, pay not sent on, requests to approve or pay', 'high', 34),
  ('labour.auto_closed', 'Labour', 'Labour requests ended automatically', 'Yours, two weeks past their end date with no work recorded',                            'low',  35)
ON CONFLICT (kind) DO UPDATE SET grp = EXCLUDED.grp, label = EXCLUDED.label, description = EXCLUDED.description;

-- ── Auto-close ──────────────────────────────────────────────────────────────
-- Run by the nightly job (no user), or by hand by admin or operations.
-- p_dry_run counts what it would end and changes nothing.
CREATE OR REPLACE FUNCTION public.labour_auto_close(p_dry_run boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r record; v_ids uuid[] := '{}';
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()) THEN
    RAISE EXCEPTION 'Only admin or operations can end labour requests in bulk';
  END IF;
  SELECT COALESCE(array_agg(q.id), '{}') INTO v_ids
    FROM labor_requisitions q
   WHERE q.status = 'approved' AND q.closed_at IS NULL
     AND q.end_date < CURRENT_DATE - 14 AND q.created_at < now() - interval '21 days'
     -- nothing recorded that isn't on a pay sheet, and nothing recorded lately
     AND NOT EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = q.id
                      AND (e.work_date > CURRENT_DATE - 21
                           OR (e.pay_sheet_id IS NULL AND (COALESCE(e.hours, 0) > 0 OR COALESCE(e.overtime_hours, 0) > 0
                                                           OR COALESCE(e.quantity, 0) > 0 OR COALESCE(e.percent_done, 0) > 0))))
     AND NOT EXISTS (SELECT 1 FROM wo_attendance_log l WHERE l.labor_requisition_id = q.id AND l.log_date > CURRENT_DATE - 21)
     AND NOT EXISTS (SELECT 1 FROM v_labour_unpaid u WHERE u.labor_requisition_id = q.id);
  IF p_dry_run OR cardinality(v_ids) = 0 THEN RETURN cardinality(v_ids); END IF;

  -- The request's history names who did it; here, nobody did.
  IF auth.uid() IS NULL THEN PERFORM set_config('kuncho.bot_name', 'Kuncho (automatic)', true); END IF;

  UPDATE labor_requisitions
     SET closed_at = now(), closed_by = auth.uid(),
         close_reason = 'Ended automatically: two weeks past its end date with no work recorded'
   WHERE id = ANY (v_ids) AND closed_at IS NULL;
  UPDATE labor_allocations
     SET status = 'completed', end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
   WHERE labor_requisition_id = ANY (v_ids) AND status IN ('active', 'planned');
  UPDATE labor_commitments SET status = 'closed', updated_at = now() WHERE labor_requisition_id = ANY (v_ids);

  -- One line to each person who asked, however many of theirs ended.
  FOR r IN
    SELECT q.requested_by, count(*) AS n,
           string_agg(q.role_needed || COALESCE(' · ' || btrim(p.project_name), ''), '; ' ORDER BY q.end_date DESC) FILTER (WHERE q.rn <= 4) AS some
      FROM (SELECT x.*, row_number() OVER (PARTITION BY x.requested_by ORDER BY x.end_date DESC) AS rn
              FROM labor_requisitions x WHERE x.id = ANY (v_ids)) q
      LEFT JOIN projects p ON p.id = q.project_id
     WHERE q.requested_by IS NOT NULL
     GROUP BY q.requested_by
  LOOP
    PERFORM notify(ARRAY[r.requested_by], 'labour.auto_closed',
      r.n || CASE WHEN r.n = 1 THEN ' of your labour requests was' ELSE ' of your labour requests were' END || ' ended automatically',
      'Two weeks past the end date with no work recorded: ' || r.some || CASE WHEN r.n > 4 THEN ' and ' || (r.n - 4) || ' more' ELSE '' END
        || '. Days already recorded can still be paid. Still going on? Open it and choose "Reopen with a new end date".',
      '/labour', NULL, NULL, NULL, 'labour.auto_closed:' || CURRENT_DATE, '{}'::jsonb, true);
  END LOOP;
  RETURN cardinality(v_ids);
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_auto_close(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_auto_close(boolean) TO authenticated;

-- ── What labour is waiting on one person ────────────────────────────────────
-- A line per kind of thing, most pressing first. Site work is the site
-- manager's; payment requests are their maker's, then finance's; approvals
-- are operations', HR's and admin's. Operations also sees every site.
CREATE OR REPLACE FUNCTION public.labour_waiting_for(p_user uuid)
RETURNS TABLE(what text, n integer, line text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_role text; v_ops boolean; v_staff uuid;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_day date;
  v_rest integer := COALESCE((SELECT rest_day FROM labour_overtime_settings LIMIT 1), 0);
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user AND COALESCE(get_user_role()::text, '') <> 'admin' THEN RETURN; END IF;
  SELECT u.role::text, (u.role = 'operations_manager' OR COALESCE(u.is_operations_manager, false))
    INTO v_role, v_ops FROM user_profiles u WHERE u.id = p_user AND u.account_status = 'active';
  IF v_role IS NULL THEN RETURN; END IF;
  v_staff := (SELECT s.id FROM staff s
               WHERE s.user_id = p_user
                  OR (s.email IS NOT NULL AND lower(s.email) = lower((SELECT u.email FROM auth.users u WHERE u.id = p_user)))
               ORDER BY (s.user_id = p_user) DESC NULLS LAST LIMIT 1);
  -- The last working day before today.
  v_day := v_today - 1;
  IF extract(dow FROM v_day)::int = v_rest THEN v_day := v_day - 1; END IF;

  RETURN QUERY
  WITH my_sites AS (
    SELECT p.id, btrim(p.project_name) AS name FROM projects p
     WHERE v_ops OR (v_staff IS NOT NULL AND p.project_manager_id = v_staff)
  ),
  -- 1. Day workers on site on the last working day, and nothing recorded.
  unrecorded AS (
    SELECT s.name, (SELECT count(DISTINCT a.staff_id) FROM labor_requisitions q
                      JOIN labor_allocations a ON a.labor_requisition_id = q.id AND a.status = 'active'
                     WHERE q.project_id = s.id AND q.status = 'approved' AND q.closed_at IS NULL AND q.payment_basis = 'per_day'
                       AND COALESCE(q.start_date, v_day) <= v_day AND (q.end_date IS NULL OR q.end_date >= v_day))::int AS workers
      FROM my_sites s
     WHERE NOT EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.project_id = s.id AND e.work_date = v_day)
       AND NOT EXISTS (SELECT 1 FROM labour_days d JOIN labour_day_allocations x ON x.day_id = d.id
                        WHERE d.work_date = v_day AND x.project_id = s.id)
  ),
  -- 2. Pay confirmed, in no payment request (as labour_payable_drafts, 479).
  payable AS (
    SELECT e.id, e.amount_etb, COALESCE(ps.confirmed_at, e.created_at)::date AS since,
           (SELECT count(*) FROM labor_expense_workers w WHERE w.expense_id = e.id)::int AS workers
      FROM expenses e
      LEFT JOIN labour_pay_sheets ps ON ps.expense_id = e.id
      LEFT JOIN labour_pay_holds h ON h.expense_id = e.id
     WHERE (ps.id IS NOT NULL OR h.expense_id IS NOT NULL)
       AND e.approval_status = 'pending' AND COALESCE(e.payment_state, 'unpaid') = 'unpaid'
       AND NOT COALESCE(e.is_archived, false)
       AND NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
                        WHERE i.expense_id = e.id AND i.removed_at IS NULL AND q.status NOT IN ('cancelled'))
       AND (e.project_id IN (SELECT id FROM my_sites) OR (v_staff IS NOT NULL AND ps.pm_staff_id = v_staff))
  ),
  -- 3. Payment requests started and not sent, or sent back.
  drafts AS (
    SELECT q.code, q.status, q.returned_reason FROM labour_pay_requests q
     WHERE q.created_by = p_user AND q.status IN ('draft', 'returned') AND q.updated_at < now() - interval '20 hours'
  ),
  -- 4. Payment requests for finance: to approve, and approved but not paid.
  fin AS (
    SELECT q.id, q.status, COALESCE(q.approved_at, q.submitted_at)::date AS since,
           (SELECT COALESCE(sum(e.amount_etb), 0) FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
             WHERE i.request_id = q.id AND i.removed_at IS NULL) AS amount,
           (SELECT count(DISTINCT w.staff_id) FROM labour_pay_request_items i JOIN labor_expense_workers w ON w.expense_id = i.expense_id
             WHERE i.request_id = q.id AND i.removed_at IS NULL)::int AS workers
      FROM labour_pay_requests q
     WHERE v_role IN ('finance', 'admin') AND q.status IN ('submitted', 'approved')
  ),
  -- 5. Labour requests waiting for a decision.
  pending AS (
    SELECT q.created_at::date AS since FROM labor_requisitions q
     WHERE (v_role IN ('admin', 'operations_manager', 'hr_officer') OR v_ops)
       AND q.status = 'pending' AND q.created_at < now() - interval '2 days'
  )
  SELECT 'record'::text, count(*)::int,
         CASE WHEN count(*) = 1 THEN max(u.name) || ': ' || max(u.workers) || ' day worker' || CASE WHEN max(u.workers) = 1 THEN '' ELSE 's' END
                                     || ', ' || to_char(v_day, 'FMDay') || ' isn''t recorded yet'
              ELSE count(*) || ' sites haven''t recorded ' || to_char(v_day, 'FMDay') || ' (' || sum(u.workers) || ' day workers): '
                   || string_agg(u.name, ', ' ORDER BY u.workers DESC) END
    FROM unrecorded u WHERE u.workers > 0 HAVING count(*) > 0
  UNION ALL
  SELECT 'request', count(*)::int,
         sum(p.workers) || ' worker' || CASE WHEN sum(p.workers) = 1 THEN ' is' ELSE 's are' END || ' waiting for ' || notify_etb(sum(p.amount_etb))
           || ': confirmed, but not in a payment request yet'
           || CASE WHEN v_today - min(p.since) >= 3 THEN ' (the oldest for ' || (v_today - min(p.since)) || ' days)' ELSE '' END
    FROM payable p HAVING count(*) > 0
  UNION ALL
  SELECT 'draft', count(*)::int,
         CASE WHEN count(*) FILTER (WHERE d.status = 'returned') > 0
              THEN count(*) FILTER (WHERE d.status = 'returned') || ' payment request' || CASE WHEN count(*) FILTER (WHERE d.status = 'returned') = 1 THEN '' ELSE 's' END
                   || ' sent back by finance to fix (' || string_agg(d.code, ', ') FILTER (WHERE d.status = 'returned') || ')'
                   || CASE WHEN count(*) FILTER (WHERE d.status = 'draft') > 0 THEN '; ' || count(*) FILTER (WHERE d.status = 'draft') || ' more started and not sent' ELSE '' END
              ELSE count(*) || ' payment request' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' started and not sent to finance (' || string_agg(d.code, ', ') || ')' END
    FROM drafts d HAVING count(*) > 0
  UNION ALL
  SELECT 'approve_pay', count(*)::int,
         count(*) || ' payment request' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' to approve: ' || notify_etb(sum(f.amount)) || ' for ' || sum(f.workers) || ' workers'
    FROM fin f WHERE f.status = 'submitted' HAVING count(*) > 0
  UNION ALL
  SELECT 'pay', count(*)::int,
         count(*) || ' approved payment request' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' not paid yet: ' || sum(f.workers) || ' workers waiting for '
           || notify_etb(sum(f.amount)) || CASE WHEN v_today - min(f.since) >= 2 THEN ' (the oldest approved ' || (v_today - min(f.since)) || ' days ago)' ELSE '' END
    FROM fin f WHERE f.status = 'approved' HAVING count(*) > 0
  UNION ALL
  SELECT 'approve', count(*)::int,
         count(*) || ' labour request' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' waiting for a decision'
           || CASE WHEN v_today - min(pe.since) >= 7 THEN ' (the oldest for ' || (v_today - min(pe.since)) || ' days)' ELSE '' END
    FROM pending pe HAVING count(*) > 0;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_waiting_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_waiting_for(uuid) TO authenticated;

-- One message a morning to everyone labour is waiting on.
CREATE OR REPLACE FUNCTION public.labour_nudge_daily()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE u record; v_lines text[]; v_n integer := 0;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND COALESCE(get_user_role()::text, '') <> 'admin' THEN
    RAISE EXCEPTION 'Only admin can send the labour reminders by hand';
  END IF;
  FOR u IN
    SELECT p.id FROM user_profiles p
     WHERE p.account_status = 'active'
       AND p.role::text IN ('admin', 'finance', 'operations_manager', 'hr_officer', 'project_manager')
  LOOP
    SELECT array_agg(w.line) INTO v_lines FROM labour_waiting_for(u.id) w;
    CONTINUE WHEN v_lines IS NULL OR cardinality(v_lines) = 0;
    v_n := v_n + notify(ARRAY[u.id], 'labour.waiting',
      CASE WHEN cardinality(v_lines) = 1 THEN 'Labour: ' || v_lines[1] ELSE 'Labour: ' || cardinality(v_lines) || ' things are waiting on you' END,
      CASE WHEN cardinality(v_lines) = 1 THEN NULL ELSE '• ' || array_to_string(v_lines, E'\n• ') END,
      '/labour', NULL, NULL, NULL, 'labour.waiting:' || v_today, '{}'::jsonb, true);
  END LOOP;
  RETURN v_n;
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_nudge_daily() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_nudge_daily() TO authenticated;

-- 02:10 in Addis every night; 08:30 in Addis, Monday to Saturday.
SELECT cron.schedule('kuncho-labour-auto-close', '10 23 * * *', 'SELECT public.labour_auto_close()');
SELECT cron.schedule('kuncho-labour-nudge', '30 5 * * 1-6', 'SELECT public.labour_nudge_daily()');
