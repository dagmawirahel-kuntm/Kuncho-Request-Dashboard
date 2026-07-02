-- ═══════════════════════════════════════════════════════════════
-- Migration 046: Give payroll runs real money, governance, and
-- financial effect.
--
-- Before this migration a payroll run recorded WHO was paid and WHEN,
-- but not HOW MUCH; payment_status was free text anyone could set; and
-- marking a run paid never touched an account balance. This brings
-- payroll up to the standard cash advances already follow:
--   1. payroll_staff carries per-employee gross/deductions/net
--   2. payroll gets the pending → manager_approved → finance_approved
--      approval chain (trigger-enforced, audit-stamped)
--   3. payment_status is constrained, and 'paid' requires finance
--      approval first (finance/admin only)
--   4. paid runs debit their account in v_account_balances
--   5. runs get auto codes (PR-YYYY-NNN); paid runs cannot be deleted
-- ═══════════════════════════════════════════════════════════════

SET search_path TO public;

-- ── 1. Per-employee amounts on payroll_staff ─────────────────────
ALTER TABLE payroll_staff
  ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS deductions   NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount   NUMERIC(12,2);

-- Run totals, aggregated in the database
CREATE OR REPLACE VIEW public.v_payroll_run_totals
WITH (security_invoker = true) AS
SELECT
  payroll_id,
  COUNT(*)                          AS staff_count,
  COALESCE(SUM(gross_amount), 0)    AS total_gross,
  COALESCE(SUM(deductions), 0)      AS total_deductions,
  COALESCE(SUM(net_amount), 0)      AS total_net
FROM public.payroll_staff
GROUP BY payroll_id;

GRANT SELECT ON public.v_payroll_run_totals TO authenticated;

-- ── 2. Constrain payment_status (was free text) ──────────────────
UPDATE payroll SET payment_status = lower(payment_status)
  WHERE payment_status IS NOT NULL AND payment_status <> lower(payment_status);
UPDATE payroll SET payment_status = 'pending'
  WHERE payment_status IS NULL OR payment_status NOT IN ('pending', 'processing', 'paid');
