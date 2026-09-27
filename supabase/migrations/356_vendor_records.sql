-- 356 — Vendor records: verify bank changes, real vendor types, find and
-- merge duplicates, and one set of figures for what a vendor is owed
--
-- A review of the 484 vendors found:
--
--  * enforce_vendor_maker_checker() (vendor maker-checker) puts a vendor
--    back to 'pending_verification' when its TIN or bank account changes,
--    and verify_vendor_record() lets someone from the other department
--    confirm it — but no screen ever called it. 47 vendors were waiting,
--    40 of them already paid 2.0M ETB. Changing only the bank (bank_id)
--    didn't reset it at all. Now bank_id counts too, every change to these
--    fields is kept in vendor_detail_changes (so the checker sees what
--    changed, from what), and v_vendor_verification_queue lists what is
--    waiting. Comparisons ignore spaces, so tidying a number isn't a change.
--  * The form offered five types (Supplier, Service Provider, …) while the
--    records say "Supplier with VAT" (319), "Supplier with no receipt"
--    (71), Labor Broker, Government, TOT … — so a VAT-registered supplier
--    couldn't be entered as one. vendor_types is now the list, and
--    vendors.vendor_type must be one of them.
--  * Categories drifted ("Building Materials" / "Building Materials ",
--    "Maintainance", "tile"); names had stray spaces.
--  * Probable duplicates: 12 pairs share a bank account, one pair a TIN,
--    and names like "MARD Trading PLC" / "MARDA TRADING PLC". Nothing
--    warned at entry. find_vendor_matches() now does (the form calls it),
--    v_vendor_duplicate_pairs lists them for review and merge_vendors()
--    moves everything onto the kept vendor. The *_frozen and
--    expenses_dedup_backup snapshot tables are left as they were.
--  * The list and the vendor page disagreed on money (paid vs every
--    expense ever raised, capped at 200). v_vendor_money is the one
--    definition: paid, sent awaiting the bank, advances, approved not yet
--    paid, awaiting approval, committed on open POs, credit left.
--  * 13 POs name a vendor that has no record; link_bundle_vendor() links
--    them without reopening the PO.

SET search_path TO public;

-- ── 1. Vendor types ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_types (
  code        text PRIMARY KEY,
  hint        text NOT NULL,
  gives_vat_receipt boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true
);
INSERT INTO vendor_types (code, hint, gives_vat_receipt, sort_order) VALUES
  ('Supplier with VAT',        'VAT-registered — gives a VAT receipt; input VAT can be claimed.', true, 1),
  ('Supplier with TOT',        'Pays turnover tax — receipt without VAT.', false, 2),
  ('Supplier with no receipt', 'Gives no tax receipt — the purchase needs a receipt arrangement.', false, 3),
  ('Foreign Supplier',         'Outside Ethiopia — imports and foreign payments.', false, 4),
  ('Service Provider',         'Services rather than goods (repairs, printing, design…).', false, 10),
  ('Contractor',               'Takes on part of a project''s work.', false, 11),
  ('Labor Broker',             'Supplies workers for labour requisitions.', false, 12),
  ('Facilitation',             'Handles receipts or clearance on our behalf.', false, 13),
  ('Individual',               'A person, not a business.', false, 20),
  ('Staff',                    'One of our own staff, paid as a payee.', false, 21),
  ('Refundee',                 'Someone we are paying back.', false, 22),
  ('Government',               'Government office or agency.', false, 23),
  ('Store',                    'Retail shop.', false, 24),
  ('Supplier',                 'Supplier whose tax status is not recorded yet — pick VAT, TOT or no receipt.', false, 90),
  ('Other',                    'Anything else.', false, 99)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE vendor_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_types_read ON vendor_types;
CREATE POLICY vendor_types_read ON vendor_types FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS vendor_types_admin ON vendor_types;
CREATE POLICY vendor_types_admin ON vendor_types FOR ALL
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
REVOKE ALL ON vendor_types FROM anon;

UPDATE vendors SET vendor_type = NULL WHERE btrim(COALESCE(vendor_type, '')) = '' AND vendor_type IS NOT NULL;
UPDATE vendors v SET vendor_type = t.code
  FROM vendor_types t WHERE lower(btrim(v.vendor_type)) = lower(t.code) AND v.vendor_type <> t.code;
