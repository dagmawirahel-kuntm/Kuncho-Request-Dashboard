-- 385 — Paying the tax authority clears what is owed to it
--
-- VAT collected on sales (2040), tax withheld from vendors (2025) and
-- payroll tax and pension withheld from salaries (2020) are money held for
-- the government. Paying them was recorded as an ordinary expense under
-- "Government Expense", so the payables never went down and the payment
-- showed as a cost. A tax filing now says how it was paid — from a bank
-- account, or by an expense already entered — and posts:
--
--   VAT, WHT, Sch-A, Pension   Dr the tax payable
--   Sch-C (profit tax)         Dr 6310 Business profit tax
--                              Cr the bank — or, when an expense paid it,
--                                 the account that expense was costed to
--                                 (the bank side is already in the books)
--
-- and a VAT return, once filed, sets the period's claimable input VAT
-- (1410) against the VAT payable, which is what the return does.
--
-- One expense may pay several filings (payroll tax and pension together):
-- each filing takes its own amount out of it.

SET search_path TO public;

ALTER TABLE tax_filings
  ADD COLUMN IF NOT EXISTS paid_from_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_by_expense_id   uuid REFERENCES expenses(id) ON DELETE SET NULL;
COMMENT ON COLUMN tax_filings.paid_from_account_id IS 'The bank account the payment left (385).';
COMMENT ON COLUMN tax_filings.paid_by_expense_id IS 'Or: the expense that recorded the payment (385) — its cost moves to the tax payable.';

INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, system_key)
SELECT '6310', 'Business profit tax', 'Expense', (SELECT id FROM chart_of_accounts WHERE account_code = '6300'), true, true, 'operating', 'profit_tax'
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE system_key = 'profit_tax' OR account_code = '6310');

CREATE OR REPLACE FUNCTION public.sync_tax_filing_ledger(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  f        tax_filings%ROWTYPE;
  v_target uuid;
  v_from   uuid;
  v_input  numeric;
  v_lines  jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO f FROM tax_filings WHERE id = p_id;
  v_target := CASE f.schedule_code
    WHEN 'VAT' THEN coa_id('vat_payable') WHEN 'WHT' THEN coa_id('wht_payable')
    WHEN 'SCH_A' THEN coa_id('payroll_taxes') WHEN 'PENSION' THEN coa_id('payroll_taxes')
    WHEN 'SCH_C' THEN coa_id('profit_tax') END;

  IF f.id IS NOT NULL AND v_target IS NOT NULL AND COALESCE(f.paid_amount, 0) > 0 AND in_current_fy(f.payment_date) THEN
    IF f.paid_by_expense_id IS NOT NULL THEN
      -- The account the expense's cost sits in.
      SELECT l.account_id INTO v_from
        FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id
        JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
       WHERE je.source_table IN ('expense_accrual', 'expenses') AND je.source_id = f.paid_by_expense_id AND l.debit > 0
       ORDER BY je.created_at LIMIT 1;
      IF v_from IS NULL THEN
        PERFORM log_posting_failure('tax_filings', p_id, 'The expense that paid this filing is not in the ledger yet — approve or pay it first');
      END IF;
    ELSIF f.paid_from_account_id IS NOT NULL THEN
      SELECT id INTO v_from FROM chart_of_accounts WHERE linked_account_id = f.paid_from_account_id;
    ELSE
      PERFORM log_posting_failure('tax_filings', p_id, format('%s %s: say where the payment came from — a bank account or the expense that paid it', f.schedule_code, f.period_label));
    END IF;
    IF v_from IS NOT NULL THEN
      v_lines := v_lines || jsonb_build_array(
        ledger_line(v_target, f.paid_amount, format('Paid to the authority: %s %s', f.schedule_code, f.period_label)),
        ledger_line(v_from, -f.paid_amount, CASE WHEN f.paid_by_expense_id IS NOT NULL THEN 'Tax paid, not a cost' ELSE 'Paid' END));
    END IF;
  END IF;

  -- A filed VAT return sets the period's claimable input VAT against what is owed.
  IF f.id IS NOT NULL AND f.schedule_code = 'VAT' AND f.status <> 'draft' AND in_current_fy(f.period_end_greg) THEN
    SELECT COALESCE(sum(t.vat_amount), 0) INTO v_input FROM v_input_vat_tracker t
     WHERE t.claimable AND t.declare_ec_year = f.period_ec_year AND t.declare_ec_month = f.period_ec_month;
    IF v_input > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        ledger_line(coa_id('vat_payable'), v_input, 'Input VAT claimed on the ' || f.period_label || ' return'),
        ledger_line(coa_id('input_vat'), -v_input, 'Claimed on the ' || f.period_label || ' return'));
    END IF;
  END IF;

  PERFORM ledger_sync('tax_filings', p_id, COALESCE(f.payment_date, f.period_end_greg, CURRENT_DATE),
                      'Tax: ' || COALESCE(f.schedule_code, '') || ' ' || COALESCE(f.period_label, ''), v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('tax_filings', p_id, SQLERRM);
END $function$;
REVOKE EXECUTE ON FUNCTION sync_tax_filing_ledger(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_ledger_tax_filing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM sync_tax_filing_ledger(CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS trg_ledger_tax_filing ON tax_filings;
CREATE TRIGGER trg_ledger_tax_filing AFTER INSERT OR UPDATE OR DELETE ON tax_filings
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_tax_filing();

-- The re-run covers filings too.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('ledger_resync'::regproc);
  d := replace(d, 'FOR r IN SELECT id FROM fixed_assets LOOP PERFORM sync_fixed_asset_ledger(r.id); END LOOP;',
    'FOR r IN SELECT id FROM fixed_assets LOOP PERFORM sync_fixed_asset_ledger(r.id); END LOOP;
  FOR r IN SELECT id FROM tax_filings LOOP PERFORM sync_tax_filing_ledger(r.id); END LOOP;');
  IF d NOT LIKE '%sync_tax_filing_ledger%' THEN RAISE EXCEPTION 'ledger_resync did not take the change'; END IF;
  EXECUTE d;
END $$;

-- Journal lines from a filing name no party; the context lookup knows nothing
-- of tax_filings, which is right: the tax payables are not control accounts.
