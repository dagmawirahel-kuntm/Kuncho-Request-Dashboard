-- 354 — One stock item per real item: match typed names, fix unit spellings,
-- stop goods-received making duplicates, and merge the ones already made
--
-- A purchase request line is typed text; linking it to a stock item was
-- optional, and the picker only offered fully set-up items. When an
-- unlinked line was received, auto_catalog_new_stock_item() (224) made a
-- new 'pending_setup' stock item from whatever was typed. So "Clear silcon"
-- and "Clear silicon", "Morale Australia" and "Morale Board (Australia)",
-- "6 mm mdf" and "mdf 6mm" each became separate items: 330 of 388 stock
-- items were made this way, most from a single request line, with 45 exact
-- repeats once case, spacing and punctuation are ignored. Units drifted
-- the same way (pcs / pkt / packet / pack, Meter / m / meters, Galon /
-- galllon / gallon, L / liters / litter …).
--
--  * stock_name_key() reduces a name to its words, lower-cased, sorted, with
--    punctuation, plurals and filler words ("bale", "x", "by", "for", "ye")
--    dropped, so "Fisher #6", "Fisher bale 6" and "6 fisher" share a key.
--    stock_items.name_key stores it.
--  * stock_units is the one list of units; stock_unit_canonical() maps the
--    old spellings onto it, and order_items / stock_items keep to it.
--  * match_stock_items() is the search behind the request form: same key or
--    a known alias first, then close spellings. Numbers are compared as
--    they are, so "MDF 8mm" never matches "MDF 6mm".
--  * Goods received now links an unlinked line to the existing item with
--    the same key and unit before it makes a new one.
--  * v_stock_duplicate_pairs lists items that look like one another;
--    merge_stock_items() moves every reference onto the kept item, records
--    the merged name as an alias (so it matches next time) and logs the
--    merge. Pairs someone marks as different stay hidden.

SET search_path TO public;

-- ── 1. Units ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_units (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  aliases    text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 100,
  active     boolean NOT NULL DEFAULT true
);

INSERT INTO stock_units (code, label, aliases, sort_order) VALUES
  ('pcs',        'pcs (pieces)',        '{pc,piece,pieces,pce,pces,no,nos,each,ea,unit,units}', 1),
  ('box',        'box',                 '{boxes,bx}', 2),
  ('pack',       'pack',                '{packs,packet,packets,pkt,pkts,pk}', 3),
  ('set',        'set',                 '{sets}', 4),
  ('pair',       'pair',                '{pairs}', 5),
  ('m',          'm (metre)',           '{meter,meters,metre,metres,mtr,mtrs,mts,lm}', 10),
  ('m2',         'm² (square metre)',   '{m²,sqm,sq m,sq.m,m^2,meter square,meters square,meterssquare,metersquare,square meter,square meters,square metre,kare,kare meter}', 11),
  ('m3',         'm³ (cubic metre)',    '{m³,cubic meter,cubic meters,meter cube,meters cube,metercube}', 12),
  ('sheet',      'sheet',               '{sheets}', 20),
  ('roll',       'roll',                '{rolls}', 21),
  ('bar',        'bar (length)',        '{bars,length,lengths}', 22),
  ('tube',       'tube',                '{tubes}', 23),
  ('kg',         'kg',                  '{kgs,kilo,kilos,kilogram,kilograms}', 30),
  ('kuntal',     'kuntal (100 kg)',     '{kuntals,quintal,quintals,qt,ql}', 31),
  ('bag',        'bag',                 '{bags,sack,sacks}', 32),
  ('madaberiya', 'madaberiya',          '{madaberia}', 33),
  ('L',          'L (litre)',           '{l,lt,ltr,ltrs,liter,liters,litre,litres,litter,litters}', 40),
  ('ml',         'ml',                  '{}', 41),
  ('gallon',     'gallon',              '{gallons,galon,galons,galllon,gal}', 42),
  ('bucket',     'bucket',              '{buckets}', 43),
  ('can',        'can / tin',           '{cans,tin,tins}', 44),
  ('lot',        'lot (lump sum)',      '{lots,lump sum,ls}', 50),
  ('service',    'service',             '{services}', 51),
  ('trip',       'trip',                '{trips}', 52),
  ('day',        'day',                 '{days}', 53)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE stock_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_units_read ON stock_units;
