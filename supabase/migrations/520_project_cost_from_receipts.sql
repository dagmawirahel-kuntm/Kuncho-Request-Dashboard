-- 520: Project cost follows the goods, and the project page reads the ledger.
--
-- Until now a purchase-order bill became project cost the moment finance
-- approved it, whether or not anything had arrived; the GRN only chose which
-- ledger account the bill hit, and an order mixing kinds of item went to
-- 5139 Mixed materials. Warehouse stock was expensed when bought and never
-- held as stock. The project page added up bills by its own rules, so it and
-- the ledger disagreed. This migration:
--
--   1. A purchase-order bill, when approved, goes to 1520 Purchases awaiting
--      delivery (owed to the vendor, or already paid ahead), not to cost.
--   2. Each GRN moves what was received into cost, line by line, on the day
--      it arrived: each line to its own material account and its own project,
--      at the billed price (less reclaimable VAT). Rejected goods, and goods
--      never delivered on a prepaid order, stay in 1520 as owed by the vendor.
--      A delivery before the bill is booked at the order price, and 1520 then
--      shows it as received but not yet billed.
--   3. Warehouse stock received on a GRN goes to 1510 Workshop stock; issuing
--      it to a project moves it to that project's cost.
--   4. Salaries are shared out to projects each tax month by the days staff
--      are recorded on a project (PM day sheets, attendance): Dr 5205 Staff
--      salaries on projects, Cr 6109 Salaries charged to projects. The P&L
--      total is unchanged; the project carries its share.
--   5. The project page's cost is the ledger's cost for the project. What is
--      committed is what is coming: ordered and not received, billed and not
--      delivered, approved work not billed, agreed subcontracts not billed.
--
-- Applies to the current fiscal year (from 8 Jul 2026); nothing earlier is
-- touched. Bills paid the old way (no accrual) keep their entries.

SET search_path TO public;

-- ─── Accounts ───────────────────────────────────────────────────────────────

INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, system_key, party_kinds, description)
SELECT '1520', 'Purchases awaiting delivery', 'Asset', c.parent_account_id, true, true, 'operating', 'purchases_in_transit', ARRAY['vendor'],
       'Purchase-order bills approved or paid whose goods have not been received on a GRN (520). A credit balance on an order means goods received and not yet billed.'
  FROM chart_of_accounts c WHERE c.account_code = '1510'
   AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE system_key = 'purchases_in_transit' OR account_code = '1520');

INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, system_key, description)
SELECT '5205', 'Staff salaries on projects', 'Expense', c.parent_account_id, true, true, 'operating', 'project_salaries',
       'Salaried staff time charged to projects by the days they were recorded on site (520).'
  FROM chart_of_accounts c WHERE c.account_code = '5201'
   AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE system_key = 'project_salaries' OR account_code = '5205');

INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, system_key, description)
SELECT '6109', 'Salaries charged to projects', 'Expense', c.parent_account_id, true, true, 'operating', 'salaries_recharged',
       'Offsets 5205: the part of salaries carried by projects, so total salary cost is unchanged (520).'
  FROM chart_of_accounts c WHERE c.account_code = '6101'
   AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE system_key = 'salaries_recharged' OR account_code = '6109');

-- ─── Which bills are costed by receipt ──────────────────────────────────────

-- A purchase-order bill with an order behind it, not already paid the old
-- way (an 'expenses' entry and no accrual).
CREATE OR REPLACE FUNCTION public.expense_costed_by_receipt(e expenses)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT e.expense_type = 'purchase_order' AND e.sourcing_bundle_id IS NOT NULL
     AND (EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = e.id)
          OR NOT EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = e.id))
$f$;

-- ─── Bill approved: to 1520 for an order, to cost otherwise ─────────────────

