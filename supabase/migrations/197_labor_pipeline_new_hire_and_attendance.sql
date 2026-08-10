-- 197 — Labor pipeline: candidate-linked new hires, propose-new-trade,
-- attendance-checkbox timesheet, per_volume commitment amount fix.
--
-- Six things bundled because they share the labor_requisitions approval path:
--
-- 1. labor_requisitions gains candidate_id, trade_tag, proposed_trade_amharic /
--    _english, estimated_total_volume. CHECKs enforce mutual exclusion
--    (at most one of specific_staff_id / candidate_id set) and per_volume
--    requiring estimated_total_volume > 0.
--
-- 2. New BEFORE-UPDATE trigger on_labor_req_approved_accept_trade: if the
--    foreman proposed a new trade, insert it into tier2_trade_roster with
--    default emoji/color and set NEW.trade_tag. Runs before promote_candidate
--    so the promoted staff row can pick up the freshly-minted tag.
--
-- 3. New BEFORE-UPDATE trigger on_labor_req_approved_promote_candidate:
--    if candidate_id is set, mint a staff row (employment_type='tier_2_casual',
--    trade_tag from the requisition, day_rate from estimated_day_rate),
--    update the candidate's outcome to 'hired', set NEW.specific_staff_id to
--    the new staff row. The existing maybe_allocate AFTER trigger then
--    picks up specific_staff_id and creates the allocation.
--
-- 4. on_labor_req_approved_insert_commitment (from migration 196) is patched
--    to branch on payment_basis: per_volume = unit_rate × estimated_total_volume,
--    per_day = existing headcount × day_rate × days math.
--
-- 5. timesheet_attendance table: (staff_id, project_id, work_date) unique.
--    Foreman ticks a cell to insert; unticks to delete. RLS: foreman for the
--    project, admin, HR, project_manager.
--
-- 6. rollup_labor_timesheets_to_expense (per_day branch only) folds in
--    attendance rows as if each row were a timesheet with days_worked=1,
--    day_rate from the requisition or the staff row. per_volume is unchanged
--    (volume is measured, not attended).
--
-- Trigger firing order relies on alphabetical name order within BEFORE UPDATE:
--   trg_labor_req_accept_trade         (a < ap)  → runs first
--   trg_labor_req_approval_authority   (existing)
--   trg_labor_req_promote_candidate    (p)       → runs last
-- Then AFTER UPDATE fires (unchanged):
--   trg_labor_req_commit_on_approval
--   trg_labor_req_maybe_allocate       (picks up specific_staff_id if promoted)

SET search_path TO public;

-- ── labor_requisitions — new columns ─────────────────────────────────────────
ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS candidate_id            uuid REFERENCES candidates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trade_tag               text REFERENCES tier2_trade_roster(trade_tag) ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS proposed_trade_amharic  text,
  ADD COLUMN IF NOT EXISTS proposed_trade_english  text,
  ADD COLUMN IF NOT EXISTS estimated_total_volume  numeric;

-- At most one of (specific_staff_id, candidate_id) is set. Both null =
-- anonymous headcount, the pre-existing mode.
ALTER TABLE labor_requisitions DROP CONSTRAINT IF EXISTS labor_req_assignment_mode_chk;
ALTER TABLE labor_requisitions
  ADD CONSTRAINT labor_req_assignment_mode_chk
  CHECK (specific_staff_id IS NULL OR candidate_id IS NULL);

-- Proposed-trade fields are all-or-nothing, and never coexist with trade_tag.
ALTER TABLE labor_requisitions DROP CONSTRAINT IF EXISTS labor_req_proposed_trade_chk;
ALTER TABLE labor_requisitions
  ADD CONSTRAINT labor_req_proposed_trade_chk
  CHECK (
    (proposed_trade_amharic IS NULL AND proposed_trade_english IS NULL)
    OR (proposed_trade_amharic IS NOT NULL AND proposed_trade_english IS NOT NULL AND trade_tag IS NULL)
  );

-- per_volume requires the total volume; per_day forbids it.
ALTER TABLE labor_requisitions DROP CONSTRAINT IF EXISTS labor_req_total_volume_chk;
ALTER TABLE labor_requisitions
  ADD CONSTRAINT labor_req_total_volume_chk
  CHECK (
    (payment_basis = 'per_day'    AND estimated_total_volume IS NULL)
    OR (payment_basis = 'per_volume' AND estimated_total_volume IS NOT NULL AND estimated_total_volume > 0)
  );

COMMENT ON COLUMN labor_requisitions.candidate_id IS
  'Scouted candidate to be hired on approval. Trigger promotes the candidate to a staff row and sets specific_staff_id.';
COMMENT ON COLUMN labor_requisitions.trade_tag IS
  'Trade picked from tier2_trade_roster. NULL means foreman is proposing a new trade via proposed_trade_amharic/english, or trade unspecified.';
COMMENT ON COLUMN labor_requisitions.estimated_total_volume IS
  'For per_volume requisitions: total planned volume in volume_unit. Drives commitment = unit_rate × volume.';

-- ── BEFORE-UPDATE trigger: accept proposed trade on approval ────────────────
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_accept_trade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_new_tag text;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.proposed_trade_amharic IS NOT NULL
     AND NEW.trade_tag IS NULL THEN
    -- Slugify the English name for the tag: lowercase, non-alphanumerics → _.
    v_new_tag := lower(regexp_replace(coalesce(NEW.proposed_trade_english, ''), '[^a-zA-Z0-9]+', '_', 'g'));
    v_new_tag := trim(both '_' from v_new_tag);
    IF v_new_tag = '' THEN v_new_tag := 'trade_' || substr(NEW.id::text, 1, 8); END IF;

    INSERT INTO tier2_trade_roster
      (trade_tag, codename_amharic, codename_english, icon_emoji, color_accent, color_accent_2, sort_order)
    VALUES
      (v_new_tag, NEW.proposed_trade_amharic, NEW.proposed_trade_english, '🔧', 'bg-slate-400', 'text-slate-700',
       (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tier2_trade_roster))
    ON CONFLICT (trade_tag) DO NOTHING;

    NEW.trade_tag := v_new_tag;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_labor_req_accept_trade ON labor_requisitions;
