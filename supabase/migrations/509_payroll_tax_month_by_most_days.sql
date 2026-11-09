-- 509: A payroll run counts in the tax month most of its dates fall in.
--
-- Payroll tax and pension were worked out per person per tax month, putting
-- each run in the month of its start date. PR-2026-226, Tikimt's salaries,
-- was dated 8 Oct – 9 Nov; Tikimt starts on 11 Oct, so the run counted in
-- Meskerem, on top of each person's Meskerem salary. Their Tikimt pay was
-- then grossed up at the top rate with none of the band's deduction (Betelehem
-- Sime: ETB 20,000 net shown as ETB 34,482.75 gross instead of 30,948.28), and
-- Tikimt's payroll tax return read ETB 0. The run's date was corrected to
-- 11 Oct; from now on a run goes by the middle of its dates, so one that
-- starts a few days early (or ends a few days late) still lands in the month
-- it pays for. A run with no end date goes by its start date, as before.

SET search_path TO public;

-- The day that decides a run's tax month: halfway through its dates.
CREATE OR REPLACE FUNCTION public.payroll_tax_date(p_start date, p_end date)
RETURNS date LANGUAGE sql IMMUTABLE AS $f$
  SELECT p_start + (GREATEST(COALESCE(p_end, p_start), p_start) - p_start) / 2;
$f$;

CREATE OR REPLACE VIEW public.v_payroll_tax_by_staff_period AS
 WITH lines AS (
         SELECT ps_1.staff_id, ps_1.payroll_id, tp.ec_year, tp.ec_month, ps_1.net_amount,
            (p.payment_status = 'paid'::text) AS is_paid
           FROM payroll_staff ps_1
             JOIN payroll p ON p.id = ps_1.payroll_id
             CROSS JOIN LATERAL tax_period_for_date(payroll_tax_date(p.start_date, p.end_date)) tp(ec_year, ec_month)
          WHERE p.start_date IS NOT NULL AND NOT COALESCE(p.is_archived, false)
        ), per_staff AS (
         SELECT lines.staff_id, lines.ec_year, lines.ec_month,
            COALESCE(sum(lines.net_amount) FILTER (WHERE lines.is_paid), (0)::numeric) AS net_paid,
            COALESCE(sum(lines.net_amount), (0)::numeric) AS net_all,
            COALESCE(array_agg(lines.payroll_id) FILTER (WHERE lines.is_paid), '{}'::uuid[]) AS payroll_ids_paid,
            array_agg(lines.payroll_id) AS payroll_ids_all
           FROM lines
          GROUP BY lines.staff_id, lines.ec_year, lines.ec_month
        )
 SELECT ps.staff_id, st.employee_name, st.employment_type, ps.ec_year, ps.ec_month,
    ((ec_month_name(ps.ec_month) || ' '::text) || ps.ec_year) AS period_label,
    (COALESCE(st.employment_type, ''::text) <> 'tier_2_casual'::text) AS pension_covered,
    ps.net_paid,
    paid.gross AS gross_paid, paid.paye AS paye_paid,
    paid.pension_employee AS pension_employee_paid, paid.pension_employer AS pension_employer_paid,
    ps.net_all,
    allp.gross AS gross_incl_unpaid, allp.paye AS paye_incl_unpaid,
    allp.pension_employee AS pension_employee_incl_unpaid, allp.pension_employer AS pension_employer_incl_unpaid,
    (paid.gross + paid.pension_employer) AS employer_cost_paid,
    (allp.gross + allp.pension_employer) AS employer_cost_incl_unpaid,
    ps.payroll_ids_paid, ps.payroll_ids_all
   FROM per_staff ps
     JOIN staff st ON st.id = ps.staff_id
     CROSS JOIN LATERAL tax_period_bounds(ps.ec_year, ps.ec_month) b(start_greg, end_greg)
     LEFT JOIN LATERAL paye_gross_up(ps.net_paid, b.start_greg, (COALESCE(st.employment_type, ''::text) <> 'tier_2_casual'::text)) paid(gross, paye, pension_employee, pension_employer) ON true
     LEFT JOIN LATERAL paye_gross_up(ps.net_all, b.start_greg, (COALESCE(st.employment_type, ''::text) <> 'tier_2_casual'::text)) allp(gross, paye, pension_employee, pension_employer) ON true;

CREATE OR REPLACE VIEW public.v_payroll_line_tax AS
 SELECT ps.payroll_id, p.payroll_record, p.payroll_type, ps.staff_id, s.employee_name, s.ec_year, s.ec_month, s.period_label,
    (p.payment_status = 'paid'::text) AS is_paid,
    ps.net_amount,
    round(sh.part * sh.gross, 2) AS gross_share,
    round(sh.part * sh.paye, 2) AS paye_share,
    round(sh.part * sh.pen_emp, 2) AS pension_employee_share,
    round(sh.part * sh.pen_er, 2) AS pension_employer_share,
    round(sh.part * (sh.gross + sh.pen_er), 2) AS employer_cost_share
   FROM payroll_staff ps
     JOIN payroll p ON p.id = ps.payroll_id
     CROSS JOIN LATERAL tax_period_for_date(payroll_tax_date(p.start_date, p.end_date)) tp(ec_year, ec_month)
     JOIN v_payroll_tax_by_staff_period s ON s.staff_id = ps.staff_id AND s.ec_year = tp.ec_year AND s.ec_month = tp.ec_month
     CROSS JOIN LATERAL ( SELECT
            CASE WHEN p.payment_status = 'paid'::text THEN ps.net_amount / NULLIF(s.net_paid, (0)::numeric)
                 ELSE ps.net_amount / NULLIF(s.net_all - s.net_paid, (0)::numeric) END AS part,
            CASE WHEN p.payment_status = 'paid'::text THEN s.gross_paid ELSE s.gross_incl_unpaid - s.gross_paid END AS gross,
            CASE WHEN p.payment_status = 'paid'::text THEN s.paye_paid ELSE s.paye_incl_unpaid - s.paye_paid END AS paye,
            CASE WHEN p.payment_status = 'paid'::text THEN s.pension_employee_paid ELSE s.pension_employee_incl_unpaid - s.pension_employee_paid END AS pen_emp,
            CASE WHEN p.payment_status = 'paid'::text THEN s.pension_employer_paid ELSE s.pension_employer_incl_unpaid - s.pension_employer_paid END AS pen_er) sh
  WHERE p.start_date IS NOT NULL AND NOT COALESCE(p.is_archived, false);
