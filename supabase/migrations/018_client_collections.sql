-- Add amount (for contract value) and sale_id (to link WHT receipts to specific sales)
ALTER TABLE client_attachments
  ADD COLUMN IF NOT EXISTS amount NUMERIC,
  ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;

-- Add wht_receipt category
DO $$ BEGIN
  ALTER TYPE attachment_category ADD VALUE 'wht_receipt';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
