-- ============================================================
-- Backfill project_id on pre-existing expenses using the free-text
-- project_name field, matched against the projects table.
--
-- Mirrors migration 040 (vendor_id backfill): the KUNCH_11 Airtable
-- base links an Expense to its Project via a real linked-record field
-- (see the Expense record's "Projects" field), and migration 038
-- carried that link straight over into expenses.project_id for rows
-- seeded from Airtable. The 1,754 expenses that predate the Airtable
-- seed only ever had the free-text project_name, so they never got a
-- real project_id — the app's UI already falls back to project_name
-- for display, but that's a stale label, not the relational link
-- Airtable actually has. This merges them onto the real link.
--
-- Safe to re-run: only touches rows where project_id IS NULL.
-- ============================================================

UPDATE expenses e
SET project_id = p.id
FROM projects p
WHERE e.project_id IS NULL
  AND e.project_name IS NOT NULL
  AND (
    lower(trim(e.project_name)) = lower(trim(p.project_name))
    OR lower(trim(e.project_name)) LIKE lower(trim(p.project_name)) || ' %'
  );

-- Verify
SELECT
  count(*) FILTER (WHERE project_id IS NOT NULL)                              AS now_linked,
  count(*) FILTER (WHERE project_id IS NULL AND project_name IS NOT NULL)     AS still_unlinked_with_name,
  count(*) FILTER (WHERE project_id IS NULL AND project_name IS NULL)         AS no_project_name_at_all
FROM expenses;