CREATE POLICY stock_units_read ON stock_units FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS stock_units_manage ON stock_units;
CREATE POLICY stock_units_manage ON stock_units FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin','stock_manager','procurement_officer']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin','stock_manager','procurement_officer']::user_role[]));
REVOKE ALL ON stock_units FROM anon;

-- Known spelling → its code; anything else comes back trimmed, as typed.
CREATE OR REPLACE FUNCTION stock_unit_canonical(p text)
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT u.code FROM stock_units u
      WHERE lower(u.code) = lower(btrim(p))
         OR lower(btrim(regexp_replace(p, '\s+', ' ', 'g'))) = ANY (u.aliases)
      ORDER BY (lower(u.code) = lower(btrim(p))) DESC
      LIMIT 1),
    NULLIF(btrim(p), ''))
$$;

CREATE OR REPLACE FUNCTION tidy_line_unit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.unit IS NOT NULL THEN
    NEW.unit := COALESCE(stock_unit_canonical(NEW.unit), NEW.unit);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tidy_order_item_unit ON order_items;
CREATE TRIGGER trg_tidy_order_item_unit BEFORE INSERT OR UPDATE OF unit ON order_items
  FOR EACH ROW EXECUTE FUNCTION tidy_line_unit();
DROP TRIGGER IF EXISTS trg_tidy_stock_item_unit ON stock_items;
CREATE TRIGGER trg_tidy_stock_item_unit BEFORE INSERT OR UPDATE OF unit ON stock_items
  FOR EACH ROW EXECUTE FUNCTION tidy_line_unit();

UPDATE order_items SET unit = stock_unit_canonical(unit)
 WHERE unit IS NOT NULL AND unit IS DISTINCT FROM stock_unit_canonical(unit);
UPDATE stock_items SET unit = stock_unit_canonical(unit)
 WHERE unit IS DISTINCT FROM stock_unit_canonical(unit);

-- ── 2. Name keys ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION stock_name_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(string_agg(DISTINCT w, ' ' ORDER BY w), '')
  FROM (
    SELECT CASE WHEN w ~ '^[a-z]{4,}s$' AND w !~ 'ss$' THEN left(w, -1) ELSE w END AS w
    FROM unnest(regexp_split_to_array(btrim(
      regexp_replace(
        regexp_replace(regexp_replace(lower(COALESCE(p, '')), '([0-9])([a-z])', '\1 \2', 'g'), '([a-z])([0-9])', '\1 \2', 'g'),
        '[^a-z0-9.]+|(?<![0-9])\.|\.(?![0-9])', ' ', 'g')), '\s+')) AS w
  ) t
  WHERE w <> '' AND w NOT IN ('x', 'by', 'for', 'the', 'of', 'and', 'with', 'ye', 'bale')
$$;

