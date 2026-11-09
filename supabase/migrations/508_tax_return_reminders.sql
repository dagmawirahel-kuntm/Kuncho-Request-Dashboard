-- 508: A reminder a week before a tax return falls due.
--
-- Every morning, finance and the tax officer get one bell notification per
-- tax month whose returns fall due within the next seven days and aren't
-- declared and paid yet: "VAT and withholding for Meskerem 2019 are due in
-- 7 days". It opens that month on the Taxes page. One reminder per month
-- and due date: the dedupe key stops a second. A return whose month ends
-- fewer than seven days before its due date (payroll tax, pension) is
-- reminded the morning after the month ends.

SET search_path TO public;

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order)
VALUES ('tax.return_due', 'Tax', 'A tax return falls due in a week',
        'Finance and the tax officer, once, about a week before returns not yet declared and paid fall due', 'high', 72)
ON CONFLICT (kind) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tax_return_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_users uuid[];
  r record;
  v_n integer := 0;
  v_list text;
BEGIN
  SELECT array_agg(id) INTO v_users FROM user_profiles
   WHERE account_status IS DISTINCT FROM 'disabled' AND (role::text = 'finance' OR is_tax_officer);
  IF v_users IS NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT f.period_ec_year AS y, f.period_ec_month AS m, f.due_date_greg AS due,
           COALESCE(f.period_label, f.period_ec_year::text) AS label,
           array_agg(CASE f.schedule_code WHEN 'VAT' THEN 'VAT' WHEN 'WHT' THEN 'withholding' WHEN 'SCH_A' THEN 'payroll tax'
                                          WHEN 'PENSION' THEN 'pension' WHEN 'SCH_C' THEN 'profit tax' END
                     ORDER BY CASE f.schedule_code WHEN 'VAT' THEN 1 WHEN 'WHT' THEN 2 WHEN 'SCH_A' THEN 3 WHEN 'PENSION' THEN 4 ELSE 5 END) AS taxes,
           count(*) AS n
      FROM tax_filings f
     WHERE f.schedule_code IN ('VAT', 'WHT', 'SCH_A', 'PENSION', 'SCH_C')
       AND f.status <> 'acknowledged'
       AND f.period_end_greg < v_today
       AND f.due_date_greg BETWEEN v_today AND v_today + 7
       AND NOT (f.declared_amount IS NOT NULL AND (f.declared_amount = 0 OR COALESCE(f.paid_amount, 0) >= f.declared_amount - 1))
     GROUP BY f.period_ec_year, f.period_ec_month, f.due_date_greg, COALESCE(f.period_label, f.period_ec_year::text)
  LOOP
    -- "VAT and withholding", "payroll tax and pension".
    v_list := CASE WHEN cardinality(r.taxes) = 1 THEN r.taxes[1]
                   ELSE array_to_string(r.taxes[1:cardinality(r.taxes) - 1], ', ') || ' and ' || r.taxes[cardinality(r.taxes)] END;
    v_n := v_n + notify(v_users, 'tax.return_due',
      upper(left(v_list, 1)) || substr(v_list, 2) || ' for ' || r.label || ' due '
        || CASE r.due - v_today WHEN 0 THEN 'today' WHEN 1 THEN 'tomorrow' ELSE 'in ' || (r.due - v_today) || ' days' END,
      CASE WHEN r.n = 1 THEN 'This return isn''t' ELSE 'These returns aren''t' END
        || ' declared and paid yet. Due ' || to_char(r.due, 'FMDD Mon YYYY') || '.',
      CASE WHEN r.m IS NULL THEN '/taxes' ELSE '/taxes/' || r.y || '/' || r.m END,
      NULL, NULL, NULL,
      'tax.return_due:' || r.y || '-' || COALESCE(r.m::text, 'year') || ':' || r.due);
  END LOOP;
  RETURN v_n;
END $f$;
REVOKE ALL ON FUNCTION public.tax_return_reminders() FROM PUBLIC, anon, authenticated;

-- 08:13 in Addis Ababa, every day.
SELECT cron.schedule('kuncho-tax-return-reminders', '13 5 * * *', 'SELECT public.tax_return_reminders()');
