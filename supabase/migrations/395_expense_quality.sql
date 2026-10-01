-- 395 — Expenses that arrive complete
--
-- This fiscal year (392 expenses): 167 had no project, 74 named the payee
-- in free text only, 47 had no general ledger, none had a receipt
-- attached, and 112 waited over two weeks for approval. The form checked
-- nothing; the pages that raise expenses for fuel, transport, repairs and
-- purchase orders left the gaps in.
--
--   • is_overhead — "no project" becomes a choice, not a blank: company
--     overhead. Fuel, repairs and rent default to it.
--   • The database refuses an expense with no amount or description, and a
--     typed-in (general) one with no project/overhead or no payee.
--   • Finance cannot approve one with no project/overhead or no ledger
--     account to post to.
--   • A receipt photo marked as a VAT receipt opens the tax review by
--     itself (vendor_receipts, pending verification): the input VAT on it
--     becomes claimable once verified and tax-reviewed.
--   • Sources fill what they know: a transport job's project, a repair's
--     garage, and a purchase order bought for several projects posts its
--     cost split across them, by line.
--   • expense_issues() names what is missing on any expense; the approval
--     queue and the fixer read it. A finance user can dismiss an issue
--     that doesn't apply ("this vendor gives no receipt").

SET search_path TO public;

-- ── Columns ─────────────────────────────────────────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS is_overhead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_is_vat boolean,
  ADD COLUMN IF NOT EXISTS receipt_no text,
  ADD COLUMN IF NOT EXISTS receipt_vat_amount numeric CHECK (receipt_vat_amount IS NULL OR receipt_vat_amount >= 0);
COMMENT ON COLUMN expenses.is_overhead IS 'No project on purpose: company overhead (395).';
COMMENT ON COLUMN expenses.receipt_is_vat IS 'The attached receipt is a VAT invoice (true), a plain receipt (false), or not said (395).';

ALTER TABLE vehicle_maintenance_requests ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL;
COMMENT ON COLUMN vehicle_maintenance_requests.vendor_id IS 'The garage that did the work; carried to the expense (395).';

ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS from_expense_form boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS expense_issue_dismissals (
  expense_id   uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  issue        text NOT NULL CHECK (issue IN ('no_receipt', 'typed_payee', 'possible_duplicate', 'vague_ledger')),
  note         text,
  dismissed_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (expense_id, issue)
);
ALTER TABLE expense_issue_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_issue_dismissals_read ON expense_issue_dismissals;
CREATE POLICY expense_issue_dismissals_read ON expense_issue_dismissals FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS expense_issue_dismissals_write ON expense_issue_dismissals;
CREATE POLICY expense_issue_dismissals_write ON expense_issue_dismissals FOR ALL
  USING (COALESCE(get_user_role() IN ('admin', 'finance'), false))
  WITH CHECK (COALESCE(get_user_role() IN ('admin', 'finance'), false));

-- ── Overhead by default where a project never applies ───────────────
CREATE OR REPLACE FUNCTION public.trg_expense_overhead_default()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    NEW.is_overhead := false;
  ELSIF TG_OP = 'INSERT' AND NEW.expense_type IN ('fuel', 'maintenance', 'property_rent') THEN
    NEW.is_overhead := true;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_expense_overhead_default ON expenses;
CREATE TRIGGER trg_expense_overhead_default BEFORE INSERT OR UPDATE OF project_id, is_overhead ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_expense_overhead_default();

-- ── The basics, enforced ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_expense_basics()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.amount_etb IS DISTINCT FROM OLD.amount_etb) AND COALESCE(NEW.amount_etb, 0) <= 0 THEN
    RAISE EXCEPTION 'Enter the amount — it must be more than 0';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.item_service_description IS DISTINCT FROM OLD.item_service_description)
     AND btrim(COALESCE(NEW.item_service_description, '')) = '' THEN
    RAISE EXCEPTION 'Say what the expense is for';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.date IS DISTINCT FROM OLD.date) AND NEW.date IS NULL THEN
    RAISE EXCEPTION 'Enter the date of the expense';
  END IF;
  -- Typed in by a person (not raised by a source page or a split).
  IF TG_OP = 'INSERT' AND NEW.expense_type = 'general' AND NEW.split_parent_id IS NULL THEN
    IF NEW.project_id IS NULL AND NOT NEW.is_overhead THEN
      RAISE EXCEPTION 'Pick the project this is for, or mark it company overhead';
    END IF;
    IF NEW.vendor_id IS NULL AND NEW.paid_to_staff_id IS NULL AND btrim(COALESCE(NEW.vendors_name, '')) = '' THEN
      RAISE EXCEPTION 'Say who is paid — a vendor or a staff member';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_expense_basics ON expenses;
