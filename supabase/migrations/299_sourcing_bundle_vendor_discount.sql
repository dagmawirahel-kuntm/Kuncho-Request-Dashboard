-- 299 — vendor discounts on sourcing bundles
--
-- A vendor knocking something off the quoted price had nowhere to go. The
-- only way to record one was to shade the unit prices on the line items,
-- which loses the fact that a discount was given, hides how big it was, and
-- corrupts the unit rates that auto_log_market_price_from_po feeds into the
-- market price history.
--
-- Shape: a discount belongs to the bundle, not the line. Vendors here
-- negotiate one figure off a whole order ("take 5% off", "call it 48,000
-- even"), and a per-line discount would just be a second unit price. Both
-- of those forms are supported:
--
--   discount_kind = 'percent'  -> discount_value is 0-100
--   discount_kind = 'amount'   -> discount_value is ETB off the subtotal
--   discount_kind = 'none'     -> no discount (the default)
--
-- discount_value is what somebody typed. discount_etb is that resolved to
-- birr against the current line items, and items_subtotal_etb is the
-- pre-discount sum. Both are derived — a trigger owns them — so every
-- reader gets the same numbers without re-deriving the arithmetic, which is
-- the mistake this migration is cleaning up in three places at once.
--
-- total_value becomes NET of the discount. That is deliberate and it is the
-- consequential decision here, because RLS reads that column for the
-- approval ladder (procurement to 30,000 in 255, operations_manager to
-- 500,000 in 133). Net is the right basis: the cap exists to limit what the
-- company commits to pay, and after a discount it commits to less. A PO of
-- 32,000 with 10% off is a 28,800 commitment and a procurement officer may
-- approve it. Because the discount is a stored column with its own history
-- rather than a haircut smeared across unit prices, a discount typed purely
-- to duck a cap is visible on the PO as its own line.
--
-- items_subtotal_etb and discount_etb are recomputed on every write to the
-- bundle, so total_value can no longer be set by hand from anywhere. It was
-- already derived in practice — SourcingBundleInsert omits it — this makes
-- that true in the database.
--
-- The discount joins the set of fields enforce_bundle_drafting_only() freezes
-- once a bundle leaves drafting. That freeze is the reason net total_value is
-- safe to hang the approval caps on: without it, a PO could be approved at one
-- figure and then discounted — or un-discounted, raising what the vendor is
-- billed — behind the approval. A discount agreed after approval is not
-- entered here; it goes on the linked expense, the same route a GRN rejection
-- deduction already takes, where finance can see what it is adjusting.

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE sourcing_bundles
  ADD COLUMN IF NOT EXISTS discount_kind      TEXT    NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS discount_value     NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason    TEXT,
  ADD COLUMN IF NOT EXISTS discount_etb       NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_subtotal_etb NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE sourcing_bundles
  DROP CONSTRAINT IF EXISTS sourcing_bundles_discount_kind_check;
ALTER TABLE sourcing_bundles
  ADD CONSTRAINT sourcing_bundles_discount_kind_check
  CHECK (discount_kind IN ('none', 'percent', 'amount'));

-- The value is checked as typed, not as resolved. A percentage over 100 or
-- a negative figure is a typo and should be refused at the door; an amount
-- larger than the current subtotal is not necessarily one — lines get added
-- after the discount is agreed — so that case is clamped when resolving
-- rather than rejected here.
ALTER TABLE sourcing_bundles
  DROP CONSTRAINT IF EXISTS sourcing_bundles_discount_value_check;
ALTER TABLE sourcing_bundles
  ADD CONSTRAINT sourcing_bundles_discount_value_check
  CHECK (
    discount_value >= 0
    AND (discount_kind <> 'percent' OR discount_value <= 100)
    AND (discount_kind <> 'none'    OR discount_value = 0)
  );

COMMENT ON COLUMN sourcing_bundles.discount_kind IS
  'How the vendor discount was expressed: none, percent (discount_value is 0-100) or amount (discount_value is ETB).';
COMMENT ON COLUMN sourcing_bundles.discount_value IS
  'The discount as entered — a percentage or an ETB figure depending on discount_kind. See discount_etb for it resolved to birr.';
COMMENT ON COLUMN sourcing_bundles.discount_etb IS
  'Derived: discount_value resolved against items_subtotal_etb and clamped to it. Maintained by apply_sourcing_bundle_discount(); do not write.';
COMMENT ON COLUMN sourcing_bundles.items_subtotal_etb IS
  'Derived: SUM(quantity_actual * unit_price_actual) over the bundle items, before any discount. Maintained by apply_sourcing_bundle_discount(); do not write.';
COMMENT ON COLUMN sourcing_bundles.total_value IS
  'Derived: items_subtotal_etb - discount_etb. The net commitment, and the column the RLS approval caps are written against.';

-- ── 2. One place that does the arithmetic ────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_bundle_discount(
  p_subtotal NUMERIC, p_kind TEXT, p_value NUMERIC
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT LEAST(
    GREATEST(
      CASE COALESCE(p_kind, 'none')
        WHEN 'percent' THEN ROUND(COALESCE(p_subtotal, 0) * COALESCE(p_value, 0) / 100.0, 2)
        WHEN 'amount'  THEN COALESCE(p_value, 0)
        ELSE 0
      END, 0),
    GREATEST(COALESCE(p_subtotal, 0), 0)
  );
$fn$;

COMMENT ON FUNCTION public.resolve_bundle_discount(NUMERIC, TEXT, NUMERIC) IS
  'Vendor discount in birr for a given bundle subtotal. Never negative and never more than the subtotal, so a stale or over-large discount cannot drive a PO below zero.';

CREATE OR REPLACE FUNCTION public.apply_sourcing_bundle_discount()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.items_subtotal_etb := COALESCE((
    SELECT SUM(COALESCE(quantity_actual, 0) * COALESCE(unit_price_actual, 0))
    FROM sourcing_bundle_items WHERE bundle_id = NEW.id
  ), 0);
  NEW.discount_etb := resolve_bundle_discount(
    NEW.items_subtotal_etb, NEW.discount_kind, NEW.discount_value);
  NEW.total_value := NEW.items_subtotal_etb - NEW.discount_etb;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.apply_sourcing_bundle_discount() IS
  'Keeps items_subtotal_etb, discount_etb and total_value derived on every write to a bundle. Runs BEFORE the row is checked, so the RLS approval caps see the discounted total.';

DROP TRIGGER IF EXISTS trg_apply_sourcing_bundle_discount ON sourcing_bundles;
CREATE TRIGGER trg_apply_sourcing_bundle_discount
  BEFORE INSERT OR UPDATE ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION public.apply_sourcing_bundle_discount();

-- The items trigger no longer computes anything itself: it touches the
-- bundle row and lets the trigger above do the one calculation. Two copies
-- of this sum is how total_value and the discount would drift apart.
CREATE OR REPLACE FUNCTION public.recalc_sourcing_bundle_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE
  v_bundle_id UUID := COALESCE(NEW.bundle_id, OLD.bundle_id);
BEGIN
  UPDATE sourcing_bundles SET updated_at = now() WHERE id = v_bundle_id;
  RETURN NULL;
END;
$fn$;

-- ── 2b. The discount is frozen with the rest of the PO ───────────────────
-- Same list, same reason as 149: a PO must not quietly change after finance
-- approved it, and a discount is one of the largest changes anyone could make
-- to one. Only the three entered columns are frozen — discount_etb,
-- items_subtotal_etb and total_value are derived and still move when line
-- items do, exactly as total_value already did.
CREATE OR REPLACE FUNCTION public.enforce_bundle_drafting_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
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
  -- date, notes, procurement officer, vendor discount — is frozen once it
  -- has left drafting, so a PO can't quietly change after finance
  -- approved it.
  IF v_status != 'drafting' AND NEW.status = OLD.status
     AND (NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.vendor_name IS DISTINCT FROM OLD.vendor_name
       OR NEW.expected_delivery_date IS DISTINCT FROM OLD.expected_delivery_date
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.procurement_officer_id IS DISTINCT FROM OLD.procurement_officer_id
       OR NEW.discount_kind IS DISTINCT FROM OLD.discount_kind
       OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
       OR NEW.discount_reason IS DISTINCT FROM OLD.discount_reason) THEN
    RAISE EXCEPTION 'Cannot edit a sourcing bundle once it has left drafting (current: %)', v_status;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ── 3. The expense a PO creates is billed net ────────────────────────────
-- Was re-summing the line items, which would have billed the vendor the
-- undiscounted figure. Reads the derived total instead — the same number
-- finance approved.
CREATE OR REPLACE FUNCTION public.auto_create_purchase_order_expense()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_bundle          sourcing_bundles%ROWTYPE;
  v_item_names      TEXT;
  v_project_id      UUID;
  v_project_count   INT;
  v_expense_id      UUID;
BEGIN
  SELECT * INTO v_bundle FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  IF v_bundle.expense_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(DISTINCT oi.item_name, ', ')
  INTO v_item_names
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.bundle_id = v_bundle.id;

  -- Only set project_id when every line item traces to the same
  -- project — same single-project rule the existing manual prefill
  -- used (ExpenseFormPage), rather than guessing on a mixed-project PO.
  SELECT count(*) INTO v_project_count FROM (
    SELECT DISTINCT o.project_id
    FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = v_bundle.id AND o.project_id IS NOT NULL
  ) distinct_projects;

  IF v_project_count = 1 THEN
    SELECT o.project_id INTO v_project_id
    FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = v_bundle.id AND o.project_id IS NOT NULL
    LIMIT 1;
  ELSE
    v_project_id := NULL;
  END IF;

  INSERT INTO expenses (
    item_service_description, amount_etb, date, expense_type,
    vendor_id, vendors_name, project_id, sourcing_bundle_id, requested, notes
  ) VALUES (
    'PO ' || v_bundle.bundle_code || COALESCE(' — ' || v_item_names, ''),
    COALESCE(v_bundle.total_value, 0), CURRENT_DATE, 'purchase_order',
    v_bundle.vendor_id, CASE WHEN v_bundle.vendor_id IS NULL THEN v_bundle.vendor_name END,
    v_project_id, v_bundle.id, true,
    CASE WHEN COALESCE(v_bundle.discount_etb, 0) > 0 THEN
      format('Vendor discount of %s ETB applied: %s before discount, %s billed.%s',
             v_bundle.discount_etb, v_bundle.items_subtotal_etb, v_bundle.total_value,
             COALESCE(' ' || v_bundle.discount_reason, ''))
    END
  ) RETURNING id INTO v_expense_id;

  UPDATE sourcing_bundles SET expense_id = v_expense_id WHERE id = v_bundle.id;

  RETURN NEW;
END;
$fn$;

-- ── 4. Rejected goods are deducted at the discounted rate ────────────────
-- 253 deducts rejected quantity at the full line price. On a discounted PO
-- that over-credits: the vendor was never going to be paid the full line
-- price for those units. The deduction is pro-rated by the same ratio the
-- discount applied to the order as a whole, so rejecting every line lands
-- back at the discounted total rather than below it.
CREATE OR REPLACE FUNCTION public.adjust_po_expense_for_rejected_qty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_bundle_id       UUID;
  v_payment_pattern TEXT;
  v_expense_id      UUID;
  v_expense_state   TEXT;
  v_old_amount      NUMERIC;
  v_prior_deduction NUMERIC;
  v_rejected_total  NUMERIC;
  v_subtotal        NUMERIC;
  v_net             NUMERIC;
  v_delta           NUMERIC;
  v_new_amount      NUMERIC;
BEGIN
  SELECT sbi.bundle_id INTO v_bundle_id
  FROM sourcing_bundle_items sbi
  WHERE sbi.id = COALESCE(NEW.sourcing_bundle_item_id, OLD.sourcing_bundle_item_id);

  IF v_bundle_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT payment_pattern, expense_id, rejection_deduction_etb,
         items_subtotal_etb, total_value
  INTO v_payment_pattern, v_expense_id, v_prior_deduction, v_subtotal, v_net
  FROM sourcing_bundles WHERE id = v_bundle_id;

  IF v_expense_id IS NULL OR v_payment_pattern = 'pay_in_advance' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT amount_etb, payment_state INTO v_old_amount, v_expense_state
  FROM expenses WHERE id = v_expense_id;

  -- Once the expense has moved past 'unpaid' it's already committed to
  -- a payment flow — adjust it by hand rather than have this trigger
  -- silently rewrite a number finance is already acting on.
  IF v_expense_state IS DISTINCT FROM 'unpaid' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(gi.quantity_rejected * COALESCE(sbi2.unit_price_actual, 0)), 0)
  INTO v_rejected_total
  FROM goods_received_note_items gi
  JOIN sourcing_bundle_items sbi2 ON sbi2.id = gi.sourcing_bundle_item_id
  WHERE sbi2.bundle_id = v_bundle_id;

  IF COALESCE(v_subtotal, 0) > 0 AND v_net IS NOT NULL AND v_net <> v_subtotal THEN
    v_rejected_total := ROUND(v_rejected_total * (v_net / v_subtotal), 2);
  END IF;

  v_delta := v_rejected_total - COALESCE(v_prior_deduction, 0);

  IF v_delta <> 0 THEN
    v_new_amount := GREATEST(v_old_amount - v_delta, 0);
    UPDATE expenses
    SET amount_etb = v_new_amount,
        notes = COALESCE(notes || E'\n', '') ||
          format('Auto-adjusted %s → %s ETB: %s change in rejected quantity on the linked GRN, not billed.', v_old_amount, v_new_amount, v_delta)
    WHERE id = v_expense_id;

    UPDATE sourcing_bundles SET rejection_deduction_etb = v_rejected_total WHERE id = v_bundle_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

COMMENT ON FUNCTION public.adjust_po_expense_for_rejected_qty() IS
  'Keeps the PO''s auto-created vendor expense billed only for accepted quantity when goods are rejected, pro-rating the deduction by any vendor discount on the bundle. Skipped for pay-in-advance POs (already paid before delivery) and once the expense has left the unpaid state (already in a payment flow) — both need a human call, not a silent rewrite.';

-- ── 5. Backfill the derived columns on existing bundles ──────────────────
-- No bundle has a discount yet, so total_value must not move — except where
-- it was already wrong. One bundle is: PO-2026-0021, a draft from 12 Aug
-- carrying total_value 53,600.00 with no line items at all and no expense.
-- Its lines went away without the stored total following them. The right
-- figure for a PO with no lines is 0, and the backfill puts it there.
--
-- So the assertion is not "nothing moves" but the sharper claim: nothing
-- that already agreed with its own line items moves. A bundle whose total
-- was right stays right, and anything that shifts is named in a NOTICE.
DO $$
DECLARE
  v_broken INT;
  r        RECORD;
BEGIN
  CREATE TEMP TABLE _bundle_totals_before ON COMMIT DROP AS
  SELECT b.id,
         b.total_value,
         COALESCE((SELECT SUM(COALESCE(i.quantity_actual, 0) * COALESCE(i.unit_price_actual, 0))
                   FROM sourcing_bundle_items i WHERE i.bundle_id = b.id), 0) AS item_sum
  FROM sourcing_bundles b;

  -- A no-op write to pass every row through the new BEFORE trigger. The
  -- updated_at trigger is held off so this does not mark every PO in the
  -- system as freshly touched; enforce_bundle_drafting_only stays on and
  -- allows it, since nothing it guards is changing.
  ALTER TABLE sourcing_bundles DISABLE TRIGGER trg_bundle_updated_at;
  UPDATE sourcing_bundles SET updated_at = updated_at;
  ALTER TABLE sourcing_bundles ENABLE TRIGGER trg_bundle_updated_at;

  FOR r IN
    SELECT b.bundle_code, p.total_value AS was, b.total_value AS is_now
    FROM _bundle_totals_before p
    JOIN sourcing_bundles b ON b.id = p.id
    WHERE p.total_value IS DISTINCT FROM b.total_value
  LOOP
    RAISE NOTICE 'corrected % : % -> %', r.bundle_code, r.was, r.is_now;
  END LOOP;

  SELECT count(*) INTO v_broken
  FROM _bundle_totals_before p
  JOIN sourcing_bundles b ON b.id = p.id
  WHERE p.total_value = p.item_sum
    AND b.total_value IS DISTINCT FROM p.total_value;

  IF v_broken > 0 THEN
    RAISE EXCEPTION 'backfill moved total_value on % bundle(s) that already agreed with their line items', v_broken;
  END IF;

  IF EXISTS (SELECT 1 FROM sourcing_bundles WHERE discount_etb <> 0) THEN
    RAISE EXCEPTION 'backfill produced a non-zero discount on a bundle that has none';
  END IF;

  IF EXISTS (SELECT 1 FROM sourcing_bundles WHERE total_value <> items_subtotal_etb - discount_etb) THEN
    RAISE EXCEPTION 'total_value does not equal subtotal minus discount on every bundle';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
