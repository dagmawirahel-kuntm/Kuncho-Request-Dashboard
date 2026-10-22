-- 458: Transport jobs are personal. Admin, dispatch (logistics officers) and
-- finance see every job; everyone else — project managers, procurement, HR,
-- stock, operations, executives — sees the jobs they asked for, plus the
-- ones they're driving. Who asked is now always recorded.

-- Who asked: the signed-in person, unless the insert already says.
CREATE OR REPLACE FUNCTION public.trg_transport_requester()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  NEW.requested_by_id := COALESCE(NEW.requested_by_id, auth.uid());
  NEW.requested_by_staff_id := COALESCE(NEW.requested_by_staff_id, current_staff_id());
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_transport_requester
  BEFORE INSERT ON transportation_requests
  FOR EACH ROW EXECUTE FUNCTION trg_transport_requester();

-- A job is mine if I asked for it or I'm the one driving it.
CREATE OR REPLACE FUNCTION public.transport_is_mine(p_requested_by uuid, p_requested_staff uuid, p_assigned_staff uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    p_requested_by = auth.uid()
    OR (p_requested_staff IS NOT NULL AND p_requested_staff = current_staff_id())
    OR (p_assigned_staff IS NOT NULL AND p_assigned_staff = my_staff_id()))
$function$;
REVOKE EXECUTE ON FUNCTION transport_is_mine(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transport_is_mine(uuid, uuid, uuid) TO authenticated;

-- Admin (admin_transportation_requests) and logistics
-- (logistics_officer_all_transport) keep every job. Finance keeps reading
-- and updating every job to pay it. The rest narrow to their own.
ALTER POLICY manager_read_transport ON transportation_requests
  USING (get_user_role() = 'finance'::user_role
         OR (get_user_role() = 'executive'::user_role AND transport_is_mine(requested_by_id, requested_by_staff_id, assigned_staff_id)));

ALTER POLICY ops_manager_read_transport ON transportation_requests
  USING (get_user_role() = 'operations_manager'::user_role AND transport_is_mine(requested_by_id, requested_by_staff_id, assigned_staff_id));

ALTER POLICY raa_transport_select ON transportation_requests
  USING (get_user_role() = ANY (ARRAY['hr_officer'::user_role, 'project_manager'::user_role, 'stock_manager'::user_role, 'procurement_officer'::user_role])
         AND transport_is_mine(requested_by_id, requested_by_staff_id, assigned_staff_id));

ALTER POLICY raa_transport_select_ops ON transportation_requests
  USING ((SELECT is_ops_manager()) AND transport_is_mine(requested_by_id, requested_by_staff_id, assigned_staff_id));

ALTER POLICY raa_transport_update ON transportation_requests
  USING (get_user_role() = 'finance'::user_role
         OR (get_user_role() = ANY (ARRAY['executive'::user_role, 'hr_officer'::user_role, 'project_manager'::user_role, 'stock_manager'::user_role, 'procurement_officer'::user_role])
             AND transport_is_mine(requested_by_id, requested_by_staff_id, assigned_staff_id)));

ALTER POLICY raa_transport_update_ops ON transportation_requests
  USING ((SELECT is_ops_manager()) AND transport_is_mine(requested_by_id, requested_by_staff_id, assigned_staff_id));

-- The full view: admin, logistics officers (role or badge) and finance.
CREATE OR REPLACE FUNCTION public.transport_full_view()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'finance', 'logistics_officer')
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer), false)
$function$;
REVOKE EXECUTE ON FUNCTION transport_full_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transport_full_view() TO authenticated;

-- Each job's requester by name. Names live behind user_profiles / staff
-- RLS, so this reads as its owner but only returns the jobs the viewer may
-- see: every job for the full view, their own otherwise.
CREATE OR REPLACE VIEW v_transport_requesters WITH (security_invoker = false) AS
SELECT t.id AS job_id, t.requested_by_id, COALESCE(u.full_name, s.employee_name) AS requester_name
  FROM transportation_requests t
  LEFT JOIN user_profiles u ON u.id = t.requested_by_id
  LEFT JOIN staff s ON s.id = t.requested_by_staff_id
 WHERE transport_full_view() OR transport_is_mine(t.requested_by_id, t.requested_by_staff_id, t.assigned_staff_id);
