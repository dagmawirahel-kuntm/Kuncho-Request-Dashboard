-- 537: Sales writes proformas.
--
-- Sales could see their deals and clients but not a single proforma: the
-- price on paper had to be asked of finance. Now the sales role:
--
--   • reads every proforma and its lines. All of them, not only their own:
--     the PI-YYYY-NNN number is the highest number the writer can see plus
--     one (generate_proforma_number runs as the writer), so a narrower view
--     would hand out numbers already taken;
--   • writes new proformas, revisions and copies, as drafts, as themselves;
--   • edits lines only while the proforma is a draft;
--   • marks a proforma sent, accepted or declined;
--   • issues the numbered copy (print, PDF, email, QR check).
--
-- What stays with admin, executive and finance:
--   • what a line costs us and the margin (proforma_item_costs: no grant);
--   • approving a discount over the company limit (proforma_discount_guard
--     already allows only those roles, and never the person who set it);
--   • converting to an invoice, payment requests and the project BOQ;
--   • creating and editing clients.
--
-- Once a proforma has left draft its money doesn't change in place: a
-- change is a revision, so what the client was sent stays on record.

-- ── Proformas ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS proforma_sales_read ON proformas;
CREATE POLICY proforma_sales_read ON proformas FOR SELECT
  USING ((SELECT get_user_role()) = 'sales');

DROP POLICY IF EXISTS proforma_sales_insert ON proformas;
CREATE POLICY proforma_sales_insert ON proformas FOR INSERT
  WITH CHECK ((SELECT get_user_role()) = 'sales'
              AND created_by = (SELECT auth.uid())
              AND status = 'draft');

-- A revision marks its parent superseded (proforma_revision_after) as the
-- writer, so the update reaches any proforma that isn't invoiced yet.
DROP POLICY IF EXISTS proforma_sales_update ON proformas;
CREATE POLICY proforma_sales_update ON proformas FOR UPDATE
  USING ((SELECT get_user_role()) = 'sales' AND status <> 'converted')
  WITH CHECK ((SELECT get_user_role()) = 'sales' AND status <> 'converted');

-- Sent means sent: its price is changed by a revision, not in place.
CREATE OR REPLACE FUNCTION proforma_sales_money_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(get_user_role()::text, '') <> 'sales' OR OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF NEW.lines_total     IS DISTINCT FROM OLD.lines_total
  OR NEW.subtotal        IS DISTINCT FROM OLD.subtotal
  OR NEW.vat_amount      IS DISTINCT FROM OLD.vat_amount
  OR NEW.total           IS DISTINCT FROM OLD.total
  OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
  OR NEW.discount_kind   IS DISTINCT FROM OLD.discount_kind
  OR NEW.discount_value  IS DISTINCT FROM OLD.discount_value
  OR NEW.client_id       IS DISTINCT FROM OLD.client_id
  OR NEW.payment_terms   IS DISTINCT FROM OLD.payment_terms
  OR NEW.scope           IS DISTINCT FROM OLD.scope
  OR NEW.exclusions      IS DISTINCT FROM OLD.exclusions THEN
    RAISE EXCEPTION '% has left draft — revise it to change its price or terms', OLD.proforma_number;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_proforma_sales_money_guard ON proformas;
CREATE TRIGGER trg_proforma_sales_money_guard BEFORE UPDATE ON proformas
  FOR EACH ROW EXECUTE FUNCTION proforma_sales_money_guard();

-- ── Lines ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pi_sales_read ON proforma_items;
CREATE POLICY pi_sales_read ON proforma_items FOR SELECT
  USING ((SELECT get_user_role()) = 'sales');

DROP POLICY IF EXISTS pi_sales_write ON proforma_items;
CREATE POLICY pi_sales_write ON proforma_items FOR ALL
  USING ((SELECT get_user_role()) = 'sales'
         AND EXISTS (SELECT 1 FROM proformas p WHERE p.id = proforma_id AND p.status = 'draft'))
  WITH CHECK ((SELECT get_user_role()) = 'sales'
              AND EXISTS (SELECT 1 FROM proformas p WHERE p.id = proforma_id AND p.status = 'draft'));

-- ── The numbered copy ────────────────────────────────────────────────────
-- As 368, plus sales for proformas. issue_document and document_email_begin
-- both ask this, and the issued_documents read policy uses it too.
CREATE OR REPLACE FUNCTION public.can_issue_document(p_doc_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(CASE p_doc_type
    WHEN 'purchase_order' THEN get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'procurement_officer']::user_role[])
    WHEN 'proforma'       THEN get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales']::user_role[])
    ELSE get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[])
  END, false);
$function$;
