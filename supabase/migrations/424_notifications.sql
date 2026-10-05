-- Notifications: one inbox for everyone.
--
-- Until now the bell recounted eleven company-wide numbers every minute,
-- with nothing personal, no read/unread and no history; three features had
-- each built their own one-off "you have news" (site report nudges, tax
-- impact seen, calendar messages to one person). This gives the app one
-- place for news addressed to a person:
--
--   notifications        one row per recipient: what happened, who did it,
--                        where to look, how urgent, read or not
--   notification_kinds   the catalogue: every kind with its group, label and
--                        default urgency (the settings page lists these)
--   notification_prefs   per person: muted kinds, and (migration 425) the
--                        outside channels — Telegram, a daily email
--   notify(...)          the one way rows are written. Called from the
--                        triggers in this file; never breaks the change that
--                        called it, never notifies a person about their own
--                        action, skips disabled accounts and muted kinds
--
-- New rows reach an open app instantly through Supabase Realtime (the table
-- is added to the supabase_realtime publication; RLS limits each person to
-- their own rows).
--
-- Bulk jobs (imports, back-fills) can stay quiet with
--   SET LOCAL app.notify_off = 'on';

-- ── Catalogue ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_kinds (
  kind text PRIMARY KEY,
  grp text NOT NULL,
  label text NOT NULL,
  description text,
  default_priority text NOT NULL DEFAULT 'normal' CHECK (default_priority IN ('low', 'normal', 'high')),
  sort_order integer NOT NULL DEFAULT 0
);
ALTER TABLE notification_kinds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_kinds' AND policyname = 'nk_read') THEN
    CREATE POLICY nk_read ON notification_kinds FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
GRANT SELECT ON notification_kinds TO authenticated;

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order) VALUES
  ('expense.submitted',   'Expenses',     'New expense to approve',                 'Finance and admin: a request was raised',                                'low',    10),
  ('expense.resubmitted', 'Expenses',     'Rejected expense sent again',            'Finance and admin: the requester fixed and resent it',                    'normal', 11),
  ('expense.approved',    'Expenses',     'Your expense was approved',              'You raised it; payment is next',                                          'normal', 12),
  ('expense.rejected',    'Expenses',     'Your expense was rejected',              'You raised it; with the reason',                                          'high',   13),
  ('expense.unapproved',  'Expenses',     'Approval withdrawn on your expense',     'Finance took an approval back',                                           'normal', 14),
  ('expense.sent',        'Expenses',     'Payment sent for your expense',          'Money left; waiting for the bank to confirm',                             'normal', 15),
  ('expense.paid',        'Expenses',     'Your expense was paid',                  'Confirmed paid',                                                          'normal', 16),
  ('expense.advance',     'Expenses',     'Advance paid on your purchase',          'Pay-in-advance purchase orders',                                          'normal', 17),
  ('request.submitted',   'Purchasing',   'New purchase request',                   'Procurement: a site asked for materials',                                 'low',    20),
  ('request.rejected',    'Purchasing',   'Your purchase request was rejected',     'You raised it; with the reason',                                          'high',   21),
  ('po.submitted',        'Purchasing',   'Purchase order to approve',              'Finance and admin: procurement sent a PO for approval',                   'normal', 22),
  ('po.approved',         'Purchasing',   'Your purchase order was approved',       'Procurement: finance approved your PO',                                   'normal', 23),
  ('po.returned',         'Purchasing',   'Purchase order sent back',               'Procurement: finance returned your PO to drafting',                       'high',   24),
  ('po.ordered',          'Purchasing',   'Your items were ordered',                'You requested them; with the vendor and expected date',                   'low',    25),
  ('po.cancelled',        'Purchasing',   'A purchase order was cancelled',         'Procurement, and whoever requested its items',                            'normal', 26),
  ('delivery.received',   'Purchasing',   'Goods delivered',                        'Procurement, the requesters and the site PM',                             'normal', 27),
  ('site_report.reminder','Site reports', 'Daily reports asked for',                'Foremen: the PM asked for missing daily reports',                         'high',   30),
  ('message.received',    'Messages',     'A message for you',                      'Calendar messages addressed to you',                                      'normal', 40),
  ('leave.submitted',     'People',       'Leave request to decide',                'You are the approver',                                                    'normal', 50),
  ('leave.decided',       'People',       'Your leave request was decided',         'Approved or rejected',                                                    'normal', 51),
  ('float.submitted',     'Site cash',    'Site cash float to review',              'PM or finance: a foreman asked for a float',                              'normal', 60),
  ('float.decided',       'Site cash',    'Your site cash float was decided',       'Approved, opened or rejected',                                            'normal', 61),
  ('tax.escalated',       'Tax',          'High tax impact request went ahead',     'Finance, admin, executives and the tax officer',                          'normal', 70),
  ('tax.month_closing',   'Tax',          'Month closing with VAT unpaid',          'Once a month, in the last days before it closes',                         'high',   71),
  ('system.test',         'System',       'Test notification',                      'Sent from the settings page',                                             'normal', 90)
