-- ============================================================
-- Reporting lines as real data, hybrid department membership, and
-- leave routed down the reporting line.
--
-- Confirmed real state before writing (several points differ from the
-- brief this implements, and the differences matter):
--
--   • staff.reports_to_id is populated for 0 of 90. Confirmed.
--   • departments.head_staff_id is set for 4 of 8 — but the four ARE
--     Executive, Design, Procurement & Logistics and Business
--     Development/Sales. Finance & Admin has NO head (the brief had it
--     the other way round, listing Finance as set and Sales as
--     missing). The four still to fill are Operations/Construction,
--     Finance & Admin, HR & People and HSE.
--   • Operations/Construction holds 52 of 90 staff and has no head —
--     the single highest-value gap.
--   • 19 of 90 staff have no department_id at all, so for those the
--     manager AND department-head tiers are both empty.
--   • leave_requests is not unused: it holds 1 row (a rejected sick
--     leave) and already has 4 policies — submit-own, read-own,
--     cancel-own, and hr_officer/admin sees all. What is missing is
--     any notion of WHO should decide.
--   • THERE IS NO hr_officer ACCOUNT. Roles held today: admin x2,
--     finance x1, procurement_officer x2, staff x2. So a chain ending
--     at "fall back to HR" ends at nobody, and every request from an
--     unassigned staff member would stall — the exact failure the
--     brief says must not happen. admin is therefore the terminal
--     tier, not HR.
-- ============================================================

SET search_path TO public;

-- ── 1. Reporting lines: reject cycles ────────────────────────────────
-- A null manager stays legal — department heads and Executive
-- legitimately have none. What is rejected is a loop: pointing at
-- yourself, or at anyone who already reports up through you.
--
-- The walk is bounded by a hop counter as well as the loop test. If a
-- cycle somehow already exists in the data, an unbounded walk would
-- spin forever inside the trigger rather than raising; the counter
-- turns that into a loud failure instead of a hang.
CREATE OR REPLACE FUNCTION enforce_reports_to_acyclic()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE
  v_cursor UUID := NEW.reports_to_id;
  v_hops   INT  := 0;
BEGIN
  IF NEW.reports_to_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.reports_to_id = NEW.id THEN
    RAISE EXCEPTION 'A staff member cannot report to themselves';
  END IF;

  WHILE v_cursor IS NOT NULL LOOP
    v_hops := v_hops + 1;
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'That would create a reporting loop — % already reports up through this person',
        (SELECT employee_name FROM staff WHERE id = NEW.reports_to_id);
    END IF;
    IF v_hops > 50 THEN
      RAISE EXCEPTION 'Reporting chain exceeds 50 levels — the existing data contains a loop and needs fixing first';
    END IF;
    SELECT reports_to_id INTO v_cursor FROM staff WHERE id = v_cursor;
  END LOOP;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enforce_reports_to_acyclic ON staff;
CREATE TRIGGER trg_enforce_reports_to_acyclic
  BEFORE INSERT OR UPDATE OF reports_to_id ON staff
  FOR EACH ROW EXECUTE FUNCTION enforce_reports_to_acyclic();

CREATE INDEX IF NOT EXISTS idx_staff_reports_to ON staff(reports_to_id) WHERE reports_to_id IS NOT NULL;

COMMENT ON COLUMN staff.reports_to_id IS
  'Line manager. Null is legal (department heads, Executive, or anyone reporting outside the modelled structure). Cycles are rejected by trigger. Never inferred — entered by someone who knows the structure.';

-- ── 2. Hybrid membership: secondary departments ──────────────────────
-- Per the confirmed examples: designers who also act as project
-- managers, and Finance staff who effectively run HR. Both are one
-- person genuinely sitting in two departments.
--
-- staff.department_id remains THE primary and is untouched — it keeps
-- driving landing-page routing, the leave fallback below, the org
-- chart and the unassigned count, all of which need exactly one
-- answer. This table only adds "also appears in".
--
-- Deliberately descriptive, never authorising: §4 keeps approval
-- authority on role + amount threshold, so secondary membership of
-- Finance must not let anyone approve a payment. Nothing reads this
-- table for permissions and nothing should.
--
-- Note the third example — operations managers specialised in
-- construction vs woodwork — is NOT this. That is specialisation
-- within one department, already served by staff.sub_team and by
-- rating people against different job descriptions. No junction row
-- needed for it.
CREATE TABLE IF NOT EXISTS staff_department_memberships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_dept_memberships_staff ON staff_department_memberships(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_dept_memberships_dept  ON staff_department_memberships(department_id);

COMMENT ON TABLE staff_department_memberships IS
  'Secondary (hybrid) department membership. staff.department_id remains the primary and is what routes anything. Descriptive only — grants no authority.';

-- A secondary row duplicating the primary is meaningless; block it.
CREATE OR REPLACE FUNCTION reject_duplicate_primary_membership()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM staff WHERE id = NEW.staff_id AND department_id = NEW.department_id) THEN
    RAISE EXCEPTION 'That is already this person''s primary department — a secondary membership would be a duplicate';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reject_duplicate_primary_membership ON staff_department_memberships;
