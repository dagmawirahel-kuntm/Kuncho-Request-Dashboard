-- 457: Roles with levels (dereja), skills signed off, measured office KPIs.
--
-- Replaces the 1–5 score per responsibility and the foundational /
-- differentiator split. A role (job_descriptions) belongs to a family and
-- has up to three levels (role_levels), each with its own title and an
-- optional pay band that is only ever suggested. Its key_responsibilities
-- are now skills (signed off per person, each at a level), duties (what the
-- job is) or KPIs (measured from the app's own data — office roles).
-- A person holds a role at a level; sign-offs are the evidence, and moving
-- up is a deliberate step once every next-level skill is signed.
-- Who signs: the department head, operations, and — for site roles — a site
-- foreman. Never the person themself.

-- ── Roles ───────────────────────────────────────────────────────────────
ALTER TABLE job_descriptions
  ADD COLUMN IF NOT EXISTS family text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'office',
  ADD COLUMN IF NOT EXISTS role_name_am text,
  ADD COLUMN IF NOT EXISTS reports_to text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE job_descriptions ADD CONSTRAINT job_descriptions_kind_check CHECK (kind IN ('workshop', 'site', 'office'));
COMMENT ON COLUMN job_descriptions.kind IS 'workshop / site / office (457). Site roles can be signed off by a site foreman.';
COMMENT ON COLUMN job_descriptions.confirmed_at IS 'Draft until the department head or operations confirms it (457).';

CREATE TABLE IF NOT EXISTS role_levels (
  job_description_id uuid NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
  level        smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  title        text NOT NULL CHECK (btrim(title) <> ''),
  title_am     text,
  summary      text,
  day_rate_min numeric(12,2) CHECK (day_rate_min IS NULL OR day_rate_min >= 0),
  day_rate_max numeric(12,2) CHECK (day_rate_max IS NULL OR day_rate_max >= COALESCE(day_rate_min, 0)),
  monthly_min  numeric(12,2) CHECK (monthly_min IS NULL OR monthly_min >= 0),
  monthly_max  numeric(12,2) CHECK (monthly_max IS NULL OR monthly_max >= COALESCE(monthly_min, 0)),
  PRIMARY KEY (job_description_id, level)
);
COMMENT ON TABLE role_levels IS 'A role''s levels — dereja 1–3 (457). Pay bands are a suggestion, never applied.';
ALTER TABLE role_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_levels_read ON role_levels FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY role_levels_manage ON role_levels FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin'::user_role, 'operations_manager'::user_role]) OR (SELECT is_ops_manager()))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin'::user_role, 'operations_manager'::user_role]) OR (SELECT is_ops_manager()));

-- ── Skills, duties, KPIs ────────────────────────────────────────────────
ALTER TABLE key_responsibilities
  ADD COLUMN IF NOT EXISTS level smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'skill',
  ADD COLUMN IF NOT EXISTS kpi_key text,
  ADD COLUMN IF NOT EXISTS title_am text;
ALTER TABLE key_responsibilities ADD CONSTRAINT key_responsibilities_level_check CHECK (level BETWEEN 1 AND 3);
ALTER TABLE key_responsibilities ADD CONSTRAINT key_responsibilities_kind_check CHECK (kind IN ('skill', 'duty', 'kpi'));
COMMENT ON COLUMN key_responsibilities.kind IS 'skill: signed off per person; duty: what the job is; kpi: measured by role_kpis() (457).';

-- The old tier follows the level, so views built on it keep working.
CREATE OR REPLACE FUNCTION public.trg_key_responsibility_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  NEW.tier := CASE WHEN NEW.level <= 1 THEN 'foundational' ELSE 'differentiator' END;
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_key_responsibility_tier
  BEFORE INSERT OR UPDATE OF level ON key_responsibilities
  FOR EACH ROW EXECUTE FUNCTION trg_key_responsibility_tier();

-- ── A person's level ───────────────────────────────────────────────────
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS role_level smallint,
  ADD COLUMN IF NOT EXISTS role_level_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS role_level_set_by uuid REFERENCES auth.users(id);
ALTER TABLE staff ADD CONSTRAINT staff_role_level_check CHECK (role_level IS NULL OR role_level BETWEEN 1 AND 3);

CREATE TABLE IF NOT EXISTS role_level_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  job_description_id uuid REFERENCES job_descriptions(id),
  from_role_id uuid REFERENCES job_descriptions(id),
  from_level smallint,
  to_level smallint,
  note text,
  changed_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS role_level_changes_staff_idx ON role_level_changes (staff_id, changed_at DESC);
ALTER TABLE role_level_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_level_changes_read ON role_level_changes FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Sign-offs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid REFERENCES staff(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES key_responsibilities(id),
  signed_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  photo_url text,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revoke_note text,
  CHECK ((staff_id IS NULL) <> (candidate_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS skill_signoffs_staff_live ON skill_signoffs (staff_id, skill_id) WHERE revoked_at IS NULL AND staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS skill_signoffs_candidate_live ON skill_signoffs (candidate_id, skill_id) WHERE revoked_at IS NULL AND candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS skill_signoffs_skill_idx ON skill_signoffs (skill_id) WHERE revoked_at IS NULL;
COMMENT ON TABLE skill_signoffs IS 'Someone saw this person (or candidate) do this skill (457). Revoked, never removed.';
ALTER TABLE skill_signoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY skill_signoffs_read ON skill_signoffs FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Subcontractor ratings: the same four scores as a job ──────────────
CREATE TABLE IF NOT EXISTS subcontract_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontract_id uuid NOT NULL UNIQUE REFERENCES subcontractor_engagements(id) ON DELETE CASCADE,
  score_quality smallint NOT NULL CHECK (score_quality BETWEEN 1 AND 5),
  score_timeliness smallint NOT NULL CHECK (score_timeliness BETWEEN 1 AND 5),
  score_safety smallint NOT NULL CHECK (score_safety BETWEEN 1 AND 5),
  score_cooperation smallint NOT NULL CHECK (score_cooperation BETWEEN 1 AND 5),
  comment text,
  rated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  rated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subcontract_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY subcontract_ratings_read ON subcontract_ratings FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Who may do what ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_roles()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'executive', 'hr_officer', 'operations_manager') OR is_ops_manager(), false)
$function$;

CREATE OR REPLACE FUNCTION public.is_any_site_foreman()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM staff s LEFT JOIN staff_assignments a ON a.staff_id = s.id AND a.active
     WHERE s.user_id = auth.uid()
       AND (lower(s.role) = 'site_foreman' OR lower(a.role) IN ('site_foreman', 'site foreman')))
