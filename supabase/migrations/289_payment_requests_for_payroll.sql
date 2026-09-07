-- 289 — a payroll run can now carry a Payment Request
--
-- payment_requests was built for two sources and its CHECK constraint says so:
-- exactly one of expense_id or batch_payment_id, and source_type must name
-- which. A payroll run is the third thing finance actually hands the bank —
-- and the one where the document matters most, because it is a single
-- instruction covering many payees at more than one bank.
--
-- This adds payroll_id and widens the constraint to a third branch, keeping
-- the same shape: source_type names the source, that source's id is set, and
-- the other two are null. Existing rows are untouched — both current branches
-- are carried through unchanged.
--
-- v_payment_requests is rebuilt to resolve a payroll source the same way it
-- resolves the other two: source_code from payroll_record, and a payment_state
-- from the run's own payment_status so the Payment Requests list can show
-- whether the money has actually gone out.

ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS payroll_id uuid REFERENCES payroll(id);

ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_source_type_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_source_type_check
  CHECK (source_type = ANY (ARRAY['expense', 'batch_payment', 'payroll']));

ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_source_ck;

ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_source_ck CHECK (
     (source_type = 'expense'       AND expense_id        IS NOT NULL AND batch_payment_id IS NULL AND payroll_id IS NULL)
  OR (source_type = 'batch_payment' AND batch_payment_id  IS NOT NULL AND expense_id       IS NULL AND payroll_id IS NULL)
  OR (source_type = 'payroll'       AND payroll_id        IS NOT NULL AND expense_id       IS NULL AND batch_payment_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_payroll ON payment_requests (payroll_id);

-- payroll_id is appended at the end of the select list rather than slotted in
-- beside the other two source columns: CREATE OR REPLACE VIEW cannot renumber
-- existing columns, and dropping the view would take its dependents with it.
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
    pr.payroll_id
   FROM payment_requests pr
     LEFT JOIN expenses e ON e.id = pr.expense_id
     LEFT JOIN batch_payments bp ON bp.id = pr.batch_payment_id
     LEFT JOIN payroll pay ON pay.id = pr.payroll_id
     LEFT JOIN payment_requests prev ON prev.id = pr.supersedes_id
     LEFT JOIN user_profiles iss ON iss.id = pr.issued_by
     LEFT JOIN user_profiles vby ON vby.id = pr.voided_by;