CREATE OR REPLACE FUNCTION public.sync_expense_accrual(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  e        expenses%ROWTYPE;
  v_lines  jsonb := '[]'::jsonb;
  v_cost   uuid;
  v_pay    uuid;
  v_accrued boolean;
  v_receipt boolean;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_id;
  v_accrued := EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = p_id);
  IF NOT v_accrued AND EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_id) THEN
    RETURN;
  END IF;
  v_receipt := e.id IS NOT NULL AND e.expense_type = 'purchase_order' AND e.sourcing_bundle_id IS NOT NULL;
  IF e.id IS NOT NULL
     AND e.approval_status::text = 'finance_approved'
     AND NOT COALESCE(e.is_archived, false)
     AND COALESCE(e.payment_state, '') <> 'void'
     AND e.expense_type IS DISTINCT FROM 'vrf' AND e.vendor_receipt_facilitation_id IS NULL
     AND COALESCE(e.amount_etb, 0) > 0
     AND in_current_fy(e.date)
     AND (v_accrued OR v_receipt OR COALESCE(e.payment_state, '') <> 'advance')
  THEN
    v_cost := CASE WHEN v_receipt THEN coa_id('purchases_in_transit') ELSE expense_cost_account(p_id) END;
    v_pay  := expense_payable_account(e.expense_type);
    IF v_cost IS NULL THEN
      PERFORM log_posting_failure('expenses', p_id, format('Cannot record the bill: its General Ledger (category %s) has no account in the chart', e.category_id));
      RETURN;
    END IF;
    v_lines := expense_cost_lines(e, v_cost, e.amount_etb,
                 CASE WHEN v_receipt THEN 'Billed, awaiting delivery: ' ELSE '' END || COALESCE(e.item_service_description, ''))
      || jsonb_build_array(ledger_line(v_pay, -e.amount_etb,
                  'Owed' || COALESCE(' to ' || COALESCE(ledger_party_name('vendor', e.vendor_id), ledger_party_name('staff', e.paid_to_staff_id), e.vendors_name), ''),
                  e.project_id, e.vendor_id, NULL, e.paid_to_staff_id));
  END IF;
  PERFORM ledger_sync('expense_accrual', p_id, COALESCE(e.date, CURRENT_DATE),
                      'Bill approved: ' || COALESCE(e.expense_code, p_id::text), v_lines);
  IF v_receipt THEN PERFORM sync_bundle_receipt_cost(e.sourcing_bundle_id); END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('expenses', p_id, 'Recording the bill: ' || SQLERRM);
END $function$;

-- Reclaimable VAT on an order bill comes out of 1520, so the goods reach
-- cost without it.
CREATE OR REPLACE FUNCTION public.sync_expense_input_vat(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  e       expenses%ROWTYPE;
  v_vat   numeric;
  v_cost  uuid;
  v_lines jsonb := '[]'::jsonb;
  q       record;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_id;
  IF e.id IS NOT NULL AND e.expense_type = 'purchase_order' AND e.sourcing_bundle_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = p_id) THEN
    v_cost := coa_id('purchases_in_transit');
  ELSE
    SELECT l.account_id INTO v_cost
      FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id
      JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
     WHERE je.source_id = p_id AND je.source_table IN ('expense_accrual', 'expenses') AND l.debit > 0
     ORDER BY je.created_at DESC LIMIT 1;
    IF v_cost IS NULL THEN
      SELECT l.account_id INTO v_cost
        FROM expense_payments q2 JOIN journal_entries je ON je.source_table = 'expense_payments' AND je.source_id = q2.id
        JOIN journal_lines l ON l.journal_entry_id = je.id
        JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
       WHERE q2.expense_id = p_id AND l.debit > 0
       ORDER BY je.created_at DESC LIMIT 1;
    END IF;
  END IF;

  FOR q IN SELECT p.id, p.paid_date FROM expense_payments p WHERE p.expense_id = p_id LOOP
    v_lines := '[]'::jsonb;
    v_vat := NULL;
    SELECT t.vat_amount INTO v_vat FROM v_input_vat_tracker t WHERE t.part_id = q.id AND t.claimable;
    IF e.id IS NOT NULL AND COALESCE(e.in_parts, false) AND COALESCE(v_vat, 0) > 0 AND v_cost IS NOT NULL
       AND in_current_fy(COALESCE(q.paid_date, e.date)) THEN
      v_lines := jsonb_build_array(ledger_line(coa_id('input_vat'), v_vat, 'Input VAT on a tax-reviewed receipt (part payment)', e.project_id))
              || expense_cost_lines(e, v_cost, -v_vat, 'VAT is reclaimable, not a cost');
    END IF;
    PERFORM ledger_sync('expense_input_vat', q.id, COALESCE(q.paid_date, e.date, CURRENT_DATE),
                        'Input VAT: ' || COALESCE(e.expense_code, p_id::text) || ' (part payment)', v_lines, 'adjusting');
  END LOOP;

  v_lines := '[]'::jsonb;
  v_vat := NULL;
  SELECT t.vat_amount INTO v_vat FROM v_input_vat_tracker t WHERE t.expense_id = p_id AND t.part_id IS NULL AND t.claimable;
  IF e.id IS NOT NULL AND NOT COALESCE(e.in_parts, false) AND COALESCE(v_vat, 0) > 0 AND v_cost IS NOT NULL AND in_current_fy(e.date) THEN
    v_lines := jsonb_build_array(ledger_line(coa_id('input_vat'), v_vat, 'Input VAT on a tax-reviewed receipt', e.project_id))
            || expense_cost_lines(e, v_cost, -v_vat, 'VAT is reclaimable, not a cost');
  END IF;
  PERFORM ledger_sync('expense_input_vat', p_id, COALESCE(e.date, CURRENT_DATE),
                      'Input VAT: ' || COALESCE(e.expense_code, p_id::text), v_lines, 'adjusting');
  IF e.sourcing_bundle_id IS NOT NULL THEN PERFORM sync_bundle_receipt_cost(e.sourcing_bundle_id); END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('expenses', p_id, 'Input VAT: ' || SQLERRM);
