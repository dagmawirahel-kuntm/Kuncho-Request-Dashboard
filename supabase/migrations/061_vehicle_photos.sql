-- Migration 061: vehicle photos
--
-- Adds an optional image_url to vehicles so Fleet & Logistics cards can show
-- a real vehicle photo instead of a generic icon. Seeds the 3 real fleet
-- vehicles (from migration 059) with freely-licensed, stable Wikimedia
-- Commons photos matching each by type/name — these are placeholders admins
-- can override any time via the Fleet & Logistics page.

SET search_path TO public;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS image_url TEXT;

UPDATE vehicles SET image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Iveco_Eurocargo.JPG/960px-Iveco_Eurocargo.JPG'
  WHERE name = 'IVECO' AND image_url IS NULL;

UPDATE vehicles SET image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/2010_Toyota_Hilux_%28GGN25R%29_SR_4-door_utility_%282011-11-30%29_01.jpg/960px-2010_Toyota_Hilux_%28GGN25R%29_SR_4-door_utility_%282011-11-30%29_01.jpg'
  WHERE name = 'Toyota (carry-on)' AND image_url IS NULL;

UPDATE vehicles SET image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/BMW_C_Evolution_2014-05-25.jpg/960px-BMW_C_Evolution_2014-05-25.jpg'
  WHERE name = 'Electric Motorbike' AND image_url IS NULL;
