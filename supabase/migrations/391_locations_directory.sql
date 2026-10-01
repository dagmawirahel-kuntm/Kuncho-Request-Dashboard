-- 391 — Locations as a working directory of places
--
-- The locations table had nine rows, none pinned on the map, and the kind
-- of place sitting in the old free-text location_type column while kind
-- said 'other'. Meanwhile 138 of 140 transport jobs typed their pickup and
-- dropoff as free text — "merkato", "urael", "workshop", "skylight",
-- "skyligh" — because there was nothing useful to pick from.
--
-- This makes a location worth saving and worth picking:
--   * where it is in words (area, address) and who to ask for there
--   * the other names people type for it, so "skyligh" finds Skylight Hotel
--   * archived instead of deleted, since jobs, expenses and assets point at it
--   * how much it is used (v_location_usage)
--   * the places typed into transport jobs that aren't saved yet
--     (v_unsaved_transport_places), and link_transport_places() to attach
--     those jobs to a saved location in one go
--   * merge_locations() for two saved locations that are the same place.

SET search_path TO public;

-- ── More about the place ─────────────────────────────────────────────────
ALTER TABLE locations ADD COLUMN IF NOT EXISTS area          text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS address       text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS contact_name  text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS aliases       text[] NOT NULL DEFAULT '{}';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS is_active     boolean NOT NULL DEFAULT true;

-- The kind was only ever filled in the legacy column. Carry it over.
UPDATE locations SET kind = CASE lower(btrim(location_type))
    WHEN 'site' THEN 'site' WHEN 'office' THEN 'office'
    WHEN 'workshop' THEN 'workshop' WHEN 'warehouse' THEN 'warehouse'
    ELSE kind END
 WHERE kind = 'other' AND location_type IS NOT NULL;

-- Keep the legacy column saying the same thing as kind, for anything that
-- still reads it; and keep the other names tidy (trimmed, no blanks, no
-- repeats, none equal to the name itself).
CREATE OR REPLACE FUNCTION locations_tidy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.location_name := btrim(NEW.location_name);
  NEW.location_type := initcap(replace(COALESCE(NEW.kind, 'other'), '_', ' '));
  NEW.aliases := COALESCE((
    SELECT array_agg(a ORDER BY a) FROM (
      SELECT DISTINCT btrim(x) AS a FROM unnest(COALESCE(NEW.aliases, '{}')) x
       WHERE btrim(x) <> '' AND lower(btrim(x)) <> lower(NEW.location_name)
    ) t), '{}');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_locations_tidy ON locations;
CREATE TRIGGER trg_locations_tidy BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION locations_tidy();
UPDATE locations SET location_type = location_type;  -- run the tidy once

-- ── How much each place is used ──────────────────────────────────────────
CREATE OR REPLACE VIEW v_location_usage WITH (security_invoker = true) AS
SELECT l.id AS location_id,
       (SELECT count(*) FROM projects p WHERE p.location_id = l.id)                                  AS projects,
       (SELECT count(*) FROM transportation_requests t
         WHERE t.pickup_location_id = l.id OR t.dropoff_location_id = l.id)                          AS transport_jobs,
       (SELECT max(t.created_at) FROM transportation_requests t
         WHERE t.pickup_location_id = l.id OR t.dropoff_location_id = l.id)                          AS last_transport_at,
       (SELECT count(*) FROM expenses e WHERE e.location_id = l.id)                                  AS expenses,
       (SELECT count(*) FROM fixed_assets a WHERE a.location_id = l.id)                              AS assets,
       (SELECT count(*) FROM hse_incidents h WHERE h.location_id = l.id)                             AS hse_incidents
  FROM locations l;

-- ── Places typed into transport jobs but not saved ───────────────────────
-- One row per place as typed (case and spaces ignored), with how often and
-- the most common spelling. Reads through transportation_requests' RLS, so
-- each person sees the places from the jobs they can see.
CREATE OR REPLACE VIEW v_unsaved_transport_places WITH (security_invoker = true) AS
WITH typed AS (
  SELECT btrim(pickup_location_text) AS place, created_at FROM transportation_requests
   WHERE pickup_location_id IS NULL AND btrim(COALESCE(pickup_location_text, '')) <> ''
  UNION ALL
  SELECT btrim(dropoff_location_text), created_at FROM transportation_requests
   WHERE dropoff_location_id IS NULL AND btrim(COALESCE(dropoff_location_text, '')) <> ''
), spelled AS (
  SELECT lower(place) AS place_key, place, count(*) AS n, max(created_at) AS last_at FROM typed GROUP BY 1, 2
)
SELECT place_key,
       (array_agg(place ORDER BY n DESC, place))[1] AS place,
       sum(n)::int AS times,
       max(last_at) AS last_used_at
  FROM spelled
 GROUP BY place_key;

