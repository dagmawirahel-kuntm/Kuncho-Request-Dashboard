-- Pins search_path on the seven calendar/due-date functions from migrations
-- 301 and 302 that were created without it.
--
-- Raised by Supabase's own security advisor (function_search_path_mutable)
-- after 301-304 went in. is_tax_officer() and generate_tax_filing_periods()
-- already carry `SET search_path = public`; these seven were missed.
--
-- WHY IT MATTERS EVEN THOUGH NONE OF THEM IS SECURITY DEFINER:
--   * tax_filing_due_date() is called from inside generate_tax_filing_periods(),
--     and ec_month_start_greg()/ec_month_end_greg() from there too, so they
--     execute in that function's context rather than on their own.
--   * ec_month_name() is evaluated by the tax_filings.period_label generated
--     column on every insert and update.
-- In both cases the caller's search_path is whatever the session set, which
-- is exactly the setting a schema-shadowing attack needs. Pinning it costs
-- nothing and removes the question.
--
-- ALTER rather than CREATE OR REPLACE on purpose: the bodies are unchanged
-- and verified, and replacing ec_month_name() would touch a function the
-- generated column depends on for no reason.

SET search_path TO public;

ALTER FUNCTION public.ec_is_leap(int)                           SET search_path = public;
ALTER FUNCTION public.ec_month_name(int)                        SET search_path = public;
ALTER FUNCTION public.ec_to_gregorian(int, int, int)            SET search_path = public;
ALTER FUNCTION public.gregorian_to_ec(date)                     SET search_path = public;
ALTER FUNCTION public.ec_month_start_greg(int, int)             SET search_path = public;
ALTER FUNCTION public.ec_month_end_greg(int, int)               SET search_path = public;
ALTER FUNCTION public.tax_filing_due_date(jsonb, int, int, date) SET search_path = public;
