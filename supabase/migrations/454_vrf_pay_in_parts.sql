-- 454 — Pay a VRF in parts, from different banks
--
-- A VRF's money often goes out in several transfers, from more than one
-- bank account. It could only be marked sent once, from one account, by
-- one bank line. Now:
--   • vrf_payment_parts — each part: the account it left from, the amount,
--     the bank line that shows it (or the date, until the statement is in)
--     and that line's date. A part is reversed, never removed.
--   • record_vrf_part() — on an approved VRF; parts may not add up to more
--     than what is to be sent. When they add up to it, the VRF is sent.
--   • reverse_vrf_part() — takes a part back (a sent VRF returns to approved).
--   • match_vrf_part_to_transfer() / bank reconciliation kind 'vrf_part' —
--     a part recorded by date is matched to its line later; undo releases it.
--   • The ledger posts one "VRF part sent" entry per part, from that part's
--     bank, on its bank date; the commission is booked once, when complete.
--   • The VRF's bank date (its WHT date) is the last part's bank date.
--   • Bank line status, account control, the payment↔bank check and the
--     cash ledger see parts like any other payment.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS vrf_payment_parts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vrf_id          uuid NOT NULL REFERENCES vendor_receipt_facilitation(id),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  amount          numeric NOT NULL CHECK (amount > 0),
  transfer_id     uuid REFERENCES transfers(id),
  sent_date       date NOT NULL,
  bank_date       date,
  note            text,
  sent_by         uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  reversed_at     timestamptz,
  reversed_by     uuid,
  reverse_reason  text
);
CREATE INDEX IF NOT EXISTS idx_vrf_payment_parts_vrf ON vrf_payment_parts (vrf_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vrf_payment_parts_transfer ON vrf_payment_parts (transfer_id)
  WHERE transfer_id IS NOT NULL AND reversed_at IS NULL;
COMMENT ON TABLE vrf_payment_parts IS 'A VRF paid in parts, possibly from several bank accounts (454). Written through record/reverse/match functions only.';
ALTER TABLE vrf_payment_parts ENABLE ROW LEVEL SECURITY;
-- Whoever can see the VRF sees its parts.
CREATE POLICY vrf_payment_parts_read ON vrf_payment_parts FOR SELECT
  USING (EXISTS (SELECT 1 FROM vendor_receipt_facilitation v WHERE v.id = vrf_id));

-- A part's bank date comes from its line; a closed period guards it.
CREATE OR REPLACE FUNCTION public.trg_vrf_part_bank_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  NEW.bank_date := (SELECT t.date FROM transfers t WHERE t.id = NEW.transfer_id);
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_vrf_part_bank_date
  BEFORE INSERT OR UPDATE OF transfer_id ON vrf_payment_parts
  FOR EACH ROW EXECUTE FUNCTION trg_vrf_part_bank_date();
CREATE OR REPLACE TRIGGER trg_guard_closed_bank_match
  BEFORE UPDATE OF transfer_id ON vrf_payment_parts
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_match();

-- Re-derive a VRF after its parts change (bank date, state, ledger).
CREATE OR REPLACE FUNCTION public.vrf_touch(p_vrf_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
  UPDATE vendor_receipt_facilitation SET bank_date = bank_date WHERE id = p_vrf_id;
  PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
END $function$;

-- Is this bank line already paying something?
CREATE OR REPLACE FUNCTION public.transfer_in_use(p_transfer_id uuid, p_except_part uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE out_transfer_id = p_transfer_id)
      OR EXISTS (SELECT 1 FROM expenses WHERE transfer_id = p_transfer_id)
      OR EXISTS (SELECT 1 FROM expense_payments WHERE transfer_id = p_transfer_id)
      OR EXISTS (SELECT 1 FROM batch_payments WHERE transfer_id = p_transfer_id)
      OR EXISTS (SELECT 1 FROM payroll WHERE transfer_id = p_transfer_id)
      OR EXISTS (SELECT 1 FROM vrf_payment_parts WHERE transfer_id = p_transfer_id AND reversed_at IS NULL
                   AND id IS DISTINCT FROM p_except_part)
$function$;

CREATE OR REPLACE FUNCTION public.record_vrf_part(p_vrf_id uuid, p_account_id uuid, p_amount numeric,
  p_transfer_id uuid DEFAULT NULL, p_sent_date date DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v record; t record; v_sent numeric; v_date date; v_part uuid; v_net numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can record a VRF payment';
  END IF;
  SELECT * INTO v FROM vendor_receipt_facilitation WHERE id = p_vrf_id AND NOT is_archived FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VRF not found'; END IF;
  IF v.payment_state <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved VRF can be paid (this one is %)', replace(v.payment_state, '_', ' ');
  END IF;
  IF v.out_transfer_id IS NOT NULL THEN RAISE EXCEPTION 'This VRF is already matched to one bank line'; END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id) THEN RAISE EXCEPTION 'Choose the account it was paid from'; END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Enter the amount of this part'; END IF;
  v_net := COALESCE(v.net_sent, v.amount_transferred, 0);
  SELECT COALESCE(sum(amount), 0) INTO v_sent FROM vrf_payment_parts WHERE vrf_id = p_vrf_id AND reversed_at IS NULL;
  IF v_sent + p_amount > v_net + 1 THEN
    RAISE EXCEPTION 'That is more than is left to send: % of % already sent, % left',
      to_char(v_sent, 'FM999,999,999,990.00'), to_char(v_net, 'FM999,999,999,990.00'), to_char(v_net - v_sent, 'FM999,999,999,990.00');
  END IF;
  IF p_transfer_id IS NOT NULL THEN
    SELECT * INTO t FROM transfers WHERE id = p_transfer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank line not found'; END IF;
    IF t.from_account_id IS DISTINCT FROM p_account_id THEN RAISE EXCEPTION 'That bank line is not from the account chosen'; END IF;
    IF abs(t.amount - p_amount) > greatest(50, p_amount * 0.01) THEN
      RAISE EXCEPTION 'That bank line (%) does not match this part (%)', t.amount, p_amount;
    END IF;
    IF transfer_in_use(p_transfer_id) THEN RAISE EXCEPTION 'That bank line is already matched to another payment'; END IF;
    v_date := t.date;
  ELSIF p_sent_date IS NULL THEN
    RAISE EXCEPTION 'Choose the bank line, or enter the date it was sent';
  ELSE
    v_date := p_sent_date;
  END IF;

  INSERT INTO vrf_payment_parts (vrf_id, account_id, amount, transfer_id, sent_date, note)
  VALUES (p_vrf_id, p_account_id, round(p_amount, 2), p_transfer_id, v_date, NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_part;

  PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
  IF v_sent + p_amount >= v_net - 1 THEN
    -- All of it has gone: the VRF is sent, as of the last part.
    UPDATE vendor_receipt_facilitation
       SET payment_state = 'sent', sent_by = auth.uid(),
           sent_date = (SELECT max(sent_date) FROM vrf_payment_parts WHERE vrf_id = p_vrf_id AND reversed_at IS NULL)
     WHERE id = p_vrf_id;
  ELSE
    UPDATE vendor_receipt_facilitation SET bank_date = bank_date WHERE id = p_vrf_id;
  END IF;
  PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
  RETURN v_part;
END $function$;

CREATE OR REPLACE FUNCTION public.reverse_vrf_part(p_part_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reverse a VRF payment';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why this part is being reversed'; END IF;
  SELECT * INTO p FROM vrf_payment_parts WHERE id = p_part_id AND reversed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That part is not there, or was already reversed'; END IF;
  IF p.transfer_id IS NOT NULL AND transfer_in_closed_period(p.transfer_id) THEN
    RAISE EXCEPTION 'Its bank line is in a closed period — reopen it first';
  END IF;
  UPDATE vrf_payment_parts SET reversed_at = now(), reversed_by = auth.uid(), reverse_reason = btrim(p_reason)
   WHERE id = p_part_id;
  PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
  UPDATE vendor_receipt_facilitation
     SET payment_state = CASE WHEN payment_state = 'sent' THEN 'approved' ELSE payment_state END,
         sent_by = CASE WHEN payment_state = 'sent' THEN NULL ELSE sent_by END,
         sent_date = CASE WHEN payment_state = 'sent' THEN NULL ELSE sent_date END
   WHERE id = p.vrf_id;
  PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
END $function$;

CREATE OR REPLACE FUNCTION public.match_vrf_part_to_transfer(p_part_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p record; t record;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a VRF payment to a bank line';
  END IF;
  SELECT * INTO p FROM vrf_payment_parts WHERE id = p_part_id AND reversed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That VRF part is not there'; END IF;
  IF p.transfer_id IS NOT NULL THEN RAISE EXCEPTION 'That VRF part already has a bank line'; END IF;
  SELECT * INTO t FROM transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank line not found'; END IF;
  IF t.from_account_id IS DISTINCT FROM p.account_id THEN RAISE EXCEPTION 'That bank line is not from the account this part was paid from'; END IF;
  IF abs(t.amount - p.amount) > greatest(50, p.amount * 0.01) THEN
    RAISE EXCEPTION 'That bank line (%) does not match this part (%)', t.amount, p.amount;
  END IF;
  IF transfer_in_use(p_transfer_id, p_part_id) THEN RAISE EXCEPTION 'That bank line is already matched to another payment'; END IF;
  UPDATE vrf_payment_parts SET transfer_id = p_transfer_id WHERE id = p_part_id;
  PERFORM vrf_touch(p.vrf_id);
END $function$;

-- Undo on a bank line releases the parts it matched.
CREATE OR REPLACE FUNCTION public.vrf_parts_release_transfer(p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE x record;
BEGIN
  FOR x IN UPDATE vrf_payment_parts SET transfer_id = NULL
            WHERE transfer_id = p_transfer_id AND reversed_at IS NULL RETURNING vrf_id LOOP
    PERFORM vrf_touch(x.vrf_id);
  END LOOP;
END $function$;

REVOKE EXECUTE ON FUNCTION vrf_touch(uuid), transfer_in_use(uuid, uuid), vrf_parts_release_transfer(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_vrf_part(uuid, uuid, numeric, uuid, date, text), reverse_vrf_part(uuid, text),
  match_vrf_part_to_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_vrf_part(uuid, uuid, numeric, uuid, date, text), reverse_vrf_part(uuid, text),
  match_vrf_part_to_transfer(uuid, uuid) TO authenticated;


-- ── Existing functions and views, edited in place ─────────────────────
-- Each edit checks its anchor is there and stops the migration if not.
DO $$
DECLARE d text; n text;
BEGIN
  -- The VRF's bank date: its own line, else its last part's.
  d := pg_get_functiondef('public.vrf_derive'::regproc);
  n := replace(d, 'NEW.bank_date := (SELECT t.date FROM transfers t WHERE t.id = NEW.out_transfer_id);',
    'NEW.bank_date := COALESCE((SELECT t.date FROM transfers t WHERE t.id = NEW.out_transfer_id),
    (SELECT max(p.bank_date) FROM vrf_payment_parts p WHERE p.vrf_id = NEW.id AND p.reversed_at IS NULL));');
  IF n = d THEN RAISE EXCEPTION '454: vrf_derive anchor missing'; END IF;
  EXECUTE n;

  -- Marking the whole VRF sent is for one line; a VRF in parts goes on in parts.
  d := pg_get_functiondef('public.mark_vrf_sent'::regproc);
  n := replace(d, E'  IF p_transfer_id IS NOT NULL THEN\n    SELECT * INTO t FROM transfers WHERE id = p_transfer_id;',
E'  IF EXISTS (SELECT 1 FROM vrf_payment_parts WHERE vrf_id = p_vrf_id AND reversed_at IS NULL) THEN
    RAISE EXCEPTION ''This VRF is being paid in parts — record the rest as a part'';
  END IF;
  IF p_transfer_id IS NOT NULL THEN
    SELECT * INTO t FROM transfers WHERE id = p_transfer_id;');
  IF n = d THEN RAISE EXCEPTION '454: mark_vrf_sent anchor 1 missing'; END IF;
  d := n;
  n := replace(d, 'OR EXISTS (SELECT 1 FROM payroll WHERE transfer_id = p_transfer_id) THEN',
    'OR EXISTS (SELECT 1 FROM payroll WHERE transfer_id = p_transfer_id)
       OR EXISTS (SELECT 1 FROM vrf_payment_parts WHERE transfer_id = p_transfer_id AND reversed_at IS NULL) THEN');
  IF n = d THEN RAISE EXCEPTION '454: mark_vrf_sent anchor 2 missing'; END IF;
  EXECUTE n;

  -- Bank reconciliation: a line can pay a VRF part.
  d := pg_get_functiondef('public.apply_bank_line_match'::regproc);
  n := replace(d, 'IF p_kind IN (''expense'', ''expense_part'', ''batch'', ''vrf'', ''payroll'') AND l.direction <> ''debit'' THEN',
    'IF p_kind IN (''expense'', ''expense_part'', ''batch'', ''vrf'', ''vrf_part'', ''payroll'') AND l.direction <> ''debit'' THEN');
  IF n = d THEN RAISE EXCEPTION '454: apply_bank_line_match anchor 1 missing'; END IF;
  d := n;
  n := replace(d, '  ELSIF p_kind = ''internal_line'' THEN',
'  ELSIF p_kind = ''vrf_part'' THEN
    PERFORM match_vrf_part_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET match_status = ''manual'' WHERE id = p_line_id;
  ELSIF p_kind = ''internal_line'' THEN');
  IF n = d THEN RAISE EXCEPTION '454: apply_bank_line_match anchor 2 missing'; END IF;
  EXECUTE n;
END $$;

-- Undo on a bank line releases the parts it matched. (The anchor is built in
-- two pieces: as one string the migration tool takes it for an UPDATE with no
-- WHERE and holds it for confirmation.)
DO $$
DECLARE d text; n text; anchor text := '    UPDATE bank_statement_' || 'lines SET matched_expense_id = NULL, matched_sale_id = NULL,';
BEGIN
  d := pg_get_functiondef('public.unmatch_bank_line'::regproc);
  n := replace(d, anchor, '    PERFORM vrf_parts_release_transfer(l.transfer_id);' || chr(10) || anchor);
  IF n = d THEN RAISE EXCEPTION '454: unmatch_bank_line anchor missing'; END IF;
  EXECUTE n;
END $$;

-- Ledger: one entry per part, from its own bank, on its bank date; the
-- commission once, when the VRF is complete.
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.vrf_sync_ledger'::regproc);
  n := replace(d, '    IF v.payment_state = ''sent'' AND fiscal_period_for_date(COALESCE(v.bank_date, v.sent_date, v.trxn_date)) = v_fy AND COALESCE(v.net_sent, 0) > 0 THEN',
'    IF EXISTS (SELECT 1 FROM vrf_payment_parts p WHERE p.vrf_id = v.id AND p.reversed_at IS NULL) THEN
      FOR r IN SELECT p.*, COALESCE(p.bank_date, p.sent_date) AS on_date FROM vrf_payment_parts p
                WHERE p.vrf_id = v.id AND p.reversed_at IS NULL ORDER BY COALESCE(p.bank_date, p.sent_date), p.created_at LOOP
        CONTINUE WHEN fiscal_period_for_date(r.on_date) IS DISTINCT FROM v_fy;
        SELECT id INTO v_bank FROM chart_of_accounts WHERE linked_account_id = r.account_id;
        IF v_bank IS NULL OR v_transit IS NULL THEN
          PERFORM log_posting_failure(''vendor_receipt_facilitation'', v.id,
            format(''Cannot post a part of %s: the account it was sent from has no ledger account'', v_label));
          CONTINUE;
        END IF;
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
        VALUES (r.on_date, ''operational'', ''vendor_receipt_facilitation'', v.id, ''VRF part sent: '' || v_label, auth.uid())
        RETURNING id INTO v_entry;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry, v_transit, r.amount, 0, ''Sent for '' || v_label),
          (v_entry, v_bank, 0, r.amount, ''Paid from bank'');
      END LOOP;
      IF v.payment_state = ''sent'' AND COALESCE(v.commission_amount, 0) > 0 AND v_comm IS NOT NULL AND v_transit IS NOT NULL
         AND fiscal_period_for_date(COALESCE(v.bank_date, v.sent_date, v.trxn_date)) = v_fy THEN
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
        VALUES (COALESCE(v.bank_date, v.sent_date, v.trxn_date), ''operational'', ''vendor_receipt_facilitation'', v.id, ''VRF commission: '' || v_label, auth.uid())
        RETURNING id INTO v_entry;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry, v_comm, v.commission_amount, 0, ''Commission on '' || v_label),
          (v_entry, v_transit, 0, v.commission_amount, ''Commission kept back'');
      END IF;
    ELSIF v.payment_state = ''sent'' AND fiscal_period_for_date(COALESCE(v.bank_date, v.sent_date, v.trxn_date)) = v_fy AND COALESCE(v.net_sent, 0) > 0 THEN');
  IF n = d THEN RAISE EXCEPTION '454: vrf_sync_ledger anchor missing'; END IF;
  EXECUTE n;
END $$;

-- Views: parts are payments like any other.
DO $$
DECLARE d text; n text;
BEGIN
  -- Bank line status: a line that paid a part shows that VRF and the part's amount.
  d := pg_get_viewdef('public.v_bank_line_status'::regclass);
  n := replace(d, $q$'amount', COALESCE(v.net_sent, v.amount_transferred)) AS jsonb_build_object
                   FROM vendor_receipt_facilitation v
                  WHERE (v.out_transfer_id = b_1.transfer_id)$q$,
    $q$'amount', COALESCE(( SELECT sum(p.amount) FROM vrf_payment_parts p WHERE ((p.vrf_id = v.id) AND (p.transfer_id = b_1.transfer_id) AND (p.reversed_at IS NULL))), v.net_sent, v.amount_transferred)) AS jsonb_build_object
                   FROM vendor_receipt_facilitation v
                  WHERE ((v.out_transfer_id = b_1.transfer_id) OR (EXISTS ( SELECT 1 FROM vrf_payment_parts p WHERE ((p.vrf_id = v.id) AND (p.transfer_id = b_1.transfer_id) AND (p.reversed_at IS NULL)))))$q$);
  IF n = d THEN RAISE EXCEPTION '454: v_bank_line_status anchor missing'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_bank_line_status WITH (security_invoker = true) AS ' || n;

  -- Account control: parts sent but not yet on a statement, by their own account.
  d := pg_get_viewdef('public.v_account_control'::regclass);
  n := replace(d, $q$WHERE ((v.payment_state = 'sent'::text) AND (v.out_transfer_id IS NULL) AND (NOT v.is_archived) AND (v.initial_account_id IS NOT NULL))) x$q$,
    $q$WHERE ((v.payment_state = 'sent'::text) AND (v.out_transfer_id IS NULL) AND (NOT v.is_archived) AND (v.initial_account_id IS NOT NULL)
       AND (NOT (EXISTS ( SELECT 1 FROM vrf_payment_parts p WHERE ((p.vrf_id = v.id) AND (p.reversed_at IS NULL))))))
                UNION ALL
                 SELECT p.account_id, p.amount
                   FROM (vrf_payment_parts p JOIN vendor_receipt_facilitation v ON ((v.id = p.vrf_id)))
                  WHERE ((p.reversed_at IS NULL) AND (p.transfer_id IS NULL) AND (NOT v.is_archived))) x$q$);
  IF n = d THEN RAISE EXCEPTION '454: v_account_control anchor missing'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_account_control WITH (security_invoker = true) AS ' || n;

  -- Payment ↔ bank check: each part is a payment of its own.
  d := pg_get_viewdef('public.v_payment_bank_check'::regclass);
  n := replace(d, $q$FROM vendor_receipt_facilitation f
          WHERE ((f.payment_state = 'sent'::text) AND (NOT f.is_archived))$q$,
    $q$FROM vendor_receipt_facilitation f
          WHERE ((f.payment_state = 'sent'::text) AND (NOT f.is_archived)
            AND (NOT (EXISTS ( SELECT 1 FROM vrf_payment_parts p WHERE ((p.vrf_id = f.id) AND (p.reversed_at IS NULL))))))
        UNION ALL
         SELECT 'vrf'::text, f.id, p.id, (COALESCE(f.record_name, 'VRF'::text) || ' · part'::text), f.facilitator_name,
            'Vendor receipt facilitation'::text, p.amount, p.account_id, p.sent_date, p.sent_by, NULL::text AS text,
            p.transfer_id, 'transfer'::text, 'sent'::text
           FROM (vrf_payment_parts p JOIN vendor_receipt_facilitation f ON ((f.id = p.vrf_id)))
          WHERE ((p.reversed_at IS NULL) AND (NOT f.is_archived))$q$);
  IF n = d THEN RAISE EXCEPTION '454: v_payment_bank_check anchor missing'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_payment_bank_check WITH (security_invoker = true) AS ' || n;

  -- Cash ledger: a VRF's bank entries are on the statement through its parts' lines too.
  d := pg_get_viewdef('public.v_cash_ledger_lines'::regclass);
  n := replace(d, $q$((bl.transfer_id = v.out_transfer_id) OR (bl.transfer_id IN ( SELECT r.transfer_id$q$,
    $q$((bl.transfer_id = v.out_transfer_id) OR (bl.transfer_id IN ( SELECT p.transfer_id FROM vrf_payment_parts p WHERE ((p.vrf_id = v.id) AND (p.reversed_at IS NULL)))) OR (bl.transfer_id IN ( SELECT r.transfer_id$q$);
  IF n = d THEN RAISE EXCEPTION '454: v_cash_ledger_lines anchor missing'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_cash_ledger_lines WITH (security_invoker = true) AS ' || n;

  -- The register: how much has gone out in parts.
  d := pg_get_viewdef('public.v_vrf_register'::regclass);
  n := replace(d, E'f.wht_in_deal,\n    f.bank_date\n   FROM',
    E'f.wht_in_deal,\n    f.bank_date,\n    ( SELECT COALESCE(sum(p.amount), (0)::numeric) FROM vrf_payment_parts p WHERE ((p.vrf_id = f.id) AND (p.reversed_at IS NULL))) AS sent_in_parts,\n    ( SELECT (count(*))::integer FROM vrf_payment_parts p WHERE ((p.vrf_id = f.id) AND (p.reversed_at IS NULL))) AS parts_count\n   FROM');
  IF n = d THEN RAISE EXCEPTION '454: v_vrf_register anchor missing'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_vrf_register WITH (security_invoker = true) AS ' || n;
END $$;

-- A corrected bank line date reaches VRF parts too (extends 451/453).
CREATE OR REPLACE FUNCTION public.trg_bank_date_from_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE x record;
BEGIN
  PERFORM touch_expense_bank_dates(ARRAY(
    SELECT id FROM expenses WHERE transfer_id = NEW.id
    UNION SELECT x.expense_id FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id WHERE b.transfer_id = NEW.id
    UNION SELECT e.id FROM expenses e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id) WHERE v.out_transfer_id = NEW.id
    UNION SELECT q.expense_id FROM expense_payments q WHERE q.transfer_id = NEW.id));
  FOR x IN UPDATE vrf_payment_parts SET transfer_id = transfer_id WHERE transfer_id = NEW.id RETURNING vrf_id LOOP
    PERFORM vrf_touch(x.vrf_id);
  END LOOP;
  IF EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE out_transfer_id = NEW.id) THEN
    PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
    UPDATE vendor_receipt_facilitation SET bank_date = NEW.date WHERE out_transfer_id = NEW.id;
    PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
  END IF;
  RETURN NULL;
END $function$;
