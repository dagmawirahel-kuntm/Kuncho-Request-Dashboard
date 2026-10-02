-- 402 — Celebrations: birthdays, your own good news, and the month recap
--
-- The app's "fun effects" (lib/celebrate.ts) need a little from the
-- database to celebrate the right people on the right day:
--
--   staff.birth_date        kept by HR beside the other personal details;
--                           readable wherever staff already is.
--   staff.birthday_public   false keeps a person's birthday out of the team
--                           feed (they still get their own greeting).
--
-- Names and dates reach people through SECURITY DEFINER functions that
-- return only what each needs — never a birth year or an age:
--
--   team_birthdays(p_days)      birthdays from yesterday to p_days ahead,
--                               this year's date only (day and month)
--   my_celebrations()           is today your birthday, or a work
--                               anniversary (and which), for the signed-in
--                               person only
--   my_kudos_received(p_since)  thanks sent TO you since a moment
--   my_month_recap(from, to)    your own month in numbers: days on time,
--                               expenses submitted and paid, thanks given
--                               and received, days you cleared your queue
--
-- Days are Addis Ababa days throughout.

SET search_path TO public;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS birthday_public boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN staff.birth_date IS 'Date of birth. Only day and month ever leave the table (team_birthdays, my_celebrations).';
COMMENT ON COLUMN staff.birthday_public IS 'false: the birthday is not shown to colleagues in Team pulse.';

-- "Me" is current_staff_id() (148): one answer to who am I, not a second.

-- This year's (and next year's) occurrence of a yearly date; 29 Feb lands
-- on 28 Feb in other years, as in team_milestones (380).
CREATE OR REPLACE FUNCTION public.yearly_occurrence(p_date date, p_on date, p_plus int)
RETURNS date LANGUAGE sql IMMUTABLE AS $function$
  SELECT (p_date + make_interval(years => (extract(year FROM p_on)::int - extract(year FROM p_date)::int) + p_plus))::date
$function$;

CREATE OR REPLACE FUNCTION public.team_birthdays(p_days int DEFAULT 7)
RETURNS TABLE (staff_id uuid, employee_name text, department text, birthday date, is_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date AS d),
  me AS (SELECT public.current_staff_id() AS id),
  candidates AS (
    SELECT s.id, s.employee_name, s.department_id, yearly_occurrence(s.birth_date, t.d, y) AS bday
      FROM staff s, today t, generate_series(0, 1) y
     WHERE auth.uid() IS NOT NULL
       AND s.status <> 'terminated'
       AND s.birth_date IS NOT NULL
       AND (s.birthday_public OR s.id = (SELECT id FROM me))
  )
  SELECT c.id, c.employee_name::text, d.name::text, c.bday, c.id = (SELECT id FROM me)
    FROM candidates c
    CROSS JOIN today t
    LEFT JOIN departments d ON d.id = c.department_id
   WHERE c.bday BETWEEN t.d - 1 AND t.d + LEAST(GREATEST(COALESCE(p_days, 7), 0), 31)
   ORDER BY c.bday, c.employee_name
$function$;

CREATE OR REPLACE FUNCTION public.my_celebrations()
RETURNS TABLE (staff_id uuid, employee_name text, birthday_today boolean, anniversary_years int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date AS d)
  SELECT s.id,
         s.employee_name::text,
         COALESCE(yearly_occurrence(s.birth_date, t.d, 0) = t.d, false),
         CASE WHEN s.starting_date IS NOT NULL
                   AND yearly_occurrence(s.starting_date, t.d, 0) = t.d
                   AND extract(year FROM t.d)::int - extract(year FROM s.starting_date)::int >= 1
              THEN extract(year FROM t.d)::int - extract(year FROM s.starting_date)::int END
    FROM staff s CROSS JOIN today t
   WHERE s.id = public.current_staff_id()
$function$;

CREATE OR REPLACE FUNCTION public.my_kudos_received(p_since timestamptz DEFAULT now() - interval '14 days')
RETURNS TABLE (id uuid, from_name text, message text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT k.id, COALESCE(fs.employee_name, up.full_name)::text, k.message, k.created_at
    FROM kudos k
    LEFT JOIN user_profiles up ON up.id = k.from_user
    LEFT JOIN LATERAL (SELECT s.employee_name FROM staff s WHERE s.user_id = k.from_user LIMIT 1) fs ON true
   WHERE auth.uid() IS NOT NULL
     AND k.to_staff_id = public.current_staff_id()
     AND k.created_at > GREATEST(COALESCE(p_since, now() - interval '14 days'), now() - interval '60 days')
   ORDER BY k.created_at DESC
   LIMIT 20
$function$;

CREATE OR REPLACE FUNCTION public.my_month_recap(p_from date, p_to date)
RETURNS TABLE (
  days_recorded int, days_on_time int, days_late int,
  expenses_submitted int, expenses_paid int,
  kudos_received int, kudos_sent int, queue_zero_days int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH me AS (SELECT public.current_staff_id() AS sid, auth.uid() AS uid),
  span AS (
    SELECT p_from AS f, LEAST(p_to, p_from + 62) AS t,
           (p_from::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AS fts,
           ((LEAST(p_to, p_from + 62) + 1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AS tts
  )
  SELECT
    (SELECT count(*) FROM staff_attendance a, me, span WHERE a.staff_id = me.sid AND a.work_date BETWEEN span.f AND span.t AND a.status <> 'absent')::int,
    (SELECT count(*) FROM staff_attendance a, me, span WHERE a.staff_id = me.sid AND a.work_date BETWEEN span.f AND span.t AND a.status IN ('present', 'field'))::int,
    (SELECT count(*) FROM staff_attendance a, me, span WHERE a.staff_id = me.sid AND a.work_date BETWEEN span.f AND span.t AND a.status = 'late')::int,
    (SELECT count(*) FROM expenses e, me, span WHERE e.purchaser_user_id = me.uid AND e.created_at >= span.fts AND e.created_at < span.tts)::int,
    (SELECT count(*) FROM expenses e, me, span WHERE e.purchaser_user_id = me.uid AND e.paid_date BETWEEN span.f AND span.t)::int,
    (SELECT count(*) FROM kudos k, me, span WHERE k.to_staff_id = me.sid AND k.created_at >= span.fts AND k.created_at < span.tts)::int,
    (SELECT count(*) FROM kudos k, me, span WHERE k.from_user = me.uid AND k.created_at >= span.fts AND k.created_at < span.tts)::int,
    (SELECT count(*) FROM dashboard_progress p, me, span WHERE p.user_id = me.uid AND p.day BETWEEN span.f AND span.t AND p.reached_zero)::int
   WHERE auth.uid() IS NOT NULL
$function$;

REVOKE EXECUTE ON FUNCTION team_birthdays(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION my_celebrations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION my_kudos_received(timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION my_month_recap(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION team_birthdays(int) TO authenticated;
GRANT EXECUTE ON FUNCTION my_celebrations() TO authenticated;
GRANT EXECUTE ON FUNCTION my_kudos_received(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION my_month_recap(date, date) TO authenticated;
