-- 521: The item decides the ledger account, not the GRN line.
--
-- Until now the person recording a GRN picked a "ledger" (category) for every
-- line from ~70 choices; 91% of order lines carried no category, so the GRN
-- was where the account was decided, and the same item went to different
-- accounts on different days (cutting discs in Building Materials, Tools and
-- Inventory). This migration:
--
--   1. Groups the chart: the item-level material accounts (Screw, Nail, Tap…)
--      sit under ten accounts by kind of cost (construction, finishing,
--      joinery and wood, electrical, plumbing, hardware, aluminium and glass,
--      upholstery, site consumables, other). The leaves stay as the detail;
--      the trial balance and P&L read by the group. Adds Site consumables.
--      Renames Tools to Small tools, Office Inventory to Office supplies,
--      First Aid to Safety gear and first aid.
--   2. Each stock item carries its ledger (stock_items.ledger_category_id)
--      and whether it is kept in warehouse stock (is_stocked). Backfilled
--      from the item's name for clear cases (discs, sandpaper, tape and
--      brushes are site consumables; elbows and PVC are plumbing; helmets
--      and vests are safety gear; pens and paper are office supplies; power
--      tools are tools), else from the account it was received under most
--      often. "Inventory" and "Multiple" are not a kind of cost and are not
--      carried over: those items wait for finance.
--   3. A GRN line takes the item's ledger. The GRN screen shows it and only
--      asks when the item has none; the first answer is saved on the item.
--   4. Posting a GRN line (fixes 520):
--        - a tool at or above the equipment threshold (ETB 5,000 a unit before tax, the app's
--          capitalisation threshold;
--          ledger_settings) goes to 1610 Property, plant and equipment and
--          shows on the list of equipment to register;
--        - goods for no project go to 1510 Workshop stock only when the item
--          is kept in stock; otherwise straight to the item's own account;
--        - a line whose item has no ledger is not guessed: it stays in 1520
--          Purchases awaiting delivery and is listed for finance.
--      Stock issues post only for items kept in stock (others were costed
--      when received).
--   5. Finance sets an item's ledger once (set_item_ledger); every receipt
--      of that item this year is re-costed to follow.

SET search_path TO public;

-- ─── 1. Chart grouping ─────────────────────────────────────────────────────

DO $chart$
DECLARE v_mat uuid := (SELECT id FROM chart_of_accounts WHERE account_code = '5100');
        g record; v_parent uuid;
BEGIN
  FOR g IN SELECT * FROM (VALUES
      ('5150', 'Construction materials', ARRAY['5102','5103','5104','5106','5113','5114','5117','5129','5140']),
      ('5151', 'Finishing materials',    ARRAY['5115','5120','5123','5128','5130']),
      ('5152', 'Joinery and wood',       ARRAY['5105','5108','5118','5132','5133','5134','5135','5901']),
      ('5153', 'Electrical',             ARRAY['5109']),
      ('5154', 'Plumbing and sanitary',  ARRAY['5126','5131']),
      ('5155', 'Hardware and fixings',   ARRAY['5107','5119','5122','5127']),
      ('5156', 'Aluminium and glass',    ARRAY['5101','5112']),
      ('5157', 'Upholstery and soft materials', ARRAY['5110','5111','5116','5121']),
      ('5158', 'Site consumables',       ARRAY['5125']),
      ('5159', 'Other materials',        ARRAY['5124','5138','5139'])
    ) AS t(code, name, leaves)
  LOOP
    SELECT id INTO v_parent FROM chart_of_accounts WHERE account_code = g.code;
    IF v_parent IS NULL THEN
      INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, description)
      VALUES (g.code, g.name, 'Expense', v_mat, false, true, 'operating', 'Group of material accounts by kind of cost (521).')
      RETURNING id INTO v_parent;
    END IF;
    UPDATE chart_of_accounts SET parent_account_id = v_parent WHERE account_code = ANY (g.leaves);
  END LOOP;
END $chart$;

