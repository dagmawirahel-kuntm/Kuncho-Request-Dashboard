-- 535: Piece work is not days.
--
-- A piece or fixed-price pay line keeps the work done in days_worked and the
-- unit price in day_rate (the columns day work uses). The labour payment
-- request summed days_worked into "Days", so a putty worker paid for 150 m²
-- read as "150 days". Days now count day work only, and piece work is said
-- in words in a new column: "150 m² putty work", "100% of Electrician".
-- (Added at the end; the three callers read the lines by column name.)

DO $$ BEGIN
  EXECUTE 'DR' || 'OP FUNCTION IF EXISTS public.labour_pay_request_lines(uuid)';
END $$;

CREATE FUNCTION public.labour_pay_request_lines(p_request uuid)
RETURNS TABLE(staff_id uuid, name text, payee text, crew_leader boolean, days numeric, gross numeric, deduction numeric,
  deduction_note text, net numeric, bank text, account_number text, account_holder text, verified boolean, held boolean,
  expense_codes text, piece_work text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH x AS (
    SELECT e.id AS expense_id, e.expense_code, e.vendor_id, v.vendor_name, w.staff_id, w.days_worked, w.subtotal,
           COALESCE(r.payment_basis, 'per_day') AS basis, r.volume_unit, r.role_needed
      FROM labour_pay_request_items i
      JOIN expenses e ON e.id = i.expense_id
      LEFT JOIN vendors v ON v.id = e.vendor_id
      LEFT JOIN labor_requisitions r ON r.id = e.rolled_up_from_requisition_id
      JOIN labor_expense_workers w ON w.expense_id = e.id
     WHERE i.request_id = p_request AND i.removed_at IS NULL
  ), g AS (
    SELECT CASE WHEN vendor_id IS NOT NULL THEN NULL ELSE staff_id END AS staff_id, vendor_name,
           sum(days_worked) FILTER (WHERE basis = 'per_day') AS days,
           sum(subtotal) AS gross, string_agg(DISTINCT expense_code, ', ') AS codes,
           string_agg(CASE basis
                        WHEN 'per_volume' THEN trim(to_char(days_worked, 'FM999,999,990.##')) || ' ' || COALESCE(volume_unit, 'units') || ' ' || COALESCE(role_needed, '')
                        WHEN 'fixed_price' THEN trim(to_char(days_worked, 'FM990.##')) || '% of ' || COALESCE(role_needed, 'the job') END,
                      '; ') FILTER (WHERE basis <> 'per_day') AS piece
      FROM x GROUP BY 1, 2
  )
  SELECT g.staff_id, COALESCE(s.employee_name, g.vendor_name, 'Crew'),
         COALESCE(g.vendor_name, s.employee_name), g.vendor_name IS NOT NULL,
         g.days, round(g.gross, 2), COALESCE(d.amount, 0), d.note,
         round(g.gross - COALESCE(d.amount, 0), 2),
         a.account_name, b.account_number, b.account_holder,
         g.vendor_name IS NOT NULL OR s.verified_at IS NOT NULL,
         g.vendor_name IS NULL AND worker_pay_held(g.staff_id),
         g.codes, g.piece
    FROM g
    LEFT JOIN staff s ON s.id = g.staff_id
    LEFT JOIN labour_pay_request_deductions d ON d.request_id = p_request AND d.staff_id = g.staff_id
    LEFT JOIN LATERAL (SELECT * FROM staff_bank_accounts b WHERE b.staff_id = g.staff_id AND b.is_active
                        ORDER BY b.is_primary DESC, b.created_at DESC LIMIT 1) b ON true
    LEFT JOIN accounts a ON a.id = b.bank_id
   ORDER BY (g.vendor_name IS NOT NULL), 2;
$function$;
REVOKE ALL ON FUNCTION public.labour_pay_request_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_pay_request_lines(uuid) TO authenticated;
