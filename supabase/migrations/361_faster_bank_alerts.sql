-- 361 — Bank alerts: find possible double payments without timing out
--
-- v_bank_alerts runs with the caller's permissions (security_invoker), so
-- expenses' row-level security applies. Its "possible double payment"
-- section joined expenses to itself; with RLS on both sides the planner
-- can't hash the join (the payee comparison isn't leakproof), so it
-- re-checked the policy for every pair: 120 x 227 rows, ~2.6 s of the
-- view's 3.7 s, and past the 8 s statement timeout whenever the dashboard
-- loaded it alongside other lookups.
--
-- The section now reads the candidate expenses once (RLS checked once per
-- row) into a materialised CTE and pairs those. Same rows, same columns;
-- every other section of the view is kept exactly as it is.

SET search_path TO public;

DO $$
DECLARE
  d text := pg_get_viewdef('v_bank_alerts'::regclass, true);
  cut int := strpos(d, E'UNION ALL\n SELECT ''possible_duplicate''');
BEGIN
  IF cut = 0 THEN RAISE EXCEPTION 'v_bank_alerts: possible_duplicate section not found'; END IF;
  d := left(d, cut - 1) || $sql$UNION ALL
 SELECT 'possible_duplicate'::text AS kind,
    'high'::text AS severity,
    d.account_id,
    a.account_name,
    (('Possible double payment: '::text || to_char(d.amt1, 'FM999,999,999,990.00'::text)) || ' to '::text) || COALESCE(v.vendor_name, st.employee_name, 'the same payee'::text) AS title,
    ((((COALESCE(d.code1, 'Expense'::text) || ' and '::text) || COALESCE(d.code2, 'expense'::text)) || ', '::text) || abs(d.date2 - d.date1)) || ' days apart.'::text AS detail,
    d.amt1 AS amount,
    GREATEST(d.date1, d.date2) AS since,
    '/expenses/'::text || d.id2 AS link,
    d.id2 AS ref_id
   FROM ( WITH cand AS MATERIALIZED (
             SELECT e.id, e.expense_code, e.account_id, e.vendor_id, e.paid_to_staff_id,
                COALESCE(e.vendor_id::text, e.paid_to_staff_id::text) AS payee,
                COALESCE(e.net_payable, e.amount_etb) AS amt,
                e.date
               FROM expenses e
              WHERE COALESCE(e.vendor_id, e.paid_to_staff_id) IS NOT NULL
                AND (e.payment_state = ANY (ARRAY['approved_to_pay'::text, 'sent'::text, 'paid'::text]))
                AND NOT COALESCE(e.is_archived, false)
                AND e.date >= (CURRENT_DATE - 67)
           )
         SELECT c1.id AS id1, c2.id AS id2, c1.expense_code AS code1, c2.expense_code AS code2,
            c1.account_id, c1.vendor_id, c1.paid_to_staff_id, c1.amt AS amt1, c1.date AS date1, c2.date AS date2
           FROM cand c1
             JOIN cand c2 ON c2.payee = c1.payee AND c2.id > c1.id AND abs(c2.amt - c1.amt) < 0.01 AND abs(c2.date - c1.date) <= 7
          WHERE c1.amt >= 5000::numeric AND GREATEST(c1.date, c2.date) >= (CURRENT_DATE - 60)) d
     LEFT JOIN vendors v ON v.id = d.vendor_id
     LEFT JOIN staff st ON st.id = d.paid_to_staff_id
     LEFT JOIN accounts a ON a.id = d.account_id$sql$;
  EXECUTE 'CREATE OR REPLACE VIEW v_bank_alerts WITH (security_invoker = on) AS ' || d;
END $$;
