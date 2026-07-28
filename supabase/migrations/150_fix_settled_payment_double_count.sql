-- ============================================================
-- Fix: cash movements settled through a bank line were subtracted
-- TWICE from account balances — once as the imported bank statement
-- transfer, once again as the app-side expense/payroll row recording
-- the same payment.
--
-- Found on CBE (1000504664272), which was showing a NEGATIVE live
-- balance despite a 6,359,691.55 FY2026/27 opening anchor:
--
--     6,359,691.55   anchor (2026-07-07, migration 134)
--    +     8,874.75   transfers in
--    -  5,667,504.67  transfers out   <- 26 imported bank statement lines
--    ─────────────────
--         701,061.63  <- what the bank statement alone says
--    -  1,153,739.27  expenses out    <- the SAME payments, app-side
--    ─────────────────
--        -452,677.64  <- what v_account_balances reported
--
-- Both offending expenses ALREADY carried a correct transfer_id
-- pointing at the exact bank line that settled them (the linking
-- machinery from 099/137 is working fine):
--
--   GEN-MISC-20260708-01  1,110,260.87 -> FT26195KGZBS  1,110,266.87
--   MESK-MISC-20260725-01    43,478.40 -> FT261949D7NL     48,701.65
--
-- The balance logic simply never consulted that link. This migration
-- makes it consult it: an expense or payroll row whose settlement is
-- already represented by a counted bank line (directly, or via its
-- batch payment, or via the VRF that funded it) no longer subtracts a
-- second time.
--
-- Deliberately NOT done here: reconciling the small per-line gaps
-- between an expense's amount and its bank line's amount (6.00 on the
-- rent, 5,223.25 on the PO — bank charges / partial settlement). The
-- bank statement is authoritative for what left the account, so the
-- bank line is the figure that counts; the expense amount stays as the
-- business record of what was owed. Surfacing those gaps is a separate
-- reporting concern, not a balance concern.
--
-- Shape note: the anchor/same-day carve-out logic from 130/131/134 is
-- unchanged in behaviour. It is refactored into shared counted_out /
-- counted_in CTEs so the "is this bank line counted?" rule is written
-- once and reused by the double-count exclusion, instead of being
-- duplicated and drifting.
-- ============================================================

SET search_path TO public;

