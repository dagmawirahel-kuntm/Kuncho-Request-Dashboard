-- Root cause of "purchased items never show up in stock or in the
-- project's available material list, they just sit as a paid record":
--
-- receipt_catalogued_stock_item() (109, rewritten 159/164) is the only
-- thing that turns a received GRN line into a stock_receipts row —
-- which is what makes an item count as stock AND appear in
-- v_project_material_balance for a project. It silently no-ops
-- whenever the underlying order_item has no stock_item_id.
--
-- auto_catalog_new_stock_item() (092) was meant to cover that case,
-- but only fires when propose_new_stock_item was explicitly ticked at
-- PR time — an opt-in checkbox nobody ticks in practice, since a
-- requester typing a free-text item name has no reason to know it
-- matters. Checked live: 5 of the last 20 received GRN line items
-- (25%) have stock_item_id IS NULL and zero stock_receipts rows —
-- paid for, received, invisible everywhere except the expense record.
-- Confirmed concretely on PO-2026-0035 (Jewar Gebeyahu Wholesale
-- Trading PLC — Vertical profile for partition, Cement Board).
--
-- Separately, even when auto_catalog_new_stock_item() did fire, it
-- hardcoded destination='warehouse' on its own stock_receipts insert —
-- so a project-tied order's auto-catalogued item still wouldn't have
-- shown up in v_project_material_balance (only destination='site' +
-- project_id rows do, per 164).
--
-- Fix: drop the opt-in requirement — auto-catalog fires on ANY
-- received line with no stock_item_id, unconditionally. It now only
-- creates the catalog row (still 'pending_setup', still needs a
-- stock_manager to set item_code's category/warehouse_zone/
-- reorder_level before it counts in future stock-checks — that
-- safety invariant from 092 is untouched) and links stock_item_id.
-- The stock_receipts insert is left solely to
-- receipt_catalogued_stock_item(), which already fires right after
-- (trigger name sort order: trg_auto_catalog_new_stock_item <
-- trg_receipt_catalogued_stock_item) and already computes destination/
-- project_id correctly — so removing the duplicate insert here also
-- removes the hardcoded-warehouse bug for free, without touching the
-- function that already gets it right.

CREATE OR REPLACE FUNCTION auto_catalog_new_stock_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_item         RECORD;
  v_new_stock_item_id  UUID;
BEGIN
  SELECT oi.* INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  IF NOT FOUND OR v_order_item.stock_item_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO stock_items (item_name, unit, sub_category_id, catalog_status, active, notes)
  VALUES (
    v_order_item.item_name, v_order_item.unit, v_order_item.sub_category_id, 'pending_setup', TRUE,
    'Auto-created on receipt from PR line ' || v_order_item.id || ' — needs a proper category (for item_code), warehouse_zone, and reorder_level set before it counts toward future stock-checks.'
  )
  RETURNING id INTO v_new_stock_item_id;

  UPDATE order_items SET stock_item_id = v_new_stock_item_id WHERE id = v_order_item.id;

  RETURN NEW;
END;
$$;

-- ── Backfill: the 5 already-received line items stuck with no
-- stock_item_id and no stock_receipts row. Generic (not hardcoded to
-- specific rows) so it also catches anything this audit missed and
-- stays correct if run again.
DO $$
DECLARE
  r RECORD;
  v_new_stock_item_id UUID;
BEGIN
  FOR r IN
    SELECT
      grni.id AS grni_id, grni.quantity_received, grni.grn_id,
      oi.id AS order_item_id, oi.item_name, oi.unit, oi.sub_category_id, oi.quantity AS order_qty,
      sbi.unit_price_actual,
      o.project_id,
      grn.received_at
    FROM goods_received_note_items grni
    JOIN sourcing_bundle_items sbi ON sbi.id = grni.sourcing_bundle_item_id
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN goods_received_notes grn ON grn.id = grni.grn_id
    LEFT JOIN orders o ON o.id = oi.order_id
    WHERE oi.stock_item_id IS NULL
  LOOP
    INSERT INTO stock_items (item_name, unit, sub_category_id, catalog_status, active, notes)
    VALUES (
      r.item_name, r.unit, r.sub_category_id, 'pending_setup', TRUE,
      'Auto-created on receipt from PR line ' || r.order_item_id || ' — needs a proper category (for item_code), warehouse_zone, and reorder_level set before it counts toward future stock-checks.'
    )
    RETURNING id INTO v_new_stock_item_id;

    UPDATE order_items SET stock_item_id = v_new_stock_item_id WHERE id = r.order_item_id;

    INSERT INTO stock_receipts (
      stock_item_id, quantity, unit_price, receipt_type, destination,
      order_item_id, grn_item_id, received_date, notes, project_id
    ) VALUES (
      v_new_stock_item_id,
      COALESCE(r.quantity_received, r.order_qty),
      r.unit_price_actual,
      'purchase',
      CASE WHEN r.project_id IS NOT NULL THEN 'site' ELSE 'warehouse' END,
      r.order_item_id,
      r.grni_id,
      COALESCE(r.received_at::date, CURRENT_DATE),
      'Backfilled — item was received but had no stock catalog link (see 224 migration)',
      r.project_id
    );
  END LOOP;
END $$;
