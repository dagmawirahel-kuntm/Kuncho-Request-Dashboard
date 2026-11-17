-- 527 — Cost watch: where each project's money is heading, by cost group
--
-- One page that ranks the projects by how much new cost is heading into
-- them, and shows for each of their cost groups (Materials, Labor,
-- Subcontract, Transport, Overhead) how much is on each step of the way:
--
--   requested  a purchase request not yet on a PO, or a PO not yet placed
--   ordered    a PO placed, or a bill waiting for approval
--   approved   approved to pay, not paid yet (sent to the bank included)
--   paid       paid, or paid in advance
--
-- Every shilling is in one place only: a PO line follows its PO and then
-- the PO's payment; a request line counts only the part not yet on a PO;
-- a bill counts only when it has no PO behind it. The cost group comes from
-- the item's ledger (521), else the request line's, else the PO's payment;
-- goods with none are Materials. A bill's comes from its ledger; an expense
-- ledger with no group is Overhead, as in v_project_cost_group_budget.
-- Bills booked to an asset, liability or equity account (equipment, bonds,
-- loans, advances, personal withdrawals) are not project cost and are left out.
--
--   cost_watch(days)               per project and cost group: each step,
--                                  what came in during the last `days` and
--                                  the `days` before, and what the project
--                                  is worth where that is known
--   cost_watch_trend(project, w)   per week and cost group, what came in
--   cost_watch_moves(limit, proj)  the latest steps in the last 60 days:
--                                  requested, PO approved, ordered, billed,
--                                  approved to pay, paid, with the amount
--                                  that is still on its way or spent
--
-- Admin, executive, finance and operations see every project; a project
-- manager sees their own.

CREATE INDEX IF NOT EXISTS sbi_order_item ON public.sourcing_bundle_items (order_item_id);
CREATE INDEX IF NOT EXISTS expenses_project ON public.expenses (project_id) WHERE project_id IS NOT NULL;

