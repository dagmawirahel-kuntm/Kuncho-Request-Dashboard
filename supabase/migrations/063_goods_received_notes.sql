-- Migration 063: Goods Received Notes (GRN)
--
-- Closes a real control gap: "Mark as Fulfilled" on a Purchase Order used
-- to be a single self-service click by the same procurement officer who
-- placed the order — no quantity check, no independent sign-off, no
-- document. A GRN is now the ONLY way a sourcing_bundle becomes
-- 'fulfilled', and it can only be created by stock_manager/logistics_officer
-- (or admin) — a different role than the one that ordered it.
--
-- GRN is also where the received items get tied to their real General
-- Ledger category (the "Balance Sheet line item" the business asked for),
-- separately from whatever category the original PR line item guessed at.

SET search_path TO public;

-- ── categories: a real Asset sub-classification, so the Balance Sheet can
-- group by either raw category name OR a proper Inventory/Fixed Assets/
-- Current Assets bucket. Only meaningful when nature = 'Asset'.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS asset_class TEXT;
ALTER TABLE categories ADD CONSTRAINT categories_asset_class_check
  CHECK (asset_class IS NULL OR asset_class IN ('Inventory', 'Fixed Assets', 'Current Assets', 'Other')) NOT VALID;

-- ── transportation_requests: a PO can request its own transport job,
-- separate from the transport_id back-link an expense already carries
ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS sourcing_bundle_id UUID REFERENCES sourcing_bundles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transport_sourcing_bundle ON transportation_requests(sourcing_bundle_id);

-- ── GRN tables ──────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS grn_seq START 1;

CREATE TABLE IF NOT EXISTS goods_received_notes (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_code                   TEXT UNIQUE,
  sourcing_bundle_id         UUID NOT NULL REFERENCES sourcing_bundles(id) ON DELETE CASCADE,
  transportation_request_id  UUID REFERENCES transportation_requests(id) ON DELETE SET NULL,
  received_by                UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  received_at                TIMESTAMPTZ DEFAULT NOW(),
  category_id                UUID REFERENCES categories(id) ON DELETE SET NULL,
  notes                      TEXT,
  photo_url                  TEXT,
  photo_name                 TEXT,
  created_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goods_received_note_items (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id                    UUID NOT NULL REFERENCES goods_received_notes(id) ON DELETE CASCADE,
  sourcing_bundle_item_id   UUID NOT NULL REFERENCES sourcing_bundle_items(id) ON DELETE CASCADE,
  quantity_received         NUMERIC(10,3),
  condition_notes           TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate grn_code, matching the PO-YYYY-0001 convention
CREATE OR REPLACE FUNCTION set_grn_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.grn_code IS NULL THEN
    NEW.grn_code := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('grn_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_grn_code ON goods_received_notes;
CREATE TRIGGER trg_set_grn_code
  BEFORE INSERT ON goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION set_grn_code();

-- A GRN existing IS the fulfillment confirmation — SECURITY DEFINER so the
-- stock_manager/logistics_officer who creates it doesn't need (and isn't
-- granted) any direct UPDATE access to sourcing_bundles itself. This is
-- the actual segregation-of-duties control: the only way `status` becomes
-- 'fulfilled' is by recording a real GRN, never a self-service click by
-- whoever placed the order.
CREATE OR REPLACE FUNCTION mark_bundle_fulfilled_on_grn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE sourcing_bundles
  SET status = 'fulfilled', fulfilled_at = NOW()
  WHERE id = NEW.sourcing_bundle_id AND status <> 'fulfilled';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grn_fulfills_bundle ON goods_received_notes;
CREATE TRIGGER trg_grn_fulfills_bundle
  AFTER INSERT ON goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION mark_bundle_fulfilled_on_grn();

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE goods_received_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_received_note_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "grn_read" ON goods_received_notes;
CREATE POLICY "grn_read" ON goods_received_notes FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer'));

DROP POLICY IF EXISTS "grn_insert" ON goods_received_notes;
CREATE POLICY "grn_insert" ON goods_received_notes FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'stock_manager', 'logistics_officer'));

DROP POLICY IF EXISTS "grn_items_read" ON goods_received_note_items;
CREATE POLICY "grn_items_read" ON goods_received_note_items FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer'));

DROP POLICY IF EXISTS "grn_items_insert" ON goods_received_note_items;
CREATE POLICY "grn_items_insert" ON goods_received_note_items FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'stock_manager', 'logistics_officer'));

-- stock_manager/logistics_officer need read access to what they're
-- receiving — sourcing_bundles/sourcing_bundle_items/order_items didn't
-- grant them anything before this
DROP POLICY IF EXISTS "grn_roles_read_bundles" ON sourcing_bundles;
CREATE POLICY "grn_roles_read_bundles" ON sourcing_bundles FOR SELECT
  USING (get_user_role() IN ('stock_manager', 'logistics_officer'));

DROP POLICY IF EXISTS "grn_roles_read_bundle_items" ON sourcing_bundle_items;
CREATE POLICY "grn_roles_read_bundle_items" ON sourcing_bundle_items FOR SELECT
  USING (get_user_role() IN ('stock_manager', 'logistics_officer'));

DROP POLICY IF EXISTS "grn_roles_read_order_items" ON order_items;
CREATE POLICY "grn_roles_read_order_items" ON order_items FOR SELECT
  USING (get_user_role() IN ('stock_manager', 'logistics_officer'));
