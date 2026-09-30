-- 371 — Site Delivery Notes, partial deliveries and returns to the vendor
--
-- Most purchases go straight to a site, where nobody ever confirmed them:
-- an admin typed the GRN later from the office, and the first GRN closed the
-- whole purchase order however much had actually arrived.
--
-- Now:
--   * A Site Delivery Note (SDN) is issued by procurement or logistics when
--     goods leave for a site: which lines, how many, on which transport job.
--     One open SDN per purchase order and site, and one per transport job,
--     so the same delivery can't be sent (and received) twice.
--   * The site's project manager signs it on their phone: what arrived,
--     what was damaged, what they refused, with photos. If everything
--     arrived in full and undamaged, the GRN is written straight away and
--     the transport job is closed. Anything else waits for procurement to
--     confirm the figures, and the GRN is written from what they confirm.
--   * A purchase order can now be received in several deliveries. It is
--     fulfilled once every line is accounted for (received, or refused at
--     the door), or when procurement closes it short with a reason.
--   * Pay-on-delivery: the expense is prepared when the order is fulfilled,
--     not at the first delivery, so nobody pays for goods still on the road.
--     What was refused, or never came on an order closed short, is taken
--     off the bill.
--   * Refused goods are tracked until they go back to the vendor.
--   * Project managers can read the GRNs of their projects.
--   * Vendor on-time figures judge the complete delivery, not the first.

SET search_path TO public;

-- ── 1. New columns ───────────────────────────────────────────────────
ALTER TABLE sourcing_bundles
  ADD COLUMN IF NOT EXISTS closed_short_at     timestamptz,
  ADD COLUMN IF NOT EXISTS closed_short_by     uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_short_reason text;
COMMENT ON COLUMN sourcing_bundles.closed_short_at IS
  'Set when procurement closed this order before everything arrived (371). What never came is not billed on pay-on-delivery orders.';

ALTER TABLE goods_received_notes
  ADD COLUMN IF NOT EXISTS delivery_note_ref text,
  ADD COLUMN IF NOT EXISTS driver_name       text,
  ADD COLUMN IF NOT EXISTS vehicle_plate     text,
  ADD COLUMN IF NOT EXISTS photos            jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS site_delivery_note_id uuid;
COMMENT ON COLUMN goods_received_notes.delivery_note_ref IS 'The vendor''s own delivery note or waybill number.';
COMMENT ON COLUMN goods_received_notes.photos IS 'Array of {url, name}. photo_url/photo_name keep the first one for older screens.';

ALTER TABLE goods_received_note_items
  ADD COLUMN IF NOT EXISTS return_status    text,
  ADD COLUMN IF NOT EXISTS returned_at      timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by      uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_reference text;
