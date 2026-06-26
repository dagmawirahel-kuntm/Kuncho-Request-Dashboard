-- Add 'Refunded' to the sale_lifecycle_status enum
ALTER TYPE sale_lifecycle_status ADD VALUE IF NOT EXISTS 'Refunded';
