-- 327 (POST-MERGE) — money comes back only after it went out
--
-- Apply only after the frontend with the VRF payment step (shipped with 326)
-- is merged AND both Vercel production deploys are READY: the form before it
-- offers returns on any VRF, and has no way to mark one sent.
--
-- A return can be recorded on a VRF only once its payment is sent. Returns
-- already recorded stay as they are (every VRF with one is sent since 326).

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.vrf_returns_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
       SELECT 1 FROM vendor_receipt_facilitation WHERE id = NEW.vrf_id AND payment_state = 'sent') THEN
    RAISE EXCEPTION 'Mark the VRF payment sent before recording money coming back';
  END IF;
  IF NEW.account_id IS NULL THEN
    SELECT return_account_id INTO NEW.account_id FROM vendor_receipt_facilitation WHERE id = NEW.vrf_id;
  END IF;
  IF NEW.account_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND is_vrf_holding) THEN
    RAISE EXCEPTION 'Returned money has to go to a holding account';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_returns_guard() FROM PUBLIC, anon;
