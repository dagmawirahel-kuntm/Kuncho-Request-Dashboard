-- ============================================================
-- Location map integration (#11 build part).
--
-- Reality check that shaped this: only the `locations` table carried
-- coordinates, and all 8 rows were unpinned — properties, projects and
-- vendors had no lat/lng at all, so nothing could reach the map and
-- there was nothing to auto-derive. Coordinates can't be invented, so
-- the essential entities are made pinnable and everything geocoded is
-- unified into one source the map reads. The map populates as the org
-- drops pins; the structure no longer blocks it.
--
-- Deliberately NOT geocoding addresses: there's no geocoding service
-- available here and fabricating coordinates from a text address would
-- put pins in the wrong place. A human drops the pin.
-- ============================================================

SET search_path TO public;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE projects   ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE projects   ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- One unified, geocoded map source, categorised so the frontend can
-- layer by what each department tracks: manually pinned locations (by
-- kind), leased workshops, project sites, and — the "track destinations"
-- layer — active transport jobs whose dropoff is a pinned location.
CREATE OR REPLACE VIEW v_map_points
WITH (security_invoker = true) AS
SELECT 'location'::text AS category, l.kind::text AS subtype, l.id, l.location_name AS name,
       l.latitude AS lat, l.longitude AS lng, NULL::text AS status, l.project_id, l.vendor_id
FROM locations l WHERE l.latitude IS NOT NULL AND l.longitude IS NOT NULL
UNION ALL
SELECT 'property', 'workshop', p.id, p.property_name, p.latitude, p.longitude, p.status::text, NULL, NULL
FROM properties p WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
UNION ALL
SELECT 'project', 'site', pr.id, pr.project_name, pr.latitude, pr.longitude, NULL, pr.id, NULL
FROM projects pr WHERE pr.latitude IS NOT NULL AND pr.longitude IS NOT NULL
UNION ALL
SELECT 'fleet_destination', tr.job_status::text, tr.id,
       COALESCE(tr.request_name, 'Job') || ' → ' || COALESCE(dl.location_name, 'dropoff'),
       dl.latitude, dl.longitude, tr.job_status::text, tr.project_id, tr.vendor_id
FROM transportation_requests tr
JOIN locations dl ON dl.id = tr.dropoff_location_id
WHERE tr.job_status IN ('requested','assigned','in_progress')
  AND dl.latitude IS NOT NULL AND dl.longitude IS NOT NULL;

GRANT SELECT ON v_map_points TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT count(*) AS geo_cols FROM information_schema.columns
WHERE table_name IN ('properties','projects') AND column_name IN ('latitude','longitude');
SELECT category, count(*) FROM v_map_points GROUP BY category;
