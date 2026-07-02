-- Migration 047: Finance owns the sales pipeline — fix RLS
--
-- Found during launch walkthrough: saving a proforma as a finance user
-- fails with an RLS violation. Migration 043 gave proformas INSERT only
-- to admin/manager, and 001 gave finance SELECT-only on sales — yet the
-- proforma and sales pages live in the finance section and finance is
-- exactly who records sales. Managers also had no SELECT on sales at
-- all (only the approval UPDATE from 007), so their sales list was empty.

SET search_path TO public;

-- ── Proformas: finance gets the full lifecycle ───────────────────
DROP POLICY IF EXISTS "proforma_finance" ON proformas;
CREATE POLICY "proforma_finance" ON proformas
  FOR ALL USING (get_user_role() = 'finance');

DROP POLICY IF EXISTS "pi_finance" ON proforma_items;
CREATE POLICY "pi_finance" ON proforma_items
  FOR ALL USING (get_user_role() = 'finance');

-- ── Sales: finance full write, manager read (approvals via 007) ──
DROP POLICY IF EXISTS "finance_read_sales" ON sales;
DROP POLICY IF EXISTS "finance_all_sales" ON sales;
CREATE POLICY "finance_all_sales" ON sales
  FOR ALL USING (get_user_role() = 'finance');

DROP POLICY IF EXISTS "manager_read_sales" ON sales;
CREATE POLICY "manager_read_sales" ON sales
  FOR SELECT USING (get_user_role() = 'manager');
