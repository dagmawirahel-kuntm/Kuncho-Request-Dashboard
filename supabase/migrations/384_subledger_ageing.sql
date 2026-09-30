-- 384 — Ageing for the sub-ledgers
--
-- How old is what each vendor is owed, or each client owes? Payments are
-- set against the oldest bills first; what is left of each bill is aged
-- from its date. For a payable the bills are the credits; for a receivable
-- or an advance they are the debits.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.subledger_ageing(p_key text, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (party_type text, party_id uuid, party_name text, balance numeric,
               age_0_30 numeric, age_31_60 numeric, age_61_90 numeric, age_over_90 numeric,
               oldest_open date, last_activity date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH acct AS (
    SELECT id, nature FROM chart_of_accounts WHERE system_key = p_key AND party_kinds IS NOT NULL
  ), lines AS (
    -- amount > 0: adds to what is open (a bill owed, an invoice or advance given)
    SELECT l.party_type, l.party_id, je.entry_date, je.created_at, l.id,
           CASE WHEN a.nature IN ('Liability', 'Equity') THEN l.credit - l.debit ELSE l.debit - l.credit END AS amount
      FROM journal_lines l
      JOIN journal_entries je ON je.id = l.journal_entry_id
      JOIN acct a ON a.id = l.account_id
     WHERE je.entry_date <= p_as_of
  ), settled AS (
    SELECT party_type, party_id, -sum(amount) FILTER (WHERE amount < 0) AS paid, sum(amount) AS balance,
           max(entry_date) AS last_activity
      FROM lines GROUP BY 1, 2
  ), charges AS (
    SELECT l.*, sum(l.amount) OVER (PARTITION BY l.party_type, l.party_id ORDER BY l.entry_date, l.created_at, l.id) AS cum
      FROM lines l WHERE l.amount > 0
  ), open_part AS (
    SELECT c.party_type, c.party_id, c.entry_date,
           GREATEST(0, LEAST(c.amount, c.cum - COALESCE(s.paid, 0))) AS open_amount
      FROM charges c JOIN settled s ON s.party_type IS NOT DISTINCT FROM c.party_type AND s.party_id IS NOT DISTINCT FROM c.party_id
  )
  SELECT s.party_type, s.party_id, COALESCE(ledger_party_name(s.party_type, s.party_id), 'Not named'),
         round(s.balance, 2),
         round(COALESCE(sum(o.open_amount) FILTER (WHERE p_as_of - o.entry_date <= 30), 0), 2),
         round(COALESCE(sum(o.open_amount) FILTER (WHERE p_as_of - o.entry_date BETWEEN 31 AND 60), 0), 2),
         round(COALESCE(sum(o.open_amount) FILTER (WHERE p_as_of - o.entry_date BETWEEN 61 AND 90), 0), 2),
         round(COALESCE(sum(o.open_amount) FILTER (WHERE p_as_of - o.entry_date > 90), 0), 2),
         min(o.entry_date) FILTER (WHERE o.open_amount > 0), s.last_activity
    FROM settled s
    LEFT JOIN open_part o ON o.party_type IS NOT DISTINCT FROM s.party_type AND o.party_id IS NOT DISTINCT FROM s.party_id
   WHERE can_read_subledgers()
   GROUP BY s.party_type, s.party_id, s.balance, s.last_activity
  HAVING round(s.balance, 2) <> 0
   ORDER BY s.balance DESC
$$;
REVOKE EXECUTE ON FUNCTION subledger_ageing(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION subledger_ageing(text, date) TO authenticated;
