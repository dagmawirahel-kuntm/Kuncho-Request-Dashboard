-- 297 — drop the "Workshop salary" label from the Zemen accounts
--
-- 294's backfill stamped that label on every account at ZMNBNK, inferred from
-- the title of the sheet they came from ("Wshop Salary through zemen bank").
-- The inference does not hold: the sheet is what the workshop payroll was
-- paid through, not a statement about each account. Several of the 22 are not
-- workshop people at all — Betelehem Sime and Mahlet Tsegaye are Office
-- designers — so the label described them wrongly on their own record.
--
-- The bank and the number are the facts here. Removed rather than corrected,
-- because there is no per-person label anyone actually asserted.
--
-- The 14 "Superseded by the Zemen workshop salary account" labels are left:
-- those describe an event that did happen to that specific account.

UPDATE staff_bank_accounts
   SET label = NULL
 WHERE label = 'Workshop salary';
