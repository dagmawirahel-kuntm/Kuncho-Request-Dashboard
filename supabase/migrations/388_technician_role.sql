-- 388 — What a technician can see and do
--
-- A technician (387) is a tradesperson with a login. They get:
--   • everything a staff login has for themselves — their own requests,
--     expenses, transport, timesheet, advances and pay;
--   • purchase requests for the projects they work on: an active
--     assignment, or a work order they lead or are on the crew of;
--   • progress on the work orders they lead or are on the crew of — what's
--     done on each item, a note, a photo. Completing, cancelling and
--     changing the job stays with the managers.
-- Nothing of a manager's: no approvals, no project money, no other
-- people's records.
--
-- The staff-only policies now read is_self_service_role(), so staff and
-- technician share them rather than each table carrying a second copy.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.is_self_service_role()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(get_user_role() IN ('staff', 'technician'), false)
$$;

-- On the job: leads it or is on its crew.
CREATE OR REPLACE FUNCTION public.works_on_work_order(p_wo uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT current_staff_id() IS NOT NULL AND (
       EXISTS (SELECT 1 FROM work_orders w WHERE w.id = p_wo AND w.assigned_lead_staff_id = current_staff_id())
    OR EXISTS (SELECT 1 FROM work_order_crew c WHERE c.work_order_id = p_wo AND c.staff_id = current_staff_id() AND c.removed_at IS NULL))
$$;

-- Works on the project: an active assignment, or an open job on it.
CREATE OR REPLACE FUNCTION public.works_on_project(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT current_staff_id() IS NOT NULL AND (
       EXISTS (SELECT 1 FROM staff_assignments a WHERE a.staff_id = current_staff_id() AND a.project_id = p_project AND a.active)
    OR EXISTS (SELECT 1 FROM work_orders w WHERE w.project_id = p_project AND w.status NOT IN ('completed', 'cancelled')
                 AND (w.assigned_lead_staff_id = current_staff_id()
                      OR EXISTS (SELECT 1 FROM work_order_crew c WHERE c.work_order_id = w.id AND c.staff_id = current_staff_id() AND c.removed_at IS NULL))))
$$;

-- The projects a person can raise a request for, by the rule above.
CREATE OR REPLACE FUNCTION public.my_work_projects()
RETURNS TABLE (id uuid, project_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.project_name FROM projects p WHERE works_on_project(p.id) ORDER BY p.project_name
$$;

REVOKE EXECUTE ON FUNCTION is_self_service_role(), works_on_work_order(uuid), works_on_project(uuid), my_work_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_self_service_role(), works_on_work_order(uuid), works_on_project(uuid), my_work_projects() TO authenticated;

-- ── Own records: staff and technician alike ─────────────────────────
DROP POLICY IF EXISTS staff_view_own_advances ON cash_advances;
CREATE POLICY staff_view_own_advances ON cash_advances FOR SELECT
  USING (is_self_service_role() AND staff_id IN (SELECT s.id FROM staff s WHERE s.user_id = auth.uid()));

DROP POLICY IF EXISTS staff_view_own_payroll_summary ON emergency_payroll_summary;
CREATE POLICY staff_view_own_payroll_summary ON emergency_payroll_summary FOR SELECT
  USING (is_self_service_role() AND staff_id IN (SELECT s.id FROM staff s WHERE s.user_id = auth.uid()));

DROP POLICY IF EXISTS staff_own_expenses ON expenses;
CREATE POLICY staff_own_expenses ON expenses FOR ALL
  USING (is_self_service_role() AND purchaser_user_id = auth.uid())
  WITH CHECK (is_self_service_role() AND purchaser_user_id = auth.uid());

DROP POLICY IF EXISTS staff_view_own ON staff;
CREATE POLICY staff_view_own ON staff FOR SELECT
  USING (is_self_service_role() AND user_id = auth.uid());

DROP POLICY IF EXISTS staff_own_timesheet ON timesheet;
CREATE POLICY staff_own_timesheet ON timesheet FOR ALL
  USING (is_self_service_role() AND staff_id IN (SELECT s.id FROM staff s
         WHERE s.employee_name = (SELECT up.full_name FROM user_profiles up WHERE up.id = auth.uid())));

DROP POLICY IF EXISTS staff_own_timesheet_select ON timesheet;
CREATE POLICY staff_own_timesheet_select ON timesheet FOR SELECT
  USING (is_self_service_role() AND staff_id IN (SELECT s.id FROM staff s WHERE s.user_id = auth.uid()));

DROP POLICY IF EXISTS staff_own_transport ON transportation_requests;
CREATE POLICY staff_own_transport ON transportation_requests FOR ALL
  USING (is_self_service_role() AND requested_by_id = auth.uid())
  WITH CHECK (is_self_service_role() AND requested_by_id = auth.uid());

-- ── Purchase requests ───────────────────────────────────────────────
-- staff as before: their own, any project. A technician: their own, for a
-- project they work on.
DROP POLICY IF EXISTS technician_own_orders ON orders;
CREATE POLICY technician_own_orders ON orders FOR ALL
  USING (get_user_role() = 'technician' AND requested_by_user_id = auth.uid())
  WITH CHECK (get_user_role() = 'technician' AND requested_by_user_id = auth.uid()
              AND (project_id IS NULL OR works_on_project(project_id)));

DROP POLICY IF EXISTS staff_own_order_items ON order_items;
CREATE POLICY staff_own_order_items ON order_items FOR ALL
  USING (is_self_service_role() AND order_id IN (SELECT o.id FROM orders o WHERE o.requested_by_user_id = auth.uid()))
  WITH CHECK (is_self_service_role() AND order_id IN (SELECT o.id FROM orders o WHERE o.requested_by_user_id = auth.uid()));

-- ── Work orders: the people on the job record its progress ──────────
CREATE OR REPLACE FUNCTION public.record_work_order_progress(p_wo uuid, p_items jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL, p_photo text DEFAULT NULL, p_percent numeric DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  w     work_orders%ROWTYPE;
  x     jsonb;
  v_pct numeric;
BEGIN
  SELECT * INTO w FROM work_orders WHERE id = p_wo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF NOT (can_run_work_order(p_wo) OR works_on_work_order(p_wo)) THEN
    RAISE EXCEPTION 'Only the people on this job, the site''s team or operations can update it';
  END IF;
  IF w.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This work order is %; reopen it to update it', w.status; END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    UPDATE work_order_items
       SET done_quantity = GREATEST(COALESCE((x->>'done_quantity')::numeric, 0), 0), updated_at = now()
     WHERE id = (x->>'id')::uuid AND work_order_id = p_wo
       AND done_quantity IS DISTINCT FROM GREATEST(COALESCE((x->>'done_quantity')::numeric, 0), 0);
  END LOOP;

  v_pct := COALESCE(work_order_items_progress(p_wo), LEAST(GREATEST(p_percent, 0), 100), w.current_progress_pct);
  IF NULLIF(btrim(p_note), '') IS NULL AND p_photo IS NULL AND v_pct = w.current_progress_pct AND jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RETURN v_pct;
  END IF;
  INSERT INTO wo_progress_updates (work_order_id, progress_pct, note, photos, updated_by_staff_id)
  VALUES (p_wo, v_pct, NULLIF(btrim(p_note), ''), CASE WHEN p_photo IS NOT NULL THEN jsonb_build_array(p_photo) END, current_staff_id());
  UPDATE work_orders SET status = 'in_progress' WHERE id = p_wo AND status = 'requested' AND v_pct > 0;
  RETURN v_pct;
END $function$;

-- ── Ermiyas Getahun: workshop electrician ───────────────────────────
-- Signed up as a project manager so he could ask for generator parts.
UPDATE user_profiles SET role = 'technician'
 WHERE id = '704f108c-f6f5-4d92-892b-2200c8c38368' AND role = 'project_manager';
UPDATE staff SET role = 'Electrician'
 WHERE id = '63b1fb8a-72f3-4ab1-a70f-3014c3b43895' AND role IS NULL;
-- He keeps the workshop's maintenance requests through an assignment.
INSERT INTO staff_assignments (staff_id, department_id, role, project_id, is_primary, start_date, active, notes)
SELECT s.id, s.department_id, 'Electrician', p.id, true, CURRENT_DATE, true, 'Workshop electrician (388)'
  FROM staff s, projects p
 WHERE s.id = '63b1fb8a-72f3-4ab1-a70f-3014c3b43895' AND p.project_name = 'Workshop Maintenance'
   AND NOT EXISTS (SELECT 1 FROM staff_assignments a WHERE a.staff_id = s.id AND a.project_id = p.id AND a.active);
