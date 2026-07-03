-- Migration 051: Account lifecycle — pending approval / active / disabled
--
-- Two features on one mechanism:
--  1. Self-signups start as 'pending': they can authenticate but see only
--     a "waiting for approval" screen until an admin approves them.
--  2. Admins can deactivate ('disabled') a leaver: login shows a blocked
--     screen and — crucially — the database refuses them everything.
--
-- Enforcement is at the DB core: get_user_role() now returns NULL unless
-- the account is 'active'. Every RLS policy in the system gates on
-- get_user_role(), so pending/disabled users lose all table access in
-- one stroke, even calling the API directly. The only thing they can
-- still read is their own user_profiles row (needed so the app can show
-- them their status), which contains nothing sensitive.

SET search_path TO public;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';

DO $$ BEGIN
  ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_account_status_check
    CHECK (account_status IN ('pending', 'active', 'disabled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Existing accounts stay active (column default). New self-signups start
-- pending — the admin "Add User" flow flips them to active immediately.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, role, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'staff',     -- never trust caller-supplied role metadata
    'pending'    -- self-signups await admin approval
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The core lock: non-active accounts have no role, therefore no access.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.user_profiles
  WHERE id = auth.uid() AND account_status = 'active';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Every authenticated user may read their own profile row regardless of
-- status (the app needs it to show the pending/disabled screen).
DROP POLICY IF EXISTS "own_profile_select" ON user_profiles;
CREATE POLICY "own_profile_select" ON user_profiles
  FOR SELECT USING (id = auth.uid());
