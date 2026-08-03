-- 170 — Six requests: government expense view, all-receipts collection queue,
-- timesheet for both labor tiers, tax outstanding status, payroll reconciliation.
-- (Job duration + actual completion time, the sixth, is a frontend-only change
-- on transportation_requests columns that already exist.)

SET search_path TO public;

-- ── #7. Government-purpose expense statement ─────────────────────────
-- In the app's books an Asset-nature category (e.g. Steel) sits on the balance
-- sheet and only hits P&L when consumed. Government/tax statements don't follow
-- that — consumable inventories are an expense at the point of purchase. This
-- view reclassifies accordingly: every Expense-nature category plus every
-- Asset-nature category flagged as Inventory counts as expense on purchase date.
CREATE OR REPLACE VIEW v_government_expense_statement
WITH (security_invoker = true) AS
SELECT
  date_trunc('month', e.date)::date AS period_month,
  c.category_name,
  c.nature,
  c.asset_class,
  CASE
    WHEN c.nature = 'Expense' THEN 'operating_expense'
    ELSE 'consumable_inventory'
  END AS gov_treatment,
  COUNT(*)          AS line_count,
  SUM(e.amount_etb) AS amount
FROM expenses e
JOIN categories c ON c.id = e.category_id
WHERE e.payment_status = true
  AND e.date >= financials_cutover_date()
  AND (c.nature = 'Expense' OR (c.nature = 'Asset' AND c.asset_class = 'Inventory'))
GROUP BY 1, 2, 3, 4, 5;
GRANT SELECT ON v_government_expense_statement TO authenticated;

-- ── #9. Receipt collection queue: everything uncollected ─────────────
-- Was gated on the receipt already being photographed. The queue is now every
-- receipt the tax officer hasn't marked collected, photo or not (has_photo says
-- which). The tax officer can confirm collection too — it's their custody.
CREATE OR REPLACE VIEW v_receipt_pickup_queue AS
 SELECT 'vendor'::text AS kind, vr.id, vr.receipt_no, vr.receipt_date, vr.vat_amount,
    v.vendor_name AS counterparty, v.location AS pickup_hint, vr.entered_at AS captured_at,
    vr.status AS workflow_status, (vr.document_url IS NOT NULL) AS has_photo
   FROM vendor_receipts vr
     LEFT JOIN vendors v ON v.id = vr.vendor_id
  WHERE vr.physical_received_at IS NULL AND vr.status <> 'rejected'::text
UNION ALL
 SELECT 'client'::text AS kind, ca.id, ca.receipt_no, ca.receipt_date, ca.vat_amount,
    c.client_name AS counterparty, c.address AS pickup_hint, ca.created_at AS captured_at,
    COALESCE(ca.tax_status, 'pending_review'::text) AS workflow_status, (ca.file_path IS NOT NULL) AS has_photo
   FROM client_attachments ca
     LEFT JOIN clients c ON c.id = ca.client_id
  WHERE (ca.category = ANY (ARRAY['receipt'::text, 'wht_receipt'::text])) AND ca.physical_received_at IS NULL;
