-- ============================================================
-- Security fix for the four BOQ change-order approval RPCs
-- (migration 211): `IF get_user_role() NOT IN (...)` silently
-- passes when get_user_role() returns NULL (unauthenticated/no
-- matching active user_profiles row), because `NULL NOT IN (...)`
-- evaluates to NULL, and PL/pgSQL's IF treats a NULL condition the
-- same as false — the RAISE EXCEPTION branch never runs.
--
-- This is exploitable specifically because these four functions are
-- SECURITY DEFINER (they bypass RLS entirely by design, per the
-- earlier documented decision), so the in-body role check is the
-- ONLY gate — and anon had EXECUTE on them via this project's
-- default privileges (same root cause as the anon-grant fix already
-- applied to the two internal helpers). Fix: reject NULL explicitly.
-- Also revoking EXECUTE from anon AND PUBLIC on all six public BOQ
-- change-order RPCs as defense in depth — none of them have any
-- legitimate unauthenticated caller. A live check confirmed all six
-- carry a standing PUBLIC grant (CREATE FUNCTION's default), which
-- alone gives anon EXECUTE regardless of anything revoked from anon
-- specifically — Postgres ACLs are additive across a role's direct
-- grants and PUBLIC's grants, so both must be revoked.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION pm_approve_change_order(p_change_order_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorized to approve as PM';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.status <> 'pending_pm' THEN
    RAISE EXCEPTION 'Change order is not awaiting PM approval';
  END IF;

  UPDATE boq_change_orders SET pm_reviewed_by = current_staff_id(), pm_reviewed_at = now(), updated_at = now()
  WHERE id = p_change_order_id;

  IF v_co.approval_level_required = 'pm_only' THEN
    PERFORM finalize_change_order(p_change_order_id);
    RETURN 'approved_and_finalized';
  ELSE
    UPDATE boq_change_orders SET status = 'pending_finance', updated_at = now() WHERE id = p_change_order_id;
    RETURN 'advanced_to_finance';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION finance_approve_change_order(p_change_order_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Not authorized to approve as Finance';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.status <> 'pending_finance' THEN
    RAISE EXCEPTION 'Change order is not awaiting Finance approval';
  END IF;

  UPDATE boq_change_orders SET finance_reviewed_by = current_staff_id(), finance_reviewed_at = now(), updated_at = now()
  WHERE id = p_change_order_id;

  IF v_co.approval_level_required = 'pm_finance' THEN
    PERFORM finalize_change_order(p_change_order_id);
    RETURN 'approved_and_finalized';
  ELSE
    UPDATE boq_change_orders SET status = 'pending_exec', updated_at = now() WHERE id = p_change_order_id;
    RETURN 'advanced_to_exec';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION exec_approve_change_order(p_change_order_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive') THEN
    RAISE EXCEPTION 'Not authorized to approve as Executive';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.status <> 'pending_exec' THEN
    RAISE EXCEPTION 'Change order is not awaiting Executive approval';
  END IF;

  UPDATE boq_change_orders SET exec_reviewed_by = current_staff_id(), exec_reviewed_at = now(),
    status = 'pending_client_signoff', updated_at = now()
  WHERE id = p_change_order_id;

  RETURN 'advanced_to_client_signoff';
END;
$$;

CREATE OR REPLACE FUNCTION record_client_signoff(p_change_order_id UUID, p_evidence TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorized to record client sign-off';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.status <> 'pending_client_signoff' THEN
    RAISE EXCEPTION 'Change order is not awaiting client sign-off';
  END IF;
  IF p_evidence IS NULL OR btrim(p_evidence) = '' THEN
    RAISE EXCEPTION 'Sign-off evidence is required';
  END IF;

  UPDATE boq_change_orders SET client_signoff_at = now(), client_signoff_evidence = p_evidence, updated_at = now()
  WHERE id = p_change_order_id;

  PERFORM finalize_change_order(p_change_order_id);
  RETURN 'approved_and_finalized';
END;
$$;

-- Also fixing the same NULL-bypass pattern in the two INVOKER RPCs.
-- These are backed by RLS (a real backstop — RLS treats a NULL
-- USING/WITH CHECK result as not-satisfied, not as pass), so they
-- were not exploitable, but the in-body check should still fail
-- loudly and correctly instead of silently no-op'ing past a bug.
CREATE OR REPLACE FUNCTION submit_boq_change_order(
  p_boq_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_requested_by_client BOOLEAN,
  p_cost_delta_etb NUMERIC,
  p_items JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_boq boqs%ROWTYPE;
  v_co_id UUID;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'project_manager', 'operations_manager', 'design') THEN
    RAISE EXCEPTION 'Not authorized to submit a change order';
  END IF;

  SELECT * INTO v_boq FROM boqs WHERE id = p_boq_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOQ not found';
  END IF;
  IF v_boq.status <> 'approved' THEN
    RAISE EXCEPTION 'Change orders can only be submitted against an approved BOQ';
  END IF;

  INSERT INTO boq_change_orders (boq_id, title, description, requested_by_client, cost_delta_etb, created_by_staff_id)
  VALUES (p_boq_id, p_title, p_description, COALESCE(p_requested_by_client, true), p_cost_delta_etb, current_staff_id())
  RETURNING id INTO v_co_id;

  INSERT INTO boq_change_order_items (
    change_order_id, action, existing_item_id, parent_item_id, new_name, new_unit,
    new_quantity, new_unit_rate_etb, new_notes, new_node_type, new_display_order, new_is_priced_elsewhere
  )
  SELECT
    v_co_id, x.action, x.existing_item_id, x.parent_item_id, x.new_name, x.new_unit,
    x.new_quantity, x.new_unit_rate_etb, x.new_notes, x.new_node_type, x.new_display_order, x.new_is_priced_elsewhere
  FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb)) AS x(
    action TEXT, existing_item_id UUID, parent_item_id UUID, new_name TEXT, new_unit TEXT,
    new_quantity NUMERIC, new_unit_rate_etb NUMERIC, new_notes TEXT, new_node_type TEXT,
    new_display_order INT, new_is_priced_elsewhere BOOLEAN
  );

  RETURN v_co_id;
END;
$$;

CREATE OR REPLACE FUNCTION reject_change_order(p_change_order_id UUID, p_reason TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
  v_role user_role;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;

  v_role := get_user_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  ELSIF v_co.status = 'pending_pm' AND v_role NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorized to reject at this stage';
  ELSIF v_co.status = 'pending_finance' AND v_role NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Not authorized to reject at this stage';
  ELSIF v_co.status = 'pending_exec' AND v_role NOT IN ('admin', 'executive') THEN
    RAISE EXCEPTION 'Not authorized to reject at this stage';
  ELSIF v_co.status = 'pending_client_signoff' AND v_role NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorized to reject at this stage';
  ELSIF v_co.status NOT IN ('pending_pm', 'pending_finance', 'pending_exec', 'pending_client_signoff') THEN
    RAISE EXCEPTION 'This change order is no longer pending';
  END IF;

  UPDATE boq_change_orders SET status = 'rejected', rejection_reason = p_reason, updated_at = now()
  WHERE id = p_change_order_id;

  RETURN 'rejected';
END;
$$;

-- Defense in depth: anon has no legitimate reason to call any of the
-- six public BOQ change-order RPCs. Revoke explicitly rather than
-- relying solely on the in-body check.
--
-- Must also revoke from PUBLIC, not just anon: a live check
-- (information_schema.routine_privileges) confirmed all six
-- functions carry a standing grantee = 'PUBLIC' EXECUTE row (created
-- by CREATE FUNCTION's default behavior, same as the anon-by-default
-- issue). In Postgres's ACL model, a role's effective privileges are
-- the union of privileges granted directly to it AND privileges
-- granted to PUBLIC — revoking from anon alone does not remove what
-- anon still holds via the PUBLIC grant. authenticated is left
-- untouched since it is the legitimate caller for all six.
REVOKE EXECUTE ON FUNCTION submit_boq_change_order(UUID, TEXT, TEXT, BOOLEAN, NUMERIC, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION pm_approve_change_order(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION finance_approve_change_order(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION exec_approve_change_order(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION record_client_signoff(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION reject_change_order(UUID, TEXT) FROM PUBLIC, anon;

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name IN (
  'submit_boq_change_order', 'pm_approve_change_order', 'finance_approve_change_order',
  'exec_approve_change_order', 'record_client_signoff', 'reject_change_order'
)
ORDER BY routine_name, grantee;
