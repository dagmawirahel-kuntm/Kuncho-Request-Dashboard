-- 328 — A Payment Request (PRQ) for a VRF, and the PRQ register behind RLS
--
-- Until 322 a VRF was paid through a VRF expense, and finance issued its
-- "Vendor Receipt Payment Request" against that expense (PRQ-2026-0007 …
-- PRQ-2026-0034). 322 stopped creating those expenses, so a VRF recorded
-- since (VRF-20260924-01, VRF-20260925-01) had no way to get a PRQ.
--
-- - payment_requests gains vrf_id and a 'vrf' source type.
-- - save_payment_request() issues against a VRF once its payment is
--   approved or sent; re-issuing supersedes, as for every other source.
-- - v_payment_requests names the VRF as the source and reports its payment
--   as paid once the VRF is sent.
--
-- Security fix in the same view: v_payment_requests runs with its owner's
-- rights and anon could select from it, so anyone, signed in or not, could
-- read every PRQ's code, title, amount and issuer, past the table's own
-- RLS (pr_read: admin, executive, finance, or the issuer). The view now
-- applies that same rule itself and is closed to anon. It keeps its owner's
-- rights so the roles allowed in see exactly what they saw before: the
-- issuer's name (user_profiles only lets admin read other people) and a
-- batch's payment state (executive can't read every expense in a batch).

