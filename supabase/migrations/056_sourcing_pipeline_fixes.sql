-- Migration 056: Fix purchase-request → sourcing-bundle pipeline
--
-- Audit found: (1) order_items RLS was wide open to any authenticated
-- user since migration 021, never revisited by 049's role alignment;
-- (2) sourcing_bundles had no guard against a non-drafting bundle being
-- edited or deleted outside its intended lifecycle.
--
-- This migration only touches RLS/guards. The application-level bugs
-- (wrong column names breaking PurchaseOrderPage, order_items.status
-- never synced when bundling, cancelled bundles orphaning their items,
-- procurement_officer_id overwritten on edit) are fixed in the same
-- commit's TypeScript changes.

SET search_path TO public;

-- ── order_items: replace the wide-open policy with real role/ownership
-- scoping, mirroring `orders` access exactly ──────────────────────────
DROP POLICY IF EXISTS "all authenticated manage order items" ON order_items;

CREATE POLICY "admin_all_order_items" ON order_items FOR ALL
  USING (get_user_role() = 'admin');

-- Staff manage line items only on their own purchase requests
CREATE POLICY "staff_own_order_items" ON order_items FOR ALL
  USING (
    get_user_role() = 'staff'
    AND order_id IN (SELECT id FROM orders WHERE requested_by_user_id = auth.uid())
  )
  WITH CHECK (
    get_user_role() = 'staff'
    AND order_id IN (SELECT id FROM orders WHERE requested_by_user_id = auth.uid())
  );

-- These four roles already have broad create/edit access to `orders`
-- itself (001 + 049) — give them the matching access to its line items
CREATE POLICY "ops_roles_order_items" ON order_items FOR ALL
  USING (get_user_role() IN ('manager', 'finance', 'hr_officer', 'project_manager'));

-- Procurement reads all line items (to build sourcing bundles) and can
-- update status (bundling flips pending -> sourced/partially_sourced,
-- cancelling a bundle flips it back) — but doesn't create/delete PR lines
CREATE POLICY "procurement_read_order_items" ON order_items FOR SELECT
  USING (get_user_role() = 'procurement_officer');

CREATE POLICY "procurement_update_order_item_status" ON order_items FOR UPDATE
  USING (get_user_role() = 'procurement_officer');

-- ── sourcing_bundles: block edits/deletes once a bundle has left
-- drafting — the UI only ever showed Edit/Delete for drafting bundles,
-- but nothing enforced it server-side ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_bundle_drafting_only()
RETURNS TRIGGER AS $$
DECLARE
  v_status sourcing_bundle_status;
BEGIN
  v_status := COALESCE(OLD.status, 'drafting');
  IF TG_OP = 'DELETE' THEN
    IF v_status != 'drafting' THEN
      RAISE EXCEPTION 'Cannot delete a sourcing bundle once it has left drafting (current: %)', v_status;
    END IF;
    RETURN OLD;
  END IF;
  -- Status transitions (submit/approve/reject/order/fulfill/cancel) and
  -- expense reconciliation (expense_id, finance_notes) are always
  -- allowed. Only the bundle's drafting-time content — vendor, delivery
  -- date, notes, procurement officer — is frozen once it has left
  -- drafting, so a PO can't quietly change after finance approved it.
  IF v_status != 'drafting' AND NEW.status = OLD.status
     AND (NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.vendor_name IS DISTINCT FROM OLD.vendor_name
       OR NEW.expected_delivery_date IS DISTINCT FROM OLD.expected_delivery_date
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.procurement_officer_id IS DISTINCT FROM OLD.procurement_officer_id) THEN
    RAISE EXCEPTION 'Cannot edit a sourcing bundle once it has left drafting (current: %)', v_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_bundle_drafting_only ON sourcing_bundles;
CREATE TRIGGER trg_enforce_bundle_drafting_only
  BEFORE UPDATE OR DELETE ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bundle_drafting_only();

-- A non-drafting bundle's line items are likewise frozen (adding/
-- removing/reweighting items only makes sense while still drafting) —
-- EXCEPT removal is also allowed once the bundle is cancelled, so
-- cancelling can release its items back for re-sourcing (bug 2c).
CREATE OR REPLACE FUNCTION public.enforce_bundle_items_drafting_only()
RETURNS TRIGGER AS $$
DECLARE
  v_bundle_id UUID;
  v_status sourcing_bundle_status;
BEGIN
  v_bundle_id := COALESCE(NEW.bundle_id, OLD.bundle_id);
  SELECT status INTO v_status FROM sourcing_bundles WHERE id = v_bundle_id;
  IF TG_OP = 'DELETE' THEN
    IF v_status IS NOT NULL AND v_status NOT IN ('drafting', 'cancelled') THEN
      RAISE EXCEPTION 'Cannot remove line items from a sourcing bundle once it has left drafting (current: %)', v_status;
    END IF;
    RETURN OLD;
  END IF;
  IF v_status IS NOT NULL AND v_status != 'drafting' THEN
    RAISE EXCEPTION 'Cannot modify line items of a sourcing bundle once it has left drafting (current: %)', v_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_bundle_items_drafting_only ON sourcing_bundle_items;
CREATE TRIGGER trg_enforce_bundle_items_drafting_only
  BEFORE INSERT OR UPDATE OR DELETE ON sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bundle_items_drafting_only();
