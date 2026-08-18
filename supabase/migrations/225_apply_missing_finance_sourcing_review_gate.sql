-- migration 147 (finance_sourcing_review_gate) was never actually
-- applied to this database, despite living in the repo's migration
-- history since before this session started. Confirmed live: the
-- finance_sourcing_reviews table didn't exist at all, and
-- check_and_fulfill_from_stock() was still running its pre-147
-- (migration 115) body — no calls to ensure_finance_sourcing_review()
-- anywhere. The frontend (OrderDetailPage.tsx) has queried this table
-- since 147 was written; every query silently resolved to an empty
-- array (react-query's `data ?? []` swallowed the "relation does not
-- exist" error), so the entire finance-review block on every purchase
-- request's detail page rendered nothing — not "no review needed",
-- just invisible. Reported as "the review for finance is non-existent."
--
-- This is 147's DDL/functions/triggers verbatim (nothing here is a
-- design change), plus a backfill 147 itself never needed at the time
-- but now does: 72 already-pending line items across 58 live purchase
-- requests had no review row and never will unless one is created now,
-- since the new trigger only fires on INSERT or on UPDATE of
-- stock_item_id/status/quantity — a page load doesn't touch any of
-- those. The backfill mirrors check_and_fulfill_from_stock()'s own
-- logic inline rather than calling it directly, since that function's
-- auth.uid() IS NULL guard (correct for a real user session) would
-- reject every call made here as an unauthenticated migration.

SET search_path TO public;

-- ── 1. projects.finance_contact_id ──────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS finance_contact_id UUID REFERENCES user_profiles(id);

CREATE OR REPLACE FUNCTION block_finance_contact_reassign_by_non_admin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.finance_contact_id IS DISTINCT FROM OLD.finance_contact_id AND get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can assign or reassign a project''s finance contact';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_finance_contact_reassign ON projects;
CREATE TRIGGER trg_block_finance_contact_reassign
  BEFORE UPDATE OF finance_contact_id ON projects
  FOR EACH ROW EXECUTE FUNCTION block_finance_contact_reassign_by_non_admin();

-- ── 2. finance_sourcing_reviews ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_sourcing_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id  UUID NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'exempt')),
  reviewed_by    UUID REFERENCES user_profiles(id),
  reviewed_at    TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_sourcing_reviews_status ON finance_sourcing_reviews(status);

ALTER TABLE finance_sourcing_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_sourcing_reviews_read" ON finance_sourcing_reviews;
CREATE POLICY "finance_sourcing_reviews_read" ON finance_sourcing_reviews FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "finance_sourcing_reviews_write" ON finance_sourcing_reviews;
CREATE POLICY "finance_sourcing_reviews_write" ON finance_sourcing_reviews FOR UPDATE
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

GRANT SELECT, UPDATE ON finance_sourcing_reviews TO authenticated;

CREATE OR REPLACE FUNCTION stamp_finance_sourcing_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_finance_sourcing_review ON finance_sourcing_reviews;
CREATE TRIGGER trg_stamp_finance_sourcing_review
  BEFORE UPDATE OF status ON finance_sourcing_reviews
  FOR EACH ROW EXECUTE FUNCTION stamp_finance_sourcing_review();

