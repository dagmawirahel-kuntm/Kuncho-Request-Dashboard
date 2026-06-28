-- Vendor Documents: licences, trade registration, certificates, contracts
CREATE TABLE IF NOT EXISTS vendor_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL DEFAULT 'Other',
  document_name TEXT NOT NULL,
  file_url      TEXT,
  expiry_date   DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_documents_vendor_id ON vendor_documents(vendor_id);

-- Receipt attachment fields on expenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS receipt_url  TEXT,
  ADD COLUMN IF NOT EXISTS receipt_name TEXT;

-- Supabase Storage bucket for document uploads (public, anon-readable)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', true, 52428800, ARRAY['image/*','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload
CREATE POLICY IF NOT EXISTS "auth_upload_documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY IF NOT EXISTS "public_read_documents"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'documents');

CREATE POLICY IF NOT EXISTS "auth_delete_documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents');
