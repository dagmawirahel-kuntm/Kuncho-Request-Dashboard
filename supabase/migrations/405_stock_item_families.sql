-- 405 — Variants that are separate stock items: product families
--
-- The worst "price rises" in Market Trends are not rises. A small paint
-- brush (15 ETB) and a large one (608) were both bought as "Brush"; a 3 L
-- and a 15 L tin of the same Jotun colour are two items with nothing
-- tying them together, so nobody can compare them.
--
-- item_variants (365) splits ONE stock item into versions. This adds the
-- other direction: several existing stock items marked as variants of one
-- product, each keeping its own stock, code and history.
--   • stock_item_families — the product ("Jotun White", "MDF", "Golden
--     screw"), with the unit its variants compare in (L, kg, m…).
--   • stock_items.family_id / variant_label / pack_qty — which product an
--     item is a version of, how it differs ("3 L tin", "18 mm"), and how
--     many of the family's base unit one stock unit holds (3 for a 3 L tin)
--     so prices compare per litre/kg/m across sizes.
--   • link_stock_item_variant() / unlink_stock_item_variant() — nothing is
--     moved or merged; unlinking is always possible.
--   • move_market_prices() — a price recorded against the wrong item (the
--     608 ETB brush under the 15 ETB one) moves to the right one, so each
--     item's trend compares like with like.
--   • v_stock_item_family_prices — every family with its variants side by
--     side: latest price, change, and price per base unit.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS stock_item_families (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  base_unit   text,
  notes       text,
  created_by  uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_item_families_name ON stock_item_families (lower(btrim(name)));
COMMENT ON TABLE stock_item_families IS 'A product whose versions are separate stock items (405).';

ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS family_id uuid REFERENCES stock_item_families(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_label text,
  ADD COLUMN IF NOT EXISTS pack_qty numeric CHECK (pack_qty IS NULL OR pack_qty > 0);
CREATE INDEX IF NOT EXISTS idx_stock_items_family ON stock_items (family_id) WHERE family_id IS NOT NULL;
COMMENT ON COLUMN stock_items.variant_label IS 'How this version differs within its family: "3 L tin", "18 mm" (405).';
COMMENT ON COLUMN stock_items.pack_qty IS 'Family base units in one stock unit — 3 for a 3 L tin when the family compares per L (405).';

ALTER TABLE stock_item_families ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_item_families_read ON stock_item_families FOR SELECT USING (auth.uid() IS NOT NULL);
-- Written through the functions below only.

-- Mark p_item as a variant of a family: the one given, else one found or
-- created by name. Returns the family.
CREATE OR REPLACE FUNCTION public.link_stock_item_variant(p_item uuid, p_family uuid DEFAULT NULL, p_family_name text DEFAULT NULL,
  p_label text DEFAULT NULL, p_pack_qty numeric DEFAULT NULL, p_base_unit text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_family uuid := p_family; v_item stock_items%ROWTYPE; v_other stock_items%ROWTYPE;
BEGIN
  PERFORM assert_stock_catalog_role();
  SELECT * INTO v_item FROM stock_items WHERE id = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock item not found'; END IF;
  IF p_pack_qty IS NOT NULL AND p_pack_qty <= 0 THEN RAISE EXCEPTION 'The pack size must be more than 0'; END IF;

  IF v_family IS NULL THEN
    IF NULLIF(btrim(p_family_name), '') IS NULL THEN RAISE EXCEPTION 'Name the product this is a variant of'; END IF;
    SELECT id INTO v_family FROM stock_item_families WHERE lower(btrim(name)) = lower(btrim(p_family_name));
    IF v_family IS NULL THEN
      INSERT INTO stock_item_families (name, base_unit) VALUES (btrim(p_family_name), NULLIF(btrim(p_base_unit), ''))
      RETURNING id INTO v_family;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM stock_item_families WHERE id = v_family) THEN
    RAISE EXCEPTION 'That product no longer exists';
  END IF;

  -- Tools are tracked one by one; they only sit with other tools.
  SELECT * INTO v_other FROM stock_items WHERE family_id = v_family AND id <> p_item LIMIT 1;
  IF FOUND AND v_other.is_tool <> v_item.is_tool THEN
    RAISE EXCEPTION '"%" is a tool and "%" is not — they cannot be variants of one product',
      CASE WHEN v_item.is_tool THEN v_item.item_name ELSE v_other.item_name END,
      CASE WHEN v_item.is_tool THEN v_other.item_name ELSE v_item.item_name END;
  END IF;

  IF p_base_unit IS NOT NULL THEN
    UPDATE stock_item_families SET base_unit = COALESCE(base_unit, NULLIF(btrim(p_base_unit), '')) WHERE id = v_family;
  END IF;
  UPDATE stock_items
     SET family_id = v_family,
         variant_label = COALESCE(NULLIF(btrim(p_label), ''), variant_label),
         pack_qty = COALESCE(p_pack_qty, pack_qty),
         updated_at = now()
   WHERE id = p_item;
  RETURN v_family;
END $function$;

CREATE OR REPLACE FUNCTION public.unlink_stock_item_variant(p_item uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM assert_stock_catalog_role();
  UPDATE stock_items SET family_id = NULL, variant_label = NULL, pack_qty = NULL, updated_at = now() WHERE id = p_item;
END $function$;

CREATE OR REPLACE FUNCTION public.rename_stock_item_family(p_family uuid, p_name text, p_base_unit text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM assert_stock_catalog_role();
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'The product needs a name'; END IF;
  UPDATE stock_item_families SET name = btrim(p_name), base_unit = COALESCE(NULLIF(btrim(p_base_unit), ''), base_unit) WHERE id = p_family;
END $function$;

-- A price recorded against the wrong item moves to the right one. It
-- leaves any variant tag behind (that belonged to the old item) and is
-- marked reviewed with the reason.
CREATE OR REPLACE FUNCTION public.move_market_prices(p_price_ids uuid[], p_stock_item_id uuid, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_count integer;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'procurement_officer', 'stock_manager') THEN
    RAISE EXCEPTION 'Only procurement or stock can move prices';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_items WHERE id = p_stock_item_id AND active) THEN
    RAISE EXCEPTION 'Pick an active stock item to move the price to';
  END IF;
  UPDATE market_prices
     SET stock_item_id = p_stock_item_id,
         variant_id = NULL,
         review_note = COALESCE(NULLIF(btrim(p_note), ''), 'Moved to the right item'),
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = ANY (p_price_ids) AND stock_item_id IS DISTINCT FROM p_stock_item_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;

REVOKE EXECUTE ON FUNCTION link_stock_item_variant(uuid, uuid, text, text, numeric, text), unlink_stock_item_variant(uuid),
  rename_stock_item_family(uuid, text, text), move_market_prices(uuid[], uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION link_stock_item_variant(uuid, uuid, text, text, numeric, text), unlink_stock_item_variant(uuid),
  rename_stock_item_family(uuid, text, text), move_market_prices(uuid[], uuid, text) TO authenticated;

-- Every family with its variants side by side.
CREATE OR REPLACE VIEW public.v_stock_item_family_prices WITH (security_invoker = true) AS
SELECT f.id AS family_id, f.name AS family_name, f.base_unit,
       si.id AS stock_item_id, si.item_name, si.item_code, si.unit, si.variant_label, si.pack_qty, si.catalog_status,
       lp.display_price AS latest_price, lp.display_price_sourced_at AS latest_at, lp.change_vs_previous_pct,
       lp.min_180d, lp.max_180d, lp.prices_180d,
       CASE WHEN si.pack_qty IS NOT NULL AND lp.display_price IS NOT NULL THEN round(lp.display_price / si.pack_qty, 2) END AS price_per_base,
       (SELECT count(*) FROM stock_items x WHERE x.family_id = f.id AND x.active) AS family_size
  FROM stock_item_families f
  JOIN stock_items si ON si.family_id = f.id AND si.active
  LEFT JOIN v_stock_item_latest_price lp ON lp.stock_item_id = si.id;
GRANT SELECT ON v_stock_item_family_prices TO authenticated;
