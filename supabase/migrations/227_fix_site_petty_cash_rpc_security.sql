-- Site Float Request has never worked for a real site foreman:
-- submit_site_petty_cash_request(), approve_site_petty_cash_request(),
-- reject_site_petty_cash_request(), and open_float_from_request() all
-- do their own role/ownership checks internally, but ran as SECURITY
-- INVOKER — so the actual INSERT/UPDATE they perform was subject to
-- the caller's own RLS. site_petty_cash_float_requests only has an
-- INSERT/UPDATE-capable policy for role='admin'; every other role only
-- has SELECT. Confirmed live: the table has zero rows, ever.
--
-- Fix: SECURITY DEFINER, matching the pattern already used everywhere
-- else in this codebase for RPCs that do their own in-function
-- authorization (ensure_finance_sourcing_review, rollup_labor_
-- timesheets_to_expense, etc.) — the function's own checks are the
-- real gate, RLS on the table doesn't need to duplicate them.
--
-- Verified live (in a rolled-back transaction, impersonating real
-- users via request.jwt.claims): submit as a real site foreman,
-- approve + open_float_from_request as a real finance user — the full
-- chain now succeeds where it previously raised a row-level security
-- violation on every step but submit's happy path.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.submit_site_petty_cash_request(p_project_id uuid, p_amount numeric, p_purpose text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_staff uuid; v_status text; v_id uuid;
BEGIN
  v_staff := current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'No linked staff record for the current user'; END IF;
  IF NOT is_site_foreman_for_project(p_project_id) THEN
    RAISE EXCEPTION 'You are not the site foreman for that project';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000 THEN
    RAISE EXCEPTION 'Request amount must be between 0 and 10,000 ETB';
  END IF;
  v_status := CASE WHEN p_amount <= 5000 THEN 'pending_finance' ELSE 'pending_pm' END;
  INSERT INTO site_petty_cash_float_requests(project_id, requested_by_staff_id, requested_amount, purpose, status)
  VALUES (p_project_id, v_staff, p_amount, p_purpose, v_status) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_site_petty_cash_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_role := get_user_role()::text;
  IF v_r.status = 'pending_finance' THEN
    IF v_role IS NULL OR v_role NOT IN ('finance','admin') THEN RAISE EXCEPTION 'Only Finance can approve a pending_finance request'; END IF;
    UPDATE site_petty_cash_float_requests
      SET status='approved', finance_reviewed_by=auth.uid(), finance_reviewed_at=now(), updated_at=now()
      WHERE id=p_request_id;
  ELSIF v_r.status = 'pending_pm' THEN
    IF v_role = 'admin' THEN
      NULL;
    ELSIF v_role = 'project_manager' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = v_r.project_id AND p.project_manager_id = current_staff_id()
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Only the assigned Project Manager can approve a pending_pm request';
    END IF;
    UPDATE site_petty_cash_float_requests
      SET status='approved', pm_reviewed_by=auth.uid(), pm_reviewed_at=now(), updated_at=now()
      WHERE id=p_request_id;
  ELSE
    RAISE EXCEPTION 'Request is not pending (status=%)', v_r.status;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_site_petty_cash_request(p_request_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_role := get_user_role()::text;
  IF v_r.status = 'pending_finance' THEN
    IF v_role IS NULL OR v_role NOT IN ('finance','admin') THEN RAISE EXCEPTION 'Only Finance can reject a pending_finance request'; END IF;
    UPDATE site_petty_cash_float_requests
      SET status='rejected', rejection_reason=p_reason,
          finance_reviewed_by=auth.uid(), finance_reviewed_at=now(), updated_at=now()
      WHERE id=p_request_id;
  ELSIF v_r.status = 'pending_pm' THEN
    IF v_role = 'admin' THEN
      NULL;
    ELSIF v_role = 'project_manager' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = v_r.project_id AND p.project_manager_id = current_staff_id()
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Only the assigned Project Manager can reject a pending_pm request';
    END IF;
    UPDATE site_petty_cash_float_requests
      SET status='rejected', rejection_reason=p_reason,
          pm_reviewed_by=auth.uid(), pm_reviewed_at=now(), updated_at=now()
      WHERE id=p_request_id;
  ELSE
    RAISE EXCEPTION 'Request is not pending (status=%)', v_r.status;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_float_from_request(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text; v_float uuid;
BEGIN
  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_r.status <> 'approved' THEN RAISE EXCEPTION 'Only approved requests can open a float (status=%)', v_r.status; END IF;
  v_role := get_user_role()::text;
  IF NOT (v_role IN ('admin','finance')
    OR (v_role = 'project_manager' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = v_r.project_id AND p.project_manager_id = current_staff_id()
    ))
  ) THEN RAISE EXCEPTION 'Not authorised to open this float'; END IF;

  INSERT INTO petty_cash_floats(custodian_staff_id, project_id, float_amount, current_balance, active, opened_from_request_id)
  VALUES (v_r.requested_by_staff_id, v_r.project_id, v_r.requested_amount, v_r.requested_amount, true, v_r.id)
  RETURNING id INTO v_float;
  UPDATE site_petty_cash_float_requests
    SET status='opened', resulting_float_id=v_float, updated_at=now()
    WHERE id=p_request_id;
  RETURN v_float;
END;
$function$;
