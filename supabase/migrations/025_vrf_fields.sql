-- Vendor Receipt Facilitation: add fields to properly track
-- the outgoing transfer, facilitator identity, commission, and settlement status.
ALTER TABLE vendor_receipt_facilitation
  ADD COLUMN IF NOT EXISTS amount_transferred   NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS facilitator_name     TEXT,
  ADD COLUMN IF NOT EXISTS commission_rate      NUMERIC(5,2),  -- percentage e.g. 2.5
  ADD COLUMN IF NOT EXISTS commission_amount    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','partial','settled'));
