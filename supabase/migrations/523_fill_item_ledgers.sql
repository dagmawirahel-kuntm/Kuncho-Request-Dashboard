-- 523: A ledger for the items 521 left without one.
--
-- 178 items had no ledger after 521: their name gave no clear answer and
-- they had only ever been received under "Multiple" or "Inventory". Each is
-- set here from its name plus the order it came on (supplier, project, the
-- other lines on the order). Examples: "Internal", "External", "Cap",
-- "Oval", "Si look" come from aluminium suppliers with profiles and rollers,
-- so they are aluminium window parts; "Suttof" and "Bridge" sit on plumbing
-- orders. ledger_source = 'assigned' so finance sees them as not confirmed.
--
-- Also: equipment bought outright (category "PPE Plant Property &
-- Equipment", e.g. the workshop roof fans) is listed for the register like
-- tools above the threshold.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.grn_line_postings(p_grn uuid, p_k numeric, p_bill_project uuid)
RETURNS TABLE (grn_item_id uuid, stock_item_id uuid, item_name text, account_id uuid, project_id uuid,
               amount numeric, unit_cost numeric, quantity numeric, reason text)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  WITH base AS (
    SELECT gi.id AS grn_item_id, si.id AS stock_item_id, COALESCE(si.item_name, oi.item_name) AS item_name,
           o.project_id AS order_project,
           COALESCE(si.is_stocked, false) AS is_stocked,
           COALESCE(si.is_tool, false) AS is_tool,
           COALESCE(CASE WHEN ledger_category_usable(si.ledger_category_id) THEN si.ledger_category_id END,
                    CASE WHEN ledger_category_usable(gi.category_id) THEN gi.category_id END,
                    CASE WHEN ledger_category_usable(sc.parent_category_id) THEN sc.parent_category_id END) AS cat,
           (COALESCE(gi.quantity_accepted, gi.quantity_received - COALESCE(gi.quantity_rejected, 0) - COALESCE(gi.quantity_damaged, 0))
            + COALESCE(gi.quantity_damaged, 0)) AS qty,
           COALESCE(sbi.unit_price_actual, 0) * COALESCE(p_k, 1) AS unit_cost,
           COALESCE(sbi.unit_price_actual, 0) AS order_price
      FROM goods_received_note_items gi
      JOIN sourcing_bundle_items sbi ON sbi.id = gi.sourcing_bundle_item_id
      JOIN order_items oi ON oi.id = sbi.order_item_id
      LEFT JOIN orders o ON o.id = oi.order_id
      LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
      LEFT JOIN stock_items si ON si.id = COALESCE(oi.stock_item_id, stock_item_for_name(oi.item_name, oi.unit))
     WHERE gi.grn_id = p_grn
  ), acct AS (
    SELECT b.*,
           (SELECT c.id FROM chart_of_accounts c WHERE c.category_id = b.cat AND c.is_postable ORDER BY c.account_code LIMIT 1) AS cat_account,
           ((b.is_tool OR b.cat = (SELECT id FROM categories WHERE category_name = 'Small Tools'))
              AND b.order_price >= (SELECT equipment_threshold_etb FROM ledger_settings LIMIT 1))
           OR b.cat = (SELECT c.category_id FROM chart_of_accounts c WHERE c.system_key = 'ppe') AS is_equipment
      FROM base b
  )
  SELECT a.grn_item_id, a.stock_item_id, a.item_name,
         CASE WHEN a.is_equipment THEN coa_id('ppe')
              WHEN a.order_project IS NULL AND a.is_stocked THEN coa_id('stock')
              ELSE a.cat_account END,
         CASE WHEN a.is_equipment THEN NULL
              WHEN a.order_project IS NULL AND a.is_stocked THEN NULL
              ELSE COALESCE(a.order_project, p_bill_project) END,
         round(a.qty * a.unit_cost, 2), round(a.unit_cost, 2), a.qty,
         CASE WHEN a.is_equipment THEN 'equipment'
              WHEN a.order_project IS NULL AND a.is_stocked THEN 'stock'
              WHEN a.cat_account IS NULL THEN 'no ledger'
              ELSE 'cost' END
    FROM acct a
   WHERE a.qty > 0
$f$;

-- The assignments. Names are matched exactly as they are in the item list.
CREATE TEMP TABLE _assign (category text, names text[]);
INSERT INTO _assign VALUES
  ('Electrical Materials', ARRAY['1.5 water proof light','1.5 water proof light drive','2 cm light waterproof','Aluminum light waterproof',
     'bell switch','Cable A','Cable lock morsa','Cabo cable','Conduit','data socket','Double floor socket','double tv socket','Guroro condiut',
     'Himel contactor','Industrial socket 3 phase 32A','Industrial socket single 25A','Motor box 10x10','normal socket','Shadow light',
     'Shadow light_ drive','Shooter Light','Single phase breaker 32 A','socket with switch','socket with usb','Soket',
     'Soket for strip light 1 lamp','Strip Light (Cool White)','Strip light noeye white','Strip light_ ayne yelelew_ white','Utp','Wire']),
  ('Sanitary Material', ARRAY['Bridge','Female T 3/4 to 1/2','Floor Jali (Grate)','Hand Wash Siphon','Hand Washer Mixer','Hand weshe cifone',
     'Hose','Hose end big','Hose end small','O-Clamp 50','P trap 110','PPR 3/4','Reducar T 1'' to 3/4','Reducer 110 to 75','Sensor handwash',
     'Shower Head Big','Shwer head big','Socket 1''','Suttof','Suttoff','T 3/4','Tee ¾"','WC Accessory (Gold Dragon)','WC Attach',
     'WC citcover gold ragon']),
  ('Aluminum', ARRAY['Aluminium door lock','Aluminum C-Channel Profile','Aluminum Omega Profile','Aluminum T connector','Aluminum track',
     'Aluminum track_1.5','Angle Connector','Cap','cup','Cup bkack','External','Extenal','Internal','L aluminum','Lsilayd concert',
     'LTZ almunium','Oval','Roler','Rubber 5mm','rubber 6mm','s.angle connector','s.locker','Si look','Slider Connector','Sliding Cup',
     'Sliding Lock','T Connector','T Profile (Black)','Z Profile (Black)']),
  ('Cladding ', ARRAY['aluminum cladding T_silver','Aluminum cladding_ white','L_ silver','T_silver']),
  ('Components', ARRAY['45 hydraulic slider','Black handle','castel whell','castle wheel','Castle wheel 5*2','Coat hanger',
     'Coat hanger accessories','curtain handle','door slider','Filfila matefia','Filfila matefiya','glass door handle','Gobata matufiya',
     'handle','Hidden door stopper','Hydrolic hinge keteta','Indoor Door lock','Main door lock','Piston','slider bale 25','Slider bale 45',
     'slider bale 50','Tv mount movable','window handle']),
  ('Screw', ARRAY['black screw by 5','Board screw (black) — loose','fisher','screw *60','Screw #5','Screw 1.5','Screw 3','Screws',
     'self screw *20','self screw *30']),
  ('Punta', ARRAY['Ezbazer punta','Punta 3.5']),
  ('Structural Adhesive ', ARRAY['appel mitre giue','Cola (Adhesive)','mastish ye banner','matabekiya mastish glo','Mitre apple glue']),
  ('Paints', ARRAY['Estco Paint (Water-based)','Lacer (Oil-based)','Siler']),
  ('UV Wood', ARRAY['Black uv','Specified color laminated solid UV','UV Board','Uv cream color','UV GREY COLOR']),
  ('MDF', ARRAY['Fayzit Board','Laminated Board (Mat)','Laminated wood color','MDF Board (ET)','MDF Board (TY)','Normal mdf #18']),
  ('Chupped', ARRAY['Chepud','Chip Wood Board']),
  ('Veneer', ARRAY['cream veneer','gray veneer']),
  ('Morale', ARRAY['Morale Board (Australia)','Morale Board (Shashemene)']),
  ('Safarian', ARRAY['Safarian ble 12mm','Safarian Board']),
  ('Wood', ARRAY['Solid Wood Board','Wanza Timber']),
  ('Steel', ARRAY['CHS (Circular Hollow Section)','Gutter','L Metal','Lamera (Sheet Metal)','RHS (Rectangular Hollow Section)','Vertical profile']),
  ('Plastic', ARRAY['PC Sheet','plastic mashgeya']),
  ('Foam', ARRAY['Door Foam']),
  ('Granite', ARRAY['Kidus Green Imported Marble — kitchen top']),
  ('Other Services', ARRAY['Marble cutting']),
  ('Building Materials', ARRAY['L angel','L end','Lcorner']),
  ('Site Consumables', ARRAY['Almunium saw by 25cm','Holesaw 100','pad ye grader','Pistola chaf']),
  ('Small Tools', ARRAY['42v ingco battry','Battery 12 V','estepel gen']),
  ('Workshop Overhead', ARRAY['Leo Capacitor']),
  ('PPE Plant Property & Equipment', ARRAY['Industrial roof fan']);

ALTER TABLE stock_items DISABLE TRIGGER trg_zz_stock_item_ledger;
UPDATE stock_items si
   SET ledger_category_id = c.id, ledger_source = 'assigned', ledger_set_at = now()
  FROM _assign a JOIN categories c ON c.category_name = a.category
 WHERE si.item_name = ANY (a.names) AND si.ledger_category_id IS NULL;
ALTER TABLE stock_items ENABLE TRIGGER trg_zz_stock_item_ledger;

-- Re-cost (run in batches when applying):
-- SELECT resync_item_costing(id) FROM stock_items WHERE ledger_source = 'assigned';
