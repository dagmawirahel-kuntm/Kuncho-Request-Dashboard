-- ── Client attachments table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  file_path    TEXT NOT NULL,        -- path inside the 'client-documents' storage bucket
  file_size    BIGINT,               -- bytes
  mime_type    TEXT,
  category     TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('receipt', 'contract', 'other')),
  notes        TEXT,
  uploaded_by  UUID REFERENCES user_profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast per-client lookups
CREATE INDEX IF NOT EXISTS idx_client_attachments_client_id ON client_attachments(client_id);

-- RLS
ALTER TABLE client_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance and admin can manage client attachments" ON client_attachments;
CREATE POLICY "Finance and admin can manage client attachments"
  ON client_attachments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager', 'finance')
    )
  );

-- ── Supabase Storage bucket (run this once in the Supabase dashboard or via CLI) ─
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('client-documents', 'client-documents', false)
-- ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for the bucket (apply in Supabase dashboard → Storage → Policies)
-- Allow authenticated users with finance/admin role to upload/download
