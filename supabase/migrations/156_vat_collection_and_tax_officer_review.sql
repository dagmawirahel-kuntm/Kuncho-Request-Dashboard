-- ============================================================
-- Closes the two gaps between "receipts get collected" and "the tax
-- officer can file a VAT return from real data":
--
--   1. INPUT VAT (what we reclaim). vendor_receipts (112) already
--      captures vat_amount with a maker-checker, but nothing attributed
--      a receipt to a project and nothing gave the tax officer a say.
--   2. OUTPUT VAT (what we owe). sales had no VAT field at all, so
--      tax_summary.vat_from_sales was a hand-typed number with nothing
--      to reconcile it against.
--
-- ── Tax officer as a THIRD step, per user decision ──────────────────
-- The first instinct was to make the tax officer the checker, replacing
-- one side of 112's maker-checker. That was rejected once the cost was
-- clear: 112 deliberately requires one finance + one procurement person
-- (cross-department), and since is_tax_officer is only settable on
-- finance-role holders (153), a tax-officer-as-checker would have put
-- both sides of the control inside Finance. So the existing two-party
-- check is left exactly as it was, and tax review is added AFTER it:
--
--   pending_verification  --(cross-dept, 112, unchanged)-->  verified
--   verified              --(tax officer / admin)-->         tax_reviewed
--
-- All three identities must be distinct people. That is the point of a
-- three-party control, and it is enforced rather than advisory. Admin
-- can stand in for the tax officer (the house convention from 148: an
-- identity-scoped gate always keeps a role-based fallback so one
-- person's absence can't stall the flow) — but an admin standing in is
-- still a distinct third person, not an escape from the rule.
--
-- Only tax_reviewed receipts feed a filing. 'verified' now means
-- "genuine, cross-checked, and waiting for the tax officer" — a real
-- queue rather than a terminal state. v_monthly_vat_from_receipts is
-- repointed accordingly; it is read by v_tax_liability_summary (153),
-- which needs no change because the view keeps its name and shape.
-- Zero data impact: vendor_receipts has 0 rows today.
--
-- ── Output VAT, per user decision: sales.amount is VAT-INCLUSIVE ────
-- So VAT = amount × 15/115, not amount × 15%. The 15% rate matches the
-- VAT_RATE constant already used client-side in PurchaseOrderPage.
--
-- Two things deliberately NOT assumed:
--   - Not every sale is VAT-able. sales.is_vat_exempt (new, default
--     false) makes the exemption explicit and correctable per sale
--     instead of silently applying 15/115 to zero-rated or exempt
--     revenue.
--   - Which statuses create a VAT liability is a tax-law question, not
--     a schema question. The rollup counts Invoiced + Paid (liability
--     arising on invoice, the usual basis) and excludes Draft and
--     Cancelled. Refunded is excluded too but surfaced separately in
--     v_output_vat_by_sale, because whether a refund reverses an
--     already-declared VAT liability depends on when it was declared —
--     a human call, not something to bake in here.
-- ============================================================

SET search_path TO public;

-- ── 1. Project attribution on receipts ──────────────────────────────
-- Collection is the project finance / procurement officer's job, so a
-- receipt has to be chaseable per project. Previously attribution ran
-- only indirectly through expense_id -> expenses.project_id, which
-- broke entirely for GRN-linked receipts (grn_id set, expense_id null).
ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_receipts_project ON vendor_receipts(project_id);

COMMENT ON COLUMN vendor_receipts.project_id IS
  'Direct project attribution for receipt collection accountability. Falls back to expenses.project_id via expense_id when null, but set explicitly for GRN-linked receipts which have no expense.';

-- ── 2. The third state ──────────────────────────────────────────────
ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS reviewed_by      UUID REFERENCES user_profiles(id);
ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS reviewed_at      TIMESTAMPTZ;
ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS tax_review_note  TEXT;

ALTER TABLE vendor_receipts DROP CONSTRAINT IF EXISTS vendor_receipts_status_check;
ALTER TABLE vendor_receipts ADD CONSTRAINT vendor_receipts_status_check
  CHECK (status IN ('pending_verification', 'verified', 'tax_reviewed', 'rejected'));

