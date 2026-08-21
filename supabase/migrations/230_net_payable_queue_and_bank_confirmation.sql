-- Two payments-page changes.
--
-- 1. v_to_pay_queue now carries net_payable and wht_amount, so the
--    To-Pay Queue can lead with the NET figure that actually leaves the
--    bank (VAT in, WHT withheld) — the number printed on the PO — with
--    gross shown as secondary context. Previously the queue only had
--    amount_etb (gross), so a WHT-eligible payment looked bigger than
--    the vendor would ever receive.
--
-- 2. Bank statement import becomes the authoritative confirmation of
--    payment for bank methods. A transfer / CPO / cheque expense can now
--    only reach payment_state='paid' when it carries a matched bank line
--    (transfer_id) — i.e. via match_expense_to_transfer /
--    match_expense_to_statement_line / the batch matcher, all of which set
--    transfer_id in the same step it flips to paid. Any other path to
--    'paid' for a bank method is rejected.
--
--    Deliberately exempt:
--      * Cash and VRF — they never appear on a bank statement; they keep
--        their own confirmations (confirm_expense_cash_payment /
--        confirm_vrf_payment), which set paid without a transfer_id.
--      * The advance-close path (close_vendor_advance): a pay-in-advance
--        expense already disbursed the money at payment_state='advance';
--        reaching 'paid' there is a GRN-driven reclassification, not a
--        fresh disbursement, so it must not require a new bank match.
--        Detected as OLD.payment_state = 'advance'.

SET search_path TO public;

-- ── 1. v_to_pay_queue: add net_payable + wht_amount ────────────────
-- Columns are appended at the end (net_payable, wht_amount) because
-- CREATE OR REPLACE VIEW can only add columns after the existing ones,
-- never insert them mid-list.
CREATE OR REPLACE VIEW public.v_to_pay_queue AS
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
    e.wht_amount
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN cost_groups cg ON cg.id = c.cost_group_id
     LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
  WHERE e.payment_state = 'approved_to_pay'::text;

-- ── 2. Bank-confirmation guard inside the payment lifecycle ─────────
CREATE OR REPLACE FUNCTION public.enforce_expense_payment_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- Bank statement import is the confirmation for bank methods: a
      -- transfer/CPO/cheque only reaches 'paid' with a matched bank line
      -- (transfer_id). Cash & VRF are exempt (own confirmations, no
      -- statement line); closing a pay-in-advance is exempt (money left
      -- at 'advance', so this transition is a GRN reclassification).
      IF NEW.payment_method IN ('transfer', 'cpo', 'cheque')
         AND NEW.transfer_id IS NULL
         AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance') THEN
        RAISE EXCEPTION 'A % payment can only be confirmed by matching it to an imported bank statement line', NEW.payment_method;
      END IF;

      IF NEW.sourcing_bundle_id IS NOT NULL THEN
        SELECT payment_pattern INTO v_payment_pattern FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
        v_grn_exists := EXISTS (SELECT 1 FROM goods_received_notes WHERE sourcing_bundle_id = NEW.sourcing_bundle_id);

        IF v_payment_pattern = 'pay_in_advance' THEN
          IF TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance' THEN
            RAISE EXCEPTION 'This purchase is pay-in-advance — record the payment as payment_state = advance first, then close it via close_vendor_advance() once a GRN exists';
          END IF;
          IF NOT v_grn_exists THEN
            RAISE EXCEPTION 'Cannot close this advance: no GRN exists yet for the linked purchase order';
          END IF;
        ELSE
          IF NOT v_grn_exists THEN
            RAISE EXCEPTION 'This purchase is pay-on-delivery — a GRN must exist for its purchase order before the expense can be marked paid';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  NEW.payment_status := (NEW.payment_state = 'paid');

  IF TG_OP = 'INSERT' OR NEW.payment_state IS DISTINCT FROM OLD.payment_state THEN
    NEW.payment_state_changed_at := NOW();
  END IF;

  RETURN NEW;
END;
$function$;
