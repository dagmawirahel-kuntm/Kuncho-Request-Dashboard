-- Booth return items carry two distinct natures:
--   fixed_part   — structural element tied to a specific booth design
--   standalone   — large independent structure reusable across future projects
-- source_project_id links back to which booth/event the items came from.

ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS structure_type TEXT
    CHECK (structure_type IN ('fixed_part', 'standalone') OR structure_type IS NULL),
  ADD COLUMN IF NOT EXISTS source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

COMMENT ON COLUMN stock_items.structure_type IS
  'booth_return only — fixed_part = tied to a specific booth design; standalone = reusable across future projects';
COMMENT ON COLUMN stock_items.source_project_id IS
  'booth_return only — the event/booth project these structures came from';