-- The numbers in a key ("10 20" for "Trunking 10x20"): close spellings
-- only count as the same item when these agree.
CREATE OR REPLACE FUNCTION stock_name_numbers(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(string_agg(w, ' ' ORDER BY w), '')
  FROM unnest(string_to_array(p_key, ' ')) w WHERE w ~ '^[0-9.]+$'
$$;

ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS name_key text GENERATED ALWAYS AS (stock_name_key(item_name)) STORED;
CREATE INDEX IF NOT EXISTS idx_stock_items_name_key ON stock_items (name_key);
CREATE INDEX IF NOT EXISTS idx_stock_items_name_key_trgm ON stock_items USING gin (name_key gin_trgm_ops);

-- Names a merged item was known by, so the same typing finds the kept item.
CREATE TABLE IF NOT EXISTS stock_item_aliases (
  alias_key     text PRIMARY KEY,
  alias_name    text NOT NULL,
  stock_item_id uuid NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_item_aliases_item ON stock_item_aliases (stock_item_id);
ALTER TABLE stock_item_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_item_aliases_read ON stock_item_aliases;
CREATE POLICY stock_item_aliases_read ON stock_item_aliases FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE ALL ON stock_item_aliases FROM anon;

-- ── 3. Search for the request form ───────────────────────────────────────
-- match: 'same' (same key or alias), 'close' (similar spelling, same
-- numbers), 'partial' (contains the words typed / similar but different
-- numbers). Pending-setup items are included: they are real stock.
CREATE OR REPLACE FUNCTION match_stock_items(p_query text, p_limit int DEFAULT 8)
RETURNS TABLE (
  id uuid, item_code text, item_name text, unit text, catalog_status text,
  sub_category_id uuid, qty_on_hand numeric, last_price numeric, last_price_date date,
  match text, score numeric, alias_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (
    SELECT stock_name_key(p_query) AS k, stock_name_numbers(stock_name_key(p_query)) AS n,
           lower(btrim(p_query)) AS raw
  ),
  c AS (
    SELECT si.id, si.item_code, si.item_name, si.unit, si.catalog_status, si.sub_category_id,
           al.alias_name,
           CASE WHEN si.name_key = q.k OR al.alias_key IS NOT NULL THEN 1::real
                ELSE greatest(similarity(si.name_key, q.k), word_similarity(q.k, si.name_key)) END AS sc,
           stock_name_numbers(si.name_key) = q.n AS same_nums,
           (si.name_key = q.k OR al.alias_key IS NOT NULL) AS same_key,
           strpos(lower(si.item_name), q.raw) > 0 OR lower(si.item_code) = q.raw AS contains
    FROM stock_items si
    CROSS JOIN q
    LEFT JOIN stock_item_aliases al ON al.stock_item_id = si.id AND al.alias_key = q.k
    WHERE auth.uid() IS NOT NULL
      AND q.k <> ''
      AND si.active AND si.catalog_status <> 'inactive'
  )
  SELECT c.id, c.item_code, c.item_name, c.unit, c.catalog_status, c.sub_category_id,
         COALESCE((SELECT sum(r.quantity) FROM stock_receipts r WHERE r.stock_item_id = c.id), 0)
           - COALESCE((SELECT sum(i.quantity) FROM stock_issues i WHERE i.stock_item_id = c.id), 0),
         lp.unit_price, lp.received_date,
         CASE WHEN c.same_key THEN 'same'
              WHEN c.same_nums AND c.sc >= 0.5 THEN 'close'
              ELSE 'partial' END,
         round(c.sc::numeric, 2), c.alias_name
  FROM c
  LEFT JOIN LATERAL (
    SELECT r.unit_price, r.received_date FROM stock_receipts r
     WHERE r.stock_item_id = c.id AND r.unit_price > 0
     ORDER BY r.received_date DESC, r.created_at DESC LIMIT 1
  ) lp ON true
  WHERE c.same_key OR c.contains OR c.sc >= 0.35
  ORDER BY c.same_key DESC, (c.same_nums AND c.sc >= 0.5) DESC, c.sc DESC,
           (c.catalog_status = 'active') DESC, c.item_name
  LIMIT greatest(1, least(COALESCE(p_limit, 8), 25))
$$;
REVOKE ALL ON FUNCTION match_stock_items(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_stock_items(text, int) TO authenticated;

-- The existing item a typed name + unit belongs to, if there is exactly
-- that item (same key or alias, same unit). Used at goods received.
CREATE OR REPLACE FUNCTION stock_item_for_name(p_name text, p_unit text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT si.id
  FROM stock_items si
  WHERE si.active AND si.catalog_status <> 'inactive'
    AND stock_name_key(p_name) <> ''
    AND (si.name_key = stock_name_key(p_name)
         OR EXISTS (SELECT 1 FROM stock_item_aliases a WHERE a.stock_item_id = si.id AND a.alias_key = stock_name_key(p_name)))
    AND (p_unit IS NULL OR stock_unit_canonical(si.unit) = stock_unit_canonical(p_unit))
  ORDER BY (si.catalog_status = 'active') DESC,
           (SELECT count(*) FROM stock_receipts r WHERE r.stock_item_id = si.id) DESC,
           si.created_at
  LIMIT 1
$$;

-- ── 4. Goods received: link before creating ──────────────────────────────
CREATE OR REPLACE FUNCTION auto_catalog_new_stock_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_item         RECORD;
  v_new_stock_item_id  UUID;
BEGIN
  SELECT oi.* INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  IF NOT FOUND OR v_order_item.stock_item_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- The same item under the same name (or a name it was merged from) and
  -- unit is already in stock: receive into it.
  v_new_stock_item_id := stock_item_for_name(v_order_item.item_name, v_order_item.unit);

  IF v_new_stock_item_id IS NULL THEN
    INSERT INTO stock_items (item_name, unit, sub_category_id, catalog_status, active, notes)
    VALUES (
      btrim(regexp_replace(v_order_item.item_name, '\s+', ' ', 'g')), COALESCE(v_order_item.unit, 'pcs'),
      v_order_item.sub_category_id, 'pending_setup', TRUE,
      'Auto-created on receipt from PR line ' || v_order_item.id || ' — needs a proper category (for item_code), warehouse_zone, and reorder_level set before it counts toward future stock-checks. If it is an item already in stock, merge it from Stock → Duplicates.'
    )
    RETURNING id INTO v_new_stock_item_id;
  END IF;

  UPDATE order_items SET stock_item_id = v_new_stock_item_id WHERE id = v_order_item.id;
  RETURN NEW;
END;
$$;

-- ── 5. Duplicates: review, dismiss, merge ────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_duplicate_dismissals (
  item_a       uuid NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  item_b       uuid NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  dismissed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_a, item_b),
  CHECK (item_a < item_b)
);
CREATE INDEX IF NOT EXISTS idx_stock_dup_dismissals_b ON stock_duplicate_dismissals (item_b);
ALTER TABLE stock_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_dup_dismissals_read ON stock_duplicate_dismissals;
CREATE POLICY stock_dup_dismissals_read ON stock_duplicate_dismissals FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE ALL ON stock_duplicate_dismissals FROM anon;

CREATE TABLE IF NOT EXISTS stock_item_merges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kept_item_id    uuid REFERENCES stock_items(id) ON DELETE SET NULL,
  kept_item_name  text NOT NULL,
  merged_item_id  uuid NOT NULL,
  merged_name     text NOT NULL,
  merged_code     text,
  merged_status   text,
  moved           jsonb NOT NULL DEFAULT '{}',
  note            text,
  merged_by       uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  merged_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_item_merges_kept ON stock_item_merges (kept_item_id);
ALTER TABLE stock_item_merges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_item_merges_read ON stock_item_merges;
CREATE POLICY stock_item_merges_read ON stock_item_merges FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE ALL ON stock_item_merges FROM anon;

-- Pairs that look like one item: the same key, or a close spelling with
-- the same numbers. Grouped into sets by the review page.
CREATE OR REPLACE VIEW v_stock_duplicate_pairs WITH (security_invoker = on) AS
WITH s AS (
  SELECT id, name_key, stock_name_numbers(name_key) AS nums
  FROM stock_items
  WHERE active AND catalog_status <> 'inactive' AND name_key <> ''
)
SELECT a.id AS item_a, b.id AS item_b,
       CASE WHEN a.name_key = b.name_key THEN 'same_name' ELSE 'similar' END AS reason,
       round(similarity(a.name_key, b.name_key)::numeric, 2) AS score
FROM s a
JOIN s b ON a.id < b.id
        AND (a.name_key = b.name_key OR (a.nums = b.nums AND similarity(a.name_key, b.name_key) >= 0.5))
WHERE NOT EXISTS (SELECT 1 FROM stock_duplicate_dismissals d WHERE d.item_a = a.id AND d.item_b = b.id);

-- Everything the review page shows about one item.
CREATE OR REPLACE VIEW v_stock_item_usage WITH (security_invoker = on) AS
SELECT si.id, si.item_code, si.item_name, si.unit, si.catalog_status, si.is_tool, si.created_at,
       si.sub_category_id, si.warehouse_zone,
       (SELECT count(*) FROM order_items x WHERE x.stock_item_id = si.id)    AS request_lines,
       (SELECT count(*) FROM stock_receipts x WHERE x.stock_item_id = si.id) AS receipts,
       (SELECT count(*) FROM stock_issues x WHERE x.stock_item_id = si.id)   AS issues,
       (SELECT count(*) FROM tool_units x WHERE x.stock_item_id = si.id)     AS tool_units,
       COALESCE((SELECT sum(quantity) FROM stock_receipts x WHERE x.stock_item_id = si.id), 0)
         - COALESCE((SELECT sum(quantity) FROM stock_issues x WHERE x.stock_item_id = si.id), 0) AS qty_on_hand,
       (si.notes LIKE 'Auto-created on receipt%') AS from_receipt
FROM stock_items si
WHERE si.active AND si.catalog_status <> 'inactive';

CREATE OR REPLACE FUNCTION assert_stock_catalog_role()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'executive', 'stock_manager', 'procurement_officer') THEN
    RAISE EXCEPTION 'Only stock, procurement or admin can change the stock catalogue' USING ERRCODE = '42501';
  END IF;
END $$;

-- "These are different items": hide every pair among them.
CREATE OR REPLACE FUNCTION dismiss_stock_duplicates(p_ids uuid[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM assert_stock_catalog_role();
  INSERT INTO stock_duplicate_dismissals (item_a, item_b, dismissed_by)
  SELECT a, b, auth.uid()
  FROM unnest(p_ids) a, unnest(p_ids) b
  WHERE a < b
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION dismiss_stock_duplicates(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dismiss_stock_duplicates(uuid[]) TO authenticated;

-- Move everything that points at each of p_merge onto p_keep, then delete
-- them. Units must agree (a bag is not a kuntal); tools only merge with
-- tools. The kept item takes any blanks from the merged ones, becomes
-- 'active' if one of them was, and remembers their names as aliases.
CREATE OR REPLACE FUNCTION merge_stock_items(p_keep uuid, p_merge uuid[], p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_keep  stock_items;
  v_dup   stock_items;
  v_id    uuid;
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

    IF stock_unit_canonical(v_dup.unit) IS DISTINCT FROM stock_unit_canonical(v_keep.unit) THEN
      RAISE EXCEPTION '"%" is counted in % but "%" in % — set the same unit on both first, so quantities stay right',
        v_dup.item_name, v_dup.unit, v_keep.item_name, v_keep.unit;
    END IF;
    IF v_dup.is_tool <> v_keep.is_tool THEN
      RAISE EXCEPTION '"%" and "%" are not both tools — they cannot be merged', v_dup.item_name, v_keep.item_name;
    END IF;

    UPDATE order_items                 SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_oi = ROW_COUNT;
    UPDATE stock_receipts              SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_rc = ROW_COUNT;
    UPDATE stock_issues                SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_is = ROW_COUNT;
    UPDATE tool_units                  SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_tu = ROW_COUNT;
    UPDATE stock_return_requests       SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_rr = ROW_COUNT;
    UPDATE market_prices               SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_mp = ROW_COUNT;
    UPDATE market_price_check_requests SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_mc = ROW_COUNT;
    UPDATE site_material_receipts      SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_sm = ROW_COUNT;
    UPDATE catalog_item_components     SET stock_item_id = p_keep WHERE stock_item_id = v_id; GET DIAGNOSTICS n_cc = ROW_COUNT;
    DELETE FROM item_brands b
     WHERE b.stock_item_id = v_id
       AND EXISTS (SELECT 1 FROM item_brands k WHERE k.stock_item_id = p_keep AND lower(k.brand_name) = lower(b.brand_name));
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
      'market_prices', n_mp, 'price_checks', n_mc, 'site_receipts', n_sm, 'catalog_components', n_cc, 'brands', n_ib);

    INSERT INTO stock_item_merges (kept_item_id, kept_item_name, merged_item_id, merged_name, merged_code, merged_status, moved, note, merged_by)
    VALUES (p_keep, v_keep.item_name, v_id, v_dup.item_name, v_dup.item_code, v_dup.catalog_status, v_moved, p_note, auth.uid());

    DELETE FROM stock_items WHERE id = v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'name', v_dup.item_name, 'moved', v_moved);
  END LOOP;

  RETURN jsonb_build_object('kept', p_keep, 'merged', v_out);
END $$;
REVOKE ALL ON FUNCTION merge_stock_items(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION merge_stock_items(uuid, uuid[], text) TO authenticated;

REVOKE ALL ON v_stock_duplicate_pairs, v_stock_item_usage FROM anon;
GRANT SELECT ON v_stock_duplicate_pairs, v_stock_item_usage TO authenticated;