DO $$ BEGIN
  ALTER TABLE goods_received_note_items ADD CONSTRAINT grn_items_return_status_chk
    CHECK (return_status IS NULL OR return_status IN ('to_return', 'returned'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN goods_received_note_items.return_status IS
  'to_return while refused goods are still with us, returned once the vendor has them back (371).';

-- Refused goods start out waiting to go back.
CREATE OR REPLACE FUNCTION public.set_grn_item_return_status()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF COALESCE(NEW.quantity_rejected, 0) > 0 THEN
    IF NEW.return_status IS NULL THEN NEW.return_status := 'to_return'; END IF;
  ELSE
    NEW.return_status := NULL; NEW.returned_at := NULL; NEW.returned_by := NULL; NEW.return_reference := NULL;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_set_grn_item_return_status ON goods_received_note_items;
CREATE TRIGGER trg_set_grn_item_return_status BEFORE INSERT OR UPDATE ON goods_received_note_items
  FOR EACH ROW EXECUTE FUNCTION set_grn_item_return_status();

UPDATE goods_received_note_items SET return_status = 'to_return'
 WHERE quantity_rejected > 0 AND return_status IS NULL;

-- ── 2. Where each purchase order line stands ─────────────────────────
-- ordered: the PO quantity. received: everything counted at the door
-- (accepted + damaged + refused) across every GRN. outstanding: what is
-- still to come. A line is settled when nothing is outstanding.
CREATE OR REPLACE VIEW public.v_bundle_line_receipts WITH (security_invoker = true) AS
SELECT sbi.bundle_id,
       sbi.id AS bundle_item_id,
       o.project_id,
       oi.item_name,
       oi.unit,
       COALESCE(sbi.quantity_actual, oi.quantity, 0) AS ordered,
       COALESCE(r.received, 0)  AS received,
       COALESCE(r.accepted, 0)  AS accepted,
       COALESCE(r.damaged, 0)   AS damaged,
       COALESCE(r.rejected, 0)  AS rejected,
       GREATEST(COALESCE(sbi.quantity_actual, oi.quantity, 0) - COALESCE(r.received, 0), 0) AS outstanding,
       sbi.unit_price_actual,
       sbi.sort_order
FROM sourcing_bundle_items sbi
LEFT JOIN order_items oi ON oi.id = sbi.order_item_id
LEFT JOIN orders o ON o.id = oi.order_id
LEFT JOIN LATERAL (
  SELECT sum(gi.quantity_received) AS received, sum(gi.quantity_accepted) AS accepted,
         sum(gi.quantity_damaged) AS damaged, sum(gi.quantity_rejected) AS rejected
  FROM goods_received_note_items gi WHERE gi.sourcing_bundle_item_id = sbi.id
) r ON true;

-- ── 3. Fulfil when everything is accounted for ───────────────────────
CREATE OR REPLACE FUNCTION public.refresh_bundle_receipt(p_bundle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_status sourcing_bundle_status;
  v_last   timestamptz;
BEGIN
  SELECT status INTO v_status FROM sourcing_bundles WHERE id = p_bundle_id;
  IF v_status IS DISTINCT FROM 'ordered' THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM goods_received_notes WHERE sourcing_bundle_id = p_bundle_id) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM v_bundle_line_receipts WHERE bundle_id = p_bundle_id AND outstanding > 0) THEN RETURN; END IF;

  SELECT max(received_at) INTO v_last FROM goods_received_notes WHERE sourcing_bundle_id = p_bundle_id;
  UPDATE sourcing_bundles SET status = 'fulfilled', fulfilled_at = COALESCE(v_last, now())
   WHERE id = p_bundle_id AND status = 'ordered';
END $function$;

CREATE OR REPLACE FUNCTION public.trg_refresh_bundle_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_bundle uuid;
BEGIN
  SELECT sourcing_bundle_id INTO v_bundle FROM goods_received_notes WHERE id = NEW.grn_id;
  IF v_bundle IS NOT NULL THEN PERFORM refresh_bundle_receipt(v_bundle); END IF;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_refresh_bundle_receipt ON goods_received_note_items;
CREATE TRIGGER trg_refresh_bundle_receipt AFTER INSERT OR UPDATE ON goods_received_note_items
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_bundle_receipt();

-- The first GRN no longer closes the order.
DROP TRIGGER IF EXISTS trg_grn_fulfills_bundle ON goods_received_notes;

-- ── 4. Pay-on-delivery expense waits for the complete delivery ───────
-- A GRN only prepares the expense itself for an order paid in advance
-- (where it already exists from ordering, so this is a no-op kept for
-- older orders whose advance expense was never made).
CREATE OR REPLACE FUNCTION public.auto_create_purchase_order_expense()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF (SELECT payment_pattern FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id) = 'pay_in_advance' THEN
    PERFORM create_po_expense(NEW.sourcing_bundle_id);
  END IF;
  RETURN NEW;
END $function$;

-- What isn't billed: goods refused at the door, plus — once an order is
-- closed short — what never came. Same arithmetic as before (discount
-- carried pro rata, VAT on top, WHT rescaled or dropped under the floor),
-- now callable from wherever the figures change.
CREATE OR REPLACE FUNCTION public.sync_po_expense_deduction(p_bundle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_payment_pattern TEXT;
  v_expense_id      UUID;
  v_expense_state   TEXT;
  v_closed_short    TIMESTAMPTZ;
  v_old_amount      NUMERIC;
  v_old_wht         NUMERIC;
  v_prior_deduction NUMERIC;
  v_rejected_total  NUMERIC;
  v_short_total     NUMERIC := 0;
  v_subtotal        NUMERIC;
  v_net             NUMERIC;
  v_delta           NUMERIC;
  v_new_amount      NUMERIC;
  v_billed_before   NUMERIC;
  v_billed_after    NUMERIC;
  v_new_wht         NUMERIC;
BEGIN
  SELECT payment_pattern, expense_id, rejection_deduction_etb, items_subtotal_etb, total_value, closed_short_at
    INTO v_payment_pattern, v_expense_id, v_prior_deduction, v_subtotal, v_net, v_closed_short
  FROM sourcing_bundles WHERE id = p_bundle_id;

  IF v_expense_id IS NULL OR v_payment_pattern = 'pay_in_advance' THEN RETURN; END IF;

  SELECT amount_etb, wht_amount, payment_state INTO v_old_amount, v_old_wht, v_expense_state
  FROM expenses WHERE id = v_expense_id;
  IF v_expense_state IS DISTINCT FROM 'unpaid' THEN RETURN; END IF;

  SELECT COALESCE(SUM(gi.quantity_rejected * COALESCE(sbi.unit_price_actual, 0)), 0)
    INTO v_rejected_total
  FROM goods_received_note_items gi
  JOIN sourcing_bundle_items sbi ON sbi.id = gi.sourcing_bundle_item_id
  WHERE sbi.bundle_id = p_bundle_id;

  IF v_closed_short IS NOT NULL THEN
    SELECT COALESCE(SUM(outstanding * COALESCE(unit_price_actual, 0)), 0) INTO v_short_total
    FROM v_bundle_line_receipts WHERE bundle_id = p_bundle_id;
  END IF;

  v_rejected_total := v_rejected_total + v_short_total;

  IF COALESCE(v_subtotal, 0) > 0 AND v_net IS NOT NULL AND v_net <> v_subtotal THEN
    v_rejected_total := ROUND(v_rejected_total * (v_net / v_subtotal), 2);
  END IF;

  v_delta := v_rejected_total - COALESCE(v_prior_deduction, 0);
  IF v_delta = 0 THEN RETURN; END IF;

  v_new_amount := GREATEST(v_old_amount - ROUND(v_delta * 1.15, 2), 0);
  v_billed_before := COALESCE(v_net, 0) - COALESCE(v_prior_deduction, 0);
  v_billed_after  := COALESCE(v_net, 0) - v_rejected_total;
  v_new_wht := CASE
    WHEN COALESCE(v_old_wht, 0) = 0 OR v_billed_before <= 0 THEN v_old_wht
    WHEN v_billed_after <= 20000 THEN NULL
    ELSE ROUND(v_old_wht * v_billed_after / v_billed_before, 2)
  END;

  UPDATE expenses
  SET amount_etb = v_new_amount,
      wht_amount = v_new_wht,
      notes = COALESCE(notes || E'\n', '') ||
        format('Auto-adjusted %s → %s ETB (incl. VAT): %s change in goods refused%s, not billed.%s',
               v_old_amount, v_new_amount, v_delta,
               CASE WHEN v_short_total > 0 THEN ' or never delivered (order closed short)' ELSE '' END,
               CASE WHEN v_new_wht IS DISTINCT FROM v_old_wht
                    THEN format(' WHT %s → %s.', COALESCE(v_old_wht, 0), COALESCE(v_new_wht, 0)) ELSE '' END)
  WHERE id = v_expense_id;

  UPDATE sourcing_bundles SET rejection_deduction_etb = v_rejected_total WHERE id = p_bundle_id;
END $function$;

CREATE OR REPLACE FUNCTION public.adjust_po_expense_for_rejected_qty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_bundle_id UUID;
BEGIN
  SELECT sbi.bundle_id INTO v_bundle_id
  FROM sourcing_bundle_items sbi
  WHERE sbi.id = COALESCE(NEW.sourcing_bundle_item_id, OLD.sourcing_bundle_item_id);
  IF v_bundle_id IS NOT NULL THEN PERFORM sync_po_expense_deduction(v_bundle_id); END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- Ordering still prepares a pay-in-advance expense; fulfilling now
-- prepares the pay-on-delivery one, files it under the ledgers the goods
-- were received into, and takes off what wasn't delivered.
CREATE OR REPLACE FUNCTION public.prepare_po_expense_on_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_expense  expenses%ROWTYPE;
  v_category uuid;
BEGIN
  IF NEW.status = 'ordered' AND NEW.payment_pattern = 'pay_in_advance' AND NEW.expense_id IS NULL
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.payment_pattern IS DISTINCT FROM NEW.payment_pattern) THEN
    PERFORM create_po_expense(NEW.id);
  END IF;

  IF NEW.status = 'fulfilled' AND OLD.status IS DISTINCT FROM 'fulfilled'
     AND NEW.payment_pattern IS DISTINCT FROM 'pay_in_advance'
     AND EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.sourcing_bundle_id = NEW.id) THEN
    PERFORM create_po_expense(NEW.id, COALESCE(NEW.fulfilled_at, now())::date);
    v_category := resolve_po_posting_category(NEW.id);
    IF v_category IS NOT NULL THEN
      UPDATE expenses SET category_id = v_category
       WHERE sourcing_bundle_id = NEW.id AND category_id IS NULL AND expense_type = 'purchase_order';
    END IF;
    PERFORM sync_po_expense_deduction(NEW.id);
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND NEW.expense_id IS NOT NULL THEN
    SELECT * INTO v_expense FROM expenses WHERE id = NEW.expense_id;
    IF v_expense.approval_status = 'pending' AND v_expense.payment_state = 'unpaid'
       AND NOT EXISTS (SELECT 1 FROM payment_requests pr WHERE pr.expense_id = v_expense.id)
       AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses bpe WHERE bpe.expense_id = v_expense.id)
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = v_expense.id) THEN
      BEGIN
        UPDATE sourcing_bundles SET expense_id = NULL WHERE id = NEW.id;
        DELETE FROM expenses WHERE id = v_expense.id;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- ── 5. Closing an order short ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_po_short(p_bundle_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'procurement_officer') THEN
    RAISE EXCEPTION 'Only procurement can close a purchase order short';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Say why the rest isn''t coming';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sourcing_bundles WHERE id = p_bundle_id AND status = 'ordered') THEN
    RAISE EXCEPTION 'Only an order still waiting for goods can be closed short';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM goods_received_notes WHERE sourcing_bundle_id = p_bundle_id) THEN
    RAISE EXCEPTION 'Nothing has been received on this order — cancel it instead';
  END IF;
  IF EXISTS (SELECT 1 FROM site_delivery_notes WHERE sourcing_bundle_id = p_bundle_id AND status IN ('issued', 'exceptions')) THEN
    RAISE EXCEPTION 'A site delivery note on this order is still open — finish or cancel it first';
  END IF;

  UPDATE sourcing_bundles
     SET closed_short_at = now(), closed_short_by = auth.uid(), closed_short_reason = btrim(p_reason),
         status = 'fulfilled', fulfilled_at = now()
   WHERE id = p_bundle_id;
  -- The status change prepares a pay-on-delivery expense and syncs the
  -- deduction; an existing one (pay in advance) is left to finance.
  PERFORM sync_po_expense_deduction(p_bundle_id);
