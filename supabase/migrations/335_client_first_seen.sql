-- 335 — When a client relationship really began
--
-- v_client_relationships said "client since" from clients.created_at, but
-- most clients were imported into the app this year, so that is the import
-- date. first_seen is the earliest thing on record with the client — a
-- project start, an invoice, a deal, a signed contract or a conversation —
-- or the record's own date when there is nothing earlier. Added as the last
-- column; nothing else in the view changes.

SET search_path TO public;

CREATE OR REPLACE VIEW v_client_relationships
WITH (security_invoker = true) AS
WITH win AS (
  SELECT COALESCE((SELECT value FROM sales_settings WHERE key = 'contact_active_days'), 90)::int AS active_days
)
SELECT c.id AS client_id,
  c.client_name, c.logo_url, c.tin, c.business_type, c.phone_number, c.email, c.address,
  c.created_at AS client_since,
  p.projects_total, p.projects_open, p.open_contract_value,
  ct.contacts_total, ct.contacts_active,
  ia.last_interaction_at, ia.interactions_recent,
  ns.next_step, ns.next_step_due, ns.next_steps_open,
  d.open_deals, d.pipeline_value, d.lost_deals,
  k.contracts_signed, k.contracted_value,
  m.invoiced, m.received, m.invoiced - m.received AS outstanding, m.last_payment_at,
  COALESCE(e.docs_missing, 0) AS docs_missing,
  (SELECT active_days FROM win) AS active_window_days,
  -- When the relationship began: the earliest thing on record with the
  -- client. Most clients were imported this year, so their created_at is
  -- the import date, not when the work started.
  LEAST(c.created_at, f.first_project, f.first_sale, f.first_deal, f.first_contract, f.first_talk) AS first_seen
FROM clients c
LEFT JOIN LATERAL (
  SELECT count(*) AS projects_total,
    count(*) FILTER (WHERE pr.active_for_year AND NOT COALESCE(pr.is_internal, false)) AS projects_open,
    COALESCE(sum(pr.contract_value) FILTER (WHERE pr.active_for_year AND NOT COALESCE(pr.is_internal, false)), 0) AS open_contract_value
  FROM projects pr WHERE pr.client_id = c.id
) p ON true
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE cc.is_active) AS contacts_total,
    count(*) FILTER (WHERE cc.is_active AND EXISTS (
      SELECT 1 FROM client_interactions i
      WHERE i.contact_id = cc.id
        AND i.occurred_at >= now() - make_interval(days => (SELECT active_days FROM win)))) AS contacts_active
  FROM client_contacts cc WHERE cc.client_id = c.id
) ct ON true
LEFT JOIN LATERAL (
  SELECT max(i.occurred_at) AS last_interaction_at,
    count(*) FILTER (WHERE i.occurred_at >= now() - make_interval(days => (SELECT active_days FROM win))) AS interactions_recent
  FROM client_interactions i WHERE i.client_id = c.id
) ia ON true
LEFT JOIN LATERAL (
  SELECT (array_agg(i.next_step ORDER BY i.next_step_due NULLS LAST, i.occurred_at))[1] AS next_step,
    min(i.next_step_due) AS next_step_due,
    count(*) AS next_steps_open
  FROM client_interactions i
  WHERE i.client_id = c.id AND i.next_step IS NOT NULL AND i.next_step_done_at IS NULL
) ns ON true
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE o.stage IN ('lead', 'qualified', 'site_visit', 'quoted', 'negotiating')) AS open_deals,
    COALESCE(sum(o.estimated_value) FILTER (WHERE o.stage IN ('lead', 'qualified', 'site_visit', 'quoted', 'negotiating')), 0) AS pipeline_value,
    count(*) FILTER (WHERE o.stage = 'lost') AS lost_deals
  FROM opportunities o WHERE o.client_id = c.id
) d ON true
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE ko.status <> 'draft') AS contracts_signed,
    COALESCE(sum(ko.contract_value) FILTER (WHERE ko.status <> 'draft'), 0) AS contracted_value
  FROM contracts ko WHERE ko.client_id = c.id
) k ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(s.amount) FILTER (WHERE s.sales_status IN ('Invoiced', 'Paid')), 0) AS invoiced,
    COALESCE(sum(s.amount) FILTER (WHERE s.sales_status = 'Paid'), 0) AS received,
    max(s.payment_date) FILTER (WHERE s.sales_status = 'Paid') AS last_payment_at
  FROM sales s
  WHERE s.client_id = c.id AND NOT COALESCE(s.is_archived, false)
) m ON true
LEFT JOIN LATERAL (
  SELECT sum(se.docs_missing) AS docs_missing FROM v_sales_engagements se WHERE se.client_id = c.id
) e ON true
LEFT JOIN LATERAL (
  SELECT
    (SELECT min(pr.start_date)::timestamptz FROM projects pr WHERE pr.client_id = c.id) AS first_project,
    (SELECT min(s.date)::timestamptz FROM sales s WHERE s.client_id = c.id AND NOT COALESCE(s.is_archived, false)) AS first_sale,
    (SELECT min(o.created_at) FROM opportunities o WHERE o.client_id = c.id) AS first_deal,
    (SELECT min(ko.signed_date)::timestamptz FROM contracts ko WHERE ko.client_id = c.id) AS first_contract,
    (SELECT min(i.occurred_at) FROM client_interactions i WHERE i.client_id = c.id) AS first_talk
) f ON true;
REVOKE ALL ON v_client_relationships FROM PUBLIC, anon;
GRANT SELECT ON v_client_relationships TO authenticated;
