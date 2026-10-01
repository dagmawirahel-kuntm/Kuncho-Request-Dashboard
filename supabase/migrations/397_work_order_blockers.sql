-- 397 — Blockers that belong to a work order, and what they do to it
--
-- The work order page listed "blockers" for the whole project: every
-- purchase request on it not yet delivered (26 on an average open order)
-- and any HSE incident that day. Nobody chose them, they were the same on
-- every order of the project, and they changed nothing about the order.
--
-- Now a blocker is raised on the order it holds up:
--   • what kind (materials, labour, safety, client, design, equipment,
--     access, other), what is holding it, and since when;
--   • whether it STOPS the work or only slows it, and which part of the
--     job (an item) if not all of it;
--   • optionally the purchase request or HSE incident behind it — those
--     clear the blocker by themselves when the materials arrive (every line
--     on a fulfilled PO) or the incident is closed;
--   • when it is expected to clear.
-- Its effect on the order:
--   • a stopping blocker makes the order Blocked on the board;
--   • the days the work was stopped are counted (overlaps once) and push
--     the due date: v_work_order_board.days_lost / adjusted_due_date;
--   • raising and clearing write the order's timeline.
-- The people on the job raise them; they or the managers clear them.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS work_order_blockers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('materials', 'labour', 'safety', 'client', 'design', 'equipment', 'access', 'other')),
  description       text NOT NULL CHECK (btrim(description) <> ''),
  stops_work        boolean NOT NULL DEFAULT true,
  work_order_item_id uuid REFERENCES work_order_items(id) ON DELETE SET NULL,
  order_id          uuid REFERENCES orders(id) ON DELETE SET NULL,
  hse_incident_id   uuid REFERENCES hse_incidents(id) ON DELETE SET NULL,
  expected_clear_date date,
  raised_at         timestamptz NOT NULL DEFAULT now(),
  raised_by         uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  cleared_at        timestamptz,
  cleared_by        uuid REFERENCES auth.users(id),
  cleared_note      text,
  cleared_automatically boolean NOT NULL DEFAULT false,
  CHECK (cleared_at IS NULL OR cleared_at >= raised_at)
);
CREATE INDEX IF NOT EXISTS idx_wo_blockers_open ON work_order_blockers (work_order_id) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wo_blockers_order ON work_order_blockers (order_id) WHERE cleared_at IS NULL AND order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wo_blockers_hse ON work_order_blockers (hse_incident_id) WHERE cleared_at IS NULL AND hse_incident_id IS NOT NULL;
COMMENT ON TABLE work_order_blockers IS 'What is holding up a work order, and whether it stops the work (397).';

ALTER TABLE work_order_blockers ENABLE ROW LEVEL SECURITY;
CREATE POLICY wo_blockers_read ON work_order_blockers FOR SELECT USING (auth.uid() IS NOT NULL);
-- Written through raise_/clear_work_order_blocker only.

-- A purchase request is delivered when every line still wanted is on a
-- fulfilled PO (a GRN recorded against it).
CREATE OR REPLACE FUNCTION public.order_delivered(p_order uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = p_order AND oi.status::text <> 'cancelled')
     AND NOT EXISTS (
       SELECT 1 FROM order_items oi
        WHERE oi.order_id = p_order AND oi.status::text <> 'cancelled'
          AND NOT EXISTS (SELECT 1 FROM sourcing_bundle_items sbi JOIN sourcing_bundles b ON b.id = sbi.bundle_id
                           WHERE sbi.order_item_id = oi.id AND b.status::text = 'fulfilled'))
$$;

