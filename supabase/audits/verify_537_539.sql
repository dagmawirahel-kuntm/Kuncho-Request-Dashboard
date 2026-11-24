-- ═══════════════════════════════════════════════════════════════════
-- VERIFY MIGRATIONS 537–539 WITHOUT KEEPING THEM
--
-- Paste the whole file into the Supabase SQL editor and run it. It applies
-- 537 (sales proformas), 538 (security gaps) and 539 (sales hub) inside one
-- transaction, checks them as staff, a project manager, finance and sales,
-- and then fails on purpose so everything is rolled back.
--
-- The result is the error message: it starts with "VERIFY RESULT". Every
-- check reads ok=… / FAIL=…. Nothing is saved, whatever the outcome.
-- (For the sales checks it turns the technician login into sales — that
-- is rolled back too.)
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

CREATE TEMP TABLE _pre_auth_fns AS
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- ════════ 537_sales_writes_proformas ════════
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

-- ════════ 538_close_security_gaps ════════
-- 538: Closing the gaps the security check found (24 Nov 2026).
--
-- 1. Pay. v_payroll_line_tax and v_payroll_tax_by_staff_period (511) run
--    with their owner's rights and filter nothing, so any login could read
--    every person's gross, net and PAYE. 357 closed this kind of leak; these
--    two came after it. The tax functions that read them by name all run
--    with owner rights (tax_plan_compute, tax_plan_levers,
--    build_tax_filing_schedule) and keep reading them unchanged. The app
--    reads new *_app views instead, which return a row only to admin,
--    executive, finance, HR, the tax officer — or the person it is about.
--
-- 2. Signed-out callers. The browser key is public by design, so anything
--    granted to `anon` is open to the internet. Signed out, the app needs
--    three things: checking a document's QR code (verify_document), a
--    driver's trip sheet (driver_trip_sheet) and the sign-up email check
--    (email_allowed_for_signup). Everything else in public is closed to
--    anon: tables, views and sequences, and every function — which until now
--    anon could call through PUBLIC's default grant. Signed-in users keep
--    exactly the functions they could call before (counted per function
--    first, so functions closed on purpose stay closed). Objects made later
--    start closed to anon too.
--
-- 3. Function search_path. 192 functions resolved names through the
--    caller's search_path, get_user_role() — which every policy uses —
--    among them. Each is pinned to public, extensions (what Supabase uses by
--    default, so lookups don't change). Extension-owned functions are left
--    alone.
--
-- 4. Client prices. Every 'staff' login could read every proforma and its
--    lines (043/049, from before the sales role existed). Those grants go.
--    Contracts and opportunities — deal values — were open to every login;
--    staff and technicians lose them. Project managers, operations, finance
--    and the rest keep them: project pages show the contract.
--
-- 5. A leftover: _claude_write_probe, a test table with no row security.
--
-- Not done here (dashboard settings, not SQL): leaked-password protection
-- and two-step sign-in, under Supabase → Authentication.

SET search_path TO public;

-- ── 1. Pay ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_payroll_line_tax_app WITH (security_barrier = true) AS
  SELECT * FROM v_payroll_line_tax
   WHERE (SELECT get_user_role()) = ANY (ARRAY['admin', 'executive', 'finance', 'hr_officer']::user_role[])
      OR (SELECT is_tax_officer())
      OR staff_id = (SELECT current_staff_id());

CREATE OR REPLACE VIEW v_payroll_tax_by_staff_period_app WITH (security_barrier = true) AS
  SELECT * FROM v_payroll_tax_by_staff_period
   WHERE (SELECT get_user_role()) = ANY (ARRAY['admin', 'executive', 'finance', 'hr_officer']::user_role[])
      OR (SELECT is_tax_officer())
      OR staff_id = (SELECT current_staff_id());

REVOKE ALL ON v_payroll_line_tax, v_payroll_tax_by_staff_period FROM anon, authenticated;
REVOKE ALL ON v_payroll_line_tax_app, v_payroll_tax_by_staff_period_app FROM anon;
GRANT SELECT ON v_payroll_line_tax_app, v_payroll_tax_by_staff_period_app TO authenticated;

-- ── 2. Signed-out callers ────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

DO $$
DECLARE
  f record;
  keep_auth oid[];
  keep_service oid[];
BEGIN
  -- Who can call what today, before PUBLIC's grant goes.
  SELECT array_agg(p.oid) INTO keep_auth
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  SELECT array_agg(p.oid) INTO keep_service
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND has_function_privilege('service_role', p.oid, 'EXECUTE');

  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.oid = ANY (keep_auth) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    IF f.oid = ANY (keep_service) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END $$;

-- What the signed-out pages need.
GRANT EXECUTE ON FUNCTION verify_document(text)          TO anon;
GRANT EXECUTE ON FUNCTION driver_trip_sheet(uuid)        TO anon;
GRANT EXECUTE ON FUNCTION email_allowed_for_signup(text) TO anon;

-- New objects start closed to anon (and functions to PUBLIC).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

-- ── 3. Function search_path ──────────────────────────────────────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', f.sig);
  END LOOP;
END $$;

-- ── 4. Client prices ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS proforma_staff    ON proformas;
DROP POLICY IF EXISTS raa_pi_staff_read ON proforma_items;

DROP POLICY IF EXISTS contracts_read ON contracts;
CREATE POLICY contracts_read ON contracts FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL
         AND COALESCE((SELECT get_user_role()) <> ALL (ARRAY['staff', 'technician']::user_role[]), false));

