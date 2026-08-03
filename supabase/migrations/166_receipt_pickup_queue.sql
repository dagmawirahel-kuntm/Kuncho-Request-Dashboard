-- ============================================================
-- Receipt pickup queue (#4). A receipt that's been photographed but
-- whose paper hasn't reached the office (physical_received_at IS NULL)
-- is a pickup task for the electric-motorbike driver. "Bundled" in the
-- user's words = captured in a picture, not yet physically delivered.
--
-- No new task table: the uncollected receipts ARE the queue, unioned
-- across both receipt homes (vendor_receipts from 157, client receipts
-- on client_attachments from 158) with a location hint so the driver
-- knows where to go. Confirming pickup just sets physical custody —
-- the same field finance would otherwise confirm.
--
-- The existing confirm_*_physical RPCs are gated to admin/finance; a
-- driver isn't finance, so pickup needs its own entry point.
-- confirm_receipt_pickup lets the pickup roles (logistics_officer /
-- e-bike driver, plus admin/finance) mark a receipt collected, routed
-- to the right table by kind.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE VIEW v_receipt_pickup_queue
WITH (security_invoker = true) AS
-- Vendor tax receipts: photographed, paper not in yet.
SELECT
  'vendor'::text          AS kind,
  vr.id,
  vr.receipt_no,
  vr.receipt_date,
  vr.vat_amount,
  v.vendor_name           AS counterparty,
  v.location              AS pickup_hint,
  vr.entered_at           AS captured_at,
  vr.status               AS workflow_status
FROM vendor_receipts vr
LEFT JOIN vendors v ON v.id = vr.vendor_id
WHERE vr.document_url IS NOT NULL
  AND vr.physical_received_at IS NULL
  AND vr.status <> 'rejected'
UNION ALL
-- Client receipts (receipt / wht_receipt categories only).
SELECT
  'client'::text,
  ca.id,
  ca.receipt_no,
  ca.receipt_date,
  ca.vat_amount,
  c.client_name,
  NULLIF(concat_ws(' · ', c.address, c.phone), ''),
  ca.created_at,
  COALESCE(ca.tax_status, 'pending_review')
FROM client_attachments ca
LEFT JOIN clients c ON c.id = ca.client_id
WHERE ca.category IN ('receipt', 'wht_receipt')
  AND ca.file_path IS NOT NULL
  AND ca.physical_received_at IS NULL;

GRANT SELECT ON v_receipt_pickup_queue TO authenticated;

-- ── Driver confirms a pickup ────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_receipt_pickup(p_kind TEXT, p_id UUID, p_note TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance', 'logistics_officer', 'operations_manager') THEN
    RAISE EXCEPTION 'Only the pickup driver, finance, or admin can confirm a receipt pickup';
  END IF;

  IF p_kind = 'vendor' THEN
    UPDATE vendor_receipts
    SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
    WHERE id = p_id AND physical_received_at IS NULL;
  ELSIF p_kind = 'client' THEN
    UPDATE client_attachments
    SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
    WHERE id = p_id AND physical_received_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Unknown receipt kind: %', p_kind;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION confirm_receipt_pickup(TEXT, UUID, TEXT) TO authenticated;

-- Logistics officer / driver needs to READ client receipts to see the
-- queue (vendor receipts they can already read via the vehicle/expense
-- grant path; client_attachments needs an explicit read for them).
DROP POLICY IF EXISTS "logistics_read_client_receipts" ON client_attachments;
CREATE POLICY "logistics_read_client_receipts" ON client_attachments FOR SELECT
  USING (get_user_role() IN ('logistics_officer', 'operations_manager') AND category IN ('receipt', 'wht_receipt'));

-- ── Verify ──────────────────────────────────────────────────────────
SELECT proname FROM pg_proc WHERE proname='confirm_receipt_pickup';
SELECT count(*) AS pickup_queue_rows FROM v_receipt_pickup_queue;
