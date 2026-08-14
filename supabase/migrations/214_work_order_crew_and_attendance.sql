-- Work orders become the source of truth for who worked on what and for
-- how long. Two new tables: work_order_crew (assignment layer, additive
-- alongside the existing work_order_labor cost-link table) and
-- wo_attendance_log (WO-owned daily hours, both Tier 1 and Tier 2,
-- replacing the foreman-entered timesheet flow for site staff).
--
-- Folding-in note: this also absorbs the separate Tier-2-only weekly
-- attendance grid (AttendancePage.tsx / timesheet_attendance) that
-- already existed before this migration — confirmed live it's a second,
-- parallel way to mark Tier 2 presence beyond the original PR #1
-- timesheet page. Rather than leaving 3 parallel attendance paths after
-- this ships, wo_attendance_log becomes the only entry point and syncs
-- into *both* legacy tables (timesheet, timesheet_attendance) so nothing
-- downstream (payroll views, the labor rollup RPC) needs to change its
-- own query shape — same "safest path" principle as the sync-to-timesheet
-- requirement below, just extended to the second legacy table once its
-- existence was confirmed.

-- ── work_order_crew ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_order_crew (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id         uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  staff_id              uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role_on_wo            text,
  assigned_by_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  assigned_at           timestamptz NOT NULL DEFAULT now(),
  removed_at            timestamptz,
  removed_by_staff_id   uuid REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wo_crew_wo ON work_order_crew (work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_crew_staff ON work_order_crew (staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_crew_active ON work_order_crew (work_order_id, staff_id) WHERE removed_at IS NULL;

-- SECURITY DEFINER: needs to read staff.employment_type regardless of
-- the caller's own staff-read grant (staff has no broad authenticated
-- SELECT policy — a site foreman assigning crew cannot see most staff
-- rows directly) and labor_allocations, which is readable but this keeps
-- the check reliable independent of caller RLS either way.
CREATE OR REPLACE FUNCTION public.enforce_wo_crew_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_emp_type text;
  v_project_id uuid;
BEGIN
  SELECT employment_type INTO v_emp_type FROM staff WHERE id = NEW.staff_id;
  IF v_emp_type = 'tier_2_casual' THEN
    SELECT project_id INTO v_project_id FROM work_orders WHERE id = NEW.work_order_id;
    IF NOT EXISTS (
      SELECT 1 FROM labor_allocations
      WHERE staff_id = NEW.staff_id AND project_id = v_project_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'This Tier 2 worker has no active labor allocation on this work order''s project — cannot assign to the crew';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_enforce_wo_crew_allocation ON work_order_crew;
CREATE TRIGGER trg_enforce_wo_crew_allocation
  BEFORE INSERT ON work_order_crew
  FOR EACH ROW EXECUTE FUNCTION public.enforce_wo_crew_allocation();

ALTER TABLE work_order_crew ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_order_crew_read ON work_order_crew;
CREATE POLICY work_order_crew_read ON work_order_crew FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS work_order_crew_write ON work_order_crew;
CREATE POLICY work_order_crew_write ON work_order_crew FOR ALL
  USING (
    get_user_role() IN ('admin', 'executive')
    OR EXISTS (
      SELECT 1 FROM work_orders wo WHERE wo.id = work_order_crew.work_order_id
        AND (manages_project(wo.project_id) OR is_site_foreman_for_project(wo.project_id))
    )
  )
  WITH CHECK (
    get_user_role() IN ('admin', 'executive')
    OR EXISTS (
      SELECT 1 FROM work_orders wo WHERE wo.id = work_order_crew.work_order_id
        AND (manages_project(wo.project_id) OR is_site_foreman_for_project(wo.project_id))
    )
  );

-- ── labor_allocations: real link to the originating requisition ─────
-- Replaces the fragile "parse a requisition uuid out of notes text via
-- regex" approach AttendancePage.tsx used (its own code comment called
-- this out as a hack "fragile but the only link we have without adding
-- a column"). Needed below so the wo_attendance_log sync can resolve
-- which requisition a Tier 2 worker's day belongs to.
ALTER TABLE labor_allocations
  ADD COLUMN IF NOT EXISTS labor_requisition_id uuid REFERENCES labor_requisitions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.provision_tier_2_worker_from_candidate(p_candidate_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_role     user_role;
  v_cand     candidates%ROWTYPE;
  v_req      labor_requisitions%ROWTYPE;
  v_new_id   uuid;
  v_actor_id uuid;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('admin', 'executive', 'hr_officer') THEN
    RAISE EXCEPTION 'Only admin/executive/HR may approve and provision a Tier 2 candidate';
  END IF;

  SELECT * INTO v_cand FROM candidates WHERE id = p_candidate_id;
  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'Candidate % not found', p_candidate_id;
  END IF;
  IF v_cand.candidate_type <> 'tier_2_casual' THEN
    RAISE EXCEPTION 'Candidate % is not a Tier 2 casual candidate', p_candidate_id;
  END IF;
  IF v_cand.outcome <> 'pending' THEN
    RAISE EXCEPTION 'Candidate % has already been decided (outcome: %)', p_candidate_id, v_cand.outcome;
  END IF;

  IF v_cand.labor_requisition_id IS NOT NULL THEN
    SELECT * INTO v_req FROM labor_requisitions WHERE id = v_cand.labor_requisition_id;
  END IF;

  v_actor_id := public.current_staff_id();

  INSERT INTO staff
    (employee_name, phone_number, email, employment_type, status,
     trade_tag, day_rate, first_engaged_at)
  VALUES
    (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
     v_cand.trade_tag, v_req.estimated_day_rate, CURRENT_DATE)
  RETURNING id INTO v_new_id;

  UPDATE candidates
     SET outcome = 'hired',
         hr_approved_by_staff_id = v_actor_id,
         hr_approved_at = now(),
         provisioned_staff_id = v_new_id,
         updated_at = now()
   WHERE id = p_candidate_id;

  IF v_req.id IS NOT NULL THEN
    INSERT INTO labor_allocations
      (staff_id, project_id, start_date, status, assigned_by, notes, labor_requisition_id)
    VALUES
      (v_new_id, v_req.project_id, CURRENT_DATE, 'active', auth.uid(),
       'Provisioned via Tier 2 HR queue from candidate ' || p_candidate_id::text ||
       ' for requisition ' || v_req.id::text,
       v_req.id);
  END IF;

  RETURN v_new_id;
END $fn$;

-- ── wo_attendance_log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wo_attendance_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id        uuid REFERENCES work_orders(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  staff_id             uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  log_date             date NOT NULL,
  hours_logged         numeric(5,2) NOT NULL CHECK (hours_logged > 0 AND hours_logged <= 16),
  is_unallocated       boolean NOT NULL DEFAULT false,
  notes                text,
  logged_by_staff_id   uuid NOT NULL REFERENCES staff(id) ON DELETE SET NULL,
  synced_timesheet_id  uuid REFERENCES timesheet(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wo_attendance_wo_or_unallocated_chk CHECK (
    (work_order_id IS NOT NULL AND is_unallocated = false) OR
    (work_order_id IS NULL AND is_unallocated = true)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_attendance_allocated
  ON wo_attendance_log (work_order_id, staff_id, log_date) WHERE is_unallocated = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_attendance_unallocated
  ON wo_attendance_log (project_id, staff_id, log_date) WHERE is_unallocated = true;
CREATE INDEX IF NOT EXISTS idx_wo_attendance_wo_date ON wo_attendance_log (work_order_id, log_date);
CREATE INDEX IF NOT EXISTS idx_wo_attendance_project_date ON wo_attendance_log (project_id, log_date);

CREATE OR REPLACE FUNCTION public.trg_wo_attendance_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END $fn$;

DROP TRIGGER IF EXISTS trg_wo_attendance_updated_at ON wo_attendance_log;
CREATE TRIGGER trg_wo_attendance_updated_at
  BEFORE UPDATE ON wo_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_wo_attendance_touch_updated_at();

-- Auto-fill project_id from the work order when one is set, so the
-- column stays authoritative even if a caller sends a stale value.
CREATE OR REPLACE FUNCTION public.wo_attendance_fill_project_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.work_order_id IS NOT NULL THEN
    SELECT project_id INTO NEW.project_id FROM work_orders WHERE id = NEW.work_order_id;
  END IF;
  RETURN NEW;
END $fn$;

-- Named trg_1_... (not trg_wo_attendance_fill_project_id): multiple
-- BEFORE triggers on the same table/event fire in alphabetical order by
-- trigger name, not creation order. This must run before the sync
-- trigger below, which reads NEW.project_id — verified live that without
-- the numeric prefix forcing order, "trg_sync_..." sorted before
-- "trg_wo_attendance_fill_project_id" and the sync silently used a NULL
-- project_id, losing the allocation/requisition link entirely.
DROP TRIGGER IF EXISTS trg_wo_attendance_fill_project_id ON wo_attendance_log;
DROP TRIGGER IF EXISTS trg_1_wo_attendance_fill_project_id ON wo_attendance_log;
CREATE TRIGGER trg_1_wo_attendance_fill_project_id
  BEFORE INSERT OR UPDATE OF work_order_id ON wo_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.wo_attendance_fill_project_id();

-- Sync into `timesheet` (1:1 per wo_attendance_log row, tracked via
-- synced_timesheet_id) and, for Tier 2 workers on an allocated WO, also
-- into `timesheet_attendance` (many-to-one: several WOs on the same
-- project/day collapse to one presence mark, matching that table's own
-- UNIQUE(staff_id, project_id, work_date)). Both are the exact shape
-- rollup_labor_timesheets_to_expense and the cost views already expect —
-- deliberately not rewiring that logic, only feeding it.
--
-- SECURITY DEFINER: PM/admin/exec can write wo_attendance_log per this
-- migration's own RLS below, but timesheet's RLS does not grant plain
-- project_manager/operations_manager write, and timesheet_attendance's
-- ta_write only covers admin/hr_officer/project_manager/foreman (not
-- executive/operations_manager) — under SECURITY INVOKER those callers'
-- edits would fail RLS partway through the sync.
CREATE OR REPLACE FUNCTION public.sync_wo_attendance_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_emp_type text;
  v_alloc    labor_allocations%ROWTYPE;
  v_day_rate numeric;
  v_days     numeric;
  v_tier     int;
  v_ts_id    uuid;
  v_note     text;
BEGIN
  SELECT employment_type INTO v_emp_type FROM staff WHERE id = NEW.staff_id;
  v_tier := CASE WHEN v_emp_type = 'tier_2_casual' THEN 2 ELSE 1 END;

  SELECT * INTO v_alloc FROM labor_allocations
   WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
   ORDER BY start_date DESC LIMIT 1;

  v_day_rate := COALESCE(v_alloc.day_rate_snapshot, (SELECT day_rate FROM staff WHERE id = NEW.staff_id));
  v_days := NEW.hours_logged / 8.0;
  v_note := CASE WHEN NEW.is_unallocated THEN 'Unallocated time' || COALESCE(' — ' || NEW.notes, '') ELSE NEW.notes END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO timesheet
      (staff_id, project_id, date, labor_tier, labor_allocation_id, labor_requisition_id, day_rate, days_worked, notes)
    VALUES
      (NEW.staff_id, NEW.project_id, NEW.log_date, v_tier, v_alloc.id, v_alloc.labor_requisition_id, v_day_rate, v_days, v_note)
    RETURNING id INTO v_ts_id;
    NEW.synced_timesheet_id := v_ts_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.synced_timesheet_id IS NOT NULL THEN
    -- rollup marks rolled_up_expense_id on `timesheet` only via its dead
    -- check_in_time/check_out_time-gated branch (never populated here by
    -- design — see the rollup fix below), so the real "already paid"
    -- signal for a Tier 2 day is on the linked timesheet_attendance row.
    -- Block edits to anything already rolled into a paid expense, same
    -- as the existing payroll_id IS NULL convention on `timesheet` RLS.
    IF EXISTS (SELECT 1 FROM timesheet WHERE id = NEW.synced_timesheet_id AND rolled_up_expense_id IS NOT NULL)
       OR EXISTS (
         SELECT 1 FROM timesheet_attendance
         WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND work_date = NEW.log_date
           AND rolled_up_expense_id IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'This attendance entry has already been rolled up into a paid labor expense and can no longer be edited';
    END IF;
    UPDATE timesheet SET
      staff_id = NEW.staff_id, project_id = NEW.project_id, date = NEW.log_date,
      labor_tier = v_tier, labor_allocation_id = v_alloc.id, labor_requisition_id = v_alloc.labor_requisition_id,
      day_rate = v_day_rate, days_worked = v_days, notes = v_note, updated_at = now()
    WHERE id = NEW.synced_timesheet_id;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sync_wo_attendance_before ON wo_attendance_log;
DROP TRIGGER IF EXISTS trg_2_sync_wo_attendance_before ON wo_attendance_log;
CREATE TRIGGER trg_2_sync_wo_attendance_before
  BEFORE INSERT OR UPDATE OF work_order_id, staff_id, project_id, log_date, hours_logged, is_unallocated, notes ON wo_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_wo_attendance_before();

CREATE OR REPLACE FUNCTION public.sync_wo_attendance_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_emp_type    text;
  v_req_id      uuid;
  v_other_exists boolean;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT employment_type INTO v_emp_type FROM staff WHERE id = NEW.staff_id;
    IF v_emp_type = 'tier_2_casual' AND NOT NEW.is_unallocated THEN
      SELECT labor_requisition_id INTO v_req_id FROM labor_allocations
       WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
       ORDER BY start_date DESC LIMIT 1;

      INSERT INTO timesheet_attendance (staff_id, project_id, work_date, labor_requisition_id, created_by)
      VALUES (NEW.staff_id, NEW.project_id, NEW.log_date, v_req_id, NEW.logged_by_staff_id)
      ON CONFLICT (staff_id, project_id, work_date) DO UPDATE
        SET labor_requisition_id = EXCLUDED.labor_requisition_id
        WHERE timesheet_attendance.rolled_up_expense_id IS NULL;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM timesheet WHERE id = OLD.synced_timesheet_id AND rolled_up_expense_id IS NOT NULL)
       OR EXISTS (
         SELECT 1 FROM timesheet_attendance
         WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND work_date = OLD.log_date
           AND rolled_up_expense_id IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'This attendance entry has already been rolled up into a paid labor expense and can no longer be removed';
    END IF;

    SELECT employment_type INTO v_emp_type FROM staff WHERE id = OLD.staff_id;
    IF v_emp_type = 'tier_2_casual' AND NOT OLD.is_unallocated THEN
      SELECT EXISTS (
        SELECT 1 FROM wo_attendance_log
        WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND log_date = OLD.log_date
          AND is_unallocated = false AND id <> OLD.id
      ) INTO v_other_exists;
      IF NOT v_other_exists THEN
        DELETE FROM timesheet_attendance
         WHERE staff_id = OLD.staff_id AND project_id = OLD.project_id AND work_date = OLD.log_date;
      END IF;
    END IF;
    IF OLD.synced_timesheet_id IS NOT NULL THEN
      DELETE FROM timesheet WHERE id = OLD.synced_timesheet_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_sync_wo_attendance_after ON wo_attendance_log;
CREATE TRIGGER trg_sync_wo_attendance_after
  AFTER INSERT OR UPDATE OR DELETE ON wo_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.sync_wo_attendance_after();

ALTER TABLE wo_attendance_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wo_attendance_read ON wo_attendance_log;
CREATE POLICY wo_attendance_read ON wo_attendance_log FOR SELECT
  USING (
    get_user_role() IN ('admin', 'executive')
    OR manages_project(project_id)
    OR is_site_foreman_for_project(project_id)
  );

DROP POLICY IF EXISTS wo_attendance_insert ON wo_attendance_log;
CREATE POLICY wo_attendance_insert ON wo_attendance_log FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin', 'executive')
    OR is_site_foreman_for_project(project_id)
  );

DROP POLICY IF EXISTS wo_attendance_update ON wo_attendance_log;
CREATE POLICY wo_attendance_update ON wo_attendance_log FOR UPDATE
  USING (
    get_user_role() IN ('admin', 'executive')
    OR manages_project(project_id)
    OR is_site_foreman_for_project(project_id)
  )
  WITH CHECK (
    get_user_role() IN ('admin', 'executive')
    OR manages_project(project_id)
    OR is_site_foreman_for_project(project_id)
  );

DROP POLICY IF EXISTS wo_attendance_delete ON wo_attendance_log;
CREATE POLICY wo_attendance_delete ON wo_attendance_log FOR DELETE
  USING (
    get_user_role() IN ('admin', 'executive')
    OR is_site_foreman_for_project(project_id)
  );

-- ── Fix rollup_labor_timesheets_to_expense: broken INSERT ────────────
-- Live bug, pre-existing and unrelated to this feature: the currently
-- installed body (migration 197) inserts into `expenses` using columns
-- that don't exist on that table (expense_category, description,
-- expense_date, total_amount, status, created_by). Confirmed live via
-- information_schema — real columns are item_service_description,
-- amount_etb, expense_type, date, approval_status, payment_state, etc.,
-- which the *previous* version (migration 189) used correctly. Restoring
-- that column mapping — the SELECT/aggregation logic above it (per_day
-- vs per_volume, the timesheet ∪ timesheet_attendance union) is
-- deliberately left untouched, since that's the "safest path" this
-- migration is following for the sync above too.
CREATE OR REPLACE FUNCTION public.rollup_labor_timesheets_to_expense(p_labor_requisition_id uuid, p_period_start date, p_period_end date)
RETURNS uuid LANGUAGE plpgsql SET search_path = 'public' AS $function$
DECLARE
  v_req            labor_requisitions%ROWTYPE;
  v_existing_id    uuid;
  v_expense_id     uuid;
  v_total          numeric := 0;
  v_worker_count   int     := 0;
  v_days_or_vol    numeric := 0;
  v_project_name   text;
  v_desc           text;
BEGIN
  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_labor_requisition_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition % not found', p_labor_requisition_id; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'Requisition must be approved before rollup (current: %)', v_req.status; END IF;

  SELECT id INTO v_existing_id FROM expenses
   WHERE rolled_up_from_requisition_id = p_labor_requisition_id
     AND rollup_period_start = p_period_start AND rollup_period_end = p_period_end;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rollup_workers (
    staff_id uuid, days_worked numeric, day_rate numeric, subtotal numeric
  ) ON COMMIT DROP;
  DELETE FROM _rollup_workers;

  IF v_req.payment_basis = 'per_volume' THEN
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
    SELECT
      ts.staff_id,
      SUM(COALESCE(ts.volume_completed, 0)) AS days_worked,
      v_req.unit_rate AS day_rate,
      SUM(COALESCE(ts.volume_completed, 0)) * v_req.unit_rate AS subtotal
    FROM timesheet ts
    LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
    WHERE ts.labor_requisition_id = p_labor_requisition_id
      AND ts.rolled_up_expense_id IS NULL
      AND ts.date BETWEEN p_period_start AND p_period_end
      AND ts.check_in_time IS NOT NULL AND ts.check_out_time IS NOT NULL
      AND ts.staff_id IS NOT NULL
      AND COALESCE(ts.volume_completed, 0) > 0
      AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
    GROUP BY ts.staff_id
    HAVING SUM(COALESCE(ts.volume_completed, 0)) > 0;
  ELSE
    -- per_day. Union: timesheet rows + attendance rows (days_worked=1 per row).
    -- Both sources feed the same temp table; aggregate to one row per staff.
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
    SELECT
      combined.staff_id,
      SUM(combined.days_worked) AS days_worked,
      MAX(combined.day_rate)    AS day_rate,
      SUM(combined.days_worked) * MAX(combined.day_rate) AS subtotal
    FROM (
      SELECT
        ts.staff_id,
        COALESCE(ts.days_worked, 1)::numeric AS days_worked,
        COALESCE(ts.day_rate, la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
      FROM timesheet ts
      LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = ts.staff_id
      WHERE ts.labor_requisition_id = p_labor_requisition_id
        AND ts.rolled_up_expense_id IS NULL
        AND ts.date BETWEEN p_period_start AND p_period_end
        AND ts.check_in_time IS NOT NULL AND ts.check_out_time IS NOT NULL
        AND ts.staff_id IS NOT NULL
        AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
      UNION ALL
      SELECT
        att.staff_id,
        1::numeric AS days_worked,
        COALESCE(la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
      FROM timesheet_attendance att
      LEFT JOIN labor_allocations la ON la.staff_id = att.staff_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = att.staff_id
      WHERE att.labor_requisition_id = p_labor_requisition_id
        AND att.rolled_up_expense_id IS NULL
        AND att.work_date BETWEEN p_period_start AND p_period_end
    ) combined
    GROUP BY combined.staff_id;
  END IF;

  SELECT COALESCE(SUM(subtotal),0), COUNT(*), COALESCE(SUM(days_worked),0)
    INTO v_total, v_worker_count, v_days_or_vol FROM _rollup_workers;

  IF v_worker_count = 0 THEN
    RAISE EXCEPTION 'No un-rolled timesheets found in period % to %', p_period_start, p_period_end;
  END IF;

  SELECT project_name INTO v_project_name FROM projects WHERE id = v_req.project_id;
  v_desc := v_project_name || ' · Labor · ' || v_req.role_needed
    || ' · ' || to_char(p_period_start, 'YYYY-MM-DD') || '→' || to_char(p_period_end, 'YYYY-MM-DD');

  INSERT INTO expenses
    (item_service_description, amount_etb, expense_type, project_id, date,
     approval_status, payment_state,
     rolled_up_from_requisition_id, rollup_period_start, rollup_period_end)
  VALUES
    (v_desc, v_total, 'labor_payment'::expense_category, v_req.project_id, p_period_end,
     'pending'::expense_approval_status, 'unpaid',
     p_labor_requisition_id, p_period_start, p_period_end)
  RETURNING id INTO v_expense_id;

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal)
  SELECT v_expense_id, w.staff_id, w.days_worked, w.day_rate, w.subtotal FROM _rollup_workers w;

  UPDATE timesheet SET rolled_up_expense_id = v_expense_id
   WHERE labor_requisition_id = p_labor_requisition_id
     AND rolled_up_expense_id IS NULL
     AND date BETWEEN p_period_start AND p_period_end
     AND check_in_time IS NOT NULL AND check_out_time IS NOT NULL
     AND staff_id IS NOT NULL;

  IF v_req.payment_basis = 'per_day' THEN
    UPDATE timesheet_attendance SET rolled_up_expense_id = v_expense_id
     WHERE labor_requisition_id = p_labor_requisition_id
       AND rolled_up_expense_id IS NULL
       AND work_date BETWEEN p_period_start AND p_period_end;
  END IF;

  RETURN v_expense_id;
END $function$;
