-- PAYE and pension per employee, per payment, and per declaration.
--
-- 312 computed what each person costs in tax and pension per month, but a
-- Schedule A or pension return carried only a total -- nothing recorded
-- WHOSE tax it declared, or which payment each person's tax came from. Three
-- layers close that:
--
-- 1. v_payroll_tax_by_staff_period gains employer cost and the payroll runs
--    behind each figure (columns appended, so nothing reading it changes).
--
-- 2. v_payroll_line_tax -- the tax on each PAYMENT. PAYE is progressive on a
--    person's whole month, so a bonus and a salary paid in the same month
--    cannot be taxed separately. Each line takes its share of the month:
--      paid line    share of the tax on the month's PAID pay, by net
--      unpaid line  share of the EXTRA tax the unpaid pay adds, by net
--    so the paid lines add up exactly to what the return declares, and all
--    lines together add up to the month's total once everything is paid.
--
-- 3. tax_filing_lines -- the declaration schedule. One row per employee on a
--    Schedule A or pension return, snapshotting net, gross, PAYE, both
--    pension shares and the payroll run ids they came from. It is built from
--    live payroll while the return is a draft (build_tax_filing_schedule) and
--    frozen automatically the moment the return leaves draft, so "whose tax
--    did we declare in Nehase 2018" has a permanent answer even if payroll is
--    edited afterwards. Lines are never written directly; admin deletion of
--    a return now keeps them in its audit snapshot.

SET search_path TO public;

-- ── 1. Per person per tax period, with runs and employer cost ───────────
CREATE OR REPLACE VIEW v_payroll_tax_by_staff_period
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT ps.staff_id, ps.payroll_id, tp.ec_year, tp.ec_month,
         ps.net_amount,
         (p.payment_status = 'paid') AS is_paid
  FROM payroll_staff ps
  JOIN payroll p ON p.id = ps.payroll_id
  CROSS JOIN LATERAL tax_period_for_date(p.start_date) tp
  WHERE p.start_date IS NOT NULL
    AND NOT COALESCE(p.is_archived, false)
),
per_staff AS (
  SELECT staff_id, ec_year, ec_month,
         COALESCE(sum(net_amount) FILTER (WHERE is_paid), 0) AS net_paid,
         COALESCE(sum(net_amount), 0)                        AS net_all,
         COALESCE(array_agg(payroll_id) FILTER (WHERE is_paid), '{}') AS payroll_ids_paid,
         array_agg(payroll_id)                               AS payroll_ids_all
  FROM lines
  GROUP BY staff_id, ec_year, ec_month
)
SELECT ps.staff_id, st.employee_name, st.employment_type,
       ps.ec_year, ps.ec_month,
       ec_month_name(ps.ec_month) || ' ' || ps.ec_year     AS period_label,
       (COALESCE(st.employment_type, '') <> 'tier_2_casual') AS pension_covered,
       ps.net_paid,
       paid.gross            AS gross_paid,
       paid.paye             AS paye_paid,
       paid.pension_employee AS pension_employee_paid,
       paid.pension_employer AS pension_employer_paid,
       ps.net_all,
       allp.gross            AS gross_incl_unpaid,
       allp.paye             AS paye_incl_unpaid,
       -- appended in 319
       allp.pension_employee AS pension_employee_incl_unpaid,
       allp.pension_employer AS pension_employer_incl_unpaid,
       paid.gross + paid.pension_employer AS employer_cost_paid,
       allp.gross + allp.pension_employer AS employer_cost_incl_unpaid,
       ps.payroll_ids_paid,
       ps.payroll_ids_all
FROM per_staff ps
JOIN staff st ON st.id = ps.staff_id
CROSS JOIN LATERAL tax_period_bounds(ps.ec_year, ps.ec_month) b
LEFT JOIN LATERAL paye_gross_up(ps.net_paid, b.start_greg,
                                COALESCE(st.employment_type, '') <> 'tier_2_casual') paid ON true
LEFT JOIN LATERAL paye_gross_up(ps.net_all,  b.start_greg,
                                COALESCE(st.employment_type, '') <> 'tier_2_casual') allp ON true;