END $function$;

-- ── 6. Undoing a GRN reopens the order when something is outstanding ─
CREATE OR REPLACE FUNCTION public.undo_grn_fulfillment(p_grn_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_bundle_id UUID;
  v_sdn_id    UUID;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'stock_manager', 'logistics_officer') THEN
    RAISE EXCEPTION 'Not authorized to undo a goods received note';
  END IF;

  SELECT sourcing_bundle_id, site_delivery_note_id INTO v_bundle_id, v_sdn_id FROM goods_received_notes WHERE id = p_grn_id;
  IF v_bundle_id IS NULL THEN
    RAISE EXCEPTION 'GRN not found';
  END IF;

  DELETE FROM goods_received_notes WHERE id = p_grn_id;

  -- A GRN written from a signed SDN goes back to procurement to confirm.
  IF v_sdn_id IS NOT NULL THEN
    UPDATE site_delivery_notes SET status = 'exceptions', grn_id = NULL, confirmed_by = NULL, confirmed_at = NULL
     WHERE id = v_sdn_id;
  END IF;

  UPDATE sourcing_bundles
     SET status = 'ordered', fulfilled_at = NULL,
         closed_short_at = NULL, closed_short_by = NULL, closed_short_reason = NULL
   WHERE id = v_bundle_id AND status = 'fulfilled'
     AND (NOT EXISTS (SELECT 1 FROM goods_received_notes WHERE sourcing_bundle_id = v_bundle_id)
          OR EXISTS (SELECT 1 FROM v_bundle_line_receipts WHERE bundle_id = v_bundle_id AND outstanding > 0));
