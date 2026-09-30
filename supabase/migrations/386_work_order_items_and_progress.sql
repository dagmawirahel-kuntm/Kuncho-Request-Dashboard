-- 386 — Work orders you can keep up to date from a phone
--
-- A work order's progress was one slider for the whole job, set by hand:
-- 25 orders in progress, 2 progress updates ever. Status was a field on the
-- edit form. Labour recorded on the new labour screens never reached it.
--
-- Now:
--   • a short title, and the job broken into items — "Gypsum ceiling
--     120 m²", "Paint 3 rooms", or a plain step to tick;
--   • record_work_order_progress() takes what is done on each item (and a
--     note and photo) in one go; progress is worked out from the items and
--     the order moves itself from requested to in progress;
--   • set_work_order_status() completes, cancels or reopens it with a note;
--   • v_work_order_board has what the list needs: items done, last update,
--     labour cost from the linked labour requests (confirmed and recorded);
--   • v_work_order_labour lists those requests on the order.
--
-- An order without items still takes an overall % as before.

SET search_path TO public;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE work_orders DISABLE TRIGGER trg_derive_task_progress_from_work_orders;
UPDATE work_orders SET title = left(btrim(regexp_replace(split_part(scope_of_work, E'\n', 1), '\s+', ' ', 'g')), 80)
 WHERE title IS NULL;
ALTER TABLE work_orders ENABLE TRIGGER trg_derive_task_progress_from_work_orders;

