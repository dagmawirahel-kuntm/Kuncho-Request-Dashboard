-- 453 — VRF: WHT is always worked out and kept; the deal decides who bears it.
--         Plus the date of the bank payment the VRF is matched to.
--
-- A vendor may agree that the withholding comes out of their money (we send
-- the receipt amount less WHT), or insist on the full receipt amount (we
-- send it all and pay the WHT to the tax office on top). The only way to
-- record the second was to tick "Enter myself" and type 0 — and the WHT
-- vanished from the tax books: 6 VRFs, ETB 129,718 of withholding.
--
--   • wht_in_deal — true: WHT comes out of what is sent (as before);
--     false: the vendor is sent the full receipt amount. Either way the WHT
--     is calculated, stored in wht_amount and counted in WHT payable.
--   • net_sent / amount_transferred / expected_return follow the deal.
--   • The 6 zeroed VRFs get their WHT back, marked "not in the deal" (what
--     was actually sent is unchanged).
--   • bank_date — the value date of the bank line the VRF's payment is
--     matched to; WHT is filed by it, the ledger's "VRF sent" entry is dated
--     by it, and the screens show it.

SET search_path TO public;

ALTER TABLE vendor_receipt_facilitation
  ADD COLUMN IF NOT EXISTS wht_in_deal boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bank_date date;
COMMENT ON COLUMN vendor_receipt_facilitation.wht_in_deal IS 'true: WHT is taken out of what is sent; false: the vendor is sent the full receipt amount and the WHT is paid on top. WHT is calculated and counted either way (453).';
COMMENT ON COLUMN vendor_receipt_facilitation.bank_date IS 'Value date of the bank line this VRF''s payment is matched to (453).';

-- What is sent, and what should come back, follow the deal.
ALTER TABLE vendor_receipt_facilitation
  ALTER COLUMN net_sent SET EXPRESSION AS (receipt_amount - CASE WHEN wht_in_deal THEN COALESCE(wht_amount, 0) ELSE 0 END);
ALTER TABLE vendor_receipt_facilitation
  ALTER COLUMN expected_return SET EXPRESSION AS (receipt_amount - CASE WHEN wht_in_deal THEN COALESCE(wht_amount, 0) ELSE 0 END - COALESCE(commission_amount, 0));

-- The derivation: WHT always from the rate rules (a hand-entered amount is
-- kept only as a correction, never as a way to drop it); sent = receipt less
-- WHT only when the WHT is in the deal; the bank date from the matched line.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('vrf_derive'::regproc);
  IF position('  IF NOT NEW.wht_overridden THEN' in d) = 0
     OR position('  NEW.amount_transferred    := NEW.receipt_amount - COALESCE(NEW.wht_amount, 0);' in d) = 0
     OR position('NEW.wht_amount IS DISTINCT FROM OLD.wht_amount OR NEW.wht_overridden IS DISTINCT FROM OLD.wht_overridden' in d) = 0
     OR position('  -- The payment step moves only through approve_vrf_payment / mark_vrf_sent.' in d) = 0 THEN
    RAISE EXCEPTION 'vrf_derive has changed — review 453';
  END IF;
  d := replace(d, '  IF NOT NEW.wht_overridden THEN',
'  -- A hand-entered WHT of 0 used to stand for "the vendor gets the full
  -- amount". That is now the deal flag; the WHT itself is always counted.
  IF NEW.wht_overridden AND COALESCE(NEW.wht_amount, 0) = 0 THEN
    NEW.wht_overridden := false;
  END IF;
  IF NOT NEW.wht_overridden THEN');
  d := replace(d, '  -- The payment step moves only through approve_vrf_payment / mark_vrf_sent.',
'  NEW.bank_date := (SELECT t.date FROM transfers t WHERE t.id = NEW.out_transfer_id);
  -- The payment step moves only through approve_vrf_payment / mark_vrf_sent.');
  d := replace(d, '  NEW.amount_transferred    := NEW.receipt_amount - COALESCE(NEW.wht_amount, 0);',
                  '  NEW.amount_transferred    := NEW.receipt_amount - CASE WHEN NEW.wht_in_deal THEN COALESCE(NEW.wht_amount, 0) ELSE 0 END;');
  -- Changing the deal after approval changes what is paid: back to approval.
  d := replace(d, 'NEW.wht_amount IS DISTINCT FROM OLD.wht_amount OR NEW.wht_overridden IS DISTINCT FROM OLD.wht_overridden',
                  'NEW.wht_amount IS DISTINCT FROM OLD.wht_amount OR NEW.wht_overridden IS DISTINCT FROM OLD.wht_overridden OR NEW.wht_in_deal IS DISTINCT FROM OLD.wht_in_deal');
  EXECUTE d;
END $$;

-- The ledger's "VRF sent" entry is dated by the bank.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('vrf_sync_ledger'::regproc);
  IF (length(d) - length(replace(d, 'COALESCE(v.sent_date, v.trxn_date)', ''))) / length('COALESCE(v.sent_date, v.trxn_date)') <> 2 THEN
    RAISE EXCEPTION 'vrf_sync_ledger has changed — review 453';
  END IF;
  EXECUTE replace(d, 'COALESCE(v.sent_date, v.trxn_date)', 'COALESCE(v.bank_date, v.sent_date, v.trxn_date)');
END $$;

-- WHT payable: the VRF rows go by the stored bank date (451 looked it up).
DO $$
DECLARE d text;
        old_vrf text := 'COALESCE(( SELECT t.date
                   FROM transfers t
                  WHERE (t.id = f.out_transfer_id)), f.sent_date, f.trxn_date)';
