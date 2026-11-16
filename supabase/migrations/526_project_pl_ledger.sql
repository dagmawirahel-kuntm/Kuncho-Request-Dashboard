-- 526: A project's own P&L from the ledger, by account group.
--
-- The same rows as pl_ledger (524) — account, its headings, amount — for
-- the journal lines tagged to one project: revenue invoiced to it and cost
-- booked to it (goods on receipt, labour, subcontract, salaries charged by
-- site days). The project page shows it under its headings with subtotals.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.project_pl_ledger(p_project uuid)
RETURNS TABLE (account_id uuid, account_code text, account_name text, nature text, path jsonb, amount numeric)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  WITH m AS (
    SELECT l.account_id, sum(l.debit) AS dr, sum(l.credit) AS cr
      FROM journal_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
     WHERE l.project_id = p_project
       AND je.entry_type::text NOT IN ('opening_balance', 'closing')
     GROUP BY l.account_id
  )
  SELECT c.id, c.account_code, c.account_name, c.nature, account_path(c.id),
         round(CASE WHEN c.nature = 'Revenue' THEN m.cr - m.dr ELSE m.dr - m.cr END, 2)
    FROM m JOIN chart_of_accounts c ON c.id = m.account_id
   WHERE c.nature IN ('Revenue', 'Expense') AND round(m.dr - m.cr, 2) <> 0
   ORDER BY c.account_code
$f$;
GRANT EXECUTE ON FUNCTION public.project_pl_ledger(uuid) TO authenticated;
