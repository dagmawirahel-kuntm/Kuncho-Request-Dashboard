-- 364 — Stock: counts, issuing to a project, reversals instead of deletes
--
-- 1. Reversals. A stock movement is corrected by an opposite entry, never
--    deleted: reverse_stock_movement() adds the same line with the quantity
--    negated (same destination, project and price, so warehouse stock,
--    site deliveries, project costs and the weighted average cost all net
--    back exactly) and stamps the original with who reversed it and why.
--    Deleting a movement straight from the app is refused; the functions
--    that legitimately remove one (undoing a GRN) run as the owner and are
--    unaffected. A GRN receipt is undone from its purchase order instead.
-- 2. Stock counts. start_stock_count() freezes what the system says is in
--    the warehouse (for a zone, or everything); people enter what they
--    counted; post_stock_count() books each difference as an adjustment
--    (in at the average cost, or out) and closes the count.
-- 3. issue_stock_to_project() issues several items to a project in one go,
--    at the average cost, refusing more than the warehouse holds unless
--    told otherwise.

SET search_path TO public;

CREATE OR REPLACE FUNCTION is_stock_keeper() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'executive', 'stock_manager', 'procurement_officer'), false);
$$;

-- ── 1. Reversals ───────────────────────────────────────────────────────────
ALTER TABLE stock_receipts
  ADD COLUMN IF NOT EXISTS reversal_of uuid REFERENCES stock_receipts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reverse_reason text;
ALTER TABLE stock_issues
  ADD COLUMN IF NOT EXISTS reversal_of uuid REFERENCES stock_issues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reverse_reason text;

CREATE OR REPLACE FUNCTION reverse_stock_movement(p_kind text, p_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r stock_receipts%ROWTYPE; i stock_issues%ROWTYPE; v_new uuid; v_note text;
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may reverse a stock movement'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why it is being reversed'; END IF;

  IF p_kind = 'receipt' THEN
    SELECT * INTO r FROM stock_receipts WHERE id = p_id FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Receipt not found'; END IF;
    IF r.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'This is itself a reversal'; END IF;
    IF r.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Already reversed on %', to_char(r.reversed_at, 'DD Mon YYYY'); END IF;
    IF r.grn_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'This came from a goods received note — undo it from its purchase order';
    END IF;
    v_note := 'Reversal: ' || trim(p_reason);
    INSERT INTO stock_receipts (stock_item_id, quantity, unit_price, receipt_type, destination, warehouse_zone,
                                project_id, received_date, notes, reversal_of)
    VALUES (r.stock_item_id, -r.quantity, r.unit_price, r.receipt_type, r.destination, r.warehouse_zone,
            r.project_id, CURRENT_DATE, v_note, r.id)
    RETURNING id INTO v_new;
    UPDATE stock_receipts SET reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason) WHERE id = r.id;

  ELSIF p_kind = 'issue' THEN
    SELECT * INTO i FROM stock_issues WHERE id = p_id FOR UPDATE;
    IF i.id IS NULL THEN RAISE EXCEPTION 'Issue not found'; END IF;
    IF i.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'This is itself a reversal'; END IF;
    IF i.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Already reversed on %', to_char(i.reversed_at, 'DD Mon YYYY'); END IF;
    v_note := 'Reversal: ' || trim(p_reason);
    INSERT INTO stock_issues (stock_item_id, quantity, issue_type, project_id, issued_to_staff_id, order_item_id,
                              issued_date, notes, unit_cost_snapshot, total_cost, reversal_of)
    VALUES (i.stock_item_id, -i.quantity, i.issue_type, i.project_id, i.issued_to_staff_id, i.order_item_id,
            CURRENT_DATE, v_note, i.unit_cost_snapshot, -COALESCE(i.total_cost, 0), i.id)
    RETURNING id INTO v_new;
    UPDATE stock_issues SET reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason) WHERE id = i.id;
  ELSE
    RAISE EXCEPTION 'Kind must be receipt or issue';
  END IF;
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION refuse_stock_movement_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Stock movements are not deleted — reverse it instead, so the history stays';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_refuse_receipt_delete ON stock_receipts;
CREATE TRIGGER trg_refuse_receipt_delete BEFORE DELETE ON stock_receipts FOR EACH ROW EXECUTE FUNCTION refuse_stock_movement_delete();
DROP TRIGGER IF EXISTS trg_refuse_issue_delete ON stock_issues;
CREATE TRIGGER trg_refuse_issue_delete BEFORE DELETE ON stock_issues FOR EACH ROW EXECUTE FUNCTION refuse_stock_movement_delete();

-- ── 2. Stock counts ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS stock_count_seq;

