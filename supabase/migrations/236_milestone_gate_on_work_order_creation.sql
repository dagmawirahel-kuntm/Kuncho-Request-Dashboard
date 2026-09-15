-- PR 9d group (c): soft-warning milestone gate on create_work_order_from_task.
--
-- This is the ONE place this PR touches PR 9b's code, per guardrail 21.
--
-- Rule: if the task's linked BOQ items belong to a payment milestone with
-- sequence_number > 1, and that milestone's IMMEDIATELY PRECEDING milestone
-- (sequence_number - 1, same contract) is not yet 'payment_confirmed', the
-- call returns a warning instead of creating the work order. Passing
-- p_override_reason re-runs it as an explicit override: the work order IS
-- created and the override is logged to milestone_gate_overrides.
--
-- Cancelling simply means never calling again with a reason -- nothing is
-- created and nothing is logged, because the warning path writes nothing at
-- all.
--
-- Non-blocking by construction for everyone else: the gate query is a join
-- through schedule_task_boq_items -> payment_milestone_boq_items. A project
-- with no contract, no milestones, or no BOQ links matches zero rows, so
-- v_block is NULL and the function proceeds exactly as PR 9b's version did.
--
-- SIGNATURE CHANGE: this previously returned a bare UUID. It now returns a
-- row, because the warning needs to carry which milestone is blocking and
-- for how much -- a plain UUID has nowhere to put that. Callers read
-- .work_order_id instead of using the scalar directly (ScheduleSection.tsx
-- is updated alongside this migration). Postgres cannot change a function's
-- return type in place, hence the DROP.
--
-- Still SECURITY INVOKER, as before: work_orders already has a permissive
-- direct-write policy, and this function's own body enforces the narrower
-- "must be THIS schedule's PM" rule on top. The override INSERT into
-- milestone_gate_overrides is the one part that needs elevated rights --
-- that table has no write policy by design (audit log) -- so it is done
-- through a small SECURITY DEFINER helper rather than making the whole
-- function DEFINER.

SET search_path TO public;

-- Audit-log writer. DEFINER purely so the insert can land on a table that
-- deliberately has no write policy; it takes no user-supplied identity --
-- the staff id is resolved from the caller's own session.
CREATE OR REPLACE FUNCTION log_milestone_gate_override(
  p_task_id UUID,
  p_blocking_milestone_id UUID,
  p_reason TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller := current_staff_id();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Your account is not linked to a staff record, so the override cannot be attributed';
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to override the milestone gate';
  END IF;

  INSERT INTO milestone_gate_overrides
    (schedule_task_id, blocking_milestone_id, reason, overridden_by_staff_id)
  VALUES (p_task_id, p_blocking_milestone_id, btrim(p_reason), v_caller);
END;
$$;

REVOKE EXECUTE ON FUNCTION log_milestone_gate_override(UUID, UUID, TEXT) FROM PUBLIC, anon;

DROP FUNCTION IF EXISTS create_work_order_from_task(UUID, TEXT);

CREATE OR REPLACE FUNCTION create_work_order_from_task(
  p_task_id UUID,
  p_work_type TEXT,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  work_order_id            UUID,
  warning_message          TEXT,
  blocking_milestone_id    UUID,
  blocking_milestone_title TEXT,
  blocking_amount_etb      NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_task         schedule_tasks%ROWTYPE;
  v_schedule     schedules%ROWTYPE;
  v_caller_staff UUID;
  v_role         user_role;
  v_wo_id        UUID;
  v_block        RECORD;
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

  -- Milestone gate. Matches nothing (and costs one indexed join) for any
  -- project without a milestone plan.
  SELECT pm_prev.id, pm_prev.title, pm_prev.net_payable_etb, pm_prev.status
    INTO v_block
  FROM schedule_task_boq_items stbi
  JOIN payment_milestone_boq_items pmbi ON pmbi.boq_item_id = stbi.boq_item_id
  JOIN payment_milestones pm            ON pm.id = pmbi.payment_milestone_id
  JOIN payment_milestones pm_prev       ON pm_prev.contract_id = pm.contract_id
                                       AND pm_prev.sequence_number = pm.sequence_number - 1
  WHERE stbi.schedule_task_id = p_task_id
    AND pm.sequence_number > 1
    AND pm_prev.status <> 'payment_confirmed'
  ORDER BY pm_prev.sequence_number
  LIMIT 1;

  IF v_block.id IS NOT NULL AND COALESCE(btrim(p_override_reason), '') = '' THEN
    -- Warning only: create nothing, log nothing. The caller decides.
    RETURN QUERY SELECT
      NULL::UUID,
      format('The previous milestone (%s, %s ETB) has not been confirmed as paid yet (status: %s).',
             v_block.title, to_char(v_block.net_payable_etb, 'FM999,999,999.00'), v_block.status),
      v_block.id,
      v_block.title,
      v_block.net_payable_etb;
    RETURN;
  END IF;

  INSERT INTO work_orders (project_id, work_type, scope_of_work, requested_by, target_completion_date, schedule_task_id)
  VALUES (v_schedule.project_id, p_work_type, v_task.title, auth.uid(), v_task.current_end_date, p_task_id)
  RETURNING id INTO v_wo_id;

  IF v_block.id IS NOT NULL THEN
    PERFORM log_milestone_gate_override(p_task_id, v_block.id, p_override_reason);
  END IF;

  RETURN QUERY SELECT v_wo_id, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::NUMERIC;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_work_order_from_task(UUID, TEXT, TEXT) FROM PUBLIC, anon;