$function$;

-- Signing off p_staff (or a candidate: p_staff null) on role p_role.
CREATE OR REPLACE FUNCTION public.can_sign_off(p_staff uuid, p_role uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_me uuid := current_staff_id(); r job_descriptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF p_staff IS NOT NULL AND p_staff = v_me THEN RETURN false; END IF;
  IF get_user_role() IN ('admin', 'executive', 'operations_manager') OR is_ops_manager() THEN RETURN true; END IF;
  SELECT * INTO r FROM job_descriptions WHERE id = p_role;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_me IS NOT NULL AND EXISTS (SELECT 1 FROM departments d WHERE d.head_staff_id = v_me
       AND (d.id = r.department_id OR d.id = (SELECT department_id FROM staff WHERE id = p_staff))) THEN
    RETURN true;
  END IF;
  RETURN r.kind = 'site' AND is_any_site_foreman();
END $function$;

-- ── Giving people a role and level (one or many) ───────────────────────
-- p_rows: [{staff_id, role_id, level, note?}]
CREATE OR REPLACE FUNCTION public.set_staff_roles(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE x jsonb; s staff%ROWTYPE; v_role uuid; v_level smallint; v_n int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    SELECT * INTO s FROM staff WHERE id = (x->>'staff_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found'; END IF;
    v_role := NULLIF(x->>'role_id', '')::uuid;
    v_level := CASE WHEN v_role IS NULL THEN NULL ELSE COALESCE(NULLIF(x->>'level', '')::smallint, 1) END;
    IF NOT (can_manage_roles() OR (v_role IS NOT NULL AND can_sign_off(s.id, v_role))) THEN
      RAISE EXCEPTION 'You can''t set the role for %', s.employee_name;
    END IF;
    IF v_role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM role_levels WHERE job_description_id = v_role AND level = v_level) THEN
      RAISE EXCEPTION '% — that role has no level %', s.employee_name, v_level;
    END IF;
    IF s.job_description_id IS NOT DISTINCT FROM v_role AND s.role_level IS NOT DISTINCT FROM v_level THEN CONTINUE; END IF;
    UPDATE staff SET job_description_id = v_role, role_level = v_level, role_level_set_at = now(), role_level_set_by = auth.uid()
     WHERE id = s.id;
    INSERT INTO role_level_changes (staff_id, job_description_id, from_role_id, from_level, to_level, note)
    VALUES (s.id, v_role, s.job_description_id, s.role_level, v_level, NULLIF(btrim(x->>'note'), ''));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

-- ── Signing off ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sign_off_skills(p_staff uuid, p_candidate uuid, p_skills uuid[],
  p_note text DEFAULT NULL, p_photo text DEFAULT NULL, p_work_order uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_role uuid; v_n int := 0; k key_responsibilities%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF (p_staff IS NULL) = (p_candidate IS NULL) THEN RAISE EXCEPTION 'Sign off a staff member or a candidate'; END IF;
  v_role := CASE WHEN p_staff IS NOT NULL THEN (SELECT job_description_id FROM staff WHERE id = p_staff)
                 ELSE (SELECT assessed_for_role_id FROM candidates WHERE id = p_candidate) END;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Give them a role first — skills are signed off against it'; END IF;
  IF p_staff IS NOT NULL AND p_staff = current_staff_id() THEN RAISE EXCEPTION 'You can''t sign off your own skills'; END IF;
  IF NOT can_sign_off(p_staff, v_role) THEN
    RAISE EXCEPTION 'Only their department head, operations, or (for site work) a site foreman can sign this off';
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_skills, '{}') LOOP
    SELECT * INTO k FROM key_responsibilities WHERE id = v_id;
    IF NOT FOUND OR k.job_description_id <> v_role OR k.kind <> 'skill' OR NOT k.active THEN
      RAISE EXCEPTION 'That skill is not on their role';
    END IF;
    INSERT INTO skill_signoffs (staff_id, candidate_id, skill_id, note, photo_url, work_order_id)
    SELECT p_staff, p_candidate, v_id, NULLIF(btrim(p_note), ''), NULLIF(p_photo, ''), p_work_order
     WHERE NOT EXISTS (SELECT 1 FROM skill_signoffs o WHERE o.skill_id = v_id AND o.revoked_at IS NULL
                         AND (o.staff_id = p_staff OR o.candidate_id = p_candidate));
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $function$;

CREATE OR REPLACE FUNCTION public.revoke_skill_signoff(p_signoff uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o skill_signoffs%ROWTYPE; v_role uuid;
BEGIN
  SELECT * INTO o FROM skill_signoffs WHERE id = p_signoff AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sign-off not found'; END IF;
  SELECT job_description_id INTO v_role FROM key_responsibilities WHERE id = o.skill_id;
  IF NOT (o.signed_by = auth.uid() OR can_sign_off(o.staff_id, v_role)) THEN RAISE EXCEPTION 'You can''t take this sign-off back'; END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why it''s taken back'; END IF;
  UPDATE skill_signoffs SET revoked_at = now(), revoked_by = auth.uid(), revoke_note = btrim(p_note) WHERE id = o.id;
END $function$;

-- Up one level, once every skill of the next level is signed off.
CREATE OR REPLACE FUNCTION public.move_up_level(p_staff uuid, p_note text DEFAULT NULL)
RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s staff%ROWTYPE; v_next smallint; v_missing text;
BEGIN
  SELECT * INTO s FROM staff WHERE id = p_staff;
  IF NOT FOUND OR s.job_description_id IS NULL THEN RAISE EXCEPTION 'They have no role yet'; END IF;
  IF NOT can_sign_off(p_staff, s.job_description_id) THEN RAISE EXCEPTION 'Only their department head, operations, or (for site work) a site foreman can move them up'; END IF;
  v_next := COALESCE(s.role_level, 0) + 1;
  IF NOT EXISTS (SELECT 1 FROM role_levels WHERE job_description_id = s.job_description_id AND level = v_next) THEN
    RAISE EXCEPTION 'They are at the top level of their role';
  END IF;
  SELECT string_agg(k.responsibility_title, '; ' ORDER BY k.sort_order) INTO v_missing
    FROM key_responsibilities k
   WHERE k.job_description_id = s.job_description_id AND k.kind = 'skill' AND k.active AND k.level <= v_next
     AND NOT EXISTS (SELECT 1 FROM skill_signoffs o WHERE o.staff_id = p_staff AND o.skill_id = k.id AND o.revoked_at IS NULL);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'Not signed off yet: %', v_missing; END IF;
  UPDATE staff SET role_level = v_next, role_level_set_at = now(), role_level_set_by = auth.uid() WHERE id = p_staff;
  INSERT INTO role_level_changes (staff_id, job_description_id, from_role_id, from_level, to_level, note)
  VALUES (p_staff, s.job_description_id, s.job_description_id, s.role_level, v_next, NULLIF(btrim(p_note), ''));
  RETURN v_next;
END $function$;

CREATE OR REPLACE FUNCTION public.confirm_role(p_role uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT (can_manage_roles() OR EXISTS (SELECT 1 FROM job_descriptions j JOIN departments d ON d.id = j.department_id
                                         WHERE j.id = p_role AND d.head_staff_id = current_staff_id())) THEN
    RAISE EXCEPTION 'Only the department head or operations can confirm a role';
  END IF;
  UPDATE job_descriptions SET confirmed_at = now(), confirmed_by = auth.uid(), active = true WHERE id = p_role;
END $function$;

CREATE OR REPLACE FUNCTION public.rate_subcontract(p_subcontract uuid, p_quality int, p_timeliness int, p_safety int, p_cooperation int, p_comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT can_write_subcontracts() THEN RAISE EXCEPTION 'Only admin, executive, operations, project managers or procurement can rate subcontractors'; END IF;
  UPDATE subcontract_ratings SET score_quality = p_quality, score_timeliness = p_timeliness, score_safety = p_safety,
         score_cooperation = p_cooperation, comment = NULLIF(btrim(p_comment), ''), rated_by = auth.uid(), rated_at = now()
   WHERE subcontract_id = p_subcontract;
  IF NOT FOUND THEN
    INSERT INTO subcontract_ratings (subcontract_id, score_quality, score_timeliness, score_safety, score_cooperation, comment)
    VALUES (p_subcontract, p_quality, p_timeliness, p_safety, p_cooperation, NULLIF(btrim(p_comment), ''));
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.subcontract_rated_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT subcontract_id FROM subcontract_ratings
  UNION
  SELECT subcontract_id FROM competency_ratings WHERE subcontract_id IS NOT NULL
$function$;

-- A hired candidate keeps what was signed off on their trial.
CREATE OR REPLACE FUNCTION public.trg_candidate_carry_signoffs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.provisioned_staff_id IS NULL OR NEW.provisioned_staff_id IS NOT DISTINCT FROM OLD.provisioned_staff_id THEN RETURN NEW; END IF;
  IF NEW.assessed_for_role_id IS NOT NULL THEN
    UPDATE staff SET job_description_id = NEW.assessed_for_role_id, role_level = COALESCE(role_level, 1),
                     role_level_set_at = COALESCE(role_level_set_at, now())
     WHERE id = NEW.provisioned_staff_id AND job_description_id IS NULL;
  END IF;
  INSERT INTO skill_signoffs (staff_id, skill_id, signed_by, signed_at, note, photo_url)
  SELECT NEW.provisioned_staff_id, o.skill_id, o.signed_by, o.signed_at, COALESCE(o.note, 'Signed off on their trial'), o.photo_url
    FROM skill_signoffs o
   WHERE o.candidate_id = NEW.id AND o.revoked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM skill_signoffs x WHERE x.staff_id = NEW.provisioned_staff_id AND x.skill_id = o.skill_id AND x.revoked_at IS NULL);
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_candidate_carry_signoffs
  AFTER UPDATE OF provisioned_staff_id ON candidates
  FOR EACH ROW EXECUTE FUNCTION trg_candidate_carry_signoffs();

-- ── Office KPIs, measured ──────────────────────────────────────────────
-- For the person's role, each KPI it lists that the app can measure, over
-- the last 90 days (30 for daily reports). scope: person (their own
-- actions) or team (the whole function — no one person's name on it).
CREATE OR REPLACE FUNCTION public.role_kpis(p_staff uuid)
RETURNS TABLE (kpi_key text, label text, value numeric, unit text, target numeric, better text, sample integer, scope text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE s staff%ROWTYPE; k record; v numeric; n integer;
BEGIN
  SELECT * INTO s FROM staff WHERE id = p_staff;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT (can_manage_roles() OR p_staff = current_staff_id()
          OR EXISTS (SELECT 1 FROM departments d WHERE d.id = s.department_id AND d.head_staff_id = current_staff_id())) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  FOR k IN SELECT r.kpi_key AS key, r.responsibility_title AS title FROM key_responsibilities r
            WHERE r.job_description_id = s.job_description_id AND r.kind = 'kpi' AND r.active AND r.kpi_key IS NOT NULL
            ORDER BY r.sort_order LOOP
    v := NULL; n := 0;
    IF k.key = 'fin_approval_hours' THEN
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.finance_approved_at - COALESCE(e.manager_approved_at, e.created_at)) / 3600), count(*)
        INTO v, n FROM expenses e
       WHERE e.finance_approved_by = s.user_id AND e.finance_approved_at > now() - interval '90 days'
         AND e.finance_approved_at >= COALESCE(e.manager_approved_at, e.created_at);
      kpi_key := k.key; label := k.title; value := round(v, 1); unit := 'hours (median)'; target := 24; better := 'lower'; sample := n; scope := 'person'; RETURN NEXT;
    ELSIF k.key = 'fin_payment_hours' THEN
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.payment_confirmed_at - e.finance_approved_at) / 3600), count(*)
        INTO v, n FROM expenses e
       WHERE e.payment_confirmed_by = s.user_id AND e.payment_confirmed_at > now() - interval '90 days'
         AND e.finance_approved_at IS NOT NULL AND e.payment_confirmed_at >= e.finance_approved_at;
      kpi_key := k.key; label := k.title; value := round(v, 1); unit := 'hours (median)'; target := 48; better := 'lower'; sample := n; scope := 'person'; RETURN NEXT;
    ELSIF k.key = 'fin_bank_backlog' THEN
      SELECT count(*) INTO n FROM v_bank_line_status b WHERE b.reconciled_as IS NULL AND b.value_date < current_date - 14;
      kpi_key := k.key; label := k.title; value := n; unit := 'bank lines unexplained after 14 days'; target := 0; better := 'lower'; sample := n; scope := 'team'; RETURN NEXT;
    ELSIF k.key = 'stock_receipt_lag' THEN
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (r.created_at::date - r.received_date)), count(*)
        INTO v, n FROM stock_receipts r
       WHERE r.created_at > now() - interval '90 days' AND r.reversed_at IS NULL AND r.received_date IS NOT NULL;
      kpi_key := k.key; label := k.title; value := round(v, 1); unit := 'days from receiving to recording (median)'; target := 1; better := 'lower'; sample := n; scope := 'team'; RETURN NEXT;
    ELSIF k.key = 'pm_wo_fresh' THEN
      SELECT round(100.0 * count(*) FILTER (WHERE GREATEST(w.updated_at, (SELECT max(u.created_at) FROM wo_progress_updates u WHERE u.work_order_id = w.id)) > now() - interval '7 days')
                   / NULLIF(count(*), 0), 1), count(*)
        INTO v, n FROM work_orders w JOIN projects p ON p.id = w.project_id
       WHERE p.project_manager_id = p_staff AND w.status IN ('requested', 'in_progress');
      kpi_key := k.key; label := k.title; value := v; unit := '% of open work orders updated this week'; target := 80; better := 'higher'; sample := n; scope := 'person'; RETURN NEXT;
    ELSIF k.key = 'foreman_daily_reports' THEN
      WITH proj AS (
        SELECT DISTINCT a.project_id FROM staff_assignments a
         WHERE a.staff_id = p_staff AND a.active AND a.project_id IS NOT NULL
           AND (lower(s.role) = 'site_foreman' OR lower(a.role) IN ('site_foreman', 'site foreman'))
      ), days AS (
        SELECT d::date AS day FROM generate_series(current_date - 30, current_date - 1, interval '1 day') d
         WHERE extract(isodow FROM d) < 7
      ), grid AS (
        SELECT p.project_id, days.day,
               EXISTS (SELECT 1 FROM site_daily_reports r WHERE r.project_id = p.project_id AND r.report_date = days.day
                         AND r.submitted_at IS NOT NULL AND r.superseded_by IS NULL) AS reported
          FROM proj p CROSS JOIN days
      )
      SELECT round(100.0 * count(*) FILTER (WHERE reported) / NULLIF(count(*), 0), 1), count(*) INTO v, n FROM grid;
      kpi_key := k.key; label := k.title; value := v; unit := '% of working days with a daily report (30 days)'; target := 90; better := 'higher'; sample := n; scope := 'person'; RETURN NEXT;
    ELSIF k.key = 'hr_record_gaps' THEN
      SELECT count(*) INTO n FROM staff x
       WHERE x.status = 'active' AND COALESCE(x.employment_type, '') <> 'tier_2_casual'
         AND (NULLIF(btrim(x.phone_number), '') IS NULL OR x.employment_type IS NULL OR x.department_id IS NULL
              OR (NULLIF(btrim(x.bank_account), '') IS NULL AND x.bank_id IS NULL));
      kpi_key := k.key; label := k.title; value := n; unit := 'staff records missing phone, bank, department or type'; target := 0; better := 'lower'; sample := n; scope := 'team'; RETURN NEXT;
    ELSIF k.key = 'hse_open_incidents' THEN
      SELECT count(*) INTO n FROM hse_incidents i WHERE COALESCE(i.status::text, 'open') NOT IN ('closed', 'resolved') AND i.incident_date < current_date - 7;
      kpi_key := k.key; label := k.title; value := n; unit := 'incidents open more than a week'; target := 0; better := 'lower'; sample := n; scope := 'team'; RETURN NEXT;
    END IF;
  END LOOP;
END $function$;

REVOKE EXECUTE ON FUNCTION can_manage_roles(), is_any_site_foreman(), can_sign_off(uuid, uuid), set_staff_roles(jsonb),
  sign_off_skills(uuid, uuid, uuid[], text, text, uuid), revoke_skill_signoff(uuid, text), move_up_level(uuid, text),
  confirm_role(uuid), rate_subcontract(uuid, int, int, int, int, text), role_kpis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_manage_roles(), is_any_site_foreman(), can_sign_off(uuid, uuid), set_staff_roles(jsonb),
  sign_off_skills(uuid, uuid, uuid[], text, text, uuid), revoke_skill_signoff(uuid, text), move_up_level(uuid, text),
  confirm_role(uuid), rate_subcontract(uuid, int, int, int, int, text), role_kpis(uuid) TO authenticated;

-- ── Views ──────────────────────────────────────────────────────────────
-- Each active person with their role, level, sign-offs and pay against the band.
-- Like v_staff_directory: names, roles and sign-offs for everyone signed in
-- (foremen and department heads sign people off without reading staff);
-- pay only for those who may already see it.
CREATE OR REPLACE FUNCTION public.can_see_staff_pay()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'hr_officer', 'executive', 'finance'), false)
$function$;
GRANT EXECUTE ON FUNCTION can_see_staff_pay() TO authenticated;

