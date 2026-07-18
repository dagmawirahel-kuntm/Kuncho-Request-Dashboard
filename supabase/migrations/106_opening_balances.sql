-- ============================================================
-- Opening balance — the one-time bridge from the last ERCA filing
-- into the ledger. Deliberately NOT derived from operational data:
-- FY2025/26 is known to be incomplete for this purpose (VRF, PPE,
-- Loan, CPO/Bonds, and "Multiple" were explicitly excluded from
-- cost-group mapping in migration 072 precisely because they don't
-- map cleanly onto operational rows).
--
-- STATUS AS OF THIS MIGRATION: structure ready, figures not yet
-- entered. opening_balances is created empty and stays empty until a
-- finance person maps real ERCA balance sheet line items to
-- chart_of_accounts rows by hand — that mapping is a human judgment
-- call this migration does not attempt to infer. Do not read an
-- empty table here as a bug; it's the intended state until real
-- figures land. The conversion function below exists and is callable,
-- but calling it against zero rows correctly does nothing useful yet.
--
-- Reconciliation anchor (this part IS real, already-known data, not
-- pending): the CBE backfill (scripts/backfill-cbe-2025h2-transfers.ts)
-- pulled from a source with its own bank-reported running Balance
-- column — never migrated into transfers.amount (correctly: it's a
-- balance, not a movement) but too valuable to discard. Captured here
-- as a proper reference row rather than left as a note-only aside,
-- because it's the real anchor the opening-balance reconciliation
-- check needs: with the backfill plus the existing live import now
-- spanning essentially all of FY2025/26, the check can walk forward
-- from this bank-verified mid-2025 balance through every transfer to
-- the ERCA figure's date, instead of assuming CBE's balance was ₣0 on
-- 1 Dec 2025 (the live import's own start) — which it almost
-- certainly wasn't.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS opening_balances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_of_accounts_id  UUID NOT NULL REFERENCES chart_of_accounts(id),
  amount                NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  side                  TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  source                TEXT NOT NULL, -- e.g. "ERCA Annual Income Tax Return FY2025/26, filed [date], ref [number]"
  entered_by            UUID REFERENCES user_profiles(id),
  entered_at            TIMESTAMPTZ DEFAULT NOW(),
  notes                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_opening_balances_coa ON opening_balances(chart_of_accounts_id);

-- ── Reconciliation anchor: a real, bank-verified reference point ──
CREATE TABLE IF NOT EXISTS bank_balance_anchors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id),
  as_of_date  DATE NOT NULL,
  balance     NUMERIC(14,2) NOT NULL,
  source      TEXT NOT NULL,
  transfer_id UUID REFERENCES transfers(id), -- the specific statement line this balance was reported alongside
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO bank_balance_anchors (account_id, as_of_date, balance, source, transfer_id)
SELECT
  '890c3473-dc57-4c01-9f39-17518047c463', -- CBE, 1000504664272
  '2025-07-07',
  66717.56,
  'CBE statement (Airtable base apphyWTS8wt69LgMI, "Imported table"), Post Date 07 JUL 25 — bank-reported running balance immediately after this transaction. Confirmed as the true earliest transaction (not just earliest by date) by the Balance column''s own arithmetic: this row''s balance minus/plus every subsequent row''s amount lands exactly on that row''s own reported balance, all the way through the backfilled range.',
  t.id
FROM transfers t
WHERE t.transfer_id_code = 'CBE-CR-2025-001-2025-07-07'
  AND NOT EXISTS (SELECT 1 FROM bank_balance_anchors WHERE transfer_id = t.id);