END $function$;

-- ─── GRN: what arrived becomes cost (or stock) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_bundle_receipt_cost(p_bundle uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  sb sourcing_bundles%ROWTYPE; g record;
  v_live boolean; v_billed numeric; v_bill_project uuid; v_first_bill uuid;
  v_ordered numeric; v_base numeric; v_order_gross numeric; v_k numeric; v_lines jsonb;
BEGIN
  IF p_bundle IS NULL THEN RETURN; END IF;
  SELECT * INTO sb FROM sourcing_bundles WHERE id = p_bundle;
  IF sb.id IS NULL THEN RETURN; END IF;

  -- Not for an order whose bill was already costed the old way.
  v_live := NOT EXISTS (
    SELECT 1 FROM expenses e
     WHERE e.sourcing_bundle_id = p_bundle
       AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expenses' AND je.source_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expense_accrual' AND je.source_id = e.id));

  -- What was billed for the order, less reclaimable VAT.
  SELECT COALESCE(sum(e.amount_etb - COALESCE((SELECT sum(t.vat_amount) FROM v_input_vat_tracker t WHERE t.expense_id = e.id AND t.claimable), 0)), 0),
         (array_agg(e.project_id) FILTER (WHERE e.project_id IS NOT NULL))[1],
         (array_agg(e.id ORDER BY e.date, e.created_at))[1]
    INTO v_billed, v_bill_project, v_first_bill
    FROM expenses e
   WHERE e.sourcing_bundle_id = p_bundle AND e.expense_type = 'purchase_order'
     AND e.approval_status::text = 'finance_approved' AND NOT COALESCE(e.is_archived, false)
     AND COALESCE(e.payment_state, '') <> 'void' AND in_current_fy(e.date);

  -- The value the bill pays for: what was ordered, less what was refused or
  -- never came on an order paid on delivery (that bill is reduced for it).
  -- On a prepaid order the refused value stays in 1520, owed back.
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
      WITH x AS (
        SELECT CASE WHEN o.project_id IS NULL AND oi.stock_item_id IS NOT NULL THEN coa_id('stock')
                    ELSE COALESCE((SELECT c.id FROM chart_of_accounts c
                                    WHERE c.category_id = COALESCE(gi.category_id, sc.parent_category_id, ssc.parent_category_id) LIMIT 1),
                                  expense_cost_account(v_first_bill), coa_id('mixed_materials')) END AS acct,
               CASE WHEN o.project_id IS NULL AND oi.stock_item_id IS NOT NULL THEN NULL
                    ELSE COALESCE(o.project_id, v_bill_project) END AS proj,
               round((COALESCE(gi.quantity_accepted,
                               gi.quantity_received - COALESCE(gi.quantity_rejected, 0) - COALESCE(gi.quantity_damaged, 0))
                      + COALESCE(gi.quantity_damaged, 0)) * COALESCE(sbi.unit_price_actual, 0) * v_k, 2) AS amt,
               oi.item_name
          FROM goods_received_note_items gi
          JOIN sourcing_bundle_items sbi ON sbi.id = gi.sourcing_bundle_item_id
          JOIN order_items oi ON oi.id = sbi.order_item_id
          LEFT JOIN orders o ON o.id = oi.order_id
          LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
          LEFT JOIN stock_items si ON si.id = oi.stock_item_id
          LEFT JOIN sub_categories ssc ON ssc.id = si.sub_category_id
         WHERE gi.grn_id = g.id
      ), y AS (SELECT * FROM x WHERE amt > 0)
      SELECT COALESCE((SELECT jsonb_agg(ledger_line(acct, amt, 'Received: ' || COALESCE(item_name, 'goods'), proj)) FROM y), '[]'::jsonb)
          || COALESCE((SELECT jsonb_agg(ledger_line(coa_id('purchases_in_transit'), -s, 'Goods received on ' || COALESCE(g.grn_code, 'a GRN'), proj))
                         FROM (SELECT proj, sum(amt) AS s FROM y GROUP BY proj) z), '[]'::jsonb)
        INTO v_lines;
    END IF;
    PERFORM ledger_sync('grn_cost', g.id, COALESCE(g.received_at::date, CURRENT_DATE),
                        'Goods received: ' || COALESCE(g.grn_code, '') || COALESCE(' · ' || sb.bundle_code, ''), v_lines);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('sourcing_bundles', p_bundle, 'Costing goods received: ' || SQLERRM);