-- What a request line is likely to cost: its estimate, else the last price
-- paid for the same item. Hardly anyone types an estimate (259 of 264 open
-- lines had none), so the last price is what usually counts. A quantity 20
-- times past the most ever bought at once is taken for a typing slip and
-- left unpriced (one line had the ETB total typed as its quantity).
CREATE OR REPLACE FUNCTION public.cost_watch_line_value(p_order_item uuid, p_qty numeric)
RETURNS TABLE(amount numeric, price_from text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT CASE WHEN COALESCE(oi.unit_price_est, 0) > 0 THEN p_qty * oi.unit_price_est
              WHEN lp.price > 0 AND p_qty <= 20 * GREATEST(lp.max_qty, 1) THEN p_qty * lp.price
              ELSE 0 END,
         CASE WHEN COALESCE(oi.unit_price_est, 0) > 0 THEN 'estimate'
              WHEN lp.price > 0 AND p_qty <= 20 * GREATEST(lp.max_qty, 1) THEN 'last_price'
              ELSE 'none' END
    FROM order_items oi
    LEFT JOIN LATERAL (
      SELECT (array_agg(sbi.unit_price_actual ORDER BY sb.created_at DESC))[1] AS price, max(sbi.quantity_actual) AS max_qty
        FROM sourcing_bundle_items sbi
        JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id AND sb.status IN ('approved', 'ordered', 'fulfilled')
        JOIN order_items o2 ON o2.id = sbi.order_item_id
       WHERE oi.stock_item_id IS NOT NULL AND o2.stock_item_id = oi.stock_item_id AND sbi.unit_price_actual > 0) lp ON true
   WHERE oi.id = p_order_item
$f$;
REVOKE EXECUTE ON FUNCTION public.cost_watch_line_value(uuid, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cost_watch_items()
RETURNS TABLE(project_id uuid, cost_group_id uuid, amount numeric, stage text, started_at timestamptz,
              source text, source_id uuid, label text, unpriced boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH grp AS (
    SELECT (SELECT id FROM cost_groups WHERE name = 'Materials') AS materials,
           (SELECT id FROM cost_groups WHERE name = 'Overhead') AS overhead
  ), proj AS (
    SELECT p.id FROM projects p
     WHERE NOT COALESCE(p.is_internal, false) AND p.costing_closed_at IS NULL
  ), line_group AS (
    SELECT oi.id AS order_item_id, COALESCE(c1.cost_group_id, c2.cost_group_id) AS cost_group_id
      FROM order_items oi
      LEFT JOIN stock_items si ON si.id = oi.stock_item_id
      LEFT JOIN categories c1 ON c1.id = si.ledger_category_id
      LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
      LEFT JOIN categories c2 ON c2.id = sc.parent_category_id
  ), po_pay AS (
    -- Where a PO's payment stands: paid, approved to pay, or not yet.
    SELECT sb.id AS bundle_id, ec.cost_group_id,
           CASE WHEN e.payment_state IN ('paid', 'advance') THEN 'paid'
                WHEN e.approval_status::text = 'finance_approved' AND COALESCE(e.payment_state, '') <> 'void' THEN 'approved' END AS state
      FROM sourcing_bundles sb
      LEFT JOIN expenses e ON e.id = sb.expense_id AND NOT COALESCE(e.is_archived, false)
      LEFT JOIN categories ec ON ec.id = e.category_id
  )
  -- Request lines, the part not on a PO yet
  SELECT o.project_id, COALESCE(lg.cost_group_id, grp.materials), lv.amount,
         'requested', oi.created_at, 'request', o.id, o.request_code, lv.price_from = 'none'
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN proj ON proj.id = o.project_id
    JOIN line_group lg ON lg.order_item_id = oi.id
    CROSS JOIN grp
    LEFT JOIN LATERAL (SELECT sum(COALESCE(sbi.quantity_actual, 0)) AS q
                         FROM sourcing_bundle_items sbi JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id
                        WHERE sbi.order_item_id = oi.id AND sb.status <> 'cancelled') onpo ON true
    CROSS JOIN LATERAL cost_watch_line_value(oi.id, GREATEST(COALESCE(oi.quantity, 0) - COALESCE(onpo.q, 0), 0)) lv
   WHERE oi.status::text IN ('pending', 'partially_sourced') AND o.approval_status::text <> 'rejected'
  UNION ALL
  -- PO lines: requested until placed, then following the PO's payment.
  -- An order closed short counts what came.
  SELECT o.project_id, COALESCE(lg.cost_group_id, pp.cost_group_id, grp.materials),
         CASE WHEN sb.closed_short_at IS NOT NULL THEN COALESCE(r.received, 0) ELSE COALESCE(sbi.quantity_actual, 0) END
           * COALESCE(sbi.unit_price_actual, 0),
         CASE WHEN sb.status IN ('drafting', 'submitted', 'approved') THEN 'requested'
              ELSE COALESCE(pp.state, 'ordered') END,
         COALESCE(oi.created_at, sbi.created_at), 'po', sb.id, sb.bundle_code, false
    FROM sourcing_bundle_items sbi
    JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id AND sb.status <> 'cancelled'
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    JOIN proj ON proj.id = o.project_id
    JOIN line_group lg ON lg.order_item_id = oi.id
    JOIN po_pay pp ON pp.bundle_id = sb.id
    CROSS JOIN grp
    LEFT JOIN v_bundle_line_receipts r ON r.bundle_item_id = sbi.id
  UNION ALL
  -- Bills with no PO behind them: labour pay, petty cash, subcontract, transport…
  SELECT e.project_id, COALESCE(c.cost_group_id, CASE WHEN c.id IS NOT NULL THEN grp.overhead END), COALESCE(e.amount_etb, 0),
         CASE WHEN e.payment_state IN ('paid', 'advance') THEN 'paid'
              WHEN e.approval_status::text = 'finance_approved' THEN 'approved'
              ELSE 'ordered' END,
         e.created_at, 'bill', e.id, e.expense_code, false
    FROM expenses e
    JOIN proj ON proj.id = e.project_id
    CROSS JOIN grp
    LEFT JOIN categories c ON c.id = e.category_id
   WHERE NOT COALESCE(e.is_archived, false)
     AND NOT EXISTS (SELECT 1 FROM chart_of_accounts coa WHERE coa.category_id = e.category_id AND coa.nature IN ('Asset', 'Liability', 'Equity')) AND COALESCE(e.payment_state, '') <> 'void'
     AND e.approval_status::text <> 'rejected'
     AND e.sourcing_bundle_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM sourcing_bundles sb WHERE sb.expense_id = e.id)
$f$;
REVOKE EXECUTE ON FUNCTION public.cost_watch_items() FROM PUBLIC, anon, authenticated;

-- Who sees what: everything for management, their own projects for a PM.
CREATE OR REPLACE FUNCTION public.cost_watch_sees(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE((SELECT get_user_role())::text IN ('admin', 'executive', 'finance', 'operations_manager'), false)
      OR (SELECT is_ops_manager())
      OR p_project IN (SELECT my_managed_project_ids())
$f$;
REVOKE EXECUTE ON FUNCTION public.cost_watch_sees(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cost_watch(p_days integer DEFAULT 30)
RETURNS TABLE(project_id uuid, project_name text, pm_name text, value numeric, value_source text,
              cost_group_id uuid, cost_group text, sort_order integer,
              requested numeric, ordered numeric, approved numeric, paid numeric, new_now numeric, new_before numeric,
              unpriced integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_now timestamptz := now(); v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH it AS (SELECT * FROM cost_watch_items() i WHERE cost_watch_sees(i.project_id) AND (i.amount <> 0 OR i.unpriced)),
  agg AS (
    SELECT i.project_id, i.cost_group_id,
           sum(i.amount) FILTER (WHERE i.stage = 'requested') AS requested,
           sum(i.amount) FILTER (WHERE i.stage = 'ordered') AS ordered,
           sum(i.amount) FILTER (WHERE i.stage = 'approved') AS approved,
           sum(i.amount) FILTER (WHERE i.stage = 'paid') AS paid,
           sum(i.amount) FILTER (WHERE i.started_at >= v_now - make_interval(days => v_days)) AS new_now,
           sum(i.amount) FILTER (WHERE i.started_at >= v_now - make_interval(days => 2 * v_days)
                                   AND i.started_at < v_now - make_interval(days => v_days)) AS new_before,
           count(*) FILTER (WHERE i.unpriced) AS unpriced
      FROM it i GROUP BY 1, 2
  ), worth AS (
    SELECT p.id,
           CASE WHEN p.contract_value > 0 THEN p.contract_value
                WHEN q.total > 0 THEN q.total
                WHEN s.total > 0 THEN s.total END AS value,
           CASE WHEN p.contract_value > 0 THEN 'contract'
                WHEN q.total > 0 THEN 'quotation'
                WHEN s.total > 0 THEN 'invoiced' END AS source
      FROM projects p
      LEFT JOIN LATERAL (SELECT pf.total FROM proformas pf WHERE pf.project_id = p.id AND pf.status::text IN ('accepted', 'converted')
                          ORDER BY COALESCE(pf.accepted_at, pf.updated_at) DESC LIMIT 1) q ON true
      LEFT JOIN LATERAL (SELECT sum(sa.amount) AS total FROM sales sa WHERE sa.project_id = p.id) s ON true
  )
  SELECT a.project_id, btrim(p.project_name), btrim(st.employee_name), w.value, w.source,
         a.cost_group_id, COALESCE(g.name, 'Not grouped'), COALESCE(g.sort_order, 99),
         COALESCE(a.requested, 0), COALESCE(a.ordered, 0), COALESCE(a.approved, 0), COALESCE(a.paid, 0),
         COALESCE(a.new_now, 0), COALESCE(a.new_before, 0), a.unpriced::int
    FROM agg a
    JOIN projects p ON p.id = a.project_id
    LEFT JOIN staff st ON st.id = p.project_manager_id
    LEFT JOIN cost_groups g ON g.id = a.cost_group_id
    LEFT JOIN worth w ON w.id = a.project_id
   ORDER BY 1, 8;
END $f$;
REVOKE EXECUTE ON FUNCTION public.cost_watch(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cost_watch(integer) TO authenticated;

-- Per week (Monday) and cost group, what came in; the row with week NULL is
-- everything before the first week shown, so the line can start from it.
CREATE OR REPLACE FUNCTION public.cost_watch_trend(p_project uuid, p_weeks integer DEFAULT 16)
RETURNS TABLE(week date, cost_group_id uuid, cost_group text, added numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_from date := (date_trunc('week', now() AT TIME ZONE 'Africa/Addis_Ababa'))::date - 7 * (LEAST(GREATEST(COALESCE(p_weeks, 16), 2), 104) - 1);
BEGIN
  IF auth.uid() IS NULL OR NOT cost_watch_sees(p_project) THEN RETURN; END IF;
  RETURN QUERY
  SELECT CASE WHEN (i.started_at AT TIME ZONE 'Africa/Addis_Ababa')::date < v_from THEN NULL
              ELSE (date_trunc('week', i.started_at AT TIME ZONE 'Africa/Addis_Ababa'))::date END,
         i.cost_group_id, COALESCE(g.name, 'Not grouped'), sum(i.amount)
    FROM cost_watch_items() i LEFT JOIN cost_groups g ON g.id = i.cost_group_id
   WHERE i.project_id = p_project AND i.amount <> 0
   GROUP BY 1, 2, 3
   ORDER BY 1 NULLS FIRST, 3;
END $f$;
REVOKE EXECUTE ON FUNCTION public.cost_watch_trend(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cost_watch_trend(uuid, integer) TO authenticated;

-- The latest steps, newest first: a request raised, a PO approved, a PO
-- placed, a payment approved, a payment made.
CREATE OR REPLACE FUNCTION public.cost_watch_moves(p_limit integer DEFAULT 40, p_project uuid DEFAULT NULL)
RETURNS TABLE(at timestamptz, project_id uuid, project_name text, amount numeric, groups jsonb, step text, code text, link text, who text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_since timestamptz := now() - interval '60 days';
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH it AS (
    SELECT i.* FROM cost_watch_items() i
     WHERE i.amount <> 0 AND (p_project IS NULL OR i.project_id = p_project) AND cost_watch_sees(i.project_id)
  ), lines AS (
    -- PO lines, by the PO they belong to
    SELECT i.source, i.source_id, i.project_id, i.cost_group_id, sum(i.amount) AS amt
      FROM it i WHERE i.source = 'po' GROUP BY 1, 2, 3, 4
    UNION ALL
    -- A request at the value asked for, whether or not it is on a PO since
    SELECT 'request', o.id, o.project_id,
           COALESCE(c1.cost_group_id, c2.cost_group_id, (SELECT id FROM cost_groups WHERE name = 'Materials')),
           sum(lv.amount)
      FROM orders o
      JOIN projects p ON p.id = o.project_id AND NOT COALESCE(p.is_internal, false) AND p.costing_closed_at IS NULL
      JOIN order_items oi ON oi.order_id = o.id AND oi.status::text NOT IN ('cancelled', 'stock_pending_dispatch')
      LEFT JOIN stock_items si ON si.id = oi.stock_item_id
      LEFT JOIN categories c1 ON c1.id = si.ledger_category_id
      LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
      LEFT JOIN categories c2 ON c2.id = sc.parent_category_id
      CROSS JOIN LATERAL cost_watch_line_value(oi.id, COALESCE(oi.quantity, 0)) lv
     WHERE o.created_at >= v_since AND o.approval_status::text <> 'rejected'
       AND (p_project IS NULL OR o.project_id = p_project) AND cost_watch_sees(o.project_id)
     GROUP BY 1, 2, 3, 4
  ), steps AS (
    SELECT 'po'::text AS source, sb.id AS source_id, sb.bundle_code AS code, '/sourcing/' || sb.id AS link, sb.procurement_officer_id AS who_user, x.at, x.step
      FROM sourcing_bundles sb
      LEFT JOIN expenses e ON e.id = sb.expense_id
      CROSS JOIN LATERAL (VALUES (sb.approved_at, 'PO approved'), (sb.ordered_at, 'Ordered'),
                                 (e.finance_approved_at, 'Approved to pay'),
                                 (CASE WHEN e.payment_state IN ('paid', 'advance') THEN COALESCE(e.paid_date::timestamptz, e.payment_state_changed_at) END, 'Paid')) x(at, step)
     WHERE sb.status <> 'cancelled' AND x.at >= v_since
    UNION ALL
    SELECT 'request', o.id, o.request_code, '/purchase-requests/' || o.id, o.requested_by_user_id, o.created_at, 'Requested'
      FROM orders o WHERE o.created_at >= v_since
  ), ev AS (
    SELECT s.at, l.project_id, l.cost_group_id, l.amt, s.step, s.code, s.link, s.who_user
      FROM steps s JOIN lines l ON l.source = s.source AND l.source_id = s.source_id
    UNION ALL
    SELECT x.at, i.project_id, i.cost_group_id, i.amount, x.step, i.label, '/expenses/' || i.source_id, NULL::uuid
      FROM it i JOIN expenses e ON e.id = i.source_id
      CROSS JOIN LATERAL (VALUES (e.created_at, 'Billed'), (e.finance_approved_at, 'Approved to pay'),
                                 (CASE WHEN e.payment_state IN ('paid', 'advance') THEN COALESCE(e.paid_date::timestamptz, e.payment_state_changed_at) END, 'Paid')) x(at, step)
     WHERE i.source = 'bill' AND x.at >= v_since
  ), one AS (
    SELECT ev.at, ev.project_id, ev.step, ev.code, ev.link, ev.who_user, sum(ev.amt) AS amount,
           jsonb_object_agg(COALESCE(g.name, 'Not grouped'), ev.amt) AS groups
      FROM (SELECT e2.at, e2.project_id, e2.cost_group_id, sum(e2.amt) AS amt, e2.step, e2.code, e2.link, e2.who_user
              FROM ev e2 GROUP BY 1, 2, 3, 5, 6, 7, 8) ev
      LEFT JOIN cost_groups g ON g.id = ev.cost_group_id
     GROUP BY 1, 2, 3, 4, 5, 6
  )
  SELECT one.at, one.project_id, btrim(p.project_name), one.amount, one.groups, one.step, one.code, one.link,
         (SELECT full_name FROM user_profiles u WHERE u.id = one.who_user)
    FROM one JOIN projects p ON p.id = one.project_id
   ORDER BY one.at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
END $f$;
REVOKE EXECUTE ON FUNCTION public.cost_watch_moves(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cost_watch_moves(integer, uuid) TO authenticated;
