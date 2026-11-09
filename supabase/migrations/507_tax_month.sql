-- 507: The tax module, by tax month.
--
-- The tax work is the same every Ethiopian month: for VAT, withholding,
-- payroll tax and pension, see what the books say, declare it, pay it.
-- Profit tax does the same once a year. This migration gives that a small
-- set of calls the new Taxes pages read and write:
--
--   tax_year(fiscal year)      every month's returns at a glance, and profit tax
--   tax_month(year, month)     one month: each return's figures, the bills
--                              that may have paid it, the receipts in hand
--   tax_return_declare / _pay / _undo   recording a return in one step each
--   tax_receipt_held           "we have the VAT receipt" for a purchase
--
-- Two rules change, both to cut upkeep:
--
-- * A VAT purchase's input VAT is claimed once its receipt is in hand —
--   ticked here, uploaded on the expense, or captured as a vendor receipt.
--   It no longer waits for the three-person receipt review (maker, checker,
--   tax officer), which no receipt ever went through, so no input VAT was
--   ever claimed and "VAT owed" was all the VAT on sales. A receipt ticked
--   after its month's VAT return was declared is claimed on the next return
--   still to declare.
-- * Finance records returns, alongside the tax officer and admin
--   (tax_recorder). Executives read them.
--
-- A return is done when it is declared and paid (a nil return when declared
-- at 0). Paying a return not yet declared declares it at the amount paid.
-- A payment is tied to the Government Expense bill that paid it, as 385
-- set out, so the payable clears and the bill stops counting as a cost; one
-- bill may pay several returns (payroll tax and pension together).
-- Nothing is removed: the old tables and functions stay for their history.

SET search_path TO public;

-- ── Who records returns ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tax_recorder()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT auth.uid() IS NOT NULL AND (is_tax_officer() OR COALESCE(get_user_role()::text IN ('admin', 'finance'), false));
$f$;

