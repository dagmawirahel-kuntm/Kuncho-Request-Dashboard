-- ============================================================
-- Authority-matrix consolidation, reconciled against Kuncho
-- Operations Manual v0.1 (July 2026).
--
-- Three changes, each traceable to a specific line of the manual:
--
-- 1. `manager` -> `executive`  (Manual §14, §1, §6)
--    §12's role table enumerates all 12 real roles; `manager` is not
--    among them — it has no mandate, no approval right, no
--    department. Meanwhile §1 defines Executive as the "admin /
--    executive tier", §6 escalates PO(large) and contract signing to
--    "CEO / MD", and §14 asks outright whether `manager` should be
--    renamed to `executive`, noting "a rename is low-risk; a semantic
--    narrowing is a real authority-matrix change."
--
--    So this is the rename, NOT a narrowing. Every policy that
--    granted `manager` now grants `executive` with identical scope.
--    Postgres rewrites the stored policy expressions automatically
--    when the enum label is renamed (verified: 116 policies across
--    ~60 tables update atomically, and `operations_manager` /
--    `project_manager` / `stock_manager` are untouched because they
--    are separate enum labels, not substrings).
--
--    This simultaneously fills the one real hole in the authority
--    matrix: there was no CEO/MD tier in the schema at all. There is
--    now, and it costs no new RBAC surface.
--
-- 2. The PR-level approval is retired as a gate  (Manual §4.1)
--    §4.1's Materials chain is:
--      Need -> stock check -> (if short) sourcing -> PO -> GRN -> expense
--    There is no purchase-request approval step in it. The
--    `orders.approval_status` pending->manager_approved->finance_approved
--    ladder is undocumented, and because `canApproveAsManager()`
--    resolves to `admin || manager` with zero manager holders, its
--    first rung was in practice an ADMIN-ONLY bottleneck on every
--    single purchase request.
--
--    The column and all its historical values are KEPT — same
--    grandfathering discipline as every other legacy-data decision
--    here. It simply stops gating anything; the real gates are the
--    finance sourcing review (147) and the PO approval below.
--
-- 3. Procurement Officer PO cap at ETB 50,000  (Manual §6, §12)
--    Documented twice — §6 "PO (project materials) | Procurement
--    Officer | 50,000 | Operations Manager" and §12 "procurement_officer
--    ... POs to 50,000" — and implemented nowhere. Worse, the blanket
--    `sourcing_bundles_policy` (FOR ALL) let a procurement officer
--    approve a bundle of ANY value via direct API, even though the UI
--    never offered the button. This closes that gap.
--
-- DELIBERATELY NOT DONE: the manual's other four thresholds (petty
-- cash 5,000; supplier payment release 100,000; supplier payment
-- large 1,000,000; project budget approval per-contract) are NOT
-- implemented here. §6 states plainly: "Amounts are illustrative
-- pending final confirmation against Kuncho's real thresholds."
-- Hard-coding provisional figures into RLS would bake guesses into
-- access control. They stay open pending confirmed numbers.
-- ============================================================

SET search_path TO public;

-- ── 1. manager -> executive ─────────────────────────────────────────
-- Idempotent: only renames if the old label is still present, so a
-- re-run (or a database already migrated) is a no-op rather than an
-- error. RENAME VALUE has no same-transaction restriction (unlike
-- ADD VALUE), so this is safe inside a wrapped migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'manager'
  ) THEN
    ALTER TYPE user_role RENAME VALUE 'manager' TO 'executive';
  END IF;
END $$;

-- ── 1b. Decouple finance's read path from the executive tier ────────
-- The policy literally named `manager_read` on both orders and
-- expenses granted ARRAY['manager','finance'] — meaning finance's
-- ONLY read path on those two tables ran through a policy named after
-- a different role. Any future cleanup that removed "the manager
-- policies" would have silently taken finance's access to the Payment
-- Hub, the approvals queue and the expense list with it.
--
-- Split into two independent, accurately-named policies. Net
-- effective access is unchanged; it just can't be removed by accident.
DROP POLICY IF EXISTS "manager_read" ON expenses;
CREATE POLICY "expenses_executive_read" ON expenses FOR SELECT
  USING (get_user_role() = 'executive');
CREATE POLICY "expenses_finance_read" ON expenses FOR SELECT
  USING (get_user_role() = 'finance');

