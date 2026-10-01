-- 398: Skill levels come from the ratings people actually record.
--
-- v_staff_skill_level was built on staff_competency_checklist, which
-- nothing in the app writes any more, so the Workshop view and the
-- crew pickers had no one to suggest. It now reads the latest score per
-- responsibility from competency_ratings (the same "current score" rule
-- as v_staff_current_scores). A responsibility counts as met at 3/5+.
--   Advanced      every foundational and every differentiator met
--   Intermediate  every foundational met
--   Beginner      rated, but not there yet
-- The old columns keep their names (foundational_checked now means
-- "foundational met") so existing readers keep working; avg_score,
-- coverage and is_main_role are new.
--
-- Also lets operations managers rate and read ratings for staff other
-- than themselves: they run the workshop and the FF&E skills page
-- already offered them the Rate button, but RLS turned the insert away.

-- Same leading columns as before, new ones appended, so this is a
-- straight replace.
CREATE OR REPLACE VIEW v_staff_skill_level AS
WITH active_reqs AS (
  SELECT r.id, r.job_description_id, r.tier
  FROM key_responsibilities r
  JOIN job_descriptions jd ON jd.id = r.job_description_id
  WHERE r.active AND jd.active
), totals AS (
  SELECT job_description_id,
         count(*) FILTER (WHERE tier = 'foundational')   AS foundational_total,
         count(*) FILTER (WHERE tier = 'differentiator') AS differentiator_total
  FROM active_reqs
  GROUP BY job_description_id
), per_staff AS (
  SELECT c.staff_id, ar.job_description_id,
         count(*) FILTER (WHERE ar.tier = 'foundational'   AND c.score >= 3) AS foundational_checked,
         count(*) FILTER (WHERE ar.tier = 'differentiator' AND c.score >= 3) AS differentiator_checked,
         count(*)::int              AS rated_count,
         round(avg(c.score), 2)     AS avg_score,
         max(c.rated_at)            AS last_rated_at
  FROM v_staff_current_scores_all c
  JOIN active_reqs ar ON ar.id = c.responsibility_id
  GROUP BY c.staff_id, ar.job_description_id
)
SELECT ps.staff_id,
       ps.job_description_id,
       jd.role_name,
       ps.foundational_checked,
       t.foundational_total,
       ps.differentiator_checked,
       t.differentiator_total,
       CASE
         WHEN ps.foundational_checked >= t.foundational_total
          AND ps.differentiator_checked >= t.differentiator_total THEN 'Advanced'
         WHEN ps.foundational_checked >= t.foundational_total THEN 'Intermediate'
         ELSE 'Beginner'
       END AS skill_level,
       ps.avg_score,
       ps.rated_count,
       (t.foundational_total + t.differentiator_total)::int AS total_count,
       ps.last_rated_at,
       (s.job_description_id IS NOT DISTINCT FROM ps.job_description_id) AS is_main_role
FROM per_staff ps
JOIN totals t ON t.job_description_id = ps.job_description_id
JOIN job_descriptions jd ON jd.id = ps.job_description_id
JOIN staff s ON s.id = ps.staff_id AND s.status = 'active'
WHERE (get_user_role())::text = ANY (ARRAY['admin','executive','hr_officer','project_manager','operations_manager'])
   OR ps.staff_id = current_staff_id();

-- Owner rights with the role filter above, like v_staff_current_scores.
ALTER VIEW v_staff_skill_level SET (security_invoker = false);
GRANT SELECT ON v_staff_skill_level TO authenticated;

CREATE POLICY cr_ops_manager_insert ON competency_ratings FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = 'operations_manager'::user_role
    AND staff_id IS NOT NULL
    AND staff_id IS DISTINCT FROM current_staff_id()
  );

CREATE POLICY cr_ops_manager_read ON competency_ratings FOR SELECT TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['operations_manager'::user_role, 'project_manager'::user_role])
    AND staff_id IS NOT NULL
  );

-- rated_by was only ever filled by the client; stamp it so a rating
-- always says who gave it (and cr_update/cr_delete's "your own" rule
-- has something to match).
CREATE OR REPLACE FUNCTION stamp_competency_rater() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.rated_by IS NULL THEN NEW.rated_by := auth.uid(); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_stamp_competency_rater BEFORE INSERT ON competency_ratings
  FOR EACH ROW EXECUTE FUNCTION stamp_competency_rater();
