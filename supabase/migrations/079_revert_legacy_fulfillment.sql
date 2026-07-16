-- ============================================================
-- Reverts a PO that was fulfilled BEFORE the GRN system existed —
-- via the old self-service "Mark as Fulfilled" button, with no real
-- goods_received_notes row behind it at all. Different situation from
-- undo_grn_fulfillment (078): there's nothing to delete, just a
-- status that needs to go back to 'ordered' so the real "Record GRN"
-- flow (canRecordGrn: status = 'ordered' && no GRN) becomes reachable.
--
-- Deliberately refuses to touch a bundle that DOES have a real GRN —
-- that's what undo_grn_fulfillment is for. This path is only for the
-- legacy, no-GRN-at-all case.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION revert_legacy_fulfillment(p_bundle_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'stock_manager', 'logistics_officer') THEN
    RAISE EXCEPTION 'Not authorized to revert this purchase order';
  END IF;

  IF EXISTS (SELECT 1 FROM goods_received_notes WHERE sourcing_bundle_id = p_bundle_id) THEN
    RAISE EXCEPTION 'This PO has a real GRN on record — use Undo Fulfillment instead';
  END IF;

  UPDATE sourcing_bundles
  SET status = 'ordered', fulfilled_at = NULL
  WHERE id = p_bundle_id AND status = 'fulfilled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found or not currently fulfilled';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION revert_legacy_fulfillment(UUID) TO authenticated;

-- Verify
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'revert_legacy_fulfillment';
