-- 337 — What Kuncho sells, what it costs to deliver, and proformas built
--       from it
--
-- Proforma lines were free text and the products list had ten names and no
-- prices, so a proforma could not say what was being sold, at what price, or
-- at what margin. Kuncho sells mostly residential interior works and event
-- construction, plus leather products.
--
-- 1. Service lines (catalog_service_lines): residential interior works,
--    event & exhibition construction, leather products. Each carries the
--    markup applied to cost when suggesting a price — data, so finance
--    changes it without a release.
-- 2. The catalog is the existing products table, grown: each item now has a
--    service line, whether it is a service or a product, its unit, a code,
--    and an optional markup of its own. The ten existing items are filed
--    under their lines, and a starter set of interior and event services is
--    added with no price — finance prices them.
-- 3. Cost recipes (catalog_item_components): what one unit of an item takes
--    — materials, labour, subcontract, transport — each at a cost entered
--    by hand or, for a material linked to a stock item, its latest market
--    price. Only admin, executive and finance see costs.
-- 4. v_catalog_costing: per item, the cost of one unit, the suggested price
--    (cost plus markup), the margin at the list price, and how many
--    components still have no cost.
-- 5. Templates (catalog_templates, catalog_template_lines): the jobs Kuncho
--    repeats — a 3×3 exhibition booth, a kitchen, a bathroom — as ready
--    sets of lines.
-- 6. Proforma lines remember the catalog item they came from; a proforma
--    remembers the template or BOQ it was built from.
-- 7. create_boq_from_proforma(): when a quoted job goes ahead, its proforma
--    becomes a draft BOQ on the project, one line per proforma line, linked
--    back through boqs.source_proforma_id.

SET search_path TO public;

-- ── 1. Service lines ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_service_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  markup_percent numeric NOT NULL DEFAULT 0 CHECK (markup_percent >= 0),
  sort_order     int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE catalog_service_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_lines_read ON catalog_service_lines;
CREATE POLICY catalog_lines_read ON catalog_service_lines FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS catalog_lines_write ON catalog_service_lines;
CREATE POLICY catalog_lines_write ON catalog_service_lines FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]));
REVOKE ALL ON catalog_service_lines FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_service_lines TO authenticated;
DROP TRIGGER IF EXISTS catalog_service_lines_updated_at ON catalog_service_lines;
CREATE TRIGGER catalog_service_lines_updated_at BEFORE UPDATE ON catalog_service_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Starting markups; finance sets the real ones.
INSERT INTO catalog_service_lines (code, name, description, markup_percent, sort_order) VALUES
  ('residential_interior', 'Residential interior works', 'Finishing, ceilings, painting, flooring, kitchens, bathrooms, joinery', 25, 10),
  ('event_construction',   'Event & exhibition construction', 'Booths, stages, branding, cut-outs, installation and dismantling', 25, 20),
  ('leather_products',     'Leather products', 'Bags, desk sets, coasters, corporate gifts', 25, 30)
ON CONFLICT (code) DO NOTHING;

