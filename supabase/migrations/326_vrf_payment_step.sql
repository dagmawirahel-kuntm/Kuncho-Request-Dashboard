-- 326 — A VRF goes through payment: to pay → approved → sent
--
-- Since 322 a VRF counted as money out of the bank the moment it was saved,
-- with no approval and no confirmation that it was paid. The VRF payment now
-- has its own step, without becoming an expense again:
--
--   to_pay    recorded; nothing leaves the bank yet. Shown on the Approval
--             Dashboard.
--   approved  approved by admin or finance (approve_vrf_payment); shown in
--             the Payments dashboard's to-pay list.
--   sent      paid (mark_vrf_sent), matched to its bank statement line where
--             the statement is imported, else on the date given.
--
-- Only a sent VRF leaves the bank balance (v_account_balances), posts its
-- outflow and commission to the ledger, and carries WHT onto the WHT return
-- -- all dated by when it was sent. Changing what is to be paid after
-- approval sends it back to to_pay. The step moves only through the two
-- functions: vrf_derive refuses any other change to it.
--
-- Every existing VRF was paid before this step existed (each has its return
-- recorded), so all are marked sent on their bank line's date, else the
-- VRF's date. Balances, WHT and the ledger are unchanged by this.
--
-- 327 (post-merge) then refuses returns on a VRF that has not been sent.
-- Additive for the deployed frontend.

SET search_path TO public;

-- The conversion below re-posts the ledger and writes as a person.
DO $$
DECLARE v_admin uuid;
BEGIN
  SELECT id INTO v_admin FROM user_profiles WHERE role = 'admin' ORDER BY created_at NULLS LAST LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
END $$;

