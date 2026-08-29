-- 261 — Multiple roster (Tier 2) workers on a single labor requisition
--
-- Today a roster request carries exactly ONE person, via
-- labor_requisitions.specific_staff_id. Asking for five masons on a work
-- order means creating five separate requisitions, each approved
-- separately — even though they share one project, work order, trade,
-- date window and rate.
--
-- The new-hire path already solved this shape: labor_requisition_candidates
-- is a child table, and on_labor_req_approved_promote_candidate loops it to
-- create one labor_allocation per candidate. This migration gives roster
-- workers the same treatment:
--
--   1. labor_requisition_workers — child table, one row per roster worker,
--      mirroring labor_requisition_candidates (including its RLS).
--   2. Backfill from the existing specific_staff_id so the child table is
--      the single source of truth for every requisition, old and new.
--   3. on_labor_req_approved_maybe_allocate rewritten to loop the child
--      table, falling back to specific_staff_id when no child rows exist
--      (so anything created by an older client still works unchanged).
--
-- specific_staff_id is deliberately NOT dropped: it stays as the "exactly
-- one worker" denormalised pointer (the UI keeps writing it for
-- single-worker requests) so existing readers and the assignment-mode
-- CHECK constraint keep working.

CREATE TABLE IF NOT EXISTS public.labor_requisition_workers (
  requisition_id uuid NOT NULL REFERENCES labor_requisitions(id) ON DELETE CASCADE,
  staff_id       uuid NOT NULL REFERENCES staff(id),
  -- Set when this worker's labor_allocation has been created on approval.
  -- Doubles as the idempotency guard: the trigger only ever allocates rows
  -- where this is still NULL, so a re-approval can't double-allocate.
  allocation_id  uuid REFERENCES labor_allocations(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requisition_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_labor_req_workers_staff ON labor_requisition_workers(staff_id);

COMMENT ON TABLE public.labor_requisition_workers IS
  'Roster (Tier 2) workers requested on one labor requisition — the multi-worker equivalent of labor_requisition_candidates. One labor_allocation is created per row on approval; allocation_id records which, and guards against double-allocation.';

ALTER TABLE public.labor_requisition_workers ENABLE ROW LEVEL SECURITY;

-- Mirrors labor_requisition_candidates' lrc_read / lrc_write exactly: the
-- same people who can raise a requisition for a project (including that
-- project's site foreman) can say who it is for.
DROP POLICY IF EXISTS lrw_read ON public.labor_requisition_workers;
CREATE POLICY lrw_read ON public.labor_requisition_workers FOR SELECT
USING (
  get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'hr_officer'::user_role,
                               'operations_manager'::user_role, 'project_manager'::user_role, 'finance'::user_role])
  OR EXISTS (
    SELECT 1 FROM labor_requisitions lr
    WHERE lr.id = labor_requisition_workers.requisition_id
      AND is_site_foreman_for_project(lr.project_id)
  )
);

DROP POLICY IF EXISTS lrw_write ON public.labor_requisition_workers;
CREATE POLICY lrw_write ON public.labor_requisition_workers FOR ALL
USING (
  get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'hr_officer'::user_role,
                               'operations_manager'::user_role, 'project_manager'::user_role])
  OR EXISTS (
    SELECT 1 FROM labor_requisitions lr
    WHERE lr.id = labor_requisition_workers.requisition_id
      AND is_site_foreman_for_project(lr.project_id)
  )
)
WITH CHECK (
  get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'hr_officer'::user_role,
                               'operations_manager'::user_role, 'project_manager'::user_role])
  OR EXISTS (
    SELECT 1 FROM labor_requisitions lr
    WHERE lr.id = labor_requisition_workers.requisition_id
      AND is_site_foreman_for_project(lr.project_id)
  )
);

-- Backfill: every existing single-worker roster requisition becomes one
-- child row, so readers only ever need to consult one place. Where the
-- requisition is already approved and produced an allocation, link it, so
-- the trigger's "already allocated" guard sees it as done and can never
-- re-allocate a historical row.
INSERT INTO labor_requisition_workers (requisition_id, staff_id, allocation_id)
SELECT lr.id, lr.specific_staff_id,
       (SELECT la.id FROM labor_allocations la
         WHERE la.labor_requisition_id = lr.id AND la.staff_id = lr.specific_staff_id
         ORDER BY la.created_at LIMIT 1)
FROM labor_requisitions lr
WHERE lr.specific_staff_id IS NOT NULL
ON CONFLICT (requisition_id, staff_id) DO NOTHING;

