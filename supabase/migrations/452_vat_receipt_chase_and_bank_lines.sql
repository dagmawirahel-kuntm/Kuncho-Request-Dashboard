-- 452: Two lists for the tax impact page.
--
-- 1. Receipts to chase. Money has left for a purchase from a VAT supplier —
--    marked paid, paid as an advance, or confirmed by a bank statement line —
--    but no VAT receipt has been captured for it. That VAT cannot be claimed
--    until the receipt arrives, so each one is a call to make. The list says
--    who to call (grouped by supplier on the page), how long ago it was paid,
--    the VAT riding on it and where the chase stands. A small table keeps the
--    chase: asked (how often, when), promised (by when), or not coming.
--    A receipt captured (any status but rejected) takes it off the list.
--
-- 2. Bank lines to match. Money that left the bank in a tax month but is not
--    matched to anything on record. Each line gets the best suggestion from
--    suggest_bank_line_matches, with each record offered to one line only
--    (the line it fits best), and the VAT the record carries — matching it
--    moves that VAT into the bank's month (451). Matching itself goes through
--    apply_bank_line_match, the same route as the bank review queue.

-- ── 1. Receipts to chase ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vat_receipt_chases (
  expense_id     uuid PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  status         text NOT NULL CHECK (status IN ('asked', 'promised', 'not_coming')),
  asked_count    integer NOT NULL DEFAULT 0,
  first_asked_at timestamptz,
  last_asked_at  timestamptz,
  promised_on    date,
  note           text,
  updated_by     uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vat_receipt_chases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vat_receipt_chases' AND policyname = 'vrc_read') THEN
    CREATE POLICY vrc_read ON vat_receipt_chases FOR SELECT USING (tax_plan_reader());
  END IF;
END $$;
GRANT SELECT ON vat_receipt_chases TO authenticated;

CREATE OR REPLACE FUNCTION public.vat_receipt_chase_list()
 RETURNS TABLE(
   expense_id uuid, expense_code text, label text,
   vendor_id uuid, vendor_name text, vendor_phone text, contact_person text, project_name text,
   payment_state text, paid_on date, from_bank boolean,
   ec_year integer, ec_month integer, period_label text, days_since integer,
   amount numeric, paid_amount numeric, vat numeric,
   chase_status text, asked_count integer, last_asked_at timestamptz, promised_on date, chase_note text,
   promise_late boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
BEGIN
  IF NOT tax_plan_reader() THEN RAISE EXCEPTION 'Only finance, tax officers and management can see the receipt chase'; END IF;
  RETURN QUERY
  WITH ex AS (
    SELECT e.*, vd.vendor_name AS v_name, vd.phone_contact AS v_phone, vd.contact_person AS v_contact, p.project_name AS p_name,
           ivi.vat_amount AS vat_set,
           COALESCE(
             (SELECT min(l.value_date) FROM bank_statement_lines l WHERE l.matched_expense_id = e.id),
             (SELECT min(l.value_date) FROM bank_statement_lines l WHERE e.transfer_id IS NOT NULL AND l.transfer_id = e.transfer_id)
           ) AS stmt_date,
           (SELECT sum(l.debit_amount) FROM bank_statement_lines l WHERE l.matched_expense_id = e.id) AS stmt_amt
      FROM expenses e
      LEFT JOIN vendors vd ON vd.id = e.vendor_id
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
     WHERE NOT COALESCE(e.is_archived, false)
       AND e.date >= financials_cutover_date()
       AND e.expense_type IS DISTINCT FROM 'vrf' AND e.vendor_receipt_facilitation_id IS NULL
       -- carries VAT: flagged so, or not flagged either way and from a VAT supplier / a VAT receipt
       AND (ivi.vat_applicable IS TRUE
            OR (ivi.vat_applicable IS NULL AND (COALESCE(e.receipt_is_vat, false) OR vd.vendor_type::text = 'Supplier with VAT')))
       AND NOT EXISTS (SELECT 1 FROM vendor_receipts r WHERE r.expense_id = e.id AND r.status IS DISTINCT FROM 'rejected')
  ),
  paid AS (
    SELECT x.*,
           COALESCE(x.stmt_date, x.bank_date, (x.paid_date AT TIME ZONE 'Africa/Addis_Ababa')::date, x.total_payment_date, x.partial_payment_date,
                    (x.payment_confirmed_at AT TIME ZONE 'Africa/Addis_Ababa')::date,
                    CASE WHEN x.payment_status OR x.payment_state IN ('advance', 'sent', 'paid')
                         THEN (x.payment_state_changed_at AT TIME ZONE 'Africa/Addis_Ababa')::date END,
                    x.date) AS paid_on0,
           CASE WHEN x.payment_status THEN x.amount_etb
                ELSE LEAST(x.amount_etb, COALESCE(NULLIF(x.paid_to_date_etb, 0), NULLIF(x.partial_paid_amount, 0), x.stmt_amt, x.amount_etb)) END AS paid_amt
      FROM ex x
     WHERE x.payment_status OR x.payment_state IN ('advance', 'sent', 'paid') OR x.stmt_date IS NOT NULL OR x.bank_date IS NOT NULL
  )
  SELECT p.id, p.expense_code, COALESCE(p.item_service_description, p.expense_code),
         p.vendor_id, COALESCE(p.v_name, p.vendors_name), p.v_phone, p.v_contact, p.p_name,
         CASE WHEN p.payment_status THEN 'paid' ELSE p.payment_state::text END,
         p.paid_on0, (p.stmt_date IS NOT NULL OR p.bank_date IS NOT NULL),
         tp.ec_year, tp.ec_month, ec_month_name(tp.ec_month) || ' ' || tp.ec_year,
         GREATEST(v_today - p.paid_on0, 0),
         round(p.amount_etb, 2), round(p.paid_amt, 2),
         round(COALESCE(
           CASE WHEN p.vat_set IS NOT NULL THEN p.vat_set * p.paid_amt / NULLIF(p.amount_etb, 0) END,
           CASE WHEN p.receipt_vat_amount IS NOT NULL THEN p.receipt_vat_amount * p.paid_amt / NULLIF(p.amount_etb, 0) END,
           p.paid_amt * rt.rate / (1 + rt.rate)), 2),
         c.status, COALESCE(c.asked_count, 0), c.last_asked_at, c.promised_on, c.note,
         c.status = 'promised' AND c.promised_on < v_today
    FROM paid p
    CROSS JOIN LATERAL tax_period_for_date(p.paid_on0) tp
    CROSS JOIN LATERAL (SELECT COALESCE((tax_rate_note('VAT', p.paid_on0) ->> 'standard_rate')::numeric, 0.15) AS rate) rt
    LEFT JOIN vat_receipt_chases c ON c.expense_id = p.id
   ORDER BY p.paid_on0, p.expense_code;
END $function$;

GRANT EXECUTE ON FUNCTION public.vat_receipt_chase_list() TO authenticated;

-- One action on one or more bills (a call to a supplier usually covers all
-- of theirs): 'asked', 'promised' (with a date), 'not_coming', or 'clear'.
CREATE OR REPLACE FUNCTION public.vat_receipt_chase_mark(
  p_expense_ids uuid[], p_action text, p_promised_on date DEFAULT NULL, p_note text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF NOT tax_plan_reader() THEN RAISE EXCEPTION 'Only finance, tax officers and management can chase receipts'; END IF;
  IF p_action NOT IN ('asked', 'promised', 'not_coming', 'clear') THEN RAISE EXCEPTION 'Unknown action %', p_action; END IF;
  IF p_action = 'promised' AND p_promised_on IS NULL THEN RAISE EXCEPTION 'Say by when the receipt was promised'; END IF;
  IF p_action = 'clear' THEN
    DELETE FROM vat_receipt_chases WHERE expense_id = ANY(p_expense_ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END IF;
  INSERT INTO vat_receipt_chases AS c (expense_id, status, asked_count, first_asked_at, last_asked_at, promised_on, note, updated_by, updated_at)
  SELECT e.id, p_action,
         CASE WHEN p_action = 'asked' THEN 1 ELSE 0 END,
         CASE WHEN p_action = 'asked' THEN now() END,
         CASE WHEN p_action = 'asked' THEN now() END,
         CASE WHEN p_action = 'promised' THEN p_promised_on END,
         NULLIF(btrim(p_note), ''), auth.uid(), now()
    FROM expenses e WHERE e.id = ANY(p_expense_ids)
  ON CONFLICT (expense_id) DO UPDATE SET
    status         = EXCLUDED.status,
    asked_count    = c.asked_count + CASE WHEN p_action = 'asked' THEN 1 ELSE 0 END,
    first_asked_at = COALESCE(c.first_asked_at, EXCLUDED.first_asked_at),
    last_asked_at  = CASE WHEN p_action = 'asked' THEN now() ELSE c.last_asked_at END,
    promised_on    = CASE WHEN p_action = 'promised' THEN p_promised_on WHEN p_action = 'asked' THEN c.promised_on ELSE NULL END,
    note           = COALESCE(NULLIF(btrim(p_note), ''), c.note),
    updated_by     = auth.uid(),
    updated_at     = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

GRANT EXECUTE ON FUNCTION public.vat_receipt_chase_mark(uuid[], text, date, text) TO authenticated;

-- ── 2. Bank lines to match, for one tax month ────────────────────────────
CREATE OR REPLACE FUNCTION public.tax_bank_lines_to_match(p_ec_year integer, p_ec_month integer)
 RETURNS TABLE(
   line_id uuid, value_date date, narration text, reference text, line_amount numeric, account_name text,
   kind text, target_id uuid, target_label text, target_detail text, target_amount numeric, target_date date,
   score integer, reason text, expense_id uuid, vat numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE b record; s record; used_lines uuid[] := '{}'; used_targets text[] := '{}'; r numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT start_greg, end_greg INTO b FROM tax_period_bounds(p_ec_year, p_ec_month);
  r := COALESCE((tax_rate_note('VAT', b.start_greg) ->> 'standard_rate')::numeric, 0.15);

  -- Best first: each line takes its best suggestion that no better-fitting
  -- line has taken already.
  FOR s IN
    WITH lines AS (
      SELECT l.line_id, l.value_date, l.narration, l.reference, l.amount, a.account_name
        FROM v_bank_line_status l
        LEFT JOIN accounts a ON a.id = l.account_id
       WHERE l.value_date BETWEEN b.start_greg AND b.end_greg
         AND l.direction = 'debit' AND l.reconciled_as IS NULL
    ),
    sug AS (
      SELECT ln.*, g.kind AS g_kind, g.target_id AS g_target, g.label AS g_label, g.detail AS g_detail,
             g.amount AS g_amount, g.target_date AS g_date, g.score AS g_score, g.reason AS g_reason
        FROM lines ln
        CROSS JOIN LATERAL (SELECT * FROM suggest_bank_line_matches(ln.line_id) x ORDER BY x.score DESC LIMIT 5) g
    )
    SELECT sg.*,
           CASE sg.g_kind WHEN 'expense' THEN sg.g_target
                          WHEN 'expense_part' THEN (SELECT q.expense_id FROM expense_payments q WHERE q.id = sg.g_target) END AS g_expense
      FROM sug sg
     ORDER BY sg.g_score DESC, abs(sg.amount - COALESCE(sg.g_amount, 0)), sg.value_date
  LOOP
    CONTINUE WHEN s.line_id = ANY(used_lines) OR (s.g_kind || ':' || s.g_target) = ANY(used_targets);
    used_lines := used_lines || s.line_id;
    used_targets := used_targets || (s.g_kind || ':' || s.g_target);
    line_id := s.line_id; value_date := s.value_date; narration := s.narration; reference := s.reference;
    line_amount := s.amount; account_name := s.account_name;
    kind := s.g_kind; target_id := s.g_target; target_label := s.g_label; target_detail := s.g_detail;
    target_amount := s.g_amount; target_date := s.g_date; score := s.g_score; reason := s.g_reason;
    expense_id := s.g_expense;
    vat := NULL;
    IF s.g_expense IS NOT NULL THEN
      SELECT CASE WHEN ivi.vat_applicable IS TRUE
                    OR (ivi.vat_applicable IS NULL AND (COALESCE(e.receipt_is_vat, false) OR vd.vendor_type::text = 'Supplier with VAT'))
                  THEN round(LEAST(s.amount, COALESCE(s.g_amount, s.amount)) * r / (1 + r), 2) ELSE 0 END
        INTO vat
        FROM expenses e
        LEFT JOIN vendors vd ON vd.id = e.vendor_id
        LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
       WHERE e.id = s.g_expense;
    END IF;
    RETURN NEXT;
  END LOOP;

  -- Lines nothing on record looks like.
  RETURN QUERY
    SELECT l.line_id, l.value_date, l.narration, l.reference, l.amount, a.account_name,
           NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::numeric, NULL::date, NULL::integer, NULL::text, NULL::uuid, NULL::numeric
      FROM v_bank_line_status l
      LEFT JOIN accounts a ON a.id = l.account_id
     WHERE l.value_date BETWEEN b.start_greg AND b.end_greg
       AND l.direction = 'debit' AND l.reconciled_as IS NULL
       AND NOT (l.line_id = ANY(used_lines))
     ORDER BY l.amount DESC;
END $function$;

GRANT EXECUTE ON FUNCTION public.tax_bank_lines_to_match(integer, integer) TO authenticated;
