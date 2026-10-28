-- 487: speed up row-level security everywhere.
-- Policies called get_user_role(), auth.uid(), my_staff_id() and friends
-- directly, so Postgres ran them again for every row it checked — a lookup
-- of the user's profile per row per policy (get_user_role is SECURITY
-- DEFINER, so it can't be inlined). Wrapping each call as (SELECT f()) makes
-- it run once per query. manages_project(col) did a projects lookup per row;
-- it now checks the row's project against the list of projects the user
-- manages, worked out once. Same rules, same rows: checked for one user of
-- each of the 10 roles across all 268 tables before applying.
-- Counting pending orders for a PM went from ~370 ms to ~60 ms; most other
-- lists from hundreds of ms to a few.

CREATE OR REPLACE FUNCTION public.my_managed_project_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p.id FROM projects p WHERE p.project_manager_id IS NOT NULL AND p.project_manager_id = current_staff_id()
$f$;

DO $$
DECLARE pol record; nq text; nc text;
  pat text := '(?<!SELECT )(?<![A-Za-z_.])((?:public\.)?(?:get_user_role|my_staff_id|is_ops_manager|is_self_service_role|current_staff_id)\(\)|auth\.uid\(\)|auth\.jwt\(\))';
  mp text := '(?<![A-Za-z_.])manages_project\(([A-Za-z_][A-Za-z_0-9.]*)\)';
  mp_to text := '(\1 IS NOT NULL AND ((SELECT is_ops_manager()) OR \1 IN (SELECT my_managed_project_ids())))';
BEGIN
  FOR pol IN SELECT * FROM pg_policies WHERE schemaname = 'public' LOOP
    nq := CASE WHEN pol.qual IS NOT NULL THEN regexp_replace(regexp_replace(pol.qual, mp, mp_to, 'g'), pat, '(SELECT \1)', 'g') END;
    nc := CASE WHEN pol.with_check IS NOT NULL THEN regexp_replace(regexp_replace(pol.with_check, mp, mp_to, 'g'), pat, '(SELECT \1)', 'g') END;
    IF nq IS DISTINCT FROM pol.qual OR nc IS DISTINCT FROM pol.with_check THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename)
        || CASE WHEN nq IS NOT NULL THEN ' USING (' || nq || ')' ELSE '' END
        || CASE WHEN nc IS NOT NULL THEN ' WITH CHECK (' || nc || ')' ELSE '' END;
    END IF;
  END LOOP;
END $$;