CREATE TRIGGER trg_labor_req_accept_trade
  BEFORE UPDATE OF status ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.on_labor_req_approved_accept_trade();

-- ── BEFORE-UPDATE trigger: promote candidate to staff row on approval ───────
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_promote_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_cand   candidates%ROWTYPE;
  v_new_id uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.candidate_id IS NOT NULL
     AND NEW.specific_staff_id IS NULL THEN
    SELECT * INTO v_cand FROM candidates WHERE id = NEW.candidate_id;
    IF v_cand.id IS NULL THEN
      RAISE EXCEPTION 'Candidate % not found for requisition %', NEW.candidate_id, NEW.id;
    END IF;

    INSERT INTO staff
      (employee_name, phone_number, email, employment_type, status,
       trade_tag, day_rate, first_engaged_at)
    VALUES
      (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
       NEW.trade_tag, NEW.estimated_day_rate, COALESCE(NEW.start_date, CURRENT_DATE))
    RETURNING id INTO v_new_id;

    UPDATE candidates
       SET outcome = 'hired',
           outcome_notes = COALESCE(outcome_notes, '') ||
             CASE WHEN outcome_notes IS NULL OR outcome_notes = '' THEN '' ELSE E'\n' END ||
             'Hired via labor requisition ' || NEW.id::text,
           updated_at = now()
     WHERE id = NEW.candidate_id;

    NEW.specific_staff_id := v_new_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_labor_req_promote_candidate ON labor_requisitions;
CREATE TRIGGER trg_labor_req_promote_candidate
  BEFORE UPDATE OF status ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.on_labor_req_approved_promote_candidate();

-- ── Patch commitment trigger: branch on payment_basis ────────────────────────
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_insert_commitment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_amount numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    v_amount := CASE
      WHEN NEW.payment_basis = 'per_volume' THEN
        COALESCE(NEW.estimated_total_cost, NEW.unit_rate * COALESCE(NEW.estimated_total_volume, 0))
      ELSE
        COALESCE(NEW.estimated_total_cost,
                 NEW.estimated_day_rate * COALESCE(NEW.estimated_days, 0) * NEW.headcount)
    END;
    INSERT INTO labor_commitments
      (labor_requisition_id, project_id, committed_amount, committed_by, status, notes)
    VALUES
      (NEW.id, NEW.project_id, v_amount, NEW.approved_by, 'active',
       'Auto-committed on approval')
    ON CONFLICT (labor_requisition_id) DO UPDATE
      SET committed_amount = EXCLUDED.committed_amount,
          committed_at     = now(),
          committed_by     = EXCLUDED.committed_by,
          status           = 'active',
          updated_at       = now();
  END IF;
  RETURN NEW;
END $$;

-- ── timesheet_attendance ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timesheet_attendance (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id               uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  project_id             uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_date              date NOT NULL,
  labor_requisition_id   uuid REFERENCES labor_requisitions(id) ON DELETE SET NULL,
  rolled_up_expense_id   uuid REFERENCES expenses(id) ON DELETE SET NULL,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, project_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_attendance_project_date
  ON timesheet_attendance (project_id, work_date);
CREATE INDEX IF NOT EXISTS idx_timesheet_attendance_req_unrolled
  ON timesheet_attendance (labor_requisition_id)
  WHERE rolled_up_expense_id IS NULL;

ALTER TABLE timesheet_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ta_read  ON timesheet_attendance;
DROP POLICY IF EXISTS ta_write ON timesheet_attendance;
DROP POLICY IF EXISTS ta_delete ON timesheet_attendance;

CREATE POLICY ta_read ON timesheet_attendance FOR SELECT
  USING (
    public.get_user_role() IN ('admin','executive','finance','hr_officer','project_manager','operations_manager')
    OR public.is_site_foreman_for_project(project_id)
  );

CREATE POLICY ta_write ON timesheet_attendance FOR INSERT
  WITH CHECK (
    public.get_user_role() IN ('admin','hr_officer','project_manager')
    OR public.is_site_foreman_for_project(project_id)
  );

CREATE POLICY ta_delete ON timesheet_attendance FOR DELETE
  USING (
    public.get_user_role() IN ('admin','hr_officer','project_manager')
    OR public.is_site_foreman_for_project(project_id)
  );

GRANT SELECT, INSERT, DELETE ON timesheet_attendance TO authenticated;

-- ── Rollup RPC: also fold in attendance rows for per_day requisitions ────────
-- per_volume is unchanged (volume is measured, not attended). per_day now
-- unions timesheet entries with attendance-derived days (days_worked=1 per
-- attendance row, day_rate from requisition / allocation snapshot / staff).
CREATE OR REPLACE FUNCTION public.rollup_labor_timesheets_to_expense(
  p_labor_requisition_id uuid, p_period_start date, p_period_end date
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
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
    (project_id, expense_category, description, expense_date, total_amount,
     payment_status, rolled_up_from_requisition_id, rollup_period_start, rollup_period_end,
     status, created_by)
  VALUES
    (v_req.project_id, 'labor_payment', v_desc, p_period_end, v_total,
     false, p_labor_requisition_id, p_period_start, p_period_end,
     'draft', auth.uid())
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
END $$;
