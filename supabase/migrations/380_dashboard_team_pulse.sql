-- 380 — Team pulse: thanks between colleagues, and work anniversaries
--
-- The dashboard's "Team pulse" widget shows company announcements (already
-- readable in company_events), thanks people send each other, and who is
-- reaching a work anniversary this week.
--
-- kudos: one person thanks one colleague, in up to 280 characters. Thanks
-- are meant to be seen, so recent_kudos() shows them to everyone signed in;
-- the table itself only lets you read, write and take back your own.
--
-- staff isn't readable by every role, so the widget reads names through
-- three SECURITY DEFINER functions that return names and departments only:
--   recent_kudos(p_limit)      — the latest thanks, company-wide
--   kudos_recipients()         — active colleagues you can thank
--   team_milestones(p_days)    — work anniversaries from 2 days ago to p_days ahead

SET search_path TO public;

CREATE TABLE IF NOT EXISTS kudos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user   uuid NOT NULL DEFAULT auth.uid() REFERENCES user_profiles(id) ON DELETE CASCADE,
  to_staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  message     text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 280),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kudos_created ON kudos (created_at DESC);

ALTER TABLE kudos ENABLE ROW LEVEL SECURITY;

-- You send as yourself, and not to yourself.
DROP POLICY IF EXISTS kudos_insert_own ON kudos;
CREATE POLICY kudos_insert_own ON kudos FOR INSERT
  WITH CHECK (
    from_user = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = to_staff_id AND s.user_id = auth.uid())
  );
DROP POLICY IF EXISTS kudos_read_own ON kudos;
CREATE POLICY kudos_read_own ON kudos FOR SELECT
  USING (from_user = auth.uid() OR get_user_role() = 'admin'::user_role);
DROP POLICY IF EXISTS kudos_delete_own ON kudos;
CREATE POLICY kudos_delete_own ON kudos FOR DELETE
  USING (from_user = auth.uid() OR get_user_role() = 'admin'::user_role);

REVOKE ALL ON kudos FROM anon;
GRANT SELECT, INSERT, DELETE ON kudos TO authenticated;

-- A thank-you is personal; twenty a day is plenty and stops a runaway loop.
CREATE OR REPLACE FUNCTION kudos_daily_limit() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM kudos
       WHERE from_user = NEW.from_user
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Addis_Ababa') AT TIME ZONE 'Africa/Addis_Ababa') >= 20 THEN
    RAISE EXCEPTION 'You have sent 20 thanks today — try again tomorrow.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_kudos_daily_limit ON kudos;
CREATE TRIGGER trg_kudos_daily_limit BEFORE INSERT ON kudos
  FOR EACH ROW EXECUTE FUNCTION kudos_daily_limit();

CREATE OR REPLACE FUNCTION public.recent_kudos(p_limit int DEFAULT 20)
RETURNS TABLE (id uuid, from_name text, to_name text, to_department text, message text, created_at timestamptz, mine boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT k.id,
         COALESCE(fs.employee_name, up.full_name)::text,
         ts.employee_name::text,
         d.name::text,
         k.message,
         k.created_at,
         k.from_user = auth.uid()
    FROM kudos k
    JOIN staff ts ON ts.id = k.to_staff_id
    LEFT JOIN departments d ON d.id = ts.department_id
    LEFT JOIN user_profiles up ON up.id = k.from_user
    LEFT JOIN LATERAL (SELECT s.employee_name FROM staff s WHERE s.user_id = k.from_user LIMIT 1) fs ON true
   WHERE auth.uid() IS NOT NULL
   ORDER BY k.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$function$;

CREATE OR REPLACE FUNCTION public.kudos_recipients()
RETURNS TABLE (id uuid, employee_name text, department text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT s.id, s.employee_name::text, d.name::text
    FROM staff s
    LEFT JOIN departments d ON d.id = s.department_id
   WHERE auth.uid() IS NOT NULL
     AND s.status <> 'terminated'
     AND (s.user_id IS DISTINCT FROM auth.uid())
   ORDER BY s.employee_name
$function$;

CREATE OR REPLACE FUNCTION public.team_milestones(p_days int DEFAULT 7)
RETURNS TABLE (staff_id uuid, employee_name text, department text, years int, anniversary date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date AS d),
  candidates AS (
    SELECT s.id, s.employee_name, s.department_id, s.starting_date,
           -- this year's and next year's anniversary (a 29 Feb start lands on 28 Feb)
           (s.starting_date + make_interval(years => (extract(year FROM t.d)::int - extract(year FROM s.starting_date)::int) + y))::date AS ann
      FROM staff s, today t, generate_series(0, 1) y
     WHERE auth.uid() IS NOT NULL
       AND s.status <> 'terminated'
       AND s.starting_date IS NOT NULL
  )
  SELECT c.id, c.employee_name::text, d.name::text,
         (extract(year FROM c.ann)::int - extract(year FROM c.starting_date)::int) AS years,
         c.ann
    FROM candidates c
    CROSS JOIN today t
    LEFT JOIN departments d ON d.id = c.department_id
   WHERE c.ann BETWEEN t.d - 2 AND t.d + LEAST(GREATEST(COALESCE(p_days, 7), 0), 31)
     AND extract(year FROM c.ann)::int - extract(year FROM c.starting_date)::int >= 1
   ORDER BY c.ann, c.employee_name
$function$;

REVOKE EXECUTE ON FUNCTION recent_kudos(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION kudos_recipients() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION team_milestones(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION recent_kudos(int) TO authenticated;
GRANT EXECUTE ON FUNCTION kudos_recipients() TO authenticated;
GRANT EXECUTE ON FUNCTION team_milestones(int) TO authenticated;
