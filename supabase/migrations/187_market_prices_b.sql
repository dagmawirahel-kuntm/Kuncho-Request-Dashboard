-- 187 — Market prices · Part B: table + views + PO auto-log + verified log RPC
--
-- The append-only history table anchored on stock_items. Two entry paths:
-- (1) an AFTER-UPDATE trigger on `orders.approval_status` that auto-logs one
-- row per line-item once the order becomes committed, and (2) an explicit
-- SECURITY-INVOKER RPC for Procurement to enter a verified quote.
--
-- v_stock_item_latest_price is the single UI-facing surface: display_price
-- prefers a verified quote if it's still inside its own freshness window;
-- otherwise it falls back to whatever most-recent number we have.
--
-- Trigger inserts are SECURITY DEFINER for the specific auto-log path so
-- non-procurement callers (PM/foreman) can still submit an order without
-- being blocked by the market_prices RLS. Nothing else runs elevated.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS market_prices (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id             uuid NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  unit_price                numeric NOT NULL CHECK (unit_price > 0),
  currency                  text NOT NULL DEFAULT 'ETB',
  unit                      text NOT NULL,
  source                    text NOT NULL
    CHECK (source IN ('po_entry','verified_quote','check_request_response')),
  source_vendor_id          uuid REFERENCES vendors(id) ON DELETE SET NULL,
  source_reference          text,
  source_order_item_id      uuid REFERENCES order_items(id) ON DELETE SET NULL,
  sourced_by_staff_id       uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  sourced_at                timestamptz NOT NULL DEFAULT now(),
  notes                     text,
  related_check_request_id  uuid,        -- FK added in Migration C once the table exists
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_item_recent      ON market_prices (stock_item_id, sourced_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_source           ON market_prices (source);
CREATE INDEX IF NOT EXISTS idx_mp_sourced_at       ON market_prices (sourced_at);
CREATE INDEX IF NOT EXISTS idx_mp_order_item       ON market_prices (source_order_item_id) WHERE source_order_item_id IS NOT NULL;
-- Dedupe: at most one PO-source row per order_item.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_order_item_unique
  ON market_prices (source_order_item_id) WHERE source = 'po_entry';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE market_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mp_read ON market_prices;
CREATE POLICY mp_read ON market_prices FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS mp_write ON market_prices;
CREATE POLICY mp_write ON market_prices FOR ALL
  USING (get_user_role() IN ('admin','executive','procurement_officer'))
  WITH CHECK (get_user_role() IN ('admin','executive','procurement_officer'));

GRANT SELECT, INSERT, UPDATE, DELETE ON market_prices TO authenticated;

-- ── Latest price + freshness view ────────────────────────────────────────────
-- display_price picks the verified row if it's inside its own freshness
-- window, else falls back to the most-recent any-source row. Kept as a
-- computed-on-read view (spec §31) so nothing goes stale silently.
CREATE OR REPLACE VIEW public.v_stock_item_latest_price AS
WITH per_item AS (
  SELECT
    si.id AS stock_item_id,
    si.item_name,
    si.amharic_name,
    si.item_code,
    si.unit,
    si.sub_category_id,
    public.get_item_volatility(si.id) AS volatility,
    (SELECT jsonb_build_object(
      'unit_price', mp.unit_price, 'sourced_at', mp.sourced_at,
      'source', mp.source, 'vendor_id', mp.source_vendor_id
     ) FROM market_prices mp WHERE mp.stock_item_id = si.id
     ORDER BY mp.sourced_at DESC LIMIT 1) AS latest_any,
    (SELECT jsonb_build_object(
      'unit_price', mp.unit_price, 'sourced_at', mp.sourced_at,
      'source', mp.source, 'vendor_id', mp.source_vendor_id
     ) FROM market_prices mp
     WHERE mp.stock_item_id = si.id AND mp.source IN ('verified_quote','check_request_response')
     ORDER BY mp.sourced_at DESC LIMIT 1) AS latest_verified,
    (SELECT mp.unit_price FROM market_prices mp
     WHERE mp.stock_item_id = si.id AND mp.sourced_at <= (now() - interval '90 days')
     ORDER BY mp.sourced_at DESC LIMIT 1) AS price_90d_ago
  FROM stock_items si
  WHERE si.active
),
computed AS (
  SELECT
    p.stock_item_id, p.item_name, p.amharic_name, p.item_code, p.unit,
    p.sub_category_id, p.volatility,
    (p.latest_any->>'unit_price')::numeric      AS latest_any_price,
    (p.latest_any->>'sourced_at')::timestamptz  AS latest_any_sourced_at,
    (p.latest_any->>'source')::text             AS latest_any_source,
    (p.latest_any->>'vendor_id')::uuid          AS latest_any_vendor_id,
    (p.latest_verified->>'unit_price')::numeric     AS latest_verified_price,
    (p.latest_verified->>'sourced_at')::timestamptz AS latest_verified_sourced_at,
    -- verified beats any-source only if within its own freshness window
    CASE
      WHEN p.latest_verified IS NULL THEN 'latest_any'
      WHEN public.get_freshness_status(
             GREATEST(0, (EXTRACT(EPOCH FROM (now() - (p.latest_verified->>'sourced_at')::timestamptz)) / 86400.0)::int),
             p.volatility
           ) IN ('outdated') THEN 'latest_any'
      ELSE 'verified'
    END AS pick_kind,
    p.price_90d_ago
  FROM per_item p
),
picked AS (
  SELECT
    c.*,
    CASE WHEN c.pick_kind = 'verified' THEN c.latest_verified_price ELSE c.latest_any_price END AS display_price,
    CASE WHEN c.pick_kind = 'verified' THEN 'verified_quote'         ELSE c.latest_any_source END AS display_price_source,
    CASE WHEN c.pick_kind = 'verified' THEN c.latest_verified_sourced_at ELSE c.latest_any_sourced_at END AS display_price_sourced_at
  FROM computed c
)
SELECT
  p.stock_item_id, p.item_name, p.amharic_name, p.item_code, p.unit, p.sub_category_id,
  p.volatility,
  p.latest_any_price, p.latest_any_sourced_at, p.latest_any_source, p.latest_any_vendor_id,
  p.latest_verified_price, p.latest_verified_sourced_at,
  p.display_price, p.display_price_source, p.display_price_sourced_at,
  CASE WHEN p.display_price_sourced_at IS NULL THEN NULL
       ELSE GREATEST(0, (EXTRACT(EPOCH FROM (now() - p.display_price_sourced_at)) / 86400.0)::int)
  END AS days_since_display_price,
  public.get_freshness_status(
    CASE WHEN p.display_price_sourced_at IS NULL THEN NULL
         ELSE GREATEST(0, (EXTRACT(EPOCH FROM (now() - p.display_price_sourced_at)) / 86400.0)::int) END,
    p.volatility
  ) AS freshness,
  CASE
    WHEN p.price_90d_ago IS NULL OR p.price_90d_ago = 0 OR p.display_price IS NULL THEN NULL
    ELSE ROUND(((p.display_price - p.price_90d_ago) / p.price_90d_ago * 100)::numeric, 2)
  END AS price_trend_90d_pct
FROM picked p;

GRANT SELECT ON public.v_stock_item_latest_price TO authenticated;

-- ── History fetcher (function-view) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.v_market_price_history(
  p_stock_item_id uuid, p_from_date date DEFAULT NULL, p_to_date date DEFAULT NULL
) RETURNS TABLE (
  id uuid, unit_price numeric, currency text, unit text, source text,
  vendor_id uuid, vendor_name text, source_reference text, sourced_at timestamptz,
  sourced_by_staff_id uuid, sourced_by_name text, notes text
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT mp.id, mp.unit_price, mp.currency, mp.unit, mp.source,
         mp.source_vendor_id, v.vendor_name,
         mp.source_reference, mp.sourced_at,
         mp.sourced_by_staff_id, s.employee_name,
         mp.notes
  FROM market_prices mp
  LEFT JOIN vendors v ON v.id = mp.source_vendor_id
  LEFT JOIN staff   s ON s.id = mp.sourced_by_staff_id
  WHERE mp.stock_item_id = p_stock_item_id
    AND (p_from_date IS NULL OR mp.sourced_at::date >= p_from_date)
    AND (p_to_date   IS NULL OR mp.sourced_at::date <= p_to_date)
  ORDER BY mp.sourced_at DESC
  LIMIT 500;
$$;
GRANT EXECUTE ON FUNCTION public.v_market_price_history(uuid, date, date) TO authenticated;

-- ── Per-item vendor history ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_stock_item_vendor_history AS
SELECT
  mp.stock_item_id,
  mp.source_vendor_id AS vendor_id,
  v.vendor_name,
  count(*)::int                        AS quotes_count,
  avg(mp.unit_price)::numeric(14,2)    AS average_price,
  max(mp.sourced_at)                   AS last_sourced_at,
  (SELECT unit_price FROM market_prices mp2
    WHERE mp2.stock_item_id = mp.stock_item_id AND mp2.source_vendor_id = mp.source_vendor_id
    ORDER BY sourced_at DESC LIMIT 1)  AS latest_price
FROM market_prices mp
LEFT JOIN vendors v ON v.id = mp.source_vendor_id
WHERE mp.source_vendor_id IS NOT NULL
GROUP BY mp.stock_item_id, mp.source_vendor_id, v.vendor_name;
GRANT SELECT ON public.v_stock_item_vendor_history TO authenticated;

-- ── PO auto-log trigger ──────────────────────────────────────────────────────
-- Fires when an order transitions into an approved-and-committed state. It
-- iterates that order's items and logs one market_prices row per line that
-- has both a stock_item_id and a unit_price_est. Dedupe: the unique index
-- on (source_order_item_id) WHERE source='po_entry' guarantees at most one
-- PO-source row per line.
--
-- SECURITY DEFINER: PM/foreman can create/edit orders and their approval
-- flip should be able to insert into market_prices even though they don't
-- have the write role. Inputs are strictly derived from the triggering row.
CREATE OR REPLACE FUNCTION public.auto_log_market_price_from_po()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_committed boolean;
  v_committed_prev boolean;
BEGIN
  v_committed_prev := OLD.approval_status IN ('manager_approved','finance_approved') OR OLD.status IN ('approved','completed');
  v_committed      := NEW.approval_status IN ('manager_approved','finance_approved') OR NEW.status IN ('approved','completed');

  IF v_committed AND NOT v_committed_prev THEN
    INSERT INTO market_prices
      (stock_item_id, unit_price, currency, unit, source, source_vendor_id,
       source_reference, source_order_item_id, sourced_by_staff_id, notes)
    SELECT
      oi.stock_item_id,
      oi.unit_price_est,
      'ETB',
      COALESCE(oi.unit, si.unit),
      'po_entry',
      NEW.recommended_vendor_id,
      COALESCE(NEW.request_code, NEW.order_name, NEW.id::text),
      oi.id,
      -- Prefer the manager-approver's staff row (whoever committed the order),
      -- fall back to the requester, fall back to any staff row (as a last
      -- resort — market history requires a staff FK).
      COALESCE(
        (SELECT id FROM staff WHERE user_id = NEW.manager_approved_by LIMIT 1),
        (SELECT id FROM staff WHERE user_id = NEW.finance_approved_by LIMIT 1),
        (SELECT id FROM staff WHERE user_id = NEW.requested_by_user_id LIMIT 1),
        (SELECT id FROM staff ORDER BY created_at LIMIT 1)
      ),
      'Auto-logged from PO approval'
    FROM order_items oi
    LEFT JOIN stock_items si ON si.id = oi.stock_item_id
    WHERE oi.order_id = NEW.id
      AND oi.stock_item_id IS NOT NULL
      AND oi.unit_price_est IS NOT NULL
      AND oi.unit_price_est > 0
    ON CONFLICT (source_order_item_id) WHERE source = 'po_entry'
    DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_log_market_price_po ON orders;
CREATE TRIGGER trg_auto_log_market_price_po
  AFTER UPDATE OF approval_status, status ON orders
  FOR EACH ROW EXECUTE FUNCTION public.auto_log_market_price_from_po();

-- ── Explicit verified-quote RPC (Procurement + admin) ────────────────────────
CREATE OR REPLACE FUNCTION public.log_verified_market_price(
  p_stock_item_id uuid, p_unit_price numeric, p_vendor_id uuid,
  p_notes text DEFAULT NULL, p_source_reference text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_id uuid; v_staff uuid; v_unit text;
BEGIN
  IF public.get_user_role() NOT IN ('admin','executive','procurement_officer') THEN
    RAISE EXCEPTION 'Only Procurement, admin, or executive may log a verified market price';
  END IF;
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Your account is not linked to a staff record';
  END IF;
  SELECT unit INTO v_unit FROM stock_items WHERE id = p_stock_item_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Stock item % not found', p_stock_item_id;
  END IF;

  INSERT INTO market_prices
    (stock_item_id, unit_price, currency, unit, source, source_vendor_id,
     source_reference, sourced_by_staff_id, notes)
  VALUES
    (p_stock_item_id, p_unit_price, 'ETB', v_unit, 'verified_quote', p_vendor_id,
     p_source_reference, v_staff, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.log_verified_market_price(uuid, numeric, uuid, text, text) TO authenticated;
