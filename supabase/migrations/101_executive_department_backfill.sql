-- ============================================================
-- Executive department + backfill of the two clear staff.role
-- mappings identified during discovery. Confirmed decisions:
--   - Workshop stays folded into Operations/Construction (082's
--     call stands) — no separate Workshop department. Workshop
--     staff (carpenters, leather, CNC, etc.) select
--     "Operations/Construction" like everyone else already there.
--   - Executive is added as an 8th department, outside the seven
--     §3.2 line functions — it's the escalation top of the
--     authority matrix (the "Upper Level Managment" / CEO office),
--     not a line department with its own headcount function.
--     sort_order 0 puts it first, ahead of Design's 1.
--
-- The remaining 19 staff with no department-mapping rule are left
-- unassigned on purpose, same discipline as migration 082 — there's
-- no data-driven rule for them, and guessing would bake a wrong
-- placement into the org chart. They're for a human to place through
-- the assignment UI, whose write-path restriction migration 102 adds.
-- ============================================================

SET search_path TO public;

INSERT INTO departments (name, mandate, sort_order) VALUES
  ('Executive', 'Company leadership, strategy, and final authority per the authority matrix.', 0)
ON CONFLICT (name) DO NOTHING;

-- Clear case #1: the 3 "Upper Level Managment" staff -> Executive.
-- Guarded by department_id IS NULL, same as 082, so this is safe to
-- re-run without clobbering a later manual correction.
UPDATE staff s SET department_id = d.id
FROM departments d
WHERE d.name = 'Executive'
  AND s.role = 'Upper Level Managment'
  AND s.department_id IS NULL;

-- Clear case #2: "Security and assistance labor" -> Operations/Construction,
-- alongside the other physical-site roles migration 082 already mapped there.
UPDATE staff s SET department_id = d.id
FROM departments d
WHERE d.name = 'Operations/Construction'
  AND s.role = 'Security and assistance labor'
  AND s.department_id IS NULL;

-- Verify: 8 departments now, Executive first.
SELECT name, sort_order, mandate IS NOT NULL AS has_mandate
FROM departments ORDER BY sort_order;

-- Verify: staff count per department.
SELECT d.name AS department, count(s.id) AS staff_count
FROM departments d LEFT JOIN staff s ON s.department_id = d.id
GROUP BY d.name, d.sort_order ORDER BY d.sort_order;

-- Verify: remaining unassigned staff (expect 19).
SELECT count(*) AS unassigned_staff FROM staff WHERE department_id IS NULL;
