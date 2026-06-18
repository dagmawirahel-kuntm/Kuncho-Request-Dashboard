-- ═══════════════════════════════════════════════════════════════
-- Expense workflow: approval hierarchy, finance-only field locks,
-- and a descriptive auto-generated request code.
--
-- Hierarchy: a request starts 'pending'. A Manager (or Admin)
-- approves/rejects it. If the amount exceeds the large-expense
-- threshold, it also needs Finance's sign-off before it's ready
-- for payment; below the threshold, Manager approval is enough
-- and Finance can proceed straight to processing payment.
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE expense_approval_status AS ENUM ('pending', 'manager_approved', 'finance_approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS approval_status expense_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS manager_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finance_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS finance_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requires_finance_approval BOOLEAN GENERATED ALWAYS AS (COALESCE(amount_etb, 0) > 50000) STORED;

CREATE INDEX IF NOT EXISTS idx_expenses_approval_status ON expenses(approval_status);

-- ── Descriptive request code: PROJECT-LEDGER-YYYYMMDD-## ────────
-- Falls back to GEN/MISC when project/ledger aren't set yet, so
-- every expense still gets a unique, sortable, human-readable code.
CREATE OR REPLACE FUNCTION generate_expense_code()
RETURNS TRIGGER AS $$
DECLARE
  v_project_tag TEXT;
  v_ledger_tag  TEXT;
  v_date_tag    TEXT;
  v_prefix      TEXT;
  v_seq         INT;
BEGIN
  SELECT UPPER(LEFT(REGEXP_REPLACE(project_name, '[^A-Za-z0-9]', '', 'g'), 4))
    INTO v_project_tag FROM projects WHERE id = NEW.project_id;
  SELECT UPPER(LEFT(REGEXP_REPLACE(category_name, '[^A-Za-z0-9]', '', 'g'), 4))
    INTO v_ledger_tag FROM categories WHERE id = NEW.category_id;

  v_project_tag := COALESCE(NULLIF(v_project_tag, ''), 'GEN');
  v_ledger_tag  := COALESCE(NULLIF(v_ledger_tag, ''), 'MISC');
  v_date_tag    := TO_CHAR(COALESCE(NEW.date, CURRENT_DATE), 'YYYYMMDD');
  v_prefix      := v_project_tag || '-' || v_ledger_tag || '-' || v_date_tag;

  SELECT COUNT(*) + 1 INTO v_seq
  FROM expenses
  WHERE expense_code LIKE v_prefix || '-%'
    AND id IS DISTINCT FROM NEW.id;

  NEW.expense_code := v_prefix || '-' || LPAD(v_seq::TEXT, 2, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_expense_code ON expenses;
CREATE TRIGGER trg_generate_expense_code
  BEFORE INSERT OR UPDATE OF project_id, category_id, date ON expenses
  FOR EACH ROW EXECUTE FUNCTION generate_expense_code();

-- Backfill codes for existing rows (fires the column-list trigger
-- above on every row even though the values themselves don't change).
UPDATE expenses SET date = date;

-- ── Lock payment / finance-linked fields to Finance & Admin ─────
CREATE OR REPLACE FUNCTION enforce_expense_finance_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    IF NEW.payment_status        IS DISTINCT FROM OLD.payment_status
    OR NEW.paid_date             IS DISTINCT FROM OLD.paid_date
    OR NEW.bank_ref              IS DISTINCT FROM OLD.bank_ref
    OR NEW.partially_paid        IS DISTINCT FROM OLD.partially_paid
    OR NEW.partial_paid_amount   IS DISTINCT FROM OLD.partial_paid_amount
    OR NEW.partial_payment_date  IS DISTINCT FROM OLD.partial_payment_date
    OR NEW.partial_payment_notes IS DISTINCT FROM OLD.partial_payment_notes
    OR NEW.total_payment_date    IS DISTINCT FROM OLD.total_payment_date
    OR NEW.account_id            IS DISTINCT FROM OLD.account_id
    OR NEW.transfer_id           IS DISTINCT FROM OLD.transfer_id
    OR NEW.tax_summary_id        IS DISTINCT FROM OLD.tax_summary_id
    OR NEW.verify_wht            IS DISTINCT FROM OLD.verify_wht
    OR NEW.wht_handling_method   IS DISTINCT FROM OLD.wht_handling_method
    OR NEW.wht_fund              IS DISTINCT FROM OLD.wht_fund
    THEN
      RAISE EXCEPTION 'Only Finance or Admin can modify payment and finance-linked fields on an expense';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_expense_finance_fields ON expenses;
CREATE TRIGGER trg_enforce_expense_finance_fields
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION enforce_expense_finance_fields();

-- ── Guard approval-status transitions ────────────────────────────
CREATE OR REPLACE FUNCTION enforce_expense_approval_transitions()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Only a Manager can approve or reject a pending expense';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can give final approval or reject a manager-approved expense';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      -- Resubmission after a rejection clears the prior approval trail.
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

DROP TRIGGER IF EXISTS trg_enforce_expense_approval_transitions ON expenses;
CREATE TRIGGER trg_enforce_expense_approval_transitions
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION enforce_expense_approval_transitions();

-- ── RLS gaps: Procurement Officer creates requests, Finance pays ─
DROP POLICY IF EXISTS "procurement_select_expenses" ON expenses;
CREATE POLICY "procurement_select_expenses" ON expenses FOR SELECT
  USING (get_user_role() = 'procurement_officer');
DROP POLICY IF EXISTS "procurement_insert_expenses" ON expenses;
CREATE POLICY "procurement_insert_expenses" ON expenses FOR INSERT
  WITH CHECK (get_user_role() = 'procurement_officer');
DROP POLICY IF EXISTS "procurement_update_own_expenses" ON expenses;
CREATE POLICY "procurement_update_own_expenses" ON expenses FOR UPDATE
  USING (get_user_role() = 'procurement_officer' AND purchaser_user_id = auth.uid());

DROP POLICY IF EXISTS "finance_update_expenses" ON expenses;
CREATE POLICY "finance_update_expenses" ON expenses FOR UPDATE
  USING (get_user_role() = 'finance');
