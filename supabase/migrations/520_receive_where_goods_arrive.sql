-- 520 — Goods are received when Kuncho collects them
--
-- What the records showed (16 Nov 2026):
--   * 273 purchase orders were "ordered" with goods never recorded (ETB 27M);
--     177 of them more than 30 days old, ETB 15.1M of it paid in advance.
--   * All 98 receipts ever recorded were typed by one admin, in batches. The
--     buyer, who holds 229 of the 273 orders, was not allowed to record one.
--   * Kuncho mostly collects the goods itself, and nobody fixed meets them at
--     the site. So the moment someone stands with the goods and can count them
--     is the collection, and that person is the buyer.
--
-- So:
--   1. The buyer records what was collected, from the phone, with a photo
--      (record_collection). A receipt needs a photo unless an admin types it.
--   2. The site manager is told the goods are on their way and has three days
--      to say something didn't arrive, was short or damaged
--      (report_receipt_problem); procurement answers (resolve_receipt_problem).
--   3. An order says how the goods come: we collect, or the vendor delivers on
--      a date (delivery_mode, set_po_delivery).
--   4. One message a morning to each buyer: orders bought and not marked
--      collected, the money paid ahead on them, vendor deliveries due, and
--      problems the sites reported (goods_nudge_daily).
--   5. Finance sees a vendor's unreceived advances before approving another
--      (vendor_open_advances).
--   6. The backlog: every open order whose payment a bank statement confirms
--      is marked received in full, dated the bank date. What was for the
--      warehouse is added to stock and listed for the next stock count. The
--      rest stays open on the buyer's list, to collect or cancel.

-- ── 1. How the goods come ─────────────────────────────────────────────────
ALTER TABLE public.sourcing_bundles
  ADD COLUMN IF NOT EXISTS delivery_mode text CHECK (delivery_mode IN ('collect', 'vendor_delivers'));
COMMENT ON COLUMN public.sourcing_bundles.delivery_mode IS
  'collect: Kuncho picks the goods up on expected_delivery_date. vendor_delivers: the vendor brings them on that date. NULL on orders placed before 520 (read as collect).';

-- A receipt catalogues goods it has not seen before, and their code was cut
-- to three digits: number 1001 came out as STK-100, which already exists, and
-- the receipt failed. Numbers past 999 now keep every digit.
CREATE OR REPLACE FUNCTION public.generate_stock_item_code()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  prefix TEXT;
  seq_name TEXT;
  seq_num BIGINT;
BEGIN
  prefix   := CASE NEW.main_category
    WHEN 'wood_work'    THEN 'WW'
    WHEN 'electrical'   THEN 'EL'
    WHEN 'painting'     THEN 'PT'
    WHEN 'hardware'     THEN 'HW'
    WHEN 'construction' THEN 'CM'
    WHEN 'tools'        THEN 'TL'
    WHEN 'booth_return' THEN 'BR'
    ELSE 'STK'
  END;
  seq_name := CASE NEW.main_category
    WHEN 'wood_work'    THEN 'stock_seq_ww'
    WHEN 'electrical'   THEN 'stock_seq_el'
    WHEN 'painting'     THEN 'stock_seq_pt'
    WHEN 'hardware'     THEN 'stock_seq_hw'
    WHEN 'construction' THEN 'stock_seq_cm'
    WHEN 'tools'        THEN 'stock_seq_tl'
    WHEN 'booth_return' THEN 'stock_seq_br'
    ELSE 'stock_seq_stk'
  END;
  seq_num := nextval(seq_name);
  NEW.item_code := prefix || '-' || LPAD(seq_num::TEXT, GREATEST(3, length(seq_num::TEXT)), '0');
  RETURN NEW;
END;
$function$;

-- What was received on a line, an order's receipts, and a payment the bank
-- shows are looked up on every receipt; none had an index.
CREATE INDEX IF NOT EXISTS grn_items_bundle_item ON public.goods_received_note_items (sourcing_bundle_item_id);
CREATE INDEX IF NOT EXISTS grn_items_grn ON public.goods_received_note_items (grn_id);
CREATE INDEX IF NOT EXISTS grn_bundle ON public.goods_received_notes (sourcing_bundle_id);
CREATE INDEX IF NOT EXISTS bank_lines_matched_expense ON public.bank_statement_lines (matched_expense_id) WHERE matched_expense_id IS NOT NULL;

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order) VALUES
  ('goods.waiting', 'Purchasing', 'Goods waiting on you', 'One message a morning: orders not marked collected, vendor deliveries due, problems the sites reported', 'high', 28),
  ('goods.problem', 'Purchasing', 'A problem with goods received', 'A site says goods did not arrive, were short or damaged, and the answer', 'high', 29)
