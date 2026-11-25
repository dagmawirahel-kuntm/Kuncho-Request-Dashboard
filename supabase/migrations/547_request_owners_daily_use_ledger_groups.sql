-- Workshop requests: an owner on each line, an admin's approval for some
-- requesters, a daily "what was it used for" sheet, and a general ledger on
-- the PO.
--
--  1. Owners. One request can hold lines for several people: each line says
--     who asked for it (order_items.requested_for_staff_id).
--  2. Admin approval. A requester flagged requests_need_admin_approval (for
--     now Mahlet, who raises the workshop's requests from finance) has her
--     requests held: nothing on them can go on a PO until an admin approves
--     the request (approve_held_requests), and only an admin can approve it.
--  3. Daily use. Each line records what it was used for: a project, stock, or
--     the workshop's running costs. daily_use_sheet(date) lists a day's lines
--     by owner, with the stock issued that day, for the printable form;
--     set_line_use records the answers.
--  4. General ledger. Procurement picks the general ledger on the PO (a
--     parent account such as "Construction materials"); finance picks the sub
--     ledger inside it (Gypsum, Cement…), using it as the clue.

-- 1. Owners and use on each line
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS requested_for_staff_id uuid REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS used_for text CHECK (used_for IS NULL OR used_for IN ('project', 'stock', 'workshop')),
  ADD COLUMN IF NOT EXISTS used_for_project_id uuid REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS used_for_note text,
  ADD COLUMN IF NOT EXISTS used_for_set_by uuid,
  ADD COLUMN IF NOT EXISTS used_for_set_at timestamptz;

COMMENT ON COLUMN order_items.requested_for_staff_id IS 'Who asked for this line (547): one request can hold lines for several owners.';
COMMENT ON COLUMN order_items.used_for IS 'What the line was used for (547): a project, stock, or the workshop''s running costs.';

-- 2. Requests that wait for an admin
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS requests_need_admin_approval boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profiles.requests_need_admin_approval IS
  'Purchase requests this person raises wait for an admin''s approval before anything on them is bought (547).';

-- Who is flagged is set in 547b, applied once the app can approve held requests.

CREATE OR REPLACE FUNCTION public.order_is_held(p_order uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(o.approval_status::text = 'pending'
         AND (SELECT u.requests_need_admin_approval FROM user_profiles u WHERE u.id = o.requested_by_user_id), false)
    FROM orders o WHERE o.id = p_order;
$function$;

-- Only an admin approves a held request.
CREATE OR REPLACE FUNCTION public.trg_held_request_admin_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.approval_status::text IN ('manager_approved', 'finance_approved')
     AND OLD.approval_status::text = 'pending'
     AND COALESCE((SELECT requests_need_admin_approval FROM user_profiles WHERE id = NEW.requested_by_user_id), false)
     AND COALESCE(get_user_role()::text, '') <> 'admin' THEN
    RAISE EXCEPTION 'An admin approves % — requests from % wait for an admin', NEW.request_code,
      COALESCE((SELECT full_name FROM user_profiles WHERE id = NEW.requested_by_user_id), 'this requester');
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_held_request_admin_only BEFORE UPDATE OF approval_status ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_held_request_admin_only();

-- Nothing on a held request goes on a PO.
CREATE OR REPLACE FUNCTION public.trg_po_line_needs_approved_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_order uuid; v_code text;
BEGIN
  IF NEW.order_item_id IS NULL THEN RETURN NEW; END IF;
  SELECT oi.order_id, o.request_code INTO v_order, v_code
    FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = NEW.order_item_id;
  IF order_is_held(v_order) THEN
    RAISE EXCEPTION '% is waiting for an admin''s approval — it can go on a purchase order once it is approved', v_code;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_po_line_needs_approved_request BEFORE INSERT ON sourcing_bundle_items
  FOR EACH ROW EXECUTE FUNCTION trg_po_line_needs_approved_request();

-- Tell the admins when a held request comes in.
CREATE OR REPLACE FUNCTION public.trg_notify_held_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(NEW.is_archived, false) AND order_is_held(NEW.id) THEN
    PERFORM notify(notify_role_users(ARRAY['admin']), 'request.held', 'Purchase request to approve',
      concat_ws(' · ', NEW.request_code, notify_short(COALESCE(NEW.order_name, NEW.item_service_description), 60))
        || COALESCE(' — from ' || notify_user_name(NEW.requested_by_user_id), '') || '. Nothing on it is bought until an admin approves it.',
      '/purchase-requests/' || NEW.id, 'purchase_request', NEW.id, NULL, 'request.held:' || NEW.id);
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_zz_notify_held_request AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_notify_held_request();

CREATE OR REPLACE FUNCTION public.approve_held_requests(p_orders uuid[])
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  IF COALESCE(get_user_role()::text, '') <> 'admin' THEN RAISE EXCEPTION 'An admin approves these requests'; END IF;
  UPDATE orders SET approval_status = 'manager_approved', manager_approved_by = auth.uid(), manager_approved_at = now()
   WHERE id = ANY (p_orders) AND approval_status::text = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

-- 3. Daily use: a day's lines by owner, and the stock issued that day.
CREATE OR REPLACE FUNCTION public.daily_use_sheet(p_date date, p_requester uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'finance', 'executive', 'operations_manager', 'procurement_officer', 'stock_manager') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT jsonb_build_object(
    'date', p_date,
    'requester', (SELECT full_name FROM user_profiles WHERE id = p_requester),
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id, 'order_id', o.id, 'request_code', o.request_code, 'request', o.order_name,
        'owner_id', oi.requested_for_staff_id, 'owner', s.employee_name,
        'item', oi.item_name, 'quantity', oi.quantity, 'unit', oi.unit, 'status', oi.status,
        'request_project', p.project_name, 'held', order_is_held(o.id), 'approval', o.approval_status,
        'po', (SELECT string_agg(DISTINCT b.bundle_code, ', ') FROM sourcing_bundle_items sbi JOIN sourcing_bundles b ON b.id = sbi.bundle_id
                WHERE sbi.order_item_id = oi.id AND b.status::text <> 'cancelled'),
        'used_for', oi.used_for, 'used_for_project_id', oi.used_for_project_id, 'used_for_project', up.project_name,
        'used_for_note', oi.used_for_note)
        ORDER BY s.employee_name NULLS LAST, o.request_code, oi.sort_order)
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN staff s ON s.id = oi.requested_for_staff_id
      LEFT JOIN projects p ON p.id = o.project_id
      LEFT JOIN projects up ON up.id = oi.used_for_project_id
     WHERE COALESCE(o.order_date, o.created_at::date) = p_date
       AND NOT COALESCE(o.is_archived, false) AND o.approval_status::text <> 'rejected'
       AND COALESCE(oi.status, '') <> 'cancelled'
       AND (p_requester IS NULL OR o.requested_by_user_id = p_requester)), '[]'::jsonb),
    'stock', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', si.id, 'item', st.item_name, 'quantity', si.quantity, 'unit', st.unit, 'project', p.project_name,
        'to', s.employee_name, 'type', si.issue_type, 'cost', si.total_cost) ORDER BY st.item_name)
      FROM stock_issues si
      JOIN stock_items st ON st.id = si.stock_item_id
      LEFT JOIN projects p ON p.id = si.project_id
      LEFT JOIN staff s ON s.id = si.issued_to_staff_id
     WHERE si.issued_date = p_date AND si.reversed_at IS NULL AND si.reversal_of IS NULL), '[]'::jsonb))
  INTO v;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.set_line_use(p_item uuid, p_used_for text, p_project uuid DEFAULT NULL, p_note text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_requester uuid;
BEGIN
  SELECT o.requested_by_user_id INTO v_requester FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request line not found'; END IF;
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'finance', 'executive', 'operations_manager', 'stock_manager')
     AND v_requester IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_used_for IS NOT NULL AND p_used_for NOT IN ('project', 'stock', 'workshop') THEN RAISE EXCEPTION 'Used for a project, stock or the workshop'; END IF;
  IF p_used_for = 'project' AND p_project IS NULL THEN RAISE EXCEPTION 'Pick the project it was used for'; END IF;
  UPDATE order_items SET used_for = p_used_for,
         used_for_project_id = CASE WHEN p_used_for = 'project' THEN p_project END,
         used_for_note = NULLIF(btrim(p_note), ''),
         used_for_set_by = auth.uid(), used_for_set_at = now()
   WHERE id = p_item;