-- ── 2. Tax on each payment line ─────────────────────────────────────────
CREATE OR REPLACE VIEW v_payroll_line_tax
WITH (security_invoker = true) AS
SELECT ps.payroll_id, p.payroll_record, p.payroll_type,
       ps.staff_id, s.employee_name,
       s.ec_year, s.ec_month, s.period_label,
       (p.payment_status = 'paid')            AS is_paid,
       ps.net_amount,
       round(sh.part * sh.gross, 2)            AS gross_share,
       round(sh.part * sh.paye, 2)             AS paye_share,
       round(sh.part * sh.pen_emp, 2)          AS pension_employee_share,
       round(sh.part * sh.pen_er, 2)           AS pension_employer_share,
       round(sh.part * (sh.gross + sh.pen_er), 2) AS employer_cost_share
FROM payroll_staff ps
JOIN payroll p ON p.id = ps.payroll_id
CROSS JOIN LATERAL tax_period_for_date(p.start_date) tp
JOIN v_payroll_tax_by_staff_period s
  ON s.staff_id = ps.staff_id AND s.ec_year = tp.ec_year AND s.ec_month = tp.ec_month
CROSS JOIN LATERAL (
  SELECT
    CASE WHEN p.payment_status = 'paid'
         THEN ps.net_amount / NULLIF(s.net_paid, 0)
         ELSE ps.net_amount / NULLIF(s.net_all - s.net_paid, 0) END AS part,
    CASE WHEN p.payment_status = 'paid' THEN s.gross_paid
         ELSE s.gross_incl_unpaid - s.gross_paid END                 AS gross,
    CASE WHEN p.payment_status = 'paid' THEN s.paye_paid
         ELSE s.paye_incl_unpaid - s.paye_paid END                   AS paye,
    CASE WHEN p.payment_status = 'paid' THEN s.pension_employee_paid
         ELSE s.pension_employee_incl_unpaid - s.pension_employee_paid END AS pen_emp,
    CASE WHEN p.payment_status = 'paid' THEN s.pension_employer_paid
         ELSE s.pension_employer_incl_unpaid - s.pension_employer_paid END AS pen_er
) sh
WHERE p.start_date IS NOT NULL
  AND NOT COALESCE(p.is_archived, false);

GRANT SELECT ON v_payroll_tax_by_staff_period, v_payroll_line_tax TO authenticated;

-- ── 3. The declaration schedule ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_filing_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_filing_id     uuid NOT NULL REFERENCES tax_filings(id) ON DELETE CASCADE,
  staff_id          uuid REFERENCES staff(id) ON DELETE SET NULL,
  employee_name     text NOT NULL,
  employment_type   text,
  pension_covered   boolean NOT NULL,
  net_paid          numeric NOT NULL,
  gross             numeric NOT NULL,
  paye              numeric NOT NULL,
  pension_employee  numeric NOT NULL,
  pension_employer  numeric NOT NULL,
  payroll_ids       uuid[] NOT NULL DEFAULT '{}',
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tax_filing_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_tax_filing_lines_filing ON tax_filing_lines(tax_filing_id);
CREATE INDEX IF NOT EXISTS idx_tax_filing_lines_payroll ON tax_filing_lines USING gin (payroll_ids);

COMMENT ON TABLE tax_filing_lines IS
  'Declaration schedule: the employees whose PAYE / pension a Schedule A or pension return declares, snapshotted from payroll. Rebuilt only while the return is a draft; frozen when it is filed.';

ALTER TABLE tax_filing_lines ENABLE ROW LEVEL SECURITY;
-- Salaries: the payroll read set plus the tax officer. No write policy --
-- rows are written only by build_tax_filing_schedule().
CREATE POLICY tax_filing_lines_read ON tax_filing_lines FOR SELECT TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'hr_officer', 'executive'), false));
GRANT SELECT ON tax_filing_lines TO authenticated;

