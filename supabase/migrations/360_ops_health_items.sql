-- 360 — Operations health: work that has stopped moving, with who owns it
--
-- A system review (2026-09-27) found the same pattern across modules:
-- records that reached a step and stayed there. 114 purchase orders past
-- their delivery date with no goods received note (10.2M, 30 already
-- paid); 38 payments marked sent and never confirmed by the bank (5.5M);
-- 105 paid expenses with no receipt (14.3M); 106 expenses waiting over 14
-- days for approval; 143 workers still active on labour requisitions whose
-- end date has passed; and so on. Each lives on its own page, so nobody
-- sees the backlog as a whole.
--
-- v_ops_health_items is one row per stuck item: what kind, what it is, how
-- much money, since when, who owns the next step, and where to fix it. It
-- runs as the caller, so each person sees only items from records they can
-- already read — finance sees payment items, procurement sees PO items, a
-- project manager their own projects' labour.

SET search_path TO public;

CREATE OR REPLACE VIEW v_ops_health_items WITH (security_invoker = on) AS

-- Purchase orders past their delivery date with nothing received
SELECT 'po_not_received'::text AS kind, b.id::text AS ref_id,
  COALESCE(b.bundle_code, 'PO') || ' · ' || COALESCE(v.vendor_name, b.vendor_name, 'no vendor') AS title,
  'Expected ' || to_char(b.expected_delivery_date, 'DD Mon') ||
    CASE WHEN EXISTS (SELECT 1 FROM expenses e WHERE e.sourcing_bundle_id = b.id AND e.payment_state IN ('paid', 'sent', 'advance'))
         THEN ' · already paid' ELSE '' END AS detail,
  b.total_value AS amount, b.expected_delivery_date AS since,
  'procurement'::text AS owner_team, up.full_name AS owner_name, b.procurement_officer_id AS owner_user_id,
  '/sourcing/' || b.id AS link,
  EXISTS (SELECT 1 FROM expenses e WHERE e.sourcing_bundle_id = b.id AND e.payment_state IN ('paid', 'sent', 'advance')) AS urgent
FROM sourcing_bundles b
LEFT JOIN vendors v ON v.id = b.vendor_id
LEFT JOIN user_profiles up ON up.id = b.procurement_officer_id
WHERE b.status::text = 'ordered' AND b.expected_delivery_date < CURRENT_DATE
  AND NOT EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.sourcing_bundle_id = b.id)

UNION ALL
-- Purchase orders waiting to be approved or placed
SELECT 'po_not_ordered', b.id::text,
  COALESCE(b.bundle_code, 'PO') || ' · ' || COALESCE(v.vendor_name, b.vendor_name, 'no vendor'),
  CASE b.status::text WHEN 'submitted' THEN 'Waiting for approval' ELSE 'Approved, not ordered' END,
  b.total_value, COALESCE(b.approved_at, b.submitted_at, b.created_at)::date,
  'procurement', up.full_name, b.procurement_officer_id,
  '/sourcing/' || b.id, false
FROM sourcing_bundles b
LEFT JOIN vendors v ON v.id = b.vendor_id
LEFT JOIN user_profiles up ON up.id = b.procurement_officer_id
WHERE b.status::text IN ('submitted', 'approved') AND COALESCE(b.approved_at, b.submitted_at, b.created_at) < now() - interval '7 days'

UNION ALL
-- Purchase requests with lines nobody has sourced
SELECT 'pr_not_sourced', o.id::text,
  COALESCE(o.request_code, 'PR') || ' · ' || COALESCE(o.order_name, 'Purchase request'),
  (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'pending') || ' line(s) not sourced' ||
    COALESCE(' · needed by ' || to_char(o.required_by_date, 'DD Mon'), ''),
  (SELECT sum(oi.quantity * oi.unit_price_est) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'pending'),
  o.created_at::date, 'procurement', s.employee_name, s.user_id,
  '/purchase-requests/' || o.id, (o.required_by_date < CURRENT_DATE)
FROM orders o
LEFT JOIN staff s ON s.id = o.staff_id
WHERE NOT COALESCE(o.is_archived, false) AND o.approval_status::text <> 'rejected'
  AND o.created_at < now() - interval '14 days'
  AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'pending')

