-- 513 — suggest the payee's own open records first
--
-- Suggestions came from suggest_bank_line_matches_core(): records within
-- 120 days whose amount is close, the best ten. 512 then weighed them by
-- whose account the bank paid. A payee's own open expense still never
-- showed when its amount differed (a part payment, several at once), when it
-- was older, or when ten unrelated close amounts ranked above it, even
-- though the bank says exactly who was paid.
--
-- Now, before suggesting, the line's payee is found (their account: linked,
-- paid before, on record; else their name) and their open records are put
-- forward whatever the amount:
--   * vendor / staff: expenses not yet matched (a year back), parts sent or
--     paid, vendor requests not yet sent from the bank;
--   * client: invoices not yet paid in.
-- Ranked by the amount fit; one that fits is near certain (97, or 95 when
-- only the name agrees), so automatic matching can settle it when it is the
-- only one. Their only open record with another amount is 75 ("part
-- payment?" / "several at once?"); one not approved for payment yet is 50.
-- The reason says how we know who they are ("paid to this account 15 times
-- before").
--
-- Needs 512.

-- Who a line's other party is, every candidate: whose the account is
-- (bank_account_owners), else the best match by name.
CREATE OR REPLACE FUNCTION public.bank_line_payees(p_line_id uuid)
RETURNS TABLE(kind text, id uuid, name text, how text, lines integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH l AS (
    SELECT b.counterparty_name AS n, b.counterparty_account AS a, COALESCE(b.debit_amount, 0) > 0 AS money_out
      FROM bank_statement_lines b
     WHERE b.id = p_line_id AND NOT bank_party_clearing(b.counterparty_name)
       AND (b.counterparty_name IS NOT NULL OR b.counterparty_account IS NOT NULL)
  ), o AS (
    SELECT o.kind, o.id, o.name, o.how, o.lines FROM l, bank_account_owners(l.a) o
  )
  SELECT * FROM o
  UNION ALL
  SELECT b.kind, b.id, b.name, 'name'::text, NULL::integer
    FROM l, LATERAL (SELECT * FROM bank_party_by_name(l.n, l.money_out) LIMIT 1) b
   WHERE NOT EXISTS (SELECT 1 FROM o);
$f$;
REVOKE EXECUTE ON FUNCTION public.bank_line_payees(uuid) FROM PUBLIC, anon, authenticated;

-- The payee's own records not yet matched to a bank line, as suggestions.
CREATE OR REPLACE FUNCTION public.bank_party_records(p_line_id uuid)
RETURNS TABLE(kind text, target_id uuid, label text, detail text, amount numeric, target_date date, score integer, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH l AS (
    SELECT b.value_date, b.counterparty_name AS cp,
           CASE WHEN COALESCE(b.debit_amount, 0) > 0 THEN 'debit' ELSE 'credit' END AS direction,
           COALESCE(NULLIF(b.debit_amount, 0), b.credit_amount, 0) AS amount
      FROM bank_statement_lines b WHERE b.id = p_line_id
  ), p AS (
    SELECT * FROM bank_line_payees(p_line_id)
  ), rec AS (
    SELECT 'expense'::text AS kind, e.id AS target_id,
           btrim(COALESCE(e.expense_code, '') || ' ' || COALESCE(e.item_service_description, '')) AS label,
           p.name || ' · ' || replace(e.payment_state::text, '_', ' ') AS detail,
           COALESCE(e.net_payable, e.amount_etb) AS amount, e.date AS target_date,
           e.payment_state::text = 'unpaid' AS not_approved, 'expense'::text AS noun,
           p.name AS who, p.how, p.lines
      FROM l, p JOIN expenses e ON (p.kind = 'vendor' AND e.vendor_id = p.id) OR (p.kind = 'staff' AND e.paid_to_staff_id = p.id)
     WHERE l.direction = 'debit' AND e.transfer_id IS NULL AND NOT e.in_parts AND NOT COALESCE(e.is_archived, false)
       AND e.payment_state IN ('approved_to_pay', 'sent', 'paid', 'advance', 'unpaid')
       AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id)
       AND e.date BETWEEN l.value_date - 365 AND l.value_date + 30
    UNION ALL
    SELECT 'expense_part', q.id,
           btrim(COALESCE(e.expense_code, '') || format(' part %s of %s ', pos.part_no, pos.part_count) || COALESCE(e.item_service_description, '')),
           p.name || ' · part ' || q.state, q.cash_etb, COALESCE(q.paid_date, q.sent_at::date, e.date),
           false, 'expense part', p.name, p.how, p.lines
      FROM l, p JOIN expenses e ON (p.kind = 'vendor' AND e.vendor_id = p.id) OR (p.kind = 'staff' AND e.paid_to_staff_id = p.id)
      JOIN expense_payments q ON q.expense_id = e.id
      CROSS JOIN LATERAL expense_part_position(q.id) pos
     WHERE l.direction = 'debit' AND q.state IN ('sent', 'paid') AND q.transfer_id IS NULL AND NOT q.legacy_entry
    UNION ALL
    SELECT 'vrf', f.id, COALESCE(f.record_name, 'Vendor request'), p.name || ' · ' || COALESCE(f.payment_state, ''),
           COALESCE(f.net_sent, f.amount_transferred), f.trxn_date, false, 'vendor request', p.name, p.how, p.lines
      FROM l, p JOIN vendor_receipt_facilitation f ON p.kind = 'vendor' AND f.vendor_id = p.id
     WHERE l.direction = 'debit' AND f.out_transfer_id IS NULL AND NOT f.is_archived
    UNION ALL
    SELECT 'sale', s.id, btrim(COALESCE(s.invoice_number, '') || ' ' || COALESCE(s.sales_description, '')),
           p.name || ' · ' || s.sales_status::text,
           s.amount - CASE WHEN bank_amount_fit(l.amount, s.amount, 'credit') < 55
                            AND bank_amount_fit(l.amount, s.amount - COALESCE(w.expected_wht, 0), 'credit') >= 55
                           THEN COALESCE(w.expected_wht, 0) ELSE 0 END,
           s.date, false, 'invoice', p.name, p.how, p.lines
      FROM l, p JOIN sales s ON p.kind = 'client' AND s.client_id = p.id
      LEFT JOIN v_sale_wht w ON w.sale_id = s.id
     WHERE l.direction = 'credit' AND s.transfer_id IS NULL AND NOT COALESCE(s.is_archived, false)
  ), f AS (
    SELECT r.*, bank_amount_fit(l.amount, r.amount, l.direction) AS fit,
           count(*) FILTER (WHERE NOT r.not_approved) OVER () AS open_n
      FROM rec r, l
  )
  SELECT f.kind, f.target_id, f.label, f.detail, round(f.amount, 2), f.target_date,
    (CASE
       WHEN f.not_approved THEN 50
       WHEN f.fit >= 55 THEN CASE WHEN f.how = 'name' THEN 95 ELSE 97 END
       WHEN f.open_n = 1 THEN 75
       ELSE greatest(40, 70 - least(30, round(abs(l.amount - f.amount) / greatest(l.amount, 1) * 100)::int))
     END)::int,
    CASE l.direction WHEN 'debit' THEN 'Paid to ' ELSE 'Paid by ' END || COALESCE(l.cp, f.who)
    || CASE f.how WHEN 'linked' THEN ' (their account, as linked)'
                  WHEN 'paid' THEN ' (paid to this account ' || CASE WHEN f.lines = 1 THEN 'once' ELSE f.lines || ' times' END || ' before)'
                  WHEN 'record' THEN ' (their account on record)'
                  ELSE ' (same name as ' || f.who || ')' END
    || CASE
         WHEN f.not_approved THEN '; their ' || f.noun || ' isn''t approved for payment yet: approve it, then match'
         WHEN f.fit >= 60 THEN '; their ' || f.noun || ', same amount'
         WHEN f.fit >= 55 THEN '; their ' || f.noun || ', amount plus a ' || round(l.amount - f.amount, 2) || ' fee'
         WHEN l.amount < f.amount THEN '; their ' || CASE WHEN f.open_n = 1 THEN 'only open ' ELSE '' END || f.noun
                                       || ', ' || round(f.amount - l.amount, 2) || ' less: part payment?'
         ELSE '; their ' || CASE WHEN f.open_n = 1 THEN 'only open ' ELSE '' END || f.noun
              || ', ' || round(l.amount - f.amount, 2) || ' more: several at once?'
       END
  FROM f, l;
$f$;
REVOKE EXECUTE ON FUNCTION public.bank_party_records(uuid) FROM PUBLIC, anon, authenticated;

-- 512's suggestions, with the payee's own open records added (the higher
-- score wins where both name the same record).
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
      (SELECT o->>'how' FROM bank_target_parties(p_line_id, s.kind, s.target_id, s.detail) t, jsonb_array_elements(v_owners) o
        WHERE t.id IS NOT NULL AND o->>'kind' = t.kind AND (o->>'id')::uuid = t.id
        ORDER BY CASE o->>'how' WHEN 'linked' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END LIMIT 1) AS owner_how,
      (NOT v_linked AND EXISTS (SELECT 1 FROM bank_target_parties(p_line_id, s.kind, s.target_id, s.detail) t
                                 WHERE bank_party_is(l.cp_name, NULL, t.name, NULL) IS NOT NULL)) AS same_name,
      CASE WHEN jsonb_array_length(v_owners) = 0 THEN NULL
           ELSE (SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(cardinality(t.accounts) > 0) THEN 'strong' ELSE 'weak' END
                   FROM bank_target_parties(p_line_id, s.kind, s.target_id, s.detail) t WHERE t.id IS NOT NULL) END AS other,
      bank_amount_fit(l.amount, s.amount, l.direction) AS fit
    FROM s
  ), v AS (
    SELECT w.*, CASE WHEN w.owner_how IS NOT NULL THEN 'account' WHEN w.same_name THEN 'name' END AS who
      FROM w
  ), core AS (
    SELECT v.kind, v.target_id, v.label, v.detail, v.amount, v.target_date,
      (CASE
         WHEN v.who IS NOT NULL AND v.score >= 95 THEN v.score
         WHEN v.who = 'account' AND v.fit >= 55 THEN greatest(v.score, 97)
         WHEN v.who = 'name' AND v.fit >= 55 THEN greatest(v.score, 95)
         WHEN v.who IS NOT NULL THEN least(v.score + 20, 90)
         WHEN v.other = 'strong' AND v.score < 95 THEN least(v.score, 45)
         WHEN v.other = 'weak' AND v.score < 95 THEN least(greatest(v.score - 15, 0), 80)
         ELSE v.score END)::int AS score,
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
         ELSE v.reason END AS reason
    FROM v
  ), mine AS (
    SELECT * FROM bank_party_records(p_line_id)
  ), best AS (
    SELECT DISTINCT ON (u.kind, u.target_id) u.*
      FROM (SELECT * FROM core UNION ALL SELECT * FROM mine) u
     ORDER BY u.kind, u.target_id, u.score DESC
  )
  SELECT b.kind, b.target_id, b.label, b.detail, b.amount, b.target_date, b.score, b.reason
    FROM best b
   ORDER BY b.score DESC, abs(b.target_date - l.value_date)
   LIMIT 12;
END $f$;
GRANT EXECUTE ON FUNCTION public.suggest_bank_line_matches(uuid) TO authenticated;
