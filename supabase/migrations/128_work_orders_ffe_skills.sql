-- ============================================================
-- Work orders + FF&E job descriptions / computed skill levels.
--
-- Work orders (§1) don't invent a new cost mechanism — they wrap two
-- that already exist (labor_allocations, stock_issues), the same
-- "wrapper links to the real cost record" shape subcontractor_
-- engagements already uses for completion certificates (095).
-- work_order_labor/work_order_materials are pure join tables; a work
-- order's cost is ALWAYS derived via v_work_order_cost, never stored.
--
-- FF&E skill levels (§2) are computed, never stored: staff_ffe_checklist
-- holds only which responsibilities are checked for a person; level is
-- computed live in v_staff_ffe_skill_level against whichever
-- responsibilities are currently active for that role. Adding, editing,
-- or retiring a responsibility changes every affected staff member's
-- level immediately, with no migration or recompute step, because
-- nothing is ever snapshotted.
--
-- Scope, per explicit confirmation: the FF&E framework applies ONLY to
-- the five FF&E roles seeded below — not to other Operations &
-- Construction staff (drivers, security, general labor, site
-- supervisors), who keep using staff.sub_team (123) exactly as before.
-- A staff member becomes "FF&E staff" implicitly, the moment an
-- admin/operations_manager gives them a staff_ffe_checklist row for
-- some role — there is no is_ffe_staff flag on `staff` to maintain.
--
-- Editing the framework itself (ffe_job_descriptions,
-- ffe_key_responsibilities) is restricted to admin/operations_manager
-- per explicit user confirmation — a Workshop competency framework,
-- not a general HR record. The same two roles own checking off staff
-- responsibilities (staff_ffe_checklist writes) — an assessment action
-- requiring the same authority as defining the framework itself, not
-- opened to a broader group without it being asked for.
-- ============================================================

SET search_path TO public;

-- ── 1. Work orders ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_type             TEXT NOT NULL CHECK (work_type IN ('workshop', 'site')),
  scope_of_work         TEXT NOT NULL,
  requested_by          UUID REFERENCES user_profiles(id),
  assigned_lead_staff_id UUID REFERENCES staff(id),
  status                TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'in_progress', 'completed', 'cancelled')),
  target_completion_date DATE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_project ON work_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_lead ON work_orders(assigned_lead_staff_id);

DROP TRIGGER IF EXISTS trg_work_orders_updated_at ON work_orders;
CREATE TRIGGER trg_work_orders_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Links staff time already logged elsewhere — never a second copy of
-- the allocation. A labor_allocation can only be linked to one work
-- order (the underlying time was spent on one job), enforced by the
-- unique constraint on labor_allocation_id.
CREATE TABLE IF NOT EXISTS work_order_labor (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id      UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  labor_allocation_id UUID NOT NULL UNIQUE REFERENCES labor_allocations(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_order_labor_wo ON work_order_labor(work_order_id);

-- Links materials already issued from stock — same one-issue-one-job
-- shape as above.
CREATE TABLE IF NOT EXISTS work_order_materials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id  UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  stock_issue_id UUID NOT NULL UNIQUE REFERENCES stock_issues(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_order_materials_wo ON work_order_materials(work_order_id);

-- Cost derivation: labor cost per linked allocation is day_rate_snapshot
-- x its planned span (COALESCE(end_date, CURRENT_DATE) - start_date + 1)
-- — the same "full planned span" cost driver 096's labor_allocation_
-- committed CTE already uses for this exact table, reused here rather
-- than inventing a second cost formula for the same rows. Materials
-- cost is stock_issues.total_cost (090's generated column) directly.
-- No linked rows at all -> 0, not an error and not a required estimate.
CREATE OR REPLACE VIEW v_work_order_cost
WITH (security_invoker = true) AS
SELECT
  wo.id AS work_order_id,
  COALESCE(labor.total, 0) AS labor_cost,
  COALESCE(materials.total, 0) AS materials_cost,
  COALESCE(labor.total, 0) + COALESCE(materials.total, 0) AS total_cost
FROM work_orders wo
LEFT JOIN (
  SELECT wol.work_order_id,
    SUM((COALESCE(la.end_date, CURRENT_DATE) - la.start_date + 1) * COALESCE(la.day_rate_snapshot, 0)) AS total
  FROM work_order_labor wol
  JOIN labor_allocations la ON la.id = wol.labor_allocation_id
  GROUP BY wol.work_order_id
) labor ON labor.work_order_id = wo.id
LEFT JOIN (
  SELECT wom.work_order_id, SUM(si.total_cost) AS total
  FROM work_order_materials wom
  JOIN stock_issues si ON si.id = wom.stock_issue_id
  GROUP BY wom.work_order_id
) materials ON materials.work_order_id = wo.id;

GRANT SELECT ON v_work_order_cost TO authenticated;

-- ── RLS: work_orders ────────────────────────────────────────────────
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_orders_read" ON work_orders;
CREATE POLICY "work_orders_read" ON work_orders FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "work_orders_manage" ON work_orders;
CREATE POLICY "work_orders_manage" ON work_orders FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'operations_manager', 'project_manager'));

DROP POLICY IF EXISTS "work_order_labor_read" ON work_order_labor;
CREATE POLICY "work_order_labor_read" ON work_order_labor FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "work_order_labor_manage" ON work_order_labor;
CREATE POLICY "work_order_labor_manage" ON work_order_labor FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'operations_manager', 'project_manager'));

