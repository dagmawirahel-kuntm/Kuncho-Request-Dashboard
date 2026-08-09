-- 191 — Brand + specification on market prices, and an item_brands catalog
--
-- Adds `brand` + `specification` free-text on both market_prices and
-- market_price_check_requests so a quote can distinguish Nippon 20L water-
-- based ivory from Berger 20L water-based ivory even when the anchor
-- (stock_item or sub_category) is the same.
--
-- item_brands is a manageable catalog: Procurement adds known brands per
-- stock_item OR per sub_category, and the modals populate their datalists
-- from it. A brand may be tied to either anchor level but not both — a
-- stock-item-scoped brand is a subset of the category-scoped list for that
-- item's category.
--
-- Nothing existing is touched; every column is nullable so historical rows
-- keep working.

SET search_path TO public;

-- ── Columns on market_prices + market_price_check_requests ──────────────────
ALTER TABLE market_prices
  ADD COLUMN IF NOT EXISTS brand         text,
  ADD COLUMN IF NOT EXISTS specification text;

ALTER TABLE market_price_check_requests
  ADD COLUMN IF NOT EXISTS brand         text,
  ADD COLUMN IF NOT EXISTS specification text;

-- ── item_brands catalog ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_brands (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id    uuid REFERENCES stock_items(id)  ON DELETE CASCADE,
  sub_category_id  uuid REFERENCES sub_categories(id) ON DELETE CASCADE,
  brand_name       text NOT NULL,
  specification    text,
  notes            text,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='item_brands_needs_anchor_chk') THEN
    ALTER TABLE item_brands
      ADD CONSTRAINT item_brands_needs_anchor_chk
      CHECK (stock_item_id IS NOT NULL OR sub_category_id IS NOT NULL);
  END IF;
END $$;

-- Case-insensitive uniqueness within each anchor level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_brands_uniq_stock
  ON item_brands (stock_item_id, lower(brand_name)) WHERE stock_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_brands_uniq_subcat
  ON item_brands (sub_category_id, lower(brand_name)) WHERE stock_item_id IS NULL AND sub_category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_item_brands_stock   ON item_brands (stock_item_id)   WHERE stock_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_brands_subcat  ON item_brands (sub_category_id) WHERE sub_category_id IS NOT NULL;

ALTER TABLE item_brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_brands_read ON item_brands;
CREATE POLICY item_brands_read ON item_brands FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS item_brands_write ON item_brands;
CREATE POLICY item_brands_write ON item_brands FOR ALL
  USING (get_user_role() IN ('admin','executive','procurement_officer'))
  WITH CHECK (get_user_role() IN ('admin','executive','procurement_officer'));
GRANT SELECT, INSERT, UPDATE, DELETE ON item_brands TO authenticated;

