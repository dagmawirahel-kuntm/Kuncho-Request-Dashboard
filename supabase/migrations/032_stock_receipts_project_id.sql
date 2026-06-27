-- Add project_id to stock_receipts to support direct project procurement:
-- when materials are purchased specifically for a named project (not general
-- warehouse restocking), linking at receipt time enables project cost tracking.
ALTER TABLE stock_receipts
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
