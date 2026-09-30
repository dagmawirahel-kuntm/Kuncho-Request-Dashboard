-- 377 — A fixed-price task needs no unit rate
--
-- labor_req_volume_needs_rate_chk only let a day-rate request skip the
-- unit rate and volume unit, so a fixed-price task (375) was refused.

SET search_path TO public;

ALTER TABLE labor_requisitions DROP CONSTRAINT IF EXISTS labor_req_volume_needs_rate_chk;
ALTER TABLE labor_requisitions ADD CONSTRAINT labor_req_volume_needs_rate_chk
  CHECK (payment_basis <> 'per_volume' OR (unit_rate IS NOT NULL AND unit_rate > 0 AND volume_unit IS NOT NULL));
