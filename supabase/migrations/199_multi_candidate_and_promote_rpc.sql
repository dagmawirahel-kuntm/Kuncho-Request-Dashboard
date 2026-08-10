-- 199 — Multi-candidate labor requisitions + promote-to-casual RPC +
-- attendance-aware daily-report headcount view.
--
-- Three coupled changes:
--
-- 1. labor_requisition_candidates join table lets one requisition hire N
--    candidates in a single HR approval. Backfills existing candidate_id
--    into the join table (one row per requisition) so the promote trigger
--    can treat both paths uniformly.
--
-- 2. on_labor_req_approved_promote_candidate rewritten: loops over the join
--    table, mints a staff row + labor_allocation per candidate, marks each
--    join row's promoted_staff_id, flips candidates.outcome to 'hired'.
--    Also handles the pre-existing labor_requisitions.candidate_id path by
--    reading the join table (which the backfill populated).
--
-- 3. promote_candidate_to_casual(candidate_id, trade_tag, day_rate) RPC for
--    HR: standalone promote from Competency Hub without needing a
--    requisition. Same effects as the trigger's per-candidate step minus
--    the allocation (no project context).
--
-- 4. v_site_report_headcount view: now UNIONs timesheet rows and
--    timesheet_attendance ticks. Tier 2 attendance was undercounted before
--    (the view predates migration 197's attendance table).

SET search_path TO public;

-- ── 1) Join table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_requisition_candidates (
  requisition_id       uuid NOT NULL REFERENCES labor_requisitions(id) ON DELETE CASCADE,
  candidate_id         uuid NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  promoted_staff_id    uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requisition_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_lrc_requisition ON labor_requisition_candidates (requisition_id);
CREATE INDEX IF NOT EXISTS idx_lrc_candidate   ON labor_requisition_candidates (candidate_id);

ALTER TABLE labor_requisition_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lrc_read  ON labor_requisition_candidates;
DROP POLICY IF EXISTS lrc_write ON labor_requisition_candidates;

CREATE POLICY lrc_read ON labor_requisition_candidates FOR SELECT
  USING (
    public.get_user_role() IN ('admin','executive','hr_officer','operations_manager','project_manager','finance')
    OR EXISTS (SELECT 1 FROM labor_requisitions lr
               WHERE lr.id = labor_requisition_candidates.requisition_id
                 AND public.is_site_foreman_for_project(lr.project_id))
  );

CREATE POLICY lrc_write ON labor_requisition_candidates FOR ALL
  USING (
    public.get_user_role() IN ('admin','executive','hr_officer','operations_manager','project_manager')
    OR EXISTS (SELECT 1 FROM labor_requisitions lr
               WHERE lr.id = labor_requisition_candidates.requisition_id
                 AND public.is_site_foreman_for_project(lr.project_id))
  )
  WITH CHECK (
    public.get_user_role() IN ('admin','executive','hr_officer','operations_manager','project_manager')
    OR EXISTS (SELECT 1 FROM labor_requisitions lr
               WHERE lr.id = labor_requisition_candidates.requisition_id
                 AND public.is_site_foreman_for_project(lr.project_id))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON labor_requisition_candidates TO authenticated;

-- Backfill: any existing single-candidate requisition becomes a one-row group
-- in the join table so the multi-candidate trigger can treat it uniformly.
INSERT INTO labor_requisition_candidates (requisition_id, candidate_id, promoted_staff_id)
SELECT id, candidate_id, specific_staff_id
FROM labor_requisitions
WHERE candidate_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 2) Rewritten promote trigger — loops over the join table ────────────────
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_promote_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_row      labor_requisition_candidates%ROWTYPE;
  v_cand     candidates%ROWTYPE;
  v_new_id   uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    FOR v_row IN
      SELECT * FROM labor_requisition_candidates
       WHERE requisition_id = NEW.id
         AND promoted_staff_id IS NULL
    LOOP
      SELECT * INTO v_cand FROM candidates WHERE id = v_row.candidate_id;
      IF v_cand.id IS NULL THEN
        RAISE EXCEPTION 'Candidate % not found for requisition %', v_row.candidate_id, NEW.id;
      END IF;

      INSERT INTO staff
        (employee_name, phone_number, email, employment_type, status,
         trade_tag, day_rate, first_engaged_at)
      VALUES
        (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
         NEW.trade_tag, NEW.estimated_day_rate, COALESCE(NEW.start_date, CURRENT_DATE))
      RETURNING id INTO v_new_id;

      UPDATE candidates
         SET outcome = 'hired',
             outcome_notes = COALESCE(outcome_notes, '') ||
               CASE WHEN outcome_notes IS NULL OR outcome_notes = '' THEN '' ELSE E'\n' END ||
               'Hired via labor requisition ' || NEW.id::text,
             updated_at = now()
       WHERE id = v_row.candidate_id;

      UPDATE labor_requisition_candidates
         SET promoted_staff_id = v_new_id
       WHERE requisition_id = NEW.id AND candidate_id = v_row.candidate_id;

      -- Allocation for this staff on the project (mirrors maybe_allocate).
      INSERT INTO labor_allocations
        (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes)
      VALUES
        (v_new_id, NEW.project_id,
         COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
         NEW.estimated_day_rate,
         'planned',
         'Auto-created from approved requisition ' || NEW.id::text
           || ' · candidate ' || v_row.candidate_id::text);
    END LOOP;

    -- Legacy: if a single specific_staff_id was set and no join-table
    -- entries were processed, leave NEW.specific_staff_id in place so the
    -- existing maybe_allocate trigger handles it. If the join table drove
    -- allocations here, clear specific_staff_id to avoid a duplicate
    -- allocation from maybe_allocate.
    IF EXISTS (SELECT 1 FROM labor_requisition_candidates WHERE requisition_id = NEW.id) THEN
      NEW.specific_staff_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- ── 3) Standalone promote RPC for Competency Hub ────────────────────────────
