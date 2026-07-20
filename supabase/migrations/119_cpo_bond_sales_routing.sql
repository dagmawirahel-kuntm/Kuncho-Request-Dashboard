-- ============================================================
-- CPO bonds: let BD/Sales originate the request (spec §8).
--
-- cpo_bonds stays exactly what it was — a Balance Sheet asset (bid
-- guarantee), outside cost groups, outside the ledger changes made
-- elsewhere in this codebase. Only who can *raise the need* changes,
-- not who pays or how it's booked: Finance/PM/manager/admin keep
-- their existing FOR ALL / read policies (049, 080) untouched, so
-- nothing depending on Finance's view breaks. This adds:
--   - opportunity_id: optional link back to the bid that needs the
--     bond (opportunities table, migration 084)
--   - requested_by: who raised it
--   - a 'requested' bond_status value (bond_status is plain TEXT,
--     no CHECK constraint, so no enum migration needed) for a
--     sales-raised bond awaiting Finance to actually process/fund it
--   - RLS: sales may insert/select/update-while-requested only their
--     own requested_by rows — the same "PM-requests/Finance-pays"
--     shape, and the same self-scoped-while-pending pattern as
--     leave_requests_own_cancel (118).
-- ============================================================

SET search_path TO public;

ALTER TABLE cpo_bonds ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id);
ALTER TABLE cpo_bonds ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES user_profiles(id);

CREATE INDEX IF NOT EXISTS idx_cpo_bonds_opportunity ON cpo_bonds(opportunity_id);

DROP POLICY IF EXISTS "raa_cpo_sales_own_select" ON cpo_bonds;
CREATE POLICY "raa_cpo_sales_own_select" ON cpo_bonds
  FOR SELECT
  USING (get_user_role() = 'sales' AND requested_by = auth.uid());

DROP POLICY IF EXISTS "raa_cpo_sales_own_insert" ON cpo_bonds;
CREATE POLICY "raa_cpo_sales_own_insert" ON cpo_bonds
  FOR INSERT
  WITH CHECK (
    get_user_role() = 'sales'
    AND requested_by = auth.uid()
    AND bond_status = 'requested'
  );

-- Sales can correct their own request while Finance hasn't touched it
-- yet; once it moves past 'requested' (Active/Released/Forfeited) it's
-- Finance's record to manage, matching every other request-then-lock
-- pattern in this codebase.
DROP POLICY IF EXISTS "raa_cpo_sales_own_update_while_requested" ON cpo_bonds;
CREATE POLICY "raa_cpo_sales_own_update_while_requested" ON cpo_bonds
  FOR UPDATE
  USING (get_user_role() = 'sales' AND requested_by = auth.uid() AND bond_status = 'requested')
  WITH CHECK (get_user_role() = 'sales' AND requested_by = auth.uid() AND bond_status = 'requested');

-- Verify: cpo_bonds should now show 6 policies total
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'cpo_bonds' ORDER BY policyname;
