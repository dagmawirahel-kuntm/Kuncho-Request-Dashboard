-- 366 — A stock item's location is the real warehouse or workshop
--
-- The item form offers the leased properties (the rent table) as
-- locations, and says warehouse_zone is free text — but the column still
-- carried the old CHECK for 'Zone A' / 'Zone B' / 'Zone C', so saving an
-- item with a real location failed. Only 'Zone A' was ever stored. The
-- CHECK goes, on items and receipts alike.

ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_warehouse_zone_check;
ALTER TABLE stock_receipts DROP CONSTRAINT IF EXISTS stock_receipts_warehouse_zone_check;
