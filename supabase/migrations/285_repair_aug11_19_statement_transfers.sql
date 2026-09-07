-- 285 — the transfers written from the 11–19 Aug statement were all backwards
--
-- Migration 284 restored that import's reference codes and matched its lines.
-- The transfer records written when it was committed are still wrong, because
-- they were written from the mis-parsed data (see the parser fix in this same
-- change): reading a Reference-before-amounts CBE export with the older
-- Reference-last column order puts every Debit into credit, every Credit into
-- balance, and the Balance string into reference. So commit_statement_import
-- saw a credit where the bank showed a debit, and produced, for all 48 lines:
--
--   * transfer_id_code = a formatted running balance ("922,283.56") instead
--     of the bank reference — which also means a re-import of this period
--     cannot recognise these lines as already committed and would duplicate
--     every one of them
--   * to_account_id = CBE with from_account_id empty on all 46 debits, i.e.
--     5,069,507.93 of payments counted as money INTO the account
--   * amount 0.00 on both credits, including a real 7,000,000.00 deposit on
--     19 Aug and 148,083.00 on the same day
--
-- The line rows themselves were corrected in place at some point after the
-- commit and are right — the uploaded 8 Jul–5 Sep statement re-parses to the
-- same debits, credits and running balances with zero balance warnings across
-- all 238 rows, so the chain validates end to end. This rewrites each transfer
-- to agree with its line: real reference code, real amount, and the direction
-- the bank actually moved the money.
--
-- Effect on v_account_balances for CBE: 5,069,507.93 stops counting as
-- transfers-in and starts counting as transfers-out, and 7,148,083.00 of
-- genuine deposits start counting as transfers-in. Sixteen expenses matched
-- in 284 also stop being counted through expenses_out and start being counted
-- through their transfer, which is the deduplication the view is built around.
--
-- Checked before applying: all 48 lines carry a transfer, every recovered
-- reference code is unique across the transfers table (no collision with the
-- 64 transfers that already hold a real FT code), and only the two zero-amount
-- credits change amount.

DO $$
DECLARE
  v_import_id uuid := '8688873f-541e-4614-9cfc-ff98cbf40f12';
  v_n int;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bank_statement_lines l
    WHERE l.import_id = v_import_id AND (l.transfer_id IS NULL OR l.reference_code IS NULL)
  ) THEN
    RAISE EXCEPTION 'A line on this import has no transfer or no reference code — run 284 first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bank_statement_lines l
    JOIN transfers t2 ON t2.transfer_id_code = l.reference_code AND t2.id <> l.transfer_id
    WHERE l.import_id = v_import_id
  ) THEN
    RAISE EXCEPTION 'A recovered reference code is already held by a different transfer — aborting';
  END IF;

  UPDATE transfers t
     SET transfer_id_code = l.reference_code,
         amount           = COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount, 0),
         from_account_id  = CASE WHEN COALESCE(l.debit_amount, 0)  > 0 THEN i.account_id END,
         to_account_id    = CASE WHEN COALESCE(l.credit_amount, 0) > 0 THEN i.account_id END,
         notes            = COALESCE(l.narration, '') || ' (ref: ' || COALESCE(l.reference, '') || ')'
    FROM bank_statement_lines l
    JOIN bank_statement_imports i ON i.id = l.import_id
   WHERE l.transfer_id = t.id AND l.import_id = v_import_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> 48 THEN
    RAISE EXCEPTION 'Expected to repair 48 transfers, repaired % — aborting', v_n;
  END IF;
END $$;
