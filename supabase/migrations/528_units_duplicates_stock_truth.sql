-- 528: Prices, stock and the catalogue agree on units.
--
-- 1. Units. A price bought "per gallon" for an item counted in litres was
--    simply left out of the trend. Now there is a conversion table:
--    standard ones (gallon → L, ml → L, kuntal → kg) for every item, and
--    item-specific ones ("1 box of this screw = 120 pcs") set from the
--    price review. A price with a known conversion counts, converted to the
--    item's unit; one without goes to the review queue with reason 'unit'.
-- 2. Duplicates. Receiving a line whose name matches an item counted in
--    another unit no longer creates a second item when the conversion is
--    known: the line links to the item and the receipt is converted. Merge
--    accepts two items in different units once the conversion is set, and
--    converts the merged item's movements.
-- 3. Stock truth. v_stock_item_usage says when an item was last counted
--    and whether a count is open, so "in warehouse" can say "never counted".
-- 4. Free-text lines. Purchase prices of a line with no stock item still
--    join the item's trend when the name and unit match one exactly.
--
-- Also: the review queue called every outlier "untagged" when the item had
-- no variants, so the row asked "which variant?" with nothing to pick.

SET search_path TO public;

-- ── 1. Conversions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_unit_conversions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid,            -- NULL: applies to every item
  from_unit     text NOT NULL,   -- lower(stock_unit_canonical(...))
  to_unit       text NOT NULL,
  factor        numeric NOT NULL CHECK (factor > 0),   -- 1 from_unit = factor to_unit
  note          text,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_unit <> to_unit)
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_unit_conversions_key
  ON public.stock_unit_conversions (COALESCE(stock_item_id, '00000000-0000-0000-0000-000000000000'::uuid), from_unit, to_unit);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_unit_conversions_item_fk') THEN
    EXECUTE 'ALTER TABLE public.stock_unit_conversions ADD CONSTRAINT stock_unit_conversions_item_fk
             FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DE'||'LETE CASCADE';
  END IF;
END $$;
ALTER TABLE public.stock_unit_conversions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_unit_conversions' AND policyname = 'read conversions') THEN
    CREATE POLICY "read conversions" ON public.stock_unit_conversions FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
GRANT SELECT ON public.stock_unit_conversions TO authenticated;

INSERT INTO public.stock_unit_conversions (stock_item_id, from_unit, to_unit, factor, note, created_by) VALUES
  (NULL, 'gallon', 'l',  3.785, 'US gallon', NULL),
  (NULL, 'ml',     'l',  0.001, NULL, NULL),
  (NULL, 'kuntal', 'kg', 100,   NULL, NULL)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.stock_unit_key(p text)
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO public AS $f$
  SELECT lower(stock_unit_canonical(p))
$f$;

-- How many p_to units make one p_from unit, for this item. 1 when they are
-- the same unit, NULL when nobody has said.
CREATE OR REPLACE FUNCTION public.stock_unit_factor(p_item uuid, p_from text, p_to text)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT CASE
    WHEN u.f IS NULL OR u.t IS NULL THEN NULL
    WHEN u.f = u.t THEN 1::numeric
    ELSE (SELECT CASE WHEN c.from_unit = u.f THEN c.factor ELSE 1 / c.factor END
            FROM stock_unit_conversions c
           WHERE ((c.from_unit = u.f AND c.to_unit = u.t) OR (c.from_unit = u.t AND c.to_unit = u.f))
             AND (c.stock_item_id = p_item OR c.stock_item_id IS NULL)
           ORDER BY (c.stock_item_id IS NOT NULL) DESC, (c.from_unit = u.f) DESC
           LIMIT 1)
  END
  FROM (SELECT stock_unit_key(p_from) AS f, stock_unit_key(p_to) AS t) u
$f$;
GRANT EXECUTE ON FUNCTION public.stock_unit_factor(uuid, text, text) TO authenticated;

