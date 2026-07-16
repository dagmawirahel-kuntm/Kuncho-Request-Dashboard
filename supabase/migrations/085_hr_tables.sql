-- ============================================================
-- HR & People department tables. Only the `staff` roster exists
-- today; the department's mandate covers five more things this adds
-- tables for: leave, performance, onboarding, and discipline.
--
-- Three of these four hold personal data about named staff and are
-- deliberately locked down tighter than the rest of this batch:
-- leave_requests, performance_reviews, and disciplinary_records are
-- readable and writable ONLY by hr_officer/admin — no broad
-- authenticated-read policy, unlike every other table in this
-- migration set (design_*, contracts, opportunities, hse_*,
-- onboarding_tasks). disciplinary_records in particular is flagged
-- SENSITIVE in the source spec.
--
-- Requires migration 081 (adds the `hr_officer` role, already
-- existed pre-081 actually — hr_officer is one of the original 9
-- roles from migration 002) — no enum dependency blocks this file,
-- but it's still sequenced after 082 (departments) for consistency.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS leave_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      UUID NOT NULL REFERENCES staff(id),
  leave_type    TEXT NOT NULL
                CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'maternity', 'compassionate', 'other')),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  days          NUMERIC(5,1),
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by   UUID REFERENCES user_profiles(id),
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_staff ON leave_requests(staff_id);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id          UUID NOT NULL REFERENCES staff(id),
  review_period     TEXT,
  reviewer_staff_id UUID REFERENCES staff(id),
  overall_rating    TEXT,
  strengths         TEXT,
  improvements      TEXT,
  summary           TEXT,
  review_date       DATE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_reviews_staff ON performance_reviews(staff_id);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID NOT NULL REFERENCES staff(id),
  task       TEXT NOT NULL,
  is_done    BOOLEAN NOT NULL DEFAULT FALSE,
  done_at    TIMESTAMPTZ,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_staff ON onboarding_tasks(staff_id);

-- SENSITIVE
CREATE TABLE IF NOT EXISTS disciplinary_records (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       UUID NOT NULL REFERENCES staff(id),
  incident_date  DATE NOT NULL,
  category       TEXT NOT NULL
                 CHECK (category IN ('verbal_warning', 'written_warning', 'suspension', 'dismissal', 'other')),
  description    TEXT,
  action_taken   TEXT,
  recorded_by    UUID REFERENCES user_profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disciplinary_records_staff ON disciplinary_records(staff_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary_records ENABLE ROW LEVEL SECURITY;

-- Sensitive/personal: hr_officer + admin only, no broader read policy at all
DROP POLICY IF EXISTS "leave_requests_hr_only" ON leave_requests;
CREATE POLICY "leave_requests_hr_only" ON leave_requests FOR ALL
  USING (get_user_role() IN ('hr_officer', 'admin'));

DROP POLICY IF EXISTS "performance_reviews_hr_only" ON performance_reviews;
CREATE POLICY "performance_reviews_hr_only" ON performance_reviews FOR ALL
  USING (get_user_role() IN ('hr_officer', 'admin'));

DROP POLICY IF EXISTS "disciplinary_records_hr_only" ON disciplinary_records;
CREATE POLICY "disciplinary_records_hr_only" ON disciplinary_records FOR ALL
  USING (get_user_role() IN ('hr_officer', 'admin'));

-- Not flagged sensitive in the source spec: general pattern (broad
-- read, hr_officer/admin/manager write) like design_*/contracts/hse_*
DROP POLICY IF EXISTS "onboarding_tasks_read" ON onboarding_tasks;
CREATE POLICY "onboarding_tasks_read" ON onboarding_tasks FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "onboarding_tasks_write" ON onboarding_tasks;
CREATE POLICY "onboarding_tasks_write" ON onboarding_tasks FOR ALL
  USING (get_user_role() IN ('hr_officer', 'admin', 'manager'));

-- Verify: RLS on for all four
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('leave_requests', 'performance_reviews', 'onboarding_tasks', 'disciplinary_records')
ORDER BY relname;

-- Verify: policy list — the three sensitive tables should show exactly
-- one policy each (hr_officer/admin only); onboarding_tasks should
-- show two (a broad read + a scoped write)
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('leave_requests', 'performance_reviews', 'onboarding_tasks', 'disciplinary_records')
ORDER BY tablename, policyname;