GRANT SELECT ON v_receipt_pickup_queue TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_receipt_pickup(p_kind text, p_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_is_tax_officer boolean;
BEGIN
  SELECT COALESCE(is_tax_officer, false) INTO v_is_tax_officer FROM user_profiles WHERE id = auth.uid();
  IF get_user_role() NOT IN ('admin', 'finance', 'logistics_officer', 'operations_manager')
     AND NOT COALESCE(v_is_tax_officer, false) THEN
    RAISE EXCEPTION 'Only the tax officer, pickup driver, finance, or admin can confirm a receipt collection';
  END IF;
  IF p_kind = 'vendor' THEN
    UPDATE vendor_receipts SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
    WHERE id = p_id AND physical_received_at IS NULL;
  ELSIF p_kind = 'client' THEN
    UPDATE client_attachments SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
    WHERE id = p_id AND physical_received_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Unknown receipt kind: %', p_kind;
  END IF;
END;
$function$;

-- ── #10. Timesheet for both labor tiers ──────────────────────────────
-- Tier 1 = routine allocated staff (labor_allocations); Tier 2 = casual/new
-- requisitioned labor (labor_requisitions), often with no staff record. Add the
-- links, a casual worker name, and a day-rate so a worked day carries a cost.
ALTER TABLE timesheet
  ADD COLUMN IF NOT EXISTS labor_tier           smallint,
  ADD COLUMN IF NOT EXISTS labor_allocation_id  uuid REFERENCES labor_allocations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS labor_requisition_id uuid REFERENCES labor_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS casual_worker_name   text,
  ADD COLUMN IF NOT EXISTS day_rate             numeric(14,2),
  ADD COLUMN IF NOT EXISTS days_worked          numeric(6,2) DEFAULT 1;
COMMENT ON COLUMN timesheet.labor_tier IS '1 = routine allocated staff (labor_allocations); 2 = casual/new requisitioned labor (labor_requisitions). NULL = legacy/plain entry.';

CREATE OR REPLACE VIEW v_timesheet_cost
WITH (security_invoker = true) AS
SELECT t.id, t.date, t.project_id, t.staff_id, t.labor_tier, t.casual_worker_name,
  COALESCE(t.days_worked, 1) AS days_worked,
  COALESCE(t.day_rate, la.day_rate_snapshot, lr.estimated_day_rate) AS effective_day_rate,
  ROUND(COALESCE(t.days_worked, 1) * COALESCE(t.day_rate, la.day_rate_snapshot, lr.estimated_day_rate, 0), 2) AS labor_cost
FROM timesheet t
LEFT JOIN labor_allocations la  ON la.id = t.labor_allocation_id
LEFT JOIN labor_requisitions lr ON lr.id = t.labor_requisition_id
WHERE COALESCE(t.is_archived, false) = false;
GRANT SELECT ON v_timesheet_cost TO authenticated;

CREATE OR REPLACE VIEW v_project_labor_cost
WITH (security_invoker = true) AS
SELECT project_id,
  COUNT(*) AS entries, SUM(days_worked) AS total_days, SUM(labor_cost) AS total_labor_cost,
  SUM(labor_cost) FILTER (WHERE labor_tier = 1) AS tier1_cost,
  SUM(labor_cost) FILTER (WHERE labor_tier = 2) AS tier2_cost
FROM v_timesheet_cost
WHERE project_id IS NOT NULL
GROUP BY project_id;
GRANT SELECT ON v_project_labor_cost TO authenticated;

-- ── #11. Outstanding tax status ──────────────────────────────────────
-- Every month from the platform cutover to now, per active obligation type, is
-- filed / outstanding / overdue / current. Replaces the manual monthly grid as
-- the Tax Summary page's main content.
CREATE OR REPLACE VIEW v_tax_outstanding_status
WITH (security_invoker = true) AS
WITH months AS (
  SELECT generate_series(
    date_trunc('month', financials_cutover_date())::date,
    date_trunc('month', CURRENT_DATE)::date,
    interval '1 month')::date AS period_month
)
SELECT ot.id AS obligation_type_id, ot.tax_type, ot.name, m.period_month,
  (te.id IS NOT NULL) AS filed, te.filed_date, te.reference_number,
  CASE WHEN ot.due_day_of_month IS NOT NULL
    THEN (m.period_month + interval '1 month')::date + (ot.due_day_of_month - 1) END AS due_date,
  CASE
    WHEN te.id IS NOT NULL THEN 'filed'
    WHEN ot.due_day_of_month IS NOT NULL
      AND CURRENT_DATE > (m.period_month + interval '1 month')::date + (ot.due_day_of_month - 1) THEN 'overdue'
    WHEN m.period_month < date_trunc('month', CURRENT_DATE)::date THEN 'outstanding'
    ELSE 'current'
  END AS status
FROM tax_obligation_types ot
CROSS JOIN months m
LEFT JOIN tax_engagements te ON te.obligation_type_id = ot.id AND te.period_month = m.period_month
WHERE ot.active;
GRANT SELECT ON v_tax_outstanding_status TO authenticated;

-- ── #12. Reconcile payments that don't go through the payments page ──
-- Payroll disbursements leave the bank but had no bank-line match target, so
-- their statement lines stayed unmatched forever. Add a payroll match target,
-- an RPC mirroring the expense/transfer match, and a view of what's still open.
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS matched_payroll_id uuid REFERENCES payroll(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.match_line_to_payroll(p_line_id uuid, p_payroll_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile a bank line';
  END IF;
  UPDATE bank_statement_lines SET matched_payroll_id = p_payroll_id, match_status = 'manual' WHERE id = p_line_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.match_line_to_payroll(uuid, uuid) TO authenticated;

CREATE OR REPLACE VIEW v_unreconciled_payroll
WITH (security_invoker = true) AS
SELECT p.id AS payroll_id, p.payroll_record, p.end_date, p.account_id, a.account_name,
  COALESCE(SUM(ps.net_amount), 0) AS net_amount
FROM payroll p
LEFT JOIN payroll_staff ps ON ps.payroll_id = p.id
LEFT JOIN accounts a ON a.id = p.account_id
WHERE p.payment_status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM bank_statement_lines bl WHERE bl.matched_payroll_id = p.id)
GROUP BY p.id, p.payroll_record, p.end_date, p.account_id, a.account_name;
GRANT SELECT ON v_unreconciled_payroll TO authenticated;
