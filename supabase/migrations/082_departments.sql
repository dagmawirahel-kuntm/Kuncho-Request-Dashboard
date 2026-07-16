-- ============================================================
-- Departments backbone, per the ops manual's §3.2 department list.
--
-- Seeded as 7 rows, not 8 — confirmed with the business owner:
-- Workshop/Production is NOT its own department even though ~half
-- the company (staff_type = 'Work Shop', plus the Workshop Manager,
-- 26 carpenters/assistants, a CNC operator, and the 7-person Leather
-- Workshop) is fabrication staff. §3.2 names no Workshop/Production
-- line, so all of that headcount folds into Operations/Construction
-- below, matching the manual literally over matching headcount
-- weight.
--
-- `mandate` is seeded NULL, not fabricated. §3.2's actual mandate
-- text per department isn't available in this session — pasting
-- placeholder text and labeling it "verbatim from §3.2" would bake
-- wrong operational documentation into the database. Send the real
-- §3.2 text (or the manual itself) and a follow-up migration will
-- populate `mandate` with an UPDATE, not a rewrite of this one.
--
-- `head_staff_id` is deliberately left NULL for every row — the
-- manual's head slots are unfilled `[name]` placeholders, so this
-- accurately surfaces that no department currently has a named owner
-- on record, rather than papering over it.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS departments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  mandate       TEXT,
  head_staff_id UUID REFERENCES staff(id),
  sort_order    INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO departments (name, sort_order) VALUES
  ('Design',                      1),
  ('Operations/Construction',     2),
  ('Procurement & Logistics',     3),
  ('Finance & Admin',             4),
  ('Business Development/Sales',  5),
  ('HR & People',                 6),
  ('HSE',                         7)
ON CONFLICT (name) DO NOTHING;

-- ── staff.department_id ──────────────────────────────────────────
-- Nullable FK, backfilled from the existing free-text staff.role as
-- a starting map. Anything not in the list below (including the
-- typo'd "Upper Level Managment" — the executive/CEO office, not a
-- §3.2 line department) is deliberately left NULL rather than
-- force-fit. Guarded by `department_id IS NULL` so this is safe to
-- re-run without clobbering later manual corrections.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);

UPDATE staff s SET department_id = d.id
FROM departments d
WHERE d.name = 'Design'
  AND s.role = 'Designer'
  AND s.department_id IS NULL;

UPDATE staff s SET department_id = d.id
FROM departments d
WHERE d.name = 'Operations/Construction'
  AND s.role IN (
    'Project Manager', 'Gang Chief', 'Carpenter', 'Ass. Carpenter', 'Painter',
    'CNC operator', 'Workshop Manager', 'Leather Workshop', 'Labor', 'Cleaner', 'Security'
  )
  AND s.department_id IS NULL;

UPDATE staff s SET department_id = d.id
FROM departments d
WHERE d.name = 'Procurement & Logistics'
  AND s.role IN ('Purchaser', 'Resources control', 'Driver')
  AND s.department_id IS NULL;

UPDATE staff s SET department_id = d.id
FROM departments d
WHERE d.name = 'Finance & Admin'
  AND s.role IN ('Finance', 'Business Admin')
  AND s.department_id IS NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_read" ON departments;
CREATE POLICY "departments_read" ON departments FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "departments_admin_write" ON departments;
CREATE POLICY "departments_admin_write" ON departments FOR ALL
  USING (get_user_role() IN ('admin', 'manager'));

-- Verify: 7 departments, all with head_staff_id NULL and mandate NULL
-- (until the follow-up mandate-text migration lands)
SELECT name, sort_order, mandate IS NOT NULL AS has_mandate, head_staff_id IS NOT NULL AS has_head
FROM departments ORDER BY sort_order;

-- Verify: staff department mapping coverage
SELECT
  d.name AS department,
  count(s.id) AS staff_count
FROM departments d
LEFT JOIN staff s ON s.department_id = d.id
GROUP BY d.name, d.sort_order
ORDER BY d.sort_order;

SELECT
  count(*) FILTER (WHERE department_id IS NOT NULL) AS mapped,
  count(*) FILTER (WHERE department_id IS NULL)      AS unmapped,
  count(*)                                            AS total_staff
FROM staff;