INSERT INTO vendor_types (code, hint, sort_order)
  SELECT DISTINCT vendor_type, 'Added from existing records.', 95 FROM vendors
   WHERE vendor_type IS NOT NULL AND vendor_type NOT IN (SELECT code FROM vendor_types)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_vendor_type_fkey;
ALTER TABLE vendors ADD CONSTRAINT vendors_vendor_type_fkey
  FOREIGN KEY (vendor_type) REFERENCES vendor_types(code) ON UPDATE CASCADE;

-- ── 2. Tidy values ───────────────────────────────────────────────────────
-- Named trg_a_… so it runs before the maker-checker trigger.
CREATE OR REPLACE FUNCTION tidy_vendor_record()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.vendor_name    := btrim(regexp_replace(NEW.vendor_name, '\s+', ' ', 'g'));
  NEW.category       := NULLIF(btrim(regexp_replace(COALESCE(NEW.category, ''), '\s+', ' ', 'g')), '');
  NEW.vendor_type    := NULLIF(btrim(COALESCE(NEW.vendor_type, '')), '');
  NEW.tin            := NULLIF(regexp_replace(COALESCE(NEW.tin, ''), '\s', '', 'g'), '');
  NEW.bank_account   := NULLIF(regexp_replace(COALESCE(NEW.bank_account, ''), '\s', '', 'g'), '');
  NEW.phone_contact  := NULLIF(btrim(COALESCE(NEW.phone_contact, '')), '');
  NEW.email          := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_a_tidy_vendor_record ON vendors;
CREATE TRIGGER trg_a_tidy_vendor_record BEFORE INSERT OR UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION tidy_vendor_record();

-- Maker-checker, now also on the bank itself, ignoring whitespace-only edits.
CREATE OR REPLACE FUNCTION enforce_vendor_maker_checker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.entered_by := auth.uid();
    NEW.entered_at := NOW();
    NEW.verification_status := 'pending_verification';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    RETURN NEW;
  END IF;

  -- TIN or bank details changed — the fraud-sensitive fields. Resets to
  -- pending_verification regardless of who is editing; entered_by/at
  -- re-stamp to THIS edit, since it's this edit that needs checking.
  IF regexp_replace(COALESCE(NEW.tin, ''), '\s', '', 'g') IS DISTINCT FROM regexp_replace(COALESCE(OLD.tin, ''), '\s', '', 'g')
     OR regexp_replace(COALESCE(NEW.bank_account, ''), '\s', '', 'g') IS DISTINCT FROM regexp_replace(COALESCE(OLD.bank_account, ''), '\s', '', 'g')
     OR NEW.bank_id IS DISTINCT FROM OLD.bank_id THEN
    NEW.verification_status := 'pending_verification';
    NEW.entered_by := auth.uid();
    NEW.entered_at := NOW();
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  END IF;
  RETURN NEW;
END $$;

-- One-off clean-up of names and categories. TIN and bank are left alone
-- here so no vendor is sent back for verification by a migration.
ALTER TABLE vendors DISABLE TRIGGER trg_enforce_vendor_maker_checker;
UPDATE vendors SET vendor_name = btrim(regexp_replace(vendor_name, '\s+', ' ', 'g'))
 WHERE vendor_name <> btrim(regexp_replace(vendor_name, '\s+', ' ', 'g'));
UPDATE vendors SET category = NULLIF(btrim(regexp_replace(category, '\s+', ' ', 'g')), '')
 WHERE category IS NOT NULL AND category IS DISTINCT FROM NULLIF(btrim(regexp_replace(category, '\s+', ' ', 'g')), '');
UPDATE vendors SET category = CASE lower(category)
    WHEN 'maintainance' THEN 'Maintenance'
    WHEN 'stationary'   THEN 'Stationery'
    WHEN 'tile'         THEN 'Tile'
    WHEN 'sub contractor' THEN 'Subcontractor'
    ELSE category END
 WHERE lower(category) IN ('maintainance', 'stationary', 'tile', 'sub contractor');
ALTER TABLE vendors ENABLE TRIGGER trg_enforce_vendor_maker_checker;

-- ── 3. What changed, for the checker ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_detail_changes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id   uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  field       text NOT NULL CHECK (field IN ('tin', 'bank_account', 'bank')),
  old_value   text,
  new_value   text,
  changed_by  uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_detail_changes_vendor ON vendor_detail_changes (vendor_id, changed_at DESC);
