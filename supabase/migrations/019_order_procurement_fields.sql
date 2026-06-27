-- Add procurement-context fields to orders so project managers can link
-- to catalog items, specify units/estimates, set priority and required-by date.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit              TEXT,
  ADD COLUMN IF NOT EXISTS unit_price_estimate NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS required_by_date  DATE,
  ADD COLUMN IF NOT EXISTS priority          TEXT DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent', 'critical')),
  ADD COLUMN IF NOT EXISTS is_new_item       BOOLEAN DEFAULT FALSE;

-- Allow order_name to be set on insert (previously omitted pattern)
-- No schema change needed — column already exists as plain TEXT.
