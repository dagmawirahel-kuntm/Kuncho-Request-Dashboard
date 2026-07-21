-- ============================================================
-- account_balances_asof(): bring it in sync with v_account_balances
-- (migration 130) and with what the transfers table now actually holds
-- after the 2025H2 backfill (migration 129).
--
-- Two gaps, both on the same function (powers BalanceSheetPage's "as of"
-- report):
--
-- 1. It never got the anchor-floor treatment migration 130 gave
--    v_account_balances. It still sums sales/expenses/transfers/payroll
--    from zero up to p_cutoff — for CBE, any "as of" date between
--    2025-07-07 and today now disagrees with the anchor-aware current
--    balance shown on AccountDetailPage for the exact same account, by
--    exactly the anchor's opening amount (66717.56). Same fix as 130:
--    start from the anchor (if its as_of_date falls on/before p_cutoff)
--    and only sum activity dated after the anchor and on/before p_cutoff;
--    same same-day transfer exclusion for the anchor's own row.
--
-- 2. It's also stale against 058's VRF/payroll additions to
--    v_account_balances — vendor_receipt_facilitation cash movement was
--    never added here, so "as of" and "current" have disagreed on any
--    account with VRF activity regardless of the anchor question. Fixed
--    in the same pass since it's the same RETURNS TABLE being rebuilt.
--
-- AR/AP/retained-earnings (ar_total_asof, ap_by_category_asof,
-- retained_earnings_asof) are untouched — they're sales/expenses
-- recognition, not account-balance reconstruction, and have no anchor
-- concept to apply.
-- ============================================================

SET search_path TO public;

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
          OR (t.date = la.as_of_date AND t.id IS DISTINCT FROM la.transfer_id)
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
          OR (t.date = la.as_of_date AND t.id IS DISTINCT FROM la.transfer_id)
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

-- Verify: an as-of date inside the backfilled window should now show the
-- CBE anchor floor plus only post-anchor activity through that date —
-- not an all-time sum, and not diverging from v_account_balances' shape.
SELECT id, account_name, opening_balance, opening_balance_as_of, balance
FROM account_balances_asof('2025-11-29'::date)
WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';
