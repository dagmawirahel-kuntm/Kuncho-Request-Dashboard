-- 329 — Close every view to anon; archived expenses leave the payment queues
--
-- 1. Anon could read 30 views and materialized views that run with their
--    owner's rights, and so skip the RLS on the tables beneath them. With
--    only the public anon key — which ships in the frontend bundle — anyone
--    could read payroll staff bank accounts (v_payroll_staff_accounts), the
--    staff directory, the to-pay queue, account statement summaries, AR/AP
--    aging, cash runway, project margins and more. Nothing in the app reads a
--    view before login (the only public pages are login, signup and
--    password reset, which read none), so anon loses SELECT on every view
--    and materialized view in public, and views created later no longer get
--    it by default. Logged-in users are unaffected.
--
-- 2. Archived expenses stayed in the Payments queues. The VRF expenses that
--    322 archived (their VRFs are paid through the VRF payment step) still
--    sat in the to-pay queue (7), pending approval (2), awaiting bank
--    confirmation (1) and WHT receipts to prepare (5), so one could be paid,
--    or its WHT receipt issued, a second time. The six payment-queue views
--    now skip archived expenses; their definitions are otherwise unchanged.

SET search_path TO public;

-- ── 1. No view is readable before login ─────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
  END LOOP;
END $$;

-- Views and tables created later by the migration role start closed to anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ── 2. Archived expenses are not in any payment queue ───────────────────
CREATE OR REPLACE VIEW v_to_pay_queue AS
SELECT e.id,
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
  EXTRACT(day FROM now() - e.finance_approved_at) AS days_since_approval,
  e.sourcing_bundle_id,
  sb.payment_pattern,
  e.net_payable,
  e.wht_amount,
  COALESCE(e.credit_applied_etb, 0::numeric) AS credit_applied_etb,
  COALESCE(e.amount_etb, 0::numeric) - COALESCE(e.wht_amount, 0::numeric) - COALESCE(e.credit_applied_etb, 0::numeric) AS cash_to_send
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN categories c ON c.id = e.category_id
LEFT JOIN cost_groups cg ON cg.id = c.cost_group_id
LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
WHERE e.payment_state = 'approved_to_pay'
  AND NOT COALESCE(e.is_archived, false);

CREATE OR REPLACE VIEW v_finance_pending_approval
WITH (security_invoker = true) AS
SELECT e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.project_id,
  p.project_name,
  e.approval_status,
  e.manager_approved_by,
  e.manager_approved_at,
  e.created_at
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
WHERE e.payment_state = 'unpaid'
  AND e.approval_status = ANY (ARRAY['pending'::expense_approval_status, 'manager_approved'::expense_approval_status])
  AND NOT COALESCE(e.is_archived, false);

CREATE OR REPLACE VIEW v_awaiting_bank_confirmation AS
SELECT e.id,
  e.expense_code,
  e.item_service_description,
  e.vendor_id,
  v.vendor_name,
  e.amount_etb,
  e.net_payable,
  e.payment_method,
  e.account_id,
  a.account_name,
  e.payment_state_changed_at,
  EXTRACT(day FROM now() - e.payment_state_changed_at) AS days_waiting,
  bpe.batch_payment_id
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN accounts a ON a.id = e.account_id
LEFT JOIN batch_payment_expenses bpe ON bpe.expense_id = e.id
WHERE e.payment_state = 'sent'
  AND e.payment_method = ANY (ARRAY['transfer', 'cpo', 'cheque'])
  AND e.transfer_id IS NULL
  AND NOT COALESCE(e.is_archived, false);

CREATE OR REPLACE VIEW v_recent_payments AS
SELECT e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.payment_state,
  e.payment_method,
  e.disbursed_by,
  e.payment_state_changed_at,
  e.transfer_id,
  t.transfer_id_code,
  t.notes AS transfer_notes,
  bpe.batch_payment_id,
  e.vrf_id,
  vrf.record_name AS vrf_record_name,
  e.net_payable,
  e.wht_amount
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN transfers t ON t.id = e.transfer_id
LEFT JOIN vendor_receipt_facilitation vrf ON vrf.id = e.vrf_id
LEFT JOIN batch_payment_expenses bpe ON bpe.expense_id = e.id
WHERE e.payment_state = ANY (ARRAY['sent', 'paid'])
  AND e.payment_state_changed_at >= now() - '7 days'::interval
  AND NOT COALESCE(e.is_archived, false);

CREATE OR REPLACE VIEW v_open_vendor_advances
WITH (security_invoker = true) AS
SELECT e.id,
  e.expense_code,
  e.item_service_description,
  e.amount_etb,
  e.vendor_id,
  v.vendor_name,
  e.sourcing_bundle_id,
  sb.bundle_code,
  e.disbursed_by,
  e.payment_state_changed_at,
  EXTRACT(day FROM now() - e.payment_state_changed_at) AS days_open
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
WHERE e.payment_state = 'advance'
  AND NOT COALESCE(e.is_archived, false)
ORDER BY e.payment_state_changed_at;

CREATE OR REPLACE VIEW v_wht_receipts_to_prepare
WITH (security_invoker = true) AS
SELECT e.id AS expense_id,
  e.expense_code,
  e.date,
  e.paid_date,
  e.amount_etb,
  e.wht_amount,
  e.net_payable,
  e.vendor_id,
  v.vendor_name,
  v.tin AS vendor_tin,
  e.project_id,
  p.project_name,
  e.disbursed_by
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
WHERE e.payment_state = 'paid'
  AND COALESCE(e.wht_amount, 0::numeric) > 0::numeric
  AND e.wht_receipt_prepared = false
  AND NOT COALESCE(e.is_archived, false);

-- CREATE OR REPLACE keeps grants; restate that none of these is anon's.
REVOKE ALL ON v_to_pay_queue, v_finance_pending_approval, v_awaiting_bank_confirmation,
  v_recent_payments, v_open_vendor_advances, v_wht_receipts_to_prepare FROM anon;
