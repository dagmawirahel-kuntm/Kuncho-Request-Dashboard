-- 286 — import and match 20 Aug – 5 Sep 2026, the period the bank had and we didn't
--
-- With the parser fixed (Reference now read by header name rather than by a
-- fixed position), the full 8 Jul – 5 Sep CBE statement re-parses cleanly:
-- 238 rows, every one with a reference, and zero balance warnings — the
-- running-balance chain ties from the first row to the last.
--
-- Checking those 238 references against the transfers table showed the split
-- exactly: rows 1–112 (through 19 Aug) already exist as transfers, rows
-- 113–238 do not. Nothing partial, no interleaving — the system simply had
-- no bank data at all after 19 Aug. This imports those 126 rows, commits them
-- to transfers, and matches them to expenses by reference.
--
-- The 126 lines tie to the statement independently: 6,581,513.73 opening,
-- less 20,256,151.24 of debits, plus 17,285,377.39 of credits, equals
-- 3,610,739.88 — the closing balance the bank prints.
--
-- MATCHING. 93 of the 126 references name an expense. Their arithmetic is
-- the check: (debit − 6 birr internet charge) / net_payable lands on an exact
-- tax ratio for 83 of them — 1.000000 VAT-inclusive, 1.150000 +15% VAT,
-- 1.120000 +15% VAT less 3% WHT, 0.973913 VAT-inclusive less 3% WHT. Of the
-- remaining ten, seven resolve exactly too:
--
--   * five Outward MT103 transfers (lines 3, 13, 22, 69, 119) carry a 290
--     birr charge rather than 6 — 284.00 more, to the cent, on every one of
--     them, and the same 284.00 appeared on the MT103 in the 11–19 Aug
--     statement. With that fee they are all exactly 1.120000.
--   * line 39, MESO-GLAS-20260826-01: ratio exactly 0.575000, which is
--     0.5 × 1.15 — a half advance, and the expense is indeed in state
--     'advance'. 128,556.54 × 1.15 ÷ 2 + 6 = 73,926.00.
--   * line 97, MESO-SUBC-20260902-01: 94,875.00 ÷ 1.15 × 0.06 withheld
--     gives 89,925.00 + 6 = 89,931.00 to the cent.
--
-- One reference was recorded on the wrong expense. MESO-ALUM-20260903-01 is
-- PO-2026-0141 but carried FT26246FVM9R, which is the bank's line for
-- PO20260140. The narrations settle it without reference to the amounts —
-- line 100 says PO20260140 and line 101 says PO20260141 — and the amounts
-- then agree to the cent both ways (33,652.17 × 1.12 + 6 = 37,696.43 for
-- line 100 → MESO-MISC-20260903-02, and 27,153.89 × 1.12 + 6 = 30,418.36 for
-- line 101 → MESO-ALUM-20260903-01). Its bank_ref is corrected here, which
-- also resolves the only reference in the batch that pointed at two expenses.
--
-- Two are matched on their reference but their arithmetic is unexplained, so
-- they are matched with the variance left visible rather than quietly fixed:
--   line 37   618,099.80  DEBR-ELEC-20260826-01  488,478.14  ratio 1.265346
--   line 125   54,316.03  GEN-MULT-20260831-02    54,665.04  ratio 0.993506
--
-- PAYMENT STATE. Matching does NOT force 'paid' the way the app's matcher
-- does, because most of these expenses are not in a state where that is
-- correct or even legal:
--
--   advance  26 — money already recorded as gone; only 1 has a GRN, and
--                 forcing 'paid' would try to close 25 advances with no
--                 goods received. State left alone, transfer linked.
--   paid     34 — already confirmed; transfer linked.
--   sent     23 — the bank confirms these, so they move to 'paid', except
--                 any whose purchase order still has no GRN (the payment
--                 lifecycle trigger is left enabled and enforces that).
--   unpaid   10 — the bank shows the money left the account but the app has
--                 no payer on them at all. Linked to their transfer and left
--                 unpaid: they need a person, not a migration.

-- Stage 1 — commit the import: one transfer per line, then link the lines.
INSERT INTO transfers (transfer_id_code, date, from_account_id, to_account_id, amount, notes)
SELECT l.reference_code,
       COALESCE(l.value_date, l.post_date),
       CASE WHEN COALESCE(l.debit_amount, 0)  > 0 THEN i.account_id END,
       CASE WHEN COALESCE(l.credit_amount, 0) > 0 THEN i.account_id END,
       COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount, 0),
       COALESCE(l.narration, '') || ' (ref: ' || COALESCE(l.reference, '') || ')'