DROP POLICY IF EXISTS "work_order_materials_read" ON work_order_materials;
CREATE POLICY "work_order_materials_read" ON work_order_materials FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "work_order_materials_manage" ON work_order_materials;
CREATE POLICY "work_order_materials_manage" ON work_order_materials FOR ALL
  USING (get_user_role() IN ('admin', 'manager', 'operations_manager', 'project_manager'));

-- ── 2. FF&E job descriptions, responsibilities, computed skill level ──

CREATE TABLE IF NOT EXISTS ffe_job_descriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name     TEXT NOT NULL UNIQUE,
  role_overview TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_ffe_job_descriptions_updated_at ON ffe_job_descriptions;
CREATE TRIGGER trg_ffe_job_descriptions_updated_at
  BEFORE UPDATE ON ffe_job_descriptions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS ffe_key_responsibilities (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_description_id     UUID NOT NULL REFERENCES ffe_job_descriptions(id) ON DELETE CASCADE,
  responsibility_title   TEXT NOT NULL,
  responsibility_detail  TEXT,
  tier                   TEXT NOT NULL CHECK (tier IN ('foundational', 'differentiator')),
  sort_order             INT NOT NULL DEFAULT 0,
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ffe_key_responsibilities_role ON ffe_key_responsibilities(job_description_id);

DROP TRIGGER IF EXISTS trg_ffe_key_responsibilities_updated_at ON ffe_key_responsibilities;
CREATE TRIGGER trg_ffe_key_responsibilities_updated_at
  BEFORE UPDATE ON ffe_key_responsibilities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- The only input anyone provides: is a responsibility checked for a
-- staff member, by whom, when. Never a level — that's always computed.
CREATE TABLE IF NOT EXISTS staff_ffe_checklist (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id         UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  responsibility_id UUID NOT NULL REFERENCES ffe_key_responsibilities(id) ON DELETE CASCADE,
  is_checked       BOOLEAN NOT NULL DEFAULT false,
  checked_by       UUID REFERENCES user_profiles(id),
  checked_at       TIMESTAMPTZ,
  UNIQUE (staff_id, responsibility_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_ffe_checklist_staff ON staff_ffe_checklist(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_ffe_checklist_responsibility ON staff_ffe_checklist(responsibility_id);

-- Keeps checked_by/checked_at meaningful: stamped the moment
-- is_checked flips true, cleared the moment it flips back to false
-- (an unchecked box has no "who checked it" to report).
CREATE OR REPLACE FUNCTION stamp_staff_ffe_checklist()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_checked AND (TG_OP = 'INSERT' OR NOT OLD.is_checked) THEN
    NEW.checked_by := auth.uid();
    NEW.checked_at := NOW();
  ELSIF NOT NEW.is_checked THEN
    NEW.checked_by := NULL;
    NEW.checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_staff_ffe_checklist ON staff_ffe_checklist;
CREATE TRIGGER trg_stamp_staff_ffe_checklist
  BEFORE INSERT OR UPDATE OF is_checked ON staff_ffe_checklist
  FOR EACH ROW EXECUTE FUNCTION stamp_staff_ffe_checklist();

-- Live computation — never a stored/snapshotted level. Only surfaces a
-- staff+role row once at least one responsibility is checked; a role
-- with zero checked responsibilities for a person simply doesn't
-- appear (there is no "level: none" row).
CREATE OR REPLACE VIEW v_staff_ffe_skill_level
WITH (security_invoker = true) AS
WITH active_reqs AS (
  SELECT r.id, r.job_description_id, r.tier
  FROM ffe_key_responsibilities r
  JOIN ffe_job_descriptions jd ON jd.id = r.job_description_id
  WHERE r.active AND jd.active
),
staff_checked AS (
  SELECT c.staff_id, c.responsibility_id
  FROM staff_ffe_checklist c
  WHERE c.is_checked
),
totals AS (
  SELECT
    job_description_id,
    count(*) FILTER (WHERE tier = 'foundational') AS foundational_total,
    count(*) FILTER (WHERE tier = 'differentiator') AS differentiator_total
  FROM active_reqs
  GROUP BY job_description_id
),
per_staff AS (
  SELECT
    sc.staff_id,
    ar.job_description_id,
    count(*) FILTER (WHERE ar.tier = 'foundational') AS foundational_checked,
    count(*) FILTER (WHERE ar.tier = 'differentiator') AS differentiator_checked
  FROM staff_checked sc
  JOIN active_reqs ar ON ar.id = sc.responsibility_id
  GROUP BY sc.staff_id, ar.job_description_id
)
SELECT
  ps.staff_id,
  ps.job_description_id,
  jd.role_name,
  ps.foundational_checked,
  t.foundational_total,
  ps.differentiator_checked,
  t.differentiator_total,
  -- Vacuous-truth-correct: a role with zero active responsibilities in
  -- a tier trivially satisfies "every [tier] responsibility checked"
  -- for that tier, matching the spec's literal wording rather than
  -- forcing Beginner whenever a hypothetical future role happens to
  -- have no foundational items at all.
  CASE
    WHEN ps.foundational_checked >= t.foundational_total
     AND ps.differentiator_checked >= t.differentiator_total
    THEN 'Advanced'
    WHEN ps.foundational_checked >= t.foundational_total
    THEN 'Intermediate'
    ELSE 'Beginner'
  END AS skill_level
FROM per_staff ps
JOIN totals t ON t.job_description_id = ps.job_description_id
JOIN ffe_job_descriptions jd ON jd.id = ps.job_description_id;

GRANT SELECT ON v_staff_ffe_skill_level TO authenticated;

-- ── RLS: FF&E framework ─────────────────────────────────────────────
ALTER TABLE ffe_job_descriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ffe_key_responsibilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_ffe_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ffe_job_descriptions_read" ON ffe_job_descriptions;
CREATE POLICY "ffe_job_descriptions_read" ON ffe_job_descriptions FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "ffe_job_descriptions_manage" ON ffe_job_descriptions;
CREATE POLICY "ffe_job_descriptions_manage" ON ffe_job_descriptions FOR ALL
  USING (get_user_role() IN ('admin', 'operations_manager'));

DROP POLICY IF EXISTS "ffe_key_responsibilities_read" ON ffe_key_responsibilities;
CREATE POLICY "ffe_key_responsibilities_read" ON ffe_key_responsibilities FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "ffe_key_responsibilities_manage" ON ffe_key_responsibilities;
CREATE POLICY "ffe_key_responsibilities_manage" ON ffe_key_responsibilities FOR ALL
  USING (get_user_role() IN ('admin', 'operations_manager'));

DROP POLICY IF EXISTS "staff_ffe_checklist_read" ON staff_ffe_checklist;
CREATE POLICY "staff_ffe_checklist_read" ON staff_ffe_checklist FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "staff_ffe_checklist_manage" ON staff_ffe_checklist;
CREATE POLICY "staff_ffe_checklist_manage" ON staff_ffe_checklist FOR ALL
  USING (get_user_role() IN ('admin', 'operations_manager'));

-- ── Seed: the five FF&E roles + responsibilities, exactly as given ──
INSERT INTO ffe_job_descriptions (role_name, role_overview, sort_order) VALUES
  ('FF&E Carpenter / Cabinet Maker (Woodwork)',
   'Responsible for crafting, assembling, and modifying custom wood furniture, cabinetry, wall paneling, and fixed millwork according to shop drawings and specifications.', 1),
  ('FF&E Site Installer / Assembly Technician',
   'Executes the on-site delivery, unboxing, placement, wall-mounting, and final adjustment of all furniture, fixtures, and art pieces at the project site (hotels, offices, residential units).', 2),
  ('Custom Upholsterer',
   'Specialize in padding and covering furniture frames (sofas, armchairs, dining chairs, headboards, banquettes) with fabrics, leather, or synthetic materials.', 3),
  ('Furniture Finisher / Spray Painter',
   'Prepares surfaces and applies protective coatings, stains, paints, and polishes to raw wood, metal, or composite furniture.', 4),
  ('FF&E Metal Fabricator / Welder',
   'Fabricates decorative metal components, table bases, light fixture frames, shelving units, and metal accents used in modern FF&E design.', 5)
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO ffe_key_responsibilities (job_description_id, responsibility_title, responsibility_detail, tier, sort_order)
SELECT jd.id, r.title, r.detail, r.tier, r.sort_order
FROM (VALUES
  ('FF&E Carpenter / Cabinet Maker (Woodwork)', 'Fabrication & Joinery', 'Cut, shape, and join solid wood, MDF, plywood, and veneers using workshop machinery (table saws, routers, CNC machines, planers).', 'foundational', 1),
  ('FF&E Carpenter / Cabinet Maker (Woodwork)', 'Assembly', 'Construct loose furniture frames (tables, bed bases, sideboards) and built-in fixtures (wardrobes, reception desks, vanities).', 'foundational', 2),
  ('FF&E Carpenter / Cabinet Maker (Woodwork)', 'Hardware Integration', 'Install structural hardware, hinges, heavy-duty drawer slides, soft-close mechanisms, and concealed fittings.', 'foundational', 3),
  ('FF&E Carpenter / Cabinet Maker (Woodwork)', 'Drawing Interpretation', 'Read and work directly from technical shop drawings, cutting lists, and material specifications.', 'differentiator', 4),

  ('FF&E Site Installer / Assembly Technician', 'Site Assembly', 'Uncrate, assemble, and position loose furniture, headboards, desks, and modular items on-site.', 'foundational', 1),
  ('FF&E Site Installer / Assembly Technician', 'Leveling & Adjustments', 'Align cabinet doors, level furniture on uneven flooring, and ensure seamless fitment against walls.', 'foundational', 2),
  ('FF&E Site Installer / Assembly Technician', 'Wall & Floor Mounting', 'Safely anchor heavy fixtures, mirrors, art pieces, headboards, and shelving to walls/floors according to structural guidelines (safety-critical).', 'differentiator', 3),
  ('FF&E Site Installer / Assembly Technician', 'Minor On-Site Repairs', 'Perform minor touch-ups (fill gouges, adjust hardware) caused during transport or handling.', 'differentiator', 4),

  ('Custom Upholsterer', 'Frame Preparation', 'Install webbing, springs, foam padding, and batting onto wood or metal furniture frames.', 'foundational', 1),
  ('Custom Upholsterer', 'Patterning & Cutting', 'Measure, pattern, and cut upholstery fabrics, vinyls, and leathers, matching patterns/grain directions.', 'foundational', 2),
  ('Custom Upholsterer', 'Stitching & Tacking', 'Operate heavy-duty industrial sewing machines and pneumatic staple guns to stretch, secure, and finish fabric cleanly.', 'foundational', 3),
  ('Custom Upholsterer', 'Detailing', 'Execute decorative details like button tufting, piping, welt cords, brass nailhead trim, and blind stitching.', 'differentiator', 4),

  ('Furniture Finisher / Spray Painter', 'Surface Preparation', 'Sand, fill, repair defects, and prep wood or metal surfaces for priming and finishing.', 'foundational', 1),
  ('Furniture Finisher / Spray Painter', 'Coating Application', 'Operate spray booths to apply stains, sealers, polyurethane (PU), lacquer, or powder coatings uniformly.', 'foundational', 2),
  ('Furniture Finisher / Spray Painter', 'Quality Finishing', 'Sand between coats and perform final buffing, polishing, or wax treatments.', 'foundational', 3),
  ('Furniture Finisher / Spray Painter', 'Color Matching & Patina', 'Mix custom wood stains and paints to match approved design control samples; apply distressed, antiqued, or high-gloss finishes.', 'differentiator', 4),

  ('FF&E Metal Fabricator / Welder', 'Metalworking', 'Cut, bend, drill, and shape steel, stainless steel, aluminum, and brass profiles.', 'foundational', 1),
  ('FF&E Metal Fabricator / Welder', 'Grinding & Polishing', 'Grind down welds, polish brass/steel to specified finishes (brushed, satin, mirror polish), and prep for plating or clear coating.', 'foundational', 2),
  ('FF&E Metal Fabricator / Welder', 'Welding & Joining', 'Perform precision TIG and MIG welding on visible decorative metal joins.', 'differentiator', 3)
) AS r(role_name, title, detail, tier, sort_order)
JOIN ffe_job_descriptions jd ON jd.role_name = r.role_name
WHERE NOT EXISTS (
  SELECT 1 FROM ffe_key_responsibilities existing
  WHERE existing.job_description_id = jd.id AND existing.responsibility_title = r.title
);

-- Verify
SELECT role_name, count(*) AS responsibility_count
FROM ffe_job_descriptions jd JOIN ffe_key_responsibilities r ON r.job_description_id = jd.id
GROUP BY role_name ORDER BY role_name;

SELECT count(*) AS total_roles FROM ffe_job_descriptions;
SELECT count(*) AS total_responsibilities FROM ffe_key_responsibilities;