-- ── 3. Three-party maker-checker-reviewer ───────────────────────────
CREATE OR REPLACE FUNCTION enforce_vendor_receipt_maker_checker()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_maker_role      TEXT;
  v_checker_role    TEXT;
  v_reviewer_is_tax BOOLEAN;
  v_reviewer_role   TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- entered_by is always the caller, never client-supplied — a
    -- COALESCE here would let a client claim someone else made the
    -- entry, defeating the whole point of tracking who the maker was.
    NEW.entered_by := auth.uid();
    NEW.entered_at := NOW();
    NEW.status     := 'pending_verification';
    NEW.verified_by := NULL; NEW.verified_at := NULL;
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  -- ── Step 2: cross-department verification. Unchanged from 112. ────
  IF OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected') THEN
    NEW.verified_by := auth.uid();
    NEW.verified_at := NOW();

    IF NEW.verified_by = NEW.entered_by THEN
      RAISE EXCEPTION 'The same person cannot both enter and verify a vendor receipt';
    END IF;

    SELECT role INTO v_maker_role   FROM user_profiles WHERE id = NEW.entered_by;
    SELECT role INTO v_checker_role FROM user_profiles WHERE id = NEW.verified_by;

    IF NOT (
      (v_maker_role IN ('finance', 'admin') AND v_checker_role IN ('procurement_officer', 'admin'))
      OR (v_maker_role IN ('procurement_officer', 'admin') AND v_checker_role IN ('finance', 'admin'))
    ) THEN
      RAISE EXCEPTION 'A vendor receipt must be verified by someone from a different department than whoever entered it (one finance, one procurement)';
    END IF;

  -- ── Step 3: tax officer accepts it into a filing, or rejects. ─────
  ELSIF OLD.status = 'verified' AND NEW.status IN ('tax_reviewed', 'rejected') THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := NOW();

    SELECT is_tax_officer, role INTO v_reviewer_is_tax, v_reviewer_role
    FROM user_profiles WHERE id = NEW.reviewed_by;

    IF NOT (COALESCE(v_reviewer_is_tax, false) OR v_reviewer_role = 'admin') THEN
      RAISE EXCEPTION 'Only the designated Tax Officer (or an admin standing in) can accept a receipt into a tax filing';
    END IF;

    -- Three distinct people. An admin standing in for the tax officer
    -- is still a third person, not an exemption from the rule.
    IF NEW.reviewed_by = NEW.entered_by OR NEW.reviewed_by = NEW.verified_by THEN
      RAISE EXCEPTION 'Tax review must be done by someone other than the person who entered or verified the receipt';
    END IF;

  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Invalid vendor receipt status transition from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Only tax-reviewed receipts feed a filing ─────────────────────
-- Read by v_tax_liability_summary (153); name and column shape are
-- unchanged, so that view needs no edit.
CREATE OR REPLACE VIEW v_monthly_vat_from_receipts
WITH (security_invoker = true) AS
SELECT
  TO_CHAR(receipt_date, 'YYYY-MM') AS month,
  count(*)                  AS receipt_count,
  SUM(vat_amount)           AS total_vat,
  SUM(withholding_amount)   AS total_withholding
FROM vendor_receipts
WHERE status = 'tax_reviewed' AND receipt_date IS NOT NULL
GROUP BY TO_CHAR(receipt_date, 'YYYY-MM')
ORDER BY month;

GRANT SELECT ON v_monthly_vat_from_receipts TO authenticated;

-- ── 5. The tax officer's queue ──────────────────────────────────────
CREATE OR REPLACE VIEW v_receipts_awaiting_tax_review
WITH (security_invoker = true) AS
SELECT
  vr.id, vr.receipt_no, vr.receipt_date, vr.vat_amount, vr.withholding_amount,
  vr.vendor_tin_on_receipt, vr.document_url,
  v.vendor_name,
  COALESCE(vr.project_id, e.project_id) AS project_id,
  p.project_name,
  e.expense_code,
  maker.full_name    AS entered_by_name,
  checker.full_name  AS verified_by_name,
  vr.verified_at
FROM vendor_receipts vr
LEFT JOIN vendors v        ON v.id = vr.vendor_id
LEFT JOIN expenses e       ON e.id = vr.expense_id
LEFT JOIN projects p       ON p.id = COALESCE(vr.project_id, e.project_id)
LEFT JOIN user_profiles maker   ON maker.id = vr.entered_by
LEFT JOIN user_profiles checker ON checker.id = vr.verified_by
WHERE vr.status = 'verified';

GRANT SELECT ON v_receipts_awaiting_tax_review TO authenticated;

-- ── 6. What hasn't been collected yet, by project ───────────────────
-- Deliberately does NOT try to infer which expenses "should" have VAT:
-- that depends on whether the vendor is VAT-registered, which this
-- schema doesn't record (vendors has tin, but a TIN is not the same as
-- VAT registration). Every paid expense with no receipt is listed, with
-- the vendor's TIN exposed so the tax officer can judge.
CREATE OR REPLACE VIEW v_receipts_outstanding
WITH (security_invoker = true) AS
SELECT
  e.id AS expense_id, e.expense_code, e.date, e.amount_etb,
  e.project_id, p.project_name,
  e.vendor_id, v.vendor_name, v.tin AS vendor_tin,
  CASE WHEN vr.id IS NULL THEN 'none' ELSE vr.status END AS receipt_status
