-- ============================================================
-- Stock-out no longer happens automatically the instant a PR line is
-- linked to a catalogued item with on-hand quantity. check_and_
-- fulfill_from_stock() (migration 091) previously drew stock down
-- and marked the line fulfilled in one silent step on save — no
-- human check, and critically, no transport arranged to actually
-- move the item from the workshop/warehouse to the requesting site.
--
-- New flow: a line that stock can cover is flagged
-- 'stock_pending_dispatch' with a proposed quantity — nothing is
-- deducted yet. A stock officer reviews the queue
-- (v_stock_pending_dispatch), confirms it's really available (fresh
-- on-hand, since time has passed since the PR was saved), and signs
-- off — which is the one moment stock_issues actually gets written,
-- and which requires a transport job (the existing transportation_
-- requests module — job_type 'material_move', vehicle/driver
-- assignment, requested -> assigned -> in_progress -> completed
-- lifecycle already built there) so the delivery from workshop to
-- site is trackable the same way any other dispatch is, not implied
-- by a stock ledger entry alone.
--
-- Known tradeoff, stated plainly rather than silently glossed over:
-- deferring the deduction means two PR lines could both see the same
-- units "available" between check-time and sign-off-time (no hold is
-- placed). The stock officer's own queue re-reads on-hand fresh at
-- sign-off and the RPC re-verifies before writing, so the failure
-- mode is "sign-off correctly refuses when it's actually short," not
-- a silent overcommit — but a real reservation system, if this
-- becomes a frequent enough collision, is a future enhancement, not
-- something invented here without being asked for.
-- ============================================================

SET search_path TO public;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('pending', 'sourced', 'partially_sourced', 'unfulfilled', 'cancelled', 'stock_fulfilled', 'stock_pending_dispatch'));

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_dispatch_qty NUMERIC(10,2);

ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS transport_request_id UUID REFERENCES transportation_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_issues_transport ON stock_issues(transport_request_id);

