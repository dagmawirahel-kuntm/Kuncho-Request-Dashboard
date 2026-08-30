-- 267 — Merge duplicate staff records into one
--
-- Tier 2 casuals get created at the point of need, often by different
-- people on different sites, so the same person accumulates several
-- records under spelling variants. Each one carries its own slice of the
-- history — attendance, allocations, payments, crew membership — so the
-- person's real record is scattered and their pay history looks thinner
-- than it is.
--
-- Doing this by hand is not realistic: 80 columns across 60-odd tables
-- reference staff(id). Miss one and you either orphan history or hit a
-- foreign key on the delete. So the merge is driven off the catalogue —
-- it re-points every column that actually references staff(id), whatever
-- they are at the time it runs, including staff's own self-references
-- (reports_to_id, referred_by_staff_id).
--
-- Eight unique constraints involve staff_id (timesheet_attendance's
-- (staff_id, project_id, work_date) being the one that bites: two records
-- for the same person on the same site and day). Re-pointing those would
-- violate the constraint, so each table is moved inside its own
-- sub-block; a collision is reported as CONFLICT and left in place rather
-- than aborting the whole merge. The duplicate is only deleted when
-- nothing is left pointing at it — so a partial merge is safe and can be
-- resolved by hand, and never leaves a half-deleted record.

-- sync_wo_attendance_before() refuses any UPDATE to attendance that has
-- already been rolled up into a paid expense — correctly, since that would
-- be rewriting work someone has been paid for. A merge trips it even
-- though it changes nothing about the work: same date, hours, volume and
-- rate, only a different person record holding it.
--
-- So the guard gains one exemption, keyed on a flag that merge_staff_records()
-- sets with is_local => true (transaction-scoped) and clears the moment the
-- re-pointing is done. Nothing else sets it, and it cannot outlive the
-- transaction. Verified: immediately after a merge, a normal edit to paid
-- attendance is refused exactly as before.
CREATE OR REPLACE FUNCTION public.sync_wo_attendance_before()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF NEW.labor_requisition_id IS NOT NULL THEN
    SELECT * INTO v_alloc FROM labor_allocations
     WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND status = 'active'
       AND labor_requisition_id = NEW.labor_requisition_id
     ORDER BY start_date DESC LIMIT 1;
  END IF;

  IF v_alloc.id IS NULL AND NEW.work_order_id IS NOT NULL THEN
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
    IF COALESCE(current_setting('app.staff_merge', true), '') <> 'on' THEN
      IF EXISTS (SELECT 1 FROM timesheet WHERE id = NEW.synced_timesheet_id AND rolled_up_expense_id IS NOT NULL)
         OR EXISTS (
           SELECT 1 FROM timesheet_attendance
           WHERE staff_id = NEW.staff_id AND project_id = NEW.project_id AND work_date = NEW.log_date
             AND rolled_up_expense_id IS NOT NULL
         )
      THEN
        RAISE EXCEPTION 'This attendance entry has already been rolled up into a paid labor expense and can no longer be edited';
      END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.merge_staff_records(p_keep uuid, p_merge uuid)