FROM expenses e
LEFT JOIN vendors  v ON v.id = e.vendor_id
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN LATERAL (
  SELECT id, status FROM vendor_receipts WHERE expense_id = e.id
  ORDER BY CASE status WHEN 'tax_reviewed' THEN 1 WHEN 'verified' THEN 2 WHEN 'pending_verification' THEN 3 ELSE 4 END
  LIMIT 1
) vr ON TRUE
WHERE e.payment_status = true
  AND (vr.id IS NULL OR vr.status <> 'tax_reviewed');

GRANT SELECT ON v_receipts_outstanding TO authenticated;

-- ── 7. Output VAT, derived from VAT-inclusive sale amounts ──────────
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_vat_exempt BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN sales.is_vat_exempt IS
  'True for zero-rated/exempt revenue. Default false: sales.amount is VAT-inclusive, so output VAT = amount * 15/115 unless flagged here.';

CREATE OR REPLACE VIEW v_output_vat_by_sale
WITH (security_invoker = true) AS
SELECT
  s.id, s.invoice_number, s.date, s.sales_status, s.amount AS gross_amount,
  s.is_vat_exempt,
  CASE WHEN s.is_vat_exempt THEN 0 ELSE ROUND(s.amount * 15.0 / 115.0, 2) END AS output_vat,
  CASE WHEN s.is_vat_exempt THEN s.amount ELSE ROUND(s.amount * 100.0 / 115.0, 2) END AS net_of_vat,
  s.client_id, c.client_name, s.project_id
FROM sales s
LEFT JOIN clients c ON c.id = s.client_id;

GRANT SELECT ON v_output_vat_by_sale TO authenticated;

CREATE OR REPLACE VIEW v_monthly_output_vat
WITH (security_invoker = true) AS
SELECT
  TO_CHAR(s.date, 'YYYY-MM') AS month,
  count(*)                                       AS sale_count,
  SUM(s.amount)                                  AS gross_total,
  SUM(ROUND(s.amount * 15.0 / 115.0, 2))         AS output_vat
FROM sales s
WHERE s.date IS NOT NULL
  AND NOT s.is_vat_exempt
  AND s.sales_status IN ('Invoiced', 'Paid')
GROUP BY TO_CHAR(s.date, 'YYYY-MM')
ORDER BY month;

GRANT SELECT ON v_monthly_output_vat TO authenticated;

-- ── 8. Fold output VAT into the consolidated liability view (153) ───
CREATE OR REPLACE VIEW v_tax_liability_summary
WITH (security_invoker = true) AS
SELECT 'Tax Summary (VAT — expenses)' AS category, month AS period, vat_from_expenses AS amount FROM tax_summary WHERE vat_from_expenses > 0
UNION ALL
SELECT 'Tax Summary (VAT — sales)', month, vat_from_sales FROM tax_summary WHERE vat_from_sales > 0
UNION ALL
SELECT 'Tax Summary (WHT — expenses)', month, wht_from_expenses FROM tax_summary WHERE wht_from_expenses > 0
UNION ALL
SELECT 'Tax Summary (WHT — deducted by client)', month, wht_deducted_by_client FROM tax_summary WHERE wht_deducted_by_client > 0
UNION ALL
SELECT 'Input VAT (tax-reviewed receipts)', month, total_vat FROM v_monthly_vat_from_receipts WHERE total_vat > 0
UNION ALL
SELECT 'WHT (receipts, as printed)', month, total_withholding FROM v_monthly_vat_from_receipts WHERE total_withholding > 0
UNION ALL
SELECT 'Output VAT (derived from sales)', month, output_vat FROM v_monthly_output_vat WHERE output_vat > 0
UNION ALL
SELECT 'Payroll tax', payroll_month, SUM(tax_amount) FROM payroll_taxes GROUP BY payroll_month HAVING SUM(tax_amount) > 0;

GRANT SELECT ON v_tax_liability_summary TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'vendor_receipts'::regclass AND conname = 'vendor_receipts_status_check';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'vendor_receipts' AND column_name IN ('project_id','reviewed_by','reviewed_at','tax_review_note')
ORDER BY column_name;

SELECT column_name FROM information_schema.columns WHERE table_name='sales' AND column_name='is_vat_exempt';

-- All should run without error; all return 0 rows on today's data
-- (0 vendor_receipts, 0 sales).
SELECT count(*) AS awaiting_tax_review FROM v_receipts_awaiting_tax_review;
SELECT count(*) AS outstanding_receipts FROM v_receipts_outstanding;
SELECT count(*) AS output_vat_months FROM v_monthly_output_vat;
SELECT category, period, amount FROM v_tax_liability_summary ORDER BY category, period;
