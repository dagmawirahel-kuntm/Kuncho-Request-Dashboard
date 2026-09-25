-- 334 — A client's people, every conversation with them, and the whole
--       relationship on one timeline
--
-- A client had one phone number and one email, so there was no way to say
-- who at the client we deal with, or when we last spoke to them.
--
-- 1. client_contacts: the people at a client — name, what they do for us
--    (decision maker, procurement, finance, project, site), phone, email,
--    one primary contact per client.
-- 2. client_interactions: each call, meeting, site visit, email or WhatsApp
--    with a client — who it was with, what was said, the next step and when
--    it is due — linked to the deal or project it was about.
-- 3. sales_settings: numbers the sales pages work from, stored as data. The
--    first two: a contact counts as active if spoken to within 90 days, and
--    as warm within 30.
-- 4. v_client_relationships: one row per client — projects (all and open),
--    contacts (all and active), the last conversation and the next step due,
--    open deals and their value, contracted value, invoiced, received, owed,
--    and deal documents still missing.
-- 5. v_client_timeline: everything that has happened with a client, in date
--    order — deals opened and moved, proformas, contracts, invoices,
--    payments, projects started and due for handover, conversations and
--    documents filed.
--
-- Both views run with the reader's rights, so each person sees only what
-- they can already see in the underlying tables.

SET search_path TO public;

-- ── 1. Contacts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  full_name   text NOT NULL CHECK (btrim(full_name) <> ''),
  role        text NOT NULL DEFAULT 'other'
              CHECK (role IN ('decision_maker', 'procurement', 'finance', 'project', 'site', 'other')),
  job_title   text,
  phone       text,
  email       text,
  is_primary  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  notes       text,
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_contacts_client_idx ON client_contacts (client_id);
-- One primary contact per client.
CREATE UNIQUE INDEX IF NOT EXISTS client_contacts_one_primary ON client_contacts (client_id) WHERE is_primary;
DROP TRIGGER IF EXISTS client_contacts_updated_at ON client_contacts;
CREATE TRIGGER client_contacts_updated_at BEFORE UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_contacts_read ON client_contacts;
CREATE POLICY client_contacts_read ON client_contacts FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales']::user_role[]));
DROP POLICY IF EXISTS client_contacts_insert ON client_contacts;
CREATE POLICY client_contacts_insert ON client_contacts FOR INSERT
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales']::user_role[]));
DROP POLICY IF EXISTS client_contacts_update ON client_contacts;
CREATE POLICY client_contacts_update ON client_contacts FOR UPDATE
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales']::user_role[]));
DROP POLICY IF EXISTS client_contacts_delete ON client_contacts;
CREATE POLICY client_contacts_delete ON client_contacts FOR DELETE
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));
REVOKE ALL ON client_contacts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_contacts TO authenticated;

-- ── 2. Conversations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_interactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id        uuid REFERENCES client_contacts(id) ON DELETE SET NULL,
  opportunity_id    uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  project_id        uuid REFERENCES projects(id) ON DELETE SET NULL,
  kind              text NOT NULL CHECK (kind IN ('call', 'meeting', 'site_visit', 'email', 'whatsapp', 'other')),
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  summary           text NOT NULL CHECK (btrim(summary) <> ''),
  next_step         text,
  next_step_due     date,
  next_step_done_at timestamptz,
  logged_by         uuid NOT NULL DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (next_step_due IS NULL OR next_step IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS client_interactions_client_idx ON client_interactions (client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS client_interactions_contact_idx ON client_interactions (contact_id);

-- The contact and the deal a conversation names must belong to its client.
CREATE OR REPLACE FUNCTION client_interaction_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM client_contacts WHERE id = NEW.contact_id AND client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'That contact is not at this client';
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM opportunities WHERE id = NEW.opportunity_id AND client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'That deal is not with this client';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS client_interaction_guard ON client_interactions;
CREATE TRIGGER client_interaction_guard BEFORE INSERT OR UPDATE ON client_interactions
  FOR EACH ROW EXECUTE FUNCTION client_interaction_guard();

ALTER TABLE client_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_interactions_read ON client_interactions;
CREATE POLICY client_interactions_read ON client_interactions FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales']::user_role[]));
-- Everyone logs as themselves.
DROP POLICY IF EXISTS client_interactions_insert ON client_interactions;
CREATE POLICY client_interactions_insert ON client_interactions FOR INSERT
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales']::user_role[])
              AND logged_by = auth.uid());
-- Your own entries, or any entry for admin, executive and finance (e.g. to
-- tick off a next step someone else set).
DROP POLICY IF EXISTS client_interactions_update ON client_interactions;
CREATE POLICY client_interactions_update ON client_interactions FOR UPDATE
  USING (logged_by = auth.uid() OR get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales']::user_role[]));
DROP POLICY IF EXISTS client_interactions_delete ON client_interactions;
CREATE POLICY client_interactions_delete ON client_interactions FOR DELETE
  USING (logged_by = auth.uid() OR get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));
REVOKE ALL ON client_interactions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_interactions TO authenticated;

-- ── 3. Settings as data ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_settings (
  key        text PRIMARY KEY,
  value      numeric NOT NULL,
  label      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sales_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_settings_read ON sales_settings;
CREATE POLICY sales_settings_read ON sales_settings FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS sales_settings_write ON sales_settings;
CREATE POLICY sales_settings_write ON sales_settings FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'finance']::user_role[]));
REVOKE ALL ON sales_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_settings TO authenticated;