CREATE OR REPLACE VIEW v_staff_roles WITH (security_invoker = false) AS
WITH sk AS (
  SELECT s.id AS staff_id, k.level,
         count(*) AS total,
         count(o.id) AS signed,
         max(o.signed_at) AS last_signed
    FROM staff s
    JOIN key_responsibilities k ON k.job_description_id = s.job_description_id AND k.kind = 'skill' AND k.active
    LEFT JOIN skill_signoffs o ON o.staff_id = s.id AND o.skill_id = k.id AND o.revoked_at IS NULL
   GROUP BY s.id, k.level
)
SELECT s.id AS staff_id, s.employee_name, s.employment_type, s.trade_tag, s.role AS role_text, s.phone_number,
       s.department_id, d.name AS department_name,
       (CASE WHEN can_see_staff_pay() THEN s.day_rate END)::numeric(12,2) AS day_rate,
       (CASE WHEN can_see_staff_pay() THEN s.monthly_salary END)::numeric(12,2) AS monthly_salary,
       s.job_description_id, j.role_name, j.role_name_am, j.family, j.kind AS role_kind,
       s.role_level, l.title AS level_title, l.title_am AS level_title_am,
       (SELECT max(level) FROM role_levels x WHERE x.job_description_id = s.job_description_id) AS max_level,
       COALESCE((SELECT sum(total) FROM sk WHERE sk.staff_id = s.id AND sk.level <= COALESCE(s.role_level, 1)), 0)::int AS skills_total,
       COALESCE((SELECT sum(signed) FROM sk WHERE sk.staff_id = s.id AND sk.level <= COALESCE(s.role_level, 1)), 0)::int AS skills_signed,
       COALESCE((SELECT sum(total) FROM sk WHERE sk.staff_id = s.id AND sk.level = COALESCE(s.role_level, 0) + 1), 0)::int AS next_total,
       COALESCE((SELECT sum(signed) FROM sk WHERE sk.staff_id = s.id AND sk.level = COALESCE(s.role_level, 0) + 1), 0)::int AS next_signed,
       (SELECT max(last_signed) FROM sk WHERE sk.staff_id = s.id) AS last_signed_at,
       l.day_rate_min, l.day_rate_max, l.monthly_min, l.monthly_max,
       CASE WHEN NOT can_see_staff_pay() THEN NULL
            WHEN s.day_rate IS NOT NULL AND s.day_rate > 0 AND (l.day_rate_min IS NOT NULL OR l.day_rate_max IS NOT NULL)
              THEN s.day_rate < COALESCE(l.day_rate_min, 0) OR s.day_rate > COALESCE(l.day_rate_max, s.day_rate)
            WHEN s.monthly_salary IS NOT NULL AND s.monthly_salary > 0 AND (l.monthly_min IS NOT NULL OR l.monthly_max IS NOT NULL)
              THEN s.monthly_salary < COALESCE(l.monthly_min, 0) OR s.monthly_salary > COALESCE(l.monthly_max, s.monthly_salary)
            ELSE false END AS out_of_band,
       s.role_level_set_at
  FROM staff s
  LEFT JOIN departments d ON d.id = s.department_id
  LEFT JOIN job_descriptions j ON j.id = s.job_description_id
  LEFT JOIN role_levels l ON l.job_description_id = s.job_description_id AND l.level = s.role_level
 WHERE s.status = 'active';