ALTER TABLE vendor_receipt_facilitation
  ADD COLUMN IF NOT EXISTS payment_state text NOT NULL DEFAULT 'to_pay'
    CHECK (payment_state IN ('to_pay', 'approved', 'sent')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS sent_date date;
CREATE INDEX IF NOT EXISTS idx_vrf_payment_state ON vendor_receipt_facilitation(payment_state) WHERE NOT is_archived;

CREATE OR REPLACE FUNCTION public.vrf_derive()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_vat numeric; v_wht jsonb; v_base numeric; v_thr numeric;
  v_returned numeric; v_expected numeric;
  v_op boolean := COALESCE(current_setting('kuncho.vrf_payment_op', true), '') = 'on';
BEGIN
  -- The payment step moves only through approve_vrf_payment / mark_vrf_sent.
  IF TG_OP = 'INSERT' AND NOT v_op THEN
    NEW.payment_state := 'to_pay';
    NEW.approved_by := NULL; NEW.approved_at := NULL;
    NEW.sent_by := NULL; NEW.sent_date := NULL;
  ELSIF TG_OP = 'UPDATE' AND NOT v_op AND (
        NEW.payment_state IS DISTINCT FROM OLD.payment_state
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.sent_by IS DISTINCT FROM OLD.sent_by OR NEW.sent_date IS DISTINCT FROM OLD.sent_date) THEN
    RAISE EXCEPTION 'A VRF payment moves on with Approve and Mark sent';
  END IF;
  -- Changing what is to be paid after approval sends it back for approval.
  IF TG_OP = 'UPDATE' AND NOT v_op AND OLD.payment_state = 'approved' AND (
        NEW.receipt_amount IS DISTINCT FROM OLD.receipt_amount
     OR NEW.wht_amount IS DISTINCT FROM OLD.wht_amount OR NEW.wht_overridden IS DISTINCT FROM OLD.wht_overridden
     OR NEW.supply_kind IS DISTINCT FROM OLD.supply_kind
     OR NEW.commission_basis IS DISTINCT FROM OLD.commission_basis OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.commission_amount IS DISTINCT FROM OLD.commission_amount
     OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.initial_account_id IS DISTINCT FROM OLD.initial_account_id) THEN
    NEW.payment_state := 'to_pay';
    NEW.approved_by := NULL; NEW.approved_at := NULL;
  END IF;

  -- Names cannot be blanked once given.
  IF TG_OP = 'UPDATE' AND OLD.record_name IS NOT NULL AND btrim(COALESCE(NEW.record_name, '')) = '' THEN
    RAISE EXCEPTION 'A VRF needs a name';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.facilitator_name IS NOT NULL AND btrim(COALESCE(NEW.facilitator_name, '')) = '' THEN
    RAISE EXCEPTION 'A VRF needs its facilitator';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.vendor_id IS NOT NULL AND NEW.vendor_id IS NULL THEN
    RAISE EXCEPTION 'A VRF needs the vendor that issued the receipt';
  END IF;

  -- Every new VRF is recorded the structured way, with a name and facilitator.
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.structured THEN RAISE EXCEPTION 'Record a new VRF from its receipt amount'; END IF;
    IF btrim(COALESCE(NEW.record_name, '')) = '' THEN RAISE EXCEPTION 'A VRF needs a name'; END IF;
    IF btrim(COALESCE(NEW.facilitator_name, '')) = '' THEN RAISE EXCEPTION 'A VRF needs its facilitator'; END IF;
    IF NEW.vendor_id IS NULL THEN RAISE EXCEPTION 'A VRF needs the vendor that issued the receipt'; END IF;
  END IF;

  IF NOT NEW.structured THEN RETURN NEW; END IF;

  IF NEW.receipt_amount IS NULL THEN RAISE EXCEPTION 'Enter the receipt amount'; END IF;
  IF NEW.trxn_date IS NULL THEN RAISE EXCEPTION 'Enter the date the money was sent'; END IF;
  IF NEW.return_account_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.return_account_id AND is_vrf_holding) THEN
    RAISE EXCEPTION 'Returned money has to go to a holding account';
  END IF;

  v_vat := (tax_rate_note('VAT', NEW.trxn_date) ->> 'standard_rate')::numeric;
  v_wht := tax_rate_note('WHT', NEW.trxn_date);

  IF NOT NEW.wht_overridden THEN
    v_base := round(NEW.receipt_amount / (1 + v_vat), 2);
    v_thr  := (v_wht ->> CASE WHEN NEW.supply_kind = 'services' THEN 'services_threshold_etb' ELSE 'goods_threshold_etb' END)::numeric;
    NEW.wht_amount := CASE WHEN v_base >= COALESCE(v_thr, 0) THEN round(v_base * (v_wht ->> 'rate')::numeric, 2) ELSE 0 END;
  ELSIF NEW.wht_amount IS NULL THEN
    RAISE EXCEPTION 'Enter the WHT, or let it be calculated';
  END IF;

  IF NEW.commission_basis IS NULL THEN RAISE EXCEPTION 'Choose how the commission is worked out'; END IF;
  IF NEW.commission_basis = 'receipt_pct' THEN
    NEW.commission_amount := round(NEW.receipt_amount * COALESCE(NEW.commission_rate, 0) / 100, 2);
  ELSIF NEW.commission_basis = 'vat_pct' THEN
    NEW.commission_amount := round(NEW.receipt_amount * v_vat / (1 + v_vat) * COALESCE(NEW.commission_rate, 0) / 100, 2);
  ELSE
    NEW.commission_rate := NULL;
    NEW.commission_amount := COALESCE(NEW.commission_amount, 0);
  END IF;

  -- The legacy figures, kept for everything that still reads them.
  NEW.amount_transferred    := NEW.receipt_amount - COALESCE(NEW.wht_amount, 0);
  NEW.net_facilitation_cost := COALESCE(NEW.commission_amount, 0) + COALESCE(NEW.wht_amount, 0);

  SELECT COALESCE(sum(amount), 0) INTO v_returned FROM vrf_returns WHERE vrf_id = NEW.id;
  NEW.money_returned := v_returned;
  v_expected := NEW.amount_transferred - COALESCE(NEW.commission_amount, 0);
  -- A bank fee of a few birr on the return is normal: 10 birr of slack.
  NEW.status := CASE
    WHEN v_returned <= 0 THEN 'open'
    WHEN v_returned >= v_expected - 10 THEN 'settled'
    ELSE 'partial' END;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_derive() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.vrf_sync_ledger(p_vrf_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v vendor_receipt_facilitation%ROWTYPE;
  r record;
  v_fy uuid; v_transit uuid; v_comm uuid; v_bank uuid; v_hold uuid; v_entry uuid; v_label text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can post VRF entries';
  END IF;

  DELETE FROM journal_entries WHERE source_table = 'vendor_receipt_facilitation' AND source_id = p_vrf_id;
  -- A rewrite starts clean: earlier failures for this VRF are superseded.
  DELETE FROM ledger_posting_failures
  WHERE source_table = 'vendor_receipt_facilitation' AND source_id = p_vrf_id AND NOT COALESCE(resolved, false);

  SELECT * INTO v FROM vendor_receipt_facilitation WHERE id = p_vrf_id;
  IF NOT FOUND OR v.is_archived OR NOT v.structured THEN RETURN; END IF;

  SELECT id INTO v_fy FROM fiscal_periods WHERE is_current;
  SELECT id INTO v_transit FROM chart_of_accounts WHERE account_code = '1085';
  SELECT id INTO v_comm FROM chart_of_accounts WHERE account_code = '51057';
  v_label := COALESCE(v.record_name, 'VRF');

  BEGIN
    -- Money leaves the bank when the payment is sent, not when it is recorded.
    IF v.payment_state = 'sent' AND fiscal_period_for_date(COALESCE(v.sent_date, v.trxn_date)) = v_fy AND COALESCE(v.net_sent, 0) > 0 THEN
      SELECT id INTO v_bank FROM chart_of_accounts WHERE linked_account_id = v.initial_account_id;
      IF v_bank IS NULL OR v_transit IS NULL OR v_comm IS NULL THEN
        PERFORM log_posting_failure('vendor_receipt_facilitation', v.id,
          format('Cannot post %s: the account it was sent from has no ledger account', v_label));
      ELSE
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
        VALUES (COALESCE(v.sent_date, v.trxn_date), 'operational', 'vendor_receipt_facilitation', v.id, 'VRF sent: ' || v_label, auth.uid())
        RETURNING id INTO v_entry;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry, v_transit, v.net_sent, 0, 'Sent for ' || v_label),
          (v_entry, v_bank, 0, v.net_sent, 'Paid from bank');
        IF COALESCE(v.commission_amount, 0) > 0 THEN
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
            (v_entry, v_comm, v.commission_amount, 0, 'Commission on ' || v_label),
            (v_entry, v_transit, 0, v.commission_amount, 'Commission kept back');
        END IF;
      END IF;
    END IF;

    FOR r IN SELECT * FROM vrf_returns WHERE vrf_id = v.id ORDER BY return_date, created_at LOOP
      CONTINUE WHEN fiscal_period_for_date(r.return_date) IS DISTINCT FROM v_fy;
      CONTINUE WHEN r.account_id IS NULL;
      SELECT id INTO v_hold FROM chart_of_accounts WHERE linked_account_id = r.account_id;
      IF v_hold IS NULL OR v_transit IS NULL THEN
        PERFORM log_posting_failure('vendor_receipt_facilitation', v.id,
          format('Cannot post a return on %s: no holding account with a ledger account', v_label));
        CONTINUE;
      END IF;
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
      VALUES (r.return_date, 'operational', 'vendor_receipt_facilitation', v.id, 'VRF returned: ' || v_label, auth.uid())
      RETURNING id INTO v_entry;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry, v_hold, r.amount, 0, 'Returned from ' || v_label),
        (v_entry, v_transit, 0, r.amount, 'Out of transit');
    END LOOP;

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('vendor_receipt_facilitation', p_vrf_id, SQLERRM);
  END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_sync_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vrf_sync_ledger(uuid) TO authenticated;


