-- 504: Undo "sent" on a VRF sent in one go.
--
-- A VRF paid in parts could already be taken back one part at a time
-- (reverse_vrf_part, 454), but one marked sent in one go (mark_vrf_sent, 326)
-- couldn't: vrf_derive refuses any change to the payment step outside
-- Approve and Mark sent. Finance now undoes it here, with a reason:
--   * it goes back to Approved, to be marked sent again or paid in parts;
--     with no paying account it goes back to To pay, since approval needs one;
--   * a bank line matched to it is let go, and its ledger entry and WHT
--     drop out (vrf_sync_ledger re-runs on the update; the WHT return only
--     counts a sent VRF);
--   * refused once money has come back on it or been drawn from it, when its
--     bank line is in a closed bank period, or when the WHT return for its
--     month is filed.
-- Every undo is kept in vrf_sent_undos.

CREATE TABLE IF NOT EXISTS public.vrf_sent_undos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vrf_id uuid NOT NULL REFERENCES public.vendor_receipt_facilitation(id) ON DELETE CASCADE,
  reason text NOT NULL,
  was_sent_date date,
  was_sent_by uuid REFERENCES public.user_profiles(id),
  was_transfer_id uuid,
  net_sent numeric,
  back_to text NOT NULL,
  undone_by uuid NOT NULL REFERENCES public.user_profiles(id),
  undone_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vrf_sent_undos_vrf_idx ON public.vrf_sent_undos (vrf_id, undone_at DESC);
ALTER TABLE public.vrf_sent_undos ENABLE ROW LEVEL SECURITY;
CREATE POLICY vrf_sent_undos_read ON public.vrf_sent_undos FOR SELECT TO authenticated
  USING (COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false));
COMMENT ON TABLE public.vrf_sent_undos IS 'Each time a VRF sent in one go was taken back, and why (504). Written only by undo_vrf_sent.';

CREATE OR REPLACE FUNCTION public.undo_vrf_sent(p_vrf_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v record; v_on date; v_ec record; v_back text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT COALESCE(get_user_role()::text IN ('admin', 'finance'), false) THEN
    RAISE EXCEPTION 'Only admin or finance can undo a VRF payment';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why it is being undone'; END IF;
  SELECT * INTO v FROM vendor_receipt_facilitation WHERE id = p_vrf_id AND NOT is_archived FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VRF not found'; END IF;
  IF v.payment_state <> 'sent' THEN
    RAISE EXCEPTION 'Only a sent VRF can be undone (this one is %)', replace(v.payment_state, '_', ' ');
  END IF;
  IF EXISTS (SELECT 1 FROM vrf_payment_parts WHERE vrf_id = p_vrf_id AND reversed_at IS NULL) THEN
    RAISE EXCEPTION 'It was sent in parts: reverse its parts instead';
  END IF;
  IF EXISTS (SELECT 1 FROM vrf_returns WHERE vrf_id = p_vrf_id) THEN
    RAISE EXCEPTION 'Money has already come back on it: remove its returns first';
  END IF;
  IF EXISTS (SELECT 1 FROM vrf_personal_draws WHERE vrf_id = p_vrf_id)
     OR EXISTS (SELECT 1 FROM expenses WHERE vrf_id = p_vrf_id AND NOT COALESCE(is_archived, false))
     OR EXISTS (SELECT 1 FROM payroll WHERE vrf_id = p_vrf_id AND NOT COALESCE(is_archived, false)) THEN
    RAISE EXCEPTION 'Money has been drawn from it: undo the draws first';
  END IF;
  IF v.out_transfer_id IS NOT NULL AND transfer_in_closed_period(v.out_transfer_id) THEN
    RAISE EXCEPTION 'Its bank line is in a closed bank period: reopen it first';
  END IF;
  v_on := COALESCE(v.bank_date, v.sent_date, v.trxn_date);
  IF COALESCE(v.wht_amount, 0) > 0 AND v_on IS NOT NULL THEN
    SELECT t.ec_year, t.ec_month INTO v_ec FROM tax_period_for_date(v_on) t;
    IF EXISTS (SELECT 1 FROM tax_filings WHERE schedule_code = 'WHT' AND status <> 'draft'
                AND period_ec_year = v_ec.ec_year AND period_ec_month = v_ec.ec_month) THEN
      RAISE EXCEPTION 'Its WHT is on a WHT return that is already filed';
    END IF;
  END IF;

  v_back := CASE WHEN v.initial_account_id IS NULL THEN 'to_pay' ELSE 'approved' END;
  INSERT INTO vrf_sent_undos (vrf_id, reason, was_sent_date, was_sent_by, was_transfer_id, net_sent, back_to, undone_by)
  VALUES (p_vrf_id, btrim(p_reason), v.sent_date, v.sent_by, v.out_transfer_id, v.net_sent, v_back, auth.uid());

  PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
  UPDATE vendor_receipt_facilitation
     SET payment_state = v_back, sent_by = NULL, sent_date = NULL, out_transfer_id = NULL,
         approved_by = CASE WHEN v_back = 'to_pay' THEN NULL ELSE approved_by END,
         approved_at = CASE WHEN v_back = 'to_pay' THEN NULL ELSE approved_at END
   WHERE id = p_vrf_id;
  PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
  RETURN v_back;
END $f$;
GRANT EXECUTE ON FUNCTION public.undo_vrf_sent(uuid, text) TO authenticated;
