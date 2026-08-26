-- 258 — Fix PO expense category misclassification, past and future
--
-- Follows 257 (the Sub Ledgers subsidiary view). That view exposed that
-- purchase-order expenses often post to the wrong GL category: a
-- multi-category PO collapses to the literal "Multiple" account, and even
-- single-category POs sometimes posted to a category that doesn't match
-- what the GRN says was actually received (e.g. Gypsum posted as Steel).
--
-- This migration:
--   1. Adds the 4 chart_of_accounts rows that were missing for categories
--      already in use on GRN lines (Cladding, Fabric, Magnesium Board,
--      Silicon), so every real category has somewhere to post.
--   2. Adds resolve_po_category_split(): splits a posted amount across the
--      real categories tagged on a PO's GRN lines, weighted by
--      quantity_accepted * unit_price_actual. Returns no rows when the
--      bundle has no GRN lines yet, so callers can fall back cleanly.
--   3. Rewrites post_expense_payment_to_ledger() to use that split for the
--      expense-side debit line(s) of every purchase_order expense with GRN
--      data — posting N debit lines (one per real category) instead of one
--      lump line — while leaving non-PO expenses and PO expenses without
--      GRN data yet (paid before goods arrived) on the original
--      single-category behavior. retry_expense_ledger_posting() re-enters
--      this same trigger, so it picks up the new logic automatically.
--   4. One-time historical correction: for every already-posted PO expense
--      with GRN data, replaces its existing expense-side debit line(s) with
--      the correct split — using the amount actually posted (not
--      expenses.amount_etb, which can drift from the ledger after the
--      fact) so every corrected entry still balances exactly. Idempotent:
--      re-running it recomputes the same values.
--
-- v_sub_ledger_balances (257) is also redefined here: it originally
-- compared the real (GRN) category against expenses.category_id, which
-- this migration deliberately leaves untouched (to avoid side effects like
-- regenerating expense_code). It now compares against what is actually
-- posted in journal_lines instead, so it reflects the real ledger both
-- before and after this fix.

-- 1. Missing chart_of_accounts rows for real categories used on GRN lines.
INSERT INTO chart_of_accounts (account_code, account_name, nature, category_id, parent_account_id, is_postable, active)
SELECT v.code, trim(c.category_name), 'Expense', c.id, 'cf0514d6-fc40-44bf-a6d2-7a3b3de5c341', true, true
FROM (VALUES
  ('51061', 'Cladding '),
  ('51062', 'Fabric'),
  ('51063', 'Magnesium Board '),
  ('51064', 'Silicon')
) AS v(code, category_name)
JOIN categories c ON c.category_name = v.category_name
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts coa WHERE coa.category_id = c.id);

-- 2. Split-allocation helper.
CREATE OR REPLACE FUNCTION public.resolve_po_category_split(p_sourcing_bundle_id uuid, p_amount numeric)
RETURNS TABLE(category_id uuid, amount numeric)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle_value numeric;
  v_running numeric := 0;
  v_row RECORD;
  v_count int;
  v_i int := 0;
BEGIN
  IF p_sourcing_bundle_id IS NULL OR p_amount IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(gni.quantity_accepted * sbi.unit_price_actual), 0)
  INTO v_bundle_value
  FROM goods_received_note_items gni
  JOIN goods_received_notes gn ON gn.id = gni.grn_id
  JOIN sourcing_bundle_items sbi ON sbi.id = gni.sourcing_bundle_item_id
  WHERE gn.sourcing_bundle_id = p_sourcing_bundle_id;

  -- No GRN lines recorded yet for this bundle (e.g. paid before goods
  -- arrived) — nothing to split on. Caller falls back to the old
  -- single-category posting.
  IF v_bundle_value IS NULL OR v_bundle_value = 0 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT gni.category_id
    FROM goods_received_note_items gni
    JOIN goods_received_notes gn ON gn.id = gni.grn_id
    JOIN sourcing_bundle_items sbi ON sbi.id = gni.sourcing_bundle_item_id
    WHERE gn.sourcing_bundle_id = p_sourcing_bundle_id
    GROUP BY gni.category_id
  ) x;

  FOR v_row IN
    SELECT gni.category_id AS cat_id,
           SUM(gni.quantity_accepted * sbi.unit_price_actual) AS line_value
    FROM goods_received_note_items gni
    JOIN goods_received_notes gn ON gn.id = gni.grn_id
    JOIN sourcing_bundle_items sbi ON sbi.id = gni.sourcing_bundle_item_id
    WHERE gn.sourcing_bundle_id = p_sourcing_bundle_id
    GROUP BY gni.category_id
    ORDER BY gni.category_id
  LOOP
    v_i := v_i + 1;
    category_id := v_row.cat_id;
    IF v_i = v_count THEN
      -- Last row absorbs the rounding remainder so the split's debit
      -- lines always sum EXACTLY to p_amount (required by the deferred
      -- journal-balance constraint).
      amount := ROUND(p_amount - v_running, 2);
    ELSE
      amount := ROUND(p_amount * (v_row.line_value / v_bundle_value), 2);
      v_running := v_running + amount;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.resolve_po_category_split IS
  'Splits a posted PO expense amount across the real categories tagged on its GRN lines (goods_received_note_items.category_id), weighted by quantity_accepted * unit_price_actual. Returns no rows if the bundle has no GRN lines yet, so callers can fall back to the single-category posting.';