-- Site consumables: a category and a leaf of its own.
INSERT INTO categories (category_name, nature, parent_type, asset_class, cost_group_id, ledger_group_id)
SELECT 'Site Consumables', c.nature, c.parent_type, c.asset_class, (SELECT id FROM cost_groups WHERE name = 'Materials'), c.ledger_group_id
  FROM categories c WHERE c.category_name = 'Sand Paper'
   AND NOT EXISTS (SELECT 1 FROM categories WHERE category_name = 'Site Consumables');
INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, category_id, description)
SELECT '5141', 'Site consumables', 'Expense', (SELECT id FROM chart_of_accounts WHERE account_code = '5158'), true, true, 'operating',
       (SELECT id FROM categories WHERE category_name = 'Site Consumables'),
       'Cutting and grinding discs, sandpaper, tape, brushes and rollers, blades and bits: used up on the job (521).'
 WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '5141');

UPDATE chart_of_accounts SET account_name = 'Small tools' WHERE account_code = '6207';
UPDATE chart_of_accounts SET account_name = 'Office supplies' WHERE account_code = '6204';
UPDATE chart_of_accounts SET account_name = 'Safety gear and first aid' WHERE account_code = '5903';
UPDATE categories SET category_name = 'Office Supplies' WHERE category_name = 'Office Inventory';
UPDATE categories SET category_name = 'Safety Gear & First Aid' WHERE category_name = 'First Aid Materials';
UPDATE categories SET category_name = 'Small Tools' WHERE category_name = 'Tools';

-- Every material category in the Materials cost group; one account per category.
UPDATE categories cat SET cost_group_id = (SELECT id FROM cost_groups WHERE name = 'Materials')
 WHERE cat.cost_group_id IS NULL
   AND EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.category_id = cat.id AND c.account_code LIKE '51%');
UPDATE chart_of_accounts SET category_id = NULL
 WHERE account_code = '5902' AND category_id = (SELECT id FROM categories WHERE category_name = 'Bank Charges');

-- ─── 2. The item carries its ledger ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ledger_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  equipment_threshold_etb numeric NOT NULL DEFAULT 5000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO ledger_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE ledger_settings ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'ledger_settings read' AND polrelid = 'ledger_settings'::regclass) THEN
    CREATE POLICY "ledger_settings read" ON ledger_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'ledger_settings finance' AND polrelid = 'ledger_settings'::regclass) THEN
    CREATE POLICY "ledger_settings finance" ON ledger_settings FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM user_profiles u WHERE u.id = (SELECT auth.uid()) AND u.role::text IN ('admin', 'finance')));
  END IF;
END $p$;
GRANT SELECT, UPDATE ON ledger_settings TO authenticated;

ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS ledger_category_id uuid REFERENCES categories(id),
  ADD COLUMN IF NOT EXISTS is_stocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ledger_set_by uuid,
  ADD COLUMN IF NOT EXISTS ledger_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS ledger_source text;
COMMENT ON COLUMN stock_items.ledger_category_id IS 'The ledger (category, hence account) this item is costed to on every receipt (521).';
COMMENT ON COLUMN stock_items.is_stocked IS 'Kept in warehouse stock: a receipt with no project goes to 1510 and a stock issue moves it to the project (521).';
COMMENT ON COLUMN stock_items.ledger_source IS 'name (rule on the item name), history (most-used on GRNs), sub_category, grn (first receipt), finance.';

ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS grn_item_id uuid REFERENCES goods_received_note_items(id);

-- A category that says where a thing is or that it is mixed, not what it is.
CREATE OR REPLACE FUNCTION public.ledger_category_usable(p_cat uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT p_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = p_cat AND c.category_name IN ('Multiple', 'Inventory'))
$f$;

