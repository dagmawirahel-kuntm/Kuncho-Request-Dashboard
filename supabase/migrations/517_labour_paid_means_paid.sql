-- 517 — paid means paid
--
-- ETB 407,730 of labour pay was "sent" with no paid date: sending a payment
-- to the bank read as the end. A payment already closes only when finance
-- records the bank reference and the date it was paid (442); nothing said
-- that this was still open. The screens now say "sent to the bank, not
-- recorded as paid" until it is, the pay tracker (516) shows it as waiting on
-- finance, and finance's morning message counts it.

-- The morning message gains one line for finance and admin: labour payments
-- sent more than a day ago whose pay is not yet recorded as paid. The
-- function is re-created from its live text with that line added, and is
-- left alone if it does not read as expected.
DO $patch$
DECLARE v text;
BEGIN
  v := pg_get_functiondef('public.labour_waiting_for(uuid)'::regprocedure);
  IF position('''proof''::text' IN v) = 0 THEN
    IF position('FROM pending pe HAVING count(*) > 0;' IN v) = 0 THEN
      RAISE EXCEPTION 'labour_waiting_for does not read as expected; nothing was changed';
    END IF;
    v := replace(v, 'FROM pending pe HAVING count(*) > 0;', $new$FROM pending pe HAVING count(*) > 0
  UNION ALL
  SELECT 'proof'::text, count(*)::int,
         count(*) || ' labour payment' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' sent to the bank and not recorded as paid: ' || notify_etb(sum(x.amount))
           || CASE WHEN v_today - min(x.since) >= 2 THEN ' (the oldest sent ' || (v_today - min(x.since)) || ' days ago)' ELSE '' END
    FROM (SELECT b.created_at::date AS since,
                 (SELECT COALESCE(sum(e.amount_etb), 0) FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
                   WHERE i.request_id = q.id AND i.removed_at IS NULL AND e.payment_state <> 'paid') AS amount
            FROM labour_pay_requests q JOIN batch_payments b ON b.id = q.batch_payment_id
           WHERE v_role IN ('finance', 'admin') AND q.status = 'sent' AND b.dissolved_at IS NULL
             AND b.created_at < now() - interval '1 day') x
   WHERE x.amount > 0 HAVING count(*) > 0;$new$);
    EXECUTE v;
  END IF;
END $patch$;