-- 3. Posting trigger: use the split for PO expenses with GRN data.
CREATE OR REPLACE FUNCTION public.post_expense_payment_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy UUID;
  v_row_fy     UUID;
  v_expense_account_id UUID;
  v_cash_account_id    UUID;
  v_advance_account_id UUID;
  v_entry_id   UUID;
  v_is_advance_close BOOLEAN;
  v_existing_count INT;
  v_split RECORD;
  v_used_split BOOLEAN := FALSE;
  v_cat_account_id UUID;
  v_multiple_account_id UUID;
  v_multiple_leftover NUMERIC := 0;
BEGIN
  v_is_advance_close := (TG_OP = 'UPDATE' AND OLD.payment_state = 'advance' AND NEW.payment_state = 'paid');

  IF NEW.payment_state NOT IN ('paid', 'advance') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  IF v_row_fy IS NULL OR v_row_fy <> v_current_fy THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_existing_count FROM journal_entries WHERE source_table = 'expenses' AND source_id = NEW.id;

  IF NEW.payment_state = 'advance' AND v_existing_count > 0 THEN RETURN NEW; END IF;
  IF NEW.payment_state = 'paid' AND v_is_advance_close AND v_existing_count <> 1 THEN RETURN NEW; END IF;
  IF NEW.payment_state = 'paid' AND NOT v_is_advance_close AND v_existing_count > 0 THEN RETURN NEW; END IF;

  BEGIN
    SELECT coa.id INTO v_expense_account_id FROM chart_of_accounts coa WHERE coa.category_id = NEW.category_id;
    SELECT coa.id INTO v_cash_account_id FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;
    SELECT id INTO v_advance_account_id FROM chart_of_accounts WHERE account_code = '1080';

    IF NEW.payment_state = 'advance' THEN
      IF v_advance_account_id IS NULL OR v_cash_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post advance: advance account %s, account_id=%s -> cash account %s, amount_etb=%s',
          v_advance_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Vendor advance recorded: ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_advance_account_id, NEW.amount_etb, 0, 'Advance — goods not yet received: ' || COALESCE(NEW.item_service_description, '')),
        (v_entry_id, v_cash_account_id, 0, NEW.amount_etb, 'Paid via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));

    ELSIF v_is_advance_close THEN
      IF v_advance_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot close advance: advance account %s, amount_etb=%s', v_advance_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Vendor advance closed (GRN received): ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      -- Split the expense-side debit across the real categories tagged on
      -- this PO's GRN lines when available, instead of one lump line
      -- against NEW.category_id (which can be the generic "Multiple"
      -- account, or simply wrong for a single-category PO).
      IF NEW.expense_type = 'purchase_order' THEN
        FOR v_split IN SELECT * FROM resolve_po_category_split(NEW.sourcing_bundle_id, NEW.amount_etb) LOOP
          v_used_split := TRUE;
          SELECT coa.id INTO v_cat_account_id FROM chart_of_accounts coa WHERE coa.category_id = v_split.category_id;
          IF v_cat_account_id IS NULL THEN
            v_multiple_leftover := v_multiple_leftover + v_split.amount;
          ELSE
            INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
            VALUES (v_entry_id, v_cat_account_id, v_split.amount, 0, NEW.item_service_description);
          END IF;
        END LOOP;
      END IF;

      IF v_used_split AND v_multiple_leftover <> 0 THEN
        SELECT coa.id INTO v_multiple_account_id FROM chart_of_accounts coa
          JOIN categories c ON c.id = coa.category_id WHERE c.category_name = 'Multiple';
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (v_entry_id, v_multiple_account_id, v_multiple_leftover, 0, NEW.item_service_description);
      END IF;

      IF NOT v_used_split THEN
        IF v_expense_account_id IS NULL THEN
          PERFORM log_posting_failure('expenses', NEW.id, format(
            'Cannot close advance: category_id=%s -> expense account %s', NEW.category_id, v_expense_account_id));
          DELETE FROM journal_entries WHERE id = v_entry_id;
          RETURN NEW;
        END IF;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description);
      END IF;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_advance_account_id, 0, NEW.amount_etb, 'Advance closed — goods received');

    ELSE
      IF v_cash_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post: category_id=%s -> expense account %s, account_id=%s -> cash account %s, amount_etb=%s',
          NEW.category_id, v_expense_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Expense paid: ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      -- Same GRN-based split as the advance-close path above.
      IF NEW.expense_type = 'purchase_order' THEN
        FOR v_split IN SELECT * FROM resolve_po_category_split(NEW.sourcing_bundle_id, NEW.amount_etb) LOOP
          v_used_split := TRUE;
          SELECT coa.id INTO v_cat_account_id FROM chart_of_accounts coa WHERE coa.category_id = v_split.category_id;
          IF v_cat_account_id IS NULL THEN
            v_multiple_leftover := v_multiple_leftover + v_split.amount;
          ELSE
            INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
            VALUES (v_entry_id, v_cat_account_id, v_split.amount, 0, NEW.item_service_description);
          END IF;
        END LOOP;
      END IF;

      IF v_used_split AND v_multiple_leftover <> 0 THEN
        SELECT coa.id INTO v_multiple_account_id FROM chart_of_accounts coa
          JOIN categories c ON c.id = coa.category_id WHERE c.category_name = 'Multiple';
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (v_entry_id, v_multiple_account_id, v_multiple_leftover, 0, NEW.item_service_description);
      END IF;

      IF NOT v_used_split THEN
        IF v_expense_account_id IS NULL THEN
          PERFORM log_posting_failure('expenses', NEW.id, format(
            'Cannot post: category_id=%s -> expense account %s', NEW.category_id, v_expense_account_id));
          DELETE FROM journal_entries WHERE id = v_entry_id;
          RETURN NEW;
        END IF;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description);
      END IF;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_cash_account_id, 0, NEW.amount_etb, 'Paid via ' || (SELECT account_name FROM accounts WHERE id = NEW.account_id));
    END IF;

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('expenses', NEW.id, SQLERRM);
  END;

  RETURN NEW;
