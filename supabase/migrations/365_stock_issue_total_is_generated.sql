-- 365 — stock_issues.total_cost is generated (quantity x unit cost)
--
-- The functions in 364 wrote total_cost themselves, which the database
-- refuses for a generated column. They now set the unit cost and let the
-- total follow, negative for a reversal like its quantity.

SET search_path TO public;

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
                              issued_date, notes, unit_cost_snapshot, reversal_of)
    VALUES (i.stock_item_id, -i.quantity, i.issue_type, i.project_id, i.issued_to_staff_id, i.order_item_id,
            CURRENT_DATE, v_note, i.unit_cost_snapshot, i.id)
    RETURNING id INTO v_new;
    UPDATE stock_issues SET reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason) WHERE id = i.id;
  ELSE
    RAISE EXCEPTION 'Kind must be receipt or issue';
  END IF;
  RETURN v_new;
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
      INSERT INTO stock_issues (stock_item_id, quantity, issue_type, issued_date, notes, unit_cost_snapshot)
      VALUES (l.stock_item_id, -v_diff, 'adjustment', c.count_date, v_note || COALESCE(' — ' || l.note, ''), l.unit_cost);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  UPDATE stock_counts SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = p_count_id;
  RETURN v_n;
END $$;

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
                              order_item_id, issued_date, notes, unit_cost_snapshot)
    VALUES (l.item, l.qty, 'project_use', p_project_id, p_issued_to_staff_id, v_issuer,
            l.oi, COALESCE(p_issue_date, CURRENT_DATE), NULLIF(trim(p_notes), ''), v_cost);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
