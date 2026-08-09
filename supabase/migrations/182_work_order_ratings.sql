-- 182 — Work order ratings: per-WO feedback → rolling perf score + review evidence
--
-- One migration for the whole backend (spec's ask). Additive only — nothing on
-- work_orders / work_order_labor / labor_allocations / staff / performance_reviews
-- changes shape.
--
-- Shape:
--   work_order_ratings                    — one row per (WO, ratee, rater)
--   3 BEFORE triggers                     — completion gate, no self-rating (via CHECK), rater authority
--   v_staff_rolling_performance           — 6-month half-life decay-weighted aggregate
--   v_staff_performance_review_evidence() — SQL fn returning raw ratings in a period
--   RLS on the table (ratee CANNOT read raw rows — aggregate only)
--
-- Guardrails from spec: new triggers/RPCs are SECURITY INVOKER. Only existing
-- DEFINER helpers (current_staff_id / get_user_role / is_site_foreman_for_project)
-- are reused; no new definer surface is added. Rolling score is computed on read
-- (no cached column on staff) so it can't drift. No historical retroactive ratings.

SET search_path TO public;

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_order_ratings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     uuid        NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  rated_staff_id    uuid        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  rater_staff_id    uuid        NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  score_quality     smallint    NOT NULL CHECK (score_quality    BETWEEN 1 AND 5),
  score_timeliness  smallint    NOT NULL CHECK (score_timeliness BETWEEN 1 AND 5),
  score_safety      smallint    NOT NULL CHECK (score_safety     BETWEEN 1 AND 5),
  score_teamwork    smallint    NOT NULL CHECK (score_teamwork   BETWEEN 1 AND 5),
  comment           text,
  rated_at          timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, rated_staff_id, rater_staff_id),
  -- No self-rating. Enforced by CHECK, not a trigger — it's a per-row invariant
  -- that never depends on outside state.
  CHECK (rated_staff_id <> rater_staff_id)
);

