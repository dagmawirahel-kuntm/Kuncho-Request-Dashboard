-- 378 — Who can ask for labour, and taking a request back
--
-- A project manager is an assignment, not only a role: someone named as a
-- project's manager whose login is, say, finance could record and confirm
-- pay on their site (375) but not ask for labour on it. They can now.
-- Whoever asked can also withdraw a request that hasn't been decided yet.

SET search_path TO public;

DROP POLICY IF EXISTS labor_requisitions_request ON labor_requisitions;
CREATE POLICY labor_requisitions_request ON labor_requisitions FOR INSERT WITH CHECK (
  COALESCE(get_user_role() IN ('admin', 'executive', 'project_manager', 'operations_manager', 'hr_officer'), false)
  OR (project_id IS NOT NULL AND (is_site_foreman_for_project(project_id) OR manages_project(project_id)))
);

CREATE OR REPLACE FUNCTION public.withdraw_labour_request(p_req uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r labor_requisitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Only a request still waiting for a decision can be withdrawn'; END IF;
  IF NOT (r.requested_by = auth.uid() OR can_run_labour_site(r.project_id)) THEN
    RAISE EXCEPTION 'Only whoever asked, or the site''s team, can withdraw it';
  END IF;
  UPDATE labor_requisitions SET status = 'rejected', decision_note = 'Withdrawn' || COALESCE(': ' || NULLIF(btrim(p_reason), ''), '')
   WHERE id = p_req;
END $function$;
REVOKE EXECUTE ON FUNCTION withdraw_labour_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION withdraw_labour_request(uuid, text) TO authenticated;
