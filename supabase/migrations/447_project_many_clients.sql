-- 447: One project, many paying clients.
--
-- An event like EFF 2026 is one project with a host (National Bank of
-- Ethiopia pays for hosting and administering the construction) and dozens
-- of exhibitors who each pay their own portion. Every exhibitor is a client
-- of its own, with its own contract, proforma, invoice, payment and papers,
-- all under the same project. For that:
--   1. a project's contract value is the total of its contracts, not
--      whichever contract was saved last;
--   2. a proforma made for the client under the deal's project counts as
--      the deal's proforma on the document checklist;
--   3. client_name_key() and client_matches() find a client already on file
--      however its name was written ("Dashen Bank" is "DASHEN BANK S.C.");
--   4. project_add_clients() adds a list of clients to a project in one go:
--      each matched (by TIN, then by name) or created, with a numbered draft
--      contract under the project.

SET search_path TO public;

-- ── 1. A project's contract value is all of its contracts ───────────────
-- One contract per project gives the same figure as before. The project is
-- only touched when its total really changes, and that change is the
-- contracts' own doing, so the guard on a project's budget fields (only
-- admin, executive, finance and operations may edit them) lets it through:
-- before, anyone allowed to save a contract (sales too) was stopped by it.
CREATE OR REPLACE FUNCTION project_contract_total(p_project_id uuid) RETURNS numeric
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT sum(contract_value) FROM contracts WHERE project_id = p_project_id AND status <> 'terminated'
$$;

-- It runs as the owner so the total stays right whoever saves the contract
-- (whether they may edit the project row or not).
CREATE OR REPLACE FUNCTION sync_project_contract_value() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_total numeric;
BEGIN
  PERFORM set_config('kuncho.contract_sync', 'on', true);
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.project_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.project_id IS DISTINCT FROM NEW.project_id) THEN
    v_total := project_contract_total(OLD.project_id);
    UPDATE projects SET contract_value = v_total
     WHERE id = OLD.project_id AND contract_value IS DISTINCT FROM v_total;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.project_id IS NOT NULL THEN
    v_total := project_contract_total(NEW.project_id);
    UPDATE projects
       SET contract_value = v_total,
           client_id = COALESCE(client_id, NEW.client_id)
     WHERE id = NEW.project_id
       AND (contract_value IS DISTINCT FROM v_total OR (client_id IS NULL AND NEW.client_id IS NOT NULL));
  END IF;
  PERFORM set_config('kuncho.contract_sync', 'off', true);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- As before, plus: a total brought over from the contracts passes.
CREATE OR REPLACE FUNCTION restrict_project_budgeting_field_edits() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF get_user_role() IN ('admin', 'executive', 'finance', 'operations_manager') THEN
    RETURN NEW;
  END IF;
  IF current_setting('kuncho.contract_sync', true) = 'on'
     AND NEW.stage IS NOT DISTINCT FROM OLD.stage
     AND NEW.physical_progress IS NOT DISTINCT FROM OLD.physical_progress
     AND NEW.health IS NOT DISTINCT FROM OLD.health
     AND NEW.target_handover_date IS NOT DISTINCT FROM OLD.target_handover_date
     AND NEW.budget_baseline_locked_at IS NOT DISTINCT FROM OLD.budget_baseline_locked_at
     AND NEW.budget_version IS NOT DISTINCT FROM OLD.budget_version THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admin, executive, finance or operations_manager can edit stage, progress, health, or budget fields on a project';
END;
$$;

CREATE OR REPLACE TRIGGER trg_sync_project_contract_value
  AFTER INSERT OR DELETE OR UPDATE OF contract_value, project_id, status ON contracts
  FOR EACH ROW EXECUTE FUNCTION sync_project_contract_value();

