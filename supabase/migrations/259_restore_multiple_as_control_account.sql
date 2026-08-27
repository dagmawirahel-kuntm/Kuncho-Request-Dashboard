-- 259 — Restore "Multiple" as a real control account; sub-ledger is the detail
--
-- 258 fixed PO expense misclassification by splitting the posted debit into
-- one line PER real GRN category — which correctly fixed the numbers, but
-- also eliminated "Multiple" as a distinct control account: a genuinely
-- multi-category PO no longer had a single line anyone could point to in
-- the Trial Balance / Journal Entries. That's not what was asked for: the
-- intent was the classic control-account pattern — the main ledger keeps
-- ONE line (the real category if the PO is genuinely single-category, or
-- the "Multiple" control account if it genuinely spans several), and the
-- Sub Ledgers view (v_sub_ledger_balances, from 257/258) is the subsidiary
-- ledger that explains what's actually inside "Multiple".
--
-- This migration:
--   1. Adds resolve_po_posting_category(): resolves the SINGLE GL category
--      a PO expense should post to, from its GRN-line categories — the
--      real category when genuinely single-category (this is what
--      corrects true misclassifications like Gypsum posted as Steel), or
--      the "Multiple" control account when it genuinely spans more than
--      one. Returns NULL with no GRN data yet, so callers fall back to the
--      PR-time category — unchanged from the very original behavior.
--   2. Rewrites post_expense_payment_to_ledger() back to posting exactly
--      ONE expense-side debit line per entry (as it always did), just
--      resolving which account via resolve_po_posting_category() instead
--      of the PR-time-only resolve_expense_category(). retry_expense_ledger_posting()
--      re-enters this same trigger, so it picks up the change automatically.
--   3. Re-collapses the entries 258 split into multiple debit lines: for
--      every PO expense journal entry currently posted as more than one
--      expense-side debit line, replaces them with a single line to
--      resolve_po_posting_category()'s answer (the real category if
--      genuinely single, "Multiple" if genuinely multi) for the same total
--      already posted. Genuinely single-category corrections from 258 are
--      untouched (they were already a single line to the correct account).
--   4. Redefines v_sub_ledger_balances to distinguish the two situations
--      that can make a real category's amount not equal its own posted
--      line: expected consolidation into the "Multiple" control account
--      (in_multiple_control — not an error) vs. a genuine anomaly, posted
--      to neither its own category nor Multiple (misclassified_amount —
--      a real problem worth flagging; verified 0 across the board after
--      this migration).

-- 1. Single-category resolver.
CREATE OR REPLACE FUNCTION public.resolve_po_posting_category(p_sourcing_bundle_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_distinct INT;
  v_category_id UUID;
  v_bundle_value NUMERIC;
BEGIN
  IF p_sourcing_bundle_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(gni.quantity_accepted * sbi.unit_price_actual), 0)
  INTO v_bundle_value
  FROM goods_received_note_items gni
  JOIN goods_received_notes gn ON gn.id = gni.grn_id
  JOIN sourcing_bundle_items sbi ON sbi.id = gni.sourcing_bundle_item_id
  WHERE gn.sourcing_bundle_id = p_sourcing_bundle_id;

  -- No GRN lines recorded yet — nothing to resolve from. Caller falls back
  -- to the PR-time category (resolve_expense_category / NEW.category_id).
  IF v_bundle_value IS NULL OR v_bundle_value = 0 THEN
    RETURN NULL;
  END IF;

  SELECT count(DISTINCT gni.category_id) INTO v_distinct
  FROM goods_received_note_items gni
  JOIN goods_received_notes gn ON gn.id = gni.grn_id
  WHERE gn.sourcing_bundle_id = p_sourcing_bundle_id;

  IF v_distinct = 1 THEN
    -- A genuinely single-category PO: post straight to the real category,
    -- correcting any PR-time misclassification.
    SELECT DISTINCT gni.category_id INTO v_category_id
    FROM goods_received_note_items gni
    JOIN goods_received_notes gn ON gn.id = gni.grn_id
    WHERE gn.sourcing_bundle_id = p_sourcing_bundle_id;
    RETURN v_category_id;
  ELSE
    -- Genuinely multi-category: collapse to the "Multiple" control
    -- account, same as always — the Sub Ledgers view (v_sub_ledger_balances)
    -- is the subsidiary ledger that explains what's really inside it.
    SELECT id INTO v_category_id FROM categories WHERE category_name = 'Multiple';
    RETURN v_category_id;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.resolve_po_posting_category IS
  'Resolves the single GL category a purchase-order expense should post to, using GRN-line categories (goods_received_note_items.category_id) instead of the PR-time sub_category guess: the real category when the PO is genuinely single-category, or the "Multiple" control account when it genuinely spans more than one. Returns NULL when the bundle has no GRN lines yet, so callers fall back to the PR-time category.';

