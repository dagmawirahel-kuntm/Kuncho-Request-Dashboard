-- 369: The heritage document design.
--
-- tagline: a line under the company name on every document (what Kuncho
--   does, e.g. "Interiors · Events · Leather craft").
-- bilingual_labels: column headings, totals and titles in Amharic under the
--   English. On by default; turn it off for clients abroad.

ALTER TABLE public.company_profile ADD COLUMN IF NOT EXISTS tagline text;
ALTER TABLE public.company_profile ADD COLUMN IF NOT EXISTS bilingual_labels boolean NOT NULL DEFAULT true;
