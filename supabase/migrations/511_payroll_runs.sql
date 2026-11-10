-- 511: Payroll runs built from the staff record, taxed properly, and booked.
--
-- Until now a payroll run was a list of agreed take-home amounts. The gross
-- column held the same number as the net, nothing was taken back for cash
-- advances, overtime and bonuses were taxed like salary, and the ledger
-- booked the take-home as the whole salary cost: no payroll tax, no pension.
-- This migration:
--
--   Staff     TIN, pension number and a pension exemption on the staff
--             record; a salary history kept from every change; a readiness
--             view saying what each person still needs before they can be
--             paid properly.
--
--   Runs      Kinds: Regular, Overtime, Bonus, Allowance, Back pay. A run
--             keeps the dates it pays for, the day it was paid and the tax
--             month it is declared in. Overtime is often paid weeks after
--             the salary run, so each kind is its own run with its own pay
--             date, and it lands in the tax month of the work it pays for.
--             If that month's payroll tax return has already been declared,
--             it moves to the next return still open.
--
--   Tax       PAYE is worked out on a person's whole month. Salary (Regular,
--             Back pay) is grossed up on its own; overtime, bonus and
--             allowances sit on top of it, so they take the marginal rate.
--             Pension (7% + 11%) is on basic salary only (Proclamation
--             715/2011 counts basic salary, not overtime or bonus). Each
--             line's tax is fixed when its run is paid; until then it is an
--             estimate that is refreshed whenever the month changes.
--
--   Lines     base_net (agreed take-home before anything is taken back),
--             days paid out of days in the period, advance_recovery (taken
--             back against cash advances), and the gross, PAYE and pension
--             each line carries. net_amount stays the cash paid out, so bank
--             matching, payment requests and VRFs carry on unchanged.
--
--   Ledger    When a run is paid:  Dr 6101 gross, Dr 6102 employer pension,
--             Cr 2020 PAYE + pension, Cr 1210 advances taken back,
--             Cr 2015 net pay owed. The money going out clears 2015: a bank
--             line matched to the run, or the account the run says paid it.
--             A paid run with no account keeps its net in 2015 until finance
--             says which account paid it.
--
--   Repair    Paid runs get their tax fixed, and PR-0019-001 and PR-2026-223,
--             which never reached the ledger because they had no account,
--             now post their salary cost and tax.

SET search_path TO public;

-- ─── Staff ──────────────────────────────────────────────────────────────────

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS tin text,
  ADD COLUMN IF NOT EXISTS pension_no text,
  ADD COLUMN IF NOT EXISTS pension_exempt boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.staff.tin IS 'Taxpayer identification number, listed on the payroll tax return (511).';
COMMENT ON COLUMN public.staff.pension_no IS 'Private pension number, listed on the pension return (511).';
COMMENT ON COLUMN public.staff.pension_exempt IS 'Not covered by private pension (already a pensioner, or a foreign national): no 7% / 11% (511).';

CREATE OR REPLACE FUNCTION public.staff_pension_covered(p_employment_type text, p_exempt boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT COALESCE(p_employment_type, '') <> 'tier_2_casual' AND NOT COALESCE(p_exempt, false)
$f$;

CREATE TABLE IF NOT EXISTS public.staff_salary_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  monthly_salary numeric NOT NULL CHECK (monthly_salary >= 0),
  effective_from date NOT NULL,
  reason         text,
  created_by     uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, effective_from)
);
COMMENT ON TABLE public.staff_salary_changes IS 'Agreed monthly take-home and the day it took effect (511). Kept from every change to staff.monthly_salary.';
ALTER TABLE public.staff_salary_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_salary_changes_read ON public.staff_salary_changes FOR SELECT TO authenticated
  USING (get_user_role()::text IN ('admin', 'hr_officer', 'finance', 'executive'));
GRANT SELECT ON public.staff_salary_changes TO authenticated;

INSERT INTO public.staff_salary_changes (staff_id, monthly_salary, effective_from, reason, created_by)
SELECT s.id, s.monthly_salary, COALESCE(s.starting_date, s.first_engaged_at, s.created_at::date),
       'On the staff record when salary history began', NULL
  FROM public.staff s
 WHERE s.monthly_salary IS NOT NULL AND s.monthly_salary >= 0
ON CONFLICT (staff_id, effective_from) DO NOTHING;

