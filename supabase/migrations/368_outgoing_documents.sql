-- 368: Outgoing documents — who we are, what we sent, and proof it's ours.
--
-- 1. company_profile: the company's identity on every document (legal name
--    in English and Amharic, TIN, VAT registration, address and contacts,
--    logo, bank accounts, print style, proforma terms). It lived as two
--    hard-coded strings; now admin, executive or finance edit it once.
-- 2. company_signoff: the signatory, signature and stamp. Only the roles
--    that issue documents can read it, so the signature image isn't handed
--    to everyone who can open a page.
-- 3. Proformas: scope and exclusions, versions (a revision keeps the
--    number with -R2, -R3… and supersedes the one before), sent / accepted /
--    declined with dates, and a valid-until date. Lines carry a section.
-- 4. issued_documents: every proforma, invoice, payment request letter and
--    purchase order that is printed or shared is filed with its exact HTML,
--    a hash of its content and a random verification token. Issuing the
--    same content again reuses the copy; changed content becomes the next
--    version and supersedes the last.
-- 5. verify_document(token): the public check behind the QR code and the
--    share link — no sign-in needed, returns that one document only.

SET search_path TO public;

-- ── 1. Company profile ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_profile (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  legal_name      text NOT NULL DEFAULT 'KUNCHO TRADING PLC' CHECK (btrim(legal_name) <> ''),
  legal_name_am   text,
  address         text DEFAULT 'Addis Ababa, Ethiopia',
  po_box          text,
  phone           text,
  email           text,
  website         text,
  tin             text,
  vat_reg_no      text,
  vat_reg_date    date,
  logo_data_url   text,
  print_style     text NOT NULL DEFAULT 'color' CHECK (print_style IN ('color', 'plain')),
  show_ethiopian_dates boolean NOT NULL DEFAULT true,
  footer_note     text,
  proforma_terms  text,
  -- [{ bank, account_name, account_number, branch, swift, on_documents }]
  bank_accounts   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(bank_accounts) = 'array'),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT auth.uid()
);
INSERT INTO company_profile (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_profile_read ON company_profile;
CREATE POLICY company_profile_read ON company_profile FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS company_profile_write ON company_profile;
CREATE POLICY company_profile_write ON company_profile FOR UPDATE
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));
REVOKE ALL ON company_profile FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON company_profile TO authenticated;
DROP TRIGGER IF EXISTS company_profile_updated_at ON company_profile;
CREATE TRIGGER company_profile_updated_at BEFORE UPDATE ON company_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. Signatory, signature, stamp ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_signoff (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  signatory_name     text,
  signatory_title    text,
  signature_data_url text,
  stamp_data_url     text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid DEFAULT auth.uid()
);
INSERT INTO company_signoff (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE company_signoff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_signoff_issuers ON company_signoff;
CREATE POLICY company_signoff_issuers ON company_signoff FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));
REVOKE ALL ON company_signoff FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON company_signoff TO authenticated;
DROP TRIGGER IF EXISTS company_signoff_updated_at ON company_signoff;
CREATE TRIGGER company_signoff_updated_at BEFORE UPDATE ON company_signoff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. Proformas: content, versions, what happened to them ──────────────
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS scope              text;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS exclusions         text;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS version            int NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS parent_proforma_id uuid REFERENCES proformas(id) ON DELETE SET NULL;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS root_proforma_id   uuid REFERENCES proformas(id) ON DELETE SET NULL;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS sent_at            timestamptz;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS sent_to            text;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS accepted_at        timestamptz;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS declined_at        timestamptz;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS decline_reason     text;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS valid_until        date GENERATED ALWAYS AS (date + validity_days) STORED;
CREATE INDEX IF NOT EXISTS proformas_root_idx ON proformas (root_proforma_id);

ALTER TABLE proformas DROP CONSTRAINT IF EXISTS proformas_status_check;
ALTER TABLE proformas ADD CONSTRAINT proformas_status_check
  CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'converted', 'expired', 'superseded'));

ALTER TABLE proforma_items ADD COLUMN IF NOT EXISTS section text;