ALTER TABLE payroll ALTER COLUMN payment_status SET DEFAULT 'pending';
ALTER TABLE payroll ALTER COLUMN payment_status SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE payroll ADD CONSTRAINT payroll_payment_status_check
    CHECK (payment_status IN ('pending', 'processing', 'paid'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE emergency_payroll_summary SET payment_status = lower(payment_status)
  WHERE payment_status IS NOT NULL AND payment_status <> lower(payment_status);
UPDATE emergency_payroll_summary SET payment_status = 'pending'
  WHERE payment_status IS NULL OR payment_status NOT IN ('pending', 'processing', 'paid');
ALTER TABLE emergency_payroll_summary ALTER COLUMN payment_status SET DEFAULT 'pending';
ALTER TABLE emergency_payroll_summary ALTER COLUMN payment_status SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE emergency_payroll_summary ADD CONSTRAINT eps_payment_status_check
    CHECK (payment_status IN ('pending', 'processing', 'paid'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. Approval workflow on payroll (mirrors 007 pattern) ────────
DO $$ BEGIN
  CREATE TYPE payroll_approval_status AS ENUM ('pending', 'manager_approved', 'finance_approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS approval_status payroll_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS manager_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finance_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS finance_approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payroll_approval_status ON payroll(approval_status);

-- Existing paid runs predate the workflow: grandfather them in as
-- finance_approved so the paid-requires-approval rule doesn't lock them.
UPDATE payroll SET approval_status = 'finance_approved'
  WHERE payment_status = 'paid' AND approval_status = 'pending';

CREATE OR REPLACE FUNCTION public.enforce_payroll_approval_transitions()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF OLD.approval_status = 'pending' AND NEW.approval_status IN ('manager_approved', 'rejected') THEN
      IF v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Only a Manager can approve or reject a pending payroll run';
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can give final approval or reject a manager-approved payroll run';
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

  -- Marking a run paid requires finance approval, by finance/admin only
  IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    IF NEW.approval_status <> 'finance_approved' THEN
      RAISE EXCEPTION 'A payroll run must be finance-approved before it can be marked paid';
    END IF;
    IF v_role NOT IN ('finance', 'admin') THEN
      RAISE EXCEPTION 'Only Finance can mark a payroll run as paid';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_payroll_approval_transitions ON payroll;
CREATE TRIGGER trg_enforce_payroll_approval_transitions
  BEFORE UPDATE ON payroll
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_approval_transitions();

DROP POLICY IF EXISTS "manager_approve_payroll" ON payroll;
CREATE POLICY "manager_approve_payroll" ON payroll FOR UPDATE
  USING (get_user_role() = 'manager');

-- ── 4. Paid payroll debits its account in the balances view ──────
CREATE OR REPLACE VIEW public.v_account_balances AS
WITH
  sales_in AS (
    SELECT account_id, COALESCE(SUM(amount), 0) AS total
    FROM public.sales
    WHERE account_id IS NOT NULL AND sales_status = 'Paid'
    GROUP BY account_id
  ),
  expenses_out AS (
    SELECT account_id, COALESCE(SUM(amount_etb), 0) AS total
    FROM public.expenses
    WHERE account_id IS NOT NULL AND payment_status = true
    GROUP BY account_id
  ),
  advances_out AS (
    SELECT account_used_id AS account_id, COALESCE(SUM(amount_advanced), 0) AS total
    FROM public.cash_advances
    WHERE account_used_id IS NOT NULL AND approval_status = 'finance_approved'
    GROUP BY account_used_id
  ),
  payroll_out AS (
    SELECT p.account_id, COALESCE(SUM(ps.net_amount), 0) AS total
    FROM public.payroll p
    JOIN public.payroll_staff ps ON ps.payroll_id = p.id
    WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid'
    GROUP BY p.account_id
  ),
  transfers_in AS (
    SELECT to_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
    FROM public.transfers
    WHERE to_account_id IS NOT NULL
    GROUP BY to_account_id
  ),
  transfers_out AS (
    SELECT from_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
    FROM public.transfers
    WHERE from_account_id IS NOT NULL
    GROUP BY from_account_id
  )
SELECT
  a.id,
  a.account_name,
  a.type,
  a.status,
  COALESCE(si.total, 0) + COALESCE(ti.total, 0)
    - COALESCE(eo.total, 0)
    - COALESCE(ao.total, 0)
    - COALESCE(po.total, 0)
    - COALESCE(to2.total, 0)  AS balance,
  COALESCE(si.total,  0)      AS total_sales_in,
  COALESCE(ti.total,  0)      AS total_transfers_in,
  COALESCE(eo.total,  0)      AS total_expenses_out,
  COALESCE(ao.total,  0)      AS total_advances_out,
  COALESCE(po.total,  0)      AS total_payroll_out,
  COALESCE(to2.total, 0)      AS total_transfers_out
FROM public.accounts a
LEFT JOIN sales_in      si   ON si.account_id  = a.id
LEFT JOIN expenses_out  eo   ON eo.account_id  = a.id
LEFT JOIN advances_out  ao   ON ao.account_id  = a.id
LEFT JOIN payroll_out   po   ON po.account_id  = a.id
LEFT JOIN transfers_in  ti   ON ti.account_id  = a.id
LEFT JOIN transfers_out to2  ON to2.account_id = a.id;

GRANT SELECT ON public.v_account_balances TO authenticated;

-- ── 5. Auto run codes (PR-YYYY-NNN) + backfill ───────────────────
CREATE OR REPLACE FUNCTION public.generate_payroll_record()
RETURNS TRIGGER AS $$
DECLARE
  v_year TEXT;
  v_next INT;
BEGIN
  IF NEW.payroll_record IS NULL OR NEW.payroll_record = '' THEN
    v_year := to_char(COALESCE(NEW.start_date, CURRENT_DATE), 'YYYY');
    SELECT COALESCE(MAX(SUBSTRING(payroll_record FROM 'PR-\d{4}-(\d+)')::int), 0) + 1
      INTO v_next
      FROM payroll
      WHERE payroll_record LIKE 'PR-' || v_year || '-%';
    NEW.payroll_record := 'PR-' || v_year || '-' || LPAD(v_next::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_generate_payroll_record ON payroll;
CREATE TRIGGER trg_generate_payroll_record
  BEFORE INSERT ON payroll
  FOR EACH ROW EXECUTE FUNCTION public.generate_payroll_record();

-- Backfill codes for existing runs, ordered by creation
WITH numbered AS (
  SELECT id,
    'PR-' || to_char(COALESCE(start_date, created_at::date), 'YYYY') || '-' ||
    LPAD(ROW_NUMBER() OVER (
      PARTITION BY to_char(COALESCE(start_date, created_at::date), 'YYYY')
      ORDER BY created_at
    )::text, 3, '0') AS code
  FROM payroll
  WHERE payroll_record IS NULL OR payroll_record = ''
)
UPDATE payroll p SET payroll_record = n.code
FROM numbered n WHERE p.id = n.id;

-- ── 6. Paid runs cannot be deleted ───────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_paid_payroll_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.payment_status = 'paid' THEN
    RAISE EXCEPTION 'Cannot delete a paid payroll run. Set it back from paid first (Finance/Admin).';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_paid_payroll_delete ON payroll;
CREATE TRIGGER trg_prevent_paid_payroll_delete
  BEFORE DELETE ON payroll
  FOR EACH ROW EXECUTE FUNCTION public.prevent_paid_payroll_delete();