-- ── Conversion: opening_balances -> one balanced journal_entries row.
-- Callable once, refuses to run twice, refuses to silently plug an
-- imbalance, refuses anything other than Asset/Liability/Equity
-- nature (P&L doesn't carry forward — only its net effect, already
-- folded into Retained Earnings by ERCA's own figures, does).
CREATE OR REPLACE FUNCTION convert_opening_balances_to_journal_entry()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy    UUID;
  v_period_start  DATE;
  v_row_count     INT;
  v_bad_nature    INT;
  v_debit_total   NUMERIC;
  v_credit_total  NUMERIC;
  v_entry_id      UUID;
  v_ob            RECORD;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can convert opening balances into a journal entry';
  END IF;

  SELECT count(*) INTO v_row_count FROM opening_balances;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'opening_balances is empty — nothing to convert. Enter the ERCA-sourced figures first.';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE entry_type = 'opening_balance') THEN
    RAISE EXCEPTION 'An opening_balance journal entry already exists — this is a one-time conversion, not repeatable. Reverse it manually first if it genuinely needs redoing.';
  END IF;

  SELECT count(*) INTO v_bad_nature
  FROM opening_balances ob
  JOIN chart_of_accounts coa ON coa.id = ob.chart_of_accounts_id
  WHERE coa.nature NOT IN ('Asset', 'Liability', 'Equity');
  IF v_bad_nature > 0 THEN
    RAISE EXCEPTION '% opening_balances row(s) point at a Revenue/Expense-nature account — only Asset/Liability/Equity belong in an opening balance (P&L does not carry forward)', v_bad_nature;
  END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE side = 'debit'), 0),
    COALESCE(SUM(amount) FILTER (WHERE side = 'credit'), 0)
  INTO v_debit_total, v_credit_total
  FROM opening_balances;

  IF v_debit_total <> v_credit_total THEN
    RAISE EXCEPTION 'ERCA-sourced opening balances do not balance on their own: debits = %, credits = %, difference = %. Surfacing this, not auto-plugging it — resolve the mapping before converting.',
      v_debit_total, v_credit_total, v_debit_total - v_credit_total;
  END IF;

  SELECT id, start_date INTO v_current_fy, v_period_start FROM fiscal_periods WHERE is_current;

  INSERT INTO journal_entries (entry_date, entry_type, description, created_by)
  VALUES (v_period_start, 'opening_balance', 'Opening balance from ERCA filing', auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_ob IN SELECT * FROM opening_balances LOOP
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
    VALUES (
      v_entry_id, v_ob.chart_of_accounts_id,
      CASE WHEN v_ob.side = 'debit' THEN v_ob.amount ELSE 0 END,
      CASE WHEN v_ob.side = 'credit' THEN v_ob.amount ELSE 0 END,
      v_ob.source
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION convert_opening_balances_to_journal_entry() TO authenticated;

-- ── Reconciliation check: anchor + net movement since, vs. whatever
-- opening_balances eventually records for that account's Cash line.
-- Real arithmetic against a real starting point, not a plausibility
-- guess — returns NULL for the ERCA side (and says so) until
-- opening_balances actually has a matching row.
CREATE OR REPLACE VIEW v_cash_reconciliation_check
WITH (security_invoker = true) AS
SELECT
  a.id AS account_id,
  a.account_name,
  ba.as_of_date AS anchor_date,
  ba.balance AS anchor_balance,
  COALESCE(mv.net_movement, 0) AS movement_since_anchor,
  ba.balance + COALESCE(mv.net_movement, 0) AS implied_balance_today,
  ob.amount AS erca_opening_amount,
  ob.side AS erca_opening_side,
  CASE
    WHEN ob.amount IS NULL THEN 'No ERCA opening balance entered yet for this account'
    ELSE ROUND(
      (ba.balance + COALESCE(mv.net_movement, 0))
      - (CASE WHEN ob.side = 'debit' THEN ob.amount ELSE -ob.amount END), 2
    )::text
  END AS gap_vs_erca_figure
FROM bank_balance_anchors ba
JOIN accounts a ON a.id = ba.account_id
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE to_account_id = ba.account_id), 0)
    - COALESCE(SUM(amount) FILTER (WHERE from_account_id = ba.account_id), 0) AS net_movement
  FROM transfers
  WHERE (to_account_id = ba.account_id OR from_account_id = ba.account_id)
    AND date > ba.as_of_date
) mv ON TRUE
LEFT JOIN chart_of_accounts coa ON coa.linked_account_id = ba.account_id
LEFT JOIN opening_balances ob ON ob.chart_of_accounts_id = coa.id;

GRANT SELECT ON v_cash_reconciliation_check TO authenticated;

-- Verify: anchor row present for CBE, conversion function exists,
-- opening_balances is empty as expected, reconciliation view runs
-- (ERCA side will read "not entered yet").
SELECT account_name, as_of_date, balance, source FROM bank_balance_anchors ba
JOIN accounts a ON a.id = ba.account_id;

SELECT count(*) AS opening_balances_rows_expect_zero FROM opening_balances;

SELECT proname FROM pg_proc WHERE proname = 'convert_opening_balances_to_journal_entry';

SELECT account_name, anchor_date, anchor_balance, movement_since_anchor, implied_balance_today, gap_vs_erca_figure
FROM v_cash_reconciliation_check;

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_balance_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opening_balances_read" ON opening_balances;
CREATE POLICY "opening_balances_read" ON opening_balances FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "opening_balances_admin_finance_write" ON opening_balances;
CREATE POLICY "opening_balances_admin_finance_write" ON opening_balances FOR ALL
  USING (get_user_role() IN ('admin', 'finance'));

DROP POLICY IF EXISTS "bank_balance_anchors_read" ON bank_balance_anchors;
CREATE POLICY "bank_balance_anchors_read" ON bank_balance_anchors FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "bank_balance_anchors_admin_finance_write" ON bank_balance_anchors;
CREATE POLICY "bank_balance_anchors_admin_finance_write" ON bank_balance_anchors FOR ALL
  USING (get_user_role() IN ('admin', 'finance'));