DROP POLICY IF EXISTS opportunities_read ON opportunities;
CREATE POLICY opportunities_read ON opportunities FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL
         AND COALESCE((SELECT get_user_role()) <> ALL (ARRAY['staff', 'technician']::user_role[]), false));

-- ── 5. Leftover ──────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _claude_write_probe;

-- ════════ 539_sales_hub ════════
-- 539: The sales hub — every bit of a deal collected in one place.
--
-- The pieces were already stored: deals and their stage history (330),
-- contacts and every conversation with a next step (334), the client
-- timeline (334/335), proformas, contracts, invoices, payments and the deal
-- documents. They sat on separate pages, nothing chased the next step, and
-- sales could not record a new client or file most deal documents.
--
-- 1. A deal carries its own next step and due date, and a win chance (by
--    default the stage's, from sales_settings) — so the pipeline can be
--    weighted.
-- 2. Sales records new clients and keeps their contact details current.
--    TIN, withholding and receipt vouching stay finance's.
-- 3. Sales files every kind of deal document against the client or deal
--    (contract, TIN licence, BOQ, bid bond, handover…), not only receipts.
-- 4. v_sales_hub_deals: one row per deal with everything the board needs —
--    client or prospect, owner, value, win chance, weighted value, days in
--    stage, last touch, next step, latest proforma.
-- 5. v_sales_followups: everything waiting on someone, one list — next steps
--    due, quotes sent and not answered, quotes about to expire, deals gone
--    quiet, deals with no next step.
-- 6. v_sales_feed: the company-wide timeline, every client, newest first.
-- 7. sales_scorecard(days): by owner and by source — deals, won, lost, win
--    rate, pipeline, weighted, quotes sent and accepted, days to accept,
--    average discount.
-- 8. sales_nudge_daily(): each morning at 08:25 Addis (Mon–Sat), each owner
--    gets their own follow-ups on Telegram / email, linked to the hub.
--
-- Views run as the reader (security_invoker), so each person sees only
-- what they already may.

SET search_path TO public;

-- ── 1. Next step and win chance on the deal ──────────────────────────────
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS next_step     text,
  ADD COLUMN IF NOT EXISTS next_step_due date,
  ADD COLUMN IF NOT EXISTS win_chance    smallint CHECK (win_chance IS NULL OR win_chance BETWEEN 0 AND 100);

INSERT INTO sales_settings (key, value, label) VALUES
  ('win_chance_lead',        10, 'Win chance of a lead (%)'),
  ('win_chance_qualified',   25, 'Win chance once qualified (%)'),
  ('win_chance_site_visit',  40, 'Win chance after the site visit (%)'),
  ('win_chance_quoted',      50, 'Win chance once quoted (%)'),
  ('win_chance_negotiating', 75, 'Win chance while negotiating (%)'),
  ('stale_deal_days',        14, 'A deal with no stage change or conversation for this many days has gone quiet'),
  ('quote_followup_days',     7, 'Chase a sent proforma with no answer after this many days'),
  ('quote_expiry_warn_days',  3, 'Warn this many days before a proforma expires')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION sales_setting(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT value FROM sales_settings WHERE key = p_key), p_default)
$$;