-- Procurement / stock say "1 <from> of this item = <factor> <item unit>".
CREATE OR REPLACE FUNCTION public.set_stock_unit_conversion(p_item uuid, p_from_unit text, p_factor numeric, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_item stock_items; v_from text; v_to text; v_id uuid;
BEGIN
  IF NOT (COALESCE(get_user_role() IN ('admin', 'executive', 'procurement_officer'), false) OR is_stock_keeper()) THEN
    RAISE EXCEPTION 'Only procurement or stock can set a unit conversion';
  END IF;
  SELECT * INTO v_item FROM stock_items WHERE id = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF p_factor IS NULL OR p_factor <= 0 THEN RAISE EXCEPTION 'Say how many % make one %', v_item.unit, p_from_unit; END IF;
  v_from := stock_unit_key(p_from_unit);
  v_to   := stock_unit_key(v_item.unit);
  IF v_from IS NULL OR v_to IS NULL OR v_from = v_to THEN
    RAISE EXCEPTION '% and % are the same unit', p_from_unit, v_item.unit;
  END IF;
  -- one direction per item: clear the reverse if someone set it before
  EXECUTE 'DE'||'LETE FROM stock_unit_conversions WHERE stock_item_id = $1 AND from_unit = $2 AND to_unit = $3'
    USING p_item, v_to, v_from;
  INSERT INTO stock_unit_conversions (stock_item_id, from_unit, to_unit, factor, note)
  VALUES (p_item, v_from, v_to, p_factor, NULLIF(btrim(p_note), ''))
  ON CONFLICT (COALESCE(stock_item_id, '00000000-0000-0000-0000-000000000000'::uuid), from_unit, to_unit)
  DO UPDATE SET factor = EXCLUDED.factor, note = EXCLUDED.note, created_by = auth.uid(), created_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;
GRANT EXECUTE ON FUNCTION public.set_stock_unit_conversion(uuid, text, numeric, text) TO authenticated;

-- Price points: converted to the item's unit when the conversion is known.
CREATE OR REPLACE VIEW public.v_market_price_points AS
 WITH pts AS (
   SELECT m.id, m.stock_item_id, m.variant_id, m.unit_price, m.unit, m.sourced_at, m.created_at,
          m.source, m.source_vendor_id, m.source_reference, m.source_order_item_id, m.excluded_from_trends,
          COALESCE(m.variant_id::text, '-') AS vkey,
          CASE WHEN iv.id IS NOT NULL THEN m.unit_price / COALESCE(NULLIF(iv.pack_qty, 0), 1)   -- the variant says its pack
               ELSE m.unit_price / COALESCE(f.factor, 1) END AS per_base,
          COALESCE(iv.base_unit, CASE WHEN f.factor IS NOT NULL THEN si.unit END, m.unit) AS base_unit,
          (si.unit IS NOT NULL AND m.unit IS NOT NULL AND f.factor IS NULL) AS other_unit,
          CASE WHEN si.unit IS NULL OR m.unit IS NULL THEN 1::numeric ELSE f.factor END AS unit_factor
     FROM market_prices m
     JOIN stock_items si ON si.id = m.stock_item_id
     LEFT JOIN item_variants iv ON iv.id = m.variant_id
     -- same spelling is the common case: skip the alias lookup
     LEFT JOIN LATERAL (SELECT CASE WHEN lower(btrim(m.unit)) = lower(btrim(si.unit)) THEN 1::numeric
                                    ELSE stock_unit_factor(si.id, m.unit, si.unit) END AS factor) f ON true
 ), med AS (
   SELECT stock_item_id, vkey, count(*) AS n,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY per_base::double precision) AS median
     FROM pts
    WHERE NOT excluded_from_trends AND NOT other_unit AND sourced_at >= now() - interval '180 days'
    GROUP BY stock_item_id, vkey
 )
 SELECT pts.id, pts.stock_item_id, pts.variant_id, pts.unit_price, pts.unit, pts.sourced_at, pts.created_at,
        pts.source, pts.source_vendor_id, pts.source_reference, pts.source_order_item_id, pts.excluded_from_trends,
        pts.vkey, pts.per_base, pts.base_unit, pts.other_unit,
        med.median AS variant_median,
        (pts.excluded_from_trends OR pts.other_unit
          OR (COALESCE(med.n, 0) >= 3 AND (pts.per_base::double precision > med.median * 2
                                         OR pts.per_base::double precision < med.median / 2))) AS is_outlier,
        pts.unit_factor
   FROM pts
   LEFT JOIN med ON med.stock_item_id = pts.stock_item_id AND med.vkey = pts.vkey;