UNION ALL
-- Payments marked sent that the bank statement never confirmed
SELECT 'payment_unconfirmed', e.id::text,
  COALESCE(v.vendor_name, e.vendors_name, e.item_service_description, 'Payment') || COALESCE(' · ' || e.expense_code, ''),
  'Sent ' || to_char(e.payment_state_changed_at, 'DD Mon') || ' — not on a bank statement yet',
  e.amount_etb, e.payment_state_changed_at::date, 'finance', NULL, e.disbursed_by,
  '/expenses/' || e.id, (e.payment_state_changed_at < now() - interval '21 days')
FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id
WHERE e.payment_state = 'sent' AND e.payment_state_changed_at < now() - interval '7 days'

UNION ALL
-- Expenses waiting for finance approval
SELECT 'expense_not_approved', e.id::text,
  COALESCE(v.vendor_name, e.vendors_name, e.item_service_description, 'Expense') || COALESCE(' · ' || e.expense_code, ''),
  COALESCE(p.project_name, 'No project'),
  e.amount_etb, e.created_at::date, 'finance', NULL, NULL,
  '/expenses/' || e.id, (e.created_at < now() - interval '30 days')
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
WHERE e.approval_status::text IN ('pending', 'manager_approved') AND NOT COALESCE(e.is_archived, false)
  AND e.created_at < now() - interval '7 days'

UNION ALL
-- Paid, but no receipt on file
SELECT 'receipt_missing', e.id::text,
  COALESCE(v.vendor_name, e.vendors_name, e.item_service_description, 'Expense') || COALESCE(' · ' || e.expense_code, ''),
  'Paid ' || COALESCE(to_char(e.paid_date, 'DD Mon'), '') || ' · no receipt attached',
  e.amount_etb, COALESCE(e.paid_date::date, e.date), 'finance', buyer.full_name, e.purchaser_user_id,
  '/expenses/' || e.id, (e.amount_etb >= 100000)
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN user_profiles buyer ON buyer.id = e.purchaser_user_id
WHERE e.payment_state = 'paid' AND e.receipt_url IS NULL AND NOT COALESCE(e.is_archived, false)

UNION ALL
-- Withholding not recorded on a payment to a WHT-eligible vendor
SELECT 'wht_missing', e.id::text,
  v.vendor_name || COALESCE(' · ' || e.expense_code, ''),
  'WHT-eligible vendor, no withholding recorded (3% ≈ ' || to_char(round(e.amount_etb * 0.03), 'FM999,999,990') || ')',
  e.amount_etb, COALESCE(e.paid_date::date, e.date), 'finance', NULL, NULL,
  '/expenses/' || e.id, true
FROM expenses e JOIN vendors v ON v.id = e.vendor_id
WHERE v.wth_eligible AND e.amount_etb >= 10000 AND COALESCE(e.wht_amount, 0) = 0
  AND e.payment_state IN ('paid', 'sent') AND NOT COALESCE(e.is_archived, false)

UNION ALL
-- Bank statement lines nobody has matched
SELECT 'bank_line_unmatched', l.id::text,
  COALESCE(a.account_name, 'Bank') || ' · ' || left(COALESCE(l.narration, l.reference, 'line'), 60),
  CASE WHEN COALESCE(l.debit_amount, 0) > 0 THEN 'Money out' ELSE 'Money in' END || ' on ' || to_char(l.value_date, 'DD Mon'),
  COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount), l.value_date, 'finance', NULL, NULL,
  '/bank-statement-import?tab=queue&account=' || l.account_id || '&line=' || l.id,
  (COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount) >= 100000)
FROM bank_statement_lines l LEFT JOIN accounts a ON a.id = l.account_id
WHERE COALESCE(l.match_status, 'unmatched') = 'unmatched' AND l.value_date < CURRENT_DATE - 7

