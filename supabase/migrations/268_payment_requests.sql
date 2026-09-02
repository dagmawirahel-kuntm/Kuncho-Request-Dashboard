-- 268 — Saved Payment Requests
--
-- Until now the Payment Request existed only as a `window.print()` view:
-- ExpenseDetailPage rendered one for a single labor draft, and
-- BatchPaymentDetailPage rendered one for a batch. Both were built from
-- whatever the tables happened to say at the moment someone hit Print.
--
-- That leaves two holes:
--
--   1. No record. Nothing in the system knows a Payment Request was ever
--      issued, by whom, for how much, or against which drafts. Finance
--      cannot answer "show me the PR we sent to the bank on the 14th"
--      because the document only ever lived in a print dialog.
--
--   2. No stability. Reprinting after a rate correction, a worker merge
--      or an un-approval silently produces a *different* document under
--      the same circumstances. A payment authorisation that changes
--      retroactively is not an authorisation.
--
-- So a saved Payment Request freezes the rendered document alongside the
-- structured data behind it. `document_html` is the archive copy — what
-- was actually authorised — and `snapshot` is the same content in a form
-- you can query (totals per worker, per draft, bank lines). Later edits
-- to expenses or timesheets do not reach back into either.
--
-- Re-issuing against the same source does not overwrite: the previous
-- row is marked `superseded` and the new one carries revision + 1 and a
-- supersedes_id back-pointer, so the trail of what was authorised when
-- stays intact.
--
-- Code prefix note: 'PR-' is already taken — generate_request_code()
-- stamps order requests (purchase requisitions) with PR-YYYY-NNNN. Using
-- it again here would produce two unrelated documents sharing a code
-- format in a system where people quote codes to each other. Payment
-- Requests get PRQ-YYYY-NNNN.

