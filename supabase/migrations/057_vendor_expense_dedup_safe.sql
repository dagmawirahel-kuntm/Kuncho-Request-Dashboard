-- Migration 057: FK-safe replacement for 036's vendor/expense_code dedup
--
-- Diagnosis: 036_vendor_name_unique_expense_code_unique.sql deletes
-- duplicate vendor/expense rows BEFORE adding the unique constraints,
-- but several columns reference vendors(id)/expenses(id) with no
-- ON DELETE CASCADE/SET NULL (expenses.vendor_id, cpo_bonds.vendor_id,
-- orders.recommended_vendor_id, transportation_requests.vendor_id;
-- orders.parent_purchase_id, transportation_requests.expense_id,
-- cpo_bonds.related_expense_id). If a duplicate being deleted was
-- referenced by any of those, DELETE fails with a foreign-key
-- violation, and — since the whole pasted script runs as one implicit
-- transaction — everything in 036 rolls back, including the two
-- constraints. That's why 036 showed up as "not applied."
--
-- This migration re-points every such reference to the row being KEPT
-- before deleting the duplicate, so nothing is silently orphaned or
-- blocks the delete, then adds the same two constraints 036 wanted.
-- Safe to run whether or not 036 partially succeeded.

SET search_path TO public;

-- ── STEP 1: diagnostic (read-only) — see what will be merged ────────
-- Run this first if you want to eyeball it before the merge below.
SELECT lower(trim(vendor_name)) AS normalized_name, count(*) AS copies,
       array_agg(id) AS vendor_ids, array_agg(vendor_name) AS names
FROM vendors
GROUP BY lower(trim(vendor_name))
HAVING count(*) > 1;

-- ── STEP 2: vendor dedup, FK-safe ─────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  keeper UUID;
  dupe UUID;
BEGIN
  FOR r IN
    SELECT lower(trim(vendor_name)) AS norm, array_agg(id ORDER BY created_at) AS ids
    FROM vendors
    WHERE vendor_name IS NOT NULL
    GROUP BY lower(trim(vendor_name))
    HAVING count(*) > 1
  LOOP
    keeper := r.ids[1];
    FOR i IN 2 .. array_length(r.ids, 1) LOOP
      dupe := r.ids[i];
      UPDATE expenses                  SET vendor_id = keeper WHERE vendor_id = dupe;
      UPDATE cpo_bonds                 SET vendor_id = keeper WHERE vendor_id = dupe;
      UPDATE orders                    SET recommended_vendor_id = keeper WHERE recommended_vendor_id = dupe;
      UPDATE transportation_requests   SET vendor_id = keeper WHERE vendor_id = dupe;
      -- these already cascade/set-null safely, but re-point instead of
      -- losing the link entirely
      UPDATE sourcing_bundles          SET vendor_id = keeper WHERE vendor_id = dupe;
      UPDATE vendor_attachments        SET vendor_id = keeper WHERE vendor_id = dupe;
      DELETE FROM vendors WHERE id = dupe;
    END LOOP;
  END LOOP;
END $$;

UPDATE vendors SET vendor_name = trim(vendor_name) WHERE vendor_name != trim(vendor_name);

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_vendor_name_unique;
ALTER TABLE vendors ADD CONSTRAINT vendors_vendor_name_unique UNIQUE (vendor_name);

-- ── STEP 3: expense_code dedup, FK-safe (likely a no-op — 042 already
-- deduped the double-import by a different key; this catches leftovers) ──
DO $$
DECLARE
  r RECORD;
  keeper UUID;
  dupe UUID;
BEGIN
  FOR r IN
    SELECT lower(trim(expense_code)) AS norm, array_agg(id ORDER BY created_at) AS ids
    FROM expenses
    WHERE expense_code IS NOT NULL
    GROUP BY lower(trim(expense_code))
    HAVING count(*) > 1
  LOOP
    keeper := r.ids[1];
    FOR i IN 2 .. array_length(r.ids, 1) LOOP
      dupe := r.ids[i];
      UPDATE orders                  SET parent_purchase_id = keeper WHERE parent_purchase_id = dupe;
      UPDATE transportation_requests SET expense_id = keeper WHERE expense_id = dupe;
      UPDATE cpo_bonds               SET related_expense_id = keeper WHERE related_expense_id = dupe;
      -- cascading/set-null junction tables — re-point rather than lose
      UPDATE order_expenses          SET expense_id = keeper WHERE expense_id = dupe;
      UPDATE batch_payment_expenses  SET expense_id = keeper WHERE expense_id = dupe;
      UPDATE cash_advance_expenses   SET expense_id = keeper WHERE expense_id = dupe;
      UPDATE expense_order_items     SET expense_id = keeper WHERE expense_id = dupe;
      UPDATE stock_receipts          SET expense_id = keeper WHERE expense_id = dupe;
      UPDATE stock_issues            SET expense_id = keeper WHERE expense_id = dupe;
      UPDATE sourcing_bundles        SET expense_id = keeper WHERE expense_id = dupe;
      DELETE FROM expenses WHERE id = dupe;
    END LOOP;
  END LOOP;
END $$;

UPDATE expenses SET expense_code = trim(expense_code)
  WHERE expense_code IS NOT NULL AND expense_code != trim(expense_code);

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_expense_code_unique;
ALTER TABLE expenses ADD CONSTRAINT expenses_expense_code_unique UNIQUE (expense_code);

-- ── STEP 4: verify (read-only) ────────────────────────────────────────
SELECT
  (SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='vendors' AND constraint_name='vendors_vendor_name_unique')) AS vendor_constraint_added,
  (SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='expenses' AND constraint_name='expenses_expense_code_unique')) AS expense_code_constraint_added;