FROM bank_statement_lines l
JOIN bank_statement_imports i ON i.id = l.import_id
WHERE l.import_id = 'e1f3e9fb-e3c7-484c-868a-88210bdb5978';

UPDATE bank_statement_lines l
   SET transfer_id = t.id
  FROM transfers t
 WHERE l.import_id = 'e1f3e9fb-e3c7-484c-868a-88210bdb5978'
   AND t.transfer_id_code = l.reference_code;

UPDATE bank_statement_imports
   SET status = 'committed', committed_at = NOW()
 WHERE id = 'e1f3e9fb-e3c7-484c-868a-88210bdb5978';

-- Stages 2 and 3 — correct the mis-recorded reference, then match. The two
-- role-gated triggers would reject a migration outright (get_user_role() is
-- NULL here, and bank_ref is one of the fields they gate); the payment
-- lifecycle and ledger posting triggers stay ON so they govern every state
-- change below.
ALTER TABLE expenses DISABLE TRIGGER trg_enforce_expense_finance_fields;
ALTER TABLE expenses DISABLE TRIGGER trg_enforce_expense_approval_transitions;

UPDATE expenses
   SET bank_ref = 'FT262463VRN0'
 WHERE expense_code = 'MESO-ALUM-20260903-01' AND bank_ref = 'FT26246FVM9R';

DO $$
DECLARE
  v_import_id uuid := 'e1f3e9fb-e3c7-484c-868a-88210bdb5978';
  v_account   uuid;
  v_exp int; v_lines int; v_ambiguous int;
BEGIN
  SELECT account_id INTO v_account FROM bank_statement_imports WHERE id = v_import_id;

  SELECT count(*) INTO v_ambiguous FROM (
    SELECT l.id FROM bank_statement_lines l
    JOIN expenses e ON e.bank_ref = l.reference_code AND e.transfer_id IS NULL
    WHERE l.import_id = v_import_id
    GROUP BY l.id HAVING count(*) > 1
  ) x;
  IF v_ambiguous > 0 THEN
    RAISE EXCEPTION '% line(s) still name more than one expense — resolve before matching', v_ambiguous;
  END IF;

  CREATE TEMP TABLE _m ON COMMIT DROP AS
  SELECT l.id AS line_id, l.transfer_id, e.id AS expense_id, e.amount_etb,
         COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount, 0) AS line_amount,
         -- 'sent' is the only state the bank's confirmation should advance;
         -- see the header for why advance/paid/unpaid are left alone. A
         -- purchase order still owed a GRN stays 'sent' too — the lifecycle
         -- rule is that goods arrive before an expense is called paid, and
         -- one of these (GEN-MISC-20260829-03) is in exactly that position.
         (e.payment_state = 'sent'
          AND COALESCE(sb.payment_pattern, '') <> 'pay_in_advance'
          AND (e.sourcing_bundle_id IS NULL
               OR EXISTS (SELECT 1 FROM goods_received_notes g
                           WHERE g.sourcing_bundle_id = e.sourcing_bundle_id))) AS confirm_paid
  FROM bank_statement_lines l
  JOIN expenses e ON e.bank_ref = l.reference_code AND e.transfer_id IS NULL
  LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
  WHERE l.import_id = v_import_id
    AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = e.id);

  UPDATE expenses e
     SET transfer_id   = m.transfer_id,
         account_id    = COALESCE(e.account_id, v_account),
         payment_state = CASE WHEN m.confirm_paid THEN 'paid' ELSE e.payment_state END
    FROM _m m
   WHERE e.id = m.expense_id;
  GET DIAGNOSTICS v_exp = ROW_COUNT;

  UPDATE bank_statement_lines l
     SET matched_expense_id     = m.expense_id,
         matched_expense_amount = m.amount_etb,
         match_status           = 'matched_expense',
         variance_amount        = m.line_amount - m.amount_etb
    FROM _m m
   WHERE l.id = m.line_id;
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  RAISE NOTICE 'matched % expenses across % lines', v_exp, v_lines;
END $$;

ALTER TABLE expenses ENABLE TRIGGER trg_enforce_expense_approval_transitions;
ALTER TABLE expenses ENABLE TRIGGER trg_enforce_expense_finance_fields;
