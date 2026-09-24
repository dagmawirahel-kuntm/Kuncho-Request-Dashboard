-- Aligning the tax pages with Tax Filings, part 4: Schedule A (PAYE) and
-- pension, computed from payroll.
--
-- ── What payroll holds ──────────────────────────────────────────────────
-- Kuncho agrees a NET take-home with each person, and that is the figure
-- typed into payroll_staff (confirmed by the user). Checked in production:
-- on all 132 lines gross_amount = net_amount and deductions = 0, so no line
-- has been grossed up and nothing in the books reflects PAYE or pension.
-- Stored payroll is NOT rewritten here -- this computes what the tax returns
-- need from the net, and leaves the payroll records as entered.
--
-- ── The inversion ───────────────────────────────────────────────────────
-- Within a band, PAYE = rate*G - K and employee pension = p*G, so
--     N = G - (rate*G - K) - p*G   =>   G = (N - K) / (1 - rate - p)
-- Walking the bands in ascending order, the first whose candidate G falls at
-- or below its max is the right one: net is increasing in gross, so a lower
-- band's candidate always overshoots that band's max.
--
-- This replaces src/lib/paye.ts, which computed (N + K) instead of (N - K)
-- -- e.g. net 7,650 grossed up to 12,500 instead of 10,000 -- and whose
-- "round-trip check" derived PAYE as the remainder, so it reconciled by
-- construction and could never catch that. paye.ts was never imported, so
-- no figure was affected; it is deleted in the same change so there is one
-- implementation. The check here is independent: PAYE is recomputed from
-- the band table on the resulting gross and the implied net must land
-- within 2 cents of the agreed net, or the function raises.
--
-- ── Pension ─────────────────────────────────────────────────────────────
-- Everyone on payroll is treated as covered EXCEPT staff.employment_type =
-- 'tier_2_casual'. 41 of the 56 people on payroll have no employment type
-- recorded; limiting pension to 'Full Time' would have dropped most of the
-- workforce, and monthly-payroll staff are employees. There is no
-- nationality field, so the foreign-national exemption in the pension rate
-- reference cannot be applied -- everyone is assumed Ethiopian.
-- The insurable-earnings ceiling in the rate reference is honoured if the
-- tax officer ever sets it (it is NULL today).
--
-- ── Timing ──────────────────────────────────────────────────────────────
-- Payroll runs already follow Ethiopian months (8 Jun - 7 Jul 2026 is Sene
-- 2018), so a run's period is the EC month of its start_date. Everything a
-- person is paid in that month -- regular and bonus runs together -- is one
-- month's employment income, so the gross-up is done on the combined net.
-- Only PAID runs count toward a return; unpaid runs are shown alongside as
-- a projection.
--
-- Additive only (see 309).

SET search_path TO public;

