-- 282 — remove the duplicate Hanbon expense for PO-2026-0058
--
-- PO-2026-0058 (Hanbon Construction Materials PLC — T frame, L frame, Top T
-- frame, C final, White silicon, INTERIOR DESIGN WORK FOR AIH) was booked
-- twice on 21 Aug 2026, 69 seconds apart, at 301,499.96 each. The sourcing
-- bundle is worth 301,499.96 once, so 301,499.96 was recorded twice against
-- a single order.
--
-- Which one is real is not a judgement call — the evidence is one-sided:
--
--                              INTE-MULT-20260821-01   INTE-MULT-20260821-02
--   bank_ref                   (none)                  FT26233HBDS9
--   payment_method             cash                    transfer
--   purchase_type              (none)                  Goods
--   receipt_available          (none)                  Yes
--   sourcing_bundles.expense_id  no                    YES  (PO-2026-0058)
--   finance approved           27 Aug 22:07            21 Aug 06:18
--
-- -02 is the transfer the bank actually made and the expense PO-2026-0058
-- itself points back to. -01 has no bank reference, no receipt, and nothing
-- points at it. It is deleted here; -02 is left untouched.
--
-- The general ledger is the reason this cannot be a soft archive. -01 was
-- walked through approval and payment on 6 Sep 2026, and its two entries
-- posted that afternoon (17:26 and 17:28 UTC):
--
--   9a5434d8  Vendor advance recorded: INTE-MULT-20260821-01     301,499.96
--   90957656  Vendor advance closed (GRN received): …-01          301,499.96
--
-- Nothing reverses those on archive, so the entries and their four lines go
-- with the expense. -02's own two entries (89cbc472, edb90dbf) stay.
--
-- Full snapshot of the deleted row, for the record:
--   id                cbcc6aa4-9494-451e-ad6e-c21ead912eff
--   expense_code      INTE-MULT-20260821-01
--   amount_etb        301499.96      net_payable  301499.96
--   date              2026-08-21     expense_type purchase_order
--   vendor_id         b78deb0f-a063-45d4-b519-13666e2748af (Hanbon)
--   project_id        7b94b0f1-c596-4c73-9692-e08f287710b8 (INTERIOR DESIGN
--                                                          WORK FOR AIH)
--   category_id       e7b7cca6-c2c4-4864-9ac1-4bb83a5650de
--   account_id        890c3473-dc57-4c01-9f39-17518047c463 (CBE)
--   sourcing_bundle_id 39f002db-3209-4d3d-aaee-0a42d9429903 (PO-2026-0058)
--   fiscal_period_id  b6b2ae8b-35f6-4394-bb68-394b19db7cf1
--   purchaser_user_id df456dc7-e8da-481a-a038-b277093527c2
--   disbursed_by      71147969-86d5-48f0-a976-71a2a5456643
--   approval_status   finance_approved (by df456dc7, 27 Aug 2026 22:07:59Z)
--   payment_state     paid / payment_method cash / bank_ref NULL
--   created_at        2026-08-21T06:14:33.461975Z
--   description       PO PO-2026-0058 — T frame, L frame, Top T frame,
--                     C final, White silicon
--
-- Checked before applying: this row has NO batch payment line, payment
-- request, order item, stock or vendor receipt, cash receipt, bank statement
-- match, fixed asset, CPO bond, vendor credit, purchase allocation or split
-- child. sourcing_bundles.expense_id names -02, not this row. The only
-- things referencing it are the two ledger entries removed with it.

DO $$
DECLARE
  v_dup    uuid := 'cbcc6aa4-9494-451e-ad6e-c21ead912eff';
  v_keep   uuid := '0f09d8e1-9921-4b00-8aed-907d4cfed72b';
  v_lines  int;
  v_je     int;
  v_exp    int;
BEGIN
  -- Refuse to run if the survivor is not there, or if anything has attached
  -- itself to the duplicate since this was written.
  IF NOT EXISTS (SELECT 1 FROM expenses WHERE id = v_keep AND bank_ref = 'FT26233HBDS9') THEN
    RAISE EXCEPTION 'Keeper INTE-MULT-20260821-02 missing or changed — aborting';
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = v_dup)
     OR EXISTS (SELECT 1 FROM payment_requests    WHERE expense_id = v_dup)
     OR EXISTS (SELECT 1 FROM stock_receipts      WHERE expense_id = v_dup)
     OR EXISTS (SELECT 1 FROM vendor_receipts     WHERE expense_id = v_dup)
     OR EXISTS (SELECT 1 FROM bank_statement_lines WHERE matched_expense_id = v_dup)
     OR EXISTS (SELECT 1 FROM sourcing_bundles    WHERE expense_id = v_dup) THEN
    RAISE EXCEPTION 'Duplicate INTE-MULT-20260821-01 has acquired dependents — aborting';
  END IF;

  DELETE FROM journal_lines
   WHERE journal_entry_id IN (
     SELECT id FROM journal_entries WHERE source_table = 'expenses' AND source_id = v_dup);
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  DELETE FROM journal_entries WHERE source_table = 'expenses' AND source_id = v_dup;
  GET DIAGNOSTICS v_je = ROW_COUNT;

  DELETE FROM expenses WHERE id = v_dup;
  GET DIAGNOSTICS v_exp = ROW_COUNT;

  IF v_lines <> 4 OR v_je <> 2 OR v_exp <> 1 THEN
    RAISE EXCEPTION 'Expected 4 journal lines, 2 entries, 1 expense — got %, %, %', v_lines, v_je, v_exp;
  END IF;
END $$;
