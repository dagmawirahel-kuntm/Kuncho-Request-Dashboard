-- ============================================================
-- An order_item can be covered by stock (115) while ALSO already
-- sitting in a sourcing bundle — e.g. a procurement officer bundled
-- the full requested quantity for a vendor quote before stock was
-- ever checked, or bundled only the leftover after a partial stock
-- match. Either way, once the stock officer actually signs off a
-- dispatch, whatever bundle line still represents that same
-- order_item needs to shrink by the dispatched quantity — otherwise
-- procurement ends up buying units that already left the warehouse.
--
-- Scope, deliberately narrow, and constrained by an invariant that
-- already exists in this codebase (056): sourcing_bundle_items rows
-- are completely frozen — no INSERT/UPDATE/DELETE at all — the moment
-- their bundle leaves 'drafting' (trg_enforce_bundle_items_drafting_
-- only). That's not just 'ordered'/'fulfilled' — 'submitted' and
-- 'approved' are frozen too. So:
--   * bundle still 'drafting'   -> reduce quantity_actual by the
--     dispatched amount (floor 0) and note it on the bundle line —
--     both are still writable.
--   * bundle 'submitted'/'approved'/'ordered'/'fulfilled' -> the
--     bundle_items row cannot be touched at all (the trigger would
--     reject it), so the overlap is recorded on order_items.
--     fulfillment_notes instead — visible, not silently lost, without
--     fighting an invariant that exists for a good reason (a
--     submitted/approved/ordered figure is a real number someone
--     downstream is relying on).
--   * 'cancelled' bundles: no longer an active commitment, no action.
-- ============================================================

SET search_path TO public;

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
  v_bundle_item RECORD;
  v_locked_note TEXT := '';
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

  -- Sync any sourcing bundle line still open (drafting) for this same
  -- order_item: the dispatched quantity no longer needs to come from
  -- a vendor, so shrink the bundled quantity to match.
  FOR v_bundle_item IN
    SELECT sbi.id, sbi.quantity_actual
    FROM sourcing_bundle_items sbi
    JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id
    WHERE sbi.order_item_id = p_order_item_id
      AND sb.status = 'drafting'
  LOOP
    UPDATE sourcing_bundle_items
    SET quantity_actual = GREATEST(COALESCE(v_bundle_item.quantity_actual, 0) - v_qty, 0),
        notes = TRIM(BOTH E'\n' FROM COALESCE(notes || E'\n', '') ||
          format('%s %s covered from stock at dispatch sign-off on %s — quantity reduced accordingly', v_qty, COALESCE(v_item.unit, ''), CURRENT_DATE))
    WHERE id = v_bundle_item.id;
  END LOOP;

  -- Bundles past drafting are frozen at the DB level (056) — can't
  -- touch quantity_actual or notes there even if we wanted to. Fold
  -- the overlap into the order_item's own note instead, so it's
  -- visible without fighting that invariant.
  FOR v_bundle_item IN
    SELECT sb.bundle_code, sb.status
    FROM sourcing_bundle_items sbi
    JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id
    WHERE sbi.order_item_id = p_order_item_id
      AND sb.status IN ('submitted', 'approved', 'ordered', 'fulfilled')
  LOOP
    v_locked_note := v_locked_note || format(E'\nAlso bundled in %s (%s) — quantity NOT auto-adjusted there (frozen past drafting), review manually.',
      COALESCE(v_bundle_item.bundle_code, 'a sourcing bundle'), v_bundle_item.status);
  END LOOP;

  UPDATE order_items
  SET status = v_new_status,
      stock_dispatch_qty = NULL,
      fulfillment_notes = TRIM(BOTH E'\n' FROM COALESCE(fulfillment_notes || E'\n', '') ||
        format('%s %s signed off and dispatched on %s, transport job %s', v_qty, COALESCE(unit, ''), CURRENT_DATE, v_transport_id) ||
        v_locked_note)
  WHERE id = p_order_item_id;

  RETURN v_transport_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sign_off_stock_dispatch(UUID, UUID, NUMERIC) TO authenticated;

-- Verify: function still resolves, no signature drift.
SELECT proname FROM pg_proc WHERE proname = 'sign_off_stock_dispatch';
