-- ============================================================
-- Schedule (PR 9b), migration group (c) of 4: work_orders link,
-- baseline RPCs, work-order/BOQ-link RPCs, RLS.
--
-- Every function below follows the mandatory NULL-guard pattern from
-- the top of the PR 9b prompt: an explicit `IF auth.uid() IS NULL
-- THEN RAISE EXCEPTION` as the first executable line, and every
-- role/ownership check that follows is written so a NULL result
-- cannot silently skip the RAISE EXCEPTION branch (get_user_role()
-- comparisons wrapped in COALESCE(..., false); staff-id comparisons
-- guarded with an explicit IS NOT NULL before the equality check).
-- Every function gets REVOKE EXECUTE ... FROM PUBLIC, anon — the
-- exact default-grant gap that caused this whole hardening pass
-- earlier today, not something to reintroduce in new code the same day.
--
-- Two deliberate deviations from the prompt's literal item 26 list,
-- both flagged to the user before writing this file:
--
--   1. link_boq_items_to_task is SECURITY DEFINER, not INVOKER.
--      schedule_task_boq_items gets no direct write RLS policy per
--      item 25 ("writes via RPCs only") — an INVOKER version would
--      simply fail on every call, RLS blocking it regardless of the
--      function's own internal authorization logic.
--
--   2. add_calendar_holiday is a new RPC, not in the prompt's Part 4
--      list at all. calendar_holidays is also scoped to "writes via
--      RPCs only" (item 25) but no RPC was specified for it anywhere
--      in the prompt — without one, nobody could ever add a holiday.
--      Admin-only for company-wide holidays (applies_to_project_id
--      NULL); admin or the specific project's own PM (via the
--      already-load-bearing manages_project() RLS helper) for a
--      project-specific one.
--
-- One addition beyond item 23's literal text: schedules_update's
-- WITH CHECK blocks a non-admin PM from setting status to 'approved'
-- or 'completed' via a raw UPDATE — only admin or the approve_schedule
-- RPC (SECURITY DEFINER) can move status off 'draft'. Unlike BOQ
-- (209's boqs_update lets project_manager set status='approved'
-- directly, since BOQ approval has no side effect to skip), Schedule
-- approval MUST run the baseline-copy logic (current_* -> planned_*
-- across every task) — a bare status UPDATE bypassing that would
-- leave planned_* NULL forever while status says 'approved'. Mirrors
-- BOQ's own status-gated WITH CHECK shape, not an invented pattern.
--
-- create_work_order_from_task's work_type mapping: work_orders has no
-- title column (uses scope_of_work <- task title) and no start-date
-- column (only a single target_completion_date <- task's
-- current_end_date; there is nowhere for current_start_date to go).
-- work_type is NOT NULL CHECK IN ('workshop','site') with no default
-- and no derivable signal from schedule_tasks — resolved with the
-- user: added as an explicit p_work_type parameter rather than
-- guessing a default.
-- ============================================================

SET search_path TO public;

ALTER TABLE work_orders ADD COLUMN schedule_task_id UUID REFERENCES schedule_tasks(id);
CREATE INDEX idx_work_orders_schedule_task ON work_orders(schedule_task_id);

CREATE TABLE schedule_baseline_resets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id         UUID NOT NULL REFERENCES schedules(id),
  reason              TEXT NOT NULL,
  reset_by_staff_id   UUID REFERENCES staff(id),
  reset_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_schedule_baseline_resets_schedule ON schedule_baseline_resets(schedule_id);
