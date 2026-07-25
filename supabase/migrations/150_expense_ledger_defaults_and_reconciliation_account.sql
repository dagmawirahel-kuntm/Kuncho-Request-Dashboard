-- ============================================================
-- Closes the three real gaps behind the standing "Posting Failures"
-- list on Ledger & Journal, all confirmed against live data before
-- writing this (not assumed):
--
--   1. GENERAL LEDGER NOT SET FROM THE NATURE OF THE ENGAGEMENT.
--      Migration 136's auto-creation triggers set expense_type
--      correctly for every gate, but only the maintenance and penalty
--      triggers ever set category_id (both hardcode 'Transportation').
--      The PO/GRN, subcontract, CPO-bond and VRF triggers create the
--      expense with category_id NULL, and the manual "General Ledger"
--      field on ExpenseFormPage is bound to that same column — so an
--      auto-created expense reaches payment_state='paid' with no
--      expense-side account to debit. Live proof: the property_rent
--      expense (1,110,260.87) and a purchase_order expense
--      (43,478.40) both logged 'Cannot post: category_id= -> expense
--      account ,' on 25 Jul 2026.
--
--   2. RECONCILIATION NEVER SET THE CASH ACCOUNT.
--      commit_statement_import (138) knows exactly which bank account
--      the statement belongs to (bank_statement_imports.account_id)
--      and writes it onto the transfers row it creates, but
--      match_expense_to_transfer (099) only sets payment_state and
--      transfer_id — never expenses.account_id, which is the ONLY
--      column post_expense_payment_to_ledger (105) reads to find the
--      Cash-at-Bank credit side. So an expense could be fully
--      reconciled against a real statement line, with a confirmed
--      bank reference, and still fail to post for want of a cash
--      account. Live proof: 'account_id= -> cash account ,' on every
--      failure on record.
--
--   3. AN AMOUNT MISMATCH WAS INVISIBLE.
--      auto_match_statement_import (138) matches purely on
--      reference_code = expenses.bank_ref with no amount comparison at
--      all. A statement line that only partly offsets its expense (or
--      overshoots it) matched silently and looked identical to an
--      exact match. The residual is now computed, stored and shown.
--
-- Guardrails kept from the existing design:
--   • Auto-population only ever FILLS a NULL. A category or account a
--     human chose is never overwritten — the default is a starting
--     point, not an override.
--   • Nothing here is retroactive. No historical expense's category_id
--     or account_id is rewritten (the 705 'general' rows with a null
--     category stay null — 'general' has no engagement to derive
--     from, and guessing is exactly what migration 072 undid).
--   • The variance is recorded and surfaced, never blocking. The bank
--     statement stays ground truth per 138's own framing; finance
--     decides what a residual means.
-- ============================================================

SET search_path TO public;