UNION ALL
-- Transport jobs still open after a week
SELECT 'transport_open', t.id::text,
  COALESCE(t.request_name, 'Transport job') || COALESCE(' · ' || p.project_name, ''),
  initcap(replace(COALESCE(t.job_status::text, 'requested'), '_', ' ')) || COALESCE(' · ' || s.employee_name, ''),
  t.amount, t.created_at::date, 'logistics', s.employee_name, s.user_id,
  '/transportation/' || t.id || '/edit', (t.created_at < now() - interval '21 days')
FROM transportation_requests t
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN staff s ON s.id = t.assigned_staff_id
WHERE COALESCE(t.job_status::text, '') NOT IN ('completed', 'cancelled') AND t.created_at < now() - interval '7 days'

UNION ALL
-- Labour requisitions waiting for a decision
SELECT 'labor_not_decided', r.id::text,
  r.role_needed || ' ×' || r.headcount || ' · ' || COALESCE(p.project_name, ''),
  'Starts ' || to_char(r.start_date, 'DD Mon') || COALESCE(' · ' || to_char(r.estimated_total_cost, 'FM999,999,990') || ' ETB', ''),
  r.estimated_total_cost, r.created_at::date, 'hr', NULL, NULL,
  '/labor-requisitions/' || r.id, (r.start_date <= CURRENT_DATE)
FROM labor_requisitions r LEFT JOIN projects p ON p.id = r.project_id
WHERE r.status = 'pending' AND r.created_at < now() - interval '3 days'

UNION ALL
-- Workers still active after their requisition ended
SELECT 'labor_overstay', a.id::text,
  COALESCE(s.employee_name, 'Worker') || ' · ' || r.role_needed || ' · ' || COALESCE(p.project_name, ''),
  'Requisition ended ' || to_char(r.end_date, 'DD Mon') || ' — still active at ' || COALESCE(to_char(a.day_rate_snapshot, 'FM999,990'), '?') || '/day',
  a.day_rate_snapshot * (CURRENT_DATE - r.end_date), r.end_date, 'project', pm.employee_name, pm.user_id,
  '/labor-requisitions/' || r.id, (CURRENT_DATE - r.end_date > 14)
FROM labor_allocations a
JOIN labor_requisitions r ON r.id = a.labor_requisition_id
LEFT JOIN staff s ON s.id = a.staff_id
LEFT JOIN projects p ON p.id = r.project_id
LEFT JOIN staff pm ON pm.id = p.project_manager_id
WHERE a.status = 'active' AND r.end_date < CURRENT_DATE AND (a.end_date IS NULL OR a.end_date > r.end_date)

UNION ALL
-- Approved labour nobody has been placed in
SELECT 'labor_unfilled', r.id::text,
  r.role_needed || ' · ' || COALESCE(p.project_name, ''),
  COALESCE(r.slots_filled, 0) || ' of ' || r.headcount || ' filled · started ' || to_char(r.start_date, 'DD Mon'),
  r.estimated_total_cost, r.start_date, 'hr', NULL, NULL,
  '/labor-requisitions/' || r.id, false
FROM labor_requisitions r LEFT JOIN projects p ON p.id = r.project_id
WHERE r.status = 'approved' AND COALESCE(r.slots_filled, 0) < r.headcount AND r.start_date < CURRENT_DATE - 3
  AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)

UNION ALL
-- Vendors with money owed whose bank details nobody has checked
SELECT 'vendor_unverified', v.id::text, v.vendor_name,
  'Bank details not verified · ' || to_char(m.owed, 'FM999,999,990') || ' ETB approved to pay',
  m.owed, v.entered_at::date, 'finance', NULL, NULL,
  '/vendors/review?vendor=' || v.id, true
FROM vendors v JOIN v_vendor_money m ON m.vendor_id = v.id
WHERE v.verification_status = 'pending_verification' AND m.owed > 0

UNION ALL
-- Running projects with no project manager
SELECT 'project_no_pm', p.id::text, p.project_name,
  'No project manager assigned', p.contract_value, p.created_at::date, 'management', NULL, NULL,
  '/projects/' || p.id, false
FROM projects p
WHERE p.project_manager_id IS NULL AND COALESCE(p.active_for_year, false)
  AND NOT COALESCE(p.is_internal, false);

REVOKE ALL ON v_ops_health_items FROM anon;
GRANT SELECT ON v_ops_health_items TO authenticated;
