-- 331 — What each deal needs on file, and where its money stands
--
-- 1. Documents a deal needs are data (sales_document_requirements), not
--    code: each names a document type, the stage from which it is due, and
--    whether it applies to tenders only. Finance can add, reword or retire
--    one without a release. The first set:
--      Client TIN & trade licence   from qualified
--      BOQ / scope of work          from quoted
--      Proforma / quotation         from quoted
--      CPO bid bond                 from quoted, tenders only
--      Signed contract              from won
--      Handover certificate         once the contract is completed
-- 2. client_attachments accepts those document types (tin_licence, boq,
--    proforma, bid_bond, invoice, handover, alongside receipt, contract,
--    wht_receipt, other). clients gains a TIN.
-- 3. v_sales_engagements: one row per deal — each opportunity, plus each
--    contract that did not come from a logged opportunity — with its client,
--    stage, source, values, what has been invoiced and received against its
--    contract, the client WHT certificates owed and collected, and its
--    document checklist (in hand / missing / not yet due). A document counts
--    as in hand from the record itself where there is one (a proforma issued
--    for the deal, a CPO bond linked to it, the contract's own file, an
--    approved BOQ on its project) or from a file filed against the deal,
--    its contract or, for the TIN and licence, its client.

SET search_path TO public;

-- ── 1. Requirements as data ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_document_requirements (
  document_type text PRIMARY KEY,
  label         text NOT NULL,
  -- The deal stage from which it is due; 'completed' means once the
  -- contract is completed.
  due_from      text NOT NULL CHECK (due_from IN ('lead', 'qualified', 'site_visit', 'quoted', 'negotiating', 'won', 'completed')),
  tender_only   boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sales_document_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_doc_req_read ON sales_document_requirements;
CREATE POLICY sales_doc_req_read ON sales_document_requirements FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS sales_doc_req_write ON sales_document_requirements;
CREATE POLICY sales_doc_req_write ON sales_document_requirements FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]));
REVOKE ALL ON sales_document_requirements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_document_requirements TO authenticated;

INSERT INTO sales_document_requirements (document_type, label, due_from, tender_only, sort_order) VALUES
  ('tin_licence', 'Client TIN & trade licence', 'qualified', false, 10),
  ('boq',         'BOQ / scope of work',        'quoted',    false, 20),
  ('proforma',    'Proforma / quotation',       'quoted',    false, 30),
  ('bid_bond',    'CPO bid bond',               'quoted',    true,  40),
  ('contract',    'Signed contract',            'won',       false, 50),
  ('handover',    'Handover certificate',       'completed', false, 60)
ON CONFLICT (document_type) DO NOTHING;

-- ── 2. Document types on client files; the client's TIN ─────────────────
ALTER TABLE client_attachments DROP CONSTRAINT IF EXISTS client_attachments_category_check;
ALTER TABLE client_attachments ADD CONSTRAINT client_attachments_category_check
  CHECK (category IN ('receipt', 'contract', 'wht_receipt', 'other',
                      'tin_licence', 'boq', 'proforma', 'bid_bond', 'invoice', 'handover'));

ALTER TABLE clients ADD COLUMN IF NOT EXISTS tin text;

