-- ============================================================
-- Account reconciliation (#8), built on the bank-anchor system
-- (130/131/134/150) rather than beside it.
--
-- A reconciliation records a real bank-statement balance at a date. It
-- becomes a new anchor, so v_account_balances computes forward from the
-- reconciled figure automatically — no parallel balance path. What the
-- account then shows:
--   * reconciled balance     — the last statement balance (the anchor)
--   * unreconciled movement  — system activity since that statement,
--                              i.e. current balance minus reconciled
--   * last reconciled        — the statement date
--   * variance (at recon time) — how far the system was off the
--                              statement when it was reconciled
--
-- Determinism guard: a reconciliation's statement_date must be STRICTLY
-- LATER than the account's latest existing anchor. v_account_balances
-- picks the latest anchor per account (DISTINCT ON, as_of_date DESC)
-- with no tiebreak, so allowing an equal/earlier date could make the
-- reconciled base ambiguous or silently shadow a fiscal-year anchor.
-- Forcing strictly-later keeps "latest anchor = latest reconciliation"
-- true and unambiguous, and matches how bank statements actually arrive
-- (each dated after the last). Nothing here runs until a user
-- reconciles, so existing balances (CBE at 701,061.63) are untouched.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  statement_date         DATE NOT NULL,
  statement_balance      NUMERIC(14,2) NOT NULL,
  system_balance_at_date NUMERIC(14,2) NOT NULL,  -- snapshot of what the app computed for that date
  variance               NUMERIC(14,2) NOT NULL,  -- statement - system: how far off the app was
  statement_url          TEXT,
  statement_name         TEXT,
  note                   TEXT,
  reconciled_by          UUID REFERENCES user_profiles(id),
  reconciled_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_account ON bank_reconciliations(account_id, statement_date DESC);

ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bank_reconciliations_read" ON bank_reconciliations;
CREATE POLICY "bank_reconciliations_read" ON bank_reconciliations FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "bank_reconciliations_write" ON bank_reconciliations;
CREATE POLICY "bank_reconciliations_write" ON bank_reconciliations FOR ALL
  USING (get_user_role() IN ('admin', 'finance')) WITH CHECK (get_user_role() IN ('admin', 'finance'));
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_reconciliations TO authenticated;

-- ── Perform a reconciliation ────────────────────────────────────────
CREATE OR REPLACE FUNCTION reconcile_account(
  p_account_id UUID, p_statement_date DATE, p_statement_balance NUMERIC,
  p_statement_url TEXT DEFAULT NULL, p_statement_name TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_latest_anchor DATE;
  v_system_bal    NUMERIC;
  v_variance      NUMERIC;
  v_recon_id      UUID;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile an account';
  END IF;

  SELECT max(as_of_date) INTO v_latest_anchor FROM bank_balance_anchors WHERE account_id = p_account_id;
  IF v_latest_anchor IS NOT NULL AND p_statement_date <= v_latest_anchor THEN
    RAISE EXCEPTION 'Statement date % must be later than the last reconciliation/anchor (%). Reconcile a more recent statement.',
      p_statement_date, v_latest_anchor;
  END IF;

  -- What the app thinks the balance was on the statement date, BEFORE
  -- this reconciliation moves the anchor.
  SELECT balance INTO v_system_bal FROM account_balances_asof(p_statement_date) WHERE id = p_account_id;
  v_system_bal := COALESCE(v_system_bal, 0);
  v_variance   := p_statement_balance - v_system_bal;

  INSERT INTO bank_reconciliations (account_id, statement_date, statement_balance, system_balance_at_date, variance, statement_url, statement_name, note, reconciled_by)
  VALUES (p_account_id, p_statement_date, p_statement_balance, v_system_bal, v_variance, p_statement_url, p_statement_name, p_note, auth.uid())
  RETURNING id INTO v_recon_id;

  -- Adopt the statement balance as the new anchor: the app now computes
  -- forward from the reconciled figure.
  INSERT INTO bank_balance_anchors (account_id, as_of_date, balance, source, transfer_id)
  VALUES (p_account_id, p_statement_date, p_statement_balance,
          'Bank reconciliation ' || p_statement_date::text || COALESCE(' — ' || p_note, ''), NULL);

  RETURN v_recon_id;
END;
$$;
GRANT EXECUTE ON FUNCTION reconcile_account(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- ── Per-account reconciliation status ───────────────────────────────
-- reconciled balance vs live balance vs the gap since, plus how stale
-- the last reconciliation is. unreconciled_movement is exactly the
-- activity the account has seen since the last statement.
CREATE OR REPLACE VIEW v_account_reconciliation_status
WITH (security_invoker = true) AS
SELECT
  a.id AS account_id, a.account_name, a.type, a.status,
  ab.balance                              AS current_balance,
  r.statement_date                        AS last_reconciled_date,
  r.statement_balance                     AS reconciled_balance,
  r.variance                              AS last_variance,
  CASE WHEN r.statement_date IS NOT NULL
    THEN ROUND(ab.balance - r.statement_balance, 2) END AS unreconciled_movement,
  CASE WHEN r.statement_date IS NOT NULL
    THEN (CURRENT_DATE - r.statement_date) END          AS days_since_reconciled
FROM accounts a
LEFT JOIN v_account_balances ab ON ab.id = a.id
LEFT JOIN LATERAL (
  SELECT statement_date, statement_balance, variance
  FROM bank_reconciliations br WHERE br.account_id = a.id
  ORDER BY statement_date DESC LIMIT 1
) r ON TRUE
WHERE a.status <> 'inactive';

GRANT SELECT ON v_account_reconciliation_status TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT proname FROM pg_proc WHERE proname='reconcile_account';
SELECT count(*) AS recon_table FROM information_schema.tables WHERE table_name='bank_reconciliations';
-- CBE unchanged (no reconciliation entered yet): current 701,061.63,
-- reconciled/unreconciled null until first reconcile.
SELECT account_name, current_balance, last_reconciled_date, unreconciled_movement
FROM v_account_reconciliation_status WHERE account_name='Commercial Bank of Ethiopia';
