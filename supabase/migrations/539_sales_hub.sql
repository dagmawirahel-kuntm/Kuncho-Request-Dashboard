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
-- A trigger function: nobody calls it directly (538 closes functions to anon;
-- this one is made after that ran).
REVOKE EXECUTE ON FUNCTION clients_sales_guard() FROM PUBLIC, anon;

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
