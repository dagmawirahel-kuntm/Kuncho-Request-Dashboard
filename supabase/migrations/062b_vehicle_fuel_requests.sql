-- Migration 062b: Fuel requests
-- Run 062a_fuel_expense_type_enum.sql FIRST (separate transaction — Postgres
-- won't let a freshly added enum value be used until committed).
--
-- Fleet managers set a vehicle's full-tank capacity once; requesting fuel
-- for that vehicle creates a real expense (expense_type = 'fuel') tagged
-- with the vehicle and the liters requested, so it flows through the same
-- approval/payment ledger as every other expense instead of a parallel
-- system. Only fleet managers (admin/manager/logistics_officer, or the
-- is_logistics_officer badge) may submit or edit a fuel-typed expense —
-- enforced here at the trigger level so it holds regardless of which of
-- the many existing expense-insert policies would otherwise allow it.

SET search_path TO public;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_tank_liters NUMERIC;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS vehicle_id  UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fuel_liters NUMERIC;

-- Only gates the moment a row becomes a fuel expense (a fresh INSERT, or an
-- UPDATE that reclassifies an existing row into 'fuel') — NOT every later
-- update, so finance's normal approve/reject/pay actions on an
-- already-fuel-tagged expense are unaffected.
CREATE OR REPLACE FUNCTION enforce_fuel_expense_requester()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expense_type = 'fuel' AND (TG_OP = 'INSERT' OR OLD.expense_type IS DISTINCT FROM 'fuel') THEN
    IF get_user_role() NOT IN ('admin', 'manager', 'logistics_officer')
       AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_logistics_officer = true) THEN
      RAISE EXCEPTION 'Only fleet managers can submit a fuel request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_fuel_expense_requester ON expenses;
CREATE TRIGGER trg_enforce_fuel_expense_requester
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION enforce_fuel_expense_requester();