DROP VIEW IF EXISTS public.v_account_balances;
CREATE VIEW public.v_account_balances
WITH (security_invoker = true) AS
WITH
  latest_anchor AS (
    SELECT DISTINCT ON (account_id) account_id, as_of_date, balance, transfer_id
    FROM bank_balance_anchors
    ORDER BY account_id, as_of_date DESC
  ),
  -- Every outbound bank line that counts against its account, kept as
  -- individual rows (not pre-summed) so the settlement exclusion below
  -- can test membership by transfer id.
  counted_out AS (
    SELECT t.id, t.from_account_id AS account_id, t.amount
    FROM public.transfers t
    LEFT JOIN latest_anchor la ON la.account_id = t.from_account_id
    WHERE t.from_account_id IS NOT NULL
      AND (
        la.as_of_date IS NULL
        OR t.date > la.as_of_date
        OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
      )
  ),
  counted_in AS (
    SELECT t.id, t.to_account_id AS account_id, t.amount
    FROM public.transfers t
    LEFT JOIN latest_anchor la ON la.account_id = t.to_account_id
    WHERE t.to_account_id IS NOT NULL
      AND (
        la.as_of_date IS NULL
        OR t.date > la.as_of_date
        OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
      )
  ),
  -- VRF outflows that count, again row-wise for the same reason.
  counted_vrf_out AS (
    SELECT v.id, v.initial_account_id AS account_id, v.amount_transferred AS amount
    FROM public.vendor_receipt_facilitation v
    LEFT JOIN latest_anchor la ON la.account_id = v.initial_account_id
    WHERE v.initial_account_id IS NOT NULL
      AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
  ),
  transfers_out AS (SELECT account_id, COALESCE(SUM(amount), 0) AS total FROM counted_out     GROUP BY account_id),
  transfers_in  AS (SELECT account_id, COALESCE(SUM(amount), 0) AS total FROM counted_in      GROUP BY account_id),
  vrf_out       AS (SELECT account_id, COALESCE(SUM(amount), 0) AS total FROM counted_vrf_out GROUP BY account_id),
  vrf_in AS (
    SELECT v.return_account_id AS account_id, COALESCE(SUM(v.money_returned), 0) AS total
    FROM public.vendor_receipt_facilitation v
    LEFT JOIN latest_anchor la ON la.account_id = v.return_account_id
    WHERE v.return_account_id IS NOT NULL
      AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
    GROUP BY v.return_account_id
  ),
  sales_in AS (
    SELECT s.account_id, COALESCE(SUM(s.amount), 0) AS total
    FROM public.sales s
    LEFT JOIN latest_anchor la ON la.account_id = s.account_id
    WHERE s.account_id IS NOT NULL AND s.sales_status = 'Paid'
      AND (la.as_of_date IS NULL OR s.date > la.as_of_date)
    GROUP BY s.account_id
  ),
  -- ── The fix ──────────────────────────────────────────────────────
  -- Skip any paid expense whose cash movement is already counted as a
  -- bank line or VRF outflow on this same account.
  expenses_out AS (
    SELECT e.account_id, COALESCE(SUM(e.amount_etb), 0) AS total
    FROM public.expenses e
    LEFT JOIN latest_anchor la ON la.account_id = e.account_id
    WHERE e.account_id IS NOT NULL AND e.payment_status = true
      AND (la.as_of_date IS NULL OR e.date > la.as_of_date)
      AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = e.transfer_id AND co.account_id = e.account_id)
      AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = e.vrf_id     AND cv.account_id = e.account_id)
      AND NOT EXISTS (
        SELECT 1 FROM batch_payment_expenses bpe
        JOIN batch_payments bp ON bp.id = bpe.batch_payment_id
        JOIN counted_out co ON co.id = bp.transfer_id AND co.account_id = e.account_id
        WHERE bpe.expense_id = e.id
      )
    GROUP BY e.account_id
  ),
  payroll_out AS (
    SELECT p.account_id, COALESCE(SUM(ps.net_amount), 0) AS total
    FROM public.payroll p
    JOIN public.payroll_staff ps ON ps.payroll_id = p.id
    LEFT JOIN latest_anchor la ON la.account_id = p.account_id
    WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid'
      AND (la.as_of_date IS NULL OR p.end_date > la.as_of_date)
      AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = p.transfer_id AND co.account_id = p.account_id)
      AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = p.vrf_id     AND cv.account_id = p.account_id)
    GROUP BY p.account_id
  ),
  advances_out AS (
    SELECT ca.account_used_id AS account_id, COALESCE(SUM(ca.amount_advanced), 0) AS total
    FROM public.cash_advances ca
    LEFT JOIN latest_anchor la ON la.account_id = ca.account_used_id
    WHERE ca.account_used_id IS NOT NULL AND ca.approval_status = 'finance_approved'
      AND (la.as_of_date IS NULL OR ca.date_given > la.as_of_date)
    GROUP BY ca.account_used_id
  )
SELECT
  a.id,
  a.account_name,
  a.type,
  a.status,
  COALESCE(la.balance, 0) + COALESCE(si.total, 0) + COALESCE(ti.total, 0) + COALESCE(vi.total, 0)
    - COALESCE(eo.total, 0)
    - COALESCE(ao.total, 0)
    - COALESCE(po.total, 0)
    - COALESCE(vo.total, 0)
    - COALESCE(to2.total, 0)  AS balance,
  COALESCE(la.balance, 0)     AS opening_balance,
  la.as_of_date               AS opening_balance_as_of,
  COALESCE(si.total,  0)      AS total_sales_in,
  COALESCE(ti.total,  0)      AS total_transfers_in,
  COALESCE(vi.total,  0)      AS total_vrf_returned_in,
  COALESCE(eo.total,  0)      AS total_expenses_out,
  COALESCE(ao.total,  0)      AS total_advances_out,
  COALESCE(po.total,  0)      AS total_payroll_out,
  COALESCE(vo.total,  0)      AS total_vrf_transferred_out,
  COALESCE(to2.total, 0)      AS total_transfers_out
FROM public.accounts a
LEFT JOIN latest_anchor la  ON la.account_id  = a.id
LEFT JOIN sales_in      si  ON si.account_id  = a.id
LEFT JOIN expenses_out  eo  ON eo.account_id  = a.id
LEFT JOIN advances_out  ao  ON ao.account_id  = a.id
LEFT JOIN payroll_out   po  ON po.account_id  = a.id
LEFT JOIN vrf_out       vo  ON vo.account_id  = a.id
LEFT JOIN vrf_in        vi  ON vi.account_id  = a.id
LEFT JOIN transfers_in  ti  ON ti.account_id  = a.id
LEFT JOIN transfers_out to2 ON to2.account_id = a.id;