CREATE OR REPLACE FUNCTION public.can_run_work_order(p_wo uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(get_user_role() IN ('admin', 'executive', 'operations_manager', 'project_manager'), false)
      OR EXISTS (SELECT 1 FROM work_orders w WHERE w.id = p_wo
                 AND (manages_project(w.project_id) OR is_site_foreman_for_project(w.project_id)))
$$;

CREATE TABLE IF NOT EXISTS work_order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  description   text NOT NULL CHECK (btrim(description) <> ''),
  unit          text,
  quantity      numeric CHECK (quantity IS NULL OR quantity > 0),
  done_quantity numeric NOT NULL DEFAULT 0 CHECK (done_quantity >= 0),
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_order_items_wo ON work_order_items (work_order_id, sort_order);
COMMENT ON TABLE work_order_items IS 'What a work order is made of (386): a quantity to reach, or a step to tick (quantity null, done when done_quantity > 0).';

ALTER TABLE work_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wo_items_read ON work_order_items;
CREATE POLICY wo_items_read ON work_order_items FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS wo_items_write ON work_order_items;
CREATE POLICY wo_items_write ON work_order_items FOR ALL USING (can_run_work_order(work_order_id)) WITH CHECK (can_run_work_order(work_order_id));

-- Progress from the items: each item counts the same, done in proportion.
CREATE OR REPLACE FUNCTION public.work_order_items_progress(p_wo uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT round(100 * avg(LEAST(CASE WHEN quantity IS NULL THEN CASE WHEN done_quantity > 0 THEN 1 ELSE 0 END
                                    ELSE done_quantity / quantity END, 1)), 1)
    FROM work_order_items WHERE work_order_id = p_wo
$$;

CREATE OR REPLACE FUNCTION public.trg_work_order_items_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_wo uuid := COALESCE(NEW.work_order_id, OLD.work_order_id); v_pct numeric;
BEGIN
  v_pct := work_order_items_progress(v_wo);
  IF v_pct IS NOT NULL THEN
    UPDATE work_orders
       SET current_progress_pct = v_pct,
           status = CASE WHEN status = 'requested' AND v_pct > 0 THEN 'in_progress' ELSE status END
     WHERE id = v_wo AND (current_progress_pct IS DISTINCT FROM v_pct OR (status = 'requested' AND v_pct > 0));
  END IF;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_work_order_items_progress ON work_order_items;
CREATE TRIGGER trg_work_order_items_progress AFTER INSERT OR UPDATE OR DELETE ON work_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_work_order_items_progress();

-- One update from site: what is done on each item, a note, a photo.
-- p_items: [{id, done_quantity}] — done_quantity is the total done so far.
-- p_percent: the overall % for an order with no items.
CREATE OR REPLACE FUNCTION public.record_work_order_progress(p_wo uuid, p_items jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL, p_photo text DEFAULT NULL, p_percent numeric DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  w     work_orders%ROWTYPE;
  x     jsonb;
  v_pct numeric;
BEGIN
  SELECT * INTO w FROM work_orders WHERE id = p_wo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF NOT can_run_work_order(p_wo) THEN RAISE EXCEPTION 'Only the site''s team or operations can update this work order'; END IF;
  IF w.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This work order is %; reopen it to update it', w.status; END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    UPDATE work_order_items
       SET done_quantity = GREATEST(COALESCE((x->>'done_quantity')::numeric, 0), 0), updated_at = now()
     WHERE id = (x->>'id')::uuid AND work_order_id = p_wo
       AND done_quantity IS DISTINCT FROM GREATEST(COALESCE((x->>'done_quantity')::numeric, 0), 0);
  END LOOP;

  v_pct := COALESCE(work_order_items_progress(p_wo), LEAST(GREATEST(p_percent, 0), 100), w.current_progress_pct);
  IF NULLIF(btrim(p_note), '') IS NULL AND p_photo IS NULL AND v_pct = w.current_progress_pct AND jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RETURN v_pct;
  END IF;
  -- The update is the record of the day; its trigger sets current_progress_pct.
  INSERT INTO wo_progress_updates (work_order_id, progress_pct, note, photos, updated_by_staff_id)
  VALUES (p_wo, v_pct, NULLIF(btrim(p_note), ''), CASE WHEN p_photo IS NOT NULL THEN jsonb_build_array(p_photo) END, current_staff_id());
  UPDATE work_orders SET status = 'in_progress' WHERE id = p_wo AND status = 'requested' AND v_pct > 0;
  RETURN v_pct;
END $function$;

CREATE OR REPLACE FUNCTION public.set_work_order_status(p_wo uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE w work_orders%ROWTYPE;
BEGIN
  SELECT * INTO w FROM work_orders WHERE id = p_wo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF NOT can_run_work_order(p_wo) THEN RAISE EXCEPTION 'Only the site''s team or operations can change this work order'; END IF;
  IF p_status NOT IN ('requested', 'in_progress', 'completed', 'cancelled') THEN RAISE EXCEPTION 'Unknown status %', p_status; END IF;
  IF p_status = 'cancelled' AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why it is cancelled'; END IF;
  UPDATE work_orders SET status = p_status WHERE id = p_wo;
  INSERT INTO wo_progress_updates (work_order_id, progress_pct, note, updated_by_staff_id)
  VALUES (p_wo, CASE WHEN p_status = 'completed' THEN 100 ELSE w.current_progress_pct END,
          CASE p_status WHEN 'completed' THEN 'Completed' WHEN 'cancelled' THEN 'Cancelled' WHEN 'in_progress' THEN 'Reopened' ELSE 'Moved back to requested' END
            || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''),
          current_staff_id());
END $function$;

REVOKE EXECUTE ON FUNCTION record_work_order_progress(uuid, jsonb, text, text, numeric), set_work_order_status(uuid, text, text), can_run_work_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_work_order_progress(uuid, jsonb, text, text, numeric), set_work_order_status(uuid, text, text), can_run_work_order(uuid) TO authenticated;

-- Labour on the order: the labour requests linked to it, with what they cost.
CREATE OR REPLACE VIEW public.v_work_order_labour WITH (security_invoker = true) AS
SELECT r.work_order_id, r.id AS labor_requisition_id, r.role_needed, r.headcount, r.status, r.payment_basis,
       r.start_date, r.end_date, r.closed_at,
       COALESCE((SELECT sum(s.total) FROM labour_pay_sheets s WHERE s.labor_requisition_id = r.id), 0) AS confirmed_cost,
       COALESCE((SELECT sum(l.amount) FROM labour_pay_lines(r.id, CURRENT_DATE) l), 0) AS recorded_cost,
       (SELECT count(DISTINCT e.work_date) FROM labour_work_entries e WHERE e.labor_requisition_id = r.id) AS days_recorded,
       (SELECT max(e.work_date) FROM labour_work_entries e WHERE e.labor_requisition_id = r.id) AS last_recorded
FROM labor_requisitions r
WHERE r.work_order_id IS NOT NULL;

-- What the list shows for every order.
CREATE OR REPLACE VIEW public.v_work_order_board WITH (security_invoker = true) AS
SELECT w.id AS work_order_id,
       (SELECT count(*) FROM work_order_items i WHERE i.work_order_id = w.id) AS items_total,
       (SELECT count(*) FROM work_order_items i WHERE i.work_order_id = w.id
          AND (CASE WHEN i.quantity IS NULL THEN i.done_quantity > 0 ELSE i.done_quantity >= i.quantity END)) AS items_done,
       GREATEST((SELECT max(u.created_at) FROM wo_progress_updates u WHERE u.work_order_id = w.id),
                (SELECT max(e.recorded_at) FROM labour_work_entries e JOIN labor_requisitions r ON r.id = e.labor_requisition_id WHERE r.work_order_id = w.id)) AS last_update_at,
       (SELECT count(*) FROM labor_requisitions r WHERE r.work_order_id = w.id AND r.status <> 'rejected' AND r.closed_at IS NULL) AS open_labour_requests,
       COALESCE((SELECT sum(l.confirmed_cost + l.recorded_cost) FROM v_work_order_labour l WHERE l.work_order_id = w.id), 0) AS labour_cost
FROM work_orders w;
