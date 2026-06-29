-- Replace vendor_documents (URL-based) with vendor_attachments (Storage-path-based),
-- matching the same pattern as client_attachments.

-- 1. New table
CREATE TABLE IF NOT EXISTS vendor_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INT,
  mime_type   TEXT,
  category    TEXT NOT NULL DEFAULT 'other',
  notes       TEXT,
  expiry_date DATE,
  uploaded_by UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_attachments_vendor_id ON vendor_attachments(vendor_id);

-- 2. RLS
ALTER TABLE vendor_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_attachments_select" ON vendor_attachments;
CREATE POLICY "vendor_attachments_select"
  ON vendor_attachments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "vendor_attachments_insert" ON vendor_attachments;
CREATE POLICY "vendor_attachments_insert"
  ON vendor_attachments FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "vendor_attachments_delete" ON vendor_attachments;
CREATE POLICY "vendor_attachments_delete"
  ON vendor_attachments FOR DELETE TO authenticated USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'finance', 'manager')
    )
  );

-- 3. Private Storage bucket (signed URLs for downloads)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vendor-documents', 'vendor-documents', false,
  52428800,
  ARRAY['image/*', 'application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "vendor_docs_upload"  ON storage.objects;
DROP POLICY IF EXISTS "vendor_docs_select"  ON storage.objects;
DROP POLICY IF EXISTS "vendor_docs_delete"  ON storage.objects;

CREATE POLICY "vendor_docs_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-documents');

CREATE POLICY "vendor_docs_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vendor-documents');

CREATE POLICY "vendor_docs_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vendor-documents');

-- 4. Drop the old URL-based table (no real data yet — migrations 035-038 were just generated)
DROP TABLE IF EXISTS vendor_documents;
