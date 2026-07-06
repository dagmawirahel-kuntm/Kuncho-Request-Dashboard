-- Migration 058: VRF Manager badge + real VRF cash-flow tracking
--
-- "VRF Manager" is a sub-responsibility layered on top of the manager
-- role (not a new top-level role) — admin grants/revokes it per person
-- via a badge flag. Holders can manage VRF records fully and can mark
-- VRF-linked expenses as paid (normally a finance/admin-only action),
-- scoped specifically to expenses tied to a VRF record.
--
-- This also fixes a real gap found while designing that workflow:
-- v_account_balances never reflected VRF cash movement at all — a
-- vendor's refund landing back in an account was invisible, so a
-- "VRF pool" account would always show a misleading balance. The two
-- VRF legs (money out to the vendor, money back from the vendor) are
-- added as their own CTE; the smaller expenses later paid out of the
-- returned funds already flow through expenses_out normally and are
-- NOT double-counted here — they're a separate, later draw against
-- the same account balance the VRF return credited.

SET search_path TO public;

-- ── Badge column ──────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_vrf_manager BOOLEAN NOT NULL DEFAULT FALSE;

-- ── VRF RLS: badge-holding managers get the same access finance has ─
DROP POLICY IF EXISTS "vrf_manager_badge_all" ON vendor_receipt_facilitation;
CREATE POLICY "vrf_manager_badge_all" ON vendor_receipt_facilitation
  FOR ALL USING (
    get_user_role() = 'manager'
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true)
  );

-- ── Expense finance-lock: badge holders may set payment fields, but
-- only on expenses actually linked to a VRF record ──────────────────
CREATE OR REPLACE FUNCTION enforce_expense_finance_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_is_vrf_manager BOOLEAN;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    SELECT is_vrf_manager INTO v_is_vrf_manager FROM user_profiles WHERE id = auth.uid();

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
      IF NOT (v_is_vrf_manager AND OLD.vendor_receipt_facilitation_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Only Finance, Admin, or a VRF Manager (on VRF-linked expenses) can modify payment and finance-linked fields on an expense';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Real VRF cash flow in the balances view ──────────────────────
-- security_invoker must be re-specified — a plain DROP+CREATE resets
-- it, which would silently undo the RLS-bypass fix from migration 049.
DROP VIEW IF EXISTS public.v_account_balances;
CREATE VIEW public.v_account_balances
WITH (security_invoker = true) AS
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
  vrf_out AS (
    SELECT initial_account_id AS account_id, COALESCE(SUM(amount_transferred), 0) AS total
    FROM public.vendor_receipt_facilitation
    WHERE initial_account_id IS NOT NULL
    GROUP BY initial_account_id
  ),
  vrf_in AS (
    SELECT return_account_id AS account_id, COALESCE(SUM(money_returned), 0) AS total
    FROM public.vendor_receipt_facilitation
    WHERE return_account_id IS NOT NULL
    GROUP BY return_account_id
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
  COALESCE(si.total, 0) + COALESCE(ti.total, 0) + COALESCE(vi.total, 0)
    - COALESCE(eo.total, 0)
    - COALESCE(ao.total, 0)
    - COALESCE(po.total, 0)
    - COALESCE(vo.total, 0)
    - COALESCE(to2.total, 0)  AS balance,
  COALESCE(si.total,  0)      AS total_sales_in,
  COALESCE(ti.total,  0)      AS total_transfers_in,
  COALESCE(vi.total,  0)      AS total_vrf_returned_in,
  COALESCE(eo.total,  0)      AS total_expenses_out,
  COALESCE(ao.total,  0)      AS total_advances_out,
  COALESCE(po.total,  0)      AS total_payroll_out,
  COALESCE(vo.total,  0)      AS total_vrf_transferred_out,
  COALESCE(to2.total, 0)      AS total_transfers_out
FROM public.accounts a
LEFT JOIN sales_in      si   ON si.account_id  = a.id
LEFT JOIN expenses_out  eo   ON eo.account_id  = a.id
LEFT JOIN advances_out  ao   ON ao.account_id  = a.id
LEFT JOIN payroll_out   po   ON po.account_id  = a.id
LEFT JOIN vrf_out       vo   ON vo.account_id  = a.id
LEFT JOIN vrf_in        vi   ON vi.account_id  = a.id
LEFT JOIN transfers_in  ti   ON ti.account_id  = a.id
LEFT JOIN transfers_out to2  ON to2.account_id = a.id;

GRANT SELECT ON public.v_account_balances TO authenticated;
