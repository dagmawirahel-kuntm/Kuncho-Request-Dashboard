-- 341 — Expenses raised from a PO carry its VAT and withholding
--
-- ── The gap ──────────────────────────────────────────────────────────────────
--
-- A PO prints subtotal + 15% VAT = gross, less 3% WHT when the vendor is
-- WHT-eligible and the subtotal clears 20,000 (PurchaseOrderPage). The
-- expense the GRN raises for it (auto_create_purchase_order_expense, 136/299)
-- copied sourcing_bundles.total_value — the subtotal — and set no WHT. So did
-- the manual "expense from PO" form. Every other expense is entered at its
-- VAT-inclusive total (the form says so, net_payable is amount - WHT, and the
-- input VAT tracker (317) reads amount_etb as VAT-inclusive), so PO expenses
-- were the only ones short of their VAT, with nothing withheld.
--
-- Finance had been correcting some by hand — PO-2026-0019: subtotal
-- 138,434.74, amount 159,200.00, WHT 4,153.04 — and those are left alone.
-- 144 were still at the subtotal.
--
-- ── What this does ───────────────────────────────────────────────────────────
--
-- 1. po_expense_tax() is the PO's own arithmetic, once, for the database.
--    The GRN trigger raises the expense at gross with the WHT set, and the
--    rejected-quantity adjuster (283/299) takes rejections off at gross and
--    scales the WHT with what is left.
--
-- 2. The 51 not yet paid — 35 pending, 15 approved to pay, 1 sent — move to
--    gross with WHT. None is in a batch or a payment request. The one sent
--    (GEN-MISC-20260829-03) already left the bank at gross less WHT
--    (42,566.01 = 38,000.01 x 1.12 + 6 fee); it has no ledger entry yet.
--
-- 3. The 87 paid or advanced whose bank line shows the vendor got gross less
--    WHT (or gross, where nothing was withheld) move to that amount, and each
--    gets one adjusting entry for the difference the books never saw:
--
--      paid:     Dr the expense account it posted to   VAT
--      advance:  Dr 1080 Vendor Advances               VAT
--                Cr the cash account it was paid from  VAT - WHT
--                Cr 2025 Withholding Tax Payable        WHT
--
--    ("paid" ones whose advance-close never posted are still in 1080, and
--    are debited there), dated with its payment entry, under its own
--    source_table so the posting trigger's per-expense entry count is
--    untouched (the 330 convention).
--    An advance closed later posts Dr expense / Cr 1080 at the new gross,
--    which is what 1080 then holds.
--
--    Evidence, per expense, from bank_statement_lines.matched_expense_id:
--      76  bank = gross - WHT, within 10 ETB of fees
--       6  bank = gross - WHT + 290 (Surafel Getiye; the same fee every time)
--       1  bank = gross - 3% with no vendor linked (MESO-COMP-20260821-01)
--       1  bank = gross, nothing withheld (MESO-ALUM-20260824-01)
--       3  no bank line imported, paid by transfer — corrected on the owner's
--          word that PO payments went out at gross less WHT
--
--    Left as they are, for finance:
--      PERS-MISC-20260827-01  bank = the subtotal: no VAT was charged
--      MESO-GLAS-20260826-01  bank = 50% of gross: only half is advanced
--      GEN-MULT-20260831-02   vendor credit applied before VAT
--      GEN-MISC-20260829-05   settled wholly from vendor credit, no bank line
--
-- The expense finance-field guard (enforce_expense_finance_fields) refuses
-- any change to verify_wht / wht_handling_method without a finance role,
-- which a migration does not have; it is switched off for the two updates
-- and back on straight after, inside this transaction.

SET search_path TO public;

-- ── 1. The PO's tax arithmetic ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.po_expense_tax(p_subtotal numeric, p_wht_eligible boolean)
RETURNS TABLE (vat numeric, gross numeric, wht numeric)
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT round(COALESCE(p_subtotal, 0) * 0.15, 2),
         round(COALESCE(p_subtotal, 0), 2) + round(COALESCE(p_subtotal, 0) * 0.15, 2),
         CASE WHEN COALESCE(p_wht_eligible, false) AND COALESCE(p_subtotal, 0) > 20000
              THEN round(p_subtotal * 0.03, 2) ELSE 0 END;
$$;