-- Who is signed off on each skill — for picking people for a job.
CREATE OR REPLACE VIEW v_skill_holders WITH (security_invoker = false) AS
SELECT o.skill_id, o.staff_id, s.employee_name, s.role_level, o.signed_at, o.id AS signoff_id
  FROM skill_signoffs o JOIN staff s ON s.id = o.staff_id
 WHERE o.revoked_at IS NULL AND s.status = 'active';

-- Finished jobs (60 days) whose lead or crew nobody has rated yet.
CREATE OR REPLACE VIEW v_unrated_jobs WITH (security_invoker = false) AS
WITH people AS (
  SELECT w.id AS work_order_id, w.assigned_lead_staff_id AS staff_id, true AS is_lead FROM work_orders w WHERE w.assigned_lead_staff_id IS NOT NULL
  UNION
  SELECT c.work_order_id, c.staff_id, false FROM work_order_crew c WHERE c.removed_at IS NULL
)
SELECT w.id AS work_order_id, COALESCE(w.title, w.scope_of_work) AS title, p.project_name, w.updated_at AS finished_at,
       pe.staff_id, s.employee_name, bool_or(pe.is_lead) AS is_lead
  FROM work_orders w
  JOIN people pe ON pe.work_order_id = w.id
  JOIN staff s ON s.id = pe.staff_id
  LEFT JOIN projects p ON p.id = w.project_id
 WHERE w.status = 'completed' AND w.updated_at > now() - interval '60 days'
   AND NOT EXISTS (SELECT 1 FROM work_order_ratings r WHERE r.work_order_id = w.id AND r.rated_staff_id = pe.staff_id)
 GROUP BY w.id, w.title, w.scope_of_work, p.project_name, w.updated_at, pe.staff_id, s.employee_name;

