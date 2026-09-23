-- Scopes the tax-documents storage bucket to the people who can see the
-- rows that point into it.
--
-- ── What was wrong ──────────────────────────────────────────────────────
-- The bucket is private, but its three policies only checked the bucket:
--
--   tax_docs_select  USING      (bucket_id = 'tax-documents')
--   tax_docs_upload  WITH CHECK (bucket_id = 'tax-documents')
--   tax_docs_delete  USING      (bucket_id = 'tax-documents')
--
-- so every signed-in user -- 8 project managers, the HR officer, a staff
-- account -- could read any vendor tax receipt (TINs, commercial amounts),
-- upload into the bucket, and delete the receipt evidence an ERCA audit
-- asks for. Confirmed live before this migration: a project_manager INSERT
-- into tax-documents/vendor-receipts/ succeeded.
--
-- ── What is in the bucket ───────────────────────────────────────────────
-- Two writers ever used it, each with its own folder:
--   vendor-receipts/  TaxReceiptFormPage -> vendor_receipts.document_url
--   declarations/     TaxEngagementFormPage -> tax_engagements.document_url
--                     (retired by migration 308; new filing documents go to
--                     tax-records under migration 303's policies)
-- Every reader reaches a file through one of those rows, so the file
-- policies below are the row policies, restated for storage.
--
-- ── The rules ───────────────────────────────────────────────────────────
-- READ   vendor-receipts/: exactly vendor_receipts_read's roles (admin,
--        executive, finance, procurement_officer, stock_manager,
--        logistics_officer) plus the tax officer, who reviews them.
--        Anything else in the bucket: tax officer, admin, finance,
--        executive -- the tax_filings read set.
-- UPLOAD vendor-receipts/ only, by vendor_receipts_insert's roles (admin,
--        finance, procurement_officer). An upload anyone else could make
--        would be a file with no row allowed to point at it.
-- DELETE admin only. No app code deletes from this bucket -- FileUpload's
--        clear button only clears the form field -- so this takes nothing
--        away from any workflow; it stops receipt evidence being removed.
--
-- No UPDATE policy, as before. FileUpload uploads with upsert:true, but
-- every path is timestamped so the overwrite branch never runs; leaving
-- UPDATE absent keeps upload behaviour exactly as it was.

SET search_path TO public;

DROP POLICY IF EXISTS tax_docs_select ON storage.objects;
DROP POLICY IF EXISTS tax_docs_upload ON storage.objects;
DROP POLICY IF EXISTS tax_docs_delete ON storage.objects;

CREATE POLICY tax_docs_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'tax-documents'
    AND (
      is_tax_officer()
      OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false)
      OR (name LIKE 'vendor-receipts/%'
          AND COALESCE(get_user_role() IN ('procurement_officer', 'stock_manager', 'logistics_officer'), false))
    )
  );

CREATE POLICY tax_docs_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tax-documents'
    AND name LIKE 'vendor-receipts/%'
    AND COALESCE(get_user_role() IN ('admin', 'finance', 'procurement_officer'), false)
  );

CREATE POLICY tax_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'tax-documents'
    AND COALESCE(get_user_role() = 'admin', false)
  );
