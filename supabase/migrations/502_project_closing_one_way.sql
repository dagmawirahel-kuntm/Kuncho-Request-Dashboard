-- 502: one way to close a project.
--
-- Until now a project was "closed" by unticking Active for year on its form,
-- which hid it from the lists and nothing else: expenses kept landing on
-- switched-off projects, and Close costing (491) only locked labour and
-- fixtures. Now the Closing tab is the one way:
--   · Close costing also refuses new costs on the project: expenses, purchase
--     requests and their items, purchase-order lines and stock issues. Paying
--     costs already approved still works (payment requests, bank matching),
--     and so does receiving the client's money (sales are not touched);
--   · it can't close while costs wait for approval, requested items are still
--     to buy, or a purchase order is not ordered yet (new blockers);
--   · money still to settle (approved costs not paid, client money not in) is
--     listed before closing, without blocking it;
--   · a project that never went ahead closes without delivery, with a reason;
--   · closing takes the project off the active lists, reopening puts it back,
--     and Active for year can no longer be switched off by hand on a client
--     project (internal cost buckets keep the switch and are never closed);
--   · project_close_review() lists the client projects switched off the old
--     way, for finance to close, reactivate or mark as cost buckets.

-- ── Is costing closed on this project? Its name if so. ─────────────────────
CREATE OR REPLACE FUNCTION public.project_costing_closed_name(p_project uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE(NULLIF(btrim(project_name), ''), 'this project') FROM projects
   WHERE id = p_project AND costing_closed_at IS NOT NULL;
$f$;

CREATE OR REPLACE FUNCTION public.costing_closed_refusal(p_name text, p_what text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT format('Costing on %s is closed, so %s can''t go on it. Finance reopens costing from the project''s Closing tab if it must.', p_name, p_what);
$f$;

-- ── New costs on a closed project are refused ──────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_expense_on_closed_project()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE v_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    -- Not new costs: a split of a cost already there, a purchase order's bill
    -- (its lines were checked when they went on the PO), and labour pay
    -- (labour itself is locked by Close costing and confirmed before it).
    IF NEW.split_parent_id IS NOT NULL OR NEW.sourcing_bundle_id IS NOT NULL
       OR (NEW.expense_type::text = 'labor_payment' AND (NEW.paid_to_staff_id IS NOT NULL OR NEW.rollup_period_start IS NOT NULL
                                                         OR NEW.rolled_up_from_requisition_id IS NOT NULL)) THEN
      RETURN NEW;
    END IF;
  END IF;
  v_name := project_costing_closed_name(NEW.project_id);
  IF v_name IS NOT NULL THEN RAISE EXCEPTION '%', costing_closed_refusal(v_name, 'a new expense'); END IF;
  IF TG_OP = 'UPDATE' THEN
    v_name := project_costing_closed_name(OLD.project_id);
    IF v_name IS NOT NULL THEN
      RAISE EXCEPTION 'Costing on % is closed, so its expenses can''t move to another project. Finance reopens costing from the project''s Closing tab if it must.', v_name;
    END IF;
  END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE TRIGGER trg_a_expense_on_closed_project
  BEFORE INSERT OR UPDATE OF project_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION trg_expense_on_closed_project();

CREATE OR REPLACE FUNCTION public.trg_order_on_closed_project()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE v_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NEW; END IF;
  v_name := project_costing_closed_name(NEW.project_id);
  IF v_name IS NOT NULL THEN RAISE EXCEPTION '%', costing_closed_refusal(v_name, 'a new purchase request'); END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE TRIGGER trg_a_order_on_closed_project
  BEFORE INSERT OR UPDATE OF project_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION trg_order_on_closed_project();

CREATE OR REPLACE FUNCTION public.trg_order_item_on_closed_project()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE v_name text;
BEGIN
  v_name := project_costing_closed_name((SELECT o.project_id FROM orders o WHERE o.id = NEW.order_id));
  IF v_name IS NOT NULL THEN RAISE EXCEPTION '%', costing_closed_refusal(v_name, 'more items'); END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE TRIGGER trg_a_order_item_on_closed_project
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION trg_order_item_on_closed_project();

CREATE OR REPLACE FUNCTION public.trg_po_line_on_closed_project()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE v_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id THEN RETURN NEW; END IF;
  v_name := project_costing_closed_name((SELECT o.project_id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = NEW.order_item_id));
  IF v_name IS NOT NULL THEN RAISE EXCEPTION '%', costing_closed_refusal(v_name, 'a purchase-order line for it'); END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE TRIGGER trg_a_po_line_on_closed_project
  BEFORE INSERT OR UPDATE OF order_item_id ON public.sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION trg_po_line_on_closed_project();

CREATE OR REPLACE FUNCTION public.trg_stock_issue_on_closed_project()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE v_name text;
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;  -- undoing an issue
  IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NEW; END IF;
  v_name := project_costing_closed_name(NEW.project_id);
  IF v_name IS NOT NULL THEN RAISE EXCEPTION '%', costing_closed_refusal(v_name, 'stock issued to it'); END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE TRIGGER trg_a_stock_issue_on_closed_project
  BEFORE INSERT OR UPDATE OF project_id ON public.stock_issues
  FOR EACH ROW EXECUTE FUNCTION trg_stock_issue_on_closed_project();

-- ── What must be cleared before costing closes ─────────────────────────────
CREATE OR REPLACE FUNCTION public.project_costing_blockers(p_project uuid)
RETURNS TABLE(kind text, label text, n integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT * FROM (
    SELECT 'not_delivered', 'Not marked delivered yet', 1
     WHERE (SELECT delivered_at FROM projects WHERE id = p_project) IS NULL
    UNION ALL
    SELECT 'fixtures_out', 'Fixtures not back yet', count(*)::int FROM project_fixture_status(p_project) s WHERE s.still_out > 0 HAVING count(*) > 0
    UNION ALL
    SELECT 'awaiting_inspection', 'Returns waiting for inspection', count(*)::int
      FROM fixture_checks c WHERE c.project_id = p_project AND c.kind = 'return' AND c.status = 'received' HAVING count(*) > 0
    UNION ALL
    SELECT 'open_work_orders', 'Work orders still open (repairs included)', count(*)::int
      FROM work_orders w WHERE w.project_id = p_project AND w.status IN ('requested', 'in_progress') HAVING count(*) > 0
    UNION ALL
    SELECT 'days_not_locked', 'Day sheets with labour here not locked yet', count(DISTINCT d.id)::int
      FROM labour_days d JOIN labour_day_allocations a ON a.day_id = d.id
     WHERE a.project_id = p_project AND d.status <> 'locked' HAVING count(DISTINCT d.id) > 0
    UNION ALL
    SELECT 'labour_unconfirmed', 'Labour recorded but not confirmed for pay', count(*)::int FROM (
        SELECT e.id FROM labour_work_entries e WHERE e.project_id = p_project AND e.pay_sheet_id IS NULL
        UNION ALL
        SELECT a.id FROM labour_day_allocations a JOIN labour_days d ON d.id = a.day_id
          JOIN labour_day_workers w ON w.day_id = a.day_id AND w.staff_id = a.staff_id
         WHERE a.project_id = p_project AND d.status = 'locked' AND w.pay_run_id IS NULL) x HAVING count(*) > 0
    UNION ALL
    SELECT 'damage_undecided', 'Damage charges waiting for finance', count(*)::int
      FROM project_damage_charges g WHERE g.project_id = p_project AND g.status = 'raised' HAVING count(*) > 0
    UNION ALL
    -- 502: the costs themselves.
    SELECT 'costs_waiting', 'Expenses waiting for approval: approve or reject them', count(*)::int
      FROM expenses e WHERE e.project_id = p_project AND e.approval_status IN ('pending', 'manager_approved')
       AND COALESCE(e.payment_state, '') <> 'void' AND NOT COALESCE(e.is_archived, false) HAVING count(*) > 0
    UNION ALL
    SELECT 'items_to_buy', 'Requested items not bought yet: buy or cancel them', count(*)::int
      FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.project_id = p_project AND NOT COALESCE(o.is_archived, false) AND o.approval_status::text <> 'rejected'
       AND i.status::text IN ('pending', 'partially_sourced', 'stock_pending_dispatch') HAVING count(*) > 0
    UNION ALL
    SELECT 'pos_not_ordered', 'Purchase orders not ordered yet: order or cancel them', count(DISTINCT b.id)::int
      FROM sourcing_bundles b JOIN sourcing_bundle_items s ON s.bundle_id = b.id
      JOIN order_items i ON i.id = s.order_item_id JOIN orders o ON o.id = i.order_id
     WHERE o.project_id = p_project AND b.status::text IN ('drafting', 'submitted', 'approved') HAVING count(DISTINCT b.id) > 0
  ) b(kind, label, n);
$f$;

-- ── Money still to settle: shown before closing, never blocks it ───────────
-- Counts for whoever sees the Closing tab; amounts for admin, finance and
-- executives only.
CREATE OR REPLACE FUNCTION public.project_money_to_settle(p_project uuid)
RETURNS TABLE(kind text, label text, n integer, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT m.kind, m.label, m.n,
         CASE WHEN COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false) THEN m.amount END
    FROM (
    SELECT 'to_pay', 'Approved costs not paid yet', count(*)::int,
           sum(GREATEST(e.amount_etb - COALESCE(e.paid_to_date_etb, 0), 0))
      FROM expenses e WHERE e.project_id = p_project AND e.approval_status = 'finance_approved'
       AND COALESCE(e.payment_state, 'unpaid') NOT IN ('paid', 'advance', 'void') AND NOT COALESCE(e.is_archived, false)
    HAVING count(*) > 0
    UNION ALL
    SELECT 'to_receive', 'Client money not received yet (draft or invoiced sales)', count(*)::int,
           sum(GREATEST(s.amount - COALESCE(s.amount_received, 0) - COALESCE(s.withheld_by_client, 0), 0))
      FROM sales s WHERE s.project_id = p_project AND s.sales_status::text IN ('Draft', 'Invoiced') AND NOT COALESCE(s.is_archived, false)
    HAVING count(*) > 0
    UNION ALL
    SELECT 'requests_issued', 'Payment requests sent to the client, not invoiced yet', count(*)::int, sum(c.amount)
      FROM client_payment_requests c WHERE c.project_id = p_project AND c.status = 'issued'
    HAVING count(*) > 0
    UNION ALL
    SELECT 'charges_to_invoice', 'Damage charges approved, not invoiced yet', count(*)::int, sum(g.amount)
      FROM project_damage_charges g WHERE g.project_id = p_project AND g.status = 'approved'
    HAVING count(*) > 0
  ) m(kind, label, n, amount)
   WHERE project_can_see_closing(p_project);
$f$;

-- ── Closing: delivered, recorded as delivered now, or never went ahead ─────
-- p_delivered NULL: it must already be marked delivered (Close costing).
-- true: finance records the delivery now if the PM never did (old projects).
-- false: it never went ahead; the reason is required.
CREATE OR REPLACE FUNCTION public.project_close_out(p_project uuid, p_delivered boolean DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v_block text; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
        v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF NOT project_can_close_costing() THEN RAISE EXCEPTION 'Finance closes costing'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF p.is_internal THEN RAISE EXCEPTION '% is an internal cost bucket: it stays open and is never closed', btrim(p.project_name); END IF;
  IF p.costing_closed_at IS NOT NULL THEN RAISE EXCEPTION 'Costing is already closed'; END IF;
  IF p.delivered_at IS NULL AND p_delivered IS NULL THEN RAISE EXCEPTION 'Not yet: Not marked delivered yet'; END IF;
  IF p.delivered_at IS NOT NULL AND p_delivered = false THEN RAISE EXCEPTION 'It is marked delivered: close costing instead'; END IF;
  IF p.delivered_at IS NULL AND p_delivered = false AND v_note IS NULL THEN RAISE EXCEPTION 'Say why it never went ahead'; END IF;

  SELECT string_agg(b.label || ' (' || b.n || ')', '; ') INTO v_block
    FROM project_costing_blockers(p_project) b WHERE b.kind <> 'not_delivered';
  IF v_block IS NOT NULL THEN RAISE EXCEPTION 'Not yet: %', v_block; END IF;

  PERFORM set_config('kuncho.lifecycle', 'on', true);
  IF p.delivered_at IS NULL AND p_delivered THEN
    UPDATE projects SET delivered_at = now(), delivered_by = auth.uid(), delivered_by_name = v_name WHERE id = p_project;
    INSERT INTO project_lifecycle_events (project_id, kind, note, by_user, by_name)
    VALUES (p_project, 'delivered', 'Recorded by finance at closing', auth.uid(), v_name);
  END IF;
  UPDATE projects SET costing_closed_at = now(), costing_closed_by = auth.uid(), costing_closed_by_name = v_name,
                      active_for_year = false
   WHERE id = p_project;
  PERFORM set_config('kuncho.lifecycle', 'off', true);
  INSERT INTO project_lifecycle_events (project_id, kind, note, by_user, by_name)
  VALUES (p_project, 'costing_closed',
          CASE WHEN p.delivered_at IS NULL AND p_delivered = false THEN 'Closed without delivery: ' || v_note ELSE v_note END,
          auth.uid(), v_name);
END $f$;

CREATE OR REPLACE FUNCTION public.project_close_costing(p_project uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  PERFORM project_close_out(p_project, NULL, p_note);
END $f$;

CREATE OR REPLACE FUNCTION public.project_reopen_costing(p_project uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT project_can_close_costing() THEN RAISE EXCEPTION 'Finance reopens costing'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why costing reopens'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project FOR UPDATE;
  IF p.costing_closed_at IS NULL THEN RAISE EXCEPTION 'Costing isn''t closed'; END IF;
  PERFORM set_config('kuncho.lifecycle', 'on', true);
  UPDATE projects SET costing_closed_at = NULL, costing_closed_by = NULL, costing_closed_by_name = NULL, active_for_year = true
   WHERE id = p_project;
  PERFORM set_config('kuncho.lifecycle', 'off', true);
  INSERT INTO project_lifecycle_events (project_id, kind, note, by_user, by_name) VALUES (p_project, 'costing_reopened', btrim(p_reason), auth.uid(), v_name);
END $f$;

-- ── Active for year follows the closing on client projects ─────────────────
CREATE OR REPLACE FUNCTION public.trg_project_active_follows_closing()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.active_for_year IS NOT DISTINCT FROM OLD.active_for_year OR NEW.is_internal
     OR COALESCE(current_setting('kuncho.lifecycle', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NOT NEW.active_for_year THEN
    RAISE EXCEPTION 'Close % from its Closing tab: closing is what takes a project off the active lists', btrim(NEW.project_name);
  END IF;
  IF NEW.costing_closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Costing on % is closed: finance reopens it from the Closing tab, which makes it active again', btrim(NEW.project_name);
  END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE TRIGGER trg_project_active_follows_closing
  BEFORE UPDATE OF active_for_year ON public.projects
  FOR EACH ROW EXECUTE FUNCTION trg_project_active_follows_closing();

-- ── The Closing tab's data ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_closing(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v jsonb; v_days int := (SELECT costing_open_days FROM labour_day_settings WHERE id);
BEGIN
  IF NOT project_can_see_closing(p_project) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project;
  SELECT jsonb_build_object(
    'stage', CASE WHEN p.costing_closed_at IS NOT NULL THEN 'closed' WHEN p.delivered_at IS NOT NULL THEN 'delivered' ELSE 'active' END,
    'is_internal', p.is_internal, 'active_for_year', p.active_for_year,
    'delivered_at', p.delivered_at, 'delivered_by_name', p.delivered_by_name,
    'costing_closed_at', p.costing_closed_at, 'costing_closed_by_name', p.costing_closed_by_name,
    'closed_undelivered', p.costing_closed_at IS NOT NULL AND p.delivered_at IS NULL,
    'costing_open_days', v_days,
    'open_for_days', CASE WHEN p.delivered_at IS NOT NULL AND p.costing_closed_at IS NULL THEN (bot_today() - (p.delivered_at AT TIME ZONE 'Africa/Addis_Ababa')::date) END,
    'damage_chargeable', p.damage_chargeable, 'damage_terms', p.damage_terms,
    'can_deliver', project_can_deliver(p_project), 'can_close', project_can_close_costing(), 'can_inspect', fixture_inspector(p_project),
    'can_set_terms', manages_project(p_project) OR COALESCE(get_user_role()::text IN ('admin', 'finance', 'sales', 'executive'), false),
    'blockers', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', b.kind, 'label', b.label, 'n', b.n)) FROM project_costing_blockers(p_project) b), '[]'::jsonb),
    'settle', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', m.kind, 'label', m.label, 'n', m.n, 'amount', m.amount))
                          FROM project_money_to_settle(p_project) m), '[]'::jsonb),
    'fixtures', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM project_fixture_status(p_project) s), '[]'::jsonb),
    'checks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'kind', c.kind, 'status', c.status, 'note', c.note,
                  'checked_by_name', c.checked_by_name, 'checked_at', c.checked_at, 'inspected_by_name', c.inspected_by_name, 'inspected_at', c.inspected_at,
                  'photos', c.photos,
                  'lines', (SELECT jsonb_agg(jsonb_build_object('fixture_id', l.fixture_id, 'name', f.name, 'unit', f.unit, 'quantity', l.quantity,
                              'ok_qty', l.ok_qty, 'damaged_qty', l.damaged_qty, 'missing_qty', l.missing_qty, 'checklist', l.checklist, 'photos', l.photos, 'note', l.note,
                              'repair', (SELECT jsonb_build_object('id', w.id, 'status', w.status) FROM work_orders w
                                          WHERE w.repair_of_check_id = c.id AND w.repair_fixture_id = l.fixture_id ORDER BY w.created_at DESC LIMIT 1)) ORDER BY f.sort_order, f.name)
                              FROM fixture_check_lines l JOIN project_fixtures f ON f.id = l.fixture_id WHERE l.check_id = c.id))
                  ORDER BY c.checked_at DESC) FROM fixture_checks c WHERE c.project_id = p_project), '[]'::jsonb),
    'charges', COALESCE((SELECT jsonb_agg(to_jsonb(g) || jsonb_build_object('fixture', (SELECT name FROM project_fixtures WHERE id = g.fixture_id)) ORDER BY g.raised_at DESC)
                           FROM project_damage_charges g WHERE g.project_id = p_project), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.at DESC) FROM project_lifecycle_events e WHERE e.project_id = p_project), '[]'::jsonb))
  INTO v;
  RETURN v;
