-- ============================================================
-- Receipt tracking on both sides of VAT, plus the company's live tax
-- position derived from them.
--
-- Three things this adds:
--   1. PHYSICAL custody tracking on vendor receipts. Photographing a
--      receipt proves it exists; it does not prove the paper reached
--      the office, which is what an ERCA audit actually asks for.
--   2. A SALES-side mirror (sales_receipts) — the VAT invoices we
--      issue. Output VAT was derived from sales.amount (156) with no
--      document behind it; now the figure has evidence.
--   3. v_tax_position — output VAT minus reclaimable input VAT per
--      month, which is the "tax position" the numbers add up to.
--
-- ── Physical custody is a SEPARATE AXIS, not a fourth status ────────
-- Deliberate. The paper can arrive before the digital review or long
-- after it, and the two are confirmed by different people for
-- different reasons. Folding "physical received" into the status enum
-- would make one of those orderings unrepresentable and would force a
-- false sequence on a process that genuinely has none. So custody is
-- its own nullable pair of columns, orthogonal to
-- pending_verification -> verified -> tax_reviewed.
--
-- ── Sales is TWO steps, purchases are THREE ────────────────────────
-- Not an oversight. A vendor receipt is someone else's document that
-- we use to reclaim money from ERCA, so it carries the full
-- collect -> cross-department verify -> tax review chain (112 + 156).
-- A sales receipt is our own document recording money we already owe;
-- the risk is failing to declare it, not fabricating it. So the chain
-- is present -> tax officer reviews, with the same "two distinct
-- people" floor and the same tax-officer gate.
--
-- ── Storage: a PRIVATE bucket ───────────────────────────────────────
-- Receipt photos carry vendor TINs, commercial amounts, and client
-- identities. The existing 'documents' bucket is PUBLIC (public_read_
-- documents policy, bucket_id='documents'), which is fine for generated
-- contracts but wrong for tax evidence. This follows the private
-- 'vendor-documents' pattern instead: authenticated-only, read through
-- signed URLs.
-- ============================================================

SET search_path TO public;

-- ── 1. Private bucket for receipt images ────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('tax-documents', 'tax-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "tax_docs_upload" ON storage.objects;
CREATE POLICY "tax_docs_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tax-documents');

DROP POLICY IF EXISTS "tax_docs_select" ON storage.objects;
CREATE POLICY "tax_docs_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tax-documents');

DROP POLICY IF EXISTS "tax_docs_delete" ON storage.objects;
CREATE POLICY "tax_docs_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tax-documents');

-- ── 2. Physical custody on vendor receipts ──────────────────────────
ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS physical_received_at TIMESTAMPTZ;
ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS physical_received_by UUID REFERENCES user_profiles(id);
ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS physical_note        TEXT;

COMMENT ON COLUMN vendor_receipts.physical_received_at IS
  'When the paper receipt physically reached the office. Independent of the review chain — a receipt can be tax_reviewed from a photo before the paper arrives, or the paper can arrive first. Null means still outstanding.';

-- ── 3. Sales receipts — the VAT invoices we issue ───────────────────
CREATE TABLE IF NOT EXISTS sales_receipts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id              UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  project_id           UUID REFERENCES projects(id) ON DELETE SET NULL,
  receipt_no           TEXT,
  receipt_date         DATE,
  vat_amount           NUMERIC(12,2),
  document_url         TEXT,
  document_name        TEXT,
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'tax_reviewed', 'rejected')),
  presented_by         UUID REFERENCES user_profiles(id),
  presented_at         TIMESTAMPTZ,
  reviewed_by          UUID REFERENCES user_profiles(id),
  reviewed_at          TIMESTAMPTZ,
  tax_review_note      TEXT,
  rejection_reason     TEXT,
  physical_received_at TIMESTAMPTZ,
  physical_received_by UUID REFERENCES user_profiles(id),
  physical_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sale_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_receipts_sale    ON sales_receipts(sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_receipts_project ON sales_receipts(project_id);
CREATE INDEX IF NOT EXISTS idx_sales_receipts_status  ON sales_receipts(status);

CREATE OR REPLACE FUNCTION enforce_sales_receipt_presenter_reviewer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reviewer_is_tax BOOLEAN;
  v_reviewer_role   TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Same reasoning as 112: never client-supplied, or the presenter
    -- identity is worthless as a record of who is accountable.
    NEW.presented_by := auth.uid();
    NEW.presented_at := NOW();
    NEW.status       := 'pending_review';
    NEW.reviewed_by  := NULL; NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending_review' AND NEW.status IN ('tax_reviewed', 'rejected') THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := NOW();

    SELECT is_tax_officer, role INTO v_reviewer_is_tax, v_reviewer_role
    FROM user_profiles WHERE id = NEW.reviewed_by;

    IF NOT (COALESCE(v_reviewer_is_tax, false) OR v_reviewer_role = 'admin') THEN
      RAISE EXCEPTION 'Only the designated Tax Officer (or an admin standing in) can review a sales receipt';
    END IF;

    IF NEW.reviewed_by = NEW.presented_by THEN
      RAISE EXCEPTION 'The person who presented a sales receipt cannot also review it';
    END IF;

  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Invalid sales receipt status transition from % to %', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sales_receipt_presenter_reviewer ON sales_receipts;
CREATE TRIGGER trg_enforce_sales_receipt_presenter_reviewer
  BEFORE INSERT OR UPDATE ON sales_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_sales_receipt_presenter_reviewer();

ALTER TABLE sales_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_receipts_read" ON sales_receipts;
CREATE POLICY "sales_receipts_read" ON sales_receipts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "sales_receipts_insert" ON sales_receipts;
CREATE POLICY "sales_receipts_insert" ON sales_receipts FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'finance', 'sales', 'project_manager'));

