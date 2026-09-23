-- Ethiopian Tax Filing module, group C: the private storage bucket, its
-- policies, and the admin-only hard delete with its audit snapshot.
--
-- ── Why a new bucket rather than the existing tax-documents ─────────────
-- tax-documents is private at the bucket level, but its policies are not:
--
--   tax_docs_select  USING (bucket_id = 'tax-documents')   -- any authenticated
--   tax_docs_delete  USING (bucket_id = 'tax-documents')   -- any authenticated
--
-- Storage policies are permissive and OR together, so a stricter policy
-- added alongside those would grant nothing extra and block nothing: the
-- existing ones would still let any signed-in user read or delete a filing
-- PDF, straight past the table RLS below. Scoping inside that bucket would
-- mean rewriting policies shared with tax receipts, vendor receipts and
-- PrivateDocLink's default -- breaking uploads for whichever roles use them.
--
-- So: a dedicated bucket, restrictive from the start, touching nothing
-- existing. The tax-documents gap is real and pre-existing, and is flagged
-- separately rather than fixed here.

SET search_path TO public;

INSERT INTO storage.buckets (id, name, public)
VALUES ('tax-records', 'tax-records', false)
ON CONFLICT (id) DO NOTHING;

-- Read: the same group that may read the filings themselves.
CREATE POLICY tax_records_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'tax-records'
    AND (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false))
  );

-- Upload: tax officer or admin only.
CREATE POLICY tax_records_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tax-records'
    AND (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false))
  );

-- Update (overwrite): same as upload.
CREATE POLICY tax_records_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tax-records'
    AND (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false))
  )
  WITH CHECK (
    bucket_id = 'tax-records'
    AND (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false))
  );

-- Delete: admin only, mirroring the table rule. A tax officer cannot remove
-- a government record from storage any more than they can from the table.
CREATE POLICY tax_records_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'tax-records'
    AND COALESCE(get_user_role() = 'admin', false)
  );

-- ── delete_tax_filing ───────────────────────────────────────────────────
-- The one place in this platform where an admin may remove a recorded row:
-- a filing mis-keyed against a government period has to be correctable. The
-- price is that it is never quiet -- a reason is required, and a full
-- snapshot lands in tax_filing_deletions BEFORE the row goes, in the same
-- transaction, so the trail cannot be lost if the delete half-succeeds.
--
-- SECURITY DEFINER because tax_filings has no DELETE policy at all (by
-- design), tax_filing_deletions has no INSERT policy, and storage.objects
-- rows must go too. The admin check is inside the function, so the UI is
-- not the thing enforcing it.
CREATE OR REPLACE FUNCTION delete_tax_filing(p_filing_id UUID, p_reason TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_filing   tax_filings%ROWTYPE;
  v_snapshot JSONB;
  v_paths    TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT COALESCE(get_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Only an admin can delete a recorded tax filing';
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to delete a tax filing';
  END IF;

  SELECT * INTO v_filing FROM tax_filings WHERE id = p_filing_id;
  IF v_filing.id IS NULL THEN
    RAISE EXCEPTION 'Tax filing % not found', p_filing_id;
  END IF;

  -- Snapshot the filing together with every document's metadata, so the
  -- audit row is readable on its own without joining to rows that no
  -- longer exist.
  SELECT to_jsonb(v_filing) || jsonb_build_object(
           'documents',
           COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM tax_filing_documents d
                      WHERE d.tax_filing_id = p_filing_id), '[]'::jsonb))
    INTO v_snapshot;

  SELECT array_agg(storage_path) INTO v_paths
  FROM tax_filing_documents WHERE tax_filing_id = p_filing_id;

  INSERT INTO tax_filing_deletions
    (deleted_filing_snapshot, schedule_code, period_label, reason, deleted_by)
  VALUES (v_snapshot, v_filing.schedule_code, v_filing.period_label, btrim(p_reason), auth.uid());

  -- Storage first, then the row: tax_filing_documents cascades from
  -- tax_filings, and once those rows are gone the paths are unrecoverable.
  IF v_paths IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'tax-records' AND name = ANY(v_paths);
  END IF;

  DELETE FROM tax_filings WHERE id = p_filing_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_tax_filing(UUID, TEXT) FROM PUBLIC, anon;

-- ── delete_tax_filing_document ──────────────────────────────────────────
-- Removing a single document, rather than the whole filing. Same rules:
-- admin only, reason required, snapshotted.
CREATE OR REPLACE FUNCTION delete_tax_filing_document(p_document_id UUID, p_reason TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc      tax_filing_documents%ROWTYPE;
  v_filing   tax_filings%ROWTYPE;
  v_snapshot JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT COALESCE(get_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Only an admin can delete a tax filing document';
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to delete a tax filing document';
  END IF;

  SELECT * INTO v_doc FROM tax_filing_documents WHERE id = p_document_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Tax filing document % not found', p_document_id;
  END IF;

  SELECT * INTO v_filing FROM tax_filings WHERE id = v_doc.tax_filing_id;

  -- Records which filing it belonged to, so the trail says what was removed
  -- from where even though the filing itself survives.
  SELECT jsonb_build_object('document', to_jsonb(v_doc), 'filing', to_jsonb(v_filing))
    INTO v_snapshot;

  INSERT INTO tax_filing_deletions
    (deleted_filing_snapshot, schedule_code, period_label, reason, deleted_by)
  VALUES (v_snapshot, v_filing.schedule_code, v_filing.period_label,
          btrim(p_reason), auth.uid());

  DELETE FROM storage.objects
  WHERE bucket_id = 'tax-records' AND name = v_doc.storage_path;

  DELETE FROM tax_filing_documents WHERE id = p_document_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_tax_filing_document(UUID, TEXT) FROM PUBLIC, anon;