RETURNS TABLE(table_name text, column_name text, rows_moved int, note text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fk        RECORD;
  v_keep      staff%ROWTYPE;
  v_dup       staff%ROWTYPE;
  v_moved     int;
  v_conflicts int := 0;
  v_remaining int;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'hr_officer') THEN
    RAISE EXCEPTION 'Only admin or HR can merge staff records';
  END IF;

  IF p_keep = p_merge THEN
    RAISE EXCEPTION 'Cannot merge a staff record into itself';
  END IF;

  SELECT * INTO v_keep FROM staff WHERE id = p_keep;
  IF v_keep.id IS NULL THEN RAISE EXCEPTION 'Staff record to keep (%) not found', p_keep; END IF;
  SELECT * INTO v_dup  FROM staff WHERE id = p_merge;
  IF v_dup.id IS NULL THEN RAISE EXCEPTION 'Staff record to merge (%) not found', p_merge; END IF;

  -- Transaction-local: lets the attendance sync trigger tell a merge apart
  -- from someone editing paid work.
  PERFORM set_config('app.staff_merge', 'on', true);

  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f' AND c.confrelid = 'staff'::regclass
    ORDER BY 1, 2
  LOOP
    BEGIN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_fk.tbl, v_fk.col, v_fk.col)
        USING p_keep, p_merge;
      GET DIAGNOSTICS v_moved = ROW_COUNT;

      IF v_moved > 0 THEN
        table_name := v_fk.tbl; column_name := v_fk.col;
        rows_moved := v_moved; note := 'moved';
        RETURN NEXT;
      END IF;
    EXCEPTION WHEN unique_violation OR check_violation THEN
      -- Both records already hold a row the constraint treats as the same
      -- thing (e.g. attendance for one person, one site, one day). Merging
      -- them is a judgement call about which is real, so it's surfaced
      -- rather than guessed at.
      v_conflicts := v_conflicts + 1;
      table_name := v_fk.tbl; column_name := v_fk.col;
      rows_moved := 0; note := 'CONFLICT — both records have a row that collides here; resolve by hand';
      RETURN NEXT;
    END;
  END LOOP;

  -- Close the exemption as soon as the re-pointing is done, so it can't
  -- shelter anything else later in the same transaction.
  PERFORM set_config('app.staff_merge', 'off', true);

  -- Keep the earliest engagement date and the fullest contact details:
  -- the duplicate often holds a field the survivor never had filled in.
  UPDATE staff SET
    first_engaged_at = LEAST(COALESCE(v_keep.first_engaged_at, v_dup.first_engaged_at),
                             COALESCE(v_dup.first_engaged_at,  v_keep.first_engaged_at)),
    phone_number = COALESCE(v_keep.phone_number, v_dup.phone_number),
    email        = COALESCE(v_keep.email,        v_dup.email),
    trade_tag    = COALESCE(v_keep.trade_tag,    v_dup.trade_tag)
  WHERE id = p_keep;

  -- Only remove the duplicate once nothing references it. A conflict above
  -- means something still does, and deleting would either fail on a
  -- foreign key or quietly strand history.
  SELECT count(*) INTO v_remaining
  FROM (
    SELECT 1 FROM labor_expense_workers WHERE staff_id = p_merge
    UNION ALL SELECT 1 FROM timesheet WHERE staff_id = p_merge
    UNION ALL SELECT 1 FROM timesheet_attendance WHERE staff_id = p_merge
    UNION ALL SELECT 1 FROM wo_attendance_log WHERE staff_id = p_merge
    UNION ALL SELECT 1 FROM labor_allocations WHERE staff_id = p_merge
    UNION ALL SELECT 1 FROM work_order_crew WHERE staff_id = p_merge
  ) x;

  IF v_conflicts = 0 AND v_remaining = 0 THEN
    DELETE FROM staff WHERE id = p_merge;
    table_name := 'staff'; column_name := 'id';
    rows_moved := 1; note := format('duplicate "%s" (rate %s) deleted; history now under "%s"',
                                    v_dup.employee_name, v_dup.day_rate, v_keep.employee_name);
  ELSE
    table_name := 'staff'; column_name := 'id';
    rows_moved := 0; note := format('duplicate "%s" KEPT — %s conflict(s), %s labor row(s) still attached',
                                    v_dup.employee_name, v_conflicts, v_remaining);
  END IF;
  RETURN NEXT;
END $function$;

COMMENT ON FUNCTION public.merge_staff_records IS
  'Merges a duplicate staff record into another, re-pointing every column that references staff(id) via the catalogue rather than a hard-coded list. Unique-constraint collisions are reported as CONFLICT and left in place; the duplicate is deleted only when nothing references it. admin/hr_officer only.';

-- Applied: the two records both named "Amare Andualem" (one Aug 19 at AIH
-- paid 1,500, one Aug 20 at Mesob paid 1,700) merged into the earlier-created
-- record, which now carries both engagements and first_engaged_at 2026-08-19.
-- Guarded so a re-run is a no-op once the duplicate is gone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM staff WHERE id = '22e0527f-a9d1-40da-ac8b-86ed1ee02d46')
     AND EXISTS (SELECT 1 FROM staff WHERE id = '78ff7f2d-38ed-444d-9580-d32261d035db') THEN
    PERFORM public.merge_staff_records(
      '78ff7f2d-38ed-444d-9580-d32261d035db',
      '22e0527f-a9d1-40da-ac8b-86ed1ee02d46');
  END IF;
END $$;