CREATE OR REPLACE FUNCTION public.promote_candidate_to_casual(
  p_candidate_id  uuid,
  p_trade_tag     text,
  p_day_rate      numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_role   user_role;
  v_cand   candidates%ROWTYPE;
  v_new_id uuid;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('admin','executive','hr_officer') THEN
    RAISE EXCEPTION 'Only admin/executive/HR may promote a candidate to casual worker';
  END IF;

  SELECT * INTO v_cand FROM candidates WHERE id = p_candidate_id;
  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'Candidate % not found', p_candidate_id;
  END IF;
  IF v_cand.outcome = 'hired' THEN
    RAISE EXCEPTION 'Candidate is already hired';
  END IF;

  INSERT INTO staff
    (employee_name, phone_number, email, employment_type, status,
     trade_tag, day_rate, first_engaged_at)
  VALUES
    (v_cand.full_name, v_cand.phone, v_cand.email, 'tier_2_casual', 'active',
     p_trade_tag, p_day_rate, CURRENT_DATE)
  RETURNING id INTO v_new_id;

  UPDATE candidates
     SET outcome = 'hired',
         outcome_notes = COALESCE(outcome_notes, '') ||
           CASE WHEN outcome_notes IS NULL OR outcome_notes = '' THEN '' ELSE E'\n' END ||
           'Promoted to Tier 2 casual from Competency Hub',
         updated_at = now()
   WHERE id = p_candidate_id;

  RETURN v_new_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.promote_candidate_to_casual(uuid, text, numeric) TO authenticated;

-- ── 4) Site-report headcount now counts timesheet + attendance ticks ────────
CREATE OR REPLACE VIEW public.v_site_report_headcount AS
SELECT
  project_id,
  work_date AS report_date,
  count(*) FILTER (WHERE labor_tier = 1) AS tier1_headcount,
  count(*) FILTER (WHERE labor_tier = 2) AS tier2_headcount,
  count(*) AS total_headcount
FROM (
  SELECT t.project_id, t.date AS work_date, t.labor_tier
    FROM timesheet t
   WHERE t.project_id IS NOT NULL
     AND t.date IS NOT NULL
     AND COALESCE(t.is_archived, false) = false
  UNION ALL
  SELECT a.project_id, a.work_date, 2 AS labor_tier
    FROM timesheet_attendance a
) src
GROUP BY project_id, work_date;

GRANT SELECT ON public.v_site_report_headcount TO authenticated;