END $function$;

-- 4. General ledger on the PO
ALTER TABLE sourcing_bundles
  ADD COLUMN IF NOT EXISTS general_ledger_id uuid REFERENCES chart_of_accounts(id);

COMMENT ON COLUMN sourcing_bundles.general_ledger_id IS
  'The general ledger procurement picked for the PO (547) — a parent account; finance picks the sub ledger inside it.';

CREATE OR REPLACE FUNCTION public.trg_po_general_ledger_is_a_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.general_ledger_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.ledger_group_id = NEW.general_ledger_id) THEN
    RAISE EXCEPTION 'Pick a general ledger such as Construction materials or Finishing materials';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_po_general_ledger_is_a_group BEFORE INSERT OR UPDATE OF general_ledger_id ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION trg_po_general_ledger_is_a_group();

-- The PO page's payment status carries procurement's general ledger.
DO $mig$
DECLARE
  v_old text := pg_get_functiondef('public.po_payment_status(uuid)'::regprocedure);
  v_new text := replace(v_old,
    E'''po_approved_by_finance'',',
    E'''general_ledger'', (SELECT jsonb_build_object(''id'', g.id, ''code'', g.account_code, ''name'', g.account_name) FROM chart_of_accounts g WHERE g.id = b.general_ledger_id),\n    ''po_approved_by_finance'',');
BEGIN
  IF v_new = v_old THEN RAISE EXCEPTION 'po_payment_status: anchor not found'; END IF;
  EXECUTE v_new;
END $mig$;

GRANT EXECUTE ON FUNCTION public.order_is_held(uuid), public.approve_held_requests(uuid[]),
  public.daily_use_sheet(date, uuid), public.set_line_use(uuid, text, uuid, text) TO authenticated;
