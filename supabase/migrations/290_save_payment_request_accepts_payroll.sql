-- 290 — save_payment_request accepts a payroll run
--
-- 289 widened the table; this widens the only way rows get into it. The
-- function rejects any source type it doesn't recognise by name, so without
-- this a payroll Payment Request fails at the door regardless of the schema.
--
-- The three branches are otherwise identical: check the source exists, find
-- the currently issued request for that same source, supersede it, and insert
-- the next revision. Keeping supersede scoped per source is what makes
-- re-issuing after an edit produce revision + 1 rather than a second live
-- document for the same run.

CREATE OR REPLACE FUNCTION public.save_payment_request(
  p_source_type text, p_source_id uuid, p_document_html text,
  p_snapshot jsonb DEFAULT '{}'::jsonb, p_payee_lines jsonb DEFAULT '[]'::jsonb,
  p_title text DEFAULT NULL, p_total_amount numeric DEFAULT 0,
  p_amount_in_words text DEFAULT NULL, p_worker_count integer DEFAULT 0,
  p_draft_count integer DEFAULT 1, p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL, p_project_names text[] DEFAULT NULL,
  p_notes text DEFAULT NULL)
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

  IF p_source_type NOT IN ('expense', 'batch_payment', 'payroll') THEN
    RAISE EXCEPTION 'Unknown Payment Request source type: %', p_source_type;
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
  END IF;

  SELECT * INTO v_prev
  FROM payment_requests
  WHERE status = 'issued'
    AND ((p_source_type = 'expense'       AND expense_id       = p_source_id)
      OR (p_source_type = 'batch_payment' AND batch_payment_id = p_source_id)
      OR (p_source_type = 'payroll'       AND payroll_id       = p_source_id))
  ORDER BY revision DESC, issued_at DESC
  LIMIT 1;

  IF v_prev.id IS NOT NULL THEN
    UPDATE payment_requests SET status = 'superseded', updated_at = now() WHERE id = v_prev.id;
  END IF;

  INSERT INTO payment_requests (
    source_type, expense_id, batch_payment_id, payroll_id,
    title, total_amount, amount_in_words, worker_count, draft_count,
    period_start, period_end, project_names,
    payee_lines, document_html, snapshot,
    revision, supersedes_id, issued_by, notes
  ) VALUES (
    p_source_type,
    CASE WHEN p_source_type = 'expense'       THEN p_source_id END,
    CASE WHEN p_source_type = 'batch_payment' THEN p_source_id END,
    CASE WHEN p_source_type = 'payroll'       THEN p_source_id END,
    p_title, COALESCE(p_total_amount, 0), p_amount_in_words,
    COALESCE(p_worker_count, 0), COALESCE(p_draft_count, 1),
    p_period_start, p_period_end, p_project_names,
    COALESCE(p_payee_lines, '[]'::jsonb), p_document_html, COALESCE(p_snapshot, '{}'::jsonb),
    COALESCE(v_prev.revision, 0) + 1, v_prev.id, auth.uid(), p_notes
  )
  RETURNING * INTO v_new;

  RETURN v_new;
END $function$;
