-- 338 — Advances can be requested and received without progress
--
-- An advance is paid so the work can start: the payment request goes out
-- before (or with) the proforma, and the money arrives before anything is
-- built. There is no progress to meet. Until now the only route to
-- payment_confirmed ran pending -> progress_met -> invoiced -> confirmed,
-- and progress_met needs linked BOQ work at 100% — so an advance could
-- never be recorded as received, and milestone 2's work orders stayed gated
-- behind it.
--
-- Milestones already say what they are: payment_milestones.kind (330,
-- sales journey foundation). For kind = 'advance':
--   * mark_milestone_invoiced records the payment request from pending as
--     well as from progress_met — the request can go out before the
--     contract is signed.
--   * confirm_milestone_payment records the money from pending or
--     progress_met as well as from invoiced — some clients pay on the
--     proforma with no separate request.
-- Progress, final and other milestones keep the full pipeline.
--
-- mark_milestone_progress_met (330: an advance falls due when the contract
-- is signed) is not touched.

CREATE OR REPLACE FUNCTION mark_milestone_invoiced(p_milestone_id UUID, p_document_url TEXT, p_invoiced_date DATE)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m payment_milestones%ROWTYPE; v_pm_staff UUID; v_caller UUID; v_role user_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_m FROM payment_milestones WHERE id = p_milestone_id;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Payment milestone % not found', p_milestone_id; END IF;
  SELECT project_manager_id INTO v_pm_staff FROM projects WHERE id = v_m.project_id;
  v_caller := current_staff_id(); v_role := get_user_role();
  IF NOT (COALESCE(v_role IN ('admin', 'finance'), false) OR (v_caller IS NOT NULL AND v_caller = v_pm_staff)) THEN
    RAISE EXCEPTION 'Only the project''s PM, finance, or an admin can mark a milestone invoiced';
  END IF;
  IF v_m.kind = 'advance' THEN
    IF v_m.status NOT IN ('pending', 'progress_met') THEN
      RAISE EXCEPTION 'This advance is at status %; a payment request can only be recorded before it is requested or paid', v_m.status;
    END IF;
  ELSIF v_m.status <> 'progress_met' THEN
    RAISE EXCEPTION 'Milestone is at status %; it can only be invoiced from progress_met', v_m.status;
  END IF;
  UPDATE payment_milestones SET status = 'invoiced', invoiced_at = COALESCE(p_invoiced_date::timestamptz, now()),
    invoiced_by_staff_id = v_caller, invoice_document_url = p_document_url WHERE id = p_milestone_id;
END; $$;
REVOKE EXECUTE ON FUNCTION mark_milestone_invoiced(UUID, TEXT, DATE) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION confirm_milestone_payment(p_milestone_id UUID, p_amount_received_etb NUMERIC, p_received_date DATE, p_note TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m payment_milestones%ROWTYPE; v_role user_role; v_caller UUID; v_tolerance NUMERIC := 1.00;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_m FROM payment_milestones WHERE id = p_milestone_id;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Payment milestone % not found', p_milestone_id; END IF;
  v_role := get_user_role(); v_caller := current_staff_id();
  IF NOT COALESCE(v_role IN ('admin', 'finance'), false) THEN RAISE EXCEPTION 'Only finance or an admin can confirm a milestone payment'; END IF;
  IF NOT (v_m.status = 'invoiced' OR (v_m.kind = 'advance' AND v_m.status IN ('pending', 'progress_met'))) THEN
    RAISE EXCEPTION 'Milestone is at status %; payment can only be confirmed from invoiced', v_m.status;
  END IF;
  IF p_amount_received_etb IS NULL THEN RAISE EXCEPTION 'Amount received is required'; END IF;
  IF abs(p_amount_received_etb - v_m.net_payable_etb) > v_tolerance AND COALESCE(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'Received amount (%) differs from the net payable (%) -- a note explaining the difference is required', p_amount_received_etb, v_m.net_payable_etb;
  END IF;
  UPDATE payment_milestones SET status = 'payment_confirmed', payment_confirmed_at = COALESCE(p_received_date::timestamptz, now()),
    payment_confirmed_by_staff_id = v_caller, amount_received_etb = p_amount_received_etb, payment_note = p_note WHERE id = p_milestone_id;
END; $$;
REVOKE EXECUTE ON FUNCTION confirm_milestone_payment(UUID, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;

-- A milestone_type column briefly existed alongside kind while this was
-- built; kind is the one source of truth.
ALTER TABLE payment_milestones DROP CONSTRAINT IF EXISTS payment_milestones_milestone_type_check;
ALTER TABLE payment_milestones DROP COLUMN IF EXISTS milestone_type;
