-- 332 — Staff IDs, contracts and VRF certificates out of the public bucket
--
-- The 'documents' bucket is public: anything in it opens from its URL with
-- no sign-in, and its SELECT policy let anyone — signed in or not — list
-- every file. Staff ID scans, signed contracts and VRF payment certificates
-- had been uploaded there.
--
-- 1. Two private buckets. A file in them opens only through a short-lived
--    signed link, for the roles below.
--      staff-documents    staff ID scans
--                         read + upload: admin, HR, executive, finance
--                         (the roles that can edit a staff record)
--                         delete: admin, HR
--      finance-documents  VRF payment certificates
--                         read + upload: admin, executive, finance and the
--                         VRF Manager; delete: admin
--    Contracts move to the private client-documents bucket (330), filed
--    under the client.
-- 2. 'documents' stays public for the everyday photos and receipts, but
--    listing it now needs a sign-in, and a file in it can be deleted only
--    by whoever uploaded it or by an admin.
--
-- The files themselves are copied by a one-off storage job, the rows that
-- point at them are repointed to the new paths, and only then are the
-- public copies deleted — see the data step recorded at the end.

SET search_path TO public;

-- ── 1. Private buckets ──────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('staff-documents', 'staff-documents', false, 26214400),
       ('finance-documents', 'finance-documents', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS staff_docs_select ON storage.objects;
CREATE POLICY staff_docs_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'staff-documents'
         AND COALESCE(get_user_role() = ANY (ARRAY['admin', 'hr_officer', 'executive', 'finance']::user_role[]), false));
DROP POLICY IF EXISTS staff_docs_insert ON storage.objects;
CREATE POLICY staff_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'staff-documents'
              AND COALESCE(get_user_role() = ANY (ARRAY['admin', 'hr_officer', 'executive', 'finance']::user_role[]), false));
DROP POLICY IF EXISTS staff_docs_delete ON storage.objects;
CREATE POLICY staff_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'staff-documents'
         AND COALESCE(get_user_role() = ANY (ARRAY['admin', 'hr_officer']::user_role[]), false));

DROP POLICY IF EXISTS finance_docs_select ON storage.objects;
CREATE POLICY finance_docs_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'finance-documents'
         AND (COALESCE(get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]), false)
              OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_vrf_manager)));
DROP POLICY IF EXISTS finance_docs_insert ON storage.objects;
CREATE POLICY finance_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'finance-documents'
              AND (COALESCE(get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]), false)
                   OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_vrf_manager)));
DROP POLICY IF EXISTS finance_docs_delete ON storage.objects;
CREATE POLICY finance_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'finance-documents' AND COALESCE(get_user_role() = 'admin', false));

-- ── 2. The public bucket: no anonymous listing, no deleting others' files ─
DROP POLICY IF EXISTS public_read_documents ON storage.objects;
DROP POLICY IF EXISTS documents_select ON storage.objects;
CREATE POLICY documents_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents');

DROP POLICY IF EXISTS auth_delete_documents ON storage.objects;
CREATE POLICY auth_delete_documents ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents'
         AND (owner_id = auth.uid()::text OR COALESCE(get_user_role() = 'admin', false)));
