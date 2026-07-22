-- ============================================================
-- FY2026/27 opening balance anchor for CBE + a same-day double-count
-- fix in the anchor-aware balance logic this new anchor exposes.
--
-- User-provided: CBE's balance at the start of FY2026/27 (the current
-- fiscal year, 2026-07-08 onward per fiscal_periods) is 5,108,807.22
-- ETB. Anchored at as_of_date = 2026-07-07 (the last day of FY2025/26)
-- so the existing anchor-aware views' `date > as_of_date` logic starts
-- fresh exactly at 2026-07-08 — no code change needed there, since
-- 130/131 already pick the MOST RECENT anchor per account
-- (`DISTINCT ON (account_id) ... ORDER BY as_of_date DESC`). This new
-- row supersedes the earlier CBE anchor (2025-07-07, 66717.56 —
-- migration 106) for every live balance computation going forward;
-- that older anchor is untouched and stays in the table as the
-- historical/legacy record for FY2025/26, exactly as it was.
--
-- Bug found while adding this: the FY2025/26 anchor was tied to one
-- specific transfer (the earliest backfilled transaction), so 130/131
-- correctly special-case that one transfer_id out of the same-day
-- exclusion — same-day siblings still count. A period-boundary anchor
-- like this one has no specific transfer backing it (transfer_id is
-- NULL — it's a declared balance as of a date, not a transaction), and
-- `t.id IS DISTINCT FROM NULL` is true for every real id, so the old
-- logic would have WRONGLY counted every transfer dated exactly
-- 2026-07-07 a second time on top of being baked into the anchor.
-- Fixed by only applying the same-day carve-out when transfer_id is
-- actually set; a NULL-transfer_id anchor now correctly means "every
-- transfer on this date is already in the anchor, count starts after."
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
  sales_in AS (
    SELECT s.account_id, COALESCE(SUM(s.amount), 0) AS total
    FROM public.sales s
    LEFT JOIN latest_anchor la ON la.account_id = s.account_id
    WHERE s.account_id IS NOT NULL AND s.sales_status = 'Paid'
      AND (la.as_of_date IS NULL OR s.date > la.as_of_date)
    GROUP BY s.account_id
  ),
  expenses_out AS (
    SELECT e.account_id, COALESCE(SUM(e.amount_etb), 0) AS total
    FROM public.expenses e
    LEFT JOIN latest_anchor la ON la.account_id = e.account_id
    WHERE e.account_id IS NOT NULL AND e.payment_status = true
      AND (la.as_of_date IS NULL OR e.date > la.as_of_date)
    GROUP BY e.account_id
  ),
  advances_out AS (
    SELECT ca.account_used_id AS account_id, COALESCE(SUM(ca.amount_advanced), 0) AS total
    FROM public.cash_advances ca
    LEFT JOIN latest_anchor la ON la.account_id = ca.account_used_id
    WHERE ca.account_used_id IS NOT NULL AND ca.approval_status = 'finance_approved'
      AND (la.as_of_date IS NULL OR ca.date_given > la.as_of_date)
    GROUP BY ca.account_used_id
  ),
  payroll_out AS (
    SELECT p.account_id, COALESCE(SUM(ps.net_amount), 0) AS total
    FROM public.payroll p
    JOIN public.payroll_staff ps ON ps.payroll_id = p.id
    LEFT JOIN latest_anchor la ON la.account_id = p.account_id
    WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid'
      AND (la.as_of_date IS NULL OR p.end_date > la.as_of_date)
    GROUP BY p.account_id
  ),
  vrf_out AS (
    SELECT v.initial_account_id AS account_id, COALESCE(SUM(v.amount_transferred), 0) AS total
    FROM public.vendor_receipt_facilitation v
    LEFT JOIN latest_anchor la ON la.account_id = v.initial_account_id
    WHERE v.initial_account_id IS NOT NULL
      AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
    GROUP BY v.initial_account_id
  ),
  vrf_in AS (
    SELECT v.return_account_id AS account_id, COALESCE(SUM(v.money_returned), 0) AS total
    FROM public.vendor_receipt_facilitation v
    LEFT JOIN latest_anchor la ON la.account_id = v.return_account_id
    WHERE v.return_account_id IS NOT NULL
      AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
    GROUP BY v.return_account_id
  ),
  transfers_in AS (
    SELECT t.to_account_id AS account_id, COALESCE(SUM(t.amount), 0) AS total
    FROM public.transfers t
    LEFT JOIN latest_anchor la ON la.account_id = t.to_account_id
    WHERE t.to_account_id IS NOT NULL
      AND (
        la.as_of_date IS NULL
        OR t.date > la.as_of_date
        OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
      )
    GROUP BY t.to_account_id
  ),
  transfers_out AS (
    SELECT t.from_account_id AS account_id, COALESCE(SUM(t.amount), 0) AS total
    FROM public.transfers t
    LEFT JOIN latest_anchor la ON la.account_id = t.from_account_id
    WHERE t.from_account_id IS NOT NULL
      AND (
        la.as_of_date IS NULL
        OR t.date > la.as_of_date
        OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
      )
    GROUP BY t.from_account_id
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

-- ── Same fix, same-shape function (131) ─────────────────────────────
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
      GROUP BY e.account_id
    ),
    advances_out AS (
      SELECT ca.account_used_id AS account_id, COALESCE(SUM(ca.amount_advanced), 0) AS total
      FROM public.cash_advances ca
      LEFT JOIN latest_anchor la ON la.account_id = ca.account_used_id
      WHERE ca.account_used_id IS NOT NULL AND ca.approval_status = 'finance_approved'
        AND ca.date_given <= p_cutoff
        AND (la.as_of_date IS NULL OR ca.date_given > la.as_of_date)
      GROUP BY ca.account_used_id
    ),
    payroll_out AS (
      SELECT p.account_id, COALESCE(SUM(ps.net_amount), 0) AS total
      FROM public.payroll p
      JOIN public.payroll_staff ps ON ps.payroll_id = p.id
      LEFT JOIN latest_anchor la ON la.account_id = p.account_id
      WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid'
        AND p.end_date <= p_cutoff
        AND (la.as_of_date IS NULL OR p.end_date > la.as_of_date)
      GROUP BY p.account_id
    ),
    vrf_out AS (
      SELECT v.initial_account_id AS account_id, COALESCE(SUM(v.amount_transferred), 0) AS total
      FROM public.vendor_receipt_facilitation v
      LEFT JOIN latest_anchor la ON la.account_id = v.initial_account_id
      WHERE v.initial_account_id IS NOT NULL
        AND v.trxn_date <= p_cutoff
        AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
      GROUP BY v.initial_account_id
    ),
    vrf_in AS (
      SELECT v.return_account_id AS account_id, COALESCE(SUM(v.money_returned), 0) AS total
      FROM public.vendor_receipt_facilitation v
      LEFT JOIN latest_anchor la ON la.account_id = v.return_account_id
      WHERE v.return_account_id IS NOT NULL
        AND v.trxn_date <= p_cutoff
        AND (la.as_of_date IS NULL OR v.trxn_date > la.as_of_date)
      GROUP BY v.return_account_id
    ),
    transfers_in AS (
      SELECT t.to_account_id AS account_id, COALESCE(SUM(t.amount), 0) AS total
      FROM public.transfers t
      LEFT JOIN latest_anchor la ON la.account_id = t.to_account_id
      WHERE t.to_account_id IS NOT NULL AND t.date <= p_cutoff
        AND (
          la.as_of_date IS NULL
          OR t.date > la.as_of_date
          OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
        )
      GROUP BY t.to_account_id
    ),
    transfers_out AS (
      SELECT t.from_account_id AS account_id, COALESCE(SUM(t.amount), 0) AS total
      FROM public.transfers t
      LEFT JOIN latest_anchor la ON la.account_id = t.from_account_id
      WHERE t.from_account_id IS NOT NULL AND t.date <= p_cutoff
        AND (
          la.as_of_date IS NULL
          OR t.date > la.as_of_date
          OR (t.date = la.as_of_date AND la.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la.transfer_id)
        )
      GROUP BY t.from_account_id
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

-- ── The new anchor itself ────────────────────────────────────────────
INSERT INTO bank_balance_anchors (account_id, as_of_date, balance, source, transfer_id)
SELECT
  '890c3473-dc57-4c01-9f39-17518047c463', -- CBE, 1000504664272
  '2026-07-07',
  5108807.22,
  'User-provided FY2026/27 opening balance for CBE (as of fiscal year start, 2026-07-08) — supersedes the FY2025/26 anchor for all live balance computation; that earlier anchor is untouched as the historical record.',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM bank_balance_anchors WHERE account_id = '890c3473-dc57-4c01-9f39-17518047c463' AND as_of_date = '2026-07-07'
);

-- Verify: CBE's live balance now anchors off the FY2026/27 opening
-- figure, not the older FY2025/26 one.
SELECT id, account_name, opening_balance, opening_balance_as_of, balance
FROM v_account_balances WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';
SELECT account_id, as_of_date, balance, transfer_id FROM bank_balance_anchors
WHERE account_id = '890c3473-dc57-4c01-9f39-17518047c463' ORDER BY as_of_date;
