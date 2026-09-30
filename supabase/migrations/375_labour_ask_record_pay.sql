-- 375 — Labour: ask, record, pay
--
-- Labour had grown four copies of the same day's work (work-order log,
-- timesheet, timesheet attendance, the manual timesheet), kept in step by
-- triggers that had been rewritten again and again; attendance could only
-- be recorded through an in-progress work order, by the site foreman; and a
-- request for "3 labourers" could never be filled. Nothing had been recorded
-- for three weeks. This starts again on the same requests:
--
--   * A request is paid by the day (hours worked, 8 to a day), by quantity
--     (m², pieces…) or at a fixed price for a task, paid as it is done.
--   * The operations manager or HR approves it.
--   * Workers can be added to a request at any time — someone from the
--     roster or a new person by name and phone. Once it is approved they are
--     on it straight away.
--   * One place for recorded work: labour_work_entries. The site foreman or
--     the project manager records a day for a site: hours, quantity or % of
--     the task done. No work order needed.
--   * The project manager confirms what is owed on a request up to a date.
--     That files a pay sheet and the payable finance approves and pays,
--     through the same expenses as before.
--   * Every request keeps a timeline — asked, approved, workers added, pay
--     confirmed, approved and paid by finance — with comments, so people
--     stop chasing each other by phone.
--
-- Work recorded the old way stays where it is and is still paid from
-- Finance → Labour pay until it is cleared.

SET search_path TO public;

-- ── 1. Fixed-price tasks ─────────────────────────────────────────────
ALTER TABLE labor_requisitions ADD COLUMN IF NOT EXISTS fixed_price_amount numeric;
ALTER TABLE labor_requisitions DROP CONSTRAINT IF EXISTS labor_req_payment_basis_chk;
ALTER TABLE labor_requisitions ADD CONSTRAINT labor_req_payment_basis_chk
  CHECK (payment_basis IN ('per_day', 'per_volume', 'fixed_price'));
ALTER TABLE labor_requisitions DROP CONSTRAINT IF EXISTS labor_req_total_volume_chk;
ALTER TABLE labor_requisitions ADD CONSTRAINT labor_req_total_volume_chk
  CHECK (payment_basis <> 'per_volume' OR (estimated_total_volume IS NOT NULL AND estimated_total_volume > 0));
ALTER TABLE labor_requisitions DROP CONSTRAINT IF EXISTS labor_req_fixed_price_chk;
ALTER TABLE labor_requisitions ADD CONSTRAINT labor_req_fixed_price_chk
  CHECK (payment_basis <> 'fixed_price' OR (fixed_price_amount IS NOT NULL AND fixed_price_amount > 0));
COMMENT ON COLUMN labor_requisitions.fixed_price_amount IS
  'For a fixed-price task (375): the agreed price for the whole task, paid in parts as it is done (% complete).';

-- ── 2. The operations manager can approve too ────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_labor_req_approval_authority()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_role user_role;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    v_role := public.get_user_role();
    IF v_role IS NULL OR v_role NOT IN ('admin', 'hr_officer', 'operations_manager') THEN
      RAISE EXCEPTION 'Only the operations manager, HR or admin may approve a labour request';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $function$;

-- The commitment knows a fixed price.
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_insert_commitment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_amount numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    v_amount := CASE
      WHEN NEW.payment_basis = 'fixed_price' THEN NEW.fixed_price_amount
      WHEN NEW.payment_basis = 'per_volume' THEN
        COALESCE(NEW.estimated_total_cost, NEW.unit_rate * COALESCE(NEW.estimated_total_volume, 0))
      ELSE
        COALESCE(
          NEW.estimated_total_cost,
          NEW.estimated_day_rate * COALESCE(NEW.estimated_days, 0) * NEW.headcount,
          (SELECT SUM(COALESCE(s.day_rate, 0))
             FROM labor_requisition_workers w
             JOIN staff s ON s.id = w.staff_id
            WHERE w.requisition_id = NEW.id) * COALESCE(NEW.estimated_days, 0)
        )
    END;
    v_amount := COALESCE(v_amount, 0);

    INSERT INTO labor_commitments
      (labor_requisition_id, project_id, committed_amount, committed_by, status, notes)
    VALUES
      (NEW.id, NEW.project_id, v_amount, NEW.approved_by, 'active', 'Auto-committed on approval')
    ON CONFLICT (labor_requisition_id) DO UPDATE
      SET committed_amount = EXCLUDED.committed_amount,
          committed_at     = now(),
          committed_by     = EXCLUDED.committed_by,
          status           = 'active',
          updated_at       = now();
  END IF;
  RETURN NEW;
