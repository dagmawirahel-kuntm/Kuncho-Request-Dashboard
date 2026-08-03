-- ============================================================
-- Vendor-side tax receipts get their own section rather than being
-- filed among the vendor's compliance documents — and the link column
-- added in 158 to support the other approach is dropped as dead.
--
-- ── Why the 158 approach is being reversed ──────────────────────────
-- 158 added vendor_receipts.vendor_attachment_id so a receipt could be
-- filed as a vendor_attachments row and show its review chip in the
-- vendor's document list. Two problems with that, both real:
--
--   1. It was never wired. The link column and the display existed;
--      nothing ever populated it. The first real receipt captured
--      (IMG_0152.png, expense MESK-MISC-20260725-01) landed with
--      vendor_attachment_id NULL and was therefore invisible on the
--      vendor page — the display had nothing to match on.
--   2. Per user decision, it's the wrong shape anyway.
--      vendor_attachments is a COMPLIANCE store — business licence,
--      trade registration, TIN certificate, VAT certificate,
--      insurance. Those are a handful of long-lived documents whose
--      whole value is being easy to find and check for expiry. Filing
--      every transactional receipt beside them buries that under
--      volume the moment real throughput starts.
--
-- So the vendor page reads vendor_receipts DIRECTLY for its own
-- section. The receipt already carries vendor_id, which means the
-- existing captured receipt appears immediately with no backfill, no
-- file copied between buckets, and no second row representing the same
-- document. That last point is the whole reason for the change: a
-- duplicate record that has to be kept in step is exactly the
-- redundancy this tax work exists to remove.
--
-- The document stays in the private 'tax-documents' bucket. It does not
-- need to move — v_vendor_tax_receipts reports the bucket alongside the
-- path so the UI can sign a URL against the right one, including for
-- GRN-linked receipts that have no vendor at all.
-- ============================================================

SET search_path TO public;

-- ── 1. Drop the unused link ─────────────────────────────────────────
-- Safe: nothing writes it, and the only reader is the vendor-page chip
-- being replaced in this same change. Confirmed NULL on every existing
-- row before dropping.
--
-- v_tax_receipt_movement (158) selects through this column, so it must
-- be dropped before the column and rebuilt after — a plain ALTER fails
-- with "other objects depend on it". Dropped explicitly rather than
-- with CASCADE, so the rebuild below is the only thing that can bring
-- it back and nothing else is silently taken down with it.
DROP VIEW IF EXISTS v_tax_receipt_movement;
DROP INDEX IF EXISTS idx_vendor_receipts_attachment;
ALTER TABLE vendor_receipts DROP COLUMN IF EXISTS vendor_attachment_id;

-- ── 2. What the vendor page shows ───────────────────────────────────
-- One row per receipt for a vendor, with the full chain and the bucket
-- its document lives in.
CREATE OR REPLACE VIEW v_vendor_tax_receipts
WITH (security_invoker = true) AS
SELECT
  vr.id,
  vr.vendor_id,
  vr.receipt_no,
  vr.receipt_date,
  vr.vat_amount,
  vr.withholding_amount,
  vr.vendor_tin_on_receipt,
  vr.status,
  vr.physical_received_at,
  vr.document_url                     AS document_path,
  'tax-documents'::text               AS document_bucket,
  vr.document_name,
  COALESCE(vr.project_id, e.project_id) AS project_id,
  p.project_name,
  e.expense_code,
  vr.expense_id,
  vr.grn_id,
  maker.full_name                     AS entered_by_name,
  checker.full_name                   AS verified_by_name,
  reviewer.full_name                  AS reviewed_by_name,
  vr.entered_at,
  vr.verified_at,
  vr.reviewed_at
FROM vendor_receipts vr
LEFT JOIN expenses e ON e.id = vr.expense_id
LEFT JOIN projects p ON p.id = COALESCE(vr.project_id, e.project_id)
LEFT JOIN user_profiles maker    ON maker.id    = vr.entered_by
LEFT JOIN user_profiles checker  ON checker.id  = vr.verified_by
LEFT JOIN user_profiles reviewer ON reviewer.id = vr.reviewed_by;

GRANT SELECT ON v_vendor_tax_receipts TO authenticated;

-- ── 3. v_tax_receipt_movement no longer joins the dropped column ────
CREATE OR REPLACE VIEW v_tax_receipt_movement
WITH (security_invoker = true) AS
SELECT
  'purchase'                             AS side,
  vr.id,
  vr.receipt_no,
  vr.receipt_date,
  vr.vat_amount,
  vr.status                              AS workflow_status,
  vr.physical_received_at,
  v.vendor_name                          AS counterparty,
  COALESCE(vr.project_id, e.project_id)  AS project_id,
  p.project_name,
  maker.full_name                        AS collected_by,
  checker.full_name                      AS verified_by,
  reviewer.full_name                     AS tax_reviewed_by,
  vr.document_url                        AS document_ref,
  'tax-documents'::text                  AS document_bucket
FROM vendor_receipts vr
LEFT JOIN vendors  v ON v.id = vr.vendor_id
LEFT JOIN expenses e ON e.id = vr.expense_id
LEFT JOIN projects p ON p.id = COALESCE(vr.project_id, e.project_id)
LEFT JOIN user_profiles maker    ON maker.id    = vr.entered_by
LEFT JOIN user_profiles checker  ON checker.id  = vr.verified_by
LEFT JOIN user_profiles reviewer ON reviewer.id = vr.reviewed_by
UNION ALL
SELECT
  'sale',
  ca.id,
  ca.receipt_no,
  ca.receipt_date,
  ca.vat_amount,
  ca.tax_status,
  ca.physical_received_at,
  c.client_name,
  COALESCE(ca.project_id, s.project_id),
  p.project_name,
  presenter.full_name,
  NULL,
  reviewer.full_name,
  ca.file_path,
  'client-documents'
FROM client_attachments ca
LEFT JOIN clients  c ON c.id = ca.client_id
LEFT JOIN sales    s ON s.id = ca.sale_id
LEFT JOIN projects p ON p.id = COALESCE(ca.project_id, s.project_id)
LEFT JOIN user_profiles presenter ON presenter.id = ca.uploaded_by
LEFT JOIN user_profiles reviewer  ON reviewer.id  = ca.tax_reviewed_by
WHERE ca.tax_status IS NOT NULL;

GRANT SELECT ON v_tax_receipt_movement TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT count(*) AS dropped_col_expect_0
FROM information_schema.columns
WHERE table_name = 'vendor_receipts' AND column_name = 'vendor_attachment_id';

-- The already-captured receipt must show up here with no backfill.
SELECT vendor_id, receipt_no, status, document_path, expense_code, entered_by_name
FROM v_vendor_tax_receipts;

SELECT count(*) AS movement_rows FROM v_tax_receipt_movement;
