-- 449: An event's common proforma.
--
-- EFF 2026's exhibitors all start from one proforma and change their booth's
-- specifics, so each pays a different amount. The project keeps which
-- proforma that is; each exhibitor's proforma starts as a copy of it, and
-- the "who pays" list offers that exhibitor's own proforma total as its
-- contract price.
--
-- base_proforma_id is deliberately not a foreign key: proformas already point
-- at projects (project_id), and a second key between the two tables would
-- make every proformas(...) / projects(...) embed in the app ambiguous to
-- PostgREST (PGRST201), as spot_paid_account_id did to expenses → accounts
-- (fixed in #185). It is only set through project_set_common_proforma(),
-- which checks the proforma is under that project, and the app treats one
-- that has since gone as none.

SET search_path TO public;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS base_proforma_id uuid;
COMMENT ON COLUMN projects.base_proforma_id IS
  'The proforma every paying client of this project starts from (an event''s exhibitors). Set through project_set_common_proforma(); not a foreign key on purpose (see migration 449).';

CREATE OR REPLACE FUNCTION project_set_common_proforma(p_project_id uuid, p_proforma_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'finance', 'executive', 'sales') THEN
    RAISE EXCEPTION 'Only finance, sales, executive or admin can choose the common proforma';
  END IF;
  IF p_proforma_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM proformas WHERE id = p_proforma_id AND project_id = p_project_id) THEN
    RAISE EXCEPTION 'That proforma is not under this project';
  END IF;
  UPDATE projects SET base_proforma_id = p_proforma_id WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
END $$;

REVOKE ALL ON FUNCTION project_set_common_proforma(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION project_set_common_proforma(uuid, uuid) TO authenticated;
