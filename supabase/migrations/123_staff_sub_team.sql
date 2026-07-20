-- ============================================================
-- staff.sub_team (spec §4).
--
-- Do NOT reopen keeping Workshop under Operations/Construction as one
-- department (082) — this is a lightweight sub-grouping WITHIN that
-- one department for its ~40 fabrication staff, not a new department.
-- Plain nullable TEXT, not a CHECK-constrained enum: the exact set of
-- workshop sub-teams (Carpentry, CNC, Leather, Site, ...) is expected
-- to evolve without needing a migration each time, matching this
-- codebase's general preference for free-text-with-suggestions over
-- rigid enums for similarly loose classification fields (e.g.
-- staff.role itself). The frontend scopes editing/display to
-- Operations/Construction staff only and offers a suggested list.
--
-- Deliberately named sub_team, not anything containing "FF&E" — Design's
-- ffe_specifications (spec records) already uses that term; this is a
-- different concept (a group of fabrication staff) and must not collide
-- with it in the UI.
-- ============================================================

SET search_path TO public;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS sub_team TEXT;

-- Verify
SELECT column_name FROM information_schema.columns WHERE table_name = 'staff' AND column_name = 'sub_team';