BEGIN
  d := pg_get_viewdef('v_wht_payable_by_ec_period'::regclass);
  IF position(old_vrf in d) = 0 THEN RAISE EXCEPTION 'v_wht_payable_by_ec_period has changed — review 453'; END IF;
  d := replace(d, old_vrf, 'COALESCE(f.bank_date, f.sent_date, f.trxn_date)');
  EXECUTE 'CREATE OR REPLACE VIEW v_wht_payable_by_ec_period WITH (security_invoker = true) AS ' || d;
END $$;

-- The register: what is unaccounted for follows the deal; the deal and the
-- bank date are shown.
DO $$
DECLARE d text;
        old_un text := '(((COALESCE(f.receipt_amount, f.amount_transferred, (0)::numeric) - COALESCE(f.money_returned, (0)::numeric)) - COALESCE(f.wht_amount, (0)::numeric)) - COALESCE(f.commission_amount, (0)::numeric)) AS unaccounted';
BEGIN
  d := pg_get_viewdef('v_vrf_register'::regclass);
  IF position(old_un in d) = 0 OR position('    f.sent_date
   FROM' in d) = 0 THEN RAISE EXCEPTION 'v_vrf_register has changed — review 453'; END IF;
  d := replace(d, old_un,
    '(((COALESCE(f.receipt_amount, f.amount_transferred, (0)::numeric) - COALESCE(f.money_returned, (0)::numeric)) - CASE WHEN f.wht_in_deal THEN COALESCE(f.wht_amount, (0)::numeric) ELSE (0)::numeric END) - COALESCE(f.commission_amount, (0)::numeric)) AS unaccounted');
  d := replace(d, '    f.sent_date
   FROM', '    f.sent_date,
    f.wht_in_deal,
    f.bank_date
   FROM');
  EXECUTE 'CREATE OR REPLACE VIEW v_vrf_register WITH (security_invoker = true) AS ' || d;
END $$;

-- A corrected bank line date reaches the VRFs it paid too (extends 451).
CREATE OR REPLACE FUNCTION public.trg_bank_date_from_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM touch_expense_bank_dates(ARRAY(
    SELECT id FROM expenses WHERE transfer_id = NEW.id
    UNION SELECT x.expense_id FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id WHERE b.transfer_id = NEW.id
    UNION SELECT e.id FROM expenses e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id) WHERE v.out_transfer_id = NEW.id
    UNION SELECT q.expense_id FROM expense_payments q WHERE q.transfer_id = NEW.id));
  IF EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE out_transfer_id = NEW.id) THEN
    PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
    UPDATE vendor_receipt_facilitation SET bank_date = NEW.date WHERE out_transfer_id = NEW.id;
    PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
  END IF;
  RETURN NULL;
END $function$;

-- ── Backfill ──────────────────────────────────────────────────────────
-- The ledger sync behind every VRF change runs as a finance user; post as
-- the first active admin, as the screens would.
DO $$
DECLARE adm uuid;
BEGIN
  SELECT id INTO adm FROM user_profiles WHERE role = 'admin' AND account_status = 'active' ORDER BY created_at LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
  -- WHT zeroed by hand: count it again, outside the deal (what was sent stays).
  UPDATE vendor_receipt_facilitation SET wht_in_deal = false, wht_overridden = false
   WHERE structured AND wht_overridden AND COALESCE(wht_amount, 0) = 0;
  -- Bank dates (and a re-post of each matched VRF's ledger entry on it).
  UPDATE vendor_receipt_facilitation SET bank_date = bank_date WHERE out_transfer_id IS NOT NULL;
  PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
END $$;
