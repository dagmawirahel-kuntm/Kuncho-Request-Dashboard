-- ============================================================
-- BOQ foundation (PR 9a) — views for reading the tree, flat
-- export, and procurement spec. Additive only.
--
-- v_boq_current_per_project intentionally omits
-- has_active_change_order here; migration 211 (once
-- boq_change_orders exists) amends this view via
-- CREATE OR REPLACE VIEW to add that column.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE VIEW v_boq_current_per_project
WITH (security_invoker = true) AS
SELECT
  b.id                AS boq_id,
  b.project_id,
  b.version_number,
  b.title,
  b.status,
  b.grand_total_etb,
  b.total_direct_etb,
  b.total_lump_sum_etb,
  b.owner_pm_staff_id,
  b.approved_at,
  b.approved_by_staff_id,
  b.source_proforma_id,
  b.created_at,
  b.updated_at
FROM boqs b
WHERE b.status = 'approved';

-- Set-returning function (not a plain view — needs a parameter)
-- returning the item tree of a single BOQ in true DFS order, with
-- computed depth, breadcrumb path, and weight_pct of grand total.
CREATE OR REPLACE FUNCTION v_boq_tree(p_boq_id UUID)
RETURNS TABLE (
  id                   UUID,
  boq_id               UUID,
  parent_item_id       UUID,
  display_order        INT,
  node_type            TEXT,
  name                 TEXT,
  notes                TEXT,
  unit                 TEXT,
  quantity             NUMERIC,
  unit_rate_etb        NUMERIC,
  total_etb            NUMERIC,
  is_priced_elsewhere  BOOLEAN,
  absorbed_by_item_id  UUID,
  source_item_id       UUID,
  depth                INT,
  path                 TEXT,
  sort_path            INT[],
  weight_pct           NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH RECURSIVE tree AS (
    SELECT
      i.id, i.boq_id, i.parent_item_id, i.display_order, i.node_type, i.name,
      i.notes, i.unit, i.quantity, i.unit_rate_etb, i.total_etb,
      i.is_priced_elsewhere, i.absorbed_by_item_id, i.source_item_id,
      1 AS depth,
      i.name AS path,
      ARRAY[i.display_order] AS sort_path
    FROM boq_items i
    WHERE i.boq_id = p_boq_id AND i.parent_item_id IS NULL

    UNION ALL

    SELECT
      c.id, c.boq_id, c.parent_item_id, c.display_order, c.node_type, c.name,
      c.notes, c.unit, c.quantity, c.unit_rate_etb, c.total_etb,
      c.is_priced_elsewhere, c.absorbed_by_item_id, c.source_item_id,
      t.depth + 1,
      t.path || ' > ' || c.name,
      t.sort_path || c.display_order
    FROM boq_items c
    JOIN tree t ON c.parent_item_id = t.id
  )
  SELECT
    t.id, t.boq_id, t.parent_item_id, t.display_order, t.node_type, t.name,
    t.notes, t.unit, t.quantity, t.unit_rate_etb, t.total_etb,
    t.is_priced_elsewhere, t.absorbed_by_item_id, t.source_item_id,
    t.depth, t.path, t.sort_path,
    CASE WHEN b.grand_total_etb > 0 THEN ROUND(t.total_etb / b.grand_total_etb * 100, 4) ELSE 0 END AS weight_pct
  FROM tree t
  JOIN boqs b ON b.id = t.boq_id
  ORDER BY t.sort_path;
$$;

-- Flat leaf-item export across all approved BOQs, with room /
-- category / sub-category paths flattened into columns.
CREATE OR REPLACE VIEW v_boq_items_flat
WITH (security_invoker = true) AS
WITH RECURSIVE anc AS (
  SELECT
    i.id AS leaf_id,
    i.id AS ancestor_id,
    i.name AS ancestor_name,
    i.parent_item_id,
    0 AS depth_up
  FROM boq_items i

  UNION ALL

  SELECT
    a.leaf_id,
    p.id,
    p.name,
    p.parent_item_id,
    a.depth_up + 1
  FROM anc a
  JOIN boq_items p ON p.id = a.parent_item_id
),
anc_depth AS (
  SELECT
    a.leaf_id,
    a.ancestor_id,
    a.ancestor_name,
    a.depth_up,
    ROW_NUMBER() OVER (PARTITION BY a.leaf_id ORDER BY a.depth_up DESC) AS depth_from_root
  FROM anc a
  WHERE a.depth_up > 0
),
ancestors_agg AS (
  SELECT
    leaf_id,
    MAX(ancestor_name) FILTER (WHERE depth_from_root = 1) AS room,
    MAX(ancestor_name) FILTER (WHERE depth_from_root = 2) AS category,
    MAX(ancestor_name) FILTER (WHERE depth_from_root = 3) AS sub_category
  FROM anc_depth
  GROUP BY leaf_id
)
SELECT
  li.id                  AS item_id,
  li.boq_id,
  b.project_id,
  b.version_number,
  b.title                AS boq_title,
  aa.room,
  aa.category,
  aa.sub_category,
  li.name,
  li.notes,
  li.node_type,
  li.unit,
  li.quantity,
  li.unit_rate_etb,
  li.total_etb,
  li.is_priced_elsewhere,
  li.absorbed_by_item_id
FROM boq_items li
JOIN boqs b ON b.id = li.boq_id
LEFT JOIN ancestors_agg aa ON aa.leaf_id = li.id
WHERE li.node_type IN ('line_item', 'lump_sum')
  AND b.status = 'approved';

-- Procurement spec: leaf items whose cost is absorbed elsewhere.
CREATE OR REPLACE VIEW v_boq_procurement_spec
WITH (security_invoker = true) AS
SELECT
  f.*,
  ab.name AS absorbed_by_name
FROM v_boq_items_flat f
LEFT JOIN boq_items ab ON ab.id = f.absorbed_by_item_id
WHERE f.is_priced_elsewhere = true;

SELECT table_name FROM information_schema.views WHERE table_name LIKE 'v_boq%';