CREATE SEQUENCE IF NOT EXISTS payment_request_seq;

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code      text UNIQUE,

  -- Exactly one source. A PR is raised either against a single labor
  -- expense draft or against a batch of them; the CHECK below keeps the
  -- pair honest rather than trusting callers.
  source_type       text NOT NULL CHECK (source_type IN ('expense', 'batch_payment')),
  expense_id        uuid REFERENCES expenses(id) ON DELETE RESTRICT,
  batch_payment_id  uuid REFERENCES batch_payments(id) ON DELETE RESTRICT,

  title             text,
  total_amount      numeric NOT NULL DEFAULT 0,
  amount_in_words   text,
  worker_count      int NOT NULL DEFAULT 0,
  draft_count       int NOT NULL DEFAULT 1,
  period_start      date,
  period_end        date,
  project_names     text[],

  -- The disbursement schedule as issued: one entry per payee with the
  -- bank account and amount. Kept as its own column (not buried in
  -- snapshot) because finance queries it directly — "what did we tell
  -- the bank to pay this worker in August".
  payee_lines       jsonb NOT NULL DEFAULT '[]'::jsonb,

  document_html     text NOT NULL,
  snapshot          jsonb NOT NULL DEFAULT '{}'::jsonb,

  status            text NOT NULL DEFAULT 'issued'
                      CHECK (status IN ('issued', 'superseded', 'void')),
  revision          int NOT NULL DEFAULT 1,
  supersedes_id     uuid REFERENCES payment_requests(id) ON DELETE SET NULL,

  issued_by         uuid REFERENCES user_profiles(id),
  issued_at         timestamptz NOT NULL DEFAULT now(),
  voided_by         uuid REFERENCES user_profiles(id),
  voided_at         timestamptz,
  void_reason       text,

  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_requests_source_ck CHECK (
    (source_type = 'expense'       AND expense_id IS NOT NULL AND batch_payment_id IS NULL) OR
    (source_type = 'batch_payment' AND batch_payment_id IS NOT NULL AND expense_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS payment_requests_expense_idx ON payment_requests(expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_requests_batch_idx   ON payment_requests(batch_payment_id) WHERE batch_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_requests_status_idx  ON payment_requests(status, issued_at DESC);

COMMENT ON TABLE public.payment_requests IS
  'Issued Payment Request documents, frozen at issue time. document_html is the archive copy of what was authorised; snapshot/payee_lines are the same content in queryable form. Re-issuing supersedes rather than overwrites.';
COMMENT ON COLUMN public.payment_requests.document_html IS
  'The rendered document exactly as issued. Deliberately not regenerated on read — later edits to expenses, rates or staff records must not change a document someone already signed.';

-- ── Code stamping ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_payment_request_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.request_code IS NULL THEN
    NEW.request_code := 'PRQ-' || TO_CHAR(NOW(), 'YYYY') || '-'
      || LPAD(nextval('payment_request_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_payment_request_code ON payment_requests;
CREATE TRIGGER trg_payment_request_code
  BEFORE INSERT ON payment_requests
  FOR EACH ROW EXECUTE FUNCTION generate_payment_request_code();

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- A Payment Request carries per-worker pay and bank accounts, so read is
-- narrower than the expense it derives from: the finance/leadership roles
-- that already see disbursement data, plus whoever issued it. Writes go
-- exclusively through save_payment_request() / void_payment_request(),
-- which are SECURITY DEFINER — there is deliberately no direct INSERT or
-- UPDATE policy, so a frozen document cannot be edited after the fact.

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pr_read ON public.payment_requests;
CREATE POLICY pr_read ON public.payment_requests
  FOR SELECT
  USING (
    get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[])
    OR issued_by = auth.uid()
  );

-- ── Issue ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_payment_request(
  p_source_type      text,
  p_source_id        uuid,
  p_document_html    text,
  p_snapshot         jsonb DEFAULT '{}'::jsonb,
  p_payee_lines      jsonb DEFAULT '[]'::jsonb,
  p_title            text  DEFAULT NULL,
  p_total_amount     numeric DEFAULT 0,
  p_amount_in_words  text  DEFAULT NULL,
  p_worker_count     int   DEFAULT 0,
  p_draft_count      int   DEFAULT 1,
  p_period_start     date  DEFAULT NULL,
  p_period_end       date  DEFAULT NULL,
  p_project_names    text[] DEFAULT NULL,
  p_notes            text  DEFAULT NULL
)
RETURNS payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prev payment_requests%ROWTYPE;
  v_new  payment_requests%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can issue a Payment Request';
  END IF;

  IF p_source_type NOT IN ('expense', 'batch_payment') THEN
    RAISE EXCEPTION 'Unknown Payment Request source type: %', p_source_type;
  END IF;

  IF p_document_html IS NULL OR length(btrim(p_document_html)) = 0 THEN
    RAISE EXCEPTION 'Cannot save an empty Payment Request document';
  END IF;

  -- The source has to exist. Without this the FK would still catch it,
  -- but with a constraint name instead of something finance can read.
  IF p_source_type = 'expense' THEN
    IF NOT EXISTS (SELECT 1 FROM expenses WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Expense % not found', p_source_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM batch_payments WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Batch payment % not found', p_source_id;
    END IF;
  END IF;

  -- Supersede rather than overwrite: the previously issued PR for this
  -- source stays readable, flagged, with the new one pointing back at it.
  SELECT * INTO v_prev
  FROM payment_requests
  WHERE status = 'issued'
    AND ((p_source_type = 'expense'       AND expense_id = p_source_id)
      OR (p_source_type = 'batch_payment' AND batch_payment_id = p_source_id))
  ORDER BY revision DESC, issued_at DESC
  LIMIT 1;

  IF v_prev.id IS NOT NULL THEN
    UPDATE payment_requests
       SET status = 'superseded', updated_at = now()
     WHERE id = v_prev.id;
  END IF;

  INSERT INTO payment_requests (
    source_type, expense_id, batch_payment_id,
    title, total_amount, amount_in_words, worker_count, draft_count,
    period_start, period_end, project_names,
    payee_lines, document_html, snapshot,
    revision, supersedes_id, issued_by, notes
  ) VALUES (
    p_source_type,
    CASE WHEN p_source_type = 'expense' THEN p_source_id END,
    CASE WHEN p_source_type = 'batch_payment' THEN p_source_id END,
    p_title, COALESCE(p_total_amount, 0), p_amount_in_words,
    COALESCE(p_worker_count, 0), COALESCE(p_draft_count, 1),
    p_period_start, p_period_end, p_project_names,
    COALESCE(p_payee_lines, '[]'::jsonb), p_document_html, COALESCE(p_snapshot, '{}'::jsonb),
    COALESCE(v_prev.revision, 0) + 1, v_prev.id, auth.uid(), p_notes
  )
  RETURNING * INTO v_new;

  RETURN v_new;
END $function$;

COMMENT ON FUNCTION public.save_payment_request IS
  'Issues a Payment Request against one expense or one batch payment, freezing the rendered document. Any previously issued PR for the same source is marked superseded and back-linked, so re-issuing after a correction keeps both versions.';

-- ── Void ─────────────────────────────────────────────────────────────────────
--
-- Deletion is the wrong verb for an authorisation document. Voiding keeps
-- the row and the reason, which is what an auditor asking "why is PRQ-…-0007
-- missing" actually needs.

CREATE OR REPLACE FUNCTION public.void_payment_request(
  p_payment_request_id uuid,
  p_reason             text
)
RETURNS payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row payment_requests%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can void a Payment Request';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required to void a Payment Request';
  END IF;

  SELECT * INTO v_row FROM payment_requests WHERE id = p_payment_request_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Payment Request % not found', p_payment_request_id;
  END IF;
  IF v_row.status = 'void' THEN
    RAISE EXCEPTION 'Payment Request % is already void', v_row.request_code;
  END IF;

  UPDATE payment_requests
     SET status = 'void', voided_by = auth.uid(), voided_at = now(),
         void_reason = p_reason, updated_at = now()
   WHERE id = p_payment_request_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

COMMENT ON FUNCTION public.void_payment_request IS
  'Marks an issued Payment Request void with a required reason. Never deletes — the register has to explain its own gaps.';

-- ── Register view ────────────────────────────────────────────────────────────
--
-- document_html is deliberately excluded. It is the largest column by far
-- and the register lists hundreds of rows; the document is fetched only
-- when someone opens one.

CREATE OR REPLACE VIEW public.v_payment_requests
WITH (security_invoker = true) AS
SELECT
  pr.id,
  pr.request_code,
  pr.source_type,
  pr.expense_id,
  pr.batch_payment_id,
  COALESCE(e.expense_code, bp.payment_code) AS source_code,
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
  -- Payment state of what the PR authorises, so the register can show
  -- "issued but never paid" without a second round-trip per row.
  CASE
    WHEN pr.source_type = 'expense' THEN e.payment_state
    ELSE (
      SELECT CASE
               WHEN bool_and(x.payment_state = 'paid') THEN 'paid'
               WHEN bool_or(x.payment_state IN ('sent', 'paid')) THEN 'sent'
               ELSE 'unpaid'
             END
      FROM batch_payment_expenses bpe
      JOIN expenses x ON x.id = bpe.expense_id
      WHERE bpe.batch_payment_id = pr.batch_payment_id
    )
  END AS payment_state,
  pr.created_at,
  pr.updated_at
FROM payment_requests pr
LEFT JOIN expenses e        ON e.id = pr.expense_id
LEFT JOIN batch_payments bp ON bp.id = pr.batch_payment_id
LEFT JOIN payment_requests prev ON prev.id = pr.supersedes_id
LEFT JOIN user_profiles iss ON iss.id = pr.issued_by
LEFT JOIN user_profiles vby ON vby.id = pr.voided_by;

COMMENT ON VIEW public.v_payment_requests IS
  'Payment Request register. Excludes document_html by design — the archived document is fetched only when a specific PR is opened.';

GRANT SELECT ON public.v_payment_requests TO authenticated;
