-- 540: A switch for festive documents.
--
-- Documents dated in a festive season (lib/seasons.ts: Christmas, New Year
-- and Gena, 25 Nov 2026 → 8 Jan 2027) carry its mark: a red, green and gold
-- tibeb band, a small ornament beside the title and a dated greeting in the
-- footer; emails and shared links carry the season's greeting. On by
-- default; Company & Documents turns it off. The app reads a missing column
-- as on, so the season shows before this runs — this only adds the switch.

ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS festive_documents boolean NOT NULL DEFAULT true;
