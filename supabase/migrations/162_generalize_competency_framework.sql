-- ============================================================
-- Widen the FF&E competency framework to every department.
--
-- This is a rename, not a rebuild. The FF&E model works because its
-- responsibilities are observable — you can watch someone read a shop
-- drawing and rate it honestly. Nothing about that changes; the tables
-- simply stop being FF&E-specific.
--
-- Data carried across untouched: 5 job descriptions, 19
-- responsibilities, 2 skill ratings. Those 5 roles become
-- Operations/Construction rows and are otherwise identical.
--
-- HARD CUTOVER, per confirmed decision: no compatibility views over the
-- old names. Access is limited to the account owner plus one
-- procurement user, so the deploy window where old JavaScript could hit
-- a renamed table is acceptable. The frontend changes land in the same
-- merge.
--
-- Postgres specifics that make this safe:
--   • ALTER TABLE ... RENAME preserves rows, indexes, constraints,
--     policies, triggers and grants.
--   • Views track table OIDs, not names, so the three v_staff_ffe_*
--     views keep working across the rename. They are renamed too, for
--     consistency, which is a separate and equally safe operation.
--   • Constraint and policy NAMES keep their old ffe_ strings. That is
--     cosmetic; renaming them adds churn and risk for no behavioural
--     gain, so they are deliberately left alone.
--
-- A fourth table joins the rename that the original scope did not
-- mention: staff_ffe_checklist also FKs into the responsibilities, so
-- leaving it behind would point a foreign key at a renamed target under
-- an inconsistent name. Confirmed to generalize with the rest.
--
-- NOT renamed: ffe_specifications. That is design specification data,
-- unrelated to competency — the ffe_ prefix does double duty in this
-- schema and only one meaning is being widened here.
-- ============================================================

SET search_path TO public;

-- ── 1. Rename the four tables and three views ────────────────────────
ALTER TABLE IF EXISTS ffe_job_descriptions      RENAME TO job_descriptions;
ALTER TABLE IF EXISTS ffe_key_responsibilities  RENAME TO key_responsibilities;
ALTER TABLE IF EXISTS staff_ffe_skill_ratings   RENAME TO staff_skill_ratings;
ALTER TABLE IF EXISTS staff_ffe_checklist       RENAME TO staff_competency_checklist;

ALTER VIEW IF EXISTS v_staff_ffe_current_scores RENAME TO v_staff_current_scores;
ALTER VIEW IF EXISTS v_staff_ffe_role_summary   RENAME TO v_staff_role_summary;
ALTER VIEW IF EXISTS v_staff_ffe_skill_level    RENAME TO v_staff_skill_level;

-- ── 2. A job description now belongs to a department ─────────────────
ALTER TABLE job_descriptions
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_descriptions_department ON job_descriptions(department_id);

COMMENT ON TABLE job_descriptions IS
  'Role definitions per department, rateable via key_responsibilities. Generalized from the FF&E framework — the five fabrication roles are Operations/Construction rows and are unchanged.';

-- The five existing FF&E roles are Operations/Construction. Matched by
-- "has no department yet", so this cannot touch anything seeded later.
UPDATE job_descriptions
SET department_id = (SELECT id FROM departments WHERE name = 'Operations/Construction')
WHERE department_id IS NULL;

-- ── 3. Skill ratings are sensitive personal data ─────────────────────
-- Previously readable by any authenticated user. Restricted to the
-- people with a legitimate reason: the person themselves, their line
-- manager, their department head, HR and admin.
--
-- Deliberately NOT extended to secondary (hybrid) department heads —
-- staff_department_memberships is descriptive and grants no authority
-- (161), and quietly widening who can read someone's competency scores
-- would be exactly the kind of authority creep that decision exists to
-- prevent.
DROP POLICY IF EXISTS "staff_ffe_skill_ratings_read" ON staff_skill_ratings;
DROP POLICY IF EXISTS "staff_skill_ratings_read" ON staff_skill_ratings;
CREATE POLICY "staff_skill_ratings_read" ON staff_skill_ratings FOR SELECT
  USING (
    get_user_role() IN ('admin', 'hr_officer')
    OR staff_id = current_staff_id()
    OR EXISTS (SELECT 1 FROM staff s WHERE s.id = staff_skill_ratings.staff_id AND s.reports_to_id = current_staff_id())
    OR EXISTS (
      SELECT 1 FROM staff s
      JOIN departments d ON d.id = s.department_id
      WHERE s.id = staff_skill_ratings.staff_id AND d.head_staff_id = current_staff_id()
    )
  );