CREATE TRIGGER trg_expense_basics BEFORE INSERT OR UPDATE OF amount_etb, item_service_description, date ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_expense_basics();

-- ── A purchase order bought for several projects ────────────────────
-- Its value by project, from the PO lines; the remainder of rounding goes
-- to the largest share so the parts add up to p_amount exactly.
CREATE OR REPLACE FUNCTION public.po_project_split(p_bundle uuid, p_amount numeric)
RETURNS TABLE (project_id uuid, amount numeric) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH lines AS (
    SELECT o.project_id, sum(COALESCE(sbi.quantity_actual, 0) * COALESCE(sbi.unit_price_actual, 0)) AS v
      FROM sourcing_bundle_items sbi
      JOIN order_items oi ON oi.id = sbi.order_item_id
      JOIN orders o ON o.id = oi.order_id
     WHERE sbi.bundle_id = p_bundle
     GROUP BY o.project_id),
  tot AS (SELECT sum(v) AS t FROM lines),
  r AS (SELECT l.project_id, round(p_amount * l.v / t.t, 2) AS a, row_number() OVER (ORDER BY l.v DESC, l.project_id) AS rn
          FROM lines l CROSS JOIN tot t WHERE t.t > 0 AND l.v > 0)
  SELECT r.project_id, r.a + CASE WHEN r.rn = 1 THEN p_amount - sum(r.a) OVER () ELSE 0 END FROM r
$$;

