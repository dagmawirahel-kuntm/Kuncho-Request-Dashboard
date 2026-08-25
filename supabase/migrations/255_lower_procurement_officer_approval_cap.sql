-- Procurement Officer PO approval cap dialed down from ETB 50,000 to
-- ETB 30,000, per request. Operations Manager's 500,000 cap (133) is
-- unrelated and untouched.

SET search_path TO public;

DROP POLICY IF EXISTS sourcing_bundles_update_procurement_capped ON sourcing_bundles;
CREATE POLICY sourcing_bundles_update_procurement_capped ON sourcing_bundles
  FOR UPDATE
  USING (get_user_role() = 'procurement_officer')
  WITH CHECK (
    get_user_role() = 'procurement_officer'
    AND (status <> 'approved' OR COALESCE(total_value, 0) <= 30000)
  );

COMMENT ON POLICY sourcing_bundles_update_procurement_capped ON sourcing_bundles IS
  'Procurement Officer approval cap: may build and edit bundles of any size, but cannot set status=approved above ETB 30,000.';