-- ── 2. The catalog: products, grown ─────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS service_line_id uuid REFERENCES catalog_service_lines(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'service';
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('service', 'product'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS item_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS markup_percent numeric CHECK (markup_percent IS NULL OR markup_percent >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS products_item_code_key ON products (lower(item_code)) WHERE item_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_service_line_idx ON products (service_line_id);

-- File the existing items under their lines.
UPDATE products p SET service_line_id = sl.id,
  kind = CASE WHEN sl.code = 'leather_products' THEN 'product' ELSE 'service' END
FROM catalog_service_lines sl
WHERE p.service_line_id IS NULL
  AND sl.code = CASE
    WHEN p.category = 'Leather Products' THEN 'leather_products'
    WHEN p.product_name IN ('Booth Construction', 'Cutouts') THEN 'event_construction'
    ELSE 'residential_interior' END;
UPDATE products SET unit = CASE WHEN kind = 'product' THEN 'pcs' ELSE 'lump sum' END WHERE unit IS NULL;

-- A starter set of the services Kuncho sells, unpriced.
INSERT INTO products (product_name, category, active, description, service_line_id, kind, unit, sort_order)
SELECT v.name, sl.name, true, v.descr, sl.id, 'service', v.unit, v.ord
FROM (VALUES
  ('residential_interior', 'Gypsum board ceiling',            'Supply and install gypsum ceiling, including framing', 'm²', 10),
  ('residential_interior', 'Wall painting',                   'Surface preparation, putty, primer and two coats',    'm²', 20),
  ('residential_interior', 'Floor tiling',                    'Supply and lay ceramic or porcelain tiles',           'm²', 30),
  ('residential_interior', 'Laminate / parquet flooring',     'Supply and lay laminate or parquet with underlay',    'm²', 40),
  ('residential_interior', 'Kitchen cabinets',                'Base and wall units, worktop and fittings',           'lm', 50),
  ('residential_interior', 'Built-in wardrobe',               'Carcass, doors, internal fittings',                   'lm', 60),
  ('residential_interior', 'Bathroom fit-out',                'Tiling, sanitary ware, fittings per bathroom',        'room', 70),
  ('residential_interior', 'Interior doors',                  'Supply and hang door with frame and ironmongery',     'pcs', 80),
  ('residential_interior', 'Electrical & lighting point',     'Wiring, fitting and fixture per point',               'point', 90),
  ('residential_interior', 'Interior design & drawings',      'Concept, 3D views and working drawings',              'lump sum', 100),
  ('event_construction',   'Custom booth construction',       'Design-and-build exhibition stand',                   'm²', 10),
  ('event_construction',   'Shell-scheme booth',              'Standard modular stand with fascia',                  'm²', 20),
  ('event_construction',   'Stage & platform',                'Raised stage with skirting and steps',                'm²', 30),
  ('event_construction',   'Branding & printing',             'Printed graphics, vinyl and panels',                  'm²', 40),
  ('event_construction',   'Truss & lighting',                'Truss rig with lighting',                             'lump sum', 50),
  ('event_construction',   'Furniture hire',                  'Tables, chairs, counters for the event',              'pcs', 60),
  ('event_construction',   'Installation & dismantling',      'On-site build-up and tear-down crew',                 'lump sum', 70),
  ('event_construction',   'Transport',                       'Delivery and collection',                             'trip', 80)
) AS v(line, name, descr, unit, ord)
JOIN catalog_service_lines sl ON sl.code = v.line
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE lower(p.product_name) = lower(v.name));

-- ── 3. Cost recipes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_item_components (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'material'
                CHECK (kind IN ('material', 'labour', 'subcontract', 'transport', 'other')),
  description   text NOT NULL CHECK (btrim(description) <> ''),
  stock_item_id uuid REFERENCES stock_items(id) ON DELETE SET NULL,
  qty_per_unit  numeric NOT NULL DEFAULT 1 CHECK (qty_per_unit > 0),
  unit          text,
  -- Entered cost of one unit of this component. Left empty for a material
  -- linked to a stock item, it is that item's latest market price.
  unit_cost     numeric CHECK (unit_cost IS NULL OR unit_cost >= 0),
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_item_components_product_idx ON catalog_item_components (product_id);
DROP TRIGGER IF EXISTS catalog_item_components_updated_at ON catalog_item_components;
CREATE TRIGGER catalog_item_components_updated_at BEFORE UPDATE ON catalog_item_components
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE catalog_item_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_components_read ON catalog_item_components;
CREATE POLICY catalog_components_read ON catalog_item_components FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));
DROP POLICY IF EXISTS catalog_components_write ON catalog_item_components;
CREATE POLICY catalog_components_write ON catalog_item_components FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]));
REVOKE ALL ON catalog_item_components FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_item_components TO authenticated;

-- ── 4. Cost, suggested price, margin ────────────────────────────────────
-- Runs with the reader's rights: anyone who cannot read the recipes sees
-- no cost, no suggested price and no margin.
CREATE OR REPLACE VIEW v_catalog_costing
WITH (security_invoker = true) AS
SELECT p.id AS product_id,
  p.product_name, p.item_code, p.kind, p.unit, p.active,
  p.service_line_id, sl.name AS service_line,
  p.unit_price AS list_price,
  COALESCE(p.markup_percent, sl.markup_percent, 0) AS markup_percent,
  c.components,
  c.unpriced_components,
  CASE WHEN c.components > 0 THEN round(c.cost_per_unit, 2) END AS cost_per_unit,
  CASE WHEN c.components > 0 THEN round(c.cost_per_unit * (1 + COALESCE(p.markup_percent, sl.markup_percent, 0) / 100), 2) END AS suggested_price,
  CASE WHEN c.components > 0 AND COALESCE(p.unit_price, 0) > 0
       THEN round((p.unit_price - c.cost_per_unit) / p.unit_price * 100, 1) END AS margin_at_list_pct,
  c.oldest_market_price_at
