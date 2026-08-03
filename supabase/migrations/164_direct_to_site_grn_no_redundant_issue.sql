-- ============================================================
-- Part B: direct-to-site GRN material needs no stock_issues row.
--
-- Confirmed against the shipped schema and live data before writing.
--
-- receipt_catalogued_stock_item() (109, rewritten in 159) already
-- decides destination='site' vs 'warehouse' purely from whether the
-- underlying PR line was tied to a project (order_items -> orders.
-- project_id). It inserts a stock_receipts row either way and never
-- creates a stock_issues row for either path — so there is no
-- redundant "release" step to remove; that part of the ask already
-- holds.
--
-- The Materials cost/budget view was the other thing to check, and
-- checking it live changed the plan. First pass here added a CTE to
-- v_project_cost_group_budget sourcing Actual cost from
-- destination='site' stock_receipts directly — on the assumption that
-- Materials Actual depends only on stock_issues (096's header
-- describes exactly that). Applying it to production immediately
-- doubled a real project's Materials Actual (86,956.80 where it
-- should read 43,478.40), which is what exposed the wrong assumption:
-- auto_create_purchase_order_expense() (136) already fires on EVERY
-- goods_received_notes INSERT, site or warehouse, and creates an
-- expenses row with project_id set whenever the bundle is
-- single-project. Once that expense is approved and paid, it already
-- flows into Materials Actual through the ordinary expense_amounts
-- CTE — bundle_amounts stops counting it the same moment
-- (sb.expense_id IS NOT NULL), exactly as 070's header describes for
-- every other purchase. So a direct-to-site GRN's cost was never
-- actually gated on stock_issues; it runs through the same
-- expense-on-payment path as everything else, and never needed a fix.
-- That CTE is not included below — reverted on the same database
-- connection, in the same session, before anything downstream could
-- read the wrong figure. Verified back to 43,478.40 afterwards.
--
-- What DOES still depend on stock_issues, and has no other path
-- covering it, is v_project_material_balance (159) — the view behind
-- ProjectWorkspacePage's "Return to Stock" picker and
-- validate_stock_return_request()'s guard. Nothing in the
-- expense/budget pipeline tracks physical quantity at a project; that
-- is this view's only job, and it sourced solely from stock_issues.
-- Left alone, a direct-to-site delivery could never be returned or
-- transferred site-to-site — it would sit at the project with no
-- record it ever arrived. That part of the original diagnosis holds
-- and is fixed below.
--
-- Fix, scoped to what actually needed it: populate
-- stock_receipts.project_id at receipt time (032 added the column
-- specifically "to support direct project procurement... enables
-- project cost tracking" and it was never written), backfill the one
-- live row, and extend v_project_material_balance to also draw on
-- destination='site' stock_receipts. v_project_cost_group_budget is
-- untouched by this migration. The warehouse path
-- (destination='warehouse', where project_id is NULL by construction)
-- is untouched throughout — those rows fail every new predicate below.
-- ============================================================

SET search_path TO public;

-- ── 1. Populate stock_receipts.project_id going forward ─────────────
CREATE OR REPLACE FUNCTION receipt_catalogued_stock_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_order_item   RECORD;
  v_unit_price   NUMERIC;
  v_destination  TEXT;
  v_grn_date     DATE;
BEGIN
  IF NEW.quality_status = 'rejected' THEN
    RETURN NEW;
  END IF;

  SELECT oi.*, o.project_id AS req_project_id
  INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  LEFT JOIN orders o ON o.id = oi.order_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  IF NOT FOUND OR v_order_item.stock_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sbi.unit_price_actual INTO v_unit_price
  FROM sourcing_bundle_items sbi WHERE sbi.id = NEW.sourcing_bundle_item_id;

  SELECT received_at::date INTO v_grn_date FROM goods_received_notes WHERE id = NEW.grn_id;

  v_destination := CASE WHEN v_order_item.req_project_id IS NOT NULL THEN 'site' ELSE 'warehouse' END;

  INSERT INTO stock_receipts (
    stock_item_id, quantity, unit_price, receipt_type, destination,
    order_item_id, grn_item_id, received_date, notes, project_id
  ) VALUES (
    v_order_item.stock_item_id,
    COALESCE(NEW.quantity_received, v_order_item.quantity),
    v_unit_price,
    'purchase',
    v_destination,
    v_order_item.id,
    NEW.id,
    COALESCE(v_grn_date, CURRENT_DATE),
    'Received via GRN' || CASE WHEN NEW.quality_status = 'damaged' THEN ' (flagged damaged)' ELSE '' END,
    v_order_item.req_project_id
  );

  RETURN NEW;
END;
$fn$;

-- ── 2. Backfill the live direct-to-site rows this trigger already
--    created without a project_id. Scoped to destination='site' only
--    — the warehouse path is not touched, even as a no-op.
UPDATE stock_receipts sr
SET project_id = o.project_id
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE sr.order_item_id = oi.id
  AND sr.destination = 'site'
  AND sr.project_id IS NULL
  AND o.project_id IS NOT NULL;

-- ── 3. Material balance: a direct-to-site delivery counts as placed
--    at the project exactly like an issue does, so it can be returned
--    or transferred through the existing flow. Restructured from a
--    single-source CTE to a FULL OUTER JOIN of two sources so a
--    (project, item) pair that has ONLY a site delivery — no
--    stock_issues row at all — still produces a row.
CREATE OR REPLACE VIEW v_project_material_balance
WITH (security_invoker = true) AS
WITH issued AS (
  SELECT si.project_id, si.stock_item_id, SUM(si.quantity) AS qty_issued
  FROM stock_issues si
  WHERE si.issue_type = 'project_use' AND si.project_id IS NOT NULL
  GROUP BY si.project_id, si.stock_item_id
),
site_delivered AS (
  SELECT sr.project_id, sr.stock_item_id, SUM(sr.quantity) AS qty_delivered
  FROM stock_receipts sr
  WHERE sr.destination = 'site' AND sr.project_id IS NOT NULL
  GROUP BY sr.project_id, sr.stock_item_id
),
placed AS (
  SELECT
    COALESCE(i.project_id, sd.project_id) AS project_id,
    COALESCE(i.stock_item_id, sd.stock_item_id) AS stock_item_id,
    COALESCE(i.qty_issued, 0) AS qty_issued,
    COALESCE(sd.qty_delivered, 0) AS qty_site_delivered,
    COALESCE(i.qty_issued, 0) + COALESCE(sd.qty_delivered, 0) AS qty_placed
  FROM issued i
  FULL OUTER JOIN site_delivered sd
    ON sd.project_id = i.project_id AND sd.stock_item_id = i.stock_item_id
),
moved AS (
  SELECT r.project_id, r.stock_item_id,
         SUM(COALESCE(r.quantity_received, r.quantity_requested)) FILTER (WHERE r.status = 'received') AS qty_returned,
         SUM(r.quantity_requested) FILTER (WHERE r.status = 'pending')  AS qty_pending
  FROM stock_return_requests r
  WHERE r.project_id IS NOT NULL
  GROUP BY r.project_id, r.stock_item_id
)
-- Column order matches the pre-164 view exactly through
-- qty_available_to_return — CREATE OR REPLACE VIEW cannot reorder or
-- rename existing output columns, only append. qty_site_delivered and
-- qty_placed are new, so they go last.
SELECT
  pl.project_id,
  p.project_name,
  pl.stock_item_id,
  st.item_name,
  st.unit,
  pl.qty_issued,
  COALESCE(m.qty_returned, 0) AS qty_returned,
  COALESCE(m.qty_pending, 0)  AS qty_pending,
  pl.qty_placed - COALESCE(m.qty_returned, 0) - COALESCE(m.qty_pending, 0) AS qty_available_to_return,
  pl.qty_site_delivered,
  pl.qty_placed
FROM placed pl
JOIN stock_items st ON st.id = pl.stock_item_id
LEFT JOIN projects p ON p.id = pl.project_id
LEFT JOIN moved m ON m.project_id = pl.project_id AND m.stock_item_id = pl.stock_item_id;

GRANT SELECT ON v_project_material_balance TO authenticated;

COMMENT ON VIEW v_project_material_balance IS
  'What a project actually has on hand: material formally issued (stock_issues) PLUS material delivered straight to the project via GRN (stock_receipts.destination=site), less whatever has already been returned or is pending return. qty_available_to_return is the column every consumer should read; qty_issued/qty_site_delivered are exposed for transparency only.';
