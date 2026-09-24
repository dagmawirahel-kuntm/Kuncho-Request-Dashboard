-- Aligning the tax pages with Tax Filings, part 2: one WHT rule for what
-- clients withhold from Kuncho.
--
-- ── The disagreement ────────────────────────────────────────────────────
-- Two implementations answered "does WHT apply, and on what?":
--
--   recompute_all_contract_milestone_amounts (233)   ClientDetailPage.saleWht
--   base = contract value EXCLUDING VAT               base = contract value as entered
--   applies when base >= 20,000                       final_only: base > 20,000
--                                                     per_payment: SALE amount >= 20,000
--   20000 and 1.15 hardcoded                          20_000 and 0.03 hardcoded
--
-- So a VAT-inclusive contract of 22,000 (19,130 before VAT) showed WHT on the
-- client page and none on its milestones; a contract of exactly 20,000 did
-- the reverse in final_only mode; and in per_payment mode the client page
-- tested each sale on its own, not the contract -- against the decision that
-- WHT is tested at contract level on the pre-VAT amount, >= 20,000.
--
-- ── The rule, once ──────────────────────────────────────────────────────
-- contract_wht_basis() below is the only place it is written. The milestone
-- recompute and v_sale_wht (which the client page now reads) both call it.
--
--   base    contract value, with VAT removed when contract_value_includes_vat,
--           using the VAT rate in force on the signing date
--   applies base >= the client-contract threshold in the WHT rate reference
--   rate    the contract's own wht_rate (a percentage) if set, else the
--           WHT rate reference's rate
--
-- ── Threshold ───────────────────────────────────────────────────────────
-- The WHT rate reference seeded in 301 carries goods_threshold_etb 20,000
-- and services_threshold_etb 10,000. Kuncho decided 20,000 applies to its
-- client contracts. That decision is recorded as its own key rather than by
-- borrowing goods_threshold_etb, so it is visible as a choice and the tax
-- officer can change it in one place -- if Kuncho's contracts are services
-- for WHT purposes, the statutory figure may be 10,000.

SET search_path TO public;

UPDATE tax_rate_references r
SET rate_note = r.rate_note || jsonb_build_object(
      'client_contract_threshold_etb', 20000,
      'client_contract_threshold_note',
      'Kuncho decision: WHT on client contracts tested at contract level on the pre-VAT value, >= this figure. Confirm against services_threshold_etb.')
FROM tax_schedules s
WHERE s.id = r.tax_schedule_id AND s.code = 'WHT' AND r.effective_to IS NULL;