END $f$;

CREATE OR REPLACE FUNCTION public.trg_grn_item_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  PERFORM sync_bundle_receipt_cost((SELECT g.sourcing_bundle_id FROM goods_received_notes g WHERE g.id = COALESCE(NEW.grn_id, OLD.grn_id)));
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_zz_grn_item_cost
  AFTER INSERT OR UPDATE OR DELETE ON public.goods_received_note_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_grn_item_cost();

CREATE OR REPLACE FUNCTION public.trg_grn_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM ledger_sync('grn_cost', OLD.id, COALESCE(OLD.received_at::date, CURRENT_DATE), 'Goods received: GRN removed', '[]'::jsonb);
    PERFORM sync_bundle_receipt_cost(OLD.sourcing_bundle_id);
  ELSE
    PERFORM sync_bundle_receipt_cost(NEW.sourcing_bundle_id);
    IF NEW.sourcing_bundle_id IS DISTINCT FROM OLD.sourcing_bundle_id THEN PERFORM sync_bundle_receipt_cost(OLD.sourcing_bundle_id); END IF;
  END IF;
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_zz_grn_cost
  AFTER UPDATE OF received_at, sourcing_bundle_id OR DELETE ON public.goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION public.trg_grn_cost();

CREATE OR REPLACE FUNCTION public.trg_bundle_receipt_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  PERFORM sync_bundle_receipt_cost(NEW.id);
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_zz_bundle_receipt_cost
  AFTER UPDATE OF closed_short_at, total_value, payment_pattern ON public.sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION public.trg_bundle_receipt_cost();

