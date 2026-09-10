-- 300 — a payroll run issues one Payment Request per bank
--
-- A payroll run is paid at several banks at once. PR-2026-222 is 38 people
-- and 712,318.40 split four ways: 31 at CBE, 4 at BOA, 1 at Awash, and 2
-- with no account on file at all. Each bank gets its own instruction — one
-- document listing every payee including the ones banking elsewhere is not
-- something a bank can act on.
--
-- 268 built the table for exactly one live document per source, and 290
-- carried that rule to payroll:
--
--   SELECT ... WHERE status = 'issued' AND payroll_id = p_source_id
--
-- Every per-bank request for one run shares that payroll_id, so issuing the
-- Awash one would find the CBE one and mark it superseded. That single rule
-- is what this migration is really changing; the columns exist to make the
-- narrower rule expressible.
--
-- ── Why two columns and not one ──────────────────────────────────────────
--
-- Three kinds of payroll request now exist, and two of them have no bank:
--
--   bank_scope = 'bank'        one bank. bank_id set. What the bank receives.
--   bank_scope = 'unassigned'  the payees with no account on file. bank_id
--                              null, because there is no bank to name.
--   bank_scope = 'all'         the whole run, grouped by bank with subtotals.
--                              The internal sheet somebody signs before any
--                              of the others are sent. bank_id null.
--
-- Keying on bank_id alone would put 'all' and 'unassigned' in the same slot,
-- and issuing one would supersede the other — the original bug in a smaller
-- form. bank_scope is the discriminator that keeps them apart.
--
-- The 'unassigned' request is deliberately a document rather than a silent
-- omission. Those two people are owed 13,333.35; a per-bank split that just
-- dropped them would make the four documents quietly fail to add up to the
-- run, and nobody would be looking for the difference.
--
-- ── What is unchanged ────────────────────────────────────────────────────
--
-- Expense and batch sources keep exactly the rule they had: one live request
-- per source, superseded on re-issue. They get bank_scope 'all' and are never
-- split. Only the payroll branch of the supersede lookup narrows, and the
-- table currently holds 1 payroll request against 25 others.

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS bank_scope TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS bank_id    uuid REFERENCES accounts(id);

ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_bank_scope_ck;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_bank_scope_ck
  CHECK (bank_scope IN ('all', 'bank', 'unassigned'));

-- bank_id is set exactly when the scope names a bank. Without this the two
-- could drift into a request that claims a bank and does not carry one, or
-- carries one it does not claim.
ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_bank_id_ck;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_bank_id_ck
  CHECK ((bank_scope = 'bank') = (bank_id IS NOT NULL));

-- Splitting is a payroll thing. An expense or a batch is one payment to one
-- place; there is nothing to split it by, and allowing it would create a
-- second live request for a source that is supposed to have one.
ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_split_is_payroll_ck;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_split_is_payroll_ck
  CHECK (bank_scope = 'all' OR source_type = 'payroll');

COMMENT ON COLUMN payment_requests.bank_scope IS
  'What this request covers: all (the whole source), bank (one bank, bank_id set), or unassigned (payroll payees with no bank account on file). Only a payroll run can be anything but all.';
COMMENT ON COLUMN payment_requests.bank_id IS
  'The bank this request instructs, as an accounts row — the company account held at that bank. Set only when bank_scope = bank.';

-- ── 2. One live request per (source, scope, bank) ────────────────────────
-- The supersede rule below is what normally keeps this true; the index is
-- what keeps it true when two people issue at once. NULLS NOT DISTINCT
-- (Postgres 15+, this project is on 17) makes the null bank_id of 'all' and
-- 'unassigned' collide with itself rather than sliding past the constraint,
-- which is the whole reason bank_scope is in the key.
CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_one_live_per_bank_idx
  ON payment_requests (payroll_id, bank_scope, bank_id)
  NULLS NOT DISTINCT
  WHERE status = 'issued' AND payroll_id IS NOT NULL;

-- ── 3. Issuing scopes the supersede ──────────────────────────────────────
-- Re-issuing the CBE request supersedes the previous CBE request and leaves
-- BOA and Awash alone. Their revisions are independent, because they are
-- independent documents: correcting one payee's account at CBE is no reason
-- to reprint an instruction Awash has already acted on.
--
-- Dropped rather than replaced. The two new parameters change the signature,
-- and CREATE OR REPLACE matches on argument types — it would leave the old
-- 14-argument version in place as an overload, still callable, still carrying
-- the run-wide supersede rule this migration exists to narrow. Two functions
-- of the same name is also what makes PostgREST refuse to choose one.
DROP FUNCTION IF EXISTS public.save_payment_request(
  text, uuid, text, jsonb, jsonb, text, numeric, text, integer, integer,
  date, date, text[], text);

