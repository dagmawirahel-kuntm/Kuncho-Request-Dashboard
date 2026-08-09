-- 192 — Generalize competency evaluation: rename + polymorphic targets +
-- candidates + staff.job_description_id
--
-- Renames the existing 2-row staff_skill_ratings to competency_ratings and
-- widens it so a rating row can point at exactly one of a staff, an external
-- subcontract (subcontractor_engagement), or a job candidate. Adds the
-- candidates table for external assessments and adds staff.job_description_id
-- so the "which JD do I rate this person against?" question has a clean
-- answer instead of matching text like `staff.role`.
--
-- Grandfathering: the existing 2 rows have staff_id set → they pass the new
-- CHECK and the polymorphic FK columns stay null.
--
-- Reissues v_staff_current_scores to the new table name (v_staff_skill_level
-- already reads staff_competency_checklist, not the ratings table — untouched).

SET search_path TO public;

-- ── staff.job_description_id ────────────────────────────────────────────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS job_description_id uuid REFERENCES job_descriptions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_staff_jd ON staff (job_description_id) WHERE job_description_id IS NOT NULL;
COMMENT ON COLUMN staff.job_description_id IS 'Which JD this staff is rated against on the Competency Hub.';

-- ── Rename ratings table ────────────────────────────────────────────────────
-- Drop the dependent views first so ALTER TABLE RENAME can proceed cleanly.
DROP VIEW IF EXISTS public.v_staff_role_summary;
DROP VIEW IF EXISTS public.v_staff_current_scores;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='staff_skill_ratings')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='competency_ratings') THEN
    ALTER TABLE public.staff_skill_ratings RENAME TO competency_ratings;
  END IF;
END $$;

-- ── Widen for polymorphic targets ───────────────────────────────────────────
-- staff_id becomes nullable; subcontract_id (→subcontractor_engagements) and
-- candidate_id (→candidates, created below) are added.
ALTER TABLE competency_ratings ALTER COLUMN staff_id DROP NOT NULL;
ALTER TABLE competency_ratings
  ADD COLUMN IF NOT EXISTS subcontract_id uuid REFERENCES subcontractor_engagements(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS candidate_id   uuid;  -- FK added after candidates exists

-- One-target-only CHECK.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='competency_ratings_one_target_chk') THEN
    ALTER TABLE competency_ratings
      ADD CONSTRAINT competency_ratings_one_target_chk
      CHECK (
        (CASE WHEN staff_id       IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN subcontract_id IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN candidate_id   IS NOT NULL THEN 1 ELSE 0 END)
      = 1
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cr_staff        ON competency_ratings (staff_id)        WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cr_subcontract  ON competency_ratings (subcontract_id)  WHERE subcontract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cr_candidate    ON competency_ratings (candidate_id)    WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cr_responsibility ON competency_ratings (responsibility_id);
CREATE INDEX IF NOT EXISTS idx_cr_rated_at     ON competency_ratings (rated_at DESC);

-- ── candidates ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name                       text NOT NULL,
  phone                           text,
  email                           text,
  assessed_for_role_id            uuid REFERENCES job_descriptions(id) ON DELETE SET NULL,
  outcome                         text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','hired','rejected','withdrawn')),
  outcome_notes                   text,
  assessed_by_dept_head_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_by                      uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidates_role    ON candidates (assessed_for_role_id);
CREATE INDEX IF NOT EXISTS idx_candidates_outcome ON candidates (outcome);
CREATE INDEX IF NOT EXISTS idx_candidates_owner   ON candidates (assessed_by_dept_head_staff_id);

-- Now wire the FK back from competency_ratings.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='competency_ratings_candidate_fk') THEN
    ALTER TABLE competency_ratings
      ADD CONSTRAINT competency_ratings_candidate_fk
      FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── Reissue dependent views against the renamed table ──────────────────────
-- v_staff_current_scores + v_staff_role_summary (which reads the former).
CREATE VIEW public.v_staff_current_scores AS
SELECT DISTINCT ON (staff_id, responsibility_id)
  staff_id, responsibility_id, score, rated_at, rated_by
FROM competency_ratings
WHERE staff_id IS NOT NULL
ORDER BY staff_id, responsibility_id, rated_at DESC;
GRANT SELECT ON public.v_staff_current_scores TO authenticated;

CREATE VIEW public.v_staff_role_summary AS
WITH active_reqs AS (
  SELECT r.id, r.job_description_id FROM key_responsibilities r
  JOIN job_descriptions jd_1 ON jd_1.id = r.job_description_id
  WHERE r.active AND jd_1.active
)
SELECT cs.staff_id, ar.job_description_id, jd.role_name,
  round(avg(cs.score), 1) AS avg_score,
  count(*) AS rated_responsibility_count,
  (SELECT count(*) FROM active_reqs ar2 WHERE ar2.job_description_id = ar.job_description_id) AS total_active_responsibilities
FROM v_staff_current_scores cs
JOIN active_reqs ar ON ar.id = cs.responsibility_id
JOIN job_descriptions jd ON jd.id = ar.job_description_id
GROUP BY cs.staff_id, ar.job_description_id, jd.role_name;
GRANT SELECT ON public.v_staff_role_summary TO authenticated;