-- ── Approve and send ──────────────────────────────────────────────────────
-- Invoker functions: the caller's own VRF access (RLS) still applies; these
-- add the role check and are the only way the payment step moves.

CREATE OR REPLACE FUNCTION public.approve_vrf_payment(p_vrf_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can approve a VRF payment';
  END IF;
  SELECT * INTO v FROM vendor_receipt_facilitation WHERE id = p_vrf_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'VRF not found'; END IF;
  IF v.payment_state <> 'to_pay' THEN RAISE EXCEPTION 'This VRF payment is already %', replace(v.payment_state, '_', ' '); END IF;
  IF NOT v.structured OR v.receipt_amount IS NULL THEN RAISE EXCEPTION 'Record the VRF from its receipt amount first'; END IF;
  IF v.vendor_id IS NULL THEN RAISE EXCEPTION 'Add the vendor before approving'; END IF;
  IF v.initial_account_id IS NULL THEN RAISE EXCEPTION 'Choose the account it is paid from before approving'; END IF;

  PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
  UPDATE vendor_receipt_facilitation
  SET payment_state = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = p_vrf_id;
  PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.approve_vrf_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_vrf_payment(uuid) TO authenticated;

-- Marks an approved VRF paid. With a bank line, the line must be from the
-- account it was paid from, within 1% (or 50 birr) of the net sent, and not
-- already matched to anything else; the sent date is the line's date.
CREATE OR REPLACE FUNCTION public.mark_vrf_sent(p_vrf_id uuid, p_transfer_id uuid DEFAULT NULL, p_sent_date date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v record; t record; v_date date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can mark a VRF payment sent';
  END IF;
  SELECT * INTO v FROM vendor_receipt_facilitation WHERE id = p_vrf_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'VRF not found'; END IF;
  IF v.payment_state <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved VRF payment can be marked sent (this one is %)', replace(v.payment_state, '_', ' ');
  END IF;

  IF p_transfer_id IS NOT NULL THEN
    SELECT * INTO t FROM transfers WHERE id = p_transfer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank line not found'; END IF;
    IF t.from_account_id IS DISTINCT FROM v.initial_account_id THEN
      RAISE EXCEPTION 'That bank line is not from the account this VRF is paid from';
    END IF;
    IF abs(t.amount - v.net_sent) > greatest(50, v.net_sent * 0.01) THEN
      RAISE EXCEPTION 'That bank line (%) does not match the amount sent (%)', t.amount, v.net_sent;
    END IF;
    IF EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE out_transfer_id = p_transfer_id AND id <> p_vrf_id)
       OR EXISTS (SELECT 1 FROM expenses WHERE transfer_id = p_transfer_id)
       OR EXISTS (SELECT 1 FROM batch_payments WHERE transfer_id = p_transfer_id)
       OR EXISTS (SELECT 1 FROM payroll WHERE transfer_id = p_transfer_id) THEN
      RAISE EXCEPTION 'That bank line is already matched to another payment';
    END IF;
    v_date := t.date;
  ELSIF p_sent_date IS NULL THEN
    RAISE EXCEPTION 'Choose the bank line, or enter the date it was sent';
  ELSE
    v_date := p_sent_date;
  END IF;

  PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
  UPDATE vendor_receipt_facilitation
  SET payment_state = 'sent', sent_by = auth.uid(),
      sent_date = v_date,
      out_transfer_id = COALESCE(p_transfer_id, out_transfer_id)
  WHERE id = p_vrf_id;
  PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mark_vrf_sent(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_vrf_sent(uuid, uuid, date) TO authenticated;

-- ── Views: only sent VRFs leave the bank or carry WHT ─────────────────────

CREATE OR REPLACE VIEW v_wht_payable_by_ec_period
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT tp.ec_year, tp.ec_month, e.payment_status AS paid, e.wht_amount AS wht, false AS is_vrf
  FROM expenses e
  CROSS JOIN LATERAL tax_period_for_date(COALESCE(e.total_payment_date, e.paid_date::date, e.date)) tp(ec_year, ec_month)
  WHERE COALESCE(e.wht_amount, 0) > 0
    AND COALESCE(e.total_payment_date, e.paid_date::date, e.date) IS NOT NULL
    AND NOT COALESCE(e.is_archived, false)
    AND e.vendor_receipt_facilitation_id IS NULL
    AND e.expense_type IS DISTINCT FROM 'vrf'
  UNION ALL
  -- WHT is withheld when the VRF is paid: sent VRFs, in the month they went.
  SELECT tp.ec_year, tp.ec_month, true, f.wht_amount, true
  FROM vendor_receipt_facilitation f
  CROSS JOIN LATERAL tax_period_for_date(COALESCE(f.sent_date, f.trxn_date)) tp(ec_year, ec_month)
  WHERE f.structured AND NOT f.is_archived AND f.payment_state = 'sent'
    AND COALESCE(f.sent_date, f.trxn_date) IS NOT NULL AND COALESCE(f.wht_amount, 0) > 0
)
SELECT ec_year,
  ec_month,
  ec_month_name(ec_month) || ' ' || ec_year AS period_label,
  count(*) FILTER (WHERE paid) AS paid_expense_count,
  COALESCE(sum(wht) FILTER (WHERE paid), 0::numeric) AS wht_withheld,
  count(*) FILTER (WHERE NOT paid) AS pending_expense_count,
  COALESCE(sum(wht) FILTER (WHERE NOT paid), 0::numeric) AS wht_pending_unpaid,
  count(*) FILTER (WHERE is_vrf) AS vrf_count,
  COALESCE(sum(wht) FILTER (WHERE is_vrf), 0::numeric) AS vrf_wht
FROM lines
GROUP BY ec_year, ec_month;
REVOKE ALL ON v_wht_payable_by_ec_period FROM anon;
GRANT SELECT ON v_wht_payable_by_ec_period TO authenticated;

CREATE OR REPLACE VIEW v_account_balances
WITH (security_invoker = true) AS
WITH latest_anchor AS (
  SELECT DISTINCT ON (bank_balance_anchors.account_id) bank_balance_anchors.account_id,
    bank_balance_anchors.as_of_date, bank_balance_anchors.balance, bank_balance_anchors.transfer_id
  FROM bank_balance_anchors
  ORDER BY bank_balance_anchors.account_id, bank_balance_anchors.as_of_date DESC
), counted_out AS (
  SELECT t.id, t.from_account_id AS account_id, t.amount
  FROM transfers t LEFT JOIN latest_anchor la_1 ON la_1.account_id = t.from_account_id
  WHERE t.from_account_id IS NOT NULL
    AND (la_1.as_of_date IS NULL OR t.date > la_1.as_of_date
         OR (t.date = la_1.as_of_date AND la_1.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la_1.transfer_id))
), counted_in AS (
  SELECT t.id, t.to_account_id AS account_id, t.amount
  FROM transfers t LEFT JOIN latest_anchor la_1 ON la_1.account_id = t.to_account_id
  WHERE t.to_account_id IS NOT NULL
    AND (la_1.as_of_date IS NULL OR t.date > la_1.as_of_date
         OR (t.date = la_1.as_of_date AND la_1.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la_1.transfer_id))
), counted_vrf_out AS (
  SELECT v.id, v.initial_account_id AS account_id, v.amount_transferred AS amount
  FROM vendor_receipt_facilitation v LEFT JOIN latest_anchor la_1 ON la_1.account_id = v.initial_account_id
  WHERE v.initial_account_id IS NOT NULL
    AND NOT v.is_archived
    AND v.payment_state = 'sent'
    AND v.out_transfer_id IS NULL
    AND (la_1.as_of_date IS NULL OR COALESCE(v.sent_date, v.trxn_date) > la_1.as_of_date)
), transfers_out AS (
  SELECT account_id, COALESCE(sum(amount), 0::numeric) AS total FROM counted_out GROUP BY account_id
), transfers_in AS (
  SELECT account_id, COALESCE(sum(amount), 0::numeric) AS total FROM counted_in GROUP BY account_id
), vrf_out AS (
  SELECT account_id, COALESCE(sum(amount), 0::numeric) AS total FROM counted_vrf_out GROUP BY account_id
), vrf_in AS (
  SELECT x.account_id, COALESCE(sum(x.amount), 0::numeric) AS total
  FROM (
    -- Returns recorded as entries, unless their bank line already counts.
    SELECT r.account_id, r.amount, r.return_date AS d
    FROM vrf_returns r JOIN vendor_receipt_facilitation v ON v.id = r.vrf_id
    WHERE v.structured AND NOT v.is_archived AND r.account_id IS NOT NULL AND r.transfer_id IS NULL
    UNION ALL
    -- Records still written by the old form.
    SELECT v.return_account_id, v.money_returned, v.trxn_date
    FROM vendor_receipt_facilitation v
    WHERE NOT v.structured AND NOT v.is_archived AND v.return_account_id IS NOT NULL
  ) x
  LEFT JOIN latest_anchor la_1 ON la_1.account_id = x.account_id
  WHERE la_1.as_of_date IS NULL OR x.d > la_1.as_of_date
  GROUP BY x.account_id
), sales_in AS (
  SELECT s.account_id, COALESCE(sum(s.amount), 0::numeric) AS total
  FROM sales s LEFT JOIN latest_anchor la_1 ON la_1.account_id = s.account_id
  WHERE s.account_id IS NOT NULL AND s.sales_status = 'Paid'::sale_lifecycle_status
    AND (la_1.as_of_date IS NULL OR s.date > la_1.as_of_date)
  GROUP BY s.account_id
), expenses_out AS (
  SELECT e.account_id, COALESCE(sum(e.amount_etb), 0::numeric) AS total
  FROM expenses e LEFT JOIN latest_anchor la_1 ON la_1.account_id = e.account_id
  WHERE e.account_id IS NOT NULL AND e.payment_status = true
    AND (la_1.as_of_date IS NULL OR e.date > la_1.as_of_date)
    AND e.vendor_receipt_facilitation_id IS NULL
    AND e.expense_type IS DISTINCT FROM 'vrf'
    AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = e.transfer_id AND co.account_id = e.account_id)
    AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = e.vrf_id AND cv.account_id = e.account_id)
    AND NOT EXISTS (
      SELECT 1 FROM batch_payment_expenses bpe
      JOIN batch_payments bp ON bp.id = bpe.batch_payment_id
      JOIN counted_out co ON co.id = bp.transfer_id AND co.account_id = e.account_id
      WHERE bpe.expense_id = e.id)
  GROUP BY e.account_id
), payroll_out AS (
  SELECT p.account_id, COALESCE(sum(ps.net_amount), 0::numeric) AS total
  FROM payroll p
  JOIN payroll_staff ps ON ps.payroll_id = p.id
  LEFT JOIN latest_anchor la_1 ON la_1.account_id = p.account_id
  WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid'
    AND (la_1.as_of_date IS NULL OR p.end_date > la_1.as_of_date)
    AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = p.transfer_id AND co.account_id = p.account_id)
    AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = p.vrf_id AND cv.account_id = p.account_id)
  GROUP BY p.account_id
), advances_out AS (
  SELECT ca.account_used_id AS account_id, COALESCE(sum(ca.amount_advanced), 0::numeric) AS total
  FROM cash_advances ca LEFT JOIN latest_anchor la_1 ON la_1.account_id = ca.account_used_id
  WHERE ca.account_used_id IS NOT NULL
    AND ca.approval_status = 'finance_approved'::cash_advance_approval_status
    AND (la_1.as_of_date IS NULL OR ca.date_given > la_1.as_of_date)
  GROUP BY ca.account_used_id
), draws_out AS (
  SELECT d.account_id, COALESCE(sum(d.amount), 0::numeric) AS total
  FROM vrf_personal_draws d LEFT JOIN latest_anchor la_1 ON la_1.account_id = d.account_id
  WHERE d.account_id IS NOT NULL AND (la_1.as_of_date IS NULL OR d.draw_date > la_1.as_of_date)
  GROUP BY d.account_id
)
SELECT a.id,
  a.account_name,
  a.type,
  a.status,
  COALESCE(la.balance, 0::numeric) + COALESCE(si.total, 0::numeric) + COALESCE(ti.total, 0::numeric)
    + COALESCE(vi.total, 0::numeric) - COALESCE(eo.total, 0::numeric) - COALESCE(ao.total, 0::numeric)
    - COALESCE(po.total, 0::numeric) - COALESCE(vo.total, 0::numeric) - COALESCE(to2.total, 0::numeric)
    - COALESCE(dr.total, 0::numeric) AS balance,
  COALESCE(la.balance, 0::numeric) AS opening_balance,
  la.as_of_date AS opening_balance_as_of,
  COALESCE(si.total, 0::numeric) AS total_sales_in,
  COALESCE(ti.total, 0::numeric) AS total_transfers_in,
  COALESCE(vi.total, 0::numeric) AS total_vrf_returned_in,
  COALESCE(eo.total, 0::numeric) AS total_expenses_out,
  COALESCE(ao.total, 0::numeric) AS total_advances_out,
  COALESCE(po.total, 0::numeric) AS total_payroll_out,
  COALESCE(vo.total, 0::numeric) AS total_vrf_transferred_out,
  COALESCE(to2.total, 0::numeric) AS total_transfers_out,
  COALESCE(dr.total, 0::numeric) AS total_vrf_draws_out
