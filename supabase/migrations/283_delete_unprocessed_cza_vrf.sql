-- 283 — remove the CZA Manufacturing PLC receipt facilitation, which never happened
--
-- Two identical VRF settlements sat in the pay queue for CZA Manufacturing
-- PLC, booked 10 seconds apart on 27 Aug 2026 at 966,000 ETB each. Neither
-- was ever processed: no bank reference, no batch payment, no payment
-- request, no ledger entry, no receipt, on either one. Each had its own
-- facilitation record — both marked settled, facilitator Hamza Dilgeba,
-- 966,000 transferred against 898,380 returned at a 7% commission — and
-- neither fund was ever drawn against (0 payments, 898,380 still showing as
-- available on both).
--
-- Confirmed with the user: the CZA facilitation did not take place. Both
-- expenses and both facilitation records are removed, taking 1,932,000 ETB
-- of approved_to_pay off the queue and 1,796,760 of phantom available funds
-- off v_vrf_fund_status.
--
-- Snapshot for the record — expenses (both vendor f61af21a-1353-48da-b47f-
-- 4243a8475b26 "CZA Manufacturing PLC", category 59888f33-6099-401b-8fb7-
-- 8eb8d0a6e59b, account 890c3473 CBE, fiscal period b6b2ae8b, no project,
-- description "VRF settlement", 966,000.00 gross and net, no WHT, type vrf,
-- finance_approved by df456dc7-e8da-481a-a038-b277093527c2, payment_state
-- approved_to_pay, never disbursed):
--
--   b0576704-b4d1-4447-8e21-e78b7ea79e1b  GEN-VRF-20260827-01
--     created 2026-08-27T12:30:37.531935Z, approved 12:32:47.923844Z
--     vrf 3eb8cacf-5d89-4e0b-9a67-8c1ba8d70f8e
--   f652dca1-b542-4b5a-9611-d17a5f9c11be  GEN-VRF-20260827-02
--     created 2026-08-27T12:30:47.837111Z, approved 12:35:07.071777Z
--     vrf 7f30829d-d27e-48a1-b452-a7ef9f24bfe9
--
-- and the facilitation records (both status settled, trxn_date 2026-08-27,
-- facilitator "Hamza Dilgeba ", commission_rate 7, amount_transferred
-- 966000, money_returned 898380, initial_account 890c3473, no return
-- account, no commission_amount, no record_name):
--
--   3eb8cacf-5d89-4e0b-9a67-8c1ba8d70f8e  created 2026-08-27T12:30:23.267485Z
--   7f30829d-d27e-48a1-b452-a7ef9f24bfe9  created 2026-08-27T12:27:47.000944Z
--
-- Checked before applying: no vrf_receipt_items, no payroll drawn on either
-- fund, no expense drawn on either fund (expenses.vrf_id), no journal entry
-- and no ledger posting failure against either. The only thing referencing
-- each facilitation was its own settlement expense, deleted here first.

DO $$
DECLARE
  v_exp int;
  v_vrf int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM expenses
     WHERE id IN ('b0576704-b4d1-4447-8e21-e78b7ea79e1b','f652dca1-b542-4b5a-9611-d17a5f9c11be')
       AND (bank_ref IS NOT NULL OR payment_state = 'paid')
  ) THEN
    RAISE EXCEPTION 'A CZA VRF expense has been paid since this was written — aborting';
  END IF;

  IF EXISTS (
    SELECT 1 FROM expenses
     WHERE vrf_id IN ('3eb8cacf-5d89-4e0b-9a67-8c1ba8d70f8e','7f30829d-d27e-48a1-b452-a7ef9f24bfe9')
    UNION ALL
    SELECT 1 FROM payroll
     WHERE vrf_id IN ('3eb8cacf-5d89-4e0b-9a67-8c1ba8d70f8e','7f30829d-d27e-48a1-b452-a7ef9f24bfe9')
    UNION ALL
    SELECT 1 FROM vrf_receipt_items
     WHERE vrf_id IN ('3eb8cacf-5d89-4e0b-9a67-8c1ba8d70f8e','7f30829d-d27e-48a1-b452-a7ef9f24bfe9')
  ) THEN
    RAISE EXCEPTION 'Something has been drawn against a CZA facilitation fund — aborting';
  END IF;

  DELETE FROM expenses
   WHERE id IN ('b0576704-b4d1-4447-8e21-e78b7ea79e1b','f652dca1-b542-4b5a-9611-d17a5f9c11be');
  GET DIAGNOSTICS v_exp = ROW_COUNT;

  DELETE FROM vendor_receipt_facilitation
   WHERE id IN ('3eb8cacf-5d89-4e0b-9a67-8c1ba8d70f8e','7f30829d-d27e-48a1-b452-a7ef9f24bfe9');
  GET DIAGNOSTICS v_vrf = ROW_COUNT;

  IF v_exp <> 2 OR v_vrf <> 2 THEN
    RAISE EXCEPTION 'Expected 2 expenses and 2 facilitations — got % and %', v_exp, v_vrf;
  END IF;
END $$;
