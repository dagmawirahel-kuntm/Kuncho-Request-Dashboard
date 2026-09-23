-- Retires tax_engagements as a place to record filings. tax_filings
-- (migrations 301-306) is now the one record of what was filed, for which
-- Ethiopian period, with what documents.
--
-- ── The overlap ─────────────────────────────────────────────────────────
-- Three things answered "have we filed, and are we late?", in two calendars:
--
--   tax_filings               Ethiopian periods (Hamle 2018), per schedule,
--                             status + amounts + documents + audited delete
--   v_tax_outstanding_status  every GREGORIAN month since cutover per
--                             obligation type, 'overdue' unless a
--                             tax_engagements row sits on the 1st of that month
--   v_next_tax_obligations    the next GREGORIAN month after the last
--                             engagement, with a due day finance never set
--
-- The last two drove the Tax Summary grid and the Tax Management banners,
-- so the same payroll return could read "overdue" on one page and "draft,
-- due 10 Meskerem" on another. They also could not see the one real row:
-- it was logged against 2026-07-25, not a 1st, so the outstanding view's
-- equality join never matched it.
--
-- ── What happens here ───────────────────────────────────────────────────
-- 1. Both Gregorian status views are dropped. They hold no data; their
--    definitions stay in migrations 153 and 170.
-- 2. tax_engagements becomes a read-only archive: the write policy and the
--    INSERT/UPDATE/DELETE grants go, so nothing new lands in it. The table
--    and v_tax_engagements stay, so the history is still readable.
-- 3. Its read policy was any signed-in user -- the same exposure as the
--    tax-documents bucket (307). It is narrowed to the tax_filings read set.
--
-- ── What deliberately does NOT happen ───────────────────────────────────
-- The single existing row (payroll_tax, period 2026-07-25, filed
-- 2026-07-25, no reference, no document) is NOT copied into tax_filings.
-- It cannot be placed on an Ethiopian period without guessing. Read as
-- Hamle 2018 (the period its date falls in), it was filed 12 days before
-- that period ended, which a monthly return cannot be. Read as the Sene
-- 2018 return (ended 2026-07-07), the filed date is plausible -- but that
-- is a reading, not what was entered. Marking either live Schedule A
-- period as filed on that basis would put a claim in the tax record that
-- nobody made. It stays in the archive; if the filing was real, the tax
-- officer records it against the right period in Tax Filings.

SET search_path TO public;

DROP VIEW IF EXISTS v_tax_outstanding_status;
DROP VIEW IF EXISTS v_next_tax_obligations;

DROP POLICY IF EXISTS tax_engagements_write ON tax_engagements;
REVOKE INSERT, UPDATE, DELETE ON tax_engagements FROM authenticated, anon;

DROP POLICY IF EXISTS tax_engagements_read ON tax_engagements;
CREATE POLICY tax_engagements_read ON tax_engagements FOR SELECT TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false));

COMMENT ON TABLE tax_engagements IS
  'ARCHIVE, read-only since migration 308. Superseded by tax_filings, which records filings by Ethiopian period. Kept so earlier log entries remain readable.';

-- 153 described this flag as "UI-only, not an access gate". Since 301 it is
-- one: is_tax_officer() reads it in the RLS of tax_schedules,
-- tax_rate_references, tax_filings, tax_filing_documents, the tax-records
-- bucket, and now tax-documents and tax_engagements.
COMMENT ON COLUMN user_profiles.is_tax_officer IS
  'Access designation, read by is_tax_officer() in RLS on the tax filing tables and the tax-records / tax-documents buckets (migrations 301-308). Grants read on tax data and write on tax filings. Set by admins only.';