ALTER TABLE vendor_detail_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_detail_changes_read ON vendor_detail_changes;
CREATE POLICY vendor_detail_changes_read ON vendor_detail_changes FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'procurement_officer']::user_role[]));
REVOKE ALL ON vendor_detail_changes FROM anon;

CREATE OR REPLACE FUNCTION log_vendor_detail_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o_tin text; o_acct text; o_bank uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN o_tin := OLD.tin; o_acct := OLD.bank_account; o_bank := OLD.bank_id; END IF;
  IF COALESCE(NEW.tin, '') IS DISTINCT FROM COALESCE(o_tin, '') THEN
    INSERT INTO vendor_detail_changes (vendor_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'tin', o_tin, NEW.tin, auth.uid());
  END IF;
  IF COALESCE(NEW.bank_account, '') IS DISTINCT FROM COALESCE(o_acct, '') THEN
    INSERT INTO vendor_detail_changes (vendor_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'bank_account', o_acct, NEW.bank_account, auth.uid());
  END IF;
  IF NEW.bank_id IS DISTINCT FROM o_bank THEN
    INSERT INTO vendor_detail_changes (vendor_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'bank',
      (SELECT account_name FROM accounts WHERE id = o_bank),
      (SELECT account_name FROM accounts WHERE id = NEW.bank_id), auth.uid());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_log_vendor_detail_change ON vendors;
CREATE TRIGGER trg_log_vendor_detail_change AFTER INSERT OR UPDATE OF tin, bank_account, bank_id ON vendors
  FOR EACH ROW EXECUTE FUNCTION log_vendor_detail_change();