-- ─── Stock issued to a project ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_stock_issue_ledger(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE s stock_issues%ROWTYPE; v_amt numeric; v_acct uuid; v_lines jsonb := '[]'::jsonb; v_item text;
BEGIN
  SELECT * INTO s FROM stock_issues WHERE id = p_id;
  v_amt := round(COALESCE(s.total_cost, s.quantity * s.unit_cost_snapshot, 0), 2);
  IF s.id IS NOT NULL AND s.reversed_at IS NULL AND s.reversal_of IS NULL AND v_amt > 0
     AND in_current_fy(COALESCE(s.issued_date, s.created_at::date)) THEN
    SELECT c.id, si.item_name INTO v_acct, v_item
      FROM stock_items si LEFT JOIN sub_categories sc ON sc.id = si.sub_category_id
      LEFT JOIN chart_of_accounts c ON c.category_id = sc.parent_category_id
     WHERE si.id = s.stock_item_id LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.trg_stock_issue_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  PERFORM sync_stock_issue_ledger(NEW.id);
  IF NEW.reversal_of IS NOT NULL THEN PERFORM sync_stock_issue_ledger(NEW.reversal_of); END IF;
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_zz_stock_issue_ledger
  AFTER INSERT OR UPDATE ON public.stock_issues
  FOR EACH ROW EXECUTE FUNCTION public.trg_stock_issue_ledger();

-- ─── Salaries shared out to projects ────────────────────────────────────────

-- Each person's paid cost for the tax month (gross and the company's
-- pension), shared over the days they were recorded on a project; a month
-- is taken as 26 working days, so time not on a project stays as overhead.
CREATE OR REPLACE FUNCTION public.sync_salary_allocation(p_y int, p_m int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_from date; v_to date; v_lines jsonb := '[]'::jsonb; v_total numeric;
BEGIN
  IF p_y IS NULL OR p_m IS NULL THEN RETURN; END IF;
  SELECT b.start_greg, b.end_greg INTO v_from, v_to FROM tax_period_bounds(p_y, p_m) b(start_greg, end_greg);
  IF in_current_fy(v_to) THEN
    WITH cost AS (
      SELECT ps.staff_id, sum(COALESCE(ps.gross_amount, 0) + COALESCE(ps.pension_employer, 0)) AS c
        FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
       WHERE p.payment_status = 'paid' AND NOT COALESCE(p.is_archived, false) AND ps.frozen_at IS NOT NULL
         AND p.tax_ec_year = p_y AND p.tax_ec_month = p_m
       GROUP BY ps.staff_id
    ), days AS (
      SELECT u.staff_id, u.project_id, sum(u.d) AS n FROM (
        SELECT a.staff_id, a.project_id, COALESCE(a.days, 1)::numeric AS d
          FROM labour_day_allocations a JOIN labour_days ld ON ld.id = a.day_id
         WHERE a.project_id IS NOT NULL AND ld.work_date BETWEEN v_from AND v_to
        UNION ALL
        SELECT sa.staff_id, sa.project_id, 1
          FROM staff_attendance sa
         WHERE sa.project_id IS NOT NULL AND sa.work_date BETWEEN v_from AND v_to
           AND NOT EXISTS (SELECT 1 FROM labour_day_allocations a JOIN labour_days ld ON ld.id = a.day_id
                            WHERE a.staff_id = sa.staff_id AND ld.work_date = sa.work_date)
      ) u GROUP BY u.staff_id, u.project_id
    ), tot AS (SELECT staff_id, sum(n) AS t FROM days GROUP BY staff_id),
    share AS (
      SELECT d.project_id, round(c.c * d.n / GREATEST(t.t, 26), 2) AS amt
        FROM days d JOIN tot t ON t.staff_id = d.staff_id JOIN cost c ON c.staff_id = d.staff_id
    ), per AS (SELECT project_id, sum(amt) AS amt FROM share GROUP BY project_id HAVING sum(amt) > 0)
    SELECT COALESCE(jsonb_agg(ledger_line(coa_id('project_salaries'), amt, 'Staff time on the project', project_id)), '[]'::jsonb),
           COALESCE(sum(amt), 0)
      INTO v_lines, v_total FROM per;
    IF v_total > 0 THEN
      v_lines := v_lines || jsonb_build_array(ledger_line(coa_id('salaries_recharged'), -v_total, 'Salaries carried by projects'));
    END IF;
  END IF;
  PERFORM ledger_sync('salary_allocation', md5('salary_allocation ' || p_y || '-' || p_m)::uuid, COALESCE(v_to, CURRENT_DATE),
                      'Salaries charged to projects: ' || ec_month_name(p_m) || ' ' || p_y, v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('salary_allocation', md5('salary_allocation ' || p_y || '-' || p_m)::uuid, SQLERRM);
END $f$;

CREATE OR REPLACE FUNCTION public.trg_payroll_salary_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  PERFORM sync_salary_allocation(NEW.tax_ec_year, NEW.tax_ec_month);
  IF (OLD.tax_ec_year, OLD.tax_ec_month) IS DISTINCT FROM (NEW.tax_ec_year, NEW.tax_ec_month) THEN
    PERFORM sync_salary_allocation(OLD.tax_ec_year, OLD.tax_ec_month);
  END IF;
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_zz_payroll_salary_allocation
  AFTER UPDATE OF payment_status, tax_ec_year, tax_ec_month, is_archived ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.trg_payroll_salary_allocation();

-- A day put on a project changes that month's share.
CREATE OR REPLACE FUNCTION public.trg_project_day_salary_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_date date; t record;
BEGIN
  IF TG_TABLE_NAME = 'labour_day_allocations' THEN
    SELECT ld.work_date INTO v_date FROM labour_days ld WHERE ld.id = COALESCE(NEW.day_id, OLD.day_id);
  ELSE
    v_date := COALESCE(NEW.work_date, OLD.work_date);
  END IF;
  IF v_date IS NOT NULL AND EXISTS (SELECT 1 FROM payroll_staff ps WHERE ps.staff_id = COALESCE(NEW.staff_id, OLD.staff_id)) THEN
    SELECT * INTO t FROM tax_period_for_date(v_date) x(ec_year, ec_month);
    PERFORM sync_salary_allocation(t.ec_year, t.ec_month);
  END IF;
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_zz_salary_allocation_days
  AFTER INSERT OR UPDATE OR DELETE ON public.labour_day_allocations
  FOR EACH ROW EXECUTE FUNCTION public.trg_project_day_salary_allocation();
CREATE OR REPLACE TRIGGER trg_zz_salary_allocation_attendance
  AFTER INSERT OR UPDATE OF project_id, work_date OR DELETE ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.trg_project_day_salary_allocation();

-- ─── What is awaiting delivery, order by order ──────────────────────────────

CREATE OR REPLACE VIEW public.v_purchases_awaiting_delivery WITH (security_invoker = on) AS
WITH t AS (
  SELECT COALESCE(e.sourcing_bundle_id, ep_e.sourcing_bundle_id, g.sourcing_bundle_id) AS bundle_id,
         l.project_id, (l.debit - l.credit) AS amt
    FROM journal_lines l
    JOIN chart_of_accounts c ON c.id = l.account_id AND c.system_key = 'purchases_in_transit'
    JOIN journal_entries je ON je.id = l.journal_entry_id
    LEFT JOIN expenses e ON je.source_table IN ('expense_accrual', 'expense_input_vat') AND e.id = je.source_id
    LEFT JOIN expense_payments ep ON je.source_table = 'expense_input_vat' AND ep.id = je.source_id
    LEFT JOIN expenses ep_e ON ep_e.id = ep.expense_id
    LEFT JOIN goods_received_notes g ON je.source_table = 'grn_cost' AND g.id = je.source_id
)
SELECT t.bundle_id, sb.bundle_code, COALESCE(v.vendor_name, sb.vendor_name) AS vendor_name, t.project_id, p.project_name,
       sb.payment_pattern, sb.status::text AS order_status,
       round(COALESCE(sum(t.amt) FILTER (WHERE t.amt > 0), 0), 2) AS billed,
       round(COALESCE(-sum(t.amt) FILTER (WHERE t.amt < 0), 0), 2) AS received,
       round(sum(t.amt), 2) AS awaiting,
       (SELECT min(e.date) FROM expenses e WHERE e.sourcing_bundle_id = t.bundle_id AND e.approval_status::text = 'finance_approved') AS billed_on,
       (SELECT bool_or(e.payment_state IN ('paid', 'advance')) FROM expenses e WHERE e.sourcing_bundle_id = t.bundle_id) AS paid,
       (SELECT max(g.received_at)::date FROM goods_received_notes g WHERE g.sourcing_bundle_id = t.bundle_id) AS last_received_on,
       (SELECT string_agg(e.expense_code, ', ') FROM expenses e WHERE e.sourcing_bundle_id = t.bundle_id AND e.approval_status::text = 'finance_approved') AS bills
  FROM t
  JOIN sourcing_bundles sb ON sb.id = t.bundle_id
  LEFT JOIN vendors v ON v.id = sb.vendor_id
  LEFT JOIN projects p ON p.id = t.project_id
 GROUP BY t.bundle_id, sb.bundle_code, v.vendor_name, sb.vendor_name, t.project_id, p.project_name, sb.payment_pattern, sb.status
HAVING abs(sum(t.amt)) >= 1;
GRANT SELECT ON public.v_purchases_awaiting_delivery TO authenticated;

-- ─── The project page reads the ledger ──────────────────────────────────────

CREATE OR REPLACE VIEW public.v_project_cost_group_budget WITH (security_invoker = on) AS
 WITH grp AS (
         SELECT (SELECT id FROM cost_groups WHERE name = 'Materials') AS materials,
                (SELECT id FROM cost_groups WHERE name = 'Labor') AS labor,
                (SELECT id FROM cost_groups WHERE name = 'Overhead') AS overhead
        ), budgets AS (
         SELECT pb.project_id, pb.cost_group_id, pb.budgeted_amount
           FROM project_budgets pb
             JOIN projects p ON p.id = pb.project_id AND p.budget_version = pb.version
        ), ledger_actual AS (
         -- Cost booked against the project in the ledger.
         SELECT l.project_id,
                COALESCE(cat.cost_group_id,
                         CASE WHEN c.system_key = 'project_salaries' THEN grp.labor
                              WHEN c.account_code LIKE '5%' THEN grp.materials
                              ELSE grp.overhead END) AS cost_group_id,
                (l.debit - l.credit) AS actual_amount, 0::numeric AS committed_amount
           FROM journal_lines l
             JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
             LEFT JOIN categories cat ON cat.id = c.category_id
             CROSS JOIN grp
          WHERE l.project_id IS NOT NULL
        ), in_transit AS (
         -- Billed or paid for, not yet received.
         SELECT x.project_id, grp.materials AS cost_group_id, 0::numeric AS actual_amount, GREATEST(sum(x.amt), 0) AS committed_amount
           FROM (SELECT l.project_id, (l.debit - l.credit) AS amt
                   FROM journal_lines l JOIN chart_of_accounts c ON c.id = l.account_id AND c.system_key = 'purchases_in_transit'
                  WHERE l.project_id IS NOT NULL) x CROSS JOIN grp
          GROUP BY x.project_id, grp.materials
        ), on_order AS (
         -- Ordered, not billed, not yet received.
         SELECT r.project_id, COALESCE(cat.cost_group_id, grp.materials) AS cost_group_id, 0::numeric AS actual_amount,
                (GREATEST(COALESCE(r.outstanding, 0), 0) * COALESCE(r.unit_price_actual, 0)) AS committed_amount
           FROM v_bundle_line_receipts r
             JOIN sourcing_bundles sb ON sb.id = r.bundle_id
             JOIN sourcing_bundle_items sbi ON sbi.id = r.bundle_item_id
             JOIN order_items oi ON oi.id = sbi.order_item_id
             LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
             LEFT JOIN categories cat ON cat.id = sc.parent_category_id
             CROSS JOIN grp
          WHERE sb.status = ANY (ARRAY['ordered'::sourcing_bundle_status, 'fulfilled'::sourcing_bundle_status])
            AND sb.closed_short_at IS NULL AND r.project_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.sourcing_bundle_id = sb.id AND e.approval_status::text = 'finance_approved'
                              AND NOT COALESCE(e.is_archived, false) AND COALESCE(e.payment_state, '') <> 'void')
        ), bills_in_approval AS (
         -- Bills an executive has approved that finance has not yet.
         SELECT e.project_id, cat.cost_group_id, 0::numeric AS actual_amount, COALESCE(e.amount_etb, 0) AS committed_amount
           FROM expenses e LEFT JOIN categories cat ON cat.id = e.category_id
          WHERE e.project_id IS NOT NULL AND e.approval_status::text = 'manager_approved'
            AND NOT COALESCE(e.is_archived, false) AND COALESCE(e.payment_state, '') <> 'void'
        ), labor_allocation_committed AS (
         SELECT la.project_id, grp.labor AS cost_group_id, 0::numeric AS actual_amount,
                (GREATEST(((COALESCE(la.end_date, CURRENT_DATE) - la.start_date) + 1) - COALESCE((SELECT count(*) FROM timesheet t
                    WHERE t.staff_id = la.staff_id AND t.project_id = la.project_id AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL
                      AND t.date >= la.start_date AND t.date <= COALESCE(la.end_date, CURRENT_DATE)), 0), 0)::numeric
                 * COALESCE(la.day_rate_snapshot, 0)) AS committed_amount
           FROM labor_allocations la CROSS JOIN grp
          WHERE la.status = ANY (ARRAY['planned'::text, 'active'::text]) AND la.project_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM labor_requisitions lr WHERE lr.id = la.labor_requisition_id AND lr.status = 'approved'::text)
        ), timesheet_unbilled AS (
         -- Days worked that no bill covers yet.
         SELECT t.project_id, grp.labor AS cost_group_id, 0::numeric AS actual_amount,
                COALESCE(staff_effective_day_rate(t.staff_id), 0) AS committed_amount
           FROM timesheet t CROSS JOIN grp
          WHERE t.project_id IS NOT NULL AND t.check_in_time IS NOT NULL AND t.check_out_time IS NOT NULL AND t.rolled_up_expense_id IS NULL
        ), labor_requisition_committed AS (
         -- Approved labour not yet billed: day work by days × rate, piece work by volume × unit rate.
         SELECT lr.project_id, grp.labor AS cost_group_id, 0::numeric AS actual_amount,
                GREATEST(COALESCE(lr.estimated_total_cost,
                                  lr.estimated_total_volume * lr.unit_rate,
                                  lr.estimated_days * lr.estimated_day_rate * COALESCE(lr.headcount, 1), 0)
                         - COALESCE((SELECT sum(e.amount_etb) FROM expenses e
                                      WHERE (e.rolled_up_from_requisition_id = lr.id
                                             OR e.id IN (SELECT ps.expense_id FROM labour_pay_sheets ps WHERE ps.labor_requisition_id = lr.id))
                                        AND NOT COALESCE(e.is_archived, false)
                                        AND (e.payment_status OR e.partially_paid
                                             OR e.approval_status = ANY (ARRAY['manager_approved'::expense_approval_status, 'finance_approved'::expense_approval_status]))), 0), 0) AS committed_amount
           FROM labor_requisitions lr CROSS JOIN grp
          WHERE lr.status = 'approved'::text
        ), subcontract_engagement_committed AS (
         SELECT se.project_id, se.cost_group_id, 0::numeric AS actual_amount,
                GREATEST(se.agreed_amount - COALESCE(spent.total, 0), 0) AS committed_amount
           FROM subcontractor_engagements se
             LEFT JOIN (SELECT expenses.subcontractor_engagement_id, sum(COALESCE(expenses.amount_etb, 0)) AS total
                          FROM expenses WHERE expenses.subcontractor_engagement_id IS NOT NULL
                         GROUP BY expenses.subcontractor_engagement_id) spent ON spent.subcontractor_engagement_id = se.id
          WHERE se.status = ANY (ARRAY['agreed'::text, 'in_progress'::text]) AND se.project_id IS NOT NULL
        ), combined AS (
         SELECT u.project_id, u.cost_group_id, sum(u.actual_amount) AS actual_amount, sum(u.committed_amount) AS committed_amount
           FROM (SELECT * FROM ledger_actual
                 UNION ALL SELECT * FROM in_transit
                 UNION ALL SELECT * FROM on_order
                 UNION ALL SELECT * FROM bills_in_approval
                 UNION ALL SELECT * FROM labor_allocation_committed
                 UNION ALL SELECT * FROM timesheet_unbilled
                 UNION ALL SELECT * FROM labor_requisition_committed
                 UNION ALL SELECT * FROM subcontract_engagement_committed) u
          GROUP BY u.project_id, u.cost_group_id
        ), per_group AS (
         SELECT p.id AS project_id, g.id AS cost_group_id, g.name AS cost_group_name, g.sort_order,
                COALESCE(b.budgeted_amount, 0) AS budgeted_amount,
                COALESCE(c.actual_amount, 0) AS actual_amount,
                COALESCE(c.committed_amount, 0) AS committed_amount
           FROM projects p
             CROSS JOIN cost_groups g
             LEFT JOIN budgets b ON b.project_id = p.id AND b.cost_group_id = g.id
             LEFT JOIN combined c ON c.project_id = p.id AND c.cost_group_id = g.id
        UNION ALL
         SELECT p.id, NULL::uuid, 'Unallocated'::text, 999, 0::numeric,
                COALESCE(c.actual_amount, 0), COALESCE(c.committed_amount, 0)
           FROM projects p JOIN combined c ON c.project_id = p.id AND c.cost_group_id IS NULL
          WHERE COALESCE(c.actual_amount, 0) <> 0 OR COALESCE(c.committed_amount, 0) <> 0
        )
 SELECT project_id, cost_group_id, cost_group_name, sort_order, budgeted_amount, actual_amount, committed_amount,
        ((budgeted_amount - actual_amount) - committed_amount) AS remaining_amount,
        ((actual_amount + committed_amount) > budgeted_amount) AS over_budget,
        false AS is_provisional
   FROM per_group;

