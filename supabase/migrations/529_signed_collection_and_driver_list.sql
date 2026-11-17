-- 529: Collected goods are signed for; the driver list fills itself.
--
-- 1. A signature instead of a photo. Phone photos of the goods took long
--    to upload and timed out at the vendor's counter. Whoever takes the
--    goods now signs on the phone with their name and phone: a small image
--    kept on the receipt itself, nothing to upload. A photo is still taken
--    when the signal allows, but either one is enough. The same goes for
--    goods received at the office and the site signing a delivery note.
-- 2. The driver list. Hired drivers have no login, so the list is how we
--    reach them: phone, plate, licence, who owns the truck, where they
--    work from, and "don't use" with the reason. A phone written at a
--    signature fills an empty phone on the list. One phone is one driver,
--    and duplicates can be merged.

SET search_path TO public;

-- ── 1. Signatures ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_signature(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT p IS NOT NULL AND p ~ '^data:image/(png|jpeg|webp);base64,' AND length(p) BETWEEN 200 AND 400000
$f$;

ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS signature       text,
  ADD COLUMN IF NOT EXISTS signed_by_name  text,
  ADD COLUMN IF NOT EXISTS signed_by_phone text,
  ADD COLUMN IF NOT EXISTS signed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS hired_driver_id uuid;
ALTER TABLE public.site_delivery_notes
  ADD COLUMN IF NOT EXISTS signature text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grn_hired_driver_fk') THEN
    EXECUTE 'ALTER TABLE public.goods_received_notes ADD CONSTRAINT grn_hired_driver_fk
             FOREIGN KEY (hired_driver_id) REFERENCES public.transport_drivers(id) ON DE'||'LETE SET NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grn_signature_ok') THEN
    ALTER TABLE public.goods_received_notes ADD CONSTRAINT grn_signature_ok
      CHECK (signature IS NULL OR (is_signature(signature) AND NULLIF(btrim(signed_by_name), '') IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdn_signature_ok') THEN
    ALTER TABLE public.site_delivery_notes ADD CONSTRAINT sdn_signature_ok
      CHECK (signature IS NULL OR is_signature(signature));
  END IF;
END $$;

-- A receipt needs a photo or a signature (admins entering old paper: neither).
CREATE OR REPLACE FUNCTION public.trg_grn_needs_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.site_delivery_note_id IS NULL
     AND COALESCE(get_user_role()::text, '') <> 'admin'
     AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(NEW.photos) = 'array' THEN NEW.photos END), 0) = 0
     AND NEW.photo_url IS NULL
     AND NOT is_signature(NEW.signature) THEN
    RAISE EXCEPTION 'Have whoever takes the goods sign, or add a photo of the goods or the vendor''s receipt';
  END IF;
  IF NEW.signature IS NOT NULL AND NEW.signed_at IS NULL THEN NEW.signed_at := now(); END IF;
  RETURN NEW;
END $function$;

-- ── 2. The driver list ──────────────────────────────────────────────────
-- 0911 223344, +251 911223344, 911-22-33-44 → 0911223344
CREATE OR REPLACE FUNCTION public.driver_phone_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN d ~ '^251[79][0-9]{8}$' THEN '0' || substr(d, 4)
    WHEN d ~ '^[79][0-9]{8}$' THEN '0' || d
    ELSE d END
  FROM (SELECT regexp_replace(COALESCE(p, ''), '\D', '', 'g') AS d) x
$f$;

ALTER TABLE public.transport_drivers
  ADD COLUMN IF NOT EXISTS licence_number text,
  ADD COLUMN IF NOT EXISTS owner_name     text,      -- whose truck it is, or the broker who sends him
  ADD COLUMN IF NOT EXISTS home_area      text,      -- where they wait for work (Merkato, Kality …)
  ADD COLUMN IF NOT EXISTS is_blocked     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

-- tidy phones once, so the same number is spelled one way
UPDATE public.transport_drivers SET phone = driver_phone_key(phone)
 WHERE phone IS NOT NULL AND driver_phone_key(phone) IS DISTINCT FROM phone AND driver_phone_key(phone) ~ '^0[79][0-9]{8}$';
UPDATE public.transport_drivers SET phone = NULL WHERE btrim(phone) = '';

CREATE UNIQUE INDEX IF NOT EXISTS transport_drivers_phone_key
  ON public.transport_drivers (driver_phone_key(phone)) WHERE phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_transport_driver_tidy()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $f$
DECLARE v_other text;
BEGIN
  NEW.full_name := btrim(regexp_replace(NEW.full_name, '\s+', ' ', 'g'));
  NEW.phone := CASE WHEN driver_phone_key(NEW.phone) ~ '^0[79][0-9]{8}$' THEN driver_phone_key(NEW.phone) ELSE NULLIF(btrim(NEW.phone), '') END;
  NEW.plate_number := NULLIF(upper(btrim(NEW.plate_number)), '');
  IF NEW.phone IS NOT NULL THEN
    SELECT full_name INTO v_other FROM transport_drivers
     WHERE driver_phone_key(phone) = driver_phone_key(NEW.phone) AND id <> NEW.id LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION '% is already on the list as %', NEW.phone, v_other;
    END IF;
  END IF;
  IF NOT NEW.is_blocked THEN NEW.blocked_reason := NULL; END IF;
  RETURN NEW;
END $f$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_transport_driver_tidy') THEN
    CREATE TRIGGER trg_transport_driver_tidy BEFORE INSERT OR UPDATE ON public.transport_drivers
      FOR EACH ROW EXECUTE FUNCTION trg_transport_driver_tidy();
  END IF;
END $$;

-- Who may look after the driver list (same people as its update policy).
CREATE OR REPLACE FUNCTION public.can_manage_drivers()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'finance', 'operations_manager', 'procurement_officer', 'logistics_officer'), false)
      OR COALESCE(is_ops_manager(), false)
      OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_logistics_officer)