DROP POLICY IF EXISTS "manager_write" ON expenses;
CREATE POLICY "expenses_executive_insert" ON expenses FOR INSERT
  WITH CHECK (get_user_role() = 'executive');

DROP POLICY IF EXISTS "manager_update" ON expenses;
CREATE POLICY "expenses_executive_update" ON expenses FOR UPDATE
  USING (get_user_role() = 'executive');

DROP POLICY IF EXISTS "manager_read" ON orders;
CREATE POLICY "orders_executive_read" ON orders FOR SELECT
  USING (get_user_role() = 'executive');
CREATE POLICY "orders_finance_read" ON orders FOR SELECT
  USING (get_user_role() = 'finance');

DROP POLICY IF EXISTS "manager_write" ON orders;
CREATE POLICY "orders_executive_insert" ON orders FOR INSERT
  WITH CHECK (get_user_role() = 'executive');

DROP POLICY IF EXISTS "manager_approve_orders" ON orders;
CREATE POLICY "orders_executive_update" ON orders FOR UPDATE
  USING (get_user_role() = 'executive');

-- Note: `manager_read`-style names survive on other tables (categories,
-- projects, staff, sales...). After the rename above they correctly
-- grant `executive`; only the name is stale. They are left alone
-- deliberately — renaming ~40 more policies is churn with no access
-- change, and none of them carry the finance-coupling hazard that
-- made the two above worth splitting.

-- ── 2. Retire the PR-level approval as a gate ───────────────────────
-- No data change. The column, the enum, and every historical
-- manager_approved/finance_approved value stay exactly as they are.
COMMENT ON COLUMN orders.approval_status IS
  'RETIRED AS A GATE (migration 149). The Operations Manual v0.1 §4.1 Materials chain contains no purchase-request approval step; the real gates are the finance sourcing review (finance_sourcing_reviews, 147) and the PO approval on sourcing_bundles. Historical values are preserved and still displayed read-only on the PR detail page, but nothing blocks on this column any more. Do not reintroduce it as a gate without updating the manual first.';

-- ── 3. Procurement Officer PO approval capped at ETB 50,000 ─────────
-- The blanket FOR ALL policy is narrowed to the three uncapped roles;
-- procurement_officer gets explicit per-command policies instead, so
-- everything they do today still works EXCEPT approving a bundle
-- above the documented limit.
DROP POLICY IF EXISTS sourcing_bundles_policy ON sourcing_bundles;
CREATE POLICY sourcing_bundles_policy ON sourcing_bundles
  USING (get_user_role() IN ('admin', 'executive', 'finance'));

DROP POLICY IF EXISTS "procurement_select_bundles" ON sourcing_bundles;
CREATE POLICY "procurement_select_bundles" ON sourcing_bundles FOR SELECT
  USING (get_user_role() = 'procurement_officer');

DROP POLICY IF EXISTS "procurement_insert_bundles" ON sourcing_bundles;
CREATE POLICY "procurement_insert_bundles" ON sourcing_bundles FOR INSERT
  WITH CHECK (get_user_role() = 'procurement_officer');

-- The cap itself. Drafting, submitting, marking ordered, editing —
-- all unaffected at any value. Only landing the row in `approved`
-- above 50,000 is refused, mirroring 133's ops_manager cap at 500,000.
DROP POLICY IF EXISTS "procurement_update_bundles" ON sourcing_bundles;
CREATE POLICY "procurement_update_bundles" ON sourcing_bundles FOR UPDATE
  USING (get_user_role() = 'procurement_officer')
  WITH CHECK (
    get_user_role() = 'procurement_officer'
    AND NOT (status = 'approved' AND COALESCE(total_value, 0) > 50000)
  );

DROP POLICY IF EXISTS "procurement_delete_bundles" ON sourcing_bundles;
CREATE POLICY "procurement_delete_bundles" ON sourcing_bundles FOR DELETE
  USING (get_user_role() = 'procurement_officer');

-- Verify
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'user_role' ORDER BY e.enumsortorder;
SELECT count(*) AS policies_still_referencing_manager FROM pg_policies
WHERE COALESCE(qual,'')||COALESCE(with_check,'') LIKE '%''manager''::user_role%';
SELECT policyname, cmd FROM pg_policies WHERE tablename='sourcing_bundles' ORDER BY cmd, policyname;