CREATE OR REPLACE FUNCTION paye_gross_up(p_net numeric, p_on date, p_pension_covered boolean)
RETURNS TABLE (gross numeric, paye numeric, pension_employee numeric, pension_employer numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_bands   jsonb := tax_rate_note('SCH_A', p_on) -> 'bands';
  v_sch_a   jsonb := tax_rate_note('SCH_A', p_on);
  v_pen     jsonb := tax_rate_note('PENSION', p_on);
  v_p       numeric := 0;   -- employee pension rate
  v_pe      numeric := 0;   -- employer pension rate
  v_cap     numeric;        -- insurable earnings ceiling, NULL = none
  v_band    jsonb;
  v_rate    numeric;
  v_k       numeric;
  v_max     numeric;
  v_cand    numeric;
  v_g       numeric;
  v_paye_ind numeric;
  v_pens    numeric;
  v_net_fwd numeric;
BEGIN
  IF p_net IS NULL OR p_net <= 0 THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- A missing rate reference returns no row, so the caller shows a missing
  -- figure rather than a zero tax.
  IF v_bands IS NULL OR (p_pension_covered AND v_pen IS NULL) THEN
    RETURN;
  END IF;

  IF COALESCE((v_sch_a ->> 'pension_pre_tax')::boolean, false) THEN
    RAISE EXCEPTION 'Schedule A reference in force on % deducts pension before tax; paye_gross_up does not model that yet', p_on;
  END IF;

  IF p_pension_covered THEN
    v_p   := (v_pen ->> 'employee_rate')::numeric;
    v_pe  := (v_pen ->> 'employer_rate')::numeric;
    v_cap := (v_pen ->> 'insurable_earnings_ceiling_etb')::numeric;
  END IF;

  FOR v_band IN
    SELECT value FROM jsonb_array_elements(v_bands) ORDER BY (value ->> 'min')::numeric
  LOOP
    v_rate := (v_band ->> 'rate')::numeric;
    v_k    := (v_band ->> 'deduct')::numeric;
    v_max  := (v_band ->> 'max')::numeric;

    -- Uncapped pension: N = G(1 - rate - p) + K
    v_cand := (p_net - v_k) / (1 - v_rate - v_p);
    IF v_cap IS NOT NULL AND v_cand > v_cap THEN
      -- Pension capped at p*cap: N = G(1 - rate) + K - p*cap
      v_cand := (p_net - v_k + v_p * v_cap) / (1 - v_rate);
    END IF;

    IF v_max IS NULL OR v_cand <= v_max THEN
      v_g := v_cand;
      EXIT;
    END IF;
  END LOOP;

  IF v_g IS NULL THEN
    RAISE EXCEPTION 'paye_gross_up: no Schedule A band fits net % on %', p_net, p_on;
  END IF;

  v_g    := round(v_g, 2);
  v_pens := round(v_p * CASE WHEN v_cap IS NULL THEN v_g ELSE LEAST(v_g, v_cap) END, 2);

  -- Independent forward check: PAYE from the band table on the resulting
  -- gross, not derived from the net.
  SELECT GREATEST(0, round((b ->> 'rate')::numeric * v_g - (b ->> 'deduct')::numeric, 2))
    INTO v_paye_ind
  FROM jsonb_array_elements(v_bands) b
  WHERE (b ->> 'max') IS NULL OR v_g <= (b ->> 'max')::numeric
  ORDER BY (b ->> 'min')::numeric
  LIMIT 1;

  v_net_fwd := v_g - v_paye_ind - v_pens;
  IF abs(v_net_fwd - p_net) > 0.02 THEN
    RAISE EXCEPTION 'paye_gross_up failed to reconcile: agreed net %, gross %, PAYE %, pension % gives net %',
      p_net, v_g, v_paye_ind, v_pens, v_net_fwd;
  END IF;

  -- The check bounds the rounding residual to 2 cents; it is carried in PAYE
  -- so gross - PAYE - pension equals the agreed net exactly.
  RETURN QUERY SELECT v_g,
                      round(v_g - v_pens - p_net, 2),
                      v_pens,
                      round(v_pe * CASE WHEN v_cap IS NULL THEN v_g ELSE LEAST(v_g, v_cap) END, 2);
END;
$$;
REVOKE EXECUTE ON FUNCTION paye_gross_up(numeric, date, boolean) FROM PUBLIC, anon;

COMMENT ON FUNCTION paye_gross_up(numeric, date, boolean) IS
  'Agreed net -> gross, PAYE, employee and employer pension, from the Schedule A and pension rate references in force on the date. Raises if the independent forward check does not reproduce the net within 2 cents.';

-- One row per person per Ethiopian month.
CREATE OR REPLACE VIEW v_payroll_tax_by_staff_period
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT ps.staff_id, ec.ec_year, ec.ec_month,
         ps.net_amount,
         (p.payment_status = 'paid') AS is_paid
  FROM payroll_staff ps
  JOIN payroll p ON p.id = ps.payroll_id
  CROSS JOIN LATERAL gregorian_to_ec(p.start_date) ec
  WHERE p.start_date IS NOT NULL
    AND NOT COALESCE(p.is_archived, false)
),
per_staff AS (
  SELECT staff_id, ec_year, ec_month,
         COALESCE(sum(net_amount) FILTER (WHERE is_paid), 0) AS net_paid,
         COALESCE(sum(net_amount), 0)                        AS net_all
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
       allp.paye             AS paye_incl_unpaid
FROM per_staff ps
JOIN staff st ON st.id = ps.staff_id
LEFT JOIN LATERAL paye_gross_up(ps.net_paid, ec_month_start_greg(ps.ec_year, ps.ec_month),
                                COALESCE(st.employment_type, '') <> 'tier_2_casual') paid ON true
LEFT JOIN LATERAL paye_gross_up(ps.net_all,  ec_month_start_greg(ps.ec_year, ps.ec_month),
                                COALESCE(st.employment_type, '') <> 'tier_2_casual') allp ON true;

-- Totals per Ethiopian month: what the Schedule A and pension returns need.
CREATE OR REPLACE VIEW v_payroll_tax_by_ec_period
WITH (security_invoker = true) AS
SELECT ec_year, ec_month, period_label,
       count(*) FILTER (WHERE net_paid > 0)     AS paid_staff_count,
       sum(net_paid)                            AS net_paid,
       sum(gross_paid)                          AS gross_paid,
       sum(paye_paid)                           AS paye_paid,
       sum(pension_employee_paid)               AS pension_employee_paid,
       sum(pension_employer_paid)               AS pension_employer_paid,
       sum(net_all) - sum(net_paid)             AS net_unpaid,
       sum(paye_incl_unpaid)                    AS paye_incl_unpaid
FROM v_payroll_tax_by_staff_period
GROUP BY ec_year, ec_month, period_label;

GRANT SELECT ON v_payroll_tax_by_staff_period, v_payroll_tax_by_ec_period TO authenticated;
