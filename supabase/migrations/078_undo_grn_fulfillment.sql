-- ============================================================
-- Undo an erroneous GRN — deletes the GRN (and its items, via
-- CASCADE) and reverts the sourcing_bundle back to 'ordered',
-- clearing fulfilled_at. Does NOT touch the PO itself: vendor, line
-- items, notes, and history all stay exactly as they were — this
-- only undoes what mark_bundle_fulfilled_on_grn() (063) did.
--
-- SECURITY DEFINER for the same reason as mark_bundle_fulfilled_on_grn:
-- stock_manager/logistics_officer have no direct UPDATE grant on
-- sourcing_bundles (by design — the only sanctioned way to change its
-- status is through a real GRN event, in either direction), and no
-- DELETE policy exists on goods_received_notes at all today. This
-- function is the sole privileged path for reversing a fulfillment,
-- mirroring the same roles allowed to create the GRN in the first
-- place: admin, stock_manager, logistics_officer.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION undo_grn_fulfillment(p_grn_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bundle_id UUID;
BEGIN
  IF get_user_role() NOT IN ('admin', 'stock_manager', 'logistics_officer') THEN
    RAISE EXCEPTION 'Not authorized to undo a goods received note';
  END IF;

  SELECT sourcing_bundle_id INTO v_bundle_id FROM goods_received_notes WHERE id = p_grn_id;
  IF v_bundle_id IS NULL THEN
    RAISE EXCEPTION 'GRN not found';
  END IF;

  DELETE FROM goods_received_notes WHERE id = p_grn_id;

  UPDATE sourcing_bundles
  SET status = 'ordered', fulfilled_at = NULL
  WHERE id = v_bundle_id AND status = 'fulfilled';
END;
$$;

GRANT EXECUTE ON FUNCTION undo_grn_fulfillment(UUID) TO authenticated;

-- Verify
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'undo_grn_fulfillment';
