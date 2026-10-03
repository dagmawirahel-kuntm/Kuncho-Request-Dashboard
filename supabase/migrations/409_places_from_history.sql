-- 409 — Where vendors are and where projects happen, from what we already know
--
-- What the data showed (Oct 2026): 478 vendors and not one tied to a saved
-- place (10 had a place typed in free text); 106 projects with 2 tied to a
-- site; 7 saved "site" places with no project. Yet the transport history
-- already says where each vendor's goods are collected (61 purchase-order
-- pickups — Surafel Getiye at Merkato 13 times out of 13, Abduselam Murad
-- at Urael 7 of 7) and where each project's deliveries go (Mesob Exhibition
-- Center A → Meskel Adebabay 11 of 13, Mesob Kitchen → Imperial 8 of 13),
-- and the old Airtable base linked five sites to their projects.
--
-- Now:
--   * vendors.location_id — the vendor's usual place (shop, market area);
--     location_source on vendors and projects says where it came from.
--   * v_place_suggestions — for a vendor or project without a place: the
--     place the history points to, how many trips say so and what share.
--   * apply_place_suggestion() — accept one (or pick another place).
--   * Filled now where the history is clear: a vendor whose pickups are at
--     one place 60%+ of the time; a vendor whose typed location names one
--     saved market or area; a project with 2+ deliveries, 60%+ to one site
--     (workshop, office and market trips left out); the Airtable links.
--     A place that becomes a project's site is marked as a site.

SET search_path TO public;

ALTER TABLE vendors  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE vendors  ADD COLUMN IF NOT EXISTS location_source text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_source text;
CREATE INDEX IF NOT EXISTS idx_vendors_location ON vendors (location_id) WHERE location_id IS NOT NULL;

-- ── Suggestions ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_place_suggestions WITH (security_invoker = true) AS
WITH vendor_trips AS (
  SELECT COALESCE(sb.vendor_id, CASE WHEN t.job_type = 'purchase_pickup' THEN t.vendor_id END) AS vendor_id,
         t.pickup_location_id AS location_id
    FROM transportation_requests t
    LEFT JOIN sourcing_bundles sb ON sb.id = t.sourcing_bundle_id
    JOIN locations l ON l.id = t.pickup_location_id
   WHERE t.job_status <> 'cancelled' AND l.kind NOT IN ('workshop', 'office', 'site')
     AND l.is_active AND btrim(l.location_name) <> 'New Location'
), vendor_ranked AS (
  SELECT vendor_id, location_id, count(*) AS trips,
         sum(count(*)) OVER (PARTITION BY vendor_id) AS total,
         row_number() OVER (PARTITION BY vendor_id ORDER BY count(*) DESC) AS rn
    FROM vendor_trips WHERE vendor_id IS NOT NULL
   GROUP BY vendor_id, location_id
), vendor_typed AS (
  SELECT v.id AS vendor_id, min(l.id::text)::uuid AS location_id, count(DISTINCT l.id) AS hits
    FROM vendors v
    JOIN locations l ON l.is_active AND l.kind IN ('market', 'other')
     AND (' ' || btrim(regexp_replace(lower(v.location), '[^a-z0-9]+', ' ', 'g')) || ' '
            LIKE '% ' || btrim(regexp_replace(lower(l.location_name), '[^a-z0-9]+', ' ', 'g')) || ' %'
          OR EXISTS (SELECT 1 FROM unnest(l.aliases) a
                      WHERE length(btrim(a)) >= 4 AND lower(btrim(v.location)) = lower(btrim(a))))
   WHERE NULLIF(btrim(v.location), '') IS NOT NULL
   GROUP BY v.id
), project_trips AS (
  SELECT COALESCE(t.project_id,
           (SELECT o.project_id FROM sourcing_bundle_items sbi
              JOIN order_items oi ON oi.id = sbi.order_item_id
              JOIN orders o ON o.id = oi.order_id
             WHERE sbi.bundle_id = t.sourcing_bundle_id AND o.project_id IS NOT NULL
             GROUP BY o.project_id ORDER BY count(*) DESC LIMIT 1)) AS project_id,
         t.dropoff_location_id AS location_id
    FROM transportation_requests t
    JOIN locations l ON l.id = t.dropoff_location_id
   WHERE t.job_status <> 'cancelled' AND l.kind NOT IN ('workshop', 'office', 'market')
     AND l.is_active AND btrim(l.location_name) <> 'New Location'
), project_ranked AS (
  SELECT project_id, location_id, count(*) AS trips,
         sum(count(*)) OVER (PARTITION BY project_id) AS total,
         row_number() OVER (PARTITION BY project_id ORDER BY count(*) DESC) AS rn
    FROM project_trips WHERE project_id IS NOT NULL
   GROUP BY project_id, location_id
)
SELECT 'vendor'::text AS subject_kind, v.id AS subject_id, v.vendor_name AS subject_name,
       l.id AS location_id, l.location_name, l.kind AS location_kind,
       r.trips::int, r.total::int, round(r.trips::numeric / r.total, 2) AS share,
       'Goods collected here on ' || r.trips || ' of ' || r.total || ' pickup' || CASE WHEN r.total = 1 THEN '' ELSE 's' END AS evidence
  FROM vendor_ranked r JOIN vendors v ON v.id = r.vendor_id JOIN locations l ON l.id = r.location_id
 WHERE r.rn = 1 AND v.location_id IS NULL
