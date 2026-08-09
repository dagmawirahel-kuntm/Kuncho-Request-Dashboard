-- 193 — Competency aggregation views (per staff / dept / subcontract / candidate)
--
-- All read-only. Uses staff.job_description_id added in 192 to know which JD
-- each staff is being rated against. Stale = last rating > 6 months old
-- (or no rating at all).
--
-- Views run as owner (default) so callers see aggregated summaries even
-- when their per-caller RLS on competency_ratings would hide individual
-- rows — matches the WO ratings pattern (PR #2).

SET search_path TO public;

-- ── Per-staff summary ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_staff_competency_summary AS
WITH active_reqs AS (
  SELECT r.id AS responsibility_id, r.job_description_id
  FROM key_responsibilities r
  JOIN job_descriptions jd ON jd.id = r.job_description_id
  WHERE r.active AND jd.active
),
per_staff AS (
  SELECT s.id AS staff_id, s.job_description_id
  FROM staff s
  WHERE s.status = 'active' AND s.job_description_id IS NOT NULL
),
totals AS (
  SELECT ps.staff_id, ps.job_description_id,
         count(*)::int AS responsibilities_total
  FROM per_staff ps
  JOIN active_reqs ar ON ar.job_description_id = ps.job_description_id
  GROUP BY ps.staff_id, ps.job_description_id
),
rated AS (
  SELECT ps.staff_id, ps.job_description_id,
         count(DISTINCT ar.responsibility_id)::int AS responsibilities_rated,
         round(avg(cr.score)::numeric, 2)          AS avg_score,
         max(cr.rated_at)                          AS last_rated_at
  FROM per_staff ps
  JOIN active_reqs ar ON ar.job_description_id = ps.job_description_id
  LEFT JOIN competency_ratings cr
    ON cr.staff_id = ps.staff_id AND cr.responsibility_id = ar.responsibility_id
  GROUP BY ps.staff_id, ps.job_description_id
)
SELECT
  t.staff_id, t.job_description_id, t.responsibilities_total,
  COALESCE(r.responsibilities_rated, 0) AS responsibilities_rated,
  r.avg_score, r.last_rated_at,
  (COALESCE(r.responsibilities_rated, 0) < t.responsibilities_total) AS has_gaps,
  (r.last_rated_at IS NULL OR r.last_rated_at < (now() - interval '6 months')) AS is_stale
FROM totals t
LEFT JOIN rated r ON r.staff_id = t.staff_id AND r.job_description_id = t.job_description_id;

GRANT SELECT ON public.v_staff_competency_summary TO authenticated;

-- ── Department gaps view (drives Hub Tab 1) ─────────────────────────────────
CREATE OR REPLACE VIEW public.v_department_competency_gaps AS
SELECT
  s.id                                    AS staff_id,
  s.employee_name                         AS staff_name,
  s.department_id,
  d.name                                  AS department_name,
  s.job_description_id,
  jd.role_name,
  cs.responsibilities_total,
  cs.responsibilities_rated,
  cs.avg_score,
  cs.last_rated_at,
  cs.has_gaps,
  cs.is_stale,
  CASE WHEN cs.last_rated_at IS NULL THEN NULL
       ELSE GREATEST(0, (EXTRACT(EPOCH FROM (now() - cs.last_rated_at)) / 86400.0)::int)
  END AS days_since_last_rated
FROM staff s
LEFT JOIN departments d      ON d.id  = s.department_id
LEFT JOIN job_descriptions jd ON jd.id = s.job_description_id
LEFT JOIN v_staff_competency_summary cs
  ON cs.staff_id = s.id AND cs.job_description_id = s.job_description_id
WHERE s.status = 'active' AND s.job_description_id IS NOT NULL;

GRANT SELECT ON public.v_department_competency_gaps TO authenticated;

-- ── Subcontract summary ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_subcontract_competency_summary AS
SELECT
  se.id AS subcontract_id,
  se.project_id,
  p.project_name,
  se.vendor_id,
  v.vendor_name,
  se.scope_of_work,
  count(cr.id)::int                       AS ratings_count,
  round(avg(cr.score)::numeric, 2)        AS avg_score,
  max(cr.rated_at)                        AS last_rated_at
FROM subcontractor_engagements se
LEFT JOIN projects p           ON p.id = se.project_id
LEFT JOIN vendors v            ON v.id = se.vendor_id
LEFT JOIN competency_ratings cr ON cr.subcontract_id = se.id
GROUP BY se.id, se.project_id, p.project_name, se.vendor_id, v.vendor_name, se.scope_of_work;

GRANT SELECT ON public.v_subcontract_competency_summary TO authenticated;

-- ── Candidate summary ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_candidate_competency_summary AS
WITH active_reqs AS (
  SELECT r.id AS responsibility_id, r.job_description_id
  FROM key_responsibilities r
  JOIN job_descriptions jd ON jd.id = r.job_description_id
  WHERE r.active AND jd.active
)
SELECT
  c.id AS candidate_id,
  c.full_name,
  c.assessed_for_role_id,
  jd.role_name,
  c.outcome,
  c.assessed_by_dept_head_staff_id,
  ar_totals.responsibilities_total,
  count(DISTINCT cr.responsibility_id) FILTER (WHERE cr.responsibility_id IS NOT NULL)::int AS responsibilities_rated,
  round(avg(cr.score)::numeric, 2)   AS avg_score,
  max(cr.rated_at)                   AS last_rated_at
FROM candidates c
LEFT JOIN job_descriptions jd ON jd.id = c.assessed_for_role_id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS responsibilities_total FROM active_reqs WHERE job_description_id = c.assessed_for_role_id
) ar_totals ON true
LEFT JOIN competency_ratings cr ON cr.candidate_id = c.id
GROUP BY c.id, c.full_name, c.assessed_for_role_id, jd.role_name, c.outcome,
         c.assessed_by_dept_head_staff_id, ar_totals.responsibilities_total;

GRANT SELECT ON public.v_candidate_competency_summary TO authenticated;
