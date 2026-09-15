-- Fix: every schedule in production had boq_id = NULL, which silently made
-- PR 9c's physical-progress chain inert.
--
-- v_boq_item_physical_progress joins:
--     JOIN v_boq_current_per_project cur
--       ON cur.project_id = s.project_id AND cur.boq_id = s.boq_id
-- so a schedule with boq_id = NULL never matches, and every BOQ item reports
-- progress_pct = NULL no matter how many schedule tasks are linked to it.
-- Confirmed in live data: the task "Inspection and Preparation of wall
-- surfaces" IS correctly linked to its BOQ item via schedule_task_boq_items,
-- and still contributed nothing.
--
-- This also would have made PR 9d's milestone gate unusable on day one:
-- mark_milestone_progress_met treats NULL progress as incomplete, so every
-- milestone would have been rejected forever.
--
-- Root cause (two parts, both fixed):
--
-- 1. ScheduleSection's "Build Schedule" passes boq_id from its
--    ['project-approved-boq', projectId] query, but BoqSection's
--    invalidateAll() only invalidates ['project-boq'] and ['boq-tree'] --
--    never 'project-approved-boq'. So approving a BOQ left ScheduleSection
--    holding a stale null. Live evidence: BOQ 9b247824 was approved at
--    14:54:51 and the schedule created 25 seconds later at 14:55:16 still
--    got boq_id = NULL. (The cache invalidation is fixed in BoqSection.tsx
--    alongside this migration.)
--
-- 2. A schedule created BEFORE its BOQ was approved had no repair path at
--    all -- nothing ever set boq_id later. That is what happened to the
--    other schedule (created 2026-08-19, BOQ approved 2026-08-20).
--
-- The two triggers below close both directions at the database level, so
-- correctness no longer depends on the frontend passing the right value.

SET search_path TO public;

-- Direction 1: schedule created while an approved BOQ already exists, but
-- the caller passed NULL (stale cache, API client, import script).
CREATE OR REPLACE FUNCTION default_schedule_boq_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.boq_id IS NULL THEN
    SELECT id INTO NEW.boq_id
    FROM boqs
    WHERE project_id = NEW.project_id AND status = 'approved'
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_default_schedule_boq_id
  BEFORE INSERT ON schedules
  FOR EACH ROW EXECUTE FUNCTION default_schedule_boq_id();

-- Direction 2: BOQ approved after the schedule already existed. Only fills
-- schedules that have no BOQ recorded -- it must never re-point a schedule
-- that is deliberately tracking an earlier version, because that is exactly
-- what v_schedule_tasks_with_stale_boq_links is designed to surface.
--
-- SECURITY DEFINER because the roles that approve a BOQ are not necessarily
-- the schedule's owning PM, and schedules_update is restricted to admin or
-- that PM -- a plain INVOKER trigger would fail under RLS. Same reasoning,
-- and same mandatory auth guard, as PR 9c's
-- derive_task_progress_from_work_orders.
CREATE OR REPLACE FUNCTION link_schedules_to_newly_approved_boq()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NEW.status = 'approved' AND COALESCE(OLD.status, '') <> 'approved' THEN
    UPDATE schedules
    SET boq_id = NEW.id
    WHERE project_id = NEW.project_id AND boq_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_link_schedules_to_newly_approved_boq
  AFTER UPDATE OF status ON boqs
  FOR EACH ROW EXECUTE FUNCTION link_schedules_to_newly_approved_boq();

-- One-time backfill for the schedules already stuck in this state.
UPDATE schedules s
SET boq_id = b.id
FROM boqs b
WHERE s.boq_id IS NULL
  AND b.project_id = s.project_id
  AND b.status = 'approved';
