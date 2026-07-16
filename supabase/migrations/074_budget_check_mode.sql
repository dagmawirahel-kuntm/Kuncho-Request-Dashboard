-- ============================================================
-- Phase 2 point-of-spend checks ship in warn-only mode by decision:
-- Phase 1's Actual/Committed numbers haven't been hand-verified
-- against a real project yet, so nothing should actually block a
-- PR/PO based on them. This is the toggle for that — a single-row
-- settings table rather than hiding the mode inside a migration, per
-- the explicit "should not be invisible" requirement. No UI to flip
-- it yet; that's a deliberate SQL-only interim step until a real
-- project's numbers are confirmed by hand.
--
-- IMPORTANT: nothing in this pass actually reads `enforcing = true`
-- to change behavior — there is no enforcing code path built yet at
-- all (by decision: "don't build any enforcing path as reachable in
-- this pass"). This table exists now so the switch is visible and
-- ready; flipping it currently does nothing until a future migration
-- wires up the enforcing branch.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS budget_check_mode (
  id         BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true), -- singleton row
  enforcing  BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES user_profiles(id)
);

INSERT INTO budget_check_mode (id, enforcing) VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE budget_check_mode ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budget_check_mode_read" ON budget_check_mode;
CREATE POLICY "budget_check_mode_read" ON budget_check_mode FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "budget_check_mode_admin_write" ON budget_check_mode;
CREATE POLICY "budget_check_mode_admin_write" ON budget_check_mode FOR UPDATE
  USING (get_user_role() = 'admin');

GRANT SELECT ON budget_check_mode TO authenticated;
GRANT UPDATE ON budget_check_mode TO authenticated;

-- Verify
SELECT * FROM budget_check_mode;
