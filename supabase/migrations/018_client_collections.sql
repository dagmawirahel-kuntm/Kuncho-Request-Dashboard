-- Add amount (for contract value) and sale_id (to link WHT receipts to specific sales)
ALTER TABLE client_attachments
  ADD COLUMN IF NOT EXISTS amount NUMERIC,
  ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;

-- Expand the category CHECK constraint to include wht_receipt
ALTER TABLE client_attachments
  DROP CONSTRAINT IF EXISTS client_attachments_category_check;

ALTER TABLE client_attachments
  ADD CONSTRAINT client_attachments_category_check
  CHECK (category IN ('receipt', 'contract', 'wht_receipt', 'other'));
