-- 331 — Withholding on YILKAL ACHAMYELEH's four subcontract certificates
--
-- BATCH-20260925-01 carried four subcontract certificates to one payee,
-- 139,613.80 ETB, with no withholding recorded — verify_wht false and no
-- amount, so the whole gross was queued to go to him.
--
-- Recorded at 3% of the VAT-exclusive amount, the rate every other WHT
-- figure on file uses, on the instruction of the company:
--
--   ETHI-SUBC-20260925-01   26,400.00   WHT   688.70   send  25,711.30
--   MESO-SUBC-20260925-01   57,737.80   WHT 1,506.20   send  56,231.60
--   MESO-SUBC-20260925-02   11,316.00   WHT   295.20   send  11,020.80
--   MESO-SUBC-20260925-03   44,160.00   WHT 1,152.00   send  43,008.00
--                          139,613.80       3,642.10        135,971.70
--
-- Worth knowing: the vendor has no TIN on file. A payee who gives no TIN is
-- generally withheld at a higher rate; the company chose 3% here. If his TIN
-- turns out to be missing rather than unrecorded, this is the figure to
-- revisit — it can be changed until the batch is sent.
--
-- Applied through set_expense_withholding() (330), the same path the
-- To-Pay queue and batch page use, acting as an admin. Recorded here for
-- history; replaying it needs an admin or finance identity.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, amount_etb FROM expenses
           WHERE expense_code IN ('ETHI-SUBC-20260925-01','MESO-SUBC-20260925-01',
                                  'MESO-SUBC-20260925-02','MESO-SUBC-20260925-03')
             AND payment_state IN ('unpaid', 'approved_to_pay')
  LOOP
    PERFORM set_expense_withholding(r.id, true, round(r.amount_etb / 1.15 * 0.03, 2));
  END LOOP;
END $$;