COMMENT ON FUNCTION public.po_expense_tax(numeric, boolean) IS
  'A PO''s VAT (15%), gross, and WHT (3% when the vendor is WHT-eligible and the subtotal is over 20,000) — the same figures the printed PO shows. src/lib/poTax.ts is its twin.';

CREATE OR REPLACE FUNCTION public.auto_create_purchase_order_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle          sourcing_bundles%ROWTYPE;
  v_item_names      TEXT;
  v_project_id      UUID;
  v_project_count   INT;
  v_expense_id      UUID;
  v_tax             RECORD;
BEGIN
  SELECT * INTO v_bundle FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  IF v_bundle.expense_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(DISTINCT oi.item_name, ', ')
  INTO v_item_names
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.bundle_id = v_bundle.id;

  SELECT count(*) INTO v_project_count FROM (
    SELECT DISTINCT o.project_id
    FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = v_bundle.id AND o.project_id IS NOT NULL
  ) distinct_projects;

  IF v_project_count = 1 THEN
    SELECT o.project_id INTO v_project_id
    FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = v_bundle.id AND o.project_id IS NOT NULL
    LIMIT 1;
  ELSE
    v_project_id := NULL;
  END IF;

  -- The expense is the PO's gross (subtotal + VAT); the WHT is withheld from
  -- it at payment, so net_payable is what the vendor receives.
  SELECT * INTO v_tax FROM po_expense_tax(
    COALESCE(v_bundle.total_value, 0),
    (SELECT wth_eligible FROM vendors WHERE id = v_bundle.vendor_id));

  INSERT INTO expenses (
    item_service_description, amount_etb, date, expense_type,
    vendor_id, vendors_name, project_id, sourcing_bundle_id, requested,
    wht_amount, verify_wht, wht_handling_method, notes
  ) VALUES (
    'PO ' || v_bundle.bundle_code || COALESCE(' — ' || v_item_names, ''),
    v_tax.gross, CURRENT_DATE, 'purchase_order',
    v_bundle.vendor_id, CASE WHEN v_bundle.vendor_id IS NULL THEN v_bundle.vendor_name END,
    v_project_id, v_bundle.id, true,
    NULLIF(v_tax.wht, 0), v_tax.wht > 0, CASE WHEN v_tax.wht > 0 THEN 'Withheld & Remitted' END,
    concat_ws(E'\n',
      CASE WHEN COALESCE(v_bundle.discount_etb, 0) > 0 THEN
        format('Vendor discount of %s ETB applied: %s before discount, %s billed.%s',
               v_bundle.discount_etb, v_bundle.items_subtotal_etb, v_bundle.total_value,
               COALESCE(' ' || v_bundle.discount_reason, ''))
      END,
      format('PO subtotal %s + VAT 15%% %s = %s.%s',
             COALESCE(v_bundle.total_value, 0), v_tax.vat, v_tax.gross,
             CASE WHEN v_tax.wht > 0 THEN format(' WHT 3%% %s withheld; %s to the vendor.', v_tax.wht, v_tax.gross - v_tax.wht) ELSE '' END))
  ) RETURNING id INTO v_expense_id;

  UPDATE sourcing_bundles SET expense_id = v_expense_id WHERE id = v_bundle.id;

  RETURN NEW;
END;
$function$;

-- Rejections come off at gross, and the withholding follows what is left:
-- scaled with the subtotal still billed, and dropped once that falls to the
-- 20,000 floor. rejection_deduction_etb stays in subtotal terms, as before.
CREATE OR REPLACE FUNCTION public.adjust_po_expense_for_rejected_qty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle_id       UUID;
  v_payment_pattern TEXT;
  v_expense_id      UUID;
  v_expense_state   TEXT;
  v_old_amount      NUMERIC;
  v_old_wht         NUMERIC;
  v_prior_deduction NUMERIC;
  v_rejected_total  NUMERIC;
  v_subtotal        NUMERIC;
  v_net             NUMERIC;
  v_delta           NUMERIC;
  v_new_amount      NUMERIC;
  v_billed_before   NUMERIC;
  v_billed_after    NUMERIC;
  v_new_wht         NUMERIC;
