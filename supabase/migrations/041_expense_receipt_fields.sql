-- ============================================================
-- Re-apply the parts of 035 that never actually committed.
-- (Supabase SQL Editor runs a pasted script as one implicit
-- transaction, so the unrelated CREATE POLICY IF NOT EXISTS syntax
-- error in the original 035 paste rolled back everything in that
-- run, including this ALTER TABLE and the bucket/policy setup.)
--
-- Deliberately does NOT touch vendor_documents — that table was
-- already correctly dropped by 039_vendor_attachments.sql.
-- ============================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS receipt_url  TEXT,
  ADD COLUMN IF NOT EXISTS receipt_name TEXT;

-- Supabase Storage bucket for document uploads (public, anon-readable)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', true, 52428800, ARRAY['image/*','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "auth_upload_documents" ON storage.objects;
CREATE POLICY "auth_upload_documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "public_read_documents" ON storage.objects;
CREATE POLICY "public_read_documents"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "auth_delete_documents" ON storage.objects;
CREATE POLICY "auth_delete_documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents');

-- Verify — should show both columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'expenses' AND column_name IN ('receipt_url', 'receipt_name');