-- ── The role list agreed for the rework (drafts until confirmed) ───────
-- Reshaped: Carpenter (was FF&E Carpenter; takes in Site Installer as L2
-- skills), Painter & finisher, Upholstery & leather. Added: CNC, Electrician,
-- site trades, Site foreman, Driver (takes in Logistics Officer). Office
-- roles keep one level, with KPIs measured where the app has the data.
-- Dropped (deactivated): Metal Fabricator, Site Installer, Logistics Officer.
DO $do$
DECLARE d jsonb := $seed${"roles": [{"name": "Carpenter", "rename_from": "FF&E Carpenter / Cabinet Maker (Woodwork)", "family": "Carpentry", "kind": "workshop", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "አናጢ", "reports_to": "Lead carpenter / Operations", "overview": "Builds, assembles and installs custom furniture, cabinetry and joinery from shop drawings.", "levels": [[1, "Assistant carpenter", "ረዳት አናጢ", "Works under a carpenter; prepares and cuts parts."], [2, "Carpenter", "አናጢ", "Builds and installs pieces from drawings on their own."], [3, "Lead carpenter", "ዋና አናጢ", "Plans jobs, checks others’ work and trains."]], "items": [{"kind": "skill", "level": 1, "title": "Measures and marks cuts from a cutting list", "detail": null}, {"kind": "skill", "level": 1, "title": "Runs the panel saw, edge bander and drill safely", "detail": null}, {"kind": "skill", "level": 1, "title": "Sands and prepares parts for finishing", "detail": null}, {"kind": "skill", "level": 1, "title": "Keeps tools and bench clean; follows workshop safety", "detail": null}, {"kind": "skill", "level": 2, "title": "Reads shop drawings and works out the cutting list", "detail": null}, {"kind": "skill", "level": 2, "title": "Joinery: dowel, mortise and tenon, biscuit, knock-down fittings", "detail": null}, {"kind": "skill", "level": 2, "title": "Assembles carcasses square and true", "detail": null}, {"kind": "skill", "level": 2, "title": "Fits hinges, runners, handles and locks", "detail": null}, {"kind": "skill", "level": 2, "title": "Installs on site: levels, scribes to walls, fixes to wall and floor", "detail": null}, {"kind": "skill", "level": 3, "title": "Plans a job’s sequence and materials; flags drawing problems before cutting", "detail": null}, {"kind": "skill", "level": 3, "title": "Solid wood, veneer, curved and custom pieces", "detail": null}, {"kind": "skill", "level": 3, "title": "Checks work against the drawing before it leaves the workshop", "detail": null}, {"kind": "skill", "level": 3, "title": "Trains assistant carpenters", "detail": null}]}, {"name": "Painter & finisher", "rename_from": "Furniture Finisher / Spray Painter", "family": "Finishing & painting", "kind": "site", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "ቀለም ቀቢ", "reports_to": "Lead painter / Site foreman", "overview": "Prepares surfaces and applies paint, lacquer and finishes on site and on furniture.", "levels": [[1, "Assistant painter", "ረዳት ቀለም ቀቢ", "Prepares surfaces and mixes materials."], [2, "Painter", "ቀለም ቀቢ", "Applies finishes evenly on their own."], [3, "Lead painter / finisher", "ዋና ቀለም ቀቢ", "Colour work, spray booth, quality and training."]], "items": [{"kind": "skill", "level": 1, "title": "Surface prep: sanding, filling, masking", "detail": null}, {"kind": "skill", "level": 1, "title": "Mixes paint and lacquer to the right ratio", "detail": null}, {"kind": "skill", "level": 1, "title": "Cleans tools and protects floors and fittings", "detail": null}, {"kind": "skill", "level": 2, "title": "Applies primer and coats evenly by brush and roller", "detail": null}, {"kind": "skill", "level": 2, "title": "Putty and skim coat to a smooth, flat finish", "detail": null}, {"kind": "skill", "level": 2, "title": "Spray-applies lacquer / PU on furniture without runs", "detail": null}, {"kind": "skill", "level": 3, "title": "Colour matching, stains and special finishes", "detail": null}, {"kind": "skill", "level": 3, "title": "Sets up the spray booth and maintains the gun", "detail": null}, {"kind": "skill", "level": 3, "title": "Checks finish quality and trains painters", "detail": null}]}, {"name": "Upholstery & leather", "rename_from": "Custom Upholsterer", "family": "Upholstery & leather", "kind": "workshop", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "ሶፋ ሰሪ", "reports_to": "Lead upholsterer / Operations", "overview": "Pads and covers furniture — sofas, chairs, headboards — in fabric and leather.", "levels": [[1, "Assistant upholsterer", "ረዳት ሶፋ ሰሪ", "Prepares frames, foam and simple stitching."], [2, "Upholsterer", "ሶፋ ሰሪ", "Patterns, cuts and covers pieces on their own."], [3, "Lead upholsterer", "ዋና ሶፋ ሰሪ", "Custom work, costing and training."]], "items": [{"kind": "skill", "level": 1, "title": "Strips old covers and prepares frames", "detail": null}, {"kind": "skill", "level": 1, "title": "Cuts foam and padding to template", "detail": null}, {"kind": "skill", "level": 1, "title": "Basic hand stitching", "detail": null}, {"kind": "skill", "level": 2, "title": "Patterns and cuts fabric and leather with little waste", "detail": null}, {"kind": "skill", "level": 2, "title": "Machine stitching and piping", "detail": null}, {"kind": "skill", "level": 2, "title": "Covers seats, backs and headboards with tight, even tension", "detail": null}, {"kind": "skill", "level": 3, "title": "Buttoning, tufting, channels and custom shapes", "detail": null}, {"kind": "skill", "level": 3, "title": "Works out the material a piece needs", "detail": null}, {"kind": "skill", "level": 3, "title": "Trains upholsterers", "detail": null}]}, {"name": "CNC operator", "family": "CNC", "kind": "workshop", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "የሲኤንሲ ኦፕሬተር", "reports_to": "Workshop lead / Operations", "overview": "Runs the CNC router to cut panels and parts accurately from drawings.", "levels": [[1, "CNC operator", "ኦፕሬተር", "Runs prepared programs safely."], [2, "CNC programmer", "ፕሮግራመር", "Prepares toolpaths and nests parts."], [3, "Lead CNC operator", "ዋና ኦፕሬተር", "Maintains the machine, optimises and trains."]], "items": [{"kind": "skill", "level": 1, "title": "Loads sheets, sets zero and runs a prepared program", "detail": null}, {"kind": "skill", "level": 1, "title": "Changes and checks tools", "detail": null}, {"kind": "skill", "level": 1, "title": "Daily machine cleaning and safety checks", "detail": null}, {"kind": "skill", "level": 2, "title": "Prepares toolpaths from drawings (CAM)", "detail": null}, {"kind": "skill", "level": 2, "title": "Nests parts to cut waste", "detail": null}, {"kind": "skill", "level": 2, "title": "Labels parts for assembly", "detail": null}, {"kind": "skill", "level": 3, "title": "Troubleshoots and maintains the machine", "detail": null}, {"kind": "skill", "level": 3, "title": "Sets feeds and speeds for each material", "detail": null}, {"kind": "skill", "level": 3, "title": "Trains operators", "detail": null}]}, {"name": "Electrician", "family": "Electrical", "kind": "site", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "ኤሌክትሪሻን", "reports_to": "Site foreman", "overview": "Installs and tests electrical work on site.", "levels": [[1, "Electrician helper", "ረዳት ኤሌክትሪሻን", "Conduit, boxes and cable pulling."], [2, "Electrician", "ኤሌክትሪሻን", "Wires and tests circuits on their own."], [3, "Lead electrician", "ዋና ኤሌክትሪሻን", "Plans circuits, commissions and supervises."]], "items": [{"kind": "skill", "level": 1, "title": "Fixes conduit and boxes to line and level", "detail": null}, {"kind": "skill", "level": 1, "title": "Pulls cable without damage", "detail": null}, {"kind": "skill", "level": 1, "title": "Isolates power safely before work", "detail": null}, {"kind": "skill", "level": 2, "title": "Wires sockets, switches, lights and distribution boards", "detail": null}, {"kind": "skill", "level": 2, "title": "Tests circuits: continuity and insulation", "detail": null}, {"kind": "skill", "level": 2, "title": "Reads electrical drawings", "detail": null}, {"kind": "skill", "level": 3, "title": "Plans small circuits and balances loads", "detail": null}, {"kind": "skill", "level": 3, "title": "Commissions and hands over with a test record", "detail": null}, {"kind": "skill", "level": 3, "title": "Supervises helpers", "detail": null}]}, {"name": "Mason", "family": "Site trades", "kind": "site", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "ግንበኛ", "reports_to": "Site foreman", "overview": "Builds block walls and openings to drawing.", "levels": [[1, "Mason helper", "ረዳት ግንበኛ", "Mixes mortar and lays under guidance."], [2, "Mason", "ግንበኛ", "Lays walls plumb and level on their own."], [3, "Lead mason", "ዋና ግንበኛ", "Leads a gang, estimates and checks."]], "items": [{"kind": "skill", "level": 1, "title": "Mixes mortar to the right mix", "detail": null}, {"kind": "skill", "level": 1, "title": "Carries, stacks and lays blocks under guidance", "detail": null}, {"kind": "skill", "level": 2, "title": "Sets out walls from the drawing", "detail": null}, {"kind": "skill", "level": 2, "title": "Lays block walls plumb, level and in line", "detail": null}, {"kind": "skill", "level": 2, "title": "Forms openings and lintels", "detail": null}, {"kind": "skill", "level": 3, "title": "Estimates blocks, cement and sand for a wall", "detail": null}, {"kind": "skill", "level": 3, "title": "Leads a gang and checks their work", "detail": null}]}, {"name": "Plasterer", "family": "Site trades", "kind": "site", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "reports_to": "Site foreman", "overview": "Plasters walls and ceilings flat and true.", "levels": [[1, "Plasterer helper", null, "Prepares surfaces and mixes plaster."], [2, "Plasterer", null, "Plasters flat to a straight edge on their own."], [3, "Lead plasterer", null, "Gypsum and decorative work, leads a gang."]], "items": [{"kind": "skill", "level": 1, "title": "Prepares and wets surfaces", "detail": null}, {"kind": "skill", "level": 1, "title": "Mixes plaster to the right mix", "detail": null}, {"kind": "skill", "level": 2, "title": "Plasters walls and ceilings flat to a straight edge", "detail": null}, {"kind": "skill", "level": 2, "title": "Forms corners and fixes beads", "detail": null}, {"kind": "skill", "level": 3, "title": "Gypsum and decorative plaster work", "detail": null}, {"kind": "skill", "level": 3, "title": "Leads a gang and checks flatness", "detail": null}]}, {"name": "Chiseler", "family": "Site trades", "kind": "site", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "reports_to": "Site foreman", "overview": "Cuts chases in walls and floors for electrical and plumbing lines.", "levels": [[1, "Chiseler", null, "Cuts marked chases safely."], [2, "Skilled chiseler", null, "Cuts to depth and line, makes good."], [3, "Lead chiseler", null, "Marks routes from the layout, leads."]], "items": [{"kind": "skill", "level": 1, "title": "Cuts marked chases with power tools safely", "detail": null}, {"kind": "skill", "level": 1, "title": "Uses dust and eye protection", "detail": null}, {"kind": "skill", "level": 2, "title": "Cuts to depth and line without damaging the wall", "detail": null}, {"kind": "skill", "level": 2, "title": "Makes good after services are in", "detail": null}, {"kind": "skill", "level": 3, "title": "Marks routes from the electrical / plumbing layout", "detail": null}, {"kind": "skill", "level": 3, "title": "Leads a gang", "detail": null}]}, {"name": "Tiler", "family": "Site trades", "kind": "site", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "ሴራሚክ ነጣፊ", "reports_to": "Site foreman", "overview": "Sets wall and floor tiles level with even joints.", "levels": [[1, "Tiler helper", "ረዳት ሴራሚክ ነጣፊ", "Prepares surfaces, mixes and cuts."], [2, "Tiler", "ሴራሚክ ነጣፊ", "Sets and grouts tiles on their own."], [3, "Lead tiler", "ዋና ሴራሚክ ነጣፊ", "Patterns, large format, waterproofing."]], "items": [{"kind": "skill", "level": 1, "title": "Prepares surfaces and mixes adhesive", "detail": null}, {"kind": "skill", "level": 1, "title": "Cuts tiles cleanly", "detail": null}, {"kind": "skill", "level": 2, "title": "Sets wall and floor tiles level with even joints", "detail": null}, {"kind": "skill", "level": 2, "title": "Grouts and cleans to a finish", "detail": null}, {"kind": "skill", "level": 3, "title": "Patterns and large-format tiles", "detail": null}, {"kind": "skill", "level": 3, "title": "Waterproofing in wet areas", "detail": null}, {"kind": "skill", "level": 3, "title": "Leads a gang", "detail": null}]}, {"name": "Labourer & cleaner", "family": "Site trades", "kind": "site", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "የቀን ሰራተኛ", "reports_to": "Site foreman", "overview": "Moves materials, supports the trades and keeps the site clean.", "levels": [[1, "Labourer / cleaner", "የቀን ሰራተኛ", "Carries materials and cleans."], [2, "Skilled helper", "ልምድ ያለው ረዳት", "Assists the trades and does handover cleaning."], [3, "Gang leader", "የቡድን መሪ", "Leads a gang and organises material movement."]], "items": [{"kind": "skill", "level": 1, "title": "Carries and stacks materials safely", "detail": null}, {"kind": "skill", "level": 1, "title": "Keeps the site clean and clear every day", "detail": null}, {"kind": "skill", "level": 1, "title": "Wears PPE and follows site rules", "detail": null}, {"kind": "skill", "level": 2, "title": "Assists the trades: mixing, scaffolding, tools", "detail": null}, {"kind": "skill", "level": 2, "title": "Final cleaning to handover standard", "detail": null}, {"kind": "skill", "level": 3, "title": "Leads a gang and plans material movement", "detail": null}]}, {"name": "Site foreman", "family": "Site management", "kind": "site", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "name_am": "ፎርማን", "reports_to": "Project manager", "overview": "Runs the site day to day: people, materials, progress and safety.", "levels": [[1, "Site foreman", "ፎርማን", "Runs a site."]], "items": [{"kind": "kpi", "level": 1, "title": "Daily report every working day", "detail": null, "kpi_key": "foreman_daily_reports"}, {"kind": "duty", "level": 1, "title": "Work orders updated as work moves", "detail": null}, {"kind": "duty", "level": 1, "title": "Labour attendance recorded daily", "detail": null}, {"kind": "duty", "level": 1, "title": "Materials received and checked against delivery notes", "detail": null}, {"kind": "duty", "level": 1, "title": "Toolbox talk and PPE every day", "detail": null}]}, {"name": "Driver", "family": "Logistics", "kind": "office", "dept": "b460903a-9cc3-4393-b218-f51348f802bf", "name_am": "ሹፌር", "reports_to": "Procurement & Logistics", "overview": "Moves goods and people safely; keeps the vehicle and paperwork in order.", "levels": [[1, "Driver", "ሹፌር", "Drives and delivers."]], "items": [{"kind": "skill", "level": 1, "title": "Valid licence and daily vehicle check", "detail": null}, {"kind": "skill", "level": 1, "title": "Loads secured; delivers with a signed delivery note", "detail": null}, {"kind": "skill", "level": 1, "title": "Keeps the trip and fuel log", "detail": null}, {"kind": "skill", "level": 1, "title": "Drives safely; no incidents", "detail": null}]}, {"name": "Project Manager", "family": "Office", "kind": "office", "dept": "060f32c8-3407-4357-babf-6ec0eaac844c", "levels": [[1, "Project manager", "ፕሮጀክት ማኔጀር", null]], "items": [{"kind": "kpi", "level": 1, "title": "Work orders kept up to date", "detail": null, "kpi_key": "pm_wo_fresh"}, {"kind": "duty", "level": 1, "title": "Budget variance control", "detail": null}, {"kind": "duty", "level": 1, "title": "Progress vs spend accuracy", "detail": null}, {"kind": "duty", "level": 1, "title": "Stage-gate discipline", "detail": null}, {"kind": "duty", "level": 1, "title": "Site delivery confirmation", "detail": null}]}, {"name": "Designer", "family": "Office", "kind": "office", "dept": "5d3b7ad6-681f-40bd-8b39-4a0f7323c389", "levels": [[1, "Designer", "ዲዛይነር", null]], "items": [{"kind": "duty", "level": 1, "title": "Drawing completeness at sign-off", "detail": null}, {"kind": "duty", "level": 1, "title": "FF&E spec accuracy", "detail": null}, {"kind": "duty", "level": 1, "title": "Revision volume after sign-off", "detail": null}, {"kind": "duty", "level": 1, "title": "Client approval turnaround", "detail": null}]}, {"name": "Finance Officer", "family": "Office", "kind": "office", "dept": "bc53b9b8-cd52-4926-911d-7b639fe0b560", "levels": [[1, "Finance officer", "የፋይናንስ ኦፊሰር", null]], "items": [{"kind": "kpi", "level": 1, "title": "Approval turnaround", "detail": null, "kpi_key": "fin_approval_hours"}, {"kind": "kpi", "level": 1, "title": "Payment confirmation turnaround", "detail": null, "kpi_key": "fin_payment_hours"}, {"kind": "kpi", "level": 1, "title": "Bank lines explained", "detail": null, "kpi_key": "fin_bank_backlog"}, {"kind": "duty", "level": 1, "title": "WHT applied correctly", "detail": null}, {"kind": "duty", "level": 1, "title": "Budget-check discipline", "detail": null}, {"kind": "duty", "level": 1, "title": "Ledger posting integrity", "detail": null}]}, {"name": "Procurement Officer", "family": "Office", "kind": "office", "dept": "b460903a-9cc3-4393-b218-f51348f802bf", "levels": [[1, "Procurement officer", "የግዢ ኦፊሰር", null]], "items": [{"kind": "duty", "level": 1, "title": "Competitive sourcing", "detail": null}, {"kind": "duty", "level": 1, "title": "PO accuracy", "detail": null}, {"kind": "duty", "level": 1, "title": "Vendor record quality", "detail": null}, {"kind": "duty", "level": 1, "title": "PR to PO turnaround", "detail": "Not measured yet: purchase requests are not moved past \"pending\" in the app."}, {"kind": "duty", "level": 1, "title": "Advance-payment handling", "detail": null}]}, {"name": "Stock Manager", "family": "Office", "kind": "office", "dept": "b460903a-9cc3-4393-b218-f51348f802bf", "levels": [[1, "Stock manager", "የስቶክ ማኔጀር", null]], "items": [{"kind": "kpi", "level": 1, "title": "Receipts recorded on time", "detail": null, "kpi_key": "stock_receipt_lag"}, {"kind": "duty", "level": 1, "title": "Catalogue quality", "detail": null}, {"kind": "duty", "level": 1, "title": "Stock accuracy vs physical count", "detail": null}]}, {"name": "HR Officer", "family": "Office", "kind": "office", "dept": "a87e21e8-07e4-4ef6-ba14-9123a08e101e", "levels": [[1, "HR officer", "የሰው ሃብት ኦፊሰር", null]], "items": [{"kind": "kpi", "level": 1, "title": "Staff records complete", "detail": null, "kpi_key": "hr_record_gaps"}, {"kind": "duty", "level": 1, "title": "Onboarding completeness", "detail": null}, {"kind": "duty", "level": 1, "title": "Leave processing turnaround", "detail": null}]}, {"name": "HSE Officer", "family": "Office", "kind": "office", "dept": "9139329c-1e2e-402e-8d63-44b29b93950f", "levels": [[1, "HSE officer", "የደህንነት ኦፊሰር", null]], "items": [{"kind": "kpi", "level": 1, "title": "Incidents closed", "detail": null, "kpi_key": "hse_open_incidents"}, {"kind": "duty", "level": 1, "title": "Induction coverage", "detail": null}, {"kind": "duty", "level": 1, "title": "Incident logging timeliness", "detail": null}]}, {"name": "Business Development", "family": "Office", "kind": "office", "dept": "2504744f-9052-4191-a48c-5248699183c5", "levels": [[1, "Business development", "ቢዝነስ ዴቨሎፕመንት", null]], "items": [{"kind": "duty", "level": 1, "title": "Contract completeness", "detail": null}, {"kind": "duty", "level": 1, "title": "Project linkage discipline", "detail": null}, {"kind": "duty", "level": 1, "title": "Quote-to-win conversion", "detail": null}, {"kind": "duty", "level": 1, "title": "CPO handling", "detail": null}]}], "drop": ["FF&E Metal Fabricator / Welder", "FF&E Site Installer / Assembly Technician", "Logistics Officer"]}$seed$::jsonb; r jsonb; l jsonb; it jsonb; v_id uuid; v_i int := 0; v_j int;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(d->'roles') LOOP
    v_i := v_i + 1;
    SELECT id INTO v_id FROM job_descriptions WHERE role_name IN (r->>'name', COALESCE(r->>'rename_from', r->>'name')) ORDER BY (role_name = r->>'name') DESC LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO job_descriptions (role_name, role_overview, sort_order, active, department_id)
      VALUES (r->>'name', r->>'overview', v_i * 10, true, (r->>'dept')::uuid) RETURNING id INTO v_id;
    END IF;
    UPDATE job_descriptions SET role_name = r->>'name', role_overview = COALESCE(r->>'overview', role_overview), sort_order = v_i * 10,
           active = true, department_id = (r->>'dept')::uuid, family = r->>'family', kind = r->>'kind',
           role_name_am = r->>'name_am', reports_to = r->>'reports_to', confirmed_at = NULL, confirmed_by = NULL
     WHERE id = v_id;
    UPDATE key_responsibilities SET active = false WHERE job_description_id = v_id AND active;
    FOR l IN SELECT * FROM jsonb_array_elements(r->'levels') LOOP
      INSERT INTO role_levels (job_description_id, level, title, title_am, summary)
      VALUES (v_id, (l->>0)::smallint, l->>1, l->>2, l->>3)
      ON CONFLICT (job_description_id, level) DO NOTHING;
    END LOOP;
    v_j := 0;
    FOR it IN SELECT * FROM jsonb_array_elements(r->'items') LOOP
      v_j := v_j + 1;
      INSERT INTO key_responsibilities (job_description_id, responsibility_title, responsibility_detail, tier, level, kind, kpi_key, sort_order, active)
      VALUES (v_id, it->>'title', it->>'detail', 'foundational', (it->>'level')::smallint, it->>'kind', it->>'kpi_key', v_j * 10, true);
    END LOOP;
  END LOOP;
  UPDATE job_descriptions SET active = false WHERE role_name IN (SELECT jsonb_array_elements_text(d->'drop'));
  UPDATE key_responsibilities SET active = false
   WHERE active AND job_description_id IN (SELECT id FROM job_descriptions WHERE role_name IN (SELECT jsonb_array_elements_text(d->'drop')));
END $do$;