CREATE OR REPLACE FUNCTION build_tax_filing_schedule(p_filing_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_f tax_filings%ROWTYPE;
  v_n int;
  v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false)) THEN
    RAISE EXCEPTION 'Only the tax officer or an admin can build a declaration schedule';
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

  DELETE FROM tax_filing_lines WHERE tax_filing_id = p_filing_id;

  INSERT INTO tax_filing_lines (tax_filing_id, staff_id, employee_name, employment_type, pension_covered,
                                net_paid, gross, paye, pension_employee, pension_employer, payroll_ids, created_by)
  SELECT p_filing_id, s.staff_id, s.employee_name, s.employment_type, s.pension_covered,
         s.net_paid, s.gross_paid, s.paye_paid, s.pension_employee_paid, s.pension_employer_paid,
         s.payroll_ids_paid, auth.uid()
  FROM v_payroll_tax_by_staff_period s
  WHERE s.ec_year = v_f.period_ec_year AND s.ec_month = v_f.period_ec_month
    AND s.net_paid > 0
    -- A pension return lists only the people pension applies to.
    AND (v_f.schedule_code = 'SCH_A' OR s.pension_covered);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT CASE WHEN v_f.schedule_code = 'SCH_A' THEN sum(paye) ELSE sum(pension_employee + pension_employer) END
    INTO v_total FROM tax_filing_lines WHERE tax_filing_id = p_filing_id;

  RETURN jsonb_build_object('filing', v_f.schedule_code || ' ' || v_f.period_label, 'employees', v_n, 'total', COALESCE(v_total, 0));
END;
$$;
REVOKE EXECUTE ON FUNCTION build_tax_filing_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION build_tax_filing_schedule(uuid) TO authenticated;

-- Freeze on filing: when a Schedule A / pension return leaves draft with no
-- schedule yet, build it from payroll as it stands at that moment. BEFORE
-- UPDATE, so the builder still sees the row as a draft. SECURITY INVOKER --
-- the builder carries the definer rights and the auth guard.
CREATE OR REPLACE FUNCTION tax_filings_freeze_schedule()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status <> 'draft'
     AND NEW.schedule_code IN ('SCH_A', 'PENSION') AND NEW.period_ec_month IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM tax_filing_lines l WHERE l.tax_filing_id = NEW.id) THEN
    PERFORM build_tax_filing_schedule(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tax_filings_freeze_schedule ON tax_filings;
CREATE TRIGGER trg_tax_filings_freeze_schedule
  BEFORE UPDATE OF status ON tax_filings
  FOR EACH ROW EXECUTE FUNCTION tax_filings_freeze_schedule();

-- Admin deletion keeps the schedule in the audit snapshot (304's function,
-- with 'employee_lines' added).
CREATE OR REPLACE FUNCTION delete_tax_filing(p_filing_id UUID, p_reason TEXT)
RETURNS TEXT[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_filing   tax_filings%ROWTYPE;
  v_snapshot JSONB;
  v_paths    TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT COALESCE(get_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Only an admin can delete a recorded tax filing';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to delete a tax filing';
  END IF;

  SELECT * INTO v_filing FROM tax_filings WHERE id = p_filing_id;
  IF v_filing.id IS NULL THEN
    RAISE EXCEPTION 'Tax filing % not found', p_filing_id;
  END IF;

  SELECT to_jsonb(v_filing) || jsonb_build_object(
           'documents',
           COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM tax_filing_documents d
                      WHERE d.tax_filing_id = p_filing_id), '[]'::jsonb),
           'employee_lines',
           COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM tax_filing_lines l
                      WHERE l.tax_filing_id = p_filing_id), '[]'::jsonb))
    INTO v_snapshot;

  SELECT COALESCE(array_agg(storage_path), ARRAY[]::text[]) INTO v_paths
  FROM tax_filing_documents WHERE tax_filing_id = p_filing_id;

  INSERT INTO tax_filing_deletions
    (deleted_filing_snapshot, schedule_code, period_label, reason, deleted_by)
  VALUES (v_snapshot, v_filing.schedule_code, v_filing.period_label, btrim(p_reason), auth.uid());

  DELETE FROM tax_filings WHERE id = p_filing_id;

  RETURN v_paths;
END;
$$;
REVOKE EXECUTE ON FUNCTION delete_tax_filing(UUID, TEXT) FROM PUBLIC, anon;

