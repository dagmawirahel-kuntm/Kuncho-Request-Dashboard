-- ============================================================
-- Advance payment as a first-class state — the sequencing fix.
--
-- Confirmed decision, load-bearing: advance payment is COMMON, not an
-- edge case. Vendors frequently demand payment (or a CPO) before
-- releasing goods. A GRN-before-payment rule that ignored this would
-- block the majority of real purchases, so the rule built here is
-- conditional on the purchase's own declared payment pattern, not an
-- absolute block:
--
--   Pattern A — pay_on_delivery (goods first): GRN required before
--   the expense can reach 'paid'. This is the discipline that already
--   existed in spirit; here it's made explicit and conditional.
--
--   Pattern B — pay_in_advance (payment first): the money can leave
--   before goods arrive, but it lands in a new 'advance' payment_state
--   — a vendor advance (asset: "vendor owes us goods"), not yet an
--   expense — never directly in 'paid'. Reaching 'paid' from 'advance'
--   requires close_vendor_advance(), which itself requires a GRN to
--   exist. The GRN's role flips for Pattern B: instead of unlocking
--   the payment, it closes the advance. Discipline preserved, payment
--   not blocked.
--
-- payment_pattern is declared per purchase order (sourcing_bundles),
-- not per vendor — vendors.payment_terms already exists as a general
-- default, but a vendor might demand advance on one order and not
-- another, and the pattern is known at PO time regardless.
--
-- Current fiscal year only, same as every other payment-lifecycle
-- rule (migration 098) — a pre-current-FY expense is grandfathered,
-- not retrofitted.
-- ============================================================

SET search_path TO public;

ALTER TABLE sourcing_bundles ADD COLUMN IF NOT EXISTS payment_pattern TEXT NOT NULL DEFAULT 'pay_on_delivery'
  CHECK (payment_pattern IN ('pay_on_delivery', 'pay_in_advance'));

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_payment_state_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_payment_state_check
  CHECK (payment_state IN ('unpaid', 'approved_to_pay', 'sent', 'paid', 'advance', 'void'));

-- ── Extends enforce_expense_payment_lifecycle() (migration 098) —
-- same function, not a second trigger, so there's one place that
-- decides what a current-FY expense is allowed to do. The three
-- pre-existing checks (direct-boolean-bypass, finance_approved_by
-- required, disbursed_by required/distinct/role) are unchanged except
-- 'advance' joins the same IN-lists 'sent'/'paid' already sat in —
-- money leaving the building needs the same segregation-of-duties
-- identity regardless of which bucket it lands in.
CREATE OR REPLACE FUNCTION enforce_expense_payment_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy      UUID;
  v_row_fy          UUID;
  v_is_current      BOOLEAN;
  v_payment_pattern TEXT;
  v_grn_exists      BOOLEAN;