-- A revision: same family, next version, number PI-…-R<n>; the one it
-- revises is superseded unless it has already been taken up.
CREATE OR REPLACE FUNCTION proforma_revision_before()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE p proformas%ROWTYPE; v_root uuid; v_base text;
BEGIN
  IF NEW.parent_proforma_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM proformas WHERE id = NEW.parent_proforma_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_root := COALESCE(p.root_proforma_id, p.id);
  NEW.root_proforma_id := v_root;
  NEW.version := (SELECT COALESCE(max(version), 1) + 1 FROM proformas WHERE id = v_root OR root_proforma_id = v_root);
  IF NEW.proforma_number IS NULL OR btrim(NEW.proforma_number) = '' THEN
    SELECT regexp_replace(proforma_number, '-R\d+$', '') INTO v_base FROM proformas WHERE id = v_root;
    NEW.proforma_number := v_base || '-R' || NEW.version;
  END IF;
  RETURN NEW;
END $$;
-- Named to run before trg_generate_proforma_number (triggers fire in name
-- order), so a revision gets -R<n> rather than a fresh number.
DROP TRIGGER IF EXISTS trg_0_proforma_revision ON proformas;
CREATE TRIGGER trg_0_proforma_revision BEFORE INSERT ON proformas
  FOR EACH ROW EXECUTE FUNCTION proforma_revision_before();

CREATE OR REPLACE FUNCTION proforma_revision_after()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.parent_proforma_id IS NOT NULL THEN
    UPDATE proformas SET status = 'superseded'
     WHERE id = NEW.parent_proforma_id AND status IN ('draft', 'sent', 'expired', 'declined');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_proforma_revision_after ON proformas;
CREATE TRIGGER trg_proforma_revision_after AFTER INSERT ON proformas
  FOR EACH ROW EXECUTE FUNCTION proforma_revision_after();

-- ── 4. The register of what went out ────────────────────────────────────
CREATE TABLE IF NOT EXISTS issued_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type      text NOT NULL CHECK (doc_type IN ('proforma', 'invoice', 'client_payment_request', 'purchase_order')),
  source_id     uuid NOT NULL,
  doc_number    text,
  version       int NOT NULL CHECK (version >= 1),
  title         text,
  party_name    text,
  total         numeric(18,2),
  currency      text NOT NULL DEFAULT 'ETB',
  content_hash  text NOT NULL,
  html          text,
  verify_token  text NOT NULL UNIQUE DEFAULT replace(replace(rtrim(encode(extensions.gen_random_bytes(18), 'base64'), '='), '+', '-'), '/', '_'),
  status        text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'superseded', 'void')),
  issued_by     uuid DEFAULT auth.uid(),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  sent_to       text,
  sent_via      text,
  sent_at       timestamptz,
  void_reason   text,
  voided_at     timestamptz,
  UNIQUE (doc_type, source_id, version)
);
CREATE INDEX IF NOT EXISTS issued_documents_source_idx ON issued_documents (doc_type, source_id, version DESC);

-- Who may issue and see each kind: the roles that can see its source.
CREATE OR REPLACE FUNCTION can_issue_document(p_doc_type text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(CASE p_doc_type
    WHEN 'purchase_order' THEN get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'procurement_officer']::user_role[])
    ELSE get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[])
  END, false);
$$;
REVOKE ALL ON FUNCTION can_issue_document(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_issue_document(text) TO authenticated;

ALTER TABLE issued_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS issued_documents_read ON issued_documents;
CREATE POLICY issued_documents_read ON issued_documents FOR SELECT USING (can_issue_document(doc_type));
REVOKE ALL ON issued_documents FROM PUBLIC, anon;
GRANT SELECT ON issued_documents TO authenticated;

-- Step 1: file the content (by hash). Same content as the latest copy →
-- that copy; otherwise the next version, the old ones superseded.
CREATE OR REPLACE FUNCTION issue_document(p_doc_type text, p_source_id uuid, p_doc_number text, p_title text,
  p_party_name text, p_total numeric, p_content_hash text)
RETURNS issued_documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d issued_documents%ROWTYPE;
BEGIN
  IF NOT can_issue_document(p_doc_type) THEN RAISE EXCEPTION 'You can''t issue this kind of document'; END IF;
  IF COALESCE(btrim(p_content_hash), '') = '' THEN RAISE EXCEPTION 'Missing content hash'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_doc_type || p_source_id::text, 0));

  SELECT * INTO d FROM issued_documents
   WHERE doc_type = p_doc_type AND source_id = p_source_id AND status <> 'void'
   ORDER BY version DESC LIMIT 1;
  IF FOUND AND d.content_hash = p_content_hash THEN RETURN d; END IF;

  UPDATE issued_documents SET status = 'superseded'
   WHERE doc_type = p_doc_type AND source_id = p_source_id AND status = 'issued';
  INSERT INTO issued_documents (doc_type, source_id, doc_number, version, title, party_name, total, content_hash)
  VALUES (p_doc_type, p_source_id, NULLIF(btrim(p_doc_number), ''),
    COALESCE((SELECT max(version) FROM issued_documents WHERE doc_type = p_doc_type AND source_id = p_source_id), 0) + 1,
    p_title, p_party_name, p_total, p_content_hash)
  RETURNING * INTO d;
  RETURN d;
