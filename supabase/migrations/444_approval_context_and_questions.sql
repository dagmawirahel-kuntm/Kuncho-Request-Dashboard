-- 444 — What an approver needs to decide, and a question instead of a reject
--
-- The approval queue (395) said what each bill is and what holds it up. It
-- did not say what approving it does, or whether anything about it is odd.
-- v_approval_context gives, per bill waiting for approval:
--   paid already       paid at the gate (spot payment), or its reference is
--                      on a bank statement — approving puts it in the books
--   the payee          how often they were paid in the last year, the usual
--                      amount, when last — or that this is the first payment;
--                      whether the vendor's bank details are verified
--   the order          a purchase order's code, whether it is paid in
--                      advance or on delivery, and when it was delivered
--   the project        what is recorded against it so far, approved and not
--                      yet paid, and waiting here, against its contract value
--   the question       the latest question asked about it, and the answer
--
-- And a question to whoever raised it, instead of a reject: finance asks
-- (ask_expense_question), the requester is notified and answers on the
-- expense (answer_expense_question), and the asker is notified back.
--
-- Applied as 444_approval_context_and_questions, then
-- 444_approval_context_and_questions_2_ask_guards (the requester and
-- open-question checks in ask_expense_question).

SET search_path TO public;

-- ── 1. Questions about an expense ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (length(btrim(question)) > 0),
  asked_by uuid NOT NULL DEFAULT auth.uid(),
  asked_at timestamptz NOT NULL DEFAULT now(),
  answer text,
  answered_by uuid,
  answered_at timestamptz,
  CHECK ((answer IS NULL) = (answered_at IS NULL))
);
CREATE INDEX IF NOT EXISTS expense_questions_expense_idx ON expense_questions (expense_id, asked_at DESC);
ALTER TABLE expense_questions ENABLE ROW LEVEL SECURITY;

-- Finance, admin and executives read every question; whoever raised the
-- expense reads the ones about it. Writing goes through the functions below.
CREATE POLICY expense_questions_read ON expense_questions FOR SELECT TO authenticated USING (
  COALESCE(get_user_role() = ANY (ARRAY['admin'::user_role, 'finance'::user_role, 'executive'::user_role]), false)
  OR EXISTS (SELECT 1 FROM expenses e WHERE e.id = expense_questions.expense_id AND e.purchaser_user_id = auth.uid())
);

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order) VALUES
  ('expense.question', 'Expenses', 'Finance has a question about your expense', 'You raised it; answer it on the expense', 'high', 13),
  ('expense.answered', 'Expenses', 'Your question was answered', 'Finance and admin: the requester answered', 'normal', 11)
ON CONFLICT (kind) DO NOTHING;