FROM products p
LEFT JOIN catalog_service_lines sl ON sl.id = p.service_line_id
LEFT JOIN LATERAL (
  SELECT count(*) AS components,
    count(*) FILTER (WHERE x.cost IS NULL) AS unpriced_components,
    COALESCE(sum(x.qty * x.cost), 0) AS cost_per_unit,
    min(x.market_at) AS oldest_market_price_at
  FROM (
    SELECT k.qty_per_unit AS qty,
      COALESCE(k.unit_cost, mp.unit_price) AS cost,
      CASE WHEN k.unit_cost IS NULL THEN mp.sourced_at END AS market_at
    FROM catalog_item_components k
    LEFT JOIN LATERAL (
      SELECT m.unit_price, m.sourced_at FROM market_prices m
      WHERE k.stock_item_id IS NOT NULL AND m.stock_item_id = k.stock_item_id
      ORDER BY m.sourced_at DESC LIMIT 1
    ) mp ON true
    WHERE k.product_id = p.id
  ) x
) c ON true;
REVOKE ALL ON v_catalog_costing FROM PUBLIC, anon;
GRANT SELECT ON v_catalog_costing TO authenticated;

-- ── 5. Templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  service_line_id uuid REFERENCES catalog_service_lines(id) ON DELETE SET NULL,
  description     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_template_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES catalog_templates(id) ON DELETE CASCADE,
  product_id  uuid REFERENCES products(id) ON DELETE SET NULL,
  description text NOT NULL CHECK (btrim(description) <> ''),
  qty         numeric NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit        text,
  -- Empty: take the catalog item's price when the template is used.
  unit_price  numeric CHECK (unit_price IS NULL OR unit_price >= 0),
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS catalog_template_lines_template_idx ON catalog_template_lines (template_id);
DROP TRIGGER IF EXISTS catalog_templates_updated_at ON catalog_templates;
CREATE TRIGGER catalog_templates_updated_at BEFORE UPDATE ON catalog_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE catalog_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_template_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_templates_read ON catalog_templates;
CREATE POLICY catalog_templates_read ON catalog_templates FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales', 'project_manager']::user_role[]));
DROP POLICY IF EXISTS catalog_templates_write ON catalog_templates;
CREATE POLICY catalog_templates_write ON catalog_templates FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));
DROP POLICY IF EXISTS catalog_template_lines_read ON catalog_template_lines;
CREATE POLICY catalog_template_lines_read ON catalog_template_lines FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales', 'project_manager']::user_role[]));
DROP POLICY IF EXISTS catalog_template_lines_write ON catalog_template_lines;
CREATE POLICY catalog_template_lines_write ON catalog_template_lines FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));
REVOKE ALL ON catalog_templates, catalog_template_lines FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_templates, catalog_template_lines TO authenticated;

-- Starter templates for the jobs Kuncho repeats.
INSERT INTO catalog_templates (name, service_line_id, description)
SELECT v.name, sl.id, v.descr
FROM (VALUES
  ('Exhibition booth 3×3 (custom)', 'event_construction',   'A 9 m² custom stand, branded, installed and taken down'),
  ('Kitchen renovation',            'residential_interior', 'Cabinets, tiling, painting, lighting for a standard kitchen'),
  ('Bathroom renovation',           'residential_interior', 'One bathroom: fit-out, ceiling, lighting')
) AS v(name, line, descr)
JOIN catalog_service_lines sl ON sl.code = v.line
ON CONFLICT (name) DO NOTHING;

