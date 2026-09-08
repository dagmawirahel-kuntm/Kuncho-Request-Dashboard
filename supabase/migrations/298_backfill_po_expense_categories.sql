-- 298 — Give the uncategorised PO expenses their category back
--
-- 12 expenses carry category_id = NULL, ~850k ETB between them. Every one
-- is expense_type = 'purchase_order'. On the Solomon Apartment project
-- page this is what surfaced as the "Unallocated" bucket; across the
-- ledger it is why the Sub Ledgers view cannot explain part of its own
-- control account.
--
-- ── Why they are NULL ────────────────────────────────────────────────────────
--
-- Not bad data entry — an ordering problem in the triggers.
--
-- A PO expense is created by auto_create_purchase_order_expense(), which
-- fires on INSERT of the goods_received_notes *header*. That INSERT never
-- sets category_id itself; it leaves the job to
-- apply_default_expense_category(), which calls resolve_expense_category().
-- For a purchase order that resolver reads the *ordered* lines —
-- order_items.sub_category_id -> sub_categories.parent_category_id.
--
-- The true category is not there. It is on the GRN *lines*, recorded by
-- whoever received the goods. Those lines are inserted after the header,
-- so at the moment the expense row is created they do not exist yet. When
-- the ordered lines also have no sub_category (which is the case for all
-- twelve), the resolver returns NULL — and nothing ever revisits the
-- expense once the receiving evidence lands.
--
-- The ledger, notably, does not have this problem:
-- post_expense_payment_to_ledger() falls back to
-- resolve_po_posting_category(), which reads the GRN lines. That is why
-- nine of these twelve posted to exactly the right expense account while
-- the expense row itself still said nothing. The ledger already knew.
--
-- ── Part 1: backfill ─────────────────────────────────────────────────────────
--
-- Ten resolve straight from GRN line evidence via
-- resolve_po_posting_category() — the same function the ledger already
-- used for them. For all nine of those that have posted, the resolved
-- category matches the expense account the entry actually debited (Foam
-- -> 51011, Electrical Materials -> 51007, Multiple -> 51028, Safarian ->
-- 51045, Components -> 51004, Ceramic -> 51002, MDF -> 51025, Inventory ->
-- 51019). So this is not a reclassification: it writes onto the expense
-- what its own journal entry has said all along. No ledger change is
-- needed and none is made.
--
-- One more — PO-2026-0009, Abi's Furniture — has a GRN whose header
-- records the category (Leather Materials) but which has no line items at
-- all, so the line-based resolver finds nothing. The header is still
-- first-hand receiving evidence, so it is used, as a separate and
-- explicitly narrower statement.
--
-- ── What is deliberately left alone ──────────────────────────────────────────
--
-- TEST-MISC-20260724-01 — 200,000 ETB, project "Test 2", PO-2026-0010
-- "Box", order still pending, unpaid, no GRN and no sub-category. There is
-- no evidence of what it is, because it is test data. Inventing a category
-- would be fabrication, and a made-up one is worse than an obvious blank:
-- the blank is what makes it findable. It wants archiving, which is a call
-- about live records rather than a schema change, so it is left for a
-- human to make.
--
-- ── Part 2: stop it recurring ────────────────────────────────────────────────
--
-- This is still happening — the most recent case is dated 3 September. A
-- backfill alone would leave the same gap open. So the receiving side now
-- closes it: when a GRN line lands, the PO expense behind it takes the
-- category the line implies, but only if it does not already have one.
-- An explicit choice by a human is never overwritten.

-- ── 1. Backfill from GRN line evidence ───────────────────────────────────────

UPDATE expenses e
   SET category_id = resolve_po_posting_category(e.sourcing_bundle_id)
 WHERE e.category_id IS NULL
   AND e.expense_type = 'purchase_order'
   AND resolve_po_posting_category(e.sourcing_bundle_id) IS NOT NULL;

-- ── 2. Backfill from the GRN header, where there are no lines ────────────────

UPDATE expenses e
   SET category_id = gn.category_id
  FROM goods_received_notes gn
 WHERE gn.sourcing_bundle_id = e.sourcing_bundle_id
   AND e.category_id IS NULL
   AND e.expense_type = 'purchase_order'
   AND gn.category_id IS NOT NULL;

-- ── 3. Keep it from happening again ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.backfill_po_expense_category_from_grn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bundle_id   uuid;
  v_category_id uuid;
BEGIN
  SELECT gn.sourcing_bundle_id INTO v_bundle_id
  FROM goods_received_notes gn WHERE gn.id = NEW.grn_id;

  IF v_bundle_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Nothing to do unless a PO expense for this bundle is still blank.
  -- Checked before resolving so the common case costs one indexed lookup.
  IF NOT EXISTS (
    SELECT 1 FROM expenses e
    WHERE e.sourcing_bundle_id = v_bundle_id
      AND e.category_id IS NULL
      AND e.expense_type = 'purchase_order'
  ) THEN
    RETURN NULL;
  END IF;

  v_category_id := resolve_po_posting_category(v_bundle_id);

  IF v_category_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE expenses e
     SET category_id = v_category_id
   WHERE e.sourcing_bundle_id = v_bundle_id
     AND e.category_id IS NULL
     AND e.expense_type = 'purchase_order';

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.backfill_po_expense_category_from_grn() IS
  'Fills in a PO expense category once the GRN lines that reveal it exist. The expense row is created on GRN header insert, before those lines, so the category cannot be known at that point. Only ever fills a NULL — an explicit category set by a person is never overwritten.';

DROP TRIGGER IF EXISTS trg_backfill_po_expense_category ON goods_received_note_items;

-- AFTER, so the GRN line is already visible to
-- resolve_po_posting_category() when it runs.
--
-- The quantity columns listed are the ones a person can actually write.
-- quantity_accepted, which is what the resolver weighs lines by, is a
-- GENERATED column (received - rejected - damaged), and a generated column
-- can never appear in an UPDATE, so naming it here would define a clause
-- that could not fire. Its three inputs are named instead.
CREATE TRIGGER trg_backfill_po_expense_category
AFTER INSERT OR UPDATE OF category_id, quantity_received, quantity_rejected, quantity_damaged
ON goods_received_note_items
FOR EACH ROW
EXECUTE FUNCTION backfill_po_expense_category_from_grn();
