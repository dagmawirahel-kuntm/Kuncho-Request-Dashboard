-- 497: each bank account's look on the reconciliation screens.
-- A bank's own colours and logo, so its statement and queue look like its
-- website. Left empty, the app uses what it knows of that bank's brand (or a
-- neutral look); finance or admin set them to match exactly.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_color text
  CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_accent text
  CHECK (brand_accent IS NULL OR brand_accent ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_logo_url text
  CHECK (brand_logo_url IS NULL OR brand_logo_url ~ '^https://');

COMMENT ON COLUMN accounts.brand_color IS 'The bank''s main colour (#rrggbb) on the reconciliation screens; empty = the app''s default for that bank.';
COMMENT ON COLUMN accounts.brand_accent IS 'The bank''s second colour (#rrggbb).';
COMMENT ON COLUMN accounts.brand_logo_url IS 'The bank''s logo, uploaded by finance (public documents bucket, bank-logos/).';
