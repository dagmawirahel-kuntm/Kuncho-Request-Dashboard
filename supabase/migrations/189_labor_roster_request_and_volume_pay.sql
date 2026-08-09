-- 189 — Labor: roster-based requisitions + volume-based pay
--
-- Two ancillary additions on top of the tier-2 pipeline:
--
-- 1) `labor_requisitions.specific_staff_id` — a PM can name the exact person
--    they want off the roster; on HR approval a planned labor_allocation
--    for that person is auto-created so the pipeline (timesheets → rollup
--    → payment) picks them up without any manual allocation step.
--
-- 2) A `payment_basis` on the requisition — 'per_day' (default, existing
--    behavior) or 'per_volume' (piece-work: workers paid unit_rate ×
--    volume_completed). The rollup RPC now branches on this field.
--
-- Grandfathering: existing requisitions default to per_day, existing
-- timesheets keep their day_rate × days_worked math. No historical rows
-- are recomputed.

SET search_path TO public;

ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS specific_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_basis     text NOT NULL DEFAULT 'per_day',
  ADD COLUMN IF NOT EXISTS volume_unit       text,
  ADD COLUMN IF NOT EXISTS unit_rate         numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='labor_req_payment_basis_chk') THEN
    ALTER TABLE labor_requisitions
      ADD CONSTRAINT labor_req_payment_basis_chk
      CHECK (payment_basis IN ('per_day','per_volume'));
  END IF;
  -- per_volume requisitions must carry unit and rate; per_day doesn't need them.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='labor_req_volume_needs_rate_chk') THEN
    ALTER TABLE labor_requisitions
      ADD CONSTRAINT labor_req_volume_needs_rate_chk
      CHECK (payment_basis = 'per_day'
             OR (unit_rate IS NOT NULL AND unit_rate > 0 AND volume_unit IS NOT NULL));
  END IF;
END $$;

COMMENT ON COLUMN labor_requisitions.specific_staff_id IS
  'When set, HR approval creates a planned labor_allocation for THIS person on this project (roster-driven request instead of anonymous headcount).';
COMMENT ON COLUMN labor_requisitions.payment_basis IS
  'per_day → paid days_worked × day_rate (existing behavior). per_volume → paid volume_completed × unit_rate.';

-- Timesheet: piece-work volume for per_volume requisitions.
ALTER TABLE timesheet
  ADD COLUMN IF NOT EXISTS volume_completed numeric;

COMMENT ON COLUMN timesheet.volume_completed IS
  'For per_volume requisitions: units of work completed that day (m², pcs, lm, etc.).';

-- ── Approval trigger extension: auto-create allocation for specific_staff_id ──
-- Runs alongside the existing on_labor_req_approved_insert_commitment trigger.
-- Keeps that trigger's logic untouched; the two triggers are independent.
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_maybe_allocate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_rate numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.specific_staff_id IS NOT NULL THEN
    -- Snapshot the day rate from the staff row; piece-work still snapshots
    -- (unused for per_volume rollup, but preserves historical intent).
    SELECT day_rate INTO v_rate FROM staff WHERE id = NEW.specific_staff_id;
    INSERT INTO labor_allocations
      (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes)
    VALUES
      (NEW.specific_staff_id, NEW.project_id,
       COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
       COALESCE(NEW.estimated_day_rate, v_rate),
       'planned',
       'Auto-created from approved roster request ' || NEW.id::text);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_labor_req_maybe_allocate ON labor_requisitions;
CREATE TRIGGER trg_labor_req_maybe_allocate
  AFTER UPDATE OF status ON labor_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.on_labor_req_approved_maybe_allocate();

-- ── Rollup RPC: branch on payment_basis ──────────────────────────────────────
-- Replaces the body of rollup_labor_timesheets_to_expense; per_day mode is
-- byte-identical to migration 185. per_volume mode groups by worker and
-- pays sum(volume_completed) × unit_rate per row.
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
    -- Piece-work: pay unit_rate × sum(volume_completed) per worker. The
    -- day_rate column in the per-worker breakdown carries unit_rate for
    -- transparency; days_worked carries the volume tally.
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
    -- per_day: unchanged behavior (matches migration 185).
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
    SELECT
      ts.staff_id,
      SUM(COALESCE(ts.days_worked, 1)) AS days_worked,
      COALESCE(MAX(ts.day_rate), MAX(la.day_rate_snapshot), MAX(s.day_rate), 0) AS day_rate,
      SUM(COALESCE(ts.days_worked, 1)) * COALESCE(MAX(ts.day_rate), MAX(la.day_rate_snapshot), MAX(s.day_rate), 0) AS subtotal
    FROM timesheet ts
    LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
    LEFT JOIN staff s ON s.id = ts.staff_id
    WHERE ts.labor_requisition_id = p_labor_requisition_id
      AND ts.rolled_up_expense_id IS NULL
      AND ts.date BETWEEN p_period_start AND p_period_end
      AND ts.check_in_time IS NOT NULL AND ts.check_out_time IS NOT NULL
      AND ts.staff_id IS NOT NULL
      AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
    GROUP BY ts.staff_id;
  END IF;

  SELECT COALESCE(SUM(subtotal),0), COUNT(*), COALESCE(SUM(days_worked),0)
    INTO v_total, v_worker_count, v_days_or_vol FROM _rollup_workers;

  IF v_worker_count = 0 THEN
    RAISE EXCEPTION 'No un-rolled timesheets found in period % to %', p_period_start, p_period_end;
  END IF;

  SELECT project_name INTO v_project_name FROM projects WHERE id = v_req.project_id;
  v_desc := format(
    CASE WHEN v_req.payment_basis = 'per_volume'
         THEN 'Labor payment: %s worker%s · %s %s (%s, %s → %s)'
         ELSE 'Labor payment: %s worker%s · %s day%s (%s, %s → %s)'
    END,
    v_worker_count, CASE WHEN v_worker_count=1 THEN '' ELSE 's' END,
    v_days_or_vol,
    CASE WHEN v_req.payment_basis = 'per_volume' THEN COALESCE(v_req.volume_unit,'units')
         ELSE CASE WHEN v_days_or_vol=1 THEN '' ELSE 's' END END,
    COALESCE(v_project_name,'—'), p_period_start, p_period_end);

  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, project_id, date,
    vendor_id, paid_to_staff_id,
    rolled_up_from_requisition_id, rollup_period_start, rollup_period_end,
    approval_status, payment_state, notes
  ) VALUES (
    v_desc, v_total, 'labor_payment'::expense_category, v_req.project_id, p_period_end,
    CASE WHEN v_req.payment_model='gang_leader' THEN v_req.gang_leader_vendor_id ELSE NULL END,
    CASE WHEN v_req.payment_model='individual' AND v_worker_count=1
         THEN (SELECT staff_id FROM _rollup_workers LIMIT 1) ELSE NULL END,
    p_labor_requisition_id, p_period_start, p_period_end,
    'pending'::expense_approval_status, 'unpaid',
    'Auto-generated by rollup_labor_timesheets_to_expense'
  ) RETURNING id INTO v_expense_id;

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal)
  SELECT v_expense_id, staff_id, days_worked, day_rate, subtotal FROM _rollup_workers;

  UPDATE timesheet SET rolled_up_expense_id = v_expense_id
    WHERE labor_requisition_id = p_labor_requisition_id
      AND rolled_up_expense_id IS NULL
      AND date BETWEEN p_period_start AND p_period_end
      AND check_in_time IS NOT NULL AND check_out_time IS NOT NULL
      AND staff_id IN (SELECT staff_id FROM _rollup_workers);

  RETURN v_expense_id;
END $$;
