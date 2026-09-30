-- 374 — Tighten the functions added in 371–372
--
-- Every write function already checks who is calling, but none of them has
-- any business being reachable without signing in, and trigger functions
-- have no business being called directly at all.

SET search_path TO public;

ALTER FUNCTION set_grn_item_return_status() SET search_path = public;
ALTER FUNCTION set_sdn_code() SET search_path = public;

REVOKE EXECUTE ON FUNCTION
  issue_site_delivery_note(uuid, uuid, jsonb, uuid, text, text, text, date, text),
  sign_site_delivery_note(uuid, jsonb, jsonb, text, double precision, double precision),
  confirm_site_delivery_note(uuid, jsonb, text),
  cancel_site_delivery_note(uuid, text),
  close_po_short(uuid, text),
  mark_grn_items_returned(uuid[], text),
  review_market_prices(uuid[], uuid, boolean, text),
  link_prices_to_stock_item(text, uuid, uuid),
  can_issue_site_delivery(),
  bundle_touches_my_projects(uuid),
  bundle_item_available_to_send(uuid, uuid)
FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION
  set_grn_item_return_status(), set_sdn_code(), trg_refresh_bundle_receipt(),
  set_item_variant_label(), check_bundle_item_variant()
FROM PUBLIC, anon, authenticated;

-- Signed-in users keep what the screens and the read policies call.
GRANT EXECUTE ON FUNCTION
  issue_site_delivery_note(uuid, uuid, jsonb, uuid, text, text, text, date, text),
  sign_site_delivery_note(uuid, jsonb, jsonb, text, double precision, double precision),
  confirm_site_delivery_note(uuid, jsonb, text),
  cancel_site_delivery_note(uuid, text),
  close_po_short(uuid, text),
  mark_grn_items_returned(uuid[], text),
  review_market_prices(uuid[], uuid, boolean, text),
  link_prices_to_stock_item(text, uuid, uuid),
  can_issue_site_delivery(),
  bundle_touches_my_projects(uuid),
  bundle_item_available_to_send(uuid, uuid)
TO authenticated;
