-- PR 9d group (a) revision: WHT is a contract-level deduction, apportioned
-- across milestones, computed on the VAT-exclusive value.
--
-- Supersedes the per-milestone / final_only-on-the-last-milestone math in
-- migration 232, per the user's correction: "Withholding tax is deducted not
-- based on the milestone, it's a value deducted from the entirety of the
-- contract value."
--
-- Why this also fixes the negative-net problem found in 232's verification:
-- apportioning the contract-wide WHT proportionally is arithmetically
-- identical to charging each milestone WHT on its own share --
--     milestone_i share = (CV * rate) * (p_i/100) = (CV * p_i/100) * rate
-- -- so no milestone can ever carry more WHT than its own value generates.
-- 232's final_only branch dumped the entire contract's WHT on the last
-- milestone, which drove net_payable_etb negative whenever that milestone
-- was smaller than the contract-wide WHT (verified: a 1% final milestone on
-- a 1,000,000 contract came out at -20,500).
--
-- Consequence worth knowing: wht_deduction_mode no longer changes milestone
-- AMOUNTS at all -- both 'per_payment' and 'final_only' now apportion
-- identically. The mode still matters for the sales-side WHT-receipt
-- workflow (one receipt at the end vs. one per payment); it is simply no
-- longer an input to this calculation.
--
-- VAT: confirmed with the user that contract_value has no inherent VAT
-- convention -- every other VAT site in this codebase adds VAT on top of a
-- base ("VAT (15%, added)"; proformas store subtotal/vat_amount/total
-- separately), but contracts.contract_value is a bare number field, so
-- nothing recorded whether a given value was entered gross or net. Rather
-- than assume, each contract now declares it via
-- contract_value_includes_vat.
--
-- Derivation (auditable, per the prompt's requirement):
--   base_cv    = includes_vat ? contract_value / 1.15 : contract_value
--   wht_applies= base_cv >= 20,000        -- threshold tested at CONTRACT level,
--                                            so small milestones still carry
--                                            their share of a qualifying contract
--   gross_amount_etb   = contract_value * pct / 100   -- what is invoiced (as entered)
--   gross_excl_vat_etb = base_cv        * pct / 100   -- the VAT-exclusive share
--   retention_withheld_etb = gross_excl_vat_etb * retention_percent / 100
--   wht_withheld_etb       = wht_applies ? gross_excl_vat_etb * wht_rate / 100 : 0
--   net_payable_etb        = gross_amount_etb - retention_withheld_etb - wht_withheld_etb
--
-- NOTE ON RETENTION BASIS: retention is computed on the VAT-exclusive figure,
-- matching WHT, on the reasoning that VAT is a pass-through and retention is
-- held against work value. The user specified the VAT basis for WHT only, so
-- this is the consistent extension rather than a separately confirmed rule --
-- flagged here because it is a money calculation someone may need to correct.

SET search_path TO public;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_value_includes_vat boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contracts.contract_value_includes_vat IS
  'true when contract_value as entered already includes 15% VAT. WHT and retention on payment milestones are computed on the VAT-exclusive figure (contract_value / 1.15 when this is true).';

ALTER TABLE payment_milestones
  ADD COLUMN IF NOT EXISTS gross_excl_vat_etb numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN payment_milestones.gross_excl_vat_etb IS
  'This milestone''s VAT-exclusive share of the contract -- the base for both retention and WHT. Stored rather than derived so the deduction is auditable.';

CREATE OR REPLACE FUNCTION recompute_all_contract_milestone_amounts(p_contract_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_contract_value numeric;
  v_incl_vat       boolean;
  v_base_cv        numeric;
  v_wht_rate_pct   numeric;
  v_retention_pct  numeric;
  v_wht_applies    boolean;
BEGIN
  SELECT contract_value, contract_value_includes_vat, COALESCE(wht_rate, 3), COALESCE(retention_percent, 0)
    INTO v_contract_value, v_incl_vat, v_wht_rate_pct, v_retention_pct
  FROM contracts WHERE id = p_contract_id;

  IF v_contract_value IS NULL THEN
    UPDATE payment_milestones
    SET gross_amount_etb = 0, gross_excl_vat_etb = 0, retention_withheld_etb = 0,
        wht_withheld_etb = 0, net_payable_etb = 0
    WHERE contract_id = p_contract_id;
    RETURN;
  END IF;

  v_base_cv     := CASE WHEN v_incl_vat THEN v_contract_value / 1.15 ELSE v_contract_value END;
  v_wht_applies := v_base_cv >= 20000;

  WITH calc AS (
    SELECT
      pm.id,
      round(v_contract_value * pm.percent_of_contract_value / 100, 2) AS gross,
      round(v_base_cv        * pm.percent_of_contract_value / 100, 2) AS gross_ex,
      round(v_base_cv * pm.percent_of_contract_value / 100 * v_retention_pct / 100, 2) AS retention,
      CASE WHEN v_wht_applies
        THEN round(v_base_cv * pm.percent_of_contract_value / 100 * v_wht_rate_pct / 100, 2)
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

-- Amounts no longer depend on sequence_number (no finality rule) or on other
-- rows existing, so the milestone-side trigger narrows to the two events that
-- actually change a row's amounts.
DROP TRIGGER IF EXISTS trg_payment_milestones_recompute ON payment_milestones;
CREATE TRIGGER trg_payment_milestones_recompute
  AFTER INSERT OR UPDATE OF percent_of_contract_value
  ON payment_milestones
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_milestones_from_milestone_change();

-- The contract-side trigger gains the new VAT flag.
DROP TRIGGER IF EXISTS trg_contracts_recompute_milestones ON contracts;
CREATE TRIGGER trg_contracts_recompute_milestones
  AFTER UPDATE OF contract_value, wht_rate, retention_percent, wht_deduction_mode, contract_value_includes_vat
  ON contracts
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_milestones_from_contract_change();