INSERT INTO sales_settings (key, value, label) VALUES
  ('contact_active_days', 90, 'A contact is active if spoken to within this many days'),
  ('contact_warm_days',   30, 'A contact is warm if spoken to within this many days')
ON CONFLICT (key) DO NOTHING;

-- ── 4. One row per client ───────────────────────────────────────────────
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
  (SELECT active_days FROM win) AS active_window_days
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
) e ON true;
REVOKE ALL ON v_client_relationships FROM PUBLIC, anon;
GRANT SELECT ON v_client_relationships TO authenticated;

-- ── 5. Everything that has happened with a client ───────────────────────
CREATE OR REPLACE VIEW v_client_timeline
WITH (security_invoker = true) AS
-- Deals opened
SELECT 'opp:' || o.id AS event_id, o.client_id, o.created_at AS event_at,
  'deal_opened'::text AS kind, o.title, o.source::text AS detail, o.estimated_value AS amount,
  o.id AS opportunity_id, NULL::uuid AS contract_id, NULL::uuid AS project_id, NULL::uuid AS contact_id
FROM opportunities o WHERE o.client_id IS NOT NULL
UNION ALL
-- Deals moved from one stage to the next
SELECT 'stage:' || h.id, o.client_id, h.changed_at,
  CASE h.to_stage WHEN 'won' THEN 'deal_won' WHEN 'lost' THEN 'deal_lost' ELSE 'deal_moved' END,
  o.title, h.from_stage || '→' || h.to_stage, NULL,
  o.id, NULL, NULL, NULL
FROM opportunity_stage_history h JOIN opportunities o ON o.id = h.opportunity_id
WHERE o.client_id IS NOT NULL AND h.from_stage IS NOT NULL
UNION ALL
-- Proformas issued
SELECT 'proforma:' || pf.id, pf.client_id, COALESCE(pf.date::timestamptz, pf.created_at),
  'proforma', pf.proforma_number, pf.status::text, pf.total,
  pf.opportunity_id, NULL, pf.project_id, NULL
FROM proformas pf WHERE pf.client_id IS NOT NULL
UNION ALL
-- Contracts drafted or signed
SELECT 'contract:' || k.id, k.client_id,
  CASE WHEN k.status = 'draft' THEN k.created_at ELSE COALESCE(k.signed_date::timestamptz, k.created_at) END,
  CASE WHEN k.status = 'draft' THEN 'contract_drafted' ELSE 'contract_signed' END,
  COALESCE(k.contract_no, 'Contract'), k.status::text, k.contract_value,
  k.opportunity_id, k.id, k.project_id, NULL
FROM contracts k WHERE k.client_id IS NOT NULL
UNION ALL
-- Invoices raised
SELECT 'invoice:' || s.id, s.client_id, COALESCE(s.date::timestamptz, s.created_at),
  'invoice', COALESCE(s.invoice_number, s.sales_description, 'Invoice'), s.sales_status::text, s.amount,
  NULL, s.contract_id, s.project_id, NULL
FROM sales s
WHERE s.client_id IS NOT NULL AND NOT COALESCE(s.is_archived, false) AND s.sales_status IN ('Invoiced', 'Paid')
UNION ALL
-- Payments received
SELECT 'payment:' || s.id, s.client_id, s.payment_date::timestamptz,
  'payment', COALESCE(s.invoice_number, s.sales_description, 'Payment'), NULL, s.amount,
  NULL, s.contract_id, s.project_id, NULL
FROM sales s
WHERE s.client_id IS NOT NULL AND NOT COALESCE(s.is_archived, false) AND s.sales_status = 'Paid' AND s.payment_date IS NOT NULL
UNION ALL
-- Projects started
SELECT 'project:' || pr.id, pr.client_id, COALESCE(pr.start_date::timestamptz, pr.created_at),
  'project_started', pr.project_name, NULL, pr.contract_value,
  NULL, NULL, pr.id, NULL
FROM projects pr WHERE pr.client_id IS NOT NULL AND NOT COALESCE(pr.is_internal, false)
UNION ALL
-- Projects due for handover
SELECT 'handover:' || pr.id, pr.client_id, pr.target_handover_date::timestamptz,
  'handover_due', pr.project_name, NULL, NULL,
  NULL, NULL, pr.id, NULL
FROM projects pr WHERE pr.client_id IS NOT NULL AND pr.target_handover_date IS NOT NULL AND NOT COALESCE(pr.is_internal, false)
UNION ALL
-- Conversations
SELECT 'talk:' || i.id, i.client_id, i.occurred_at,
  'interaction', i.summary, i.kind, NULL,
  i.opportunity_id, NULL, i.project_id, i.contact_id
FROM client_interactions i
UNION ALL
-- Documents filed
SELECT 'doc:' || a.id, a.client_id, a.created_at,
  'document', a.file_name, a.category::text, a.amount,
  a.opportunity_id, a.contract_id, a.project_id, NULL
FROM client_attachments a WHERE a.client_id IS NOT NULL;
REVOKE ALL ON v_client_timeline FROM PUBLIC, anon;
GRANT SELECT ON v_client_timeline TO authenticated;