ON CONFLICT (kind) DO UPDATE SET grp = EXCLUDED.grp, label = EXCLUDED.label, description = EXCLUDED.description;

-- ── 2. Who records what came: the buyer too ───────────────────────────────
CREATE OR REPLACE FUNCTION public.can_receive_goods()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE((SELECT get_user_role())::text IN ('admin', 'procurement_officer', 'logistics_officer', 'stock_manager'), false)
      OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer)
$f$;
REVOKE EXECUTE ON FUNCTION public.can_receive_goods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_receive_goods() TO authenticated;

ALTER POLICY grn_insert ON public.goods_received_notes WITH CHECK (can_receive_goods());
ALTER POLICY grn_items_insert ON public.goods_received_note_items WITH CHECK (can_receive_goods());

-- A receipt someone types carries a photo of the goods or the vendor's
-- receipt. Notes signed at a site carry theirs; an admin may type one without.
CREATE OR REPLACE FUNCTION public.trg_grn_needs_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.site_delivery_note_id IS NULL
     AND COALESCE(get_user_role()::text, '') <> 'admin'
     AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(NEW.photos) = 'array' THEN NEW.photos END), 0) = 0
     AND NEW.photo_url IS NULL THEN
    RAISE EXCEPTION 'Add a photo of the goods or the vendor''s receipt';
  END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_grn_needs_photo BEFORE INSERT ON public.goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION public.trg_grn_needs_photo();

-- What was collected, in one step from the phone. Lines are
-- [{id: sourcing_bundle_item_id, received, damaged, note}]; the ledger comes
-- from the request line, as the full form fills it in, or else from the
-- order's expense (most request lines carry none).
CREATE OR REPLACE FUNCTION public.record_collection(
  p_bundle uuid, p_lines jsonb, p_photos jsonb, p_notes text DEFAULT NULL, p_vendor_receipt text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE b sourcing_bundles%ROWTYPE; v_grn uuid; v_bad text;
BEGIN
  IF NOT can_receive_goods() THEN
    RAISE EXCEPTION 'Only procurement, logistics or the store can record what was collected';
  END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF b.status <> 'ordered' THEN RAISE EXCEPTION 'Only an order waiting for goods can be marked collected'; END IF;
  IF jsonb_typeof(p_photos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_photos) = 0 THEN
    RAISE EXCEPTION 'Add a photo of the goods or the vendor''s receipt';
  END IF;

  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE COALESCE((x->>'received')::numeric, 0) > 0) THEN
    RAISE EXCEPTION 'Enter what was collected on at least one line';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE COALESCE((x->>'received')::numeric, 0) > 0
                AND NOT EXISTS (SELECT 1 FROM sourcing_bundle_items i WHERE i.id = (x->>'id')::uuid AND i.bundle_id = p_bundle)) THEN
    RAISE EXCEPTION 'A line is not on this order';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE COALESCE((x->>'received')::numeric, 0) < 0 OR COALESCE((x->>'damaged')::numeric, 0) < 0
                 OR COALESCE((x->>'damaged')::numeric, 0) > COALESCE((x->>'received')::numeric, 0)) THEN
    RAISE EXCEPTION 'Damaged is part of what was collected, so it can''t be more than that';
  END IF;
  SELECT string_agg(r.item_name, ', ') INTO v_bad
    FROM jsonb_array_elements(p_lines) x JOIN v_bundle_line_receipts r ON r.bundle_item_id = (x->>'id')::uuid
   WHERE r.bundle_id = p_bundle AND COALESCE((x->>'received')::numeric, 0) > r.outstanding;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'More than is still to come on: %', v_bad; END IF;

  INSERT INTO goods_received_notes (sourcing_bundle_id, received_by, received_at, notes, photos, photo_url, photo_name,
                                    delivery_note_ref, transportation_request_id)
  VALUES (p_bundle, auth.uid(), now(), NULLIF(btrim(p_notes), ''), p_photos, p_photos->0->>'url', p_photos->0->>'name',
          NULLIF(btrim(p_vendor_receipt), ''),
          (SELECT t.id FROM transportation_requests t WHERE t.sourcing_bundle_id = p_bundle
              AND t.job_status IN ('requested', 'assigned', 'in_progress') ORDER BY t.created_at DESC LIMIT 1))
  RETURNING id INTO v_grn;

  INSERT INTO goods_received_note_items (grn_id, sourcing_bundle_item_id, quantity_received, quantity_rejected, quantity_damaged, condition_notes, category_id)
  SELECT v_grn, i.id, (x->>'received')::numeric, 0, COALESCE((x->>'damaged')::numeric, 0), NULLIF(btrim(x->>'note'), ''),
         COALESCE(sc.parent_category_id, (SELECT e.category_id FROM expenses e WHERE e.id = b.expense_id))
    FROM jsonb_array_elements(p_lines) x
    JOIN sourcing_bundle_items i ON i.id = (x->>'id')::uuid AND i.bundle_id = p_bundle
    LEFT JOIN order_items oi ON oi.id = i.order_item_id
    LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
   WHERE COALESCE((x->>'received')::numeric, 0) > 0;
  RETURN v_grn;
