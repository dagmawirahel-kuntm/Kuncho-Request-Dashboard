-- ============================================================
-- Bank statement upload + reconciliation. The transfers table stays
-- the single source of truth for "what actually happened in the bank
-- account" (per the user's original framing) — this migration adds
-- the missing front door: a place to land a parsed statement file
-- before it becomes real transfers rows, auto-match it against
-- expenses that already recorded the reference they expected
-- (expenses.bank_ref, populated since migration 014), and flag
-- anything that doesn't reconcile in either direction.
--
-- Confirmed real state: expenses.bank_ref already exists and is
-- populated for ~1035 historical CBE rows (migration 014) with the
-- bare FT-code (no bank suffix) — e.g. bank_ref = 'FT261296CHVL' for
-- an expense whose real statement line reads
-- "...,FT261296CHVL\BAR". Verified directly against a real CBE CSV
-- export the user provided: dozens of rows match bank_ref values
-- exactly once the trailing "\XXX" suffix is stripped. That's the
-- join key this migration's auto-match uses — not a guess.
--
-- Statement lines are kept permanently in bank_statement_lines (not
-- deleted after commit) — that's what makes "flag anything not
-- reconciled" a standing, queryable fact rather than a one-time
-- report that evaporates after import.
-- ============================================================

SET search_path TO public;

-- ── 1. Import batches ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_statement_imports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id),
  file_name         TEXT,
  period_start      DATE,
  period_end        DATE,
  starting_balance  NUMERIC(14,2),
  ending_balance    NUMERIC(14,2),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'committed')),
  uploaded_by       UUID REFERENCES user_profiles(id),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at      TIMESTAMPTZ,
  notes             TEXT
);