END $function$;

-- ── 7. Returning refused goods ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_grn_items_returned(p_item_ids uuid[], p_reference text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_count integer;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'procurement_officer', 'stock_manager', 'logistics_officer') THEN
    RAISE EXCEPTION 'Not authorized to record a return';
  END IF;
  UPDATE goods_received_note_items
     SET return_status = 'returned', returned_at = now(), returned_by = auth.uid(),
         return_reference = NULLIF(btrim(p_reference), '')
   WHERE id = ANY(p_item_ids) AND return_status = 'to_return';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;

-- ── 8. Site Delivery Notes ───────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS sdn_seq;

CREATE TABLE IF NOT EXISTS site_delivery_notes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdn_code                  text UNIQUE,
  sourcing_bundle_id        uuid NOT NULL REFERENCES sourcing_bundles(id) ON DELETE CASCADE,
  project_id                uuid NOT NULL REFERENCES projects(id),
  transportation_request_id uuid REFERENCES transportation_requests(id) ON DELETE SET NULL,
  status                    text NOT NULL DEFAULT 'issued'
                            CHECK (status IN ('issued', 'exceptions', 'received', 'cancelled')),
  -- Snapshot of the order at issue, so the site sees the document as sent.
  bundle_code               text,
  vendor_name               text,
  project_name              text,
  vendor_delivery_ref       text,
  driver_name               text,
  vehicle_plate             text,
  expected_on               date,
  notes                     text,
  issued_by                 uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  issued_by_name            text,
  issued_at                 timestamptz NOT NULL DEFAULT now(),
  signed_by                 uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  signed_by_name            text,
  signed_at                 timestamptz,
  sign_notes                text,
  sign_lat                  double precision,
  sign_lng                  double precision,
  photos                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  grn_id                    uuid REFERENCES goods_received_notes(id) ON DELETE SET NULL,
  confirmed_by              uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  confirmed_at              timestamptz,
  confirm_notes             text,
  cancelled_reason          text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE site_delivery_notes IS
  'Goods sent to a site, signed for there by the project manager (371). A clean signature writes the GRN; anything short, damaged or refused waits for procurement to confirm.';

-- One delivery, one note: a single open SDN per order and site, and a
-- transport job carries at most one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sdn_open_per_bundle_site
  ON site_delivery_notes (sourcing_bundle_id, project_id) WHERE status = 'issued';
CREATE UNIQUE INDEX IF NOT EXISTS uq_sdn_per_transport_job
  ON site_delivery_notes (transportation_request_id)
  WHERE transportation_request_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_sdn_project_status ON site_delivery_notes (project_id, status);
CREATE INDEX IF NOT EXISTS idx_sdn_bundle ON site_delivery_notes (sourcing_bundle_id);

DO $$ BEGIN
  ALTER TABLE goods_received_notes ADD CONSTRAINT goods_received_notes_sdn_fkey
    FOREIGN KEY (site_delivery_note_id) REFERENCES site_delivery_notes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS site_delivery_note_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdn_id                  uuid NOT NULL REFERENCES site_delivery_notes(id) ON DELETE CASCADE,
  sourcing_bundle_item_id uuid NOT NULL REFERENCES sourcing_bundle_items(id) ON DELETE CASCADE,
  item_name               text,
  unit                    text,
  quantity_sent           numeric NOT NULL CHECK (quantity_sent > 0),
  quantity_received       numeric,
  quantity_damaged        numeric NOT NULL DEFAULT 0,
  quantity_rejected       numeric NOT NULL DEFAULT 0,
  notes                   text,
  sort_order              integer NOT NULL DEFAULT 0,
  UNIQUE (sdn_id, sourcing_bundle_item_id),
  CHECK (quantity_damaged >= 0 AND quantity_rejected >= 0),
  CHECK (quantity_received IS NULL OR (quantity_received >= 0 AND quantity_damaged + quantity_rejected <= quantity_received))
);
CREATE INDEX IF NOT EXISTS idx_sdn_items_bundle_item ON site_delivery_note_items (sourcing_bundle_item_id);

