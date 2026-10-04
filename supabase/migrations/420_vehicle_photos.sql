-- Vehicle photos. Migration 061 added vehicles.image_url but was never applied
-- to the live database, so uploading a photo on the Fleet page failed and every
-- card showed the placeholder. Only the column is added here: photos are
-- uploaded from the Fleet page, not seeded.

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS image_url TEXT;
