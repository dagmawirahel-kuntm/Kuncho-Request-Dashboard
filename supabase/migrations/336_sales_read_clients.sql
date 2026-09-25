-- 336 — The sales role can read clients
--
-- Sales Journey and the client history page (331, 334) are open to the sales
-- role, but clients was readable only by admin, executive and finance, so a
-- sales user saw every deal with no client and an empty client list. Read
-- only: creating and editing clients stays with admin and finance.

SET search_path TO public;

DROP POLICY IF EXISTS clients_sales_read ON clients;
CREATE POLICY clients_sales_read ON clients FOR SELECT
  USING (get_user_role() = 'sales'::user_role);
