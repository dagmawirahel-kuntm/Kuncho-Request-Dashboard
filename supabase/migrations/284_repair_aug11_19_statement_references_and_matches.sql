-- 284 — the 11–19 Aug CBE statement lost its reference column, so nothing could match
--
-- account-statement-2026-08-11-to-2026-08-19.csv was imported in a different
-- export format from the "export NN.csv" files, and every one of its 48 lines
-- landed with reference and reference_code NULL. Matching in this system is
-- entirely by reference_code = expenses.bank_ref, so those lines could never
-- match anything: 44 of 48 sat unmatched, and the four that were paired by
-- hand were guesses, three of them off by one line (see below).
--
-- The references are recoverable. export 18.csv (6–19 Aug, still a draft,
-- import 84f19d3f) is the SAME statement in the format that parses: 66 lines
-- = the 18 lines of export 17.csv (6–10 Aug) plus these 48. The two sets
-- agree one-to-one on (value_date, debit, credit, running_balance) — 48
-- distinct keys on each side, 48 joins, and the ordinals line up exactly
-- (export 18 line n+18 = this import's line n) for all 48. So the reference
-- for each committed line is simply its twin's, and this migration copies
-- them across.
--
-- What the recovered references then show, arithmetically:
--
-- Every CBE debit here is (amount payable) + a 6.00 birr transfer charge,
-- where "payable" is the expense figure adjusted for how it was recorded.
-- With the references restored, (debit - 6) / net_payable lands on exactly
-- one of four ratios for fifteen of the sixteen lines that name an expense:
--
--   1.000000  recorded VAT-inclusive, no WHT      lines 39, 40, 47
--   1.150000  recorded VAT-exclusive, +15% VAT    lines 28, 32, 33, 38, 42
--   1.120000  +15% VAT less 3% WHT                lines 36, 37, 44, 46
--   0.973913  VAT-inclusive less 3% WHT           line 48
--   (line 31 is net_payable to the birr: 809,700.00 gross less 21,122.61 WHT
--    = 788,577.39, and the bank took 788,583.25.)
--
-- That is the confirmation that the recovered references are right — they
-- were derived from balances and dates, and they land on tax arithmetic that
-- was nowhere in the derivation.
--
-- Three of the four hand-made matches were off by one line:
--
--   line 34  323,507.22  ref FT26226CLW1V  was MESO-CEME → GEN-MDF-20260814-01
--   line 35  249,327.76  ref FT262275CZRL  was GEN-VENE  → MESO-CEME-20260815-01
--   line 36   46,753.81  ref FT2622770370  was unmatched → GEN-VENE-20260815-01
--
-- Line 34's narration IS its reference (FT26226CLW1V, an Outward MT103), and
-- that reference is GEN-MDF's recorded bank_ref. Line 36's reference is
-- GEN-VENE's recorded bank_ref. Line 35 carries no bank_ref on any expense,
-- but 222,608.71 x 1.12 + 6 = 249,327.76 to the cent, and 222,608.71 is
-- MESO-CEME-20260815-01 — so that one is matched on the arithmetic and its
-- bank_ref is filled in from the statement. Lines 32 and 33 were already
-- right and are re-applied unchanged.
--
-- Deliberately NOT matched:
--
--   line 27  20,166.00  ref FT262250GFSY -> MESO-GLAS-20260813-01 (1,680.00)
--     The ratio is exactly 12.000000. The bank paid twelve times what the
--     expense records — most likely the expense holds a unit price for a
--     12-piece delivery ("PO PO-2026-0022 — Angle spacer"). It is left
--     unmatched for someone to decide; matching it would confirm 1,680 as
--     paid when 20,160 left the account.
--
-- No expense is created, no amount is edited. Fourteen expenses gain the
-- transfer that proves the bank paid them; six of those move sent -> paid,
-- which posts them to the ledger through the existing trigger:
--   GEN-MDF 288,586.80 · GEN-DECK 151,799.75 · MESO-SUBC 94,875.00 ·
--   BINI-MISC-19 41,000.00 · GEN-OTHE-17 6,676.00 · GEN-OTHE-15 3,829.00
-- All six carry a finance approver distinct from their payer, and both POs
-- among them are pay_on_delivery with a GRN, so the payment lifecycle trigger
-- is left enabled and enforces that on the way through.

DO $$
DECLARE
  v_import_id uuid := '8688873f-541e-4614-9cfc-ff98cbf40f12'; -- account-statement 11-19 Aug (committed)
  v_source_id uuid := '84f19d3f-70b3-42ce-a83f-028701e58bad'; -- export 18.csv (draft, has references)
  v_n int;
BEGIN
  ---------------------------------------------------------------- references
  WITH src AS (
    SELECT value_date, debit_amount, credit_amount, running_balance, reference, reference_code
    FROM bank_statement_lines
    WHERE import_id = v_source_id AND value_date BETWEEN '2026-08-11' AND '2026-08-19'
  ), pair AS (
    SELECT t.id AS tgt_id, s.reference, s.reference_code
    FROM bank_statement_lines t
    JOIN src s
      ON s.value_date = t.value_date
     AND COALESCE(s.debit_amount, 0)     = COALESCE(t.debit_amount, 0)
     AND COALESCE(s.credit_amount, 0)    = COALESCE(t.credit_amount, 0)
     AND COALESCE(s.running_balance, -1) = COALESCE(t.running_balance, -1)
    WHERE t.import_id = v_import_id
  )
  UPDATE bank_statement_lines t
     SET reference = p.reference, reference_code = p.reference_code
    FROM pair p
   WHERE t.id = p.tgt_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 48 THEN
    RAISE EXCEPTION 'Expected to restore 48 references, restored % — aborting', v_n;
  END IF;
END $$;

-- The two role-gated triggers below would reject this connection outright
-- (get_user_role() is NULL for a migration). The payment lifecycle and the
-- ledger posting triggers stay ON — their rules are exactly what should
-- govern an expense being confirmed as paid by the bank.
ALTER TABLE expenses DISABLE TRIGGER trg_enforce_expense_finance_fields;
ALTER TABLE expenses DISABLE TRIGGER trg_enforce_expense_approval_transitions;

DO $$
DECLARE
  v_import_id uuid := '8688873f-541e-4614-9cfc-ff98cbf40f12';
  v_account   uuid;
  v_exp int; v_lines int;
BEGIN
  SELECT account_id INTO v_account FROM bank_statement_imports WHERE id = v_import_id;

  CREATE TEMP TABLE _match ON COMMIT DROP AS
  SELECT l.id AS line_id, l.transfer_id, l.line_no,
         COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount, 0) AS line_amount,
         e.id AS expense_id, e.amount_etb, l.reference_code
  FROM (VALUES
    (28, 'MESO-GLAS-20260813-02'), (31, 'GEN-MULT-20260814-01'),
    (32, 'BINI-MISC-20260814-01'), (33, 'INTE-FOAM-20260814-01'),
    (34, 'GEN-MDF-20260814-01'),   (35, 'MESO-CEME-20260815-01'),
    (36, 'GEN-VENE-20260815-01'),  (37, 'GEN-MORA-20260815-01'),
    (38, 'WORK-MULT-20260815-01'), (39, 'GEN-OTHE-20260815-01'),
    (40, 'GEN-OTHE-20260817-01'),  (42, 'PRAN-PAIN-20260818-01'),
    (44, 'GEN-DECK-20260819-01'),  (46, 'INTE-FOAM-20260819-01'),
    (47, 'BINI-MISC-20260819-01'), (48, 'MESO-SUBC-20260818-01')
  ) AS m(line_no, expense_code)
  JOIN bank_statement_lines l ON l.import_id = v_import_id AND l.line_no = m.line_no
  JOIN expenses e ON e.expense_code = m.expense_code;

  IF (SELECT count(*) FROM _match) <> 16 THEN
    RAISE EXCEPTION 'Expected 16 line/expense pairs, resolved % — aborting', (SELECT count(*) FROM _match);
  END IF;
  IF EXISTS (SELECT 1 FROM _match WHERE transfer_id IS NULL) THEN
    RAISE EXCEPTION 'A line being matched has no committed transfer — aborting';
  END IF;
  IF EXISTS (SELECT 1 FROM _match m JOIN batch_payment_expenses b ON b.expense_id = m.expense_id) THEN
    RAISE EXCEPTION 'An expense being matched belongs to a batch payment — match the batch instead';
  END IF;

  UPDATE expenses e
     SET transfer_id   = m.transfer_id,
         payment_state = 'paid',
         account_id    = COALESCE(e.account_id, v_account),
         bank_ref      = COALESCE(e.bank_ref, m.reference_code)
    FROM _match m
   WHERE e.id = m.expense_id;
  GET DIAGNOSTICS v_exp = ROW_COUNT;

  UPDATE bank_statement_lines l
     SET matched_expense_id     = m.expense_id,
         matched_sale_id        = NULL,
         matched_expense_amount = m.amount_etb,
         match_status           = 'matched_expense',
         variance_amount        = m.line_amount - m.amount_etb
    FROM _match m
   WHERE l.id = m.line_id;
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  IF v_exp <> 16 OR v_lines <> 16 THEN
    RAISE EXCEPTION 'Expected 16 expenses and 16 lines updated — got % and %', v_exp, v_lines;
  END IF;
END $$;

ALTER TABLE expenses ENABLE TRIGGER trg_enforce_expense_approval_transitions;
ALTER TABLE expenses ENABLE TRIGGER trg_enforce_expense_finance_fields;