-- ── 3. Row creation ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ensure_finance_sourcing_review(p_order_item_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item          RECORD;
  v_cost_group_id UUID;
  v_line_amount   NUMERIC;
  v_remaining     NUMERIC;
  v_is_provisional BOOLEAN;
  v_status        TEXT;
BEGIN
  SELECT oi.quantity, oi.unit_price_est, oi.sub_category_id, o.project_id
  INTO v_item
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT c.cost_group_id INTO v_cost_group_id
  FROM sub_categories sc JOIN categories c ON c.id = sc.parent_category_id
  WHERE sc.id = v_item.sub_category_id;

  IF v_item.project_id IS NULL OR v_cost_group_id IS NULL OR v_item.unit_price_est IS NULL THEN
    v_status := 'pending';
  ELSE
    v_line_amount := COALESCE(v_item.quantity, 0) * v_item.unit_price_est;

    SELECT remaining_amount, is_provisional INTO v_remaining, v_is_provisional
    FROM v_project_cost_group_budget
    WHERE project_id = v_item.project_id AND cost_group_id = v_cost_group_id;

    IF NOT FOUND OR v_is_provisional OR v_remaining <= 0 THEN
      v_status := 'pending';
    ELSIF v_line_amount >= 0.20 * v_remaining THEN
      v_status := 'pending';
    ELSE
      v_status := 'exempt';
    END IF;
  END IF;

  INSERT INTO finance_sourcing_reviews (order_item_id, status)
  VALUES (p_order_item_id, v_status)
  ON CONFLICT (order_item_id) DO NOTHING;
END;
$$;

-- ── 4. Hook into both places a line can be confirmed "not in stock" ──
CREATE OR REPLACE FUNCTION check_and_fulfill_from_stock(p_order_item_id UUID)
RETURNS TABLE(proposed_qty NUMERIC, remaining_qty NUMERIC, new_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item      RECORD;
  v_on_hand   NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT oi.* INTO v_item FROM order_items oi WHERE oi.id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found';
  END IF;

  IF COALESCE(v_item.quantity, 0) <= 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, COALESCE(v_item.quantity, 0), v_item.status;
    RETURN;
  END IF;

  IF v_item.stock_item_id IS NULL THEN
    PERFORM ensure_finance_sourcing_review(p_order_item_id);
    RETURN QUERY SELECT 0::NUMERIC, v_item.quantity, v_item.status;
    RETURN;
  END IF;

  SELECT qty_on_hand INTO v_on_hand FROM v_stock_on_hand WHERE stock_item_id = v_item.stock_item_id;
  v_on_hand := GREATEST(COALESCE(v_on_hand, 0), 0);

  IF v_on_hand <= 0 THEN
    PERFORM ensure_finance_sourcing_review(p_order_item_id);
    RETURN QUERY SELECT 0::NUMERIC, v_item.quantity, v_item.status;
    RETURN;
  END IF;

  UPDATE order_items
  SET status = 'stock_pending_dispatch',
      stock_dispatch_qty = LEAST(v_on_hand, v_item.quantity),
      fulfillment_notes = TRIM(BOTH E'\n' FROM COALESCE(fulfillment_notes || E'\n', '') ||
        format('%s %s available from stock as of %s — awaiting stock officer sign-off and transport assignment',
               LEAST(v_on_hand, v_item.quantity), COALESCE(unit, ''), CURRENT_DATE))
  WHERE id = p_order_item_id;

  RETURN QUERY SELECT LEAST(v_on_hand, v_item.quantity), (v_item.quantity - LEAST(v_on_hand, v_item.quantity)), 'stock_pending_dispatch'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION trg_order_item_ensure_finance_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stock_item_id IS NULL AND NEW.status = 'pending' AND COALESCE(NEW.quantity, 0) > 0 THEN
    PERFORM ensure_finance_sourcing_review(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_item_ensure_finance_review ON order_items;
CREATE TRIGGER trg_order_item_ensure_finance_review
  AFTER INSERT OR UPDATE OF stock_item_id, status, quantity ON order_items
  FOR EACH ROW EXECUTE FUNCTION trg_order_item_ensure_finance_review();

-- ── 5. The actual gate ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_finance_review_before_sourcing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM finance_sourcing_reviews WHERE order_item_id = NEW.order_item_id;
  IF v_status IS NOT NULL AND v_status NOT IN ('exempt', 'approved') THEN
    RAISE EXCEPTION 'This request needs a finance review before it can be sourced (current status: %)', v_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_finance_review_before_sourcing ON sourcing_bundle_items;
CREATE TRIGGER trg_enforce_finance_review_before_sourcing
  BEFORE INSERT ON sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_review_before_sourcing();

-- ── 6. Backfill — 147 shipped with no backfill because it assumed the
-- trigger would cover every relevant row going forward. It never ran
-- at all, so every currently-pending line item needs the same check a
-- fresh save would have given it.
DO $$
DECLARE
  r RECORD;
  v_on_hand NUMERIC;
BEGIN
  FOR r IN
    SELECT id, stock_item_id, quantity, unit, fulfillment_notes
    FROM order_items
    WHERE status = 'pending' AND COALESCE(quantity,0) > 0
  LOOP
    IF r.stock_item_id IS NOT NULL THEN
      SELECT qty_on_hand INTO v_on_hand FROM v_stock_on_hand WHERE stock_item_id = r.stock_item_id;
      v_on_hand := GREATEST(COALESCE(v_on_hand, 0), 0);
      IF v_on_hand > 0 THEN
        UPDATE order_items
        SET status = 'stock_pending_dispatch',
            stock_dispatch_qty = LEAST(v_on_hand, r.quantity),
            fulfillment_notes = TRIM(BOTH E'\n' FROM COALESCE(r.fulfillment_notes || E'\n', '') ||
              format('%s %s available from stock as of %s — awaiting stock officer sign-off and transport assignment',
                     LEAST(v_on_hand, r.quantity), COALESCE(r.unit, ''), CURRENT_DATE))
        WHERE id = r.id;
      ELSE
        PERFORM ensure_finance_sourcing_review(r.id);
      END IF;
    ELSE
      PERFORM ensure_finance_sourcing_review(r.id);
    END IF;
  END LOOP;
END $$;
