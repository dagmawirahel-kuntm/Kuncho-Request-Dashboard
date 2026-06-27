-- Replace the product_id foreign key (sales catalog, wrong reference) with
-- sub_category_id (sub-ledger accounts — the correct procurement reference).
ALTER TABLE orders
  DROP COLUMN IF EXISTS product_id,
  ADD COLUMN IF NOT EXISTS sub_category_id UUID REFERENCES sub_categories(id) ON DELETE SET NULL;
