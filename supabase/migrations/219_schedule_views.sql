-- ============================================================
-- Schedule (PR 9b), migration group (d) of 4: views. Last group
-- before the frontend pause — item 44(d)'s trainer-hint-catalog
-- extension is a small frontend edit (src/lib/trainerHints.ts +
-- ProjectWorkspacePage.tsx), done alongside this migration since the
-- prompt scopes it to group (d), separate from the larger Schedule UI
-- (Part 8) that the actual frontend pause applies to.
--
-- Pattern matches PR 9a's v_boq_tree / v_boq_current_per_project
-- (210_boq_views.sql) exactly: WITH (security_invoker = true) on
-- plain views, LANGUAGE sql STABLE SECURITY INVOKER + recursive CTE
-- with a sort_path array for stable DFS order on the set-returning
-- tree function.
-- ============================================================

SET search_path TO public;

-- ── v_schedule_task_health (item 20) ────────────────────────────────
-- is_on_critical_path is a placeholder (always false) — true
-- critical-path-method calculation is explicitly out of scope for
-- this PR (item 43), kept here only so the column exists and doesn't
-- need a schema change when that algorithm is eventually built.
CREATE OR REPLACE VIEW v_schedule_task_health
WITH (security_invoker = true) AS
SELECT
  st.id                   AS task_id,
  st.schedule_id,
  st.title,
  st.status,
  st.current_start_date,
  st.current_end_date,
  st.planned_start_date,
  st.planned_end_date,
  CASE WHEN st.planned_end_date IS NOT NULL THEN st.current_end_date - st.planned_end_date ELSE NULL END AS days_slipped,
  (st.current_end_date < CURRENT_DATE AND st.status <> 'completed') AS is_overdue,
  false AS is_on_critical_path
FROM schedule_tasks st;

-- ── v_project_schedule_summary (item 21) ────────────────────────────
-- One row per project with an active (non-completed) schedule — the
-- exec-dashboard hook the prompt flags for a later PR to pick up.
CREATE OR REPLACE VIEW v_project_schedule_summary
WITH (security_invoker = true) AS
SELECT
  s.project_id,
  s.id                        AS schedule_id,
  s.status                    AS schedule_status,
  s.baseline_locked_at,
  count(st.id)                AS total_tasks,
  count(st.id) FILTER (WHERE st.status = 'completed')                                     AS tasks_completed,
  count(st.id) FILTER (WHERE st.current_end_date < CURRENT_DATE AND st.status <> 'completed') AS tasks_overdue,
  ROUND(AVG(st.current_end_date - st.planned_end_date)
    FILTER (WHERE st.status <> 'completed' AND st.planned_end_date IS NOT NULL), 2)       AS avg_days_slipped_incomplete
FROM schedules s
LEFT JOIN schedule_tasks st ON st.schedule_id = s.id
WHERE s.status <> 'completed'
GROUP BY s.project_id, s.id, s.status, s.baseline_locked_at;

-- ── v_schedule_tasks_with_stale_boq_links (item 19) ─────────────────
-- A schedule's boq_id going stale relative to the project's currently-
-- approved BOQ (via a change order finalizing to a new version) is a
-- known limitation, not a bug (item 18) — nothing here auto-remaps
-- anything, it only surfaces what needs manual review.
CREATE OR REPLACE VIEW v_schedule_tasks_with_stale_boq_links
WITH (security_invoker = true) AS
SELECT
  s.id                    AS schedule_id,
  s.project_id,
  s.boq_id                AS schedule_boq_id,
  cur.boq_id               AS current_approved_boq_id,
  st.id                   AS task_id,
  st.title                AS task_title,
  stbi.boq_item_id        AS stale_boq_item_id,
  bi.name                 AS stale_boq_item_name
FROM schedules s
JOIN schedule_tasks st ON st.schedule_id = s.id
JOIN schedule_task_boq_items stbi ON stbi.schedule_task_id = st.id
LEFT JOIN boq_items bi ON bi.id = stbi.boq_item_id
LEFT JOIN v_boq_current_per_project cur ON cur.project_id = s.project_id
WHERE s.boq_id IS NOT NULL
  AND (cur.boq_id IS NULL OR cur.boq_id <> s.boq_id);

-- ── v_schedule_gantt_data (item 22) ──────────────────────────────────
CREATE OR REPLACE FUNCTION v_schedule_gantt_data(p_schedule_id UUID)
RETURNS TABLE (
  id                    UUID,
  title                 TEXT,
  parent_task_id        UUID,
  depth                 INT,
  current_start_date    DATE,
  current_end_date      DATE,
  planned_start_date    DATE,
  planned_end_date      DATE,
  status                TEXT,
  predecessor_task_id   UUID,
  days_slipped          INT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH RECURSIVE tree AS (
    SELECT
      t.id, t.title, t.parent_task_id, t.current_start_date, t.current_end_date,
      t.planned_start_date, t.planned_end_date, t.status, t.predecessor_task_id,
      t.display_order,
      1 AS depth,
      ARRAY[t.display_order] AS sort_path
    FROM schedule_tasks t
    WHERE t.schedule_id = p_schedule_id AND t.parent_task_id IS NULL

    UNION ALL

    SELECT
      c.id, c.title, c.parent_task_id, c.current_start_date, c.current_end_date,
      c.planned_start_date, c.planned_end_date, c.status, c.predecessor_task_id,
      c.display_order,
      tr.depth + 1,
      tr.sort_path || c.display_order
    FROM schedule_tasks c
    JOIN tree tr ON c.parent_task_id = tr.id
  )
  SELECT
    tr.id, tr.title, tr.parent_task_id, tr.depth,
    tr.current_start_date, tr.current_end_date, tr.planned_start_date, tr.planned_end_date,
    tr.status, tr.predecessor_task_id,
    CASE WHEN tr.planned_end_date IS NOT NULL THEN tr.current_end_date - tr.planned_end_date ELSE NULL END AS days_slipped
  FROM tree tr
  ORDER BY tr.sort_path;
$$;

-- Verify.
SELECT table_name FROM information_schema.views WHERE table_name LIKE 'v_schedule%' OR table_name LIKE 'v_project_schedule%';
SELECT proname FROM pg_proc WHERE proname = 'v_schedule_gantt_data';