FROM accounts a
LEFT JOIN latest_anchor la ON la.account_id = a.id
LEFT JOIN sales_in si ON si.account_id = a.id
LEFT JOIN expenses_out eo ON eo.account_id = a.id
LEFT JOIN advances_out ao ON ao.account_id = a.id
LEFT JOIN payroll_out po ON po.account_id = a.id
LEFT JOIN vrf_out vo ON vo.account_id = a.id
LEFT JOIN vrf_in vi ON vi.account_id = a.id
LEFT JOIN transfers_in ti ON ti.account_id = a.id
LEFT JOIN transfers_out to2 ON to2.account_id = a.id
LEFT JOIN draws_out dr ON dr.account_id = a.id;
REVOKE ALL ON v_account_balances FROM anon;
GRANT SELECT ON v_account_balances TO authenticated;

CREATE OR REPLACE VIEW v_vrf_register
WITH (security_invoker = true) AS
SELECT
  f.id AS vrf_id,
  f.record_name,
  f.facilitator_name,
  f.status,
  f.trxn_date,
  ec.ec_year,
  ec.ec_month,
  CASE WHEN ec.ec_year IS NOT NULL THEN ec_month_name(ec.ec_month) || ' ' || ec.ec_year END AS period_label,
  fp.id AS fiscal_period_id,
  fp.label AS fiscal_year,
  COALESCE(f.receipt_amount, f.amount_transferred, 0)::numeric AS receipt_amount,
  COALESCE(f.amount_transferred, 0)::numeric AS transferred,
  COALESCE(f.wht_amount, 0)::numeric AS wht_recorded,
  COALESCE(f.commission_amount, 0)::numeric AS commission,
  COALESCE(f.money_returned, 0)::numeric AS returned,
  (COALESCE(f.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0))::numeric AS kept_back,
  (COALESCE(f.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0)
    - COALESCE(f.wht_amount, 0) - COALESCE(f.commission_amount, 0))::numeric AS unaccounted,
  fs.company_expense_drawn,
  fs.payroll_drawn,
  fs.personal_drawn,
  fs.fund_available AS held,
  round(COALESCE(f.receipt_amount, f.amount_transferred, 0) * COALESCE(r.rate, 0) / (1 + COALESCE(r.rate, 0)), 2) AS vat_on_receipt,
  f.net_sent::numeric AS net_sent,
  f.expected_return::numeric AS expected_return,
  f.needs_review,
  f.review_notes,
  f.structured,
  f.supply_kind,
  f.commission_basis,
  f.commission_rate::numeric AS commission_rate,
  f.wht_overridden,
  f.return_account_id,
  ra.account_name AS holding_account_name,
  f.initial_account_id,
  ia.account_name AS sent_from_account_name,
  f.out_transfer_id,
  f.vendor_id,
  vd.vendor_name,
  vd.tin AS vendor_tin,
  f.payment_state,
  f.approved_at,
  f.sent_date
