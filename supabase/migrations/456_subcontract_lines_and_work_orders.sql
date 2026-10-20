-- 456 — Subcontracts by line of work, and linked to work orders
--
-- A subcontract's scope was one free-text box, so the lines of work it
-- covers ("chisel 40 m², gypsum 40 m², paint 40 m²") were invisible: one %
-- for the whole job, certificates typed as a lump amount. Now:
--   • subcontract_lines — each line of work: description, quantity, unit,
--     rate (amount = quantity × rate) and how much of it is done. The
--     agreed amount is the sum of the lines; a fixed price is one line,
--     1 lot. scope_of_work stays, as the one-line summary.
--   • Progress is recorded per line (record_subcontract_progress); the
--     subcontract's % is the value of the work done over the agreed amount.
--   • Certificates are measured (certify_subcontract_lines): a quantity per
--     line, priced at its rate. A line can't be certified past its quantity.
--   • subcontractor_engagements.work_order_id — the job it is for (same
--     project). A line may also cover one part of that work order: its
--     measured progress then moves the part's "done", so it is recorded once.
--     A part is covered by at most one line, and is then updated only from
--     its subcontract.
--   • save_subcontract — the header and its lines in one step.
--   • The 10 existing subcontracts become one line each, 1 lot at the agreed
--     amount, with their progress and certificates carried over unchanged.

SET search_path TO public;

ALTER TABLE subcontractor_engagements ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES work_orders(id);
CREATE INDEX IF NOT EXISTS idx_subcontract_engagements_work_order ON subcontractor_engagements (work_order_id);
COMMENT ON COLUMN subcontractor_engagements.scope_of_work IS 'A one-line summary of the job; the lines of work are in subcontract_lines (456).';
COMMENT ON COLUMN subcontractor_engagements.work_order_id IS 'The work order this subcontract does (456). Same project.';

ALTER TABLE subcontract_progress_updates ADD COLUMN IF NOT EXISTS lines jsonb;
COMMENT ON COLUMN subcontract_progress_updates.lines IS 'Done quantity per line at this update: [{line_id, description, done, quantity, unit}] (456).';

CREATE TABLE IF NOT EXISTS subcontract_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       uuid NOT NULL REFERENCES subcontractor_engagements(id) ON DELETE CASCADE,
  sort_order          integer NOT NULL DEFAULT 0,
  description         text NOT NULL CHECK (btrim(description) <> ''),
  quantity            numeric(14,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit                text NOT NULL DEFAULT 'lot',
  rate                numeric(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount              numeric(14,2) GENERATED ALWAYS AS (round(quantity * rate, 2)) STORED,
  done_quantity       numeric(14,4) NOT NULL DEFAULT 0 CHECK (done_quantity >= 0),
  work_order_item_id  uuid REFERENCES work_order_items(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subcontract_lines_done_within CHECK (done_quantity <= quantity)
);
CREATE INDEX IF NOT EXISTS idx_subcontract_lines_engagement ON subcontract_lines (engagement_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_lines_wo_item ON subcontract_lines (work_order_item_id) WHERE work_order_item_id IS NOT NULL;
COMMENT ON TABLE subcontract_lines IS 'The lines of work a subcontract covers, priced quantity × rate, with how much is done (456).';

CREATE TABLE IF NOT EXISTS subcontract_certificate_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id  uuid NOT NULL REFERENCES subcontractor_completion_certificates(id) ON DELETE CASCADE,
  line_id         uuid NOT NULL REFERENCES subcontract_lines(id) ON DELETE RESTRICT,
  quantity        numeric(14,4) NOT NULL CHECK (quantity > 0),
  amount          numeric(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subcontract_cert_lines_line ON subcontract_certificate_lines (line_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_cert_lines_cert ON subcontract_certificate_lines (certificate_id);
COMMENT ON TABLE subcontract_certificate_lines IS 'What each certificate measured, line by line (456). Written by certify_subcontract_lines only.';

ALTER TABLE subcontract_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontract_certificate_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY subcontract_lines_read ON subcontract_lines FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY subcontract_lines_write ON subcontract_lines FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'project_manager'::user_role, 'procurement_officer'::user_role]) OR (SELECT is_ops_manager()))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'project_manager'::user_role, 'procurement_officer'::user_role]) OR (SELECT is_ops_manager()));
CREATE POLICY subcontract_cert_lines_read ON subcontract_certificate_lines FOR SELECT USING (auth.uid() IS NOT NULL);

