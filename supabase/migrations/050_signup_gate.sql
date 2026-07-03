-- Migration 050: Self-signup, gated to company-registered emails
--
-- Employees create their own account and choose their own password on a
-- public /signup page. The gate is enforced at the database: an INSERT
-- trigger on auth.users rejects any email that is not present in the
-- staff table (HR's directory) or the signup_allowlist (admin-managed
-- extras, e.g. accounts for people without a staff record). Existing
-- accounts are unaffected — the trigger fires only on new signups.

SET search_path TO public;

-- Admin-managed allowlist for emails that should be able to sign up
-- but don't (yet) exist in the staff directory.
CREATE TABLE IF NOT EXISTS signup_allowlist (
  email      TEXT PRIMARY KEY,
  note       TEXT,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE signup_allowlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allowlist_admin" ON signup_allowlist;
CREATE POLICY "allowlist_admin" ON signup_allowlist
  FOR ALL USING (get_user_role() = 'admin');

-- The gate: new auth users must match staff.email or the allowlist
CREATE OR REPLACE FUNCTION public.enforce_signup_allowlist()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff
                 WHERE email IS NOT NULL AND lower(email) = lower(NEW.email))
     AND NOT EXISTS (SELECT 1 FROM public.signup_allowlist
                 WHERE lower(email) = lower(NEW.email)) THEN
    RAISE EXCEPTION 'Signup not allowed: % is not registered in the company directory', NEW.email;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_signup_allowlist ON auth.users;
CREATE TRIGGER trg_enforce_signup_allowlist
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signup_allowlist();

-- Friendly pre-check for the signup page (the trigger's error text gets
-- swallowed by the auth API, so the UI asks this function first).
CREATE OR REPLACE FUNCTION public.email_allowed_for_signup(p_email TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff
                 WHERE email IS NOT NULL AND lower(email) = lower(p_email))
      OR EXISTS (SELECT 1 FROM public.signup_allowlist
                 WHERE lower(email) = lower(p_email));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.email_allowed_for_signup(TEXT) TO anon, authenticated;
