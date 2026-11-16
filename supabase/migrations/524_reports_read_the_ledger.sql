-- 524: The P&L and Balance Sheet read the ledger, by account group.
--
-- Until now Reports → P&L added up paid sales and paid bills by category,
-- and the Balance Sheet was assembled from bank balances, unpaid bills and
-- capitalised categories. Neither read the ledger, so neither showed the
-- account groups nor what 520–523 changed (goods paid for and not yet
-- received, equipment held as fixed assets, workshop stock). Both now read
-- journal lines:
--
--   pl_ledger(from, to)           every Revenue / Expense account with its
--                                 heading path, for the period
--   pl_ledger_monthly(from, to, calendar)
--                                 revenue and expenses per Gregorian or
--                                 Ethiopian month
--   balance_sheet_ledger(as_of)   every Asset / Liability / Equity account
--                                 with its heading path, plus the profit
--                                 not yet closed into equity. Opening
--                                 balances still waiting in
--                                 opening_balances (not yet posted as a
--                                 journal entry) are included, so the sheet
--                                 balances before and after they are posted.
--
-- Also: Components (carpets, curtains, sinks, TV racks, remotes as well as
-- hardware) moves out of Hardware and fixings into its own group, 5160
-- Fixtures and fittings.

SET search_path TO public;

INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, description)
SELECT '5160', 'Fixtures and fittings', 'Expense', (SELECT id FROM chart_of_accounts WHERE account_code = '5100'), false, true, 'operating',
       'Group of material accounts by kind of cost (524): fittings and finished items built in or supplied with the work.'
 WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '5160');
UPDATE chart_of_accounts SET parent_account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5160')
 WHERE account_code = '5107';

-- Headings above an account, from the top down: [{code, name}, ...].
CREATE OR REPLACE FUNCTION public.account_path(p_account uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO public AS $f$
  WITH RECURSIVE up AS (
    SELECT c.parent_account_id AS id, 1 AS depth FROM chart_of_accounts c WHERE c.id = p_account
    UNION ALL
    SELECT c.parent_account_id, up.depth + 1 FROM up JOIN chart_of_accounts c ON c.id = up.id
     WHERE up.id IS NOT NULL AND up.depth < 10
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', c.account_code, 'name', c.account_name) ORDER BY up.depth DESC), '[]'::jsonb)
    FROM up JOIN chart_of_accounts c ON c.id = up.id
$f$;

CREATE OR REPLACE FUNCTION public.pl_ledger(p_from date, p_to date)
RETURNS TABLE (account_id uuid, account_code text, account_name text, nature text, path jsonb, amount numeric)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  WITH m AS (
    SELECT l.account_id, sum(l.debit) AS dr, sum(l.credit) AS cr
      FROM journal_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
     WHERE je.entry_date BETWEEN p_from AND p_to
       AND je.entry_type::text NOT IN ('opening_balance', 'closing')
     GROUP BY l.account_id
  )
  SELECT c.id, c.account_code, c.account_name, c.nature, account_path(c.id),
         round(CASE WHEN c.nature = 'Revenue' THEN m.cr - m.dr ELSE m.dr - m.cr END, 2)
    FROM m JOIN chart_of_accounts c ON c.id = m.account_id
   WHERE c.nature IN ('Revenue', 'Expense') AND round(m.dr - m.cr, 2) <> 0
   ORDER BY c.account_code
$f$;

CREATE OR REPLACE FUNCTION public.pl_ledger_monthly(p_from date, p_to date, p_calendar text DEFAULT 'GC')
RETURNS TABLE (month int, revenue numeric, expenses numeric)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT CASE WHEN p_calendar = 'EC' THEN (SELECT et.month FROM to_ethiopian(je.entry_date) et(year, month, day))
              ELSE EXTRACT(month FROM je.entry_date)::int END AS month,
         round(sum(CASE WHEN c.nature = 'Revenue' THEN l.credit - l.debit ELSE 0 END), 2),
         round(sum(CASE WHEN c.nature = 'Expense' THEN l.debit - l.credit ELSE 0 END), 2)
    FROM journal_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id
    JOIN chart_of_accounts c ON c.id = l.account_id
   WHERE je.entry_date BETWEEN p_from AND p_to
     AND je.entry_type::text NOT IN ('opening_balance', 'closing')
     AND c.nature IN ('Revenue', 'Expense')
   GROUP BY 1
   ORDER BY 1
$f$;

CREATE OR REPLACE FUNCTION public.balance_sheet_ledger(p_as_of date)
RETURNS TABLE (account_id uuid, account_code text, account_name text, nature text, path jsonb, balance numeric)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  WITH opening_day AS (SELECT start_date FROM fiscal_periods WHERE is_current LIMIT 1),
  moves AS (
    SELECT l.account_id, l.debit - l.credit AS net
      FROM journal_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
     WHERE je.entry_date <= p_as_of
    UNION ALL
    -- Opening balances not yet posted as a journal entry.
    SELECT ob.chart_of_accounts_id, CASE WHEN ob.side = 'debit' THEN ob.amount ELSE -ob.amount END
      FROM opening_balances ob
     WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_type::text = 'opening_balance')
       AND p_as_of >= (SELECT start_date FROM opening_day)
  ), bal AS (
    SELECT account_id, sum(net) AS net FROM moves GROUP BY account_id
  ), profit AS (
    SELECT COALESCE(sum(-b.net), 0) AS amt  -- revenue (credit) less expenses (debit)
      FROM bal b JOIN chart_of_accounts c ON c.id = b.account_id
     WHERE c.nature IN ('Revenue', 'Expense')
  )
  SELECT c.id, c.account_code, c.account_name, c.nature, account_path(c.id),
         round(CASE WHEN c.nature = 'Asset' THEN b.net ELSE -b.net END, 2)
    FROM bal b JOIN chart_of_accounts c ON c.id = b.account_id
   WHERE c.nature IN ('Asset', 'Liability', 'Equity') AND round(b.net, 2) <> 0
  UNION ALL
  SELECT NULL, '3999', 'Profit or loss not yet closed', 'Equity',
         jsonb_build_array(jsonb_build_object('code', '3000', 'name', 'Equity')), round(p.amt, 2)
    FROM profit p WHERE round(p.amt, 2) <> 0
   ORDER BY 2
$f$;

GRANT EXECUTE ON FUNCTION public.account_path(uuid), public.pl_ledger(date, date),
  public.pl_ledger_monthly(date, date, text), public.balance_sheet_ledger(date) TO authenticated;