-- 2. Posting trigger: back to a single expense-side debit line, resolved
--    via GRN data when available.
CREATE OR REPLACE FUNCTION public.post_expense_payment_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fy UUID;
  v_row_fy     UUID;
  v_effective_category_id UUID;
  v_expense_account_id UUID;
  v_cash_account_id    UUID;
  v_advance_account_id UUID;
  v_entry_id   UUID;
  v_is_advance_close BOOLEAN;
  v_existing_count INT;
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

  -- Resolve the real GL category from GRN-line categories when this is a
  -- purchase_order expense with GRN data recorded (single real category ->
  -- that category, corrects PR-time misclassification; genuinely
  -- multi-category -> the "Multiple" control account, unchanged from
  -- before — the Sub Ledgers view is the subsidiary ledger behind it).
  -- Falls back to the PR-time category when there's no GRN data yet.
  v_effective_category_id := NEW.category_id;
  IF NEW.expense_type = 'purchase_order' THEN
    v_effective_category_id := COALESCE(resolve_po_posting_category(NEW.sourcing_bundle_id), NEW.category_id);
  END IF;

  BEGIN
    SELECT coa.id INTO v_expense_account_id FROM chart_of_accounts coa WHERE coa.category_id = v_effective_category_id;
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
      IF v_expense_account_id IS NULL OR v_advance_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot close advance: category_id=%s -> expense account %s, advance account %s, amount_etb=%s',
          v_effective_category_id, v_expense_account_id, v_advance_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Vendor advance closed (GRN received): ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description),
        (v_entry_id, v_advance_account_id, 0, NEW.amount_etb, 'Advance closed — goods received');

    ELSE
      IF v_expense_account_id IS NULL OR v_cash_account_id IS NULL OR NEW.amount_etb IS NULL THEN
        PERFORM log_posting_failure('expenses', NEW.id, format(
          'Cannot post: category_id=%s -> expense account %s, account_id=%s -> cash account %s, amount_etb=%s',
          v_effective_category_id, v_expense_account_id, NEW.account_id, v_cash_account_id, NEW.amount_etb));
        RETURN NEW;
      END IF;

      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description)
      VALUES (NEW.date, 'operational', 'expenses', NEW.id, 'Expense paid: ' || COALESCE(NEW.expense_code, NEW.id::text))
      RETURNING id INTO v_entry_id;

      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry_id, v_expense_account_id, NEW.amount_etb, 0, NEW.item_service_description),
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

-- 3. Re-collapse the entries 258 split into multiple debit lines back into
--    one control-account (or corrected single-category) line. Idempotent —
--    entries already down to a single line are left untouched.
DO $$
DECLARE
  r RECORD;
  v_effective_category UUID;
  v_account_id UUID;
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
    IF (SELECT count(*) FROM journal_lines WHERE journal_entry_id = r.je_id AND debit > 0) > 1 THEN
      SELECT COALESCE(SUM(debit), 0) INTO v_posted_total FROM journal_lines WHERE journal_entry_id = r.je_id AND debit > 0;
      v_effective_category := resolve_po_posting_category(r.sourcing_bundle_id);
      IF v_effective_category IS NOT NULL THEN
        SELECT coa.id INTO v_account_id FROM chart_of_accounts coa WHERE coa.category_id = v_effective_category;
        IF v_account_id IS NOT NULL THEN
          DELETE FROM journal_lines WHERE journal_entry_id = r.je_id AND debit > 0;
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
          VALUES (r.je_id, v_account_id, v_posted_total, 0, r.item_service_description);
        END IF;
      END IF;
    END IF;
  END LOOP;
END $$;

-- 4. v_sub_ledger_balances: distinguish expected consolidation into the
--    Multiple control account from a genuine posting anomaly.
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
multiple_cat AS (SELECT id FROM categories WHERE category_name = 'Multiple'),
expense_multiple_amount AS (
  SELECT pa.expense_id, pa.amount AS multiple_amount
  FROM posted_alloc pa, multiple_cat mc
  WHERE pa.category_id = mc.id
),
combined AS (
  SELECT COALESCE(r.expense_id, p.expense_id) AS expense_id,
         COALESCE(r.fiscal_period_id, p.fiscal_period_id) AS fiscal_period_id,
         COALESCE(r.category_id, p.category_id) AS category_id,
         COALESCE(r.amount, 0) AS real_amount,
         COALESCE(p.amount, 0) AS own_posted_amount
  FROM real_alloc r
  FULL OUTER JOIN posted_alloc p ON p.expense_id = r.expense_id AND p.category_id = r.category_id
),
combined2 AS (
  SELECT c.*, (ema.multiple_amount IS NOT NULL) AS is_multiple_posting
  FROM combined c
  LEFT JOIN expense_multiple_amount ema ON ema.expense_id = c.expense_id
)
SELECT
  fiscal_period_id,
  fp.label AS fiscal_period_label,
  category_id AS real_category_id,
  COALESCE(cat.category_name, 'Unclassified') AS real_category,
  ROUND(SUM(real_amount), 2) AS amount,
  -- Expected/normal: this category's true amount is currently consolidated
  -- into the "Multiple" control account (not an error — that IS the
  -- control-account design; the breakdown here is the subsidiary detail).
  ROUND(SUM(CASE WHEN is_multiple_posting THEN GREATEST(real_amount - own_posted_amount, 0) ELSE 0 END), 2) AS in_multiple_control,
  -- Genuine anomaly: posted to neither its own real category NOR the
  -- Multiple control account — i.e. actually wrong, not just consolidated.
  ROUND(SUM(CASE WHEN NOT is_multiple_posting THEN GREATEST(real_amount - own_posted_amount, 0) ELSE 0 END), 2) AS misclassified_amount,
  COUNT(DISTINCT expense_id) AS entry_count
FROM combined2
LEFT JOIN fiscal_periods fp ON fp.id = fiscal_period_id
LEFT JOIN categories cat ON cat.id = category_id
GROUP BY fiscal_period_id, fp.label, category_id, cat.category_name
HAVING ROUND(SUM(real_amount), 2) <> 0;

COMMENT ON VIEW public.v_sub_ledger_balances IS
  'Subsidiary ledger behind the "Multiple" GL control account: for each real (GRN-tagged) category, the true amount, how much of it is (expectedly) consolidated in the Multiple control account, and how much is genuinely posted to neither its own category nor Multiple (a real anomaly). Compares against actual journal_lines postings, not expenses.category_id. Read-only.';
