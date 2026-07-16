-- ============================================================
-- Design department tables. Design is a staffed department (see
-- migration 082) with zero tables today — nothing tracks a design
-- package's status, the drawing register, or the FF&E schedule, all
-- of which feed the Stage 2 (design/permit) gate on projects.stage.
--
-- Requires migration 081 (adds the `design` role) to have already
-- committed — this migration's write policies reference it.
-- ============================================================

SET search_path TO public;

-- ── Design packages: one per project, drives the Stage 2 gate ──────
CREATE TABLE IF NOT EXISTS design_packages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  brief          TEXT,
  status         TEXT NOT NULL DEFAULT 'brief'
                 CHECK (status IN ('brief', 'concept', 'detailed', 'client_review', 'signed_off')),
  signed_off_by  UUID REFERENCES user_profiles(id),
  signed_off_at  TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_packages_project ON design_packages(project_id);

-- ── Drawing register ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS design_drawings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_package_id UUID NOT NULL REFERENCES design_packages(id) ON DELETE CASCADE,
  drawing_no        TEXT,
  title             TEXT NOT NULL,
  discipline        TEXT,
  revision          TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'issued', 'approved', 'superseded')),
  file_url          TEXT,
  file_name         TEXT,
  issued_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_drawings_package ON design_drawings(design_package_id);

-- ── FF&E schedule (furniture / fixtures / equipment) ────────────────
CREATE TABLE IF NOT EXISTS ffe_specifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_package_id UUID NOT NULL REFERENCES design_packages(id) ON DELETE CASCADE,
  area_room         TEXT,
  item_name         TEXT NOT NULL,
  specification     TEXT,
  quantity          NUMERIC(12,2),
  unit              TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ffe_specifications_package ON ffe_specifications(design_package_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Read: any authenticated user (design work is visible company-wide,
-- same as projects/categories/etc). Write: the owning department
-- (design) plus admin/manager, per the §1 department->role map.
ALTER TABLE design_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_drawings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ffe_specifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "design_packages_read" ON design_packages;
CREATE POLICY "design_packages_read" ON design_packages FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "design_packages_write" ON design_packages;
CREATE POLICY "design_packages_write" ON design_packages FOR ALL
  USING (get_user_role() IN ('design', 'admin', 'manager'));

DROP POLICY IF EXISTS "design_drawings_read" ON design_drawings;
CREATE POLICY "design_drawings_read" ON design_drawings FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "design_drawings_write" ON design_drawings;
CREATE POLICY "design_drawings_write" ON design_drawings FOR ALL
  USING (get_user_role() IN ('design', 'admin', 'manager'));

DROP POLICY IF EXISTS "ffe_specifications_read" ON ffe_specifications;
CREATE POLICY "ffe_specifications_read" ON ffe_specifications FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "ffe_specifications_write" ON ffe_specifications;
CREATE POLICY "ffe_specifications_write" ON ffe_specifications FOR ALL
  USING (get_user_role() IN ('design', 'admin', 'manager'));

-- Verify: RLS is on and each table has both a read and a write policy
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('design_packages', 'design_drawings', 'ffe_specifications')
ORDER BY relname;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('design_packages', 'design_drawings', 'ffe_specifications')
ORDER BY tablename, policyname;
