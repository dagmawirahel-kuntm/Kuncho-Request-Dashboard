-- Seed stock_items catalog from Stock.xlsx
-- Quantity (stock_receipts) and quality_grade / warehouse_zone
-- are left NULL — to be filled by the stock manager.

INSERT INTO stock_items (
  item_name, amharic_name,
  main_category, item_type,
  unit, is_tool, active, quality_grade, warehouse_zone, reorder_level
) VALUES

-- ══════════════════════════════════════════════════════════════
-- WOOD WORK
-- ══════════════════════════════════════════════════════════════

-- Solid / engineered boards
('Solid Wood Board',        NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),
('Fayzit Board',            NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),
('Safarian Board',          NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),

-- MDF variants
('MDF Board (TY)',          NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),
('MDF Board (ET)',          NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),

-- Morale / Particle board variants
('Morale Board (Australia)',NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),
('Morale Board (Shashemene)',NULL,        'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),

-- Laminated boards
('Laminated Board (Mat)',   NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),
('Chip Wood Board',         NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),
('UV Board',                NULL,         'wood_work', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),

-- Local timber
('Wanza Timber',            'ዋንዛ',       'wood_work', 'raw_material', 'pcs',   false, true, NULL, NULL, NULL),

-- ══════════════════════════════════════════════════════════════
-- PAINTING MATERIAL
-- ══════════════════════════════════════════════════════════════

-- Water-based
('Primer (Water-based)',    NULL,         'painting',  'consumable',  'L',     false, true, NULL, NULL, NULL),
('Estco Paint (Water-based)',NULL,        'painting',  'consumable',  'L',     false, true, NULL, NULL, NULL),

-- Oil-based / finishing
('Lacer (Oil-based)',       NULL,         'painting',  'consumable',  'L',     false, true, NULL, NULL, NULL),
('Siler',                   NULL,         'painting',  'consumable',  'L',     false, true, NULL, NULL, NULL),
('Cola (Adhesive)',          NULL,         'painting',  'consumable',  'L',     false, true, NULL, NULL, NULL),

-- ══════════════════════════════════════════════════════════════
-- CONSTRUCTION MATERIAL  (structural metals)
-- ══════════════════════════════════════════════════════════════

('RHS (Rectangular Hollow Section)', NULL, 'construction', 'raw_material', 'm', false, true, NULL, NULL, NULL),
('CHS (Circular Hollow Section)',    NULL, 'construction', 'raw_material', 'm', false, true, NULL, NULL, NULL),
('L Metal',                          NULL, 'construction', 'raw_material', 'm', false, true, NULL, NULL, NULL),
('Lamera (Sheet Metal)',             NULL, 'construction', 'raw_material', 'sheet', false, true, NULL, NULL, NULL),
('Gutter',                           'ጎሮንዳዮ', 'construction', 'raw_material', 'm', false, true, NULL, NULL, NULL),

-- ══════════════════════════════════════════════════════════════
-- HARDWARE & ACCESSORIES  (aluminum profiles, sheeting)
-- ══════════════════════════════════════════════════════════════

('Aluminum Omega Profile',  NULL,         'hardware',  'raw_material', 'm',    false, true, NULL, NULL, NULL),
('Aluminum C-Channel Profile', NULL,      'hardware',  'raw_material', 'm',    false, true, NULL, NULL, NULL),
('PC Sheet',                NULL,         'hardware',  'raw_material', 'sheet', false, true, NULL, NULL, NULL),

-- ══════════════════════════════════════════════════════════════
-- ELECTRICAL MATERIAL
-- ══════════════════════════════════════════════════════════════

('Strip Light (Warm White)', NULL,        'electrical', 'raw_material', 'pcs', false, true, NULL, NULL, NULL),
('Strip Light (Cool White)', NULL,        'electrical', 'raw_material', 'pcs', false, true, NULL, NULL, NULL),
('Shooter Light',            NULL,        'electrical', 'raw_material', 'pcs', false, true, NULL, NULL, NULL),
('Spot Light',               NULL,        'electrical', 'raw_material', 'pcs', false, true, NULL, NULL, NULL),
('Cable',                    NULL,        'electrical', 'raw_material', 'm',   false, true, NULL, NULL, NULL),
('Wire',                     NULL,        'electrical', 'raw_material', 'm',   false, true, NULL, NULL, NULL),
('Conduit',                  NULL,        'electrical', 'raw_material', 'm',   false, true, NULL, NULL, NULL),

-- ══════════════════════════════════════════════════════════════
-- TOOLS & EQUIPMENT — Power / Machine Tools  (is_tool = true)
-- ══════════════════════════════════════════════════════════════

('Drill (incco)',            NULL,         'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Drill (Makita)',           NULL,         'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Drill (Bosh)',             NULL,         'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Concrete Drill Bit Set',  NULL,         'tools', 'tool', 'set', true, true, NULL, NULL, NULL),
('Grinder (incco)',         NULL,         'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Grinder (Makita)',        NULL,         'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Circular Saw',             NULL,        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Jigsaw (Gicso)',           NULL,        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Router (Rawuter)',         NULL,        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Sander',                   NULL,        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Hot Glue Gun (Electric)',  NULL,        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Laser Leveler',            'ሌዘር ውሀልክ', 'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Staple Gun',               NULL,        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Compressor',               NULL,        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),

-- ══════════════════════════════════════════════════════════════
-- TOOLS & EQUIPMENT — Hand Tools  (is_tool = true)
-- ══════════════════════════════════════════════════════════════

('Spirit Level',             'ውሀልክ',     'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Hand Saw',                 'መጋዝ',       'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Hammer',                   'መዶሻ',       'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Chisel',                   'መሮ',        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Clamp',                    'ክላፕ',       'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Manual Glue Gun',          NULL,        'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Silicon Pusher',           'ሲልከን መግፊያ','tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Pliers',                   'ጉጠት',       'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Try Square',               'እስኳድራ',    'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),
('Aluminum Cutter',          'የአልሙኒየም መቁረጫ', 'tools', 'tool', 'pcs', true, true, NULL, NULL, NULL),

-- ══════════════════════════════════════════════════════════════
-- BOOTH RETURN
-- ══════════════════════════════════════════════════════════════

('Booth Return Items',       NULL,        'booth_return', 'raw_material', 'pcs', false, true, NULL, NULL, NULL)

ON CONFLICT DO NOTHING;