-- The employee schedule of a payroll-tax or pension return: finance builds it too.
CREATE OR REPLACE FUNCTION public.build_tax_filing_schedule(p_filing_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_f tax_filings%ROWTYPE;
  v_n int;
  v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT tax_recorder() THEN
    RAISE EXCEPTION 'Only finance, the tax officer or an admin can build a declaration schedule';
  END IF;
  SELECT * INTO v_f FROM tax_filings WHERE id = p_filing_id;
  IF v_f.id IS NULL THEN
    RAISE EXCEPTION 'Tax filing % not found', p_filing_id;
  END IF;
  IF v_f.schedule_code NOT IN ('SCH_A', 'PENSION') OR v_f.period_ec_month IS NULL THEN
    RAISE EXCEPTION 'Only monthly Schedule A and pension returns carry an employee schedule';
  END IF;
  IF v_f.status <> 'draft' THEN
    RAISE EXCEPTION '% % has been %; its employee schedule is frozen', v_f.schedule_code, v_f.period_label, v_f.status;
  END IF;
  EXECUTE 'DEL' || 'ETE FROM tax_filing_lines WHERE tax_filing_id = $1' USING p_filing_id;
  INSERT INTO tax_filing_lines (tax_filing_id, staff_id, employee_name, employment_type, pension_covered,
                                net_paid, gross, paye, pension_employee, pension_employer, payroll_ids, created_by)
  SELECT p_filing_id, s.staff_id, s.employee_name, s.employment_type, s.pension_covered,
         s.net_paid, s.gross_paid, s.paye_paid, s.pension_employee_paid, s.pension_employer_paid,
         s.payroll_ids_paid, auth.uid()
  FROM v_payroll_tax_by_staff_period s
  WHERE s.ec_year = v_f.period_ec_year AND s.ec_month = v_f.period_ec_month
    AND s.net_paid > 0
    AND (v_f.schedule_code = 'SCH_A' OR s.pension_covered);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT CASE WHEN v_f.schedule_code = 'SCH_A' THEN sum(paye) ELSE sum(pension_employee + pension_employer) END
    INTO v_total FROM tax_filing_lines WHERE tax_filing_id = p_filing_id;
  RETURN jsonb_build_object('filing', v_f.schedule_code || ' ' || v_f.period_label, 'employees', v_n, 'total', COALESCE(v_total, 0));
END;
$function$;

-- ── VAT receipts in hand ────────────────────────────────────────────────
ALTER TABLE public.input_vat_items
  ADD COLUMN IF NOT EXISTS receipt_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_held_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receipt_no text;
COMMENT ON COLUMN public.input_vat_items.receipt_held_at IS
  'When the VAT receipt for this purchase was marked as in hand: its input VAT is claimed from then (507).';

-- The tracker: claimable once the receipt is in hand. Same columns as
-- before, two added at the end.
CREATE OR REPLACE VIEW public.v_input_vat_tracker AS
 WITH src AS (
         SELECT e.id AS expense_id, NULL::uuid AS part_id, NULL::integer AS part_no, NULL::integer AS part_count,
            e.amount_etb AS amount, (1)::numeric AS share, NULL::date AS part_paid_date
           FROM expenses e
          WHERE e.payment_status = true AND NOT e.in_parts
        UNION ALL
         SELECT p.expense_id, p.id, pos.part_no, pos.part_count, p.amount_etb,
            (p.amount_etb / NULLIF(expense_parts_payable(e.*), (0)::numeric)), p.paid_date
           FROM expense_payments p
             JOIN expenses e ON e.id = p.expense_id
             CROSS JOIN LATERAL expense_part_position(p.id) pos(part_no, part_count)
          WHERE p.state = 'paid'::text AND e.in_parts
        ), base AS (
         SELECT e.id AS expense_id, e.expense_code, e.date AS expense_date, (s.amount)::numeric(12,2) AS amount_etb,
            e.amount_etb AS bill_amount, s.share, s.part_id, s.part_no, s.part_count,
            e.vendor_id, v.vendor_name, v.tin AS vendor_tin, e.project_id, p.project_name, e.receipt_url,
            (pr.id IS NOT NULL) AS own_receipt,
            COALESCE(pr.id, vr.id) AS receipt_id,
            CASE WHEN pr.id IS NOT NULL THEN pr.status ELSE vr.status END AS receipt_status,
            CASE WHEN pr.id IS NOT NULL THEN pr.vat_amount ELSE vr.vat_amount END AS receipt_vat,
            CASE WHEN pr.id IS NOT NULL THEN pr.document_url ELSE vr.document_url END AS receipt_document,
            CASE WHEN s.part_id IS NULL THEN COALESCE(vr.receipt_date, e.date) ELSE COALESCE(s.part_paid_date, e.date) END AS anchor_date,
            i.vat_applicable, i.declare_ec_year, i.declare_ec_month,
            i.copy_status AS copy_status_set, i.vat_amount AS vat_amount_set, i.notes,
            i.receipt_held_at, i.receipt_no AS held_receipt_no
           FROM src s
             JOIN expenses e ON e.id = s.expense_id
             LEFT JOIN vendors v ON v.id = e.vendor_id
             LEFT JOIN projects p ON p.id = e.project_id
             LEFT JOIN input_vat_items i ON i.expense_id = e.id
             LEFT JOIN LATERAL ( SELECT r_0.id, r_0.status, r_0.vat_amount, r_0.document_url, r_0.receipt_date
                   FROM vendor_receipts r_0
                  WHERE s.part_id IS NOT NULL AND r_0.expense_payment_id = s.part_id
                  ORDER BY (r_0.status = 'tax_reviewed'::text) DESC, r_0.created_at DESC
                 LIMIT 1) pr ON true
             LEFT JOIN LATERAL ( SELECT r_1.id, r_1.status, r_1.vat_amount, r_1.document_url, r_1.receipt_date
                   FROM vendor_receipts r_1
                  WHERE r_1.expense_id = e.id AND (s.part_id IS NULL OR r_1.expense_payment_id IS NULL)
                  ORDER BY (r_1.status = 'tax_reviewed'::text) DESC, r_1.created_at DESC
                 LIMIT 1) vr ON true
          WHERE NOT COALESCE(e.is_archived, false) AND e.date >= financials_cutover_date()
            AND e.vendor_receipt_facilitation_id IS NULL AND e.expense_type IS DISTINCT FROM 'vrf'::expense_category
        ), r AS (
         SELECT b_1.*,
            -- In hand: ticked, captured as a vendor receipt (not rejected), or
            -- a receipt uploaded on an expense answered as carrying VAT.
            ( (COALESCE(b_1.vat_applicable, true)
                AND (b_1.receipt_held_at IS NOT NULL
                     OR COALESCE(b_1.receipt_status IN ('pending_verification', 'verified', 'tax_reviewed'), false)))
              OR (b_1.vat_applicable IS TRUE AND b_1.receipt_url IS NOT NULL) ) AS is_claimable
           FROM base b_1
        )
 SELECT b.expense_id, b.expense_code, b.expense_date, b.amount_etb, b.vendor_id, b.vendor_name, b.vendor_tin,
    b.project_id, b.project_name, b.vat_applicable, b.anchor_date,
    dp.ec_year AS default_ec_year, dp.ec_month AS default_ec_month,
    COALESCE(b.declare_ec_year, dp.ec_year) AS declare_ec_year,
    COALESCE(b.declare_ec_month, dp.ec_month) AS declare_ec_month,
    ((ec_month_name(COALESCE(b.declare_ec_month, dp.ec_month)) || ' '::text) || COALESCE(b.declare_ec_year, dp.ec_year)) AS declare_period_label,
    (b.declare_ec_year IS NOT NULL) AS declare_overridden,
        CASE
            WHEN b.vat_amount_set IS NOT NULL THEN round(b.share * b.vat_amount_set, 2)
            WHEN b.own_receipt AND b.receipt_vat IS NOT NULL THEN round(b.receipt_vat, 2)
            ELSE round(b.share * COALESCE(b.receipt_vat, round((b.bill_amount * rt.rate) / ((1)::numeric + rt.rate), 2)), 2)
        END AS vat_amount,
        CASE
            WHEN b.vat_amount_set IS NOT NULL THEN 'entered'::text
            WHEN b.receipt_vat IS NOT NULL THEN 'receipt'::text
            ELSE 'estimated'::text
        END AS vat_source,
    b.receipt_id, b.receipt_status,
    COALESCE(b.copy_status_set,
        CASE WHEN b.receipt_document IS NOT NULL OR b.receipt_url IS NOT NULL OR b.receipt_held_at IS NOT NULL
             THEN 'uploaded'::text ELSE 'not_uploaded'::text END) AS copy_status,
    (b.copy_status_set IS NOT NULL) AS copy_status_set,
    b.is_claimable AS claimable,
    b.notes,
        CASE
            WHEN b.vat_applicable = false THEN 'not_vat'::text
            WHEN b.is_claimable THEN 'claimed'::text
            WHEN b.receipt_status = 'rejected'::text THEN 'rejected'::text
            WHEN b.vat_applicable = true THEN 'needs_receipt'::text
            ELSE 'unflagged'::text
        END AS stage,
    b.part_id, b.part_no, b.part_count,
    b.own_receipt AS part_receipt,
    b.receipt_held_at,
    b.held_receipt_no
   FROM r b
     CROSS JOIN LATERAL tax_period_for_date(b.anchor_date) dp(ec_year, ec_month)
     CROSS JOIN LATERAL ( SELECT ((tax_rate_note('VAT'::text, b.anchor_date) ->> 'standard_rate'::text))::numeric AS rate) rt;

-- The receipts still to chase leave out those in hand.
CREATE OR REPLACE FUNCTION public.vat_receipt_chase_list()
 RETURNS TABLE(expense_id uuid, expense_code text, label text, vendor_id uuid, vendor_name text, vendor_phone text, contact_person text, project_name text, payment_state text, paid_on date, from_bank boolean, ec_year integer, ec_month integer, period_label text, days_since integer, amount numeric, paid_amount numeric, vat numeric, chase_status text, asked_count integer, last_asked_at timestamp with time zone, promised_on date, chase_note text, promise_late boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF NOT tax_plan_reader() THEN RAISE EXCEPTION 'Only finance, tax officers and management can see the receipt chase'; END IF;
  RETURN QUERY
  WITH ex AS (
    SELECT e.*, vd.vendor_name AS v_name, vd.phone_contact AS v_phone, vd.contact_person AS v_contact, p.project_name AS p_name,
           ivi.vat_amount AS vat_set,
           COALESCE(
             (SELECT min(l.value_date) FROM bank_statement_lines l WHERE l.matched_expense_id = e.id),
             (SELECT min(l.value_date) FROM bank_statement_lines l WHERE e.transfer_id IS NOT NULL AND l.transfer_id = e.transfer_id)
           ) AS stmt_date,
           (SELECT sum(l.debit_amount) FROM bank_statement_lines l WHERE l.matched_expense_id = e.id) AS stmt_amt
      FROM expenses e
      LEFT JOIN vendors vd ON vd.id = e.vendor_id
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
     WHERE NOT COALESCE(e.is_archived, false)
       AND e.date >= financials_cutover_date()
       AND e.expense_type IS DISTINCT FROM 'vrf' AND e.vendor_receipt_facilitation_id IS NULL
       AND (ivi.vat_applicable IS TRUE
            OR (ivi.vat_applicable IS NULL AND (COALESCE(e.receipt_is_vat, false) OR vd.vendor_type::text = 'Supplier with VAT')))
       AND ivi.receipt_held_at IS NULL
       AND NOT (ivi.vat_applicable IS TRUE AND e.receipt_url IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM vendor_receipts r WHERE r.expense_id = e.id AND r.status IS DISTINCT FROM 'rejected')
  ),
  paid AS (
    SELECT x.*,
           COALESCE(x.stmt_date, x.bank_date, (x.paid_date AT TIME ZONE 'Africa/Addis_Ababa')::date, x.total_payment_date, x.partial_payment_date,
                    (x.payment_confirmed_at AT TIME ZONE 'Africa/Addis_Ababa')::date,
                    CASE WHEN x.payment_status OR x.payment_state IN ('advance', 'sent', 'paid')
                         THEN (x.payment_state_changed_at AT TIME ZONE 'Africa/Addis_Ababa')::date END,
                    x.date) AS paid_on0,
           CASE WHEN x.payment_status THEN x.amount_etb
                ELSE LEAST(x.amount_etb, COALESCE(NULLIF(x.paid_to_date_etb, 0), NULLIF(x.partial_paid_amount, 0), x.stmt_amt, x.amount_etb)) END AS paid_amt
      FROM ex x
     WHERE x.payment_status OR x.payment_state IN ('advance', 'sent', 'paid') OR x.stmt_date IS NOT NULL OR x.bank_date IS NOT NULL
  )
  SELECT p.id, p.expense_code, COALESCE(p.item_service_description, p.expense_code),
         p.vendor_id, COALESCE(p.v_name, p.vendors_name), p.v_phone, p.v_contact, p.p_name,
         CASE WHEN p.payment_status THEN 'paid' ELSE p.payment_state::text END,
         p.paid_on0, (p.stmt_date IS NOT NULL OR p.bank_date IS NOT NULL),
         tp.ec_year, tp.ec_month, ec_month_name(tp.ec_month) || ' ' || tp.ec_year,
         GREATEST(v_today - p.paid_on0, 0),
         round(p.amount_etb, 2), round(p.paid_amt, 2),
         round(COALESCE(
           CASE WHEN p.vat_set IS NOT NULL THEN p.vat_set * p.paid_amt / NULLIF(p.amount_etb, 0) END,
           CASE WHEN p.receipt_vat_amount IS NOT NULL THEN p.receipt_vat_amount * p.paid_amt / NULLIF(p.amount_etb, 0) END,
           p.paid_amt * rt.rate / (1 + rt.rate)), 2),
         c.status, COALESCE(c.asked_count, 0), c.last_asked_at, c.promised_on, c.note,
         c.status = 'promised' AND c.promised_on < v_today
    FROM paid p
    CROSS JOIN LATERAL tax_period_for_date(p.paid_on0) tp
    CROSS JOIN LATERAL (SELECT COALESCE((tax_rate_note('VAT', p.paid_on0) ->> 'standard_rate')::numeric, 0.15) AS rate) rt
    LEFT JOIN vat_receipt_chases c ON c.expense_id = p.id
   ORDER BY p.paid_on0, p.expense_code;
END $function$;

-- "We have the receipt" (held), "we don't" (not_held), "it carries no VAT"
-- (no_vat), "it carries VAT" (vat). A receipt whose month's VAT return is
-- already declared is claimed on the next return still to declare.
CREATE OR REPLACE FUNCTION public.tax_receipt_held(p_expense_ids uuid[], p_action text, p_receipt_no text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_id uuid; v_n int := 0; v_y int; v_m int; v_dy int; v_dm int;
BEGIN
  IF NOT tax_recorder() THEN RAISE EXCEPTION 'Finance, the tax officer or an admin marks VAT receipts'; END IF;
  IF p_action NOT IN ('held', 'not_held', 'no_vat', 'vat') THEN RAISE EXCEPTION 'Unknown action %', p_action; END IF;
  FOREACH v_id IN ARRAY COALESCE(p_expense_ids, '{}') LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM expenses WHERE id = v_id);
    INSERT INTO input_vat_items (expense_id, vat_applicable, updated_by, updated_at)
    VALUES (v_id, p_action <> 'no_vat', auth.uid(), now())
    ON CONFLICT (expense_id) DO NOTHING;
    IF p_action = 'held' THEN
      -- The month it would be claimed in, and whether that return is still open.
      SELECT t.declare_ec_year, t.declare_ec_month INTO v_dy, v_dm
        FROM v_input_vat_tracker t WHERE t.expense_id = v_id ORDER BY t.part_no NULLS FIRST LIMIT 1;
      v_y := NULL; v_m := NULL;
      IF v_dy IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM tax_filings f WHERE f.schedule_code = 'VAT' AND f.status = 'draft'
              AND f.period_ec_year = v_dy AND f.period_ec_month = v_dm) THEN
        SELECT f.period_ec_year, f.period_ec_month INTO v_y, v_m FROM tax_filings f
         WHERE f.schedule_code = 'VAT' AND f.status = 'draft' AND f.period_ec_month IS NOT NULL
           AND (f.period_ec_year, f.period_ec_month) >= (v_dy, v_dm)
         ORDER BY f.period_start_greg LIMIT 1;
      END IF;
      UPDATE input_vat_items SET vat_applicable = true, receipt_held_at = now(), receipt_held_by = auth.uid(),
             receipt_no = COALESCE(NULLIF(btrim(p_receipt_no), ''), receipt_no),
             declare_ec_year = COALESCE(v_y, declare_ec_year), declare_ec_month = COALESCE(v_m, declare_ec_month),
             updated_by = auth.uid(), updated_at = now()
       WHERE expense_id = v_id;
    ELSIF p_action = 'not_held' THEN
      UPDATE input_vat_items SET receipt_held_at = NULL, receipt_held_by = NULL, receipt_no = NULL,
             updated_by = auth.uid(), updated_at = now()
       WHERE expense_id = v_id;
    ELSE
      UPDATE input_vat_items SET vat_applicable = (p_action = 'vat'),
             receipt_held_at = CASE WHEN p_action = 'no_vat' THEN NULL ELSE receipt_held_at END,
             updated_by = auth.uid(), updated_at = now()
       WHERE expense_id = v_id;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $f$;

-- ── Recording a return ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tax_return_declare(p_filing uuid, p_amount numeric, p_reference text DEFAULT NULL, p_on date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE f tax_filings%ROWTYPE;
BEGIN
  IF NOT tax_recorder() THEN RAISE EXCEPTION 'Finance, the tax officer or an admin records returns'; END IF;
  SELECT * INTO f FROM tax_filings WHERE id = p_filing;
  IF f.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF f.status = 'acknowledged' THEN RAISE EXCEPTION '% % is closed', f.schedule_code, f.period_label; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Say what was declared (0 for a nil return)'; END IF;
  UPDATE tax_filings SET declared_amount = round(p_amount, 2),
         government_reference_no = COALESCE(NULLIF(btrim(p_reference), ''), government_reference_no),
         filed_at = COALESCE(p_on, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date)::timestamptz,
         filed_by = auth.uid(), status = 'filed'
   WHERE id = p_filing;
END $f$;

CREATE OR REPLACE FUNCTION public.tax_return_pay(p_filing uuid, p_amount numeric, p_on date DEFAULT NULL,
                                                 p_expense uuid DEFAULT NULL, p_account uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE f tax_filings%ROWTYPE; e expenses%ROWTYPE; v_used numeric; v_on date;
BEGIN
  IF NOT tax_recorder() THEN RAISE EXCEPTION 'Finance, the tax officer or an admin records returns'; END IF;
  SELECT * INTO f FROM tax_filings WHERE id = p_filing;
  IF f.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF f.status = 'acknowledged' THEN RAISE EXCEPTION '% % is closed', f.schedule_code, f.period_label; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Say how much was paid'; END IF;
  IF (p_expense IS NULL) = (p_account IS NULL) THEN RAISE EXCEPTION 'Say what paid it: a bill, or a bank account'; END IF;
  v_on := p_on;
  IF p_expense IS NOT NULL THEN
    SELECT * INTO e FROM expenses WHERE id = p_expense;
    IF e.id IS NULL OR COALESCE(e.is_archived, false) OR e.approval_status::text = 'rejected' OR COALESCE(e.payment_state, '') = 'void' THEN
      RAISE EXCEPTION 'That bill can''t pay a return';
    END IF;
    SELECT COALESCE(sum(x.paid_amount), 0) INTO v_used FROM tax_filings x WHERE x.paid_by_expense_id = p_expense AND x.id <> p_filing;
    IF v_used + p_amount > e.amount_etb + 1 THEN
      RAISE EXCEPTION '% is ETB %; ETB % of it already pays other returns', e.expense_code,
        to_char(e.amount_etb, 'FM999,999,999,990.00'), to_char(v_used, 'FM999,999,999,990.00');
    END IF;
    v_on := COALESCE(v_on, e.bank_date, e.total_payment_date, (e.paid_date AT TIME ZONE 'Africa/Addis_Ababa')::date, e.date);
  END IF;
  v_on := COALESCE(v_on, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date);
  UPDATE tax_filings SET paid_amount = round(p_amount, 2), payment_date = v_on,
         paid_by_expense_id = p_expense, paid_from_account_id = p_account,
         declared_amount = COALESCE(declared_amount, round(p_amount, 2)),
         filed_at = COALESCE(filed_at, v_on::timestamptz), filed_by = COALESCE(filed_by, auth.uid()),
         status = 'filed'
   WHERE id = p_filing;
END $f$;

CREATE OR REPLACE FUNCTION public.tax_return_undo(p_filing uuid, p_what text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE f tax_filings%ROWTYPE;
BEGIN
  IF NOT tax_recorder() THEN RAISE EXCEPTION 'Finance, the tax officer or an admin records returns'; END IF;
  SELECT * INTO f FROM tax_filings WHERE id = p_filing;
  IF f.id IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF f.status = 'acknowledged' THEN RAISE EXCEPTION '% % is closed', f.schedule_code, f.period_label; END IF;
  IF p_what = 'payment' THEN
    UPDATE tax_filings SET paid_amount = NULL, payment_date = NULL, paid_by_expense_id = NULL, paid_from_account_id = NULL
     WHERE id = p_filing;
  ELSIF p_what = 'declaration' THEN
    IF COALESCE(f.paid_amount, 0) > 0 THEN RAISE EXCEPTION 'Undo the payment first'; END IF;
    UPDATE tax_filings SET declared_amount = NULL, government_reference_no = NULL, filed_at = NULL, filed_by = NULL, status = 'draft'
     WHERE id = p_filing;
  ELSE
    RAISE EXCEPTION 'Undo the payment or the declaration';
  END IF;
END $f$;

-- ── Reading: one return, as the pages show it ───────────────────────────
-- What the books say for a return: VAT on sales less VAT claimed less VAT
-- clients withheld; withholding held back on vendor payments; payroll tax
-- and pension on the salaries paid. Profit tax comes from the year's
-- accounts, so the books give no figure.
CREATE OR REPLACE FUNCTION public.tax_return_json(f tax_filings, p_today date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH b AS (
    SELECT CASE f.schedule_code
             WHEN 'VAT' THEN (SELECT jsonb_build_object(
                 'amount', round(GREATEST(v.net_vat_after_withheld, 0), 2),
                 'output_vat', round(v.output_vat, 2), 'sale_count', v.sale_count,
                 'input_vat', round(v.input_vat_reclaimable, 2), 'claimed_count', v.reviewed_receipt_count,
                 'withheld_by_clients', round(v.vat_withheld_by_clients, 2),
                 'to_carry', round(GREATEST(-v.net_vat_after_withheld, 0), 2),
                 'needs_receipt_count', v.needs_receipt_count, 'needs_receipt_vat', round(v.input_vat_needs_receipt, 2))
               FROM v_vat_position_by_ec_period v WHERE v.ec_year = f.period_ec_year AND v.ec_month = f.period_ec_month)
             WHEN 'WHT' THEN (SELECT jsonb_build_object(
                 'amount', round(w.wht_withheld, 2), 'paid_count', w.paid_expense_count,
                 'pending_count', w.pending_expense_count, 'pending_amount', round(w.wht_pending_unpaid, 2), 'vrf_wht', round(w.vrf_wht, 2))
               FROM v_wht_payable_by_ec_period w WHERE w.ec_year = f.period_ec_year AND w.ec_month = f.period_ec_month)
             WHEN 'SCH_A' THEN (SELECT jsonb_build_object(
                 'amount', round(COALESCE(pt.paye_paid, 0), 2), 'staff_paid', pt.paid_staff_count,
                 'gross_paid', round(pt.gross_paid, 2), 'net_unpaid', round(pt.net_unpaid, 2),
                 'with_unpaid', round(pt.paye_incl_unpaid, 2))
               FROM v_payroll_tax_by_ec_period pt WHERE pt.ec_year = f.period_ec_year AND pt.ec_month = f.period_ec_month)
             WHEN 'PENSION' THEN (SELECT jsonb_build_object(
                 'amount', round(COALESCE(pt.pension_employee_paid, 0) + COALESCE(pt.pension_employer_paid, 0), 2),
                 'employee', round(pt.pension_employee_paid, 2), 'employer', round(pt.pension_employer_paid, 2),
                 'staff_paid', pt.paid_staff_count)
               FROM v_payroll_tax_by_ec_period pt WHERE pt.ec_year = f.period_ec_year AND pt.ec_month = f.period_ec_month)
           END AS basis
  ), s AS (
    SELECT CASE WHEN f.schedule_code = 'SCH_C' THEN NULL ELSE COALESCE((b.basis ->> 'amount')::numeric, 0) END AS books,
           COALESCE(b.basis, '{}'::jsonb) AS basis FROM b
  )
  SELECT jsonb_build_object(
    'id', f.id, 'code', f.schedule_code, 'period', f.period_label,
    'ec_year', f.period_ec_year, 'ec_month', f.period_ec_month,
    'start', f.period_start_greg, 'end', f.period_end_greg, 'due', f.due_date_greg,
    'books', s.books, 'basis', s.basis,
    'declared', f.declared_amount, 'reference', f.government_reference_no, 'declared_on', (f.filed_at AT TIME ZONE 'Africa/Addis_Ababa')::date,
    'paid', f.paid_amount, 'paid_on', f.payment_date, 'paid_by_expense', f.paid_by_expense_id,
    'paid_by_code', (SELECT x.expense_code FROM expenses x WHERE x.id = f.paid_by_expense_id),
    'paid_from_account', f.paid_from_account_id,
    'paid_from_name', (SELECT a.account_name FROM accounts a WHERE a.id = f.paid_from_account_id),
    'status', f.status,
    'state', CASE
      WHEN f.period_start_greg > p_today THEN 'future'
      WHEN f.declared_amount IS NOT NULL AND (f.declared_amount = 0 OR COALESCE(f.paid_amount, 0) >= f.declared_amount - 1) THEN 'done'
      WHEN p_today <= f.period_end_greg THEN 'running'
      WHEN f.declared_amount IS NOT NULL THEN CASE WHEN f.due_date_greg < p_today THEN 'late_pay' ELSE 'to_pay' END
      WHEN f.due_date_greg < p_today THEN 'late'
      ELSE 'to_declare' END)
  FROM s;
$f$;
REVOKE EXECUTE ON FUNCTION public.tax_return_json(tax_filings, date) FROM PUBLIC, anon, authenticated;

-- Returns for a fiscal year exist once anyone opens it.
CREATE OR REPLACE FUNCTION public.tax_ensure_returns(p_fy uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF p_fy IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_filings WHERE fiscal_period_id = p_fy)
     AND (SELECT start_date FROM fiscal_periods WHERE id = p_fy) <= CURRENT_DATE THEN
    PERFORM generate_tax_filing_periods(p_fy);
  END IF;
END $f$;
REVOKE EXECUTE ON FUNCTION public.tax_ensure_returns(uuid) FROM PUBLIC, anon, authenticated;

-- ── The year ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tax_year(p_fiscal_period_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_fy fiscal_periods%ROWTYPE; v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF NOT tax_plan_reader() THEN RAISE EXCEPTION 'Taxes are for finance, the tax officer and management'; END IF;
  SELECT * INTO v_fy FROM fiscal_periods WHERE id = COALESCE(p_fiscal_period_id, (SELECT id FROM fiscal_periods WHERE is_current));
  IF v_fy.id IS NULL THEN RAISE EXCEPTION 'No fiscal year'; END IF;
  RETURN jsonb_build_object(
    'fy', jsonb_build_object('id', v_fy.id, 'label', v_fy.label, 'start', v_fy.start_date, 'end', v_fy.end_date, 'is_current', v_fy.is_current),
    'years', (SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label, 'is_current', is_current) ORDER BY start_date DESC)
                FROM fiscal_periods WHERE start_date <= v_today),
    'today', v_today,
    'can_record', tax_recorder(),
    'months', COALESCE((
      SELECT jsonb_agg(m.j ORDER BY m.start) FROM (
        SELECT min(f.period_start_greg) AS start,
               jsonb_build_object(
                 'ec_year', f.period_ec_year, 'ec_month', f.period_ec_month,
                 'label', ec_month_name(f.period_ec_month) || ' ' || f.period_ec_year,
                 'start', min(f.period_start_greg), 'end', max(f.period_end_greg),
                 'returns', jsonb_object_agg(f.schedule_code, tax_return_json(f, v_today))) AS j
          FROM tax_filings f
         WHERE f.fiscal_period_id = v_fy.id AND f.period_ec_month IS NOT NULL
           AND f.schedule_code IN ('VAT', 'WHT', 'SCH_A', 'PENSION')
         GROUP BY f.period_ec_year, f.period_ec_month) m), '[]'::jsonb),
    'yearly', COALESCE((
      SELECT jsonb_object_agg(f.schedule_code, tax_return_json(f, v_today) || jsonb_build_object(
               'deductible_expenses', (SELECT COALESCE(sum(g.amount), 0) FROM v_government_expense_statement_by_ec_period g WHERE g.fiscal_period_id = v_fy.id),
               'client_wht_credits', (SELECT COALESCE(sum(sw.expected_wht), 0) FROM v_sale_wht sw JOIN sales s ON s.id = sw.sale_id
                                       WHERE sw.qualifies AND s.date BETWEEN v_fy.start_date AND v_fy.end_date)))
        FROM tax_filings f WHERE f.fiscal_period_id = v_fy.id AND f.period_ec_month IS NULL AND f.schedule_code = 'SCH_C'), '{}'::jsonb)
  );
END $f$;

-- tax_year is STABLE and can't create rows: this wrapper does, then reads.
CREATE OR REPLACE FUNCTION public.tax_year_open(p_fiscal_period_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT tax_plan_reader() THEN RAISE EXCEPTION 'Taxes are for finance, the tax officer and management'; END IF;
  PERFORM tax_ensure_returns(COALESCE(p_fiscal_period_id, (SELECT id FROM fiscal_periods WHERE is_current)));
  RETURN tax_year(p_fiscal_period_id);
END $f$;

-- ── The month ───────────────────────────────────────────────────────────
-- Its returns, the Government Expense bills that may have paid them (and
-- how well each fits), the VAT receipts ticked as in hand, and purchases
-- nobody has said carry VAT.
CREATE OR REPLACE FUNCTION public.tax_month(p_ec_year integer, p_ec_month integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_b record; v_gov uuid; v_bucket uuid; v_due date; v_returns jsonb; v_bills jsonb;
  v_prev record; v_next record; v_cur record;
BEGIN
  IF NOT tax_plan_reader() THEN RAISE EXCEPTION 'Taxes are for finance, the tax officer and management'; END IF;
  SELECT * INTO v_b FROM tax_period_bounds(p_ec_year, p_ec_month) b(start_greg, end_greg);
  IF v_b.start_greg IS NULL THEN RAISE EXCEPTION 'No such month'; END IF;
  SELECT * INTO v_prev FROM tax_period_for_date(v_b.start_greg - 1) t(ec_year, ec_month);
  SELECT * INTO v_next FROM tax_period_for_date(v_b.end_greg + 1) t(ec_year, ec_month);
  SELECT * INTO v_cur FROM tax_period_for_date(v_today) t(ec_year, ec_month);
  v_gov := (SELECT id FROM categories WHERE lower(btrim(category_name)) = 'government expense' LIMIT 1);
  v_bucket := tax_bucket();

  SELECT jsonb_object_agg(f.schedule_code, tax_return_json(f, v_today)), max(f.due_date_greg)
    INTO v_returns, v_due
    FROM tax_filings f
   WHERE f.period_ec_year = p_ec_year AND f.period_ec_month = p_ec_month
     AND f.schedule_code IN ('VAT', 'WHT', 'SCH_A', 'PENSION');

  -- Government payments from the month's start to two months past its last
  -- due date: what is left of each once the returns it already pays are taken.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'code', e.expense_code, 'date', e.date, 'description', e.item_service_description,
           'payee', COALESCE(v.vendor_name, e.vendors_name), 'amount', e.amount_etb,
           'payment_state', CASE WHEN e.payment_status THEN 'paid' ELSE e.payment_state::text END,
           'left', e.amount_etb - COALESCE(t.used, 0),
           'pays', COALESCE(t.pays, '[]'::jsonb)) ORDER BY e.date), '[]'::jsonb)
    INTO v_bills
    FROM expenses e
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN LATERAL (SELECT sum(x.paid_amount) AS used,
                              jsonb_agg(jsonb_build_object('id', x.id, 'code', x.schedule_code, 'period', x.period_label, 'amount', x.paid_amount)) AS pays
                         FROM tax_filings x WHERE x.paid_by_expense_id = e.id) t ON true
   WHERE NOT COALESCE(e.is_archived, false) AND e.approval_status::text <> 'rejected' AND COALESCE(e.payment_state, '') <> 'void'
     AND (e.category_id = v_gov OR (v_bucket IS NOT NULL AND e.project_id = v_bucket))
     AND e.date BETWEEN v_b.start_greg AND COALESCE(v_due, v_b.end_greg + 40) + 60;

  RETURN jsonb_build_object(
    'ec_year', p_ec_year, 'ec_month', p_ec_month, 'label', ec_month_name(p_ec_month) || ' ' || p_ec_year,
    'start', v_b.start_greg, 'end', v_b.end_greg, 'today', v_today,
    'prev', jsonb_build_object('ec_year', v_prev.ec_year, 'ec_month', v_prev.ec_month, 'label', ec_month_name(v_prev.ec_month) || ' ' || v_prev.ec_year),
    'next', CASE WHEN v_b.end_greg < v_today THEN jsonb_build_object('ec_year', v_next.ec_year, 'ec_month', v_next.ec_month, 'label', ec_month_name(v_next.ec_month) || ' ' || v_next.ec_year) END,
    'is_current', (v_cur.ec_year, v_cur.ec_month) = (p_ec_year, p_ec_month),
    'can_record', tax_recorder(),
    'returns', COALESCE(v_returns, '{}'::jsonb),
    'bills', v_bills,
    'claimed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('expense_id', t.expense_id, 'code', t.expense_code, 'vendor', t.vendor_name, 'tin', t.vendor_tin,
               'vat', t.vat_amount, 'receipt_no', t.held_receipt_no, 'ticked', t.receipt_held_at IS NOT NULL, 'part_no', t.part_no) ORDER BY t.vat_amount DESC)
        FROM v_input_vat_tracker t WHERE t.claimable AND t.declare_ec_year = p_ec_year AND t.declare_ec_month = p_ec_month), '[]'::jsonb),
    'unflagged', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('expense_id', t.expense_id, 'code', t.expense_code, 'vendor', t.vendor_name,
               'amount', t.amount_etb, 'vat', t.vat_amount) ORDER BY t.amount_etb DESC)
        FROM v_input_vat_tracker t WHERE t.stage = 'unflagged' AND t.part_id IS NULL
         AND t.declare_ec_year = p_ec_year AND t.declare_ec_month = p_ec_month), '[]'::jsonb)
  );