END $function$;

-- ── 3. Timeline and comments ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labour_request_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  labor_requisition_id uuid NOT NULL REFERENCES labor_requisitions(id) ON DELETE CASCADE,
  kind                 text NOT NULL,
  body                 text,
  actor                uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  actor_name           text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_labour_events_req ON labour_request_events (labor_requisition_id, created_at);
COMMENT ON TABLE labour_request_events IS
  'What happened on a labour request and who said what (375): asked, approved, workers added, pay confirmed, finance approved, paid, comments.';

ALTER TABLE labour_request_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labour_events_read ON labour_request_events;
CREATE POLICY labour_events_read ON labour_request_events FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.log_labour_event(p_req uuid, p_kind text, p_body text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  INSERT INTO labour_request_events (labor_requisition_id, kind, body, actor, actor_name)
  VALUES (p_req, p_kind, NULLIF(btrim(p_body), ''), auth.uid(), (SELECT full_name FROM user_profiles WHERE id = auth.uid()));
$function$;
REVOKE EXECUTE ON FUNCTION log_labour_event(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_labour_comment(p_req uuid, p_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to comment'; END IF;
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Write something first'; END IF;
  PERFORM log_labour_event(p_req, 'comment', p_body);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_labour_request_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_labour_event(NEW.id, 'requested', NEW.notes);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
    PERFORM log_labour_event(NEW.id, NEW.status, NEW.decision_note);
  ELSIF NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL THEN
    PERFORM log_labour_event(NEW.id, 'closed', NEW.close_reason);
  ELSIF NEW.end_date IS DISTINCT FROM OLD.end_date AND OLD.end_date IS NOT NULL THEN
    PERFORM log_labour_event(NEW.id, 'extended', 'Now ends ' || to_char(NEW.end_date, 'DD Mon YYYY'));
  END IF;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_labour_request_events ON labor_requisitions;
CREATE TRIGGER trg_labour_request_events AFTER INSERT OR UPDATE ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION trg_labour_request_events();

-- Finance's side shows on the request's timeline too.
CREATE OR REPLACE FUNCTION public.trg_labour_expense_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.rolled_up_from_requisition_id IS NULL THEN RETURN NULL; END IF;
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status AND NEW.approval_status::text IN ('finance_approved', 'rejected') THEN
    PERFORM log_labour_event(NEW.rolled_up_from_requisition_id,
      CASE WHEN NEW.approval_status::text = 'rejected' THEN 'pay_rejected' ELSE 'pay_approved' END,
      format('%s ETB · %s to %s', to_char(NEW.amount_etb, 'FM999,999,990.00'),
             to_char(NEW.rollup_period_start, 'DD Mon'), to_char(NEW.rollup_period_end, 'DD Mon')));
  ELSIF NEW.payment_state IS DISTINCT FROM OLD.payment_state AND NEW.payment_state = 'paid' THEN
    PERFORM log_labour_event(NEW.rolled_up_from_requisition_id, 'paid',
      format('%s ETB · %s to %s', to_char(NEW.amount_etb, 'FM999,999,990.00'),
             to_char(NEW.rollup_period_start, 'DD Mon'), to_char(NEW.rollup_period_end, 'DD Mon')));
  END IF;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_labour_expense_events ON expenses;
CREATE TRIGGER trg_labour_expense_events AFTER UPDATE OF approval_status, payment_state ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_labour_expense_events();

-- ── 4. Who may act on a request's site ───────────────────────────────
CREATE OR REPLACE FUNCTION public.can_run_labour_site(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'executive', 'operations_manager', 'hr_officer'), false)
      OR manages_project(p_project)
      OR is_site_foreman_for_project(p_project);
$function$;

-- ── 5. Adding workers, before or after approval ──────────────────────
-- Someone already on the roster.
CREATE OR REPLACE FUNCTION public.labour_add_worker(p_req uuid, p_staff_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r      labor_requisitions%ROWTYPE;
  v_name text;
  v_rate numeric;
  v_alloc uuid;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT can_run_labour_site(r.project_id) THEN RAISE EXCEPTION 'Only the site''s team, operations or HR can add workers'; END IF;
  IF r.status = 'rejected' OR r.closed_at IS NOT NULL THEN RAISE EXCEPTION 'This request is closed'; END IF;
  SELECT employee_name, day_rate INTO v_name, v_rate FROM staff WHERE id = p_staff_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF EXISTS (SELECT 1 FROM labor_allocations WHERE labor_requisition_id = p_req AND staff_id = p_staff_id AND status = 'active') THEN
    RETURN;
  END IF;

  IF r.status = 'approved' THEN
    INSERT INTO labor_allocations (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
    VALUES (p_staff_id, r.project_id, GREATEST(COALESCE(r.start_date, CURRENT_DATE), CURRENT_DATE), r.end_date,
            CASE WHEN r.payment_basis = 'per_volume' THEN r.unit_rate ELSE COALESCE(r.estimated_day_rate, v_rate) END,
            'active', 'Added to an approved request', p_req)
    RETURNING id INTO v_alloc;
  END IF;
  INSERT INTO labor_requisition_workers (requisition_id, staff_id, allocation_id)
  VALUES (p_req, p_staff_id, v_alloc)
  ON CONFLICT DO NOTHING;
  UPDATE labor_requisitions SET headcount = GREATEST(headcount,
    (SELECT count(*) FROM labor_requisition_workers WHERE requisition_id = p_req)
    + (SELECT count(*) FROM labor_requisition_candidates WHERE requisition_id = p_req AND promoted_staff_id IS NULL))
   WHERE id = p_req AND status = 'pending';
  PERFORM log_labour_event(p_req, 'worker_added', v_name);
END $function$;

-- A new person, by name and phone. Before approval they wait as a
-- candidate (approval hires them); after, they are hired now.
CREATE OR REPLACE FUNCTION public.labour_add_new_worker(p_req uuid, p_name text, p_phone text DEFAULT NULL, p_day_rate numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r       labor_requisitions%ROWTYPE;
  v_staff uuid;
  v_cand  uuid;
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT can_run_labour_site(r.project_id) THEN RAISE EXCEPTION 'Only the site''s team, operations or HR can add workers'; END IF;
  IF r.status = 'rejected' OR r.closed_at IS NOT NULL THEN RAISE EXCEPTION 'This request is closed'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Give the worker''s name'; END IF;

  -- Already known by phone: use them.
  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_staff FROM staff
     WHERE regexp_replace(COALESCE(phone_number, ''), '[^0-9+]', '', 'g') = v_phone
     ORDER BY (status = 'active') DESC LIMIT 1;
  END IF;

  IF v_staff IS NULL AND r.status = 'approved' THEN
    INSERT INTO staff (employee_name, phone_number, employment_type, status, trade_tag, day_rate, first_engaged_at)
    VALUES (btrim(p_name), v_phone, 'tier_2_casual', 'active', r.trade_tag,
            COALESCE(p_day_rate, CASE WHEN r.payment_basis = 'per_day' THEN r.estimated_day_rate END), CURRENT_DATE)
    RETURNING id INTO v_staff;
  END IF;

  IF v_staff IS NOT NULL THEN
    IF p_day_rate IS NOT NULL THEN UPDATE staff SET day_rate = COALESCE(day_rate, p_day_rate) WHERE id = v_staff; END IF;
    PERFORM labour_add_worker(p_req, v_staff);
    RETURN v_staff;
  END IF;

  INSERT INTO candidates (full_name, phone, outcome, candidate_type, trade_tag, created_by)
  VALUES (btrim(p_name), v_phone, 'pending',
          CASE WHEN r.trade_tag IS NULL THEN 'salaried_or_subcontractor' ELSE 'tier_2_casual' END, r.trade_tag, current_staff_id())
  RETURNING id INTO v_cand;
  INSERT INTO labor_requisition_candidates (requisition_id, candidate_id) VALUES (p_req, v_cand);
  UPDATE labor_requisitions SET headcount = GREATEST(headcount,
    (SELECT count(*) FROM labor_requisition_workers WHERE requisition_id = p_req)
    + (SELECT count(*) FROM labor_requisition_candidates WHERE requisition_id = p_req AND promoted_staff_id IS NULL))
   WHERE id = p_req;
  PERFORM log_labour_event(p_req, 'worker_added', btrim(p_name) || ' (new)');
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.labour_remove_worker(p_req uuid, p_staff_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r labor_requisitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req;
  IF NOT can_run_labour_site(r.project_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE labor_allocations SET status = 'completed', end_date = LEAST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
   WHERE labor_requisition_id = p_req AND staff_id = p_staff_id AND status = 'active';
  IF r.status = 'pending' THEN DELETE FROM labor_requisition_workers WHERE requisition_id = p_req AND staff_id = p_staff_id; END IF;
  PERFORM log_labour_event(p_req, 'worker_removed', (SELECT employee_name FROM staff WHERE id = p_staff_id));
END $function$;

-- ── 6. Recorded work: one place ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS labour_pay_sheets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text UNIQUE,
  labor_requisition_id uuid NOT NULL REFERENCES labor_requisitions(id) ON DELETE CASCADE,
  project_id           uuid REFERENCES projects(id),
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  total                numeric NOT NULL DEFAULT 0,
  lines                jsonb NOT NULL DEFAULT '[]'::jsonb,
  expense_id           uuid REFERENCES expenses(id) ON DELETE SET NULL,
  confirmed_by         uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  confirmed_by_name    text,
  confirmed_at         timestamptz NOT NULL DEFAULT now(),
  note                 text
);
CREATE INDEX IF NOT EXISTS idx_labour_pay_sheets_req ON labour_pay_sheets (labor_requisition_id);
CREATE SEQUENCE IF NOT EXISTS labour_pay_sheet_seq;
COMMENT ON TABLE labour_pay_sheets IS
  'What a project manager confirmed is owed on a labour request for a period (375), and the payable it became.';

CREATE TABLE IF NOT EXISTS labour_work_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  labor_requisition_id uuid NOT NULL REFERENCES labor_requisitions(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES projects(id),
  work_date            date NOT NULL,
  -- NULL for work recorded for the whole crew or the whole task.
  staff_id             uuid REFERENCES staff(id) ON DELETE RESTRICT,
  hours                numeric CHECK (hours IS NULL OR (hours >= 0 AND hours <= 24)),
  overtime_hours       numeric NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 16),
  quantity             numeric CHECK (quantity IS NULL OR quantity >= 0),
  percent_done         numeric CHECK (percent_done IS NULL OR (percent_done > 0 AND percent_done <= 100)),
  note                 text,
  recorded_by          uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  recorded_by_name     text,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  pay_sheet_id         uuid REFERENCES labour_pay_sheets(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_labour_work_entry
  ON labour_work_entries (labor_requisition_id, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid), work_date);
CREATE INDEX IF NOT EXISTS idx_labour_work_project_date ON labour_work_entries (project_id, work_date);
CREATE INDEX IF NOT EXISTS idx_labour_work_unpaid ON labour_work_entries (labor_requisition_id, work_date) WHERE pay_sheet_id IS NULL;
COMMENT ON TABLE labour_work_entries IS
  'The one record of labour work (375): hours for a day-rate worker, quantity for work by the unit, % done for a fixed-price task. Paid once, through a pay sheet.';

ALTER TABLE labour_pay_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_work_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labour_work_read ON labour_work_entries;
CREATE POLICY labour_work_read ON labour_work_entries FOR SELECT
  USING (can_run_labour_site(project_id) OR COALESCE(get_user_role() = 'finance', false));
DROP POLICY IF EXISTS labour_pay_sheets_read ON labour_pay_sheets;
CREATE POLICY labour_pay_sheets_read ON labour_pay_sheets FOR SELECT
  USING (can_run_labour_site(project_id) OR COALESCE(get_user_role() = 'finance', false));

-- Everyone who can be recorded on a site for a day: the workers on each
-- approved, open request, plus one crew/task line where the request is
-- paid to a crew leader or at a fixed price.
CREATE OR REPLACE FUNCTION public.labour_day_sheet(p_project uuid, p_date date)
RETURNS TABLE (
  labor_requisition_id uuid, role_needed text, payment_basis text, payment_model text,
  volume_unit text, unit_rate numeric, day_rate numeric, fixed_price_amount numeric, percent_so_far numeric,
  staff_id uuid, worker_name text, phone text,
  entry_id uuid, hours numeric, overtime_hours numeric, quantity numeric, percent_done numeric, note text, locked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH reqs AS (
    SELECT r.* FROM labor_requisitions r
    WHERE r.project_id = p_project AND r.status = 'approved' AND r.closed_at IS NULL
      AND COALESCE(r.start_date, p_date) <= p_date
      AND (r.end_date IS NULL OR r.end_date >= p_date - 7)
      AND can_run_labour_site(p_project)
  ), people AS (
    -- Individual workers: day-rate always; by quantity when each worker is paid for their own.
    SELECT r.id AS req_id, a.staff_id, a.day_rate_snapshot
    FROM reqs r JOIN labor_allocations a ON a.labor_requisition_id = r.id
    WHERE r.payment_basis = 'per_day'
       OR (r.payment_basis = 'per_volume' AND r.payment_model = 'individual')
    GROUP BY r.id, a.staff_id, a.day_rate_snapshot
    HAVING bool_or(a.status = 'active' OR EXISTS (
      SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.staff_id = a.staff_id AND e.work_date = p_date))
    UNION ALL
    -- One line for a crew paid by quantity, or a fixed-price task.
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

-- Record a site's day. p_entries: [{req, staff (or null), hours, overtime_hours, quantity, percent_done, note}]
-- A line with nothing on it clears that line.
CREATE OR REPLACE FUNCTION public.record_labour_day(p_project uuid, p_date date, p_entries jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_line  jsonb;
  v_req   labor_requisitions%ROWTYPE;
  v_staff uuid;
  v_hours numeric; v_ot numeric; v_qty numeric; v_pct numeric;
  v_n     integer := 0;
  v_name  text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  v_so_far numeric;
BEGIN
  IF NOT can_run_labour_site(p_project) THEN
    RAISE EXCEPTION 'Only the site foreman, the project manager, operations or HR can record work on this site';
  END IF;
  IF p_date > CURRENT_DATE THEN RAISE EXCEPTION 'Work can''t be recorded for a day that hasn''t happened'; END IF;
  IF p_date < CURRENT_DATE - 60 THEN RAISE EXCEPTION 'That is more than 60 days ago — ask operations to record it'; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP
    SELECT * INTO v_req FROM labor_requisitions WHERE id = (v_line->>'req')::uuid;
    IF NOT FOUND OR v_req.project_id <> p_project THEN RAISE EXCEPTION 'A line belongs to another site'; END IF;
    IF v_req.status <> 'approved' THEN RAISE EXCEPTION '% is not approved yet', v_req.role_needed; END IF;
    v_staff := NULLIF(v_line->>'staff', '')::uuid;
    v_hours := NULLIF(v_line->>'hours', '')::numeric;
    v_ot    := COALESCE(NULLIF(v_line->>'overtime_hours', '')::numeric, 0);
    v_qty   := NULLIF(v_line->>'quantity', '')::numeric;
    v_pct   := NULLIF(v_line->>'percent_done', '')::numeric;

    IF EXISTS (SELECT 1 FROM labour_work_entries
                WHERE labor_requisition_id = v_req.id AND staff_id IS NOT DISTINCT FROM v_staff
                  AND work_date = p_date AND pay_sheet_id IS NOT NULL) THEN
      CONTINUE;  -- already confirmed for pay: leave it
    END IF;

    IF v_req.payment_basis = 'fixed_price' THEN
      v_hours := NULL; v_qty := NULL; v_ot := 0;
      IF v_pct IS NOT NULL THEN
        SELECT COALESCE(sum(percent_done), 0) INTO v_so_far FROM labour_work_entries
         WHERE labor_requisition_id = v_req.id AND work_date <> p_date;
        IF v_so_far + v_pct > 100 THEN
          RAISE EXCEPTION '% is already % %% done — at most % %% more', v_req.role_needed, v_so_far, 100 - v_so_far;
        END IF;
      END IF;
    ELSIF v_req.payment_basis = 'per_volume' THEN
      v_hours := NULL; v_pct := NULL; v_ot := 0;
    ELSE
      v_qty := NULL; v_pct := NULL;
      IF v_staff IS NULL THEN RAISE EXCEPTION 'Day-rate work is recorded per worker'; END IF;
    END IF;

    IF COALESCE(v_hours, 0) = 0 AND v_ot = 0 AND COALESCE(v_qty, 0) = 0 AND v_pct IS NULL THEN
      DELETE FROM labour_work_entries
       WHERE labor_requisition_id = v_req.id AND staff_id IS NOT DISTINCT FROM v_staff
         AND work_date = p_date AND pay_sheet_id IS NULL;
      CONTINUE;
    END IF;

    INSERT INTO labour_work_entries (labor_requisition_id, project_id, work_date, staff_id, hours, overtime_hours,
      quantity, percent_done, note, recorded_by, recorded_by_name)
    VALUES (v_req.id, p_project, p_date, v_staff, v_hours, v_ot, v_qty, v_pct,
      NULLIF(btrim(v_line->>'note'), ''), auth.uid(), v_name)
    ON CONFLICT (labor_requisition_id, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid), work_date)
    DO UPDATE SET hours = EXCLUDED.hours, overtime_hours = EXCLUDED.overtime_hours, quantity = EXCLUDED.quantity,
      percent_done = EXCLUDED.percent_done, note = EXCLUDED.note,
      recorded_by = EXCLUDED.recorded_by, recorded_by_name = EXCLUDED.recorded_by_name, recorded_at = now()
    WHERE labour_work_entries.pay_sheet_id IS NULL;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

-- ── 7. What is owed, and confirming it ───────────────────────────────
-- Day rate: hours ÷ 8 × the worker's rate; overtime at 1.5 × the hourly
-- rate. Quantity: quantity × unit rate. Fixed price: % done × the price.
CREATE OR REPLACE FUNCTION public.labour_pay_lines(p_req uuid, p_to date)
RETURNS TABLE (staff_id uuid, worker_name text, first_day date, last_day date, days numeric, hours numeric,
  overtime_hours numeric, quantity numeric, percent_done numeric, rate numeric, overtime_amount numeric, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH r AS (SELECT * FROM labor_requisitions WHERE id = p_req),
  e AS (
    SELECT e.* FROM labour_work_entries e
    WHERE e.labor_requisition_id = p_req AND e.pay_sheet_id IS NULL AND e.work_date <= p_to
  ), agg AS (
    SELECT e.staff_id, min(e.work_date) AS first_day, max(e.work_date) AS last_day,
      sum(COALESCE(e.hours, 0)) AS hours, sum(e.overtime_hours) AS ot,
      sum(COALESCE(e.quantity, 0)) AS qty, sum(COALESCE(e.percent_done, 0)) AS pct
    FROM e GROUP BY e.staff_id
  ), priced AS (
    SELECT a.*, s.employee_name,
      CASE r.payment_basis
        WHEN 'per_day' THEN COALESCE(
          (SELECT la.day_rate_snapshot FROM labor_allocations la WHERE la.labor_requisition_id = p_req AND la.staff_id = a.staff_id
            ORDER BY (la.status = 'active') DESC, la.created_at DESC LIMIT 1),
          s.day_rate, r.estimated_day_rate, 0)
        WHEN 'per_volume' THEN r.unit_rate
        ELSE r.fixed_price_amount END AS rate,
      r.payment_basis
    FROM agg a CROSS JOIN r LEFT JOIN staff s ON s.id = a.staff_id
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
    CASE WHEN p.payment_basis = 'per_day' THEN round(p.ot * p.rate / 8 * 1.5, 2) ELSE 0 END,
    round(CASE p.payment_basis
      WHEN 'per_day'    THEN p.hours / 8 * p.rate + p.ot * p.rate / 8 * 1.5
      WHEN 'per_volume' THEN p.qty * p.rate
      ELSE p.pct / 100 * p.rate END, 2)
  FROM priced p
  ORDER BY 2;
$function$;

-- Per request: what is recorded and not yet confirmed, for the Pay list.
CREATE OR REPLACE VIEW public.v_labour_unpaid WITH (security_invoker = true) AS
SELECT r.id AS labor_requisition_id, r.project_id, p.project_name, r.role_needed, r.payment_basis, r.payment_model, r.pay_cycle,
  r.end_date, min(e.work_date) AS first_day, max(e.work_date) AS last_day, count(DISTINCT e.work_date)::int AS days_recorded,
  count(DISTINCT e.staff_id)::int AS workers,
  -- A weekly request is ready once a whole week has passed; one paid at
  -- the end once its end date has passed.
  CASE WHEN r.pay_cycle = 'engagement_end' THEN (r.end_date IS NOT NULL AND r.end_date < CURRENT_DATE) OR r.closed_at IS NOT NULL
       ELSE min(e.work_date) <= (date_trunc('week', CURRENT_DATE)::date - 1) END AS ready,
  CASE WHEN r.pay_cycle = 'engagement_end' THEN max(e.work_date)
       ELSE LEAST(max(e.work_date), date_trunc('week', CURRENT_DATE)::date - 1) END AS suggested_to
FROM labour_work_entries e
JOIN labor_requisitions r ON r.id = e.labor_requisition_id
LEFT JOIN projects p ON p.id = r.project_id
WHERE e.pay_sheet_id IS NULL
GROUP BY r.id, p.project_name;

CREATE OR REPLACE FUNCTION public.confirm_labour_pay(p_req uuid, p_to date, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  IF NOT (manages_project(r.project_id) OR COALESCE(get_user_role() IN ('admin', 'operations_manager'), false)) THEN
    RAISE EXCEPTION 'The project manager confirms what is owed on their site';
  END IF;

  SELECT jsonb_agg(to_jsonb(l)), sum(l.amount), min(l.first_day), max(l.last_day), count(*)
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

  -- The payable's worker lines. A crew or task line has no single worker:
  -- it is filed against the first worker on the request (the crew leader
  -- when there is one on the roster), for the record only.
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
   WHERE labor_requisition_id = p_req AND pay_sheet_id IS NULL AND work_date <= p_to;

  PERFORM log_labour_event(p_req, 'pay_confirmed',
    format('%s · %s ETB · %s to %s', v_code, to_char(v_total, 'FM999,999,990.00'), to_char(v_from, 'DD Mon'), to_char(v_last, 'DD Mon')));
  RETURN v_sheet;
END $function$;

-- Take a confirmation back while finance hasn't acted on it.
CREATE OR REPLACE FUNCTION public.reopen_labour_pay(p_sheet uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s labour_pay_sheets%ROWTYPE;
  e expenses%ROWTYPE;
BEGIN
  SELECT * INTO s FROM labour_pay_sheets WHERE id = p_sheet;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pay sheet not found'; END IF;
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

-- ── 8. Rights ────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION
  add_labour_comment(uuid, text), can_run_labour_site(uuid), labour_add_worker(uuid, uuid),
  labour_add_new_worker(uuid, text, text, numeric), labour_remove_worker(uuid, uuid),
  labour_day_sheet(uuid, date), record_labour_day(uuid, date, jsonb), labour_pay_lines(uuid, date),
  confirm_labour_pay(uuid, date, text), reopen_labour_pay(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  add_labour_comment(uuid, text), can_run_labour_site(uuid), labour_add_worker(uuid, uuid),
  labour_add_new_worker(uuid, text, text, numeric), labour_remove_worker(uuid, uuid),
  labour_day_sheet(uuid, date), record_labour_day(uuid, date, jsonb), labour_pay_lines(uuid, date),
  confirm_labour_pay(uuid, date, text), reopen_labour_pay(uuid)
TO authenticated;
REVOKE EXECUTE ON FUNCTION trg_labour_request_events(), trg_labour_expense_events() FROM PUBLIC, anon, authenticated;

-- The history of requests made before today starts with their approval.
INSERT INTO labour_request_events (labor_requisition_id, kind, body, actor, created_at)
SELECT r.id, 'requested', NULL, r.requested_by, r.created_at FROM labor_requisitions r
WHERE NOT EXISTS (SELECT 1 FROM labour_request_events x WHERE x.labor_requisition_id = r.id);
INSERT INTO labour_request_events (labor_requisition_id, kind, body, actor, created_at)
SELECT r.id, r.status, r.decision_note, r.approved_by, COALESCE(r.approved_at, r.created_at) FROM labor_requisitions r
WHERE r.status IN ('approved', 'rejected')
  AND NOT EXISTS (SELECT 1 FROM labour_request_events x WHERE x.labor_requisition_id = r.id AND x.kind = r.status);
UPDATE labour_request_events ev SET actor_name = up.full_name FROM user_profiles up WHERE up.id = ev.actor AND ev.actor_name IS NULL;
