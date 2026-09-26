-- 352 — Personal dashboards
--
-- Everyone lands on one "My Dashboard" built from widgets. Until a person
-- changes it, the app shows a default for their role, department and
-- assignments (project manager, site foreman…), so nothing is stored. The
-- first time they add, remove, reorder or resize a widget, their layout is
-- saved here. Admin can set or reset anyone's layout.
--
-- widgets: an ordered array of { "key": <widget key>, "size": "half" | "full" }.
-- An unknown key (a widget retired later) is ignored by the app.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  user_id    uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  widgets    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(widgets) = 'array'),
  updated_by uuid DEFAULT auth.uid() REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dashboard_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_layouts_own ON dashboard_layouts;
CREATE POLICY dashboard_layouts_own ON dashboard_layouts FOR ALL
  USING (user_id = auth.uid() OR get_user_role() = 'admin'::user_role)
  WITH CHECK (user_id = auth.uid() OR get_user_role() = 'admin'::user_role);

REVOKE ALL ON dashboard_layouts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_layouts TO authenticated;

CREATE OR REPLACE FUNCTION touch_dashboard_layout() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_touch_dashboard_layout ON dashboard_layouts;
CREATE TRIGGER trg_touch_dashboard_layout BEFORE INSERT OR UPDATE ON dashboard_layouts
  FOR EACH ROW EXECUTE FUNCTION touch_dashboard_layout();
