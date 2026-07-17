-- ============================================================
-- Materials stock-first check, part 2: the actual fulfillment step.
--
-- SECURITY DEFINER, matching the established pattern for "role X
-- causes effect Y only via a controlled event" (mark_bundle_fulfilled_
-- on_grn, undo_grn_fulfillment, apply_approved_budget_variation) —
-- here the effect is a real stock_issues INSERT, which order_items'
-- own callers (staff, PM, HR, finance, etc, per orders' RLS) don't
-- otherwise have direct write access to (stock_issues RLS is admin/
-- manager/stock_manager/procurement_officer only). No extra role
-- check beyond "must be logged in" — order_items itself already has
-- no role restriction (FOR ALL USING auth.uid() IS NOT NULL, migration
-- 021), and per the design goal this must be automatic and fast, not
-- another gate someone routes around.
--
-- Deliberately does nothing (no error, no side effect) when there's
-- no stock to draw on — the caller's existing PR flow just proceeds
-- to external procurement exactly as before this migration existed.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION check_and_fulfill_from_stock(p_order_item_id UUID)
RETURNS TABLE(issued_qty NUMERIC, remaining_qty NUMERIC, new_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item        RECORD;
  v_on_hand     NUMERIC;
  v_avg_cost    NUMERIC;
  v_issue_qty   NUMERIC;
  v_new_status  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT oi.*, o.project_id AS req_project_id
  INTO v_item
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found';
  END IF;

  -- No stock_item linked, or nothing requested — nothing for this
  -- function to do. The PR line proceeds exactly as it did before
  -- this migration (unchanged §1a default).
  IF v_item.stock_item_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, COALESCE(v_item.quantity, 0), v_item.status;
    RETURN;
  END IF;

  SELECT qty_on_hand, avg_unit_cost INTO v_on_hand, v_avg_cost
  FROM v_stock_on_hand WHERE stock_item_id = v_item.stock_item_id;

  v_on_hand   := GREATEST(COALESCE(v_on_hand, 0), 0);
  v_issue_qty := LEAST(v_on_hand, v_item.quantity);

  IF v_issue_qty <= 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, v_item.quantity, v_item.status;
    RETURN;
  END IF;

  INSERT INTO stock_issues (stock_item_id, quantity, issue_type, project_id, order_item_id, unit_cost_snapshot, issued_date)
  VALUES (v_item.stock_item_id, v_issue_qty, 'project_use', v_item.req_project_id, p_order_item_id, v_avg_cost, CURRENT_DATE);

  v_new_status := CASE WHEN v_issue_qty >= v_item.quantity THEN 'stock_fulfilled' ELSE 'partially_sourced' END;

  UPDATE order_items
  SET status = v_new_status,
      fulfillment_notes = TRIM(BOTH E'\n' FROM COALESCE(fulfillment_notes || E'\n', '') ||
        format('%s %s issued from stock on %s', v_issue_qty, COALESCE(unit, ''), CURRENT_DATE))
  WHERE id = p_order_item_id;

  RETURN QUERY SELECT v_issue_qty, (v_item.quantity - v_issue_qty), v_new_status;
END;
$$;

GRANT EXECUTE ON FUNCTION check_and_fulfill_from_stock(UUID) TO authenticated;

-- Verify
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'check_and_fulfill_from_stock';