-- ── 4. Money, one definition ─────────────────────────────────────────────
-- paid: settled, sent (awaiting the bank) or paid as an advance, plus
-- part-payments; owed: approved but not yet sent; archived expenses count
-- toward history but not toward what is open (they're off the pay queues).
CREATE OR REPLACE VIEW v_vendor_money WITH (security_invoker = on) AS
WITH e AS (
  SELECT vendor_id,
    sum(CASE WHEN payment_state IN ('paid', 'sent', 'advance') OR payment_status THEN amount_etb
             WHEN partially_paid THEN COALESCE(partial_paid_amount, 0) ELSE 0 END) AS paid,
    sum(CASE WHEN payment_state = 'sent' THEN amount_etb ELSE 0 END) AS sent_awaiting_bank,
    sum(CASE WHEN payment_state = 'advance' THEN amount_etb ELSE 0 END) AS advances_open,
    sum(CASE WHEN NOT COALESCE(is_archived, false) AND approval_status = 'finance_approved'
              AND COALESCE(payment_state, 'unpaid') IN ('unpaid', 'approved_to_pay') AND NOT COALESCE(payment_status, false)
             THEN amount_etb - CASE WHEN partially_paid THEN COALESCE(partial_paid_amount, 0) ELSE 0 END ELSE 0 END) AS owed,
    sum(CASE WHEN NOT COALESCE(is_archived, false) AND approval_status IN ('pending', 'manager_approved') THEN amount_etb ELSE 0 END) AS awaiting_approval,
    count(*) FILTER (WHERE approval_status <> 'rejected') AS expense_count,
    max(COALESCE(paid_date::date, date)) FILTER (WHERE approval_status <> 'rejected') AS last_expense_on,
    min(date) AS first_expense_on
  FROM expenses
  WHERE vendor_id IS NOT NULL AND approval_status <> 'rejected'
  GROUP BY vendor_id
),
b AS (
  SELECT b.vendor_id,
    sum(b.total_value) FILTER (WHERE b.status::text IN ('submitted', 'approved')
      OR (b.status::text = 'ordered' AND NOT EXISTS (SELECT 1 FROM expenses x WHERE x.sourcing_bundle_id = b.id AND x.approval_status <> 'rejected'))) AS committed,
    count(*) FILTER (WHERE b.status::text NOT IN ('drafting', 'cancelled')) AS po_count,
    (max(b.created_at) FILTER (WHERE b.status::text <> 'cancelled'))::date AS last_po_on
  FROM sourcing_bundles b
  WHERE b.vendor_id IS NOT NULL
  GROUP BY b.vendor_id
),
c AS (
  SELECT vendor_id, sum(remaining_amount_etb) AS credit_left
  FROM v_vendor_credits GROUP BY vendor_id
)
SELECT v.id AS vendor_id,
  COALESCE(e.paid, 0) AS paid,
  COALESCE(e.sent_awaiting_bank, 0) AS sent_awaiting_bank,
  COALESCE(e.advances_open, 0) AS advances_open,
  COALESCE(e.owed, 0) AS owed,
  COALESCE(e.awaiting_approval, 0) AS awaiting_approval,
  COALESCE(b.committed, 0) AS committed,
  COALESCE(c.credit_left, 0) AS credit_left,
  COALESCE(e.expense_count, 0) AS expense_count,
  COALESCE(b.po_count, 0) AS po_count,
  NULLIF(greatest(COALESCE(e.last_expense_on, '1900-01-01'), COALESCE(b.last_po_on, '1900-01-01')), '1900-01-01') AS last_used_on,
  e.first_expense_on
FROM vendors v
LEFT JOIN e ON e.vendor_id = v.id
LEFT JOIN b ON b.vendor_id = v.id
LEFT JOIN c ON c.vendor_id = v.id;

-- ── 5. Delivery record and what was bought ───────────────────────────────
CREATE OR REPLACE VIEW v_vendor_po_delivery WITH (security_invoker = on) AS
SELECT b.id AS bundle_id, b.vendor_id, b.bundle_code, b.status::text AS status, b.total_value,
  b.ordered_at, b.expected_delivery_date,
  g.first_received_at,
  CASE WHEN b.expected_delivery_date IS NOT NULL AND g.first_received_at IS NOT NULL
       THEN g.first_received_at::date - b.expected_delivery_date END AS days_late,
  (b.status::text = 'ordered' AND g.first_received_at IS NULL AND b.expected_delivery_date < CURRENT_DATE) AS overdue,
  COALESCE(q.qty_received, 0) AS qty_received,
  COALESCE(q.qty_rejected, 0) AS qty_rejected,
  COALESCE(q.qty_damaged, 0) AS qty_damaged
FROM sourcing_bundles b
LEFT JOIN LATERAL (
  SELECT min(n.received_at) AS first_received_at FROM goods_received_notes n WHERE n.sourcing_bundle_id = b.id
) g ON true
LEFT JOIN LATERAL (
  SELECT sum(i.quantity_received) AS qty_received, sum(i.quantity_rejected) AS qty_rejected, sum(i.quantity_damaged) AS qty_damaged
  FROM goods_received_notes n JOIN goods_received_note_items i ON i.grn_id = n.id
  WHERE n.sourcing_bundle_id = b.id
) q ON true
WHERE b.vendor_id IS NOT NULL AND b.status::text NOT IN ('drafting', 'cancelled');

CREATE OR REPLACE VIEW v_vendor_items_bought WITH (security_invoker = on) AS
SELECT b.vendor_id,
  COALESCE(oi.stock_item_id::text, 'name:' || stock_name_key(oi.item_name)) AS item_key,
  oi.stock_item_id,
  (array_agg(COALESCE(si.item_name, oi.item_name) ORDER BY COALESCE(b.ordered_at, b.created_at) DESC))[1] AS item_name,
  (array_agg(oi.unit ORDER BY COALESCE(b.ordered_at, b.created_at) DESC))[1] AS unit,
  count(DISTINCT b.id) AS times_bought,
  sum(sbi.quantity_actual) AS total_qty,
  sum(sbi.quantity_actual * sbi.unit_price_actual) AS total_value,
  (array_agg(sbi.unit_price_actual ORDER BY COALESCE(b.ordered_at, b.created_at) DESC))[1] AS last_price,
  min(sbi.unit_price_actual) AS min_price,
  max(sbi.unit_price_actual) AS max_price,
  max(COALESCE(b.ordered_at, b.created_at))::date AS last_bought_on
FROM sourcing_bundle_items sbi
JOIN sourcing_bundles b ON b.id = sbi.bundle_id
JOIN order_items oi ON oi.id = sbi.order_item_id
LEFT JOIN stock_items si ON si.id = oi.stock_item_id
WHERE b.vendor_id IS NOT NULL AND b.status::text NOT IN ('drafting', 'cancelled') AND sbi.unit_price_actual > 0
GROUP BY b.vendor_id, COALESCE(oi.stock_item_id::text, 'name:' || stock_name_key(oi.item_name)), oi.stock_item_id;

-- ── 6. Verification queue ────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_vendor_verification_queue WITH (security_invoker = on) AS
SELECT v.id, v.vendor_name, v.vendor_type, v.tin, v.bank_account, v.bank_id, a.account_name AS bank_name,
  v.entered_by, up.full_name AS entered_by_name, up.role::text AS entered_by_role, v.entered_at,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('field', c.field, 'old', c.old_value, 'new', c.new_value, 'at', c.changed_at) ORDER BY c.changed_at DESC), '[]')
     FROM vendor_detail_changes c WHERE c.vendor_id = v.id AND c.changed_at >= v.entered_at - interval '1 minute') AS changes,
  COALESCE(m.paid, 0) AS paid, COALESCE(m.owed, 0) AS owed, COALESCE(m.awaiting_approval, 0) AS awaiting_approval,
  (SELECT COALESCE(sum(x.amount_etb), 0) FROM expenses x
    WHERE x.vendor_id = v.id AND x.payment_state IN ('paid', 'sent', 'advance')
      AND COALESCE(x.payment_state_changed_at, x.paid_date, x.updated_at) >= v.entered_at) AS paid_since_change
