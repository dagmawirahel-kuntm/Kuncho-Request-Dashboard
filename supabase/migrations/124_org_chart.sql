-- ============================================================
-- Interactive department org chart + member drill-down (spec §5).
--
-- Per user decision: add staff.reports_to_id now so the chart can be
-- a real multi-tier hierarchy (department -> head -> ... -> members),
-- not just two levels. Per user decision: the member drill-down shows
-- name/role/sub-team/contact only — no salary, no disciplinary
-- history, no other RLS-gated field, same for every viewer regardless
-- of role. This must NOT create a new unrestricted read path into the
-- real `staff` table (which holds salary, national_id, bank_account,
-- disciplinary-adjacent fields and is deliberately locked down to
-- admin/manager/finance/hr_officer/logistics_officer/self — see 001,
-- 044, 049, 060b).
--
-- v_staff_directory is a narrow, safe-columns-only view that runs as
-- its owner (no `security_invoker`, unlike this codebase's other
-- views which set security_invoker=true specifically so the
-- QUERYING user's own RLS narrows the rows — here we want the
-- opposite: bypass the restrictive base-table RLS entirely, but only
-- expose columns that were already fine to make company-wide-visible.
-- This is also what DepartmentsPage.tsx's head_staff_id name lookup
-- should have been using all along — today a non-privileged viewer's
-- embedded `staff:head_staff_id(employee_name)` query silently comes
-- back null under RLS, so "No head assigned" can be a false negative
-- rather than the department genuinely having no head.
-- ============================================================

SET search_path TO public;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS reports_to_id UUID REFERENCES staff(id);
CREATE INDEX IF NOT EXISTS idx_staff_reports_to ON staff(reports_to_id);

CREATE OR REPLACE VIEW v_staff_directory AS
SELECT
  id,
  employee_name,
  role,
  staff_type,
  department_id,
  sub_team,
  phone_number,
  photo_url,
  reports_to_id,
  status
FROM staff;

GRANT SELECT ON v_staff_directory TO authenticated;

-- Verify: view exists and excludes sensitive columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'v_staff_directory' ORDER BY ordinal_position;
