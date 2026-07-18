-- ============================================================
-- Double-entry journal core: journal_entries (one per transaction/
-- event) and journal_lines (its debit/credit legs against
-- chart_of_accounts). The non-negotiable integrity rule: every entry
-- must balance, enforced at the database level, not by application
-- discipline.
--
-- Balance enforcement is a DEFERRED CONSTRAINT TRIGGER on
-- journal_lines, not a plain BEFORE ROW trigger. A real entry has
-- multiple lines (at minimum one debit, one credit) inserted as
-- separate rows — a naive BEFORE-INSERT-per-row check would reject
-- the first line before the second exists, since the entry can't
-- balance until every line is in. Deferring the check to COMMIT (via
-- DEFERRABLE INITIALLY DEFERRED) means every line for an entry can be
-- inserted independently within one transaction, and the entry is
-- validated once, when the transaction actually tries to commit —
-- still an outright rejection of any entry left unbalanced, just
-- checked at the point where "balanced" is actually knowable.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS journal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date       DATE NOT NULL,
  fiscal_period_id UUID REFERENCES fiscal_periods(id),
  entry_type       TEXT NOT NULL CHECK (entry_type IN ('operational', 'opening_balance', 'closing', 'adjusting')),
  source_table     TEXT,
  source_id        UUID,
  description      TEXT,
  created_by       UUID REFERENCES user_profiles(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_fiscal_period ON journal_entries(fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);

-- fiscal_period_id tagging, same trigger shape as every other
-- fiscal-scoped table (migration 088).
CREATE OR REPLACE FUNCTION set_fiscal_period_journal_entries()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.entry_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON journal_entries;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF entry_date ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_journal_entries();

CREATE TABLE IF NOT EXISTS journal_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  notes            TEXT,
  CHECK (NOT (debit > 0 AND credit > 0)) -- a single line is one side or the other, never both
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);

-- ── The integrity rule ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_journal_entry_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id UUID;
  v_diff     NUMERIC;
BEGIN
  v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) INTO v_diff
  FROM journal_lines WHERE journal_entry_id = v_entry_id;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'Journal entry % does not balance: debits exceed credits by %', v_entry_id, v_diff;
  END IF;
  RETURN NULL; -- AFTER trigger; return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_check_journal_entry_balance ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_check_journal_entry_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balance();

-- Verify: both tables + trigger present, empty (nothing posts yet —
-- the auto-posting engine and opening balance conversion are
-- separate, later migrations).
SELECT count(*) AS journal_entries_count FROM journal_entries;
SELECT count(*) AS journal_lines_count FROM journal_lines;
SELECT tgname, tgtype FROM pg_trigger WHERE tgrelid = 'journal_lines'::regclass AND NOT tgisinternal;

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "journal_entries_read" ON journal_entries;
CREATE POLICY "journal_entries_read" ON journal_entries FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "journal_entries_admin_finance_write" ON journal_entries;
CREATE POLICY "journal_entries_admin_finance_write" ON journal_entries FOR ALL
  USING (get_user_role() IN ('admin', 'finance'));

DROP POLICY IF EXISTS "journal_lines_read" ON journal_lines;
CREATE POLICY "journal_lines_read" ON journal_lines FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "journal_lines_admin_finance_write" ON journal_lines;
CREATE POLICY "journal_lines_admin_finance_write" ON journal_lines FOR ALL
  USING (get_user_role() IN ('admin', 'finance'));
