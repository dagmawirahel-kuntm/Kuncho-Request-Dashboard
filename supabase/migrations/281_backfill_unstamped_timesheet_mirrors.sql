-- 281 — backfill the 370 timesheet rows that were paid but never stamped
--
-- Migration 279 fixed the rollup going forward: the per-day branch no longer
-- skips rows without clock times, so both mirrors get stamped from now on.
-- It could not repair what was already broken. 370 timesheet rows across six
-- projects are days that WERE paid — their timesheet_attendance twin carries
-- the expense id — but whose timesheet row still reads rolled_up_expense_id
-- IS NULL. They look like unpaid work, and a rollup over any window not
-- byte-identical to the one that paid them would pay them a second time.
--
-- Each row is stamped with the expense that paid its twin. The twin is
-- matched on (staff_id, work_date, project_id), preferring a twin filed
-- under the same requisition when one exists. That preference matters in
-- exactly one place on live data: Besufekad Fikru worked 24 Aug 2026 on
-- Mesob Kitchen under two requisitions at once (MESO-LABO-20260830-13 for
-- 3,000 and -14 for 2,000). Both his timesheet rows would otherwise have
-- been stamped to whichever twin sorted first; with the preference each
-- lands on its own requisition's expense.
--
-- Checked against live data before applying — all 370 rows:
--   * have a paid attendance twin (none is genuinely unpaid work)
--   * take an expense on the same project
--   * fall inside that expense's rollup_period_start..end
--   * name a worker who appears in that expense's labor_expense_workers
--
-- No money moves. This writes one foreign key on already-paid attendance
-- rows; no expense, batch or ledger row is touched. The assertion below
-- fails the whole migration if the count is not exactly 370.

DO $$
DECLARE
  v_stamped int;
BEGIN
  WITH pick AS (
    SELECT ts.id AS ts_id, tw.rolled_up_expense_id AS exp_id
    FROM timesheet ts
    CROSS JOIN LATERAL (
      SELECT att.rolled_up_expense_id, att.labor_requisition_id
      FROM timesheet_attendance att
      WHERE att.staff_id   = ts.staff_id
        AND att.work_date  = ts.date
        AND att.project_id = ts.project_id
        AND att.rolled_up_expense_id IS NOT NULL
      ORDER BY (att.labor_requisition_id = ts.labor_requisition_id) DESC, att.id
      LIMIT 1
    ) tw
    WHERE ts.rolled_up_expense_id IS NULL
  )
  UPDATE timesheet ts
     SET rolled_up_expense_id = pick.exp_id
    FROM pick
   WHERE ts.id = pick.ts_id;

  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  IF v_stamped <> 370 THEN
    RAISE EXCEPTION 'Expected to stamp 370 timesheet rows, stamped % — aborting', v_stamped;
  END IF;
END $$;
