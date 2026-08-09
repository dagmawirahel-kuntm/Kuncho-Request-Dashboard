-- 188 — Market prices · Part C: check-requests + fulfill/cancel + inline wiring
--
-- Two paths create a check request:
--   1) An explicit user action via request_market_price_check() RPC (or the
--      Market Trends UI).
--   2) A user ticking `order_items.needs_market_check` on the order form,
--      handled by trg_order_item_needs_check_creates_request.
--
-- Procurement responds via fulfill_market_price_check(), which is atomic:
-- it inserts a market_prices row, marks the request fulfilled, and — if the
-- request originated from an order_item — stamps the new price back onto
-- that order_item and clears its needs_market_check flag.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS market_price_check_requests (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id                 uuid NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  requested_by_staff_id         uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  project_id                    uuid REFERENCES projects(id) ON DELETE SET NULL,
  order_item_id                 uuid REFERENCES order_items(id) ON DELETE SET NULL,
  reason                        text,
  needed_by                     date,
  status                        text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','fulfilled','cancelled')),
  fulfilled_by_market_price_id  uuid REFERENCES market_prices(id) ON DELETE SET NULL,
  fulfilled_at                  timestamptz,
  cancelled_reason              text,
  cancelled_at                  timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpcr_item          ON market_price_check_requests (stock_item_id);
CREATE INDEX IF NOT EXISTS idx_mpcr_status        ON market_price_check_requests (status);
CREATE INDEX IF NOT EXISTS idx_mpcr_requester     ON market_price_check_requests (requested_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_mpcr_needed_by     ON market_price_check_requests (needed_by NULLS LAST, created_at);
CREATE INDEX IF NOT EXISTS idx_mpcr_order_item    ON market_price_check_requests (order_item_id) WHERE order_item_id IS NOT NULL;
-- One open request per (item, order_item_id) — prevents dupes when a user
-- toggles the flag on-off-on.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpcr_open_per_order_item
  ON market_price_check_requests (order_item_id)
  WHERE status = 'open' AND order_item_id IS NOT NULL;

-- Now that the table exists, wire the pending FK from market_prices.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='market_prices_check_request_fk') THEN
    ALTER TABLE market_prices
      ADD CONSTRAINT market_prices_check_request_fk
      FOREIGN KEY (related_check_request_id) REFERENCES market_price_check_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE market_price_check_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mpcr_read ON market_price_check_requests;
CREATE POLICY mpcr_read ON market_price_check_requests FOR SELECT
  USING (
    requested_by_staff_id = public.current_staff_id()
    OR public.get_user_role() IN ('admin','executive','procurement_officer','hr_officer','finance')
    OR (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = market_price_check_requests.project_id
        AND p.project_manager_id = public.current_staff_id()
    ))
  );

DROP POLICY IF EXISTS mpcr_insert ON market_price_check_requests;
CREATE POLICY mpcr_insert ON market_price_check_requests FOR INSERT
  WITH CHECK (
    requested_by_staff_id = public.current_staff_id()
    OR public.get_user_role() IN ('admin','executive','procurement_officer')
  );

-- Updates go through RPCs only, but allow procurement/admin to correct rows.
DROP POLICY IF EXISTS mpcr_update ON market_price_check_requests;
CREATE POLICY mpcr_update ON market_price_check_requests FOR UPDATE
  USING (public.get_user_role() IN ('admin','executive','procurement_officer'))
  WITH CHECK (public.get_user_role() IN ('admin','executive','procurement_officer'));

GRANT SELECT, INSERT, UPDATE ON market_price_check_requests TO authenticated;

