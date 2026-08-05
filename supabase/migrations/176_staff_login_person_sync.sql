-- 176 — user_profiles as the person; staff as its branches
--
-- Confirmed design: user_profiles stays reserved for people who actually have
-- app access (the login/identity). staff.user_id (already in the schema, mostly
-- unused) is the anchor: a staff row is a "branch" — one role/assignment — under
-- a person. One login can have multiple staff branches (concurrent roles); no
-- uniqueness constraint on staff.user_id by design.
--
-- One-time backfill, by exact email match only (never guessed by name — that's
-- exactly how the previous wrong link happened): staff "Dagmawi Fitsum" was
-- linked to the login "thechachi331", but their real email matches the login
-- literally named "Dagmawi Fitsum". Fixed, plus four new correct links found
-- the same way (Anteneh Haile, Biruk Shiferaw, Kaleb Endalkachew, Sileshi Girma).

UPDATE staff SET user_id = '71147969-86d5-48f0-a976-71a2a5456643'
WHERE id = '04b42109-a0c4-4c09-bffc-95c0a8e5cfcb'; -- Dagmawi Fitsum: was wrongly -> thechachi331

UPDATE staff SET user_id = 'c326bec7-ffe1-4432-bca7-05d53bfbfb7d' WHERE id = 'b7a05b32-3f81-48a2-8c8b-b5b839dbf8ad'; -- Anteneh Haile -> thechachi331
UPDATE staff SET user_id = 'ccead481-9b7a-4bd4-a4a3-9aaf93d30d04' WHERE id = '1616c1fa-54e7-4996-836d-d1c7c2f87e21'; -- Biruk Shiferaw (Driver) -> Biruk sheferaw
UPDATE staff SET user_id = '28728079-e045-4e84-80f0-115dda1e23c4' WHERE id = 'f56ac6fb-085d-40ba-8790-7f0701992e07'; -- Kaleb Endalkachew (Driver) -> Kaleb endalk
UPDATE staff SET user_id = '194a6035-a98f-435a-9db8-894248dc97c9' WHERE id = '035c7d71-db66-4df5-9bbb-b4aa83225e1c'; -- Sileshi Girma (Driver) -> Sleshi girma

-- One row per staff branch, with its login's identity/system-role/badges — the
-- join every staff-facing page needs instead of matching by name.
CREATE OR REPLACE VIEW v_staff_with_login
WITH (security_invoker = true) AS
SELECT
  s.id AS staff_id, s.employee_name, s.role AS staff_role, s.staff_type, s.status AS staff_status,
  s.department_id, s.email AS staff_email,
  s.user_id,
  up.full_name AS login_name, up.email AS login_email, up.role AS system_role,
  up.account_status AS login_status,
  up.is_vrf_manager, up.is_tax_officer, up.is_logistics_officer, up.is_ride_hailing_authorized
FROM staff s
LEFT JOIN user_profiles up ON up.id = s.user_id;
GRANT SELECT ON v_staff_with_login TO authenticated;

-- One row per login (the "bigger picture"), with all its staff branches
-- aggregated — for "this person holds N roles" reporting.
CREATE OR REPLACE VIEW v_person_branches
WITH (security_invoker = true) AS
SELECT
  up.id AS user_id, up.full_name, up.email, up.role AS system_role, up.account_status,
  up.is_vrf_manager, up.is_tax_officer, up.is_logistics_officer, up.is_ride_hailing_authorized,
  COUNT(s.id) AS branch_count,
  COALESCE(
    jsonb_agg(
      jsonb_build_object('staff_id', s.id, 'employee_name', s.employee_name, 'staff_role', s.role, 'staff_type', s.staff_type, 'status', s.status)
      ORDER BY s.role
    ) FILTER (WHERE s.id IS NOT NULL),
    '[]'::jsonb
  ) AS branches
FROM user_profiles up
LEFT JOIN staff s ON s.user_id = up.id
GROUP BY up.id, up.full_name, up.email, up.role, up.account_status, up.is_vrf_manager, up.is_tax_officer, up.is_logistics_officer, up.is_ride_hailing_authorized;
GRANT SELECT ON v_person_branches TO authenticated;
