-- ═══════════════════════════════════════════════════════════════
-- Relational enrichment (from KUNCH_11 Airtable base)
-- Adds missing foreign keys and many-to-many junction tables
-- discovered by diffing the Airtable base's multipleRecordLinks
-- fields against the existing schema.
-- ═══════════════════════════════════════════════════════════════

-- ── Projects ─────────────────────────────────────────────────────
ALTER TABLE projects ADD COLUMN project_manager_id UUID REFERENCES staff(id);
ALTER TABLE projects ADD COLUMN location_id UUID REFERENCES locations(id);

-- ── Orders ───────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN staff_id UUID REFERENCES staff(id);
ALTER TABLE orders ADD COLUMN category_id UUID REFERENCES categories(id);
ALTER TABLE orders ADD COLUMN recommended_vendor_id UUID REFERENCES vendors(id);

-- ── Expenses ─────────────────────────────────────────────────────
ALTER TABLE expenses ADD COLUMN sub_category_id UUID REFERENCES sub_categories(id);
ALTER TABLE expenses ADD COLUMN account_id UUID REFERENCES accounts(id);
ALTER TABLE expenses ADD COLUMN vendor_receipt_facilitation_id UUID REFERENCES vendor_receipt_facilitation(id);
ALTER TABLE expenses ADD COLUMN transfer_id UUID REFERENCES transfers(id);
ALTER TABLE expenses ADD COLUMN tax_summary_id UUID REFERENCES tax_summary(id);
ALTER TABLE expenses ADD COLUMN location_id UUID REFERENCES locations(id);

-- ── Transportation Requests ──────────────────────────────────────
ALTER TABLE transportation_requests ADD COLUMN expense_id UUID REFERENCES expenses(id);
ALTER TABLE transportation_requests ADD COLUMN pickup_location_id UUID REFERENCES locations(id);
ALTER TABLE transportation_requests ADD COLUMN dropoff_location_id UUID REFERENCES locations(id);
ALTER TABLE transportation_requests ADD COLUMN vendor_id UUID REFERENCES vendors(id);

-- ── Sales ────────────────────────────────────────────────────────
ALTER TABLE sales ADD COLUMN account_id UUID REFERENCES accounts(id);
ALTER TABLE sales ADD COLUMN tax_summary_id UUID REFERENCES tax_summary(id);

-- ── Payroll ──────────────────────────────────────────────────────
ALTER TABLE payroll ADD COLUMN account_id UUID REFERENCES accounts(id);

-- ── Cash Advances ────────────────────────────────────────────────
ALTER TABLE cash_advances ADD COLUMN payroll_id UUID REFERENCES payroll(id);

-- ── Emergency Payroll Summary ────────────────────────────────────
ALTER TABLE emergency_payroll_summary ADD COLUMN payroll_id UUID REFERENCES payroll(id);

-- ── Timesheet ────────────────────────────────────────────────────
ALTER TABLE timesheet ADD COLUMN payroll_id UUID REFERENCES payroll(id);

-- ── Vendor Receipt Facilitation ──────────────────────────────────
ALTER TABLE vendor_receipt_facilitation ADD COLUMN initial_account_id UUID REFERENCES accounts(id);
ALTER TABLE vendor_receipt_facilitation ADD COLUMN return_account_id UUID REFERENCES accounts(id);

-- ── CPO Bonds ────────────────────────────────────────────────────
ALTER TABLE cpo_bonds ADD COLUMN related_expense_id UUID REFERENCES expenses(id);

-- ── Batch Payments ───────────────────────────────────────────────
ALTER TABLE batch_payments ADD COLUMN assignee_id UUID REFERENCES user_profiles(id);

-- ══════════════════════════════════════════════════════════════════
-- JUNCTION TABLES (many-to-many)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE order_expenses (
  order_id   UUID REFERENCES orders(id) ON DELETE CASCADE,
  expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
  PRIMARY KEY (order_id, expense_id)
);

CREATE TABLE batch_payment_expenses (
  batch_payment_id UUID REFERENCES batch_payments(id) ON DELETE CASCADE,
  expense_id       UUID REFERENCES expenses(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_payment_id, expense_id)
);

CREATE TABLE payroll_staff (
  payroll_id UUID REFERENCES payroll(id) ON DELETE CASCADE,
  staff_id   UUID REFERENCES staff(id) ON DELETE CASCADE,
  PRIMARY KEY (payroll_id, staff_id)
);

CREATE TABLE cash_advance_expenses (
  cash_advance_id UUID REFERENCES cash_advances(id) ON DELETE CASCADE,
  expense_id      UUID REFERENCES expenses(id) ON DELETE CASCADE,
  PRIMARY KEY (cash_advance_id, expense_id)
);

-- ══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY for junction tables
-- (mirrors the access pattern of each junction's domain owner)
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE order_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_payment_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_advance_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON order_expenses FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON batch_payment_expenses FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON payroll_staff FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON cash_advance_expenses FOR ALL USING (get_user_role() = 'admin');

-- Orders domain: manager writes/reads, finance reads, procurement_officer manages
CREATE POLICY "manager_all" ON order_expenses FOR ALL USING (get_user_role() IN ('manager', 'procurement_officer'));
CREATE POLICY "finance_read" ON order_expenses FOR SELECT USING (get_user_role() = 'finance');

-- Batch payments domain: finance
CREATE POLICY "finance_all" ON batch_payment_expenses FOR ALL USING (get_user_role() = 'finance');

-- Payroll domain: hr_officer + finance
CREATE POLICY "hr_officer_all" ON payroll_staff FOR ALL USING (get_user_role() = 'hr_officer');
CREATE POLICY "finance_all" ON payroll_staff FOR ALL USING (get_user_role() = 'finance');

-- Cash advances domain: hr_officer + finance read
CREATE POLICY "hr_officer_all" ON cash_advance_expenses FOR ALL USING (get_user_role() = 'hr_officer');
CREATE POLICY "finance_read" ON cash_advance_expenses FOR SELECT USING (get_user_role() = 'finance');
