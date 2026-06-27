-- ── Purchase Request enhancements ─────────────────────────────────────────────
-- Auto-generated request code (PR-YYYY-NNNN)
CREATE SEQUENCE IF NOT EXISTS order_request_seq START 1;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS request_code TEXT;

CREATE OR REPLACE FUNCTION generate_request_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_code IS NULL THEN
    NEW.request_code := 'PR-' || TO_CHAR(NOW(), 'YYYY') || '-'
      || LPAD(nextval('order_request_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_request_code ON orders;
CREATE TRIGGER trg_order_request_code
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION generate_request_code();

-- ── Order Items (line items per purchase request) ──────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sub_category_id   UUID REFERENCES sub_categories(id) ON DELETE SET NULL,
  item_name         TEXT NOT NULL,
  specifications    TEXT,
  quantity          NUMERIC(10,2),
  unit              TEXT,
  unit_price_est    NUMERIC(12,2),
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sourced','partially_sourced','unfulfilled','cancelled')),
  fulfillment_notes TEXT,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "all authenticated manage order items" ON order_items;
CREATE POLICY "all authenticated manage order items" ON order_items FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ── Expense ↔ Order Item junction (many-to-many) ───────────────────────────────
CREATE TABLE IF NOT EXISTS expense_order_items (
  expense_id        UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  order_item_id     UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity_covered  NUMERIC(10,2),
  notes             TEXT,
  PRIMARY KEY (expense_id, order_item_id)
);

ALTER TABLE expense_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance and procurement manage expense order items" ON expense_order_items;
CREATE POLICY "finance and procurement manage expense order items" ON expense_order_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid()
      AND role IN ('admin','manager','finance','procurement_officer')
    )
  );