-- Rating someone stays a management act: their manager, their
-- department head, HR or admin. Append-only — no update or delete
-- policy, so history cannot be rewritten.
DROP POLICY IF EXISTS "staff_ffe_skill_ratings_insert" ON staff_skill_ratings;
DROP POLICY IF EXISTS "staff_skill_ratings_insert" ON staff_skill_ratings;
CREATE POLICY "staff_skill_ratings_insert" ON staff_skill_ratings FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin', 'hr_officer')
    OR EXISTS (SELECT 1 FROM staff s WHERE s.id = staff_skill_ratings.staff_id AND s.reports_to_id = current_staff_id())
    OR EXISTS (
      SELECT 1 FROM staff s
      JOIN departments d ON d.id = s.department_id
      WHERE s.id = staff_skill_ratings.staff_id AND d.head_staff_id = current_staff_id()
    )
  );

-- Same reach for the checklist.
DROP POLICY IF EXISTS "staff_ffe_checklist_read" ON staff_competency_checklist;
DROP POLICY IF EXISTS "staff_competency_checklist_read" ON staff_competency_checklist;
CREATE POLICY "staff_competency_checklist_read" ON staff_competency_checklist FOR SELECT
  USING (
    get_user_role() IN ('admin', 'hr_officer')
    OR staff_id = current_staff_id()
    OR EXISTS (SELECT 1 FROM staff s WHERE s.id = staff_competency_checklist.staff_id AND s.reports_to_id = current_staff_id())
    OR EXISTS (
      SELECT 1 FROM staff s
      JOIN departments d ON d.id = s.department_id
      WHERE s.id = staff_competency_checklist.staff_id AND d.head_staff_id = current_staff_id()
    )
  );

-- ── 4. Draft frameworks for the other departments ────────────────────
-- Seeded INACTIVE on purpose. The brief is explicit that the agent's
-- first pass must not be treated as final and that each department head
-- confirms their own before any real assessment. active = false means
-- they are visible for review and cannot be rated against until someone
-- with the knowledge turns them on.
--
-- Every responsibility below is either directly observable or evidenced
-- by system activity — no "demonstrates accuracy, rate 0-5" abstractions,
-- which decay into box-ticking because nobody can be wrong about them.
-- Tier vocabulary matches what the FF&E rows already use: foundational
-- (the job cannot be done without it) and differentiator (what separates
-- competent from excellent).
INSERT INTO job_descriptions (role_name, role_overview, department_id, sort_order, active)
SELECT v.role_name, v.overview, d.id, v.sort_order, FALSE
FROM (VALUES
  ('Procurement Officer',   'Sources and places purchase orders, owns vendor record quality.', 'Procurement & Logistics', 10),
  ('Logistics Officer',     'Moves goods and keeps the fleet compliant.',                      'Procurement & Logistics', 11),
  ('Stock Manager',         'Receives, catalogues and issues materials.',                      'Procurement & Logistics', 12),
  ('Finance Officer',       'Approves, pays and reconciles; keeps the ledger honest.',         'Finance & Admin',         20),
  ('Designer',              'Produces buildable drawings and FF&E specifications.',            'Design',                  30),
  ('Business Development',  'Converts opportunities into complete, well-formed contracts.',    'Business Development/Sales', 40),
  ('Project Manager',       'Owns a project''s budget, progress and stage gates.',             'Operations/Construction', 50),
  ('HR Officer',            'Onboards people and keeps staff records current.',                'HR & People',             60),
  ('HSE Officer',           'Keeps inductions valid and incidents closed.',                    'HSE',                     70)
) AS v(role_name, overview, dept, sort_order)
JOIN departments d ON d.name = v.dept
WHERE NOT EXISTS (SELECT 1 FROM job_descriptions j WHERE j.role_name = v.role_name);