-- ─── Who may call what ──────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.sync_bundle_receipt_cost(uuid), public.sync_stock_issue_ledger(uuid),
                       public.sync_salary_allocation(int, int) FROM PUBLIC, anon, authenticated;

-- ─── This year's bills, goods and salaries under the new rules ──────────────

DO $backfill$
DECLARE r record;
BEGIN
  -- Order bills: from cost to 1520 (and their reclaimable VAT with them).
  FOR r IN SELECT e.id FROM expenses e
            WHERE e.expense_type = 'purchase_order' AND e.sourcing_bundle_id IS NOT NULL AND in_current_fy(e.date)
              AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'expense_accrual' AND je.source_id = e.id) LOOP
    PERFORM sync_expense_accrual(r.id);
    PERFORM sync_expense_input_vat(r.id);
  END LOOP;
  -- Everything received this year, including orders not yet billed.
  FOR r IN SELECT DISTINCT g.sourcing_bundle_id AS b FROM goods_received_notes g
            WHERE g.sourcing_bundle_id IS NOT NULL AND in_current_fy(g.received_at::date) LOOP
    PERFORM sync_bundle_receipt_cost(r.b);
  END LOOP;
  FOR r IN SELECT id FROM stock_issues LOOP
    PERFORM sync_stock_issue_ledger(r.id);
  END LOOP;
  FOR r IN SELECT DISTINCT tax_ec_year AS y, tax_ec_month AS m FROM payroll WHERE payment_status = 'paid' AND tax_ec_year IS NOT NULL LOOP
    PERFORM sync_salary_allocation(r.y, r.m);
  END LOOP;
END $backfill$;