CREATE OR REPLACE FUNCTION contract_wht_basis(p_contract_id uuid)
RETURNS TABLE (base_ex_vat numeric, wht_applies boolean, rate_fraction numeric, threshold numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT b.base,
         b.base >= b.thr,
         b.rate,
         b.thr
  FROM (
    SELECT CASE WHEN c.contract_value_includes_vat
                THEN c.contract_value / (1 + (tax_rate_note('VAT', x.d) ->> 'standard_rate')::numeric)
                ELSE c.contract_value END                                     AS base,
           (tax_rate_note('WHT', x.d) ->> 'client_contract_threshold_etb')::numeric AS thr,
           COALESCE(c.wht_rate / 100, (tax_rate_note('WHT', x.d) ->> 'rate')::numeric) AS rate
    FROM contracts c
    CROSS JOIN LATERAL (SELECT COALESCE(c.signed_date, CURRENT_DATE) AS d) x
    WHERE c.id = p_contract_id
  ) b;
$$;
REVOKE EXECUTE ON FUNCTION contract_wht_basis(uuid) FROM PUBLIC, anon;

COMMENT ON FUNCTION contract_wht_basis(uuid) IS
  'The single WHT rule for client contracts: pre-VAT base, contract-level >= threshold test, contract rate or statutory rate. Used by payment milestones and v_sale_wht.';

-- Same function as 233 with the two literals replaced by contract_wht_basis().
-- Output is unchanged while the rate references say 15% VAT and 20,000
-- (there are no milestones yet, so no stored figure moves). A missing rate
-- reference now raises instead of silently computing zero WHT.
CREATE OR REPLACE FUNCTION recompute_all_contract_milestone_amounts(p_contract_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_contract_value numeric;
  v_base_cv        numeric;
  v_wht_rate       numeric;
  v_retention_pct  numeric;
  v_wht_applies    boolean;
BEGIN
  SELECT contract_value, COALESCE(retention_percent, 0)
    INTO v_contract_value, v_retention_pct
  FROM contracts WHERE id = p_contract_id;

  IF v_contract_value IS NULL THEN
    UPDATE payment_milestones
    SET gross_amount_etb = 0, gross_excl_vat_etb = 0, retention_withheld_etb = 0,
        wht_withheld_etb = 0, net_payable_etb = 0
    WHERE contract_id = p_contract_id;
    RETURN;
  END IF;

  SELECT base_ex_vat, wht_applies, rate_fraction
    INTO v_base_cv, v_wht_applies, v_wht_rate
  FROM contract_wht_basis(p_contract_id);

  IF v_base_cv IS NULL OR v_wht_applies IS NULL OR v_wht_rate IS NULL THEN
    RAISE EXCEPTION 'No VAT/WHT rate reference is in force for contract %''s signing date; add one under Tax Filings rate references before computing milestones', p_contract_id;
  END IF;

  WITH calc AS (
    SELECT
      pm.id,
      round(v_contract_value * pm.percent_of_contract_value / 100, 2) AS gross,
      round(v_base_cv        * pm.percent_of_contract_value / 100, 2) AS gross_ex,
      round(v_base_cv * pm.percent_of_contract_value / 100 * v_retention_pct / 100, 2) AS retention,
      CASE WHEN v_wht_applies
        THEN round(v_base_cv * pm.percent_of_contract_value / 100 * v_wht_rate, 2)
        ELSE 0
      END AS wht
    FROM payment_milestones pm
    WHERE pm.contract_id = p_contract_id
  )
  UPDATE payment_milestones pm
  SET gross_amount_etb       = calc.gross,
      gross_excl_vat_etb     = calc.gross_ex,
      retention_withheld_etb = calc.retention,
      wht_withheld_etb       = calc.wht,
      net_payable_etb        = calc.gross - calc.retention - calc.wht
  FROM calc
  WHERE pm.id = calc.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION recompute_all_contract_milestone_amounts(uuid) FROM PUBLIC, anon;

-- ── v_sale_wht: what the client page reads instead of computing ─────────
-- One row per sale. Which sales expect a WHT certificate depends on the
-- contract's deduction mode (it decides WHEN the client deducts, not how
-- much): final_only -> the final payment carries the whole contract's WHT;
-- per_payment -> every payment carries WHT on its own pre-VAT amount, as
-- long as the CONTRACT qualifies. A sale with no contract is tested on its
-- own pre-VAT amount against the same threshold.
CREATE OR REPLACE VIEW v_sale_wht
WITH (security_invoker = true) AS
SELECT s.id                          AS sale_id,
       s.client_id,
       s.contract_id,
       c.wht_deduction_mode,
       q.qualifies,
       q.wht_base,
       q.rate_fraction,
       round(q.wht_base * q.rate_fraction, 2) AS expected_wht,
       (q.rate_fraction IS NULL OR q.threshold IS NULL) AS rate_missing
FROM sales s
LEFT JOIN contracts c ON c.id = s.contract_id
LEFT JOIN LATERAL contract_wht_basis(s.contract_id) b ON s.contract_id IS NOT NULL
CROSS JOIN LATERAL (
  SELECT CASE WHEN s.is_vat_exempt THEN s.amount
              ELSE s.amount / (1 + (tax_rate_note('VAT', s.date) ->> 'standard_rate')::numeric) END AS ex_vat,
         (tax_rate_note('WHT', s.date) ->> 'client_contract_threshold_etb')::numeric            AS thr,
         (tax_rate_note('WHT', s.date) ->> 'rate')::numeric                                       AS rate
) sx
CROSS JOIN LATERAL (
  SELECT
    COALESCE(CASE
      WHEN s.contract_id IS NULL             THEN sx.ex_vat >= sx.thr
      WHEN c.wht_deduction_mode = 'final_only' THEN b.wht_applies AND COALESCE(s.is_final_payment, false)
      ELSE b.wht_applies
    END, false)                                                   AS qualifies,
    CASE WHEN c.wht_deduction_mode = 'final_only' THEN b.base_ex_vat ELSE sx.ex_vat END AS wht_base,
    CASE WHEN s.contract_id IS NULL THEN sx.rate ELSE b.rate_fraction END             AS rate_fraction,
    CASE WHEN s.contract_id IS NULL THEN sx.thr  ELSE b.threshold END                 AS threshold
) q;

GRANT SELECT ON v_sale_wht TO authenticated;