FROM vendors v
LEFT JOIN accounts a ON a.id = v.bank_id
LEFT JOIN user_profiles up ON up.id = v.entered_by
LEFT JOIN v_vendor_money m ON m.vendor_id = v.id
WHERE v.verification_status = 'pending_verification';

-- ── 7. Duplicates ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION vendor_name_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(string_agg(w, ' ' ORDER BY w), '')
  FROM unnest(regexp_split_to_array(btrim(regexp_replace(
         regexp_replace(lower(COALESCE(p, '')), '\mp\.\s*l\.\s*c\.?|\ms\.\s*c\.', ' ', 'g'),
         '[^a-z0-9]+', ' ', 'g')), '\s+')) w
  WHERE w <> '' AND w NOT IN ('plc', 'sc', 'share', 'company', 'co', 'ltd', 'llc', 'pvt', 'the', 'and')
$$;

CREATE TABLE IF NOT EXISTS vendor_duplicate_dismissals (
  vendor_a     uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  vendor_b     uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  dismissed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_a, vendor_b),
  CHECK (vendor_a < vendor_b)
);
CREATE INDEX IF NOT EXISTS idx_vendor_dup_dismissals_b ON vendor_duplicate_dismissals (vendor_b);
ALTER TABLE vendor_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_dup_dismissals_read ON vendor_duplicate_dismissals;
CREATE POLICY vendor_dup_dismissals_read ON vendor_duplicate_dismissals FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE ALL ON vendor_duplicate_dismissals FROM anon;

CREATE TABLE IF NOT EXISTS vendor_merges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kept_vendor_id  uuid REFERENCES vendors(id) ON DELETE SET NULL,
  kept_name       text NOT NULL,
  merged_vendor_id uuid NOT NULL,
  merged_name     text NOT NULL,
  merged_record   jsonb NOT NULL,
  moved           jsonb NOT NULL DEFAULT '{}',
  merged_by       uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  merged_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vendor_merges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_merges_read ON vendor_merges;
CREATE POLICY vendor_merges_read ON vendor_merges FOR SELECT
  USING (get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'procurement_officer']::user_role[]));
REVOKE ALL ON vendor_merges FROM anon;

CREATE OR REPLACE VIEW v_vendor_duplicate_pairs WITH (security_invoker = on) AS
WITH s AS (
  SELECT id, vendor_name_key(vendor_name) AS k,
         NULLIF(regexp_replace(COALESCE(bank_account, ''), '\D', '', 'g'), '') AS acct,
         NULLIF(regexp_replace(COALESCE(tin, ''), '\D', '', 'g'), '') AS tin
  FROM vendors
)
SELECT a.id AS vendor_a, b.id AS vendor_b,
  array_remove(ARRAY[
    CASE WHEN a.acct IS NOT NULL AND a.acct = b.acct AND length(a.acct) >= 6 THEN 'same_bank_account' END,
    CASE WHEN a.tin IS NOT NULL AND a.tin = b.tin THEN 'same_tin' END,
    CASE WHEN a.k <> '' AND a.k = b.k THEN 'same_name' END,
    CASE WHEN a.k <> b.k AND similarity(a.k, b.k) >= 0.7 THEN 'similar_name' END
  ], NULL) AS reasons,
  round(similarity(a.k, b.k)::numeric, 2) AS name_score
