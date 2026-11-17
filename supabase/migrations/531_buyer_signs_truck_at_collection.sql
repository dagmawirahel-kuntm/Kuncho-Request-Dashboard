-- 531: The buyer signs for the goods; a hired truck is recorded where it is found.
--
-- 1. How a PO's goods travel, chosen when it is ordered:
--      vendor_delivers  the vendor brings them (no transport job)
--      hired            a truck hired on the day at the vendor — the buyer
--                       records driver and fare when marking collected
--                       (big loads can still be booked ahead)
--      own_truck        our own truck, booked ahead
--    ('collect', the old value, reads as hired.)
-- 2. Only the PO's buyer signs for its goods (an admin too). Anyone who
--    may receive goods can still record them with a photo.
-- 3. Marking collected with a hired truck creates the transport job there
--    and then — driver, plate, fare — already delivered, so finance can
--    pay the driver. A truck booked ahead is used instead and gets its fare.

SET search_path TO public;

-- ── 1. Delivery modes ───────────────────────────────────────────────────
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'public.sourcing_bundles'::regclass AND pg_get_constraintdef(oid) ILIKE '%delivery_mode%' LIMIT 1;
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.sourcing_bundles DR'||'OP CONSTRAINT %I', c); END IF;
  ALTER TABLE public.sourcing_bundles ADD CONSTRAINT sourcing_bundles_delivery_mode_check
    CHECK (delivery_mode IS NULL OR delivery_mode IN ('vendor_delivers', 'hired', 'own_truck', 'collect'));
END $$;

-- ── 2. Only the buyer signs ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_po_buyer(p_bundle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  SELECT COALESCE(get_user_role()::text = 'admin', false)
      OR EXISTS (SELECT 1 FROM sourcing_bundles b WHERE b.id = p_bundle AND b.procurement_officer_id = auth.uid())
$f$;
GRANT EXECUTE ON FUNCTION public.is_po_buyer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.po_buyer_name(p_bundle uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  SELECT u.full_name FROM sourcing_bundles b JOIN user_profiles u ON u.id = b.procurement_officer_id WHERE b.id = p_bundle
$f$;

CREATE OR REPLACE FUNCTION public.trg_grn_needs_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.site_delivery_note_id IS NULL
     AND COALESCE(get_user_role()::text, '') <> 'admin'
     AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(NEW.photos) = 'array' THEN NEW.photos END), 0) = 0
     AND NEW.photo_url IS NULL
     AND NOT is_signature(NEW.signature) THEN
    RAISE EXCEPTION 'The buyer signs for the goods — or add a photo of the goods or the vendor''s receipt';
  END IF;
  IF NEW.signature IS NOT NULL THEN
    IF auth.uid() IS NOT NULL AND NOT is_po_buyer(NEW.sourcing_bundle_id) THEN
      RAISE EXCEPTION 'Only % (the buyer) signs for these goods — record them with a photo instead',
        COALESCE(po_buyer_name(NEW.sourcing_bundle_id), 'the buyer');
    END IF;
    NEW.signed_by_name := COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), NEW.signed_by_name);
    NEW.signed_at := COALESCE(NEW.signed_at, now());
  END IF;
  RETURN NEW;
END $function$;

-- ── 3. Collected: the buyer signs, the hired truck and its fare go with it
DO $$ BEGIN
  EXECUTE 'DR'||'OP FUNCTION IF EXISTS public.record_collection(uuid, jsonb, jsonb, text, text, text, text, text, uuid, text)';
END $$;

