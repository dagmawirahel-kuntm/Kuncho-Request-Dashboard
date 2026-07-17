-- ============================================================
-- Frozen, read-only audit snapshot of every fiscal-tagged
-- transactional table as it stood at FY2025/26 close (7 July 2026,
-- end of day, Ethiopia time = 2026-07-07 23:59:59+03).
--
-- KNOWN LIMITATION -- read before relying on this for an audit
-- question: this snapshot is being taken on the day this migration
-- runs, which is AFTER 7 July 2026, not live at the actual cutover
-- moment. It filters each source table to rows with
-- created_at <= '2026-07-07 23:59:59+03' -- i.e. it can prove a row
-- EXISTED by close of FY2025/26. It CANNOT prove a row was UNEDITED
-- since then: if a row created before the cutover was later modified
-- (e.g. a correction made between 8-17 July 2026), this snapshot
-- captures its value at snapshot time, not its value as of 7 July,
-- because there is no field-level audit-history table in this schema
-- to reconstruct pre-edit values retroactively. This is documented
-- via COMMENT ON TABLE on every frozen table below so it's visible to
-- anyone querying these later, not just to someone who reads this
-- migration file.
--
-- This is intentionally separate from fiscal_period_id (088), which
-- keeps evolving as legitimate bookkeeping corrections happen -- a
-- June 2026 expense corrected in September 2026 stays tagged
-- FY2025/26 in the live table. This frozen copy is what proves what
-- the number was before that kind of correction, to the extent the
-- limitation above allows.
--
-- Same-schema copies (CREATE TABLE ... AS SELECT * FROM ...), not the
-- expenses_dedup_backup shape (that one is an unrelated flat no-FK
-- snapshot from an earlier dedup fix -- left alone entirely). Each
-- frozen table gets its own primary key for queryability, but
-- deliberately NO foreign keys back to the live tables -- a frozen
-- row must never be blocked, cascaded, or altered by something that
-- later happens to the live data it once referenced.
--
-- Immutability is enforced two ways: RLS is enabled with a SELECT-only
-- policy (no INSERT/UPDATE/DELETE policy exists at all, so even a
-- write attempt that somehow reached the table is denied), AND the
-- INSERT/UPDATE/DELETE grants themselves are revoked from
-- authenticated/anon so there is no write path through the API
-- regardless of RLS. Only a superuser/migration could ever write to
-- these tables again, and no migration ever should.
-- ============================================================

SET search_path TO public;

DO $$
DECLARE
  cutover CONSTANT TIMESTAMPTZ := '2026-07-07 23:59:59+03';
  caveat CONSTANT TEXT := 'FY2025/26 close-of-day (7 Jul 2026) audit snapshot, filtered by created_at <= cutover. '
    || 'LIMITATION: taken retroactively on the day this migration ran (after the cutover), so it proves a row '
    || 'EXISTED by close of FY2025/26 but cannot prove it was unedited since -- a row corrected between 8-17 Jul 2026 '
    || 'shows its edited value here, not its 7-Jul value, since no field-level audit history exists to reconstruct it. '
    || 'Immutable from creation: RLS SELECT-only, no write grants.';
  tbl TEXT;
  src TEXT;
  date_col TEXT;
BEGIN
  FOR src, date_col IN
    SELECT * FROM (VALUES
      ('expenses', 'date'),
      ('sales', 'date'),
      ('payroll', 'start_date'),
      ('timesheet', 'date'),
      ('transfers', 'date'),
      ('cash_advances', 'date_given'),
      ('transportation_requests', 'requested_date'),
      ('orders', 'order_date'),
      ('emergency_payroll_summary', 'payment_date'),
      ('contracts', 'signed_date'),
      ('leave_requests', 'start_date'),
      ('performance_reviews', 'review_date'),
      ('disciplinary_records', 'incident_date'),
      ('hse_incidents', 'incident_date'),
      ('hse_inductions', 'induction_date')
    ) AS t(src, date_col)
  LOOP
    tbl := src || '_fy2025_26_frozen';

    EXECUTE format('DROP TABLE IF EXISTS %I', tbl);
    EXECUTE format('CREATE TABLE %I AS SELECT * FROM %I WHERE created_at <= %L', tbl, src, cutover);
    EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (id)', tbl);
    EXECUTE format('COMMENT ON TABLE %I IS %L', tbl, caveat);

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_read" ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_read" ON %I FOR SELECT USING (get_user_role() IN (''admin'', ''manager'', ''finance''))',
      tbl, tbl
    );

    -- No write policy is created at all -- combined with revoking the
    -- grants below, there is no path to INSERT/UPDATE/DELETE these
    -- tables through the API.
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM authenticated, anon', tbl);
  END LOOP;
END $$;

-- Verify: row counts per frozen table, and confirm the cutover filter
-- actually excluded something for at least one table with recent
-- activity (if this returns 0 excluded everywhere, the filter isn't
-- doing anything -- worth a second look).
SELECT
  'expenses' AS t,
  (SELECT count(*) FROM expenses) AS live_count,
  (SELECT count(*) FROM expenses_fy2025_26_frozen) AS frozen_count
UNION ALL
SELECT 'sales', (SELECT count(*) FROM sales), (SELECT count(*) FROM sales_fy2025_26_frozen)
UNION ALL
SELECT 'transfers', (SELECT count(*) FROM transfers), (SELECT count(*) FROM transfers_fy2025_26_frozen)
UNION ALL
SELECT 'orders', (SELECT count(*) FROM orders), (SELECT count(*) FROM orders_fy2025_26_frozen);

-- Verify: no write grants remain on any frozen table for API roles
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name LIKE '%_fy2025_26_frozen'
  AND grantee IN ('authenticated', 'anon')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
ORDER BY table_name, grantee, privilege_type;