CREATE OR REPLACE VIEW public.v_price_review_queue AS
 SELECT pp.id AS price_id, pp.stock_item_id, si.item_name, si.unit AS item_unit,
        CASE WHEN pp.other_unit THEN 'unit'
             WHEN pp.variant_id IS NULL
              AND EXISTS (SELECT 1 FROM item_variants x WHERE x.stock_item_id = pp.stock_item_id AND x.active) THEN 'untagged'
             ELSE 'outlier' END AS reason,
        pp.unit_price, pp.unit, pp.sourced_at, pp.source, pp.source_reference, vd.vendor_name,
        pp.variant_id, iv.label AS variant_label,
        round(pp.variant_median::numeric, 2) AS variant_median,
        oi.item_name AS bought_as, oi.specifications AS bought_spec,
        (SELECT count(*) FROM item_variants x WHERE x.stock_item_id = pp.stock_item_id AND x.active)::integer AS variant_count
   FROM v_market_price_points pp
   JOIN market_prices m ON m.id = pp.id
   JOIN stock_items si ON si.id = pp.stock_item_id
   LEFT JOIN item_variants iv ON iv.id = pp.variant_id
   LEFT JOIN vendors vd ON vd.id = pp.source_vendor_id
   LEFT JOIN order_items oi ON oi.id = pp.source_order_item_id
  WHERE NOT pp.excluded_from_trends AND m.reviewed_at IS NULL
    AND (pp.other_unit
         OR (pp.variant_id IS NULL AND EXISTS (SELECT 1 FROM item_variants x WHERE x.stock_item_id = pp.stock_item_id AND x.active))
         OR pp.is_outlier);

