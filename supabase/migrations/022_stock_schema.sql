-- ── Stock Manager role ─────────────────────────────────────────────────────────
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'stock_manager';

-- ── Stock Items catalog ────────────────────────────────────────────────────────
-- Stockable physical items distinct from the GL sub-ledger accounts.
-- sub_category_id links to the accounting sub-ledger for cost posting.
CREATE TABLE IF NOT EXISTS stock_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name       TEXT NOT NULL,
  amharic_name    TEXT,
  sub_category_id UUID REFERENCES sub_categories(id) ON DELETE SET NULL,
  main_category   TEXT CHECK (main_category IN (
    'wood_work','electrical','painting','hardware','construction','tools','booth_return'
  )),
  item_type       TEXT NOT NULL DEFAULT 'consumable'
    CHECK (item_type IN ('raw_material','tool','consumable')),
  quality_grade   TEXT,
  unit            TEXT NOT NULL DEFAULT 'pcs',
  warehouse_zone  TEXT CHECK (warehouse_zone IN ('Zone A','Zone B','Zone C')),
  reorder_level   NUMERIC(10,2),
  is_tool         BOOLEAN NOT NULL DEFAULT FALSE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_items_sub_category ON stock_items(sub_category_id);

ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_items read all" ON stock_items;
CREATE POLICY "stock_items read all" ON stock_items FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "stock_items manage" ON stock_items;
CREATE POLICY "stock_items manage" ON stock_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid()
      AND role IN ('admin','manager','stock_manager','procurement_officer')
    )
  );

-- ── Stock Receipts (items arriving IN) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_receipts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id        UUID NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity             NUMERIC(10,2) NOT NULL,
  unit_price           NUMERIC(12,2),
  receipt_type         TEXT NOT NULL DEFAULT 'purchase'
    CHECK (receipt_type IN ('purchase','opening_balance','site_return','adjustment')),
  destination          TEXT NOT NULL DEFAULT 'warehouse'
    CHECK (destination IN ('warehouse','site')),
  warehouse_zone       TEXT CHECK (warehouse_zone IN ('Zone A','Zone B','Zone C')),
  expense_id           UUID REFERENCES expenses(id) ON DELETE SET NULL,
  order_item_id        UUID REFERENCES order_items(id) ON DELETE SET NULL,
  transport_request_id UUID REFERENCES transportation_requests(id) ON DELETE SET NULL,
  received_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  received_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_receipts_item    ON stock_receipts(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_expense ON stock_receipts(expense_id);

ALTER TABLE stock_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_receipts read" ON stock_receipts;
CREATE POLICY "stock_receipts read" ON stock_receipts FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "stock_receipts manage" ON stock_receipts;
CREATE POLICY "stock_receipts manage" ON stock_receipts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid()
      AND role IN ('admin','manager','stock_manager','procurement_officer','finance')
    )
  );

-- ── Stock Issues (items going OUT) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_issues (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id      UUID NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity           NUMERIC(10,2) NOT NULL,
  issue_type         TEXT NOT NULL DEFAULT 'project_use'
    CHECK (issue_type IN ('project_use','tool_checkout','damaged','vendor_return','adjustment')),
  project_id         UUID REFERENCES projects(id) ON DELETE SET NULL,
  issued_to_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  issued_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  order_item_id      UUID REFERENCES order_items(id) ON DELETE SET NULL,
  issued_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stock_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_issues read" ON stock_issues;
CREATE POLICY "stock_issues read" ON stock_issues FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "stock_issues manage" ON stock_issues;
CREATE POLICY "stock_issues manage" ON stock_issues FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid()
      AND role IN ('admin','manager','stock_manager','procurement_officer')
    )
  );

-- ── Tool Units (individual instances — serial / asset code tracked) ────────────
CREATE TABLE IF NOT EXISTS tool_units (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id     UUID NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
  asset_code        TEXT UNIQUE NOT NULL,   -- internal barcode / manual code
  serial_number     TEXT,                   -- manufacturer serial
  barcode           TEXT,
  condition         TEXT NOT NULL DEFAULT 'good'
    CHECK (condition IN ('good','fair','damaged','retired')),
  current_holder_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  checked_out_since DATE,
  purchase_date     DATE,
  expense_id        UUID REFERENCES expenses(id) ON DELETE SET NULL,
  notes             TEXT,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_units_stock_item ON tool_units(stock_item_id);

ALTER TABLE tool_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tool_units read" ON tool_units;
CREATE POLICY "tool_units read" ON tool_units FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "tool_units manage" ON tool_units;
CREATE POLICY "tool_units manage" ON tool_units FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid()
      AND role IN ('admin','manager','stock_manager')
    )
  );

-- ── Tool Checkouts (full history per individual unit) ─────────────────────────
CREATE TABLE IF NOT EXISTS tool_checkouts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_unit_id         UUID NOT NULL REFERENCES tool_units(id) ON DELETE CASCADE,
  issued_to_staff_id   UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  issued_by_staff_id   UUID REFERENCES staff(id) ON DELETE SET NULL,
  project_id           UUID REFERENCES projects(id) ON DELETE SET NULL,
  issue_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_return_date DATE,
  actual_return_date   DATE,
  condition_on_issue   TEXT DEFAULT 'good',
  condition_on_return  TEXT,
  returned             BOOLEAN NOT NULL DEFAULT FALSE,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_checkouts_unit  ON tool_checkouts(tool_unit_id);
CREATE INDEX IF NOT EXISTS idx_tool_checkouts_staff ON tool_checkouts(issued_to_staff_id);

ALTER TABLE tool_checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tool_checkouts read" ON tool_checkouts;
CREATE POLICY "tool_checkouts read" ON tool_checkouts FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "tool_checkouts manage" ON tool_checkouts;
CREATE POLICY "tool_checkouts manage" ON tool_checkouts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid()
      AND role IN ('admin','manager','stock_manager')
    )
  );

-- ── Back-link order_items → stock_items ───────────────────────────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id) ON DELETE SET NULL;
