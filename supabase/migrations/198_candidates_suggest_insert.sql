-- 198 — Allow operations_manager / project_manager to *suggest* candidates.
--
-- The labor requisition form (migration 197) has a "New hire" mode that
-- picks a candidate from the Competency Hub. Ops Manager can raise those
-- requisitions but can't reach the Hub (admin/exec/HR only), so they need
-- an inline "Suggest new candidate" flow. Today's candidates_write policy
-- gates INSERT to admin/exec/HR + the assessing dept head.
--
-- Split the write policy: INSERT gets broader (adds operations_manager and
-- project_manager, both of whom already raise labor requisitions and would
-- naturally scout labor) with a WITH CHECK that forces created_by =
-- current_staff_id() so the inserter can subsequently read the row via the
-- existing candidates_read "created_by = current_staff_id()" clause. HR
-- still owns UPDATE/DELETE authority — a suggested candidate is not a
-- hired one, and HR must review + advance the outcome.

SET search_path TO public;

DROP POLICY IF EXISTS candidates_write  ON candidates;
DROP POLICY IF EXISTS candidates_insert ON candidates;
DROP POLICY IF EXISTS candidates_update ON candidates;
DROP POLICY IF EXISTS candidates_delete ON candidates;

CREATE POLICY candidates_insert ON candidates FOR INSERT
  WITH CHECK (
    public.get_user_role() IN ('admin','executive','hr_officer')
    OR (
      public.get_user_role() IN ('operations_manager','project_manager')
      AND created_by = public.current_staff_id()
      AND outcome = 'pending'
    )
  );

CREATE POLICY candidates_update ON candidates FOR UPDATE
  USING (
    public.get_user_role() IN ('admin','executive','hr_officer')
    OR assessed_by_dept_head_staff_id = public.current_staff_id()
  )
  WITH CHECK (
    public.get_user_role() IN ('admin','executive','hr_officer')
    OR assessed_by_dept_head_staff_id = public.current_staff_id()
  );

CREATE POLICY candidates_delete ON candidates FOR DELETE
  USING (
    public.get_user_role() IN ('admin','executive','hr_officer')
  );