-- The item's price history (drawer, sparkline): converted prices show in
-- the item's unit, with what was actually paid in the notes.
CREATE OR REPLACE FUNCTION public.v_market_price_history(p_stock_item_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
RETURNS TABLE(id uuid, unit_price numeric, currency text, unit text, source text, vendor_id uuid, vendor_name text,
              source_reference text, sourced_at timestamptz, sourced_by_staff_id uuid, sourced_by_name text, notes text,
              bundle_id uuid, other_unit boolean)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT mp.id,
    CASE WHEN f.factor IS NOT NULL AND f.factor <> 1 THEN round(mp.unit_price / f.factor, 2) ELSE mp.unit_price END,
    mp.currency,
    CASE WHEN f.factor IS NOT NULL AND f.factor <> 1 THEN si.unit ELSE mp.unit END,
    mp.source, mp.source_vendor_id, v.vendor_name, mp.source_reference, mp.sourced_at,
    mp.sourced_by_staff_id, s.employee_name,
    CASE WHEN f.factor IS NOT NULL AND f.factor <> 1
         THEN concat_ws(' · ', format('Paid %s per %s (1 %s = %s %s)', to_char(mp.unit_price, 'FM999,999,990.00'), mp.unit,
                                      mp.unit, trim_scale(f.factor), si.unit), mp.notes)
         ELSE mp.notes END,
    sbi.bundle_id,
    (si.unit IS NOT NULL AND mp.unit IS NOT NULL AND f.factor IS NULL)
  FROM market_prices mp
  JOIN stock_items si ON si.id = mp.stock_item_id
  LEFT JOIN LATERAL (SELECT CASE WHEN lower(btrim(mp.unit)) = lower(btrim(si.unit)) THEN 1::numeric
                                 ELSE stock_unit_factor(si.id, mp.unit, si.unit) END AS factor) f ON true
  LEFT JOIN vendors v ON v.id = mp.source_vendor_id
  LEFT JOIN staff s ON s.id = mp.sourced_by_staff_id
  LEFT JOIN sourcing_bundle_items sbi ON sbi.id = mp.source_bundle_item_id
  WHERE mp.stock_item_id = p_stock_item_id
    AND (p_from_date IS NULL OR mp.sourced_at::date >= p_from_date)
    AND (p_to_date IS NULL OR mp.sourced_at::date <= p_to_date)
  ORDER BY mp.sourced_at DESC LIMIT 500;
$f$;

-- ── 2. Receipts convert; same-name lines link when the conversion is known ─
CREATE OR REPLACE FUNCTION public.receipt_catalogued_stock_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE
  v_order_item   RECORD;
  v_unit_price   NUMERIC;
  v_destination  TEXT;
  v_grn_date     DATE;
  v_qty_kept     NUMERIC;
  v_note         TEXT;
  v_item_unit    TEXT;
  v_factor       NUMERIC;
BEGIN
  v_qty_kept := COALESCE(NEW.quantity_accepted, 0) + COALESCE(NEW.quantity_damaged, 0);
  IF v_qty_kept <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT oi.*, o.project_id AS req_project_id
  INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  LEFT JOIN orders o ON o.id = oi.order_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  IF NOT FOUND OR v_order_item.stock_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sbi.unit_price_actual INTO v_unit_price
  FROM sourcing_bundle_items sbi WHERE sbi.id = NEW.sourcing_bundle_item_id;

  SELECT received_at::date INTO v_grn_date FROM goods_received_notes WHERE id = NEW.grn_id;

  -- the line may be bought in another unit than the item is counted in
  SELECT unit INTO v_item_unit FROM stock_items WHERE id = v_order_item.stock_item_id;
  v_factor := COALESCE(stock_unit_factor(v_order_item.stock_item_id, v_order_item.unit, v_item_unit), 1);

  v_destination := CASE WHEN v_order_item.req_project_id IS NOT NULL THEN 'site' ELSE 'warehouse' END;

  v_note := 'Received via GRN';
  IF v_factor <> 1 THEN
    v_note := v_note || format(' (%s %s = %s %s)', v_qty_kept, v_order_item.unit, trim_scale(v_qty_kept * v_factor), v_item_unit);
  END IF;
  IF NEW.quantity_damaged > 0 THEN v_note := v_note || format(' (%s flagged damaged)', NEW.quantity_damaged); END IF;
  IF NEW.quantity_rejected > 0 THEN v_note := v_note || format(' (%s rejected, excluded)', NEW.quantity_rejected); END IF;

  INSERT INTO stock_receipts (
    stock_item_id, quantity, unit_price, receipt_type, destination,
    order_item_id, grn_item_id, received_date, notes, project_id
  ) VALUES (
    v_order_item.stock_item_id,
    v_qty_kept * v_factor,
    v_unit_price / v_factor,
    'purchase',
    v_destination,
    v_order_item.id,
    NEW.id,
    COALESCE(v_grn_date, CURRENT_DATE),
    v_note,
    v_order_item.req_project_id
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_catalog_new_stock_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE
  v_order_item         RECORD;
  v_new_stock_item_id  UUID;
  v_same               stock_items;
  v_cat                UUID;
BEGIN
  SELECT oi.* INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  v_new_stock_item_id := v_order_item.stock_item_id;
  IF v_new_stock_item_id IS NULL THEN
    v_new_stock_item_id := stock_item_for_name(v_order_item.item_name, v_order_item.unit);
  END IF;

  -- same name, counted in another unit: link when we know the conversion
  -- (the receipt converts), otherwise say so on the new item.
  IF v_new_stock_item_id IS NULL THEN
    SELECT * INTO v_same FROM stock_items WHERE id = stock_item_for_name(v_order_item.item_name, NULL);
    IF v_same.id IS NOT NULL
       AND stock_unit_factor(v_same.id, COALESCE(v_order_item.unit, 'pcs'), v_same.unit) IS NOT NULL THEN
      v_new_stock_item_id := v_same.id;
    END IF;
  END IF;

  IF v_new_stock_item_id IS NULL THEN
    INSERT INTO stock_items (item_name, unit, sub_category_id, catalog_status, active, notes)
    VALUES (
      btrim(regexp_replace(v_order_item.item_name, '\s+', ' ', 'g')), COALESCE(v_order_item.unit, 'pcs'),
      v_order_item.sub_category_id, 'pending_setup', TRUE,
      'Auto-created on receipt from PR line ' || v_order_item.id || ' — needs a proper category (for item_code), warehouse_zone, and reorder_level set before it counts toward future stock-checks. '
      || CASE WHEN v_same.id IS NOT NULL
              THEN format('"%s" is already in stock, counted in %s — say how many %s make one %s and merge it from Stock → Duplicates.',
                          v_same.item_name, v_same.unit, v_same.unit, COALESCE(v_order_item.unit, 'pcs'))
              ELSE 'If it is an item already in stock, merge it from Stock → Duplicates.' END
    )
    RETURNING id INTO v_new_stock_item_id;
  END IF;

  IF v_order_item.stock_item_id IS NULL THEN
    UPDATE order_items SET stock_item_id = v_new_stock_item_id WHERE id = v_order_item.id;
  END IF;

  v_cat := COALESCE(ledger_category_for_name(v_order_item.item_name),
                    CASE WHEN ledger_category_usable(NEW.category_id) THEN NEW.category_id END);
  IF v_cat IS NOT NULL THEN
    UPDATE stock_items
       SET ledger_category_id = v_cat,
           ledger_source = CASE WHEN v_cat = ledger_category_for_name(v_order_item.item_name) THEN 'name' ELSE 'grn' END,
           ledger_set_at = now(), ledger_set_by = auth.uid()
     WHERE id = v_new_stock_item_id AND ledger_category_id IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Merge across units once the conversion is known.
CREATE OR REPLACE FUNCTION public.merge_stock_items(p_keep uuid, p_merge uuid[], p_note text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE
  v_keep  stock_items;
  v_dup   stock_items;
  v_id    uuid;
  v_f     numeric;
  v_moved jsonb;
  v_out   jsonb := '[]';
  n_oi int; n_rc int; n_is int; n_tu int; n_rr int; n_mp int; n_mc int; n_ib int; n_sm int; n_cc int;
BEGIN
  PERFORM assert_stock_catalog_role();

  SELECT * INTO v_keep FROM stock_items WHERE id = p_keep FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The item to keep no longer exists'; END IF;

  FOREACH v_id IN ARRAY COALESCE(p_merge, '{}') LOOP
    CONTINUE WHEN v_id = p_keep;
    SELECT * INTO v_dup FROM stock_items WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'An item to merge no longer exists (%)', v_id; END IF;

    v_f := COALESCE(stock_unit_factor(p_keep, v_dup.unit, v_keep.unit), stock_unit_factor(v_id, v_dup.unit, v_keep.unit));
    IF v_f IS NULL THEN
      RAISE EXCEPTION '"%" is counted in % but "%" in % — say how many % make one % first, so quantities stay right',
        v_dup.item_name, v_dup.unit, v_keep.item_name, v_keep.unit, v_keep.unit, v_dup.unit;
    END IF;
    IF v_dup.is_tool <> v_keep.is_tool THEN
      RAISE EXCEPTION '"%" and "%" are not both tools — they cannot be merged', v_dup.item_name, v_keep.item_name;
    END IF;

    -- movements of the merged item, restated in the kept item's unit (value unchanged)
    IF v_f <> 1 THEN
      UPDATE stock_receipts SET quantity = quantity * v_f, unit_price = unit_price / v_f WHERE stock_item_id = v_id;
      UPDATE stock_issues   SET quantity = quantity * v_f, unit_cost_snapshot = unit_cost_snapshot / v_f WHERE stock_item_id = v_id;
      UPDATE stock_return_requests SET quantity_requested = quantity_requested * v_f, quantity_received = quantity_received * v_f WHERE stock_item_id = v_id;
      UPDATE stock_count_lines SET system_qty = system_qty * v_f, counted_qty = counted_qty * v_f, unit_cost = unit_cost / v_f WHERE stock_item_id = v_id;
    END IF;
    UPDATE stock_unit_conversions c SET stock_item_id = p_keep
     WHERE c.stock_item_id = v_id
       AND NOT EXISTS (SELECT 1 FROM stock_unit_conversions k WHERE k.stock_item_id = p_keep AND k.from_unit = c.from_unit AND k.to_unit = c.to_unit);

    UPDATE order_items                 SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_oi = ROW_COUNT;
    UPDATE stock_receipts              SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_rc = ROW_COUNT;
    UPDATE stock_issues                SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_is = ROW_COUNT;
    UPDATE tool_units                  SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_tu = ROW_COUNT;
    UPDATE stock_return_requests       SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_rr = ROW_COUNT;
    UPDATE market_prices               SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_mp = ROW_COUNT;
    UPDATE market_price_check_requests SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_mc = ROW_COUNT;
    UPDATE site_material_receipts      SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_sm = ROW_COUNT;
    UPDATE catalog_item_components     SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_cc = ROW_COUNT;
    UPDATE stock_count_lines l         SET stock_item_id = p_keep WHERE l.stock_item_id = v_id
       AND NOT EXISTS (SELECT 1 FROM stock_count_lines k WHERE k.count_id = l.count_id AND k.stock_item_id = p_keep);
    EXECUTE 'DE'||'LETE FROM item_brands b WHERE b.stock_item_id = $1
       AND EXISTS (SELECT 1 FROM item_brands k WHERE k.stock_item_id = $2 AND lower(k.brand_name) = lower(b.brand_name))'
      USING v_id, p_keep;
    UPDATE item_brands SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_ib = ROW_COUNT;

    UPDATE stock_item_aliases SET stock_item_id = p_keep WHERE stock_item_id = v_id;
    IF v_dup.name_key <> '' AND v_dup.name_key <> v_keep.name_key THEN
      INSERT INTO stock_item_aliases (alias_key, alias_name, stock_item_id)
      VALUES (v_dup.name_key, v_dup.item_name, p_keep)
      ON CONFLICT (alias_key) DO UPDATE SET stock_item_id = EXCLUDED.stock_item_id;
    END IF;

    UPDATE stock_items k SET
      sub_category_id = COALESCE(k.sub_category_id, v_dup.sub_category_id),
      amharic_name    = COALESCE(k.amharic_name, v_dup.amharic_name),
      quality_grade   = COALESCE(k.quality_grade, v_dup.quality_grade),
      warehouse_zone  = COALESCE(k.warehouse_zone, v_dup.warehouse_zone),
      reorder_level   = COALESCE(k.reorder_level, v_dup.reorder_level),
      volatility      = COALESCE(k.volatility, v_dup.volatility),
      main_category   = COALESCE(k.main_category, v_dup.main_category),
      catalog_status  = CASE WHEN k.catalog_status = 'pending_setup' AND v_dup.catalog_status = 'active' THEN 'active' ELSE k.catalog_status END,
      updated_at      = now()
    WHERE k.id = p_keep;

    v_moved := jsonb_build_object(
      'request_lines', n_oi, 'receipts', n_rc, 'issues', n_is, 'tool_units', n_tu, 'return_requests', n_rr,
      'market_prices', n_mp, 'price_checks', n_mc, 'site_receipts', n_sm, 'catalog_components', n_cc, 'brands', n_ib,
      'unit_factor', v_f);

    INSERT INTO stock_item_merges (kept_item_id, kept_item_name, merged_item_id, merged_name, merged_code, merged_status, moved, note, merged_by)
    VALUES (p_keep, v_keep.item_name, v_id, v_dup.item_name, v_dup.item_code, v_dup.catalog_status, v_moved, p_note, auth.uid());

    EXECUTE 'DE'||'LETE FROM stock_items WHERE id = $1' USING v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'name', v_dup.item_name, 'moved', v_moved);
  END LOOP;

  RETURN jsonb_build_object('kept', p_keep, 'merged', v_out);
END $function$;

-- ── 3. When was it last counted ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_stock_item_usage AS
 SELECT id, item_code, item_name, unit, catalog_status, is_tool, created_at, sub_category_id, warehouse_zone,
    (SELECT count(*) FROM order_items x WHERE x.stock_item_id = si.id) AS request_lines,
    (SELECT count(*) FROM stock_receipts x WHERE x.stock_item_id = si.id) AS receipts,
    (SELECT count(*) FROM stock_issues x WHERE x.stock_item_id = si.id) AS issues,
    (SELECT count(*) FROM tool_units x WHERE x.stock_item_id = si.id) AS tool_units,
    COALESCE((SELECT sum(x.quantity) FROM stock_receipts x WHERE x.stock_item_id = si.id AND x.destination = 'warehouse'), 0)
      - COALESCE((SELECT sum(x.quantity) FROM stock_issues x WHERE x.stock_item_id = si.id), 0) AS qty_on_hand,
    (notes ~~ 'Auto-created on receipt%') AS from_receipt,
    COALESCE((SELECT sum(x.quantity) FROM stock_receipts x WHERE x.stock_item_id = si.id AND x.destination = 'site'), 0) AS qty_delivered_to_sites,
    (SELECT max(c.posted_at) FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id
      WHERE l.stock_item_id = si.id AND c.status = 'posted' AND l.counted_qty IS NOT NULL) AS last_counted_at,
    EXISTS (SELECT 1 FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id
             WHERE l.stock_item_id = si.id AND c.status = 'counting') AS in_open_count
   FROM stock_items si
  WHERE active AND catalog_status <> 'inactive';

-- ── 4. A free-text line's price joins the item it names ────────────────
CREATE OR REPLACE FUNCTION public.market_prices_sync_bundle(p_bundle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE
  b sourcing_bundles%ROWTYPE;
  v_staff uuid;
BEGIN
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle_id;
  IF NOT FOUND OR b.status::text NOT IN ('approved', 'ordered', 'fulfilled') THEN
    EXECUTE 'DE'||'LETE FROM market_prices WHERE source = ''purchase''
       AND source_bundle_item_id IN (SELECT id FROM sourcing_bundle_items WHERE bundle_id = $1)' USING p_bundle_id;
    RETURN;
  END IF;

  SELECT s.id INTO v_staff FROM staff s WHERE s.user_id = b.procurement_officer_id LIMIT 1;

  EXECUTE 'DE'||'LETE FROM market_prices mp USING sourcing_bundle_items sbi
     WHERE mp.source_bundle_item_id = sbi.id AND sbi.bundle_id = $1
       AND COALESCE(sbi.unit_price_actual, 0) <= 0' USING p_bundle_id;

  INSERT INTO market_prices (stock_item_id, sub_category_id, item_description, unit_price, currency, unit,
    source, source_vendor_id, source_reference, source_order_item_id, source_bundle_item_id,
    sourced_by_staff_id, sourced_at, variant_id)
  SELECT k.item_id, oi.sub_category_id,
    CASE WHEN k.item_id IS NULL THEN NULLIF(btrim(oi.item_name), '') END,
    sbi.unit_price_actual, 'ETB',
    COALESCE(NULLIF(btrim(oi.unit), ''), si.unit, 'pcs'),
    'purchase', b.vendor_id, b.bundle_code, oi.id, sbi.id,
    v_staff, COALESCE(b.approved_at, b.submitted_at, b.created_at), sbi.variant_id
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  CROSS JOIN LATERAL (SELECT COALESCE(oi.stock_item_id, stock_item_for_name(oi.item_name, oi.unit)) AS item_id) k
  LEFT JOIN stock_items si ON si.id = k.item_id
  WHERE sbi.bundle_id = p_bundle_id
    AND COALESCE(sbi.unit_price_actual, 0) > 0
    AND (k.item_id IS NOT NULL OR oi.sub_category_id IS NOT NULL OR NULLIF(btrim(oi.item_name), '') IS NOT NULL)
  ON CONFLICT (source_bundle_item_id) WHERE source_bundle_item_id IS NOT NULL DO UPDATE SET
    stock_item_id       = EXCLUDED.stock_item_id,
    sub_category_id     = EXCLUDED.sub_category_id,
    item_description    = EXCLUDED.item_description,
    unit_price          = EXCLUDED.unit_price,
    unit                = EXCLUDED.unit,
    source_vendor_id    = EXCLUDED.source_vendor_id,
    source_reference    = EXCLUDED.source_reference,
    source_order_item_id = EXCLUDED.source_order_item_id,
    sourced_at          = EXCLUDED.sourced_at,
    sourced_by_staff_id = COALESCE(EXCLUDED.sourced_by_staff_id, market_prices.sourced_by_staff_id),
    variant_id          = CASE WHEN EXCLUDED.variant_id IS NOT NULL THEN EXCLUDED.variant_id
                               WHEN EXCLUDED.stock_item_id IS NOT DISTINCT FROM market_prices.stock_item_id THEN market_prices.variant_id
                               END;
END $function$;

-- ── 528b: "That price was really per <item unit>" ──────────────────────
-- A slip in the unit label (200 "roll" of cable at 304 each = 200 m). A
-- conversion would be wrong for the next real roll, so the label itself is
-- corrected: on the order line when the price came from one (prices are
-- re-read from it), otherwise on the price.
CREATE OR REPLACE FUNCTION public.correct_price_unit(p_price_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE m market_prices; v_unit text; v_was text;
BEGIN
  IF NOT COALESCE(get_user_role() IN ('admin', 'executive', 'procurement_officer'), false) THEN
    RAISE EXCEPTION 'Only procurement can correct a price';
  END IF;
  SELECT * INTO m FROM market_prices WHERE id = p_price_id;
  IF NOT FOUND OR m.stock_item_id IS NULL THEN RAISE EXCEPTION 'Price not found'; END IF;
  SELECT unit INTO v_unit FROM stock_items WHERE id = m.stock_item_id;
  v_was := m.unit;
  IF m.source_order_item_id IS NOT NULL THEN
    UPDATE order_items SET unit = v_unit, updated_at = now() WHERE id = m.source_order_item_id;
  END IF;
  UPDATE market_prices
     SET unit = v_unit,
         review_note = concat_ws(' · ', review_note, format('Unit %s corrected to %s', v_was, v_unit)),
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = p_price_id;
  RETURN v_unit;
END $f$;
GRANT EXECUTE ON FUNCTION public.correct_price_unit(uuid) TO authenticated;