CREATE OR REPLACE FUNCTION public.set_sdn_code()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.sdn_code IS NULL THEN
    NEW.sdn_code := 'SDN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sdn_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_set_sdn_code ON site_delivery_notes;
CREATE TRIGGER trg_set_sdn_code BEFORE INSERT ON site_delivery_notes FOR EACH ROW EXECUTE FUNCTION set_sdn_code();
DROP TRIGGER IF EXISTS trg_sdn_updated_at ON site_delivery_notes;
CREATE TRIGGER trg_sdn_updated_at BEFORE UPDATE ON site_delivery_notes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Who sends goods to site: procurement, or logistics (role or badge).
CREATE OR REPLACE FUNCTION public.can_issue_site_delivery()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'executive', 'procurement_officer', 'logistics_officer'), false)
      OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer);
$function$;

ALTER TABLE site_delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_delivery_note_items ENABLE ROW LEVEL SECURITY;

-- Reads only; every write goes through the functions below.
DROP POLICY IF EXISTS sdn_read ON site_delivery_notes;
CREATE POLICY sdn_read ON site_delivery_notes FOR SELECT USING (
  can_issue_site_delivery()
  OR COALESCE(get_user_role() IN ('finance', 'stock_manager', 'operations_manager'), false)
  OR manages_project(project_id)
);
DROP POLICY IF EXISTS sdn_items_read ON site_delivery_note_items;
CREATE POLICY sdn_items_read ON site_delivery_note_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM site_delivery_notes s WHERE s.id = sdn_id)
);

