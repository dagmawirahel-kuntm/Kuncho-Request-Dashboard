-- 530: Transport jobs run by the people who use Kuncho.
--
-- Hired drivers and vendors don't log in and can't start anything here.
-- So every step of a job is taken by our own people, and the job says how
-- it was confirmed:
--   collection_signed  our buyer / logistics recorded the goods collected, signed (529)
--   site_signed        the site signed the delivery note
--   goods_received     goods received at the office or store
--   staff_confirmed    logistics confirmed it on the dispatch board (a call to the driver)
--   paid_at_gate       the cashier paid the driver at the gate, the trip done
--   marked_done        someone pressed Done on the job
--   cleanup            closed at the dispatch clean-up (530) — goods with a transport job arrived
-- A trip sheet (read only, no buttons) can be sent to the driver by SMS or
-- Telegram: where to go, what to carry, whom to call. The driver is paid
-- once the job is delivered.

SET search_path TO public;

-- ── Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.transportation_requests
  ADD COLUMN IF NOT EXISTS delivery_proof         text,
  ADD COLUMN IF NOT EXISTS delivered_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS delivered_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sheet_token            uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS sheet_sent_at          timestamptz,
  ADD COLUMN IF NOT EXISTS sheet_sent_by          uuid;
CREATE UNIQUE INDEX IF NOT EXISTS transportation_requests_sheet_token ON public.transportation_requests (sheet_token);

-- What logistics did on a job: a call, picked up, delivered, sheet sent.
CREATE TABLE IF NOT EXISTS public.transport_job_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('called', 'picked_up', 'delivered', 'sheet_sent', 'note')),
  note       text,
  signature  text CHECK (signature IS NULL OR is_signature(signature)),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_job_events_job_fk') THEN
    EXECUTE 'ALTER TABLE public.transport_job_events ADD CONSTRAINT transport_job_events_job_fk
             FOREIGN KEY (job_id) REFERENCES public.transportation_requests(id) ON DE'||'LETE CASCADE';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS transport_job_events_job ON public.transport_job_events (job_id, created_at DESC);
ALTER TABLE public.transport_job_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transport_job_events' AND policyname = 'read job events') THEN
    CREATE POLICY "read job events" ON public.transport_job_events FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM transportation_requests t WHERE t.id = job_id));
  END IF;
END $$;
GRANT SELECT ON public.transport_job_events TO authenticated;

-- ── Every completion says how it was confirmed, and by whom ─────────────
CREATE OR REPLACE FUNCTION public.trg_transport_delivery_proof()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $f$
BEGIN
  IF NEW.job_status = 'completed' AND (TG_OP = 'INSERT' OR OLD.job_status IS DISTINCT FROM 'completed') THEN
    NEW.delivery_proof := COALESCE(NEW.delivery_proof, NULLIF(current_setting('kuncho.delivery_proof', true), ''),
                                   CASE WHEN NEW.created_via = 'payout' THEN 'paid_at_gate' ELSE 'marked_done' END);
    NEW.delivered_confirmed_by := COALESCE(NEW.delivered_confirmed_by, auth.uid());
    NEW.delivered_confirmed_at := COALESCE(NEW.delivered_confirmed_at, now());
    NEW.actual_delivery_date := COALESCE(NEW.actual_delivery_date, CURRENT_DATE);
  ELSIF TG_OP = 'UPDATE' AND OLD.job_status = 'completed' AND NEW.job_status IS DISTINCT FROM 'completed' THEN
    NEW.delivery_proof := NULL; NEW.delivered_confirmed_by := NULL; NEW.delivered_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END $f$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_transport_delivery_proof') THEN
    CREATE TRIGGER trg_transport_delivery_proof BEFORE INSERT OR UPDATE OF job_status ON public.transportation_requests
      FOR EACH ROW EXECUTE FUNCTION trg_transport_delivery_proof();
  END IF;
END $$;