INSERT INTO catalog_template_lines (template_id, product_id, description, qty, unit, sort_order)
SELECT t.id, p.id, p.product_name, v.qty, p.unit, v.ord
FROM (VALUES
  ('Exhibition booth 3×3 (custom)', 'Custom booth construction',   9, 10),
  ('Exhibition booth 3×3 (custom)', 'Branding & printing',        12, 20),
  ('Exhibition booth 3×3 (custom)', 'Truss & lighting',            1, 30),
  ('Exhibition booth 3×3 (custom)', 'Furniture hire',              4, 40),
  ('Exhibition booth 3×3 (custom)', 'Installation & dismantling',  1, 50),
  ('Exhibition booth 3×3 (custom)', 'Transport',                   2, 60),
  ('Kitchen renovation',            'Kitchen cabinets',            6, 10),
  ('Kitchen renovation',            'Floor tiling',               12, 20),
  ('Kitchen renovation',            'Wall painting',              30, 30),
  ('Kitchen renovation',            'Electrical & lighting point',  8, 40),
  ('Bathroom renovation',           'Bathroom fit-out',            1, 10),
  ('Bathroom renovation',           'Gypsum board ceiling',        6, 20),
  ('Bathroom renovation',           'Electrical & lighting point',  3, 30)
) AS v(template, item, qty, ord)
JOIN catalog_templates t ON t.name = v.template
JOIN products p ON p.product_name = v.item
WHERE NOT EXISTS (SELECT 1 FROM catalog_template_lines l WHERE l.template_id = t.id);

-- ── 6. Where a proforma's lines came from ───────────────────────────────
ALTER TABLE proforma_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES catalog_templates(id) ON DELETE SET NULL;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS source_boq_id uuid REFERENCES boqs(id) ON DELETE SET NULL;

-- ── 7. A proforma becomes the project's draft BOQ ───────────────────────
-- Runs with the caller's rights, so BOQ and proforma permissions apply as
-- they do anywhere else.
CREATE OR REPLACE FUNCTION create_boq_from_proforma(p_proforma_id uuid, p_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE
  v_pf      proformas%ROWTYPE;
  v_proj    projects%ROWTYPE;
  v_owner   uuid;
  v_version int;
  v_boq     uuid;
  v_section uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_pf FROM proformas WHERE id = p_proforma_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proforma not found'; END IF;
  SELECT * INTO v_proj FROM projects WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v_proj.client_id IS NOT NULL AND v_pf.client_id IS NOT NULL AND v_proj.client_id <> v_pf.client_id THEN
    RAISE EXCEPTION 'That project is for another client';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM proforma_items WHERE proforma_id = p_proforma_id) THEN
    RAISE EXCEPTION 'The proforma has no lines';
  END IF;
  v_owner := COALESCE(v_proj.project_manager_id, current_staff_id());
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Give the project a project manager first'; END IF;

  SELECT COALESCE(max(version_number), 0) + 1 INTO v_version FROM boqs WHERE project_id = p_project_id;
  INSERT INTO boqs (project_id, version_number, title, status, source_proforma_id, owner_pm_staff_id, created_by_staff_id, notes)
  VALUES (p_project_id, v_version, 'From proforma ' || COALESCE(v_pf.proforma_number, ''), 'draft',
          p_proforma_id, v_owner, current_staff_id(), v_pf.notes)
  RETURNING id INTO v_boq;

  INSERT INTO boq_items (boq_id, node_type, name, display_order)
  VALUES (v_boq, 'section', 'Proforma ' || COALESCE(v_pf.proforma_number, ''), 0)
  RETURNING id INTO v_section;

  INSERT INTO boq_items (boq_id, parent_item_id, node_type, name, unit, quantity, unit_rate_etb, display_order)
  SELECT v_boq, v_section, 'line_item', COALESCE(NULLIF(btrim(i.description), ''), 'Item'), i.unit, i.qty, i.unit_price,
         row_number() OVER (ORDER BY i.sort_order, i.created_at)
  FROM proforma_items i WHERE i.proforma_id = p_proforma_id;

  UPDATE proformas SET project_id = COALESCE(project_id, p_project_id) WHERE id = p_proforma_id;
  RETURN v_boq;
END $$;
REVOKE ALL ON FUNCTION create_boq_from_proforma(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_boq_from_proforma(uuid, uuid) TO authenticated;