END $$;
REVOKE ALL ON FUNCTION issue_document(text, uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION issue_document(text, uuid, text, text, text, numeric, text) TO authenticated;

-- Step 2: store the finished page (it carries its own QR code, so it can
-- only be built once the token exists). Written once.
CREATE OR REPLACE FUNCTION store_issued_document_html(p_id uuid, p_html text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d issued_documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM issued_documents WHERE id = p_id;
  IF NOT FOUND OR NOT can_issue_document(d.doc_type) THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF d.html IS NOT NULL THEN RETURN; END IF;
  IF COALESCE(length(p_html), 0) < 50 THEN RAISE EXCEPTION 'Empty document'; END IF;
  UPDATE issued_documents SET html = p_html WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION store_issued_document_html(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION store_issued_document_html(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION mark_document_sent(p_id uuid, p_sent_to text, p_via text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d issued_documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM issued_documents WHERE id = p_id;
  IF NOT FOUND OR NOT can_issue_document(d.doc_type) THEN RAISE EXCEPTION 'Document not found'; END IF;
  UPDATE issued_documents SET sent_to = COALESCE(NULLIF(btrim(p_sent_to), ''), sent_to),
    sent_via = COALESCE(NULLIF(btrim(p_via), ''), sent_via), sent_at = now()
   WHERE id = p_id;
  IF d.doc_type = 'proforma' THEN
    UPDATE proformas SET sent_at = COALESCE(sent_at, now()), sent_to = COALESCE(NULLIF(btrim(p_sent_to), ''), sent_to),
      status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END
     WHERE id = d.source_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION mark_document_sent(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_document_sent(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION void_issued_document(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d issued_documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM issued_documents WHERE id = p_id;
  IF NOT FOUND OR NOT can_issue_document(d.doc_type) THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why it is void'; END IF;
  UPDATE issued_documents SET status = 'void', void_reason = btrim(p_reason), voided_at = now() WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION void_issued_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION void_issued_document(uuid, text) TO authenticated;

-- ── 5. Public verification ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_document(p_token text)
RETURNS TABLE(doc_type text, doc_number text, version int, latest_version int, title text, party_name text,
  total numeric, currency text, status text, issued_at timestamptz, void_reason text, company_name text, html text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.doc_type, d.doc_number, d.version,
    (SELECT max(x.version) FROM issued_documents x WHERE x.doc_type = d.doc_type AND x.source_id = d.source_id AND x.status <> 'void'),
    d.title, d.party_name, d.total, d.currency, d.status, d.issued_at, d.void_reason,
    (SELECT legal_name FROM company_profile LIMIT 1), d.html
  FROM issued_documents d
  WHERE length(COALESCE(p_token, '')) >= 16 AND d.verify_token = p_token;
$$;
REVOKE ALL ON FUNCTION verify_document(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_document(text) TO anon, authenticated;

-- ── 6. A line's cost breakdown, so a revision reopens it as it was ──────
-- (applied as 368_outgoing_documents_cost_parts)
ALTER TABLE proforma_item_costs ADD COLUMN IF NOT EXISTS parts jsonb;
ALTER TABLE proforma_item_costs ADD COLUMN IF NOT EXISTS extra numeric;