ALTER TABLE schedule_baseline_resets ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════
-- approve_schedule — SECURITY DEFINER (writes across every task in
-- the schedule regardless of individual-row RLS, per item 14).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION approve_schedule(p_schedule_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_schedule      schedules%ROWTYPE;
  v_caller_staff  UUID;
  v_role          user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_schedule FROM schedules WHERE id = p_schedule_id;
  IF v_schedule.id IS NULL THEN
    RAISE EXCEPTION 'Schedule % not found', p_schedule_id;
  END IF;
  IF v_schedule.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft schedule can be approved (current status: %)', v_schedule.status;
  END IF;

  v_caller_staff := current_staff_id();
  v_role := get_user_role();
  IF NOT (
    COALESCE(v_role = 'admin', false)
    OR (v_caller_staff IS NOT NULL AND v_caller_staff = v_schedule.owner_pm_staff_id)
  ) THEN
    RAISE EXCEPTION 'Only the assigned PM or an admin can approve this schedule';
  END IF;

  UPDATE schedule_tasks
  SET planned_start_date    = current_start_date,
      planned_end_date      = current_end_date,
      planned_duration_days = current_duration_days
  WHERE schedule_id = p_schedule_id;

  UPDATE schedules
  SET status = 'approved', baseline_locked_at = now(), baseline_locked_by_staff_id = v_caller_staff
  WHERE id = p_schedule_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_schedule(UUID) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- reset_baseline — SECURITY DEFINER (same cross-task write need as
-- approve_schedule, plus an insert into schedule_baseline_resets,
-- which has no direct write policy). PM (owner) + finance + executive
-- + admin, per item 15's "mirroring BOQ change-order escalation" —
-- admin included for consistency with every other access-control
-- clause in this prompt, even though item 15 doesn't restate it.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION reset_baseline(p_schedule_id UUID, p_reason TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_schedule      schedules%ROWTYPE;
  v_caller_staff  UUID;
  v_role          user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to reset a schedule baseline';
  END IF;

  SELECT * INTO v_schedule FROM schedules WHERE id = p_schedule_id;
  IF v_schedule.id IS NULL THEN
    RAISE EXCEPTION 'Schedule % not found', p_schedule_id;
  END IF;
  IF v_schedule.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved (already-baselined) schedule can have its baseline reset (current status: %)', v_schedule.status;
  END IF;

  v_caller_staff := current_staff_id();
  v_role := get_user_role();
  IF NOT (
    COALESCE(v_role IN ('admin', 'finance', 'executive'), false)
    OR (v_caller_staff IS NOT NULL AND v_caller_staff = v_schedule.owner_pm_staff_id)
  ) THEN
    RAISE EXCEPTION 'Only the assigned PM, finance, executive, or admin can reset a schedule baseline';
  END IF;

  UPDATE schedule_tasks
  SET planned_start_date    = current_start_date,
      planned_end_date      = current_end_date,
      planned_duration_days = current_duration_days
  WHERE schedule_id = p_schedule_id;

  INSERT INTO schedule_baseline_resets (schedule_id, reason, reset_by_staff_id)
  VALUES (p_schedule_id, p_reason, v_caller_staff);
END;
$$;

REVOKE EXECUTE ON FUNCTION reset_baseline(UUID, TEXT) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- create_work_order_from_task — SECURITY INVOKER (work_orders already
-- has a permissive direct-write RLS policy from migration 128 that
-- makes DEFINER unnecessary; this function's own body still enforces
-- the narrower "must be THIS schedule's PM" check on top of that).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION create_work_order_from_task(p_task_id UUID, p_work_type TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_task          schedule_tasks%ROWTYPE;
  v_schedule      schedules%ROWTYPE;
  v_caller_staff  UUID;
  v_role          user_role;
  v_wo_id         UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_work_type NOT IN ('workshop', 'site') THEN
    RAISE EXCEPTION 'work_type must be ''workshop'' or ''site'', got %', p_work_type;
  END IF;

  SELECT * INTO v_task FROM schedule_tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Schedule task % not found', p_task_id;
  END IF;
  SELECT * INTO v_schedule FROM schedules WHERE id = v_task.schedule_id;

  v_caller_staff := current_staff_id();
  v_role := get_user_role();
  IF NOT (
    COALESCE(v_role = 'admin', false)
    OR (v_caller_staff IS NOT NULL AND v_caller_staff = v_schedule.owner_pm_staff_id)
  ) THEN
    RAISE EXCEPTION 'Only the assigned PM or an admin can create a work order from a schedule task';
  END IF;

  INSERT INTO work_orders (project_id, work_type, scope_of_work, requested_by, target_completion_date, schedule_task_id)
  VALUES (v_schedule.project_id, p_work_type, v_task.title, auth.uid(), v_task.current_end_date, p_task_id)
  RETURNING id INTO v_wo_id;

  RETURN v_wo_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_work_order_from_task(UUID, TEXT) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- link_boq_items_to_task — SECURITY DEFINER (see header note #1).
-- Idempotent per item 17.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION link_boq_items_to_task(p_task_id UUID, p_boq_item_ids UUID[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_schedule_id   UUID;
  v_owner_pm      UUID;
  v_caller_staff  UUID;
  v_role          user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT st.schedule_id, s.owner_pm_staff_id INTO v_schedule_id, v_owner_pm
  FROM schedule_tasks st JOIN schedules s ON s.id = st.schedule_id
  WHERE st.id = p_task_id;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION 'Schedule task % not found', p_task_id;
  END IF;

  v_caller_staff := current_staff_id();
  v_role := get_user_role();
  IF NOT (
    COALESCE(v_role = 'admin', false)
    OR (v_caller_staff IS NOT NULL AND v_caller_staff = v_owner_pm)
  ) THEN
    RAISE EXCEPTION 'Only the assigned PM or an admin can link BOQ items to a schedule task';
  END IF;

  IF p_boq_item_ids IS NULL OR array_length(p_boq_item_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO schedule_task_boq_items (schedule_task_id, boq_item_id)
  SELECT p_task_id, unnest(p_boq_item_ids)
  ON CONFLICT (schedule_task_id, boq_item_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION link_boq_items_to_task(UUID, UUID[]) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- add_calendar_holiday — SECURITY DEFINER, new RPC not in the
-- prompt's Part 4 list (see header note #2).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION add_calendar_holiday(p_holiday_date DATE, p_name TEXT, p_applies_to_project_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role  user_role;
  v_id    UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_holiday_date IS NULL THEN
    RAISE EXCEPTION 'A holiday date is required';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'A holiday name is required';
  END IF;

  v_role := get_user_role();
  IF p_applies_to_project_id IS NULL THEN
    IF NOT COALESCE(v_role = 'admin', false) THEN
      RAISE EXCEPTION 'Only admin can add a company-wide holiday';
    END IF;
  ELSE
    IF NOT (COALESCE(v_role = 'admin', false) OR manages_project(p_applies_to_project_id)) THEN
      RAISE EXCEPTION 'Only admin or this project''s PM can add a project-specific holiday';
    END IF;
  END IF;

  INSERT INTO calendar_holidays (holiday_date, name, applies_to_project_id, created_by_staff_id)
  VALUES (p_holiday_date, p_name, p_applies_to_project_id, current_staff_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION add_calendar_holiday(DATE, TEXT, UUID) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════

CREATE POLICY schedules_select ON schedules FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer'));

CREATE POLICY schedules_insert ON schedules FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'admin' OR owner_pm_staff_id = current_staff_id());

CREATE POLICY schedules_update ON schedules FOR UPDATE TO authenticated
  USING (get_user_role() = 'admin' OR owner_pm_staff_id = current_staff_id())
  WITH CHECK (
    get_user_role() = 'admin'
    OR (owner_pm_staff_id = current_staff_id() AND status = 'draft')
  );

CREATE POLICY schedule_tasks_select ON schedule_tasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM schedules s WHERE s.id = schedule_tasks.schedule_id
    AND get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer')));

CREATE POLICY schedule_tasks_write ON schedule_tasks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM schedules s WHERE s.id = schedule_tasks.schedule_id
    AND (get_user_role() = 'admin' OR s.owner_pm_staff_id = current_staff_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM schedules s WHERE s.id = schedule_tasks.schedule_id
    AND (get_user_role() = 'admin' OR s.owner_pm_staff_id = current_staff_id())));

CREATE POLICY schedule_task_boq_items_select ON schedule_task_boq_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM schedule_tasks st JOIN schedules s ON s.id = st.schedule_id
    WHERE st.id = schedule_task_boq_items.schedule_task_id
    AND get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer')));
-- No write policy — schedule_task_boq_items writes go through link_boq_items_to_task only.

CREATE POLICY calendar_holidays_select ON calendar_holidays FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer'));
-- No write policy — calendar_holidays writes go through add_calendar_holiday only.

CREATE POLICY schedule_baseline_resets_select ON schedule_baseline_resets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM schedules s WHERE s.id = schedule_baseline_resets.schedule_id
    AND get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer')));
-- No write policy — schedule_baseline_resets writes go through reset_baseline only.

-- Verify.
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN ('approve_schedule', 'reset_baseline', 'create_work_order_from_task', 'link_boq_items_to_task', 'add_calendar_holiday')
ORDER BY proname;
