-- Diagnose why a finance-approved PR's items aren't showing up as
-- available for sourcing bundling. Run each section and read the notes.

-- 1) Is migration 049 actually applied? (procurement needs this to see
--    orders at all — if false, that alone explains the empty panel for
--    a procurement_officer login, regardless of any specific PR.)
SELECT EXISTS (
  SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'raa_staff_own_orders'
) AS migration_049_applied;

-- 2) Which purchase requests are actually finance-approved right now?
SELECT id, request_code, order_name, approval_status
FROM orders
WHERE approval_status = 'finance_approved'
ORDER BY created_at DESC;

-- 3) For those requests, what do their line items look like — are any
--    excluded because they're cancelled?
SELECT o.request_code, oi.id AS order_item_id, oi.item_name, oi.status
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.approval_status = 'finance_approved'
ORDER BY o.request_code;

-- 4) Are any of those items already sitting in a sourcing_bundle_items
--    row — even from an old/cancelled/orphaned bundle? (The sourcing
--    page excludes an item if it's linked to ANY other bundle,
--    regardless of that bundle's status — pre-fix-057 test bundles can
--    leave items stuck like this.)
SELECT sbi.order_item_id, oi.item_name, sbi.bundle_id, sb.bundle_code, sb.status AS bundle_status
FROM sourcing_bundle_items sbi
JOIN order_items oi ON oi.id = sbi.order_item_id
JOIN orders o ON o.id = oi.order_id
JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id
WHERE o.approval_status = 'finance_approved';

-- If section 4 returns rows for an item you expect to see available,
-- and that bundle's status is 'cancelled' or otherwise stale/orphaned,
-- tell Claude the bundle_id and it'll give you the release statement
-- (delete that sourcing_bundle_items row + confirm the order_item's
-- status reverts to 'pending').
