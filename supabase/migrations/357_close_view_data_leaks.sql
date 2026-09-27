-- 357 — Views that showed any logged-in user what only some roles may see
--
-- A view runs with its owner's rights unless it says otherwise, so row
-- security on the tables beneath it didn't apply. Checked as a plain
-- 'staff' login (who sees 0 expenses and 0 payroll directly):
--
--   v_payroll_staff_accounts   132 rows — every payee's bank account and net pay
--   v_to_pay_queue              22 — what finance is about to pay, to whom
--   v_recent_payments / v_awaiting_bank_confirmation — payments sent
--   v_project_cost_group_budget 539 — every project's budget and spend
--   mv_project_exec_summary, mv_exec_gadget_* — margins, cash runway,
--     receivables/payables ageing (materialized views have no row security)
--
-- 1. Views whose readers are all served by the tables' own policies now run
--    as the caller (security_invoker). Each was re-counted per role before
--    and after: admin, executive, finance, HR, procurement keep exactly what
--    they had; a project manager sees budgets for the projects they manage;
--    staff and logistics lose the payroll/payment rows they never had
--    access to. (Applied first by hand on 2026-09-27; recorded here.)
-- 2. The executive materialized views are read through v_exec_* views that
--    return rows only to admin/executive; 359 then closes the MVs themselves.
-- 3. Four views that some roles need beyond what table policies allow
--    (project managers picking crew by competency score, HR and PMs
--    assessing candidates, labour commitments) keep owner rights but now
--    filter by role: the underlying view is renamed *_all and closed to
--    app users, and the old name is a filtered view over it.
-- v_staff_directory stays open to all logins on purpose — it is the company
-- directory (names, roles, departments, phone).

SET search_path TO public;

-- ── 1. Run as the caller ─────────────────────────────────────────────────
ALTER VIEW v_project_cost_group_budget  SET (security_invoker = on);
ALTER VIEW v_work_order_cost            SET (security_invoker = on);
ALTER VIEW v_payment_requests           SET (security_invoker = on);
ALTER VIEW v_payroll_staff_accounts     SET (security_invoker = on);
ALTER VIEW v_receipt_pickup_queue       SET (security_invoker = on);
ALTER VIEW v_staff_badges               SET (security_invoker = on);
ALTER VIEW v_staff_badge_summary        SET (security_invoker = on);
ALTER VIEW v_stock_item_latest_price    SET (security_invoker = on);
ALTER VIEW v_stock_item_vendor_history  SET (security_invoker = on);
ALTER VIEW v_sub_category_latest_price  SET (security_invoker = on);
ALTER VIEW v_staff_competency_summary   SET (security_invoker = on);
ALTER VIEW v_department_competency_gaps SET (security_invoker = on);
ALTER VIEW v_stock_levels               SET (security_invoker = on);
ALTER VIEW v_staff_rolling_performance  SET (security_invoker = on);
ALTER VIEW v_subcontract_competency_summary SET (security_invoker = on);
ALTER VIEW v_to_pay_queue               SET (security_invoker = on);
ALTER VIEW v_awaiting_bank_confirmation SET (security_invoker = on);
ALTER VIEW v_recent_payments            SET (security_invoker = on);

-- ── 2. Executive materialized views ──────────────────────────────────────
CREATE OR REPLACE FUNCTION is_exec_viewer()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive'), false)
$$;

CREATE OR REPLACE VIEW v_exec_project_summary      AS SELECT * FROM mv_project_exec_summary          WHERE is_exec_viewer();
CREATE OR REPLACE VIEW v_exec_cash_runway          AS SELECT * FROM mv_exec_gadget_cash_runway       WHERE is_exec_viewer();
CREATE OR REPLACE VIEW v_exec_ar_aging             AS SELECT * FROM mv_exec_gadget_ar_aging          WHERE is_exec_viewer();
CREATE OR REPLACE VIEW v_exec_ap_aging             AS SELECT * FROM mv_exec_gadget_ap_aging          WHERE is_exec_viewer();
CREATE OR REPLACE VIEW v_exec_margin_leaderboard   AS SELECT * FROM mv_exec_gadget_margin_leaderboard WHERE is_exec_viewer();
CREATE OR REPLACE VIEW v_exec_ledger_failures      AS SELECT * FROM mv_exec_gadget_ledger_failures   WHERE is_exec_viewer();
CREATE OR REPLACE VIEW v_exec_governance_flags     AS SELECT * FROM mv_exec_gadget_governance_flags  WHERE is_exec_viewer();

-- The MVs themselves are closed to app users in 359, once the page that
-- reads v_exec_* is deployed (closing them first would blank the CEO view).
REVOKE ALL ON v_exec_project_summary, v_exec_cash_runway, v_exec_ar_aging, v_exec_ap_aging,
  v_exec_margin_leaderboard, v_exec_ledger_failures, v_exec_governance_flags FROM anon;
GRANT SELECT ON v_exec_project_summary, v_exec_cash_runway, v_exec_ar_aging, v_exec_ap_aging,
  v_exec_margin_leaderboard, v_exec_ledger_failures, v_exec_governance_flags TO authenticated;

-- ── 3. Role-filtered views over owner-rights views ───────────────────────
-- Competency scores: HR and management, project managers (picking crew),
-- and each person their own.
ALTER VIEW v_staff_current_scores RENAME TO v_staff_current_scores_all;
REVOKE ALL ON v_staff_current_scores_all FROM anon, authenticated;
CREATE VIEW v_staff_current_scores AS
  SELECT * FROM v_staff_current_scores_all
  WHERE get_user_role()::text IN ('admin', 'executive', 'hr_officer', 'project_manager', 'operations_manager')
     OR staff_id = current_staff_id();

ALTER VIEW v_staff_role_summary RENAME TO v_staff_role_summary_all;
REVOKE ALL ON v_staff_role_summary_all FROM anon, authenticated;
CREATE VIEW v_staff_role_summary AS
  SELECT * FROM v_staff_role_summary_all
  WHERE get_user_role()::text IN ('admin', 'executive', 'hr_officer', 'project_manager', 'operations_manager')
     OR staff_id = current_staff_id();

-- Candidate assessments: HR, management and the project managers who
-- request and assess workers.
ALTER VIEW v_candidate_competency_summary RENAME TO v_candidate_competency_summary_all;
REVOKE ALL ON v_candidate_competency_summary_all FROM anon, authenticated;
CREATE VIEW v_candidate_competency_summary AS
  SELECT * FROM v_candidate_competency_summary_all
  WHERE get_user_role()::text IN ('admin', 'executive', 'hr_officer', 'project_manager', 'operations_manager');

-- Labour commitments are money owed to gangs: finance, HR, management,
-- and a project manager for their own projects.
ALTER VIEW v_project_labor_commitments RENAME TO v_project_labor_commitments_all;
REVOKE ALL ON v_project_labor_commitments_all FROM anon, authenticated;
CREATE VIEW v_project_labor_commitments AS
  SELECT * FROM v_project_labor_commitments_all
  WHERE get_user_role()::text IN ('admin', 'executive', 'finance', 'hr_officer', 'operations_manager')
     OR manages_project(project_id);

REVOKE ALL ON v_staff_current_scores, v_staff_role_summary, v_candidate_competency_summary, v_project_labor_commitments FROM anon;
GRANT SELECT ON v_staff_current_scores, v_staff_role_summary, v_candidate_competency_summary, v_project_labor_commitments TO authenticated;