-- ── 3. One row per deal ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_sales_engagements
WITH (security_invoker = true) AS
WITH deals AS (
  -- Each opportunity, with the contract it became (the latest, if several).
  SELECT o.id AS opportunity_id,
    (SELECT c.id FROM contracts c WHERE c.opportunity_id = o.id ORDER BY c.created_at DESC LIMIT 1) AS contract_id,
    o.title, o.client_id, o.prospect_name, o.stage, o.source, o.referrer_name, o.brought_by_staff_id,
    o.estimated_value, o.lost_reason, o.stage_changed_at, o.created_at
  FROM opportunities o
  UNION ALL
  -- Contracts signed without a logged opportunity are deals too.
  SELECT NULL, c.id, COALESCE(c.contract_no, 'Contract'), c.client_id, NULL, 'won', NULL, NULL, NULL,
    c.contract_value, NULL, c.updated_at, c.created_at
  FROM contracts c WHERE c.opportunity_id IS NULL
), d AS (
  SELECT deals.*,
    COALESCE(deals.opportunity_id, deals.contract_id) AS engagement_id,
    c.contract_no, c.contract_value, c.status AS contract_status, c.signed_date, c.project_id,
    c.document_url AS contract_document_url,
    COALESCE(deals.client_id, c.client_id) AS any_client_id,
    array_position(ARRAY['lead', 'qualified', 'site_visit', 'quoted', 'negotiating', 'won'], deals.stage) AS stage_rank
  FROM deals LEFT JOIN contracts c ON c.id = deals.contract_id
), docs AS (
  SELECT d.engagement_id,
    jsonb_agg(jsonb_build_object(
      'type', r.document_type, 'label', r.label,
      'status', CASE
        WHEN (CASE r.document_type
          WHEN 'proforma' THEN EXISTS (SELECT 1 FROM proformas p WHERE p.opportunity_id = d.opportunity_id)
          WHEN 'bid_bond' THEN EXISTS (SELECT 1 FROM cpo_bonds b WHERE b.opportunity_id = d.opportunity_id)
          WHEN 'contract' THEN d.contract_document_url IS NOT NULL
          WHEN 'boq'      THEN EXISTS (SELECT 1 FROM boqs q WHERE q.project_id = d.project_id AND q.status = 'approved')
          ELSE false END)
          OR EXISTS (SELECT 1 FROM client_attachments a
                     WHERE a.category = r.document_type
                       AND (a.opportunity_id = d.opportunity_id OR a.contract_id = d.contract_id
                            OR (r.document_type = 'tin_licence' AND a.client_id = d.any_client_id)))
          THEN 'have'
        WHEN d.stage = 'lost' THEN 'not_needed'
        WHEN r.tender_only AND COALESCE(d.source, '') <> 'tender' THEN 'not_needed'
        WHEN r.due_from = 'completed' THEN CASE WHEN d.contract_status = 'completed' THEN 'missing' ELSE 'not_yet' END
        WHEN d.stage_rank >= array_position(ARRAY['lead', 'qualified', 'site_visit', 'quoted', 'negotiating', 'won'], r.due_from) THEN 'missing'
        ELSE 'not_yet' END
    ) ORDER BY r.sort_order) AS checklist
  FROM d CROSS JOIN sales_document_requirements r
  WHERE r.is_active
  GROUP BY d.engagement_id
), money AS (
  SELECT d.engagement_id,
    COALESCE(sum(s.amount) FILTER (WHERE s.sales_status IN ('Invoiced', 'Paid')), 0) AS invoiced,
    COALESCE(sum(s.amount) FILTER (WHERE s.sales_status = 'Paid'), 0) AS received,
    count(s.id) FILTER (WHERE s.sales_status IN ('Invoiced', 'Paid')) AS invoice_count,
    count(w.sale_id) FILTER (WHERE w.qualifies AND s.sales_status = 'Paid') AS wht_certificates_due,
    count(w.sale_id) FILTER (WHERE w.qualifies AND s.sales_status = 'Paid'
      AND EXISTS (SELECT 1 FROM client_attachments a WHERE a.sale_id = s.id AND a.category = 'wht_receipt')) AS wht_certificates_collected
  FROM d
  LEFT JOIN sales s ON s.contract_id = d.contract_id AND d.contract_id IS NOT NULL AND NOT COALESCE(s.is_archived, false)
  LEFT JOIN v_sale_wht w ON w.sale_id = s.id
  GROUP BY d.engagement_id
)
SELECT d.engagement_id,
  d.opportunity_id,
  d.contract_id,
  d.title,
  d.any_client_id AS client_id,
  COALESCE(cl.client_name, d.prospect_name) AS client_name,
  cl.tin AS client_tin,
  d.stage,
  d.stage_changed_at,
  d.source,
  d.referrer_name,
  st.employee_name AS brought_by_name,
  d.estimated_value,
  d.lost_reason,
  d.contract_no,
  d.contract_value,
  d.contract_status,
  d.signed_date,
  d.project_id,
  pr.project_name,
  m.invoiced,
  m.received,
  m.invoiced - m.received AS outstanding,
  COALESCE(d.contract_value, 0) - m.invoiced AS not_yet_invoiced,
  m.invoice_count,
  m.wht_certificates_due,
  m.wht_certificates_collected,
  docs.checklist,
  (SELECT count(*) FROM jsonb_array_elements(docs.checklist) e WHERE e->>'status' = 'have') AS docs_have,
  (SELECT count(*) FROM jsonb_array_elements(docs.checklist) e WHERE e->>'status' = 'missing') AS docs_missing,
  d.created_at
FROM d
LEFT JOIN clients cl ON cl.id = d.any_client_id
LEFT JOIN v_staff_directory st ON st.id = d.brought_by_staff_id
LEFT JOIN projects pr ON pr.id = d.project_id
LEFT JOIN docs ON docs.engagement_id = d.engagement_id
LEFT JOIN money m ON m.engagement_id = d.engagement_id;
REVOKE ALL ON v_sales_engagements FROM PUBLIC, anon;
GRANT SELECT ON v_sales_engagements TO authenticated;