CREATE TABLE IF NOT EXISTS stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL DEFAULT ('SC-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('stock_count_seq')::text, 3, '0')),
  warehouse_zone text,
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'posted', 'cancelled')),
  count_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  started_by uuid DEFAULT auth.uid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid,
  posted_at timestamptz
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  stock_item_id uuid NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  system_qty numeric NOT NULL,
  counted_qty numeric CHECK (counted_qty IS NULL OR counted_qty >= 0),
  unit_cost numeric,
  note text,
  counted_at timestamptz,
  counted_by uuid,
  UNIQUE (count_id, stock_item_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count ON stock_count_lines(count_id);

ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_counts_read ON stock_counts;
CREATE POLICY stock_counts_read ON stock_counts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS stock_counts_write ON stock_counts;
CREATE POLICY stock_counts_write ON stock_counts FOR UPDATE TO authenticated USING (is_stock_keeper() AND status = 'counting') WITH CHECK (is_stock_keeper());
DROP POLICY IF EXISTS stock_count_lines_read ON stock_count_lines;
CREATE POLICY stock_count_lines_read ON stock_count_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS stock_count_lines_write ON stock_count_lines;
CREATE POLICY stock_count_lines_write ON stock_count_lines FOR UPDATE TO authenticated
  USING (is_stock_keeper() AND EXISTS (SELECT 1 FROM stock_counts c WHERE c.id = count_id AND c.status = 'counting'))
  WITH CHECK (is_stock_keeper());
GRANT SELECT, UPDATE ON stock_counts, stock_count_lines TO authenticated;

CREATE OR REPLACE FUNCTION start_stock_count(p_zone text DEFAULT NULL, p_include_empty boolean DEFAULT false, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may start a count'; END IF;
  INSERT INTO stock_counts (warehouse_zone, notes) VALUES (NULLIF(p_zone, ''), NULLIF(trim(p_notes), '')) RETURNING id INTO v_id;
  INSERT INTO stock_count_lines (count_id, stock_item_id, system_qty, unit_cost)
  SELECT v_id, u.id, COALESCE(u.qty_on_hand, 0), stock_item_avg_cost(u.id)
    FROM v_stock_item_usage u
    JOIN stock_items si ON si.id = u.id
   WHERE si.catalog_status <> 'inactive' AND NOT si.is_tool
     AND (NULLIF(p_zone, '') IS NULL OR si.warehouse_zone = p_zone)
     AND (p_include_empty OR COALESCE(u.qty_on_hand, 0) <> 0);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION post_stock_count(p_count_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c stock_counts%ROWTYPE; l record; v_n int := 0; v_diff numeric; v_note text;
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may post a count'; END IF;
  SELECT * INTO c FROM stock_counts WHERE id = p_count_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Count not found'; END IF;
  IF c.status <> 'counting' THEN RAISE EXCEPTION 'This count is already %', c.status; END IF;
  v_note := 'Stock count ' || c.code;
  FOR l IN SELECT * FROM stock_count_lines WHERE count_id = p_count_id AND counted_qty IS NOT NULL AND counted_qty <> system_qty LOOP
    v_diff := l.counted_qty - l.system_qty;
    IF v_diff > 0 THEN
      INSERT INTO stock_receipts (stock_item_id, quantity, unit_price, receipt_type, destination, received_date, notes)
      VALUES (l.stock_item_id, v_diff, l.unit_cost, 'adjustment', 'warehouse', c.count_date, v_note || COALESCE(' — ' || l.note, ''));
    ELSE
      INSERT INTO stock_issues (stock_item_id, quantity, issue_type, issued_date, notes, unit_cost_snapshot, total_cost)
      VALUES (l.stock_item_id, -v_diff, 'adjustment', c.count_date, v_note || COALESCE(' — ' || l.note, ''), l.unit_cost, -v_diff * COALESCE(l.unit_cost, 0));
    END IF;
    v_n := v_n + 1;
  END LOOP;
  UPDATE stock_counts SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = p_count_id;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION cancel_stock_count(p_count_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may cancel a count'; END IF;
  UPDATE stock_counts SET status = 'cancelled' WHERE id = p_count_id AND status = 'counting';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a count in progress can be cancelled'; END IF;
END $$;

-- ── 3. Issuing to a project ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION issue_stock_to_project(
  p_project_id uuid, p_lines jsonb, p_issue_date date DEFAULT CURRENT_DATE,
  p_issued_to_staff_id uuid DEFAULT NULL, p_notes text DEFAULT NULL, p_allow_short boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; v_have numeric; v_cost numeric; v_n int := 0; v_issuer uuid; v_name text;
BEGIN
  IF NOT is_stock_keeper() THEN RAISE EXCEPTION 'Only stock, procurement, executive or admin may issue stock'; END IF;
  IF p_project_id IS NULL THEN RAISE EXCEPTION 'Choose the project it is going to'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'Add at least one item'; END IF;
  SELECT current_staff_id() INTO v_issuer;

  FOR l IN SELECT (e->>'stock_item_id')::uuid AS item, (e->>'quantity')::numeric AS qty, NULLIF(e->>'order_item_id', '')::uuid AS oi
             FROM jsonb_array_elements(p_lines) e LOOP
    IF l.qty IS NULL OR l.qty <= 0 THEN RAISE EXCEPTION 'Every line needs a quantity above zero'; END IF;
    SELECT u.qty_on_hand, u.item_name INTO v_have, v_name FROM v_stock_item_usage u WHERE u.id = l.item;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown stock item %', l.item; END IF;
    IF NOT p_allow_short AND l.qty > COALESCE(v_have, 0) THEN
      RAISE EXCEPTION '% — only % in the warehouse, % asked for', v_name, COALESCE(v_have, 0), l.qty;
    END IF;
    v_cost := stock_item_avg_cost(l.item);
    INSERT INTO stock_issues (stock_item_id, quantity, issue_type, project_id, issued_to_staff_id, issued_by_staff_id,
                              order_item_id, issued_date, notes, unit_cost_snapshot, total_cost)
    VALUES (l.item, l.qty, 'project_use', p_project_id, p_issued_to_staff_id, v_issuer,
            l.oi, COALESCE(p_issue_date, CURRENT_DATE), NULLIF(trim(p_notes), ''), v_cost, l.qty * COALESCE(v_cost, 0));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION reverse_stock_movement(text, uuid, text), start_stock_count(text, boolean, text), post_stock_count(uuid),
  cancel_stock_count(uuid), issue_stock_to_project(uuid, jsonb, date, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reverse_stock_movement(text, uuid, text), start_stock_count(text, boolean, text), post_stock_count(uuid),
  cancel_stock_count(uuid), issue_stock_to_project(uuid, jsonb, date, uuid, text, boolean), is_stock_keeper() TO authenticated;