FROM vendor_receipt_facilitation f
CROSS JOIN LATERAL (
  SELECT (tax_rate_note('VAT', COALESCE(f.trxn_date, CURRENT_DATE)) ->> 'standard_rate')::numeric AS rate
) r
LEFT JOIN LATERAL gregorian_to_ec(f.trxn_date) ec ON f.trxn_date IS NOT NULL
LEFT JOIN fiscal_periods fp ON f.trxn_date >= fp.start_date AND f.trxn_date <= fp.end_date
LEFT JOIN v_vrf_fund_status fs ON fs.vrf_id = f.id
LEFT JOIN accounts ra ON ra.id = f.return_account_id
LEFT JOIN accounts ia ON ia.id = f.initial_account_id
LEFT JOIN vendors vd ON vd.id = f.vendor_id
WHERE NOT COALESCE(f.is_archived, false);
REVOKE ALL ON v_vrf_register FROM PUBLIC, anon;
GRANT SELECT ON v_vrf_register TO authenticated;

-- ── Existing VRFs ─────────────────────────────────────────────────────────
-- They were all paid under the old flow, which had no payment step.
SELECT set_config('kuncho.vrf_payment_op', 'on', true);
UPDATE vendor_receipt_facilitation f
SET payment_state = 'sent',
    sent_date = COALESCE((SELECT t.date FROM transfers t WHERE t.id = f.out_transfer_id), f.trxn_date)
WHERE NOT f.is_archived AND f.payment_state = 'to_pay';
SELECT set_config('kuncho.vrf_payment_op', 'off', true);