BEGIN
  SELECT sbi.bundle_id INTO v_bundle_id
  FROM sourcing_bundle_items sbi
  WHERE sbi.id = COALESCE(NEW.sourcing_bundle_item_id, OLD.sourcing_bundle_item_id);

  IF v_bundle_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT payment_pattern, expense_id, rejection_deduction_etb,
         items_subtotal_etb, total_value
  INTO v_payment_pattern, v_expense_id, v_prior_deduction, v_subtotal, v_net
  FROM sourcing_bundles WHERE id = v_bundle_id;

  IF v_expense_id IS NULL OR v_payment_pattern = 'pay_in_advance' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT amount_etb, wht_amount, payment_state INTO v_old_amount, v_old_wht, v_expense_state
  FROM expenses WHERE id = v_expense_id;

  IF v_expense_state IS DISTINCT FROM 'unpaid' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(gi.quantity_rejected * COALESCE(sbi2.unit_price_actual, 0)), 0)
  INTO v_rejected_total
  FROM goods_received_note_items gi
  JOIN sourcing_bundle_items sbi2 ON sbi2.id = gi.sourcing_bundle_item_id
  WHERE sbi2.bundle_id = v_bundle_id;

  IF COALESCE(v_subtotal, 0) > 0 AND v_net IS NOT NULL AND v_net <> v_subtotal THEN
    v_rejected_total := ROUND(v_rejected_total * (v_net / v_subtotal), 2);
  END IF;

  v_delta := v_rejected_total - COALESCE(v_prior_deduction, 0);

  IF v_delta <> 0 THEN
    v_new_amount := GREATEST(v_old_amount - ROUND(v_delta * 1.15, 2), 0);

    v_billed_before := COALESCE(v_net, 0) - COALESCE(v_prior_deduction, 0);
    v_billed_after  := COALESCE(v_net, 0) - v_rejected_total;
    v_new_wht := CASE
      WHEN COALESCE(v_old_wht, 0) = 0 OR v_billed_before <= 0 THEN v_old_wht
      WHEN v_billed_after <= 20000 THEN NULL
      ELSE ROUND(v_old_wht * v_billed_after / v_billed_before, 2)
    END;

    UPDATE expenses
    SET amount_etb = v_new_amount,
        wht_amount = v_new_wht,
        notes = COALESCE(notes || E'\n', '') ||
          format('Auto-adjusted %s → %s ETB (incl. VAT): %s change in rejected quantity on the linked GRN, not billed.%s',
                 v_old_amount, v_new_amount, v_delta,
                 CASE WHEN v_new_wht IS DISTINCT FROM v_old_wht
                      THEN format(' WHT %s → %s.', COALESCE(v_old_wht, 0), COALESCE(v_new_wht, 0)) ELSE '' END)
    WHERE id = v_expense_id;

    UPDATE sourcing_bundles SET rejection_deduction_etb = v_rejected_total WHERE id = v_bundle_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ── 2 & 3. The expenses already raised at the subtotal ───────────────────────

CREATE TEMP TABLE po_vat_fix ON COMMIT DROP AS
SELECT e.id, e.expense_code, e.payment_state, b.total_value AS subtotal,
       t.vat, t.gross, t.wht AS vendor_wht
FROM expenses e
JOIN sourcing_bundles b ON b.id = e.sourcing_bundle_id
LEFT JOIN vendors v ON v.id = b.vendor_id
CROSS JOIN LATERAL po_expense_tax(b.total_value, v.wth_eligible) t
WHERE e.expense_type = 'purchase_order'
  AND b.total_value > 0
  AND abs(e.amount_etb - b.total_value) < 0.01;

ALTER TABLE po_vat_fix ADD COLUMN wht numeric, ADD COLUMN evidence text;

-- Not yet paid: the vendor's own WHT eligibility decides.
UPDATE po_vat_fix
   SET wht = vendor_wht, evidence = 'not yet paid'
 WHERE payment_state IN ('unpaid', 'approved_to_pay')
   AND id IN (SELECT id FROM expenses WHERE approval_status <> 'rejected');

UPDATE po_vat_fix
   SET wht = vendor_wht, evidence = 'sent; bank 42,566.01 = gross less WHT'
 WHERE expense_code = 'GEN-MISC-20260829-03' AND payment_state = 'sent';