-- ── 2. Sales records clients ─────────────────────────────────────────────
DROP POLICY IF EXISTS clients_sales_insert ON clients;
CREATE POLICY clients_sales_insert ON clients FOR INSERT
  WITH CHECK ((SELECT get_user_role()) = 'sales');
DROP POLICY IF EXISTS clients_sales_update ON clients;
CREATE POLICY clients_sales_update ON clients FOR UPDATE
  USING ((SELECT get_user_role()) = 'sales')
  WITH CHECK ((SELECT get_user_role()) = 'sales');

CREATE OR REPLACE FUNCTION clients_sales_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(get_user_role()::text, '') <> 'sales' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.receipt_vouched := false;
    RETURN NEW;
  END IF;
  IF NEW.tin IS DISTINCT FROM OLD.tin AND OLD.tin IS NOT NULL THEN
    RAISE EXCEPTION 'Finance changes a client''s TIN once it is on record';
  END IF;
  IF NEW.withholding_profile IS DISTINCT FROM OLD.withholding_profile
  OR NEW.receipt_vouched     IS DISTINCT FROM OLD.receipt_vouched THEN
    RAISE EXCEPTION 'Withholding and receipt vouching are finance''s to set';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clients_sales_guard ON clients;
CREATE TRIGGER trg_clients_sales_guard BEFORE INSERT OR UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION clients_sales_guard();

-- ── 3. Sales files deal documents ────────────────────────────────────────
DROP POLICY IF EXISTS client_attachments_sales_documents ON client_attachments;
CREATE POLICY client_attachments_sales_documents ON client_attachments FOR INSERT
  WITH CHECK ((SELECT get_user_role()) = 'sales'
              AND category = ANY (ARRAY['contract', 'tin_licence', 'boq', 'proforma', 'bid_bond', 'handover', 'other']));

-- ── 4. The board ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_sales_hub_deals WITH (security_invoker = true) AS
WITH touch AS (
  SELECT i.opportunity_id, max(i.occurred_at) AS last_at
    FROM client_interactions i WHERE i.opportunity_id IS NOT NULL GROUP BY i.opportunity_id
), open_step AS (
  SELECT DISTINCT ON (i.opportunity_id) i.opportunity_id, i.next_step, i.next_step_due
    FROM client_interactions i
   WHERE i.opportunity_id IS NOT NULL AND i.next_step IS NOT NULL AND i.next_step_done_at IS NULL
   ORDER BY i.opportunity_id, i.next_step_due NULLS LAST, i.occurred_at DESC
), last_pf AS (
  SELECT DISTINCT ON (p.opportunity_id) p.opportunity_id, p.id, p.proforma_number, p.status,
         p.total, p.sent_at, p.valid_until
    FROM proformas p
   WHERE p.opportunity_id IS NOT NULL AND p.status <> 'superseded'
   ORDER BY p.opportunity_id, p.created_at DESC
)
SELECT o.id, o.title, o.stage, o.source, o.client_id,
       COALESCE(c.client_name, o.prospect_name) AS party,
       (o.client_id IS NULL) AS is_prospect,
       o.owner_staff_id, s.employee_name AS owner_name, s.user_id AS owner_user_id,
       o.estimated_value, o.expected_close_date,
       COALESCE(o.win_chance, sales_setting('win_chance_' || o.stage::text,
         CASE WHEN o.stage::text = 'won' THEN 100 ELSE 0 END))::int AS win_chance,
       round(COALESCE(o.estimated_value, 0) * COALESCE(o.win_chance, sales_setting('win_chance_' || o.stage::text,
         CASE WHEN o.stage::text = 'won' THEN 100 ELSE 0 END)) / 100, 2) AS weighted_value,
       COALESCE(o.stage_changed_at, o.created_at) AS stage_since,
       (current_date - COALESCE(o.stage_changed_at, o.created_at)::date) AS days_in_stage,
       GREATEST(t.last_at, o.stage_changed_at, o.created_at) AS last_touch_at,
       COALESCE(o.next_step, os.next_step) AS next_step,
       COALESCE(o.next_step_due, os.next_step_due) AS next_step_due,
       lp.id AS proforma_id, lp.proforma_number, lp.status AS proforma_status, lp.total AS proforma_total,
       lp.sent_at AS proforma_sent_at, lp.valid_until AS proforma_valid_until,
       o.lost_reason, o.created_at, o.updated_at
  FROM opportunities o
  LEFT JOIN clients c ON c.id = o.client_id
  LEFT JOIN staff s ON s.id = o.owner_staff_id
  LEFT JOIN touch t ON t.opportunity_id = o.id
  LEFT JOIN open_step os ON os.opportunity_id = o.id
  LEFT JOIN last_pf lp ON lp.opportunity_id = o.id;

