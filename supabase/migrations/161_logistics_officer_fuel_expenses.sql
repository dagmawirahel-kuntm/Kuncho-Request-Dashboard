-- ============================================================
-- logistics_officer can file fuel expenses. Reported by Biruk
-- (logistics_officer): the Fuel Request form is reachable by the role
-- but every INSERT policy on expenses omits logistics_officer, so the
-- write was rejected by RLS after the form was filled in.
--
-- Scoped to expense_type = 'fuel' rather than a blanket grant,
-- per user decision: this is the demonstrated need (the fuel request
-- form is the only expense-creation surface this role uses today),
-- and a narrow grant is easy to widen later — the reverse is not true.
-- Matches the fuel-request payload exactly (FuelRequestFormPage always
-- sets expense_type: 'fuel'), so no legitimate fuel submission is
-- blocked by the added condition.
-- ============================================================

SET search_path TO public;

DROP POLICY IF EXISTS "logistics_officer_insert_fuel_expenses" ON expenses;
CREATE POLICY "logistics_officer_insert_fuel_expenses" ON expenses FOR INSERT
  WITH CHECK (get_user_role() = 'logistics_officer' AND expense_type = 'fuel');

-- ── Verify ──────────────────────────────────────────────────────────
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'expenses' AND policyname = 'logistics_officer_insert_fuel_expenses';
