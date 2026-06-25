SET search_path TO public;

-- ── Auto-create user_profiles on signup ──────────────────────────
-- Prevents the "user registered but missing from user_profiles" problem.
-- New signups get role 'staff' by default; an admin can promote them.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'staff'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Add updated_at to categories ─────────────────────────────────
-- The set_updated_at trigger fires on UPDATE but the column was missing,
-- causing "record NEW has no field updated_at" on every edit.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE categories SET updated_at = created_at WHERE updated_at IS NULL;

-- Generic set_updated_at function (idempotent — used by multiple tables)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_categories_updated_at ON categories;
CREATE TRIGGER set_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
