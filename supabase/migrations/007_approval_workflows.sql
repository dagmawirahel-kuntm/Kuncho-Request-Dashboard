-- ═══════════════════════════════════════════════════════════════
-- Approval workflows for orders, cash advances, and sales.
--
-- All three modules adopt the same 4-state hierarchy used by
-- expenses: pending → manager_approved → finance_approved → rejected
-- Triggers enforce valid transitions and stamp the approver audit
-- trail automatically; client code only needs to write approval_status.
-- ═══════════════════════════════════════════════════════════════

-- ── ORDERS ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE order_approval_status AS ENUM ('pending', 'manager_approved', 'finance_approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS approval_status order_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS manager_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finance_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS finance_approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_approval_status ON orders(approval_status);

CREATE OR REPLACE FUNCTION enforce_order_approval_transitions()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Only a Manager can approve or reject a pending order';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can give final approval or reject a manager-approved order';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;

    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_order_approval_transitions ON orders;
CREATE TRIGGER trg_enforce_order_approval_transitions
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION enforce_order_approval_transitions();

DROP POLICY IF EXISTS "manager_approve_orders" ON orders;
CREATE POLICY "manager_approve_orders" ON orders FOR UPDATE
  USING (get_user_role() = 'manager');

DROP POLICY IF EXISTS "finance_approve_orders" ON orders;
CREATE POLICY "finance_approve_orders" ON orders FOR UPDATE
  USING (get_user_role() = 'finance');

-- ── CASH ADVANCES ────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE cash_advance_approval_status AS ENUM ('pending', 'manager_approved', 'finance_approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE cash_advances
  ADD COLUMN IF NOT EXISTS approval_status cash_advance_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS manager_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finance_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS finance_approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cash_advances_approval_status ON cash_advances(approval_status);

CREATE OR REPLACE FUNCTION enforce_cash_advance_approval_transitions()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Only a Manager can approve or reject a pending cash advance';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can give final approval or reject a manager-approved cash advance';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;

    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_cash_advance_approval_transitions ON cash_advances;
CREATE TRIGGER trg_enforce_cash_advance_approval_transitions
  BEFORE UPDATE ON cash_advances
  FOR EACH ROW EXECUTE FUNCTION enforce_cash_advance_approval_transitions();

DROP POLICY IF EXISTS "manager_approve_cash_advances" ON cash_advances;
CREATE POLICY "manager_approve_cash_advances" ON cash_advances FOR UPDATE
  USING (get_user_role() = 'manager');

DROP POLICY IF EXISTS "finance_approve_cash_advances" ON cash_advances;
CREATE POLICY "finance_approve_cash_advances" ON cash_advances FOR UPDATE
  USING (get_user_role() = 'finance');

-- ── SALES ────────────────────────────────────────────────────────

-- Side-fix: convert sales_status from untyped TEXT to a typed enum
DO $$ BEGIN
  CREATE TYPE sale_lifecycle_status AS ENUM ('Draft', 'Invoiced', 'Paid', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'sales_status' AND data_type = 'text'
  ) THEN
    ALTER TABLE sales ALTER COLUMN sales_status TYPE sale_lifecycle_status
      USING CASE
        WHEN sales_status IN ('Draft', 'Invoiced', 'Paid', 'Cancelled') THEN sales_status::sale_lifecycle_status
        ELSE NULL
      END;
  END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE sale_approval_status AS ENUM ('pending', 'manager_approved', 'finance_approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS approval_status sale_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS manager_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finance_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS finance_approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sales_approval_status ON sales(approval_status);

CREATE OR REPLACE FUNCTION enforce_sale_approval_transitions()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Only a Manager can approve or reject a pending sale';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can give final approval or reject a manager-approved sale';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;

    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_sale_approval_transitions ON sales;
CREATE TRIGGER trg_enforce_sale_approval_transitions
  BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION enforce_sale_approval_transitions();

DROP POLICY IF EXISTS "manager_approve_sales" ON sales;
CREATE POLICY "manager_approve_sales" ON sales FOR UPDATE
  USING (get_user_role() = 'manager');

DROP POLICY IF EXISTS "finance_approve_sales" ON sales;
CREATE POLICY "finance_approve_sales" ON sales FOR UPDATE
  USING (get_user_role() = 'finance');