-- ── 5. Everything waiting on someone ─────────────────────────────────────
CREATE OR REPLACE VIEW v_sales_followups WITH (security_invoker = true) AS
-- Next steps from conversations, not ticked off.
SELECT 'step:' || i.id AS item_id, 'next_step'::text AS kind,
       i.next_step_due AS due_on, i.next_step AS title, i.summary AS detail,
       i.client_id, c.client_name AS party, i.opportunity_id, NULL::uuid AS proforma_id, i.id AS interaction_id,
       i.logged_by AS owner_user_id,
       '/sales-journey/clients/' || i.client_id AS link
  FROM client_interactions i JOIN clients c ON c.id = i.client_id
 WHERE i.next_step IS NOT NULL AND i.next_step_done_at IS NULL
UNION ALL
-- A deal's own next step.
SELECT 'deal-step:' || d.id, 'next_step', o.next_step_due, o.next_step, d.title,
       d.client_id, d.party, d.id, NULL, NULL, d.owner_user_id, '/opportunities/' || d.id || '/edit'
  FROM v_sales_hub_deals d JOIN opportunities o ON o.id = d.id
 WHERE o.next_step IS NOT NULL AND d.stage IN ('lead', 'qualified', 'site_visit', 'quoted', 'negotiating')
UNION ALL
-- Sent, no answer yet.
SELECT 'quote-chase:' || p.id, 'quote_no_answer',
       (p.sent_at::date + sales_setting('quote_followup_days', 7)::int),
       'Chase ' || p.proforma_number, 'Sent ' || to_char(p.sent_at, 'DD Mon') || ', no answer yet',
       p.client_id, c.client_name, p.opportunity_id, p.id, NULL, p.created_by, '/proformas/' || p.id
  FROM proformas p JOIN clients c ON c.id = p.client_id
 WHERE p.status = 'sent' AND p.sent_at IS NOT NULL
   AND p.sent_at::date <= current_date - sales_setting('quote_followup_days', 7)::int
   AND (p.valid_until IS NULL OR p.valid_until >= current_date)
UNION ALL
-- About to expire.
SELECT 'quote-expiry:' || p.id, 'quote_expiring', p.valid_until,
       p.proforma_number || ' expires ' || to_char(p.valid_until, 'DD Mon'),
       'Revise it or get an answer before then',
       p.client_id, c.client_name, p.opportunity_id, p.id, NULL, p.created_by, '/proformas/' || p.id
  FROM proformas p JOIN clients c ON c.id = p.client_id
 WHERE p.status IN ('draft', 'sent') AND p.valid_until IS NOT NULL
   AND p.valid_until BETWEEN current_date AND current_date + sales_setting('quote_expiry_warn_days', 3)::int
UNION ALL
-- Gone quiet.
SELECT 'quiet:' || d.id, 'deal_quiet', current_date,
       d.title || ' has gone quiet', 'No stage change or conversation for ' || (current_date - d.last_touch_at::date) || ' days',
       d.client_id, d.party, d.id, NULL, NULL, d.owner_user_id, '/opportunities/' || d.id || '/edit'
  FROM v_sales_hub_deals d
 WHERE d.stage IN ('lead', 'qualified', 'site_visit', 'quoted', 'negotiating')
   AND d.last_touch_at::date <= current_date - sales_setting('stale_deal_days', 14)::int
UNION ALL
-- Open with no next step at all.
SELECT 'no-step:' || d.id, 'deal_no_step', NULL::date,
       d.title || ': no next step', 'Say what happens next and when',
       d.client_id, d.party, d.id, NULL, NULL, d.owner_user_id, '/opportunities/' || d.id || '/edit'
  FROM v_sales_hub_deals d
 WHERE d.stage IN ('lead', 'qualified', 'site_visit', 'quoted', 'negotiating')
   AND d.next_step IS NULL;

-- ── 6. The company-wide timeline ─────────────────────────────────────────
CREATE OR REPLACE VIEW v_sales_feed WITH (security_invoker = true) AS
SELECT t.*, c.client_name
  FROM v_client_timeline t LEFT JOIN clients c ON c.id = t.client_id;

