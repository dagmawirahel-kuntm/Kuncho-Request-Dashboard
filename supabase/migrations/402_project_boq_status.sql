-- 402: Where a BOQ is missing.
--
-- Only 2 of 106 projects had a BOQ, and nothing said so: purchase
-- requests, work orders and progress ran against projects with nothing to
-- check them against. v_project_boq_status gives one row per project:
--   · boq_status   none / draft / internal_review / approved (latest version)
--   · needs_boq    client work (not internal) that is active this year or
--                  has had purchases, work orders or spending lately —
--                  the projects where a missing BOQ matters;
--   · proforma_id  the project's latest proforma with lines, if any, so the
--                  BOQ can be started from it in one step.
-- Read-only, owner rights, limited to the roles that can read BOQs plus the
-- project's own manager.

CREATE OR REPLACE VIEW v_project_boq_status AS
WITH latest AS (
  SELECT DISTINCT ON (b.project_id) b.project_id, b.id, b.status, b.version_number, b.updated_at
  FROM boqs b
  WHERE b.status <> 'superseded'
  ORDER BY b.project_id, b.version_number DESC
),
activity AS (
  SELECT p.id AS project_id,
         (SELECT count(*) FROM orders o WHERE o.project_id = p.id AND o.created_at > now() - interval '90 days') AS recent_requests,
         (SELECT count(*) FROM work_orders w WHERE w.project_id = p.id AND w.status NOT IN ('completed','cancelled')) AS open_work_orders,
         (SELECT count(*) FROM expenses e WHERE e.project_id = p.id AND e.created_at > now() - interval '60 days') AS recent_expenses
  FROM projects p
),
pf AS (
  SELECT DISTINCT ON (f.project_id) f.project_id, f.id, f.proforma_number
  FROM proformas f
  WHERE f.project_id IS NOT NULL
    AND f.status NOT IN ('superseded','declined')
    AND EXISTS (SELECT 1 FROM proforma_items i WHERE i.proforma_id = f.id)
  ORDER BY f.project_id, (f.status = 'accepted') DESC, f.created_at DESC
)
SELECT p.id AS project_id,
       l.id AS boq_id,
       coalesce(l.status, 'none') AS boq_status,
       l.version_number,
       (SELECT count(*) FROM boq_items i WHERE i.boq_id = l.id AND i.node_type <> 'section')::int AS item_count,
       l.updated_at AS boq_updated_at,
       a.recent_requests::int,
       a.open_work_orders::int,
       a.recent_expenses::int,
       (NOT coalesce(p.is_internal, false)
        AND (coalesce(p.active_for_year, false) OR a.recent_requests > 0 OR a.open_work_orders > 0 OR a.recent_expenses > 0)) AS needs_boq,
       pf.id AS proforma_id,
       pf.proforma_number
FROM projects p
JOIN activity a ON a.project_id = p.id
LEFT JOIN latest l ON l.project_id = p.id
LEFT JOIN pf ON pf.project_id = p.id
WHERE (get_user_role())::text = ANY (ARRAY['admin','executive','finance','project_manager','operations_manager','design','procurement_officer'])
   OR p.project_manager_id = current_staff_id();

ALTER VIEW v_project_boq_status SET (security_invoker = false);
GRANT SELECT ON v_project_boq_status TO authenticated;
