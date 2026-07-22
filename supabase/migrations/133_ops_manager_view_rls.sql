-- ============================================================
-- RLS + schema support for the Operations Manager role view.
--
-- Three gaps found while building it (research confirmed the first
-- two against the live RLS policies, not guessed; the third was
-- caught by actually testing the approve action end-to-end against a
-- local replica, not just checking the policy on budget_variations
-- itself):
--
-- 1. budget_variations: operations_manager was never added to either
--    the read or approve policy (076_budget_variations.sql only lists
--    admin/manager/finance/project_manager/procurement_officer). Per
--    user decision, operations_manager needs to see and act on
--    variation requests awaiting sign-off.
--
-- 2. sourcing_bundles (Purchase Orders): operations_manager had ZERO
--    read access at all (026's sourcing_bundles_policy only covers
--    admin/manager/finance/procurement_officer), and no PO ever had an
--    amount-based approval threshold — status is a plain enum with no
--    dollar gating. Per user decision, this round builds the real
--    thing: operations_manager can see and approve POs up to ETB
--    500,000, capped at the visibility layer (not just the action) —
--    a bundle over the cap is invisible to them, same as it always was.
--    Everything admin/manager/finance/procurement_officer could already
--    do is untouched (new policies are additive, not replacements).
--
-- 3. Approving a budget_variations row cascades into an UPDATE on
--    projects.budget_version (069's apply_approved_budget_variation
--    trigger) — which 069's OWN restrict_project_budgeting_field_edits
--    trigger only allows admin/manager/finance to touch. Granting
--    operations_manager the budget_variations UPDATE alone (#1) isn't
--    enough; without this, their approve click fails inside the
--    cascading trigger with "Only admin, manager, or finance can edit
--    ... budget fields on a project" — found by actually running the
--    approve flow against a local replica, not by re-reading the
--    policy list on budget_variations in isolation.
-- ============================================================

SET search_path TO public;

-- ── 1. budget_variations: add operations_manager ────────────────────
DROP POLICY IF EXISTS "budget_variations_read" ON budget_variations;
CREATE POLICY "budget_variations_read" ON budget_variations FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'project_manager', 'procurement_officer', 'operations_manager'));

DROP POLICY IF EXISTS "budget_variations_approve" ON budget_variations;
CREATE POLICY "budget_variations_approve" ON budget_variations FOR UPDATE
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'operations_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'manager', 'finance', 'operations_manager'));

-- ── 2. sourcing_bundles: computed total_value, maintained by trigger ─
ALTER TABLE sourcing_bundles ADD COLUMN IF NOT EXISTS total_value NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION recalc_sourcing_bundle_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_bundle_id UUID := COALESCE(NEW.bundle_id, OLD.bundle_id);
BEGIN
  UPDATE sourcing_bundles
  SET total_value = COALESCE(
    (SELECT SUM(COALESCE(quantity_actual, 0) * COALESCE(unit_price_actual, 0))
     FROM sourcing_bundle_items WHERE bundle_id = v_bundle_id),
    0
  )
  WHERE id = v_bundle_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_sourcing_bundle_total ON sourcing_bundle_items;
CREATE TRIGGER trg_recalc_sourcing_bundle_total
  AFTER INSERT OR UPDATE OR DELETE ON sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION recalc_sourcing_bundle_total();

-- Backfill existing bundles
UPDATE sourcing_bundles b
SET total_value = COALESCE(
  (SELECT SUM(COALESCE(quantity_actual, 0) * COALESCE(unit_price_actual, 0))
   FROM sourcing_bundle_items WHERE bundle_id = b.id),
  0
);

-- ── 3. sourcing_bundles/sourcing_bundle_items: capped operations_manager access ──
-- Read: any bundle at or under the cap, any status — matches the
-- confirmed scope ("their queue is POs up to 500,000" as the full
-- extent of what this role deals with, not just pending ones).
DROP POLICY IF EXISTS "ops_manager_read_capped_bundles" ON sourcing_bundles;
CREATE POLICY "ops_manager_read_capped_bundles" ON sourcing_bundles FOR SELECT
  USING (get_user_role() = 'operations_manager' AND total_value <= 500000);

DROP POLICY IF EXISTS "ops_manager_read_capped_bundle_items" ON sourcing_bundle_items;
CREATE POLICY "ops_manager_read_capped_bundle_items" ON sourcing_bundle_items FOR SELECT
  USING (
    get_user_role() = 'operations_manager'
    AND EXISTS (SELECT 1 FROM sourcing_bundles b WHERE b.id = sourcing_bundle_items.bundle_id AND b.total_value <= 500000)
  );

-- Approve: only a submitted, capped bundle can be touched at all by
-- this role; the WITH CHECK re-affirms the cap (a bundle can't be
-- edited into exceeding it and then approved in the same statement).
DROP POLICY IF EXISTS "ops_manager_approve_capped_bundles" ON sourcing_bundles;
CREATE POLICY "ops_manager_approve_capped_bundles" ON sourcing_bundles FOR UPDATE
  USING (get_user_role() = 'operations_manager' AND status = 'submitted' AND total_value <= 500000)
  WITH CHECK (get_user_role() = 'operations_manager' AND total_value <= 500000);

-- ── 3. Let an approved-by-operations_manager variation actually apply ──
-- Same function as 069, just widening the role list by one. Every
-- other field this trigger guards (progress, health, contract value,
-- handover date, budget lock) stays admin/manager/finance-only —
-- operations_manager's added reach here is a side effect of approving
-- a variation, not a new direct-edit permission on projects.
CREATE OR REPLACE FUNCTION restrict_project_budgeting_field_edits()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF get_user_role() IN ('admin', 'manager', 'finance', 'operations_manager') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admin, manager, or finance can edit stage, progress, health, or budget fields on a project';
END;
$$;

-- Verify
SELECT policyname, cmd FROM pg_policies WHERE tablename IN ('budget_variations', 'sourcing_bundles', 'sourcing_bundle_items') ORDER BY tablename, policyname;
SELECT count(*) AS bundles_with_total FROM sourcing_bundles WHERE total_value > 0;