SET search_path TO public;

ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS vrf_id uuid REFERENCES vendor_receipt_facilitation(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS payment_requests_vrf_idx ON payment_requests(vrf_id) WHERE vrf_id IS NOT NULL;

ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_source_type_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_source_type_check
  CHECK (source_type IN ('expense', 'batch_payment', 'payroll', 'vrf'));

ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_source_ck;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_source_ck CHECK (
     (source_type = 'expense'       AND expense_id IS NOT NULL AND batch_payment_id IS NULL AND payroll_id IS NULL AND vrf_id IS NULL)
  OR (source_type = 'batch_payment' AND batch_payment_id IS NOT NULL AND expense_id IS NULL AND payroll_id IS NULL AND vrf_id IS NULL)
  OR (source_type = 'payroll'       AND payroll_id IS NOT NULL AND expense_id IS NULL AND batch_payment_id IS NULL AND vrf_id IS NULL)
  OR (source_type = 'vrf'           AND vrf_id IS NOT NULL AND expense_id IS NULL AND batch_payment_id IS NULL AND payroll_id IS NULL)
);

CREATE OR REPLACE FUNCTION public.save_payment_request(
  p_source_type text, p_source_id uuid, p_document_html text,
  p_snapshot jsonb DEFAULT '{}'::jsonb, p_payee_lines jsonb DEFAULT '[]'::jsonb,
  p_title text DEFAULT NULL::text, p_total_amount numeric DEFAULT 0, p_amount_in_words text DEFAULT NULL::text,
  p_worker_count integer DEFAULT 0, p_draft_count integer DEFAULT 1,
  p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date,
  p_project_names text[] DEFAULT NULL::text[], p_notes text DEFAULT NULL::text,
  p_bank_scope text DEFAULT 'all'::text, p_bank_id uuid DEFAULT NULL::uuid)
RETURNS payment_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_prev  payment_requests%ROWTYPE;
  v_new   payment_requests%ROWTYPE;
  v_scope text := COALESCE(p_bank_scope, 'all');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can issue a Payment Request';
  END IF;

  IF p_source_type NOT IN ('expense', 'batch_payment', 'payroll', 'vrf') THEN
    RAISE EXCEPTION 'Unknown Payment Request source type: %', p_source_type;
  END IF;

  IF v_scope NOT IN ('all', 'bank', 'unassigned') THEN
    RAISE EXCEPTION 'Unknown Payment Request bank scope: %', v_scope;
  END IF;
  IF v_scope <> 'all' AND p_source_type <> 'payroll' THEN
    RAISE EXCEPTION 'Only a payroll run can be split by bank (got scope % for source %)', v_scope, p_source_type;
  END IF;
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
  ELSIF p_source_type = 'vrf' THEN
    IF NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE id = p_source_id AND NOT is_archived) THEN
      RAISE EXCEPTION 'VRF % not found', p_source_id;
    END IF;
    -- A PRQ authorises the payment, so it follows approval.
    IF NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE id = p_source_id AND payment_state IN ('approved', 'sent')) THEN
      RAISE EXCEPTION 'Approve the VRF payment before issuing its Payment Request';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Payroll run % not found', p_source_id;
    END IF;
    IF v_scope = 'bank' AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_bank_id) THEN
      RAISE EXCEPTION 'Bank account % not found', p_bank_id;
    END IF;
  END IF;

  SELECT * INTO v_prev
  FROM payment_requests
  WHERE status = 'issued'
    AND ((p_source_type = 'expense'       AND expense_id       = p_source_id)
      OR (p_source_type = 'batch_payment' AND batch_payment_id = p_source_id)
      OR (p_source_type = 'vrf'           AND vrf_id           = p_source_id)
      OR (p_source_type = 'payroll'       AND payroll_id       = p_source_id
          AND bank_scope = v_scope
          AND bank_id IS NOT DISTINCT FROM p_bank_id))
  ORDER BY revision DESC, issued_at DESC
  LIMIT 1;

  IF v_prev.id IS NOT NULL THEN
    UPDATE payment_requests SET status = 'superseded', updated_at = now() WHERE id = v_prev.id;
  END IF;

  INSERT INTO payment_requests (
    source_type, expense_id, batch_payment_id, payroll_id, vrf_id,
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
    CASE WHEN p_source_type = 'vrf'           THEN p_source_id END,
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
REVOKE EXECUTE ON FUNCTION public.save_payment_request(text,uuid,text,jsonb,jsonb,text,numeric,text,integer,integer,date,date,text[],text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payment_request(text,uuid,text,jsonb,jsonb,text,numeric,text,integer,integer,date,date,text[],text,text,uuid) TO authenticated;

CREATE OR REPLACE VIEW v_payment_requests AS
SELECT pr.id,
  pr.request_code,
  pr.source_type,
  pr.expense_id,
  pr.batch_payment_id,
  COALESCE(e.expense_code, bp.payment_code, pay.payroll_record, f.record_name) AS source_code,
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
    WHEN pr.source_type = 'payroll' THEN CASE WHEN pay.payment_status = 'paid' THEN 'paid' ELSE 'unpaid' END
    WHEN pr.source_type = 'vrf' THEN CASE WHEN f.payment_state = 'sent' THEN 'paid' ELSE 'unpaid' END
    ELSE (SELECT CASE
                   WHEN bool_and(x.payment_state = 'paid') THEN 'paid'
                   WHEN bool_or(x.payment_state = ANY (ARRAY['sent', 'paid'])) THEN 'sent'
                   ELSE 'unpaid'
                 END
          FROM batch_payment_expenses bpe JOIN expenses x ON x.id = bpe.expense_id
          WHERE bpe.batch_payment_id = pr.batch_payment_id)
  END AS payment_state,
  pr.created_at,
  pr.updated_at,
  pr.payroll_id,
  pr.bank_scope,
  pr.bank_id,
  bank.account_name AS bank_name,
  pr.vrf_id
FROM payment_requests pr
LEFT JOIN expenses e ON e.id = pr.expense_id
LEFT JOIN batch_payments bp ON bp.id = pr.batch_payment_id
LEFT JOIN payroll pay ON pay.id = pr.payroll_id
LEFT JOIN vendor_receipt_facilitation f ON f.id = pr.vrf_id
LEFT JOIN payment_requests prev ON prev.id = pr.supersedes_id
LEFT JOIN user_profiles iss ON iss.id = pr.issued_by
LEFT JOIN user_profiles vby ON vby.id = pr.voided_by
LEFT JOIN accounts bank ON bank.id = pr.bank_id
-- The same rule as payment_requests' pr_read policy.
WHERE get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[])
   OR pr.issued_by = auth.uid();
REVOKE ALL ON v_payment_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_payment_requests TO authenticated;