CREATE INDEX IF NOT EXISTS idx_wor_rated_staff      ON work_order_ratings (rated_staff_id, rated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wor_work_order       ON work_order_ratings (work_order_id);
CREATE INDEX IF NOT EXISTS idx_wor_rater_staff      ON work_order_ratings (rater_staff_id);

-- ── Trigger 1: WO must be completed ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_wo_rating_requires_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM work_orders WHERE id = NEW.work_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Work order % not found', NEW.work_order_id;
  END IF;
  IF lower(v_status) <> 'completed' THEN
    RAISE EXCEPTION 'Work order must be completed before it can be rated (current status: %)', v_status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wor_requires_completion ON work_order_ratings;
CREATE TRIGGER trg_wor_requires_completion
  BEFORE INSERT OR UPDATE OF work_order_id ON work_order_ratings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_wo_rating_requires_completion();

-- ── Trigger 2: rater authority (with foreman/lead escalation) ────────────────
-- Allowed raters, general case:
--   admin/executive, WO's assigned_lead_staff_id, project's assigned PM,
--   site foreman for the project (via is_site_foreman_for_project).
-- Escalation: if the RATEE is the foreman or the lead, only PM/admin/exec
-- may rate them. This blocks a foreman from rating themselves (already covered
-- by the CHECK) and, more importantly, blocks lateral peer-rating of the lead
-- by another team member on the WO.
CREATE OR REPLACE FUNCTION public.enforce_wo_rater_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role          user_role;
  v_caller_staff  uuid;
  v_project       uuid;
  v_lead          uuid;
  v_pm            uuid;
  v_ratee_is_foreman_or_lead boolean;
BEGIN
  v_role         := public.get_user_role();
  v_caller_staff := public.current_staff_id();

  -- Rater MUST be the caller (no ratings on behalf of someone else).
  -- Admin/exec are the one exception — they may correct or backfill a rating
  -- naming another rater — RLS still gates that path.
  IF NEW.rater_staff_id IS DISTINCT FROM v_caller_staff
     AND v_role NOT IN ('admin','executive') THEN
    RAISE EXCEPTION 'Rater must be your own linked staff record';
  END IF;

  SELECT wo.project_id, wo.assigned_lead_staff_id INTO v_project, v_lead
    FROM work_orders wo WHERE wo.id = NEW.work_order_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'Work order % not found', NEW.work_order_id;
  END IF;
  SELECT p.project_manager_id INTO v_pm FROM projects p WHERE p.id = v_project;

  v_ratee_is_foreman_or_lead := (
    NEW.rated_staff_id = v_lead
    OR EXISTS (
      SELECT 1 FROM staff_assignments a
      WHERE a.staff_id  = NEW.rated_staff_id
        AND a.project_id = v_project
        AND a.active
        AND lower(a.role) IN ('site_foreman','site foreman')
    )
    OR EXISTS (
      SELECT 1 FROM staff s
      WHERE s.id = NEW.rated_staff_id AND lower(coalesce(s.role,'')) = 'site_foreman'
    )
  );

  -- Escalation branch — only PM/admin/exec may rate the foreman or lead.
  IF v_ratee_is_foreman_or_lead THEN
    IF v_role IN ('admin','executive')
       OR (v_pm IS NOT NULL AND NEW.rater_staff_id = v_pm) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only the project manager, admin, or executive can rate the site foreman or work order lead on this project';
  END IF;

  -- General branch.
  IF v_role IN ('admin','executive') THEN RETURN NEW; END IF;
  IF v_lead IS NOT NULL AND NEW.rater_staff_id = v_lead THEN RETURN NEW; END IF;
  IF v_pm   IS NOT NULL AND NEW.rater_staff_id = v_pm   THEN RETURN NEW; END IF;
  IF public.is_site_foreman_for_project(v_project) THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'Not authorized to rate work on this work order';
END $$;

DROP TRIGGER IF EXISTS trg_wor_authority ON work_order_ratings;
CREATE TRIGGER trg_wor_authority
  BEFORE INSERT OR UPDATE ON work_order_ratings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_wo_rater_authority();

-- Bookkeeping trigger — updated_at.
CREATE OR REPLACE FUNCTION public.wor_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_wor_touch_updated_at ON work_order_ratings;
CREATE TRIGGER trg_wor_touch_updated_at
  BEFORE UPDATE ON work_order_ratings
  FOR EACH ROW EXECUTE FUNCTION public.wor_touch_updated_at();

-- ── View: rolling performance (6-month half-life) ────────────────────────────
-- weight = exp(-ln(2) * months_since_rated / 6). Per-dimension weighted avg,
-- overall = plain avg of the 4 dims, effective_sample_size = sum(weight),
-- sufficient_data flips true at ESS >= 2.5 (spec).
--
-- Runs as view owner (default; not security_invoker) so it can aggregate raw
-- ratings the CALLER cannot read directly — this is exactly why the ratee is
-- exposed to an aggregate but not to individual comments. Access is gated by
-- the WHERE clause: staff sees own row; admin/exec/HR see all; PM sees anyone
-- with a rating on any project they manage.
CREATE OR REPLACE VIEW public.v_staff_rolling_performance AS
WITH weighted AS (
  SELECT
    r.rated_staff_id,
    exp(
      -ln(2.0)
      * (extract(epoch FROM (now() - r.rated_at)) / (86400.0 * 30.4375 * 6.0))
    ) AS w,
    r.score_quality, r.score_timeliness, r.score_safety, r.score_teamwork,
    r.rated_at
  FROM work_order_ratings r
),
agg AS (
  SELECT
    rated_staff_id AS staff_id,
    (sum(w * score_quality)    / NULLIF(sum(w), 0))::numeric(4,2) AS score_quality,
    (sum(w * score_timeliness) / NULLIF(sum(w), 0))::numeric(4,2) AS score_timeliness,
    (sum(w * score_safety)     / NULLIF(sum(w), 0))::numeric(4,2) AS score_safety,
    (sum(w * score_teamwork)   / NULLIF(sum(w), 0))::numeric(4,2) AS score_teamwork,
    sum(w)::numeric(10,3) AS effective_sample_size,
    count(*)::int         AS rating_count_all_time,
    max(rated_at)         AS last_rated_at
  FROM weighted
  GROUP BY rated_staff_id
)
SELECT
  a.staff_id,
  a.score_quality,
  a.score_timeliness,
  a.score_safety,
  a.score_teamwork,
  ((a.score_quality + a.score_timeliness + a.score_safety + a.score_teamwork) / 4.0)::numeric(4,2) AS score_overall,
  a.effective_sample_size,
  (a.effective_sample_size >= 2.5) AS sufficient_data,
  a.rating_count_all_time,
  a.last_rated_at
FROM agg a
WHERE
  a.staff_id = public.current_staff_id()
  OR public.get_user_role() IN ('admin','executive','hr_officer')
  OR EXISTS (
    SELECT 1
    FROM work_order_ratings r
    JOIN work_orders wo ON wo.id = r.work_order_id
    JOIN projects   p  ON p.id  = wo.project_id
    WHERE r.rated_staff_id     = a.staff_id
      AND p.project_manager_id = public.current_staff_id()
  );

GRANT SELECT ON public.v_staff_rolling_performance TO authenticated;

-- ── Function: evidence for a formal review ───────────────────────────────────
-- Raw ratings (with rater name + WO scope) for one ratee in a period. Callers
-- are always admin/exec/HR/PM (frontend uses this only on the review screen).
-- SECURITY INVOKER — the RLS policy on work_order_ratings is what admits
-- those callers; the function does no privilege elevation.
CREATE OR REPLACE FUNCTION public.v_staff_performance_review_evidence(
  p_staff_id   uuid,
  p_from_date  date,
  p_to_date    date
)
RETURNS TABLE (
  rating_id         uuid,
  work_order_id     uuid,
  work_order_scope  text,
  project_id        uuid,
  project_name      text,
  rater_staff_id    uuid,
  rater_name        text,
  score_quality     smallint,
  score_timeliness  smallint,
  score_safety      smallint,
  score_teamwork    smallint,
  comment           text,
  rated_at          timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    r.id, r.work_order_id, wo.scope_of_work,
    wo.project_id, p.project_name,
    r.rater_staff_id, rs.employee_name,
    r.score_quality, r.score_timeliness, r.score_safety, r.score_teamwork,
    r.comment, r.rated_at
  FROM work_order_ratings r
  JOIN work_orders wo ON wo.id = r.work_order_id
  JOIN projects    p  ON p.id  = wo.project_id
  LEFT JOIN staff  rs ON rs.id = r.rater_staff_id
  WHERE r.rated_staff_id = p_staff_id
    AND r.rated_at::date BETWEEN p_from_date AND p_to_date
  ORDER BY r.rated_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.v_staff_performance_review_evidence(uuid, date, date) TO authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE work_order_ratings ENABLE ROW LEVEL SECURITY;

-- SELECT: rater sees own rows; admin/exec/HR see all; PM sees ratings on their
-- projects. Ratee is DELIBERATELY not in this policy — they must go through
-- the aggregate view instead.
DROP POLICY IF EXISTS wor_select ON work_order_ratings;
CREATE POLICY wor_select ON work_order_ratings FOR SELECT
  USING (
    rater_staff_id = public.current_staff_id()
    OR public.get_user_role() IN ('admin','executive','hr_officer')
    OR EXISTS (
      SELECT 1 FROM work_orders wo
      JOIN projects p ON p.id = wo.project_id
      WHERE wo.id = work_order_ratings.work_order_id
        AND p.project_manager_id = public.current_staff_id()
    )
  );

-- INSERT: rater is caller's linked staff (admin/exec may name another rater).
-- Full authority + completion gates come from the BEFORE triggers.
DROP POLICY IF EXISTS wor_insert ON work_order_ratings;
CREATE POLICY wor_insert ON work_order_ratings FOR INSERT
  WITH CHECK (
    rater_staff_id = public.current_staff_id()
    OR public.get_user_role() IN ('admin','executive')
  );

-- UPDATE: rater edits own row; admin/exec may edit any.
DROP POLICY IF EXISTS wor_update ON work_order_ratings;
CREATE POLICY wor_update ON work_order_ratings FOR UPDATE
  USING (
    rater_staff_id = public.current_staff_id()
    OR public.get_user_role() IN ('admin','executive')
  )
  WITH CHECK (
    rater_staff_id = public.current_staff_id()
    OR public.get_user_role() IN ('admin','executive')
  );

-- DELETE: rater or admin/exec.
DROP POLICY IF EXISTS wor_delete ON work_order_ratings;
CREATE POLICY wor_delete ON work_order_ratings FOR DELETE
  USING (
    rater_staff_id = public.current_staff_id()
    OR public.get_user_role() IN ('admin','executive')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON work_order_ratings TO authenticated;
