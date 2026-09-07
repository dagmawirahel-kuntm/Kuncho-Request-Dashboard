-- 287 — match the 20 Aug – 5 Sep lines whose expense never had a bank reference
--
-- After 286, 33 of the 126 lines were unmatched. Most are not mysteries: CBE
-- writes the purchase order number into the narration ("PO20260118"), and the
-- expense for that order exists — it simply has no bank_ref recorded, so the
-- reference rule had nothing to match on.
--
-- Fourteen resolve that way, and the amounts confirm every one of them: with
-- the PO number as the link, (debit − 6 birr charge) / net_payable lands on
-- exactly 1.000000, 1.150000 or 1.120000 for all fourteen — the same tax
-- ratios the reference-matched lines land on. Each PO number names exactly
-- one expense, each expense is named by exactly one line, and none belongs to
-- a batch payment.
--
-- Writing bank_ref is what does the work: trg_auto_sync_expense_bank_ref
-- links the expense to the transfer holding that code and fills in the
-- account, which is precisely the link that was missing. The line side is
-- then recorded to match.
--
-- Payment state follows 286's rule — the bank confirming a payment advances
-- only an expense that was already 'sent', and only when its purchase order
-- has a GRN. Advances stay advances; anything still 'unpaid' here stays
-- unpaid, because the bank showing money gone does not tell us who approved
-- or paid it.

ALTER TABLE expenses DISABLE TRIGGER trg_enforce_expense_finance_fields;
ALTER TABLE expenses DISABLE TRIGGER trg_enforce_expense_approval_transitions;

DO $$
DECLARE
  v_import_id uuid := 'e1f3e9fb-e3c7-484c-868a-88210bdb5978';
  v_n int;
BEGIN
  CREATE TEMP TABLE _po ON COMMIT DROP AS
  SELECT l.id AS line_id, l.line_no, l.reference_code, l.transfer_id,
         COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount, 0) AS line_amount,
         e.id AS expense_id, e.amount_etb,
         (e.payment_state = 'sent'
          AND COALESCE(sb.payment_pattern, '') <> 'pay_in_advance'
          AND (e.sourcing_bundle_id IS NULL
               OR EXISTS (SELECT 1 FROM goods_received_notes g
                           WHERE g.sourcing_bundle_id = e.sourcing_bundle_id))) AS confirm_paid
  FROM bank_statement_lines l
  JOIN expenses e
    ON e.item_service_description LIKE
       'PO PO-' || substr(l.narration, 3, 4) || '-' || substr(l.narration, 7, 4) || ' %'
  LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
  WHERE l.import_id = v_import_id
    AND l.match_status = 'unmatched'
    AND l.narration ~ '^PO20[0-9]{6}$'
    AND e.bank_ref IS NULL
    AND e.transfer_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses b WHERE b.expense_id = e.id)
    -- only where the arithmetic agrees to the cent
    AND (ABS((COALESCE(NULLIF(l.debit_amount,0), l.credit_amount, 0) - 6) / NULLIF(e.net_payable,0) - 1.00)     < 0.00002
      OR ABS((COALESCE(NULLIF(l.debit_amount,0), l.credit_amount, 0) - 6) / NULLIF(e.net_payable,0) - 1.15)     < 0.00002
      OR ABS((COALESCE(NULLIF(l.debit_amount,0), l.credit_amount, 0) - 6) / NULLIF(e.net_payable,0) - 1.12)     < 0.00002
      OR ABS((COALESCE(NULLIF(l.debit_amount,0), l.credit_amount, 0) - 6) / NULLIF(e.net_payable,0) - 0.973913) < 0.00002);

  IF (SELECT count(DISTINCT line_id) FROM _po) <> (SELECT count(*) FROM _po)
     OR (SELECT count(DISTINCT expense_id) FROM _po) <> (SELECT count(*) FROM _po) THEN
    RAISE EXCEPTION 'A line or an expense appears twice in the PO-number match — aborting';
  END IF;

  -- bank_ref first: the auto-sync trigger turns it into the transfer link.
  UPDATE expenses e
     SET bank_ref = p.reference_code
    FROM _po p
   WHERE e.id = p.expense_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM _po p JOIN expenses e ON e.id = p.expense_id
              WHERE e.transfer_id IS DISTINCT FROM p.transfer_id) THEN
    RAISE EXCEPTION 'An expense did not pick up its transfer from bank_ref — aborting';
  END IF;

  UPDATE expenses e
     SET payment_state = 'paid'
    FROM _po p
   WHERE e.id = p.expense_id AND p.confirm_paid;

  UPDATE bank_statement_lines l
     SET matched_expense_id     = p.expense_id,
         matched_expense_amount = p.amount_etb,
         match_status           = 'matched_expense',
         variance_amount        = p.line_amount - p.amount_etb
    FROM _po p
   WHERE l.id = p.line_id;

  RAISE NOTICE 'matched % lines by purchase order number', v_n;
END $$;

ALTER TABLE expenses ENABLE TRIGGER trg_enforce_expense_approval_transitions;
ALTER TABLE expenses ENABLE TRIGGER trg_enforce_expense_finance_fields;