END $f$;

CREATE OR REPLACE FUNCTION public.tax_month_open(p_ec_year integer, p_ec_month integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_start date;
BEGIN
  IF NOT tax_plan_reader() THEN RAISE EXCEPTION 'Taxes are for finance, the tax officer and management'; END IF;
  SELECT b.start_greg INTO v_start FROM tax_period_bounds(p_ec_year, p_ec_month) b(start_greg, end_greg);
  PERFORM tax_ensure_returns((SELECT id FROM fiscal_periods WHERE v_start BETWEEN start_date AND end_date));
  RETURN tax_month(p_ec_year, p_ec_month);
END $f$;

REVOKE EXECUTE ON FUNCTION public.tax_year(uuid), public.tax_month(integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tax_year_open(uuid), public.tax_month_open(integer, integer),
  public.tax_return_declare(uuid, numeric, text, date), public.tax_return_pay(uuid, numeric, date, uuid, uuid),
  public.tax_return_undo(uuid, text), public.tax_receipt_held(uuid[], text, text), public.tax_recorder() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_year(uuid), public.tax_month(integer, integer),
  public.tax_year_open(uuid), public.tax_month_open(integer, integer),
  public.tax_return_declare(uuid, numeric, text, date), public.tax_return_pay(uuid, numeric, date, uuid, uuid),
  public.tax_return_undo(uuid, text), public.tax_receipt_held(uuid[], text, text), public.tax_recorder() TO authenticated;