END;
$function$;

-- 4. One-time historical correction. Re-splits the expense-side debit
--    line(s) of every already-posted PO expense that has GRN data,
--    replacing whatever was posted before with the correct real-category
--    split. Uses the amount actually posted (not expenses.amount_etb,
--    which can drift from the ledger after the fact) so every corrected
--    entry still balances exactly. Idempotent — re-running recomputes the
--    same values from the same source data.
DO $$
DECLARE
  r RECORD;
  v_split RECORD;
  v_cat_account_id UUID;
  v_multiple_account_id UUID;
  v_multiple_leftover NUMERIC;
  v_posted_total NUMERIC;
BEGIN
  FOR r IN
    SELECT je.id AS je_id, e.id AS expense_id, e.sourcing_bundle_id, e.item_service_description
    FROM journal_entries je
    JOIN expenses e ON e.id = je.source_id AND je.source_table = 'expenses'
    WHERE e.expense_type = 'purchase_order'
      AND e.sourcing_bundle_id IS NOT NULL
      AND (je.description LIKE 'Expense paid:%' OR je.description LIKE 'Vendor advance closed%')
  LOOP
    SELECT COALESCE(SUM(debit), 0) INTO v_posted_total FROM journal_lines WHERE journal_entry_id = r.je_id AND debit > 0;

    IF v_posted_total > 0 AND EXISTS (SELECT 1 FROM resolve_po_category_split(r.sourcing_bundle_id, v_posted_total)) THEN
      DELETE FROM journal_lines WHERE journal_entry_id = r.je_id AND debit > 0;

      v_multiple_leftover := 0;
      FOR v_split IN SELECT * FROM resolve_po_category_split(r.sourcing_bundle_id, v_posted_total) LOOP
        SELECT coa.id INTO v_cat_account_id FROM chart_of_accounts coa WHERE coa.category_id = v_split.category_id;
        IF v_cat_account_id IS NULL THEN
          v_multiple_leftover := v_multiple_leftover + v_split.amount;
        ELSE
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
          VALUES (r.je_id, v_cat_account_id, v_split.amount, 0, r.item_service_description);
        END IF;
      END LOOP;

      IF v_multiple_leftover <> 0 THEN
        SELECT coa.id INTO v_multiple_account_id FROM chart_of_accounts coa
          JOIN categories c ON c.id = coa.category_id WHERE c.category_name = 'Multiple';
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
        VALUES (r.je_id, v_multiple_account_id, v_multiple_leftover, 0, r.item_service_description);
      END IF;
    END IF;
  END LOOP;