-- ── tax_filing_computed: surface both new pieces ────────────────────────
-- VAT basis gains the flagged-but-unreviewed input VAT (317); Schedule A
-- and pension gain the schedule's size once one exists.
CREATE OR REPLACE FUNCTION tax_filing_computed(p_fiscal_period_id uuid)
RETURNS TABLE (filing_id uuid, schedule_code text, computed_amount numeric, basis jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fy fiscal_periods%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false)) THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see computed tax amounts';
  END IF;
  SELECT * INTO v_fy FROM fiscal_periods WHERE id = p_fiscal_period_id;
  IF v_fy.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;
  RETURN QUERY
  SELECT f.id,
         f.schedule_code,
         CASE f.schedule_code
           WHEN 'VAT'     THEN COALESCE(v.net_vat, 0)
           WHEN 'WHT'     THEN COALESCE(w.wht_withheld, 0)
           WHEN 'SCH_A'   THEN COALESCE(pt.paye_paid, 0)
           WHEN 'PENSION' THEN COALESCE(pt.pension_employee_paid, 0) + COALESCE(pt.pension_employer_paid, 0)
           ELSE NULL
         END,
         CASE f.schedule_code
           WHEN 'VAT' THEN jsonb_build_object(
             'output_vat',               COALESCE(v.output_vat, 0),
             'input_vat',                COALESCE(v.input_vat_reclaimable, 0),
             'input_vat_pending_review', COALESCE(v.input_vat_pending_review, 0),
             'sale_count',               COALESCE(v.sale_count, 0),
             'reviewed_receipt_count',   COALESCE(v.reviewed_receipt_count, 0))
           WHEN 'WHT' THEN jsonb_build_object(
             'paid_expense_count',     COALESCE(w.paid_expense_count, 0),
             'pending_expense_count',  COALESCE(w.pending_expense_count, 0),
             'wht_pending_unpaid',     COALESCE(w.wht_pending_unpaid, 0))
           WHEN 'SCH_A' THEN jsonb_build_object(
             'payroll_runs',           runs.n,
             'paid_staff_count',       COALESCE(pt.paid_staff_count, 0),
             'net_paid',               COALESCE(pt.net_paid, 0),
             'gross_paid',             COALESCE(pt.gross_paid, 0),
             'net_unpaid',             COALESCE(pt.net_unpaid, 0),
             'paye_incl_unpaid',       COALESCE(pt.paye_incl_unpaid, 0),
             'schedule_employees',     sch.n)
           WHEN 'PENSION' THEN jsonb_build_object(
             'payroll_runs',           runs.n,
             'employee_share',         COALESCE(pt.pension_employee_paid, 0),
             'employer_share',         COALESCE(pt.pension_employer_paid, 0),
             'gross_paid',             COALESCE(pt.gross_paid, 0),
             'schedule_employees',     sch.n)
           WHEN 'SCH_C' THEN jsonb_build_object(
             'client_wht_credits_expected',
               (SELECT COALESCE(sum(sw.expected_wht), 0)
                FROM v_sale_wht sw JOIN sales s ON s.id = sw.sale_id
                WHERE sw.qualifies AND s.date BETWEEN v_fy.start_date AND v_fy.end_date),
             'deductible_expenses',
               (SELECT COALESCE(sum(g.amount), 0)
                FROM v_government_expense_statement_by_ec_period g
                WHERE g.fiscal_period_id = v_fy.id),
             'note', 'Profit tax is computed from the annual accounts, not by this system.')
           ELSE NULL
         END
  FROM tax_filings f
  LEFT JOIN v_vat_position_by_ec_period v
    ON f.schedule_code = 'VAT' AND v.ec_year = f.period_ec_year AND v.ec_month = f.period_ec_month
  LEFT JOIN v_wht_payable_by_ec_period w
    ON f.schedule_code = 'WHT' AND w.ec_year = f.period_ec_year AND w.ec_month = f.period_ec_month
  LEFT JOIN v_payroll_tax_by_ec_period pt
    ON f.schedule_code IN ('SCH_A', 'PENSION') AND pt.ec_year = f.period_ec_year AND pt.ec_month = f.period_ec_month
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM payroll p
    WHERE f.period_ec_month IS NOT NULL
      AND p.start_date BETWEEN f.period_start_greg AND f.period_end_greg
      AND NOT COALESCE(p.is_archived, false)
  ) runs ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM tax_filing_lines l WHERE l.tax_filing_id = f.id
  ) sch ON true
  WHERE f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date;
END;
$$;
REVOKE EXECUTE ON FUNCTION tax_filing_computed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tax_filing_computed(uuid) TO authenticated;