END $f$;
REVOKE EXECUTE ON FUNCTION public.record_collection(uuid, jsonb, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_collection(uuid, jsonb, jsonb, text, text) TO authenticated;

-- How and when the goods come, changeable while the order waits for them.
CREATE OR REPLACE FUNCTION public.enforce_bundle_drafting_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_status sourcing_bundle_status;
  v_relink boolean := COALESCE(current_setting('kuncho.vendor_relink', true), '') = 'on';
  v_delivery boolean := COALESCE(current_setting('kuncho.delivery_edit', true), '') = 'on';
BEGIN
  v_status := COALESCE(OLD.status, 'drafting');
  IF TG_OP = 'DELETE' THEN
    IF v_status != 'drafting' THEN
      RAISE EXCEPTION 'Cannot delete a sourcing bundle once it has left drafting (current: %)', v_status;
    END IF;
    RETURN OLD;
  END IF;
  IF v_status != 'drafting' AND NEW.status = OLD.status
     AND ((NEW.vendor_id IS DISTINCT FROM OLD.vendor_id AND NOT v_relink)
       OR NEW.vendor_name IS DISTINCT FROM OLD.vendor_name
       OR (NEW.expected_delivery_date IS DISTINCT FROM OLD.expected_delivery_date AND NOT v_delivery)
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.procurement_officer_id IS DISTINCT FROM OLD.procurement_officer_id
       OR NEW.discount_kind IS DISTINCT FROM OLD.discount_kind
       OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
       OR NEW.discount_reason IS DISTINCT FROM OLD.discount_reason) THEN
    RAISE EXCEPTION 'Cannot edit a sourcing bundle once it has left drafting (current: %)', v_status;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_po_delivery(p_bundle uuid, p_mode text, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE b sourcing_bundles%ROWTYPE;
BEGIN
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT (COALESCE(get_user_role()::text IN ('admin', 'executive', 'procurement_officer', 'operations_manager'), false)
          OR b.procurement_officer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only procurement can change how and when the goods come';
  END IF;
  IF b.status NOT IN ('approved', 'ordered') THEN RAISE EXCEPTION 'Only an order still waiting for its goods can change this'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('collect', 'vendor_delivers') THEN RAISE EXCEPTION 'Say whether we collect it or the vendor delivers'; END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'Say on which day'; END IF;
  PERFORM set_config('kuncho.delivery_edit', 'on', true);
  UPDATE sourcing_bundles SET delivery_mode = p_mode, expected_delivery_date = p_date WHERE id = p_bundle;
  PERFORM set_config('kuncho.delivery_edit', '', true);
END $f$;
REVOKE EXECUTE ON FUNCTION public.set_po_delivery(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_po_delivery(uuid, text, date) TO authenticated;

-- ── 3. The site is told, and has three days to say something is wrong ────
CREATE TABLE IF NOT EXISTS public.goods_receipt_problems (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id             uuid NOT NULL REFERENCES public.goods_received_notes(id) ON DELETE CASCADE,
  sourcing_bundle_id uuid REFERENCES public.sourcing_bundles(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('not_arrived', 'short', 'damaged', 'wrong', 'other')),
  note               text NOT NULL,
  photos             jsonb NOT NULL DEFAULT '[]'::jsonb,
  raised_by          uuid REFERENCES public.user_profiles(id),
  raised_by_name     text,
  raised_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES public.user_profiles(id),
  resolved_by_name   text,
  resolution         text
);
CREATE INDEX IF NOT EXISTS goods_receipt_problems_grn ON public.goods_receipt_problems (grn_id);
CREATE INDEX IF NOT EXISTS goods_receipt_problems_open ON public.goods_receipt_problems (sourcing_bundle_id) WHERE resolved_at IS NULL;
ALTER TABLE public.goods_receipt_problems ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'goods_receipt_problems' AND policyname = 'grp_read') THEN
    CREATE POLICY grp_read ON public.goods_receipt_problems FOR SELECT USING (
      COALESCE((SELECT get_user_role())::text IN ('admin', 'executive', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer'), false)
      OR (SELECT is_ops_manager()) OR raised_by = auth.uid() OR bundle_touches_my_projects(sourcing_bundle_id));
  END IF;
END $p$;
GRANT SELECT ON public.goods_receipt_problems TO authenticated;

CREATE OR REPLACE FUNCTION public.report_receipt_problem(p_grn uuid, p_kind text, p_note text, p_photos jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE g goods_received_notes%ROWTYPE; b sourcing_bundles%ROWTYPE; v_id uuid; v_admin boolean := COALESCE(get_user_role()::text = 'admin', false);
BEGIN
  SELECT * INTO g FROM goods_received_notes WHERE id = p_grn;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = g.sourcing_bundle_id;
  IF NOT (v_admin OR is_ops_manager() OR bundle_touches_my_projects(g.sourcing_bundle_id)
          OR EXISTS (SELECT 1 FROM sourcing_bundle_items i JOIN order_items oi ON oi.id = i.order_item_id JOIN orders o ON o.id = oi.order_id
                      WHERE i.bundle_id = g.sourcing_bundle_id AND o.project_id IS NOT NULL AND is_site_foreman_for_project(o.project_id))) THEN
    RAISE EXCEPTION 'Only the site the goods were for can report a problem with them';
  END IF;
  IF NOT v_admin AND (now() AT TIME ZONE 'Africa/Addis_Ababa')::date > (g.received_at AT TIME ZONE 'Africa/Addis_Ababa')::date + 3 THEN
    RAISE EXCEPTION 'The three days to report a problem with this delivery have passed. Tell procurement directly';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('not_arrived', 'short', 'damaged', 'wrong', 'other') THEN RAISE EXCEPTION 'Say what is wrong'; END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say what happened'; END IF;
  INSERT INTO goods_receipt_problems (grn_id, sourcing_bundle_id, kind, note, photos, raised_by, raised_by_name)
  VALUES (p_grn, g.sourcing_bundle_id, p_kind, btrim(p_note), COALESCE(p_photos, '[]'::jsonb), auth.uid(),
          (SELECT full_name FROM user_profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;
  PERFORM notify(ARRAY[b.procurement_officer_id, g.received_by] || notify_role_users(ARRAY['admin']), 'goods.problem',
    'A site reports a problem with goods',
    concat_ws(' · ', b.bundle_code, b.vendor_name) || ': '
      || CASE p_kind WHEN 'not_arrived' THEN 'it didn''t arrive' WHEN 'short' THEN 'less arrived' WHEN 'damaged' THEN 'it came damaged'
                     WHEN 'wrong' THEN 'the wrong goods came' ELSE 'a problem' END
      || ' — ' || btrim(p_note) || COALESCE(' (' || notify_user_name(auth.uid()) || ')', ''),
    '/goods-received/' || p_grn, 'goods_received_note', p_grn, NULL, 'goods.problem:' || v_id);
  RETURN v_id;
END $f$;
REVOKE EXECUTE ON FUNCTION public.report_receipt_problem(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_receipt_problem(uuid, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_receipt_problem(p_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE pr goods_receipt_problems%ROWTYPE;
BEGIN
  IF NOT (can_receive_goods() OR COALESCE(get_user_role()::text = 'executive', false)) THEN
    RAISE EXCEPTION 'Only procurement, logistics or the store can answer a problem with goods';
  END IF;
  SELECT * INTO pr FROM goods_receipt_problems WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Problem not found'; END IF;
  IF pr.resolved_at IS NOT NULL THEN RAISE EXCEPTION 'This problem was already answered'; END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say what was done about it'; END IF;
  UPDATE goods_receipt_problems SET resolved_at = now(), resolved_by = auth.uid(), resolution = btrim(p_note),
         resolved_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid())
   WHERE id = p_id;
  PERFORM notify(ARRAY[pr.raised_by], 'goods.problem', 'Your problem with a delivery was answered',
    btrim(p_note) || COALESCE(' — ' || notify_user_name(auth.uid()), ''),
    '/goods-received/' || pr.grn_id, 'goods_received_note', pr.grn_id, NULL, 'goods.problem.answer:' || p_id);
END $f$;
REVOKE EXECUTE ON FUNCTION public.resolve_receipt_problem(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_receipt_problem(uuid, text) TO authenticated;

-- The site manager hears the goods are on their way, with the date to speak
-- up by; procurement and whoever asked hear they came, as before.
CREATE OR REPLACE FUNCTION public.trg_notify_goods_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE b sourcing_bundles%ROWTYPE;
BEGIN
  IF NEW.sourcing_bundle_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.site_delivery_note_id IS NULL THEN
    PERFORM notify(notify_po_site_pms(b.id), 'delivery.received', 'Goods for your site',
      concat_ws(' · ', b.bundle_code, b.vendor_name)
        || COALESCE(' collected by ' || notify_user_name(NEW.received_by), ' received')
        || '. If it doesn''t reach the site, or something is short or damaged, report it by '
        || to_char((NEW.received_at AT TIME ZONE 'Africa/Addis_Ababa')::date + 3, 'Dy DD Mon') || '.',
      '/goods-received/' || NEW.id, 'goods_received_note', NEW.id, NULL, 'delivery.received:' || NEW.id);
  END IF;
  PERFORM notify(ARRAY[b.procurement_officer_id] || notify_po_requesters(b.id) || notify_po_site_pms(b.id),
    'delivery.received', 'Goods delivered',
    concat_ws(' · ', b.bundle_code, b.vendor_name) || ' received'
      || COALESCE(' (' || NEW.grn_code || ')', '')
      || COALESCE(' by ' || notify_user_name(NEW.received_by), '') || '.',
    '/sourcing/' || b.id, 'purchase_order', b.id, NULL, 'delivery.received:' || NEW.id);
  RETURN NEW;
END $function$;

-- ── 4. What is waiting on the buyer ───────────────────────────────────────
-- The orders still waiting for goods, for procurement's list and the
-- morning message. Money paid ahead counts a payment the bank shows too.
CREATE OR REPLACE FUNCTION public.goods_to_collect()
RETURNS TABLE(bundle_id uuid, bundle_code text, vendor_name text, vendor_id uuid, officer_id uuid, officer text,
              ordered_on date, due date, delivery_mode text, days_waiting integer, total numeric, paid_ahead numeric,
              bank_paid boolean, received_any boolean, lines_out integer, projects text, trip text, open_problems integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF NOT (can_receive_goods() OR COALESCE(get_user_role()::text IN ('executive', 'finance', 'operations_manager'), false) OR is_ops_manager()) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT sb.id, sb.bundle_code, COALESCE(v.vendor_name, sb.vendor_name), sb.vendor_id, sb.procurement_officer_id, u.full_name,
         (sb.ordered_at AT TIME ZONE 'Africa/Addis_Ababa')::date,
         COALESCE(sb.expected_delivery_date, (sb.ordered_at AT TIME ZONE 'Africa/Addis_Ababa')::date),
         COALESCE(sb.delivery_mode, 'collect'),
         (v_today - COALESCE(sb.expected_delivery_date, (sb.ordered_at AT TIME ZONE 'Africa/Addis_Ababa')::date))::int,
         COALESCE(e.amount_etb, sb.total_value, sb.items_subtotal_etb, 0),
         CASE WHEN e.payment_state IN ('advance', 'paid', 'sent') OR bk.paid THEN COALESCE(e.amount_etb, 0) ELSE 0 END,
         COALESCE(bk.paid, false),
         EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.sourcing_bundle_id = sb.id),
         (SELECT count(*) FROM v_bundle_line_receipts r WHERE r.bundle_id = sb.id AND r.outstanding > 0)::int,
         (SELECT string_agg(DISTINCT btrim(p.project_name), ', ') FROM v_bundle_line_receipts r JOIN projects p ON p.id = r.project_id
           WHERE r.bundle_id = sb.id AND r.outstanding > 0),
         (SELECT t.job_status FROM transportation_requests t WHERE t.sourcing_bundle_id = sb.id AND t.job_status <> 'cancelled'
           ORDER BY t.created_at DESC LIMIT 1),
         (SELECT count(*) FROM goods_receipt_problems pr WHERE pr.sourcing_bundle_id = sb.id AND pr.resolved_at IS NULL)::int
    FROM sourcing_bundles sb
    LEFT JOIN vendors v ON v.id = sb.vendor_id
    LEFT JOIN user_profiles u ON u.id = sb.procurement_officer_id
    LEFT JOIN expenses e ON e.id = sb.expense_id
    LEFT JOIN LATERAL (SELECT true AS paid FROM bank_statement_lines l WHERE l.matched_expense_id = sb.expense_id LIMIT 1) bk ON true
   WHERE sb.status = 'ordered'
   ORDER BY 12 DESC, 8;
END $f$;
REVOKE EXECUTE ON FUNCTION public.goods_to_collect() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.goods_to_collect() TO authenticated;

-- Problems the sites reported that nobody has answered, for the same list.
CREATE OR REPLACE FUNCTION public.goods_waiting_for(p_user uuid)
RETURNS TABLE(what text, n integer, line text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_role text;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user AND COALESCE(get_user_role()::text, '') <> 'admin' THEN RETURN; END IF;
  SELECT u.role::text INTO v_role FROM user_profiles u WHERE u.id = p_user AND u.account_status = 'active';
  IF v_role IS NULL OR v_role NOT IN ('procurement_officer', 'admin') THEN RETURN; END IF;
  RETURN QUERY
  WITH open_po AS (
    SELECT sb.id, sb.procurement_officer_id AS officer, COALESCE(sb.delivery_mode, 'collect') AS mode,
           COALESCE(sb.expected_delivery_date, (sb.ordered_at AT TIME ZONE 'Africa/Addis_Ababa')::date) AS due,
           COALESCE(e.amount_etb, sb.total_value, sb.items_subtotal_etb, 0) AS amt,
           CASE WHEN e.payment_state IN ('advance', 'paid', 'sent')
                  OR EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.matched_expense_id = sb.expense_id)
                THEN COALESCE(e.amount_etb, 0) ELSE 0 END AS ahead
      FROM sourcing_bundles sb LEFT JOIN expenses e ON e.id = sb.expense_id
     WHERE sb.status = 'ordered' AND (sb.procurement_officer_id = p_user OR v_role = 'admin')
       AND EXISTS (SELECT 1 FROM v_bundle_line_receipts r WHERE r.bundle_id = sb.id AND r.outstanding > 0)
  ), collect AS (SELECT * FROM open_po WHERE mode = 'collect' AND due < v_today),
     vendor AS (SELECT * FROM open_po WHERE mode = 'vendor_delivers' AND due <= v_today),
     prob AS (SELECT pr.id FROM goods_receipt_problems pr JOIN sourcing_bundles sb ON sb.id = pr.sourcing_bundle_id
               WHERE pr.resolved_at IS NULL AND (sb.procurement_officer_id = p_user OR v_role = 'admin'))
  SELECT 'collect'::text, count(*)::int,
         count(*) || ' order' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END
           || CASE WHEN v_role = 'admin' THEN '' ELSE ' you bought' END
           || CASE WHEN count(*) = 1 THEN ' isn''t' ELSE ' aren''t' END || ' marked collected: ' || notify_etb(sum(c.amt))
           || CASE WHEN sum(c.ahead) > 0 THEN ', ' || notify_etb(sum(c.ahead)) || ' of it paid ahead' ELSE '' END
           || '. Mark each one collected with a photo, or cancel it'
    FROM collect c HAVING count(*) > 0
  UNION ALL
  SELECT 'vendor'::text, count(*)::int,
         count(*) || ' vendor deliver' || CASE WHEN count(*) = 1 THEN 'y is' ELSE 'ies are' END
           || ' due: check with the site and record what came'
    FROM vendor HAVING count(*) > 0
  UNION ALL
  SELECT 'problem'::text, count(*)::int,
         count(*) || ' problem' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' with goods reported by the sites wait'
           || CASE WHEN count(*) = 1 THEN 's' ELSE '' END || ' for your answer'
    FROM prob HAVING count(*) > 0;
END $f$;
REVOKE EXECUTE ON FUNCTION public.goods_waiting_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.goods_waiting_for(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.goods_nudge_daily()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE u record; v_lines text[]; v_n integer := 0;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND COALESCE(get_user_role()::text, '') <> 'admin' THEN
    RAISE EXCEPTION 'Only admin can send the goods reminders by hand';
  END IF;
  FOR u IN SELECT p.id FROM user_profiles p WHERE p.account_status = 'active' AND p.role IN ('procurement_officer', 'admin') LOOP
    SELECT array_agg(w.line) INTO v_lines FROM goods_waiting_for(u.id) w;
    CONTINUE WHEN v_lines IS NULL OR cardinality(v_lines) = 0;
    v_n := v_n + notify(ARRAY[u.id], 'goods.waiting',
      CASE WHEN cardinality(v_lines) = 1 THEN 'Goods: ' || v_lines[1] ELSE 'Goods: ' || cardinality(v_lines) || ' things are waiting on you' END,
      CASE WHEN cardinality(v_lines) = 1 THEN NULL ELSE '• ' || array_to_string(v_lines, E'\n• ') END,
      '/receiving', NULL, NULL, NULL, 'goods.waiting:' || v_today, '{}'::jsonb, true);
  END LOOP;
  RETURN v_n;
END $f$;
REVOKE EXECUTE ON FUNCTION public.goods_nudge_daily() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('kuncho-goods-nudge', '40 5 * * 1-6', 'SELECT public.goods_nudge_daily()');

-- ── 5. Finance sees a vendor's advances with nothing received ─────────────
CREATE OR REPLACE FUNCTION public.vendor_open_advances(p_vendor uuid, p_except_bundle uuid DEFAULT NULL, p_except_expense uuid DEFAULT NULL)
RETURNS TABLE(bundle_id uuid, bundle_code text, ordered_on date, days integer, paid_ahead numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF NOT (COALESCE(get_user_role()::text IN ('admin', 'executive', 'finance', 'procurement_officer', 'operations_manager'), false) OR is_ops_manager()) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT sb.id, sb.bundle_code, (sb.ordered_at AT TIME ZONE 'Africa/Addis_Ababa')::date,
         (v_today - (sb.ordered_at AT TIME ZONE 'Africa/Addis_Ababa')::date)::int, e.amount_etb
    FROM sourcing_bundles sb JOIN expenses e ON e.id = sb.expense_id
   WHERE sb.vendor_id = p_vendor AND sb.status = 'ordered'
     AND sb.id IS DISTINCT FROM p_except_bundle AND sb.expense_id IS DISTINCT FROM p_except_expense
     AND (e.payment_state IN ('advance', 'paid', 'sent') OR EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.matched_expense_id = e.id))
     AND (sb.ordered_at AT TIME ZONE 'Africa/Addis_Ababa')::date < v_today - 7
     AND NOT EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.sourcing_bundle_id = sb.id)
   ORDER BY sb.ordered_at;
END $f$;
REVOKE EXECUTE ON FUNCTION public.vendor_open_advances(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_open_advances(uuid, uuid, uuid) TO authenticated;

-- ── 6. The backlog ────────────────────────────────────────────────────────
-- Stock added by the clean-up and not counted since, for the next count.
CREATE OR REPLACE FUNCTION public.stock_to_check_after_cleanup()
RETURNS TABLE(stock_item_id uuid, item_name text, unit text, warehouse_zone text, added numeric, added_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT si.id, si.item_name, si.unit, si.warehouse_zone, sum(sr.quantity), max(sr.created_at)::date
    FROM stock_receipts sr JOIN stock_items si ON si.id = sr.stock_item_id
   WHERE auth.uid() IS NOT NULL AND sr.reversal_of IS NULL AND sr.destination = 'warehouse'
     AND sr.notes LIKE '%added at the receiving clean-up%'
     AND NOT EXISTS (SELECT 1 FROM stock_count_lines cl JOIN stock_counts c ON c.id = cl.count_id
                      WHERE cl.stock_item_id = si.id AND c.status = 'posted' AND c.posted_at > sr.created_at)
   GROUP BY si.id, si.item_name, si.unit, si.warehouse_zone
   ORDER BY si.warehouse_zone NULLS LAST, si.item_name
$f$;
REVOKE EXECUTE ON FUNCTION public.stock_to_check_after_cleanup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_to_check_after_cleanup() TO authenticated;

-- Every open order the bank shows as paid is marked received in full, dated
-- the day the bank paid it. Quietly: nobody needs 200 messages about it. In
-- batches, so no single statement runs long; each call returns how many
-- orders it marked, and 0 once there are none left.
CREATE OR REPLACE FUNCTION public.receiving_cleanup(p_limit integer DEFAULT 60)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE b record; v_grn uuid; v_orders integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'The receiving clean-up runs from the SQL editor'; END IF;
  PERFORM set_config('app.notify_off', 'on', true);
  FOR b IN
    SELECT sb.id, sb.expense_id, min(l.value_date) AS bank_day
      FROM sourcing_bundles sb JOIN bank_statement_lines l ON l.matched_expense_id = sb.expense_id
     WHERE sb.status = 'ordered'
       AND EXISTS (SELECT 1 FROM v_bundle_line_receipts r WHERE r.bundle_id = sb.id AND r.outstanding > 0)
     GROUP BY sb.id, sb.expense_id
     ORDER BY min(l.value_date), sb.id
     LIMIT p_limit
  LOOP
    INSERT INTO goods_received_notes (sourcing_bundle_id, received_by, received_at, notes, photos)
    VALUES (b.id, NULL, (b.bank_day + time '12:00') AT TIME ZONE 'Africa/Addis_Ababa',
            'Marked received at the receiving clean-up on ' || to_char(CURRENT_DATE, 'DD Mon YYYY')
              || ': the bank shows it paid on ' || to_char(b.bank_day, 'DD Mon YYYY') || '. Nobody counted it when it came.',
            '[]'::jsonb)
    RETURNING id INTO v_grn;
    INSERT INTO goods_received_note_items (grn_id, sourcing_bundle_item_id, quantity_received, quantity_rejected, quantity_damaged, category_id)
    SELECT v_grn, r.bundle_item_id, r.outstanding, 0, 0,
           COALESCE(sc.parent_category_id, (SELECT e.category_id FROM expenses e WHERE e.id = b.expense_id))
      FROM v_bundle_line_receipts r
      JOIN sourcing_bundle_items i ON i.id = r.bundle_item_id
      LEFT JOIN order_items oi ON oi.id = i.order_item_id
      LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
     WHERE r.bundle_id = b.id AND r.outstanding > 0;
    UPDATE stock_receipts sr SET notes = COALESCE(sr.notes, 'Received via GRN') || ' · added at the receiving clean-up: check it at the next stock count'
     WHERE sr.destination = 'warehouse' AND sr.grn_item_id IN (SELECT gi.id FROM goods_received_note_items gi WHERE gi.grn_id = v_grn);
    v_orders := v_orders + 1;
  END LOOP;
  PERFORM set_config('app.notify_off', '', true);
  RETURN v_orders;
END $f$;
REVOKE EXECUTE ON FUNCTION public.receiving_cleanup(integer) FROM PUBLIC, anon, authenticated;

SELECT public.receiving_cleanup(60) AS batch_1;
SELECT public.receiving_cleanup(60) AS batch_2;
SELECT public.receiving_cleanup(60) AS batch_3;
SELECT public.receiving_cleanup(60) AS batch_4;
SELECT public.receiving_cleanup(60) AS batch_5;

-- What the clean-up did, and what is left for the buyers. If
-- bank_paid_still_open is above 0, run SELECT public.receiving_cleanup(60);
-- again until it is.
SELECT (SELECT count(*) FROM goods_received_notes WHERE notes LIKE 'Marked received at the receiving clean-up%') AS orders_marked_received,
       (SELECT count(*) FROM sourcing_bundles WHERE status = 'ordered') AS orders_still_open,
       (SELECT round(sum(COALESCE(total_value, items_subtotal_etb, 0))) FROM sourcing_bundles WHERE status = 'ordered') AS etb_still_open,
       (SELECT count(*) FROM stock_receipts WHERE notes LIKE '%added at the receiving clean-up%') AS warehouse_lines_to_count,
       (SELECT count(DISTINCT sb.id) FROM sourcing_bundles sb JOIN bank_statement_lines l ON l.matched_expense_id = sb.expense_id
         WHERE sb.status = 'ordered' AND EXISTS (SELECT 1 FROM v_bundle_line_receipts r WHERE r.bundle_id = sb.id AND r.outstanding > 0)) AS bank_paid_still_open;