CREATE OR REPLACE FUNCTION public.blocker_label(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind WHEN 'materials' THEN 'Waiting for materials' WHEN 'labour' THEN 'Short of people'
    WHEN 'safety' THEN 'Safety issue' WHEN 'client' THEN 'Waiting on the client' WHEN 'design' THEN 'Waiting on design'
    WHEN 'equipment' THEN 'Equipment/tools' WHEN 'access' THEN 'No access to the site' ELSE 'Blocked' END
$$;

-- A line on the order's timeline. wo_progress_updates needs a staff
-- member: the person acting, else whoever raised the blocker; with neither
-- (an admin with no staff record) the line is skipped, never the action.
CREATE OR REPLACE FUNCTION public.wo_timeline_note(p_wo uuid, p_note text, p_staff uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF p_staff IS NULL THEN RETURN; END IF;
  INSERT INTO wo_progress_updates (work_order_id, progress_pct, note, updated_by_staff_id)
  SELECT p_wo, w.current_progress_pct, p_note, p_staff FROM work_orders w WHERE w.id = p_wo;
END $function$;
REVOKE EXECUTE ON FUNCTION wo_timeline_note(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.raise_work_order_blocker(p_wo uuid, p_kind text, p_description text,
  p_stops_work boolean DEFAULT true, p_item uuid DEFAULT NULL, p_order uuid DEFAULT NULL,
  p_hse uuid DEFAULT NULL, p_expected date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE w work_orders%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO w FROM work_orders WHERE id = p_wo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF NOT (can_run_work_order(p_wo) OR works_on_work_order(p_wo)) THEN
    RAISE EXCEPTION 'Only the people on this job, the site''s team or operations can raise a blocker';
  END IF;
  IF w.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This work order is %', w.status; END IF;
  IF NULLIF(btrim(p_description), '') IS NULL THEN RAISE EXCEPTION 'Say what is holding it up'; END IF;
  IF p_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM work_order_items WHERE id = p_item AND work_order_id = p_wo) THEN
    RAISE EXCEPTION 'That part is not on this work order';
  END IF;
  IF p_order IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order AND project_id = w.project_id) THEN
    RAISE EXCEPTION 'That purchase request is for another project';
  END IF;
  IF p_order IS NOT NULL AND order_delivered(p_order) THEN
    RAISE EXCEPTION 'Those materials have already arrived';
  END IF;

  INSERT INTO work_order_blockers (work_order_id, kind, description, stops_work, work_order_item_id, order_id, hse_incident_id, expected_clear_date)
  VALUES (p_wo, p_kind, btrim(p_description), COALESCE(p_stops_work, true), p_item, p_order, p_hse, p_expected)
  RETURNING id INTO v_id;

  PERFORM wo_timeline_note(p_wo,
          CASE WHEN COALESCE(p_stops_work, true) THEN 'Work stopped — ' ELSE 'Slowed — ' END
            || blocker_label(p_kind) || ': ' || btrim(p_description)
            || COALESCE(' (expected to clear ' || to_char(p_expected, 'DD Mon') || ')', ''),
          current_staff_id());
  RETURN v_id;
END $function$;

-- Clears one blocker. p_auto: cleared by the system (materials arrived,
-- incident closed), so no person check.
CREATE OR REPLACE FUNCTION public.clear_work_order_blocker(p_id uuid, p_note text DEFAULT NULL, p_auto boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE b work_order_blockers%ROWTYPE;
BEGIN
  SELECT * INTO b FROM work_order_blockers WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Blocker not found'; END IF;
  IF b.cleared_at IS NOT NULL THEN RETURN; END IF;
  IF NOT p_auto AND NOT (can_run_work_order(b.work_order_id) OR works_on_work_order(b.work_order_id)) THEN
    RAISE EXCEPTION 'Only the people on this job, the site''s team or operations can clear a blocker';
  END IF;
  UPDATE work_order_blockers
     SET cleared_at = now(), cleared_by = CASE WHEN p_auto THEN NULL ELSE auth.uid() END,
         cleared_note = NULLIF(btrim(p_note), ''), cleared_automatically = p_auto
   WHERE id = p_id;
  PERFORM wo_timeline_note(b.work_order_id,
          'Cleared — ' || blocker_label(b.kind) || ': ' || b.description
            || COALESCE(' · ' || NULLIF(btrim(p_note), ''), '')
            || CASE WHEN b.stops_work THEN format(' (%s day%s lost)', GREATEST(CURRENT_DATE - b.raised_at::date, 0),
                                                  CASE WHEN CURRENT_DATE - b.raised_at::date = 1 THEN '' ELSE 's' END) ELSE '' END,
          COALESCE(CASE WHEN NOT p_auto THEN current_staff_id() END,
                   (SELECT s.id FROM staff s WHERE s.user_id = b.raised_by LIMIT 1)));
END $function$;

REVOKE EXECUTE ON FUNCTION raise_work_order_blocker(uuid, text, text, boolean, uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION raise_work_order_blocker(uuid, text, text, boolean, uuid, uuid, uuid, date) TO authenticated;
-- Supabase grants new functions to authenticated by default; this one
-- takes p_auto (skip the person check), so only the definer may call it.
REVOKE EXECUTE ON FUNCTION clear_work_order_blocker(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
-- The automatic path (p_auto) is for the triggers below; a person clears
-- through the wrapper, which never passes it.
CREATE OR REPLACE FUNCTION public.clear_my_work_order_blocker(p_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT clear_work_order_blocker(p_id, p_note, false) $$;
REVOKE EXECUTE ON FUNCTION clear_my_work_order_blocker(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION clear_my_work_order_blocker(uuid, text) TO authenticated;

-- Materials arrived: a PO turning fulfilled clears the blockers waiting on
-- purchase requests that are now fully delivered.
CREATE OR REPLACE FUNCTION public.trg_clear_blockers_on_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE b record;
BEGIN
  IF NEW.status::text = 'fulfilled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    FOR b IN
      SELECT DISTINCT wb.id FROM work_order_blockers wb
        JOIN order_items oi ON oi.order_id = wb.order_id
        JOIN sourcing_bundle_items sbi ON sbi.order_item_id = oi.id AND sbi.bundle_id = NEW.id
       WHERE wb.cleared_at IS NULL AND order_delivered(wb.order_id)
    LOOP
      PERFORM clear_work_order_blocker(b.id, 'Materials arrived', true);
    END LOOP;
  END IF;
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_clear_blockers_on_delivery AFTER UPDATE OF status ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION trg_clear_blockers_on_delivery();

-- Incident closed: the safety blocker on it clears.
CREATE OR REPLACE FUNCTION public.trg_clear_blockers_on_incident()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE b record;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND lower(COALESCE(NEW.status, '')) IN ('closed', 'resolved') THEN
    FOR b IN SELECT id FROM work_order_blockers WHERE hse_incident_id = NEW.id AND cleared_at IS NULL LOOP
      PERFORM clear_work_order_blocker(b.id, 'Incident closed', true);
    END LOOP;
  END IF;
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_clear_blockers_on_incident AFTER UPDATE OF status ON hse_incidents
  FOR EACH ROW EXECUTE FUNCTION trg_clear_blockers_on_incident();

-- A finished or cancelled order has nothing left to block.
CREATE OR REPLACE FUNCTION public.trg_clear_blockers_on_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE work_order_blockers SET cleared_at = now(), cleared_automatically = true,
           cleared_note = 'Work order ' || NEW.status
     WHERE work_order_id = NEW.id AND cleared_at IS NULL;
  END IF;
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_clear_blockers_on_close AFTER UPDATE OF status ON work_orders
  FOR EACH ROW EXECUTE FUNCTION trg_clear_blockers_on_close();

-- Days the work was stopped: each calendar day covered by at least one
-- stopping blocker counts once.
CREATE OR REPLACE FUNCTION public.work_order_days_lost(p_wo uuid)
RETURNS int LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT count(DISTINCT d)::int
    FROM work_order_blockers b
   CROSS JOIN LATERAL generate_series(b.raised_at::date, COALESCE(b.cleared_at::date, CURRENT_DATE) - 1, interval '1 day') d
   WHERE b.work_order_id = p_wo AND b.stops_work
$$;

-- The board gains what blockers do to each order.
-- New columns go at the end, so the view is replaced in place.
CREATE OR REPLACE VIEW public.v_work_order_board WITH (security_invoker = true) AS
SELECT w.id AS work_order_id,
       (SELECT count(*) FROM work_order_items i WHERE i.work_order_id = w.id) AS items_total,
       (SELECT count(*) FROM work_order_items i WHERE i.work_order_id = w.id
          AND (CASE WHEN i.quantity IS NULL THEN i.done_quantity > 0 ELSE i.done_quantity >= i.quantity END)) AS items_done,
       GREATEST((SELECT max(u.created_at) FROM wo_progress_updates u WHERE u.work_order_id = w.id),
                (SELECT max(e.recorded_at) FROM labour_work_entries e JOIN labor_requisitions r ON r.id = e.labor_requisition_id WHERE r.work_order_id = w.id)) AS last_update_at,
       (SELECT count(*) FROM labor_requisitions r WHERE r.work_order_id = w.id AND r.status <> 'rejected' AND r.closed_at IS NULL) AS open_labour_requests,
       COALESCE((SELECT sum(l.confirmed_cost + l.recorded_cost) FROM v_work_order_labour l WHERE l.work_order_id = w.id), 0) AS labour_cost,
       (SELECT count(*) FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL) AS open_blockers,
       (SELECT count(*) FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL AND b.stops_work) AS stopping_blockers,
       (SELECT min(b.raised_at) FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL AND b.stops_work) AS blocked_since,
       (SELECT b.kind FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL
         ORDER BY b.stops_work DESC, b.raised_at LIMIT 1) AS main_blocker_kind,
       (SELECT b.description FROM work_order_blockers b WHERE b.work_order_id = w.id AND b.cleared_at IS NULL
         ORDER BY b.stops_work DESC, b.raised_at LIMIT 1) AS main_blocker,
       work_order_days_lost(w.id) AS days_lost,
       CASE WHEN w.target_completion_date IS NOT NULL THEN w.target_completion_date + work_order_days_lost(w.id) END AS adjusted_due_date
FROM work_orders w;
GRANT SELECT ON v_work_order_board TO authenticated;