GRANT SELECT ON public.v_account_balances TO authenticated;

-- ── Same fix, same shape, for the as-of variant (131/134) ───────────
DROP FUNCTION IF EXISTS public.account_balances_asof(date);

CREATE FUNCTION public.account_balances_asof(p_cutoff date)
RETURNS TABLE (
  id uuid,
  account_name text,
  type text,
  status text,
  balance numeric,
  opening_balance numeric,
  opening_balance_as_of date,
  total_sales_in numeric,
  total_transfers_in numeric,
  total_vrf_returned_in numeric,
  total_expenses_out numeric,
  total_advances_out numeric,
  total_payroll_out numeric,
  total_vrf_transferred_out numeric,
  total_transfers_out numeric
) LANGUAGE sql STABLE AS $$
  WITH
    latest_anchor AS (
      SELECT DISTINCT ON (account_id) account_id, as_of_date, balance, transfer_id
      FROM bank_balance_anchors
      WHERE as_of_date <= p_cutoff
      ORDER BY account_id, as_of_date DESC
    ),
    counted_out AS (
      SELECT t.id, t.from_account_id AS account_id, t.amount
      FROM public.transfers t
      LEFT JOIN latest_anchor la ON la.account_id = t.from_account_id
      WHERE t.from_account_id IS NOT NULL AND t.date <= p_cutoff
        AND (
          la.as_of_date IS NULL
          OR t.date > la.as_of_date
          OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
        )
    ),
    counted_in AS (
      SELECT t.id, t.to_account_id AS account_id, t.amount
      FROM public.transfers t
      LEFT JOIN latest_anchor la ON la.account_id = t.to_account_id
      WHERE t.to_account_id IS NOT NULL AND t.date <= p_cutoff
        AND (
          la.as_of_date IS NULL
          OR t.date > la.as_of_date
          OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
        )
    ),
    counted_vrf_out AS (
      SELECT v.id, v.initial_account_id AS account_id, v.amount_transferred AS amount
      FROM public.vendor_receipt_facilitation v
      LEFT JOIN latest_anchor la ON la.account_id = v.initial_account_id
      WHERE v.initial_account_id IS NOT NULL AND v.trxn_date <= p_cutoff
        AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
    ),
    transfers_out AS (SELECT account_id, COALESCE(SUM(amount), 0) AS total FROM counted_out     GROUP BY account_id),
    transfers_in  AS (SELECT account_id, COALESCE(SUM(amount), 0) AS total FROM counted_in      GROUP BY account_id),
    vrf_out       AS (SELECT account_id, COALESCE(SUM(amount), 0) AS total FROM counted_vrf_out GROUP BY account_id),
    vrf_in AS (
      SELECT v.return_account_id AS account_id, COALESCE(SUM(v.money_returned), 0) AS total
      FROM public.vendor_receipt_facilitation v
      LEFT JOIN latest_anchor la ON la.account_id = v.return_account_id
      WHERE v.return_account_id IS NOT NULL AND v.trxn_date <= p_cutoff
        AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
      GROUP BY v.return_account_id
    ),
    sales_in AS (
      SELECT s.account_id, COALESCE(SUM(s.amount), 0) AS total
      FROM public.sales s
      LEFT JOIN latest_anchor la ON la.account_id = s.account_id
      WHERE s.account_id IS NOT NULL AND s.sales_status = 'Paid'
        AND s.date <= p_cutoff
        AND (la.as_of_date IS NULL OR s.date > la.as_of_date)
      GROUP BY s.account_id
    ),
    expenses_out AS (
      SELECT e.account_id, COALESCE(SUM(e.amount_etb), 0) AS total
      FROM public.expenses e
      LEFT JOIN latest_anchor la ON la.account_id = e.account_id
      WHERE e.account_id IS NOT NULL AND e.payment_status = true
        AND e.date <= p_cutoff
        AND (la.as_of_date IS NULL OR e.date > la.as_of_date)
        AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = e.transfer_id AND co.account_id = e.account_id)
        AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = e.vrf_id     AND cv.account_id = e.account_id)
        AND NOT EXISTS (
          SELECT 1 FROM batch_payment_expenses bpe
          JOIN batch_payments bp ON bp.id = bpe.batch_payment_id
          JOIN counted_out co ON co.id = bp.transfer_id AND co.account_id = e.account_id
          WHERE bpe.expense_id = e.id
        )
      GROUP BY e.account_id
    ),
    payroll_out AS (
      SELECT p.account_id, COALESCE(SUM(ps.net_amount), 0) AS total
      FROM public.payroll p
      JOIN public.payroll_staff ps ON ps.payroll_id = p.id
      LEFT JOIN latest_anchor la ON la.account_id = p.account_id
      WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid'
        AND p.end_date <= p_cutoff
        AND (la.as_of_date IS NULL OR p.end_date > la.as_of_date)
        AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = p.transfer_id AND co.account_id = p.account_id)
        AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = p.vrf_id     AND cv.account_id = p.account_id)
      GROUP BY p.account_id
    ),
    advances_out AS (
      SELECT ca.account_used_id AS account_id, COALESCE(SUM(ca.amount_advanced), 0) AS total
      FROM public.cash_advances ca
      LEFT JOIN latest_anchor la ON la.account_id = ca.account_used_id
      WHERE ca.account_used_id IS NOT NULL AND ca.approval_status = 'finance_approved'
        AND ca.date_given <= p_cutoff
        AND (la.as_of_date IS NULL OR ca.date_given > la.as_of_date)
      GROUP BY ca.account_used_id
    )
  SELECT
    a.id, a.account_name, a.type, a.status,
    COALESCE(la.balance, 0) + COALESCE(si.total, 0) + COALESCE(ti.total, 0) + COALESCE(vi.total, 0)
      - COALESCE(eo.total, 0) - COALESCE(ao.total, 0)
      - COALESCE(po.total, 0) - COALESCE(vo.total, 0) - COALESCE(to2.total, 0) AS balance,
    COALESCE(la.balance, 0)  AS opening_balance,
    la.as_of_date            AS opening_balance_as_of,
    COALESCE(si.total, 0), COALESCE(ti.total, 0), COALESCE(vi.total, 0),
    COALESCE(eo.total, 0), COALESCE(ao.total, 0), COALESCE(po.total, 0),
    COALESCE(vo.total, 0), COALESCE(to2.total, 0)
  FROM public.accounts a
  LEFT JOIN latest_anchor la  ON la.account_id  = a.id
  LEFT JOIN sales_in      si  ON si.account_id  = a.id
  LEFT JOIN expenses_out  eo  ON eo.account_id  = a.id
  LEFT JOIN advances_out  ao  ON ao.account_id  = a.id
  LEFT JOIN payroll_out   po  ON po.account_id  = a.id
  LEFT JOIN vrf_out       vo  ON vo.account_id  = a.id
  LEFT JOIN vrf_in        vi  ON vi.account_id  = a.id
  LEFT JOIN transfers_in  ti  ON ti.account_id  = a.id
  LEFT JOIN transfers_out to2 ON to2.account_id = a.id;
