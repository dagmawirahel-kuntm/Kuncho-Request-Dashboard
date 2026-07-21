-- ============================================================
-- Fix: v_to_pay_queue (100) was hiding real, already-approved
-- payment obligations across a fiscal year rollover.
--
-- The view filtered on `fiscal_period_for_date(e.date) = (current
-- fiscal period)`. That "current FY only" pattern exists elsewhere in
-- this codebase (098's enforce_expense_payment_lifecycle) to
-- grandfather WRITE-side enforcement — so historical rows aren't
-- retroactively blocked by new rules. It was never meant to gate
-- READ visibility of a live cash-payment queue. The practical effect:
-- the moment fiscal_periods.is_current moved from FY2025/26 to
-- FY2026/27 (2026-07-08), every expense dated before that day that
-- was finance-approved and sitting in payment_state = 'approved_to_pay'
-- silently disappeared from the queue, even though the money is still
-- genuinely owed. A to-pay queue must show every approved obligation
-- until it's paid, regardless of which fiscal year it was incurred in.
--
-- Re-declared verbatim from 100 minus the fiscal-year predicate.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE VIEW v_to_pay_queue
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.project_id,
  p.project_name,
  c.cost_group_id,
  cg.name AS cost_group_name,
  e.verify_wht,
  e.finance_approved_by,
  e.finance_approved_at,
  EXTRACT(DAY FROM (NOW() - e.finance_approved_at)) AS days_since_approval
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN categories c ON c.id = e.category_id
LEFT JOIN cost_groups cg ON cg.id = c.cost_group_id
WHERE e.payment_state = 'approved_to_pay';

GRANT SELECT ON v_to_pay_queue TO authenticated;

-- Verify
SELECT count(*) AS to_pay_queue_rows FROM v_to_pay_queue;
