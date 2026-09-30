-- 382 — Narrow the grants on the dashboard tables from 380 and 381
--
-- Supabase's default privileges give `authenticated` every privilege on a
-- new table, and 380/381 only added grants on top. Row-level security
-- already blocks the writes those tables have no policy for, but TRUNCATE
-- isn't subject to RLS, so take back everything the tables don't use:
--   kudos               select, insert, delete (RLS decides which rows)
--   dashboard_progress  select only — writes go through
--                       record_dashboard_progress(), which runs as owner

SET search_path TO public;

REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON kudos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON dashboard_progress FROM authenticated;
