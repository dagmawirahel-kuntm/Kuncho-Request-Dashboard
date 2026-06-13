-- ═══════════════════════════════════════════════════════════════
-- KUNCH_10 → Supabase Migration
-- ═══════════════════════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'finance', 'staff');
CREATE TYPE staff_type_enum AS ENUM ('Full Time', 'Part Time', 'Contract', 'Freelance');
CREATE TYPE order_status_enum AS ENUM ('pending', 'approved', 'rejected', 'completed');

-- ── User Profiles (extends auth.users) ──────────────────────────
CREATE TABLE user_profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  role         user_role NOT NULL DEFAULT 'staff',
  department   TEXT,
  phone_number TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Staff ────────────────────────────────────────────────────────
CREATE TABLE staff (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_name      TEXT NOT NULL,
  staff_type         TEXT,
  role               TEXT,
  monthly_salary     NUMERIC(12,2),
  day_rate           NUMERIC(12,2),
  payment_frequency  TEXT,
  bank_account       TEXT,
  starting_date      DATE,
  termination_date   DATE,
  phone_number       TEXT,
  experience         TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── Projects ─────────────────────────────────────────────────────
CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_name    TEXT NOT NULL,
  department      TEXT,
  start_date      DATE,
  active_for_year BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Locations ────────────────────────────────────────────────────
CREATE TABLE locations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_name TEXT NOT NULL,
  location_type TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Vendors ──────────────────────────────────────────────────────
CREATE TABLE vendors (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_name  TEXT NOT NULL,
  vendor_type  TEXT,
  tin          TEXT,
  bank_account TEXT,
  phone_contact TEXT,
  category     TEXT,
  wth_eligible BOOLEAN DEFAULT FALSE,
  active       BOOLEAN DEFAULT TRUE,
  location     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Categories ───────────────────────────────────────────────────
CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_name TEXT NOT NULL,
  category_type TEXT,
  parent_type   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sub-Categories ────────────────────────────────────────────────
CREATE TABLE sub_categories (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_name          TEXT NOT NULL,
  parent_category_id UUID REFERENCES categories(id),
  description        TEXT,
  active             BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── Accounts ─────────────────────────────────────────────────────
CREATE TABLE accounts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_name   TEXT NOT NULL,
  type           TEXT,
  account_number TEXT,
  notes          TEXT,
  status         TEXT DEFAULT 'active',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Clients ──────────────────────────────────────────────────────
CREATE TABLE clients (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_name      TEXT NOT NULL,
  phone_number     TEXT,
  email            TEXT,
  additional_email TEXT,
  business_type    TEXT,
  address          TEXT,
  notes            TEXT,
  receipt_vouched  BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Products ─────────────────────────────────────────────────────
CREATE TABLE products (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_name TEXT NOT NULL,
  category     TEXT,
  unit_price   NUMERIC(12,2),
  active       BOOLEAN DEFAULT TRUE,
  description  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Expenses ─────────────────────────────────────────────────────
CREATE TABLE expenses (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_code              TEXT GENERATED ALWAYS AS (NULL) STORED,
  item_service_description  TEXT,
  amount_etb                NUMERIC(12,2),
  payment_status            BOOLEAN DEFAULT FALSE,
  requested                 BOOLEAN DEFAULT FALSE,
  partially_paid            BOOLEAN DEFAULT FALSE,
  bank_ref                  TEXT,
  purchase_type             TEXT,
  date                      DATE,
  quantity                  NUMERIC(10,2),
  uom                       TEXT,
  receipt_available         TEXT,
  expense_type              TEXT,
  notes                     TEXT,
  proposed_item_name        TEXT,
  project_name              TEXT,
  vendors_name              TEXT,
  vendors_bank_account      TEXT,
  delivery_status           TEXT[],
  delivery_notes            TEXT,
  contacted                 BOOLEAN DEFAULT FALSE,
  verify_wht                BOOLEAN DEFAULT FALSE,
  wht_handling_method       TEXT,
  wht_fund                  TEXT,
  is_new_item               BOOLEAN DEFAULT FALSE,
  description_of_item       TEXT,
  is_allocated              BOOLEAN DEFAULT FALSE,
  receipt_delivered         BOOLEAN DEFAULT FALSE,
  partial_paid_amount       NUMERIC(12,2),
  partial_payment_notes     TEXT,
  total_payment_date        DATE,
  partial_payment_date      DATE,
  completion_percentage     NUMERIC(5,2),
  paid_date                 TIMESTAMPTZ,
  vendors_location          TEXT,
  category_id               UUID REFERENCES categories(id),
  vendor_id                 UUID REFERENCES vendors(id),
  project_id                UUID REFERENCES projects(id),
  staff_id                  UUID REFERENCES staff(id),
  purchaser_user_id         UUID REFERENCES user_profiles(id),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Drop generated column and replace with simple nullable text
ALTER TABLE expenses DROP COLUMN expense_code;
ALTER TABLE expenses ADD COLUMN expense_code TEXT;

-- ── Orders ───────────────────────────────────────────────────────
CREATE TABLE orders (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_name               TEXT,
  order_date               DATE,
  item_service_description TEXT,
  quantity                 NUMERIC(10,2),
  status                   order_status_enum DEFAULT 'pending',
  notes                    TEXT,
  vendor_recommendation    TEXT,
  project_id               UUID REFERENCES projects(id),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ── Purchase Allocation ──────────────────────────────────────────
CREATE TABLE purchase_allocation (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  allocation_name      TEXT,
  parent_purchase_id   UUID REFERENCES expenses(id),
  sub_category_id      UUID REFERENCES sub_categories(id),
  quantity             NUMERIC(10,2),
  uom                  TEXT,
  unit_price_vat_status TEXT,
  unit_price           NUMERIC(12,2),
  project_id           UUID REFERENCES projects(id),
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Transportation Requests ──────────────────────────────────────
CREATE TABLE transportation_requests (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_name           TEXT,
  requested_date         DATE,
  payment_status         BOOLEAN DEFAULT FALSE,
  requested              BOOLEAN DEFAULT FALSE,
  amount                 NUMERIC(12,2),
  bank_ref               TEXT,
  delivery_status        TEXT,
  vehicle_type           TEXT,
  driver_name            TEXT,
  expected_delivery_date DATE,
  actual_delivery_date   DATE,
  pickup_location_text   TEXT,
  dropoff_location_text  TEXT,
  vendor_name            TEXT,
  vendor_bank_account    TEXT,
  notes                  TEXT,
  requested_by_id        UUID REFERENCES user_profiles(id),
  project_id             UUID REFERENCES projects(id),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── Transfers ────────────────────────────────────────────────────
CREATE TABLE transfers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id_code TEXT,
  date             DATE,
  from_account_id  UUID REFERENCES accounts(id),
  to_account_id    UUID REFERENCES accounts(id),
  amount           NUMERIC(12,2),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sales ────────────────────────────────────────────────────────
CREATE TABLE sales (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sales_description   TEXT NOT NULL,
  sales_status        TEXT,
  date                DATE,
  amount              NUMERIC(12,2),
  product_or_service  TEXT,
  payment_method      TEXT,
  notes               TEXT,
  client_id           UUID REFERENCES clients(id),
  project_id          UUID REFERENCES projects(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payroll ──────────────────────────────────────────────────────
CREATE TABLE payroll (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_record  TEXT,
  pay_period      TEXT,
  start_date      DATE,
  end_date        DATE,
  payroll_type    TEXT,
  payment_status  TEXT DEFAULT 'pending',
  payment_method  TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Emergency Payroll Summary ─────────────────────────────────────
CREATE TABLE emergency_payroll_summary (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_name     TEXT,
  payroll_month   TEXT,
  days_worked     NUMERIC(5,2),
  total_ot_days   NUMERIC(5,2),
  total_bonus     NUMERIC(12,2),
  advance_taken   NUMERIC(12,2),
  payment_status  TEXT DEFAULT 'pending',
  payment_date    DATE,
  notes           TEXT,
  staff_id        UUID REFERENCES staff(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Cash Advances ─────────────────────────────────────────────────
CREATE TABLE cash_advances (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advance_id_code  TEXT,
  amount_advanced  NUMERIC(12,2),
  date_given       DATE,
  notes            TEXT,
  staff_id         UUID REFERENCES staff(id),
  account_used_id  UUID REFERENCES accounts(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Vendor Receipt Facilitation ───────────────────────────────────
CREATE TABLE vendor_receipt_facilitation (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_name            TEXT,
  money_returned         NUMERIC(12,2),
  notes                  TEXT,
  net_facilitation_cost  NUMERIC(12,2),
  trxn_date              DATE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tax Summary ───────────────────────────────────────────────────
CREATE TABLE tax_summary (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  month                    TEXT NOT NULL,
  vat_from_expenses        NUMERIC(12,2),
  vat_from_sales           NUMERIC(12,2),
  wht_from_expenses        NUMERIC(12,2),
  wht_deducted_by_client   NUMERIC(12,2),
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ── CPO Bonds ─────────────────────────────────────────────────────
CREATE TABLE cpo_bonds (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bond_id_ref       TEXT,
  project           TEXT,
  total_bond_amount NUMERIC(12,2),
  bond_status       TEXT,
  notes             TEXT,
  vendor_id         UUID REFERENCES vendors(id),
  paid_from_id      UUID REFERENCES accounts(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payroll Taxes ─────────────────────────────────────────────────
CREATE TABLE payroll_taxes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_name   TEXT,
  payroll_month TEXT,
  gross_salary  NUMERIC(12,2),
  tax_amount    NUMERIC(12,2),
  taxable       TEXT,
  staff_id      UUID REFERENCES staff(id),
  payroll_id    UUID REFERENCES payroll(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Batch Payments ────────────────────────────────────────────────
CREATE TABLE batch_payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_code TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Timesheet ─────────────────────────────────────────────────────
CREATE TABLE timesheet (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code           TEXT,
  date           DATE,
  check_in_time  TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  notes          TEXT,
  staff_id       UUID REFERENCES staff(id),
  project_id     UUID REFERENCES projects(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════

-- Helper function to get the current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE transportation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_payroll_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_receipt_facilitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpo_bonds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "admin_all" ON user_profiles FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON staff FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON projects FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON vendors FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON categories FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON sub_categories FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON expenses FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON orders FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON purchase_allocation FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON transportation_requests FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON locations FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON accounts FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON transfers FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON sales FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON clients FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON products FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON payroll FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON emergency_payroll_summary FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON cash_advances FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON vendor_receipt_facilitation FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON tax_summary FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON cpo_bonds FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON payroll_taxes FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON batch_payments FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "admin_all" ON timesheet FOR ALL USING (get_user_role() = 'admin');

-- Managers: read all, write requests/projects/payroll
CREATE POLICY "manager_read" ON expenses FOR SELECT USING (get_user_role() IN ('manager', 'finance'));
CREATE POLICY "manager_write" ON expenses FOR INSERT WITH CHECK (get_user_role() = 'manager');
CREATE POLICY "manager_update" ON expenses FOR UPDATE USING (get_user_role() = 'manager');
CREATE POLICY "manager_read" ON orders FOR SELECT USING (get_user_role() IN ('manager', 'finance'));
CREATE POLICY "manager_write" ON orders FOR INSERT WITH CHECK (get_user_role() = 'manager');
CREATE POLICY "manager_read" ON transportation_requests FOR SELECT USING (get_user_role() IN ('manager', 'finance'));
CREATE POLICY "manager_write" ON transportation_requests FOR INSERT WITH CHECK (get_user_role() = 'manager');
CREATE POLICY "manager_read" ON projects FOR SELECT USING (get_user_role() IN ('manager', 'finance'));
CREATE POLICY "manager_write" ON projects FOR INSERT WITH CHECK (get_user_role() = 'manager');
CREATE POLICY "manager_read" ON vendors FOR SELECT USING (get_user_role() IN ('manager', 'finance'));
CREATE POLICY "manager_read" ON categories FOR SELECT USING (get_user_role() IN ('manager', 'finance'));
CREATE POLICY "manager_read" ON sub_categories FOR SELECT USING (get_user_role() IN ('manager', 'finance'));
CREATE POLICY "manager_read" ON staff FOR SELECT USING (get_user_role() IN ('manager', 'finance'));

-- Finance: read all, write accounts/transfers/tax/payroll/batch
CREATE POLICY "finance_read_accounts" ON accounts FOR SELECT USING (get_user_role() = 'finance');
CREATE POLICY "finance_write_accounts" ON accounts FOR ALL USING (get_user_role() = 'finance');
CREATE POLICY "finance_all_transfers" ON transfers FOR ALL USING (get_user_role() = 'finance');
CREATE POLICY "finance_all_tax" ON tax_summary FOR ALL USING (get_user_role() = 'finance');
CREATE POLICY "finance_all_payroll" ON payroll FOR ALL USING (get_user_role() = 'finance');
CREATE POLICY "finance_all_batch" ON batch_payments FOR ALL USING (get_user_role() = 'finance');
CREATE POLICY "finance_all_payroll_taxes" ON payroll_taxes FOR ALL USING (get_user_role() = 'finance');
CREATE POLICY "finance_read_sales" ON sales FOR SELECT USING (get_user_role() = 'finance');
CREATE POLICY "finance_read_clients" ON clients FOR SELECT USING (get_user_role() = 'finance');

-- Staff: read and write only their own records
CREATE POLICY "staff_own_expenses" ON expenses FOR ALL
  USING (get_user_role() = 'staff' AND purchaser_user_id = auth.uid())
  WITH CHECK (get_user_role() = 'staff' AND purchaser_user_id = auth.uid());

CREATE POLICY "staff_own_transport" ON transportation_requests FOR ALL
  USING (get_user_role() = 'staff' AND requested_by_id = auth.uid())
  WITH CHECK (get_user_role() = 'staff' AND requested_by_id = auth.uid());

CREATE POLICY "staff_own_timesheet" ON timesheet FOR ALL
  USING (get_user_role() = 'staff' AND staff_id IN (
    SELECT id FROM staff WHERE employee_name = (
      SELECT full_name FROM user_profiles WHERE id = auth.uid()
    )
  ));

CREATE POLICY "staff_own_profile" ON user_profiles FOR SELECT
  USING (id = auth.uid());

-- Everyone can read products, categories, sub_categories, locations
CREATE POLICY "all_read_products" ON products FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "all_read_categories" ON categories FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "all_read_sub_categories" ON sub_categories FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "all_read_locations" ON locations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "all_read_vendors" ON vendors FOR SELECT USING (auth.uid() IS NOT NULL);

-- ══════════════════════════════════════════════════════════════════
-- TRIGGERS (auto-update updated_at)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'staff','projects','vendors','categories','sub_categories',
    'expenses','orders','purchase_allocation','transportation_requests',
    'accounts','sales','clients','products','payroll',
    'emergency_payroll_summary','cash_advances','vendor_receipt_facilitation',
    'cpo_bonds','payroll_taxes','batch_payments','timesheet'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      t
    );
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════════════════════════
-- AUTO-CREATE PROFILE ON SIGN-UP
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'staff')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
