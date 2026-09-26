-- 351 — Reconciliation controls: history, undo with a reason, alerts
--
-- 1. bank_line_events — who matched or explained a line, to what, when, and
--    whether the automatic pass did it; who undid it and why. Written by a
--    trigger on the bank line, so every path (the queue, the automatic pass,
--    rules, internal pairing) is covered.
-- 2. unmatch_bank_line(line, reason) — one way to undo any reconciliation.
--    Undoing a match only unlinks the bank line: the payment stays paid and
--    its ledger entry stays, and it shows under "paid without a bank line"
--    until it is matched to the right line. An explanation (bank charge,
--    internal transfer…) is undone with its ledger entry, as before.
-- 3. v_bank_alerts — what finance should look at today: money sitting in a
--    collection bank, a stale CBE statement, CBE running short in the next
--    week, old or large lines nobody has explained, payments sent that the
--    bank should show by now, and possible double payments.

SET search_path TO public;

-- ── 1. History ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_line_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id      uuid NOT NULL REFERENCES bank_statement_lines(id) ON DELETE CASCADE,
  account_id   uuid REFERENCES accounts(id) ON DELETE CASCADE,
  action       text NOT NULL CHECK (action IN ('matched', 'explained', 'unmatched')),
  kind         text,
  target_label text,
  auto         boolean NOT NULL DEFAULT false,
  note         text,
  actor        uuid DEFAULT auth.uid(),
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_line_events_line_idx ON bank_line_events (line_id, at DESC);
CREATE INDEX IF NOT EXISTS bank_line_events_at_idx ON bank_line_events (at DESC);
ALTER TABLE bank_line_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_line_events_read ON bank_line_events;
CREATE POLICY bank_line_events_read ON bank_line_events FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]));
REVOKE ALL ON bank_line_events FROM anon;
GRANT SELECT ON bank_line_events TO authenticated;

-- What a line is reconciled to, in words.
CREATE OR REPLACE FUNCTION bank_line_target_label(s v_bank_line_status) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE s.reconciled_as
    WHEN 'batch'    THEN s.batch ->> 'label'
    WHEN 'expense'  THEN (SELECT string_agg(x ->> 'label', ', ') FROM jsonb_array_elements(s.expenses) x)
    WHEN 'sale'     THEN (SELECT string_agg(x ->> 'label', ', ') FROM jsonb_array_elements(s.sales) x)
    WHEN 'payroll'  THEN s.payroll ->> 'label'
    WHEN 'vrf'      THEN s.vrf ->> 'label'
    WHEN 'internal' THEN 'Transfer ' || CASE WHEN s.direction = 'debit' THEN 'to ' ELSE 'from ' END || COALESCE(s.internal ->> 'account_name', 'another account')
    WHEN 'classified' THEN initcap(replace(s.classification, '_', ' '))
    ELSE s.reconciled_as END
$$;

