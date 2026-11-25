-- 541 — each PM's workers in one list
--
-- Workers were listed by site (Worker details) or all together (HR's
-- register). A PM's crew is whoever is on their day sheets: by day rate or on
-- a piece job. One row per worker, with what HR and pay need to know.

CREATE OR REPLACE FUNCTION public.labour_pm_workers(p_pm uuid, p_from date DEFAULT NULL)
RETURNS TABLE(staff_id uuid, name text, trade text, day_rate numeric, phone text, photo_url text, verified boolean, active boolean,
              first_day date, last_day date, days_worked numeric, days_this_month numeric, piece_days integer, on_latest_sheet boolean,
              needs_rate boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH d AS (
    SELECT d.id, d.work_date FROM labour_days d
     WHERE d.pm_staff_id = p_pm AND (p_from IS NULL OR d.work_date >= p_from) AND labour_day_can_see(p_pm)
  ),
  latest AS (SELECT d.id FROM d WHERE EXISTS (SELECT 1 FROM labour_day_workers w WHERE w.day_id = d.id) ORDER BY d.work_date DESC LIMIT 1),
  m AS (SELECT date_trunc('month', (now() AT TIME ZONE 'Africa/Addis_Ababa'))::date AS m),
  x AS (
    SELECT w.staff_id, d.work_date, w.paid_days, false AS piece, d.id AS day_id
      FROM labour_day_workers w JOIN d ON d.id = w.day_id
    UNION ALL
    SELECT c.staff_id, d.work_date, 0, true, d.id FROM labour_day_job_crew c JOIN d ON d.id = c.day_id
  )
  SELECT s.id, btrim(s.employee_name), s.trade_tag, s.day_rate, s.phone_number, s.photo_url, s.verified_at IS NOT NULL,
         COALESCE(s.status, 'active') = 'active',
         min(x.work_date), max(x.work_date),
         COALESCE(sum(x.paid_days), 0),
         COALESCE(sum(x.paid_days) FILTER (WHERE x.work_date >= (SELECT m FROM m)), 0),
         (count(DISTINCT x.work_date) FILTER (WHERE x.piece))::int,
         bool_or(NOT x.piece AND x.day_id IN (SELECT id FROM latest)),
         bool_or(NOT x.piece) AND COALESCE(s.day_rate, 0) <= 0
    FROM x JOIN staff s ON s.id = x.staff_id
   GROUP BY s.id
   ORDER BY max(x.work_date) DESC, btrim(s.employee_name);
$f$;
REVOKE EXECUTE ON FUNCTION public.labour_pm_workers(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_pm_workers(uuid, date) TO authenticated, service_role;