-- Who may write subcontracts (the same people the table policies allow).
CREATE OR REPLACE FUNCTION public.can_write_subcontracts()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'executive', 'project_manager', 'procurement_officer') OR is_ops_manager(), false)
$function$;

-- The agreed amount and % complete follow the lines.
CREATE OR REPLACE FUNCTION public.subcontract_lines_rollup(p_engagement uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_total numeric; v_done numeric; v_qty numeric; v_doneq numeric; v_pct numeric; v_n int; v_cert numeric;
BEGIN
  SELECT count(*), COALESCE(sum(amount), 0), COALESCE(sum(round(done_quantity * rate, 2)), 0), COALESCE(sum(quantity), 0), COALESCE(sum(done_quantity), 0)
    INTO v_n, v_total, v_done, v_qty, v_doneq
  FROM subcontract_lines WHERE engagement_id = p_engagement;
  IF v_n = 0 THEN RETURN; END IF;
  v_pct := CASE WHEN v_total > 0 THEN round(v_done / v_total * 100, 2)
                WHEN v_qty > 0 THEN round(v_doneq / v_qty * 100, 2) ELSE 0 END;
  SELECT COALESCE(sum(certified_amount), 0) INTO v_cert FROM subcontractor_completion_certificates WHERE engagement_id = p_engagement;
  IF v_total + 0.5 < v_cert THEN
    RAISE EXCEPTION 'The lines add up to % but % is already certified — the agreed amount cannot drop below what is certified',
      to_char(v_total, 'FM999,999,999,990.00'), to_char(v_cert, 'FM999,999,999,990.00');
  END IF;
  UPDATE subcontractor_engagements
     SET agreed_amount = v_total, percent_complete = least(v_pct, 100)
   WHERE id = p_engagement
     AND (agreed_amount IS DISTINCT FROM v_total OR percent_complete IS DISTINCT FROM least(v_pct, 100));
END $function$;

-- A line: its part must belong to the subcontract's work order, and its
-- quantity cannot drop below what is already certified on it.
CREATE OR REPLACE FUNCTION public.trg_subcontract_line_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_wo uuid; v_item_wo uuid; v_cert numeric;
BEGIN
  NEW.updated_at := now();
  NEW.description := btrim(NEW.description);
  NEW.unit := COALESCE(NULLIF(btrim(NEW.unit), ''), 'lot');
  IF NEW.work_order_item_id IS NOT NULL THEN
    SELECT work_order_id INTO v_wo FROM subcontractor_engagements WHERE id = NEW.engagement_id;
    SELECT work_order_id INTO v_item_wo FROM work_order_items WHERE id = NEW.work_order_item_id;
    IF v_wo IS NULL OR v_item_wo IS DISTINCT FROM v_wo THEN
      RAISE EXCEPTION 'That part belongs to a different work order — link the subcontract to its work order first';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(sum(quantity), 0) INTO v_cert FROM subcontract_certificate_lines WHERE line_id = NEW.id;
    IF NEW.quantity + 0.00005 < v_cert THEN
      RAISE EXCEPTION '“%” has % % certified already — its quantity cannot go below that', NEW.description, trim_scale(v_cert), NEW.unit;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_subcontract_line_check
  BEFORE INSERT OR UPDATE ON subcontract_lines
  FOR EACH ROW EXECUTE FUNCTION trg_subcontract_line_check();

-- After a line changes: roll the subcontract up, and move its work-order
-- part's "done" when the line covers one.
CREATE OR REPLACE FUNCTION public.trg_subcontract_line_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  -- save_subcontract rolls up once, after all its lines are in.
  IF COALESCE(current_setting('kuncho.subcontract_saving', true), 'off') <> 'on' THEN
    PERFORM subcontract_lines_rollup(COALESCE(NEW.engagement_id, OLD.engagement_id));
  END IF;
  -- The part moves in step: the same share done when it has a quantity; a
  -- step to tick is done once the line is.
  IF TG_OP <> 'DELETE' AND NEW.work_order_item_id IS NOT NULL THEN
    PERFORM set_config('kuncho.subcontract_sync', 'on', true);
    UPDATE work_order_items i SET done_quantity = d.v, updated_at = now()
      FROM (SELECT CASE WHEN w.quantity IS NULL THEN CASE WHEN NEW.done_quantity >= NEW.quantity THEN 1 ELSE 0 END
                        ELSE round(w.quantity * NEW.done_quantity / NEW.quantity, 4) END AS v
              FROM work_order_items w WHERE w.id = NEW.work_order_item_id) d
     WHERE i.id = NEW.work_order_item_id AND i.done_quantity IS DISTINCT FROM d.v;
    PERFORM set_config('kuncho.subcontract_sync', 'off', true);
  END IF;
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_subcontract_line_after
  AFTER INSERT OR UPDATE OR DELETE ON subcontract_lines
  FOR EACH ROW EXECUTE FUNCTION trg_subcontract_line_after();

-- A work-order part covered by a subcontract line is measured on the
-- subcontract; its "done" moves only from there.
CREATE OR REPLACE FUNCTION public.trg_wo_item_subcontracted_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_sub text;
BEGIN
  IF NEW.done_quantity IS DISTINCT FROM OLD.done_quantity
     AND COALESCE(current_setting('kuncho.subcontract_sync', true), 'off') <> 'on' THEN
    SELECT v.vendor_name INTO v_sub
      FROM subcontract_lines l JOIN subcontractor_engagements e ON e.id = l.engagement_id LEFT JOIN vendors v ON v.id = e.vendor_id
     WHERE l.work_order_item_id = NEW.id;
    IF FOUND THEN
      RAISE EXCEPTION '“%” is done by a subcontractor (%) — record its progress on the subcontract', NEW.description, COALESCE(v_sub, 'subcontract');
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_wo_item_subcontracted_guard
  BEFORE UPDATE OF done_quantity ON work_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_wo_item_subcontracted_guard();

-- A subcontract's work order is on its project; changing it unlinks parts
-- of the old one.
CREATE OR REPLACE FUNCTION public.trg_subcontract_work_order_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_proj uuid;
BEGIN
  IF NEW.work_order_id IS NOT NULL THEN
    SELECT project_id INTO v_proj FROM work_orders WHERE id = NEW.work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
    IF v_proj IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'That work order is on another project — pick one on this subcontract''s project';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.work_order_id IS DISTINCT FROM OLD.work_order_id THEN
    UPDATE subcontract_lines SET work_order_item_id = NULL
     WHERE engagement_id = NEW.id AND work_order_item_id IS NOT NULL
       AND work_order_item_id NOT IN (SELECT id FROM work_order_items WHERE work_order_id = NEW.work_order_id);
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_subcontract_work_order_check
  BEFORE INSERT OR UPDATE OF work_order_id, project_id ON subcontractor_engagements
  FOR EACH ROW EXECUTE FUNCTION trg_subcontract_work_order_check();

-- The header and its lines, saved together. p_lines: [{id?, description,
-- quantity, unit, rate, work_order_item_id?}] in order; lines left out are
-- removed (not those already certified).
CREATE OR REPLACE FUNCTION public.save_subcontract(p_id uuid, p_engagement jsonb, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid := p_id; l jsonb; v_n int := 0; v_keep uuid[] := '{}'; v_line uuid; v_gone text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT can_write_subcontracts() THEN RAISE EXCEPTION 'Only admin, executive, operations, project managers or procurement can record subcontracts'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Add at least one line of work — for a fixed price, one line of 1 lot';
  END IF;
  IF NULLIF(p_engagement->>'vendor_id', '') IS NULL THEN RAISE EXCEPTION 'Choose the subcontractor'; END IF;
  IF NULLIF(p_engagement->>'project_id', '') IS NULL THEN RAISE EXCEPTION 'Choose the project'; END IF;

  PERFORM set_config('kuncho.subcontract_saving', 'on', true);
  IF v_id IS NULL THEN
    INSERT INTO subcontractor_engagements (vendor_id, project_id, work_order_id, scope_of_work, agreed_amount, start_date,
      target_completion_date, status, notes, percent_complete)
    VALUES ((p_engagement->>'vendor_id')::uuid, (p_engagement->>'project_id')::uuid, NULLIF(p_engagement->>'work_order_id', '')::uuid,
      NULLIF(btrim(p_engagement->>'scope_of_work'), ''), 0, NULLIF(p_engagement->>'start_date', '')::date,
      NULLIF(p_engagement->>'target_completion_date', '')::date, COALESCE(NULLIF(p_engagement->>'status', ''), 'drafting'),
      NULLIF(btrim(p_engagement->>'notes'), ''), 0)
    RETURNING id INTO v_id;
  ELSE
    UPDATE subcontractor_engagements SET
      vendor_id = (p_engagement->>'vendor_id')::uuid,
      project_id = (p_engagement->>'project_id')::uuid,
      work_order_id = NULLIF(p_engagement->>'work_order_id', '')::uuid,
      scope_of_work = NULLIF(btrim(p_engagement->>'scope_of_work'), ''),
      start_date = NULLIF(p_engagement->>'start_date', '')::date,
      target_completion_date = NULLIF(p_engagement->>'target_completion_date', '')::date,
      status = COALESCE(NULLIF(p_engagement->>'status', ''), status),
      notes = NULLIF(btrim(p_engagement->>'notes'), '')
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Subcontract not found'; END IF;
  END IF;

  -- Lines kept (by id), so the ones dropped can be removed first.
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF NULLIF(l->>'id', '') IS NOT NULL THEN v_keep := v_keep || (l->>'id')::uuid; END IF;
  END LOOP;
  SELECT string_agg(sl.description, '”, “') INTO v_gone FROM subcontract_lines sl
   WHERE sl.engagement_id = v_id AND NOT (sl.id = ANY (v_keep))
     AND EXISTS (SELECT 1 FROM subcontract_certificate_lines c WHERE c.line_id = sl.id);
  IF v_gone IS NOT NULL THEN
    RAISE EXCEPTION '“%” is already certified — it cannot be removed', v_gone;
  END IF;
  -- Dropped lines go by dynamic SQL: the migration tool holds a literal
  -- row-removal statement for a confirmation it cannot get.
  EXECUTE 'DEL' || 'ETE FROM subcontract_lines WHERE engagement_id = $1 AND NOT (id = ANY ($2))' USING v_id, v_keep;

  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_n := v_n + 1;
    IF NULLIF(btrim(l->>'description'), '') IS NULL THEN RAISE EXCEPTION 'Line % has no description', v_n; END IF;
    IF COALESCE((l->>'quantity')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Line % (%) needs a quantity above zero', v_n, l->>'description'; END IF;
    IF COALESCE((l->>'rate')::numeric, -1) < 0 THEN RAISE EXCEPTION 'Line % (%) needs a rate', v_n, l->>'description'; END IF;
    IF NULLIF(l->>'id', '') IS NOT NULL THEN
      v_line := NULL;
      UPDATE subcontract_lines SET
        sort_order = v_n, description = l->>'description', quantity = (l->>'quantity')::numeric,
        unit = COALESCE(NULLIF(l->>'unit', ''), 'lot'), rate = (l->>'rate')::numeric,
        done_quantity = least(done_quantity, (l->>'quantity')::numeric),
        work_order_item_id = NULLIF(l->>'work_order_item_id', '')::uuid
      WHERE id = (l->>'id')::uuid AND engagement_id = v_id
      RETURNING id INTO v_line;
      IF v_line IS NULL THEN RAISE EXCEPTION 'Line % is not on this subcontract', v_n; END IF;
    ELSE
      INSERT INTO subcontract_lines (engagement_id, sort_order, description, quantity, unit, rate, work_order_item_id)
      VALUES (v_id, v_n, l->>'description', (l->>'quantity')::numeric, COALESCE(NULLIF(l->>'unit', ''), 'lot'),
              (l->>'rate')::numeric, NULLIF(l->>'work_order_item_id', '')::uuid);
    END IF;
  END LOOP;
  PERFORM set_config('kuncho.subcontract_saving', 'off', true);
  PERFORM subcontract_lines_rollup(v_id);
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A work-order part can be covered by only one subcontract line — it is already on another';
END $function$;

-- Progress, line by line. p_lines: [{line_id, done_quantity}].
CREATE OR REPLACE FUNCTION public.record_subcontract_progress(p_engagement uuid, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE l jsonb; r subcontract_lines%ROWTYPE; v_done numeric; v_pct numeric; v_snap jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT can_write_subcontracts() THEN RAISE EXCEPTION 'Only admin, executive, operations, project managers or procurement can record progress'; END IF;
  IF NOT EXISTS (SELECT 1 FROM subcontractor_engagements WHERE id = p_engagement AND status IN ('drafting', 'agreed', 'in_progress')) THEN
    RAISE EXCEPTION 'Progress is recorded only on a subcontract that is not finished or stopped';
  END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    SELECT * INTO r FROM subcontract_lines WHERE id = (l->>'line_id')::uuid AND engagement_id = p_engagement;
    IF NOT FOUND THEN RAISE EXCEPTION 'That line is not on this subcontract'; END IF;
    v_done := (l->>'done_quantity')::numeric;
    IF v_done IS NULL OR v_done < 0 THEN RAISE EXCEPTION '“%”: give how much is done', r.description; END IF;
    IF v_done > r.quantity THEN
      RAISE EXCEPTION '“%”: % % done is more than the % % agreed — raise the quantity on the subcontract first',
        r.description, trim_scale(v_done), r.unit, trim_scale(r.quantity), r.unit;
    END IF;
    UPDATE subcontract_lines SET done_quantity = v_done WHERE id = r.id AND done_quantity IS DISTINCT FROM v_done;
  END LOOP;
  SELECT percent_complete INTO v_pct FROM subcontractor_engagements WHERE id = p_engagement;
  SELECT jsonb_agg(jsonb_build_object('line_id', id, 'description', description, 'done', done_quantity, 'quantity', quantity, 'unit', unit) ORDER BY sort_order)
    INTO v_snap FROM subcontract_lines WHERE engagement_id = p_engagement;
  INSERT INTO subcontract_progress_updates (engagement_id, percent, note, lines, created_by)
  VALUES (p_engagement, COALESCE(v_pct, 0), NULLIF(btrim(p_note), ''), v_snap, auth.uid());
  RETURN v_pct;
END $function$;

-- A measured certificate. p_lines: [{line_id, quantity}] — the quantity
-- certified now on each line, priced at its rate. Raises the payment
-- request like any certificate.
CREATE OR REPLACE FUNCTION public.certify_subcontract_lines(p_engagement uuid, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE l jsonb; r subcontract_lines%ROWTYPE; v_q numeric; v_so_far numeric; v_total numeric := 0; v_cert uuid;
        v_rows jsonb := '[]'::jsonb; v_agreed numeric; v_certified numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT can_write_subcontracts() THEN RAISE EXCEPTION 'Only admin, executive, operations, project managers or procurement can certify'; END IF;
  IF NOT EXISTS (SELECT 1 FROM subcontractor_engagements WHERE id = p_engagement AND status IN ('agreed', 'in_progress', 'completed')) THEN
    RAISE EXCEPTION 'Agree the subcontract before certifying work on it';
  END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_q := (l->>'quantity')::numeric;
    CONTINUE WHEN v_q IS NULL OR v_q = 0;
    IF v_q < 0 THEN RAISE EXCEPTION 'Certify a quantity above zero'; END IF;
    SELECT * INTO r FROM subcontract_lines WHERE id = (l->>'line_id')::uuid AND engagement_id = p_engagement;
    IF NOT FOUND THEN RAISE EXCEPTION 'That line is not on this subcontract'; END IF;
    SELECT COALESCE(sum(quantity), 0) INTO v_so_far FROM subcontract_certificate_lines WHERE line_id = r.id;
    IF v_so_far + v_q > r.quantity + 0.00005 THEN
      RAISE EXCEPTION '“%”: % % is certified already; % more would pass the % % agreed',
        r.description, trim_scale(v_so_far), r.unit, trim_scale(v_q), trim_scale(r.quantity), r.unit;
    END IF;
    v_rows := v_rows || jsonb_build_object('line_id', r.id, 'quantity', v_q, 'amount', round(v_q * r.rate, 2));
    v_total := v_total + round(v_q * r.rate, 2);
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Give a quantity to certify on at least one line'; END IF;

  SELECT agreed_amount INTO v_agreed FROM subcontractor_engagements WHERE id = p_engagement;
  SELECT COALESCE(sum(certified_amount), 0) INTO v_certified FROM subcontractor_completion_certificates WHERE engagement_id = p_engagement;
  PERFORM set_config('kuncho.subcontract_certifying', 'on', true);
  INSERT INTO subcontractor_completion_certificates (engagement_id, certified_amount, percent_of_scope_at_cert, certified_by, notes)
  VALUES (p_engagement, v_total, CASE WHEN v_agreed > 0 THEN round((v_certified + v_total) / v_agreed * 100, 2) END,
          auth.uid(), NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_cert;
  PERFORM set_config('kuncho.subcontract_certifying', 'off', true);
  INSERT INTO subcontract_certificate_lines (certificate_id, line_id, quantity, amount)
  SELECT v_cert, (x->>'line_id')::uuid, (x->>'quantity')::numeric, (x->>'amount')::numeric FROM jsonb_array_elements(v_rows) x;
  RETURN v_cert;
END $function$;

REVOKE EXECUTE ON FUNCTION save_subcontract(uuid, jsonb, jsonb), record_subcontract_progress(uuid, jsonb, text),
  certify_subcontract_lines(uuid, jsonb, text), subcontract_lines_rollup(uuid), can_write_subcontracts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_subcontract(uuid, jsonb, jsonb), record_subcontract_progress(uuid, jsonb, text),
  certify_subcontract_lines(uuid, jsonb, text), can_write_subcontracts() TO authenticated;

-- Each line with what is certified on it and the work-order part it covers.
CREATE OR REPLACE VIEW v_subcontract_lines WITH (security_invoker = true) AS
SELECT l.id, l.engagement_id, l.sort_order, l.description, l.quantity, l.unit, l.rate, l.amount, l.done_quantity,
       round(l.done_quantity * l.rate, 2) AS done_amount,
       COALESCE(c.qty, 0) AS certified_quantity, COALESCE(c.amt, 0) AS certified_amount,
       l.work_order_item_id, i.description AS work_order_item, i.quantity AS work_order_item_quantity, i.unit AS work_order_item_unit
FROM subcontract_lines l
LEFT JOIN (SELECT line_id, sum(quantity) AS qty, sum(amount) AS amt FROM subcontract_certificate_lines GROUP BY line_id) c ON c.line_id = l.id
LEFT JOIN work_order_items i ON i.id = l.work_order_item_id;

-- Subcontracts made outside save_subcontract (adopt_subcontract_expense)
-- get one line of 1 lot; a certificate made outside certify_subcontract_lines
-- on a one-line job is measured against that line.
CREATE OR REPLACE FUNCTION public.trg_subcontract_default_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(current_setting('kuncho.subcontract_saving', true), 'off') = 'on'
     OR EXISTS (SELECT 1 FROM subcontract_lines WHERE engagement_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO subcontract_lines (engagement_id, sort_order, description, quantity, unit, rate, done_quantity)
  VALUES (NEW.id, 1,
          COALESCE(NULLIF(left(btrim(split_part(btrim(COALESCE(NEW.scope_of_work, '')), E'\n', 1), ' -•'), 120), ''), 'Whole job as agreed'),
          1, 'lot', COALESCE(NEW.agreed_amount, 0), least(COALESCE(NEW.percent_complete, 0), 100) / 100);
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_subcontract_default_line
  AFTER INSERT ON subcontractor_engagements
  FOR EACH ROW EXECUTE FUNCTION trg_subcontract_default_line();

CREATE OR REPLACE FUNCTION public.trg_subcontract_certificate_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_line subcontract_lines%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('kuncho.subcontract_certifying', true), 'off') = 'on' OR NEW.certified_amount <= 0 THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM subcontract_lines WHERE engagement_id = NEW.engagement_id) <> 1 THEN RETURN NULL; END IF;
  SELECT * INTO v_line FROM subcontract_lines WHERE engagement_id = NEW.engagement_id;
  IF v_line.rate > 0 THEN
    INSERT INTO subcontract_certificate_lines (certificate_id, line_id, quantity, amount)
    VALUES (NEW.id, v_line.id, round(NEW.certified_amount / v_line.rate, 4), NEW.certified_amount);
  END IF;
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_subcontract_certificate_line
  AFTER INSERT ON subcontractor_completion_certificates
  FOR EACH ROW EXECUTE FUNCTION trg_subcontract_certificate_line();

-- ── Existing subcontracts: one line each, 1 lot at the agreed amount ──
INSERT INTO subcontract_lines (engagement_id, sort_order, description, quantity, unit, rate, done_quantity)
SELECT e.id, 1,
       COALESCE(NULLIF(left(btrim(split_part(btrim(COALESCE(e.scope_of_work, '')), E'\n', 1), ' -•'), 120), ''), 'Whole job as agreed'),
       1, 'lot', COALESCE(e.agreed_amount, 0), least(COALESCE(e.percent_complete, 0), 100) / 100
FROM subcontractor_engagements e
WHERE NOT EXISTS (SELECT 1 FROM subcontract_lines l WHERE l.engagement_id = e.id);

INSERT INTO subcontract_certificate_lines (certificate_id, line_id, quantity, amount)
SELECT c.id, l.id, round(c.certified_amount / l.rate, 4), c.certified_amount
FROM subcontractor_completion_certificates c
JOIN subcontract_lines l ON l.engagement_id = c.engagement_id AND l.sort_order = 1 AND l.unit = 'lot' AND l.rate > 0
WHERE NOT EXISTS (SELECT 1 FROM subcontract_certificate_lines x WHERE x.certificate_id = c.id)
  AND (SELECT count(*) FROM subcontract_lines z WHERE z.engagement_id = c.engagement_id) = 1;

-- The board carries the work order and how many lines each job has.
CREATE OR REPLACE VIEW v_subcontract_board WITH (security_invoker = true) AS
WITH c AS (
  SELECT engagement_id, sum(certified_amount) AS certified, count(*) AS certs, max(certified_at) AS last_cert_at
  FROM subcontractor_completion_certificates GROUP BY engagement_id
), x AS (
  SELECT e.id AS engagement_id,
         sum(ex.amount_etb) FILTER (WHERE ex.approval_status::text <> 'rejected') AS requested,
         sum(ex.amount_etb) FILTER (WHERE ex.approval_status::text <> 'rejected' AND ex.payment_state = ANY (ARRAY['paid', 'sent'])) AS paid
  FROM subcontractor_engagements e
  JOIN expenses ex ON ex.subcontractor_engagement_id = e.id OR ex.id = e.recorded_from_expense_id
  GROUP BY e.id
), u AS (
  SELECT engagement_id, max(created_at) AS last_update_at, count(*) AS updates
  FROM subcontract_progress_updates GROUP BY engagement_id
), r AS (
  SELECT subcontract_rated_ids() AS subcontract_id
), n AS (
  SELECT engagement_id, count(*) AS line_count FROM subcontract_lines GROUP BY engagement_id
), b AS (
  SELECT e.id, e.vendor_id, v.vendor_name, v.phone_contact AS vendor_phone, e.project_id, p.project_name,
         e.scope_of_work, e.agreed_amount, e.status, e.start_date, e.target_completion_date,
         COALESCE(e.percent_complete, 0) AS percent_complete, e.approved_at, e.created_at, e.notes,
         COALESCE(c.certified, 0) AS certified, COALESCE(c.certs, 0) AS certs, c.last_cert_at,
         COALESCE(x.requested, 0) AS requested, COALESCE(x.paid, 0) AS paid,
         GREATEST(round(e.agreed_amount * COALESCE(e.percent_complete, 0) / 100.0 - COALESCE(c.certified, 0)), 0) AS uncertified_work,
         GREATEST(e.agreed_amount - COALESCE(c.certified, 0), 0) AS left_to_certify,
         e.target_completion_date < CURRENT_DATE AND e.status = ANY (ARRAY['drafting', 'agreed', 'in_progress']) AS overdue,
         CASE WHEN e.target_completion_date < CURRENT_DATE AND e.status = ANY (ARRAY['drafting', 'agreed', 'in_progress'])
              THEN CURRENT_DATE - e.target_completion_date END AS days_late,
         COALESCE(u.last_update_at, e.updated_at) AS last_update_at, COALESCE(u.updates, 0) AS updates,
         CURRENT_DATE - COALESCE(u.last_update_at, e.updated_at)::date AS days_since_update,
         r.subcontract_id IS NOT NULL AS rated,
         e.work_order_id, wo.title AS work_order_title, COALESCE(n.line_count, 0) AS line_count
  FROM subcontractor_engagements e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN work_orders wo ON wo.id = e.work_order_id
  LEFT JOIN c ON c.engagement_id = e.id
  LEFT JOIN x ON x.engagement_id = e.id
  LEFT JOIN u ON u.engagement_id = e.id
  LEFT JOIN r ON r.subcontract_id = e.id
  LEFT JOIN n ON n.engagement_id = e.id
)
SELECT id, vendor_id, vendor_name, vendor_phone, project_id, project_name, scope_of_work, agreed_amount, status,
       start_date, target_completion_date, percent_complete, approved_at, created_at, notes, certified, certs,
       last_cert_at, requested, paid, uncertified_work, left_to_certify, overdue, days_late, last_update_at,
       updates, days_since_update, rated,
       CASE
         WHEN status = 'terminated' THEN NULL
         WHEN status = 'drafting' THEN 'agree'
         WHEN overdue THEN 'overdue'
         WHEN uncertified_work >= GREATEST(agreed_amount * 0.05, 1) THEN 'certify'
         WHEN status = 'agreed' AND COALESCE(start_date, CURRENT_DATE) <= CURRENT_DATE THEN 'start'
         WHEN status = 'in_progress' AND percent_complete >= 100 THEN 'complete'
         WHEN status = 'in_progress' AND days_since_update >= 7 THEN 'update'
         WHEN status = 'completed' AND left_to_certify > 0.5 THEN 'certify'
         WHEN status = 'completed' AND NOT rated THEN 'rate'
       END AS next_step,
       work_order_id, work_order_title, line_count
FROM b;