ON CONFLICT (kind) DO UPDATE SET grp = EXCLUDED.grp, label = EXCLUDED.label, description = EXCLUDED.description,
  default_priority = EXCLUDED.default_priority, sort_order = EXCLUDED.sort_order;

-- ── Inbox ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL REFERENCES notification_kinds(kind),
  title text NOT NULL,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  actor_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  dedupe_key text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  -- per outside channel, when it went out: {"telegram": "...", "email": "..."}
  delivered jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_id) WHERE entity_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notifications_own') THEN
    CREATE POLICY notifications_own ON notifications FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;
GRANT SELECT ON notifications TO authenticated;
-- Writes: notify() and the mark-read functions below.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;

-- ── Preferences ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  muted_kinds text[] NOT NULL DEFAULT '{}',
  -- outside channels (migration 425 delivers them)
  outside_min_priority text NOT NULL DEFAULT 'normal' CHECK (outside_min_priority IN ('low', 'normal', 'high')),
  quiet_from time,
  quiet_to time,
  telegram_chat_id bigint,
  telegram_username text,
  telegram_linked_at timestamptz,
  telegram_link_code text,
  telegram_link_expires timestamptz,
  email_digest boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_prefs' AND policyname = 'np_own') THEN
    CREATE POLICY np_own ON notification_prefs FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;