END $$;

-- v_sub_ledger_balances: compare against what is actually posted in
-- journal_lines (post-fix, this is N debit lines per PO expense) rather
-- than the single expenses.category_id, which this migration leaves
-- untouched.
DROP VIEW IF EXISTS public.v_sub_ledger_balances;

CREATE VIEW public.v_sub_ledger_balances
WITH (security_invoker = true) AS
WITH grn_lines AS (
  SELECT gn.sourcing_bundle_id, gni.category_id AS real_category_id,
         SUM(COALESCE(gni.quantity_accepted, 0) * COALESCE(sbi.unit_price_actual, 0)) AS line_value
  FROM goods_received_note_items gni
  JOIN goods_received_notes gn  ON gn.id = gni.grn_id
  JOIN sourcing_bundle_items sbi ON sbi.id = gni.sourcing_bundle_item_id
  GROUP BY gn.sourcing_bundle_id, gni.category_id
),
bundle_totals AS (
  SELECT sourcing_bundle_id, SUM(line_value) AS bundle_value FROM grn_lines GROUP BY sourcing_bundle_id
),
posted_expenses AS (
  SELECT je.id AS je_id, e.id AS expense_id, e.sourcing_bundle_id, e.fiscal_period_id,
         (SELECT COALESCE(SUM(jl2.debit), 0) FROM journal_lines jl2 WHERE jl2.journal_entry_id = je.id AND jl2.debit > 0) AS posted_total
  FROM journal_entries je
  JOIN expenses e ON e.id = je.source_id AND je.source_table = 'expenses'
  WHERE e.expense_type = 'purchase_order'
    AND e.sourcing_bundle_id IS NOT NULL
    AND (je.description LIKE 'Expense paid:%' OR je.description LIKE 'Vendor advance closed%')
),
real_alloc AS (
  SELECT pe.expense_id, pe.fiscal_period_id, gl.real_category_id AS category_id,
         CASE WHEN bt.bundle_value > 0 THEN pe.posted_total * (gl.line_value / bt.bundle_value) ELSE 0 END AS amount
  FROM posted_expenses pe
  JOIN bundle_totals bt ON bt.sourcing_bundle_id = pe.sourcing_bundle_id
  JOIN grn_lines gl     ON gl.sourcing_bundle_id = pe.sourcing_bundle_id
),
posted_alloc AS (
  SELECT pe.expense_id, pe.fiscal_period_id, coa.category_id, SUM(jl.debit) AS amount
  FROM posted_expenses pe
  JOIN journal_lines jl ON jl.journal_entry_id = pe.je_id AND jl.debit > 0
  JOIN chart_of_accounts coa ON coa.id = jl.account_id
  GROUP BY pe.expense_id, pe.fiscal_period_id, coa.category_id
),
combined AS (
  SELECT COALESCE(r.expense_id, p.expense_id) AS expense_id,
         COALESCE(r.fiscal_period_id, p.fiscal_period_id) AS fiscal_period_id,
         COALESCE(r.category_id, p.category_id) AS category_id,
         COALESCE(r.amount, 0) AS real_amount,
         COALESCE(p.amount, 0) AS posted_amount
  FROM real_alloc r
  FULL OUTER JOIN posted_alloc p ON p.expense_id = r.expense_id AND p.category_id = r.category_id
)
SELECT
  fiscal_period_id,
  fp.label AS fiscal_period_label,
  category_id AS real_category_id,
  COALESCE(c.category_name, 'Unclassified') AS real_category,
  ROUND(SUM(real_amount), 2) AS amount,
  -- Portion of this category's true (GRN-tagged) amount that is NOT
  -- currently posted under this same category in journal_lines — i.e.
  -- still sitting under some other account.
  ROUND(SUM(GREATEST(real_amount - posted_amount, 0)), 2) AS misclassified_amount,
  COUNT(DISTINCT expense_id) AS entry_count
FROM combined
LEFT JOIN fiscal_periods fp ON fp.id = fiscal_period_id
LEFT JOIN categories c ON c.id = category_id
GROUP BY fiscal_period_id, fp.label, category_id, c.category_name
HAVING ROUND(SUM(real_amount), 2) <> 0;

COMMENT ON VIEW public.v_sub_ledger_balances IS
  'Subsidiary ledger: for each real (GRN-tagged) category, the true amount behind posted PO expenses and how much of it is NOT currently posted under that same category in journal_lines (i.e. still misclassified). Compares against the actual ledger postings, not expenses.category_id. Read-only.';
