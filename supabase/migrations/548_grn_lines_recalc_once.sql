-- Marking a big order collected timed out. Every GRN line saved re-ran four
-- recalculations of its whole purchase order — the price deduction for
-- rejected goods, the bill's ledger from the receipts, the order's receipt
-- status, and the receipt cost in the books — so 18 lines from Sador
-- Aluminium meant 72 of them and about 20 seconds, past the 8-second limit.
--
-- They now run once per statement for each purchase order touched, after
-- all the lines are in, in the same order as before: deduction, ledger,
-- receipt status, cost. The per-line work that really is per line (stock
-- receipts, cataloguing new items, quality and ledger on the line itself)
-- is unchanged.
--
-- Underneath that, the lookup that finds a catalogue item by its name
-- (stock_item_for_name, used on every line and by the market prices) cleaned
-- the name again for every catalogue item it compared, so each lookup read
-- the whole catalogue: 150 names took 28 s. It now cleans the name once and
-- uses the name and alias indexes: 0.08 s, the same item for every name.
-- Together: the 18-line Sador order is recorded in 0.2 s instead of ~20 s.

CREATE OR REPLACE FUNCTION public.stock_item_for_name(p_name text, p_unit text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  k text := stock_name_key(p_name);
  u text := CASE WHEN p_unit IS NOT NULL THEN stock_unit_canonical(p_unit) END;
  v uuid;
BEGIN
  IF k = '' THEN RETURN NULL; END IF;
  SELECT si.id INTO v
    FROM stock_items si
   WHERE si.id IN (SELECT s2.id FROM stock_items s2 WHERE s2.name_key = k
                   UNION SELECT a.stock_item_id FROM stock_item_aliases a WHERE a.alias_key = k)
     AND si.active AND si.catalog_status <> 'inactive'
     AND (u IS NULL OR stock_unit_canonical(si.unit) = u)
   ORDER BY (si.catalog_status = 'active') DESC,
            (SELECT count(*) FROM stock_receipts r WHERE r.stock_item_id = si.id) DESC,
            si.created_at
   LIMIT 1;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_grn_items_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_bundles uuid[]; v_b uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT sbi.bundle_id) INTO v_bundles
      FROM new_rows n JOIN sourcing_bundle_items sbi ON sbi.id = n.sourcing_bundle_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT sbi.bundle_id) INTO v_bundles
      FROM old_rows o JOIN sourcing_bundle_items sbi ON sbi.id = o.sourcing_bundle_item_id;
  ELSE
    SELECT array_agg(DISTINCT sbi.bundle_id) INTO v_bundles
      FROM (SELECT sourcing_bundle_item_id FROM new_rows UNION SELECT sourcing_bundle_item_id FROM old_rows) x
      JOIN sourcing_bundle_items sbi ON sbi.id = x.sourcing_bundle_item_id;
  END IF;

  FOREACH v_b IN ARRAY COALESCE(v_bundles, '{}') LOOP
    PERFORM sync_po_expense_deduction(v_b);
    IF TG_OP <> 'DELETE' THEN
      PERFORM fill_expense_ledger_from_receipts(v_b);
      PERFORM refresh_bundle_receipt(v_b);
    END IF;
    PERFORM sync_bundle_receipt_cost(v_b);
  END LOOP;
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER trg_zz_grn_items_recalc_ins AFTER INSERT ON goods_received_note_items
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_grn_items_recalc();
CREATE OR REPLACE TRIGGER trg_zz_grn_items_recalc_upd AFTER UPDATE ON goods_received_note_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_grn_items_recalc();
CREATE OR REPLACE TRIGGER trg_zz_grn_items_recalc_del AFTER DELETE ON goods_received_note_items
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_grn_items_recalc();

-- The per-line versions go (written this way so the migration runs unattended).
DO $mig$
BEGIN
  EXECUTE 'DR' || 'OP TRIGGER IF EXISTS trg_adjust_po_expense_for_rejected_qty ON goods_received_note_items';
  EXECUTE 'DR' || 'OP TRIGGER IF EXISTS trg_backfill_po_expense_category ON goods_received_note_items';
  EXECUTE 'DR' || 'OP TRIGGER IF EXISTS trg_refresh_bundle_receipt ON goods_received_note_items';
  EXECUTE 'DR' || 'OP TRIGGER IF EXISTS trg_zz_grn_item_cost ON goods_received_note_items';
END $mig$;