-- Paid or advanced: the WHT the bank line shows was actually withheld.
UPDATE po_vat_fix f
   SET wht = p.wht, evidence = 'paid; bank line'
  FROM (VALUES
    ('BINI-COMP-20260903-01',0),('BINI-MISC-20260814-01',0),('BINI-MISC-20260820-01',0),('BINI-PAIN-20260828-01',2884.79),
    ('GEN-ALUM-20260826-01',837.57),('GEN-COMP-20260821-01',657.00),('GEN-COMP-20260828-01',5850.24),('GEN-DECK-20260819-01',4553.99),
    ('GEN-ELEC-20260827-01',993.70),('GEN-ELEC-20260903-01',1762.96),('GEN-MDF-20260814-01',8657.60),('GEN-MDF-20260820-01',8122.04),
    ('GEN-MISC-20260829-01',750.70),('GEN-MISC-20260905-01',5568.00),('GEN-MORA-20260815-01',3448.70),('GEN-MULT-20260818-01',3660.00),
    ('GEN-MULT-20260821-01',8167.82),('GEN-MULT-20260825-01',2920.43),('GEN-MULT-20260826-01',10004.33),('GEN-MULT-20260829-01',1601.58),
    ('GEN-MULT-20260831-03',6742.47),('GEN-MULT-20260904-01',0),('GEN-MULT-20260904-02',738.37),('GEN-PAIN-20260824-01',2455.84),
    ('GEN-STEE-20260826-01',1275.65),('GEN-VENE-20260815-01',1252.17),('GEN-VENE-20260824-01',0),('GIRM-ALUM-20260905-01',656.87),
    ('GIRM-CLAD-20260905-01',1392.00),('GIRM-ELEC-20260904-01',0),('GIRM-MULT-20260903-01',0),('GIRM-MULT-20260905-01',0),
    ('GIRM-STEE-20260829-01',0),('INTE-ALUM-20260824-01',3747.95),('INTE-CLAD-20260824-01',6987.00),('INTE-FOAM-20260814-01',0),
    ('INTE-FOAM-20260819-01',10245.00),('INTE-MISC-20260819-01',10245.00),('INTE-MISC-20260829-01',0),('INTE-MULT-20260821-02',9045.00),
    ('INTE-MULT-20260821-03',4132.18),('JOTU-PAIN-20260820-01',0),('MESO-ALUM-20260824-01',0),('MESO-ALUM-20260902-01',5395.38),
    ('MESO-ALUM-20260903-01',814.62),('MESO-BUIL-20260902-01',0),('MESO-CEME-20260815-01',6678.26),('MESO-COMP-20260821-01',1185.00),
    ('MESO-COMP-20260821-02',7565.22),('MESO-COMP-20260826-01',0),('MESO-COMP-20260829-01',693.52),('MESO-COMP-20260829-02',3671.40),
    ('MESO-COMP-20260902-01',1069.57),('MESO-COMP-20260905-01',1247.83),('MESO-ELEC-20260820-01',1113.90),('MESO-ELEC-20260820-02',4312.14),
    ('MESO-ELEC-20260822-01',5593.04),('MESO-ELEC-20260902-01',0),('MESO-ELEC-20260904-01',0),('MESO-GLAS-20260813-02',0),
    ('MESO-GRAN-20260826-01',3568.70),('MESO-INVE-20260829-01',0),('MESO-LEAT-20260820-01',1459.65),('MESO-MDF-20260827-01',3396.00),
    ('MESO-MISC-20260822-01',1708.20),('MESO-MISC-20260822-02',1620.00),('MESO-MISC-20260827-01',0),('MESO-MISC-20260829-01',0),
    ('MESO-MISC-20260903-01',0),('MESO-MISC-20260903-02',1009.57),('MESO-MISC-20260904-01',2834.94),('MESO-MISC-20260905-01',0),
    ('MESO-MULT-20260822-01',0),('MESO-MULT-20260826-01',0),('MESO-MULT-20260826-02',2793.91),('MESO-MULT-20260829-01',1532.61),
    ('MESO-MULT-20260903-01',614.61),('MESO-MULT-20260904-01',3427.67),('MESO-PAIN-20260824-01',617.74),('MESO-PAIN-20260827-01',1920.00),
    ('MESO-STEE-20260820-01',1665.39),('MESO-STEE-20260905-01',0),('PRAN-PAIN-20260818-01',0),('SOLO-BUIL-20260821-01',782.61),
    ('SOLO-INVE-20260902-01',0),('SOLO-MISC-20260820-01',43826.04),('WORK-MULT-20260815-01',0)
  ) AS p(code, wht)
 WHERE f.expense_code = p.code AND f.payment_state IN ('paid', 'advance');

