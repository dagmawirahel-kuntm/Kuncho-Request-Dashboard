-- Root cause of "batch approved payment not coming in the payment table":
-- rollup_labor_timesheets_to_expense() has never set category_id or
-- account_id on the expense rows it creates. post_expense_payment_to_ledger
-- silently no-ops (via log_posting_failure) whenever either is missing --
-- confirmed live, EVERY labor payment ever created (batch or individual)
-- has 0 rows with a posted journal entry, category_id IS NULL across the
-- board. Without category_id/account_id there is no way for the ledger
-- (the actual "payment table") to know which GL account and which bank/
-- cash account a labor payment belongs to.
--
-- Fixes:
-- - category_id: always "Labor" (categories.id d9f67bf3-38ef-49d6-ad77-
--   2869af9b6c82, mapped to chart_of_accounts 51020) -- unambiguous for
--   every labor rollup expense, no user input needed.
-- - account_id: genuinely needs a human choice (which bank/cash account
--   funds this specific payment) -- create_batch_payment now takes an
--   explicit p_account_id and stamps it on every expense in the batch,
--   the same way ExpenseFormPage already requires it for a normal
--   expense, since labor drafts are created programmatically and never
--   go through that form.
-- - confirm_batch_payment(): batch_wire was the only payment_method with
--   no path from 'sent' to 'paid' at all (cash has a confirm RPC,
--   transfer/cpo/cheque get matched to a bank statement, vrf gets
--   confirmed by the VRF Manager) -- so a batch payment could never post
--   to the ledger even with the fields above fixed. Mirrors
--   confirm_expense_cash_payment().
-- - One-time backfill: category_id set on every existing labor-rollup
--   expense with it missing (safe, unambiguous). account_id is NOT
--   backfilled here -- it requires knowing which real account funded
--   each already-sent payment, which has to come from finance.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.rollup_labor_timesheets_to_expense(p_labor_requisition_id uuid, p_period_start date, p_period_end date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_req            labor_requisitions%ROWTYPE;
  v_existing_id    uuid;
  v_expense_id     uuid;
  v_total          numeric := 0;
  v_worker_count   int     := 0;
  v_days_or_vol    numeric := 0;
  v_project_name   text;
  v_desc           text;
  v_labor_category_id uuid := 'd9f67bf3-38ef-49d6-ad77-2869af9b6c82';
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin','executive','finance','hr_officer') THEN
    RAISE EXCEPTION 'Only admin, executive, finance, or HR may run a labor rollup';
  END IF;

  SELECT * INTO v_req FROM labor_requisitions WHERE id = p_labor_requisition_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Requisition % not found', p_labor_requisition_id; END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'Requisition must be approved before rollup (current: %)', v_req.status; END IF;

  SELECT id INTO v_existing_id FROM expenses
   WHERE rolled_up_from_requisition_id = p_labor_requisition_id
     AND rollup_period_start = p_period_start AND rollup_period_end = p_period_end;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rollup_workers (
    staff_id uuid, days_worked numeric, day_rate numeric, subtotal numeric,
    gang_size integer, gang_member_names text, gang_member_staff_ids uuid[]
  ) ON COMMIT DROP;
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS gang_size integer;
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS gang_member_names text;
  ALTER TABLE _rollup_workers ADD COLUMN IF NOT EXISTS gang_member_staff_ids uuid[];
  DELETE FROM _rollup_workers WHERE true;

  IF v_req.payment_basis = 'per_volume' THEN
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, gang_member_staff_ids)
    SELECT
      ts.staff_id,
      SUM(COALESCE(ts.volume_completed, 0)) AS days_worked,
      v_req.unit_rate AS day_rate,
      SUM(COALESCE(ts.volume_completed, 0)) * v_req.unit_rate AS subtotal,
      MAX(ts.gang_size) AS gang_size,
      (array_agg(ts.notes ORDER BY ts.date DESC) FILTER (WHERE ts.notes IS NOT NULL))[1] AS gang_member_names,
      (SELECT ts2.gang_member_staff_ids FROM timesheet ts2
        WHERE ts2.staff_id = ts.staff_id
          AND ts2.labor_requisition_id = p_labor_requisition_id
          AND ts2.date BETWEEN p_period_start AND p_period_end
          AND ts2.gang_member_staff_ids IS NOT NULL
        ORDER BY ts2.date DESC LIMIT 1) AS gang_member_staff_ids
    FROM timesheet ts
    LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
    WHERE ts.labor_requisition_id = p_labor_requisition_id
      AND ts.rolled_up_expense_id IS NULL
      AND ts.date BETWEEN p_period_start AND p_period_end
      AND ts.staff_id IS NOT NULL
      AND COALESCE(ts.volume_completed, 0) > 0
      AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
    GROUP BY ts.staff_id
    HAVING SUM(COALESCE(ts.volume_completed, 0)) > 0;
  ELSE
    INSERT INTO _rollup_workers (staff_id, days_worked, day_rate, subtotal)
    SELECT
      combined.staff_id,
      SUM(combined.days_worked) AS days_worked,
      MAX(combined.day_rate)    AS day_rate,
      SUM(combined.days_worked) * MAX(combined.day_rate) AS subtotal
    FROM (
      SELECT
        ts.staff_id,
        COALESCE(ts.days_worked, 1)::numeric AS days_worked,
        COALESCE(ts.day_rate, la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
      FROM timesheet ts
      LEFT JOIN labor_allocations la ON la.id = ts.labor_allocation_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = ts.staff_id
      WHERE ts.labor_requisition_id = p_labor_requisition_id
        AND ts.rolled_up_expense_id IS NULL
        AND ts.date BETWEEN p_period_start AND p_period_end
        AND ts.check_in_time IS NOT NULL AND ts.check_out_time IS NOT NULL
        AND ts.staff_id IS NOT NULL
        AND (la.id IS NULL OR (ts.date >= la.start_date AND ts.date <= COALESCE(la.end_date, CURRENT_DATE)))
      UNION ALL
      SELECT
        att.staff_id,
        1::numeric AS days_worked,
        COALESCE(la.day_rate_snapshot, s.day_rate, v_req.estimated_day_rate, 0)::numeric AS day_rate
      FROM timesheet_attendance att
      LEFT JOIN labor_allocations la ON la.staff_id = att.staff_id AND la.project_id = v_req.project_id
      LEFT JOIN staff s ON s.id = att.staff_id
      WHERE att.labor_requisition_id = p_labor_requisition_id
        AND att.rolled_up_expense_id IS NULL
        AND att.work_date BETWEEN p_period_start AND p_period_end
    ) combined
    GROUP BY combined.staff_id;
  END IF;

  SELECT COALESCE(SUM(subtotal),0), COALESCE(SUM(GREATEST(COALESCE(gang_size,1),1)),0), COALESCE(SUM(days_worked),0)
    INTO v_total, v_worker_count, v_days_or_vol FROM _rollup_workers;

  IF v_worker_count = 0 THEN
    RAISE EXCEPTION 'No un-rolled timesheets found in period % to %', p_period_start, p_period_end;
  END IF;

  SELECT project_name INTO v_project_name FROM projects WHERE id = v_req.project_id;
  v_desc := format(
    CASE WHEN v_req.payment_basis = 'per_volume'
         THEN 'Labor payment: %s worker%s · %s %s (%s, %s → %s)'
         ELSE 'Labor payment: %s worker%s · %s day%s (%s, %s → %s)'
    END,
    v_worker_count, CASE WHEN v_worker_count=1 THEN '' ELSE 's' END,
    v_days_or_vol,
    CASE WHEN v_req.payment_basis = 'per_volume' THEN COALESCE(v_req.volume_unit,'units')
         ELSE CASE WHEN v_days_or_vol=1 THEN '' ELSE 's' END END,
    COALESCE(v_project_name,'—'), p_period_start, p_period_end);

  INSERT INTO expenses (
    item_service_description, amount_etb, expense_type, category_id, project_id, date,
    vendor_id, paid_to_staff_id,
    approval_status, payment_state,
    rolled_up_from_requisition_id, rollup_period_start, rollup_period_end
  ) VALUES (
    v_desc, v_total, 'labor_payment'::expense_category, v_labor_category_id, v_req.project_id, p_period_end,
    CASE WHEN v_req.payment_model = 'gang_leader' THEN v_req.gang_leader_vendor_id ELSE NULL END,
    CASE WHEN v_req.payment_model = 'individual' AND v_worker_count = 1
         THEN (SELECT staff_id FROM _rollup_workers LIMIT 1) ELSE NULL END,
    'pending'::expense_approval_status, 'unpaid',
    p_labor_requisition_id, p_period_start, p_period_end
  ) RETURNING id INTO v_expense_id;

  INSERT INTO labor_expense_workers (expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, gang_member_staff_ids)
  SELECT v_expense_id, w.staff_id, w.days_worked, w.day_rate, w.subtotal, w.gang_size, w.gang_member_names, w.gang_member_staff_ids FROM _rollup_workers w;

  IF v_req.payment_basis = 'per_volume' THEN
    UPDATE timesheet SET rolled_up_expense_id = v_expense_id
     WHERE labor_requisition_id = p_labor_requisition_id
       AND rolled_up_expense_id IS NULL
       AND date BETWEEN p_period_start AND p_period_end
       AND staff_id IN (SELECT staff_id FROM _rollup_workers)
       AND COALESCE(volume_completed, 0) > 0;
  ELSE
    UPDATE timesheet SET rolled_up_expense_id = v_expense_id
     WHERE labor_requisition_id = p_labor_requisition_id
       AND rolled_up_expense_id IS NULL
       AND date BETWEEN p_period_start AND p_period_end
       AND check_in_time IS NOT NULL AND check_out_time IS NOT NULL
       AND staff_id IN (SELECT staff_id FROM _rollup_workers);

    UPDATE timesheet_attendance SET rolled_up_expense_id = v_expense_id
     WHERE labor_requisition_id = p_labor_requisition_id
       AND rolled_up_expense_id IS NULL
       AND work_date BETWEEN p_period_start AND p_period_end
       AND staff_id IN (SELECT staff_id FROM _rollup_workers);
  END IF;

  RETURN v_expense_id;
END $function$;

-- ── create_batch_payment: now requires an account_id ─────────────────
-- Explicit DROP first: the new signature adds a required p_account_id
-- parameter, which Postgres treats as a distinct overload rather than a
-- replacement of the old 4-arg version -- without dropping it, a caller
-- that still passes only the old 4 named params would keep silently
-- hitting the old account-less function.
DROP FUNCTION IF EXISTS public.create_batch_payment(uuid[], uuid, text, text);
CREATE FUNCTION public.create_batch_payment(p_expense_ids uuid[], p_assignee_id uuid, p_account_id uuid, p_payment_code text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_batch_id UUID;
  v_bad_count INT;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can create a batch payment';
  END IF;

  IF p_expense_ids IS NULL OR array_length(p_expense_ids, 1) IS NULL OR array_length(p_expense_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one expense must be selected';
  END IF;

  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'An account must be selected to fund this batch payment';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM expenses WHERE id = ANY(p_expense_ids) AND payment_state <> 'approved_to_pay';
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'All selected expenses must be in approved_to_pay state';
  END IF;

  INSERT INTO batch_payments (payment_code, assignee_id, notes)
  VALUES (p_payment_code, p_assignee_id, p_notes)
  RETURNING id INTO v_batch_id;

  INSERT INTO batch_payment_expenses (batch_payment_id, expense_id)
  SELECT v_batch_id, unnest(p_expense_ids);

  UPDATE expenses
  SET payment_state = 'sent',
      disbursed_by = p_assignee_id,
      payment_method = 'batch_wire',
      account_id = p_account_id
  WHERE id = ANY(p_expense_ids);

  RETURN v_batch_id;
END;
$function$;

-- ── confirm_batch_payment: the missing sent -> paid step ──────────────
CREATE OR REPLACE FUNCTION public.confirm_batch_payment(p_batch_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can confirm a batch payment';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM batch_payments WHERE id = p_batch_payment_id) THEN
    RAISE EXCEPTION 'Batch payment % not found', p_batch_payment_id;
  END IF;

  UPDATE expenses
     SET payment_state = 'paid'
   WHERE payment_state = 'sent'
     AND id IN (SELECT expense_id FROM batch_payment_expenses WHERE batch_payment_id = p_batch_payment_id);
END;
$function$;

-- One-time backfill: category_id only (see note above on account_id).
UPDATE expenses SET category_id = 'd9f67bf3-38ef-49d6-ad77-2869af9b6c82'
 WHERE rolled_up_from_requisition_id IS NOT NULL AND category_id IS NULL;