-- Allocation on approval, now one row per requested roster worker.
--
-- SECURITY DEFINER (it was not before): the function now also writes
-- labor_requisition_workers.allocation_id and labor_requisitions.slots_filled,
-- and the approving role is typically hr_officer, who holds neither
-- labor_allocations_write nor a write grant on the child table. Its sibling
-- on_labor_req_approved_promote_candidate is already SECURITY DEFINER for
-- exactly this reason; this brings the two in line. The function only ever
-- acts on the requisition row the trigger fired for.
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_maybe_allocate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row        labor_requisition_workers%ROWTYPE;
  v_staff_rate numeric;
  v_alloc_rate numeric;
  v_alloc_id   uuid;
  v_count      int := 0;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN

    FOR v_row IN
      SELECT * FROM labor_requisition_workers
       WHERE requisition_id = NEW.id
         AND allocation_id IS NULL
       ORDER BY created_at
    LOOP
      SELECT day_rate INTO v_staff_rate FROM staff WHERE id = v_row.staff_id;
      -- Per-worker COALESCE, not a single requisition-wide figure: an
      -- explicit estimated_day_rate applies to everyone on the request,
      -- but when it's left blank each worker keeps their own roster rate
      -- (migration 249's multi-rate Tier 2 behaviour, preserved per row).
      v_alloc_rate := CASE WHEN NEW.payment_basis = 'per_volume'
                           THEN NEW.unit_rate
                           ELSE COALESCE(NEW.estimated_day_rate, v_staff_rate) END;

      INSERT INTO labor_allocations
        (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
      VALUES
        (v_row.staff_id, NEW.project_id,
         COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
         v_alloc_rate,
         'active',
         'Auto-created from approved roster request ' || NEW.id::text,
         NEW.id)
      RETURNING id INTO v_alloc_id;

      UPDATE labor_requisition_workers
         SET allocation_id = v_alloc_id
       WHERE requisition_id = NEW.id AND staff_id = v_row.staff_id;

      v_count := v_count + 1;
    END LOOP;

    -- Legacy path: a requisition created by an older client that set
    -- specific_staff_id without a child row. Only reachable when the loop
    -- found nothing, so the two can never both allocate the same person.
    IF v_count = 0 AND NEW.specific_staff_id IS NOT NULL THEN
      SELECT day_rate INTO v_staff_rate FROM staff WHERE id = NEW.specific_staff_id;
      v_alloc_rate := CASE WHEN NEW.payment_basis = 'per_volume'
                           THEN NEW.unit_rate
                           ELSE COALESCE(NEW.estimated_day_rate, v_staff_rate) END;
      INSERT INTO labor_allocations
        (staff_id, project_id, start_date, end_date, day_rate_snapshot, status, notes, labor_requisition_id)
      VALUES
        (NEW.specific_staff_id, NEW.project_id,
         COALESCE(NEW.start_date, CURRENT_DATE), NEW.end_date,
         v_alloc_rate,
         'active',
         'Auto-created from approved roster request ' || NEW.id::text,
         NEW.id);
      v_count := 1;
    END IF;

    -- slots_filled otherwise only counts hired *candidates* (migration
    -- 213), so a fully-staffed roster requisition would read "open"
    -- forever. Roster workers are filled the moment they're allocated.
    -- Safe against recursion: the trigger is AFTER UPDATE OF status, and
    -- this touches neither status nor work_order_id/project_id.
    IF v_count > 0 THEN
      UPDATE labor_requisitions
         SET slots_filled = GREATEST(slots_filled, v_count)
       WHERE id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- Pre-existing bug, surfaced by testing this feature's main case.
-- Migration 249 made estimated_day_rate optional precisely so each Tier 2
-- worker can keep their own roster rate — but this commitment trigger was
-- never taught that. With a blank rate every term of the per_day branch is
-- NULL, so committed_amount came out NULL and the NOT NULL column rejected
-- the approval outright: approving ANY per_day requisition without an
-- explicit day rate failed, multi-worker or not. Requesting several roster
-- workers who each have their own rate is exactly that shape, so it is
-- fixed here rather than left to break the new flow.
CREATE OR REPLACE FUNCTION public.on_labor_req_approved_insert_commitment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_amount numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    v_amount := CASE
      WHEN NEW.payment_basis = 'per_volume' THEN
        COALESCE(NEW.estimated_total_cost, NEW.unit_rate * COALESCE(NEW.estimated_total_volume, 0))
      ELSE
        COALESCE(
          NEW.estimated_total_cost,
          NEW.estimated_day_rate * COALESCE(NEW.estimated_days, 0) * NEW.headcount,
          -- Fall back to the sum of the requested roster workers' own day
          -- rates, which is what such a requisition actually commits.
          (SELECT SUM(COALESCE(s.day_rate, 0))
             FROM labor_requisition_workers w
             JOIN staff s ON s.id = w.staff_id
            WHERE w.requisition_id = NEW.id) * COALESCE(NEW.estimated_days, 0)
        )
    END;
    -- Never let an unknown estimate block an approval: commit zero and let
    -- the actual timesheet rollup carry the real figure.
    v_amount := COALESCE(v_amount, 0);

    INSERT INTO labor_commitments
      (labor_requisition_id, project_id, committed_amount, committed_by, status, notes)
    VALUES
      (NEW.id, NEW.project_id, v_amount, NEW.approved_by, 'active',
       'Auto-committed on approval')
    ON CONFLICT (labor_requisition_id) DO UPDATE
      SET committed_amount = EXCLUDED.committed_amount,
          committed_at     = now(),
          committed_by     = EXCLUDED.committed_by,
          status           = 'active',
          updated_at       = now();
  END IF;
  RETURN NEW;
END $function$;