-- ── Attach typed places to a saved location ──────────────────────────────
-- Every transport job whose pickup or dropoff was typed as one of p_places
-- (case and spaces ignored) and has no location yet gets this location, and
-- the typed spellings become the location's other names. Runs as the
-- caller: they need to be able to update both the jobs and the location.
CREATE OR REPLACE FUNCTION link_transport_places(p_location_id uuid, p_places text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_keys text[];
  v_pickups int; v_dropoffs int;
  v_name text;
BEGIN
  SELECT location_name INTO v_name FROM locations WHERE id = p_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such location'; END IF;
  SELECT array_agg(DISTINCT lower(btrim(x))) INTO v_keys FROM unnest(p_places) x WHERE btrim(x) <> '';
  IF v_keys IS NULL THEN RETURN jsonb_build_object('pickups', 0, 'dropoffs', 0); END IF;

  UPDATE transportation_requests SET pickup_location_id = p_location_id
   WHERE pickup_location_id IS NULL AND lower(btrim(pickup_location_text)) = ANY (v_keys);
  GET DIAGNOSTICS v_pickups = ROW_COUNT;
  UPDATE transportation_requests SET dropoff_location_id = p_location_id
   WHERE dropoff_location_id IS NULL AND lower(btrim(dropoff_location_text)) = ANY (v_keys);
  GET DIAGNOSTICS v_dropoffs = ROW_COUNT;

  UPDATE locations SET aliases = aliases || ARRAY(SELECT DISTINCT btrim(x) FROM unnest(p_places) x WHERE btrim(x) <> '')
   WHERE id = p_location_id;
  RETURN jsonb_build_object('pickups', v_pickups, 'dropoffs', v_dropoffs);
END $$;

-- ── Two saved locations that are the same place ──────────────────────────
-- Everything pointing at p_from points at p_into instead; p_from's name and
-- other names become p_into's other names; p_from is archived. Runs as the
-- caller, so they need to be able to update every record that moves.
CREATE OR REPLACE FUNCTION merge_locations(p_from uuid, p_into uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  f locations%ROWTYPE;
  n int; moved jsonb := '{}';
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION 'Pick two different locations'; END IF;
  SELECT * INTO f FROM locations WHERE id = p_from;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM locations WHERE id = p_into) THEN RAISE EXCEPTION 'No such location'; END IF;

  UPDATE projects SET location_id = p_into WHERE location_id = p_from;                         GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('projects', n);
  UPDATE transportation_requests SET pickup_location_id = p_into WHERE pickup_location_id = p_from; GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('pickups', n);
  UPDATE transportation_requests SET dropoff_location_id = p_into WHERE dropoff_location_id = p_from; GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('dropoffs', n);
  UPDATE expenses SET location_id = p_into WHERE location_id = p_from;                         GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('expenses', n);
  UPDATE fixed_assets SET location_id = p_into WHERE location_id = p_from;                     GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('assets', n);
  UPDATE fixed_asset_movements SET from_location_id = p_into WHERE from_location_id = p_from;
  UPDATE fixed_asset_movements SET to_location_id = p_into WHERE to_location_id = p_from;
  UPDATE hse_incidents SET location_id = p_into WHERE location_id = p_from;                    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('hse_incidents', n);

  UPDATE locations SET aliases = aliases || ARRAY[f.location_name] || f.aliases,
         latitude  = COALESCE(latitude, f.latitude),  longitude = COALESCE(longitude, f.longitude),
         address   = COALESCE(address, f.address),    area = COALESCE(area, f.area),
         contact_name = COALESCE(contact_name, f.contact_name), contact_phone = COALESCE(contact_phone, f.contact_phone)
   WHERE id = p_into;
  UPDATE locations SET is_active = false,
         notes = concat_ws(E'\n', notes, 'Merged into another location on ' || to_char(now(), 'YYYY-MM-DD') || '.')
   WHERE id = p_from;
  RETURN moved;
END $$;

REVOKE ALL ON FUNCTION merge_locations(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION merge_locations(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION link_transport_places(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION link_transport_places(uuid, text[]) TO authenticated;
REVOKE ALL ON v_location_usage, v_unsaved_transport_places FROM anon;
GRANT SELECT ON v_location_usage, v_unsaved_transport_places TO authenticated;