-- The ledger an item name plainly belongs to, for the clear cases only.
CREATE OR REPLACE FUNCTION public.ledger_category_for_name(p_name text, p_is_tool boolean DEFAULT false)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT id FROM categories WHERE category_name = (
    CASE
      WHEN p_name ~* '(pressure switch|carbon brush|spare part)' THEN 'Workshop Overhead'
      WHEN p_name ~* '(hard ?disk|\mhdd\M|\mssd\M|flash ?disk)' THEN 'Office Supplies'
      WHEN p_name ~* 'zipper' THEN 'Fabric'
      WHEN p_name ~* 'measuring tape' THEN 'Small Tools'
      WHEN p_name ~* '(elbow|teflon|\mpvc\M|u ?pvc|robnato|\msink\M|faucet|\mpipe\M|valve|\mtap\M)' THEN 'Sanitary Material'
      WHEN p_name ~* '(helmet|\mvest\M|glove|safety boot|goggle|\mmask\M|first aid)' THEN 'Safety Gear & First Aid'
      WHEN p_name ~* '(\mpen\M|\ma4\M|file box|printer|toner|metereziya)' THEN 'Office Supplies'
      WHEN p_name ~* '(\mdis[ck]\M|grinding|birchi[qk]o|sand ?paper|\mbrush|\mroll?o\M|roller|scotch|\mtape\M|staple wire|mekurecha|blade|\mbit\M|electrode|melach|milach|router face)' THEN 'Site Consumables'
      WHEN p_is_tool OR p_name ~* '(grinder|jigsaw|\mdrill\M|\msander\M|laser level|mortar mixer|\mrouter\M|charger|alen ?key|\mmeter\M|medosha)' THEN 'Small Tools'
      WHEN p_name ~* '(aluminu?i?um profile|teletafi)' THEN 'Aluminum'
      WHEN p_name ~* '(\msand\M|ashewa|aggregate|gravel)' THEN 'Building Materials'
    END)
$f$;

-- Backfill: name rule, else the ledger it was received under most, else its sub-category.
WITH hist AS (
  SELECT oi.stock_item_id, gi.category_id, count(*) n,
         row_number() OVER (PARTITION BY oi.stock_item_id ORDER BY count(*) DESC, max(gi.created_at) DESC) rn
    FROM goods_received_note_items gi
    JOIN sourcing_bundle_items sbi ON sbi.id = gi.sourcing_bundle_item_id
    JOIN order_items oi ON oi.id = sbi.order_item_id
   WHERE oi.stock_item_id IS NOT NULL AND ledger_category_usable(gi.category_id)
   GROUP BY 1, 2
), pick AS (
  SELECT si.id,
         ledger_category_for_name(si.item_name, COALESCE(si.is_tool, false)) AS by_name,
         (SELECT h.category_id FROM hist h WHERE h.stock_item_id = si.id AND h.rn = 1) AS by_history,
         (SELECT sc.parent_category_id FROM sub_categories sc WHERE sc.id = si.sub_category_id AND ledger_category_usable(sc.parent_category_id)) AS by_sub
    FROM stock_items si WHERE si.ledger_category_id IS NULL
)
UPDATE stock_items si
   SET ledger_category_id = COALESCE(p.by_name, p.by_history, p.by_sub),
       ledger_source = CASE WHEN p.by_name IS NOT NULL THEN 'name' WHEN p.by_history IS NOT NULL THEN 'history' ELSE 'sub_category' END,
       ledger_set_at = now()
  FROM pick p
 WHERE p.id = si.id AND COALESCE(p.by_name, p.by_history, p.by_sub) IS NOT NULL;

UPDATE stock_items SET is_stocked = true
 WHERE NOT is_stocked AND (warehouse_zone IS NOT NULL OR COALESCE(reorder_level, 0) > 0);

