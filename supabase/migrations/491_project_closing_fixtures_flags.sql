-- 491: a project closes in two steps, fixtures are checked out and back, and
-- the day sheets' labour shows wherever project labour is counted.
--   * Delivered — the event is done and the invoice can go (the PM).
--     Costing Closed — every fixture back, inspected and repaired; labour
--     cost and profit are final (finance). Nothing more is costed to it.
--   * Each fixture going to an event is checked out (checklist, photos) and
--     checked back in; the return inspection can open a repair work order on
--     the same project, whose labour goes on the day sheet as post-event
--     repair, and — where the contract says so — raise a damage charge
--     (stock manager and logistics; finance approves it).
--   * Flags: days that don't add up, projects over their labour budget,
--     projects delivered but not closed after N days, returns not inspected.
--   * Labour already recorded on work orders stays where it is; it was
--     always tied to the project, so project totals carry it unchanged.

-- Who does what.
CREATE OR REPLACE FUNCTION public.project_can_deliver(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT manages_project(p_project) OR COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false);
$f$;
CREATE OR REPLACE FUNCTION public.project_can_close_costing()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE(get_user_role()::text IN ('finance', 'admin'), false);
$f$;
CREATE OR REPLACE FUNCTION public.fixture_inspector(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE(get_user_role()::text IN ('stock_manager', 'logistics_officer', 'admin', 'operations_manager'), false)
      OR COALESCE(is_ops_manager(), false) OR manages_project(p_project);
$f$;
CREATE OR REPLACE FUNCTION public.project_can_see_closing(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT fixture_inspector(p_project)
      OR COALESCE(get_user_role()::text IN ('finance', 'executive', 'sales', 'hr_officer'), false);
$f$;

-- The two closing points change only through the functions below.
CREATE OR REPLACE FUNCTION public.trg_project_lifecycle_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF (NEW.delivered_at IS DISTINCT FROM OLD.delivered_at OR NEW.costing_closed_at IS DISTINCT FROM OLD.costing_closed_at)
     AND COALESCE(current_setting('kuncho.lifecycle', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Use Mark delivered / Close costing on the project to change these';
  END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_project_lifecycle_guard BEFORE UPDATE OF delivered_at, costing_closed_at ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_project_lifecycle_guard();

CREATE TABLE IF NOT EXISTS public.project_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('delivered', 'delivery_undone', 'costing_closed', 'costing_reopened')),
  note text,
  by_user uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  by_name text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_lifecycle_events_project_idx ON project_lifecycle_events (project_id, at);

-- Fixtures going out with a project, and every check on them.
CREATE TABLE IF NOT EXISTS public.project_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'pcs',
  boq_item_id uuid REFERENCES boq_items(id) ON DELETE SET NULL,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_fixtures_project_idx ON project_fixtures (project_id);

CREATE SEQUENCE IF NOT EXISTS fixture_check_seq;
CREATE TABLE IF NOT EXISTS public.fixture_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('dispatch', 'return')),
  -- A return is received first, then inspected.
  status text NOT NULL CHECK (status IN ('done', 'received', 'inspected')),
  note text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  checked_by_name text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  inspected_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  inspected_by_name text,
  inspected_at timestamptz,
  inspection_note text
);
CREATE INDEX IF NOT EXISTS fixture_checks_project_idx ON fixture_checks (project_id, kind, status);
CREATE TABLE IF NOT EXISTS public.fixture_check_lines (
  check_id uuid NOT NULL REFERENCES fixture_checks(id) ON DELETE CASCADE,
  fixture_id uuid NOT NULL REFERENCES project_fixtures(id) ON DELETE RESTRICT,
  -- Sent out, or came back.
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  -- Return inspection: of what came back, fine and damaged; and what is lost.
  ok_qty numeric NOT NULL DEFAULT 0 CHECK (ok_qty >= 0),
  damaged_qty numeric NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  missing_qty numeric NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  PRIMARY KEY (check_id, fixture_id)
);
CREATE INDEX IF NOT EXISTS fixture_check_lines_fixture_idx ON fixture_check_lines (fixture_id);

-- A repair opened from a return inspection is an ordinary work order on the
-- same project that knows where it came from.
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS repair_of_check_id uuid REFERENCES fixture_checks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repair_fixture_id uuid REFERENCES project_fixtures(id) ON DELETE SET NULL;

CREATE SEQUENCE IF NOT EXISTS damage_charge_seq;
CREATE TABLE IF NOT EXISTS public.project_damage_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  check_id uuid REFERENCES fixture_checks(id) ON DELETE SET NULL,
  fixture_id uuid REFERENCES project_fixtures(id) ON DELETE SET NULL,
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'raised' CHECK (status IN ('raised', 'approved', 'invoiced', 'waived')),
  raised_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  raised_by_name text,
  raised_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS project_damage_charges_project_idx ON project_damage_charges (project_id, status);

ALTER TABLE project_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixture_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixture_check_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_damage_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_lifecycle_events_read ON project_lifecycle_events FOR SELECT TO authenticated USING (project_can_see_closing(project_id));
CREATE POLICY project_fixtures_read ON project_fixtures FOR SELECT TO authenticated USING (project_can_see_closing(project_id));
CREATE POLICY fixture_checks_read ON fixture_checks FOR SELECT TO authenticated USING (project_can_see_closing(project_id));
CREATE POLICY fixture_check_lines_read ON fixture_check_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM fixture_checks c WHERE c.id = check_id AND project_can_see_closing(c.project_id)));
CREATE POLICY project_damage_charges_read ON project_damage_charges FOR SELECT TO authenticated USING (project_can_see_closing(project_id));