-- ── 1. Which general ledger each kind of engagement defaults to ──────
-- A real table keyed on the enum, not a hardcoded name lookup like
-- 136's `WHERE category_name = 'Transportation'`. Two reasons that
-- matters here: category_name is free-form and editable from the
-- General Ledger page (one of these, 'Sub Contrcators', is visibly
-- misspelled and will eventually be corrected), and a name lookup that
-- silently returns NULL after a rename reintroduces exactly the
-- posting failure this migration exists to remove. An FK breaks loudly
-- on delete and survives renames.
CREATE TABLE IF NOT EXISTS expense_type_ledger_defaults (
  expense_type  expense_category PRIMARY KEY,
  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE expense_type_ledger_defaults IS
  'Default general ledger (categories row) per expense_type. Applied only when an expense has no category_id of its own.';

-- Seeded by name here (one time, against the categories confirmed to
-- exist right now), but stored and read by id from this point on.
-- 'general' and 'purchase_order' are deliberately absent:
--   • general       — no engagement to derive a ledger from. It's the
--                     catch-all 2,315-row type; a blanket default
--                     would misclassify almost all of it.
--   • purchase_order — the ledger depends on what was actually bought,
--                     so it's derived per-bundle from the line items'
--                     sub-ledgers instead (section 2 below), not from
--                     a fixed default.
INSERT INTO expense_type_ledger_defaults (expense_type, category_id, notes)
SELECT v.expense_type::expense_category, c.id, v.notes
FROM (VALUES
  ('vrf',           'VRF',              'Vendor receipt facilitation settlements'),
  ('cpo_bond',      'CPO',              'CPO bond payments'),
  ('fuel',          'Fuel',             'Vehicle fuel requests'),
  ('maintenance',   'Transportation',   'Fleet maintenance and penalties — matches migration 136''s existing hardcoded choice'),
  ('subcontract',   'Sub Contrcators',  'Subcontractor completion certificates'),
  ('property_rent', 'Property Rent',    'Lease/rent payments against a property')
) AS v(expense_type, category_name, notes)
JOIN categories c ON c.category_name = v.category_name
ON CONFLICT (expense_type) DO NOTHING;

ALTER TABLE expense_type_ledger_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_type_ledger_defaults_read" ON expense_type_ledger_defaults;
CREATE POLICY "expense_type_ledger_defaults_read" ON expense_type_ledger_defaults FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "expense_type_ledger_defaults_write" ON expense_type_ledger_defaults;
CREATE POLICY "expense_type_ledger_defaults_write" ON expense_type_ledger_defaults FOR ALL
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

GRANT SELECT ON expense_type_ledger_defaults TO authenticated;
GRANT INSERT, UPDATE, DELETE ON expense_type_ledger_defaults TO authenticated;

-- ── 2. Resolve the general ledger for a given engagement ─────────────
-- purchase_order is the one type whose ledger is genuinely knowable
-- but not fixed: it's whatever the bundle's line items were classified
-- as. Roll the line items' sub-ledgers up to their parent ledgers —
-- one distinct parent means an unambiguous answer, more than one means
-- a genuinely mixed PO, which the data already has a real ledger for
-- ('Multiple', 73 expenses). Zero classified line items yields NULL
-- rather than a guess.
CREATE OR REPLACE FUNCTION resolve_expense_category(
  p_expense_type       expense_category,
  p_sourcing_bundle_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_category_id UUID;
  v_distinct    INT;
BEGIN
  IF p_expense_type = 'purchase_order' AND p_sourcing_bundle_id IS NOT NULL THEN
    SELECT count(DISTINCT sc.parent_category_id)
    INTO v_distinct
    FROM sourcing_bundle_items sbi
    JOIN order_items oi   ON oi.id = sbi.order_item_id
    JOIN sub_categories sc ON sc.id = oi.sub_category_id
    WHERE sbi.bundle_id = p_sourcing_bundle_id
      AND sc.parent_category_id IS NOT NULL;

    IF v_distinct = 1 THEN
      SELECT DISTINCT sc.parent_category_id
      INTO v_category_id
      FROM sourcing_bundle_items sbi
      JOIN order_items oi   ON oi.id = sbi.order_item_id
      JOIN sub_categories sc ON sc.id = oi.sub_category_id
      WHERE sbi.bundle_id = p_sourcing_bundle_id
        AND sc.parent_category_id IS NOT NULL;
      RETURN v_category_id;
    ELSIF v_distinct > 1 THEN
      SELECT id INTO v_category_id FROM categories WHERE category_name = 'Multiple';
      RETURN v_category_id; -- NULL if that ledger was renamed/removed: still better than a wrong single pick
    END IF;

    RETURN NULL; -- no classified line items — nothing to derive from
  END IF;

  SELECT category_id INTO v_category_id
  FROM expense_type_ledger_defaults WHERE expense_type = p_expense_type;

  RETURN v_category_id;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_expense_category(expense_category, UUID) TO authenticated;

-- ── 3. Apply it on the expense itself ────────────────────────────────
-- BEFORE INSERT OR UPDATE OF expense_type: covers every path at once —
-- the ExpenseFormPage save, all six of migration 136's auto-creation
-- triggers, 141's rent-request trigger, and any future gate — instead
-- of patching each creator separately and missing the next one.
--
-- Strictly fill-only: it fires only when category_id IS NULL, so
-- reclassifying an expense by hand is permanent and re-saving the form
-- can never revert it.
CREATE OR REPLACE FUNCTION apply_default_expense_category()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.category_id IS NULL AND NEW.expense_type IS NOT NULL THEN
    NEW.category_id := resolve_expense_category(NEW.expense_type, NEW.sourcing_bundle_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_default_expense_category ON expenses;
CREATE TRIGGER trg_apply_default_expense_category
  BEFORE INSERT OR UPDATE OF expense_type, sourcing_bundle_id ON expenses
  FOR EACH ROW EXECUTE FUNCTION apply_default_expense_category();

-- ── 4. Reconciliation sets the cash account ──────────────────────────
-- The paying account is already on the transfer: commit_statement_import
-- (138) writes bank_statement_imports.account_id into
-- transfers.from_account_id for every debit line. Reading it back from
-- the transfer — rather than adding a parameter — means the fix applies
-- identically to the statement-import path, the manual "Match to Bank
-- Line" action in the UI, and 139's bank_ref auto-sync, with no
-- signature change to break existing callers.
--
-- COALESCE order matters: an account the expense already carries wins.
-- A transfer BETWEEN two own accounts has both from_ and to_ set; for
-- an expense the money left the company, so from_account_id is the
-- correct side and to_account_id is never substituted for it.
CREATE OR REPLACE FUNCTION match_expense_to_transfer(p_expense_id UUID, p_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_account_id UUID;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match an expense to a bank line';
  END IF;

  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense belongs to a batch payment — match the batch to a bank line instead';
  END IF;

  SELECT from_account_id INTO v_from_account_id FROM transfers WHERE id = p_transfer_id;

  UPDATE expenses
  SET payment_state = 'paid',
      transfer_id   = p_transfer_id,
      account_id    = COALESCE(account_id, v_from_account_id)
  WHERE id = p_expense_id;
END;
$$;

-- Same fill for the other direction (139): an expense whose bank_ref is
-- typed in after the statement was already imported gets linked to the
-- transfer by trigger — it should inherit that transfer's account too.
-- payment_state is still deliberately untouched here, for the reasons
-- 139's own header sets out.
CREATE OR REPLACE FUNCTION auto_sync_expense_bank_ref()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer_id     UUID;
  v_from_account_id UUID;
BEGIN
  IF NEW.bank_ref IS NOT NULL AND NEW.transfer_id IS NULL
     AND (TG_OP = 'INSERT' OR NEW.bank_ref IS DISTINCT FROM OLD.bank_ref) THEN
    SELECT id, from_account_id INTO v_transfer_id, v_from_account_id
    FROM transfers WHERE transfer_id_code = NEW.bank_ref LIMIT 1;
    IF v_transfer_id IS NOT NULL THEN
      NEW.transfer_id := v_transfer_id;
      NEW.account_id  := COALESCE(NEW.account_id, v_from_account_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. Offset / residual on a matched statement line ─────────────────
-- Stored rather than computed on read: the expense's amount_etb can be
-- edited later, and what finance needs on the reconciliation record is
-- what the two sides were WHEN they were matched.
--
-- Sign convention: statement line amount minus expense amount.
--   negative → the bank line only partly offsets the expense (short)
--   positive → the bank line exceeds the expense (over)
--   zero     → exact
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS matched_expense_amount NUMERIC(14,2);
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS variance_amount        NUMERIC(14,2);

COMMENT ON COLUMN bank_statement_lines.variance_amount IS
  'Statement line amount minus the matched expense amount, at match time. Negative = line only partly offsets the expense; positive = line exceeds it; 0 = exact.';

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_variance
  ON bank_statement_lines(import_id) WHERE variance_amount IS NOT NULL AND variance_amount <> 0;

-- Re-match with the residual recorded. Matching still keys on the bare
-- FT-code exactly as before — an amount difference is reported, never a
-- reason to refuse the match, because the reference IS the identity of
-- the payment and a partial settlement is a real thing that happens.
CREATE OR REPLACE FUNCTION auto_match_statement_import(p_import_id UUID)
RETURNS TABLE(matched_count INT, duplicate_count INT, unmatched_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line RECORD;
  v_expense_id     UUID;
  v_expense_amount NUMERIC;
  v_line_amount    NUMERIC;
  v_matched   INT := 0;
  v_duplicate INT := 0;
  v_unmatched INT := 0;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can run statement matching';
  END IF;

  FOR v_line IN SELECT * FROM bank_statement_lines WHERE import_id = p_import_id LOOP
    IF EXISTS (SELECT 1 FROM transfers WHERE transfer_id_code = v_line.reference_code) THEN
      UPDATE bank_statement_lines
      SET match_status = 'duplicate', matched_expense_id = NULL,
          matched_expense_amount = NULL, variance_amount = NULL
      WHERE id = v_line.id;
      v_duplicate := v_duplicate + 1;
      CONTINUE;
    END IF;

    v_expense_id := NULL;
    IF v_line.reference_code IS NOT NULL THEN
      SELECT id, amount_etb INTO v_expense_id, v_expense_amount
      FROM expenses
      WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL
      LIMIT 1;
    END IF;

    IF v_expense_id IS NOT NULL THEN
      -- A payment out of the account is the debit column; fall back to
      -- credit so an inbound line still reports a comparable figure
      -- rather than a variance computed against zero.
      v_line_amount := COALESCE(NULLIF(v_line.debit_amount, 0), v_line.credit_amount, 0);

      UPDATE bank_statement_lines
      SET match_status           = 'matched_expense',
          matched_expense_id     = v_expense_id,
          matched_expense_amount = v_expense_amount,
          variance_amount        = CASE WHEN v_expense_amount IS NULL THEN NULL
                                        ELSE v_line_amount - v_expense_amount END
      WHERE id = v_line.id;
      v_matched := v_matched + 1;
    ELSE
      UPDATE bank_statement_lines
      SET match_status = 'unmatched', matched_expense_id = NULL,
          matched_expense_amount = NULL, variance_amount = NULL
      WHERE id = v_line.id;
      v_unmatched := v_unmatched + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_duplicate, v_unmatched;
END;
$$;

-- ── 6. Re-post an expense the ledger previously couldn't ─────────────
-- The missing half of the Posting Failures screen. Auto-posting (105)
-- fires only on a NEW transition into paid, so correcting the ledger or
-- the cash account afterwards fixed the DATA but left the journal entry
-- permanently absent — the failure row could only ever be dismissed,
-- never actually resolved, and "Mark Resolved" hid a transaction that
-- still wasn't in the books. This re-runs the same posting logic on
-- demand, against the row's current state.
--
-- Deliberately re-uses post_expense_payment_to_ledger by calling the
-- trigger's own conditions in reverse (a no-op UPDATE that re-enters
-- the AFTER UPDATE OF payment_state path) rather than duplicating the
-- posting SQL — one implementation of the rules, not two that can drift.
CREATE OR REPLACE FUNCTION retry_expense_ledger_posting(p_expense_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expense expenses%ROWTYPE;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can retry a ledger posting';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF v_expense.id IS NULL THEN
    RETURN 'Expense no longer exists';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    RETURN 'Already posted';
  END IF;

  IF v_expense.payment_state IS DISTINCT FROM 'paid' THEN
    RETURN 'Not paid — nothing to post';
  END IF;

  IF v_expense.category_id IS NULL THEN
    RETURN 'Still no general ledger set on this expense';
  END IF;
  IF v_expense.account_id IS NULL THEN
    RETURN 'Still no payment account set on this expense';
  END IF;

  -- Re-enter the trigger: setting payment_state to itself is not a
  -- DISTINCT change, so drop out of 'paid' and back within the same
  -- statement-pair. Both writes are inside this function's transaction,
  -- so no other session ever observes the intermediate state.
  --
  -- Checked before relying on this: nothing else keyed on payment_state
  -- misfires on the round trip. 098's lifecycle gate re-runs the same
  -- finance_approved_by/disbursed_by checks the row already passed to
  -- reach 'paid', and 141's rent sync only acts on a transition INTO
  -- 'paid' (and is idempotent). 098 does, however, stamp
  -- payment_state_changed_at := NOW() on every state change — which
  -- would silently backdate the real payment to today and drag the row
  -- into v_recent_payments' 7-day window (137). So it's captured and
  -- put back verbatim afterwards; the retry must leave no trace beyond
  -- the journal entry it creates.
  UPDATE expenses SET payment_state = 'sent' WHERE id = p_expense_id;
  UPDATE expenses SET payment_state = 'paid' WHERE id = p_expense_id;
  UPDATE expenses SET payment_state_changed_at = v_expense.payment_state_changed_at
  WHERE id = p_expense_id;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    UPDATE ledger_posting_failures
    SET resolved = TRUE, resolved_at = NOW(), resolved_by = auth.uid()
    WHERE source_table = 'expenses' AND source_id = p_expense_id AND NOT resolved;
    RETURN 'Posted';
  END IF;

  RETURN 'Still could not post — see the newest failure message for this expense';
END;
$$;

GRANT EXECUTE ON FUNCTION retry_expense_ledger_posting(UUID) TO authenticated;

-- ── Verify ───────────────────────────────────────────────────────────
-- Defaults seeded, one row per purpose-built engagement type.
SELECT d.expense_type, c.category_name
FROM expense_type_ledger_defaults d JOIN categories c ON c.id = d.category_id
ORDER BY d.expense_type;

-- Every trigger/function this migration owns is in place.
SELECT tgname FROM pg_trigger
WHERE tgname IN ('trg_apply_default_expense_category', 'trg_auto_sync_expense_bank_ref')
ORDER BY tgname;

SELECT proname FROM pg_proc
WHERE proname IN ('resolve_expense_category', 'apply_default_expense_category',
                  'match_expense_to_transfer', 'auto_sync_expense_bank_ref',
                  'auto_match_statement_import', 'retry_expense_ledger_posting')
ORDER BY proname;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'bank_statement_lines' AND column_name IN ('matched_expense_amount', 'variance_amount')
ORDER BY column_name;

-- Nothing retroactive: historical rows keep the category/account they had.
SELECT expense_type, count(*) FILTER (WHERE category_id IS NULL) AS still_null_category
FROM expenses GROUP BY expense_type ORDER BY expense_type;