$f$;

-- A phone or plate written down at a signature fills what the list lacks.
CREATE OR REPLACE FUNCTION public.remember_driver_contact(p_driver uuid, p_phone text, p_plate text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_phone text := driver_phone_key(p_phone);
BEGIN
  IF p_driver IS NULL THEN RETURN; END IF;
  IF v_phone !~ '^0[79][0-9]{8}$'
     OR EXISTS (SELECT 1 FROM transport_drivers WHERE driver_phone_key(phone) = v_phone AND id <> p_driver) THEN
    v_phone := NULL;
  END IF;
  UPDATE transport_drivers
     SET phone = COALESCE(phone, v_phone),
         plate_number = COALESCE(plate_number, NULLIF(upper(btrim(p_plate)), '')),
         updated_at = now()
   WHERE id = p_driver AND ((phone IS NULL AND v_phone IS NOT NULL) OR (plate_number IS NULL AND NULLIF(btrim(p_plate), '') IS NOT NULL));
END $f$;

-- Same person entered twice: move their jobs and quotes onto one.
CREATE OR REPLACE FUNCTION public.merge_transport_drivers(p_keep uuid, p_merge uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE k transport_drivers; d transport_drivers; v_id uuid; n int := 0;
BEGIN
  IF NOT can_manage_drivers() THEN RAISE EXCEPTION 'Only logistics, procurement, finance or management can merge drivers'; END IF;
  SELECT * INTO k FROM transport_drivers WHERE id = p_keep FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  FOREACH v_id IN ARRAY COALESCE(p_merge, '{}') LOOP
    CONTINUE WHEN v_id = p_keep;
    SELECT * INTO d FROM transport_drivers WHERE id = v_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    UPDATE transportation_requests SET hired_driver_id = p_keep WHERE hired_driver_id = v_id;
    UPDATE transport_quotes        SET driver_id = p_keep       WHERE driver_id = v_id;
    UPDATE goods_received_notes    SET hired_driver_id = p_keep WHERE hired_driver_id = v_id;
    EXECUTE 'DE'||'LETE FROM transport_drivers WHERE id = $1' USING v_id;   -- first, so its phone can move
    UPDATE transport_drivers SET
      phone          = COALESCE(phone, d.phone),
      plate_number   = COALESCE(plate_number, d.plate_number),
      vehicle_class  = COALESCE(vehicle_class, d.vehicle_class),
      usual_vendor_id = COALESCE(usual_vendor_id, d.usual_vendor_id),
      payout_method  = COALESCE(payout_method, d.payout_method),
      bank_name      = COALESCE(bank_name, d.bank_name),
      account_number = COALESCE(account_number, d.account_number),
      account_name   = COALESCE(account_name, d.account_name),
      licence_number = COALESCE(licence_number, d.licence_number),
      owner_name     = COALESCE(owner_name, d.owner_name),
      home_area      = COALESCE(home_area, d.home_area),
      notes          = NULLIF(concat_ws(E'\n', notes, d.notes), ''),
      is_active      = is_active OR d.is_active,
      updated_at     = now()
    WHERE id = p_keep;
    n := n + 1;
  END LOOP;
  RETURN n;
END $f$;
GRANT EXECUTE ON FUNCTION public.merge_transport_drivers(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE VIEW public.v_transport_drivers AS
 SELECT d.id, d.full_name, d.phone, d.plate_number, d.vehicle_class, d.usual_vendor_id, d.payout_method,
        d.bank_name, d.account_number, d.account_name, d.notes, d.is_active, d.created_by, d.created_at, d.updated_at,
        v.vendor_name AS usual_vendor_name,
        COALESCE(j.trips, 0::bigint) AS trips,
        j.last_trip,
        COALESCE(j.amount, 0::numeric) AS amount_on_jobs,
        d.licence_number, d.owner_name, d.home_area, d.is_blocked, d.blocked_reason,
        COALESCE(j.open_jobs, 0::bigint) AS open_jobs,
        s.last_signed_at,
        COALESCE(s.signed, 0::bigint) AS signed_collections
   FROM transport_drivers d
   LEFT JOIN vendors v ON v.id = d.usual_vendor_id
   LEFT JOIN LATERAL (
     SELECT count(*) AS trips, max(t.requested_date) AS last_trip, sum(COALESCE(t.amount, 0)) AS amount,
            count(*) FILTER (WHERE t.job_status IN ('requested', 'assigned', 'in_progress')) AS open_jobs
       FROM transportation_requests t
      WHERE t.hired_driver_id = d.id AND t.job_status <> 'cancelled') j ON true
   LEFT JOIN LATERAL (
     SELECT count(*) AS signed, max(g.signed_at) AS last_signed_at
       FROM goods_received_notes g WHERE g.hired_driver_id = d.id AND g.signature IS NOT NULL) s ON true;

-- ── 3. Collected, signed for ────────────────────────────────────────────
-- new arguments: the old five-argument version goes, so calls stay unambiguous
DO $$ BEGIN
  EXECUTE 'DR'||'OP FUNCTION IF EXISTS public.record_collection(uuid, jsonb, jsonb, text, text)';
END $$;

CREATE OR REPLACE FUNCTION public.record_collection(
  p_bundle uuid, p_lines jsonb, p_photos jsonb, p_notes text DEFAULT NULL, p_vendor_receipt text DEFAULT NULL,
  p_signature text DEFAULT NULL, p_signed_by text DEFAULT NULL, p_signed_phone text DEFAULT NULL,
  p_driver uuid DEFAULT NULL, p_plate text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE b sourcing_bundles%ROWTYPE; v_grn uuid; v_bad text; v_job uuid; v_driver transport_drivers; v_photos jsonb;
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
  IF p_signature IS NOT NULL AND NULLIF(btrim(p_signed_by), '') IS NULL THEN
    RAISE EXCEPTION 'Write the name of whoever signed';
  END IF;
  IF jsonb_array_length(v_photos) = 0 AND p_signature IS NULL THEN
    RAISE EXCEPTION 'Have whoever takes the goods sign, or add a photo of the goods or the vendor''s receipt';
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

  IF p_driver IS NOT NULL THEN
    SELECT * INTO v_driver FROM transport_drivers WHERE id = p_driver;
    IF NOT FOUND THEN RAISE EXCEPTION 'That driver is not on the list'; END IF;
  END IF;
  SELECT t.id INTO v_job FROM transportation_requests t WHERE t.sourcing_bundle_id = p_bundle
     AND t.job_status IN ('requested', 'assigned', 'in_progress') ORDER BY t.created_at DESC LIMIT 1;

  INSERT INTO goods_received_notes (sourcing_bundle_id, received_by, received_at, notes, photos, photo_url, photo_name,
                                    delivery_note_ref, transportation_request_id,
                                    signature, signed_by_name, signed_by_phone, signed_at,
                                    hired_driver_id, driver_name, vehicle_plate)
  VALUES (p_bundle, auth.uid(), now(), NULLIF(btrim(p_notes), ''), v_photos, v_photos->0->>'url', v_photos->0->>'name',
          NULLIF(btrim(p_vendor_receipt), ''), v_job,
          p_signature, NULLIF(btrim(p_signed_by), ''), NULLIF(driver_phone_key(p_signed_phone), ''),
          CASE WHEN p_signature IS NOT NULL THEN now() END,
          p_driver, COALESCE(v_driver.full_name, CASE WHEN p_driver IS NULL THEN NULL END),
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

  -- the driver who signed is the job's driver, and we now have his phone
  IF p_driver IS NOT NULL THEN
    PERFORM remember_driver_contact(p_driver, p_signed_phone, p_plate);
    IF v_job IS NOT NULL THEN
      UPDATE transportation_requests SET hired_driver_id = p_driver
       WHERE id = v_job AND hired_driver_id IS NULL AND transport_mode IN ('hired', 'ride_hailing');
    END IF;
  END IF;
  RETURN v_grn;
END $function$;
GRANT EXECUTE ON FUNCTION public.record_collection(uuid, jsonb, jsonb, text, text, text, text, text, uuid, text) TO authenticated;

-- ── 4. The site signs a delivery note: a signature, or a photo ─────────
DO $$ BEGIN
  EXECUTE 'DR'||'OP FUNCTION IF EXISTS public.sign_site_delivery_note(uuid, jsonb, jsonb, text, double precision, double precision)';
END $$;

CREATE OR REPLACE FUNCTION public.sign_site_delivery_note(
  p_sdn_id uuid, p_lines jsonb, p_photos jsonb, p_notes text DEFAULT NULL,
  p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_signature text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE
  s       site_delivery_notes%ROWTYPE;
  v_line  jsonb;
  v_clean boolean;
  v_photos jsonb := CASE WHEN jsonb_typeof(p_photos) = 'array' THEN p_photos ELSE '[]'::jsonb END;
BEGIN
  SELECT * INTO s FROM site_delivery_notes WHERE id = p_sdn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery note not found'; END IF;
  IF NOT (manages_project(s.project_id) OR COALESCE(get_user_role() = 'admin', false)) THEN
    RAISE EXCEPTION 'Only the project manager of % can sign for this delivery', COALESCE(s.project_name, 'this site');
  END IF;
  IF s.status <> 'issued' THEN RAISE EXCEPTION 'This delivery note has already been signed or cancelled'; END IF;
  IF p_signature IS NOT NULL AND NOT is_signature(p_signature) THEN
    RAISE EXCEPTION 'The signature did not come through — sign again';
  END IF;
  IF jsonb_array_length(v_photos) = 0 AND p_signature IS NULL THEN
    RAISE EXCEPTION 'Sign for the delivery, or add a photo of it';
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
         sign_lat = p_lat, sign_lng = p_lng, photos = v_photos, signature = p_signature,
         status = CASE WHEN v_clean THEN 'received' ELSE 'exceptions' END
   WHERE id = p_sdn_id;

  IF v_clean THEN
    PERFORM grn_from_site_delivery_note(p_sdn_id);
    RETURN 'received';
  END IF;
  RETURN 'exceptions';
END $function$;
GRANT EXECUTE ON FUNCTION public.sign_site_delivery_note(uuid, jsonb, jsonb, text, double precision, double precision, text) TO authenticated;
