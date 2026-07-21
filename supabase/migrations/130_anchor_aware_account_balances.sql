-- ============================================================
-- v_account_balances: use bank_balance_anchors as a floor, not an
-- all-time sum from zero.
--
-- Root cause of the CBE balance not matching the real bank statement:
-- v_account_balances (migration 058, read by AccountDetailPage and
-- AccountsPage) summed every paid sale/expense/payroll/advance/VRF/
-- transfer ever tagged to an account, starting from zero, with no
-- concept of "the bank told us the real balance was X as of date Y."
-- bank_balance_anchors (migration 106) was built to be exactly that
-- correction, but nothing ever read from it — the view kept computing
-- from zero regardless of whether an anchor existed. Migration 129 just
-- populated the CBE anchor for real (2025-07-07, 66717.56 ETB); this
-- migration is what makes any anchor actually change the number shown.
--
-- For an account with an anchor: balance = anchor.balance + every flow
-- dated after the anchor's as_of_date (not before — those are already
-- baked into the bank-reported anchor figure and would be double
-- counted otherwise). "After" is `date > as_of_date` for every source
-- table EXCEPT transfers, where it's `date > as_of_date OR (date =
-- as_of_date AND id <> anchor.transfer_id)` — the anchor's own as_of_date
-- can (and for CBE, does) have other real same-day transfers after the
-- anchor transaction itself; only the exact anchor transfer is excluded,
-- not its whole calendar day.
--
-- For an account with no anchor row at all, la.as_of_date is NULL and
-- every "later than anchor" condition below short-circuits to TRUE via
-- `la.as_of_date IS NULL OR ...` — behavior is byte-for-byte identical
-- to migration 058's all-time sum. No regression for Awash or any other
-- account without an anchor.
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
        OR (t.date = la.as_of_date AND t.id IS DISTINCT FROM la.transfer_id)
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
        OR (t.date = la.as_of_date AND t.id IS DISTINCT FROM la.transfer_id)
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

-- Verify: CBE should now show a positive opening_balance and a balance
-- that reflects only post-anchor activity, not an all-time sum from 0.
SELECT id, account_name, opening_balance, opening_balance_as_of, balance
FROM v_account_balances
WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';