CREATE TRIGGER trg_reject_duplicate_primary_membership
  BEFORE INSERT OR UPDATE ON staff_department_memberships
  FOR EACH ROW EXECUTE FUNCTION reject_duplicate_primary_membership();

ALTER TABLE staff_department_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_department_memberships_read" ON staff_department_memberships;
CREATE POLICY "staff_department_memberships_read" ON staff_department_memberships FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "staff_department_memberships_manage" ON staff_department_memberships;
CREATE POLICY "staff_department_memberships_manage" ON staff_department_memberships FOR ALL
  USING (get_user_role() IN ('admin', 'hr_officer'))
  WITH CHECK (get_user_role() IN ('admin', 'hr_officer'));

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_department_memberships TO authenticated;

-- ── 3. Every department a person belongs to, primary or not ──────────
CREATE OR REPLACE VIEW v_staff_departments
WITH (security_invoker = true) AS
SELECT s.id AS staff_id, s.employee_name, d.id AS department_id, d.name AS department_name,
       TRUE AS is_primary, NULL::text AS note
FROM staff s JOIN departments d ON d.id = s.department_id
UNION ALL
SELECT s.id, s.employee_name, d.id, d.name, FALSE, m.note
FROM staff_department_memberships m
JOIN staff s ON s.id = m.staff_id
JOIN departments d ON d.id = m.department_id;

GRANT SELECT ON v_staff_departments TO authenticated;

