-- 512 — whose bank account each payment landed in
--
-- 506 put the payee or payer's name and account number on each bank line,
-- and recognised an account when a vendor or staff record held it. That
-- missed most of what is already known:
--   * a line matched to an expense, salary, VRF or sale says whose account
--     the money went to (or came from). 170 of the 190 accounts on CBE
--     lines are already settled this way; 21 of them are clients, whose
--     records hold no account at all;
--   * staff hold several accounts (staff_bank_accounts, 294), not only the
--     one mirrored on staff.bank_account;
--   * some vendor records list several accounts as text ("BOA - 226001522,
--     1000…"), which 506 read as one long number;
--   * two vendor records can hold the same account (Fetiya Bedri and Fetiya
--     Mehdi); what was actually paid says which one it is.
--
-- WHAT THIS ADDS
--   bank_payee_links          a person's word on whose an account is. It
--                             overrides everything else and is the only
--                             thing stored: the rest is read live.
--   v_bank_line_paid_party    each named line and the vendor, staff member
--                             or client its match paid or was paid by.
--   bank_account_owners()     whose an account is: linked by a person, else
--                             paid there before and/or held on record.
--   bank_line_party()         now reads bank_account_owners() first.
--   suggest_bank_line_matches a record for the account's owner is near
--                             certain; one for someone else is pushed down.
--   bank_payees()             every account on the lines, whose it is and
--                             how we know, for the Payees list.
--   bank_payee_link/unlink()  say whose an account is, or take it back.

-- ── 512a (applied on its own) ───────────────────────────────────────────────
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS public.bank_payee_links (
  account_number text PRIMARY KEY CHECK (account_number ~ '^\d{8,}$'),
  vendor_id      uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  staff_id       uuid REFERENCES public.staff(id) ON DELETE CASCADE,
  client_id      uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  -- The name the bank gave the account when it was linked.
  bank_name      text,
  linked_by      uuid DEFAULT auth.uid(),
  linked_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_payee_links_one_party CHECK (num_nonnulls(vendor_id, staff_id, client_id) = 1)
);
COMMENT ON TABLE public.bank_payee_links IS
  'Whose a bank account is, as a person said (512). Overrides what matched payments and records suggest.';
ALTER TABLE public.bank_payee_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_payee_links_read ON public.bank_payee_links;
CREATE POLICY bank_payee_links_read ON public.bank_payee_links FOR SELECT
  USING ((SELECT get_user_role())::text IN ('admin', 'finance', 'executive'));
-- Written only through bank_payee_link() / bank_payee_unlink().
CREATE INDEX IF NOT EXISTS bank_statement_lines_counterparty_account_idx
  ON public.bank_statement_lines (bank_party_digits(counterparty_account)) WHERE counterparty_account IS NOT NULL;

-- ── 512b ────────────────────────────────────────────────────────────────────
-- Every account number written in a record's bank-account field: a vendor's
-- sometimes lists several, with the banks between them.
CREATE OR REPLACE FUNCTION public.bank_account_numbers(p text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT COALESCE(array_agg(DISTINCT x.n), '{}') FROM (
    SELECT m[1] AS n FROM regexp_matches(COALESCE(p, ''), '(\d{8,})', 'g') m
    UNION
    -- One number written in groups: "1000 1234 56789".
    SELECT bank_party_digits(p) WHERE COALESCE(p, '') !~ '[A-Za-z]' AND length(bank_party_digits(p)) BETWEEN 8 AND 16
  ) x WHERE x.n IS NOT NULL;
$f$;

-- 506's test, tightened: an account field may list several numbers, and a
-- record name found inside the bank's must be two words or more ("Mohammed"
-- alone is inside half the names a bank sends).
CREATE OR REPLACE FUNCTION public.bank_party_is(p_cp_name text, p_cp_acct text, p_name text, p_acct text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN bank_party_clearing(p_cp_name) THEN NULL
    WHEN length(bank_party_digits(p_cp_acct)) >= 8 AND bank_party_digits(p_cp_acct) = ANY (bank_account_numbers(p_acct)) THEN 'account'
    WHEN bank_party_norm(p_cp_name) IS NOT NULL AND bank_party_norm(p_name) IS NOT NULL AND (
         bank_party_norm(p_cp_name) = bank_party_norm(p_name)
      OR (length(bank_party_norm(p_name)) >= 8 AND bank_party_norm(p_name) LIKE '% %'
          AND bank_party_norm(p_cp_name) LIKE '%' || bank_party_norm(p_name) || '%')
      OR (length(bank_party_norm(p_cp_name)) >= 8 AND bank_party_norm(p_name) LIKE bank_party_norm(p_cp_name) || '%')) THEN 'name'
  END;
$f$;

-- Each named line (not a clearing house) and who its match paid or was paid by.
CREATE OR REPLACE VIEW public.v_bank_line_paid_party WITH (security_invoker = true) AS
WITH l AS (
  SELECT b.id, b.account_id, b.transfer_id, b.value_date, b.counterparty_name,
         bank_party_digits(b.counterparty_account) AS account_number,
         COALESCE(b.debit_amount, 0) > 0 AS money_out
    FROM bank_statement_lines b
   WHERE b.counterparty_account IS NOT NULL AND NOT bank_party_clearing(b.counterparty_name)
)
SELECT l.id AS line_id, l.account_id, l.account_number, l.value_date, l.counterparty_name, l.money_out, p.kind, p.party_id
  FROM l CROSS JOIN LATERAL (
    SELECT 'vendor'::text AS kind, e.vendor_id AS party_id FROM expenses e WHERE e.transfer_id = l.transfer_id AND e.vendor_id IS NOT NULL
    UNION SELECT 'staff', e.paid_to_staff_id FROM expenses e WHERE e.transfer_id = l.transfer_id AND e.paid_to_staff_id IS NOT NULL
    UNION SELECT 'vendor', e.vendor_id FROM expense_payments q JOIN expenses e ON e.id = q.expense_id
           WHERE q.transfer_id = l.transfer_id AND e.vendor_id IS NOT NULL
    UNION SELECT 'staff', e.paid_to_staff_id FROM expense_payments q JOIN expenses e ON e.id = q.expense_id
           WHERE q.transfer_id = l.transfer_id AND e.paid_to_staff_id IS NOT NULL
    UNION SELECT 'vendor', e.vendor_id FROM batch_payments bp JOIN batch_payment_expenses x ON x.batch_payment_id = bp.id JOIN expenses e ON e.id = x.expense_id
           WHERE bp.transfer_id = l.transfer_id AND e.vendor_id IS NOT NULL
    UNION SELECT 'staff', ps.staff_id FROM payroll_staff ps WHERE ps.bank_line_id = l.id
    UNION SELECT 'vendor', f.vendor_id FROM vendor_receipt_facilitation f WHERE f.out_transfer_id = l.transfer_id AND f.vendor_id IS NOT NULL
    UNION SELECT 'vendor', f.vendor_id FROM vrf_payment_parts vp JOIN vendor_receipt_facilitation f ON f.id = vp.vrf_id
           WHERE vp.transfer_id = l.transfer_id AND vp.reversed_at IS NULL AND f.vendor_id IS NOT NULL
    UNION SELECT 'client', s.client_id FROM sales s WHERE s.transfer_id = l.transfer_id AND s.client_id IS NOT NULL
  ) p
 WHERE l.transfer_id IS NOT NULL;
COMMENT ON VIEW public.v_bank_line_paid_party IS 'Each named bank line and the vendor, staff member or client its match paid or was paid by (512).';

-- Whose an account is. A person's link decides alone. Otherwise every
-- party the account was paid to before (on lines that paid one party only)
-- and every record that holds it, best evidence first.
--   how: 'linked' | 'paid' (lines = how many times) | 'record'
CREATE OR REPLACE FUNCTION public.bank_account_owners(p_account text)
RETURNS TABLE(kind text, id uuid, name text, how text, lines integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH a AS (
    SELECT bank_party_digits(p_account) AS n
     WHERE length(bank_party_digits(p_account)) >= 8
       AND COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false)
  ), link AS (
    SELECT CASE WHEN k.vendor_id IS NOT NULL THEN 'vendor' WHEN k.staff_id IS NOT NULL THEN 'staff' ELSE 'client' END AS kind,
           COALESCE(k.vendor_id, k.staff_id, k.client_id) AS id, 'linked'::text AS how, NULL::integer AS lines, 1 AS rank
      FROM bank_payee_links k JOIN a ON k.account_number = a.n
  ), paid AS (
    SELECT p.line_id, p.kind, p.party_id FROM v_bank_line_paid_party p JOIN a ON p.account_number = a.n
  ), hist AS (
    SELECT p.kind, p.party_id AS id, 'paid'::text AS how, count(*)::integer AS lines, 2 AS rank
      FROM paid p WHERE (SELECT count(*) FROM paid o WHERE o.line_id = p.line_id) = 1
     GROUP BY p.kind, p.party_id
  ), rec AS (
    SELECT 'vendor'::text AS kind, v.id, 'record'::text AS how, NULL::integer AS lines, 3 AS rank
      FROM vendors v JOIN a ON a.n = ANY (bank_account_numbers(v.bank_account))
    UNION
    SELECT 'staff', s.id, 'record', NULL, 3 FROM staff s JOIN a ON a.n = ANY (bank_account_numbers(s.bank_account))
    UNION
    SELECT 'staff', x.staff_id, 'record', NULL, 3 FROM staff_bank_accounts x JOIN a ON a.n = ANY (bank_account_numbers(x.account_number))
  ), found AS (
    SELECT * FROM link
    UNION ALL
    SELECT * FROM (SELECT DISTINCT ON (u.kind, u.id) u.* FROM (SELECT * FROM hist UNION ALL SELECT * FROM rec) u
                    ORDER BY u.kind, u.id, u.rank) z
     WHERE NOT EXISTS (SELECT 1 FROM link)
  )
  SELECT f.kind, f.id, btrim(COALESCE(v.vendor_name, s.employee_name, c.client_name)), f.how, f.lines
    FROM found f
    LEFT JOIN vendors v ON f.kind = 'vendor' AND v.id = f.id
    LEFT JOIN staff s ON f.kind = 'staff' AND s.id = f.id
    LEFT JOIN clients c ON f.kind = 'client' AND c.id = f.id
   ORDER BY f.rank, f.lines DESC NULLS LAST;
$f$;
REVOKE EXECUTE ON FUNCTION public.bank_account_owners(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_account_owners(text) TO authenticated;

-- The vendor, staff member or client whose name is the bank's name for the
-- other party (no account to go on), best first.
CREATE OR REPLACE FUNCTION public.bank_party_by_name(p_name text, p_money_out boolean)
RETURNS TABLE(kind text, id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT c.kind, c.id, c.name FROM (
    SELECT 'vendor'::text AS kind, v.id, btrim(v.vendor_name) AS name, CASE WHEN p_money_out THEN 1 ELSE 3 END AS pref
      FROM vendors v WHERE bank_party_is(p_name, NULL, v.vendor_name, NULL) IS NOT NULL
    UNION ALL
    SELECT 'staff', s.id, btrim(s.employee_name), 2 FROM staff s WHERE bank_party_is(p_name, NULL, s.employee_name, NULL) IS NOT NULL
    UNION ALL
    SELECT 'client', k.id, btrim(k.client_name), CASE WHEN p_money_out THEN 4 ELSE 1 END FROM clients k
     WHERE bank_party_is(p_name, NULL, k.client_name, NULL) IS NOT NULL
  ) c
   WHERE COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false)
   ORDER BY c.pref, length(c.name) DESC;
$f$;
REVOKE EXECUTE ON FUNCTION public.bank_party_by_name(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_party_by_name(text, boolean) TO authenticated;

-- Who a line's other party is: whose the account is first (linked, paid
-- before, on record), then by name.   how: 'linked' | 'paid' | 'account' | 'name'
CREATE OR REPLACE FUNCTION public.bank_line_party(p_line_id uuid)
RETURNS TABLE(kind text, id uuid, name text, how text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH l AS (
    SELECT b.counterparty_name AS n, b.counterparty_account AS a, COALESCE(b.debit_amount, 0) > 0 AS money_out
      FROM bank_statement_lines b
     WHERE b.id = p_line_id AND (b.counterparty_name IS NOT NULL OR b.counterparty_account IS NOT NULL)
       AND NOT bank_party_clearing(b.counterparty_name)
       AND COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false)
  ), c AS (
    SELECT o.kind, o.id, o.name, CASE o.how WHEN 'record' THEN 'account' ELSE o.how END AS how,
           1 AS tier, row_number() OVER () AS ord
      FROM l, bank_account_owners(l.a) o
    UNION ALL
    SELECT n.kind, n.id, n.name, 'name', 2, row_number() OVER ()
      FROM l, bank_party_by_name(l.n, l.money_out) n
  )
  SELECT c.kind, c.id, c.name, c.how FROM c ORDER BY c.tier, c.ord LIMIT 1;
$f$;

-- Who a suggested record is for: (kind, id) where known, a name otherwise.
CREATE OR REPLACE FUNCTION public.bank_target_parties(p_line_id uuid, p_kind text, p_target uuid, p_detail text)
RETURNS TABLE(kind text, id uuid, name text, accounts text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH e AS (
    SELECT x.vendor_id, x.paid_to_staff_id, x.vendors_name FROM expenses x
     WHERE (p_kind = 'expense' AND x.id = p_target)
        OR (p_kind = 'expense_part' AND x.id = (SELECT q.expense_id FROM expense_payments q WHERE q.id = p_target))
  ), t AS (
    SELECT 'vendor'::text AS kind, e.vendor_id AS id FROM e WHERE e.vendor_id IS NOT NULL
    UNION SELECT 'staff', e.paid_to_staff_id FROM e WHERE e.paid_to_staff_id IS NOT NULL
    UNION SELECT 'vendor', x2.vendor_id FROM batch_payment_expenses x JOIN expenses x2 ON x2.id = x.expense_id
           WHERE p_kind = 'batch' AND x.batch_payment_id = p_target AND x2.vendor_id IS NOT NULL
    UNION SELECT 'vendor', f.vendor_id FROM vendor_receipt_facilitation f WHERE p_kind IN ('vrf', 'vrf_part') AND f.id = p_target AND f.vendor_id IS NOT NULL
    UNION SELECT 'staff', pl.staff_id FROM payroll_line_plan(p_line_id, p_target) pl WHERE p_kind = 'payroll'
    UNION SELECT 'staff', ps.staff_id FROM payroll_staff ps
           WHERE p_kind = 'payroll' AND ps.payroll_id = p_target AND ps.bank_line_id IS NULL AND p_detail = 'pick who this line paid'
    UNION SELECT 'client', s.client_id FROM sales s WHERE p_kind = 'sale' AND s.id = p_target AND s.client_id IS NOT NULL
    UNION SELECT 'vendor', sb.vendor_id FROM sourcing_bundles sb WHERE p_kind = 'purchase_order' AND sb.id = p_target AND sb.vendor_id IS NOT NULL
  )
  SELECT t.kind, t.id, btrim(COALESCE(v.vendor_name, st.employee_name, c.client_name)),
         CASE t.kind
           WHEN 'vendor' THEN bank_account_numbers(v.bank_account)
             || ARRAY(SELECT k.account_number FROM bank_payee_links k WHERE k.vendor_id = t.id)
           WHEN 'staff' THEN bank_account_numbers(st.bank_account)
             || ARRAY(SELECT unnest(bank_account_numbers(x.account_number)) FROM staff_bank_accounts x WHERE x.staff_id = t.id)
             || ARRAY(SELECT k.account_number FROM bank_payee_links k WHERE k.staff_id = t.id)
           ELSE ARRAY(SELECT k.account_number FROM bank_payee_links k WHERE k.client_id = t.id)
         END
    FROM t
    LEFT JOIN vendors v ON t.kind = 'vendor' AND v.id = t.id
    LEFT JOIN staff st ON t.kind = 'staff' AND st.id = t.id
    LEFT JOIN clients c ON t.kind = 'client' AND c.id = t.id
  UNION ALL
  -- Names typed on the record with no vendor behind them.
  SELECT NULL, NULL, n.name, '{}' FROM (
    SELECT e.vendors_name AS name FROM e
    UNION SELECT f.facilitator_name FROM vendor_receipt_facilitation f WHERE p_kind IN ('vrf', 'vrf_part') AND f.id = p_target
    UNION SELECT sb.vendor_name FROM sourcing_bundles sb WHERE p_kind = 'purchase_order' AND sb.id = p_target AND sb.vendor_id IS NULL
  ) n WHERE NULLIF(btrim(n.name), '') IS NOT NULL;
$f$;
REVOKE EXECUTE ON FUNCTION public.bank_target_parties(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- The suggestions weighed by whose account the bank paid (replaces 506's).
CREATE OR REPLACE FUNCTION public.suggest_bank_line_matches(p_line_id uuid)
RETURNS TABLE(kind text, target_id uuid, label text, detail text, amount numeric, target_date date, score integer, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l record; v_owners jsonb; v_linked boolean;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT b.counterparty_name AS cp_name, b.counterparty_account AS cp_acct, b.value_date,
         bank_party_clearing(b.counterparty_name) AS clearing,
         CASE WHEN COALESCE(b.debit_amount, 0) > 0 THEN 'debit' ELSE 'credit' END AS direction,
         COALESCE(NULLIF(b.debit_amount, 0), b.credit_amount, 0) AS amount
    INTO l FROM bank_statement_lines b WHERE b.id = p_line_id;
  -- No other party on the line, or only a clearing house: as they were.
  IF (l.cp_name IS NULL AND l.cp_acct IS NULL) OR l.clearing THEN
    RETURN QUERY SELECT * FROM suggest_bank_line_matches_core(p_line_id);
    RETURN;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', o.kind, 'id', o.id, 'how', o.how)), '[]'), bool_or(o.how = 'linked')
    INTO v_owners, v_linked FROM bank_account_owners(l.cp_acct) o;
  v_linked := COALESCE(v_linked, false);
  RETURN QUERY
  WITH s AS (
    SELECT * FROM suggest_bank_line_matches_core(p_line_id)
  ), w AS (
    SELECT s.*,
      -- The record is for the account's owner: how we know they own it.
      (SELECT o->>'how' FROM bank_target_parties(p_line_id, s.kind, s.target_id, s.detail) t, jsonb_array_elements(v_owners) o
        WHERE t.id IS NOT NULL AND o->>'kind' = t.kind AND (o->>'id')::uuid = t.id
        ORDER BY CASE o->>'how' WHEN 'linked' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END LIMIT 1) AS owner_how,
      -- Or its name is the bank's name for them (unless a person linked the account to someone).
      (NOT v_linked AND EXISTS (SELECT 1 FROM bank_target_parties(p_line_id, s.kind, s.target_id, s.detail) t
                                 WHERE bank_party_is(l.cp_name, NULL, t.name, NULL) IS NOT NULL)) AS same_name,
      -- The record is for someone the account isn't known to be: 'strong'
      -- when they have accounts of their own and this isn't one, 'weak' when
      -- nothing is known of their accounts.
      CASE WHEN jsonb_array_length(v_owners) = 0 THEN NULL
           ELSE (SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(cardinality(t.accounts) > 0) THEN 'strong' ELSE 'weak' END
                   FROM bank_target_parties(p_line_id, s.kind, s.target_id, s.detail) t WHERE t.id IS NOT NULL) END AS other,
      bank_amount_fit(l.amount, s.amount, l.direction) AS fit
    FROM s
  ), v AS (
    SELECT w.*, CASE WHEN w.owner_how IS NOT NULL THEN 'account' WHEN w.same_name THEN 'name' END AS who
      FROM w
  )
  SELECT v.kind, v.target_id, v.label, v.detail, v.amount, v.target_date,
    (CASE
       WHEN v.who IS NOT NULL AND v.score >= 95 THEN v.score
       WHEN v.who = 'account' AND v.fit >= 55 THEN greatest(v.score, 97)
       WHEN v.who = 'name' AND v.fit >= 55 THEN greatest(v.score, 95)
       WHEN v.who IS NOT NULL THEN least(v.score + 20, 90)
       WHEN v.other = 'strong' AND v.score < 95 THEN least(v.score, 45)
       WHEN v.other = 'weak' AND v.score < 95 THEN least(greatest(v.score - 15, 0), 80)
       ELSE v.score END)::int,
    CASE
       WHEN v.who IS NOT NULL AND v.score >= 95 THEN v.reason
       WHEN v.who IS NOT NULL THEN
         CASE l.direction WHEN 'debit' THEN 'Paid to ' ELSE 'Paid by ' END || COALESCE(l.cp_name, 'their account')
         || CASE v.owner_how WHEN 'linked' THEN ' (their account, as linked)'
                             WHEN 'paid' THEN ' (paid to this account before)'
                             WHEN 'record' THEN ' (their account on record)' ELSE '' END
         || CASE WHEN v.fit >= 60 THEN ', same amount'
                 WHEN v.fit >= 55 THEN ', amount plus a ' || round(l.amount - v.amount, 2) || ' fee'
                 ELSE ', but the amount differs' END
         || CASE WHEN v.kind = 'payroll' THEN ' · ' || v.detail ELSE '' END
       WHEN v.other IS NOT NULL AND v.score < 95 THEN v.reason || ', but the bank paid ' || COALESCE(l.cp_name, 'another account')
       ELSE v.reason END
  FROM v
  ORDER BY 7 DESC, abs(v.target_date - l.value_date);
END $f$;
GRANT EXECUTE ON FUNCTION public.suggest_bank_line_matches(uuid) TO authenticated;

-- Every account on the lines (one bank, or all), whose it is and how we know.
--   owners: [{kind, id, name, how, lines}] (see bank_account_owners)
--   by_name: the record whose name matches, when nobody owns the account
CREATE OR REPLACE FUNCTION public.bank_payees(p_account_id uuid DEFAULT NULL)
RETURNS TABLE(account_number text, bank_name text, names text[], lines_out integer, amount_out numeric,
              lines_in integer, amount_in numeric, open_lines integer, last_date date, owners jsonb, by_name jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance', 'executive') THEN
    RAISE EXCEPTION 'Only admin, finance or executive can see who the bank paid';
  END IF;
  RETURN QUERY
  WITH l AS (
    SELECT bank_party_digits(b.counterparty_account) AS n, b.counterparty_name AS cp, b.value_date,
           COALESCE(b.debit_amount, 0) > 0 AS money_out, COALESCE(NULLIF(b.debit_amount, 0), b.credit_amount, 0) AS amt,
           v.reconciled_as IS NULL AS open
      FROM bank_statement_lines b JOIN v_bank_line_status v ON v.line_id = b.id
     WHERE b.counterparty_account IS NOT NULL AND NOT bank_party_clearing(b.counterparty_name)
       AND length(bank_party_digits(b.counterparty_account)) >= 8
       AND (p_account_id IS NULL OR b.account_id = p_account_id)
  ), g AS (
    SELECT l.n,
           (array_agg(l.cp ORDER BY l.value_date DESC))[1] AS cp,
           array_agg(DISTINCT l.cp) AS cps,
           count(*) FILTER (WHERE l.money_out)::int AS lo, COALESCE(sum(l.amt) FILTER (WHERE l.money_out), 0) AS ao,
           count(*) FILTER (WHERE NOT l.money_out)::int AS li, COALESCE(sum(l.amt) FILTER (WHERE NOT l.money_out), 0) AS ai,
           count(*) FILTER (WHERE l.open)::int AS op, max(l.value_date) AS last,
           bool_or(l.money_out) AS any_out
      FROM l GROUP BY l.n
  ),
  -- The same evidence as bank_account_owners(), gathered for every account in
  -- one pass rather than account by account (190 calls took 16 s).
  link AS (
    SELECT k.account_number AS n,
           CASE WHEN k.vendor_id IS NOT NULL THEN 'vendor' WHEN k.staff_id IS NOT NULL THEN 'staff' ELSE 'client' END AS kind,
           COALESCE(k.vendor_id, k.staff_id, k.client_id) AS id, 'linked'::text AS how, NULL::integer AS lines, 1 AS rank
      FROM bank_payee_links k WHERE k.account_number IN (SELECT g.n FROM g)
  ), paid AS (
    SELECT p.line_id, p.account_number AS n, p.kind, p.party_id, count(*) OVER (PARTITION BY p.line_id) AS parties
      FROM v_bank_line_paid_party p WHERE p.account_number IN (SELECT g.n FROM g)
  ), hist AS (
    SELECT p.n, p.kind, p.party_id AS id, 'paid'::text AS how, count(*)::integer AS lines, 2 AS rank
      FROM paid p WHERE p.parties = 1 GROUP BY p.n, p.kind, p.party_id
  ), rec AS (
    SELECT x.n, 'vendor'::text AS kind, v.id, 'record'::text AS how, NULL::integer AS lines, 3 AS rank
      FROM vendors v CROSS JOIN LATERAL unnest(bank_account_numbers(v.bank_account)) x(n)
    UNION
    SELECT x.n, 'staff', s.id, 'record', NULL, 3 FROM staff s CROSS JOIN LATERAL unnest(bank_account_numbers(s.bank_account)) x(n)
    UNION
    SELECT x.n, 'staff', sb.staff_id, 'record', NULL, 3 FROM staff_bank_accounts sb CROSS JOIN LATERAL unnest(bank_account_numbers(sb.account_number)) x(n)
  ), found AS (
    SELECT * FROM link
    UNION ALL
    SELECT * FROM (SELECT DISTINCT ON (u.n, u.kind, u.id) u.*
                     FROM (SELECT * FROM hist UNION ALL SELECT * FROM rec WHERE rec.n IN (SELECT g.n FROM g)) u
                    ORDER BY u.n, u.kind, u.id, u.rank) z
     WHERE NOT EXISTS (SELECT 1 FROM link k WHERE k.n = z.n)
  ), owners AS (
    SELECT f.n, jsonb_agg(jsonb_build_object('kind', f.kind, 'id', f.id,
             'name', btrim(COALESCE(v.vendor_name, s.employee_name, c.client_name)), 'how', f.how, 'lines', f.lines)
             ORDER BY f.rank, f.lines DESC NULLS LAST) AS o
      FROM found f
      LEFT JOIN vendors v ON f.kind = 'vendor' AND v.id = f.id
      LEFT JOIN staff s ON f.kind = 'staff' AND s.id = f.id
      LEFT JOIN clients c ON f.kind = 'client' AND c.id = f.id
     GROUP BY f.n
  )
  SELECT g.n, g.cp, g.cps, g.lo, g.ao, g.li, g.ai, g.op, g.last, COALESCE(o.o, '[]'::jsonb),
         CASE WHEN o.o IS NOT NULL THEN NULL
              ELSE (SELECT jsonb_build_object('kind', b.kind, 'id', b.id, 'name', b.name)
                      FROM bank_party_by_name(g.cp, g.any_out) b LIMIT 1) END
    FROM g LEFT JOIN owners o ON o.n = g.n
   ORDER BY g.op DESC, g.last DESC;
END $f$;
REVOKE EXECUTE ON FUNCTION public.bank_payees(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_payees(uuid) TO authenticated;

-- Say whose an account is (replacing any earlier link), or take it back.
CREATE OR REPLACE FUNCTION public.bank_payee_link(p_account text, p_kind text, p_id uuid, p_bank_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE n text := bank_party_digits(p_account);
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can say whose an account is';
  END IF;
  IF length(COALESCE(n, '')) < 8 THEN RAISE EXCEPTION 'That isn''t an account number'; END IF;
  IF p_kind NOT IN ('vendor', 'staff', 'client') OR p_id IS NULL THEN
    RAISE EXCEPTION 'Pick the vendor, staff member or client it belongs to';
  END IF;
  INSERT INTO bank_payee_links (account_number, vendor_id, staff_id, client_id, bank_name, linked_by, linked_at)
  VALUES (n, CASE WHEN p_kind = 'vendor' THEN p_id END, CASE WHEN p_kind = 'staff' THEN p_id END,
          CASE WHEN p_kind = 'client' THEN p_id END, NULLIF(btrim(p_bank_name), ''), auth.uid(), now())
  ON CONFLICT (account_number) DO UPDATE
    SET vendor_id = EXCLUDED.vendor_id, staff_id = EXCLUDED.staff_id, client_id = EXCLUDED.client_id,
        bank_name = COALESCE(EXCLUDED.bank_name, bank_payee_links.bank_name),
        linked_by = EXCLUDED.linked_by, linked_at = EXCLUDED.linked_at;
END $f$;
REVOKE EXECUTE ON FUNCTION public.bank_payee_link(text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_payee_link(text, text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bank_payee_unlink(p_account text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can say whose an account is';
  END IF;
  DELETE FROM bank_payee_links WHERE account_number = bank_party_digits(p_account);
END $f$;
REVOKE EXECUTE ON FUNCTION public.bank_payee_unlink(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_payee_unlink(text) TO authenticated;