-- The salary in force on a day. Before the history begins, the first salary
-- on record is the best there is.
CREATE OR REPLACE FUNCTION public.staff_salary_on(p_staff uuid, p_on date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  SELECT COALESCE(
    (SELECT c.monthly_salary FROM staff_salary_changes c WHERE c.staff_id = p_staff AND c.effective_from <= p_on
      ORDER BY c.effective_from DESC LIMIT 1),
    (SELECT c.monthly_salary FROM staff_salary_changes c WHERE c.staff_id = p_staff ORDER BY c.effective_from LIMIT 1),
    (SELECT s.monthly_salary FROM staff s WHERE s.id = p_staff))
$f$;

CREATE OR REPLACE FUNCTION public.staff_salary_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  IF NEW.monthly_salary IS NULL OR NEW.monthly_salary < 0
     OR (TG_OP = 'UPDATE' AND NEW.monthly_salary IS NOT DISTINCT FROM OLD.monthly_salary)
     OR COALESCE(current_setting('kuncho.salary_history', true), '') = 'off' THEN
    RETURN NULL;
  END IF;
  INSERT INTO staff_salary_changes (staff_id, monthly_salary, effective_from, reason)
  VALUES (NEW.id, NEW.monthly_salary,
          CASE WHEN TG_OP = 'INSERT' THEN COALESCE(NEW.starting_date, CURRENT_DATE) ELSE CURRENT_DATE END,
          CASE WHEN TG_OP = 'INSERT' THEN 'Salary on joining' ELSE 'Changed on the staff record' END)
  ON CONFLICT (staff_id, effective_from) DO UPDATE
     SET monthly_salary = EXCLUDED.monthly_salary, reason = EXCLUDED.reason, created_by = auth.uid(), created_at = now();
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_staff_salary_history
  AFTER INSERT OR UPDATE OF monthly_salary ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.staff_salary_history();

-- Change a salary from a given day (a raise from next month, or one agreed
-- last month). The staff record keeps the salary in force today.
CREATE OR REPLACE FUNCTION public.staff_salary_set(p_staff uuid, p_salary numeric, p_from date, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_now numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer', 'finance') THEN
    RAISE EXCEPTION 'Only HR, finance or an admin can change a salary';
  END IF;
  IF p_salary IS NULL OR p_salary < 0 THEN RAISE EXCEPTION 'Give the new monthly salary'; END IF;
  IF p_from IS NULL THEN RAISE EXCEPTION 'Say which day the new salary starts'; END IF;
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id = p_staff) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  INSERT INTO staff_salary_changes (staff_id, monthly_salary, effective_from, reason)
  VALUES (p_staff, round(p_salary, 2), p_from, NULLIF(btrim(p_reason), ''))
  ON CONFLICT (staff_id, effective_from) DO UPDATE
     SET monthly_salary = EXCLUDED.monthly_salary, reason = EXCLUDED.reason, created_by = auth.uid(), created_at = now();
  v_now := staff_salary_on(p_staff, CURRENT_DATE);
  PERFORM set_config('kuncho.salary_history', 'off', true);
  UPDATE staff SET monthly_salary = v_now WHERE id = p_staff AND monthly_salary IS DISTINCT FROM v_now;
  PERFORM set_config('kuncho.salary_history', 'on', true);
END $f$;

-- What each person on the monthly payroll still needs on their record.
CREATE OR REPLACE VIEW public.v_staff_payroll_readiness WITH (security_invoker = on) AS
SELECT s.id AS staff_id, s.employee_name, s.status, s.employment_type, s.payment_frequency, s.monthly_salary,
       staff_pension_covered(s.employment_type, s.pension_exempt) AS pension_covered,
       ba.id AS bank_account_id,
       array_remove(ARRAY[
         CASE WHEN COALESCE(s.monthly_salary, 0) <= 0 THEN 'salary' END,
         CASE WHEN s.employment_type IS NULL THEN 'employment type' END,
         CASE WHEN s.payment_frequency IS NULL THEN 'pay frequency' END,
         CASE WHEN s.starting_date IS NULL THEN 'start date' END,
         CASE WHEN ba.id IS NULL THEN 'bank account' END,
         CASE WHEN NULLIF(btrim(s.tin), '') IS NULL THEN 'TIN' END,
         CASE WHEN staff_pension_covered(s.employment_type, s.pension_exempt) AND NULLIF(btrim(s.pension_no), '') IS NULL
              THEN 'pension number' END,
         CASE WHEN NULLIF(btrim(s.national_id), '') IS NULL THEN 'national ID' END
       ]::text[], NULL) AS missing
  FROM staff s
  LEFT JOIN LATERAL (SELECT b.id FROM staff_bank_accounts b WHERE b.staff_id = s.id AND b.is_active
                      ORDER BY b.is_primary DESC, b.created_at LIMIT 1) ba ON true
 WHERE COALESCE(s.employment_type, '') <> 'tier_2_casual'
   AND COALESCE(s.payment_frequency, '') <> 'Daily';
GRANT SELECT ON public.v_staff_payroll_readiness TO authenticated;

-- ─── Runs and lines ─────────────────────────────────────────────────────────

ALTER TABLE public.payroll
  ADD COLUMN IF NOT EXISTS paid_on date,
  ADD COLUMN IF NOT EXISTS tax_ec_year int,
  ADD COLUMN IF NOT EXISTS tax_ec_month int;
COMMENT ON COLUMN public.payroll.paid_on IS 'The day the money went out (511). Set when the run is marked paid if not given.';
COMMENT ON COLUMN public.payroll.tax_ec_year IS 'Tax month the run is declared in (511): the month its dates pay for, or the next open return if that one was already declared.';
ALTER TABLE public.payroll ADD CONSTRAINT payroll_tax_month_whole CHECK ((tax_ec_year IS NULL) = (tax_ec_month IS NULL));
ALTER TABLE public.payroll ADD CONSTRAINT payroll_type_known
  CHECK (payroll_type IS NULL OR payroll_type IN ('Regular', 'Overtime', 'Bonus', 'Allowance', 'Back pay'));

ALTER TABLE public.payroll_staff
  ADD COLUMN IF NOT EXISTS base_net numeric,
  ADD COLUMN IF NOT EXISTS days_paid numeric,
  ADD COLUMN IF NOT EXISTS days_in_period numeric,
  ADD COLUMN IF NOT EXISTS advance_recovery numeric NOT NULL DEFAULT 0 CHECK (advance_recovery >= 0),
  ADD COLUMN IF NOT EXISTS paye numeric,
  ADD COLUMN IF NOT EXISTS pension_employee numeric,
  ADD COLUMN IF NOT EXISTS pension_employer numeric,
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS note text;
COMMENT ON COLUMN public.payroll_staff.base_net IS 'Agreed take-home for this payment, before anything is taken back. Tax is worked back from it (511).';
COMMENT ON COLUMN public.payroll_staff.advance_recovery IS 'Taken back from this pay against cash advances; credits 1210 (511).';
COMMENT ON COLUMN public.payroll_staff.gross_amount IS 'Gross pay this line carries: base_net + PAYE + employee pension. Fixed when the run is paid (511).';
COMMENT ON COLUMN public.payroll_staff.net_amount IS 'Cash paid out: base_net less advance_recovery (511).';
COMMENT ON COLUMN public.payroll_staff.frozen_at IS 'When the run was paid and this line''s tax was fixed (511).';

-- Lines so far were entered as the agreed take-home with nothing taken off.
UPDATE public.payroll_staff
   SET base_net = COALESCE(net_amount, 0) + COALESCE(deductions, 0), advance_recovery = COALESCE(deductions, 0)
 WHERE base_net IS NULL;

-- Salary (and salary arrears) is basic pay: it carries pension and is taxed
-- first. Overtime, bonus and allowances are taxed on top and carry no pension.
CREATE OR REPLACE FUNCTION public.payroll_is_basic(p_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT COALESCE(p_type, 'Regular') IN ('Regular', 'Back pay')
$f$;

-- The tax month a run's dates point to; if that month's payroll tax return
-- has been declared, the next return still open.
CREATE OR REPLACE FUNCTION public.payroll_tax_month_for(p_start date, p_end date)
RETURNS TABLE(ec_year int, ec_month int) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_y int; v_m int; v_ny int; v_nm int;
BEGIN
  IF p_start IS NULL THEN RETURN; END IF;
  SELECT t.ec_year, t.ec_month INTO v_y, v_m FROM tax_period_for_date(payroll_tax_date(p_start, p_end)) t(ec_year, ec_month);
  IF EXISTS (SELECT 1 FROM tax_filings f WHERE f.schedule_code = 'SCH_A' AND f.status <> 'draft'
              AND f.period_ec_year = v_y AND f.period_ec_month = v_m) THEN
    SELECT f.period_ec_year, f.period_ec_month INTO v_ny, v_nm FROM tax_filings f
     WHERE f.schedule_code = 'SCH_A' AND f.status = 'draft' AND f.period_ec_month IS NOT NULL
       AND (f.period_ec_year, f.period_ec_month) > (v_y, v_m)
     ORDER BY f.period_start_greg LIMIT 1;
    IF v_ny IS NOT NULL THEN v_y := v_ny; v_m := v_nm; END IF;
  END IF;
  RETURN QUERY SELECT v_y, v_m;
END $f$;

-- Existing runs: the month most of their dates fall in (509), not moved.
UPDATE public.payroll p
   SET (tax_ec_year, tax_ec_month) = (SELECT t.ec_year, t.ec_month FROM tax_period_for_date(payroll_tax_date(p.start_date, p.end_date)) t(ec_year, ec_month))
 WHERE p.start_date IS NOT NULL AND p.tax_ec_year IS NULL;

-- ─── Tax on a person's month ────────────────────────────────────────────────

-- Gross, PAYE and pension for a month in which a person takes home p_basic
-- of salary and p_extra of overtime, bonus or allowances (agreed nets).
-- The salary is grossed up on its own, pension on its gross; the extra is
-- grossed up on top at the marginal rate:  G − PAYE(G) − pension = basic + extra.
CREATE OR REPLACE FUNCTION public.payroll_month_tax(p_basic numeric, p_extra numeric, p_on date, p_covered boolean)
RETURNS TABLE(gross numeric, paye numeric, pension_employee numeric, pension_employer numeric)
LANGUAGE plpgsql STABLE SET search_path TO public AS $f$
DECLARE
  v_bands jsonb := tax_rate_note('SCH_A', p_on) -> 'bands';
  v_b numeric := GREATEST(COALESCE(p_basic, 0), 0);
  v_x numeric := GREATEST(COALESCE(p_extra, 0), 0);
  v_s numeric := 0; v_pe numeric := 0; v_per numeric := 0;
  v_n numeric; v_band jsonb; v_cand numeric; v_g numeric;
BEGIN
  IF v_bands IS NULL THEN RETURN; END IF;
  IF v_b + v_x <= 0 THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric, 0::numeric; RETURN;
  END IF;
  IF v_b > 0 THEN
    SELECT u.gross, u.pension_employee, u.pension_employer INTO v_s, v_pe, v_per FROM paye_gross_up(v_b, p_on, p_covered) u;
    IF v_s IS NULL THEN RETURN; END IF;
  END IF;
  IF v_x <= 0 THEN
    RETURN QUERY SELECT v_s, round(v_s - v_pe - v_b, 2), v_pe, v_per; RETURN;
  END IF;
  v_n := v_b + v_x + v_pe;
  FOR v_band IN SELECT value FROM jsonb_array_elements(v_bands) ORDER BY (value ->> 'min')::numeric LOOP
    v_cand := (v_n - (v_band ->> 'deduct')::numeric) / (1 - (v_band ->> 'rate')::numeric);
    IF (v_band ->> 'max') IS NULL OR v_cand <= (v_band ->> 'max')::numeric THEN v_g := v_cand; EXIT; END IF;
  END LOOP;
  IF v_g IS NULL THEN RAISE EXCEPTION 'payroll_month_tax: no Schedule A band fits % on %', v_n, p_on; END IF;
  v_g := round(GREATEST(v_g, v_s), 2);
  RETURN QUERY SELECT v_g, round(v_g - v_pe - v_b - v_x, 2), v_pe, v_per;
END $f$;

-- Re-estimate the unpaid pay a person has in a tax month. Paid lines keep
-- the tax fixed when they were paid. Unpaid salary takes what is left of the
-- month's salary tax; unpaid overtime, bonus and allowances sit on top.
CREATE OR REPLACE FUNCTION public.payroll_retax(p_staff uuid, p_y int, p_m int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  v_on date; v_cov boolean;
  v_fb numeric; v_fx numeric; v_sg numeric; v_sp numeric; v_se numeric; v_sr numeric;
  v_cb numeric := 0; v_cx numeric := 0;
  a record; b record; r record;
BEGIN
  IF p_staff IS NULL OR p_y IS NULL OR p_m IS NULL THEN RETURN; END IF;
  SELECT staff_pension_covered(employment_type, pension_exempt) INTO v_cov FROM staff WHERE id = p_staff;
  IF v_cov IS NULL THEN RETURN; END IF;
  SELECT bd.start_greg INTO v_on FROM tax_period_bounds(p_y, p_m) bd(start_greg, end_greg);
  SELECT COALESCE(sum(ps.base_net) FILTER (WHERE payroll_is_basic(p.payroll_type)), 0),
         COALESCE(sum(ps.base_net) FILTER (WHERE NOT payroll_is_basic(p.payroll_type)), 0),
         COALESCE(sum(ps.gross_amount), 0), COALESCE(sum(ps.paye), 0),
         COALESCE(sum(ps.pension_employee), 0), COALESCE(sum(ps.pension_employer), 0)
    INTO v_fb, v_fx, v_sg, v_sp, v_se, v_sr
    FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
   WHERE ps.staff_id = p_staff AND ps.frozen_at IS NOT NULL AND NOT COALESCE(p.is_archived, false)
     AND p.tax_ec_year = p_y AND p.tax_ec_month = p_m;

  FOR r IN SELECT ps.payroll_id, ps.base_net FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
            WHERE ps.staff_id = p_staff AND ps.frozen_at IS NULL AND NOT COALESCE(p.is_archived, false)
              AND p.tax_ec_year = p_y AND p.tax_ec_month = p_m AND payroll_is_basic(p.payroll_type)
            ORDER BY p.created_at, p.id LOOP
    v_cb := v_cb + COALESCE(r.base_net, 0);
    SELECT * INTO a FROM payroll_month_tax(v_fb + v_cb, v_fx, v_on, v_cov);
    UPDATE payroll_staff SET gross_amount = a.gross - v_sg, paye = a.paye - v_sp,
           pension_employee = a.pension_employee - v_se, pension_employer = a.pension_employer - v_sr
     WHERE payroll_id = r.payroll_id AND staff_id = p_staff;
    v_sg := a.gross; v_sp := a.paye; v_se := a.pension_employee; v_sr := a.pension_employer;
  END LOOP;

  SELECT * INTO b FROM payroll_month_tax(v_fb + v_cb, v_fx, v_on, v_cov);
  FOR r IN SELECT ps.payroll_id, ps.base_net FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
            WHERE ps.staff_id = p_staff AND ps.frozen_at IS NULL AND NOT COALESCE(p.is_archived, false)
              AND p.tax_ec_year = p_y AND p.tax_ec_month = p_m AND NOT payroll_is_basic(p.payroll_type)
            ORDER BY p.created_at, p.id LOOP
    v_cx := v_cx + COALESCE(r.base_net, 0);
    SELECT * INTO a FROM payroll_month_tax(v_fb + v_cb, v_fx + v_cx, v_on, v_cov);
    UPDATE payroll_staff SET gross_amount = a.gross - b.gross, paye = a.paye - b.paye,
           pension_employee = a.pension_employee - b.pension_employee, pension_employer = a.pension_employer - b.pension_employer
     WHERE payroll_id = r.payroll_id AND staff_id = p_staff;
    b := a;
  END LOOP;
END $f$;

-- Every month a person has unpaid pay in.
CREATE OR REPLACE FUNCTION public.payroll_retax_staff(p_staff uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT p.tax_ec_year AS y, p.tax_ec_month AS m FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
            WHERE ps.staff_id = p_staff AND ps.frozen_at IS NULL AND p.tax_ec_year IS NOT NULL LOOP
    PERFORM payroll_retax(p_staff, r.y, r.m);
  END LOOP;
END $f$;

-- Fix the tax on a run as it is paid. Salary takes what is left of the
-- month's salary tax after what is already paid; overtime, bonus and
-- allowances are taxed on top of the month's salary, paid or still to come,
-- so the order things are paid in does not change who carries what.
CREATE OR REPLACE FUNCTION public.payroll_freeze(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  p payroll%ROWTYPE; v_on date; v_basic boolean; r record; a record; b record;
  v_fb numeric; v_fx numeric; v_sg numeric; v_sp numeric; v_se numeric; v_sr numeric; v_ub numeric;
BEGIN
  SELECT * INTO p FROM payroll WHERE id = p_run;
  IF p.id IS NULL OR p.tax_ec_year IS NULL OR COALESCE(p.is_archived, false) THEN RETURN; END IF;
  v_basic := payroll_is_basic(p.payroll_type);
  SELECT bd.start_greg INTO v_on FROM tax_period_bounds(p.tax_ec_year, p.tax_ec_month) bd(start_greg, end_greg);
  FOR r IN SELECT ps.staff_id, ps.base_net, staff_pension_covered(st.employment_type, st.pension_exempt) AS cov
             FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
            WHERE ps.payroll_id = p_run AND ps.frozen_at IS NULL LOOP
    SELECT COALESCE(sum(ps.base_net) FILTER (WHERE payroll_is_basic(q.payroll_type)), 0),
           COALESCE(sum(ps.base_net) FILTER (WHERE NOT payroll_is_basic(q.payroll_type)), 0),
           COALESCE(sum(ps.gross_amount), 0), COALESCE(sum(ps.paye), 0),
           COALESCE(sum(ps.pension_employee), 0), COALESCE(sum(ps.pension_employer), 0)
      INTO v_fb, v_fx, v_sg, v_sp, v_se, v_sr
      FROM payroll_staff ps JOIN payroll q ON q.id = ps.payroll_id
     WHERE ps.staff_id = r.staff_id AND ps.frozen_at IS NOT NULL AND q.id <> p_run AND NOT COALESCE(q.is_archived, false)
       AND q.tax_ec_year = p.tax_ec_year AND q.tax_ec_month = p.tax_ec_month;
    IF v_basic THEN
      SELECT * INTO a FROM payroll_month_tax(v_fb + COALESCE(r.base_net, 0), v_fx, v_on, r.cov);
      UPDATE payroll_staff SET gross_amount = a.gross - v_sg, paye = a.paye - v_sp,
             pension_employee = a.pension_employee - v_se, pension_employer = a.pension_employer - v_sr, frozen_at = now()
       WHERE payroll_id = p_run AND staff_id = r.staff_id;
    ELSE
      SELECT COALESCE(sum(ps.base_net), 0) INTO v_ub
        FROM payroll_staff ps JOIN payroll q ON q.id = ps.payroll_id
       WHERE ps.staff_id = r.staff_id AND ps.frozen_at IS NULL AND q.id <> p_run AND NOT COALESCE(q.is_archived, false)
         AND q.tax_ec_year = p.tax_ec_year AND q.tax_ec_month = p.tax_ec_month AND payroll_is_basic(q.payroll_type);
      SELECT * INTO b FROM payroll_month_tax(v_fb + v_ub, v_fx, v_on, r.cov);
      SELECT * INTO a FROM payroll_month_tax(v_fb + v_ub, v_fx + COALESCE(r.base_net, 0), v_on, r.cov);
      UPDATE payroll_staff SET gross_amount = a.gross - b.gross, paye = a.paye - b.paye,
             pension_employee = a.pension_employee - b.pension_employee,
             pension_employer = a.pension_employer - b.pension_employer, frozen_at = now()
       WHERE payroll_id = p_run AND staff_id = r.staff_id;
    END IF;
    PERFORM payroll_retax(r.staff_id, p.tax_ec_year, p.tax_ec_month);
  END LOOP;
END $f$;

CREATE OR REPLACE FUNCTION public.payroll_unfreeze(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE r record;
BEGIN
  UPDATE payroll_staff SET frozen_at = NULL WHERE payroll_id = p_run AND frozen_at IS NOT NULL;
  FOR r IN SELECT ps.staff_id FROM payroll_staff ps WHERE ps.payroll_id = p_run LOOP
    PERFORM payroll_retax_staff(r.staff_id);
  END LOOP;
END $f$;

-- ─── Line guards ────────────────────────────────────────────────────────────

-- net_amount is always the cash paid out. A line written the old way (the
-- agreed take-home as gross, a deduction, the net) is read as such. A paid
-- line's pay cannot change until its run is set back from paid.
CREATE OR REPLACE FUNCTION public.payroll_staff_before()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.frozen_at IS NOT NULL THEN
      RAISE EXCEPTION 'This person was paid on this run, so they cannot be taken off it. Set the run back from paid first.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.frozen_at IS NOT NULL AND NEW.frozen_at IS NOT NULL
     AND (NEW.base_net, NEW.advance_recovery, NEW.staff_id, NEW.payroll_id)
         IS DISTINCT FROM (OLD.base_net, OLD.advance_recovery, OLD.staff_id, OLD.payroll_id) THEN
    RAISE EXCEPTION 'This pay was paid and its tax is fixed. Set the run back from paid first.';
  END IF;
  IF NEW.base_net IS NULL THEN
    NEW.advance_recovery := COALESCE(NEW.deductions, 0);
    NEW.base_net := COALESCE(NEW.net_amount, 0) + NEW.advance_recovery;
  END IF;
  NEW.base_net := round(NEW.base_net, 2);
  NEW.advance_recovery := round(COALESCE(NEW.advance_recovery, 0), 2);
  IF NEW.advance_recovery > NEW.base_net THEN
    RAISE EXCEPTION 'More is being taken back than the pay itself';
  END IF;
  NEW.deductions := NEW.advance_recovery;
  NEW.net_amount := round(NEW.base_net - NEW.advance_recovery, 2);
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_payroll_staff_before
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_staff
  FOR EACH ROW EXECUTE FUNCTION public.payroll_staff_before();

CREATE OR REPLACE FUNCTION public.payroll_staff_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_y int; v_m int; v_paid boolean;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT tax_ec_year, tax_ec_month INTO v_y, v_m FROM payroll WHERE id = OLD.payroll_id;
    IF v_y IS NULL THEN PERFORM payroll_retax_staff(OLD.staff_id);
    ELSE PERFORM payroll_retax(OLD.staff_id, v_y, v_m);
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.staff_id, NEW.payroll_id) IS DISTINCT FROM (OLD.staff_id, OLD.payroll_id)) THEN
    SELECT tax_ec_year, tax_ec_month, payment_status = 'paid' INTO v_y, v_m, v_paid FROM payroll WHERE id = NEW.payroll_id;
    PERFORM payroll_retax(NEW.staff_id, v_y, v_m);
    -- Someone added to a run that is already paid is paid too.
    IF v_paid THEN
      PERFORM payroll_freeze(NEW.payroll_id);
      PERFORM payroll_sync_ledger(NEW.payroll_id);
    END IF;
  END IF;
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_payroll_staff_after
  AFTER INSERT OR DELETE OR UPDATE OF base_net, advance_recovery, staff_id, payroll_id ON public.payroll_staff
  FOR EACH ROW EXECUTE FUNCTION public.payroll_staff_after();

-- A change of employment type or pension exemption changes unpaid estimates.
CREATE OR REPLACE FUNCTION public.staff_payroll_retax()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
BEGIN
  IF staff_pension_covered(NEW.employment_type, NEW.pension_exempt) IS DISTINCT FROM staff_pension_covered(OLD.employment_type, OLD.pension_exempt) THEN
    PERFORM payroll_retax_staff(NEW.id);
  END IF;
  RETURN NULL;
END $f$;
CREATE OR REPLACE TRIGGER trg_staff_payroll_retax
  AFTER UPDATE OF employment_type, pension_exempt ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.staff_payroll_retax();

-- ─── Tax views, read from the lines ─────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_payroll_tax_by_staff_period AS
 WITH lines AS (
         SELECT ps.staff_id, ps.payroll_id, p.tax_ec_year AS ec_year, p.tax_ec_month AS ec_month,
            COALESCE(ps.base_net, ps.net_amount, 0) AS net,
            (p.payment_status = 'paid'::text) AS is_paid,
            COALESCE(ps.gross_amount, 0) AS gross, COALESCE(ps.paye, 0) AS paye,
            COALESCE(ps.pension_employee, 0) AS pen_emp, COALESCE(ps.pension_employer, 0) AS pen_er
           FROM payroll_staff ps
             JOIN payroll p ON p.id = ps.payroll_id
          WHERE p.tax_ec_year IS NOT NULL AND NOT COALESCE(p.is_archived, false)
        ), per_staff AS (
         SELECT l.staff_id, l.ec_year, l.ec_month,
            COALESCE(sum(l.net) FILTER (WHERE l.is_paid), 0::numeric) AS net_paid,
            COALESCE(sum(l.gross) FILTER (WHERE l.is_paid), 0::numeric) AS gross_paid,
            COALESCE(sum(l.paye) FILTER (WHERE l.is_paid), 0::numeric) AS paye_paid,
            COALESCE(sum(l.pen_emp) FILTER (WHERE l.is_paid), 0::numeric) AS pen_emp_paid,
            COALESCE(sum(l.pen_er) FILTER (WHERE l.is_paid), 0::numeric) AS pen_er_paid,
            COALESCE(sum(l.net), 0::numeric) AS net_all,
            COALESCE(sum(l.gross), 0::numeric) AS gross_all,
            COALESCE(sum(l.paye), 0::numeric) AS paye_all,
            COALESCE(sum(l.pen_emp), 0::numeric) AS pen_emp_all,
            COALESCE(sum(l.pen_er), 0::numeric) AS pen_er_all,
            COALESCE(array_agg(l.payroll_id) FILTER (WHERE l.is_paid), '{}'::uuid[]) AS payroll_ids_paid,
            array_agg(l.payroll_id) AS payroll_ids_all
           FROM lines l
          GROUP BY l.staff_id, l.ec_year, l.ec_month
        )
 SELECT ps.staff_id, st.employee_name, st.employment_type, ps.ec_year, ps.ec_month,
    ((ec_month_name(ps.ec_month) || ' '::text) || ps.ec_year) AS period_label,
    staff_pension_covered(st.employment_type, st.pension_exempt) AS pension_covered,
    ps.net_paid, ps.gross_paid, ps.paye_paid,
    ps.pen_emp_paid AS pension_employee_paid, ps.pen_er_paid AS pension_employer_paid,
    ps.net_all, ps.gross_all AS gross_incl_unpaid, ps.paye_all AS paye_incl_unpaid,
    ps.pen_emp_all AS pension_employee_incl_unpaid, ps.pen_er_all AS pension_employer_incl_unpaid,
    (ps.gross_paid + ps.pen_er_paid) AS employer_cost_paid,
    (ps.gross_all + ps.pen_er_all) AS employer_cost_incl_unpaid,
    ps.payroll_ids_paid, ps.payroll_ids_all
   FROM per_staff ps
     JOIN staff st ON st.id = ps.staff_id;

CREATE OR REPLACE VIEW public.v_payroll_line_tax AS
 SELECT ps.payroll_id, p.payroll_record, p.payroll_type, ps.staff_id, st.employee_name,
    p.tax_ec_year AS ec_year, p.tax_ec_month AS ec_month,
    ((ec_month_name(p.tax_ec_month) || ' '::text) || p.tax_ec_year) AS period_label,
    (p.payment_status = 'paid'::text) AS is_paid,
    ps.net_amount,
    round(COALESCE(ps.gross_amount, 0), 2) AS gross_share,
    round(COALESCE(ps.paye, 0), 2) AS paye_share,
    round(COALESCE(ps.pension_employee, 0), 2) AS pension_employee_share,
    round(COALESCE(ps.pension_employer, 0), 2) AS pension_employer_share,
    round(COALESCE(ps.gross_amount, 0) + COALESCE(ps.pension_employer, 0), 2) AS employer_cost_share,
    COALESCE(ps.base_net, ps.net_amount) AS base_net,
    ps.advance_recovery,
    (ps.frozen_at IS NOT NULL) AS tax_fixed,
    payroll_is_basic(p.payroll_type) AS carries_pension,
    ps.days_paid, ps.days_in_period
   FROM payroll_staff ps
     JOIN payroll p ON p.id = ps.payroll_id
     JOIN staff st ON st.id = ps.staff_id
  WHERE p.tax_ec_year IS NOT NULL AND NOT COALESCE(p.is_archived, false);

-- ─── Building and saving a run ──────────────────────────────────────────────

-- What a person still owes on cash advances: advanced, less receipts settled
-- against it, less what payroll has already taken back.
CREATE OR REPLACE FUNCTION public.payroll_open_advance(p_staff uuid, p_skip_run uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  SELECT GREATEST(0, round(
      COALESCE((SELECT sum(a.amount_advanced - COALESCE((
                  SELECT sum(e.amount_etb) FROM cash_advance_expenses x JOIN expenses e ON e.id = x.expense_id
                   WHERE x.cash_advance_id = a.id AND NOT COALESCE(e.is_archived, false)), 0))
                  FROM cash_advances a
                 WHERE a.staff_id = p_staff AND a.approval_status::text = 'finance_approved' AND NOT COALESCE(a.is_archived, false)), 0)
    - COALESCE((SELECT sum(ps.advance_recovery) FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
                 WHERE ps.staff_id = p_staff AND NOT COALESCE(p.is_archived, false)
                   AND ps.payroll_id IS DISTINCT FROM p_skip_run), 0), 2))
$f$;

CREATE OR REPLACE FUNCTION public.payroll_can_build()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT COALESCE(get_user_role()::text, '') IN ('admin', 'finance', 'hr_officer')
$f$;

-- Everyone on the monthly payroll for the dates, with the salary in force,
-- the days they were employed, what they owe on advances and anything on
-- their record that is missing. For a Regular run the amount is filled in
-- (prorated for a mid-month start or exit); other kinds leave it to type.
CREATE OR REPLACE FUNCTION public.payroll_run_draft(p_type text, p_start date, p_end date, p_run uuid DEFAULT NULL)
RETURNS TABLE(staff_id uuid, employee_name text, role text, monthly_salary numeric, days_paid numeric, days_in_period numeric,
              base_net numeric, open_advance numeric, bank_account_id uuid, already_on text, flags text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  v_days numeric; v_y int; v_m int; s record; v_from date; v_to date; v_sal numeric; v_paid numeric; v_flags text[]; v_on text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT payroll_can_build() THEN RAISE EXCEPTION 'Only HR, finance or an admin can build a payroll run'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN RAISE EXCEPTION 'Give the dates the run pays for'; END IF;
  v_days := p_end - p_start + 1;
  SELECT t.ec_year, t.ec_month INTO v_y, v_m FROM tax_period_for_date(payroll_tax_date(p_start, p_end)) t(ec_year, ec_month);
  FOR s IN SELECT st.*, r.missing, r.bank_account_id AS ba
             FROM staff st JOIN v_staff_payroll_readiness r ON r.staff_id = st.id
            WHERE (st.starting_date IS NULL OR st.starting_date <= p_end)
              AND (st.termination_date IS NULL OR st.termination_date >= p_start)
              AND (st.status = 'active' OR st.termination_date >= p_start)
            ORDER BY st.employee_name LOOP
    v_from := GREATEST(p_start, COALESCE(s.starting_date, p_start));
    v_to := LEAST(p_end, COALESCE(s.termination_date, p_end));
    v_paid := GREATEST(0, v_to - v_from + 1);
    v_sal := staff_salary_on(s.id, p_end);
    v_flags := ARRAY[]::text[];
    IF s.starting_date > p_start THEN v_flags := v_flags || ('Started ' || to_char(s.starting_date, 'DD Mon YYYY')); END IF;
    IF s.termination_date < p_end THEN v_flags := v_flags || ('Left ' || to_char(s.termination_date, 'DD Mon YYYY')); END IF;
    IF EXISTS (SELECT 1 FROM staff_salary_changes c WHERE c.staff_id = s.id AND c.effective_from > p_start AND c.effective_from <= p_end) THEN
      v_flags := v_flags || 'Salary changed during these dates'::text;
    END IF;
    v_flags := v_flags || ARRAY(SELECT 'No ' || m FROM unnest(s.missing) m);
    SELECT string_agg(DISTINCT p.payroll_record, ', ') INTO v_on
      FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
     WHERE ps.staff_id = s.id AND NOT COALESCE(p.is_archived, false) AND p.id IS DISTINCT FROM p_run
       AND COALESCE(p.payroll_type, 'Regular') = COALESCE(p_type, 'Regular') AND p.start_date IS NOT NULL
       AND (SELECT (t.ec_year, t.ec_month) = (v_y, v_m) FROM tax_period_for_date(payroll_tax_date(p.start_date, p.end_date)) t(ec_year, ec_month));
    RETURN QUERY SELECT s.id, s.employee_name, s.role, v_sal, v_paid, v_days,
      CASE WHEN COALESCE(p_type, 'Regular') = 'Regular' AND COALESCE(v_sal, 0) > 0
           THEN round(v_sal * v_paid / v_days, 2) END,
      payroll_open_advance(s.id, p_run), s.ba, v_on, v_flags;
  END LOOP;
END $f$;

-- Save a run and its people in one go. Lines already matched to a bank line
-- keep their amount; a Regular run takes each person once per month.
CREATE OR REPLACE FUNCTION public.payroll_run_save(p_run jsonb, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  v_id uuid := NULLIF(p_run ->> 'id', '')::uuid;
  p payroll%ROWTYPE; e payroll_staff%ROWTYPE;
  v_type text := COALESCE(NULLIF(p_run ->> 'payroll_type', ''), 'Regular');
  v_start date := NULLIF(p_run ->> 'start_date', '')::date;
  v_end date := NULLIF(p_run ->> 'end_date', '')::date;
  v_y int; v_m int; l jsonb; v_staff uuid; v_name text; v_base numeric; v_adv numeric; v_open numeric;
  v_seen uuid[] := '{}'; v_dup text; v_ba uuid; v_left text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT payroll_can_build() THEN RAISE EXCEPTION 'Only HR, finance or an admin can save a payroll run'; END IF;
  IF v_type NOT IN ('Regular', 'Overtime', 'Bonus', 'Allowance', 'Back pay') THEN RAISE EXCEPTION 'Unknown kind of run: %', v_type; END IF;
  IF v_start IS NULL THEN RAISE EXCEPTION 'Give the dates the run pays for'; END IF;
  IF v_end IS NOT NULL AND v_end < v_start THEN RAISE EXCEPTION 'The run ends before it starts'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Add at least one person to the run';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO p FROM payroll WHERE id = v_id FOR UPDATE;
    IF p.id IS NULL OR COALESCE(p.is_archived, false) THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
    IF p.payment_status = 'paid' THEN
      RAISE EXCEPTION '% is paid, so its pay and tax are fixed. Set it back from paid first.', COALESCE(p.payroll_record, 'This run');
    END IF;
    UPDATE payroll SET payroll_type = v_type, start_date = v_start, end_date = v_end,
           pay_period = COALESCE(NULLIF(p_run ->> 'pay_period', ''), pay_period, 'Monthly'),
           paid_on = NULLIF(p_run ->> 'paid_on', '')::date,
           payment_method = NULLIF(p_run ->> 'payment_method', ''),
           account_id = NULLIF(p_run ->> 'account_id', '')::uuid,
           transfer_id = NULLIF(p_run ->> 'transfer_id', '')::uuid,
           vrf_id = NULLIF(p_run ->> 'vrf_id', '')::uuid,
           notes = NULLIF(btrim(p_run ->> 'notes'), '')
     WHERE id = v_id;
  ELSE
    INSERT INTO payroll (payroll_type, start_date, end_date, pay_period, paid_on, payment_method, account_id, transfer_id, vrf_id, notes, payment_status)
    VALUES (v_type, v_start, v_end, COALESCE(NULLIF(p_run ->> 'pay_period', ''), 'Monthly'),
            NULLIF(p_run ->> 'paid_on', '')::date, NULLIF(p_run ->> 'payment_method', ''),
            NULLIF(p_run ->> 'account_id', '')::uuid, NULLIF(p_run ->> 'transfer_id', '')::uuid,
            NULLIF(p_run ->> 'vrf_id', '')::uuid, NULLIF(btrim(p_run ->> 'notes'), ''), 'pending')
    RETURNING id INTO v_id;
  END IF;

  SELECT t.ec_year, t.ec_month INTO v_y, v_m FROM tax_period_for_date(payroll_tax_date(v_start, v_end)) t(ec_year, ec_month);

  FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_staff := NULLIF(l ->> 'staff_id', '')::uuid;
    SELECT employee_name INTO v_name FROM staff WHERE id = v_staff;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Someone on the run is not on the staff list'; END IF;
    IF v_staff = ANY (v_seen) THEN RAISE EXCEPTION '% is on the run twice', v_name; END IF;
    v_seen := v_seen || v_staff;
    v_base := round(NULLIF(l ->> 'base_net', '')::numeric, 2);
    IF v_base IS NULL OR v_base <= 0 THEN RAISE EXCEPTION 'Give % an amount', v_name; END IF;
    v_adv := round(COALESCE(NULLIF(l ->> 'advance_recovery', '')::numeric, 0), 2);
    IF v_adv < 0 THEN RAISE EXCEPTION 'What is taken back from % cannot be negative', v_name; END IF;
    IF v_adv > v_base THEN RAISE EXCEPTION 'More is being taken back from % than their pay', v_name; END IF;
    IF v_adv > 0 THEN
      v_open := payroll_open_advance(v_staff, v_id);
      IF v_adv > v_open + 0.005 THEN
        RAISE EXCEPTION '% owes only % on cash advances', v_name, to_char(v_open, 'FM999,999,990.00');
      END IF;
    END IF;
    v_ba := NULLIF(l ->> 'staff_bank_account_id', '')::uuid;
    IF v_ba IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff_bank_accounts b WHERE b.id = v_ba AND b.staff_id = v_staff) THEN
      RAISE EXCEPTION 'The bank account picked for % is not theirs', v_name;
    END IF;

    SELECT * INTO e FROM payroll_staff WHERE payroll_id = v_id AND staff_id = v_staff;
    IF e.bank_line_id IS NOT NULL AND round(v_base - v_adv, 2) <> round(COALESCE(e.net_amount, 0), 2) THEN
      RAISE EXCEPTION '%''s pay is already matched to a bank line, so it cannot change. Unmatch the bank line first.', v_name;
    END IF;
    IF e.payroll_id IS NULL AND v_type = 'Regular' THEN
      SELECT string_agg(DISTINCT q.payroll_record, ', ') INTO v_dup
        FROM payroll_staff ps JOIN payroll q ON q.id = ps.payroll_id
       WHERE ps.staff_id = v_staff AND q.id <> v_id AND NOT COALESCE(q.is_archived, false)
         AND COALESCE(q.payroll_type, 'Regular') = 'Regular' AND q.start_date IS NOT NULL
         AND (SELECT (t.ec_year, t.ec_month) = (v_y, v_m) FROM tax_period_for_date(payroll_tax_date(q.start_date, q.end_date)) t(ec_year, ec_month));
      IF v_dup IS NOT NULL THEN
        RAISE EXCEPTION '% already has their % salary on %. Pay anything extra on an Overtime, Bonus, Allowance or Back pay run.',
          v_name, ec_month_name(v_m) || ' ' || v_y, v_dup;
      END IF;
    END IF;

    INSERT INTO payroll_staff (payroll_id, staff_id, base_net, advance_recovery, days_paid, days_in_period, staff_bank_account_id, note)
    VALUES (v_id, v_staff, v_base, v_adv, NULLIF(l ->> 'days_paid', '')::numeric, NULLIF(l ->> 'days_in_period', '')::numeric,
            v_ba, NULLIF(btrim(l ->> 'note'), ''))
    ON CONFLICT (payroll_id, staff_id) DO UPDATE
       SET base_net = EXCLUDED.base_net, advance_recovery = EXCLUDED.advance_recovery,
           days_paid = EXCLUDED.days_paid, days_in_period = EXCLUDED.days_in_period,
           staff_bank_account_id = EXCLUDED.staff_bank_account_id, note = EXCLUDED.note;
  END LOOP;

  SELECT string_agg(st.employee_name, ', ') INTO v_left FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
   WHERE ps.payroll_id = v_id AND NOT (ps.staff_id = ANY (v_seen)) AND ps.bank_line_id IS NOT NULL;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '% already paid by a bank line, so cannot come off the run. Unmatch the bank line first.', v_left;
  END IF;
  EXECUTE 'DEL' || 'ETE FROM payroll_staff WHERE payroll_id = $1 AND NOT (staff_id = ANY ($2))' USING v_id, v_seen;

  -- Advances this run clears in full are closed against it.
  UPDATE cash_advances a SET payroll_id = v_id
   WHERE a.payroll_id IS NULL AND a.approval_status::text = 'finance_approved' AND NOT COALESCE(a.is_archived, false)
     AND a.staff_id IN (SELECT ps.staff_id FROM payroll_staff ps WHERE ps.payroll_id = v_id AND ps.advance_recovery > 0)
     AND payroll_open_advance(a.staff_id, NULL) <= 0.005;
  RETURN v_id;
END $f$;

-- What saving would work out, without saving: the run is saved inside a
-- savepoint, read back, and the savepoint undone.
CREATE OR REPLACE FUNCTION public.payroll_run_preview(p_run jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_out jsonb; v_id uuid;
BEGIN
  BEGIN
    v_id := payroll_run_save(p_run, p_lines);
    SELECT jsonb_build_object(
             'tax_month', (SELECT ec_month_name(p.tax_ec_month) || ' ' || p.tax_ec_year FROM payroll p WHERE p.id = v_id),
             'tax_month_moved', (SELECT (p.tax_ec_year, p.tax_ec_month) IS DISTINCT FROM (t.ec_year, t.ec_month)
                                   FROM payroll p, tax_period_for_date(payroll_tax_date(p.start_date, p.end_date)) t(ec_year, ec_month) WHERE p.id = v_id),
             'lines', COALESCE(jsonb_agg(jsonb_build_object(
               'staff_id', ps.staff_id, 'base_net', ps.base_net, 'advance_recovery', ps.advance_recovery, 'net_amount', ps.net_amount,
               'gross', ps.gross_amount, 'paye', ps.paye, 'pension_employee', ps.pension_employee,
               'pension_employer', ps.pension_employer)), '[]'::jsonb))
      INTO v_out FROM payroll_staff ps WHERE ps.payroll_id = v_id;
    RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = 'preview';
  EXCEPTION WHEN SQLSTATE 'P0K01' THEN
    RETURN v_out;
  END;
END $f$;

-- ─── Ledger ─────────────────────────────────────────────────────────────────

INSERT INTO public.chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, system_key, description)
SELECT '6102', 'Employer pension contribution', 'Expense', c.parent_account_id, true, true, 'operating', 'employer_pension',
       'The 11% the company adds to each covered employee''s basic salary (511).'
  FROM public.chart_of_accounts c
 WHERE c.account_code = '6101'
   AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE account_code = '6102' OR system_key = 'employer_pension');

-- A paid run's salary cost and tax, and the part of its net pay that left
-- through the run's own account rather than a matched bank line.
CREATE OR REPLACE FUNCTION public.payroll_sync_ledger(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE
  p payroll%ROWTYPE; v_date date; v_pay_date date; v_label text; t record; r record;
  v_cash uuid; v_unmatched numeric; v_acc jsonb := '[]'::jsonb; v_pay jsonb := '[]'::jsonb; v_live boolean;
BEGIN
  SELECT * INTO p FROM payroll WHERE id = p_run;
  v_date := COALESCE(p.end_date, p.start_date, CURRENT_DATE);
  v_pay_date := COALESCE(p.paid_on, v_date);
  v_label := COALESCE(p.payroll_record, 'payroll') || ' · ' || COALESCE(p.payroll_type, 'Regular')
             || COALESCE(' · ' || ec_month_name(p.tax_ec_month) || ' ' || p.tax_ec_year, '');
  v_live := p.id IS NOT NULL AND p.payment_status = 'paid' AND NOT COALESCE(p.is_archived, false);

  IF v_live AND in_current_fy(v_date) THEN
    SELECT COALESCE(sum(gross_amount), 0) AS gross, COALESCE(sum(paye), 0) AS paye,
           COALESCE(sum(pension_employee), 0) AS pe, COALESCE(sum(pension_employer), 0) AS per,
           COALESCE(sum(net_amount), 0) AS net, count(*) AS n
      INTO t FROM payroll_staff WHERE payroll_id = p.id;
    IF t.n > 0 THEN
      v_acc := jsonb_build_array(
        ledger_line(coa_id('salaries'), t.gross, 'Gross pay: ' || t.n || CASE WHEN t.n = 1 THEN ' person' ELSE ' people' END),
        ledger_line(coa_id('employer_pension'), t.per, 'Employer pension 11%'),
        ledger_line(coa_id('payroll_taxes'), -(t.paye + t.pe + t.per),
                    'PAYE ' || to_char(t.paye, 'FM999,999,990.00') || ', pension ' || to_char(t.pe + t.per, 'FM999,999,990.00')),
        ledger_line(coa_id('wages_payable'), -t.net, 'Net pay owed'));
      FOR r IN SELECT staff_id, advance_recovery FROM payroll_staff WHERE payroll_id = p.id AND advance_recovery > 0 LOOP
        v_acc := v_acc || jsonb_build_array(
          ledger_line(coa_id('staff_advances'), -r.advance_recovery, 'Taken back from pay', NULL, NULL, NULL, r.staff_id));
      END LOOP;
    END IF;
  END IF;
  PERFORM ledger_sync('payroll', p_run, v_date, 'Payroll ' || v_label, v_acc);

  IF v_live AND p.account_id IS NOT NULL AND in_current_fy(v_pay_date) THEN
    SELECT COALESCE(sum(net_amount), 0) INTO v_unmatched FROM payroll_staff WHERE payroll_id = p.id AND bank_line_id IS NULL;
    IF v_unmatched > 0 THEN
      SELECT id INTO v_cash FROM chart_of_accounts WHERE linked_account_id = p.account_id;
      IF v_cash IS NULL THEN
        PERFORM log_posting_failure('payroll', p_run, 'The account this run was paid from has no ledger account linked to it');
      ELSE
        v_pay := jsonb_build_array(
          ledger_line(coa_id('wages_payable'), v_unmatched, 'Net pay paid'),
          ledger_line(v_cash, -v_unmatched, 'Paid from ' || COALESCE((SELECT account_name FROM accounts WHERE id = p.account_id), 'the run''s account')));
      END IF;
    END IF;
  END IF;
  PERFORM ledger_sync('payroll_payment', p_run, v_pay_date, 'Salaries paid: ' || v_label, v_pay);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('payroll', p_run, SQLERRM);
END $f$;

-- A bank line that paid salaries clears what the payroll owes them.
CREATE OR REPLACE FUNCTION public.post_payroll_bank_line(p_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE l bank_statement_lines%ROWTYPE; v_net numeric; v_n int; v_cash uuid; v_record text; v_lines jsonb := '[]'::jsonb; r record;
BEGIN
  SELECT * INTO l FROM bank_statement_lines WHERE id = p_line_id;
  IF l.id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(sum(ps.net_amount), 0), count(*), string_agg(DISTINCT p.payroll_record, ', ')
    INTO v_net, v_n, v_record
    FROM payroll_staff ps JOIN payroll p ON p.id = ps.payroll_id
   WHERE ps.bank_line_id = p_line_id AND NOT COALESCE(p.is_archived, false);
  BEGIN
    IF v_n > 0 AND in_current_fy(l.value_date) THEN
      SELECT id INTO v_cash FROM chart_of_accounts WHERE linked_account_id = l.account_id;
      IF v_cash IS NULL THEN
        PERFORM log_posting_failure('payroll_bank_line', p_line_id, 'No ledger cash account is linked to this bank account');
        RETURN;
      END IF;
      v_lines := jsonb_build_array(
        ledger_line(coa_id('wages_payable'), round(v_net, 2), 'Salaries: ' || v_n || CASE WHEN v_n = 1 THEN ' person' ELSE ' people' END),
        ledger_line(v_cash, -round(v_net, 2), 'Net pay sent'));
    END IF;
    PERFORM ledger_sync('payroll_bank_line', p_line_id, l.value_date, 'Salaries paid: ' || COALESCE(v_record, 'payroll'), v_lines);
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('payroll_bank_line', p_line_id, SQLERRM);
  END;
  FOR r IN SELECT DISTINCT ps.payroll_id FROM payroll_staff ps WHERE ps.bank_line_id = p_line_id LOOP
    PERFORM payroll_sync_ledger(r.payroll_id);
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.release_payroll_bank_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_runs uuid[]; v_r uuid;
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.matched_payroll_id IS NOT NULL AND NEW.matched_payroll_id IS DISTINCT FROM OLD.matched_payroll_id) THEN
    SELECT array_agg(DISTINCT payroll_id) INTO v_runs FROM payroll_staff WHERE bank_line_id = OLD.id;
    IF OLD.matched_payroll_id IS NOT NULL AND NOT (OLD.matched_payroll_id = ANY (COALESCE(v_runs, '{}'))) THEN
      v_runs := COALESCE(v_runs, '{}') || OLD.matched_payroll_id;
    END IF;
    UPDATE payroll_staff SET bank_line_id = NULL WHERE bank_line_id = OLD.id;
    IF TG_OP = 'DELETE' THEN
      PERFORM ledger_sync('payroll_bank_line', OLD.id, OLD.value_date, 'Salaries paid: bank line removed', '[]'::jsonb);
    ELSE
      PERFORM post_payroll_bank_line(OLD.id);
    END IF;
    FOREACH v_r IN ARRAY COALESCE(v_runs, '{}') LOOP
      PERFORM payroll_sync_ledger(v_r);
    END LOOP;
  END IF;
  RETURN NULL;
END $function$;

-- Before a run is written: its pay date when it is marked paid, and its tax
-- month, which follows its dates until it is paid and then stays put.
CREATE OR REPLACE FUNCTION public.payroll_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE v_becomes_paid boolean := NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid');
BEGIN
  IF v_becomes_paid AND NEW.paid_on IS NULL AND TG_OP = 'UPDATE' THEN
    SELECT max(b.value_date) INTO NEW.paid_on FROM payroll_staff ps JOIN bank_statement_lines b ON b.id = ps.bank_line_id
     WHERE ps.payroll_id = NEW.id;
  END IF;
  IF v_becomes_paid THEN NEW.paid_on := COALESCE(NEW.paid_on, CURRENT_DATE); END IF;
  IF NEW.start_date IS NULL THEN
    NEW.tax_ec_year := NULL; NEW.tax_ec_month := NULL;
  ELSIF NEW.payment_status IS DISTINCT FROM 'paid' OR v_becomes_paid THEN
    SELECT t.ec_year, t.ec_month INTO NEW.tax_ec_year, NEW.tax_ec_month FROM payroll_tax_month_for(NEW.start_date, NEW.end_date) t;
  END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE TRIGGER trg_payroll_before_write
  BEFORE INSERT OR UPDATE OF start_date, end_date, payment_status ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.payroll_before_write();

-- After a run is written: fix or release its tax, re-estimate the months it
-- touches, and bring the ledger in line.
CREATE OR REPLACE FUNCTION public.post_payroll_payment_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
      PERFORM payroll_freeze(NEW.id);
    ELSIF OLD.payment_status = 'paid' AND NEW.payment_status IS DISTINCT FROM 'paid' THEN
      PERFORM payroll_unfreeze(NEW.id);
    END IF;
    IF (NEW.tax_ec_year, NEW.tax_ec_month, NEW.payroll_type, NEW.is_archived)
       IS DISTINCT FROM (OLD.tax_ec_year, OLD.tax_ec_month, OLD.payroll_type, OLD.is_archived) THEN
      FOR r IN SELECT ps.staff_id FROM payroll_staff ps WHERE ps.payroll_id = NEW.id LOOP
        PERFORM payroll_retax(r.staff_id, OLD.tax_ec_year, OLD.tax_ec_month);
        IF (NEW.tax_ec_year, NEW.tax_ec_month) IS DISTINCT FROM (OLD.tax_ec_year, OLD.tax_ec_month) THEN
          PERFORM payroll_retax(r.staff_id, NEW.tax_ec_year, NEW.tax_ec_month);
        END IF;
      END LOOP;
    END IF;
  END IF;
  PERFORM payroll_sync_ledger(NEW.id);
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_post_payroll_payment_to_ledger
  AFTER INSERT OR UPDATE OF payment_status, account_id, paid_on, start_date, end_date, tax_ec_year, tax_ec_month, payroll_type, is_archived
  ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.post_payroll_payment_to_ledger();

-- ─── Who may call what ──────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.staff_salary_on(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_salary_set(uuid, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_tax_month_for(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_month_tax(numeric, numeric, date, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_open_advance(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_run_draft(text, date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_run_save(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_run_preview(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_salary_on(uuid, date), public.staff_salary_set(uuid, numeric, date, text),
                          public.payroll_tax_month_for(date, date), public.payroll_month_tax(numeric, numeric, date, boolean),
                          public.payroll_open_advance(uuid, uuid), public.payroll_run_draft(text, date, date, uuid),
                          public.payroll_run_save(jsonb, jsonb), public.payroll_run_preview(jsonb, jsonb)
  TO authenticated;
REVOKE ALL ON FUNCTION public.payroll_retax(uuid, int, int), public.payroll_retax_staff(uuid), public.payroll_freeze(uuid),
                       public.payroll_unfreeze(uuid), public.payroll_sync_ledger(uuid)
  FROM PUBLIC, anon, authenticated;

-- ─── Repair ─────────────────────────────────────────────────────────────────

-- Paid runs: fix their tax in the order they were paid. Then estimate
-- everything still unpaid, move the salary bank lines onto wages payable,
-- and post every paid run.
DO $repair$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM payroll WHERE payment_status = 'paid' AND NOT COALESCE(is_archived, false) AND tax_ec_year IS NOT NULL
            ORDER BY start_date, created_at LOOP
    PERFORM payroll_freeze(r.id);
  END LOOP;
  FOR r IN SELECT DISTINCT ps.staff_id FROM payroll_staff ps WHERE ps.frozen_at IS NULL LOOP
    PERFORM payroll_retax_staff(r.staff_id);
  END LOOP;
  FOR r IN SELECT DISTINCT ps.bank_line_id FROM payroll_staff ps WHERE ps.bank_line_id IS NOT NULL LOOP
    PERFORM post_payroll_bank_line(r.bank_line_id);
  END LOOP;
  FOR r IN SELECT id FROM payroll LOOP
    PERFORM payroll_sync_ledger(r.id);
  END LOOP;
  UPDATE ledger_posting_failures f SET resolved = true, resolved_at = now()
   WHERE f.source_table = 'payroll' AND NOT COALESCE(f.resolved, false)
     AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_table = 'payroll' AND je.source_id = f.source_id);
END $repair$;
