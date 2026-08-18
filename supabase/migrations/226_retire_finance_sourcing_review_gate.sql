-- Retiring the finance sourcing review gate (147, actually applied as
-- 225 in this repo's history) as a blocker on sourcing. It was only
-- live for a short window before this reversal — once it started
-- actually enforcing (225), a purchase request needing finance
-- clearance on any line could not be sourced until a finance/admin
-- user acted on it, which made the PR → sourcing process too tight.
-- Same call already made once before for orders.approval_status
-- (149/163): keep the historical data, stop it from gating or
-- generating new rows.
--
-- Left untouched: finance_sourcing_reviews itself (table + its 72 rows
-- from the brief live window, kept for reference), and projects.
-- finance_contact_id / trg_block_finance_contact_reassign (147, §1) —
-- a separate, unrelated concept (who a project's finance contact is),
-- not part of the sourcing gate.

SET search_path TO public;

-- ── 1. The actual gate: no longer blocks sourcing_bundle_items ──────
DROP TRIGGER IF EXISTS trg_enforce_finance_review_before_sourcing ON sourcing_bundle_items;
DROP FUNCTION IF EXISTS enforce_finance_review_before_sourcing();

-- ── 2. Stop generating new review rows ───────────────────────────────
DROP TRIGGER IF EXISTS trg_order_item_ensure_finance_review ON order_items;
DROP FUNCTION IF EXISTS trg_order_item_ensure_finance_review();

-- check_and_fulfill_from_stock() reverts to its pre-147 (migration 115)
-- body — the stock-first check on save still runs, it just no longer
-- calls into the review gate when nothing's available.
CREATE OR REPLACE FUNCTION public.check_and_fulfill_from_stock(p_order_item_id uuid)
 RETURNS TABLE(proposed_qty numeric, remaining_qty numeric, new_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF v_item.stock_item_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, COALESCE(v_item.quantity, 0), v_item.status;
    RETURN;
  END IF;

  SELECT qty_on_hand INTO v_on_hand FROM v_stock_on_hand WHERE stock_item_id = v_item.stock_item_id;
  v_on_hand := GREATEST(COALESCE(v_on_hand, 0), 0);

  IF v_on_hand <= 0 THEN
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
$function$;

DROP FUNCTION IF EXISTS ensure_finance_sourcing_review(uuid);

-- ── 3. Document the retirement on the table itself, same pattern as
-- the COMMENT ON COLUMN orders.approval_status carries (149) ─────────
COMMENT ON TABLE finance_sourcing_reviews IS
  'RETIRED AS A GATE. Was briefly wired live (migration 225) as a required approval before a line could be sourced, but that made the PR-to-sourcing process too tight. The table and its rows from that window are kept for reference only — nothing creates new rows or enforces on this table any more. Do not reintroduce it as a gate without a product decision first.';