INSERT INTO key_responsibilities (job_description_id, responsibility_title, responsibility_detail, tier, sort_order, active)
SELECT j.id, v.title, v.detail, v.tier, v.sort_order, FALSE
FROM (VALUES
  ('Procurement Officer','Competitive sourcing','Obtains multiple quotes before raising a PO rather than defaulting to one vendor.','foundational',1),
  ('Procurement Officer','PO accuracy','What the GRN records matches what was ordered, in item and quantity.','foundational',2),
  ('Procurement Officer','Vendor record quality','TIN and bank details captured and verified, not left blank for finance to chase.','foundational',3),
  ('Procurement Officer','PR to PO turnaround','Requests are converted to orders without stalling in the queue.','differentiator',4),
  ('Procurement Officer','Advance-payment handling','Advance-paid vendors reconciled against delivery rather than left open.','differentiator',5),

  ('Logistics Officer','Transport turnaround','Jobs completed against requested dates without repeated rescheduling.','foundational',1),
  ('Logistics Officer','Fleet maintenance compliance','Scheduled maintenance actioned before it becomes a breakdown.','foundational',2),
  ('Logistics Officer','Delivery documentation','Deliveries confirmed and discrepancies raised rather than absorbed.','differentiator',3),

  ('Stock Manager','GRN timeliness','Goods receipted on arrival, not days later from memory.','foundational',1),
  ('Stock Manager','Catalogue quality','New items catalogued properly rather than left pending setup.','foundational',2),
  ('Stock Manager','Stock accuracy vs physical count','Recorded quantities match what is actually on the shelf.','differentiator',3),

  ('Finance Officer','Approval turnaround','Payment approvals cleared without becoming the bottleneck.','foundational',1),
  ('Finance Officer','Bank-line matching completeness','Payments reconciled against statement lines rather than left unmatched.','foundational',2),
  ('Finance Officer','WHT applied correctly','Withholding handled and evidenced per the vendor''s status.','foundational',3),
  ('Finance Officer','Budget-check discipline','Raises a variation when a budget is exceeded instead of seeking an override.','differentiator',4),
  ('Finance Officer','Ledger posting integrity','Posting failures investigated and cleared, not dismissed.','differentiator',5),

  ('Designer','Drawing completeness at sign-off','Drawings carry the detail needed to build from at Stage 2.','foundational',1),
  ('Designer','FF&E spec accuracy','What is specified is something the workshop can actually build.','foundational',2),
  ('Designer','Revision volume after sign-off','Few post-approval revisions caused by avoidable omissions.','differentiator',3),
  ('Designer','Client approval turnaround','Keeps client sign-off moving rather than letting it drift.','differentiator',4),

  ('Business Development','Contract completeness','Value, terms and WHT rate all captured on the contract record.','foundational',1),
  ('Business Development','Project linkage discipline','Contracts tied to their project rather than left floating.','foundational',2),
  ('Business Development','Quote-to-win conversion','Proportion of opportunities carried through to won.','differentiator',3),
  ('Business Development','CPO handling','Bonds raised, tracked and released without lapsing.','differentiator',4),

  ('Project Manager','Budget variance control','Keeps committed plus actual within the approved budget.','foundational',1),
  ('Project Manager','Progress vs spend accuracy','Reported physical progress is consistent with money spent.','foundational',2),
  ('Project Manager','Stage-gate discipline','Projects move through lifecycle stages deliberately, with evidence.','differentiator',3),
  ('Project Manager','Site delivery confirmation','Material arriving on site is checked in promptly and shortfalls flagged.','differentiator',4),

  ('HR Officer','Onboarding completeness','New starters finish their onboarding tasks rather than leaving them open.','foundational',1),
  ('HR Officer','Records currency','Staff records kept complete and current, not filled in at audit time.','foundational',2),
  ('HR Officer','Leave processing turnaround','Requests decided rather than left pending.','differentiator',3),

  ('HSE Officer','Induction coverage','Share of site workers holding a valid, unexpired induction.','foundational',1),
  ('HSE Officer','Incident logging timeliness','Incidents recorded when they happen, not reconstructed later.','foundational',2),
  ('HSE Officer','Closure rate','Logged incidents driven to closure rather than left open indefinitely.','differentiator',3)
) AS v(role_name, title, detail, tier, sort_order)
JOIN job_descriptions j ON j.role_name = v.role_name
WHERE NOT EXISTS (
  SELECT 1 FROM key_responsibilities k
  WHERE k.job_description_id = j.id AND k.responsibility_title = v.title
);

-- ── Verify ───────────────────────────────────────────────────────────
-- Old names gone, new names present, FF&E data intact.
SELECT to_regclass('public.ffe_job_descriptions')  IS NULL AS old_gone,
       to_regclass('public.job_descriptions') IS NOT NULL AS new_present;

SELECT d.name AS department, count(*) AS roles,
       count(*) FILTER (WHERE j.active) AS active_roles
FROM job_descriptions j LEFT JOIN departments d ON d.id = j.department_id
GROUP BY d.name ORDER BY d.name;

-- The 5 original roles kept their 19 responsibilities and 2 ratings.
SELECT (SELECT count(*) FROM key_responsibilities k
          JOIN job_descriptions j ON j.id = k.job_description_id
         WHERE j.active) AS live_ffe_responsibilities,
       (SELECT count(*) FROM staff_skill_ratings) AS ratings_preserved;

SELECT viewname FROM pg_views
WHERE viewname IN ('v_staff_current_scores','v_staff_role_summary','v_staff_skill_level')
ORDER BY viewname;
