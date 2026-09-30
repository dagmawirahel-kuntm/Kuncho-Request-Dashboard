-- 381 — Who and which project, on every ledger line
--
-- A journal line said which account and how much, never for whom. So the
-- books could not say what a vendor is owed, what a client owes, or what a
-- project cost — those lived in the operational tables, apart from the
-- ledger. Now each line carries:
--
--   party_type / party_id  the vendor, client or staff member it is for —
--                          always on a control account (380 party_kinds),
--                          which is what makes that account's sub-ledger
--   project_id             the project it belongs to, when there is one
--
-- Nothing that posts has to change: a line inserted without them gets them
-- from its entry's source (an expense's vendor and project, a sale's client…).
-- The lines already posted get them the same way.
--
-- A control-account line with no party (an expense with only a typed vendor
-- name) shows in v_ledger_party_gaps for finance to put right.
--
-- v_subledger is every control account's balance per party; each sums to its
-- control account because they are the same lines. The views answer only
-- admin, finance and executive: staff advances and floats are per person.

SET search_path TO public;

ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS party_type text,
  ADD COLUMN IF NOT EXISTS party_id   uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS journal_lines_party_chk;
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_party_chk
  CHECK ((party_type IS NULL AND party_id IS NULL) OR (party_type IN ('vendor', 'client', 'staff') AND party_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_journal_lines_party ON journal_lines (account_id, party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_project ON journal_lines (project_id) WHERE project_id IS NOT NULL;

-- What a ledger source is about: its vendor, client, staff member, project.
CREATE OR REPLACE FUNCTION public.ledger_source_context(p_source_table text, p_source_id uuid)
RETURNS TABLE (vendor_id uuid, client_id uuid, staff_id uuid, project_id uuid)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT x.vendor_id, x.client_id, x.staff_id, x.project_id FROM (
    SELECT e.vendor_id, NULL::uuid AS client_id, e.paid_to_staff_id AS staff_id, e.project_id
      FROM expenses e WHERE p_source_table LIKE 'expense%' AND e.id = p_source_id
    UNION ALL
    SELECT NULL, s.client_id, NULL, s.project_id
      FROM sales s WHERE p_source_table LIKE 'sale%' AND s.id = p_source_id
    UNION ALL
    SELECT NULL, NULL, a.staff_id, NULL
      FROM cash_advances a WHERE p_source_table LIKE 'cash_advance%' AND a.id = p_source_id
    UNION ALL
    SELECT NULL, NULL, f.custodian_staff_id, f.project_id
      FROM petty_cash_floats f WHERE p_source_table LIKE 'petty_cash_float%' AND f.id = p_source_id
    UNION ALL
    SELECT NULL, NULL, f.custodian_staff_id, f.project_id
      FROM petty_cash_transactions t JOIN petty_cash_floats f ON f.id = t.float_id
     WHERE p_source_table = 'petty_cash_transactions' AND t.id = p_source_id
    UNION ALL
    SELECT v.vendor_id, NULL, NULL, NULL
      FROM vendor_receipt_facilitation v WHERE p_source_table = 'vendor_receipt_facilitation' AND v.id = p_source_id
    UNION ALL
    SELECT c.vendor_id, NULL, NULL, NULL
      FROM vendor_credits c WHERE p_source_table = 'vendor_credits' AND c.id = p_source_id
  ) x LIMIT 1
$$;

-- The party a control account takes from that context, in the order the
-- account lists its kinds (Accounts payable: the vendor, else the staff
-- member paid; Wages payable: the worker, else the crew leader).
CREATE OR REPLACE FUNCTION public.ledger_party_for(p_kinds text[], p_vendor uuid, p_client uuid, p_staff uuid,
  OUT party_type text, OUT party_id uuid)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text;
BEGIN
  FOREACH k IN ARRAY COALESCE(p_kinds, ARRAY[]::text[]) LOOP
    IF k = 'vendor' AND p_vendor IS NOT NULL THEN party_type := k; party_id := p_vendor; RETURN; END IF;
    IF k = 'client' AND p_client IS NOT NULL THEN party_type := k; party_id := p_client; RETURN; END IF;
    IF k = 'staff'  AND p_staff  IS NOT NULL THEN party_type := k; party_id := p_staff;  RETURN; END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.journal_line_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_src   text;
  v_id    uuid;
  v_kinds text[];
  c       record;
  p       record;
BEGIN
  SELECT party_kinds INTO v_kinds FROM chart_of_accounts WHERE id = NEW.account_id;
  -- A party only belongs on a control account.
  IF v_kinds IS NULL THEN
    NEW.party_type := NULL; NEW.party_id := NULL;
  END IF;
  IF (NEW.party_id IS NOT NULL OR v_kinds IS NULL) AND NEW.project_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT source_table, source_id INTO v_src, v_id FROM journal_entries WHERE id = NEW.journal_entry_id;
  IF v_src IS NULL OR v_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO c FROM ledger_source_context(v_src, v_id);
  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.project_id := COALESCE(NEW.project_id, c.project_id);
  IF NEW.party_id IS NULL AND v_kinds IS NOT NULL THEN
    SELECT * INTO p FROM ledger_party_for(v_kinds, c.vendor_id, c.client_id, c.staff_id);
    NEW.party_type := p.party_type;
    NEW.party_id := p.party_id;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_journal_line_context ON journal_lines;
CREATE TRIGGER trg_journal_line_context BEFORE INSERT OR UPDATE OF account_id ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_line_context();

-- The lines already posted.
UPDATE journal_lines l
   SET project_id = x.project_id,
       party_type = x.party_type,
       party_id   = x.party_id
  FROM (
    SELECT l2.id, c.project_id, p.party_type, p.party_id
      FROM journal_lines l2
      JOIN journal_entries je ON je.id = l2.journal_entry_id
      JOIN chart_of_accounts a ON a.id = l2.account_id
      CROSS JOIN LATERAL ledger_source_context(je.source_table, je.source_id) c
      CROSS JOIN LATERAL ledger_party_for(a.party_kinds, c.vendor_id, c.client_id, c.staff_id) p
  ) x
 WHERE x.id = l.id;

-- ── Who a party is ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_party_name(p_type text, p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE p_type
    WHEN 'vendor' THEN (SELECT vendor_name FROM vendors WHERE id = p_id)
    WHEN 'client' THEN (SELECT client_name FROM clients WHERE id = p_id)
    WHEN 'staff'  THEN (SELECT employee_name FROM staff WHERE id = p_id)
  END
$$;
REVOKE EXECUTE ON FUNCTION ledger_party_name(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ledger_party_name(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_subledgers()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false)
$$;

-- ── Sub-ledgers ──────────────────────────────────────────────────────────────
-- One row per control account and party: its balance, debit-positive
-- (what a receivable or advance holds; a payable shows negative).
CREATE OR REPLACE VIEW public.v_subledger WITH (security_invoker = true) AS
SELECT c.id AS account_id, c.account_code, c.account_name, c.system_key, c.nature,
       l.party_type, l.party_id,
       COALESCE(ledger_party_name(l.party_type, l.party_id), 'Not named') AS party_name,
       sum(l.debit) AS debit, sum(l.credit) AS credit, sum(l.debit - l.credit) AS balance,
       min(je.entry_date) AS first_date, max(je.entry_date) AS last_date, count(*) AS line_count
FROM journal_lines l
JOIN journal_entries je ON je.id = l.journal_entry_id
JOIN chart_of_accounts c ON c.id = l.account_id AND c.party_kinds IS NOT NULL
WHERE can_read_subledgers()
GROUP BY c.id, c.account_code, c.account_name, c.system_key, c.nature, l.party_type, l.party_id;

-- Every line on a control account, in order, with the running balance per party.
CREATE OR REPLACE VIEW public.v_subledger_lines WITH (security_invoker = true) AS
SELECT l.id AS journal_line_id, je.id AS journal_entry_id, je.entry_date, je.entry_type, je.source_table, je.source_id,
       je.description, l.notes, c.id AS account_id, c.account_code, c.account_name, c.system_key,
       l.party_type, l.party_id, l.project_id, l.debit, l.credit,
       sum(l.debit - l.credit) OVER (PARTITION BY c.id, l.party_type, l.party_id
                                     ORDER BY je.entry_date, je.created_at, l.id) AS running_balance
FROM journal_lines l
JOIN journal_entries je ON je.id = l.journal_entry_id
JOIN chart_of_accounts c ON c.id = l.account_id AND c.party_kinds IS NOT NULL
WHERE can_read_subledgers();

-- Control-account lines nobody is named on.
CREATE OR REPLACE VIEW public.v_ledger_party_gaps WITH (security_invoker = true) AS
SELECT l.id AS journal_line_id, je.entry_date, je.source_table, je.source_id, je.description,
       c.account_code, c.account_name, l.debit, l.credit
FROM journal_lines l
JOIN journal_entries je ON je.id = l.journal_entry_id
JOIN chart_of_accounts c ON c.id = l.account_id AND c.party_kinds IS NOT NULL
WHERE l.party_id IS NULL AND can_read_subledgers();

-- Name the party on a line (finance, for the gaps above).
CREATE OR REPLACE FUNCTION public.set_journal_line_party(p_line uuid, p_type text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_kinds text[];
BEGIN
  IF NOT COALESCE(get_user_role() IN ('admin', 'finance'), false) THEN RAISE EXCEPTION 'Only finance can name who a ledger line is for'; END IF;
  SELECT c.party_kinds INTO v_kinds FROM journal_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.id = p_line;
  IF v_kinds IS NULL THEN RAISE EXCEPTION 'That line is not on a control account'; END IF;
  IF NOT (p_type = ANY (v_kinds)) THEN RAISE EXCEPTION 'This account holds %, not %', array_to_string(v_kinds, ' or '), p_type; END IF;
  UPDATE journal_lines SET party_type = p_type, party_id = p_id WHERE id = p_line;
END $function$;
REVOKE EXECUTE ON FUNCTION set_journal_line_party(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_journal_line_party(uuid, text, uuid) TO authenticated;
