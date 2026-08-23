-- Two related problems surfaced by a real case (Solomon, ceramic worker
-- with three different per-volume rates for ceramic/filler/zecolo work):
--
-- 1. estimated_day_rate was required on every labor requisition
--    regardless of payment_basis, even though per_volume pay is driven
--    by unit_rate. Confirmed live: this forced a placeholder (day_rate
--    = 1.00) onto both of Solomon's duplicate staff records. Every
--    trigger that stamped a new Tier 2 staff/allocation's rate from a
--    requisition used estimated_day_rate unconditionally, ignoring
--    payment_basis, so there was no way to get a correct rate onto the
--    record without also filling in a field that doesn't apply.
--
-- 2. Rate resolution (sync_wo_attendance_before/after) picks "the most
--    recently started active allocation for this staff+project" with no
--    regard to which work order the attendance is actually being logged
--    against. That's fine when someone has one allocation per project,
--    but breaks for a worker with several concurrent per-volume
--    allocations at different rates for different work types on the
--    same project (Solomon's exact case) -- every day would silently
--    resolve to whichever allocation happened to be created last,
--    regardless of which task he actually did that day.
--
-- Fixes:
-- - provision_tier_2_worker_from_candidate, on_labor_req_approved_
--   maybe_allocate, on_labor_req_approved_promote_candidate: use
--   unit_rate instead of estimated_day_rate when payment_basis is
--   per_volume, wherever they stamp a new staff/allocation rate.
-- - sync_wo_attendance_before / sync_wo_attendance_after: prefer the
--   active allocation whose requisition is tied to the same work order
--   the attendance is being logged against; fall back to the old
--   "most recent active allocation on the project" behavior when no
--   such WO-specific match exists, so every existing single-allocation
--   setup keeps working exactly as before.
-- - LaborRequisitionFormPage: Estimated Day Rate is no longer marked
--   required for per_volume requisitions.

SET search_path TO public;

-- estimated_day_rate was NOT NULL at the column level regardless of
-- payment_basis -- the actual source of the "must" the user hit.
ALTER TABLE labor_requisitions ALTER COLUMN estimated_day_rate DROP NOT NULL;

-- ── provision_tier_2_worker_from_candidate ────────────────────────────
CREATE OR REPLACE FUNCTION public.provision_tier_2_worker_from_candidate(p_candidate_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_role     user_role;
  v_cand     candidates%ROWTYPE;
  v_req      labor_requisitions%ROWTYPE;
  v_new_id   uuid;
  v_actor_id uuid;
  v_rate     numeric;
BEGIN
  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'executive', 'hr_officer') THEN
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
  v_rate := CASE WHEN v_req.payment_basis = 'per_volume' THEN v_req.unit_rate ELSE v_req.estimated_day_rate END;

  IF v_cand.phone IS NOT NULL AND btrim(v_cand.phone) <> '' THEN
    SELECT id INTO v_new_id FROM staff
     WHERE employment_type = 'tier_2_casual' AND status = 'active'
       AND phone_number = v_cand.phone
     LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    INSERT INTO staff
      (employee_name, phone_number, email, employment_type, status,
       trade_tag, day_rate, first_engaged_at)
    VALUES
      (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
       v_cand.trade_tag, v_rate, CURRENT_DATE)
    RETURNING id INTO v_new_id;
  END IF;

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
END $function$;

-- ── on_labor_req_approved_maybe_allocate ──────────────────────────────
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_maybe_allocate()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_rate numeric; v_alloc_rate numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.specific_staff_id IS NOT NULL THEN
    SELECT day_rate INTO v_rate FROM staff WHERE id = NEW.specific_staff_id;
    v_alloc_rate := CASE WHEN NEW.payment_basis = 'per_volume' THEN NEW.unit_rate ELSE COALESCE(NEW.estimated_day_rate, v_rate) END;
    INSERT INTO labor_allocations
      (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
    VALUES
      (NEW.specific_staff_id, NEW.project_id,
       COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
       v_alloc_rate,
       'active',
       'Auto-created from approved roster request ' || NEW.id::text,
       NEW.id);
  END IF;
  RETURN NEW;
END $function$;

-- ── on_labor_req_approved_promote_candidate ───────────────────────────
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_promote_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_row      labor_requisition_candidates%ROWTYPE;
  v_cand     candidates%ROWTYPE;
  v_new_id   uuid;
  v_rate     numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    v_rate := CASE WHEN NEW.payment_basis = 'per_volume' THEN NEW.unit_rate ELSE NEW.estimated_day_rate END;
    FOR v_row IN
      SELECT * FROM labor_requisition_candidates
       WHERE requisition_id = NEW.id
         AND promoted_staff_id IS NULL
    LOOP
      SELECT * INTO v_cand FROM candidates WHERE id = v_row.candidate_id;
      IF v_cand.id IS NULL THEN
        RAISE EXCEPTION 'Candidate % not found for requisition %', v_row.candidate_id, NEW.id;
      END IF;

      INSERT INTO staff
        (employee_name, phone_number, email, employment_type, status,
         trade_tag, day_rate, first_engaged_at)
      VALUES
        (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
         NEW.trade_tag, v_rate, COALESCE(NEW.start_date, CURRENT_DATE))
      RETURNING id INTO v_new_id;

      UPDATE candidates
         SET outcome = 'hired',
             outcome_notes = COALESCE(outcome_notes, '') ||
               CASE WHEN outcome_notes IS NULL OR outcome_notes = '' THEN '' ELSE E'\n' END ||
               'Hired via labor requisition ' || NEW.id::text,
             updated_at = now()
       WHERE id = v_row.candidate_id;

      UPDATE labor_requisition_candidates
         SET promoted_staff_id = v_new_id
       WHERE requisition_id = NEW.id AND candidate_id = v_row.candidate_id;

      INSERT INTO labor_allocations
        (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
      VALUES
        (v_new_id, NEW.project_id,
         COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
         v_rate,
         'active',
         'Auto-created from approved requisition ' || NEW.id::text
           || ' · candidate ' || v_row.candidate_id::text,
         NEW.id);
    END LOOP;

    IF EXISTS (SELECT 1 FROM labor_requisition_candidates WHERE requisition_id = NEW.id) THEN
      NEW.specific_staff_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ── sync_wo_attendance_before: prefer the WO-matching allocation ──────
CREATE OR REPLACE FUNCTION public.sync_wo_attendance_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_emp_type text;
  v_alloc    labor_allocations%ROWTYPE;
  v_req      labor_requisitions%ROWTYPE;
  v_day_rate numeric;
  v_days     numeric;
  v_tier     int;
  v_ts_id    uuid;
  v_note     text;
BEGIN
  SELECT employment_type INTO v_emp_type FROM staff WHERE id = NEW.staff_id;
  v_tier := CASE WHEN v_emp_type = 'tier_2_casual' THEN 2 ELSE 1 END;

  IF NEW.work_order_id IS NOT NULL THEN
    SELECT la.* INTO v_alloc FROM labor_allocations la
    JOIN labor_requisitions r ON r.id = la.labor_requisition_id
    WHERE la.staff_id = NEW.staff_id AND la.project_id = NEW.project_id AND la.status = 'active'
      AND r.work_order_id = NEW.work_order_id
    ORDER BY la.start_date DESC LIMIT 1;
  END IF;

  IF v_alloc.id IS NULL THEN
    SELECT * INTO v_alloc FROM labor_allocations
     WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
     ORDER BY start_date DESC LIMIT 1;
  END IF;

  IF v_alloc.labor_requisition_id IS NOT NULL THEN
    SELECT * INTO v_req FROM labor_requisitions WHERE id = v_alloc.labor_requisition_id;
  END IF;

  v_day_rate := CASE WHEN v_req.payment_basis = 'per_volume' THEN v_req.unit_rate
                     ELSE COALESCE(v_alloc.day_rate_snapshot, (SELECT day_rate FROM staff WHERE id = NEW.staff_id), v_req.estimated_day_rate) END;
  v_days := CASE WHEN NEW.hours_logged IS NOT NULL THEN NEW.hours_logged / 8.0 ELSE NULL END;
  v_note := CASE WHEN NEW.is_unallocated THEN 'Unallocated time' || COALESCE(' — ' || NEW.notes, '') ELSE NEW.notes END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO timesheet
      (staff_id, project_id, date, labor_tier, labor_allocation_id, labor_requisition_id, day_rate, days_worked, volume_completed, gang_size, gang_member_staff_ids, overtime_hours, overtime_amount, notes)
    VALUES
      (NEW.staff_id, NEW.project_id, NEW.log_date, v_tier, v_alloc.id, v_alloc.labor_requisition_id, v_day_rate, v_days, NEW.volume_completed, NEW.gang_size, NEW.gang_member_staff_ids, NEW.overtime_hours, NEW.overtime_amount, v_note)
    RETURNING id INTO v_ts_id;
    NEW.synced_timesheet_id := v_ts_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.synced_timesheet_id IS NOT NULL THEN
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
      day_rate = v_day_rate, days_worked = v_days, volume_completed = NEW.volume_completed,
      gang_size = NEW.gang_size, gang_member_staff_ids = NEW.gang_member_staff_ids,
      overtime_hours = NEW.overtime_hours, overtime_amount = NEW.overtime_amount,
      notes = v_note, updated_at = now()
    WHERE id = NEW.synced_timesheet_id;
  END IF;

  RETURN NEW;
END $fn$;

-- ── sync_wo_attendance_after: same WO-matching preference ─────────────
CREATE OR REPLACE FUNCTION public.sync_wo_attendance_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_emp_type    text;
  v_req_id      uuid;
  v_other_exists boolean;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT employment_type INTO v_emp_type FROM staff WHERE id = NEW.staff_id;
    IF v_emp_type = 'tier_2_casual' AND NOT NEW.is_unallocated THEN
      IF NEW.work_order_id IS NOT NULL THEN
        SELECT la.labor_requisition_id INTO v_req_id FROM labor_allocations la
        JOIN labor_requisitions r ON r.id = la.labor_requisition_id
        WHERE la.staff_id = NEW.staff_id AND la.project_id = NEW.project_id AND la.status = 'active'
          AND r.work_order_id = NEW.work_order_id
        ORDER BY la.start_date DESC LIMIT 1;
      END IF;
      IF v_req_id IS NULL THEN
        SELECT labor_requisition_id INTO v_req_id FROM labor_allocations
         WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
         ORDER BY start_date DESC LIMIT 1;
      END IF;

      INSERT INTO timesheet_attendance (staff_id, project_id, work_date, labor_requisition_id, overtime_hours, overtime_amount, created_by)
      VALUES (NEW.staff_id, NEW.project_id, NEW.log_date, v_req_id, NEW.overtime_hours, NEW.overtime_amount, NEW.logged_by_staff_id)
      ON CONFLICT (staff_id, project_id, work_date) DO UPDATE
        SET labor_requisition_id = EXCLUDED.labor_requisition_id,
            overtime_hours = EXCLUDED.overtime_hours,
            overtime_amount = EXCLUDED.overtime_amount
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
END $function$;