-- ── 4. Who decides a leave request ───────────────────────────────────
-- Returns the user_profiles id of whoever should approve, walking the
-- line manager first because that is the one case where the reporting
-- line genuinely is a better router than a role lookup.
--
-- Each tier requires a LINKED LOGIN, not just a staff row: a manager
-- who cannot sign in cannot approve, so the resolver falls through to
-- the next tier rather than routing into a dead end.
--
-- Terminal tier is admin, not HR. There is no hr_officer account in
-- this system today, so an HR-terminated chain would leave requests
-- unassigned — and 19 staff have neither a manager nor a department,
-- which would put a fifth of the roster there immediately.
CREATE OR REPLACE FUNCTION resolve_leave_approver(p_staff_id UUID)
RETURNS TABLE (approver_id UUID, basis TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id UUID;
BEGIN
  -- 1. Line manager
  SELECT mgr.user_id INTO v_id
  FROM staff s JOIN staff mgr ON mgr.id = s.reports_to_id
  WHERE s.id = p_staff_id AND mgr.user_id IS NOT NULL;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'line_manager'; RETURN;
  END IF;

  -- 2. Head of their PRIMARY department (confirmed: primary, always —
  -- deterministic, and does not ask the submitter to choose).
  SELECT head.user_id INTO v_id
  FROM staff s
  JOIN departments d ON d.id = s.department_id
  JOIN staff head ON head.id = d.head_staff_id
  WHERE s.id = p_staff_id AND head.user_id IS NOT NULL AND head.id <> p_staff_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'department_head'; RETURN;
  END IF;

  -- 3. Any HR officer
  SELECT id INTO v_id FROM user_profiles
  WHERE role = 'hr_officer' AND account_status = 'active' ORDER BY full_name LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'hr_officer'; RETURN;
  END IF;

  -- 4. Any admin — the terminal tier, so routing can never come back empty
  SELECT id INTO v_id FROM user_profiles
  WHERE role = 'admin' AND account_status = 'active' ORDER BY full_name LIMIT 1;
  RETURN QUERY SELECT v_id, CASE WHEN v_id IS NULL THEN 'unresolved' ELSE 'admin' END;
END;
$fn$;

GRANT EXECUTE ON FUNCTION resolve_leave_approver(UUID) TO authenticated;

-- ── 5. Route each request as it is submitted ─────────────────────────
-- Stored, not computed on read: who should have decided is a fact about
-- the moment of submission. Recomputing later would silently re-route
-- historical requests every time somebody's manager changes.
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS assigned_approver_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_basis        TEXT;

CREATE INDEX IF NOT EXISTS idx_leave_requests_approver
  ON leave_requests(assigned_approver_id) WHERE assigned_approver_id IS NOT NULL;

COMMENT ON COLUMN leave_requests.routing_basis IS
  'Which tier resolved the approver: line_manager, department_head, hr_officer or admin. Recorded so a surprising routing can be explained without re-deriving it.';

CREATE OR REPLACE FUNCTION route_leave_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_approver UUID;
  v_basis    TEXT;
BEGIN
  IF NEW.assigned_approver_id IS NULL THEN
    SELECT approver_id, basis INTO v_approver, v_basis FROM resolve_leave_approver(NEW.staff_id);
    NEW.assigned_approver_id := v_approver;
    NEW.routing_basis := v_basis;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_route_leave_request ON leave_requests;
CREATE TRIGGER trg_route_leave_request
  BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION route_leave_request();

-- Backfill the one existing row so nothing is left unrouted.
-- Correlated subqueries rather than FROM LATERAL: an UPDATE's FROM
-- clause cannot reference the target table's own alias, so the lateral
-- form is rejected outright (42P10).
UPDATE leave_requests lr
SET assigned_approver_id = (SELECT approver_id FROM resolve_leave_approver(lr.staff_id)),
    routing_basis        = (SELECT basis       FROM resolve_leave_approver(lr.staff_id))
WHERE lr.assigned_approver_id IS NULL;

-- ── 6. The assigned approver can see and decide it ───────────────────
-- Additive. The four existing policies are untouched: submit-own,
-- read-own, cancel-own, and hr_officer/admin-sees-all all still stand,
-- which is what keeps HR's full visibility (§2: routing changes who
-- decides, not who can see).
DROP POLICY IF EXISTS "leave_requests_approver_select" ON leave_requests;
CREATE POLICY "leave_requests_approver_select" ON leave_requests FOR SELECT
  USING (assigned_approver_id = auth.uid());

DROP POLICY IF EXISTS "leave_requests_approver_decide" ON leave_requests;
CREATE POLICY "leave_requests_approver_decide" ON leave_requests FOR UPDATE
  USING (assigned_approver_id = auth.uid() AND status = 'pending')
  WITH CHECK (assigned_approver_id = auth.uid() AND status IN ('approved', 'rejected'));

-- Stamp the decision server-side rather than trusting the client.
CREATE OR REPLACE FUNCTION stamp_leave_decision()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.approved_by := auth.uid();
    NEW.approved_at := NOW();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stamp_leave_decision ON leave_requests;
CREATE TRIGGER trg_stamp_leave_decision
  BEFORE UPDATE OF status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION stamp_leave_decision();

-- ── 7. Passive visibility: gaps that would otherwise accumulate ──────
-- Same pattern as the unassigned-staff count already on StaffPage — a
-- number someone sees, rather than a report nobody runs.
CREATE OR REPLACE VIEW v_org_structure_gaps
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM staff WHERE status = 'active' AND reports_to_id IS NULL)   AS staff_without_manager,
  (SELECT count(*) FROM staff WHERE status = 'active' AND department_id IS NULL)   AS staff_without_department,
  (SELECT count(*) FROM departments WHERE active AND head_staff_id IS NULL)        AS departments_without_head,
  (SELECT count(*) FROM staff WHERE status = 'active' AND user_id IS NULL)         AS staff_without_login;

GRANT SELECT ON v_org_structure_gaps TO authenticated;

-- ── Verify ───────────────────────────────────────────────────────────
SELECT * FROM v_org_structure_gaps;

SELECT routing_basis, count(*) FROM leave_requests GROUP BY routing_basis;

SELECT proname FROM pg_proc
WHERE proname IN ('enforce_reports_to_acyclic', 'resolve_leave_approver', 'route_leave_request', 'stamp_leave_decision')
ORDER BY proname;

SELECT tgname FROM pg_trigger
WHERE tgname IN ('trg_enforce_reports_to_acyclic', 'trg_route_leave_request', 'trg_stamp_leave_decision')
ORDER BY tgname;