-- ── RPCs: pass brand + spec through ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.request_market_price_check(uuid, uuid, text, date, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.request_market_price_check(
  p_stock_item_id    uuid DEFAULT NULL,
  p_project_id       uuid DEFAULT NULL,
  p_reason           text DEFAULT NULL,
  p_needed_by        date DEFAULT NULL,
  p_order_item_id    uuid DEFAULT NULL,
  p_sub_category_id  uuid DEFAULT NULL,
  p_item_description text DEFAULT NULL,
  p_brand            text DEFAULT NULL,
  p_specification    text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_staff uuid; v_id uuid; v_existing uuid;
BEGIN
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your account is not linked to a staff record'; END IF;
  IF p_stock_item_id IS NULL AND p_sub_category_id IS NULL THEN
    RAISE EXCEPTION 'A price check needs either a stock_item or a sub_category';
  END IF;
  IF p_order_item_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM market_price_check_requests
      WHERE order_item_id = p_order_item_id AND status = 'open' LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;
  INSERT INTO market_price_check_requests
    (stock_item_id, sub_category_id, item_description, brand, specification,
     requested_by_staff_id, project_id, order_item_id, reason, needed_by, status)
  VALUES (p_stock_item_id, p_sub_category_id, p_item_description, p_brand, p_specification,
     v_staff, p_project_id, p_order_item_id, p_reason, p_needed_by, 'open')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.request_market_price_check(uuid, uuid, text, date, uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fulfill_market_price_check(
  p_request_id uuid, p_unit_price numeric,
  p_vendor_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_brand text DEFAULT NULL, p_specification text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_req market_price_check_requests%ROWTYPE;
  v_staff uuid; v_unit text; v_price_id uuid;
BEGIN
  IF public.get_user_role() NOT IN ('admin','executive','procurement_officer') THEN
    RAISE EXCEPTION 'Only Procurement, admin, or executive may fulfill a check request';
  END IF;
  SELECT * INTO v_req FROM market_price_check_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Request % not found', p_request_id; END IF;
  IF v_req.status <> 'open' THEN RAISE EXCEPTION 'Request is already %', v_req.status; END IF;
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your account is not linked to a staff record'; END IF;
  IF v_req.stock_item_id IS NOT NULL THEN
    SELECT unit INTO v_unit FROM stock_items WHERE id = v_req.stock_item_id;
  ELSE
    v_unit := 'unit';
  END IF;

  INSERT INTO market_prices
    (stock_item_id, sub_category_id, item_description, brand, specification,
     unit_price, currency, unit, source, source_vendor_id,
     sourced_by_staff_id, notes, related_check_request_id)
  VALUES
    (v_req.stock_item_id, v_req.sub_category_id, v_req.item_description,
     COALESCE(p_brand, v_req.brand), COALESCE(p_specification, v_req.specification),
     p_unit_price, 'ETB', v_unit, 'check_request_response',
     p_vendor_id, v_staff, p_notes, p_request_id)
  RETURNING id INTO v_price_id;

  UPDATE market_price_check_requests
     SET status='fulfilled', fulfilled_by_market_price_id=v_price_id,
         fulfilled_at=now(), updated_at=now()
   WHERE id=p_request_id;

  IF v_req.order_item_id IS NOT NULL THEN
    UPDATE order_items
       SET unit_price_est=COALESCE(unit_price_est, p_unit_price),
           needs_market_check=false, updated_at=now()
     WHERE id=v_req.order_item_id AND (needs_market_check=true OR unit_price_est IS NULL);
  END IF;
  RETURN v_price_id;
END $$;
GRANT EXECUTE ON FUNCTION public.fulfill_market_price_check(uuid, numeric, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_verified_market_price(
  p_stock_item_id     uuid DEFAULT NULL,
  p_unit_price        numeric DEFAULT NULL,
  p_vendor_id         uuid DEFAULT NULL,
  p_notes             text DEFAULT NULL,
  p_source_reference  text DEFAULT NULL,
  p_sub_category_id   uuid DEFAULT NULL,
  p_item_description  text DEFAULT NULL,
  p_unit              text DEFAULT NULL,
  p_brand             text DEFAULT NULL,
  p_specification     text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_id uuid; v_staff uuid; v_unit text;
BEGIN
  IF public.get_user_role() NOT IN ('admin','executive','procurement_officer') THEN
    RAISE EXCEPTION 'Only Procurement, admin, or executive may log a verified market price';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN RAISE EXCEPTION 'Unit price must be positive'; END IF;
  IF p_stock_item_id IS NULL AND p_sub_category_id IS NULL THEN
    RAISE EXCEPTION 'A verified price needs either a stock_item or a sub_category';
  END IF;
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your account is not linked to a staff record'; END IF;
  IF p_stock_item_id IS NOT NULL THEN
    SELECT unit INTO v_unit FROM stock_items WHERE id = p_stock_item_id;
    IF v_unit IS NULL THEN RAISE EXCEPTION 'Stock item % not found', p_stock_item_id; END IF;
  ELSE
    v_unit := COALESCE(p_unit, 'unit');
  END IF;
  INSERT INTO market_prices
    (stock_item_id, sub_category_id, item_description, brand, specification,
     unit_price, currency, unit, source, source_vendor_id,
     source_reference, sourced_by_staff_id, notes)
  VALUES
    (p_stock_item_id, p_sub_category_id, p_item_description, p_brand, p_specification,
     p_unit_price, 'ETB', v_unit, 'verified_quote', p_vendor_id,
     p_source_reference, v_staff, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.log_verified_market_price(uuid, numeric, uuid, text, text, uuid, text, text, text, text) TO authenticated;

-- ── v_sub_category_latest_price: partition also by brand + specification ─────
-- so a Nippon 20L survey and a Berger 20L survey coexist as two rows, not
-- one overwriting the other. Drop + create because column list widens.
DROP VIEW IF EXISTS public.v_sub_category_latest_price;
CREATE VIEW public.v_sub_category_latest_price AS
WITH ranked AS (
  SELECT mp.*,
    ROW_NUMBER() OVER (
      PARTITION BY mp.sub_category_id,
                   COALESCE(mp.item_description, '__cat__'),
                   COALESCE(mp.brand, '__none__'),
                   COALESCE(mp.specification, '__none__')
      ORDER BY mp.sourced_at DESC) AS rn
  FROM market_prices mp
  WHERE mp.sub_category_id IS NOT NULL AND mp.stock_item_id IS NULL
)
SELECT r.id, r.sub_category_id, sc.item_name AS sub_category_name,
  r.item_description, r.brand, r.specification,
  r.unit_price, r.currency, r.unit,
  r.source, r.source_vendor_id, v.vendor_name,
  r.source_reference, r.sourced_at,
  r.sourced_by_staff_id, s.employee_name AS sourced_by_name, r.notes,
  GREATEST(0, (EXTRACT(EPOCH FROM (now() - r.sourced_at)) / 86400.0)::int) AS days_since_sourced
FROM ranked r
JOIN sub_categories sc ON sc.id = r.sub_category_id
LEFT JOIN vendors v ON v.id = r.source_vendor_id
LEFT JOIN staff s ON s.id = r.sourced_by_staff_id
WHERE r.rn = 1;
GRANT SELECT ON public.v_sub_category_latest_price TO authenticated;
