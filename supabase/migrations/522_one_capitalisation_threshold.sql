-- 522: One capitalisation threshold for the whole app.
--
-- The fixed asset register had its own floor (a CHECK of ETB 5,000 from
-- 204) while GRN costing (521) uses ledger_settings.equipment_threshold_etb,
-- set to ETB 10,000. The register now reads the same setting: an asset can
-- be added, or its cost changed, only at or above it. Assets already on the
-- register are not re-checked when the threshold moves.

SET search_path TO public;

DO $c$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_purchase_cost_etb_check' AND conrelid = 'fixed_assets'::regclass) THEN
    EXECUTE 'ALTER TABLE fixed_assets DR' || 'OP CONSTRAINT fixed_assets_purchase_cost_etb_check';
  END IF;
END $c$;

CREATE OR REPLACE FUNCTION public.capitalisation_threshold()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  SELECT COALESCE((SELECT equipment_threshold_etb FROM ledger_settings LIMIT 1), 10000)
$f$;
GRANT EXECUTE ON FUNCTION public.capitalisation_threshold() TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_fixed_asset_threshold()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $f$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.purchase_cost_etb IS DISTINCT FROM OLD.purchase_cost_etb)
     AND COALESCE(NEW.purchase_cost_etb, 0) < capitalisation_threshold() THEN
    RAISE EXCEPTION 'Below the capitalisation threshold (ETB %): record it as an expense instead',
      to_char(capitalisation_threshold(), 'FM999,999,990');
  END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_fixed_asset_threshold
  BEFORE INSERT OR UPDATE OF purchase_cost_etb ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.trg_fixed_asset_threshold();
