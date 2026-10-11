-- 442 — A bank payment is paid when it is sent with its reference
--
-- The payment workflow owns "paid"; the bank statement audits it (440, 441).
-- Finance pays a bill and types the FT reference from the slip (and can attach
-- the confirmation screenshot): the bill is paid there and then and the books
-- post on that date. When the statement comes in, the line with that
-- reference is linked to it; whatever doesn't agree is flagged on the audit.
--
--   enforce_expense_payment_lifecycle  a transfer, CPO or cheque reaches paid
--                                      with its bank reference (a matched line
--                                      still does too); approver ≠ payer holds
--   pay_expense()                      pays one approved bill: by bank with its
--                                      reference it is paid (paid ahead, for a
--                                      pay-in-advance order); by bank without
--                                      one, or in cash, it is sent
--   mark_payment_paid()                a sent bill, part or batch gets its
--                                      reference (or its cash confirmed) and is
--                                      paid
--   auto_sync_expense_bank_ref         stands aside inside those two, which link
--                                      through the reconciliation instead (the
--                                      match is recorded and the bank's charge
--                                      booked)
--   match_expense_to_transfer          a sent pay-in-advance bill matched to its
--                                      line becomes an advance
--   v_awaiting_bank_confirmation       carries the reference typed at sending
--   v_sent_batches                     batches sent and waiting for their
--                                      reference
--
-- Applied as 442_pay_with_bank_reference.

SET search_path TO public;

-- ── 1. The rule: a reference makes a bank payment paid ────────────────────
CREATE OR REPLACE FUNCTION enforce_expense_payment_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy UUID; v_row_fy UUID; v_is_current BOOLEAN;
  v_payment_pattern TEXT; v_grn_exists BOOLEAN;
BEGIN
  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  v_is_current := (v_row_fy IS NOT NULL AND v_row_fy = v_current_fy);
  IF v_is_current THEN
    IF TG_OP = 'UPDATE' AND NEW.payment_status IS DISTINCT FROM OLD.payment_status
       AND NEW.payment_state IS NOT DISTINCT FROM OLD.payment_state THEN
      RAISE EXCEPTION 'payment_status can no longer be set directly on a current fiscal year expense — use payment_state instead';
    END IF;
    IF NEW.payment_state IN ('approved_to_pay','sent','paid','advance') AND NEW.finance_approved_by IS NULL THEN
      RAISE EXCEPTION 'A current fiscal year expense needs a real finance approver (finance_approved_by) before it can reach %', NEW.payment_state;
    END IF;
    IF NEW.payment_state IN ('sent','paid','advance') THEN
      IF NEW.disbursed_by IS NULL THEN
        RAISE EXCEPTION 'A current fiscal year expense needs a payer identity (disbursed_by) before it can reach %', NEW.payment_state;
      END IF;
      IF NEW.disbursed_by = NEW.finance_approved_by THEN
        RAISE EXCEPTION 'The same person cannot both approve (finance_approved_by) and pay (disbursed_by) an expense';
      END IF;
      IF (TG_OP = 'INSERT' OR NEW.disbursed_by IS DISTINCT FROM OLD.disbursed_by)
         AND (SELECT role FROM user_profiles WHERE id = NEW.disbursed_by) NOT IN ('admin','finance') THEN
        RAISE EXCEPTION 'disbursed_by must be an admin or finance user';
      END IF;
    END IF;
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
      -- The bank reference from the slip makes a bank payment paid; the
      -- statement line confirms it later (the bank audit, 440).
      IF NEW.payment_method IN ('transfer','cpo','cheque')
         AND NEW.transfer_id IS NULL AND bank_ref_norm(NEW.bank_ref) IS NULL
         AND (TG_OP = 'INSERT' OR OLD.payment_state IS DISTINCT FROM 'advance') THEN
        RAISE EXCEPTION 'A % payment is marked paid with its bank reference (the FT number on the slip)', NEW.payment_method;
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

