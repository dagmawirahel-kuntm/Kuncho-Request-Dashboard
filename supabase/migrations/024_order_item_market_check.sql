-- Allow the PM to flag a line item for market price research
-- when the estimated price is unknown.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS needs_market_check BOOLEAN NOT NULL DEFAULT FALSE;
