-- PR 9d group (d): per-project milestone summary view (item 16).
--
-- Built but deliberately NOT wired into the exec dashboard, same
-- "build the hook, wire it later" pattern as PR 9c's
-- v_project_schedule_summary.
--
-- Also fixes an RLS gap I introduced in migration 232:
-- v_contract_milestone_plan_totals was created without
-- security_invoker, so it ran with the view owner's rights and would
-- have exposed milestone percentages to roles that
-- payment_milestones_select excludes. Every other view in this codebase
-- sets security_invoker = true; these now match.

SET search_path TO public;

DROP VIEW IF EXISTS v_contract_milestone_plan_totals;
CREATE VIEW v_contract_milestone_plan_totals
WITH (security_invoker = true) AS
SELECT
  contract_id,
  count(*) AS milestone_count,
  round(sum(percent_of_contract_value), 2) AS sum_percent_of_contract_value,
  abs(sum(percent_of_contract_value) - 100) <= 0.5 AS is_balanced
FROM payment_milestones
GROUP BY contract_id;

CREATE OR REPLACE VIEW v_project_milestone_summary
WITH (security_invoker = true) AS
SELECT
  pm.project_id,
  pm.contract_id,
  count(*)                                                  AS milestone_count,
  count(*) FILTER (WHERE pm.status = 'pending')             AS pending_count,
  count(*) FILTER (WHERE pm.status = 'progress_met')        AS progress_met_count,
  count(*) FILTER (WHERE pm.status = 'invoiced')            AS invoiced_count,
  count(*) FILTER (WHERE pm.status = 'payment_confirmed')   AS paid_count,
  COALESCE(sum(pm.net_payable_etb), 0)                      AS total_net_payable_etb,
  -- What finance actually recorded as received, which can differ from the
  -- net payable (that difference is captured as a note, not reconciled --
  -- see the v1 limitation on confirm_milestone_payment).
  COALESCE(sum(pm.amount_received_etb)
           FILTER (WHERE pm.status = 'payment_confirmed'), 0) AS total_received_etb,
  COALESCE(sum(pm.net_payable_etb)
           FILTER (WHERE pm.status <> 'payment_confirmed'), 0) AS outstanding_etb,
  COALESCE(sum(pm.net_payable_etb)
           FILTER (WHERE pm.status = 'invoiced'), 0)          AS invoiced_awaiting_payment_etb,
  COALESCE(sum(pm.retention_withheld_etb), 0)                AS total_retention_withheld_etb,
  COALESCE(sum(pm.wht_withheld_etb), 0)                      AS total_wht_withheld_etb
FROM payment_milestones pm
GROUP BY pm.project_id, pm.contract_id;
