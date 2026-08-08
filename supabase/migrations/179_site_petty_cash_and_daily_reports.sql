-- 179 — Site foreman: petty cash float requests + daily site reports
--
-- Two new pipelines, both scoped to the foreman's assigned projects. The petty
-- cash pipeline auto-routes by amount (≤5k → Finance, >5k → PM) and hands off
-- to the existing petty_cash_floats table once approved; nothing in the
-- existing petty cash flows changes. Daily reports are one-per-foreman-per-
-- project-per-day; supporting views auto-pull headcount/materials/HSE/WO for
-- the report page.

SET search_path TO public;

-- ── Extend petty_cash_floats with the request-origin link (project_id
--    already exists) ───────────────────────────────────────────────────
ALTER TABLE petty_cash_floats
  ADD COLUMN IF NOT EXISTS opened_from_request_id uuid; -- FK added after target table

-- ── Site petty cash float request table ─────────────────────────────
CREATE TABLE IF NOT EXISTS site_petty_cash_float_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  requested_by_staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  requested_amount      numeric(14,2) NOT NULL CHECK (requested_amount > 0 AND requested_amount <= 10000),
  purpose               text,
  status                text NOT NULL DEFAULT 'pending_finance'
                          CHECK (status IN ('pending_finance','pending_pm','approved','rejected','opened')),
  finance_reviewed_by   uuid REFERENCES user_profiles(id),
  finance_reviewed_at   timestamptz,
  pm_reviewed_by        uuid REFERENCES user_profiles(id),
  pm_reviewed_at        timestamptz,
  rejection_reason      text,
  resulting_float_id    uuid REFERENCES petty_cash_floats(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spcfr_project ON site_petty_cash_float_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_spcfr_requester ON site_petty_cash_float_requests(requested_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_spcfr_status ON site_petty_cash_float_requests(status);

-- Now the FK from petty_cash_floats can point to it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name='petty_floats_opened_from_request_fk') THEN
    ALTER TABLE petty_cash_floats
      ADD CONSTRAINT petty_floats_opened_from_request_fk
      FOREIGN KEY (opened_from_request_id) REFERENCES site_petty_cash_float_requests(id);
  END IF;
END $$;

ALTER TABLE site_petty_cash_float_requests ENABLE ROW LEVEL SECURITY;

-- Foreman: read own requests.
DROP POLICY IF EXISTS spcfr_foreman_read_own ON site_petty_cash_float_requests;
CREATE POLICY spcfr_foreman_read_own ON site_petty_cash_float_requests FOR SELECT
  USING (requested_by_staff_id = current_staff_id());

-- Finance: read pending_finance (or anything they've already reviewed).
DROP POLICY IF EXISTS spcfr_finance_read ON site_petty_cash_float_requests;
CREATE POLICY spcfr_finance_read ON site_petty_cash_float_requests FOR SELECT
  USING (get_user_role() = 'finance'
    AND (status = 'pending_finance' OR finance_reviewed_by = auth.uid()));

-- Assigned PM: read pending_pm on their projects.
DROP POLICY IF EXISTS spcfr_pm_read ON site_petty_cash_float_requests;
CREATE POLICY spcfr_pm_read ON site_petty_cash_float_requests FOR SELECT
  USING (
    get_user_role() = 'project_manager'
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.project_manager_id = current_staff_id())
  );

-- Exec / admin: read all.
DROP POLICY IF EXISTS spcfr_exec_read ON site_petty_cash_float_requests;
CREATE POLICY spcfr_exec_read ON site_petty_cash_float_requests FOR SELECT
  USING (get_user_role() IN ('admin','executive'));

-- Insert/update via SECURITY INVOKER RPCs below — no direct INSERT/UPDATE
-- policies (RPCs enforce role + scope). Admin can still fix via ALL.
DROP POLICY IF EXISTS spcfr_admin_all ON site_petty_cash_float_requests;
CREATE POLICY spcfr_admin_all ON site_petty_cash_float_requests FOR ALL
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

GRANT SELECT ON site_petty_cash_float_requests TO authenticated;

-- ── Submit: foreman-only, must be scoped to project. Auto-routes. ───
CREATE OR REPLACE FUNCTION public.submit_site_petty_cash_request(
  p_project_id uuid, p_amount numeric, p_purpose text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
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
  VALUES (p_project_id, v_staff, p_amount, p_purpose, v_status)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.submit_site_petty_cash_request(uuid, numeric, text) TO authenticated;

-- ── Approve: role must match current status. ────────────────────────
CREATE OR REPLACE FUNCTION public.approve_site_petty_cash_request(p_request_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_role := get_user_role()::text;
  IF v_r.status = 'pending_finance' THEN
    IF v_role NOT IN ('finance','admin') THEN RAISE EXCEPTION 'Only Finance can approve a pending_finance request'; END IF;
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
GRANT EXECUTE ON FUNCTION public.approve_site_petty_cash_request(uuid) TO authenticated;

-- ── Reject: same role gating as approve, with a reason. ─────────────
CREATE OR REPLACE FUNCTION public.reject_site_petty_cash_request(p_request_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_role := get_user_role()::text;
  IF v_r.status = 'pending_finance' THEN
    IF v_role NOT IN ('finance','admin') THEN RAISE EXCEPTION 'Only Finance can reject a pending_finance request'; END IF;
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
GRANT EXECUTE ON FUNCTION public.reject_site_petty_cash_request(uuid, text) TO authenticated;

-- ── Open: creates the petty_cash_floats row with foreman as custodian ─
-- Approved requests only. Same role gating as approval (whoever approved is
-- authorised to open); admin can always open. This is the handoff into the
-- existing petty cash system.
CREATE OR REPLACE FUNCTION public.open_float_from_request(p_request_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $function$
DECLARE v_r site_petty_cash_float_requests%ROWTYPE; v_role text; v_float uuid;
BEGIN
  SELECT * INTO v_r FROM site_petty_cash_float_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_r.status <> 'approved' THEN RAISE EXCEPTION 'Only approved requests can open a float (status=%)', v_r.status; END IF;
  v_role := get_user_role()::text;
  -- Whoever approved (finance for ≤5k, PM for >5k) may open; admin always.
  IF NOT (v_role IN ('admin','finance')
    OR (v_role = 'project_manager' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = v_r.project_id AND p.project_manager_id = current_staff_id()
    ))
  ) THEN
    RAISE EXCEPTION 'Not authorised to open this float';
  END IF;

  INSERT INTO petty_cash_floats(custodian_staff_id, project_id, float_amount, current_balance, active, opened_from_request_id)
  VALUES (v_r.requested_by_staff_id, v_r.project_id, v_r.requested_amount, v_r.requested_amount, true, v_r.id)
  RETURNING id INTO v_float;

  UPDATE site_petty_cash_float_requests
    SET status='opened', resulting_float_id=v_float, updated_at=now()
    WHERE id=p_request_id;

  RETURN v_float;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.open_float_from_request(uuid) TO authenticated;

-- ── Budget-context view for the approver's screen (soft warning) ────
-- No server-side block. Frontend renders "Budget X, Committed Y, Actual Z"
-- as context; approver still decides.
CREATE OR REPLACE VIEW v_site_petty_cash_request_context
WITH (security_invoker = true) AS
SELECT
  r.id AS request_id, r.project_id, r.requested_amount, r.status,
  r.requested_by_staff_id, r.purpose, r.created_at,
  p.project_name,
  s.employee_name AS requested_by_name,
  b.total_budget, b.total_actual_with_labor, b.total_committed_with_labor,
  (COALESCE(b.total_budget,0) - COALESCE(b.total_committed_with_labor,0) - COALESCE(b.total_actual_with_labor,0)) AS budget_headroom,
  b.any_group_over_budget
FROM site_petty_cash_float_requests r
JOIN projects p ON p.id = r.project_id
LEFT JOIN staff s ON s.id = r.requested_by_staff_id
LEFT JOIN v_project_budget_summary b ON b.project_id = r.project_id;
GRANT SELECT ON v_site_petty_cash_request_context TO authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- Daily site reports
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS site_daily_reports (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  foreman_staff_id       uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  report_date            date NOT NULL,
  progress_percent_after numeric(5,2),
  weather                text CHECK (weather IN ('sunny','cloudy','rain','heavy_rain')),
  site_accessible        text CHECK (site_accessible IN ('yes','partial','no')),
  progress_notes         text,
  photos                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  headcount_override     integer,
  materials_notes        text,
  hse_near_miss_notes    text,
  tomorrow_plan          text,
  submitted_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, foreman_staff_id, report_date)
);
CREATE INDEX IF NOT EXISTS idx_sdr_project_date ON site_daily_reports(project_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_sdr_foreman ON site_daily_reports(foreman_staff_id);

ALTER TABLE site_daily_reports ENABLE ROW LEVEL SECURITY;

-- Foreman writes their own reports on scoped projects; can edit until submitted.
DROP POLICY IF EXISTS sdr_foreman_insert ON site_daily_reports;
CREATE POLICY sdr_foreman_insert ON site_daily_reports FOR INSERT
  WITH CHECK (
    is_site_foreman_for_project(project_id)
    AND foreman_staff_id = current_staff_id()
  );

DROP POLICY IF EXISTS sdr_foreman_update ON site_daily_reports;
CREATE POLICY sdr_foreman_update ON site_daily_reports FOR UPDATE
  USING (
    is_site_foreman_for_project(project_id)
    AND foreman_staff_id = current_staff_id()
    AND submitted_at IS NULL  -- locked once submitted
  )
  WITH CHECK (
    is_site_foreman_for_project(project_id)
    AND foreman_staff_id = current_staff_id()
  );

DROP POLICY IF EXISTS sdr_foreman_read_own ON site_daily_reports;
CREATE POLICY sdr_foreman_read_own ON site_daily_reports FOR SELECT
  USING (foreman_staff_id = current_staff_id());

-- Assigned PM reads reports for their projects; exec/admin read all.
DROP POLICY IF EXISTS sdr_pm_read ON site_daily_reports;
CREATE POLICY sdr_pm_read ON site_daily_reports FOR SELECT
  USING (
    get_user_role() = 'project_manager'
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.project_manager_id = current_staff_id())
  );

DROP POLICY IF EXISTS sdr_exec_all ON site_daily_reports;
CREATE POLICY sdr_exec_all ON site_daily_reports FOR ALL
  USING (get_user_role() IN ('admin','executive'))
  WITH CHECK (get_user_role() IN ('admin','executive'));

GRANT SELECT, INSERT, UPDATE ON site_daily_reports TO authenticated;

-- ── Auto-populate views (all filterable by project + date) ─────────
-- v_site_report_headcount: tier 1 + tier 2 headcount per project+date.
CREATE OR REPLACE VIEW v_site_report_headcount
WITH (security_invoker = true) AS
SELECT
  t.project_id, t.date AS report_date,
  COUNT(*) FILTER (WHERE t.labor_tier = 1) AS tier1_headcount,
  COUNT(*) FILTER (WHERE t.labor_tier = 2) AS tier2_headcount,
  COUNT(*) AS total_headcount
FROM timesheet t
WHERE t.project_id IS NOT NULL AND t.date IS NOT NULL AND COALESCE(t.is_archived,false) = false
GROUP BY t.project_id, t.date;
GRANT SELECT ON v_site_report_headcount TO authenticated;

-- v_site_report_materials: that day's stock issues (requests) per project.
CREATE OR REPLACE VIEW v_site_report_materials
WITH (security_invoker = true) AS
SELECT
  si.project_id, si.issued_date AS report_date, si.id AS stock_issue_id,
  si.stock_item_id, sit.item_name, si.quantity, sit.unit AS uom, si.notes, si.issued_by_staff_id
FROM stock_issues si
LEFT JOIN stock_items sit ON sit.id = si.stock_item_id
WHERE si.project_id IS NOT NULL AND si.issued_date IS NOT NULL;
GRANT SELECT ON v_site_report_materials TO authenticated;

-- v_site_report_hse: HSE incidents on that project+date.
CREATE OR REPLACE VIEW v_site_report_hse
WITH (security_invoker = true) AS
SELECT
  h.project_id, h.incident_date AS report_date, h.id AS incident_id,
  h.incident_type, h.severity, h.description, h.reported_by, h.status
FROM hse_incidents h
WHERE h.project_id IS NOT NULL AND h.incident_date IS NOT NULL;
GRANT SELECT ON v_site_report_hse TO authenticated;

-- v_site_report_workorders: WOs that changed status "today" on the project.
-- Uses updated_at::date as the activity date (created_at for freshly created).
CREATE OR REPLACE VIEW v_site_report_workorders
WITH (security_invoker = true) AS
SELECT
  w.project_id, w.updated_at::date AS report_date, w.id AS work_order_id,
  w.work_type, w.scope_of_work, w.status, w.target_completion_date
FROM work_orders w
WHERE w.project_id IS NOT NULL;
GRANT SELECT ON v_site_report_workorders TO authenticated;