CREATE OR REPLACE FUNCTION public.save_payment_request(
  p_source_type text, p_source_id uuid, p_document_html text,
  p_snapshot jsonb DEFAULT '{}'::jsonb, p_payee_lines jsonb DEFAULT '[]'::jsonb,
  p_title text DEFAULT NULL, p_total_amount numeric DEFAULT 0,
  p_amount_in_words text DEFAULT NULL, p_worker_count integer DEFAULT 0,
  p_draft_count integer DEFAULT 1, p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL, p_project_names text[] DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_bank_scope text DEFAULT 'all', p_bank_id uuid DEFAULT NULL)
 RETURNS payment_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev  payment_requests%ROWTYPE;
  v_new   payment_requests%ROWTYPE;
  v_scope text := COALESCE(p_bank_scope, 'all');
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can issue a Payment Request';
  END IF;

  IF p_source_type NOT IN ('expense', 'batch_payment', 'payroll') THEN
    RAISE EXCEPTION 'Unknown Payment Request source type: %', p_source_type;
  END IF;

  IF v_scope NOT IN ('all', 'bank', 'unassigned') THEN
    RAISE EXCEPTION 'Unknown Payment Request bank scope: %', v_scope;
  END IF;

  IF v_scope <> 'all' AND p_source_type <> 'payroll' THEN
    RAISE EXCEPTION 'Only a payroll run can be split by bank (got scope % for source %)', v_scope, p_source_type;
  END IF;

  -- Caught here as well as by the CHECK so the caller gets a sentence rather
  -- than a constraint name.
  IF v_scope = 'bank' AND p_bank_id IS NULL THEN
    RAISE EXCEPTION 'A per-bank Payment Request must name the bank';
  END IF;
  IF v_scope <> 'bank' AND p_bank_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only a per-bank Payment Request carries a bank (scope was %)', v_scope;
  END IF;

  IF p_document_html IS NULL OR length(btrim(p_document_html)) = 0 THEN
    RAISE EXCEPTION 'Cannot save an empty Payment Request document';
  END IF;

  IF p_source_type = 'expense' THEN
    IF NOT EXISTS (SELECT 1 FROM expenses WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Expense % not found', p_source_id;
    END IF;
  ELSIF p_source_type = 'batch_payment' THEN
    IF NOT EXISTS (SELECT 1 FROM batch_payments WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Batch payment % not found', p_source_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Payroll run % not found', p_source_id;
    END IF;
    IF v_scope = 'bank' AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_bank_id) THEN
      RAISE EXCEPTION 'Bank account % not found', p_bank_id;
    END IF;
  END IF;

  -- Expense and batch match on the source alone, exactly as before. Payroll
  -- additionally matches the scope and the bank, so the four documents for
  -- one run supersede along four separate lines.
  SELECT * INTO v_prev
  FROM payment_requests
  WHERE status = 'issued'
    AND ((p_source_type = 'expense'       AND expense_id       = p_source_id)
      OR (p_source_type = 'batch_payment' AND batch_payment_id = p_source_id)
      OR (p_source_type = 'payroll'       AND payroll_id       = p_source_id
          AND bank_scope = v_scope
          AND bank_id IS NOT DISTINCT FROM p_bank_id))
  ORDER BY revision DESC, issued_at DESC
  LIMIT 1;

  IF v_prev.id IS NOT NULL THEN
    UPDATE payment_requests SET status = 'superseded', updated_at = now() WHERE id = v_prev.id;
  END IF;

  INSERT INTO payment_requests (
    source_type, expense_id, batch_payment_id, payroll_id,
    bank_scope, bank_id,
    title, total_amount, amount_in_words, worker_count, draft_count,
    period_start, period_end, project_names,
    payee_lines, document_html, snapshot,
    revision, supersedes_id, issued_by, notes
  ) VALUES (
    p_source_type,
    CASE WHEN p_source_type = 'expense'       THEN p_source_id END,
    CASE WHEN p_source_type = 'batch_payment' THEN p_source_id END,
    CASE WHEN p_source_type = 'payroll'       THEN p_source_id END,
    v_scope, p_bank_id,
    p_title, COALESCE(p_total_amount, 0), p_amount_in_words,
    COALESCE(p_worker_count, 0), COALESCE(p_draft_count, 1),
    p_period_start, p_period_end, p_project_names,
    COALESCE(p_payee_lines, '[]'::jsonb), p_document_html, COALESCE(p_snapshot, '{}'::jsonb),
    COALESCE(v_prev.revision, 0) + 1, v_prev.id, auth.uid(), p_notes
  )
  RETURNING * INTO v_new;

  RETURN v_new;
END $function$;

COMMENT ON FUNCTION public.save_payment_request(text, uuid, text, jsonb, jsonb, text, numeric, text, integer, integer, date, date, text[], text, text, uuid) IS
  'Issues a Payment Request, superseding the previous live one for the same source. For a payroll run the previous one is found per (run, bank_scope, bank), so the requests for different banks supersede independently.';

-- ── 4. The list has to be able to tell them apart ────────────────────────
-- Without this, four rows for PR-2026-222 look identical in the Payment
-- Requests list. bank_scope, bank_id and the bank's name are appended at the
-- end of the select list: CREATE OR REPLACE VIEW cannot renumber existing
-- columns, and dropping the view would take its dependents with it.
CREATE OR REPLACE VIEW v_payment_requests AS
 SELECT pr.id,
    pr.request_code,
    pr.source_type,
    pr.expense_id,
    pr.batch_payment_id,
    COALESCE(e.expense_code, bp.payment_code, pay.payroll_record) AS source_code,
    pr.title,
    pr.total_amount,
    pr.amount_in_words,
    pr.worker_count,
    pr.draft_count,
    pr.period_start,
    pr.period_end,
    pr.project_names,
    pr.status,
    pr.revision,
    pr.supersedes_id,
    prev.request_code AS supersedes_code,
    pr.issued_by,
    iss.full_name AS issued_by_name,
    pr.issued_at,
    pr.voided_by,
    vby.full_name AS voided_by_name,
    pr.voided_at,
    pr.void_reason,
    pr.notes,
    CASE
        WHEN pr.source_type = 'expense' THEN e.payment_state
        WHEN pr.source_type = 'payroll' THEN
            CASE WHEN pay.payment_status = 'paid' THEN 'paid' ELSE 'unpaid' END
        ELSE ( SELECT
                CASE
                    WHEN bool_and(x.payment_state = 'paid') THEN 'paid'
                    WHEN bool_or(x.payment_state = ANY (ARRAY['sent','paid'])) THEN 'sent'
                    ELSE 'unpaid'
                END
           FROM batch_payment_expenses bpe
             JOIN expenses x ON x.id = bpe.expense_id
          WHERE bpe.batch_payment_id = pr.batch_payment_id)
    END AS payment_state,
    pr.created_at,
    pr.updated_at,
    pr.payroll_id,
    pr.bank_scope,
    pr.bank_id,
    bank.account_name AS bank_name
   FROM payment_requests pr
     LEFT JOIN expenses e ON e.id = pr.expense_id
     LEFT JOIN batch_payments bp ON bp.id = pr.batch_payment_id
     LEFT JOIN payroll pay ON pay.id = pr.payroll_id
     LEFT JOIN payment_requests prev ON prev.id = pr.supersedes_id
     LEFT JOIN user_profiles iss ON iss.id = pr.issued_by
     LEFT JOIN user_profiles vby ON vby.id = pr.voided_by
     LEFT JOIN accounts bank ON bank.id = pr.bank_id;

-- ── 5. Nothing existing moves ────────────────────────────────────────────
-- Every row predates the split and covers its whole source, which is what
-- 'all' means — the column default already says so. Asserted rather than
-- assumed, since a row landing in the wrong scope would be superseded by
-- the wrong document later.
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM payment_requests
   WHERE bank_scope <> 'all' OR bank_id IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% pre-existing request(s) did not land in the all scope', v_bad;
  END IF;

  -- The new index must accept the rows already there. A payroll run that
  -- somehow had two live requests would fail the CREATE above, not here,
  -- but this states the invariant the rest of the migration relies on.
  SELECT count(*) INTO v_bad FROM (
    SELECT payroll_id FROM payment_requests
     WHERE status = 'issued' AND payroll_id IS NOT NULL
     GROUP BY payroll_id, bank_scope, bank_id HAVING count(*) > 1
  ) dupes;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% payroll run(s) already carry more than one live request for the same bank', v_bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
