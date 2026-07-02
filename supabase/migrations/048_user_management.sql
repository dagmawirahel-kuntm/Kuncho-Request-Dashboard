-- Migration 048: In-app user management support
--
-- The app gains an admin-only Users & Roles page that creates accounts
-- via the public signup API (the Supabase dashboard is unusable on
-- tablets). Because signup metadata is caller-controlled, the profile
-- trigger must stop reading the role from it — otherwise anyone could
-- self-register as admin. New users always start as 'staff'; an admin
-- assigns the real role from the Users page afterwards.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'staff'  -- never trust caller-supplied role metadata
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