-- Outstanding per line, net of anything already on its way on another
-- SDN that hasn't turned into a GRN yet.
CREATE OR REPLACE FUNCTION public.bundle_item_available_to_send(p_bundle_item_id uuid, p_except_sdn uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT GREATEST(
    COALESCE((SELECT outstanding FROM v_bundle_line_receipts WHERE bundle_item_id = p_bundle_item_id), 0)
    - COALESCE((SELECT sum(i.quantity_sent) FROM site_delivery_note_items i
                JOIN site_delivery_notes s ON s.id = i.sdn_id
                WHERE i.sourcing_bundle_item_id = p_bundle_item_id
                  AND s.status IN ('issued', 'exceptions')
                  AND s.id IS DISTINCT FROM p_except_sdn), 0),
    0);
$function$;

-- p_lines: [{"bundle_item_id": uuid, "quantity": number}]
CREATE OR REPLACE FUNCTION public.issue_site_delivery_note(
  p_bundle_id uuid, p_project_id uuid, p_lines jsonb,
  p_transport_id uuid DEFAULT NULL, p_vendor_ref text DEFAULT NULL,
  p_driver_name text DEFAULT NULL, p_vehicle_plate text DEFAULT NULL,
  p_expected_on date DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  b        sourcing_bundles%ROWTYPE;
  v_sdn    uuid;
  v_line   jsonb;
  v_item   uuid;
  v_qty    numeric;
  v_avail  numeric;
  v_name   text;
  v_unit   text;
  v_proj   uuid;
  v_sort   integer;
  v_n      integer := 0;
  v_tr_bundle uuid;
BEGIN
  IF NOT can_issue_site_delivery() THEN
    RAISE EXCEPTION 'Only procurement or logistics can issue a site delivery note';
  END IF;

  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle_id;
  IF NOT FOUND OR b.status <> 'ordered' THEN
    RAISE EXCEPTION 'Goods can only be sent against a purchase order that is ordered and still waiting for them';
  END IF;

  IF EXISTS (SELECT 1 FROM site_delivery_notes WHERE sourcing_bundle_id = p_bundle_id AND project_id = p_project_id AND status = 'issued') THEN
    RAISE EXCEPTION 'This order already has a delivery note on its way to that site — wait for it to be signed, or cancel it';
  END IF;

  IF p_transport_id IS NOT NULL THEN
    SELECT sourcing_bundle_id INTO v_tr_bundle FROM transportation_requests WHERE id = p_transport_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transport job not found'; END IF;
    IF v_tr_bundle IS NOT NULL AND v_tr_bundle <> p_bundle_id THEN
      RAISE EXCEPTION 'That transport job belongs to another purchase order';
    END IF;
    IF EXISTS (SELECT 1 FROM site_delivery_notes WHERE transportation_request_id = p_transport_id AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'That transport job already carries a delivery note';
    END IF;
  END IF;

  INSERT INTO site_delivery_notes (
    sourcing_bundle_id, project_id, transportation_request_id,
    bundle_code, vendor_name, project_name,
    vendor_delivery_ref, driver_name, vehicle_plate, expected_on, notes,
    issued_by, issued_by_name)
  VALUES (
    p_bundle_id, p_project_id, p_transport_id,
    b.bundle_code, COALESCE((SELECT vendor_name FROM vendors WHERE id = b.vendor_id), b.vendor_name),
    (SELECT project_name FROM projects WHERE id = p_project_id),
    NULLIF(btrim(p_vendor_ref), ''), NULLIF(btrim(p_driver_name), ''), NULLIF(btrim(p_vehicle_plate), ''),
    p_expected_on, NULLIF(btrim(p_notes), ''),
    auth.uid(), (SELECT full_name FROM user_profiles WHERE id = auth.uid()))
  RETURNING id INTO v_sdn;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_item := (v_line->>'bundle_item_id')::uuid;
    v_qty  := (v_line->>'quantity')::numeric;
    CONTINUE WHEN v_qty IS NULL OR v_qty <= 0;

    SELECT oi.item_name, oi.unit, o.project_id, sbi.sort_order INTO v_name, v_unit, v_proj, v_sort
    FROM sourcing_bundle_items sbi
    LEFT JOIN order_items oi ON oi.id = sbi.order_item_id
    LEFT JOIN orders o ON o.id = oi.order_id
    WHERE sbi.id = v_item AND sbi.bundle_id = p_bundle_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'A line isn''t on this purchase order'; END IF;
    IF v_proj IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION '% was requested for another site', v_name;
    END IF;

    v_avail := bundle_item_available_to_send(v_item, v_sdn);
    IF v_qty > v_avail THEN
      RAISE EXCEPTION 'Only % % of % is still to be delivered', v_avail, COALESCE(v_unit, ''), v_name;
    END IF;

    INSERT INTO site_delivery_note_items (sdn_id, sourcing_bundle_item_id, item_name, unit, quantity_sent, sort_order)
    VALUES (v_sdn, v_item, v_name, v_unit, v_qty, COALESCE(v_sort, 0));
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN RAISE EXCEPTION 'Put at least one line on the delivery note'; END IF;
  RETURN v_sdn;
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_site_delivery_note(p_sdn_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT can_issue_site_delivery() THEN
    RAISE EXCEPTION 'Only procurement or logistics can cancel a site delivery note';
  END IF;
  UPDATE site_delivery_notes SET status = 'cancelled', cancelled_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_sdn_id AND status IN ('issued', 'exceptions');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a delivery note that hasn''t been received can be cancelled'; END IF;
END $function$;

-- Writes the GRN for an SDN from the figures on its lines. Lines where
-- nothing arrived are left off: they stay outstanding on the order.
CREATE OR REPLACE FUNCTION public.grn_from_site_delivery_note(p_sdn_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s     site_delivery_notes%ROWTYPE;
  v_grn uuid;
BEGIN
  SELECT * INTO s FROM site_delivery_notes WHERE id = p_sdn_id FOR UPDATE;
  IF s.grn_id IS NOT NULL THEN RETURN s.grn_id; END IF;

  INSERT INTO goods_received_notes (
    sourcing_bundle_id, transportation_request_id, received_by, received_at, notes,
    photo_url, photo_name, photos, site_delivery_note_id, delivery_note_ref, driver_name, vehicle_plate)
  VALUES (
    s.sourcing_bundle_id, s.transportation_request_id, s.signed_by, COALESCE(s.signed_at, now()),
    concat_ws(E'\n', 'Signed on site: ' || s.sdn_code || COALESCE(' by ' || s.signed_by_name, ''), s.sign_notes, s.confirm_notes),
    s.photos->0->>'url', s.photos->0->>'name', s.photos, s.id, s.vendor_delivery_ref, s.driver_name, s.vehicle_plate)
  RETURNING id INTO v_grn;

  INSERT INTO goods_received_note_items (
    grn_id, sourcing_bundle_item_id, quantity_received, quantity_rejected, quantity_damaged, condition_notes, category_id)
  SELECT v_grn, i.sourcing_bundle_item_id, i.quantity_received, i.quantity_rejected, i.quantity_damaged, i.notes,
         sc.parent_category_id
  FROM site_delivery_note_items i
  JOIN sourcing_bundle_items sbi ON sbi.id = i.sourcing_bundle_item_id
  LEFT JOIN order_items oi ON oi.id = sbi.order_item_id
  LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
  WHERE i.sdn_id = p_sdn_id AND COALESCE(i.quantity_received, 0) > 0
  ORDER BY i.sort_order;

  UPDATE site_delivery_notes SET grn_id = v_grn, status = 'received' WHERE id = p_sdn_id;

  -- Proof of delivery closes the transport job that carried it.
  IF s.transportation_request_id IS NOT NULL THEN
    UPDATE transportation_requests
       SET job_status = 'completed',
           actual_delivery_date = COALESCE(actual_delivery_date, COALESCE(s.signed_at, now())::date)
     WHERE id = s.transportation_request_id AND job_status IN ('requested', 'assigned', 'in_progress');
  END IF;

  RETURN v_grn;
END $function$;

-- The project manager's signature.
-- p_lines: [{"id": sdn item id, "received": n, "damaged": n, "rejected": n, "notes": text}]
-- p_photos: [{"url": text, "name": text}] — at least one.
CREATE OR REPLACE FUNCTION public.sign_site_delivery_note(
  p_sdn_id uuid, p_lines jsonb, p_photos jsonb,
  p_notes text DEFAULT NULL, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s       site_delivery_notes%ROWTYPE;
  v_line  jsonb;
  v_clean boolean;
BEGIN
  SELECT * INTO s FROM site_delivery_notes WHERE id = p_sdn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery note not found'; END IF;
  IF NOT (manages_project(s.project_id) OR COALESCE(get_user_role() = 'admin', false)) THEN
    RAISE EXCEPTION 'Only the project manager of % can sign for this delivery', COALESCE(s.project_name, 'this site');
  END IF;
  IF s.status <> 'issued' THEN RAISE EXCEPTION 'This delivery note has already been signed or cancelled'; END IF;
  IF jsonb_typeof(p_photos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_photos) = 0 THEN
    RAISE EXCEPTION 'Add at least one photo of the delivery';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    UPDATE site_delivery_note_items
       SET quantity_received = (v_line->>'received')::numeric,
           quantity_damaged  = COALESCE((v_line->>'damaged')::numeric, 0),
           quantity_rejected = COALESCE((v_line->>'rejected')::numeric, 0),
           notes             = NULLIF(btrim(v_line->>'notes'), '')
     WHERE id = (v_line->>'id')::uuid AND sdn_id = p_sdn_id;
  END LOOP;

  IF EXISTS (SELECT 1 FROM site_delivery_note_items WHERE sdn_id = p_sdn_id AND quantity_received IS NULL) THEN
    RAISE EXCEPTION 'Count every line before signing';
  END IF;
  IF EXISTS (SELECT 1 FROM site_delivery_note_items WHERE sdn_id = p_sdn_id AND quantity_received > quantity_sent) THEN
    RAISE EXCEPTION 'More arrived than was sent on a line — record the extra with procurement instead';
  END IF;

  SELECT bool_and(quantity_received = quantity_sent AND quantity_damaged = 0 AND quantity_rejected = 0)
    INTO v_clean FROM site_delivery_note_items WHERE sdn_id = p_sdn_id;

  UPDATE site_delivery_notes
     SET signed_by = auth.uid(), signed_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()),
         signed_at = now(), sign_notes = NULLIF(btrim(p_notes), ''),
         sign_lat = p_lat, sign_lng = p_lng, photos = p_photos,
         status = CASE WHEN v_clean THEN 'received' ELSE 'exceptions' END
   WHERE id = p_sdn_id;

  IF v_clean THEN
    PERFORM grn_from_site_delivery_note(p_sdn_id);
    RETURN 'received';
  END IF;
  RETURN 'exceptions';
END $function$;

-- Procurement settles a delivery that came in short, damaged or refused.
-- p_lines (optional) corrects the site's figures, same shape as signing.
CREATE OR REPLACE FUNCTION public.confirm_site_delivery_note(p_sdn_id uuid, p_lines jsonb DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  s      site_delivery_notes%ROWTYPE;
  v_line jsonb;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'procurement_officer') THEN
    RAISE EXCEPTION 'Only procurement can confirm a delivery with exceptions';
  END IF;
  SELECT * INTO s FROM site_delivery_notes WHERE id = p_sdn_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'exceptions' THEN
    RAISE EXCEPTION 'Only a signed delivery with exceptions waits for confirmation';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    UPDATE site_delivery_note_items
       SET quantity_received = (v_line->>'received')::numeric,
           quantity_damaged  = COALESCE((v_line->>'damaged')::numeric, 0),
           quantity_rejected = COALESCE((v_line->>'rejected')::numeric, 0),
           notes             = COALESCE(NULLIF(btrim(v_line->>'notes'), ''), notes)
     WHERE id = (v_line->>'id')::uuid AND sdn_id = p_sdn_id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM site_delivery_note_items WHERE sdn_id = p_sdn_id AND quantity_received > quantity_sent) THEN
    RAISE EXCEPTION 'A line can''t receive more than was sent';
  END IF;

  UPDATE site_delivery_notes SET confirmed_by = auth.uid(), confirmed_at = now(), confirm_notes = NULLIF(btrim(p_notes), '')
   WHERE id = p_sdn_id;
  RETURN grn_from_site_delivery_note(p_sdn_id);
END $function$;

GRANT EXECUTE ON FUNCTION issue_site_delivery_note(uuid, uuid, jsonb, uuid, text, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION sign_site_delivery_note(uuid, jsonb, jsonb, text, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_site_delivery_note(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_site_delivery_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION close_po_short(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_grn_items_returned(uuid[], text) TO authenticated;
REVOKE EXECUTE ON FUNCTION grn_from_site_delivery_note(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION refresh_bundle_receipt(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_po_expense_deduction(uuid) FROM PUBLIC, anon, authenticated;

-- ── 9. Project managers see their projects' GRNs ─────────────────────
CREATE OR REPLACE FUNCTION public.bundle_touches_my_projects(p_bundle_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = p_bundle_id AND manages_project(o.project_id));
$function$;

DROP POLICY IF EXISTS grn_read_project_manager ON goods_received_notes;
CREATE POLICY grn_read_project_manager ON goods_received_notes FOR SELECT
  USING (bundle_touches_my_projects(sourcing_bundle_id));
DROP POLICY IF EXISTS grn_items_read_project_manager ON goods_received_note_items;
CREATE POLICY grn_items_read_project_manager ON goods_received_note_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.id = grn_id AND bundle_touches_my_projects(g.sourcing_bundle_id)));

-- ── 10. Register and vendor delivery figures ─────────────────────────
CREATE OR REPLACE VIEW public.v_grn_register WITH (security_invoker = true) AS
SELECT g.id,
    g.grn_code,
    g.received_at,
    g.sourcing_bundle_id,
    sb.bundle_code,
    COALESCE(v.vendor_name, sb.vendor_name) AS vendor_name,
    g.received_by,
    up.full_name AS received_by_name,
    g.photo_url,
    g.notes,
    count(gi.id) AS line_count,
    COALESCE(sum(gi.quantity_received), 0::numeric) AS total_quantity_received,
    count(*) FILTER (WHERE gi.quantity_damaged > 0::numeric) AS damaged_lines,
    count(*) FILTER (WHERE gi.quantity_rejected > 0::numeric) AS rejected_lines,
    CASE
        WHEN count(*) FILTER (WHERE gi.quality_status = 'rejected'::text) > 0 THEN 'rejected'::text
        WHEN count(*) FILTER (WHERE gi.quality_status = 'partial'::text) > 0 THEN 'partial'::text
        WHEN count(*) FILTER (WHERE gi.quality_status = 'damaged'::text) > 0 THEN 'damaged'::text
        ELSE 'accepted'::text
    END AS worst_quality,
    string_agg(DISTINCT c.category_name, ', '::text ORDER BY c.category_name) AS ledgers,
    COALESCE(sum(gi.quantity_accepted), 0::numeric) AS total_quantity_accepted,
    COALESCE(sum(gi.quantity_rejected), 0::numeric) AS total_quantity_rejected,
    COALESCE(sum(gi.quantity_damaged), 0::numeric) AS total_quantity_damaged,
    sb.vendor_id,
    g.delivery_note_ref,
    g.site_delivery_note_id,
    (SELECT s.sdn_code FROM site_delivery_notes s WHERE s.id = g.site_delivery_note_id) AS sdn_code,
    (SELECT string_agg(DISTINCT p.project_name, ', ')
       FROM goods_received_note_items gi2
       JOIN sourcing_bundle_items sbi ON sbi.id = gi2.sourcing_bundle_item_id
       JOIN order_items oi ON oi.id = sbi.order_item_id
       JOIN orders o ON o.id = oi.order_id
       JOIN projects p ON p.id = o.project_id
      WHERE gi2.grn_id = g.id) AS project_names,
    count(*) FILTER (WHERE gi.return_status = 'to_return') AS lines_to_return,
    jsonb_array_length(g.photos) AS photo_count
FROM goods_received_notes g
    LEFT JOIN goods_received_note_items gi ON gi.grn_id = g.id
    LEFT JOIN sourcing_bundles sb ON sb.id = g.sourcing_bundle_id
    LEFT JOIN vendors v ON v.id = sb.vendor_id
    LEFT JOIN user_profiles up ON up.id = g.received_by
    LEFT JOIN categories c ON c.id = gi.category_id
GROUP BY g.id, g.grn_code, g.received_at, g.sourcing_bundle_id, sb.bundle_code, v.vendor_name, sb.vendor_name,
         g.received_by, up.full_name, g.photo_url, g.notes, sb.vendor_id, g.delivery_note_ref, g.site_delivery_note_id, g.photos;

-- On time means the whole order arrived by the date promised.
CREATE OR REPLACE VIEW public.v_vendor_po_delivery WITH (security_invoker = on) AS
SELECT b.id AS bundle_id,
    b.vendor_id,
    b.bundle_code,
    (b.status)::text AS status,
    b.total_value,
    b.ordered_at,
    b.expected_delivery_date,
    g.first_received_at,
    CASE
        WHEN b.expected_delivery_date IS NOT NULL AND b.status = 'fulfilled' AND g.last_received_at IS NOT NULL
          THEN (g.last_received_at)::date - b.expected_delivery_date
        ELSE NULL::integer
    END AS days_late,
    ((b.status)::text = 'ordered'::text AND b.expected_delivery_date < CURRENT_DATE) AS overdue,
    COALESCE(q.qty_received, 0::numeric) AS qty_received,
    COALESCE(q.qty_rejected, 0::numeric) AS qty_rejected,
    COALESCE(q.qty_damaged, 0::numeric) AS qty_damaged,
    g.last_received_at,
    g.delivery_count,
    b.closed_short_at IS NOT NULL AS closed_short
FROM sourcing_bundles b
    LEFT JOIN LATERAL ( SELECT min(n.received_at) AS first_received_at, max(n.received_at) AS last_received_at,
                               count(*) AS delivery_count
           FROM goods_received_notes n
          WHERE n.sourcing_bundle_id = b.id) g ON true
    LEFT JOIN LATERAL ( SELECT sum(i.quantity_received) AS qty_received,
            sum(i.quantity_rejected) AS qty_rejected,
            sum(i.quantity_damaged) AS qty_damaged
           FROM goods_received_notes n
             JOIN goods_received_note_items i ON i.grn_id = n.id
          WHERE n.sourcing_bundle_id = b.id) q ON true
WHERE b.vendor_id IS NOT NULL AND (b.status)::text <> ALL (ARRAY['drafting'::text, 'cancelled'::text]);
