-- 323 (POST-MERGE) — new VRFs are recorded the structured way only
--
-- Apply only after the frontend that ships with 322 (the receipt-amount VRF
-- form) is merged AND its Vercel production deploy is READY. Until then the
-- old form still inserts VRFs with typed figures and no facilitator, which
-- this migration refuses.
--
-- From here on a new VRF must be recorded from its receipt amount
-- (structured) and carry a name and a facilitator. Existing records are
-- untouched: all 20 are already structured.

SET search_path TO public;

ALTER TABLE vendor_receipt_facilitation ALTER COLUMN structured SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.vrf_derive()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_vat numeric; v_wht jsonb; v_base numeric; v_thr numeric;
  v_returned numeric; v_expected numeric;
BEGIN
  -- Names cannot be blanked once given.
  IF TG_OP = 'UPDATE' AND OLD.record_name IS NOT NULL AND btrim(COALESCE(NEW.record_name, '')) = '' THEN
    RAISE EXCEPTION 'A VRF needs a name';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.facilitator_name IS NOT NULL AND btrim(COALESCE(NEW.facilitator_name, '')) = '' THEN
    RAISE EXCEPTION 'A VRF needs its facilitator';
  END IF;

  -- Every new VRF is recorded the structured way, with a name and facilitator.
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.structured THEN RAISE EXCEPTION 'Record a new VRF from its receipt amount'; END IF;
    IF btrim(COALESCE(NEW.record_name, '')) = '' THEN RAISE EXCEPTION 'A VRF needs a name'; END IF;
    IF btrim(COALESCE(NEW.facilitator_name, '')) = '' THEN RAISE EXCEPTION 'A VRF needs its facilitator'; END IF;
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