-- Ask whoever raised a bill waiting for approval.
CREATE OR REPLACE FUNCTION ask_expense_question(p_expense_id uuid, p_question text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e expenses%ROWTYPE; v_q text := NULLIF(btrim(p_question), ''); v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only finance or admin can ask about an expense waiting for approval';
  END IF;
  IF v_q IS NULL THEN RAISE EXCEPTION 'Write the question'; END IF;
  SELECT * INTO e FROM expenses WHERE id = p_expense_id;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.approval_status::text NOT IN ('pending', 'manager_approved') THEN
    RAISE EXCEPTION 'This expense is no longer waiting for approval';
  END IF;
  IF e.purchaser_user_id IS NULL THEN
    RAISE EXCEPTION 'Nobody is recorded as raising this expense, so there is no one to ask';
  END IF;
  IF e.purchaser_user_id = auth.uid() THEN RAISE EXCEPTION 'You raised this expense yourself'; END IF;
  -- One open question at a time: the queue shows the latest one.
  IF EXISTS (SELECT 1 FROM expense_questions x WHERE x.expense_id = e.id AND x.answered_at IS NULL) THEN
    RAISE EXCEPTION 'A question about this expense is still waiting for an answer';
  END IF;
  INSERT INTO expense_questions (expense_id, question, asked_by)
  VALUES (e.id, left(v_q, 1000), auth.uid())
  RETURNING id INTO v_id;
  PERFORM notify(ARRAY[e.purchaser_user_id], 'expense.question',
    'Finance asks about ' || COALESCE(e.expense_code, 'your expense'),
    notify_short(v_q, 300), '/expenses/' || e.id, 'expense', e.id, NULL, 'q:' || v_id);
  RETURN v_id;
END $$;

-- Answer it: whoever raised the bill, or finance on their behalf.
CREATE OR REPLACE FUNCTION answer_expense_question(p_question_id uuid, p_answer text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE qq expense_questions%ROWTYPE; e expenses%ROWTYPE; v_a text := NULLIF(btrim(p_answer), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_a IS NULL THEN RAISE EXCEPTION 'Write the answer'; END IF;
  SELECT * INTO qq FROM expense_questions WHERE id = p_question_id FOR UPDATE;
  IF qq.id IS NULL THEN RAISE EXCEPTION 'Question not found'; END IF;
  IF qq.answered_at IS NOT NULL THEN RAISE EXCEPTION 'This question is already answered'; END IF;
  SELECT * INTO e FROM expenses WHERE id = qq.expense_id;
  IF NOT (e.purchaser_user_id = auth.uid() OR COALESCE(get_user_role() IN ('admin', 'finance'), false)) THEN
    RAISE EXCEPTION 'Only whoever raised the expense, or finance, can answer';
  END IF;
  UPDATE expense_questions SET answer = left(v_a, 2000), answered_by = auth.uid(), answered_at = now()
   WHERE id = qq.id;
  PERFORM notify(ARRAY[qq.asked_by], 'expense.answered',
    'Answered: ' || COALESCE(e.expense_code, 'an expense'),
    notify_short(v_a, 300), '/expenses/approvals?expense=' || e.id, 'expense', e.id, NULL, 'a:' || qq.id);
END $$;

-- The questions on an expense, with names.
CREATE OR REPLACE VIEW v_expense_questions WITH (security_invoker = true) AS
SELECT q.id, q.expense_id, q.question, q.asked_by, notify_user_name(q.asked_by) AS asked_by_name, q.asked_at,
  q.answer, q.answered_by, notify_user_name(q.answered_by) AS answered_by_name, q.answered_at
FROM expense_questions q;

-- ── 2. What approving each bill does ───────────────────────────────────────
CREATE OR REPLACE VIEW v_approval_context WITH (security_invoker = true) AS
WITH q AS MATERIALIZED (
  SELECT e.id, e.amount_etb, e.project_id, e.vendor_id, e.bank_ref, e.sourcing_bundle_id,
    e.spot_paid_by, e.spot_paid_at, e.spot_paid_method,
    COALESCE(e.vendor_id::text, 's:' || e.paid_to_staff_id::text, 'n:' || lower(NULLIF(btrim(e.vendors_name), ''))) AS payee_key
  FROM expenses e
  WHERE e.approval_status IN ('pending', 'manager_approved') AND NOT COALESCE(e.is_archived, false)
    AND e.date >= financials_cutover_date()
),
-- What each payee here was paid in the last year.
hist AS MATERIALIZED (
  SELECT x.payee_key, count(*)::int AS paid_count, sum(x.amount_etb) AS paid_total,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY x.amount_etb) AS typical_amount,
    max(x.paid_on) AS last_paid_on
  FROM (
    SELECT COALESCE(p.vendor_id::text, 's:' || p.paid_to_staff_id::text, 'n:' || lower(NULLIF(btrim(p.vendors_name), ''))) AS payee_key,
      p.amount_etb, COALESCE(p.paid_date::date, p.payment_state_changed_at::date, p.date) AS paid_on
    FROM expenses p
    WHERE p.payment_state IN ('paid', 'advance') AND NOT COALESCE(p.is_archived, false)
      AND p.date >= CURRENT_DATE - 365 AND p.amount_etb > 0
  ) x
  WHERE x.payee_key IN (SELECT payee_key FROM q)
  GROUP BY x.payee_key
),
-- Each project here: recorded against it, approved and not paid, waiting here.
proj AS MATERIALIZED (
  SELECT x.project_id,
    COALESCE(sum(x.amount_etb) FILTER (WHERE x.payment_state IN ('paid', 'advance')), 0) AS spent,
    COALESCE(sum(x.amount_etb) FILTER (WHERE x.approval_status = 'finance_approved'
                                         AND x.payment_state IN ('approved_to_pay', 'sent')), 0) AS approved_unpaid
  FROM expenses x
  WHERE x.project_id IN (SELECT project_id FROM q) AND NOT COALESCE(x.is_archived, false)
  GROUP BY x.project_id
),
waiting AS (
  SELECT project_id, sum(amount_etb) AS waiting FROM q WHERE project_id IS NOT NULL GROUP BY project_id
),
-- A bank line carrying its reference: the bank already paid it.
bank AS (
  SELECT DISTINCT ON (q.id) q.id, l.id AS line_id, l.value_date,
    COALESCE(NULLIF(l.debit_amount, 0), l.credit_amount) AS amount, l.reference_code
  FROM q JOIN bank_statement_lines l ON bank_ref_norm(l.reference_code) = bank_ref_norm(q.bank_ref)
  WHERE bank_ref_norm(q.bank_ref) IS NOT NULL
  ORDER BY q.id, l.value_date
),
grn AS (
  SELECT g.sourcing_bundle_id, min(g.received_at)::date AS delivered_on
  FROM goods_received_notes g
  WHERE g.sourcing_bundle_id IN (SELECT sourcing_bundle_id FROM q WHERE sourcing_bundle_id IS NOT NULL)
  GROUP BY g.sourcing_bundle_id
),
ques AS (
  SELECT DISTINCT ON (x.expense_id) x.expense_id, x.id, x.question, x.asked_by, x.asked_at, x.answer, x.answered_by, x.answered_at
  FROM expense_questions x
  WHERE x.expense_id IN (SELECT id FROM q)
  ORDER BY x.expense_id, x.asked_at DESC
)
SELECT q.id AS expense_id,
  -- Paid already
  (q.spot_paid_by IS NOT NULL) AS spot_paid, q.spot_paid_by, notify_user_name(q.spot_paid_by) AS spot_paid_by_name,
  q.spot_paid_at, q.spot_paid_method,
  b.line_id AS bank_line_id, b.value_date AS bank_line_date, round(b.amount, 2) AS bank_line_amount, b.reference_code AS bank_line_ref,
  -- The payee
  COALESCE(h.paid_count, 0) AS payee_paid_count, round(COALESCE(h.paid_total, 0), 2) AS payee_paid_total,
  round(h.typical_amount::numeric, 2) AS payee_typical_amount, h.last_paid_on AS payee_last_paid_on,
  v.verification_status AS vendor_verification,
  -- The order
  sb.bundle_code, sb.payment_pattern, sb.status::text AS po_status, grn.delivered_on,
  -- The project
  p.contract_value, round(COALESCE(pr.spent, 0), 2) AS project_spent,
  round(COALESCE(pr.approved_unpaid, 0), 2) AS project_approved_unpaid, round(COALESCE(w.waiting, 0), 2) AS project_waiting,
  -- The latest question
  qs.id AS question_id, qs.question, notify_user_name(qs.asked_by) AS asked_by_name, qs.asked_at,
  qs.answer, notify_user_name(qs.answered_by) AS answered_by_name, qs.answered_at
FROM q
LEFT JOIN hist h ON h.payee_key = q.payee_key
LEFT JOIN vendors v ON v.id = q.vendor_id
LEFT JOIN sourcing_bundles sb ON sb.id = q.sourcing_bundle_id
LEFT JOIN grn ON grn.sourcing_bundle_id = q.sourcing_bundle_id
LEFT JOIN projects p ON p.id = q.project_id
LEFT JOIN proj pr ON pr.project_id = q.project_id
LEFT JOIN waiting w ON w.project_id = q.project_id
LEFT JOIN bank b ON b.id = q.id
LEFT JOIN ques qs ON qs.expense_id = q.id;

-- ── 3. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON expense_questions FROM PUBLIC, anon;
GRANT SELECT ON expense_questions TO authenticated;
REVOKE ALL ON v_expense_questions, v_approval_context FROM PUBLIC, anon;
GRANT SELECT ON v_expense_questions, v_approval_context TO authenticated;
REVOKE ALL ON FUNCTION ask_expense_question(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ask_expense_question(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION answer_expense_question(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION answer_expense_question(uuid, text) TO authenticated;