-- ── RPC: request a check ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_market_price_check(
  p_stock_item_id uuid,
  p_project_id    uuid DEFAULT NULL,
  p_reason        text DEFAULT NULL,
  p_needed_by     date DEFAULT NULL,
  p_order_item_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_staff uuid; v_id uuid; v_existing uuid;
BEGIN
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your account is not linked to a staff record'; END IF;

  -- Dedupe by order_item — if there's already an open request for this line
  -- (from a previous flag toggle), reuse it.
  IF p_order_item_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM market_price_check_requests
      WHERE order_item_id = p_order_item_id AND status = 'open' LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  INSERT INTO market_price_check_requests
    (stock_item_id, requested_by_staff_id, project_id, order_item_id, reason, needed_by, status)
  VALUES
    (p_stock_item_id, v_staff, p_project_id, p_order_item_id, p_reason, p_needed_by, 'open')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.request_market_price_check(uuid, uuid, text, date, uuid) TO authenticated;

-- ── RPC: fulfill a check (atomic) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fulfill_market_price_check(
  p_request_id uuid,
  p_unit_price numeric,
  p_vendor_id  uuid DEFAULT NULL,
  p_notes      text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_req      market_price_check_requests%ROWTYPE;
  v_staff    uuid;
  v_unit     text;
  v_price_id uuid;
BEGIN
  IF public.get_user_role() NOT IN ('admin','executive','procurement_officer') THEN
    RAISE EXCEPTION 'Only Procurement, admin, or executive may fulfill a check request';
  END IF;
  SELECT * INTO v_req FROM market_price_check_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Request % not found', p_request_id; END IF;
  IF v_req.status <> 'open' THEN RAISE EXCEPTION 'Request is already %', v_req.status; END IF;
  v_staff := public.current_staff_id();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Your account is not linked to a staff record'; END IF;
  SELECT unit INTO v_unit FROM stock_items WHERE id = v_req.stock_item_id;

  INSERT INTO market_prices
    (stock_item_id, unit_price, currency, unit, source, source_vendor_id,
     sourced_by_staff_id, notes, related_check_request_id)
  VALUES
    (v_req.stock_item_id, p_unit_price, 'ETB', v_unit, 'check_request_response',
     p_vendor_id, v_staff, p_notes, p_request_id)
  RETURNING id INTO v_price_id;

  UPDATE market_price_check_requests
     SET status = 'fulfilled', fulfilled_by_market_price_id = v_price_id,
         fulfilled_at = now(), updated_at = now()
   WHERE id = p_request_id;

  -- If the request came from an order_item, stamp the price back + clear
  -- the needs_market_check flag. Only touches unit_price_est if it was
  -- null or the flag was still set — so an operator who manually overrode
  -- the price isn't clobbered.
  IF v_req.order_item_id IS NOT NULL THEN
    UPDATE order_items
       SET unit_price_est = COALESCE(unit_price_est, p_unit_price),
           needs_market_check = false,
           updated_at = now()
     WHERE id = v_req.order_item_id
       AND (needs_market_check = true OR unit_price_est IS NULL);
  END IF;

  RETURN v_price_id;
END $$;
GRANT EXECUTE ON FUNCTION public.fulfill_market_price_check(uuid, numeric, uuid, text) TO authenticated;

-- ── RPC: cancel a check ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_market_price_check(
  p_request_id uuid, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_req market_price_check_requests%ROWTYPE; v_staff uuid;
BEGIN
  SELECT * INTO v_req FROM market_price_check_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Request % not found', p_request_id; END IF;
  IF v_req.status <> 'open' THEN RAISE EXCEPTION 'Only open requests can be cancelled'; END IF;
  v_staff := public.current_staff_id();
  IF public.get_user_role() NOT IN ('admin','executive','procurement_officer')
     AND v_req.requested_by_staff_id <> v_staff THEN
    RAISE EXCEPTION 'Only the requester or Procurement may cancel this request';
  END IF;

  UPDATE market_price_check_requests
     SET status = 'cancelled', cancelled_reason = p_reason, cancelled_at = now(), updated_at = now()
   WHERE id = p_request_id;
END $$;
GRANT EXECUTE ON FUNCTION public.cancel_market_price_check(uuid, text) TO authenticated;

-- ── Inline: needs_market_check toggle → auto-create request ──────────────────
-- SECURITY DEFINER so the anyone-who-can-edit-order_items path (PM, foreman,
-- ops manager) can lodge a request even if they wouldn't have direct INSERT
-- permission on the check-request table. Input strictly derived from the row.
CREATE OR REPLACE FUNCTION public.on_order_item_needs_market_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project uuid; v_staff uuid; v_open uuid;
BEGIN
  IF NEW.needs_market_check = true
     AND (TG_OP = 'INSERT' OR OLD.needs_market_check IS DISTINCT FROM true)
     AND NEW.stock_item_id IS NOT NULL THEN
    SELECT project_id INTO v_project FROM orders WHERE id = NEW.order_id;
    -- Requester: the order requester if we can resolve to a staff row, else
    -- fall back to the caller. If neither resolves, don't create — the
    -- request table requires a real staff_id.
    v_staff := COALESCE(
      (SELECT id FROM staff WHERE user_id =
        (SELECT requested_by_user_id FROM orders WHERE id = NEW.order_id) LIMIT 1),
      public.current_staff_id()
    );
    IF v_staff IS NULL THEN RETURN NEW; END IF;

    -- Dedupe: at most one open request per order_item.
    SELECT id INTO v_open FROM market_price_check_requests
      WHERE order_item_id = NEW.id AND status = 'open' LIMIT 1;
    IF v_open IS NOT NULL THEN RETURN NEW; END IF;

    INSERT INTO market_price_check_requests
      (stock_item_id, requested_by_staff_id, project_id, order_item_id, reason, status)
    VALUES
      (NEW.stock_item_id, v_staff, v_project, NEW.id,
       'Auto-created from order_item needs_market_check flag', 'open');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_item_needs_check_creates_request ON order_items;
CREATE TRIGGER trg_order_item_needs_check_creates_request
  AFTER INSERT OR UPDATE OF needs_market_check ON order_items
  FOR EACH ROW EXECUTE FUNCTION public.on_order_item_needs_market_check();