-- I also need to drop v_staff_role_summary before dropping v_staff_current_scores
-- (dependency). The DROP block at the top of this migration handles that.

-- ── RLS on competency_ratings ───────────────────────────────────────────────
-- Rules:
--   * Rater on a staff target must be the target's home-dept head (dept
--     head = departments.head_staff_id for the staff's department_id).
--     Exception: if the target IS a dept head, rater must be Exec or HR.
--   * Rater on a subcontract target must be the project's PM or a
--     dept head who engaged the subcontract (approved_by).
--   * Rater on a candidate target must be the candidate's assessed_by_dept_head
--     or HR / Exec.
--   * Admin/Exec override for all.
--
-- SELECT:
--   * Own staff row (aggregated only — the app enforces "no comments/raters"
--     by not exposing individual rows to the ratee; RLS makes the row itself
--     invisible except in aggregate views).
--   * Home dept head sees all ratings of their dept members.
--   * HR / Exec / Admin see everything.
--   * PM sees ratings on subcontracts of their project.
--   * Candidate ratings visible to HR/Exec/Admin and the assessing dept head.

ALTER TABLE competency_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cr_read ON competency_ratings;
CREATE POLICY cr_read ON competency_ratings FOR SELECT
  USING (
    get_user_role() IN ('admin','executive','hr_officer')
    OR (
      staff_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM staff s
        JOIN departments d ON d.id = s.department_id
        WHERE s.id = competency_ratings.staff_id
          AND d.head_staff_id = public.current_staff_id()
      )
    )
    OR (
      subcontract_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM subcontractor_engagements se
        JOIN projects p ON p.id = se.project_id
        WHERE se.id = competency_ratings.subcontract_id
          AND p.project_manager_id = public.current_staff_id()
      )
    )
    OR (
      candidate_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM candidates c
        WHERE c.id = competency_ratings.candidate_id
          AND c.assessed_by_dept_head_staff_id = public.current_staff_id()
      )
    )
  );

DROP POLICY IF EXISTS cr_write ON competency_ratings;
CREATE POLICY cr_write ON competency_ratings FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin','executive')
    OR (
      -- Staff target — home dept head only, with dept-head escalation to HR/Exec.
      staff_id IS NOT NULL AND (
        (
          -- Target is NOT a dept head: rater must be that dept's head.
          NOT EXISTS (SELECT 1 FROM departments d WHERE d.head_staff_id = competency_ratings.staff_id)
          AND EXISTS (
            SELECT 1 FROM staff s
            JOIN departments d ON d.id = s.department_id
            WHERE s.id = competency_ratings.staff_id
              AND d.head_staff_id = public.current_staff_id()
          )
        ) OR (
          -- Target IS a dept head: rater must be Exec or HR.
          EXISTS (SELECT 1 FROM departments d WHERE d.head_staff_id = competency_ratings.staff_id)
          AND get_user_role() IN ('executive','hr_officer')
        )
      )
    )
    OR (
      -- Subcontract target — engaging dept head or project PM.
      subcontract_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM subcontractor_engagements se
        LEFT JOIN projects p ON p.id = se.project_id
        LEFT JOIN staff appr ON appr.user_id = se.approved_by
        WHERE se.id = competency_ratings.subcontract_id
          AND (
            p.project_manager_id = public.current_staff_id()
            OR appr.id = public.current_staff_id()
          )
      )
    )
    OR (
      -- Candidate target — assigned dept head or HR / Exec (both covered above).
      candidate_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM candidates c
        WHERE c.id = competency_ratings.candidate_id
          AND c.assessed_by_dept_head_staff_id = public.current_staff_id()
      )
    )
  );

DROP POLICY IF EXISTS cr_update ON competency_ratings;
CREATE POLICY cr_update ON competency_ratings FOR UPDATE
  USING (get_user_role() IN ('admin','executive') OR rated_by = auth.uid())
  WITH CHECK (get_user_role() IN ('admin','executive') OR rated_by = auth.uid());

DROP POLICY IF EXISTS cr_delete ON competency_ratings;
CREATE POLICY cr_delete ON competency_ratings FOR DELETE
  USING (get_user_role() IN ('admin','executive') OR rated_by = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON competency_ratings TO authenticated;

-- ── RLS on candidates ───────────────────────────────────────────────────────
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS candidates_read ON candidates;
CREATE POLICY candidates_read ON candidates FOR SELECT
  USING (
    get_user_role() IN ('admin','executive','hr_officer')
    OR assessed_by_dept_head_staff_id = public.current_staff_id()
    OR created_by = public.current_staff_id()
  );

DROP POLICY IF EXISTS candidates_write ON candidates;
CREATE POLICY candidates_write ON candidates FOR ALL
  USING (
    get_user_role() IN ('admin','executive','hr_officer')
    OR assessed_by_dept_head_staff_id = public.current_staff_id()
  )
  WITH CHECK (
    get_user_role() IN ('admin','executive','hr_officer')
    OR assessed_by_dept_head_staff_id = public.current_staff_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON candidates TO authenticated;