-- ── 2. Parsed lines ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id         UUID NOT NULL REFERENCES bank_statement_imports(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL,
  value_date        DATE,
  post_date         DATE,
  transaction_type  TEXT,
  narration         TEXT,
  debit_amount      NUMERIC(14,2),
  credit_amount     NUMERIC(14,2),
  running_balance   NUMERIC(14,2),
  reference         TEXT,
  -- The bare FT-code with any trailing "\XXX" branch suffix removed —
  -- this is what actually matches expenses.bank_ref (populated the
  -- same bare way by migration 014). Stored (not computed on the fly)
  -- so it's indexable and so historical lines keep their match key
  -- even if the stripping rule is ever refined later.
  reference_code    TEXT,
  matched_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  transfer_id       UUID REFERENCES transfers(id) ON DELETE SET NULL,
  match_status      TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched_expense', 'duplicate', 'manual')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_import ON bank_statement_lines(import_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_reference_code ON bank_statement_lines(reference_code) WHERE reference_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_match_status ON bank_statement_lines(match_status);

ALTER TABLE bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_statement_imports_all" ON bank_statement_imports;
CREATE POLICY "bank_statement_imports_all" ON bank_statement_imports FOR ALL
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

DROP POLICY IF EXISTS "bank_statement_lines_all" ON bank_statement_lines;
CREATE POLICY "bank_statement_lines_all" ON bank_statement_lines FOR ALL
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statement_imports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statement_lines TO authenticated;

-- ── 3. Auto-match — pure matching, writes only to bank_statement_lines.
-- No transfers or expenses are touched here; that only happens on
-- commit. Safe to re-run on the same import (idempotent).
CREATE OR REPLACE FUNCTION auto_match_statement_import(p_import_id UUID)
RETURNS TABLE(matched_count INT, duplicate_count INT, unmatched_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line RECORD;
  v_expense_id UUID;
  v_matched INT := 0;
  v_duplicate INT := 0;
  v_unmatched INT := 0;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can run statement matching';
  END IF;

  FOR v_line IN SELECT * FROM bank_statement_lines WHERE import_id = p_import_id LOOP
    -- Already-imported line (same reference already landed in transfers
    -- from a prior import) — flag as a duplicate, don't re-match.
    IF EXISTS (SELECT 1 FROM transfers WHERE transfer_id_code = v_line.reference_code) THEN
      UPDATE bank_statement_lines SET match_status = 'duplicate', matched_expense_id = NULL
      WHERE id = v_line.id;
      v_duplicate := v_duplicate + 1;
      CONTINUE;
    END IF;

    v_expense_id := NULL;
    IF v_line.reference_code IS NOT NULL THEN
      SELECT id INTO v_expense_id FROM expenses
      WHERE bank_ref = v_line.reference_code AND transfer_id IS NULL
      LIMIT 1;
    END IF;

    IF v_expense_id IS NOT NULL THEN
      UPDATE bank_statement_lines SET match_status = 'matched_expense', matched_expense_id = v_expense_id
      WHERE id = v_line.id;
      v_matched := v_matched + 1;
    ELSE
      UPDATE bank_statement_lines SET match_status = 'unmatched', matched_expense_id = NULL
      WHERE id = v_line.id;
      v_unmatched := v_unmatched + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_duplicate, v_unmatched;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_match_statement_import(UUID) TO authenticated;

-- ── 4. Commit — every line becomes a real transfers row (the bank
-- statement is ground truth: the money moved whether or not the
-- system already knew why), matched lines also link + pay their
-- expense. Duplicate lines are skipped entirely (already represented
-- by an earlier import's transfer row).
CREATE OR REPLACE FUNCTION commit_statement_import(p_import_id UUID)
RETURNS TABLE(transfers_created INT, expenses_matched INT, flagged_unmatched INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_import bank_statement_imports%ROWTYPE;
  v_line RECORD;
  v_transfer_id UUID;
  v_created INT := 0;
  v_matched INT := 0;
  v_flagged INT := 0;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can commit a statement import';
  END IF;

  SELECT * INTO v_import FROM bank_statement_imports WHERE id = p_import_id;
  IF v_import.id IS NULL THEN
    RAISE EXCEPTION 'Import not found';
  END IF;
  IF v_import.status = 'committed' THEN
    RAISE EXCEPTION 'This import has already been committed';
  END IF;

  FOR v_line IN SELECT * FROM bank_statement_lines WHERE import_id = p_import_id AND match_status <> 'duplicate' LOOP
    INSERT INTO transfers (transfer_id_code, date, from_account_id, to_account_id, amount, notes)
    VALUES (
      v_line.reference_code,
      COALESCE(v_line.value_date, v_line.post_date),
      CASE WHEN v_line.debit_amount IS NOT NULL AND v_line.debit_amount > 0 THEN v_import.account_id END,
      CASE WHEN v_line.credit_amount IS NOT NULL AND v_line.credit_amount > 0 THEN v_import.account_id END,
      COALESCE(v_line.debit_amount, v_line.credit_amount, 0),
      COALESCE(v_line.narration, '') || ' (ref: ' || COALESCE(v_line.reference, '') || ')'
    ) RETURNING id INTO v_transfer_id;

    v_created := v_created + 1;

    IF v_line.match_status = 'matched_expense' AND v_line.matched_expense_id IS NOT NULL THEN
      PERFORM match_expense_to_transfer(v_line.matched_expense_id, v_transfer_id);
      v_matched := v_matched + 1;
    ELSE
      v_flagged := v_flagged + 1;
    END IF;

    UPDATE bank_statement_lines SET transfer_id = v_transfer_id WHERE id = v_line.id;
  END LOOP;

  UPDATE bank_statement_imports SET status = 'committed', committed_at = NOW() WHERE id = p_import_id;

  RETURN QUERY SELECT v_created, v_matched, v_flagged;
END;
$$;

GRANT EXECUTE ON FUNCTION commit_statement_import(UUID) TO authenticated;

-- Verify
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('bank_statement_imports', 'bank_statement_lines') AND table_schema = 'public'
ORDER BY table_name;

SELECT proname FROM pg_proc
WHERE proname IN ('auto_match_statement_import', 'commit_statement_import')
ORDER BY proname;
