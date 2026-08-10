-- 196 — Fix RLS blocking labor_commitments auto-insert on requisition approval.
--
-- Migration 184 enabled RLS on labor_commitments with a SELECT-only policy and
-- said "trigger managed" — but on_labor_req_approved_insert_commitment runs
-- SECURITY INVOKER, so its INSERT is evaluated under the approving user's
-- (HR officer's) RLS and fails: "new row violates row-level security policy
-- for table labor_commitments".
--
-- Flip the trigger function to SECURITY DEFINER. The approval action is already
-- gated by enforce_labor_req_approval_authority (BEFORE-UPDATE, INVOKER,
-- admin/hr_officer only), so the DEFINER-privileged INSERT cannot be reached
-- by a caller who couldn't have approved the requisition in the first place.
-- Inputs to the INSERT are all derived from NEW (the row the caller was
-- allowed to update), never from caller-controlled parameters — no injection
-- surface.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.on_labor_req_approved_insert_commitment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_amount numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    v_amount := COALESCE(NEW.estimated_total_cost,
                         NEW.estimated_day_rate * COALESCE(NEW.estimated_days, 0) * NEW.headcount);
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
END $$;