$$;

GRANT EXECUTE ON FUNCTION public.account_balances_asof(date) TO authenticated;

-- ── A standing check so this class of bug is visible, not silent ────
-- Any paid expense / payroll row that names a settling bank line whose
-- account disagrees with the row's own account: the exclusion above
-- keys on (transfer id + account), so a mismatch here means the row is
-- still being double-counted somewhere and needs a human look.
CREATE OR REPLACE VIEW v_settlement_link_mismatches
WITH (security_invoker = true) AS
SELECT 'expense' AS kind, e.id, e.expense_code AS code, e.date, e.amount_etb AS amount,
       e.account_id, t.from_account_id AS transfer_from_account_id, t.transfer_id_code, t.amount AS transfer_amount
FROM expenses e JOIN transfers t ON t.id = e.transfer_id
WHERE e.payment_status = true AND t.from_account_id IS DISTINCT FROM e.account_id
UNION ALL
SELECT 'payroll', p.id, p.payroll_record, p.end_date, NULL,
       p.account_id, t.from_account_id, t.transfer_id_code, t.amount
FROM payroll p JOIN transfers t ON t.id = p.transfer_id
WHERE p.payment_status = 'paid' AND t.from_account_id IS DISTINCT FROM p.account_id;

GRANT SELECT ON v_settlement_link_mismatches TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
-- CBE should now read ~701,061.63 (anchor + transfers in - bank lines
-- out), with total_expenses_out at 0 because both of its paid expenses
-- are settled by counted bank lines.
SELECT account_name, opening_balance, total_transfers_in, total_transfers_out,
       total_expenses_out, total_payroll_out, balance
FROM v_account_balances
WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';

-- The as-of variant must agree with the live view when asked for today.
SELECT account_name, balance FROM account_balances_asof(CURRENT_DATE)
WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';

-- Expect zero rows.
SELECT * FROM v_settlement_link_mismatches;
