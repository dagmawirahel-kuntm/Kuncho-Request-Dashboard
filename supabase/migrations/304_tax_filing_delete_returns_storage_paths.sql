-- Supersedes the two delete functions from migration 303.
--
-- 303's versions tried to remove the filing's objects with
--   DELETE FROM storage.objects WHERE bucket_id = 'tax-records' ...
-- which Supabase refuses:
--
--   ERROR: Direct deletion from storage tables is not allowed.
--          Use the Storage API.
--
-- Found by running the delete against a real filing with a document
-- attached, not by reading the code -- 303's functions work right up until
-- a filing actually has a document, then fail every time.
--
-- The transaction did at least fail cleanly: the snapshot, the cascade and
-- the row were all rolled back together, so nothing was half-deleted. That
-- property is kept here.
--
-- New shape: the RPC does the part only it can do -- verify admin, demand a
-- reason, write the audit snapshot, and delete the rows, atomically -- and
-- RETURNS the storage paths for the caller to remove through the Storage
-- API, which is the only route Supabase permits.
--
-- If that second step fails, the objects are orphaned rather than lost: they
-- are unreferenced, unreadable through the app (nothing lists them), and
-- their paths are preserved in the deletion snapshot, so they can be found
-- and swept later. The alternative ordering -- delete the files first, then
-- the rows -- loses the files if the RPC then fails, which is worse: the
-- filing would still be listed with a document that no longer exists.
--
-- Storage removal is still admin-only: tax_records_delete (303) restricts
-- DELETE on the bucket to admins, so the Storage API call is authorised by
-- the same rule as the RPC.

SET search_path TO public;

DROP FUNCTION IF EXISTS delete_tax_filing(UUID, TEXT);

CREATE OR REPLACE FUNCTION delete_tax_filing(p_filing_id UUID, p_reason TEXT)
RETURNS TEXT[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT to_jsonb(v_filing) || jsonb_build_object(
           'documents',
           COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM tax_filing_documents d
                      WHERE d.tax_filing_id = p_filing_id), '[]'::jsonb))
    INTO v_snapshot;

  SELECT COALESCE(array_agg(storage_path), ARRAY[]::text[]) INTO v_paths
  FROM tax_filing_documents WHERE tax_filing_id = p_filing_id;

  -- Snapshot lands before the row goes, in the same transaction, so a
  -- failure anywhere below takes the audit row with it rather than leaving
  -- a trail for a deletion that did not happen.
  INSERT INTO tax_filing_deletions
    (deleted_filing_snapshot, schedule_code, period_label, reason, deleted_by)
  VALUES (v_snapshot, v_filing.schedule_code, v_filing.period_label, btrim(p_reason), auth.uid());

  DELETE FROM tax_filings WHERE id = p_filing_id;  -- documents cascade

  RETURN v_paths;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_tax_filing(UUID, TEXT) FROM PUBLIC, anon;

COMMENT ON FUNCTION delete_tax_filing(UUID, TEXT) IS
  'Admin-only hard delete of a tax filing. Writes a tax_filing_deletions snapshot, removes the filing and cascades its documents, and returns the storage paths the caller must then remove via the Storage API (Postgres cannot delete storage.objects).';

DROP FUNCTION IF EXISTS delete_tax_filing_document(UUID, TEXT);

CREATE OR REPLACE FUNCTION delete_tax_filing_document(p_document_id UUID, p_reason TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT jsonb_build_object('document', to_jsonb(v_doc), 'filing', to_jsonb(v_filing))
    INTO v_snapshot;

  INSERT INTO tax_filing_deletions
    (deleted_filing_snapshot, schedule_code, period_label, reason, deleted_by)
  VALUES (v_snapshot, v_filing.schedule_code, v_filing.period_label,
          btrim(p_reason), auth.uid());

  DELETE FROM tax_filing_documents WHERE id = p_document_id;

  RETURN v_doc.storage_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_tax_filing_document(UUID, TEXT) FROM PUBLIC, anon;

COMMENT ON FUNCTION delete_tax_filing_document(UUID, TEXT) IS
  'Admin-only delete of one tax filing document. Snapshots it, removes the row, and returns its storage path for the caller to remove via the Storage API.';
