-- Migration 055: Staff hierarchy — Workplace + Management Level
--
-- Restructures how staff are categorized, three tiers:
--   Department (bigger group)  — existing staff_type: Office, Work Shop,
--                                 Field, Leather Workshop, Site
--   Workplace (specific role)  — existing `role` column, relabeled in
--                                 the UI from "Role / Position" to
--                                 "Workplace" (no column rename — every
--                                 join/select stays valid)
--   Management Level (new)     — Upper / Medium / Low seniority tier,
--                                 assigned by managers/admin/HR

SET search_path TO public;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS management_level TEXT;

DO $$ BEGIN
  ALTER TABLE staff ADD CONSTRAINT staff_management_level_check
    CHECK (management_level IS NULL OR management_level IN ('upper', 'medium', 'low'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