END $f$;

-- ── The one-time review: client projects switched off the old way ──────────
CREATE OR REPLACE FUNCTION public.project_close_review()
RETURNS TABLE(id uuid, project_name text, client_name text, start_date date, delivered_at timestamptz,
              last_activity date, n_costs integer, cost numeric, blockers jsonb, settle jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p.id, btrim(p.project_name), c.client_name, p.start_date, p.delivered_at,
         GREATEST((SELECT max(e.date) FROM expenses e WHERE e.project_id = p.id),
                  (SELECT max(s.date) FROM sales s WHERE s.project_id = p.id),
                  (SELECT max(o.order_date) FROM orders o WHERE o.project_id = p.id)),
         (SELECT count(*)::int FROM expenses e WHERE e.project_id = p.id AND NOT COALESCE(e.is_archived, false)
             AND e.approval_status::text <> 'rejected' AND COALESCE(e.payment_state, '') <> 'void'),
         (SELECT sum(e.amount_etb) FROM expenses e WHERE e.project_id = p.id AND NOT COALESCE(e.is_archived, false)
             AND e.approval_status::text <> 'rejected' AND COALESCE(e.payment_state, '') <> 'void'),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', b.kind, 'label', b.label, 'n', b.n))
                     FROM project_costing_blockers(p.id) b WHERE b.kind <> 'not_delivered'), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', m.kind, 'label', m.label, 'n', m.n, 'amount', m.amount))
                     FROM project_money_to_settle(p.id) m), '[]'::jsonb)
    FROM projects p LEFT JOIN clients c ON c.id = p.client_id
   WHERE NOT p.active_for_year AND NOT p.is_internal AND p.costing_closed_at IS NULL
     AND COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false)
   ORDER BY 6 DESC NULLS LAST, 2;
$f$;

-- Review actions other than closing: back on the active lists, or a cost bucket.
CREATE OR REPLACE FUNCTION public.project_review_keep(p_project uuid, p_as text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT project_can_close_costing() THEN RAISE EXCEPTION 'Finance reviews closed projects'; END IF;
  IF p_as = 'active' THEN
    UPDATE projects SET active_for_year = true WHERE id = p_project AND costing_closed_at IS NULL;
  ELSIF p_as = 'internal' THEN
    UPDATE projects SET is_internal = true WHERE id = p_project AND costing_closed_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Keep it as active or internal';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found, or its costing is closed'; END IF;
END $f$;

GRANT EXECUTE ON FUNCTION public.project_close_out(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_close_review() TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_review_keep(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_costing_closed_name(uuid) TO authenticated;
