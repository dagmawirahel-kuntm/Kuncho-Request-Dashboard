-- 460: Email a document from the app.
--
-- Any outgoing document (proforma, invoice, payment request, purchase
-- order, variation addendum, contract statement, ledger statement, delivery
-- note…) can be emailed from the page it's on: the edge function
-- send-document sends it through Resend — the address set up in Settings →
-- Notifications — with the document attached as an .html file that opens in
-- any browser, and replies going to the person who sent it.
--
-- document_emails is the log: who sent what to whom, and whether it went.
-- document_email_begin runs as the sender (the function passes their sign-in
-- on), so it checks who they are: their role may send, an issued copy is one
-- they may issue, at most 6 addresses, 60 emails a day, and the same copy to
-- the same people not twice within two minutes. document_email_finish is for
-- the edge function only; a sent issued copy is marked sent, by email, to
-- those addresses, as "Mark as sent" would.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS document_emails (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_kind           text NOT NULL CHECK (doc_kind ~ '^[a-z_]{2,40}$'),
  source_id          uuid,
  issued_document_id uuid REFERENCES issued_documents(id) ON DELETE SET NULL,
  title              text NOT NULL CHECK (btrim(title) <> ''),
  recipients         text[] NOT NULL CHECK (cardinality(recipients) BETWEEN 1 AND 6),
  cc                 text[] NOT NULL DEFAULT '{}',
  subject            text NOT NULL CHECK (btrim(subject) <> ''),
  message            text,
  file_name          text NOT NULL,
  content_hash       text,
  size_bytes         integer,
  status             text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error              text,
  provider_id        text,
  sent_by            uuid NOT NULL DEFAULT auth.uid() REFERENCES user_profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz
);
CREATE INDEX IF NOT EXISTS document_emails_source_idx ON document_emails (doc_kind, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_emails_sender_idx ON document_emails (sent_by, created_at DESC);

-- Everyone who works with outgoing documents; not general staff or technicians.
CREATE OR REPLACE FUNCTION document_email_can_send() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(get_user_role() <> ALL (ARRAY['staff', 'technician']::user_role[]), false) $$;
GRANT EXECUTE ON FUNCTION document_email_can_send() TO authenticated;

ALTER TABLE document_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_emails_read ON document_emails FOR SELECT
  USING (sent_by = auth.uid() OR document_email_can_send());
REVOKE ALL ON document_emails FROM PUBLIC, anon;
GRANT SELECT ON document_emails TO authenticated;

CREATE OR REPLACE FUNCTION document_email_begin(
  p_kind text, p_source_id uuid, p_issued_id uuid, p_title text, p_to text[], p_cc text[],
  p_subject text, p_message text, p_file_name text, p_hash text, p_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_to text[]; v_cc text[]; v_bad text; v_id uuid;
  d issued_documents%ROWTYPE; me user_profiles%ROWTYPE;
  v_re constant text := '^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]{2,}$';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT document_email_can_send() THEN RAISE EXCEPTION 'Your role cannot email documents'; END IF;
  SELECT * INTO me FROM user_profiles WHERE id = auth.uid();

  SELECT array_agg(DISTINCT lower(btrim(x))) INTO v_to FROM unnest(p_to) x WHERE btrim(x) <> '';
  SELECT array_agg(DISTINCT lower(btrim(x))) INTO v_cc FROM unnest(COALESCE(p_cc, '{}')) x
   WHERE btrim(x) <> '' AND lower(btrim(x)) <> ALL (COALESCE(v_to, '{}'));
  v_cc := COALESCE(v_cc, '{}');
  IF v_to IS NULL THEN RAISE EXCEPTION 'Add who it goes to'; END IF;
  IF cardinality(v_to) + cardinality(v_cc) > 6 THEN RAISE EXCEPTION 'Six addresses at most'; END IF;
  SELECT x INTO v_bad FROM unnest(v_to || v_cc) x WHERE x !~ v_re LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '"%" is not an email address', v_bad; END IF;
  IF COALESCE(btrim(p_subject), '') = '' THEN RAISE EXCEPTION 'Add a subject'; END IF;

  IF (SELECT count(*) FROM document_emails WHERE sent_by = auth.uid() AND created_at > now() - interval '1 day') >= 60 THEN
    RAISE EXCEPTION 'That is 60 emails today — the limit; try again tomorrow';
  END IF;

  IF p_issued_id IS NOT NULL THEN
    SELECT * INTO d FROM issued_documents WHERE id = p_issued_id;
    IF NOT FOUND OR NOT can_issue_document(d.doc_type) THEN RAISE EXCEPTION 'Document not found'; END IF;
    IF d.status = 'void' THEN RAISE EXCEPTION 'This copy is void — issue a new one'; END IF;
    IF d.html IS NULL THEN RAISE EXCEPTION 'This copy has no stored page yet'; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM document_emails
              WHERE sent_by = auth.uid() AND status <> 'failed' AND created_at > now() - interval '2 minutes'
                AND COALESCE(content_hash, '') = COALESCE(CASE WHEN p_issued_id IS NOT NULL THEN d.content_hash ELSE p_hash END, '')
                AND recipients = v_to) THEN
    RAISE EXCEPTION 'You sent this to them a moment ago';
  END IF;

  INSERT INTO document_emails (doc_kind, source_id, issued_document_id, title, recipients, cc, subject, message,
    file_name, content_hash, size_bytes)
  VALUES (p_kind, COALESCE(p_source_id, d.source_id), p_issued_id, btrim(p_title), v_to, v_cc, btrim(p_subject),
    NULLIF(btrim(p_message), ''), p_file_name, CASE WHEN p_issued_id IS NOT NULL THEN d.content_hash ELSE p_hash END, p_size)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id, 'to', to_jsonb(v_to), 'cc', to_jsonb(v_cc),
    'html', d.html, 'verify_token', d.verify_token,
    'sender_name', COALESCE(me.full_name, me.email), 'sender_email', me.email,
    'company', (SELECT legal_name FROM company_profile LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION document_email_begin(text, uuid, uuid, text, text[], text[], text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION document_email_begin(text, uuid, uuid, text, text[], text[], text, text, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION document_email_finish(p_id uuid, p_ok boolean, p_provider_id text, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e document_emails%ROWTYPE; d issued_documents%ROWTYPE; v_to text;
BEGIN
  IF NOT notify_is_service() THEN RAISE EXCEPTION 'service role only'; END IF;
  UPDATE document_emails
     SET status = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END,
         sent_at = CASE WHEN p_ok THEN now() END,
         provider_id = p_provider_id, error = left(p_error, 500)
   WHERE id = p_id AND status = 'queued'
  RETURNING * INTO e;
  IF NOT FOUND OR NOT p_ok OR e.issued_document_id IS NULL THEN RETURN; END IF;

  v_to := array_to_string(e.recipients, ', ');
  UPDATE issued_documents SET sent_to = v_to, sent_via = 'email', sent_at = now()
   WHERE id = e.issued_document_id
  RETURNING * INTO d;
  IF d.doc_type = 'proforma' THEN
    UPDATE proformas SET sent_at = COALESCE(sent_at, now()), sent_to = COALESCE(sent_to, v_to),
      status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END
     WHERE id = d.source_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION document_email_finish(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION document_email_finish(uuid, boolean, text, text) TO service_role;

-- Whether email is set up, for the Email button (no secrets).
CREATE OR REPLACE FUNCTION document_email_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT email_ready FROM notification_channel_settings LIMIT 1), false) $$;
GRANT EXECUTE ON FUNCTION document_email_ready() TO authenticated;
