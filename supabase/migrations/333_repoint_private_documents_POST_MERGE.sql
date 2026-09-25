-- 333 — Point staff IDs and contracts at their private copies
--   POST-MERGE: run once the frontend from the same PR is live. The app
--   before it opens these files straight from their public URLs, so a
--   storage path would be a broken link there.
--
-- 332 moved the files: each staff ID scan was copied to staff-documents
-- (same path) and each contract file to client-documents under its client,
-- and every copy was checked against its original's size. This repoints
-- the rows from the public URL to the private path — only where the private
-- copy is there. The public originals are removed after this, through the
-- Storage API.

SET search_path TO public;

UPDATE staff s
SET id_document_url = substring(s.id_document_url FROM '/object/public/documents/(.*)$')
WHERE s.id_document_url LIKE '%/object/public/documents/staff-ids/%'
  AND EXISTS (SELECT 1 FROM storage.objects o
              WHERE o.bucket_id = 'staff-documents'
                AND o.name = substring(s.id_document_url FROM '/object/public/documents/(.*)$'));

UPDATE contracts c
SET document_url = c.client_id::text || '/contracts/' || substring(c.document_url FROM '/object/public/documents/contracts/(.*)$')
WHERE c.document_url LIKE '%/object/public/documents/contracts/%'
  AND c.client_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM storage.objects o
              WHERE o.bucket_id = 'client-documents'
                AND o.name = c.client_id::text || '/contracts/' || substring(c.document_url FROM '/object/public/documents/contracts/(.*)$'));
