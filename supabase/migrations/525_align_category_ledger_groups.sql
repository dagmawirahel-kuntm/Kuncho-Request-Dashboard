-- 525: Keep the account groups when a category is edited.
--
-- A category's account is created and moved by trg_category_ledger_account:
-- adding a category makes an account under the category's ledger group, and
-- renaming it or changing its group moves the account back under that
-- group. Two consequences of 521/524:
--
--   1. Adding the Site Consumables category in 521 made an empty account
--      5160 "Site Consumables" beside 5141, and 524's "insert 5160 Fixtures
--      and fittings unless 5160 exists" then found it. Nothing was ever
--      posted to it (posting picks 5141). It becomes the Fixtures and
--      fittings heading 524 meant to create, with Components under it.
--   2. Every material category still named 5100 Materials as its group, so
--      renaming one would pull its account out of its group. Each category
--      now names the heading its account actually sits under. Bank Charges
--      named 5900 Other project costs while its account sits under 6300.

SET search_path TO public;

UPDATE chart_of_accounts
   SET account_name = 'Fixtures and fittings', is_postable = false, category_id = NULL,
       description = 'Group of material accounts by kind of cost (524/525): fittings and finished items built in or supplied with the work.'
 WHERE account_code = '5160'
   AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = chart_of_accounts.id);

UPDATE chart_of_accounts SET parent_account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5160')
 WHERE account_code = '5107';

UPDATE categories cat
   SET ledger_group_id = a.parent_account_id
  FROM chart_of_accounts a
  JOIN chart_of_accounts p ON p.id = a.parent_account_id AND NOT p.is_postable
 WHERE a.category_id = cat.id
   AND cat.ledger_group_id IS DISTINCT FROM a.parent_account_id;
