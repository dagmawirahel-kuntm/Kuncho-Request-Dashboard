-- 169 — Make the General Ledger "Nature" field actually move the trial balance
--
-- The General Ledger form (GeneralLedgerFormPage) edits categories.nature. But
-- the trial balance (v_trial_balance) groups journal lines by
-- chart_of_accounts.nature, and each category is posted through its linked COA
-- row. Those two nature columns were never tied together, so setting a ledger's
-- nature to Asset (e.g. Steel) changed the Balance Sheet's capitalized-asset
-- RPC but left the trial balance showing it as an Expense — the reports
-- disagreed and the change looked like it did nothing.
--
-- Fix: whenever a category's nature is set, mirror it onto the linked posting
-- account. Existing journal lines keep their debits/credits; only the account's
-- classification moves, which is exactly what the user is asking for. The
-- Balance Sheet totals are unaffected (they read categories.nature and the cash
-- accounts, not this COA row), so there is no double count.

CREATE OR REPLACE FUNCTION public.sync_coa_nature_from_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.nature IS NOT NULL THEN
    UPDATE chart_of_accounts
       SET nature = NEW.nature
     WHERE category_id = NEW.id
       AND nature IS DISTINCT FROM NEW.nature;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_coa_nature ON categories;
CREATE TRIGGER trg_sync_coa_nature
  AFTER INSERT OR UPDATE OF nature ON categories
  FOR EACH ROW EXECUTE FUNCTION public.sync_coa_nature_from_category();

-- One-time backfill for ledgers whose nature was edited before this trigger
-- existed (Steel → Asset today).
UPDATE chart_of_accounts coa
   SET nature = c.nature
  FROM categories c
 WHERE coa.category_id = c.id
   AND c.nature IS NOT NULL
   AND coa.nature IS DISTINCT FROM c.nature;
