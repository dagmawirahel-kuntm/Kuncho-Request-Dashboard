-- 536: What a worker charged before for piece work.
--
-- When a piece or fixed-price job is agreed, the people who would do it
-- usually did the same kind of work for us before. For each person, every
-- earlier piece job they were on — on its crew, allocated, or paid on it —
-- with the agreed price, how much they did and were paid, where and when.
-- Rows are ranked by how close the work's name is to p_work (trigram
-- similarity on the job and its scope), then the same unit, then newest.

CREATE OR REPLACE FUNCTION public.piece_rate_history(p_staff uuid[], p_work text DEFAULT NULL, p_unit text DEFAULT NULL,
  p_exclude uuid DEFAULT NULL)
RETURNS TABLE (staff_id uuid, name text, labor_requisition_id uuid, work text, scope text, basis text, unit text,
  price numeric, done numeric, paid numeric, project text, worked_on date, match numeric, same_unit boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
  WITH crew AS (
    SELECT rw.requisition_id AS req, rw.staff_id FROM labor_requisition_workers rw WHERE rw.staff_id = ANY (p_staff)
    UNION SELECT a.labor_requisition_id, a.staff_id FROM labor_allocations a WHERE a.staff_id = ANY (p_staff)
    UNION SELECT x.rolled_up_from_requisition_id, w.staff_id FROM labor_expense_workers w JOIN expenses x ON x.id = w.expense_id
           WHERE w.staff_id = ANY (p_staff) AND x.rolled_up_from_requisition_id IS NOT NULL AND NOT COALESCE(x.is_archived, false)
  )
  SELECT c.staff_id, s.employee_name, r.id, btrim(r.role_needed), NULLIF(btrim(r.scope_of_work), ''), r.payment_basis,
         CASE WHEN r.payment_basis = 'per_volume' THEN r.volume_unit END,
         CASE WHEN r.payment_basis = 'per_volume' THEN r.unit_rate ELSE r.fixed_price_amount END,
         pay.done, pay.paid, btrim(p.project_name),
         COALESCE(pay.last_day, r.start_date),
         round(CASE WHEN NULLIF(btrim(p_work), '') IS NULL THEN 0
                    ELSE GREATEST(similarity(lower(r.role_needed), lower(p_work)),
                                  similarity(lower(COALESCE(r.scope_of_work, '')), lower(p_work)),
                                  word_similarity(lower(p_work), lower(r.role_needed || ' ' || COALESCE(r.scope_of_work, '')))) END::numeric, 2),
         p_unit IS NOT NULL AND lower(btrim(COALESCE(r.volume_unit, ''))) = lower(btrim(p_unit))
    FROM crew c
    JOIN labor_requisitions r ON r.id = c.req
    JOIN staff s ON s.id = c.staff_id
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN LATERAL (
      SELECT sum(w.days_worked) AS done, sum(w.subtotal) AS paid, max(x.rollup_period_end) AS last_day
        FROM labor_expense_workers w JOIN expenses x ON x.id = w.expense_id
       WHERE x.rolled_up_from_requisition_id = r.id AND w.staff_id = c.staff_id AND NOT COALESCE(x.is_archived, false)
    ) pay ON true
   WHERE r.payment_basis IN ('per_volume', 'fixed_price')
     AND r.status = 'approved'
     AND (p_exclude IS NULL OR r.id <> p_exclude)
     AND (CASE WHEN r.payment_basis = 'per_volume' THEN r.unit_rate ELSE r.fixed_price_amount END) > 0
   ORDER BY 1, 13 DESC, 14 DESC, 12 DESC NULLS LAST;
$f$;
REVOKE ALL ON FUNCTION public.piece_rate_history(uuid[], text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.piece_rate_history(uuid[], text, text, uuid) TO authenticated;