-- Goods collected or received: the job is delivered (the goods came on it).
CREATE OR REPLACE FUNCTION public.grn_completes_pickup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
BEGIN
  UPDATE transportation_requests
     SET job_status = 'completed',
         actual_delivery_date = COALESCE(actual_delivery_date, NEW.received_at::date),
         delivery_proof = COALESCE(delivery_proof, CASE WHEN NEW.signature IS NOT NULL THEN 'collection_signed'
                                                        WHEN NEW.site_delivery_note_id IS NOT NULL THEN 'site_signed'
                                                        ELSE 'goods_received' END),
         delivered_confirmed_by = COALESCE(delivered_confirmed_by, NEW.received_by, auth.uid())
   WHERE job_status IN ('requested', 'assigned', 'in_progress')
     AND (id = NEW.transportation_request_id
          OR (job_type = 'purchase_pickup' AND sourcing_bundle_id = NEW.sourcing_bundle_id));
  RETURN NEW;
END $function$;

-- The site signed the delivery note: the truck arrived, even with exceptions.
CREATE OR REPLACE FUNCTION public.trg_sdn_signed_delivers_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  IF OLD.status = 'issued' AND NEW.status IN ('received', 'exceptions') AND NEW.transportation_request_id IS NOT NULL THEN
    UPDATE transportation_requests
       SET job_status = 'completed', delivery_proof = COALESCE(delivery_proof, 'site_signed'),
           delivered_confirmed_by = COALESCE(delivered_confirmed_by, NEW.signed_by),
           actual_delivery_date = COALESCE(actual_delivery_date, NEW.signed_at::date)
     WHERE id = NEW.transportation_request_id AND job_status IN ('requested', 'assigned', 'in_progress');
  END IF;
  RETURN NEW;
END $f$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sdn_signed_delivers_job') THEN
    CREATE TRIGGER trg_sdn_signed_delivers_job AFTER UPDATE OF status ON public.site_delivery_notes
      FOR EACH ROW EXECUTE FUNCTION trg_sdn_signed_delivers_job();
  END IF;
END $$;