-- Where each fixture is: sent, back, lost, still out, damaged on return.
CREATE OR REPLACE FUNCTION public.project_fixture_status(p_project uuid)
RETURNS TABLE(fixture_id uuid, name text, quantity numeric, unit text, sent numeric, back numeric, missing numeric, still_out numeric,
              damaged numeric, awaiting_inspection numeric, last_check_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT f.id, f.name, f.quantity, f.unit,
         COALESCE(sum(l.quantity) FILTER (WHERE c.kind = 'dispatch'), 0),
         COALESCE(sum(l.quantity) FILTER (WHERE c.kind = 'return'), 0),
         COALESCE(sum(l.missing_qty) FILTER (WHERE c.kind = 'return'), 0),
         GREATEST(COALESCE(sum(l.quantity) FILTER (WHERE c.kind = 'dispatch'), 0)
                  - COALESCE(sum(l.quantity + l.missing_qty) FILTER (WHERE c.kind = 'return'), 0), 0),
         COALESCE(sum(l.damaged_qty) FILTER (WHERE c.kind = 'return'), 0),
         COALESCE(sum(l.quantity) FILTER (WHERE c.kind = 'return' AND c.status = 'received'), 0),
         max(c.checked_at)
    FROM project_fixtures f
    LEFT JOIN fixture_check_lines l ON l.fixture_id = f.id
    LEFT JOIN fixture_checks c ON c.id = l.check_id
   WHERE f.project_id = p_project
   GROUP BY f.id
   ORDER BY f.sort_order, f.name;
$f$;

-- What still stands between a project and Costing Closed.
CREATE OR REPLACE FUNCTION public.project_costing_blockers(p_project uuid)
RETURNS TABLE(kind text, label text, n integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT * FROM (
    SELECT 'not_delivered', 'Not marked delivered yet', 1
     WHERE (SELECT delivered_at FROM projects WHERE id = p_project) IS NULL
    UNION ALL
    SELECT 'fixtures_out', 'Fixtures not back yet', count(*)::int FROM project_fixture_status(p_project) s WHERE s.still_out > 0 HAVING count(*) > 0
    UNION ALL
    SELECT 'awaiting_inspection', 'Returns waiting for inspection', count(*)::int
      FROM fixture_checks c WHERE c.project_id = p_project AND c.kind = 'return' AND c.status = 'received' HAVING count(*) > 0
    UNION ALL
    SELECT 'open_work_orders', 'Work orders still open (repairs included)', count(*)::int
      FROM work_orders w WHERE w.project_id = p_project AND w.status IN ('requested', 'in_progress') HAVING count(*) > 0
    UNION ALL
    SELECT 'days_not_locked', 'Day sheets with labour here not locked yet', count(DISTINCT d.id)::int
      FROM labour_days d JOIN labour_day_allocations a ON a.day_id = d.id
     WHERE a.project_id = p_project AND d.status <> 'locked' HAVING count(DISTINCT d.id) > 0
    UNION ALL
    SELECT 'labour_unconfirmed', 'Labour recorded but not confirmed for pay', count(*)::int FROM (
        SELECT e.id FROM labour_work_entries e WHERE e.project_id = p_project AND e.pay_sheet_id IS NULL
        UNION ALL
        SELECT a.id FROM labour_day_allocations a JOIN labour_days d ON d.id = a.day_id
          JOIN labour_day_workers w ON w.day_id = a.day_id AND w.staff_id = a.staff_id
         WHERE a.project_id = p_project AND d.status = 'locked' AND w.pay_run_id IS NULL) x HAVING count(*) > 0
    UNION ALL
    SELECT 'damage_undecided', 'Damage charges waiting for finance', count(*)::int
      FROM project_damage_charges g WHERE g.project_id = p_project AND g.status = 'raised' HAVING count(*) > 0
  ) b(kind, label, n);
$f$;

CREATE OR REPLACE FUNCTION public.project_mark_delivered(p_project uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT project_can_deliver(p_project) THEN RAISE EXCEPTION 'The project''s PM marks it delivered'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF p.delivered_at IS NOT NULL THEN RAISE EXCEPTION 'Already marked delivered on %', to_char(p.delivered_at AT TIME ZONE 'Africa/Addis_Ababa', 'DD Mon YYYY'); END IF;
  PERFORM set_config('kuncho.lifecycle', 'on', true);
  UPDATE projects SET delivered_at = now(), delivered_by = auth.uid(), delivered_by_name = v_name WHERE id = p_project;
  PERFORM set_config('kuncho.lifecycle', 'off', true);
  INSERT INTO project_lifecycle_events (project_id, kind, note, by_user, by_name) VALUES (p_project, 'delivered', NULLIF(btrim(p_note), ''), auth.uid(), v_name);
END $f$;

CREATE OR REPLACE FUNCTION public.project_undo_delivered(p_project uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT project_can_deliver(p_project) THEN RAISE EXCEPTION 'The project''s PM changes this'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why it isn''t delivered after all'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project FOR UPDATE;
  IF p.delivered_at IS NULL THEN RAISE EXCEPTION 'It isn''t marked delivered'; END IF;
  IF p.costing_closed_at IS NOT NULL THEN RAISE EXCEPTION 'Costing is closed — finance reopens it first'; END IF;
  PERFORM set_config('kuncho.lifecycle', 'on', true);
  UPDATE projects SET delivered_at = NULL, delivered_by = NULL, delivered_by_name = NULL WHERE id = p_project;
  PERFORM set_config('kuncho.lifecycle', 'off', true);
  INSERT INTO project_lifecycle_events (project_id, kind, note, by_user, by_name) VALUES (p_project, 'delivery_undone', btrim(p_reason), auth.uid(), v_name);
END $f$;

CREATE OR REPLACE FUNCTION public.project_close_costing(p_project uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v_block text; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT project_can_close_costing() THEN RAISE EXCEPTION 'Finance closes costing'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF p.costing_closed_at IS NOT NULL THEN RAISE EXCEPTION 'Costing is already closed'; END IF;
  SELECT string_agg(b.label || ' (' || b.n || ')', '; ') INTO v_block FROM project_costing_blockers(p_project) b;
  IF v_block IS NOT NULL THEN RAISE EXCEPTION 'Not yet: %', v_block; END IF;
  PERFORM set_config('kuncho.lifecycle', 'on', true);
  UPDATE projects SET costing_closed_at = now(), costing_closed_by = auth.uid(), costing_closed_by_name = v_name WHERE id = p_project;
  PERFORM set_config('kuncho.lifecycle', 'off', true);
  INSERT INTO project_lifecycle_events (project_id, kind, note, by_user, by_name) VALUES (p_project, 'costing_closed', NULLIF(btrim(p_note), ''), auth.uid(), v_name);
END $f$;

CREATE OR REPLACE FUNCTION public.project_reopen_costing(p_project uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT project_can_close_costing() THEN RAISE EXCEPTION 'Finance reopens costing'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why costing reopens'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project FOR UPDATE;
  IF p.costing_closed_at IS NULL THEN RAISE EXCEPTION 'Costing isn''t closed'; END IF;
  PERFORM set_config('kuncho.lifecycle', 'on', true);
  UPDATE projects SET costing_closed_at = NULL, costing_closed_by = NULL, costing_closed_by_name = NULL WHERE id = p_project;
  PERFORM set_config('kuncho.lifecycle', 'off', true);
  INSERT INTO project_lifecycle_events (project_id, kind, note, by_user, by_name) VALUES (p_project, 'costing_reopened', btrim(p_reason), auth.uid(), v_name);
END $f$;

-- Damage terms of the contract; the PM, sales, finance or admin set them.
CREATE OR REPLACE FUNCTION public.project_set_damage_terms(p_project uuid, p_chargeable boolean, p_terms text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT (manages_project(p_project) OR COALESCE(get_user_role()::text IN ('admin', 'finance', 'sales', 'executive'), false)) THEN
    RAISE EXCEPTION 'The PM, sales or finance set the contract''s damage terms';
  END IF;
  UPDATE projects SET damage_chargeable = COALESCE(p_chargeable, false), damage_terms = NULLIF(btrim(p_terms), '') WHERE id = p_project;
END $f$;

-- Add or change the fixtures on a project; a fixture already checked out or
-- back can't be removed.
CREATE OR REPLACE FUNCTION public.project_fixtures_save(p_project uuid, p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE x jsonb; v_id uuid; v_n int := 0; v_out numeric; v_order int := 0;
BEGIN
  IF NOT fixture_inspector(p_project) THEN RAISE EXCEPTION 'The PM, stock manager or logistics keep the fixture list'; END IF;
  IF (SELECT costing_closed_at FROM projects WHERE id = p_project) IS NOT NULL THEN RAISE EXCEPTION 'Costing on this project is closed'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_order := v_order + 1;
    v_id := NULLIF(x->>'id', '')::uuid;
    IF COALESCE((x->>'remove')::boolean, false) THEN
      IF EXISTS (SELECT 1 FROM fixture_check_lines l WHERE l.fixture_id = v_id) THEN
        RAISE EXCEPTION '% has been checked out or back — it stays on the list', (SELECT name FROM project_fixtures WHERE id = v_id);
      END IF;
      DELETE FROM project_fixtures WHERE id = v_id AND project_id = p_project;
      CONTINUE;
    END IF;
    IF NULLIF(btrim(x->>'name'), '') IS NULL THEN RAISE EXCEPTION 'Each fixture needs a name'; END IF;
    IF COALESCE(NULLIF(x->>'quantity', '')::numeric, 0) <= 0 THEN RAISE EXCEPTION '%: how many?', btrim(x->>'name'); END IF;
    IF v_id IS NULL THEN
      INSERT INTO project_fixtures (project_id, name, quantity, unit, boq_item_id, note, sort_order, created_by)
      VALUES (p_project, btrim(x->>'name'), (x->>'quantity')::numeric, COALESCE(NULLIF(btrim(x->>'unit'), ''), 'pcs'),
              NULLIF(x->>'boq_item_id', '')::uuid, NULLIF(btrim(x->>'note'), ''), v_order, auth.uid());
    ELSE
      SELECT s.still_out INTO v_out FROM project_fixture_status(p_project) s WHERE s.fixture_id = v_id;
      IF (x->>'quantity')::numeric < COALESCE(v_out, 0) THEN
        RAISE EXCEPTION '%: % are out at the event — the count can''t go below that', btrim(x->>'name'), trim_scale(v_out);
      END IF;
      UPDATE project_fixtures SET name = btrim(x->>'name'), quantity = (x->>'quantity')::numeric,
             unit = COALESCE(NULLIF(btrim(x->>'unit'), ''), 'pcs'), note = NULLIF(btrim(x->>'note'), ''), sort_order = v_order
       WHERE id = v_id AND project_id = p_project;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $f$;

-- Start the list from the project's approved BOQ (line items not yet listed).
CREATE OR REPLACE FUNCTION public.project_fixtures_from_boq(p_project uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_boq uuid; v_n int;
BEGIN
  IF NOT fixture_inspector(p_project) THEN RAISE EXCEPTION 'The PM, stock manager or logistics keep the fixture list'; END IF;
  SELECT b.id INTO v_boq FROM boqs b WHERE b.project_id = p_project AND b.status = 'approved' ORDER BY b.version_number DESC LIMIT 1;
  IF v_boq IS NULL THEN RAISE EXCEPTION 'This project has no approved BOQ'; END IF;
  INSERT INTO project_fixtures (project_id, name, quantity, unit, boq_item_id, sort_order, created_by)
  SELECT p_project, btrim(i.name), GREATEST(COALESCE(i.quantity, 1), 1), COALESCE(NULLIF(btrim(i.unit), ''), 'pcs'), i.id,
         1000 + COALESCE(i.display_order, 0), auth.uid()
    FROM boq_items i
   WHERE i.boq_id = v_boq AND i.node_type = 'line_item' AND NULLIF(btrim(i.name), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM project_fixtures f WHERE f.project_id = p_project AND f.boq_item_id = i.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $f$;

-- Check fixtures out to the event, or receive them back.
-- p_lines: [{fixture_id, quantity, missing_qty (return), checklist, photos, note}]
CREATE OR REPLACE FUNCTION public.fixture_check_save(p_project uuid, p_kind text, p_lines jsonb, p_note text DEFAULT NULL, p_photos jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_id uuid; x jsonb; f record; v_qty numeric; v_missing numeric; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT fixture_inspector(p_project) THEN RAISE EXCEPTION 'The stock manager, logistics or the PM check fixtures out and back'; END IF;
  IF p_kind NOT IN ('dispatch', 'return') THEN RAISE EXCEPTION 'Out or back?'; END IF;
  IF (SELECT costing_closed_at FROM projects WHERE id = p_project) IS NOT NULL THEN RAISE EXCEPTION 'Costing on this project is closed'; END IF;
  INSERT INTO fixture_checks (code, project_id, kind, status, note, photos, checked_by, checked_by_name)
  VALUES ('FXC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('fixture_check_seq')::text, 4, '0'), p_project, p_kind,
          CASE WHEN p_kind = 'dispatch' THEN 'done' ELSE 'received' END, NULLIF(btrim(p_note), ''), COALESCE(p_photos, '[]'::jsonb), auth.uid(), v_name)
  RETURNING id INTO v_id;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_qty := COALESCE(NULLIF(x->>'quantity', '')::numeric, 0);
    v_missing := CASE WHEN p_kind = 'return' THEN COALESCE(NULLIF(x->>'missing_qty', '')::numeric, 0) ELSE 0 END;
    IF v_qty = 0 AND v_missing = 0 THEN CONTINUE; END IF;
    SELECT * INTO f FROM project_fixture_status(p_project) s WHERE s.fixture_id = NULLIF(x->>'fixture_id', '')::uuid;
    IF f.fixture_id IS NULL THEN RAISE EXCEPTION 'A fixture on this check isn''t on the project — refresh the page'; END IF;
    IF p_kind = 'dispatch' AND f.still_out + v_qty > f.quantity THEN
      RAISE EXCEPTION '%: only % of % are in — % already out', f.name, trim_scale(f.quantity - f.still_out), trim_scale(f.quantity), trim_scale(f.still_out);
    END IF;
    IF p_kind = 'return' AND v_qty + v_missing > f.still_out THEN
      RAISE EXCEPTION '%: only % are out', f.name, trim_scale(f.still_out);
    END IF;
    INSERT INTO fixture_check_lines (check_id, fixture_id, quantity, missing_qty, checklist, photos, note)
    VALUES (v_id, f.fixture_id, v_qty, v_missing, COALESCE(x->'checklist', '[]'::jsonb), COALESCE(x->'photos', '[]'::jsonb), NULLIF(btrim(x->>'note'), ''));
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM fixture_check_lines WHERE check_id = v_id) THEN RAISE EXCEPTION 'Nothing on this check — add how many of each'; END IF;
  -- Nothing came back to inspect (all lost): the return is inspected as it stands.
  IF p_kind = 'return' AND NOT EXISTS (SELECT 1 FROM fixture_check_lines WHERE check_id = v_id AND quantity > 0) THEN
    UPDATE fixture_checks SET status = 'inspected', inspected_by = auth.uid(), inspected_by_name = v_name, inspected_at = now() WHERE id = v_id;
  END IF;
  RETURN v_id;
END $f$;

-- Inspect what came back: each line's fine and damaged counts add up to
-- what came back.
CREATE OR REPLACE FUNCTION public.fixture_return_inspect(p_check uuid, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE c fixture_checks%ROWTYPE; l fixture_check_lines%ROWTYPE; x jsonb; v_ok numeric; v_dmg numeric;
BEGIN
  SELECT * INTO c FROM fixture_checks WHERE id = p_check FOR UPDATE;
  IF c.id IS NULL OR c.kind <> 'return' THEN RAISE EXCEPTION 'Return not found — refresh'; END IF;
  IF NOT fixture_inspector(c.project_id) THEN RAISE EXCEPTION 'The stock manager or logistics inspect returns'; END IF;
  IF c.status = 'inspected' THEN RAISE EXCEPTION 'Already inspected'; END IF;
  FOR l IN SELECT * FROM fixture_check_lines WHERE check_id = p_check LOOP
    SELECT y INTO x FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) y WHERE y->>'fixture_id' = l.fixture_id::text;
    v_ok := NULLIF(x->>'ok_qty', '')::numeric;
    v_dmg := COALESCE(NULLIF(x->>'damaged_qty', '')::numeric, 0);
    IF v_ok IS NULL THEN RAISE EXCEPTION 'Inspect every fixture on this return — % is missing', (SELECT name FROM project_fixtures WHERE id = l.fixture_id); END IF;
    IF v_ok + v_dmg <> l.quantity THEN
      RAISE EXCEPTION '%: % came back — fine and damaged must add up to that', (SELECT name FROM project_fixtures WHERE id = l.fixture_id), trim_scale(l.quantity);
    END IF;
    UPDATE fixture_check_lines SET ok_qty = v_ok, damaged_qty = v_dmg,
           checklist = COALESCE(x->'checklist', checklist), photos = COALESCE(x->'photos', photos), note = COALESCE(NULLIF(btrim(x->>'note'), ''), note)
     WHERE check_id = p_check AND fixture_id = l.fixture_id;
  END LOOP;
  UPDATE fixture_checks SET status = 'inspected', inspected_by = auth.uid(),
         inspected_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()), inspected_at = now(),
         inspection_note = NULLIF(btrim(p_note), '')
   WHERE id = p_check;
END $f$;

-- Open repair work on the same project from an inspected return.
CREATE OR REPLACE FUNCTION public.fixture_open_repair(p_check uuid, p_fixture uuid, p_scope text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE c fixture_checks%ROWTYPE; f project_fixtures%ROWTYPE; l fixture_check_lines%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO c FROM fixture_checks WHERE id = p_check;
  IF c.id IS NULL OR c.kind <> 'return' THEN RAISE EXCEPTION 'Return not found — refresh'; END IF;
  IF NOT fixture_inspector(c.project_id) THEN RAISE EXCEPTION 'The stock manager or logistics open repairs from a return'; END IF;
  IF c.status <> 'inspected' THEN RAISE EXCEPTION 'Inspect the return first'; END IF;
  IF (SELECT costing_closed_at FROM projects WHERE id = c.project_id) IS NOT NULL THEN RAISE EXCEPTION 'Costing on this project is closed'; END IF;
  SELECT * INTO f FROM project_fixtures WHERE id = p_fixture AND project_id = c.project_id;
  SELECT * INTO l FROM fixture_check_lines WHERE check_id = p_check AND fixture_id = p_fixture;
  IF f.id IS NULL OR l.check_id IS NULL THEN RAISE EXCEPTION 'That fixture isn''t on this return'; END IF;
  IF l.damaged_qty <= 0 THEN RAISE EXCEPTION 'Nothing of % came back damaged', f.name; END IF;
  SELECT id INTO v_id FROM work_orders WHERE repair_of_check_id = p_check AND repair_fixture_id = p_fixture AND status IN ('requested', 'in_progress');
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO work_orders (project_id, work_type, title, scope_of_work, requested_by, status, repair_of_check_id, repair_fixture_id)
  VALUES (c.project_id, 'workshop', left('Repair: ' || f.name, 200),
          COALESCE(NULLIF(btrim(p_scope), ''), format('Repair %s × %s damaged at the event (return %s)%s', trim_scale(l.damaged_qty), f.name, c.code,
                   CASE WHEN NULLIF(btrim(l.note), '') IS NOT NULL THEN ' — ' || btrim(l.note) ELSE '' END)),
          auth.uid(), 'requested', p_check, p_fixture)
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Raise a damage charge from a return, where the contract allows it.
CREATE OR REPLACE FUNCTION public.damage_charge_raise(p_check uuid, p_fixture uuid, p_description text, p_amount numeric, p_photos jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE c fixture_checks%ROWTYPE; p projects%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO c FROM fixture_checks WHERE id = p_check;
  IF c.id IS NULL OR c.kind <> 'return' THEN RAISE EXCEPTION 'Return not found — refresh'; END IF;
  IF NOT fixture_inspector(c.project_id) THEN RAISE EXCEPTION 'The stock manager or logistics raise damage charges'; END IF;
  SELECT * INTO p FROM projects WHERE id = c.project_id;
  IF NOT p.damage_chargeable THEN RAISE EXCEPTION 'This project''s contract doesn''t make damage chargeable to the client'; END IF;
  IF p.costing_closed_at IS NOT NULL THEN RAISE EXCEPTION 'Costing on this project is closed'; END IF;
  IF NULLIF(btrim(p_description), '') IS NULL THEN RAISE EXCEPTION 'Say what was damaged'; END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'How much is the charge?'; END IF;
  INSERT INTO project_damage_charges (code, project_id, check_id, fixture_id, description, amount, photos, raised_by, raised_by_name)
  VALUES ('DMG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('damage_charge_seq')::text, 4, '0'), c.project_id, p_check,
          NULLIF(p_fixture::text, '')::uuid, btrim(p_description), p_amount, COALESCE(p_photos, '[]'::jsonb), auth.uid(),
          (SELECT full_name FROM user_profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Finance: approve or waive a charge, then mark it invoiced.
CREATE OR REPLACE FUNCTION public.damage_charge_decide(p_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE g project_damage_charges%ROWTYPE;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('finance', 'admin') THEN RAISE EXCEPTION 'Finance decides damage charges'; END IF;
  SELECT * INTO g FROM project_damage_charges WHERE id = p_id FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Charge not found — refresh'; END IF;
  IF p_action IN ('approve', 'waive') AND g.status <> 'raised' THEN RAISE EXCEPTION 'This charge is already %', g.status; END IF;
  IF p_action = 'invoiced' AND g.status <> 'approved' THEN RAISE EXCEPTION 'Approve the charge before invoicing it'; END IF;
  IF p_action = 'waive' AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why it''s waived'; END IF;
  IF p_action NOT IN ('approve', 'waive', 'invoiced') THEN RAISE EXCEPTION 'Approve, waive or invoiced?'; END IF;
  UPDATE project_damage_charges
     SET status = CASE p_action WHEN 'approve' THEN 'approved' WHEN 'waive' THEN 'waived' ELSE 'invoiced' END,
         decided_by = auth.uid(), decided_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()), decided_at = now(),
         decision_note = COALESCE(NULLIF(btrim(p_note), ''), decision_note)
   WHERE id = p_id;
END $f$;

-- Labour cost per entry now includes the day sheets (source 'sheet', no
-- work order), so every place that totals a project's labour counts it.
CREATE OR REPLACE FUNCTION public.labour_entry_costs(p_project uuid DEFAULT NULL::uuid, p_wo uuid DEFAULT NULL::uuid)
 RETURNS TABLE(source text, entry_id uuid, labor_requisition_id uuid, work_order_id uuid, project_id uuid, staff_id uuid, work_date date, hours numeric, overtime_hours numeric, quantity numeric, percent_done numeric, cost numeric, confirmed boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT 'day', e.id, e.labor_requisition_id, r.work_order_id, e.project_id, e.staff_id, e.work_date,
         COALESCE(e.hours, 0), COALESCE(e.overtime_hours, 0), e.quantity, e.percent_done,
         round(CASE r.payment_basis
           WHEN 'per_day' THEN COALESCE(e.hours, 0) / 8 * labour_worker_day_rate(r.id, e.staff_id)
             + CASE WHEN COALESCE(e.overtime_hours, 0) = 0 THEN 0
                    WHEN e.overtime_agreed_amount IS NOT NULL THEN e.overtime_agreed_amount
                    WHEN o.rule = 'per_hour' THEN e.overtime_hours * o.hour_rate
                    ELSE (e.overtime_hours - e.overtime_night_hours) * labour_worker_day_rate(r.id, e.staff_id) / 8 * o.multiplier
                       + e.overtime_night_hours * labour_worker_day_rate(r.id, e.staff_id) / 8 * o.night_multiplier END
           WHEN 'per_volume' THEN COALESCE(e.quantity, 0) * COALESCE(r.unit_rate, 0)
           ELSE COALESCE(e.percent_done, 0) / 100 * COALESCE(r.fixed_price_amount, 0) END, 2),
         e.pay_sheet_id IS NOT NULL
    FROM labour_work_entries e
    JOIN labor_requisitions r ON r.id = e.labor_requisition_id
    LEFT JOIN LATERAL (SELECT * FROM labour_overtime_rates(r.id, e.work_date)) o ON COALESCE(e.overtime_hours, 0) > 0
   WHERE (p_project IS NULL OR e.project_id = p_project) AND (p_wo IS NULL OR r.work_order_id = p_wo)
  UNION ALL
  SELECT 'legacy', l.id, ts.labor_requisition_id, l.work_order_id, l.project_id, l.staff_id, l.log_date,
         COALESCE(l.hours_logged, 0), COALESCE(l.overtime_hours, 0), l.volume_completed, NULL,
         round(COALESCE(ts.days_worked, 0) * COALESCE(ts.day_rate, 0) + COALESCE(ts.volume_completed, 0) * COALESCE(ts.day_rate, 0)
               + COALESCE(ts.overtime_amount, 0), 2),
         ts.rolled_up_expense_id IS NOT NULL
    FROM wo_attendance_log l
    LEFT JOIN timesheet ts ON ts.id = l.synced_timesheet_id
   WHERE (p_project IS NULL OR l.project_id = p_project) AND (p_wo IS NULL OR l.work_order_id = p_wo)
     AND (COALESCE(l.hours_logged, 0) > 0 OR COALESCE(l.volume_completed, 0) > 0)
  UNION ALL
  SELECT 'sheet', a.id, NULL, NULL, c.project_id, c.staff_id, c.work_date, c.days * 8, c.overtime_hours, NULL, NULL, c.amount, c.pay_run_id IS NOT NULL
    FROM labour_day_costs(NULL, NULL, NULL, p_project) c
    JOIN labour_day_allocations a ON a.day_id = c.day_id AND a.staff_id = c.staff_id AND a.project_id = c.project_id AND a.bucket = c.bucket
   WHERE p_wo IS NULL AND (p_project IS NULL OR c.project_id = p_project);
$function$;

-- A project's labour, every way it was recorded, against its labour budget.
CREATE OR REPLACE FUNCTION public.project_labour_summary(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v jsonb; v_costs boolean := labour_can_see_costs(p_project);
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  WITH c AS (SELECT * FROM labour_entry_costs(p_project, NULL)),
  s AS (SELECT * FROM labour_day_costs(NULL, NULL, NULL, p_project)),
  b AS (SELECT pb.budgeted_amount FROM project_budgets pb JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
          JOIN cost_groups g ON g.id = pb.cost_group_id AND g.name = 'Labor' WHERE pb.project_id = p_project)
  SELECT jsonb_build_object(
    'costs_visible', v_costs,
    'cost', CASE WHEN v_costs THEN (SELECT COALESCE(sum(cost), 0) FROM c) END,
    'budget', CASE WHEN v_costs THEN (SELECT sum(budgeted_amount) FROM b) END,
    'over_budget', CASE WHEN v_costs THEN (SELECT COALESCE(sum(cost), 0) FROM c) > (SELECT sum(budgeted_amount) FROM b) END,
    'by_source', (SELECT jsonb_object_agg(source, jsonb_build_object('person_days', round(days, 1), 'cost', CASE WHEN v_costs THEN cost END))
                    FROM (SELECT source, sum(CASE WHEN source = 'sheet' THEN hours / 8 ELSE 1 END) AS days, sum(cost) AS cost FROM c GROUP BY source) x),
    'sheet', jsonb_build_object(
       'build_days', (SELECT COALESCE(sum(days), 0) FROM s WHERE bucket = 'build'),
       'repair_days', (SELECT COALESCE(sum(days), 0) FROM s WHERE bucket = 'repair'),
       'build_cost', CASE WHEN v_costs THEN (SELECT COALESCE(sum(amount), 0) FROM s WHERE bucket = 'build') END,
       'repair_cost', CASE WHEN v_costs THEN (SELECT COALESCE(sum(amount), 0) FROM s WHERE bucket = 'repair') END,
       'not_locked_days', (SELECT count(DISTINCT day_id) FROM s WHERE day_status <> 'locked')),
    'first_day', (SELECT min(work_date) FROM c), 'last_day', (SELECT max(work_date) FROM c))
  INTO v;
  RETURN v;
END $f$;

-- A project's closing state for its page.
CREATE OR REPLACE FUNCTION public.project_closing(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v jsonb; v_days int := (SELECT costing_open_days FROM labour_day_settings WHERE id);
BEGIN
  IF NOT project_can_see_closing(p_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project;
  SELECT jsonb_build_object(
    'stage', CASE WHEN p.costing_closed_at IS NOT NULL THEN 'closed' WHEN p.delivered_at IS NOT NULL THEN 'delivered' ELSE 'active' END,
    'delivered_at', p.delivered_at, 'delivered_by_name', p.delivered_by_name,
    'costing_closed_at', p.costing_closed_at, 'costing_closed_by_name', p.costing_closed_by_name,
    'costing_open_days', v_days,
    'open_for_days', CASE WHEN p.delivered_at IS NOT NULL AND p.costing_closed_at IS NULL THEN (bot_today() - (p.delivered_at AT TIME ZONE 'Africa/Addis_Ababa')::date) END,
    'damage_chargeable', p.damage_chargeable, 'damage_terms', p.damage_terms,
    'can_deliver', project_can_deliver(p_project), 'can_close', project_can_close_costing(), 'can_inspect', fixture_inspector(p_project),
    'can_set_terms', manages_project(p_project) OR COALESCE(get_user_role()::text IN ('admin', 'finance', 'sales', 'executive'), false),
    'blockers', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', b.kind, 'label', b.label, 'n', b.n)) FROM project_costing_blockers(p_project) b), '[]'::jsonb),
    'fixtures', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM project_fixture_status(p_project) s), '[]'::jsonb),
    'checks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'kind', c.kind, 'status', c.status, 'note', c.note,
                  'checked_by_name', c.checked_by_name, 'checked_at', c.checked_at, 'inspected_by_name', c.inspected_by_name, 'inspected_at', c.inspected_at,
                  'photos', c.photos,
                  'lines', (SELECT jsonb_agg(jsonb_build_object('fixture_id', l.fixture_id, 'name', f.name, 'unit', f.unit, 'quantity', l.quantity,
                              'ok_qty', l.ok_qty, 'damaged_qty', l.damaged_qty, 'missing_qty', l.missing_qty, 'checklist', l.checklist, 'photos', l.photos, 'note', l.note,
                              'repair', (SELECT jsonb_build_object('id', w.id, 'status', w.status) FROM work_orders w
                                          WHERE w.repair_of_check_id = c.id AND w.repair_fixture_id = l.fixture_id ORDER BY w.created_at DESC LIMIT 1)) ORDER BY f.sort_order, f.name)
                              FROM fixture_check_lines l JOIN project_fixtures f ON f.id = l.fixture_id WHERE l.check_id = c.id))
                  ORDER BY c.checked_at DESC) FROM fixture_checks c WHERE c.project_id = p_project), '[]'::jsonb),
    'charges', COALESCE((SELECT jsonb_agg(to_jsonb(g) || jsonb_build_object('fixture', (SELECT name FROM project_fixtures WHERE id = g.fixture_id)) ORDER BY g.raised_at DESC)
                           FROM project_damage_charges g WHERE g.project_id = p_project), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.at DESC) FROM project_lifecycle_events e WHERE e.project_id = p_project), '[]'::jsonb))
  INTO v;
  RETURN v;
END $f$;

-- The four flags, for whoever is looking: operations, finance and
-- executives see everything; a PM sees their own days and projects; stock
-- and logistics see returns to inspect.
CREATE OR REPLACE FUNCTION public.labour_flags()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_all boolean := labour_day_is_approver() OR COALESCE(get_user_role()::text IN ('finance', 'executive'), false);
  v_me uuid := current_staff_id(); v_days int := (SELECT costing_open_days FROM labour_day_settings WHERE id); v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  WITH board AS (SELECT * FROM labour_day_board(bot_today() - 30, bot_today())),
  mine AS (SELECT p.id FROM projects p WHERE v_all OR p.project_manager_id = v_me),
  costs AS (SELECT c.project_id, sum(c.cost) AS cost FROM labour_entry_costs(NULL, NULL) c WHERE c.project_id IN (SELECT id FROM mine) GROUP BY 1),
  budgets AS (SELECT pb.project_id, sum(pb.budgeted_amount) AS budget FROM project_budgets pb JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
               JOIN cost_groups g ON g.id = pb.cost_group_id AND g.name = 'Labor' GROUP BY 1)
  SELECT jsonb_build_object(
    'costing_open_days', v_days,
    'day_mismatches', COALESCE((SELECT jsonb_agg(jsonb_build_object('pm_staff_id', b.pm_staff_id, 'pm', b.pm_name, 'date', b.work_date, 'status', b.status,
                          'why', CASE WHEN b.mismatched > 0 THEN format('%s worker%s don''t add up', b.mismatched, CASE WHEN b.mismatched = 1 THEN '' ELSE 's' END)
                                      WHEN b.status = 'none' OR b.workers = 0 THEN format('%s asked for, nobody recorded', b.requested)
                                      ELSE 'Sent, not reviewed yet' END) ORDER BY b.work_date DESC, b.pm_name)
                        FROM board b
                       WHERE (v_all OR b.pm_staff_id = v_me)
                         AND (b.mismatched > 0
                              OR (b.work_date < bot_today() AND b.request_status = 'approved' AND (b.status = 'none' OR b.workers = 0))
                              OR (b.status = 'submitted' AND b.work_date < bot_today() - 1))), '[]'::jsonb),
    'over_budget', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', p.id, 'project', p.project_name, 'cost', c.cost, 'budget', b.budget,
                          'over', c.cost - b.budget) ORDER BY c.cost - b.budget DESC)
                        FROM costs c JOIN budgets b ON b.project_id = c.project_id JOIN projects p ON p.id = c.project_id
                       WHERE b.budget > 0 AND c.cost > b.budget AND labour_can_see_costs(p.id)), '[]'::jsonb),
    'costing_open', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', p.id, 'project', p.project_name,
                          'delivered_at', p.delivered_at, 'days', bot_today() - (p.delivered_at AT TIME ZONE 'Africa/Addis_Ababa')::date) ORDER BY p.delivered_at)
                        FROM projects p
                       WHERE p.id IN (SELECT id FROM mine) AND p.delivered_at IS NOT NULL AND p.costing_closed_at IS NULL
                         AND (p.delivered_at AT TIME ZONE 'Africa/Addis_Ababa')::date < bot_today() - v_days), '[]'::jsonb),
    'awaiting_inspection', COALESCE((SELECT jsonb_agg(jsonb_build_object('check_id', c.id, 'code', c.code, 'project_id', c.project_id, 'project', p.project_name,
                          'received_at', c.checked_at, 'items', (SELECT sum(l.quantity) FROM fixture_check_lines l WHERE l.check_id = c.id)) ORDER BY c.checked_at)
                        FROM fixture_checks c JOIN projects p ON p.id = c.project_id
                       WHERE c.kind = 'return' AND c.status = 'received'
                         AND (v_all OR fixture_inspector(c.project_id))), '[]'::jsonb))
  INTO v;
  RETURN v;
END $f$;

-- The project's Work tab: a job is idle when nothing has happened on it —
-- no labour on it and no progress update — for two weeks; day-sheet labour
-- is project labour, not "labour with no work order".
CREATE OR REPLACE FUNCTION public.project_work_board(p_project uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_costs boolean; v jsonb; v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  v_costs := labour_can_see_costs(p_project);

  WITH c AS (SELECT * FROM labour_entry_costs(p_project, NULL)),
  per_wo AS (
    SELECT work_order_id,
           count(DISTINCT (staff_id, work_date)) AS person_days,
           count(DISTINCT (staff_id, work_date)) FILTER (WHERE work_date > v_today - 7) AS week_days,
           count(DISTINCT staff_id) FILTER (WHERE work_date = v_today) AS today,
           sum(cost) AS cost, max(work_date) AS last_worked
      FROM c WHERE work_order_id IS NOT NULL GROUP BY work_order_id
  ), planned AS (
    SELECT work_order_id, sum(COALESCE(estimated_total_cost,
             CASE payment_basis
               WHEN 'per_day' THEN estimated_day_rate * estimated_days * GREATEST(headcount, 1)
               WHEN 'per_volume' THEN unit_rate * estimated_total_volume
               ELSE fixed_price_amount END)) AS planned
      FROM labor_requisitions WHERE work_order_id IS NOT NULL AND status = 'approved' AND project_id = p_project
     GROUP BY work_order_id
  ), rows AS (
    SELECT w.id, COALESCE(NULLIF(btrim(w.title), ''), left(w.scope_of_work, 80), 'Work order') AS title, w.status,
           w.current_progress_pct AS progress, w.target_completion_date AS due,
           (SELECT employee_name FROM staff WHERE id = w.assigned_lead_staff_id) AS lead,
           (SELECT count(*) FROM work_order_crew cr WHERE cr.work_order_id = w.id AND cr.removed_at IS NULL) AS crew,
           COALESCE(pw.today, 0) AS today, COALESCE(pw.week_days, 0) AS week_days, COALESCE(pw.person_days, 0) AS person_days,
           pw.cost, pl.planned, pw.last_worked,
           (SELECT max(u.created_at) FROM wo_progress_updates u WHERE u.work_order_id = w.id) AS last_update,
           w.repair_of_check_id IS NOT NULL AS repair
      FROM work_orders w
      LEFT JOIN per_wo pw ON pw.work_order_id = w.id
      LEFT JOIN planned pl ON pl.work_order_id = w.id
     WHERE w.project_id = p_project
  )
  SELECT jsonb_build_object(
    'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'status', status, 'progress', progress, 'due', due, 'lead', lead,
        'crew', crew, 'today', today, 'week_days', week_days, 'person_days', person_days, 'repair', repair,
        'cost', CASE WHEN v_costs THEN COALESCE(cost, 0) END,
        'planned', CASE WHEN v_costs THEN planned END,
        'spent_pct', CASE WHEN v_costs AND planned > 0 THEN round(COALESCE(cost, 0) / planned * 100) END,
        'last_worked', last_worked, 'last_update', last_update,
        'flags', to_jsonb(array_remove(ARRAY[
          CASE WHEN status IN ('requested', 'in_progress') AND last_worked > v_today - 14
                AND (last_update IS NULL OR last_update < now() - interval '14 days') THEN 'no_progress' END,
          CASE WHEN status IN ('requested', 'in_progress') AND planned > 0
                AND COALESCE(cost, 0) / planned * 100 - COALESCE(progress, 0) >= 20 THEN 'behind' END,
          CASE WHEN status = 'in_progress'
                AND (last_worked IS NULL OR last_worked <= v_today - 14)
                AND (last_update IS NULL OR last_update < now() - interval '14 days') THEN 'idle' END,
          CASE WHEN status IN ('requested', 'in_progress') AND due < v_today THEN 'overdue' END
        ], NULL)))
      ORDER BY (status IN ('requested', 'in_progress')) DESC, today DESC, GREATEST(last_worked, (last_update AT TIME ZONE 'Africa/Addis_Ababa')::date) DESC NULLS LAST, due NULLS LAST) FROM rows), '[]'::jsonb),
    'unlinked', (SELECT jsonb_build_object(
        'requests', (SELECT count(*) FROM labor_requisitions WHERE project_id = p_project AND work_order_id IS NULL
                      AND status = 'approved' AND closed_at IS NULL),
        'person_days', count(DISTINCT (staff_id, work_date)),
        'cost', CASE WHEN v_costs THEN COALESCE(sum(cost), 0) END,
        'last_worked', max(work_date))
      FROM c WHERE work_order_id IS NULL AND source <> 'sheet'),
    'project_labour', (SELECT jsonb_build_object(
        'build_days', COALESCE(sum(days) FILTER (WHERE bucket = 'build'), 0),
        'repair_days', COALESCE(sum(days) FILTER (WHERE bucket = 'repair'), 0),
        'week_days', COALESCE(sum(days) FILTER (WHERE work_date > v_today - 7), 0),
        'cost', CASE WHEN v_costs THEN COALESCE(sum(amount), 0) END,
        'last_worked', max(work_date))
      FROM labour_day_costs(NULL, NULL, NULL, p_project)),
    'costs_visible', v_costs)
  INTO v;
  RETURN v;
