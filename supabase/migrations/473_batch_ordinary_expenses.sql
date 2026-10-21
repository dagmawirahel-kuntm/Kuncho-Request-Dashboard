-- 473 — Ordinary expenses can be grouped into a batch before approval
--
-- Labour drafts could be put in one batch while still pending, approved
-- together from the batch page, and paid as one wire. Ordinary expenses —
-- general, fuel, transport, maintenance, orders — had no way in: a batch
-- could only be made from the To-pay queue, after each one was approved on
-- its own. The approval queue now groups selected bills into a batch
-- (create_batch_payment already takes pending bills). Three things here so
-- that is safe:
--
--   1. A bill can be in only one batch. Nothing stopped the same expense
--      being linked to two, which would pay it twice.
--   2. Releasing a batch approves manager-approved bills as well as pending
--      ones. Only 'pending' was approved, so a manager-approved bill in a
--      batch stayed unapproved and was never sent.
--   3. The approval queue says which batch a bill is in.

SET search_path TO public;

-- ── 1. One batch per bill ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_batch_payment(p_expense_ids uuid[], p_assignee_id uuid, p_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'batch_wire'::text, p_payment_code text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch_id  UUID;
  v_bad_count INT;
  v_pending   INT;
  v_taken     text;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can create a batch payment';
  END IF;

  IF p_expense_ids IS NULL OR array_length(p_expense_ids, 1) IS NULL OR array_length(p_expense_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one expense must be selected';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM expenses WHERE id = ANY(p_expense_ids) AND payment_state NOT IN ('unpaid', 'approved_to_pay');
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'Every selected expense must be awaiting approval or approved to pay';
  END IF;

  SELECT string_agg(DISTINCT format('%s (in %s)', COALESCE(e.expense_code, 'an expense'), COALESCE(b.payment_code, 'another batch')), ', ')
    INTO v_taken
    FROM batch_payment_expenses x
    JOIN expenses e ON e.id = x.expense_id
    JOIN batch_payments b ON b.id = x.batch_payment_id
   WHERE x.expense_id = ANY(p_expense_ids);
  IF v_taken IS NOT NULL THEN
    RAISE EXCEPTION 'Already in a batch: % — take them out of that batch first', v_taken;
  END IF;

  SELECT count(*) INTO v_pending
  FROM expenses WHERE id = ANY(p_expense_ids) AND payment_state = 'unpaid';

  IF v_pending = 0 AND p_account_id IS NULL AND p_payment_method <> 'cash' THEN
    RAISE EXCEPTION 'An account must be selected to fund a % batch payment', p_payment_method;
  END IF;

  INSERT INTO batch_payments (payment_code, assignee_id, notes)
  VALUES (p_payment_code, p_assignee_id, p_notes)
  RETURNING id INTO v_batch_id;

  INSERT INTO batch_payment_expenses (batch_payment_id, expense_id)
  SELECT v_batch_id, unnest(p_expense_ids);

  IF v_pending = 0 THEN
    UPDATE expenses
       SET payment_state = 'sent', disbursed_by = p_assignee_id,
           payment_method = p_payment_method, account_id = p_account_id
     WHERE id = ANY(p_expense_ids);
  END IF;

  RETURN v_batch_id;
END;
$function$;

-- The batch edit page links bills directly; the same rule there.
CREATE OR REPLACE FUNCTION public.guard_batch_one_per_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_other text;
BEGIN
  SELECT COALESCE(b.payment_code, 'another batch') INTO v_other
    FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id
   WHERE x.expense_id = NEW.expense_id AND x.batch_payment_id <> NEW.batch_payment_id
   LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION '% is already in %',
      COALESCE((SELECT expense_code FROM expenses WHERE id = NEW.expense_id), 'This expense'), v_other;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_guard_batch_one_per_expense
  BEFORE INSERT OR UPDATE OF expense_id ON batch_payment_expenses
  FOR EACH ROW EXECUTE FUNCTION guard_batch_one_per_expense();

-- ── 2. Releasing approves manager-approved bills too ───────────────────────
CREATE OR REPLACE FUNCTION public.approve_batch_payment(p_batch_payment_id uuid, p_assignee_id uuid, p_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'batch_wire'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids      uuid[];
  v_approved INT := 0;
  v_total    numeric;
  v_blocked  INT;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can approve a batch payment';
  END IF;

  SELECT array_agg(expense_id) INTO v_ids
  FROM batch_payment_expenses WHERE batch_payment_id = p_batch_payment_id;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Batch payment % has no expenses', p_batch_payment_id;
  END IF;

  SELECT count(*) INTO v_blocked
  FROM expenses WHERE id = ANY(v_ids) AND payment_state NOT IN ('unpaid', 'approved_to_pay');
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'This batch has already been dispatched';
  END IF;

  IF p_account_id IS NULL AND p_payment_method <> 'cash' THEN
    RAISE EXCEPTION 'An account must be selected to fund a % batch payment', p_payment_method;
  END IF;

  UPDATE expenses SET approval_status = 'finance_approved'
   WHERE id = ANY(v_ids) AND approval_status IN ('pending', 'manager_approved');
  GET DIAGNOSTICS v_approved = ROW_COUNT;

  UPDATE expenses
     SET payment_state = 'sent', disbursed_by = p_assignee_id,
         payment_method = p_payment_method, account_id = p_account_id
   WHERE id = ANY(v_ids) AND payment_state = 'approved_to_pay';

  UPDATE batch_payments SET assignee_id = p_assignee_id, updated_at = NOW()
   WHERE id = p_batch_payment_id;

  SELECT COALESCE(SUM(amount_etb), 0) INTO v_total FROM expenses WHERE id = ANY(v_ids);

  RETURN format('Batch approved and sent: %s expense(s), %s newly approved, %s ETB total',
                array_length(v_ids, 1), v_approved, v_total);
END;
$function$;

-- ── 3. The approval queue says which batch a bill is in ────────────────────
CREATE OR REPLACE VIEW v_expense_approval_queue WITH (security_invoker = true) AS
 SELECT e.id,
    e.expense_code,
    e.date,
    e.created_at,
    CURRENT_DATE - e.created_at::date AS age_days,
    e.amount_etb,
    e.expense_type,
    e.item_service_description,
    e.project_id,
    p.project_name,
    e.is_overhead,
    e.category_id,
    c.category_name,
    e.vendor_id,
    COALESCE(v.vendor_name, s.employee_name, e.vendors_name) AS payee_name,
    e.purchaser_user_id,
    up.full_name AS requested_by_name,
    e.receipt_url,
    e.approval_status,
    expense_issues(e.*) AS issues,
    bx.batch_payment_id,
    bx.batch_code
   FROM expenses e
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN staff s ON s.id = e.paid_to_staff_id
     LEFT JOIN user_profiles up ON up.id = e.purchaser_user_id
     LEFT JOIN LATERAL (
       SELECT x.batch_payment_id, b.payment_code AS batch_code
         FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id
        WHERE x.expense_id = e.id
        LIMIT 1) bx ON true
  WHERE (e.approval_status = ANY (ARRAY['pending'::expense_approval_status, 'manager_approved'::expense_approval_status]))
    AND NOT COALESCE(e.is_archived, false) AND e.date >= financials_cutover_date();