CREATE OR REPLACE FUNCTION log_bank_line_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s v_bank_line_status; v_auto boolean; v_note text;
BEGIN
  IF COALESCE(current_setting('kuncho.bank_event_logged', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.match_status IS NOT DISTINCT FROM OLD.match_status
     AND NEW.classification IS NOT DISTINCT FROM OLD.classification
     AND NEW.matched_payroll_id IS NOT DISTINCT FROM OLD.matched_payroll_id THEN
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM v_bank_line_status WHERE line_id = NEW.id;
  v_auto := COALESCE(current_setting('kuncho.bank_auto', true), '') = 'on';
  v_note := NULLIF(current_setting('kuncho.bank_note', true), '');
  IF s.reconciled_as IS NOT NULL THEN
    INSERT INTO bank_line_events (line_id, account_id, action, kind, target_label, auto, note)
    VALUES (NEW.id, NEW.account_id,
      CASE WHEN s.reconciled_as IN ('classified', 'internal') THEN 'explained' ELSE 'matched' END,
      s.reconciled_as, bank_line_target_label(s), v_auto, COALESCE(v_note, NEW.classification_note));
  ELSIF OLD.match_status IS DISTINCT FROM 'unmatched' OR OLD.classification IS NOT NULL OR OLD.matched_payroll_id IS NOT NULL THEN
    INSERT INTO bank_line_events (line_id, account_id, action, kind, target_label, auto, note)
    VALUES (NEW.id, NEW.account_id, 'unmatched',
      CASE WHEN OLD.classification = 'internal_transfer' THEN 'internal' WHEN OLD.classification IS NOT NULL THEN 'classified' END,
      CASE WHEN OLD.classification IS NOT NULL THEN initcap(replace(OLD.classification, '_', ' ')) END,
      v_auto, v_note);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_log_bank_line_event ON bank_statement_lines;
CREATE TRIGGER trg_log_bank_line_event AFTER UPDATE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION log_bank_line_event();

-- The automatic pass marks what it does. The pass itself is unchanged; it is
-- renamed and called through a wrapper that sets the flag.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_reconcile_bank_lines_pass') THEN
    ALTER FUNCTION auto_reconcile_bank_lines(uuid, uuid) RENAME TO auto_reconcile_bank_lines_pass;
  END IF;
END $$;
REVOKE ALL ON FUNCTION auto_reconcile_bank_lines_pass(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION auto_reconcile_bank_lines(p_import_id uuid DEFAULT NULL, p_account_id uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_done int;
BEGIN
  PERFORM set_config('kuncho.bank_auto', 'on', true);
  v_done := auto_reconcile_bank_lines_pass(p_import_id, p_account_id);
  PERFORM set_config('kuncho.bank_auto', 'off', true);
  RETURN v_done;
END $$;
REVOKE ALL ON FUNCTION auto_reconcile_bank_lines(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auto_reconcile_bank_lines(uuid, uuid) TO authenticated;

-- A line someone undid by hand is not matched again by the automatic pass
-- (each of its steps leaves a line alone when this raises).
CREATE OR REPLACE FUNCTION bank_line_guard(p_line_id uuid, p_allow_reconciled boolean DEFAULT false)
RETURNS v_bank_line_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT * INTO l FROM v_bank_line_status WHERE line_id = p_line_id;
  IF l.line_id IS NULL THEN RAISE EXCEPTION 'Bank line % not found', p_line_id; END IF;
  IF l.transfer_id IS NULL THEN RAISE EXCEPTION 'This line has no bank transaction'; END IF;
  IF bank_period_closed(l.account_id, l.value_date) THEN
    RAISE EXCEPTION 'The period this line is in (%) is closed — reopen it to change it', l.value_date;
  END IF;
  IF NOT p_allow_reconciled AND l.reconciled_as IS NOT NULL THEN
    RAISE EXCEPTION 'This line is already reconciled (%)', l.reconciled_as;
  END IF;
  IF COALESCE(current_setting('kuncho.bank_auto', true), '') = 'on'
     AND EXISTS (SELECT 1 FROM bank_line_events ev WHERE ev.line_id = p_line_id AND ev.action = 'unmatched' AND NOT ev.auto) THEN
    RAISE EXCEPTION 'A match on this line was undone by hand — it is left for review';
  END IF;
  RETURN l;
END; $$;

-- Matches made before this migration: record what they are, undated.
INSERT INTO bank_line_events (line_id, account_id, action, kind, target_label, auto, note, actor, at)
SELECT s.line_id, s.account_id,
  CASE WHEN s.reconciled_as IN ('classified', 'internal') THEN 'explained' ELSE 'matched' END,
  s.reconciled_as, bank_line_target_label(s), false, 'Recorded before history was kept', NULL,
  COALESCE(l.classified_at, l.created_at)
FROM v_bank_line_status s JOIN bank_statement_lines l ON l.id = s.line_id
WHERE s.reconciled_as IS NOT NULL AND s.reconciled_as <> 'opening_balance'
  AND NOT EXISTS (SELECT 1 FROM bank_line_events ev WHERE ev.line_id = s.line_id);

-- ── 2. Undo, with a reason ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION unmatch_bank_line(p_line_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l v_bank_line_status; v_label text;
BEGIN
  l := bank_line_guard(p_line_id, true);
  IF l.reconciled_as IS NULL THEN RAISE EXCEPTION 'This line is not reconciled — nothing to undo'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why this is being undone'; END IF;
  IF l.reconciled_as = 'opening_balance' THEN
    RAISE EXCEPTION 'This is the balance the statement started from — reopen the import instead';
  END IF;
  IF l.reconciled_as = 'vrf_return' THEN
    RAISE EXCEPTION 'Undo the return on its vendor request';
  END IF;
  v_label := bank_line_target_label(l);
  PERFORM set_config('kuncho.bank_event_logged', 'on', true);

  IF l.reconciled_as IN ('classified', 'internal') THEN
    PERFORM unclassify_bank_line(p_line_id);
  ELSE
    -- The records stay as they are (paid, sent, received); only the link to
    -- this bank line goes.
    UPDATE batch_payments SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    UPDATE expenses SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    UPDATE sales SET transfer_id = NULL, amount_received = NULL, withheld_by_client = NULL WHERE transfer_id = l.transfer_id;
    UPDATE payroll SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    IF EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE out_transfer_id = l.transfer_id) THEN
      PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
      UPDATE vendor_receipt_facilitation SET out_transfer_id = NULL WHERE out_transfer_id = l.transfer_id;
      PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
    END IF;
    UPDATE bank_statement_lines SET matched_expense_id = NULL, matched_sale_id = NULL, matched_payroll_id = NULL,
      matched_expense_amount = NULL, variance_amount = NULL, match_status = 'unmatched'
    WHERE id = p_line_id;
  END IF;

  INSERT INTO bank_line_events (line_id, account_id, action, kind, target_label, note)
  VALUES (p_line_id, l.account_id, 'unmatched', l.reconciled_as, v_label, btrim(p_reason));
  PERFORM set_config('kuncho.bank_event_logged', 'off', true);
END $$;
REVOKE ALL ON FUNCTION unmatch_bank_line(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION unmatch_bank_line(uuid, text) TO authenticated;

-- ── 3. Alerts ──────────────────────────────────────────────────────────
-- severity: 'high' | 'medium' | 'low'
CREATE OR REPLACE VIEW v_bank_alerts WITH (security_invoker = true) AS
WITH ctl AS (SELECT * FROM v_account_control WHERE NOT not_opened),
main AS (SELECT * FROM ctl WHERE role = 'main' LIMIT 1)
-- Money waiting in a collection bank.
SELECT 'collection_waiting'::text AS kind,
  CASE WHEN c.waiting_days >= 7 THEN 'high' ELSE 'medium' END AS severity,
  c.account_id, c.account_name,
  to_char(c.waiting_to_move, 'FM999,999,999,990.00') || ' waiting in ' || c.account_name AS title,
  'Received ' || c.waiting_days || ' days ago and not moved on to CBE yet.' AS detail,
  c.waiting_to_move AS amount, c.waiting_since AS since, '/accounts/' || c.account_id AS link, NULL::uuid AS ref_id
FROM ctl c WHERE c.role = 'collection' AND c.waiting_to_move > 0 AND c.waiting_days >= 3
UNION ALL
-- CBE's statement is behind.
SELECT 'stale_statement', CASE WHEN m.statement_date IS NULL OR m.statement_age_days > 7 THEN 'high' ELSE 'medium' END,
  m.account_id, m.account_name,
  m.account_name || ' statement is ' || COALESCE(m.statement_age_days || ' days old', 'missing'),
  'Import the latest statement so today''s balance and matches are real.',
  NULL, m.statement_date, '/bank-statement-import?account=' || m.account_id, NULL
FROM main m WHERE m.statement_date IS NULL OR m.statement_age_days > 3
UNION ALL
-- CBE runs short in the coming week on what's committed.
SELECT 'forecast_short', 'high', m.account_id, m.account_name,
  m.account_name || ' goes short on ' || to_char(f.day, 'DD Mon'),
  'Closing ' || to_char(f.closing, 'FM999,999,999,990.00') || ' after approved payments — move money in or hold some back.',
  f.closing, f.day, '/cash-forecast', NULL
FROM main m CROSS JOIN LATERAL (
  SELECT day, closing FROM cash_forecast(7, m.account_id, false) WHERE closing < 0 ORDER BY day LIMIT 1) f
UNION ALL
-- Lines nobody has explained: old ones, and large ones.
SELECT 'old_open_lines', 'medium', c.account_id, c.account_name,
  x.n || ' bank line' || CASE WHEN x.n = 1 THEN '' ELSE 's' END || ' open for over 30 days in ' || c.account_name,
  'Oldest from ' || to_char(x.oldest, 'DD Mon YYYY') || '.', x.amt, x.oldest,
  '/bank-statement-import?account=' || c.account_id, NULL
FROM ctl c CROSS JOIN LATERAL (
  SELECT count(*)::int AS n, sum(l.amount) AS amt, min(l.value_date) AS oldest
  FROM v_bank_line_status l WHERE l.account_id = c.account_id AND l.reconciled_as IS NULL AND l.value_date < current_date - 30) x
WHERE x.n > 0
UNION ALL
SELECT 'large_open_line', 'medium', l.account_id, a.account_name,
  'Unexplained ' || l.direction || ' of ' || to_char(l.amount, 'FM999,999,999,990.00') || ' on ' || to_char(l.value_date, 'DD Mon'),
  COALESCE(NULLIF(l.narration, ''), l.reference, ''), l.amount, l.value_date,
  '/bank-statement-import?account=' || l.account_id || '&line=' || l.line_id, l.line_id
FROM v_bank_line_status l JOIN accounts a ON a.id = l.account_id
WHERE l.reconciled_as IS NULL AND l.amount >= 1000000
UNION ALL
-- Sent, and the statement now runs well past it, but the bank doesn't show it.
SELECT 'sent_not_on_bank', 'medium', c.account_id, c.account_name,
  x.n || ' sent payment' || CASE WHEN x.n = 1 THEN '' ELSE 's' END || ' not on the ' || c.account_name || ' statement',
  'Sent more than 5 days before the statement ends. Match them, or check they really went.', x.amt, x.oldest,
  '/accounts/' || c.account_id, NULL
FROM ctl c CROSS JOIN LATERAL (
  SELECT count(*)::int AS n, sum(COALESCE(e.net_payable, e.amount_etb)) AS amt,
    min(COALESCE(e.payment_state_changed_at::date, e.date)) AS oldest
  FROM expenses e
  WHERE e.account_id = c.account_id AND e.payment_state = 'sent' AND e.transfer_id IS NULL AND NOT COALESCE(e.is_archived, false)
    AND COALESCE(e.payment_state_changed_at::date, e.date) < c.statement_date - 5) x
WHERE c.statement_date IS NOT NULL AND x.n > 0
UNION ALL
-- Same payee, same amount, within a week: paid twice?
SELECT 'possible_duplicate', 'high', e1.account_id, a.account_name,
  'Possible double payment: ' || to_char(COALESCE(e1.net_payable, e1.amount_etb), 'FM999,999,999,990.00') || ' to ' || COALESCE(v.vendor_name, st.employee_name, 'the same payee'),
  COALESCE(e1.expense_code, 'Expense') || ' and ' || COALESCE(e2.expense_code, 'expense') || ', ' || abs(e2.date - e1.date) || ' days apart.',
  COALESCE(e1.net_payable, e1.amount_etb), greatest(e1.date, e2.date), '/expenses/' || e2.id, e2.id
FROM expenses e1
JOIN expenses e2 ON e2.id > e1.id
  AND COALESCE(e2.vendor_id::text, e2.paid_to_staff_id::text) = COALESCE(e1.vendor_id::text, e1.paid_to_staff_id::text)
  AND abs(COALESCE(e2.net_payable, e2.amount_etb) - COALESCE(e1.net_payable, e1.amount_etb)) < 0.01
  AND abs(e2.date - e1.date) <= 7
LEFT JOIN vendors v ON v.id = e1.vendor_id
LEFT JOIN staff st ON st.id = e1.paid_to_staff_id
LEFT JOIN accounts a ON a.id = e1.account_id
WHERE COALESCE(e1.vendor_id, e1.paid_to_staff_id) IS NOT NULL
  AND e1.payment_state IN ('approved_to_pay', 'sent', 'paid') AND e2.payment_state IN ('approved_to_pay', 'sent', 'paid')
  AND NOT COALESCE(e1.is_archived, false) AND NOT COALESCE(e2.is_archived, false)
  AND COALESCE(e1.net_payable, e1.amount_etb) >= 5000
  AND greatest(e1.date, e2.date) >= current_date - 60;
REVOKE ALL ON v_bank_alerts FROM PUBLIC, anon;
GRANT SELECT ON v_bank_alerts TO authenticated;
