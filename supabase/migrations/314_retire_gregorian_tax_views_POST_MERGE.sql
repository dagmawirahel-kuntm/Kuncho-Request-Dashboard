-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  APPLY ONLY AFTER the frontend from this change is merged and live.  ║
-- ║  The currently deployed pages still read every object dropped here.  ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Aligning the tax pages with Tax Filings, part 6: removing what 309-313
-- replaced.
--
-- 308 dropped two views while the live frontend still read them, which left
-- the Tax Summary page and Tax Management's banner broken in production until
-- #117 merged. 309-313 were kept strictly additive so that could not recur;
-- everything destructive waits here instead.
--
-- Dropped (no data -- views only; definitions stay in 153/156/157/170):
--   v_tax_liability_summary          -> tax_filing_computed() (313)
--   v_tax_position                   -> v_vat_position_by_ec_period (309)
--   v_monthly_output_vat             -> v_vat_output_by_ec_period (309)
--   v_monthly_vat_from_receipts      -> v_vat_input_by_ec_period (309)
--   v_government_expense_statement   -> v_government_expense_statement_by_ec_period (313)
--
-- Made read-only (NOT dropped):
--   payroll_taxes  0 rows. Replaced by v_payroll_tax_by_* (312), which
--                  computes from payroll instead of relying on manual entry.
--   tax_summary    0 rows. Its "Tax Month" picker on sales and expenses is
--                  removed from the UI; the period now follows from the date.
--                  The table and the sales/expenses.tax_summary_id columns
--                  stay because enforce_expense_finance_fields() reads
--                  expenses.tax_summary_id on every expense update -- dropping
--                  the column would break expense edits.

SET search_path TO public;

DROP VIEW IF EXISTS v_tax_liability_summary;
DROP VIEW IF EXISTS v_tax_position;
DROP VIEW IF EXISTS v_monthly_output_vat;
DROP VIEW IF EXISTS v_monthly_vat_from_receipts;
DROP VIEW IF EXISTS v_government_expense_statement;

-- Revoking the grants is what makes them read-only: RLS policies are
-- checked only after the grant, so a FOR ALL policy left in place can no
-- longer authorise a write. The policies themselves stay, because some of
-- them are also the read path.
REVOKE INSERT, UPDATE, DELETE ON payroll_taxes, tax_summary FROM authenticated, anon;

COMMENT ON TABLE payroll_taxes IS
  'ARCHIVE, read-only since migration 314 (was empty). PAYE and pension are computed from payroll by v_payroll_tax_by_staff_period / v_payroll_tax_by_ec_period.';
COMMENT ON TABLE tax_summary IS
  'ARCHIVE, read-only since migration 314 (was empty). Tax periods follow from each record''s date via gregorian_to_ec(); see tax_filings.';