CREATE OR REPLACE FUNCTION public.po_has_line_projects(p_bundle uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT p_bundle IS NOT NULL AND EXISTS (SELECT 1 FROM po_project_split(p_bundle, 1) s WHERE s.project_id IS NOT NULL)
$$;

-- The cost side of an expense as ledger lines: one line, or one per
-- project for a purchase order with no single project.
CREATE OR REPLACE FUNCTION public.expense_cost_lines(e expenses, p_account uuid, p_amount numeric, p_notes text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE v jsonb;
BEGIN
  IF e.expense_type = 'purchase_order' AND e.project_id IS NULL AND po_has_line_projects(e.sourcing_bundle_id) THEN
    SELECT jsonb_agg(ledger_line(p_account, s.amount, p_notes, s.project_id)) INTO v
      FROM po_project_split(e.sourcing_bundle_id, p_amount) s WHERE s.amount <> 0;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  RETURN jsonb_build_array(ledger_line(p_account, p_amount, p_notes, e.project_id));
END $function$;

CREATE OR REPLACE FUNCTION public.sync_expense_accrual(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  e        expenses%ROWTYPE;
  v_lines  jsonb := '[]'::jsonb;
  v_cost   uuid;
  v_pay    uuid;
  v_accrued boolean;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_id;
  v_accrued := EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = p_id);
  IF NOT v_accrued AND EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_id) THEN
    RETURN;
  END IF;
  IF e.id IS NOT NULL
     AND e.approval_status::text = 'finance_approved'
     AND NOT COALESCE(e.is_archived, false)
     AND COALESCE(e.payment_state, '') <> 'void'
     AND e.expense_type IS DISTINCT FROM 'vrf' AND e.vendor_receipt_facilitation_id IS NULL
     AND COALESCE(e.amount_etb, 0) > 0
     AND in_current_fy(e.date)
     AND (v_accrued OR COALESCE(e.payment_state, '') <> 'advance')
  THEN
    v_cost := expense_cost_account(p_id);
    v_pay  := expense_payable_account(e.expense_type);
    IF v_cost IS NULL THEN
      PERFORM log_posting_failure('expenses', p_id, format('Cannot record the bill: its General Ledger (category %s) has no account in the chart', e.category_id));
      RETURN;
    END IF;
    v_lines := expense_cost_lines(e, v_cost, e.amount_etb, e.item_service_description)
      || jsonb_build_array(ledger_line(v_pay, -e.amount_etb,
                  'Owed' || COALESCE(' to ' || COALESCE(ledger_party_name('vendor', e.vendor_id), ledger_party_name('staff', e.paid_to_staff_id), e.vendors_name), ''),
                  e.project_id, e.vendor_id, NULL, e.paid_to_staff_id));
  END IF;
  PERFORM ledger_sync('expense_accrual', p_id, COALESCE(e.date, CURRENT_DATE),
                      'Bill approved: ' || COALESCE(e.expense_code, p_id::text), v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('expenses', p_id, 'Recording the bill: ' || SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.sync_expense_input_vat(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  e       expenses%ROWTYPE;
  v_vat   numeric;
  v_cost  uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_id;
  SELECT t.vat_amount INTO v_vat FROM v_input_vat_tracker t WHERE t.expense_id = p_id AND t.claimable;
  SELECT l.account_id INTO v_cost
    FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id
    JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
   WHERE je.source_table IN ('expense_accrual', 'expenses') AND je.source_id = p_id AND l.debit > 0
   ORDER BY je.created_at DESC LIMIT 1;
  IF e.id IS NOT NULL AND COALESCE(v_vat, 0) > 0 AND v_cost IS NOT NULL AND in_current_fy(e.date) THEN
    v_lines := jsonb_build_array(ledger_line(coa_id('input_vat'), v_vat, 'Input VAT on a tax-reviewed receipt', e.project_id))
            || expense_cost_lines(e, v_cost, -v_vat, 'VAT is reclaimable, not a cost');
  END IF;
  PERFORM ledger_sync('expense_input_vat', p_id, COALESCE(e.date, CURRENT_DATE),
                      'Input VAT: ' || COALESCE(e.expense_code, p_id::text), v_lines, 'adjusting');
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('expenses', p_id, 'Input VAT: ' || SQLERRM);
END $function$;

-- ── What's missing on an expense ────────────────────────────────────
--   no_project        no project and not marked overhead
--   no_ledger         nothing to post the cost to
--   no_payee          nobody named as paid
--   typed_payee       the payee is free text, not a vendor or staff member
--   vague_ledger      filed under Multiple/Misc where one ledger would do
--   no_receipt        paid, and no receipt photo
--   no_bank_ref       paid by transfer with no bank reference
--   possible_duplicate same payee, same amount, within 3 days
CREATE OR REPLACE FUNCTION public.expense_issues(e expenses)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(i) FILTER (WHERE i IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM expense_issue_dismissals d WHERE d.expense_id = e.id AND d.issue = i)), '{}')
  FROM unnest(ARRAY[
    CASE WHEN e.project_id IS NULL AND NOT e.is_overhead
          AND NOT (e.expense_type = 'purchase_order' AND po_has_line_projects(e.sourcing_bundle_id)) THEN 'no_project' END,
    -- Read from the row as given (not the stored one), so a ledger picked in
    -- the same save as the approval counts.
    CASE WHEN e.expense_type IS DISTINCT FROM 'vrf' AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts c
       WHERE c.category_id = CASE WHEN e.expense_type = 'purchase_order'
                                  THEN COALESCE(resolve_po_posting_category(e.sourcing_bundle_id), e.category_id)
                                  ELSE e.category_id END) THEN 'no_ledger' END,
    CASE WHEN e.vendor_id IS NULL AND e.paid_to_staff_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM labor_expense_workers w WHERE w.expense_id = e.id)
         THEN CASE WHEN btrim(COALESCE(e.vendors_name, '')) <> '' THEN 'typed_payee' ELSE 'no_payee' END END,
    CASE WHEN e.expense_type IS DISTINCT FROM 'purchase_order'
          AND EXISTS (SELECT 1 FROM categories c WHERE c.id = e.category_id AND c.category_name IN ('Multiple', 'PETTY'))
         THEN 'vague_ledger' END,
    CASE WHEN e.receipt_url IS NULL AND e.payment_state IN ('paid', 'sent')
          AND e.expense_type IS DISTINCT FROM 'labor_payment' AND COALESCE(e.receipt_available, '') <> 'No'
          AND NOT EXISTS (SELECT 1 FROM vendor_receipts r WHERE r.expense_id = e.id AND r.document_url IS NOT NULL) THEN 'no_receipt' END,
    CASE WHEN e.payment_state = 'paid' AND e.payment_method = 'transfer' AND btrim(COALESCE(e.bank_ref, '')) = '' THEN 'no_bank_ref' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM expenses o
       WHERE o.id <> e.id AND NOT COALESCE(o.is_archived, false)
         AND o.amount_etb = e.amount_etb AND abs(o.date - e.date) <= 3
         AND o.split_parent_id IS DISTINCT FROM e.id AND e.split_parent_id IS DISTINCT FROM o.id
         AND (   (e.vendor_id IS NOT NULL AND o.vendor_id = e.vendor_id)
              OR (e.paid_to_staff_id IS NOT NULL AND o.paid_to_staff_id = e.paid_to_staff_id)
              OR (e.vendor_id IS NULL AND btrim(COALESCE(e.vendors_name, '')) <> '' AND lower(btrim(o.vendors_name)) = lower(btrim(e.vendors_name))))
    ) THEN 'possible_duplicate' END
  ]) AS i