-- Migration 063 gave stock_manager/logistics_officer read on
-- sourcing_bundles/sourcing_bundle_items/order_items for the GRN flow,
-- but never on orders itself (GRN didn't need it). v_stock_pending_
-- dispatch below joins order_items to orders (for order_name/
-- project_id), and is security_invoker, so without this the stock
-- officer's own queue would silently show zero rows.
DROP POLICY IF EXISTS "grn_roles_read_orders" ON orders;
CREATE POLICY "grn_roles_read_orders" ON orders FOR SELECT
  USING (get_user_role() IN ('stock_manager', 'logistics_officer'));

-- Same gap on projects: logistics_officer already reads it (059), but
-- stock_manager — the view's primary user — never got a grant, so the
-- v_stock_pending_dispatch project_name column would silently come
-- back NULL for them (LEFT JOIN hides an RLS-blocked read as "no row"
-- rather than an error).
DROP POLICY IF EXISTS "stock_manager_read_projects" ON projects;
CREATE POLICY "stock_manager_read_projects" ON projects FOR SELECT
  USING (get_user_role() = 'stock_manager');

-- ── check_and_fulfill_from_stock(): now flags, never issues ────────
-- Old signature (091) returned OUT param `issued_qty`; the new shape
-- (`proposed_qty`) is a different row type, which CREATE OR REPLACE
-- cannot change in place.
DROP FUNCTION IF EXISTS check_and_fulfill_from_stock(UUID);
CREATE OR REPLACE FUNCTION check_and_fulfill_from_stock(p_order_item_id UUID)
RETURNS TABLE(proposed_qty NUMERIC, remaining_qty NUMERIC, new_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item      RECORD;
  v_on_hand   NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT oi.* INTO v_item FROM order_items oi WHERE oi.id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found';
  END IF;

  IF v_item.stock_item_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, COALESCE(v_item.quantity, 0), v_item.status;
    RETURN;
  END IF;

  SELECT qty_on_hand INTO v_on_hand FROM v_stock_on_hand WHERE stock_item_id = v_item.stock_item_id;
  v_on_hand := GREATEST(COALESCE(v_on_hand, 0), 0);

  IF v_on_hand <= 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, v_item.quantity, v_item.status;
    RETURN;
  END IF;

  UPDATE order_items
  SET status = 'stock_pending_dispatch',
      stock_dispatch_qty = LEAST(v_on_hand, v_item.quantity),
      fulfillment_notes = TRIM(BOTH E'\n' FROM COALESCE(fulfillment_notes || E'\n', '') ||
        format('%s %s available from stock as of %s — awaiting stock officer sign-off and transport assignment',
               LEAST(v_on_hand, v_item.quantity), COALESCE(unit, ''), CURRENT_DATE))
  WHERE id = p_order_item_id;

  RETURN QUERY SELECT LEAST(v_on_hand, v_item.quantity), (v_item.quantity - LEAST(v_on_hand, v_item.quantity)), 'stock_pending_dispatch'::TEXT;
END;
$$;

-- ── The sign-off: the one place stock_issues actually gets written ─
CREATE OR REPLACE FUNCTION sign_off_stock_dispatch(
  p_order_item_id UUID,
  p_transport_request_id UUID DEFAULT NULL,
  p_quantity NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item        RECORD;
  v_req_project UUID;
  v_on_hand     NUMERIC;
  v_qty         NUMERIC;
  v_avg_cost    NUMERIC;
  v_transport_id UUID;
  v_new_status  TEXT;
BEGIN
  IF get_user_role() NOT IN ('admin', 'manager', 'stock_manager', 'procurement_officer') THEN
    RAISE EXCEPTION 'Only admin, manager, stock_manager, or procurement_officer can sign off a stock dispatch';
  END IF;

  SELECT oi.*, o.project_id AS proj_id INTO v_item
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found';
  END IF;
  IF v_item.status <> 'stock_pending_dispatch' THEN
    RAISE EXCEPTION 'Order item % is not pending stock dispatch (status = %)', p_order_item_id, v_item.status;
  END IF;

  v_req_project := v_item.proj_id;
  v_qty := COALESCE(p_quantity, v_item.stock_dispatch_qty);
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'No quantity to dispatch';
  END IF;

  -- Re-verify on-hand NOW, not the stale figure from when the PR was
  -- saved — this is what stands in for a real reservation/hold.
  SELECT qty_on_hand, avg_unit_cost INTO v_on_hand, v_avg_cost
  FROM v_stock_on_hand WHERE stock_item_id = v_item.stock_item_id;
  IF COALESCE(v_on_hand, 0) < v_qty THEN
    RAISE EXCEPTION 'Only % on hand now — not enough to dispatch % (stock was likely committed elsewhere since this PR was saved)', COALESCE(v_on_hand, 0), v_qty;
  END IF;

  IF p_transport_request_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM transportation_requests WHERE id = p_transport_request_id) THEN
      RAISE EXCEPTION 'Transport request not found';
    END IF;
    v_transport_id := p_transport_request_id;
  ELSE
    -- No existing job named — open a new dispatch job in the existing
    -- transportation module rather than inventing a parallel one.
    -- Vehicle/driver assignment and status progression from here on
    -- happen exactly like any other transport job, through that
    -- module's own UI.
    INSERT INTO transportation_requests (
      request_name, job_type, pickup_location_text, project_id, requested_by_id, requested_date, job_status, notes
    ) VALUES (
      format('Stock dispatch: %s', (SELECT item_name FROM stock_items WHERE id = v_item.stock_item_id)),
      'material_move',
      'Workshop/Warehouse',
      v_req_project,
      auth.uid(),
      CURRENT_DATE,
      'requested',
      format('Auto-created at stock dispatch sign-off for order item %s', p_order_item_id)
    )
    RETURNING id INTO v_transport_id;
  END IF;

  INSERT INTO stock_issues (stock_item_id, quantity, issue_type, project_id, order_item_id, transport_request_id, unit_cost_snapshot, issued_date)
  VALUES (v_item.stock_item_id, v_qty, 'project_use', v_req_project, p_order_item_id, v_transport_id, v_avg_cost, CURRENT_DATE);

  v_new_status := CASE WHEN v_qty >= v_item.quantity THEN 'stock_fulfilled' ELSE 'partially_sourced' END;

  UPDATE order_items
  SET status = v_new_status,
      stock_dispatch_qty = NULL,
      fulfillment_notes = TRIM(BOTH E'\n' FROM COALESCE(fulfillment_notes || E'\n', '') ||
        format('%s %s signed off and dispatched on %s, transport job %s', v_qty, COALESCE(unit, ''), CURRENT_DATE, v_transport_id))
  WHERE id = p_order_item_id;

  RETURN v_transport_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sign_off_stock_dispatch(UUID, UUID, NUMERIC) TO authenticated;

-- ── The stock officer's queue ───────────────────────────────────────
CREATE OR REPLACE VIEW v_stock_pending_dispatch
WITH (security_invoker = true) AS
SELECT
  oi.id AS order_item_id,
  oi.item_name,
  oi.quantity AS requested_qty,
  oi.stock_dispatch_qty AS proposed_qty,
  oi.unit,
  si.id AS stock_item_id,
  si.item_name AS stock_item_name,
  si.warehouse_zone,
  soh.qty_on_hand AS current_on_hand,
  o.id AS order_id,
  o.order_name,
  o.project_id,
  p.project_name,
  o.requested_by_user_id
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN projects p ON p.id = o.project_id
JOIN stock_items si ON si.id = oi.stock_item_id
LEFT JOIN v_stock_on_hand soh ON soh.stock_item_id = si.id
WHERE oi.status = 'stock_pending_dispatch'
ORDER BY oi.updated_at;

GRANT SELECT ON v_stock_pending_dispatch TO authenticated;

-- Verify: function signatures, view, new column/constraint present.
SELECT proname FROM pg_proc WHERE proname IN ('check_and_fulfill_from_stock', 'sign_off_stock_dispatch');
SELECT count(*) AS pending_dispatch_count FROM v_stock_pending_dispatch;
SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_issues' AND column_name = 'transport_request_id';
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'order_items_status_check';
