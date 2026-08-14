-- Tier 2 casual-worker HR approval queue, split off from the Competency
-- Hub's JD-based candidate assessment flow (trades like "Mason" have no
-- job description and don't belong in that scoring flow).
--
-- Live-schema note: `candidates` currently has 10 columns (migration 192)
-- and no direct link to `labor_requisitions` — only the separate
-- `labor_requisition_candidates` join table exists *in git* (migration
-- 199); verified live against the project that migration 199 never
-- actually applied (`labor_requisition_candidates` and
-- `promote_candidate_to_casual` are both absent from the live database,
-- and the live `on_labor_req_approved_promote_candidate` trigger still
-- matches the single-candidate 197 body, not 199's rewrite). That gap is
-- pre-existing and unrelated to Tier 2 casuals — not touched here.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS candidate_type text NOT NULL DEFAULT 'salaried_or_subcontractor',
  ADD COLUMN IF NOT EXISTS trade_tag text REFERENCES tier2_trade_roster(trade_tag) ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS labor_requisition_id uuid REFERENCES labor_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_approved_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS provisioned_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidates_candidate_type_chk') THEN
    ALTER TABLE candidates ADD CONSTRAINT candidates_candidate_type_chk
      CHECK (candidate_type IN ('salaried_or_subcontractor', 'tier_2_casual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidates_tier2_needs_trade_chk') THEN
    ALTER TABLE candidates ADD CONSTRAINT candidates_tier2_needs_trade_chk
      CHECK (candidate_type <> 'tier_2_casual' OR trade_tag IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_candidates_type ON candidates (candidate_type);
CREATE INDEX IF NOT EXISTS idx_candidates_labor_requisition ON candidates (labor_requisition_id);

COMMENT ON COLUMN candidates.candidate_type IS
  'salaried_or_subcontractor uses the Competency Hub JD-based assessment flow; tier_2_casual uses the lightweight HR approve/reject queue at /hr/tier2-candidates and is excluded from External Assessments.';

-- External Assessments tab (Competency Hub) must only ever see
-- salaried_or_subcontractor candidates — Tier 2 casuals have no JD to
-- score against. No RLS change needed (candidates_read already gates
-- correctly); this view just needs the extra filter.
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
WHERE c.candidate_type = 'salaried_or_subcontractor'
GROUP BY c.id, c.full_name, c.assessed_for_role_id, jd.role_name, c.outcome,
         c.assessed_by_dept_head_staff_id, ar_totals.responsibilities_total;

-- Provisions a HR-approved Tier 2 candidate into a real staff row.
-- SECURITY DEFINER (not INVOKER): the role check below substitutes for
-- RLS, matching the existing promote_candidate_to_casual convention
-- (migration 199, same shape). This is required because the function
-- also inserts into labor_allocations when the candidate is linked to a
-- requisition, and labor_allocations' write policy does not include
-- hr_officer — under SECURITY INVOKER an HR user's own approval would
-- fail RLS on that step. Documented per the "name any such case
-- explicitly" convention.
CREATE OR REPLACE FUNCTION public.provision_tier_2_worker_from_candidate(p_candidate_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_role     user_role;
  v_cand     candidates%ROWTYPE;
  v_req      labor_requisitions%ROWTYPE;
  v_new_id   uuid;
  v_actor_id uuid;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('admin', 'executive', 'hr_officer') THEN
    RAISE EXCEPTION 'Only admin/executive/HR may approve and provision a Tier 2 candidate';
  END IF;

  SELECT * INTO v_cand FROM candidates WHERE id = p_candidate_id;
  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'Candidate % not found', p_candidate_id;
  END IF;
  IF v_cand.candidate_type <> 'tier_2_casual' THEN
    RAISE EXCEPTION 'Candidate % is not a Tier 2 casual candidate', p_candidate_id;
  END IF;
  IF v_cand.outcome <> 'pending' THEN
    RAISE EXCEPTION 'Candidate % has already been decided (outcome: %)', p_candidate_id, v_cand.outcome;
  END IF;

  IF v_cand.labor_requisition_id IS NOT NULL THEN
    SELECT * INTO v_req FROM labor_requisitions WHERE id = v_cand.labor_requisition_id;
  END IF;

  v_actor_id := public.current_staff_id();

  INSERT INTO staff
    (employee_name, phone_number, email, employment_type, status,
     trade_tag, day_rate, first_engaged_at)
  VALUES
    (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
     v_cand.trade_tag, v_req.estimated_day_rate, CURRENT_DATE)
  RETURNING id INTO v_new_id;
  -- codename_amharic / codename_english auto-fill via trg_staff_autofill_tier2 (migration 183)

  UPDATE candidates
     SET outcome = 'hired',
         hr_approved_by_staff_id = v_actor_id,
         hr_approved_at = now(),
         provisioned_staff_id = v_new_id,
         updated_at = now()
   WHERE id = p_candidate_id;

  IF v_req.id IS NOT NULL THEN
    INSERT INTO labor_allocations
      (staff_id, project_id, start_date, status, assigned_by, notes)
    VALUES
      (v_new_id, v_req.project_id, CURRENT_DATE, 'active', auth.uid(),
       'Provisioned via Tier 2 HR queue from candidate ' || p_candidate_id::text ||
       ' for requisition ' || v_req.id::text);
  END IF;

  RETURN v_new_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.provision_tier_2_worker_from_candidate(uuid) TO authenticated;

COMMENT ON FUNCTION public.provision_tier_2_worker_from_candidate(uuid) IS
  'Approves a pending tier_2_casual candidate: creates the staff row (Unranked, no carried-over assessment score), marks the candidate hired/provisioned, and if the candidate is linked to a requisition, immediately creates an active labor_allocations row so the worker is allocatable without waiting for the rest of the requisition''s slots to fill.';