END $function$;

-- The weekly site summary counts day-sheet labour as the project's, with
-- its build and repair days; only work-order labour without a job is
-- "no work order".
CREATE OR REPLACE FUNCTION public.project_week_core(p_project uuid, p_from date, p_costs boolean)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := bot_today();
  v_from date := COALESCE(p_from, date_trunc('week', bot_today())::date);
  v_to date := v_from + 6;
  v_current boolean := v_from + 6 >= bot_today();
  v jsonb;
BEGIN
  WITH c AS (
    SELECT * FROM labour_entry_costs(p_project, NULL) WHERE work_date BETWEEN v_from - 7 AND v_to
  ), wk AS (SELECT * FROM c WHERE work_date >= v_from),
  prev AS (SELECT * FROM c WHERE work_date < v_from),
  sheet AS (SELECT * FROM labour_day_costs(NULL, v_from, v_to, p_project)),
  per_wo AS (
    SELECT work_order_id, count(DISTINCT (staff_id, work_date)) AS person_days, count(DISTINCT staff_id) AS workers, sum(cost) AS cost
      FROM wk WHERE work_order_id IS NOT NULL GROUP BY 1
  ), upd AS (
    SELECT u.work_order_id, (u.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS d, u.progress_pct, u.note, u.created_at
      FROM wo_progress_updates u JOIN work_orders w ON w.id = u.work_order_id
     WHERE w.project_id = p_project AND (u.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date <= v_to
  ), orders AS (
    SELECT w.id, COALESCE(NULLIF(btrim(w.title), ''), left(w.scope_of_work, 80), 'Work order') AS title, w.status,
           w.target_completion_date AS due,
           (SELECT u.progress_pct FROM upd u WHERE u.work_order_id = w.id AND u.d < v_from ORDER BY u.created_at DESC LIMIT 1) AS before,
           CASE WHEN v_current THEN w.current_progress_pct
                ELSE (SELECT u.progress_pct FROM upd u WHERE u.work_order_id = w.id ORDER BY u.created_at DESC LIMIT 1) END AS now,
           EXISTS (SELECT 1 FROM upd u WHERE u.work_order_id = w.id AND u.d >= v_from) AS updated,
           (SELECT u.note FROM upd u WHERE u.work_order_id = w.id AND u.d >= v_from AND NULLIF(btrim(u.note), '') IS NOT NULL ORDER BY u.created_at DESC LIMIT 1) AS note,
           COALESCE(pw.person_days, 0) AS person_days, COALESCE(pw.workers, 0) AS workers, pw.cost,
           w.status = 'completed' AND (w.updated_at AT TIME ZONE 'Africa/Addis_Ababa')::date BETWEEN v_from AND v_to AS finished
      FROM work_orders w LEFT JOIN per_wo pw ON pw.work_order_id = w.id
     WHERE w.project_id = p_project
  )
  SELECT jsonb_build_object(
    'project', (SELECT jsonb_build_object('id', p.id, 'name', btrim(p.project_name), 'progress', p.physical_progress,
                  'pm', (SELECT employee_name FROM staff WHERE id = p.project_manager_id))
                  FROM projects p WHERE p.id = p_project),
    'from', v_from, 'to', v_to, 'current', v_current, 'costs', p_costs,
    'labour', jsonb_build_object(
      'person_days', (SELECT count(DISTINCT (staff_id, work_date)) FROM wk),
      'workers', (SELECT count(DISTINCT staff_id) FROM wk),
      'days_on_site', (SELECT count(DISTINCT work_date) FROM wk),
      'overtime_hours', (SELECT COALESCE(sum(overtime_hours), 0) FROM wk),
      'cost', CASE WHEN p_costs THEN (SELECT COALESCE(sum(cost), 0) FROM wk) END,
      'prev_person_days', (SELECT count(DISTINCT (staff_id, work_date)) FROM prev),
      'prev_cost', CASE WHEN p_costs THEN (SELECT COALESCE(sum(cost), 0) FROM prev) END,
      'no_work_order_days', (SELECT count(DISTINCT (staff_id, work_date)) FROM wk WHERE work_order_id IS NULL AND source <> 'sheet'),
      'build_days', (SELECT COALESCE(sum(days), 0) FROM sheet WHERE bucket = 'build'),
      'repair_days', (SELECT COALESCE(sum(days), 0) FROM sheet WHERE bucket = 'repair'),
      'by_day', (SELECT jsonb_agg(jsonb_build_object('date', d, 'people', (SELECT count(DISTINCT staff_id) FROM wk WHERE work_date = d)) ORDER BY d)
                   FROM generate_series(v_from, v_to, interval '1 day') g(d0), LATERAL (SELECT d0::date AS d) x)),
    'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'status', status, 'due', due, 'before', before, 'now', now,
        'gain', CASE WHEN now IS NOT NULL THEN now - COALESCE(before, 0) END,
        'updated', updated, 'note', note, 'person_days', person_days, 'workers', workers,
        'cost', CASE WHEN p_costs THEN COALESCE(cost, 0) END,
        'flags', to_jsonb(array_remove(ARRAY[
          CASE WHEN person_days > 0 AND NOT updated THEN 'no_update' END,
          CASE WHEN status <> 'completed' AND due < LEAST(v_to, v_today) THEN 'overdue' END], NULL)))
        ORDER BY person_days DESC, title)
      FROM orders WHERE person_days > 0 OR updated OR finished), '[]'::jsonb),
    'finished', COALESCE((SELECT jsonb_agg(title ORDER BY title) FROM orders WHERE finished), '[]'::jsonb),
    'overdue', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', title, 'due', due) ORDER BY due)
                FROM orders WHERE status IN ('requested', 'in_progress') AND due < LEAST(v_to, v_today)), '[]'::jsonb),
    'idle_orders', (SELECT count(*) FROM orders WHERE status = 'in_progress' AND person_days = 0 AND NOT updated),
    'open_orders', (SELECT count(*) FROM orders WHERE status IN ('requested', 'in_progress')),
    'pay', (SELECT jsonb_build_object(
        'to_request', count(*) FILTER (WHERE NOT x.in_request),
        'to_request_amount', CASE WHEN p_costs THEN COALESCE(sum(x.amount_etb) FILTER (WHERE NOT x.in_request), 0) END,
        'with_finance', (SELECT count(DISTINCT q.id) FROM labour_pay_requests q JOIN labour_pay_request_items i ON i.request_id = q.id AND i.removed_at IS NULL
                           JOIN expenses e ON e.id = i.expense_id WHERE q.status IN ('submitted', 'approved') AND e.project_id = p_project),
        'returned', (SELECT count(DISTINCT q.id) FROM labour_pay_requests q JOIN labour_pay_request_items i ON i.request_id = q.id AND i.removed_at IS NULL
                           JOIN expenses e ON e.id = i.expense_id WHERE q.status = 'returned' AND e.project_id = p_project),
        'paid_week', CASE WHEN p_costs THEN (SELECT COALESCE(sum(e.amount_etb), 0) FROM expenses e
                           WHERE e.project_id = p_project AND e.payment_state = 'paid'
                             AND e.paid_date::date BETWEEN v_from AND v_to
                             AND (EXISTS (SELECT 1 FROM labour_pay_sheets ps WHERE ps.expense_id = e.id)
                                  OR EXISTS (SELECT 1 FROM labour_pay_holds h WHERE h.expense_id = e.id))) END)
      FROM (SELECT e.amount_etb,
                   EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
                            WHERE i.expense_id = e.id AND i.removed_at IS NULL AND q.status <> 'cancelled') AS in_request
              FROM expenses e
              LEFT JOIN labour_pay_sheets ps ON ps.expense_id = e.id
              LEFT JOIN labour_pay_holds h ON h.expense_id = e.id
             WHERE e.project_id = p_project AND (ps.id IS NOT NULL OR h.expense_id IS NOT NULL)
               AND e.approval_status = 'pending' AND COALESCE(e.payment_state, 'unpaid') = 'unpaid'
               AND NOT COALESCE(e.is_archived, false)) x),
    'unverified', (SELECT count(DISTINCT wk.staff_id) FROM wk JOIN staff s ON s.id = wk.staff_id
                    WHERE s.employment_type = 'tier_2_casual' AND s.verified_at IS NULL),
    'quiet_requests', (SELECT count(*) FROM labor_requisitions r
                        WHERE r.project_id = p_project AND r.status = 'approved' AND r.closed_at IS NULL AND r.created_at < now() - interval '21 days'
                          AND NOT EXISTS (SELECT 1 FROM labour_work_entries e WHERE e.labor_requisition_id = r.id AND e.work_date > CURRENT_DATE - 21)
                          AND NOT EXISTS (SELECT 1 FROM wo_attendance_log l WHERE l.labor_requisition_id = r.id AND l.log_date > CURRENT_DATE - 21))
  ) INTO v;
  RETURN v;
END $function$;

REVOKE EXECUTE ON FUNCTION trg_project_lifecycle_guard() FROM PUBLIC, anon, authenticated;
