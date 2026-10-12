-- 446: Counting stock on paper.
--
-- A count can be printed as a sheet, filled in by hand on the shelves, and
-- typed in later. For that to work row for row:
--   • every line of a count gets a number, fixed when the count starts and
--     sorted by location then name — the same numbers on the paper and on
--     the screen;
--   • the count keeps when its sheet was printed and by whom, who counted on
--     paper, and a photo of the signed sheet;
--   • each counted figure keeps how it was entered (on the screen, from
--     paper, or later on Telegram);
--   • something found on the shelf that isn't on the list can be added to
--     the count while it is open.

-- ── 1. Columns ──────────────────────────────────────────────────────────
ALTER TABLE stock_count_lines
  ADD COLUMN IF NOT EXISTS line_no integer,
  ADD COLUMN IF NOT EXISTS entered_via text;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_count_lines_entered_via_check') THEN
    ALTER TABLE stock_count_lines ADD CONSTRAINT stock_count_lines_entered_via_check
      CHECK (entered_via IS NULL OR entered_via IN ('screen', 'paper', 'telegram'));
  END IF;
END $c$;

ALTER TABLE stock_counts
  ADD COLUMN IF NOT EXISTS sheet_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sheet_printed_by uuid,
  ADD COLUMN IF NOT EXISTS sheet_prints integer NOT NULL DEFAULT 0,
  -- The names written on the sheet: who counted, who checked.
  ADD COLUMN IF NOT EXISTS paper_counted_by text,
  ADD COLUMN IF NOT EXISTS paper_photo_path text;

-- Counts already started get their numbers the same way new ones will.
UPDATE stock_count_lines l SET line_no = x.n
FROM (SELECT cl.id, row_number() OVER (PARTITION BY cl.count_id
                                        ORDER BY si.warehouse_zone NULLS LAST, lower(si.item_name), cl.id) AS n
        FROM stock_count_lines cl JOIN stock_items si ON si.id = cl.stock_item_id) x
WHERE x.id = l.id AND l.line_no IS NULL;
-- Figures already counted were typed on the screen.
UPDATE stock_count_lines SET entered_via = 'screen' WHERE counted_qty IS NOT NULL AND entered_via IS NULL;

-- ── 2. Starting a count numbers its lines ───────────────────────────────
-- As before, with each line numbered by location then name.
CREATE OR REPLACE FUNCTION start_stock_count(p_zone text DEFAULT NULL::text, p_include_empty boolean DEFAULT false, p_notes text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may start a count'; END IF;
  INSERT INTO stock_counts (warehouse_zone, notes) VALUES (NULLIF(p_zone, ''), NULLIF(trim(p_notes), '')) RETURNING id INTO v_id;
  INSERT INTO stock_count_lines (count_id, stock_item_id, system_qty, unit_cost, line_no)
  SELECT v_id, u.id, COALESCE(u.qty_on_hand, 0), stock_item_avg_cost(u.id),
         row_number() OVER (ORDER BY si.warehouse_zone NULLS LAST, lower(si.item_name), si.id)
    FROM v_stock_item_usage u
    JOIN stock_items si ON si.id = u.id
   WHERE si.catalog_status <> 'inactive' AND NOT si.is_tool
     AND (NULLIF(p_zone, '') IS NULL OR si.warehouse_zone = p_zone)
     AND (p_include_empty OR COALESCE(u.qty_on_hand, 0) <> 0);
  RETURN v_id;
END $$;

-- ── 3. Found on the shelf, not on the list ──────────────────────────────
-- Adds an item to an open count, numbered after the last line, with what the
-- system says now. Returns its line number.
CREATE OR REPLACE FUNCTION stock_count_add_item(p_count_id uuid, p_item uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c stock_counts;
  v_no integer;
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may change a count'; END IF;
  SELECT * INTO c FROM stock_counts WHERE id = p_count_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Count not found'; END IF;
  IF c.status <> 'counting' THEN RAISE EXCEPTION 'This count is already %', c.status; END IF;
  SELECT line_no INTO v_no FROM stock_count_lines WHERE count_id = p_count_id AND stock_item_id = p_item;
  IF FOUND THEN RAISE EXCEPTION 'Already on this count, line %', v_no; END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_items WHERE id = p_item AND NOT is_tool) THEN RAISE EXCEPTION 'Stock item not found'; END IF;
  SELECT COALESCE(max(line_no), 0) + 1 INTO v_no FROM stock_count_lines WHERE count_id = p_count_id;
  INSERT INTO stock_count_lines (count_id, stock_item_id, system_qty, unit_cost, line_no)
  SELECT p_count_id, p_item, COALESCE((SELECT qty_on_hand FROM v_stock_item_usage WHERE id = p_item), 0), stock_item_avg_cost(p_item), v_no;
  RETURN v_no;
END $$;

REVOKE ALL ON FUNCTION stock_count_add_item(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stock_count_add_item(uuid, uuid) TO authenticated;

-- ── 4. The photo of the signed sheet ────────────────────────────────────
-- Kept with the other finance papers, under stock-counts/; whoever keeps
-- stock can put it there and look at it.
DO $s$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'stock_count_sheets_insert') THEN
    CREATE POLICY stock_count_sheets_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'finance-documents' AND name LIKE 'stock-counts/%' AND public.is_stock_keeper());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'stock_count_sheets_select') THEN
    CREATE POLICY stock_count_sheets_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'finance-documents' AND name LIKE 'stock-counts/%' AND public.is_stock_keeper());
  END IF;
END $s$;

-- The photo often comes after the count is posted, when a posted count can
-- no longer be edited; keeping it is allowed at any time.
CREATE OR REPLACE FUNCTION stock_count_keep_sheet_photo(p_count_id uuid, p_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may keep the sheet'; END IF;
  IF p_path IS NULL OR p_path NOT LIKE 'stock-counts/%' THEN RAISE EXCEPTION 'Not a count sheet'; END IF;
  UPDATE stock_counts SET paper_photo_path = p_path WHERE id = p_count_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found'; END IF;
END $$;

REVOKE ALL ON FUNCTION stock_count_keep_sheet_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stock_count_keep_sheet_photo(uuid, text) TO authenticated;
