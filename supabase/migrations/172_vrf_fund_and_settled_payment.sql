-- 172 — VRF Phase 1: fund drawdown, settled-VRF payment with certificate, access
--
-- A settled VRF's returned money is a spendable fund. Payments made "via VRF"
-- draw it down; the VRF Manager confirms each against a settled VRF and attaches
-- a payment confirmation certificate. Access is admin/executive always, finance
-- only with the is_vrf_manager badge.

SET search_path TO public;

-- ── Per-settled-VRF fund status ──────────────────────────────────────
CREATE OR REPLACE VIEW v_vrf_fund_status
WITH (security_invoker = true) AS
SELECT
  f.id AS vrf_id,
  f.record_name,
  f.facilitator_name,
  f.status,
  f.amount_transferred,
  f.money_returned,
  f.commission_amount,
  f.return_account_id,
  (COALESCE(f.amount_transferred,0) - COALESCE(f.money_returned,0) - COALESCE(f.commission_amount,0)) AS settlement_gap,
  COALESCE(SUM(e.amount_etb) FILTER (WHERE e.payment_state = 'paid'), 0) AS fund_drawn,
  COALESCE(f.money_returned,0) - COALESCE(SUM(e.amount_etb) FILTER (WHERE e.payment_state = 'paid'), 0) AS fund_available,
  COUNT(e.id) FILTER (WHERE e.payment_state = 'paid') AS payments_count
FROM vendor_receipt_facilitation f
LEFT JOIN expenses e ON e.vrf_id = f.id
GROUP BY f.id, f.record_name, f.facilitator_name, f.status, f.amount_transferred, f.money_returned, f.commission_amount, f.return_account_id;
GRANT SELECT ON v_vrf_fund_status TO authenticated;

-- ── Confirm a VRF payment against a settled VRF, with a certificate ──
DROP FUNCTION IF EXISTS public.confirm_vrf_payment(uuid, uuid);
CREATE OR REPLACE FUNCTION public.confirm_vrf_payment(
  p_expense_id uuid, p_vrf_id uuid, p_certificate_url text DEFAULT NULL, p_certificate_name text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_vrf_mgr BOOLEAN; v_state TEXT; v_method TEXT; v_amount NUMERIC;
  v_vrf_status TEXT; v_return_acct UUID; v_available NUMERIC;
BEGIN
  SELECT is_vrf_manager INTO v_is_vrf_mgr FROM user_profiles WHERE id = auth.uid();
  IF NOT (COALESCE(v_is_vrf_mgr, false) OR get_user_role() = 'admin') THEN
    RAISE EXCEPTION 'Only the VRF Manager (or an admin) can confirm a VRF payment';
  END IF;
  IF p_vrf_id IS NULL THEN RAISE EXCEPTION 'Select the settled VRF this payment is drawn from'; END IF;
  IF p_certificate_url IS NULL THEN RAISE EXCEPTION 'Attach a payment confirmation certificate before marking it paid'; END IF;

  SELECT payment_state, payment_method, amount_etb INTO v_state, v_method, v_amount FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_method IS DISTINCT FROM 'vrf' THEN RAISE EXCEPTION 'This is not a VRF payment'; END IF;
  IF v_state NOT IN ('approved_to_pay', 'sent') THEN
    RAISE EXCEPTION 'Only an approved or sent VRF payment can be confirmed (current: %)', v_state;
  END IF;

  SELECT status, return_account_id INTO v_vrf_status, v_return_acct FROM vendor_receipt_facilitation WHERE id = p_vrf_id;
  IF v_vrf_status IS DISTINCT FROM 'settled' THEN
    RAISE EXCEPTION 'Payments can only be drawn from a settled VRF (this one is %)', COALESCE(v_vrf_status, 'missing');
  END IF;

  SELECT fund_available INTO v_available FROM v_vrf_fund_status WHERE vrf_id = p_vrf_id;
  IF COALESCE(v_available,0) < COALESCE(v_amount,0) THEN
    RAISE EXCEPTION 'This VRF fund has only % available, cannot cover %', COALESCE(v_available,0), COALESCE(v_amount,0);
  END IF;

  UPDATE expenses SET
    payment_state = 'paid', vrf_id = p_vrf_id,
    account_id = COALESCE(v_return_acct, account_id),
    disbursed_by = auth.uid(),
    payment_certificate_url = p_certificate_url, payment_certificate_name = p_certificate_name,
    payment_confirmed_by = auth.uid(), payment_confirmed_at = NOW()
  WHERE id = p_expense_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.confirm_vrf_payment(uuid, uuid, text, text) TO authenticated;

-- ── Access: admin/executive always; finance only with the VRF badge ──
DROP POLICY IF EXISTS procurement_officer_all ON vendor_receipt_facilitation;
DROP POLICY IF EXISTS raa_vrf_finance ON vendor_receipt_facilitation;
DROP POLICY IF EXISTS raa_vrf_manager_read ON vendor_receipt_facilitation;
DROP POLICY IF EXISTS vrf_manager_badge_all ON vendor_receipt_facilitation;

DROP POLICY IF EXISTS vrf_executive_all ON vendor_receipt_facilitation;
CREATE POLICY vrf_executive_all ON vendor_receipt_facilitation FOR ALL
  USING (get_user_role() = 'executive') WITH CHECK (get_user_role() = 'executive');

DROP POLICY IF EXISTS vrf_finance_badge_all ON vendor_receipt_facilitation;
CREATE POLICY vrf_finance_badge_all ON vendor_receipt_facilitation FOR ALL
  USING (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true))
  WITH CHECK (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true));