DROP POLICY IF EXISTS "sales_receipts_update" ON sales_receipts;
CREATE POLICY "sales_receipts_update" ON sales_receipts FOR UPDATE
  USING (get_user_role() IN ('admin', 'finance', 'sales', 'project_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_receipts TO authenticated;

-- ── 4. Physical-custody confirmation, as callable actions ───────────
-- RPCs rather than a raw UPDATE so "who may confirm custody" is one
-- rule in one place. Finance (which includes the tax officer) or admin
-- — the two parties the user named as able to confirm the paper.
CREATE OR REPLACE FUNCTION confirm_vendor_receipt_physical(p_receipt_id UUID, p_note TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only finance or admin can confirm physical receipt of a document';
  END IF;
  UPDATE vendor_receipts
  SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
  WHERE id = p_receipt_id AND physical_received_at IS NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION confirm_vendor_receipt_physical(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION confirm_sales_receipt_physical(p_receipt_id UUID, p_note TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only finance or admin can confirm physical receipt of a document';
  END IF;
  UPDATE sales_receipts
  SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
  WHERE id = p_receipt_id AND physical_received_at IS NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION confirm_sales_receipt_physical(UUID, TEXT) TO authenticated;

-- ── 5. Sales still owing a receipt ──────────────────────────────────
-- Draft and Cancelled excluded: nothing is owed on a sale that hasn't
-- been issued or has been called off.
CREATE OR REPLACE VIEW v_sales_receipts_outstanding
WITH (security_invoker = true) AS
SELECT
  s.id AS sale_id, s.invoice_number, s.date, s.amount AS gross_amount,
  s.sales_status, s.is_vat_exempt,
  CASE WHEN s.is_vat_exempt THEN 0 ELSE ROUND(s.amount * 15.0 / 115.0, 2) END AS expected_vat,
  s.project_id, p.project_name, s.client_id, c.client_name,
  CASE WHEN sr.id IS NULL THEN 'none' ELSE sr.status END AS receipt_status
FROM sales s
LEFT JOIN projects p       ON p.id = s.project_id
LEFT JOIN clients  c       ON c.id = s.client_id
LEFT JOIN sales_receipts sr ON sr.sale_id = s.id
WHERE s.sales_status IN ('Invoiced', 'Paid')
  AND (sr.id IS NULL OR sr.status <> 'tax_reviewed');

GRANT SELECT ON v_sales_receipts_outstanding TO authenticated;

CREATE OR REPLACE VIEW v_sales_receipts_awaiting_review
WITH (security_invoker = true) AS
SELECT
  sr.id, sr.receipt_no, sr.receipt_date, sr.vat_amount, sr.document_url,
  sr.physical_received_at,
  s.invoice_number, s.amount AS gross_amount,
  c.client_name, p.project_name,
  presenter.full_name AS presented_by_name, sr.presented_at
FROM sales_receipts sr
JOIN sales s          ON s.id = sr.sale_id
LEFT JOIN clients c   ON c.id = s.client_id
LEFT JOIN projects p  ON p.id = COALESCE(sr.project_id, s.project_id)
LEFT JOIN user_profiles presenter ON presenter.id = sr.presented_by
WHERE sr.status = 'pending_review';

GRANT SELECT ON v_sales_receipts_awaiting_review TO authenticated;

-- ── 6. The tax position ─────────────────────────────────────────────
-- Output VAT (what we owe on sales) minus input VAT we can actually
-- reclaim (tax-reviewed receipts only — an unreviewed receipt is not a
-- reclaimable one). Positive = payable to ERCA, negative = reclaimable.
-- FULL OUTER JOIN so a month with only one side still appears rather
-- than silently vanishing.
CREATE OR REPLACE VIEW v_tax_position
WITH (security_invoker = true) AS
SELECT
  COALESCE(o.month, i.month)                                    AS month,
  COALESCE(o.output_vat, 0)                                     AS output_vat,
  COALESCE(i.total_vat, 0)                                      AS input_vat_reclaimable,
  COALESCE(o.output_vat, 0) - COALESCE(i.total_vat, 0)          AS net_vat,
  CASE
    WHEN COALESCE(o.output_vat, 0) - COALESCE(i.total_vat, 0) >= 0 THEN 'payable'
    ELSE 'reclaimable'
  END                                                            AS position,
  COALESCE(o.sale_count, 0)                                      AS sale_count,
  COALESCE(i.receipt_count, 0)                                   AS reviewed_receipt_count
FROM v_monthly_output_vat o
FULL OUTER JOIN v_monthly_vat_from_receipts i ON i.month = o.month
ORDER BY 1 DESC;

GRANT SELECT ON v_tax_position TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT id, public FROM storage.buckets WHERE id = 'tax-documents';

SELECT column_name FROM information_schema.columns
WHERE table_name='vendor_receipts' AND column_name LIKE 'physical%' ORDER BY column_name;

SELECT count(*) AS sales_receipts_table_exists
FROM information_schema.tables WHERE table_name='sales_receipts';

SELECT proname FROM pg_proc
WHERE proname IN ('confirm_vendor_receipt_physical','confirm_sales_receipt_physical','enforce_sales_receipt_presenter_reviewer')
ORDER BY proname;

-- All run clean; all empty on today's data (0 receipts, 0 sales).
SELECT count(*) AS sales_outstanding FROM v_sales_receipts_outstanding;
SELECT count(*) AS sales_awaiting_review FROM v_sales_receipts_awaiting_review;
SELECT * FROM v_tax_position;