-- ── 2. The deal's proforma ──────────────────────────────────────────────
-- As in 331, except that a proforma counts when it was made for the deal's
-- client under the deal's project, not only when it hangs off the deal's
-- opportunity: exhibitors' contracts have no opportunity.
CREATE OR REPLACE VIEW v_sales_engagements WITH (security_invoker = true) AS
 WITH deals AS (
         SELECT o.id AS opportunity_id,
            ( SELECT c.id
                   FROM contracts c
                  WHERE c.opportunity_id = o.id
                  ORDER BY c.created_at DESC
                 LIMIT 1) AS contract_id,
            o.title,
            o.client_id,
            o.prospect_name,
            o.stage,
            o.source,
            o.referrer_name,
            o.brought_by_staff_id,
            o.estimated_value,
            o.lost_reason,
            o.stage_changed_at,
            o.created_at
           FROM opportunities o
        UNION ALL
         SELECT NULL::uuid,
            c.id,
            COALESCE(c.contract_no, 'Contract'::text) AS "coalesce",
            c.client_id,
            NULL::text,
            'won'::text,
            NULL::text,
            NULL::text,
            NULL::uuid,
            c.contract_value,
            NULL::text,
            c.updated_at,
            c.created_at
           FROM contracts c
          WHERE c.opportunity_id IS NULL
        ), d AS (
         SELECT deals.opportunity_id,
            deals.contract_id,
            deals.title,
            deals.client_id,
            deals.prospect_name,
            deals.stage,
            deals.source,
            deals.referrer_name,
            deals.brought_by_staff_id,
            deals.estimated_value,
            deals.lost_reason,
            deals.stage_changed_at,
            deals.created_at,
            COALESCE(deals.opportunity_id, deals.contract_id) AS engagement_id,
            c.contract_no,
            c.contract_value,
            c.status AS contract_status,
            c.signed_date,
            c.project_id,
            c.document_url AS contract_document_url,
            COALESCE(deals.client_id, c.client_id) AS any_client_id,
            array_position(ARRAY['lead'::text, 'qualified'::text, 'site_visit'::text, 'quoted'::text, 'negotiating'::text, 'won'::text], deals.stage) AS stage_rank
           FROM deals
             LEFT JOIN contracts c ON c.id = deals.contract_id
        ), docs AS (
         SELECT d_1.engagement_id,
            jsonb_agg(jsonb_build_object('type', r.document_type, 'label', r.label, 'status',
                CASE
                    WHEN
                    CASE r.document_type
                        WHEN 'proforma'::text THEN (EXISTS ( SELECT 1
                           FROM proformas p
                          WHERE p.opportunity_id = d_1.opportunity_id
                             OR (d_1.project_id IS NOT NULL AND p.project_id = d_1.project_id AND p.client_id = d_1.any_client_id)))
                        WHEN 'bid_bond'::text THEN (EXISTS ( SELECT 1
                           FROM cpo_bonds b
                          WHERE b.opportunity_id = d_1.opportunity_id))
                        WHEN 'contract'::text THEN d_1.contract_document_url IS NOT NULL
                        WHEN 'boq'::text THEN (EXISTS ( SELECT 1
                           FROM boqs q
                          WHERE q.project_id = d_1.project_id AND q.status = 'approved'::text))
                        ELSE false
                    END OR (EXISTS ( SELECT 1
                       FROM client_attachments a
                      WHERE a.category = r.document_type AND (a.opportunity_id = d_1.opportunity_id OR a.contract_id = d_1.contract_id OR r.document_type = 'tin_licence'::text AND a.client_id = d_1.any_client_id))) THEN 'have'::text
                    WHEN d_1.stage = 'lost'::text THEN 'not_needed'::text
                    WHEN r.tender_only AND COALESCE(d_1.source, ''::text) <> 'tender'::text THEN 'not_needed'::text
                    WHEN r.due_from = 'completed'::text THEN
                    CASE
                        WHEN d_1.contract_status = 'completed'::text THEN 'missing'::text
                        ELSE 'not_yet'::text
                    END
                    WHEN d_1.stage_rank >= array_position(ARRAY['lead'::text, 'qualified'::text, 'site_visit'::text, 'quoted'::text, 'negotiating'::text, 'won'::text], r.due_from) THEN 'missing'::text
                    ELSE 'not_yet'::text
                END) ORDER BY r.sort_order) AS checklist
           FROM d d_1
             CROSS JOIN sales_document_requirements r
          WHERE r.is_active
          GROUP BY d_1.engagement_id
        ), money AS (
         SELECT d_1.engagement_id,
            COALESCE(sum(s.amount) FILTER (WHERE s.sales_status = ANY (ARRAY['Invoiced'::sale_lifecycle_status, 'Paid'::sale_lifecycle_status])), 0::numeric) AS invoiced,
            COALESCE(sum(s.amount) FILTER (WHERE s.sales_status = 'Paid'::sale_lifecycle_status), 0::numeric) AS received,
            count(s.id) FILTER (WHERE s.sales_status = ANY (ARRAY['Invoiced'::sale_lifecycle_status, 'Paid'::sale_lifecycle_status])) AS invoice_count,
            count(w.sale_id) FILTER (WHERE w.qualifies AND s.sales_status = 'Paid'::sale_lifecycle_status) AS wht_certificates_due,
            count(w.sale_id) FILTER (WHERE w.qualifies AND s.sales_status = 'Paid'::sale_lifecycle_status AND (EXISTS ( SELECT 1
                   FROM client_attachments a
                  WHERE a.sale_id = s.id AND a.category = 'wht_receipt'::text))) AS wht_certificates_collected
           FROM d d_1
             LEFT JOIN sales s ON s.contract_id = d_1.contract_id AND d_1.contract_id IS NOT NULL AND NOT COALESCE(s.is_archived, false)
             LEFT JOIN v_sale_wht w ON w.sale_id = s.id
          GROUP BY d_1.engagement_id
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
    COALESCE(d.contract_value, 0::numeric) - m.invoiced AS not_yet_invoiced,
    m.invoice_count,
    m.wht_certificates_due,
    m.wht_certificates_collected,
    docs.checklist,
    ( SELECT count(*) AS count
           FROM jsonb_array_elements(docs.checklist) e(value)
          WHERE (e.value ->> 'status'::text) = 'have'::text) AS docs_have,
    ( SELECT count(*) AS count
           FROM jsonb_array_elements(docs.checklist) e(value)
          WHERE (e.value ->> 'status'::text) = 'missing'::text) AS docs_missing,
    d.created_at
   FROM d
     LEFT JOIN clients cl ON cl.id = d.any_client_id
     LEFT JOIN v_staff_directory st ON st.id = d.brought_by_staff_id
     LEFT JOIN projects pr ON pr.id = d.project_id
     LEFT JOIN docs ON docs.engagement_id = d.engagement_id
     LEFT JOIN money m ON m.engagement_id = d.engagement_id;

-- ── 3. Finding a client already on file ─────────────────────────────────
-- The name with case, punctuation and legal forms (S.C., PLC, S.A., Inc,
-- Ltd, Share Company) taken out: "Dashen Bank S.C." and "DASHEN BANK" are
-- both "dashen bank".
CREATE OR REPLACE FUNCTION client_name_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(trim(regexp_replace(regexp_replace(regexp_replace(
           lower(replace(COALESCE(p, ''), '&', ' and ')),
           '[^a-z0-9 ]', ' ', 'g'),
           '\m(s ?c|share company|plc|p l c|s ?a|inc|ltd|limited|the)\M', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

-- For each name, the client it is (same name) or may be (a close spelling,
-- e.g. "Anbesa Bank" for "ANBESSA BANK"). A close spelling is only ever a
-- suggestion: "Commercial Bank of Ethiopia" and "National Bank of Ethiopia"
-- are close too.
CREATE OR REPLACE FUNCTION client_matches(p_names text[])
RETURNS TABLE (idx integer, name text, client_id uuid, client_name text, tin text, how text, score real)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT n.i::integer, n.name, m.id, m.client_name, m.tin, m.how, m.score
    FROM unnest(p_names) WITH ORDINALITY AS n(name, i)
    LEFT JOIN LATERAL (
      SELECT c.id, c.client_name, c.tin,
             CASE WHEN client_name_key(c.client_name) = client_name_key(n.name) THEN 'same' ELSE 'similar' END AS how,
             similarity(client_name_key(c.client_name), client_name_key(n.name)) AS score
        FROM clients c
       WHERE client_name_key(n.name) IS NOT NULL
         AND (client_name_key(c.client_name) = client_name_key(n.name)
              OR similarity(client_name_key(c.client_name), client_name_key(n.name)) >= 0.7)
       ORDER BY (client_name_key(c.client_name) = client_name_key(n.name)) DESC,
                similarity(client_name_key(c.client_name), client_name_key(n.name)) DESC
       LIMIT 1) m ON true
   ORDER BY n.i
$$;

REVOKE ALL ON FUNCTION client_matches(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION client_matches(text[]) TO authenticated;

-- ── 4. Adding many clients to a project ─────────────────────────────────
-- Each row: { name, client_id?, tin?, phone?, email?, amount?, includes_vat?,
-- wht?, scope?, note? }. The client is the one given, else the one with that
-- TIN, else the one with that name, else a new one; blanks on a client found
-- are filled in, nothing on it is overwritten. Each gets one draft contract
-- under the project, numbered after the last KUN-CON number of the year;
-- a client that already has one there keeps it, its blanks filled in.
CREATE OR REPLACE FUNCTION project_add_clients(p_project_id uuid, p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_client uuid;
  v_how text;
  v_contract uuid;
  v_no text;
  v_new_contract boolean;
  v_name text;
  v_tin text;
  v_phone text;
  v_email text;
  v_amount numeric;
  v_year text := to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'YYYY');
  v_next integer;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only finance or admin can add clients';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Rows must be a list';
  END IF;

  -- One numbering at a time.
  PERFORM pg_advisory_xact_lock(hashtext('contracts.contract_no'));
  SELECT COALESCE(max((regexp_match(contract_no, '^KUN-CON-' || v_year || '-(\d+)$'))[1]::integer), 0)
    INTO v_next FROM contracts WHERE contract_no LIKE 'KUN-CON-' || v_year || '-%';

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_name  := NULLIF(trim(r->>'name'), '');
    v_tin   := NULLIF(regexp_replace(COALESCE(r->>'tin', ''), '\D', '', 'g'), '');
    v_phone := NULLIF(trim(r->>'phone'), '');
    v_email := NULLIF(trim(r->>'email'), '');
    v_amount := NULLIF(regexp_replace(COALESCE(r->>'amount', ''), '[^0-9.]', '', 'g'), '')::numeric;
    v_client := NULL; v_how := NULL;

    IF NULLIF(r->>'client_id', '') IS NOT NULL THEN
      SELECT id INTO v_client FROM clients WHERE id = (r->>'client_id')::uuid;
      IF v_client IS NULL THEN RAISE EXCEPTION 'Client for "%" not found', COALESCE(v_name, r->>'client_id'); END IF;
      v_how := 'chosen';
    END IF;
    IF v_client IS NULL AND v_tin IS NOT NULL THEN
      SELECT id INTO v_client FROM clients WHERE regexp_replace(COALESCE(tin, ''), '\D', '', 'g') = v_tin ORDER BY created_at LIMIT 1;
      IF v_client IS NOT NULL THEN v_how := 'tin'; END IF;
    END IF;
    IF v_client IS NULL AND v_name IS NOT NULL THEN
      SELECT id INTO v_client FROM clients WHERE client_name_key(client_name) = client_name_key(v_name) ORDER BY created_at LIMIT 1;
      IF v_client IS NOT NULL THEN v_how := 'name'; END IF;
    END IF;

    IF v_client IS NULL THEN
      IF v_name IS NULL THEN RAISE EXCEPTION 'A row has no name'; END IF;
      INSERT INTO clients (client_name, tin, phone_number, email, business_type)
      VALUES (v_name, v_tin, v_phone, v_email, COALESCE(NULLIF(r->>'business_type', ''), 'Business'))
      RETURNING id INTO v_client;
      v_how := 'new';
    ELSE
      UPDATE clients
         SET tin = COALESCE(NULLIF(tin, ''), v_tin),
             phone_number = COALESCE(NULLIF(phone_number, ''), v_phone),
             email = COALESCE(NULLIF(email, ''), v_email)
       WHERE id = v_client;
    END IF;

    SELECT id, contract_no INTO v_contract, v_no FROM contracts
     WHERE client_id = v_client AND project_id = p_project_id AND status <> 'terminated'
     ORDER BY created_at LIMIT 1;
    v_new_contract := v_contract IS NULL;
    IF v_new_contract THEN
      v_next := v_next + 1;
      v_no := 'KUN-CON-' || v_year || '-' || lpad(v_next::text, 2, '0');
      INSERT INTO contracts (contract_no, client_id, project_id, contract_value, contract_value_includes_vat,
                             wht_rate, status, scope_of_work, notes)
      VALUES (v_no, v_client, p_project_id, v_amount, COALESCE((r->>'includes_vat')::boolean, false),
              CASE WHEN COALESCE((r->>'wht')::boolean, false) THEN 3 END,
              'draft', NULLIF(trim(r->>'scope'), ''), NULLIF(trim(r->>'note'), ''))
      RETURNING id INTO v_contract;
    ELSE
      UPDATE contracts
         SET contract_value = COALESCE(contract_value, v_amount),
             wht_rate = COALESCE(wht_rate, CASE WHEN COALESCE((r->>'wht')::boolean, false) THEN 3 END),
             scope_of_work = COALESCE(NULLIF(scope_of_work, ''), NULLIF(trim(r->>'scope'), '')),
             notes = COALESCE(NULLIF(notes, ''), NULLIF(trim(r->>'note'), ''))
       WHERE id = v_contract;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'client_id', v_client, 'client', v_how,
      'contract_id', v_contract, 'contract_no', v_no, 'contract', CASE WHEN v_new_contract THEN 'new' ELSE 'existing' END));
  END LOOP;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION project_add_clients(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION project_add_clients(uuid, jsonb) TO authenticated;
