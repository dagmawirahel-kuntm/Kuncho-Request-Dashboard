-- ============================================================
-- user_profiles.email (spec §3, first half).
--
-- Filtering the pending-account role dropdown to a department's
-- valid roles needs to match the signup to a staff record first —
-- the existing "staff_view_own" pattern (044) does that match by
-- email, but user_profiles has never stored the user's email at all
-- (only auth.users does, which the client can't read for anyone but
-- itself). Adds a plain email column, backfilled from auth.users
-- once, and kept current going forward by extending
-- handle_new_user() (051's version is authoritative) to populate it
-- at signup — same trigger, one more field, no new trigger needed.
-- ============================================================

SET search_path TO public;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE user_profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, role, account_status, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'staff',     -- never trust caller-supplied role metadata
    'pending',   -- self-signups await admin approval
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Verify
SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'email';
