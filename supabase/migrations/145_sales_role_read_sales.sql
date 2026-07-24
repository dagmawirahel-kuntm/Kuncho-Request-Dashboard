-- ============================================================
-- The 'sales' role (Business Development/Sales department) has never
-- had read access to the `sales` table itself — only admin (FOR ALL)
-- and finance (SELECT) can see it (001_initial_schema.sql). Building
-- the department's own landing page (sale pipeline Draft/Invoiced/Paid,
-- per spec) surfaced this: BD/Sales couldn't see their own sale
-- pipeline at all. This is a plain read grant, matching finance's own
-- read-only policy shape exactly — no write/approval power added
-- (manager_approve_sales/finance_approve_sales stay as the only UPDATE
-- grants).
-- ============================================================

SET search_path TO public;

DROP POLICY IF EXISTS "sales_role_read_sales" ON sales;
CREATE POLICY "sales_role_read_sales" ON sales FOR SELECT USING (get_user_role() = 'sales');

-- Verify
SELECT policyname FROM pg_policies WHERE tablename = 'sales' AND policyname = 'sales_role_read_sales';
