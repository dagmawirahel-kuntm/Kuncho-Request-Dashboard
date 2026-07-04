-- Migration 052: Company calendar + staff ID/photo attachments
--
-- 1. company_events: the shared calendar that doubles as the
--    manager → department communication gate. An event can be
--    company-wide (department IS NULL) or scoped to one department;
--    types cover announcements, events, to-dos, and holidays.
-- 2. staff gains an ID-document attachment (photo_url already exists
--    from migration 044).

SET search_path TO public;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS id_document_url  TEXT,
  ADD COLUMN IF NOT EXISTS id_document_name TEXT;

CREATE TABLE IF NOT EXISTS company_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT,
  event_date  DATE NOT NULL,
  start_time  TIME,
  end_time    TIME,
  event_type  TEXT NOT NULL DEFAULT 'event'
              CHECK (event_type IN ('announcement', 'event', 'task', 'holiday')),
  department  TEXT,  -- NULL = company-wide; otherwise a staff department name
  created_by  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_events_date ON company_events(event_date);

ALTER TABLE company_events ENABLE ROW LEVEL SECURITY;

-- Everyone in the company reads the calendar
DROP POLICY IF EXISTS "events_read_all" ON company_events;
CREATE POLICY "events_read_all" ON company_events
  FOR SELECT USING (get_user_role() IS NOT NULL);

-- Admins, managers, and HR post to it (the communication gate)
DROP POLICY IF EXISTS "events_write" ON company_events;
CREATE POLICY "events_write" ON company_events
  FOR ALL USING (get_user_role() IN ('admin', 'manager', 'hr_officer'));
