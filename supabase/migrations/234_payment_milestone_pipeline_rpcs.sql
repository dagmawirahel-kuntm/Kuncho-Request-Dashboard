-- PR 9d group (b): the three milestone pipeline RPCs.
--
-- pending -> progress_met -> invoiced -> payment_confirmed, linear, no
-- branching in v1.
--
-- All three are SECURITY DEFINER, and deliberately so: group (a)'s
-- payment_milestones_update policy pins both USING and WITH CHECK to
-- status = 'pending', so no direct client UPDATE can advance the pipeline at
-- all. That is the point -- the only way status moves is through these
-- functions, each of which enforces its own role rule and (for
-- progress_met) verifies physical reality before letting it move. Each
-- opens with the mandatory auth.uid() NULL guard and is revoked from
-- PUBLIC/anon.
--
-- Role rules per stage, per the prompt:
--   mark_milestone_progress_met  -> the project's PM, or admin
--   mark_milestone_invoiced      -> PM or finance, or admin
--   confirm_milestone_payment    -> finance or admin ONLY, never the PM
--     (the PM should not be able to declare that money arrived)

SET search_path TO public;

-- ════════════════════════════════════════════════════════════════
-- mark_milestone_progress_met
--
-- Verifies the completion condition against v_boq_item_physical_progress
-- itself rather than trusting the caller -- same reasoning as PR 9c's
-- block_manual_progress_when_wo_linked: ground truth over manual assertion.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION mark_milestone_progress_met(p_milestone_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_m          payment_milestones%ROWTYPE;
  v_pm_staff   UUID;
  v_caller     UUID;
  v_role       user_role;
  v_linked     INT;
  v_incomplete INT;
  v_detail     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_m FROM payment_milestones WHERE id = p_milestone_id;
  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'Payment milestone % not found', p_milestone_id;
  END IF;

  SELECT project_manager_id INTO v_pm_staff FROM projects WHERE id = v_m.project_id;
  v_caller := current_staff_id();
  v_role   := get_user_role();

  IF NOT (
    COALESCE(v_role = 'admin', false)
    OR (v_caller IS NOT NULL AND v_caller = v_pm_staff)
  ) THEN
    RAISE EXCEPTION 'Only the project''s PM or an admin can mark a milestone''s progress as met';
  END IF;

  IF v_m.status <> 'pending' THEN
    RAISE EXCEPTION 'Milestone is at status %; progress can only be marked from pending', v_m.status;
  END IF;

  SELECT count(*) INTO v_linked
  FROM payment_milestone_boq_items WHERE payment_milestone_id = p_milestone_id;

  -- Without this, a milestone with nothing linked would pass vacuously
  -- ("all zero of its items are complete") -- the exact loophole this RPC
  -- exists to close.
  IF v_linked = 0 THEN
    RAISE EXCEPTION 'This milestone has no BOQ items linked -- link the scope that defines its completion before marking progress met';
  END IF;

  -- A NULL progress_pct (BOQ item with no linked schedule tasks) counts as
  -- incomplete, never as done.
  SELECT count(*) INTO v_incomplete
  FROM payment_milestone_boq_items pmbi
  LEFT JOIN v_boq_item_physical_progress p ON p.item_id = pmbi.boq_item_id
  WHERE pmbi.payment_milestone_id = p_milestone_id
    AND COALESCE(p.progress_pct, -1) < 100;

  IF v_incomplete > 0 THEN
    SELECT string_agg(format('%s (%s)', COALESCE(p.name, 'unknown item'),
                             COALESCE(p.progress_pct::text || '%', 'no progress data')), '; ')
      INTO v_detail
    FROM payment_milestone_boq_items pmbi
    LEFT JOIN v_boq_item_physical_progress p ON p.item_id = pmbi.boq_item_id
    WHERE pmbi.payment_milestone_id = p_milestone_id
      AND COALESCE(p.progress_pct, -1) < 100;

    RAISE EXCEPTION 'Cannot mark progress met: % of % linked BOQ item(s) are not at 100%%. Outstanding: %',
      v_incomplete, v_linked, v_detail;
  END IF;

  UPDATE payment_milestones
  SET status = 'progress_met', progress_met_at = now(), progress_met_by_staff_id = v_caller
  WHERE id = p_milestone_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_milestone_progress_met(UUID) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- mark_milestone_invoiced -- records a reference to an externally created
-- invoice; this PR deliberately does not generate invoice documents
-- (guardrail 20), matching how contracts.document_url already just stores
-- a reference.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION mark_milestone_invoiced(
  p_milestone_id UUID,
  p_document_url TEXT,
  p_invoiced_date DATE
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_m        payment_milestones%ROWTYPE;
  v_pm_staff UUID;
  v_caller   UUID;
  v_role     user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_m FROM payment_milestones WHERE id = p_milestone_id;
  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'Payment milestone % not found', p_milestone_id;
  END IF;

  SELECT project_manager_id INTO v_pm_staff FROM projects WHERE id = v_m.project_id;
  v_caller := current_staff_id();
  v_role   := get_user_role();

  IF NOT (
    COALESCE(v_role IN ('admin', 'finance'), false)
    OR (v_caller IS NOT NULL AND v_caller = v_pm_staff)
  ) THEN
    RAISE EXCEPTION 'Only the project''s PM, finance, or an admin can mark a milestone invoiced';
  END IF;

  IF v_m.status <> 'progress_met' THEN
    RAISE EXCEPTION 'Milestone is at status %; it can only be invoiced from progress_met', v_m.status;
  END IF;

  UPDATE payment_milestones
  SET status = 'invoiced',
      invoiced_at = COALESCE(p_invoiced_date::timestamptz, now()),
      invoiced_by_staff_id = v_caller,
      invoice_document_url = p_document_url
  WHERE id = p_milestone_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_milestone_invoiced(UUID, TEXT, DATE) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════
-- confirm_milestone_payment -- finance/admin only.
--
-- Records what finance says was received. It deliberately does NOT
-- reconcile against bank statements (guardrail 20) -- that is what the
-- existing match_sale_to_statement_line / reconcile_account infrastructure
-- does for sales, and duplicating it here would create a second, parallel
-- payment-recording path. See the note in the PR description about whether
-- confirmed milestone payments should eventually route through that
-- existing matching system; this PR does not decide that.
--
-- KNOWN v1 LIMITATION (explicitly in scope per the prompt): if
-- amount_received_etb differs from net_payable_etb, that difference is
-- captured as an explanatory note, not reconciled. There is no
-- partial-payment workflow -- a short payment closes the milestone with a
-- note recording the shortfall.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION confirm_milestone_payment(
  p_milestone_id UUID,
  p_amount_received_etb NUMERIC,
  p_received_date DATE,
  p_note TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_m         payment_milestones%ROWTYPE;
  v_role      user_role;
  v_caller    UUID;
  -- Bank rounding can move a transfer by a few cents; anything beyond one
  -- birr is a real difference that needs explaining.
  v_tolerance NUMERIC := 1.00;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_m FROM payment_milestones WHERE id = p_milestone_id;
  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'Payment milestone % not found', p_milestone_id;
  END IF;

  v_role   := get_user_role();
  v_caller := current_staff_id();

  IF NOT COALESCE(v_role IN ('admin', 'finance'), false) THEN
    RAISE EXCEPTION 'Only finance or an admin can confirm a milestone payment';
  END IF;

  IF v_m.status <> 'invoiced' THEN
    RAISE EXCEPTION 'Milestone is at status %; payment can only be confirmed from invoiced', v_m.status;
  END IF;

  IF p_amount_received_etb IS NULL THEN
    RAISE EXCEPTION 'Amount received is required';
  END IF;

  IF abs(p_amount_received_etb - v_m.net_payable_etb) > v_tolerance
     AND COALESCE(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'Received amount (%) differs from the net payable (%) -- a note explaining the difference is required',
      p_amount_received_etb, v_m.net_payable_etb;
  END IF;

  UPDATE payment_milestones
  SET status = 'payment_confirmed',
      payment_confirmed_at = COALESCE(p_received_date::timestamptz, now()),
      payment_confirmed_by_staff_id = v_caller,
      amount_received_etb = p_amount_received_etb,
      payment_note = p_note
  WHERE id = p_milestone_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_milestone_payment(UUID, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;

-- Verify.
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN ('mark_milestone_progress_met', 'mark_milestone_invoiced', 'confirm_milestone_payment')
ORDER BY proname;
