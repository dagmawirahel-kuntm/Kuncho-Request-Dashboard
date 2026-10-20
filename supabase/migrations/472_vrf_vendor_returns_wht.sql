-- 472: VRF — the vendor that hands the WHT back.
--
-- With the WHT held back (453's "Out of what the vendor is sent"), we send
-- the receipt amount less WHT and pay the WHT to the tax office; the vendor
-- returns what they were sent less their commission. Some vendors ignore the
-- withholding: they take only their commission off the whole receipt amount
-- and return the rest — so the WHT comes back to us with the return.
-- Four VRFs already came back over by exactly their WHT (VRF-20260925-02,
-- VRF-20260820-01/-02, VRF-20260715-01), shown as "more came back than
-- expected" and left in VRF funds in transit.
--
--   • wht_returned — only with the WHT held back: the vendor returns
--     receipt − commission. What is sent is unchanged; what should come
--     back, the status, what is unaccounted for and the real cost (commission
--     only — the WHT came back) follow it. The WHT is still owed and counted.
--   • Ledger: when such a VRF is sent, the WHT to come back is put in transit
--     against Withholding tax payable (2025), so the return clears transit.

SET search_path TO public;

ALTER TABLE vendor_receipt_facilitation
  ADD COLUMN IF NOT EXISTS wht_returned boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN vendor_receipt_facilitation.wht_returned IS 'With the WHT held back (wht_in_deal): the vendor still returns receipt − commission, handing the WHT back (472).';

ALTER TABLE vendor_receipt_facilitation
  ALTER COLUMN expected_return SET EXPRESSION AS (receipt_amount - CASE WHEN wht_in_deal AND NOT wht_returned THEN COALESCE(wht_amount, 0) ELSE 0 END - COALESCE(commission_amount, 0));

-- The derivation: only held-back WHT can be handed back; the cost and the
-- settled check follow it.
DO $$
DECLARE
  d text;
  p text[][] := ARRAY[
    ARRAY['  NEW.amount_transferred    := NEW.receipt_amount - CASE WHEN NEW.wht_in_deal THEN COALESCE(NEW.wht_amount, 0) ELSE 0 END;',
          '  -- Only WHT held back can be handed back by the vendor (472).
  IF NOT NEW.wht_in_deal THEN NEW.wht_returned := false; END IF;
  NEW.amount_transferred    := NEW.receipt_amount - CASE WHEN NEW.wht_in_deal THEN COALESCE(NEW.wht_amount, 0) ELSE 0 END;'],
    ARRAY['  NEW.net_facilitation_cost := COALESCE(NEW.commission_amount, 0) + COALESCE(NEW.wht_amount, 0);',
          '  NEW.net_facilitation_cost := COALESCE(NEW.commission_amount, 0) + CASE WHEN NEW.wht_returned THEN 0 ELSE COALESCE(NEW.wht_amount, 0) END;'],
    ARRAY['  v_expected := NEW.amount_transferred - COALESCE(NEW.commission_amount, 0);',
          '  v_expected := NEW.amount_transferred - COALESCE(NEW.commission_amount, 0) + CASE WHEN NEW.wht_returned THEN COALESCE(NEW.wht_amount, 0) ELSE 0 END;']];
  i int;
BEGIN
  d := pg_get_functiondef('vrf_derive'::regproc);
  IF position('wht_returned' IN d) > 0 THEN RETURN; END IF;
  FOR i IN 1 .. array_length(p, 1) LOOP
    IF (length(d) - length(replace(d, p[i][1], ''))) / length(p[i][1]) <> 1 THEN
      RAISE EXCEPTION 'vrf_derive has changed — review 472 (%)', p[i][1];
    END IF;
    d := replace(d, p[i][1], p[i][2]);
  END LOOP;
  EXECUTE d;
END $$;

-- The ledger: the WHT to come back sits in transit, owed to the tax office.
DO $$
DECLARE
  d text;
  p text[][] := ARRAY[
    ARRAY['  v_fy uuid; v_transit uuid; v_comm uuid; v_bank uuid; v_hold uuid; v_entry uuid; v_label text;',
          '  v_fy uuid; v_transit uuid; v_comm uuid; v_bank uuid; v_hold uuid; v_entry uuid; v_label text; v_whtp uuid;'],
    ARRAY['    FOR r IN SELECT * FROM vrf_returns WHERE vrf_id = v.id ORDER BY return_date, created_at LOOP',
          '    -- A vendor that hands the WHT back returns more than was sent, by the
    -- WHT we owe the tax office (472).
    IF v.wht_returned AND COALESCE(v.wht_amount, 0) > 0 AND v.payment_state = ''sent''
       AND fiscal_period_for_date(COALESCE(v.bank_date, v.sent_date, v.trxn_date)) = v_fy THEN
      SELECT id INTO v_whtp FROM chart_of_accounts WHERE account_code = ''2025'';
      IF v_whtp IS NULL OR v_transit IS NULL THEN
        PERFORM log_posting_failure(''vendor_receipt_facilitation'', v.id,
          format(''Cannot post the WHT handed back on %s: no Withholding tax payable account'', v_label));
      ELSE
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
        VALUES (COALESCE(v.bank_date, v.sent_date, v.trxn_date), ''operational'', ''vendor_receipt_facilitation'', v.id, ''VRF WHT handed back: '' || v_label, auth.uid())
        RETURNING id INTO v_entry;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry, v_transit, v.wht_amount, 0, ''WHT to come back with the return''),
          (v_entry, v_whtp, 0, v.wht_amount, ''WHT owed to the tax office'');
      END IF;
    END IF;
    FOR r IN SELECT * FROM vrf_returns WHERE vrf_id = v.id ORDER BY return_date, created_at LOOP']];
  i int;
BEGIN
  d := pg_get_functiondef('vrf_sync_ledger'::regproc);
  IF position('wht_returned' IN d) > 0 THEN RETURN; END IF;
  FOR i IN 1 .. array_length(p, 1) LOOP
    IF (length(d) - length(replace(d, p[i][1], ''))) / length(p[i][1]) <> 1 THEN
      RAISE EXCEPTION 'vrf_sync_ledger has changed — review 472 (%)', p[i][1];
    END IF;
    d := replace(d, p[i][1], p[i][2]);
  END LOOP;
  EXECUTE d;
END $$;

-- The register: handed-back WHT is not a reason for less to come back.
DO $$
DECLARE
  d text;
  p text[][] := ARRAY[
    ARRAY['WHEN f.wht_in_deal THEN COALESCE(f.wht_amount, (0)::numeric)',
          'WHEN (f.wht_in_deal AND NOT f.wht_returned) THEN COALESCE(f.wht_amount, (0)::numeric)'],
    ARRAY[') AS parts_count
   FROM',
          ') AS parts_count,
    f.wht_returned
   FROM']];
  i int;
BEGIN
  d := pg_get_viewdef('v_vrf_register'::regclass);
  IF position('wht_returned' IN d) > 0 THEN RETURN; END IF;
  FOR i IN 1 .. array_length(p, 1) LOOP
    IF (length(d) - length(replace(d, p[i][1], ''))) / length(p[i][1]) <> 1 THEN
      RAISE EXCEPTION 'v_vrf_register has changed — review 472 (%)', p[i][1];
    END IF;
    d := replace(d, p[i][1], p[i][2]);
  END LOOP;
  EXECUTE 'CREATE OR REPLACE VIEW v_vrf_register WITH (security_invoker = true) AS ' || d;
END $$;
