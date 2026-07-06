-- Migration 059: Transportation → real logistics operation
--
-- Models the company's actual fleet and dispatch culture:
--   • vehicles registry — IVECO truck (the one PPE recognized in the
--     books), Toyota carry-on (off-books), electric motorbike (light
--     materials + finance document courier). Live status makes "the
--     manager pulled the truck" visible instead of a surprise.
--   • transportation_requests become dispatch JOBS: a type (material
--     move / purchase pickup / document courier / people move), a mode
--     (own fleet / ride-hailing / hired third-party), an assigned staff
--     member, and a lifecycle (requested → assigned → in_progress →
--     completed / cancelled).
--   • hired third-party classes: Lada, mini Isuzu, Isuzu, Toyota
--     carry-on — used when the own fleet is offline or on a job.
--   • badges on user_profiles: logistics officer (dispatch rights) and
--     ride-hailing authorization (per selected employees).
--   • locations gain map coordinates + a kind, so sites/vendor shops/
--     offices can be pinned on an integrated map.

SET search_path TO public;

-- ── Badges (first — the vehicles policy below references them) ────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_logistics_officer       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_ride_hailing_authorized BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Vehicles (owned fleet) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  vehicle_type        TEXT NOT NULL DEFAULT 'other'
                      CHECK (vehicle_type IN ('truck', 'pickup', 'motorbike', 'van', 'other')),
  plate_number        TEXT,
  recognized_in_books BOOLEAN NOT NULL DEFAULT FALSE,  -- IVECO is PPE; others off-books
  status              TEXT NOT NULL DEFAULT 'available'
                      CHECK (status IN ('available', 'on_job', 'maintenance', 'offline')),
  purpose_notes       TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles_read_all" ON vehicles;
CREATE POLICY "vehicles_read_all" ON vehicles
  FOR SELECT USING (get_user_role() IS NOT NULL);

DROP POLICY IF EXISTS "vehicles_manage" ON vehicles;
CREATE POLICY "vehicles_manage" ON vehicles
  FOR ALL USING (
    get_user_role() IN ('admin', 'manager')
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true)
  );

-- ── Locations: map pins + kind ────────────────────────────────────
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS kind      TEXT NOT NULL DEFAULT 'other';

DO $$ BEGIN
  ALTER TABLE locations ADD CONSTRAINT locations_kind_check
    CHECK (kind IN ('site', 'vendor_shop', 'office', 'workshop', 'warehouse', 'client', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Transportation requests → dispatch jobs ───────────────────────
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS job_type            TEXT NOT NULL DEFAULT 'material_move',
  ADD COLUMN IF NOT EXISTS transport_mode      TEXT NOT NULL DEFAULT 'own_fleet',
  ADD COLUMN IF NOT EXISTS vehicle_id          UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hired_vehicle_class TEXT,
  ADD COLUMN IF NOT EXISTS assigned_staff_id   UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_status          TEXT NOT NULL DEFAULT 'requested',
  ADD COLUMN IF NOT EXISTS priority            TEXT NOT NULL DEFAULT 'normal';

DO $$ BEGIN
  ALTER TABLE transportation_requests ADD CONSTRAINT tr_job_type_check
    CHECK (job_type IN ('material_move', 'purchase_pickup', 'document_courier', 'people_move'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE transportation_requests ADD CONSTRAINT tr_transport_mode_check
    CHECK (transport_mode IN ('own_fleet', 'ride_hailing', 'hired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE transportation_requests ADD CONSTRAINT tr_hired_class_check
    CHECK (hired_vehicle_class IS NULL OR hired_vehicle_class IN ('lada', 'mini_isuzu', 'isuzu', 'toyota_carryon', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE transportation_requests ADD CONSTRAINT tr_job_status_check
    CHECK (job_status IN ('requested', 'assigned', 'in_progress', 'completed', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE transportation_requests ADD CONSTRAINT tr_priority_check
    CHECK (priority IN ('normal', 'urgent', 'critical'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_tr_assigned_staff ON transportation_requests(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_tr_job_status     ON transportation_requests(job_status);
CREATE INDEX IF NOT EXISTS idx_tr_vehicle        ON transportation_requests(vehicle_id);

-- Existing rows: treat anything already delivered as completed
UPDATE transportation_requests
SET job_status = 'completed'
WHERE actual_delivery_date IS NOT NULL AND job_status = 'requested';

-- ── Seed the current fleet (idempotent by name) ───────────────────
INSERT INTO vehicles (name, vehicle_type, recognized_in_books, purpose_notes)
SELECT 'IVECO', 'truck', TRUE,
  'Heavy materials: purchase point → site/workshop; mostly processed materials workshop → site for assembly. The one vehicle recognized as PPE in the books.'
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE name = 'IVECO');

INSERT INTO vehicles (name, vehicle_type, recognized_in_books, purpose_notes)
SELECT 'Toyota (carry-on)', 'pickup', FALSE,
  'Paints and bulk purchases → workshop and site. Not recognized in the books.'
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE name = 'Toyota (carry-on)');

INSERT INTO vehicles (name, vehicle_type, recognized_in_books, purpose_notes)
SELECT 'Electric Motorbike', 'motorbike', FALSE,
  'Lightweight materials; primarily finance courier — receipts, checks, contracts and finance documents.'
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE name = 'Electric Motorbike');
