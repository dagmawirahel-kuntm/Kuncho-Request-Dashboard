-- 359 — Close the executive materialized views to app users
--
-- Run after the frontend that reads v_exec_* (357) is deployed. Until then
-- the executive dashboard still reads the MVs directly; afterwards only
-- admin/executive see their rows, through the role-checked views.

SET search_path TO public;

REVOKE ALL ON mv_project_exec_summary, mv_exec_gadget_cash_runway, mv_exec_gadget_ar_aging, mv_exec_gadget_ap_aging,
  mv_exec_gadget_margin_leaderboard, mv_exec_gadget_ledger_failures, mv_exec_gadget_governance_flags FROM anon, authenticated;