BEGIN
  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  v_is_current := (v_row_fy IS NOT NULL AND v_row_fy = v_current_fy);

  IF v_is_current THEN
    IF TG_OP = 'UPDATE'
       AND NEW.payment_status IS DISTINCT FROM OLD.payment_status
       AND NEW.payment_state IS NOT DISTINCT FROM OLD.payment_state THEN
      RAISE EXCEPTION 'payment_status can no longer be set directly on a current fiscal year expense — use payment_state instead';
    END IF;

    IF NEW.payment_state IN ('approved_to_pay', 'sent', 'paid', 'advance') AND NEW.finance_approved_by IS NULL THEN
      RAISE EXCEPTION 'A current fiscal year expense needs a real finance approver (finance_approved_by) before it can reach %', NEW.payment_state;
    END IF;

    IF NEW.payment_state IN ('sent', 'paid', 'advance') THEN
      IF NEW.disbursed_by IS NULL THEN
        RAISE EXCEPTION 'A current fiscal year expense needs a payer identity (disbursed_by) before it can reach %', NEW.payment_state;
      END IF;
      IF NEW.disbursed_by = NEW.finance_approved_by THEN
        RAISE EXCEPTION 'The same person cannot both approve (finance_approved_by) and pay (disbursed_by) an expense';
      END IF;
      IF (SELECT role FROM user_profiles WHERE id = NEW.disbursed_by) NOT IN ('admin', 'finance') THEN
        RAISE EXCEPTION 'disbursed_by must be an admin or finance user';
      END IF;
    END IF;

    -- ── Advance-payment sequencing ─────────────────────────────────
    IF NEW.payment_state = 'advance' AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance') THEN
      IF NEW.sourcing_bundle_id IS NULL THEN
        RAISE EXCEPTION 'advance is only meaningful for an expense linked to a sourcing_bundle (payment_pattern is declared there)';
      END IF;
      SELECT payment_pattern INTO v_payment_pattern FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
      IF v_payment_pattern IS DISTINCT FROM 'pay_in_advance' THEN
        RAISE EXCEPTION 'This purchase order is not marked pay-in-advance — set sourcing_bundles.payment_pattern first';
      END IF;
    END IF;

    IF NEW.payment_state = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'paid') THEN
      IF NEW.sourcing_bundle_id IS NOT NULL THEN
        SELECT payment_pattern INTO v_payment_pattern FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
        v_grn_exists := EXISTS (SELECT 1 FROM goods_received_notes WHERE sourcing_bundle_id = NEW.sourcing_bundle_id);

        IF v_payment_pattern = 'pay_in_advance' THEN
          -- Pattern B: 'paid' is only reachable by closing an open
          -- advance, never directly — close_vendor_advance() is the
          -- one place that also reclassifies the ledger posting
          -- (migration 111), so this trigger insists on that path
          -- rather than allowing a shortcut that would skip it.
          IF TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance' THEN
            RAISE EXCEPTION 'This purchase is pay-in-advance — record the payment as payment_state = advance first, then close it via close_vendor_advance() once a GRN exists';
          END IF;
          IF NOT v_grn_exists THEN
            RAISE EXCEPTION 'Cannot close this advance: no GRN exists yet for the linked purchase order';
          END IF;
        ELSE
          -- Pattern A — the conditional form of the block: still
          -- required, just no longer absolute now that Pattern B has
          -- its own legitimate path to 'paid' via 'advance'.
          IF NOT v_grn_exists THEN
            RAISE EXCEPTION 'This purchase is pay-on-delivery — a GRN must exist for its purchase order before the expense can be marked paid';
          END IF;
        END IF;
      END IF;
      -- No sourcing_bundle_id: an ad-hoc expense outside the formal
      -- PR->Bundle->PO->GRN chain. No GRN to require — unchanged,
      -- per the standing "don't force migration onto the chain" rule.
    END IF;
  END IF;

  NEW.payment_status := (NEW.payment_state = 'paid');

  IF TG_OP = 'INSERT' OR NEW.payment_state IS DISTINCT FROM OLD.payment_state THEN
    NEW.payment_state_changed_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- ── Close an advance: the GRN converting "vendor owes us goods" into
-- "goods received, expense incurred." Thin wrapper — the trigger
-- above does the actual validation (GRN exists, still an open
-- advance); this exists for a friendly upfront message and one clear
-- call site rather than a raw client-side update racing the trigger's
-- own error text.
CREATE OR REPLACE FUNCTION close_vendor_advance(p_expense_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expense RECORD;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can close a vendor advance';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF v_expense IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_expense.payment_state <> 'advance' THEN
    RAISE EXCEPTION 'Expense % is not an open advance (payment_state = %)', p_expense_id, v_expense.payment_state;
  END IF;

  UPDATE expenses SET payment_state = 'paid' WHERE id = p_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION close_vendor_advance(UUID) TO authenticated;

-- ── "Paid but not delivered" — the exposure finance needs to chase,
-- not a silent gap. An advance open too long is a signal.
CREATE OR REPLACE VIEW v_open_vendor_advances
WITH (security_invoker = true) AS
SELECT
  e.id, e.expense_code, e.item_service_description, e.amount_etb,
  e.vendor_id, v.vendor_name,
  e.sourcing_bundle_id, sb.bundle_code,
  e.disbursed_by, e.payment_state_changed_at,
  EXTRACT(DAY FROM (NOW() - e.payment_state_changed_at)) AS days_open
FROM expenses e
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
WHERE e.payment_state = 'advance'
ORDER BY e.payment_state_changed_at;

GRANT SELECT ON v_open_vendor_advances TO authenticated;

-- Verify: constraint updated, function/view/RPC present.
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'expenses_payment_state_check';
SELECT proname FROM pg_proc WHERE proname IN ('enforce_expense_payment_lifecycle', 'close_vendor_advance');
SELECT count(*) AS open_advances_expect_zero FROM v_open_vendor_advances;