-- Typing a reference elsewhere still links the bill to its line at once. The
-- payment functions below switch this off and link through the
-- reconciliation, which records the match and books the bank's charge.
CREATE OR REPLACE FUNCTION auto_sync_expense_bank_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer_id     UUID;
  v_from_account_id UUID;
BEGIN
  IF COALESCE(current_setting('kuncho.ref_autolink', true), '') = 'off' THEN
    RETURN NEW;
  END IF;
  IF NEW.bank_ref IS NOT NULL AND NEW.transfer_id IS NULL
     AND (TG_OP = 'INSERT' OR NEW.bank_ref IS DISTINCT FROM OLD.bank_ref) THEN
    SELECT id, from_account_id INTO v_transfer_id, v_from_account_id
    FROM transfers WHERE transfer_id_code = NEW.bank_ref LIMIT 1;
    IF v_transfer_id IS NOT NULL THEN
      NEW.transfer_id := v_transfer_id;
      NEW.account_id  := COALESCE(NEW.account_id, v_from_account_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- A bill already paid (or paid ahead) is linked to its line and nothing else
-- changes. A bill only sent is paid by the match — or paid ahead, when its
-- order is pay-in-advance.
CREATE OR REPLACE FUNCTION match_expense_to_transfer(p_expense_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from_account_id uuid; v_state text; v_advance boolean;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match an expense to a bank line';
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense belongs to a batch payment — match the batch to a bank line instead';
  END IF;
  IF EXISTS (SELECT 1 FROM expenses WHERE id = p_expense_id AND in_parts) THEN
    RAISE EXCEPTION 'This expense is paid in parts — match the bank line to the part it paid';
  END IF;
  SELECT e.payment_state, COALESCE(sb.payment_pattern = 'pay_in_advance', false)
    INTO v_state, v_advance
    FROM expenses e LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
   WHERE e.id = p_expense_id;
  SELECT from_account_id INTO v_from_account_id FROM transfers WHERE id = p_transfer_id;
  UPDATE expenses
  SET payment_state = CASE WHEN v_state IN ('paid', 'advance') THEN payment_state
                           WHEN v_advance THEN 'advance' ELSE 'paid' END,
      transfer_id   = p_transfer_id,
      account_id    = COALESCE(account_id, v_from_account_id)
  WHERE id = p_expense_id;
END $$;

-- A bank part is marked paid with its reference now (mark_payment_paid).
CREATE OR REPLACE FUNCTION confirm_expense_part_cash(p_payment_id uuid, p_paid_date date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p expense_payments%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can confirm a payment';
  END IF;
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
  IF p.state <> 'sent' THEN RAISE EXCEPTION 'Only a sent part can be confirmed (this one is %)', p.state; END IF;
  IF p.payment_method IN ('transfer', 'cpo', 'cheque') THEN
    RAISE EXCEPTION 'A % part is marked paid with its bank reference', p.payment_method;
  END IF;
  UPDATE expense_payments SET state = 'paid', paid_date = COALESCE(p_paid_date, CURRENT_DATE), confirmed_by = auth.uid()
   WHERE id = p.id;
END $function$;

-- ── 2. Paying ─────────────────────────────────────────────────────────────
-- One approved bill (not in parts, not in a batch). By bank with its
-- reference: paid on p_paid_date, or paid ahead when its order is
-- pay-in-advance. By bank without one: sent, waiting for it on To confirm.
-- Cash, VRF or other: sent, as before (a cash advance is paid ahead at once,
-- as before). Returns the state reached and whether the statement already
-- showed it.
CREATE OR REPLACE FUNCTION pay_expense(
  p_expense_id uuid, p_disbursed_by uuid, p_method text, p_account_id uuid DEFAULT NULL,
  p_bank_ref text DEFAULT NULL, p_paid_date date DEFAULT NULL,
  p_proof_url text DEFAULT NULL, p_proof_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e expenses%ROWTYPE;
  v_ref text;
  v_date date := COALESCE(p_paid_date, CURRENT_DATE);
  v_bank boolean; v_advance boolean; v_state text; v_linked boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can pay a bill';
  END IF;
  SELECT * INTO e FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.in_parts THEN RAISE EXCEPTION 'This bill is paid in parts — pay its next part instead'; END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id) THEN
    RAISE EXCEPTION 'This bill is in a batch payment — mark the batch paid instead';
  END IF;
  IF e.payment_state <> 'approved_to_pay' THEN
    RAISE EXCEPTION 'Only a bill approved to pay can be paid here (this one is %)', replace(e.payment_state, '_', ' ');
  END IF;
  IF p_disbursed_by IS NULL THEN RAISE EXCEPTION 'Pick who is paying'; END IF;
  IF p_disbursed_by = e.finance_approved_by THEN
    RAISE EXCEPTION 'The person who approved the bill cannot also pay it — pick someone else';
  END IF;
  IF COALESCE((SELECT role::text FROM user_profiles WHERE id = p_disbursed_by), '') NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'The payer must be an admin or finance user';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('transfer', 'cpo', 'cheque', 'cash', 'vrf', 'other') THEN
    RAISE EXCEPTION 'Pick how it is paid (transfer, CPO, cheque, cash, VRF or other)';
  END IF;
  v_bank := p_method IN ('transfer', 'cpo', 'cheque');
  -- A bank reference is kept as the bank prints it.
  v_ref := CASE WHEN v_bank THEN bank_ref_norm(p_bank_ref) ELSE NULLIF(btrim(p_bank_ref), '') END;
  IF v_bank AND COALESCE(p_account_id, e.account_id) IS NULL THEN
    RAISE EXCEPTION 'Pick the account it is paid from';
  END IF;
  IF v_date > CURRENT_DATE THEN RAISE EXCEPTION 'The payment date cannot be in the future'; END IF;
  v_advance := COALESCE((SELECT sb.payment_pattern = 'pay_in_advance' FROM sourcing_bundles sb
                         WHERE sb.id = e.sourcing_bundle_id), false);
  v_state := CASE
    WHEN v_bank AND v_ref IS NULL THEN 'sent'
    WHEN v_advance AND p_method <> 'vrf' THEN 'advance'
    WHEN v_bank THEN 'paid'
    ELSE 'sent' END;

  PERFORM set_config('kuncho.ref_autolink', 'off', true);
  UPDATE expenses SET
    payment_state  = v_state,
    disbursed_by   = p_disbursed_by,
    payment_method = p_method,
    account_id     = COALESCE(p_account_id, account_id),
    bank_ref       = COALESCE(v_ref, bank_ref),
    paid_date      = CASE WHEN v_state IN ('paid', 'advance') THEN v_date::timestamptz ELSE paid_date END,
    payment_certificate_url  = COALESCE(p_proof_url, payment_certificate_url),
    payment_certificate_name = COALESCE(p_proof_name, payment_certificate_name),
    payment_confirmed_by = CASE WHEN v_state IN ('paid', 'advance') THEN auth.uid() ELSE payment_confirmed_by END,
    payment_confirmed_at = CASE WHEN v_state IN ('paid', 'advance') THEN now() ELSE payment_confirmed_at END
  WHERE id = e.id;
  PERFORM set_config('kuncho.ref_autolink', 'on', true);

  IF v_bank AND v_state <> 'sent' THEN
    v_linked := bank_try_link_reference(v_ref);
  END IF;
  RETURN jsonb_build_object('state', v_state, 'linked', v_linked);
END $$;

-- Something sent gets its reference (or its cash confirmed) and is paid:
--   'expense'  a bill sent on its own
--   'part'     a part of a bill paid in parts
--   'batch'    a batch: one transfer for several bills
-- A bank payment needs its reference (the one typed when it was sent is
-- used if none is given). Returns the state reached and whether the
-- statement already showed it.
CREATE OR REPLACE FUNCTION mark_payment_paid(
  p_kind text, p_id uuid, p_bank_ref text DEFAULT NULL, p_paid_date date DEFAULT NULL,
  p_proof_url text DEFAULT NULL, p_proof_name text DEFAULT NULL, p_account_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e expenses%ROWTYPE; q expense_payments%ROWTYPE; b batch_payments%ROWTYPE;
  v_typed text := NULLIF(btrim(p_bank_ref), ''); v_ref text;
  v_date date := COALESCE(p_paid_date, CURRENT_DATE);
  v_bank boolean; v_state text := 'paid'; v_linked boolean := false;
  v_n int; v_waiting int; v_sent int; v_acct uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can mark a payment paid';
  END IF;
  IF v_date > CURRENT_DATE THEN RAISE EXCEPTION 'The payment date cannot be in the future'; END IF;
  PERFORM set_config('kuncho.ref_autolink', 'off', true);

  IF p_kind = 'expense' THEN
    SELECT * INTO e FROM expenses WHERE id = p_id FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
    IF e.in_parts THEN RAISE EXCEPTION 'This bill is paid in parts — mark the part paid'; END IF;
    IF EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id) THEN
      RAISE EXCEPTION 'This bill is in a batch payment — mark the batch paid';
    END IF;
    IF e.payment_state <> 'sent' THEN
      RAISE EXCEPTION 'Only a sent payment can be marked paid (this one is %)', replace(e.payment_state, '_', ' ');
    END IF;
    IF e.payment_method = 'vrf' THEN
      RAISE EXCEPTION 'A VRF payment is paid by the VRF manager from a settled fund';
    END IF;
    v_bank := e.payment_method IN ('transfer', 'cpo', 'cheque', 'batch_wire');
    v_ref := COALESCE(v_typed, NULLIF(btrim(e.bank_ref), ''));
    IF v_bank THEN v_ref := bank_ref_norm(v_ref); END IF;
    IF v_bank AND v_ref IS NULL THEN
      RAISE EXCEPTION 'A % payment is marked paid with its bank reference', replace(e.payment_method, '_', ' ');
    END IF;
    IF v_bank AND COALESCE(p_account_id, e.account_id) IS NULL THEN
      RAISE EXCEPTION 'Pick the account it was paid from';
    END IF;
    IF COALESCE((SELECT sb.payment_pattern = 'pay_in_advance' FROM sourcing_bundles sb
                 WHERE sb.id = e.sourcing_bundle_id), false) THEN
      v_state := 'advance';
    END IF;
    UPDATE expenses SET
      payment_state = v_state, bank_ref = v_ref, paid_date = v_date::timestamptz,
      account_id = COALESCE(p_account_id, account_id),
      payment_certificate_url  = COALESCE(p_proof_url, payment_certificate_url),
      payment_certificate_name = COALESCE(p_proof_name, payment_certificate_name),
      payment_confirmed_by = auth.uid(), payment_confirmed_at = now()
    WHERE id = e.id;

  ELSIF p_kind = 'part' THEN
    SELECT * INTO q FROM expense_payments WHERE id = p_id FOR UPDATE;
    IF q.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
    IF q.state <> 'sent' THEN RAISE EXCEPTION 'Only a sent part can be marked paid (this one is %)', q.state; END IF;
    SELECT * INTO e FROM expenses WHERE id = q.expense_id;
    v_bank := q.payment_method IN ('transfer', 'cpo', 'cheque');
    v_ref := COALESCE(v_typed, NULLIF(btrim(q.bank_ref), ''));
    IF v_bank THEN v_ref := bank_ref_norm(v_ref); END IF;
    IF v_bank AND v_ref IS NULL THEN
      RAISE EXCEPTION 'A % part is marked paid with its bank reference', q.payment_method;
    END IF;
    IF v_bank AND COALESCE(p_account_id, q.account_id, e.account_id) IS NULL THEN
      RAISE EXCEPTION 'Pick the account it was paid from';
    END IF;
    UPDATE expense_payments SET
      state = 'paid', paid_date = v_date, bank_ref = v_ref,
      account_id = COALESCE(p_account_id, account_id),
      proof_url = COALESCE(p_proof_url, proof_url), proof_name = COALESCE(p_proof_name, proof_name),
      confirmed_by = auth.uid()
    WHERE id = q.id;

  ELSIF p_kind = 'batch' THEN
    SELECT * INTO b FROM batch_payments WHERE id = p_id FOR UPDATE;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Batch payment not found'; END IF;
    SELECT count(*), count(*) FILTER (WHERE e2.payment_state NOT IN ('sent', 'paid', 'advance')),
           count(*) FILTER (WHERE e2.payment_state = 'sent'),
           COALESCE(bool_or(e2.payment_method IS DISTINCT FROM 'cash'), false),
           (array_agg(e2.account_id) FILTER (WHERE e2.account_id IS NOT NULL))[1]
      INTO v_n, v_waiting, v_sent, v_bank, v_acct
      FROM batch_payment_expenses x JOIN expenses e2 ON e2.id = x.expense_id
     WHERE x.batch_payment_id = b.id;
    IF v_n = 0 THEN RAISE EXCEPTION 'This batch has no bills'; END IF;
    IF v_waiting > 0 THEN RAISE EXCEPTION 'Send the batch first — % of its bills are not sent yet', v_waiting; END IF;
    IF v_sent = 0 THEN RAISE EXCEPTION 'Every bill in this batch is already paid'; END IF;
    v_ref := COALESCE(v_typed, NULLIF(btrim(b.bank_ref), ''));
    IF v_bank THEN v_ref := bank_ref_norm(v_ref); END IF;
    IF v_bank AND v_ref IS NULL THEN
      RAISE EXCEPTION 'A batch wire is marked paid with its bank reference';
    END IF;
    IF v_bank AND COALESCE(p_account_id, v_acct) IS NULL THEN
      RAISE EXCEPTION 'Pick the account the batch was paid from';
    END IF;
    UPDATE batch_payments SET
      bank_ref = v_ref, paid_date = v_date,
      proof_url = COALESCE(p_proof_url, proof_url), proof_name = COALESCE(p_proof_name, proof_name)
    WHERE id = b.id;
    UPDATE expenses e2 SET
      payment_state = CASE WHEN EXISTS (SELECT 1 FROM sourcing_bundles sb
                                        WHERE sb.id = e2.sourcing_bundle_id AND sb.payment_pattern = 'pay_in_advance')
                           THEN 'advance' ELSE 'paid' END,
      bank_ref = COALESCE(v_ref, e2.bank_ref), paid_date = v_date::timestamptz,
      account_id = COALESCE(p_account_id, e2.account_id),
      payment_confirmed_by = auth.uid(), payment_confirmed_at = now()
    FROM batch_payment_expenses x
    WHERE x.batch_payment_id = b.id AND e2.id = x.expense_id AND e2.payment_state = 'sent';

  ELSE
    RAISE EXCEPTION 'Unknown payment kind % (expense, part or batch)', p_kind;
  END IF;
  PERFORM set_config('kuncho.ref_autolink', 'on', true);

  IF v_bank AND v_ref IS NOT NULL THEN
    v_linked := bank_try_link_reference(v_ref);
  END IF;
  RETURN jsonb_build_object('state', v_state, 'linked', v_linked);
END $$;

-- ── 3. What To confirm reads ──────────────────────────────────────────────
-- The reference typed when it was sent, if any, at the end.
CREATE OR REPLACE VIEW v_awaiting_bank_confirmation WITH (security_invoker = on) AS
 SELECT e.id,
    e.expense_code,
    e.item_service_description,
    e.vendor_id,
    v.vendor_name,
    e.amount_etb,
    e.net_payable,
    e.payment_method,
    e.account_id,
    a.account_name,
    e.payment_state_changed_at,
    EXTRACT(day FROM now() - e.payment_state_changed_at) AS days_waiting,
    bpe.batch_payment_id,
    NULL::uuid AS part_id,
    NULL::integer AS part_no,
    NULL::integer AS part_count,
    e.bank_ref
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN accounts a ON a.id = e.account_id
     LEFT JOIN batch_payment_expenses bpe ON bpe.expense_id = e.id
  WHERE e.payment_state = 'sent'::text AND (e.payment_method = ANY (ARRAY['transfer'::text, 'cpo'::text, 'cheque'::text])) AND e.transfer_id IS NULL AND NOT COALESCE(e.is_archived, false) AND NOT e.in_parts
UNION ALL
 SELECT q.expense_id AS id,
    q.expense_code,
    q.item_service_description,
    q.vendor_id,
    q.vendor_name,
    q.amount_etb::numeric(12,2) AS amount_etb,
    q.cash_etb AS net_payable,
    q.payment_method,
    q.account_id,
    q.account_name,
    q.sent_at AS payment_state_changed_at,
    EXTRACT(day FROM now() - q.sent_at) AS days_waiting,
    NULL::uuid AS batch_payment_id,
    q.id AS part_id,
    q.part_no,
    q.part_count,
    q.bank_ref
   FROM v_expense_payments q
  WHERE q.state = 'sent'::text AND (q.payment_method = ANY (ARRAY['transfer'::text, 'cpo'::text, 'cheque'::text])) AND q.transfer_id IS NULL;

-- A batch whose bills are all sent and none paid yet: one transfer, one
-- reference.
CREATE OR REPLACE VIEW v_sent_batches WITH (security_invoker = on) AS
WITH m AS (
  SELECT x.batch_payment_id AS id, count(*)::int AS bills,
    sum(COALESCE(e.net_payable, e.amount_etb)) AS amount,
    max(e.payment_method) AS payment_method,
    (array_agg(e.account_id) FILTER (WHERE e.account_id IS NOT NULL))[1] AS account_id,
    min(e.payment_state_changed_at) AS sent_at
  FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id
  WHERE NOT COALESCE(e.is_archived, false)
  GROUP BY x.batch_payment_id
  HAVING bool_and(e.payment_state = 'sent')
)
SELECT b.id, b.payment_code, b.notes, b.assignee_id, notify_user_name(b.assignee_id) AS assignee_name,
  m.bills, round(m.amount, 2) AS amount, m.payment_method, m.account_id, a.account_name,
  m.sent_at, EXTRACT(day FROM now() - m.sent_at) AS days_waiting, b.bank_ref
FROM batch_payments b
JOIN m ON m.id = b.id
LEFT JOIN accounts a ON a.id = m.account_id;

-- ── 4. Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION pay_expense(uuid, uuid, text, uuid, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pay_expense(uuid, uuid, text, uuid, text, date, text, text) TO authenticated;
REVOKE ALL ON FUNCTION mark_payment_paid(text, uuid, text, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_payment_paid(text, uuid, text, date, text, text, uuid) TO authenticated;
REVOKE ALL ON v_sent_batches FROM PUBLIC, anon;
GRANT SELECT ON v_sent_batches TO authenticated;
REVOKE ALL ON v_awaiting_bank_confirmation FROM PUBLIC, anon;
GRANT SELECT ON v_awaiting_bank_confirmation TO authenticated;
-- Redefined above; their grants stand, restated for clarity.
REVOKE ALL ON FUNCTION match_expense_to_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_expense_to_transfer(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION confirm_expense_part_cash(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_expense_part_cash(uuid, date) TO authenticated;