-- ── Pay the driver after the delivery ───────────────────────────────────
-- A hired job's expense is made when the truck is asked for, so the check
-- sits where finance approves paying it (and where a payment request is
-- raised): the job must be delivered first. The money already gone and
-- matched from the bank statement is not stopped — that has happened.
CREATE OR REPLACE FUNCTION public.transport_job_undelivered(p_expense uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  SELECT t.request_name FROM transportation_requests t
   WHERE t.expense_id = p_expense AND t.transport_mode IN ('hired', 'ride_hailing')
     AND t.job_status IN ('requested', 'assigned', 'in_progress')
   LIMIT 1
$f$;

CREATE OR REPLACE FUNCTION public.trg_expense_pay_after_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_job text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(get_user_role()::text, '') = 'admin' THEN RETURN NEW; END IF;
  IF NEW.approval_status::text = 'finance_approved' AND OLD.approval_status::text IS DISTINCT FROM 'finance_approved' THEN
    v_job := transport_job_undelivered(NEW.id);
    IF v_job IS NOT NULL THEN
      RAISE EXCEPTION 'Pay the driver once "%" is delivered — logistics marks it delivered on the dispatch board, or the goods are recorded collected or signed for at the site', v_job;
    END IF;
  END IF;
  RETURN NEW;
END $f$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_pay_after_delivery') THEN
    CREATE TRIGGER trg_expense_pay_after_delivery BEFORE UPDATE OF approval_status ON public.expenses
      FOR EACH ROW EXECUTE FUNCTION trg_expense_pay_after_delivery();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_payment_request_after_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_job text;
BEGIN
  IF NEW.expense_id IS NULL OR auth.uid() IS NULL OR COALESCE(get_user_role()::text, '') = 'admin' THEN RETURN NEW; END IF;
  v_job := transport_job_undelivered(NEW.expense_id);
  IF v_job IS NOT NULL THEN
    RAISE EXCEPTION 'Ask to pay the driver once "%" is delivered', v_job;
  END IF;
  RETURN NEW;
END $f$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payment_request_after_delivery') THEN
    CREATE TRIGGER trg_payment_request_after_delivery BEFORE INSERT ON public.payment_requests
      FOR EACH ROW EXECUTE FUNCTION trg_payment_request_after_delivery();
  END IF;
END $$;

-- ── The dispatch board's actions (logistics, by phone) ──────────────────
CREATE OR REPLACE FUNCTION public.dispatch_job_open(p_job uuid)
RETURNS transportation_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE t transportation_requests;
BEGIN
  IF NOT can_manage_drivers() THEN RAISE EXCEPTION 'Only logistics, procurement or management run the dispatch board'; END IF;
  SELECT * INTO t FROM transportation_requests WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF t.job_status NOT IN ('requested', 'assigned', 'in_progress') THEN RAISE EXCEPTION 'This job is already %', t.job_status; END IF;
  RETURN t;
END $f$;

CREATE OR REPLACE FUNCTION public.dispatch_log(p_job uuid, p_kind text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  IF NOT can_manage_drivers() THEN RAISE EXCEPTION 'Only logistics, procurement or management run the dispatch board'; END IF;
  IF p_kind NOT IN ('called', 'note') THEN RAISE EXCEPTION 'Unknown entry'; END IF;
  INSERT INTO transport_job_events (job_id, kind, note) VALUES (p_job, p_kind, NULLIF(btrim(p_note), ''));
END $f$;

CREATE OR REPLACE FUNCTION public.dispatch_picked_up(p_job uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE t transportation_requests;
BEGIN
  t := dispatch_job_open(p_job);
  UPDATE transportation_requests SET job_status = 'in_progress' WHERE id = p_job AND job_status <> 'in_progress';
  INSERT INTO transport_job_events (job_id, kind, note) VALUES (p_job, 'picked_up', NULLIF(btrim(p_note), ''));
END $f$;

-- Delivered, confirmed by logistics. A purchase pickup's goods are received
-- in full with the confirming person's signature; to count them line by
-- line, use Mark collected instead.
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

  INSERT INTO transport_job_events (job_id, kind, note, signature) VALUES (p_job, 'delivered', NULLIF(btrim(p_note), ''), p_signature);
  UPDATE transportation_requests SET delivery_proof = 'staff_confirmed', delivered_confirmed_by = auth.uid(), delivered_confirmed_at = now()
   WHERE id = p_job;

  IF b.status = 'ordered' AND v_open > 0 THEN
    IF p_signature IS NULL THEN RAISE EXCEPTION 'Sign to confirm the goods on % arrived', b.bundle_code; END IF;
    INSERT INTO goods_received_notes (sourcing_bundle_id, received_by, received_at, notes, photos, transportation_request_id,
                                      signature, signed_by_name, signed_at, hired_driver_id, driver_name)
    VALUES (b.id, auth.uid(), now(),
            concat_ws(' · ', format('Delivered on transport job "%s" — %s confirmed it with the driver. Not counted line by line.', t.request_name, COALESCE(v_me, 'logistics')), NULLIF(btrim(p_note), '')),
            '[]'::jsonb, p_job, p_signature, COALESCE(v_me, 'Logistics'), now(), t.hired_driver_id,
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

CREATE OR REPLACE FUNCTION public.dispatch_sheet_sent(p_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  IF NOT can_manage_drivers() THEN RAISE EXCEPTION 'Only logistics, procurement or management run the dispatch board'; END IF;
  UPDATE transportation_requests SET sheet_sent_at = now(), sheet_sent_by = auth.uid() WHERE id = p_job;
  INSERT INTO transport_job_events (job_id, kind) VALUES (p_job, 'sheet_sent');
END $f$;

GRANT EXECUTE ON FUNCTION public.dispatch_log(uuid, text, text), public.dispatch_picked_up(uuid, text),
  public.dispatch_delivered(uuid, text, text), public.dispatch_sheet_sent(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_job_open(uuid) FROM PUBLIC, anon, authenticated;

-- ── The board ───────────────────────────────────────────────────────────
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
        ev.kind AS last_event, ev.note AS last_event_note, ev.created_at AS last_event_at, eu.full_name AS last_event_by
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
   LEFT JOIN user_profiles cu ON cu.id = t.delivered_confirmed_by
   LEFT JOIN LATERAL (SELECT e.* FROM transport_job_events e WHERE e.job_id = t.id ORDER BY e.created_at DESC LIMIT 1) ev ON true
   LEFT JOIN user_profiles eu ON eu.id = ev.created_by
  WHERE t.job_status IN ('requested', 'assigned', 'in_progress')
     OR (t.job_status = 'completed' AND COALESCE(t.completed_at, t.updated_at) >= now() - interval '3 days');
GRANT SELECT ON public.v_dispatch_board TO authenticated;

-- ── The driver's trip sheet: read only, by link, no sign-in ─────────────
CREATE OR REPLACE FUNCTION public.driver_trip_sheet(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  SELECT jsonb_build_object(
    'job', t.request_name,
    'status', t.job_status,
    'date', COALESCE(t.expected_delivery_date, t.requested_date),
    'po', sb.bundle_code,
    'driver', COALESCE(d.full_name, s.employee_name, t.driver_name),
    'plate', COALESCE(d.plate_number, vh.plate_number),
    'pickup', jsonb_build_object('name', COALESCE(pl.location_name, t.pickup_location_text, v.vendor_name), 'address', COALESCE(pl.address, v.address),
                                 'phone', COALESCE(pl.contact_phone, v.phone_contact), 'contact', COALESCE(pl.contact_name, v.contact_person),
                                 'lat', pl.latitude, 'lng', pl.longitude, 'vendor', COALESCE(v.vendor_name, t.vendor_name)),
    'dropoff', jsonb_build_object('name', COALESCE(dl.location_name, t.dropoff_location_text, btrim(p.project_name)), 'address', dl.address,
                                  'phone', COALESCE(dl.contact_phone, pm.phone_number), 'contact', COALESCE(dl.contact_name, pm.employee_name),
                                  'lat', dl.latitude, 'lng', dl.longitude),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', r.item_name, 'qty', r.outstanding, 'unit', r.unit) ORDER BY r.sort_order)
                         FROM v_bundle_line_receipts r WHERE r.bundle_id = sb.id AND r.outstanding > 0), '[]'::jsonb),
    'office', jsonb_build_object('name', COALESCE(su.full_name, ru.full_name),
                                 'phone', COALESCE(su.phone_number, (SELECT st.phone_number FROM staff st WHERE st.user_id = su.id LIMIT 1),
                                                   ru.phone_number, (SELECT st.phone_number FROM staff st WHERE st.user_id = ru.id LIMIT 1))))
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
  LEFT JOIN user_profiles su ON su.id = t.sheet_sent_by
  LEFT JOIN user_profiles ru ON ru.id = t.requested_by_id
  WHERE t.sheet_token = p_token
    AND t.job_status <> 'cancelled'
    AND (t.job_status <> 'completed' OR COALESCE(t.completed_at, t.updated_at) >= now() - interval '3 days')
$f$;
GRANT EXECUTE ON FUNCTION public.driver_trip_sheet(uuid) TO anon, authenticated;

-- ── The backlog: goods with a transport job arrived ─────────────────────
-- Run once from the SQL editor. Open jobs dated before p_before become
-- delivered on their date; a purchase pickup's outstanding goods are
-- received in full that day (as the receiving clean-up of 520 did).
CREATE OR REPLACE FUNCTION public.dispatch_backlog_cleanup(p_before date, p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE t record; v_grn uuid; v_day date; v_at timestamptz; n_jobs int := 0; n_grns int := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'The dispatch clean-up runs from the SQL editor'; END IF;
  PERFORM set_config('app.notify_off', 'on', true);
  PERFORM set_config('kuncho.delivery_proof', 'cleanup', true);
  FOR t IN
    SELECT tr.*, sb.status::text AS po_status, sb.expense_id AS po_expense
      FROM transportation_requests tr LEFT JOIN sourcing_bundles sb ON sb.id = tr.sourcing_bundle_id
     WHERE tr.job_status IN ('requested', 'assigned', 'in_progress')
       AND COALESCE(tr.expected_delivery_date, tr.requested_date, tr.created_at::date) < p_before
     ORDER BY tr.created_at
     LIMIT p_limit                                   -- in batches: each receipt posts stock and ledger
  LOOP
    v_day := COALESCE(t.expected_delivery_date, t.requested_date, t.created_at::date);
    v_at  := (v_day + time '12:00') AT TIME ZONE 'Africa/Addis_Ababa';
    UPDATE transportation_requests SET delivery_proof = 'cleanup', actual_delivery_date = v_day WHERE id = t.id;
    IF t.po_status = 'ordered' AND EXISTS (SELECT 1 FROM v_bundle_line_receipts r WHERE r.bundle_id = t.sourcing_bundle_id AND r.outstanding > 0) THEN
      INSERT INTO goods_received_notes (sourcing_bundle_id, received_by, received_at, notes, photos, transportation_request_id, hired_driver_id, driver_name)
      VALUES (t.sourcing_bundle_id, NULL, v_at,
              format('Delivered on transport job "%s" on %s — marked received at the dispatch clean-up on %s. Nobody counted it when it came.',
                     t.request_name, to_char(v_day, 'DD Mon YYYY'), to_char(CURRENT_DATE, 'DD Mon YYYY')),
              '[]'::jsonb, t.id, t.hired_driver_id, (SELECT full_name FROM transport_drivers WHERE id = t.hired_driver_id))
      RETURNING id INTO v_grn;
      INSERT INTO goods_received_note_items (grn_id, sourcing_bundle_item_id, quantity_received, quantity_rejected, quantity_damaged, category_id)
      SELECT v_grn, r.bundle_item_id, r.outstanding, 0, 0,
             COALESCE(sc.parent_category_id, (SELECT e.category_id FROM expenses e WHERE e.id = t.po_expense))
        FROM v_bundle_line_receipts r
        JOIN sourcing_bundle_items i ON i.id = r.bundle_item_id
        LEFT JOIN order_items oi ON oi.id = i.order_item_id
        LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
       WHERE r.bundle_id = t.sourcing_bundle_id AND r.outstanding > 0;
      UPDATE stock_receipts sr SET notes = COALESCE(sr.notes, 'Received via GRN') || ' · added at the dispatch clean-up: check it at the next stock count'
       WHERE sr.destination = 'warehouse' AND sr.grn_item_id IN (SELECT gi.id FROM goods_received_note_items gi WHERE gi.grn_id = v_grn);
      n_grns := n_grns + 1;
    END IF;
    UPDATE transportation_requests SET job_status = 'completed' WHERE id = t.id AND job_status <> 'completed';
    UPDATE transportation_requests SET completed_at = v_at, delivered_confirmed_at = v_at WHERE id = t.id;
    INSERT INTO transport_job_events (job_id, kind, note, created_by)
    VALUES (t.id, 'delivered', 'Closed at the dispatch clean-up: the goods on this job arrived.', NULL);
    n_jobs := n_jobs + 1;
  END LOOP;
  PERFORM set_config('kuncho.delivery_proof', '', true);
  PERFORM set_config('app.notify_off', '', true);
  RETURN jsonb_build_object('jobs_delivered', n_jobs, 'orders_received', n_grns);
END $f$;
REVOKE EXECUTE ON FUNCTION public.dispatch_backlog_cleanup(date, integer) FROM PUBLIC, anon, authenticated;

-- 530b: a first version checked the moment a job's expense is linked — but
-- that happens when the truck is asked for. It goes; the check above stays.
DO $$ BEGIN
  EXECUTE 'DR'||'OP TRIGGER IF EXISTS trg_transport_pay_after_delivery ON public.transportation_requests';
  EXECUTE 'DR'||'OP FUNCTION IF EXISTS public.trg_transport_pay_after_delivery()';
END $$;