GRANT SELECT ON notification_prefs TO authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_priority_rank(p text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE p WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END $$;

CREATE OR REPLACE FUNCTION notify_etb(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'ETB ' || to_char(round(coalesce(p, 0)), 'FM999,999,999,999,990') $$;

CREATE OR REPLACE FUNCTION notify_short(p text, n integer DEFAULT 60) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULL
              WHEN length(btrim(p)) > n THEN left(btrim(p), n - 1) || '…'
              ELSE btrim(p) END $$;

CREATE OR REPLACE FUNCTION notify_role_users(p_roles text[]) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(id), '{}') FROM user_profiles
  WHERE role::text = ANY (p_roles) AND account_status IS DISTINCT FROM 'disabled' $$;

-- A staff record's login: linked user, else the user with the same email.
CREATE OR REPLACE FUNCTION notify_staff_user(p_staff uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(s.user_id,
    (SELECT u.id FROM user_profiles u WHERE s.email IS NOT NULL AND lower(u.email) = lower(s.email) LIMIT 1))
  FROM staff s WHERE s.id = p_staff $$;

CREATE OR REPLACE FUNCTION notify_user_name(p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NULLIF(btrim(full_name), '') FROM user_profiles WHERE id = p_user $$;

-- ── notify() ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify(
  p_users uuid[], p_kind text, p_title text, p_body text DEFAULT NULL, p_link text DEFAULT NULL,
  p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL, p_priority text DEFAULT NULL,
  p_dedupe text DEFAULT NULL, p_data jsonb DEFAULT '{}'::jsonb, p_include_actor boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer := 0;
  v_actor uuid := auth.uid();
  v_pri text;
BEGIN
  IF COALESCE(current_setting('app.notify_off', true), '') = 'on' THEN RETURN 0; END IF;
  IF p_users IS NULL OR cardinality(p_users) = 0 THEN RETURN 0; END IF;
  v_pri := COALESCE(p_priority, (SELECT default_priority FROM notification_kinds WHERE kind = p_kind), 'normal');

  INSERT INTO notifications (user_id, kind, title, body, link, entity_type, entity_id, actor_id, priority, dedupe_key, data)
  SELECT u.id, p_kind, left(p_title, 200), left(p_body, 1000), p_link, p_entity_type, p_entity_id,
         v_actor, v_pri, p_dedupe, COALESCE(p_data, '{}'::jsonb)
  FROM (SELECT DISTINCT x AS id FROM unnest(p_users) x WHERE x IS NOT NULL) r
  JOIN user_profiles u ON u.id = r.id
  LEFT JOIN notification_prefs np ON np.user_id = u.id
  WHERE (p_include_actor OR u.id IS DISTINCT FROM v_actor)
    AND u.account_status IS DISTINCT FROM 'disabled'
    AND NOT (p_kind = ANY (COALESCE(np.muted_kinds, '{}')))
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
EXCEPTION WHEN OTHERS THEN
  -- A notification must never stop the approval, payment or delivery that raised it.
  RAISE WARNING 'notify(%) failed: %', p_kind, SQLERRM;
  RETURN 0;
END $$;
-- Only triggers and other definer functions call notify(): nobody can post into someone else's inbox.
REVOKE ALL ON FUNCTION notify(uuid[], text, text, text, text, text, uuid, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- ── Reading ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notifications_mark_read(p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  UPDATE notifications SET read_at = now()
  WHERE user_id = auth.uid() AND id = ANY (p_ids) AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION notifications_mark_all_read()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  UPDATE notifications SET read_at = now() WHERE user_id = auth.uid() AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Opening a record clears the news about it.
CREATE OR REPLACE FUNCTION notifications_mark_entity_read(p_entity_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  UPDATE notifications SET read_at = now()
  WHERE user_id = auth.uid() AND entity_id = p_entity_id AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION notifications_unread_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::integer FROM notifications WHERE user_id = auth.uid() AND read_at IS NULL $$;

GRANT EXECUTE ON FUNCTION notifications_mark_read(uuid[]), notifications_mark_all_read(),
  notifications_mark_entity_read(uuid), notifications_unread_count() TO authenticated;

-- ── Preferences: mute kinds ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notification_prefs_set_muted(p_kind text, p_muted boolean)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM notification_kinds WHERE kind = p_kind) THEN RAISE EXCEPTION 'Unknown kind %', p_kind; END IF;
  INSERT INTO notification_prefs (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  UPDATE notification_prefs
     SET muted_kinds = CASE WHEN p_muted THEN (SELECT array_agg(DISTINCT k) FROM unnest(muted_kinds || p_kind) k)
                            ELSE array_remove(muted_kinds, p_kind) END,
         updated_at = now()
   WHERE user_id = auth.uid()
  RETURNING muted_kinds INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION notification_prefs_set_muted(text, boolean) TO authenticated;

-- A test, to yourself.
CREATE OR REPLACE FUNCTION notification_send_test()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  RETURN notify(ARRAY[auth.uid()], 'system.test', 'Notifications are working',
    'This is a test from your notification settings. News about your requests, approvals and deliveries will arrive like this.',
    '/settings/notifications', NULL, NULL, NULL, NULL, '{}'::jsonb, true);
END $$;
GRANT EXECUTE ON FUNCTION notification_send_test() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Events
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Expenses: raised, approved, rejected, sent again, paid ──────────────────
CREATE OR REPLACE FUNCTION trg_notify_expense()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_req uuid := NEW.purchaser_user_id;
  v_link text := '/expenses/' || NEW.id;
  v_what text;
  v_money text := notify_etb(COALESCE(NEW.net_payable, NEW.amount_etb));
  v_proj text;
  v_by text := notify_user_name(auth.uid());
  v_finance uuid[];
BEGIN
  IF NEW.is_archived THEN RETURN NEW; END IF;
  IF v_req IS NULL AND NEW.sourcing_bundle_id IS NOT NULL THEN
    SELECT procurement_officer_id INTO v_req FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  END IF;
  v_what := concat_ws(' · ', NEW.expense_code, notify_short(NEW.item_service_description, 60));
  v_proj := COALESCE((SELECT project_name FROM projects WHERE id = NEW.project_id), NEW.project_name);

  IF TG_OP = 'INSERT' THEN
    -- Raised now (old dates are back-entries and imports, not news).
    IF NEW.approval_status = 'pending' AND NEW.date >= current_date - 45 THEN
      v_finance := notify_role_users(ARRAY['finance', 'admin']);
      PERFORM notify(v_finance, 'expense.submitted', 'New expense to approve',
        concat_ws(' · ', v_what, v_money, v_proj) || COALESCE(' — from ' || notify_user_name(NEW.purchaser_user_id), ''),
        v_link, 'expense', NEW.id, NULL, 'expense.submitted:' || NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF NEW.approval_status = 'finance_approved' THEN
      PERFORM notify(ARRAY[v_req], 'expense.approved', 'Your expense was approved',
        concat_ws(' · ', v_what, v_money) || ' — payment is next.' || COALESCE(' Approved by ' || v_by || '.', ''),
        v_link, 'expense', NEW.id);
    ELSIF NEW.approval_status = 'rejected' THEN
      PERFORM notify(ARRAY[v_req], 'expense.rejected', 'Your expense was rejected',
        concat_ws(' · ', v_what, v_money) || COALESCE(' — ' || NULLIF(btrim(NEW.rejection_reason), ''), '')
          || '. Fix it and send it again from the expense page.',
        v_link, 'expense', NEW.id);
    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      PERFORM notify(notify_role_users(ARRAY['finance', 'admin']), 'expense.resubmitted', 'Rejected expense sent again',
        concat_ws(' · ', v_what, v_money, v_proj) || COALESCE(' — by ' || v_by, ''),
        v_link, 'expense', NEW.id);
    ELSIF OLD.approval_status = 'finance_approved' AND NEW.approval_status = 'pending' THEN
      PERFORM notify(ARRAY[v_req], 'expense.unapproved', 'Approval withdrawn on your expense',
        concat_ws(' · ', v_what, v_money) || ' is back to waiting for approval.' || COALESCE(' By ' || v_by || '.', ''),
        v_link, 'expense', NEW.id);
    END IF;
  END IF;

  IF NEW.payment_state IS DISTINCT FROM OLD.payment_state THEN
    IF NEW.payment_state = 'sent' THEN
      PERFORM notify(ARRAY[v_req], 'expense.sent', 'Payment sent for your expense',
        concat_ws(' · ', v_what, v_money) || COALESCE(' by ' || replace(NEW.payment_method, '_', ' '), '')
          || ' — waiting for the bank to confirm.',
        v_link, 'expense', NEW.id);
    ELSIF NEW.payment_state = 'paid' THEN
      PERFORM notify(ARRAY[v_req], 'expense.paid', 'Your expense was paid',
        concat_ws(' · ', v_what, v_money) || ' — paid.', v_link, 'expense', NEW.id);
    ELSIF NEW.payment_state = 'advance' THEN
      PERFORM notify(ARRAY[v_req], 'expense.advance', 'Advance paid on your purchase',
        concat_ws(' · ', v_what, v_money) || ' — the vendor was paid ahead; it closes when the goods arrive.',
        v_link, 'expense', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_zz_notify_expense
  AFTER INSERT OR UPDATE OF approval_status, payment_state ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_notify_expense();

-- ── Purchase requests: raised, rejected ─────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_notify_purchase_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_link text := '/purchase-requests/' || NEW.id;
  v_what text := concat_ws(' · ', NEW.request_code, notify_short(COALESCE(NEW.order_name, NEW.item_service_description), 60));
  v_proj text := (SELECT project_name FROM projects WHERE id = NEW.project_id);
BEGIN
  IF NEW.is_archived THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.order_date IS NULL OR NEW.order_date >= current_date - 45 THEN
      PERFORM notify(notify_role_users(ARRAY['procurement_officer']), 'request.submitted', 'New purchase request',
        concat_ws(' · ', v_what, v_proj)
          || COALESCE(' — needed by ' || to_char(NEW.required_by_date, 'DD Mon'), '')
          || COALESCE(' — from ' || notify_user_name(NEW.requested_by_user_id), ''),
        v_link, 'purchase_request', NEW.id, CASE WHEN NEW.priority IN ('urgent', 'high') THEN 'normal' END,
        'request.submitted:' || NEW.id);
    END IF;
  ELSIF NEW.approval_status = 'rejected' AND OLD.approval_status IS DISTINCT FROM 'rejected' THEN
    PERFORM notify(ARRAY[NEW.requested_by_user_id, notify_staff_user(NEW.staff_id)], 'request.rejected',
      'Your purchase request was rejected',
      v_what || COALESCE(' — ' || NULLIF(btrim(NEW.rejection_reason), ''), '') || '.',
      v_link, 'purchase_request', NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_zz_notify_purchase_request
  AFTER INSERT OR UPDATE OF approval_status ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_notify_purchase_request();

-- Who asked for the items on a purchase order, and the PMs of their sites.
CREATE OR REPLACE FUNCTION notify_po_requesters(p_bundle uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(DISTINCT u), '{}') FROM (
    SELECT COALESCE(o.requested_by_user_id, notify_staff_user(o.staff_id)) u
    FROM sourcing_bundle_items bi
    JOIN order_items oi ON oi.id = bi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE bi.bundle_id = p_bundle) x
  WHERE u IS NOT NULL $$;

CREATE OR REPLACE FUNCTION notify_po_site_pms(p_bundle uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(DISTINCT u), '{}') FROM (
    SELECT notify_staff_user(p.project_manager_id) u
    FROM sourcing_bundle_items bi
    JOIN order_items oi ON oi.id = bi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    JOIN projects p ON p.id = o.project_id
    WHERE bi.bundle_id = p_bundle AND p.project_manager_id IS NOT NULL) x
  WHERE u IS NOT NULL $$;

-- ── Purchase orders: sent for approval, approved, returned, ordered, cancelled
CREATE OR REPLACE FUNCTION trg_notify_purchase_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_link text := '/sourcing/' || NEW.id;
  v_what text := concat_ws(' · ', NEW.bundle_code, NEW.vendor_name);
  v_money text := notify_etb(COALESCE(NEW.total_value, NEW.items_subtotal_etb));
  v_by text := notify_user_name(auth.uid());
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'submitted' AND OLD.status = 'drafting' THEN
    PERFORM notify(notify_role_users(ARRAY['finance', 'admin']), 'po.submitted', 'Purchase order to approve',
      concat_ws(' · ', v_what, v_money) || COALESCE(' — from ' || notify_user_name(NEW.procurement_officer_id), ''),
      v_link, 'purchase_order', NEW.id);
  ELSIF NEW.status = 'approved' THEN
    PERFORM notify(ARRAY[NEW.procurement_officer_id], 'po.approved', 'Your purchase order was approved',
      concat_ws(' · ', v_what, v_money) || ' — you can place the order.' || COALESCE(' Approved by ' || v_by || '.', ''),
      v_link, 'purchase_order', NEW.id);
  ELSIF NEW.status = 'drafting' AND OLD.status IN ('submitted', 'approved') THEN
    PERFORM notify(ARRAY[NEW.procurement_officer_id], 'po.returned', 'Purchase order sent back',
      v_what || ' is back in drafting' || COALESCE(' — ' || NULLIF(btrim(NEW.finance_notes), ''), '') || '.',
      v_link, 'purchase_order', NEW.id);
  ELSIF NEW.status = 'ordered' THEN
    PERFORM notify(notify_po_requesters(NEW.id), 'po.ordered', 'Your items were ordered',
      v_what || COALESCE(' — expected ' || to_char(NEW.expected_delivery_date, 'DD Mon'), '') || '.',
      v_link, 'purchase_order', NEW.id);
  ELSIF NEW.status = 'cancelled' THEN
    PERFORM notify(ARRAY[NEW.procurement_officer_id] || notify_po_requesters(NEW.id), 'po.cancelled',
      'A purchase order was cancelled',
      v_what || ' was cancelled' || COALESCE(' by ' || v_by, '') || '. Requested items go back to waiting for a new order.',
      v_link, 'purchase_order', NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_zz_notify_purchase_order
  AFTER UPDATE OF status ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION trg_notify_purchase_order();

-- ── Deliveries: goods received against a purchase order ──────────────────────
CREATE OR REPLACE FUNCTION trg_notify_goods_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b sourcing_bundles%ROWTYPE;
BEGIN
  IF NEW.sourcing_bundle_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM notify(ARRAY[b.procurement_officer_id] || notify_po_requesters(b.id) || notify_po_site_pms(b.id),
    'delivery.received', 'Goods delivered',
    concat_ws(' · ', b.bundle_code, b.vendor_name) || ' received'
      || COALESCE(' (' || NEW.grn_code || ')', '')
      || COALESCE(' by ' || notify_user_name(NEW.received_by), '') || '.',
    '/sourcing/' || b.id, 'purchase_order', b.id, NULL, 'delivery.received:' || NEW.id);
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_zz_notify_goods_received
  AFTER INSERT ON goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION trg_notify_goods_received();

-- ── Site reports: the PM's reminder to a foreman ─────────────────────────────
CREATE OR REPLACE FUNCTION trg_notify_site_report_nudge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_proj text := (SELECT project_name FROM projects WHERE id = NEW.project_id);
  v_from text := (SELECT employee_name FROM staff WHERE id = NEW.from_staff_id);
  v_days text := (SELECT string_agg(to_char(d, 'DD Mon'), ', ' ORDER BY d) FROM unnest(NEW.report_dates) d);
BEGIN
  PERFORM notify(ARRAY[notify_staff_user(NEW.to_staff_id)], 'site_report.reminder',
    'Daily reports needed' || COALESCE(': ' || v_proj, ''),
    COALESCE(v_from, 'Your PM') || ' asks for ' || cardinality(NEW.report_dates)
      || CASE WHEN cardinality(NEW.report_dates) = 1 THEN ' day' ELSE ' days' END || ': ' || v_days || '.'
      || COALESCE(' “' || NULLIF(btrim(NEW.message), '') || '”', ''),
    '/site-foreman/daily-report', 'project', NEW.project_id, NULL, 'site_report.reminder:' || NEW.id);
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_zz_notify_site_report_nudge
  AFTER INSERT ON site_report_nudges
  FOR EACH ROW EXECUTE FUNCTION trg_notify_site_report_nudge();

-- ── Calendar messages addressed to one person ────────────────────────────────
CREATE OR REPLACE FUNCTION trg_notify_company_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.recipient_staff_id IS NULL THEN RETURN NEW; END IF;
  PERFORM notify(ARRAY[notify_staff_user(NEW.recipient_staff_id)], 'message.received',
    COALESCE('Message from ' || notify_user_name(NEW.created_by), 'A message for you'),
    concat_ws(' — ', NEW.title, notify_short(NEW.description, 160))
      || ' · ' || to_char(NEW.event_date, 'DD Mon') || COALESCE(' ' || to_char(NEW.start_time, 'HH24:MI'), ''),
    '/calendar', 'company_event', NEW.id, NULL, 'message.received:' || NEW.id);
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_zz_notify_company_event
  AFTER INSERT ON company_events
  FOR EACH ROW EXECUTE FUNCTION trg_notify_company_event();

-- ── Leave: to the approver, then back to the person ──────────────────────────
CREATE OR REPLACE FUNCTION trg_notify_leave()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_who text := (SELECT employee_name FROM staff WHERE id = NEW.staff_id);
  v_what text := NEW.leave_type || ' leave, ' || COALESCE(trim_scale(NEW.days)::text || CASE WHEN NEW.days = 1 THEN ' day, ' ELSE ' days, ' END, '')
                 || to_char(NEW.start_date, 'DD Mon') || '–' || to_char(NEW.end_date, 'DD Mon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' AND NOT COALESCE(NEW.from_paper, false) THEN
      PERFORM notify(ARRAY[NEW.assigned_approver_id], 'leave.submitted', 'Leave request to decide',
        COALESCE(v_who || ': ', '') || v_what || COALESCE(' — ' || notify_short(NEW.reason, 120), ''),
        '/leave-requests', 'leave_request', NEW.id);
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
    PERFORM notify(ARRAY[notify_staff_user(NEW.staff_id)], 'leave.decided',
      'Your leave request was ' || NEW.status,
      upper(left(v_what, 1)) || substr(v_what, 2) || COALESCE(' — ' || NULLIF(btrim(NEW.decision_note), ''), '') || '.',
      '/my-leave', 'leave_request', NEW.id, CASE WHEN NEW.status = 'rejected' THEN 'high' END);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_zz_notify_leave
  AFTER INSERT OR UPDATE OF status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION trg_notify_leave();

-- ── Site cash floats: to the PM or finance, then back to the foreman ─────────
CREATE OR REPLACE FUNCTION trg_notify_site_float()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_proj text := (SELECT project_name FROM projects WHERE id = NEW.project_id);
  v_who text := (SELECT employee_name FROM staff WHERE id = NEW.requested_by_staff_id);
  v_what text := concat_ws(' · ', notify_etb(NEW.requested_amount), v_proj, notify_short(NEW.purpose, 80));
BEGIN
  IF TG_OP = 'INSERT' OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('pending_pm', 'pending_finance')) THEN
    IF NEW.status = 'pending_pm' THEN
      PERFORM notify(ARRAY[(SELECT notify_staff_user(p.project_manager_id) FROM projects p WHERE p.id = NEW.project_id)],
        'float.submitted', 'Site cash float to review', COALESCE(v_who || ': ', '') || v_what,
        '/pm/site-petty-cash-requests', 'site_float_request', NEW.id);
    ELSIF NEW.status = 'pending_finance' THEN
      PERFORM notify(notify_role_users(ARRAY['finance', 'admin']), 'float.submitted', 'Site cash float to review',
        COALESCE(v_who || ': ', '') || v_what, '/finance/site-petty-cash-requests', 'site_float_request', NEW.id);
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected', 'opened') THEN
    PERFORM notify(ARRAY[notify_staff_user(NEW.requested_by_staff_id)], 'float.decided',
      CASE NEW.status WHEN 'opened' THEN 'Your site cash float is open'
                      WHEN 'approved' THEN 'Your site cash float was approved'
                      ELSE 'Your site cash float was rejected' END,
      v_what || COALESCE(' — ' || NULLIF(btrim(NEW.rejection_reason), ''), '') || '.',
      '/site-foreman/float-request', 'site_float_request', NEW.id,
      CASE WHEN NEW.status = 'rejected' THEN 'high' END);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_zz_notify_site_float
  AFTER INSERT OR UPDATE OF status ON site_petty_cash_float_requests
  FOR EACH ROW EXECUTE FUNCTION trg_notify_site_float();

-- ── Tax impact (migration 423): escalations and the month-end countdown ─────
-- Called whenever the ranking is recomputed; the dedupe keys make repeats free.
CREATE OR REPLACE FUNCTION tax_impact_notify(p jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_readers uuid[];
  v_period text := (p->'period'->>'ec_year') || '-' || (p->'period'->>'ec_month');
  v_label text := p->'period'->>'label';
  v_days int := (p->'period'->>'days_left')::int;
  v_n int := 0;
  i jsonb;
  v_pay numeric;
BEGIN
  SELECT COALESCE(array_agg(id), '{}') INTO v_readers FROM user_profiles
  WHERE account_status IS DISTINCT FROM 'disabled'
    AND (role::text IN ('admin', 'executive', 'finance') OR COALESCE(is_tax_officer, false));

  FOR i IN SELECT x FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) x WHERE (x->>'escalated')::boolean LOOP
    v_n := v_n + notify(v_readers, 'tax.escalated',
      'T' || (i->>'rank') || ' went to the front: ' || COALESCE(i->>'code', 'a request'),
      concat_ws(' · ', i->>'vendor', notify_etb((i->>'vat')::numeric) || ' VAT',
        round((i->>'share')::numeric * 100) || '% of the ' || v_label || ' gap')
        || ' — ahead of ' || COALESCE(i->>'jumped', '0') || ' smaller items already waiting.',
      '/tax-impact#' || (i->>'id'), 'tax_item', (i->>'id')::uuid, NULL,
      'tax.escalated:' || (i->>'id') || ':' || v_period);
  END LOOP;

  IF v_days BETWEEN 0 AND COALESCE((p->'settings'->>'countdown_days')::int, 7) THEN
    SELECT COALESCE(sum((x->>'vat')::numeric), 0) INTO v_pay
    FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) x
    WHERE x->>'cls' = 'vat' AND x->>'queue' = 'pay';
    IF v_pay >= 1 THEN
      v_n := v_n + notify(v_readers, 'tax.month_closing',
        v_label || ' closes in ' || v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END,
        notify_etb(v_pay) || ' of VAT is approved but not paid. VAT counts in the month a bill is paid.',
        '/finance/payments', NULL, NULL, NULL, 'tax.month_closing:' || v_period);
    END IF;
  END IF;
  RETURN v_n;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tax_impact_notify failed: %', SQLERRM;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION tax_impact_notify(jsonb) FROM PUBLIC, anon, authenticated;

-- Recompute when stale, cache, notify. Used by tax_impact_items and the hourly job (425).
CREATE OR REPLACE FUNCTION tax_impact_recompute(p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j jsonb; t timestamptz;
BEGIN
  SELECT payload, computed_at INTO j, t FROM tax_impact_cache;
  IF p_force OR j IS NULL OR t < now() - interval '10 minutes' THEN
    j := tax_impact_compute(); t := now();
    INSERT INTO tax_impact_cache (id, computed_at, payload) VALUES (true, t, j)
    ON CONFLICT (id) DO UPDATE SET computed_at = EXCLUDED.computed_at, payload = EXCLUDED.payload;
    PERFORM tax_impact_notify(j);
  END IF;
  RETURN j || jsonb_build_object('computed_at', t);
END $$;
REVOKE ALL ON FUNCTION tax_impact_recompute(boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION tax_impact_items()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see tax impact';
  END IF;
  RETURN tax_impact_recompute(false) || jsonb_build_object(
    'seen', COALESCE((SELECT jsonb_agg(item_id) FROM tax_impact_seen WHERE user_id = auth.uid()), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION tax_impact_refresh()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT tax_plan_reader() THEN
    RAISE EXCEPTION 'Only the tax officer, admin, finance or executive can see tax impact';
  END IF;
  RETURN tax_impact_recompute(true) || jsonb_build_object(
    'seen', COALESCE((SELECT jsonb_agg(item_id) FROM tax_impact_seen WHERE user_id = auth.uid()), '[]'::jsonb));
END $$;

-- Marking escalations "seen" on the tax pages also reads their notifications.
CREATE OR REPLACE FUNCTION trg_tax_seen_reads_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE notifications SET read_at = now()
  WHERE user_id = NEW.user_id AND entity_id = NEW.item_id AND kind = 'tax.escalated' AND read_at IS NULL;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_tax_seen_reads_notification
  AFTER INSERT ON tax_impact_seen
  FOR EACH ROW EXECUTE FUNCTION trg_tax_seen_reads_notification();
