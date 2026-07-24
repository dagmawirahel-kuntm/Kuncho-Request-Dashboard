-- ============================================================
-- Richer generated contract content — the generated Word/print
-- document (src/lib/generateContractDocument.ts) was a bare details
-- table (value, WHT, retention) plus a client-details block. Making it
-- read as an actual signable service contract needs two things the
-- schema doesn't carry yet: what the work actually is, and by when.
-- Everything else added to the document (Warranty, Termination,
-- Confidentiality, Force Majeure, Dispute Resolution, Governing Law)
-- is fixed standard boilerplate in the generator itself, not stored
-- data — consistent with the existing "straightforward template, not
-- a legal-template engine" scope for this feature (117/generateContractDocument
-- header comment).
--
-- Per user decision: contract generation stays a manual action on the
-- Contract form ("Generate Word Document") — no auto-trigger on an
-- opportunity reaching 'won'. This migration only adds the two fields
-- the richer template needs.
-- ============================================================

SET search_path TO public;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS scope_of_work TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS completion_date DATE;

-- Verify
SELECT column_name FROM information_schema.columns WHERE table_name = 'contracts' AND column_name IN ('scope_of_work', 'completion_date') ORDER BY column_name;
