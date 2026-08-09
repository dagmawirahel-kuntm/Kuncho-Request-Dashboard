-- 190 — Market prices anchored on sub_categories + free-text new-item quotes
--
-- Widens both `market_prices` and `market_price_check_requests` so an entry
-- can anchor on ANY of:
--   * a real stock_item (existing case)
--   * a sub_category alone (survey the price of "aluminum sheet 1mm" without
--     needing to catalog every gauge/brand as a stock item)
--   * a free-text item_description alongside a sub_category (a "new item"
--     Procurement quoted but we don't want to catalog yet — spec §"new items")
--
-- CHECK enforces at least one anchor. Existing rows are unaffected (they all
-- have stock_item_id set). The `v_stock_item_latest_price` view remains
-- stock-item-only by design so per-item display prices don't mix categories.
--
-- A new view `v_sub_category_latest_price` exposes the latest category-level
-- (non-stock-item) prices for the Market Trends page's new Surveys section.

SET search_path TO public;

-- ── market_prices ────────────────────────────────────────────────────────────
ALTER TABLE market_prices
  ADD COLUMN IF NOT EXISTS sub_category_id  uuid REFERENCES sub_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_description text;

ALTER TABLE market_prices ALTER COLUMN stock_item_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='market_prices_needs_anchor_chk') THEN
    ALTER TABLE market_prices
      ADD CONSTRAINT market_prices_needs_anchor_chk
      CHECK (stock_item_id IS NOT NULL OR sub_category_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mp_sub_category_recent ON market_prices (sub_category_id, sourced_at DESC) WHERE sub_category_id IS NOT NULL;

-- ── market_price_check_requests ──────────────────────────────────────────────
ALTER TABLE market_price_check_requests
  ADD COLUMN IF NOT EXISTS sub_category_id  uuid REFERENCES sub_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_description text;

ALTER TABLE market_price_check_requests ALTER COLUMN stock_item_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mpcr_needs_anchor_chk') THEN
    ALTER TABLE market_price_check_requests
      ADD CONSTRAINT mpcr_needs_anchor_chk
      CHECK (stock_item_id IS NOT NULL OR sub_category_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mpcr_sub_category ON market_price_check_requests (sub_category_id) WHERE sub_category_id IS NOT NULL;

-- ── RPC: request check (accepts sub_category + description) ──────────────────
CREATE OR REPLACE FUNCTION public.request_market_price_check(
  p_stock_item_id    uuid DEFAULT NULL,
  p_project_id       uuid DEFAULT NULL,
  p_reason           text DEFAULT NULL,
  p_needed_by        date DEFAULT NULL,
  p_order_item_id    uuid DEFAULT NULL,
  p_sub_category_id  uuid DEFAULT NULL,
  p_item_description text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_staff uuid; v_id uuid; v_existing uuid;
BEGIN
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your account is not linked to a staff record'; END IF;
  IF p_stock_item_id IS NULL AND p_sub_category_id IS NULL THEN
    RAISE EXCEPTION 'A price check needs either a stock_item or a sub_category';
  END IF;

  -- Dedupe stock-item requests tied to an order_item (existing behavior).
  IF p_order_item_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM market_price_check_requests
      WHERE order_item_id = p_order_item_id AND status = 'open' LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  INSERT INTO market_price_check_requests
    (stock_item_id, sub_category_id, item_description,
     requested_by_staff_id, project_id, order_item_id, reason, needed_by, status)
  VALUES
    (p_stock_item_id, p_sub_category_id, p_item_description,
     v_staff, p_project_id, p_order_item_id, p_reason, p_needed_by, 'open')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.request_market_price_check(uuid, uuid, text, date, uuid, uuid, text) TO authenticated;

-- ── RPC: fulfill check ───────────────────────────────────────────────────────
-- Carries the request's sub_category_id + item_description onto the created
-- market_prices row so the survey lives in history alongside stock-item prices.
CREATE OR REPLACE FUNCTION public.fulfill_market_price_check(
  p_request_id uuid, p_unit_price numeric,
  p_vendor_id uuid DEFAULT NULL, p_notes text DEFAULT NULL
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

  -- Unit sourced from the stock_item if any; otherwise a placeholder because
  -- sub-category surveys don't have a single canonical unit.
  IF v_req.stock_item_id IS NOT NULL THEN
    SELECT unit INTO v_unit FROM stock_items WHERE id = v_req.stock_item_id;
  ELSE
    v_unit := 'unit';
  END IF;

  INSERT INTO market_prices
    (stock_item_id, sub_category_id, item_description,
     unit_price, currency, unit, source, source_vendor_id,
     sourced_by_staff_id, notes, related_check_request_id)
  VALUES
    (v_req.stock_item_id, v_req.sub_category_id, v_req.item_description,
     p_unit_price, 'ETB', v_unit, 'check_request_response',
     p_vendor_id, v_staff, p_notes, p_request_id)
  RETURNING id INTO v_price_id;

  UPDATE market_price_check_requests
     SET status='fulfilled', fulfilled_by_market_price_id=v_price_id,
         fulfilled_at=now(), updated_at=now()
   WHERE id=p_request_id;

  -- Only stamp back onto an order_item when the request was truly tied to one.
  IF v_req.order_item_id IS NOT NULL THEN
    UPDATE order_items
       SET unit_price_est=COALESCE(unit_price_est, p_unit_price),
           needs_market_check=false, updated_at=now()
     WHERE id=v_req.order_item_id AND (needs_market_check=true OR unit_price_est IS NULL);
  END IF;
  RETURN v_price_id;
END $$;
GRANT EXECUTE ON FUNCTION public.fulfill_market_price_check(uuid, numeric, uuid, text) TO authenticated;

-- ── RPC: log verified price directly (accepts new anchors) ───────────────────
CREATE OR REPLACE FUNCTION public.log_verified_market_price(
  p_stock_item_id     uuid DEFAULT NULL,
  p_unit_price        numeric DEFAULT NULL,
  p_vendor_id         uuid DEFAULT NULL,
  p_notes             text DEFAULT NULL,
  p_source_reference  text DEFAULT NULL,
  p_sub_category_id   uuid DEFAULT NULL,
  p_item_description  text DEFAULT NULL,
  p_unit              text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_id uuid; v_staff uuid; v_unit text;
BEGIN
  IF public.get_user_role() NOT IN ('admin','executive','procurement_officer') THEN
    RAISE EXCEPTION 'Only Procurement, admin, or executive may log a verified market price';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'Unit price must be positive';
  END IF;
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
    (stock_item_id, sub_category_id, item_description,
     unit_price, currency, unit, source, source_vendor_id,
     source_reference, sourced_by_staff_id, notes)
  VALUES
    (p_stock_item_id, p_sub_category_id, p_item_description,
     p_unit_price, 'ETB', v_unit, 'verified_quote', p_vendor_id,
     p_source_reference, v_staff, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.log_verified_market_price(uuid, numeric, uuid, text, text, uuid, text, text) TO authenticated;

-- ── View: latest sub-category-only price surveys ─────────────────────────────
-- Only rows with sub_category_id AND NO stock_item_id (i.e., pure surveys or
-- free-text new-item quotes). One row per (sub_category, item_description
-- OR '__cat__' if description is null).
CREATE OR REPLACE VIEW public.v_sub_category_latest_price AS
WITH ranked AS (
  SELECT
    mp.*,
    ROW_NUMBER() OVER (
      PARTITION BY mp.sub_category_id, COALESCE(mp.item_description, '__cat__')
      ORDER BY mp.sourced_at DESC
    ) AS rn
  FROM market_prices mp
  WHERE mp.sub_category_id IS NOT NULL AND mp.stock_item_id IS NULL
)
SELECT
  r.id, r.sub_category_id, sc.item_name AS sub_category_name,
  r.item_description, r.unit_price, r.currency, r.unit,
  r.source, r.source_vendor_id, v.vendor_name,
  r.source_reference, r.sourced_at,
  r.sourced_by_staff_id, s.employee_name AS sourced_by_name,
  r.notes,
  GREATEST(0, (EXTRACT(EPOCH FROM (now() - r.sourced_at)) / 86400.0)::int) AS days_since_sourced
FROM ranked r
JOIN sub_categories sc ON sc.id = r.sub_category_id
LEFT JOIN vendors v ON v.id = r.source_vendor_id
LEFT JOIN staff s ON s.id = r.sourced_by_staff_id
WHERE r.rn = 1
ORDER BY r.sourced_at DESC;
GRANT SELECT ON public.v_sub_category_latest_price TO authenticated;