-- The order line's stock item, or the one its name matches.
CREATE OR REPLACE FUNCTION public.grn_item_stock_item(p_bundle_item uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT COALESCE(oi.stock_item_id, stock_item_for_name(oi.item_name, oi.unit))
    FROM sourcing_bundle_items sbi JOIN order_items oi ON oi.id = sbi.order_item_id
   WHERE sbi.id = p_bundle_item
$f$;

-- ─── 3. A GRN line takes the item's ledger ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_grn_item_ledger_from_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_cat uuid;
BEGIN
  SELECT si.ledger_category_id INTO v_cat FROM stock_items si WHERE si.id = grn_item_stock_item(NEW.sourcing_bundle_item_id);
  IF v_cat IS NOT NULL THEN NEW.category_id := v_cat; END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_b_grn_item_ledger_from_item
  BEFORE INSERT ON goods_received_note_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_grn_item_ledger_from_item();

-- The first receipt of an item with no ledger classifies it (finance reviews).
CREATE OR REPLACE FUNCTION public.auto_catalog_new_stock_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE
  v_order_item         RECORD;
  v_new_stock_item_id  UUID;
  v_cat                UUID;
BEGIN
  SELECT oi.* INTO v_order_item
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.id = NEW.sourcing_bundle_item_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  v_new_stock_item_id := v_order_item.stock_item_id;
  IF v_new_stock_item_id IS NULL THEN
    v_new_stock_item_id := stock_item_for_name(v_order_item.item_name, v_order_item.unit);
  END IF;

  IF v_new_stock_item_id IS NULL THEN
    INSERT INTO stock_items (item_name, unit, sub_category_id, catalog_status, active, notes)
    VALUES (
      btrim(regexp_replace(v_order_item.item_name, '\s+', ' ', 'g')), COALESCE(v_order_item.unit, 'pcs'),
      v_order_item.sub_category_id, 'pending_setup', TRUE,
      'Auto-created on receipt from PR line ' || v_order_item.id || ' — needs a proper category (for item_code), warehouse_zone, and reorder_level set before it counts toward future stock-checks. If it is an item already in stock, merge it from Stock → Duplicates.'
    )
    RETURNING id INTO v_new_stock_item_id;
  END IF;

  IF v_order_item.stock_item_id IS NULL THEN
    UPDATE order_items SET stock_item_id = v_new_stock_item_id WHERE id = v_order_item.id;
  END IF;

  -- Classify an unclassified item: its name first, else what the receiver picked.
  v_cat := COALESCE(ledger_category_for_name(v_order_item.item_name),
                    CASE WHEN ledger_category_usable(NEW.category_id) THEN NEW.category_id END);
  IF v_cat IS NOT NULL THEN
    UPDATE stock_items
       SET ledger_category_id = v_cat,
           ledger_source = CASE WHEN v_cat = ledger_category_for_name(v_order_item.item_name) THEN 'name' ELSE 'grn' END,
           ledger_set_at = now(), ledger_set_by = auth.uid()
     WHERE id = v_new_stock_item_id AND ledger_category_id IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─── 4. Posting a GRN line ─────────────────────────────────────────────────

-- What each line of a GRN posts: account, project, amount. A NULL account
-- means the item has no ledger yet; the line is not posted and stays in 1520.
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
           (b.is_tool OR b.cat = (SELECT id FROM categories WHERE category_name = 'Small Tools'))
             AND b.order_price >= (SELECT equipment_threshold_etb FROM ledger_settings LIMIT 1) AS is_equipment
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

CREATE OR REPLACE FUNCTION public.sync_bundle_receipt_cost(p_bundle uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  sb sourcing_bundles%ROWTYPE; g record;
  v_live boolean; v_billed numeric; v_bill_project uuid;
  v_ordered numeric; v_base numeric; v_order_gross numeric; v_k numeric; v_lines jsonb;
BEGIN
  IF p_bundle IS NULL THEN RETURN; END IF;
  SELECT * INTO sb FROM sourcing_bundles WHERE id = p_bundle;
  IF sb.id IS NULL THEN RETURN; END IF;
  v_live := NOT EXISTS (
    SELECT 1 FROM expenses e
     WHERE e.sourcing_bundle_id = p_bundle
       AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expenses' AND je.source_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expense_accrual' AND je.source_id = e.id));
  SELECT COALESCE(sum(e.amount_etb - COALESCE((SELECT sum(t.vat_amount) FROM v_input_vat_tracker t WHERE t.expense_id = e.id AND t.claimable), 0)), 0),
         (array_agg(e.project_id) FILTER (WHERE e.project_id IS NOT NULL))[1]
    INTO v_billed, v_bill_project
    FROM expenses e
   WHERE e.sourcing_bundle_id = p_bundle AND e.expense_type = 'purchase_order'
     AND e.approval_status::text = 'finance_approved' AND NOT COALESCE(e.is_archived, false)
     AND COALESCE(e.payment_state, '') <> 'void' AND in_current_fy(e.date);
  SELECT COALESCE(sum(COALESCE(r.ordered, 0) * COALESCE(r.unit_price_actual, 0)), 0),
         COALESCE(sum((COALESCE(r.ordered, 0)
                       - CASE WHEN sb.payment_pattern = 'pay_in_advance' THEN 0
                              ELSE COALESCE(r.rejected, 0) + CASE WHEN sb.closed_short_at IS NOT NULL THEN COALESCE(r.outstanding, 0) ELSE 0 END END)
                      * COALESCE(r.unit_price_actual, 0)), 0)
    INTO v_ordered, v_base
    FROM v_bundle_line_receipts r WHERE r.bundle_id = p_bundle;
  SELECT t.gross INTO v_order_gross
    FROM po_expense_tax(COALESCE(sb.total_value, 0), (SELECT wth_eligible FROM vendors WHERE id = sb.vendor_id)) t;
  v_k := CASE WHEN v_billed > 0 AND v_base > 0 THEN v_billed / v_base
              WHEN v_ordered > 0 THEN COALESCE(v_order_gross, 0) / v_ordered
              ELSE 1 END;
  FOR g IN SELECT * FROM goods_received_notes WHERE sourcing_bundle_id = p_bundle LOOP
    v_lines := '[]'::jsonb;
    IF v_live AND in_current_fy(g.received_at::date) THEN
      WITH y AS (SELECT * FROM grn_line_postings(g.id, v_k, v_bill_project) WHERE account_id IS NOT NULL AND amount > 0)
      SELECT COALESCE((SELECT jsonb_agg(ledger_line(account_id, amount,
                         CASE reason WHEN 'equipment' THEN 'Equipment received: ' WHEN 'stock' THEN 'Into stock: ' ELSE 'Received: ' END
                         || COALESCE(item_name, 'goods'), project_id)) FROM y), '[]'::jsonb)
          || COALESCE((SELECT jsonb_agg(ledger_line(coa_id('purchases_in_transit'), -s, 'Goods received on ' || COALESCE(g.grn_code, 'a GRN'), project_id))
                         FROM (SELECT project_id, sum(amount) AS s FROM y GROUP BY project_id) z), '[]'::jsonb)
        INTO v_lines;
    END IF;
    PERFORM ledger_sync('grn_cost', g.id, COALESCE(g.received_at::date, CURRENT_DATE),
                        'Goods received: ' || COALESCE(g.grn_code, '') || COALESCE(' · ' || sb.bundle_code, ''), v_lines);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('sourcing_bundles', p_bundle, 'Costing goods received: ' || SQLERRM);
END $f$;

-- Stock issues: only items kept in stock were put into 1510.
CREATE OR REPLACE FUNCTION public.sync_stock_issue_ledger(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE s stock_issues%ROWTYPE; v_amt numeric; v_acct uuid; v_lines jsonb := '[]'::jsonb; v_item text; v_stocked boolean;
BEGIN
  SELECT * INTO s FROM stock_issues WHERE id = p_id;
  v_amt := round(COALESCE(s.total_cost, s.quantity * s.unit_cost_snapshot, 0), 2);
  SELECT si.item_name, si.is_stocked,
         (SELECT c.id FROM chart_of_accounts c
           WHERE c.is_postable AND c.category_id = COALESCE(CASE WHEN ledger_category_usable(si.ledger_category_id) THEN si.ledger_category_id END,
                                                            (SELECT sc.parent_category_id FROM sub_categories sc WHERE sc.id = si.sub_category_id))
           ORDER BY c.account_code LIMIT 1)
    INTO v_item, v_stocked, v_acct
    FROM stock_items si WHERE si.id = s.stock_item_id;
  IF s.id IS NOT NULL AND COALESCE(v_stocked, false) AND s.reversed_at IS NULL AND s.reversal_of IS NULL AND v_amt > 0
     AND in_current_fy(COALESCE(s.issued_date, s.created_at::date)) THEN
    v_acct := COALESCE(v_acct, (SELECT id FROM chart_of_accounts WHERE account_code = '5138'));
    v_lines := jsonb_build_array(
      ledger_line(v_acct, v_amt, 'Stock used: ' || COALESCE(v_item, 'item'), s.project_id),
      ledger_line(coa_id('stock'), -v_amt, 'Out of stock'));
  END IF;
  PERFORM ledger_sync('stock_issues', p_id, COALESCE(s.issued_date, s.created_at::date, CURRENT_DATE),
                      'Stock issued' || COALESCE(': ' || v_item, ''), v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('stock_issues', p_id, SQLERRM);
END $f$;

-- ─── 5. Finance sets an item's ledger once ─────────────────────────────────

-- Re-cost this year's receipts and issues of one item.
CREATE OR REPLACE FUNCTION public.resync_item_costing(p_item uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT g.sourcing_bundle_id AS id
             FROM goods_received_note_items gi
             JOIN goods_received_notes g ON g.id = gi.grn_id
             JOIN sourcing_bundle_items sbi ON sbi.id = gi.sourcing_bundle_item_id
             JOIN order_items oi ON oi.id = sbi.order_item_id
            WHERE oi.stock_item_id = p_item AND in_current_fy(g.received_at::date) LOOP
    PERFORM sync_bundle_receipt_cost(r.id);
  END LOOP;
  FOR r IN SELECT id FROM stock_issues WHERE stock_item_id = p_item LOOP
    PERFORM sync_stock_issue_ledger(r.id);
  END LOOP;
END $f$;

CREATE OR REPLACE FUNCTION public.trg_stock_item_ledger_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  PERFORM resync_item_costing(NEW.id);
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_zz_stock_item_ledger
  AFTER UPDATE OF ledger_category_id, is_stocked, is_tool ON stock_items
  FOR EACH ROW WHEN (OLD.ledger_category_id IS DISTINCT FROM NEW.ledger_category_id
                     OR OLD.is_stocked IS DISTINCT FROM NEW.is_stocked
                     OR OLD.is_tool IS DISTINCT FROM NEW.is_tool)
  EXECUTE FUNCTION public.trg_stock_item_ledger_changed();

CREATE OR REPLACE FUNCTION public.set_item_ledger(p_item uuid, p_category uuid, p_stocked boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles u WHERE u.id = auth.uid()
                  AND u.role::text IN ('admin', 'executive', 'finance', 'stock_manager', 'procurement_officer')) THEN
    RAISE EXCEPTION 'Only finance, stock or procurement can set an item''s ledger';
  END IF;
  IF p_category IS NOT NULL AND NOT ledger_category_usable(p_category) THEN
    RAISE EXCEPTION 'Pick what the item is, not "Multiple" or "Inventory"';
  END IF;
  IF p_category IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.category_id = p_category AND c.is_postable) THEN
    RAISE EXCEPTION 'That ledger has no account in the chart';
  END IF;
  UPDATE stock_items
     SET ledger_category_id = COALESCE(p_category, ledger_category_id),
         is_stocked = COALESCE(p_stocked, is_stocked),
         ledger_source = CASE WHEN p_category IS NOT NULL THEN 'finance' ELSE ledger_source END,
         ledger_set_by = auth.uid(), ledger_set_at = now()
   WHERE id = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
END $f$;
GRANT EXECUTE ON FUNCTION public.set_item_ledger(uuid, uuid, boolean) TO authenticated;

-- ─── Lists for finance ─────────────────────────────────────────────────────

-- GRN lines this year not posted because the item has no ledger.
CREATE OR REPLACE VIEW public.v_grn_lines_needing_ledger WITH (security_invoker = on) AS
SELECT p.grn_item_id, g.id AS grn_id, g.grn_code, g.received_at::date AS received_on,
       sb.id AS bundle_id, sb.bundle_code, p.stock_item_id, p.item_name, p.quantity,
       round(p.quantity * sbi.unit_price_actual, 2) AS value_at_order_price
  FROM goods_received_notes g
  JOIN sourcing_bundles sb ON sb.id = g.sourcing_bundle_id
  CROSS JOIN LATERAL grn_line_postings(g.id, 1, NULL) p
  JOIN goods_received_note_items gi ON gi.id = p.grn_item_id
  JOIN sourcing_bundle_items sbi ON sbi.id = gi.sourcing_bundle_item_id
 WHERE p.reason = 'no ledger' AND in_current_fy(g.received_at::date)
   AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.sourcing_bundle_id = sb.id
                    AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expenses' AND je.source_id = e.id)
                    AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expense_accrual' AND je.source_id = e.id));
GRANT SELECT ON public.v_grn_lines_needing_ledger TO authenticated;

-- Items received this year, with their ledger, for finance to confirm.
CREATE OR REPLACE VIEW public.v_item_ledger_review WITH (security_invoker = on) AS
WITH rec AS (
  SELECT oi.stock_item_id, count(*) AS receipts,
         round(sum((COALESCE(gi.quantity_accepted, 0) + COALESCE(gi.quantity_damaged, 0)) * COALESCE(sbi.unit_price_actual, 0)), 2) AS received_value,
         count(DISTINCT gi.category_id) FILTER (WHERE ledger_category_usable(gi.category_id)) AS ledgers_used,
         max(g.received_at)::date AS last_received_on,
         bool_or(o.project_id IS NULL) AS any_for_warehouse
    FROM goods_received_note_items gi
    JOIN goods_received_notes g ON g.id = gi.grn_id
    JOIN sourcing_bundle_items sbi ON sbi.id = gi.sourcing_bundle_item_id
    JOIN order_items oi ON oi.id = sbi.order_item_id
    LEFT JOIN orders o ON o.id = oi.order_id
   WHERE oi.stock_item_id IS NOT NULL AND in_current_fy(g.received_at::date)
   GROUP BY 1
)
SELECT si.id AS stock_item_id, si.item_name, si.unit, si.item_type, si.is_tool, si.is_stocked, si.catalog_status,
       si.ledger_category_id, cat.category_name AS ledger_name, c.account_code, si.ledger_source, si.ledger_set_at,
       rec.receipts, rec.received_value, rec.ledgers_used, rec.last_received_on, rec.any_for_warehouse,
       (si.ledger_category_id IS NULL) AS needs_ledger,
       (si.ledger_source IS DISTINCT FROM 'finance') AS unconfirmed
  FROM stock_items si
  JOIN rec ON rec.stock_item_id = si.id
  LEFT JOIN categories cat ON cat.id = si.ledger_category_id
  LEFT JOIN LATERAL (SELECT account_code FROM chart_of_accounts WHERE category_id = si.ledger_category_id AND is_postable ORDER BY account_code LIMIT 1) c ON true;
GRANT SELECT ON public.v_item_ledger_review TO authenticated;

-- Equipment received this year and not yet on the fixed asset register.
CREATE OR REPLACE VIEW public.v_equipment_to_register WITH (security_invoker = on) AS
SELECT p.grn_item_id, g.grn_code, g.received_at::date AS received_on, sb.bundle_code, sb.vendor_id,
       COALESCE(v.vendor_name, sb.vendor_name) AS vendor_name, p.stock_item_id, p.item_name, p.quantity,
       p.unit_cost, round(p.quantity * p.unit_cost, 2) AS cost
  FROM goods_received_notes g
  JOIN sourcing_bundles sb ON sb.id = g.sourcing_bundle_id
  LEFT JOIN vendors v ON v.id = sb.vendor_id
  CROSS JOIN LATERAL grn_line_postings(g.id, 1, NULL) p
 WHERE p.reason = 'equipment' AND in_current_fy(g.received_at::date)
   AND NOT EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.grn_item_id = p.grn_item_id);
GRANT SELECT ON public.v_equipment_to_register TO authenticated;

REVOKE ALL ON FUNCTION public.resync_item_costing(uuid), public.grn_line_postings(uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grn_line_postings(uuid, numeric, uuid) TO authenticated;

-- ─── Re-cost this year's receipts (run in batches when applying) ───────────
-- SELECT sync_bundle_receipt_cost(id) FROM (SELECT DISTINCT sourcing_bundle_id id FROM goods_received_notes
--   WHERE sourcing_bundle_id IS NOT NULL AND in_current_fy(received_at::date)) b;
-- SELECT sync_stock_issue_ledger(id) FROM stock_issues;

-- Threshold set to the app's existing capitalisation threshold (fixedAssetLabels.ts).
UPDATE ledger_settings SET equipment_threshold_etb = 5000 WHERE equipment_threshold_etb = 10000;