-- ── 7. Scorecard ─────────────────────────────────────────────────────────
-- By owner and by source, over the last p_days. Runs as the reader.
CREATE OR REPLACE FUNCTION sales_scorecard(p_days int DEFAULT 365)
RETURNS TABLE (dimension text, key text, label text,
               deals int, won int, lost int, win_rate numeric, won_value numeric,
               open_value numeric, weighted_value numeric,
               quotes_sent int, quotes_accepted int, avg_days_to_accept numeric, avg_discount_pct numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH d AS (
    SELECT h.*, o.source::text AS src
      FROM v_sales_hub_deals h JOIN opportunities o ON o.id = h.id
     WHERE h.created_at >= now() - make_interval(days => p_days)
  ), q AS (
    SELECT p.*, o.owner_staff_id, o.source::text AS src
      FROM proformas p LEFT JOIN opportunities o ON o.id = p.opportunity_id
     WHERE p.sent_at IS NOT NULL AND p.sent_at >= now() - make_interval(days => p_days)
       AND p.status <> 'superseded'
  ), dims AS (
    SELECT 'owner'::text AS dimension, COALESCE(owner_staff_id::text, '-') AS key, COALESCE(owner_name, 'No owner') AS label, d.* FROM d
    UNION ALL
    SELECT 'source', COALESCE(src, '-'), COALESCE(src, 'Not recorded'), d.* FROM d
  ), qdims AS (
    SELECT 'owner'::text AS dimension, COALESCE(owner_staff_id::text, '-') AS key, q.* FROM q
    UNION ALL
    SELECT 'source', COALESCE(src, '-'), q.* FROM q
  )
  SELECT g.dimension, g.key, max(g.label),
         count(*)::int,
         count(*) FILTER (WHERE g.stage::text = 'won')::int,
         count(*) FILTER (WHERE g.stage::text = 'lost')::int,
         round(100.0 * count(*) FILTER (WHERE g.stage::text = 'won')
               / NULLIF(count(*) FILTER (WHERE g.stage::text IN ('won', 'lost')), 0), 1),
         COALESCE(sum(g.estimated_value) FILTER (WHERE g.stage::text = 'won'), 0),
         COALESCE(sum(g.estimated_value) FILTER (WHERE g.stage::text NOT IN ('won', 'lost')), 0),
         COALESCE(sum(g.weighted_value)  FILTER (WHERE g.stage::text NOT IN ('won', 'lost')), 0),
         (SELECT count(*)::int FROM qdims x WHERE x.dimension = g.dimension AND x.key = g.key),
         (SELECT count(*)::int FROM qdims x WHERE x.dimension = g.dimension AND x.key = g.key AND x.status IN ('accepted', 'converted')),
         (SELECT round(avg(extract(epoch FROM x.accepted_at - x.sent_at) / 86400)::numeric, 1)
            FROM qdims x WHERE x.dimension = g.dimension AND x.key = g.key AND x.accepted_at IS NOT NULL),
         (SELECT round(avg(100 * x.discount_amount / NULLIF(x.lines_total, 0))::numeric, 1)
            FROM qdims x WHERE x.dimension = g.dimension AND x.key = g.key)
    FROM dims g
   GROUP BY g.dimension, g.key
   ORDER BY g.dimension, 8 DESC, 4 DESC
$$;

REVOKE ALL ON v_sales_hub_deals, v_sales_followups, v_sales_feed FROM anon;
GRANT SELECT ON v_sales_hub_deals, v_sales_followups, v_sales_feed TO authenticated;
REVOKE EXECUTE ON FUNCTION sales_scorecard(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sales_scorecard(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION sales_setting(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sales_setting(text, numeric) TO authenticated;

-- ── 8. The morning nudge ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sales_nudge_daily()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE u record; v_lines text[]; v_n integer := 0;
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND COALESCE(get_user_role()::text, '') <> 'admin' THEN
    RAISE EXCEPTION 'Only admin can send the sales reminders by hand';
  END IF;
  FOR u IN
    SELECT f.owner_user_id AS id
      FROM v_sales_followups f JOIN user_profiles p ON p.id = f.owner_user_id
     WHERE p.account_status = 'active'
       AND (f.due_on IS NULL OR f.due_on <= v_today)
     GROUP BY f.owner_user_id
  LOOP
    SELECT array_agg(f.title || COALESCE(' — ' || f.party, '') ORDER BY f.due_on NULLS LAST)
      INTO v_lines
      FROM v_sales_followups f
     WHERE f.owner_user_id = u.id AND (f.due_on IS NULL OR f.due_on <= v_today);
    CONTINUE WHEN v_lines IS NULL OR cardinality(v_lines) = 0;
    v_n := v_n + notify(ARRAY[u.id], 'sales.followups',
      CASE WHEN cardinality(v_lines) = 1 THEN 'Sales: ' || v_lines[1]
           ELSE 'Sales: ' || cardinality(v_lines) || ' follow-ups are due' END,
      CASE WHEN cardinality(v_lines) = 1 THEN NULL
           ELSE '• ' || array_to_string(v_lines[1:15], E'\n• ')
                || CASE WHEN cardinality(v_lines) > 15 THEN E'\n…and ' || (cardinality(v_lines) - 15) || ' more' ELSE '' END END,
      '/sales-hub', NULL, NULL, NULL, 'sales.followups:' || v_today, '{}'::jsonb, true);
  END LOOP;
  RETURN v_n;
END $f$;
REVOKE EXECUTE ON FUNCTION sales_nudge_daily() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('kuncho-sales-nudge') FROM cron.job WHERE jobname = 'kuncho-sales-nudge';
  PERFORM cron.schedule('kuncho-sales-nudge', '25 5 * * 1-6', 'SELECT public.sales_nudge_daily()');
END $$;


-- ════════ Checks ════════
DO $verify$
DECLARE
  r text := '';
  n int; m int; ok boolean;
  u_staff uuid; u_pm uuid; u_fin uuid; u_sales uuid;
  c uuid; pid uuid; payroll_total int;
BEGIN
  -- As the database owner, before switching to app users.
  SELECT count(*) INTO n FROM _pre_auth_fns f WHERE NOT has_function_privilege('authenticated', f.oid, 'EXECUTE');
  r := r || CASE WHEN n = 0 THEN 'ok=signed-in-keep-all-functions' ELSE 'FAIL=signed-in-lost-' || n || '-functions' END;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  r := r || CASE WHEN n = 3 THEN ' ok=anon-calls-only-3-functions' ELSE ' FAIL=anon-calls-' || n || '-functions' END;
  ok := NOT has_table_privilege('anon', 'public.v_payroll_line_tax', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.v_payroll_line_tax_app', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.proformas', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.clients', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.v_payroll_line_tax', 'SELECT');
  r := r || CASE WHEN ok THEN ' ok=pay-and-clients-closed-to-anon' ELSE ' FAIL=anon-or-raw-payroll-still-open' END;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND p.prokind IN ('f', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) x WHERE x LIKE 'search_path=%');
  r := r || CASE WHEN n = 0 THEN ' ok=all-functions-pinned' ELSE ' FAIL=' || n || '-functions-unpinned' END;
  r := r || CASE WHEN to_regclass('public._claude_write_probe') IS NULL THEN ' ok=probe-table-gone' ELSE ' FAIL=probe-table-still-there' END;
  SELECT count(*) INTO payroll_total FROM v_payroll_line_tax;

  SELECT id INTO u_staff FROM user_profiles WHERE role = 'staff' AND account_status = 'active' LIMIT 1;
  SELECT id INTO u_pm    FROM user_profiles WHERE role = 'project_manager' AND account_status = 'active' LIMIT 1;
  SELECT id INTO u_fin   FROM user_profiles WHERE role = 'finance' AND account_status = 'active' LIMIT 1;
  SELECT id INTO u_sales FROM user_profiles WHERE role = 'technician' AND account_status = 'active' LIMIT 1;
  UPDATE user_profiles SET role = 'sales' WHERE id = u_sales;
  SELECT id INTO c FROM clients ORDER BY created_at DESC LIMIT 1;

  SET LOCAL ROLE authenticated;

  -- Staff: no client prices, deals, or other people's pay.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  SELECT (SELECT count(*) FROM proformas) + (SELECT count(*) FROM proforma_items)
       + (SELECT count(*) FROM contracts) + (SELECT count(*) FROM opportunities) INTO n;
  r := r || ' | staff:' || CASE WHEN n = 0 THEN 'ok=no-prices-or-deals' ELSE 'FAIL=sees-' || n || '-price/deal-rows' END;
  SELECT count(*) INTO n FROM v_payroll_line_tax_app WHERE staff_id IS DISTINCT FROM current_staff_id();
  r := r || CASE WHEN n = 0 THEN ' ok=only-own-pay' ELSE ' FAIL=sees-' || n || '-others-pay-lines' END;

  -- Project manager: no one else's pay; still sees contracts.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_pm, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM v_payroll_line_tax_app WHERE staff_id IS DISTINCT FROM current_staff_id();
  r := r || ' | pm:' || CASE WHEN n = 0 THEN 'ok=only-own-pay' ELSE 'FAIL=sees-' || n || '-others-pay-lines' END;
  SELECT count(*) INTO n FROM contracts;
  r := r || ' contracts-visible=' || n;

  -- Finance: every pay line, through the app view only.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM v_payroll_line_tax_app;
  r := r || ' | finance:' || CASE WHEN n = payroll_total THEN 'ok=all-' || n || '-pay-lines' ELSE 'FAIL=' || n || '-of-' || payroll_total END;
  BEGIN
    SELECT count(*) INTO n FROM v_payroll_line_tax;
    r := r || ' FAIL=raw-payroll-view-readable';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' ok=raw-payroll-view-closed'; END;

  -- Sales: proformas (537) and the hub (539).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role', 'authenticated')::text, true);
  r := r || ' | sales(role=' || COALESCE(get_user_role()::text, 'none') || '):';
  SELECT count(*) INTO n FROM proformas; r := r || ' reads-' || n || '-proformas';
  SELECT count(*) INTO n FROM proforma_item_costs;
  r := r || CASE WHEN n = 0 THEN ' ok=no-costs' ELSE ' FAIL=sees-costs' END;
  INSERT INTO proformas (client_id, date, validity_days, lines_total, subtotal, vat_amount, total, status, created_by)
    VALUES (c, current_date, 30, 1000, 1000, 150, 1150, 'draft', u_sales) RETURNING id INTO pid;
  INSERT INTO proforma_items (proforma_id, description, qty, unit, unit_price, vat_rate, sort_order) VALUES (pid, 'test', 1, 'ls', 1000, 0.15, 0);
  r := r || ' ok=writes-draft';
  BEGIN
    INSERT INTO proforma_item_costs (proforma_item_id, cost_per_unit, cost_source) SELECT id, 1, 'manual' FROM proforma_items WHERE proforma_id = pid;
    r := r || ' FAIL=writes-costs';
  EXCEPTION WHEN others THEN r := r || ' ok=cannot-write-costs'; END;
  UPDATE proformas SET status = 'sent', sent_at = now() WHERE id = pid; GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 1 THEN ' ok=marks-sent' ELSE ' FAIL=cannot-mark-sent' END;
  BEGIN
    UPDATE proformas SET payment_terms = 'changed' WHERE id = pid;
    r := r || ' FAIL=edits-sent-terms';
  EXCEPTION WHEN others THEN r := r || ' ok=sent-terms-locked'; END;
  BEGIN
    INSERT INTO proforma_items (proforma_id, description, qty, unit, unit_price, vat_rate, sort_order) VALUES (pid, 'late', 1, 'ls', 1, 0.15, 1);
    r := r || ' FAIL=adds-line-to-sent';
  EXCEPTION WHEN others THEN r := r || ' ok=sent-lines-locked'; END;
  r := r || CASE WHEN can_issue_document('proforma') AND NOT can_issue_document('invoice') THEN ' ok=issues-proforma-not-invoice' ELSE ' FAIL=issue-rights' END;
  SELECT count(*) INTO n FROM v_sales_hub_deals;  r := r || ' hub-deals=' || n;
  SELECT count(*) INTO n FROM v_sales_followups;  r := r || ' followups=' || n;
  SELECT count(*) INTO n FROM v_sales_feed;       r := r || ' feed=' || n;
  SELECT count(*) INTO n FROM sales_scorecard(365); r := r || ' scorecard-rows=' || n;
  INSERT INTO clients (client_name, tin) VALUES ('Verify test client', '0000000000') RETURNING id INTO c;
  r := r || ' ok=adds-client';
  BEGIN
    UPDATE clients SET tin = '1111111111' WHERE id = c;
    r := r || ' FAIL=changes-tin';
  EXCEPTION WHEN others THEN r := r || ' ok=tin-locked'; END;

  RAISE EXCEPTION 'VERIFY RESULT (nothing saved): %', r;
END $verify$;

ROLLBACK;