$$;

-- Every expense this year with something missing.
CREATE OR REPLACE VIEW public.v_expense_issues WITH (security_invoker = true) AS
SELECT e.id, e.expense_code, e.date, e.created_at, e.amount_etb, e.expense_type, e.item_service_description,
       e.project_id, p.project_name, e.is_overhead, e.category_id, c.category_name,
       e.vendor_id, v.vendor_name, e.vendors_name, e.paid_to_staff_id, e.approval_status, e.payment_state, e.payment_method,
       e.receipt_url, e.bank_ref, e.purchaser_user_id, e.sourcing_bundle_id, i.issues
  FROM expenses e
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN vendors v ON v.id = e.vendor_id
  CROSS JOIN LATERAL (SELECT expense_issues(e) AS issues) i
 WHERE NOT COALESCE(e.is_archived, false) AND e.date >= financials_cutover_date()
   AND cardinality(i.issues) > 0;

-- What is waiting for approval, oldest first, and what holds it up.
CREATE OR REPLACE VIEW public.v_expense_approval_queue WITH (security_invoker = true) AS
SELECT e.id, e.expense_code, e.date, e.created_at, (CURRENT_DATE - e.created_at::date) AS age_days,
       e.amount_etb, e.expense_type, e.item_service_description,
       e.project_id, p.project_name, e.is_overhead, e.category_id, c.category_name,
       e.vendor_id, COALESCE(v.vendor_name, s.employee_name, e.vendors_name) AS payee_name,
       e.purchaser_user_id, up.full_name AS requested_by_name, e.receipt_url, e.approval_status,
       expense_issues(e) AS issues
  FROM expenses e
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN staff s ON s.id = e.paid_to_staff_id
  LEFT JOIN user_profiles up ON up.id = e.purchaser_user_id
 WHERE e.approval_status IN ('pending', 'manager_approved')
   AND NOT COALESCE(e.is_archived, false) AND e.date >= financials_cutover_date();