CREATE OR REPLACE FUNCTION public.record_collection(
  p_bundle uuid, p_lines jsonb, p_photos jsonb, p_notes text DEFAULT NULL, p_vendor_receipt text DEFAULT NULL,
  p_signature text DEFAULT NULL,
  p_truck text DEFAULT NULL,            -- 'hired' | 'own' | 'vendor'
  p_driver uuid DEFAULT NULL, p_driver_phone text DEFAULT NULL, p_plate text DEFAULT NULL,
  p_fare numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE b sourcing_bundles%ROWTYPE; v_grn uuid; v_bad text; v_job transportation_requests; v_driver transport_drivers;
        v_photos jsonb; v_vendor vendors; v_project uuid; v_me text;
BEGIN
  IF NOT can_receive_goods() THEN
    RAISE EXCEPTION 'Only procurement, logistics or the store can record what was collected';
  END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF b.status <> 'ordered' THEN RAISE EXCEPTION 'Only an order waiting for goods can be marked collected'; END IF;

  v_photos := CASE WHEN jsonb_typeof(p_photos) = 'array' THEN p_photos ELSE '[]'::jsonb END;
  IF p_signature IS NOT NULL AND NOT is_signature(p_signature) THEN
    RAISE EXCEPTION 'The signature did not come through — sign again';
  END IF;
  IF p_signature IS NOT NULL AND NOT is_po_buyer(p_bundle) THEN
    RAISE EXCEPTION 'Only % (the buyer) signs for these goods — record them with a photo instead', COALESCE(po_buyer_name(p_bundle), 'the buyer');
  END IF;
  IF jsonb_array_length(v_photos) = 0 AND p_signature IS NULL THEN
    RAISE EXCEPTION 'The buyer signs for the goods — or add a photo of the goods or the vendor''s receipt';
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

  -- the truck
  SELECT * INTO v_job FROM transportation_requests t WHERE t.sourcing_bundle_id = p_bundle
     AND t.job_status IN ('requested', 'assigned', 'in_progress') ORDER BY t.created_at DESC LIMIT 1;
  IF p_truck = 'hired' THEN
    IF p_driver IS NULL THEN RAISE EXCEPTION 'Pick the driver who carried it (or add him)'; END IF;
    IF COALESCE(p_fare, 0) <= 0 THEN RAISE EXCEPTION 'Enter the fare agreed with the driver'; END IF;
  END IF;
  IF p_driver IS NOT NULL THEN
    SELECT * INTO v_driver FROM transport_drivers WHERE id = p_driver;
    IF NOT FOUND THEN RAISE EXCEPTION 'That driver is not on the list'; END IF;
    PERFORM remember_driver_contact(p_driver, p_driver_phone, p_plate);
  END IF;

  IF p_truck = 'hired' AND v_job.id IS NULL THEN
    SELECT * INTO v_vendor FROM vendors WHERE id = b.vendor_id;
    v_project := (SELECT o.project_id FROM sourcing_bundle_items i JOIN order_items oi ON oi.id = i.order_item_id JOIN orders o ON o.id = oi.order_id
                   WHERE i.bundle_id = b.id AND o.project_id IS NOT NULL GROUP BY o.project_id ORDER BY count(*) DESC LIMIT 1);
    INSERT INTO transportation_requests (request_name, job_type, transport_mode, job_status, priority, project_id, sourcing_bundle_id,
      vendor_id, vendor_name, pickup_location_id, pickup_location_text, dropoff_location_text, requested_date, expected_delivery_date,
      hired_driver_id, amount, requested_by_id, created_via, requested)
    VALUES ('Collect ' || b.bundle_code || COALESCE(' from ' || COALESCE(v_vendor.vendor_name, b.vendor_name), ''),
      'purchase_pickup', 'hired', 'assigned', 'normal', v_project, b.id,
      b.vendor_id, COALESCE(v_vendor.vendor_name, b.vendor_name), v_vendor.location_id, COALESCE(v_vendor.vendor_name, b.vendor_name),
      (SELECT btrim(project_name) FROM projects WHERE id = v_project), CURRENT_DATE, CURRENT_DATE,
      p_driver, p_fare, auth.uid(), 'collection', true)
    RETURNING * INTO v_job;
  ELSIF v_job.id IS NOT NULL AND p_driver IS NOT NULL THEN
    -- a truck booked ahead: it is this driver, and this is what he is paid
    UPDATE transportation_requests
       SET hired_driver_id = COALESCE(hired_driver_id, p_driver),
           amount = CASE WHEN COALESCE(amount, 0) = 0 THEN p_fare ELSE amount END
     WHERE id = v_job.id;
  END IF;

  SELECT full_name INTO v_me FROM user_profiles WHERE id = auth.uid();
  INSERT INTO goods_received_notes (sourcing_bundle_id, received_by, received_at, notes, photos, photo_url, photo_name,
                                    delivery_note_ref, transportation_request_id,
                                    signature, signed_by_name, signed_at,
                                    hired_driver_id, driver_name, vehicle_plate)
  VALUES (p_bundle, auth.uid(), now(),
          concat_ws(' · ', NULLIF(btrim(p_notes), ''),
                    CASE p_truck WHEN 'vendor' THEN 'Came on the vendor''s truck' WHEN 'own' THEN 'Came on our truck' END),
          v_photos, v_photos->0->>'url', v_photos->0->>'name',
          NULLIF(btrim(p_vendor_receipt), ''), v_job.id,
          p_signature, CASE WHEN p_signature IS NOT NULL THEN COALESCE(v_me, po_buyer_name(p_bundle)) END,
          CASE WHEN p_signature IS NOT NULL THEN now() END,
          p_driver, v_driver.full_name,
          COALESCE(NULLIF(upper(btrim(p_plate)), ''), v_driver.plate_number))
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
END $function$;
GRANT EXECUTE ON FUNCTION public.record_collection(uuid, jsonb, jsonb, text, text, text, text, uuid, text, text, numeric) TO authenticated;

-- ── 4. The dispatch board receives a PO's goods only with the buyer's signature
CREATE OR REPLACE FUNCTION public.dispatch_delivered(p_job uuid, p_note text DEFAULT NULL, p_signature text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE t transportation_requests; b sourcing_bundles; v_grn uuid; v_me text; v_open int := 0;
BEGIN
  t := dispatch_job_open(p_job);
  IF p_signature IS NOT NULL AND NOT is_signature(p_signature) THEN RAISE EXCEPTION 'The signature did not come through — sign again'; END IF;
  SELECT full_name INTO v_me FROM user_profiles WHERE id = auth.uid();

  IF t.sourcing_bundle_id IS NOT NULL THEN
    SELECT * INTO b FROM sourcing_bundles WHERE id = t.sourcing_bundle_id FOR UPDATE;
    SELECT count(*) INTO v_open FROM v_bundle_line_receipts r WHERE r.bundle_id = b.id AND r.outstanding > 0;
  END IF;
  IF b.status = 'ordered' AND v_open > 0 THEN
    IF NOT is_po_buyer(b.id) THEN
      RAISE EXCEPTION 'The goods on % are signed for by % (the buyer) — ask them to mark it collected', b.bundle_code, COALESCE(po_buyer_name(b.id), 'the buyer');
    END IF;
    IF p_signature IS NULL THEN RAISE EXCEPTION 'Sign to confirm the goods on % arrived', b.bundle_code; END IF;
  END IF;

  INSERT INTO transport_job_events (job_id, kind, note, signature) VALUES (p_job, 'delivered', NULLIF(btrim(p_note), ''), p_signature);
  UPDATE transportation_requests SET delivery_proof = 'staff_confirmed', delivered_confirmed_by = auth.uid(), delivered_confirmed_at = now()
   WHERE id = p_job;

  IF b.status = 'ordered' AND v_open > 0 THEN
    INSERT INTO goods_received_notes (sourcing_bundle_id, received_by, received_at, notes, photos, transportation_request_id,
                                      signature, signed_by_name, signed_at, hired_driver_id, driver_name)
    VALUES (b.id, auth.uid(), now(),
            concat_ws(' · ', format('Delivered on transport job "%s" — %s, the buyer, confirmed it. Not counted line by line.', t.request_name, COALESCE(v_me, 'the buyer')), NULLIF(btrim(p_note), '')),
            '[]'::jsonb, p_job, p_signature, COALESCE(v_me, 'Buyer'), now(), t.hired_driver_id,
            (SELECT full_name FROM transport_drivers WHERE id = t.hired_driver_id))
    RETURNING id INTO v_grn;
    INSERT INTO goods_received_note_items (grn_id, sourcing_bundle_item_id, quantity_received, quantity_rejected, quantity_damaged, category_id)
    SELECT v_grn, r.bundle_item_id, r.outstanding, 0, 0,
           COALESCE(sc.parent_category_id, (SELECT e.category_id FROM expenses e WHERE e.id = b.expense_id))
      FROM v_bundle_line_receipts r
      JOIN sourcing_bundle_items i ON i.id = r.bundle_item_id
      LEFT JOIN order_items oi ON oi.id = i.order_item_id
      LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
     WHERE r.bundle_id = b.id AND r.outstanding > 0;
  END IF;

  UPDATE transportation_requests SET job_status = 'completed' WHERE id = p_job AND job_status <> 'completed';
  RETURN CASE WHEN v_grn IS NOT NULL THEN 'received' ELSE 'delivered' END;
END $f$;

-- the board knows each PO's buyer
CREATE OR REPLACE VIEW public.v_dispatch_board WITH (security_invoker = true) AS
 SELECT t.id, t.request_name, t.job_type, t.job_status, t.transport_mode, t.priority,
        t.requested_date, t.expected_delivery_date,
        CASE WHEN t.job_status IN ('requested', 'assigned', 'in_progress')
             THEN GREATEST(CURRENT_DATE - COALESCE(t.expected_delivery_date, t.requested_date, t.created_at::date), 0) END AS days_late,
        t.project_id, btrim(p.project_name) AS project_name,
        COALESCE(pl.location_name, t.pickup_location_text) AS pickup, pl.latitude AS pickup_lat, pl.longitude AS pickup_lng,
        COALESCE(pl.contact_phone, v.phone_contact) AS pickup_phone,
        COALESCE(dl.location_name, t.dropoff_location_text, btrim(p.project_name)) AS dropoff, dl.latitude AS dropoff_lat, dl.longitude AS dropoff_lng,
        COALESCE(dl.contact_phone, pm.phone_number) AS dropoff_phone, pm.employee_name AS site_contact,
        COALESCE(v.vendor_name, t.vendor_name) AS vendor_name, v.phone_contact AS vendor_phone,
        t.hired_driver_id, d.full_name AS hired_driver, d.phone AS hired_driver_phone, d.plate_number AS hired_plate, d.is_blocked AS driver_blocked,
        t.assigned_staff_id, s.employee_name AS staff_driver, s.phone_number AS staff_driver_phone, vh.name AS vehicle_name, vh.plate_number AS vehicle_plate,
        t.driver_name,
        t.sourcing_bundle_id, sb.bundle_code, sb.status::text AS po_status,
        (SELECT count(*) FROM v_bundle_line_receipts r WHERE r.bundle_id = sb.id AND r.outstanding > 0)::int AS po_open_lines,
        t.amount, t.expense_id, t.payment_status,
        t.delivery_proof, t.delivered_confirmed_at, cu.full_name AS delivered_confirmed_by_name, t.actual_delivery_date,
        t.sheet_token, t.sheet_sent_at,
        ev.kind AS last_event, ev.note AS last_event_note, ev.created_at AS last_event_at, eu.full_name AS last_event_by,
        sb.procurement_officer_id AS buyer_id, bu.full_name AS buyer_name
   FROM transportation_requests t
   LEFT JOIN projects p ON p.id = t.project_id
   LEFT JOIN staff pm ON pm.id = p.project_manager_id
   LEFT JOIN locations pl ON pl.id = t.pickup_location_id
   LEFT JOIN locations dl ON dl.id = COALESCE(t.dropoff_location_id, p.location_id)
   LEFT JOIN vendors v ON v.id = t.vendor_id
   LEFT JOIN transport_drivers d ON d.id = t.hired_driver_id
   LEFT JOIN staff s ON s.id = t.assigned_staff_id
   LEFT JOIN vehicles vh ON vh.id = t.vehicle_id
   LEFT JOIN sourcing_bundles sb ON sb.id = t.sourcing_bundle_id
   LEFT JOIN user_profiles bu ON bu.id = sb.procurement_officer_id
   LEFT JOIN user_profiles cu ON cu.id = t.delivered_confirmed_by
   LEFT JOIN LATERAL (SELECT e.* FROM transport_job_events e WHERE e.job_id = t.id ORDER BY e.created_at DESC LIMIT 1) ev ON true
   LEFT JOIN user_profiles eu ON eu.id = ev.created_by
  WHERE t.job_status IN ('requested', 'assigned', 'in_progress')
     OR (t.job_status = 'completed' AND COALESCE(t.completed_at, t.updated_at) >= now() - interval '3 days');

-- ── 531b: the new modes everywhere a PO's delivery is read ──────────────
CREATE OR REPLACE FUNCTION public.set_po_delivery(p_bundle uuid, p_mode text, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE b sourcing_bundles%ROWTYPE;
BEGIN
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT (COALESCE(get_user_role()::text IN ('admin', 'executive', 'procurement_officer', 'operations_manager'), false)
          OR b.procurement_officer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only procurement can change how and when the goods come';
  END IF;
  IF b.status NOT IN ('approved', 'ordered') THEN RAISE EXCEPTION 'Only an order still waiting for its goods can change this'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('hired', 'own_truck', 'vendor_delivers', 'collect') THEN
    RAISE EXCEPTION 'Say how the goods come: a hired truck, our truck, or the vendor delivers';
  END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'Say on which day'; END IF;
  PERFORM set_config('kuncho.delivery_edit', 'on', true);
  UPDATE sourcing_bundles SET delivery_mode = p_mode, expected_delivery_date = p_date WHERE id = p_bundle;
  PERFORM set_config('kuncho.delivery_edit', '', true);
END $function$;

-- the buyer's reminder: anything we fetch (hired or our truck) is "to collect"
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.goods_waiting_for'::regproc);
  d := replace(d, $r$COALESCE(sb.delivery_mode, 'collect') AS mode$r$,
                  $r$CASE WHEN sb.delivery_mode = 'vendor_delivers' THEN 'vendor_delivers' ELSE 'collect' END AS mode$r$);
  d := replace(d, $r$Mark each one collected with a photo, or cancel it$r$, $r$Mark each one collected and sign, or cancel it$r$);
  EXECUTE d;
END $$;

-- ── 531c: the screen merged before 531 still sends who signed and the driver.
-- It goes through the 531 rules (only the buyer signs). Remove once this screen is live.
CREATE OR REPLACE FUNCTION public.record_collection(
  p_bundle uuid, p_lines jsonb, p_photos jsonb, p_notes text, p_vendor_receipt text,
  p_signature text, p_signed_by text, p_signed_phone text, p_driver uuid, p_plate text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO public AS $f$
  SELECT record_collection(p_bundle => p_bundle, p_lines => p_lines, p_photos => p_photos, p_notes => p_notes,
    p_vendor_receipt => p_vendor_receipt, p_signature => p_signature, p_truck => NULL::text,
    p_driver => p_driver, p_driver_phone => p_signed_phone, p_plate => p_plate, p_fare => NULL::numeric)
$f$;
GRANT EXECUTE ON FUNCTION public.record_collection(uuid, jsonb, jsonb, text, text, text, text, text, uuid, text) TO authenticated;