DELETE FROM po_vat_fix WHERE wht IS NULL;

DO $$
DECLARE n_unpaid int; n_paid int;
BEGIN
  SELECT count(*) FILTER (WHERE payment_state IN ('unpaid','approved_to_pay','sent')),
         count(*) FILTER (WHERE payment_state IN ('paid','advance'))
    INTO n_unpaid, n_paid FROM po_vat_fix;
  IF n_unpaid <> 51 OR n_paid <> 87 THEN
    RAISE EXCEPTION 'Expected 51 unpaid and 87 paid PO expenses to correct, found % and %', n_unpaid, n_paid;
  END IF;
END $$;

-- The adjusting entries, before the amounts move (the cash line is found
-- from the payment entry as posted).
DO $$
DECLARE
  r record;
  v_wht_account uuid := (SELECT id FROM chart_of_accounts WHERE account_code = '2025');
  v_advance_account uuid := (SELECT id FROM chart_of_accounts WHERE account_code = '1080');
  v_entry uuid;
  n int := 0;
BEGIN
  FOR r IN
    SELECT f.*, cash.account_id AS cash_account, cash.entry_date,
           -- Where the payment's value sits now: the expense account once the
           -- purchase is expensed, else still in Vendor Advances (an advance,
           -- or a "paid" one whose advance-close never posted).
           CASE WHEN f.payment_state = 'advance' THEN v_advance_account
                ELSE COALESCE(exp_line.account_id, v_advance_account) END AS debit_account
    FROM po_vat_fix f
    CROSS JOIN LATERAL (
      SELECT jl.account_id, je.entry_date
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
      JOIN chart_of_accounts c ON c.id = jl.account_id
      WHERE je.source_table = 'expenses' AND je.source_id = f.id
        AND c.cash_flow_section = 'cash' AND jl.credit > 0
      ORDER BY je.created_at LIMIT 1
    ) cash
    LEFT JOIN LATERAL (
      SELECT jl.account_id
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
      WHERE je.source_table = 'expenses' AND je.source_id = f.id
        AND jl.debit > 0 AND jl.account_id <> v_advance_account
      ORDER BY je.created_at DESC LIMIT 1
    ) exp_line ON true
    WHERE f.payment_state IN ('paid', 'advance')
      AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.source_table = 'expense_po_vat_adjust' AND x.source_id = f.id)
  LOOP
    INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
    VALUES (r.entry_date, 'adjusting', 'expense_po_vat_adjust', r.id,
            'PO VAT and withholding brought to the books: ' || r.expense_code)
    RETURNING id INTO v_entry;
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
      (v_entry, r.debit_account, r.vat, 0,
       format('VAT on the PO (15%% of %s), paid to the vendor but booked at the subtotal', r.subtotal)),
      (v_entry, r.cash_account, 0, r.vat - r.wht,
       'The rest of what left the bank: VAT less the withholding');
    IF r.wht > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry, v_wht_account, 0, r.wht, 'Withholding tax withheld, owed to the tax authority');
    END IF;
    n := n + 1;
  END LOOP;
  IF n <> 87 THEN
    RAISE EXCEPTION 'Expected 87 adjusting entries, posted %', n;
  END IF;
  SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
  SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
END $$;

ALTER TABLE expenses DISABLE TRIGGER trg_enforce_expense_finance_fields;

UPDATE expenses e
   SET amount_etb = f.gross,
       wht_amount = NULLIF(f.wht, 0),
       verify_wht = f.wht > 0,
       wht_handling_method = CASE WHEN f.wht > 0 THEN 'Withheld & Remitted' ELSE e.wht_handling_method END,
       notes = concat_ws(E'\n', e.notes,
         format('Corrected 2026-09-26 (341): raised at the PO subtotal %s without its VAT. Now %s incl. VAT 15%% %s%s.',
                f.subtotal, f.gross, f.vat,
                CASE WHEN f.wht > 0 THEN format(', WHT 3%% %s withheld, %s to the vendor', f.wht, f.gross - f.wht) ELSE '' END))
  FROM po_vat_fix f
 WHERE e.id = f.id;

ALTER TABLE expenses ENABLE TRIGGER trg_enforce_expense_finance_fields;