REVOKE EXECUTE ON FUNCTION expense_issues(expenses), po_project_split(uuid, numeric), po_has_line_projects(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION expense_issues(expenses), po_project_split(uuid, numeric), po_has_line_projects(uuid) TO authenticated;
GRANT SELECT ON v_expense_issues, v_expense_approval_queue TO authenticated;

-- ── No approval without a project and a ledger ──────────────────────
CREATE OR REPLACE FUNCTION public.trg_expense_approval_needs_basics()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_issues text[];
BEGIN
  IF NEW.approval_status::text = 'finance_approved' AND OLD.approval_status::text IS DISTINCT FROM 'finance_approved'
     AND NEW.date >= financials_cutover_date() THEN
    v_issues := expense_issues(NEW);
    IF 'no_project' = ANY (v_issues) THEN
      RAISE EXCEPTION '% has no project — pick one, or mark it company overhead, then approve', COALESCE(NEW.expense_code, 'This expense');
    END IF;
    IF 'no_ledger' = ANY (v_issues) THEN
      RAISE EXCEPTION '% has no general ledger to post to — pick one, then approve', COALESCE(NEW.expense_code, 'This expense');
    END IF;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_expense_approval_needs_basics ON expenses;
CREATE TRIGGER trg_expense_approval_needs_basics BEFORE UPDATE OF approval_status ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_expense_approval_needs_basics();

-- ── A VAT receipt photo starts the tax review ───────────────────────
CREATE OR REPLACE FUNCTION public.trg_expense_receipt_to_vat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r vendor_receipts%ROWTYPE;
BEGIN
  SELECT * INTO r FROM vendor_receipts WHERE expense_id = NEW.id ORDER BY created_at DESC LIMIT 1;
  IF NEW.receipt_url IS NOT NULL AND NEW.receipt_is_vat THEN
    IF r.id IS NULL THEN
      INSERT INTO vendor_receipts (expense_id, vendor_id, project_id, receipt_no, receipt_date, vat_amount,
                                   document_url, document_name, notes, from_expense_form)
      VALUES (NEW.id, NEW.vendor_id, NEW.project_id, NULLIF(btrim(NEW.receipt_no), ''), NEW.date, NEW.receipt_vat_amount,
              NEW.receipt_url, NEW.receipt_name, 'Attached on the expense', true);
    ELSIF r.from_expense_form AND r.status = 'pending_verification' THEN
      UPDATE vendor_receipts
         SET vendor_id = NEW.vendor_id, project_id = NEW.project_id, receipt_no = NULLIF(btrim(NEW.receipt_no), ''),
             receipt_date = NEW.date, vat_amount = NEW.receipt_vat_amount,
             document_url = NEW.receipt_url, document_name = NEW.receipt_name
       WHERE id = r.id;
    END IF;
    INSERT INTO input_vat_items (expense_id, vat_applicable, updated_by, updated_at)
    VALUES (NEW.id, true, auth.uid(), now())
    ON CONFLICT (expense_id) DO UPDATE SET vat_applicable = true WHERE input_vat_items.vat_applicable IS NULL;
  ELSE
    -- Not (or no longer) a VAT receipt: drop the draft review it opened.
    IF r.id IS NOT NULL AND r.from_expense_form AND r.status = 'pending_verification' THEN
      DELETE FROM vendor_receipts WHERE id = r.id;
    END IF;
    IF NEW.receipt_url IS NOT NULL AND NEW.receipt_is_vat IS FALSE THEN
      INSERT INTO input_vat_items (expense_id, vat_applicable, updated_by, updated_at)
      VALUES (NEW.id, false, auth.uid(), now())
      ON CONFLICT (expense_id) DO UPDATE SET vat_applicable = false WHERE input_vat_items.vat_applicable IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_expense_receipt_to_vat ON expenses;
CREATE TRIGGER trg_expense_receipt_to_vat
  AFTER INSERT OR UPDATE OF receipt_url, receipt_name, receipt_is_vat, receipt_no, receipt_vat_amount, vendor_id, project_id, date ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_expense_receipt_to_vat();

-- A receipt that came in on the expense form was entered by the requester,
-- who is usually outside finance and procurement: either desk may verify
-- it. Still three different people before it counts.
CREATE OR REPLACE FUNCTION public.enforce_vendor_receipt_maker_checker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_maker_role      TEXT;
  v_checker_role    TEXT;
  v_reviewer_is_tax BOOLEAN;
  v_reviewer_role   TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.entered_by := auth.uid();
    NEW.entered_at := NOW();
    NEW.status     := 'pending_verification';
    NEW.verified_by := NULL; NEW.verified_at := NULL;
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected') THEN
    NEW.verified_by := auth.uid();
    NEW.verified_at := NOW();

    IF NEW.verified_by = NEW.entered_by THEN
      RAISE EXCEPTION 'The same person cannot both enter and verify a vendor receipt';
    END IF;

    SELECT role INTO v_maker_role   FROM user_profiles WHERE id = NEW.entered_by;
    SELECT role INTO v_checker_role FROM user_profiles WHERE id = NEW.verified_by;

    IF NOT (
      (v_maker_role IN ('finance', 'admin') AND v_checker_role IN ('procurement_officer', 'admin'))
      OR (v_maker_role IN ('procurement_officer', 'admin') AND v_checker_role IN ('finance', 'admin'))
      OR (NEW.from_expense_form AND COALESCE(v_maker_role, '') NOT IN ('finance', 'procurement_officer', 'admin')
          AND v_checker_role IN ('finance', 'procurement_officer', 'admin'))
    ) THEN
      RAISE EXCEPTION 'A vendor receipt must be verified by someone from a different department than whoever entered it (one finance, one procurement)';
    END IF;

  ELSIF OLD.status = 'verified' AND NEW.status IN ('tax_reviewed', 'rejected') THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := NOW();

    SELECT is_tax_officer, role INTO v_reviewer_is_tax, v_reviewer_role
    FROM user_profiles WHERE id = NEW.reviewed_by;

    IF NOT (COALESCE(v_reviewer_is_tax, false) OR v_reviewer_role = 'admin') THEN
      RAISE EXCEPTION 'Only the designated Tax Officer (or an admin standing in) can accept a receipt into a tax filing';
    END IF;

    IF NEW.reviewed_by = NEW.entered_by OR NEW.reviewed_by = NEW.verified_by THEN
      RAISE EXCEPTION 'Tax review must be done by someone other than the person who entered or verified the receipt';
    END IF;

  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Invalid vendor receipt status transition from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END $function$;

-- ── Sources fill what they know ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_create_maintenance_expense()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_vehicle_name TEXT;
  v_category_id  UUID;
  v_expense_id   UUID;
BEGIN
  IF NEW.status = 'completed' AND NEW.actual_cost IS NOT NULL AND NEW.expense_id IS NULL THEN
    SELECT name INTO v_vehicle_name FROM vehicles WHERE id = NEW.vehicle_id;
    SELECT id INTO v_category_id FROM categories WHERE category_name = 'Transportation';

    INSERT INTO expenses (
      item_service_description, amount_etb, date, expense_type,
      category_id, vehicle_id, vendor_id, purchaser_user_id, requested
    ) VALUES (
      'Vehicle maintenance — ' || COALESCE(v_vehicle_name, 'vehicle') || ': ' || NEW.issue_description,
      NEW.actual_cost, COALESCE(NEW.completed_at::date, CURRENT_DATE), 'maintenance',
      v_category_id, NEW.vehicle_id, NEW.vendor_id, NEW.requested_by, true
    ) RETURNING id INTO v_expense_id;

    NEW.expense_id := v_expense_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_create_penalty_expense()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_vehicle_name TEXT;
  v_category_id  UUID;
  v_expense_id   UUID;
BEGIN
  SELECT name INTO v_vehicle_name FROM vehicles WHERE id = NEW.vehicle_id;
  SELECT id INTO v_category_id FROM categories WHERE category_name = 'Penalty';
  IF v_category_id IS NULL THEN
    SELECT id INTO v_category_id FROM categories WHERE category_name = 'Transportation';
  END IF;

  INSERT INTO expenses (
    item_service_description, amount_etb, date, expense_type,
    category_id, vehicle_id, vendors_name, requested
  ) VALUES (
    'Vehicle penalty — ' || COALESCE(v_vehicle_name, 'vehicle') || COALESCE(': ' || NEW.reason, ''),
    NEW.amount, NEW.penalty_date, 'maintenance',
    v_category_id, NEW.vehicle_id, 'Traffic penalty', true
  ) RETURNING id INTO v_expense_id;

  NEW.expense_id := v_expense_id;
  RETURN NEW;
END;
$function$;

-- ── Backfill ────────────────────────────────────────────────────────
-- The basics trigger only looks at changed fields, so these updates pass.
UPDATE expenses SET is_overhead = true
 WHERE project_id IS NULL AND NOT is_overhead AND expense_type IN ('fuel', 'maintenance', 'property_rent');
-- A transport payment takes its job's project.
UPDATE expenses e SET project_id = t.project_id
  FROM transportation_requests t
 WHERE t.expense_id = e.id AND e.project_id IS NULL AND t.project_id IS NOT NULL;
-- A penalty is paid to the traffic authority.
UPDATE expenses e SET vendors_name = 'Traffic penalty'
  FROM vehicle_penalties vp
 WHERE vp.expense_id = e.id AND e.vendor_id IS NULL AND btrim(COALESCE(e.vendors_name, '')) = '';
-- Re-post approved mixed-project purchase orders so their cost splits.
SELECT sync_expense_accrual(e.id) FROM expenses e
 WHERE e.expense_type = 'purchase_order' AND e.project_id IS NULL AND e.approval_status::text = 'finance_approved'
   AND po_has_line_projects(e.sourcing_bundle_id);
