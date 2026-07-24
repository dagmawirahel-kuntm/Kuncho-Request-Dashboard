-- ============================================================
-- Replace the FF&E boolean checklist (128) with a proper 0-5 scored,
-- append-only rating history. A checkbox only ever said "demonstrated
-- or not" and computed a coarse Beginner/Intermediate/Advanced label
-- from tier counts; this tracks a real score per responsibility, with
-- every assessment kept as its own row, so progression over time
-- (2 -> 3 -> 4) is visible rather than collapsed into one snapshot.
--
-- Per user decision: the foundational/differentiator tier is retired
-- as a score driver — a 0-5 score already carries more resolution
-- than a two-tier tag. The `tier` column on ffe_key_responsibilities
-- (128) is left exactly as-is and still displayed, but purely as
-- descriptive metadata now; nothing here computes from it.
--
-- staff_ffe_checklist and v_staff_ffe_skill_level (128) are
-- deliberately left untouched, not migrated or dropped: the 8
-- existing checklist rows are a boolean "checked" state with no
-- honest 0-5 equivalent to convert to (guessing a score from a
-- checkbox would be fabricating assessment history that was never
-- actually given). They remain as read-only legacy data; the new UI
-- reads/writes staff_ffe_skill_ratings exclusively going forward.
--
-- No UPDATE or DELETE policy is defined for staff_ffe_skill_ratings —
-- deliberately. RLS blocks any command with no matching policy, so
-- "never overwrite a rating in place" is enforced structurally, not
-- just by UI convention: the only way to change a person's recorded
-- level is to insert a new rating.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS staff_ffe_skill_ratings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id          UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  responsibility_id UUID NOT NULL REFERENCES ffe_key_responsibilities(id) ON DELETE CASCADE,
  score             INT NOT NULL CHECK (score BETWEEN 0 AND 5),
  rated_by          UUID REFERENCES user_profiles(id),
  rated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_ffe_skill_ratings_lookup
  ON staff_ffe_skill_ratings(staff_id, responsibility_id, rated_at DESC);

ALTER TABLE staff_ffe_skill_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_ffe_skill_ratings_read" ON staff_ffe_skill_ratings;
CREATE POLICY "staff_ffe_skill_ratings_read" ON staff_ffe_skill_ratings FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "staff_ffe_skill_ratings_insert" ON staff_ffe_skill_ratings;
CREATE POLICY "staff_ffe_skill_ratings_insert" ON staff_ffe_skill_ratings FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'operations_manager'));

GRANT SELECT, INSERT ON staff_ffe_skill_ratings TO authenticated;

-- Most recent rating per staff+responsibility — "current score" is
-- always this, never a separately stored field.
CREATE OR REPLACE VIEW v_staff_ffe_current_scores
WITH (security_invoker = true) AS
SELECT DISTINCT ON (staff_id, responsibility_id)
  staff_id, responsibility_id, score, rated_at, rated_by
FROM staff_ffe_skill_ratings
ORDER BY staff_id, responsibility_id, rated_at DESC;

GRANT SELECT ON v_staff_ffe_current_scores TO authenticated;

-- One at-a-glance number per staff+role: average of current scores
-- across that role's ACTIVE responsibilities only (a deactivated
-- responsibility's old ratings don't drag the average down, matching
-- 128's same "only active responsibilities count" precedent). The
-- per-responsibility detail (and its full history) stays the primary
-- content — this is a summary, not a replacement.
CREATE OR REPLACE VIEW v_staff_ffe_role_summary
WITH (security_invoker = true) AS
WITH active_reqs AS (
  SELECT r.id, r.job_description_id
  FROM ffe_key_responsibilities r
  JOIN ffe_job_descriptions jd ON jd.id = r.job_description_id
  WHERE r.active AND jd.active
)
SELECT
  cs.staff_id,
  ar.job_description_id,
  jd.role_name,
  ROUND(AVG(cs.score)::numeric, 1) AS avg_score,
  COUNT(*) AS rated_responsibility_count,
  (SELECT COUNT(*) FROM active_reqs ar2 WHERE ar2.job_description_id = ar.job_description_id) AS total_active_responsibilities
FROM v_staff_ffe_current_scores cs
JOIN active_reqs ar ON ar.id = cs.responsibility_id
JOIN ffe_job_descriptions jd ON jd.id = ar.job_description_id
GROUP BY cs.staff_id, ar.job_description_id, jd.role_name;

GRANT SELECT ON v_staff_ffe_role_summary TO authenticated;

-- Verify
SELECT tablename FROM pg_tables WHERE tablename = 'staff_ffe_skill_ratings';
SELECT viewname FROM pg_views WHERE viewname IN ('v_staff_ffe_current_scores', 'v_staff_ffe_role_summary') ORDER BY viewname;