FROM s a
JOIN s b ON a.id < b.id
  AND ((a.acct IS NOT NULL AND a.acct = b.acct AND length(a.acct) >= 6)
    OR (a.tin IS NOT NULL AND a.tin = b.tin)
    OR (a.k <> '' AND a.k = b.k)
    OR similarity(a.k, b.k) >= 0.7)
WHERE NOT EXISTS (SELECT 1 FROM vendor_duplicate_dismissals d WHERE d.vendor_a = a.id AND d.vendor_b = b.id);

-- For the form: vendors that look like the one being entered.
CREATE OR REPLACE FUNCTION find_vendor_matches(p_name text, p_tin text DEFAULT NULL, p_bank_account text DEFAULT NULL, p_exclude uuid DEFAULT NULL)
RETURNS TABLE (id uuid, vendor_name text, active boolean, reasons text[], name_score numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH q AS (
    SELECT vendor_name_key(p_name) AS k,
           NULLIF(regexp_replace(COALESCE(p_tin, ''), '\D', '', 'g'), '') AS tin,
           NULLIF(regexp_replace(COALESCE(p_bank_account, ''), '\D', '', 'g'), '') AS acct
  ), s AS (
    SELECT v.id, v.vendor_name, COALESCE(v.active, true) AS active,
      array_remove(ARRAY[
        CASE WHEN q.acct IS NOT NULL AND length(q.acct) >= 6 AND regexp_replace(COALESCE(v.bank_account, ''), '\D', '', 'g') = q.acct THEN 'same_bank_account' END,
        CASE WHEN q.tin IS NOT NULL AND regexp_replace(COALESCE(v.tin, ''), '\D', '', 'g') = q.tin THEN 'same_tin' END,
        CASE WHEN q.k <> '' AND vendor_name_key(v.vendor_name) = q.k THEN 'same_name' END,
        CASE WHEN q.k <> '' AND vendor_name_key(v.vendor_name) <> q.k AND similarity(vendor_name_key(v.vendor_name), q.k) >= 0.6 THEN 'similar_name' END
      ], NULL) AS reasons,
      round(similarity(vendor_name_key(v.vendor_name), q.k)::numeric, 2) AS name_score
    FROM vendors v, q
    WHERE auth.uid() IS NOT NULL AND (p_exclude IS NULL OR v.id <> p_exclude)
  )
  SELECT * FROM s WHERE cardinality(reasons) > 0
  ORDER BY ('same_bank_account' = ANY (reasons) OR 'same_tin' = ANY (reasons)) DESC, name_score DESC
  LIMIT 5
$$;
REVOKE ALL ON FUNCTION find_vendor_matches(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION find_vendor_matches(text, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION assert_vendor_admin_role()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'executive', 'finance', 'procurement_officer') THEN
    RAISE EXCEPTION 'Only finance, procurement or admin can change vendor records this way' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION dismiss_vendor_duplicates(p_ids uuid[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM assert_vendor_admin_role();
  INSERT INTO vendor_duplicate_dismissals (vendor_a, vendor_b, dismissed_by)
  SELECT a, b, auth.uid() FROM unnest(p_ids) a, unnest(p_ids) b WHERE a < b
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION dismiss_vendor_duplicates(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dismiss_vendor_duplicates(uuid[]) TO authenticated;

-- A PO's vendor is frozen once it leaves drafting. Two things may still
-- set it: linking a free-text vendor to its record, and a vendor merge.
-- Both go through the functions below, which raise this flag.
CREATE OR REPLACE FUNCTION enforce_bundle_drafting_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status sourcing_bundle_status;
  v_relink boolean := COALESCE(current_setting('kuncho.vendor_relink', true), '') = 'on';
BEGIN
  v_status := COALESCE(OLD.status, 'drafting');
  IF TG_OP = 'DELETE' THEN
    IF v_status != 'drafting' THEN
      RAISE EXCEPTION 'Cannot delete a sourcing bundle once it has left drafting (current: %)', v_status;
    END IF;
    RETURN OLD;
  END IF;
  IF v_status != 'drafting' AND NEW.status = OLD.status
     AND ((NEW.vendor_id IS DISTINCT FROM OLD.vendor_id AND NOT v_relink)
       OR NEW.vendor_name IS DISTINCT FROM OLD.vendor_name
       OR NEW.expected_delivery_date IS DISTINCT FROM OLD.expected_delivery_date
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.procurement_officer_id IS DISTINCT FROM OLD.procurement_officer_id
       OR NEW.discount_kind IS DISTINCT FROM OLD.discount_kind
       OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
       OR NEW.discount_reason IS DISTINCT FROM OLD.discount_reason) THEN
    RAISE EXCEPTION 'Cannot edit a sourcing bundle once it has left drafting (current: %)', v_status;
  END IF;
  RETURN NEW;
END;
$$;

-- Move everything that points at each of p_merge onto p_keep, then delete
-- them. The kept vendor takes any blank fields from the merged ones; if
-- that fills in a TIN or bank, it goes back for verification as usual.
CREATE OR REPLACE FUNCTION merge_vendors(p_keep uuid, p_merge uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_keep vendors; v_dup vendors; v_id uuid; v_moved jsonb; v_out jsonb := '[]'; n int;
  t record;
BEGIN
  PERFORM assert_vendor_admin_role();
  SELECT * INTO v_keep FROM vendors WHERE id = p_keep FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The vendor to keep no longer exists'; END IF;
  PERFORM set_config('kuncho.vendor_relink', 'on', true);

  FOREACH v_id IN ARRAY COALESCE(p_merge, '{}') LOOP
    CONTINUE WHEN v_id = p_keep;
    SELECT * INTO v_dup FROM vendors WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A vendor to merge no longer exists (%)', v_id; END IF;

    v_moved := '{}';
    FOR t IN SELECT * FROM (VALUES
      ('expenses', 'vendor_id'), ('orders', 'recommended_vendor_id'), ('transportation_requests', 'vendor_id'),
      ('vendor_receipt_facilitation', 'vendor_id'), ('cpo_bonds', 'vendor_id'), ('sourcing_bundles', 'vendor_id'),
      ('vendor_attachments', 'vendor_id'), ('labor_requisitions', 'gang_leader_vendor_id'),
      ('subcontractor_engagements', 'vendor_id'), ('vendor_receipts', 'vendor_id'), ('properties', 'landlord_vendor_id'),
      ('market_prices', 'source_vendor_id'), ('fixed_assets', 'purchase_vendor_id'), ('site_material_receipts', 'vendor_id'),
      ('vendor_credits', 'vendor_id'), ('locations', 'vendor_id'), ('vendor_detail_changes', 'vendor_id')
    ) AS x(tbl, col) LOOP
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', t.tbl, t.col, t.col) USING p_keep, v_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN v_moved := v_moved || jsonb_build_object(t.tbl, n); END IF;
    END LOOP;

    UPDATE vendors k SET
      tin            = COALESCE(k.tin, v_dup.tin),
      bank_account   = COALESCE(k.bank_account, v_dup.bank_account),
      bank_id        = COALESCE(k.bank_id, CASE WHEN k.bank_account IS NULL THEN v_dup.bank_id END),
      phone_contact  = COALESCE(k.phone_contact, v_dup.phone_contact),
      vendor_type    = COALESCE(k.vendor_type, v_dup.vendor_type),
      category       = COALESCE(k.category, v_dup.category),
      location       = COALESCE(k.location, v_dup.location),
      email          = COALESCE(k.email, v_dup.email),
      address        = COALESCE(k.address, v_dup.address),
      contact_person = COALESCE(k.contact_person, v_dup.contact_person),
      payment_terms  = COALESCE(k.payment_terms, v_dup.payment_terms),
      website        = COALESCE(k.website, v_dup.website),
      wth_eligible   = COALESCE(k.wth_eligible, false) OR COALESCE(v_dup.wth_eligible, false),
      requires_payment_confirmation = k.requires_payment_confirmation OR v_dup.requires_payment_confirmation,
      active         = COALESCE(k.active, true) OR COALESCE(v_dup.active, false),
      notes          = concat_ws(E'\n', k.notes, format('Merged from "%s"%s on %s.', v_dup.vendor_name,
                         CASE WHEN v_dup.bank_account IS NOT NULL AND v_dup.bank_account IS DISTINCT FROM COALESCE(k.bank_account, v_dup.bank_account)
                              THEN ' (its bank account ' || v_dup.bank_account || ' was not kept)' ELSE '' END, CURRENT_DATE))
    WHERE k.id = p_keep;

    INSERT INTO vendor_merges (kept_vendor_id, kept_name, merged_vendor_id, merged_name, merged_record, moved, merged_by)
    VALUES (p_keep, v_keep.vendor_name, v_id, v_dup.vendor_name, to_jsonb(v_dup), v_moved, auth.uid());
    DELETE FROM vendors WHERE id = v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'name', v_dup.vendor_name, 'moved', v_moved);
  END LOOP;

  PERFORM set_config('kuncho.vendor_relink', '', true);
  RETURN jsonb_build_object('kept', p_keep, 'merged', v_out);
END $$;
REVOKE ALL ON FUNCTION merge_vendors(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION merge_vendors(uuid, uuid[]) TO authenticated;

-- ── 8. Missing details and unlinked POs ──────────────────────────────────
CREATE OR REPLACE VIEW v_vendor_missing_details WITH (security_invoker = on) AS
SELECT v.id, v.vendor_name, v.vendor_type, v.verification_status,
  array_remove(ARRAY[
    CASE WHEN v.tin IS NULL THEN 'tin' END,
    CASE WHEN v.bank_account IS NULL THEN 'bank_account' END,
    CASE WHEN v.bank_id IS NULL AND v.bank_account IS NOT NULL THEN 'bank' END,
    CASE WHEN v.phone_contact IS NULL THEN 'phone' END,
    CASE WHEN v.vendor_type IS NULL OR v.vendor_type = 'Supplier' THEN 'type' END,
    CASE WHEN v.category IS NULL THEN 'category' END
  ], NULL) AS missing,
  COALESCE(m.paid, 0) AS paid, COALESCE(m.owed, 0) AS owed, m.last_used_on
FROM vendors v
LEFT JOIN v_vendor_money m ON m.vendor_id = v.id
WHERE COALESCE(v.active, true)
  AND (v.tin IS NULL OR v.bank_account IS NULL OR (v.bank_id IS NULL AND v.bank_account IS NOT NULL)
       OR v.phone_contact IS NULL OR v.vendor_type IS NULL OR v.vendor_type = 'Supplier' OR v.category IS NULL);

CREATE OR REPLACE VIEW v_bundles_unlinked_vendor WITH (security_invoker = on) AS
SELECT b.id AS bundle_id, b.bundle_code, b.status::text AS status, btrim(b.vendor_name) AS vendor_name, b.total_value, b.created_at,
  s.id AS suggested_vendor_id, s.vendor_name AS suggested_vendor_name, s.score AS suggested_score
FROM sourcing_bundles b
LEFT JOIN LATERAL (
  SELECT v.id, v.vendor_name, round(similarity(vendor_name_key(v.vendor_name), vendor_name_key(b.vendor_name))::numeric, 2) AS score
  FROM vendors v
  WHERE similarity(vendor_name_key(v.vendor_name), vendor_name_key(b.vendor_name)) >= 0.4
  ORDER BY similarity(vendor_name_key(v.vendor_name), vendor_name_key(b.vendor_name)) DESC LIMIT 1
) s ON true
WHERE b.vendor_id IS NULL AND btrim(COALESCE(b.vendor_name, '')) <> '' AND b.status::text <> 'cancelled';

-- Link a PO that names a vendor as text to the vendor record (and its
-- expenses that have no vendor either). Only fills a blank; never swaps.
CREATE OR REPLACE FUNCTION link_bundle_vendor(p_bundle_id uuid, p_vendor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_vendor_admin_role();
  IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = p_vendor_id) THEN RAISE EXCEPTION 'Vendor not found'; END IF;
  PERFORM set_config('kuncho.vendor_relink', 'on', true);
  UPDATE sourcing_bundles SET vendor_id = p_vendor_id WHERE id = p_bundle_id AND vendor_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That PO already has a vendor, or no longer exists'; END IF;
  UPDATE expenses SET vendor_id = p_vendor_id WHERE sourcing_bundle_id = p_bundle_id AND vendor_id IS NULL;
  PERFORM set_config('kuncho.vendor_relink', '', true);
END $$;
REVOKE ALL ON FUNCTION link_bundle_vendor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION link_bundle_vendor(uuid, uuid) TO authenticated;

REVOKE ALL ON v_vendor_money, v_vendor_po_delivery, v_vendor_items_bought, v_vendor_verification_queue,
  v_vendor_duplicate_pairs, v_vendor_missing_details, v_bundles_unlinked_vendor FROM anon;
GRANT SELECT ON v_vendor_money, v_vendor_po_delivery, v_vendor_items_bought, v_vendor_verification_queue,
  v_vendor_duplicate_pairs, v_vendor_missing_details, v_bundles_unlinked_vendor TO authenticated;