UNION ALL
SELECT 'vendor', v.id, v.vendor_name, l.id, l.location_name, l.kind, 0, 0, NULL,
       'Typed on the vendor: "' || btrim(v.location) || '"'
  FROM vendor_typed t JOIN vendors v ON v.id = t.vendor_id JOIN locations l ON l.id = t.location_id
 WHERE t.hits = 1 AND v.location_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM vendor_ranked r WHERE r.vendor_id = v.id AND r.rn = 1)
UNION ALL
SELECT 'project', p.id, p.project_name, l.id, l.location_name, l.kind,
       r.trips::int, r.total::int, round(r.trips::numeric / r.total, 2),
       'Delivered here on ' || r.trips || ' of ' || r.total || ' trip' || CASE WHEN r.total = 1 THEN '' ELSE 's' END
  FROM project_ranked r JOIN projects p ON p.id = r.project_id JOIN locations l ON l.id = r.location_id
 WHERE r.rn = 1 AND p.location_id IS NULL
UNION ALL
SELECT 'project', p.id, p.project_name, l.id, l.location_name, l.kind, 0, 0, NULL,
       'The place is saved as this project''s site'
  FROM locations l JOIN projects p ON p.id = l.project_id
 WHERE l.is_active AND p.location_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM project_ranked r WHERE r.project_id = p.id AND r.rn = 1);

GRANT SELECT ON v_place_suggestions TO authenticated;

-- ── Accepting one ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_place_suggestion(p_kind text, p_id uuid, p_location uuid, p_source text DEFAULT 'confirmed')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_role text := get_user_role()::text; v_logistics boolean;
BEGIN
  SELECT COALESCE(is_logistics_officer, false) INTO v_logistics FROM user_profiles WHERE id = auth.uid();
  IF p_location IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations WHERE id = p_location) THEN
    RAISE EXCEPTION 'That place no longer exists';
  END IF;
  IF p_kind = 'vendor' THEN
    IF NOT (v_role IN ('admin', 'executive', 'finance', 'procurement_officer', 'logistics_officer') OR v_logistics) THEN
      RAISE EXCEPTION 'Only procurement, logistics, finance or an admin can set where a vendor is';
    END IF;
    UPDATE vendors SET location_id = p_location, location_source = CASE WHEN p_location IS NULL THEN NULL ELSE p_source END WHERE id = p_id;
  ELSIF p_kind = 'project' THEN
    IF NOT (v_role IN ('admin', 'executive', 'operations_manager', 'logistics_officer') OR v_logistics OR manages_project(p_id)) THEN
      RAISE EXCEPTION 'Only operations, logistics, the project''s manager or an admin can set a project''s site';
    END IF;
    UPDATE projects SET location_id = p_location, location_source = CASE WHEN p_location IS NULL THEN NULL ELSE p_source END WHERE id = p_id;
    -- The place is a site now, and this project's.
    UPDATE locations SET kind = 'site', location_type = 'site' WHERE id = p_location AND kind = 'other';
    UPDATE locations SET project_id = p_id WHERE id = p_location AND project_id IS NULL;
  ELSE
    RAISE EXCEPTION 'Unknown kind %', p_kind;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION apply_place_suggestion(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_place_suggestion(text, uuid, uuid, text) TO authenticated;

-- ── Filled now where the history is clear ────────────────────────────
UPDATE vendors v SET location_id = s.location_id, location_source = 'transport history: ' || s.evidence
  FROM v_place_suggestions s
 WHERE s.subject_kind = 'vendor' AND s.subject_id = v.id AND s.total > 0 AND s.share >= 0.6 AND v.location_id IS NULL;

UPDATE vendors v SET location_id = s.location_id, location_source = s.evidence
  FROM v_place_suggestions s
 WHERE s.subject_kind = 'vendor' AND s.subject_id = v.id AND s.total = 0 AND v.location_id IS NULL;

-- From the old Airtable base: its Location table linked these sites.
UPDATE projects p SET location_id = l.id, location_source = 'Airtable site link'
  FROM (VALUES ('Science Museum', 'MESOB - Science Museum'),
               ('Dr Solomon', 'Solomon Garden'),
               ('Summit', 'Jotun New Shops (Summit)'),
               ('Ethio Ceramics', 'Jotun New Shops (Ethio Ceramics)'),
               ('Workshop', 'Workshop')) m(place, project)
  JOIN locations l ON btrim(l.location_name) = m.place
 WHERE btrim(p.project_name) = m.project AND p.location_id IS NULL;

UPDATE projects p SET location_id = s.location_id, location_source = 'transport history: ' || s.evidence
  FROM v_place_suggestions s
 WHERE s.subject_kind = 'project' AND s.subject_id = p.id AND s.trips >= 2 AND s.share >= 0.6 AND p.location_id IS NULL;
-- Applied (Oct 2026): 29 vendors from pickups, 5 from their typed place,
-- 5 projects from Airtable, 6 from deliveries; 5 places became sites.

-- Places that are now a project's site say so.
UPDATE locations l SET kind = 'site', location_type = 'site'
  FROM projects p WHERE p.location_id = l.id AND l.kind = 'other';
UPDATE locations l SET project_id = p.id
  FROM projects p WHERE p.location_id = l.id AND l.project_id IS NULL
   AND (SELECT count(*) FROM projects p2 WHERE p2.location_id = l.id) = 1;
