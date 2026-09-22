-- Ethiopian Tax Filing module, group A: Ethiopian-calendar helpers, the
-- filing-type catalogue, and effective-dated rate references.
--
-- Rates live here as DATA, not as constants in components, so a proclamation
-- change (the 2% -> 3% WHT change in 1395/2025, say) is an edit rather than a
-- deploy.
--
-- ── Ethiopian calendar ──────────────────────────────────────────────────
-- 13 months: 12 of 30 days + Pagume (5 days, 6 when (EC_year + 1) % 4 = 0).
-- Conversion is JDN-based. Verified against live data before this migration
-- was written, in both directions:
--
--   Meskerem 1, 2018 EC  <-> 2025-09-11   (the stated anchor)
--   Hamle    1, 2018 EC  <-> 2026-07-08   (equals fiscal_periods FY2026/27 start)
--   Yekatit 30, 2018 EC  <-> 2026-03-09   (mid-year)
--   Pagume   5, 2018 EC  <-> 2026-09-10   (2018 is NOT leap: last day of year)
--   Meskerem 1, 2019 EC  <-> 2026-09-11   (next new year)
--   Pagume   6, 2019 EC  <-> 2027-09-11   (2019 IS leap: the 6th Pagume day)
--
-- The leap behaviour is not special-cased anywhere below -- it falls out of
-- the JDN arithmetic, which is why those last three cases were checked.
--
-- All four functions are pure arithmetic over their arguments, so they are
-- IMMUTABLE and need no auth guard: they read no rows. Under migration 238's
-- default privileges they are created callable by authenticated and
-- service_role, not PUBLIC/anon.

SET search_path TO public;

CREATE OR REPLACE FUNCTION ec_is_leap(p_ec_year int)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_ec_year + 1) % 4 = 0;
$$;

COMMENT ON FUNCTION ec_is_leap(int) IS
  'Ethiopian leap year: Pagume has 6 days when (EC year + 1) is divisible by 4.';

CREATE OR REPLACE FUNCTION ec_month_name(p_month int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY[
    'Meskerem','Tikimt','Hidar','Tahsas','Tir','Yekatit',
    'Megabit','Miazia','Ginbot','Sene','Hamle','Nehase','Pagume'
  ])[p_month];
$$;

COMMENT ON FUNCTION ec_month_name(int) IS
  'Transliterated Ethiopian month name for index 1-13 (Meskerem = 1, Pagume = 13).';

-- Ethiopian -> Gregorian.
CREATE OR REPLACE FUNCTION ec_to_gregorian(p_ec_year int, p_ec_month int, p_ec_day int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT to_date(
    (1723856 + 365 + 365 * (p_ec_year - 1) + (p_ec_year / 4)
     + 30 * p_ec_month + p_ec_day - 31)::text, 'J');
$$;

-- Gregorian -> Ethiopian, returned as a row so callers get all three parts
-- from one call.
CREATE OR REPLACE FUNCTION gregorian_to_ec(p_date date)
RETURNS TABLE (ec_year int, ec_month int, ec_day int)
LANGUAGE sql IMMUTABLE AS $$
  WITH j AS (SELECT to_char(p_date, 'J')::int AS jdn),
  s AS (
    SELECT (jdn - 1723856) % 1461 AS r, (jdn - 1723856) / 1461 AS q FROM j
  ),
  n AS (
    SELECT ((r % 365) + 365 * (r / 1460)) AS nn,
           (4 * q + (r / 365) - (r / 1460)) AS yy
    FROM s
  )
  SELECT yy, (nn / 30) + 1, (nn % 30) + 1 FROM n;
$$;

-- First and last Gregorian day of an Ethiopian month. Pagume's length comes
-- from ec_is_leap rather than a hardcoded 5.
CREATE OR REPLACE FUNCTION ec_month_start_greg(p_ec_year int, p_ec_month int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT ec_to_gregorian(p_ec_year, p_ec_month, 1);
$$;

CREATE OR REPLACE FUNCTION ec_month_end_greg(p_ec_year int, p_ec_month int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT ec_to_gregorian(
    p_ec_year, p_ec_month,
    CASE WHEN p_ec_month = 13 THEN CASE WHEN ec_is_leap(p_ec_year) THEN 6 ELSE 5 END
         ELSE 30 END);
$$;

-- ── is_tax_officer() ────────────────────────────────────────────────────
-- "Tax officer" is a boolean on user_profiles, not a user_role enum value --
-- checked before writing this. SECURITY DEFINER so RLS policies can consult
-- it regardless of user_profiles' own policies, mirroring get_user_role().
--
-- It deliberately does NOT raise when unauthenticated: this is evaluated
-- inside RLS policies, where raising would turn a denied read into an error.
-- It returns false, so it fails closed.
CREATE OR REPLACE FUNCTION is_tax_officer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT up.is_tax_officer FROM user_profiles up WHERE up.id = auth.uid()),
    false);
$$;

-- ── tax_schedules: the filing-type catalogue ────────────────────────────
CREATE TABLE tax_schedules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    TEXT NOT NULL UNIQUE,
  display_label           TEXT NOT NULL,
  name                    TEXT NOT NULL,
  authority               TEXT NOT NULL CHECK (authority IN ('MoR', 'ERCA', 'POESSA', 'PSSSA')),
  periodicity             TEXT NOT NULL CHECK (periodicity IN ('monthly', 'quarterly', 'annual')),
  statutory_reference     TEXT,
  -- e.g. {"kind":"following_month_day","day":8}
  --      {"kind":"following_month_end"}
  --      {"kind":"months_after_fy_end","months":4}
  default_due_rule        JSONB NOT NULL,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  applies_to_kuncho       BOOLEAN NOT NULL DEFAULT false,
  -- Extends the existing catalogue rather than duplicating it: VAT, WHT and
  -- payroll_tax already exist as tax_obligation_types.
  tax_obligation_type_id  UUID REFERENCES tax_obligation_types(id),
  display_order           INT NOT NULL DEFAULT 100,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tax_schedules_active ON tax_schedules(is_active, applies_to_kuncho);

-- ── tax_rate_references: effective-dated rates ──────────────────────────
CREATE TABLE tax_rate_references (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_schedule_id      UUID NOT NULL REFERENCES tax_schedules(id) ON DELETE CASCADE,
  effective_from       DATE NOT NULL,
  effective_to         DATE,
  -- Free-form for flat rates ("15% standard, 0% zero-rated"); structured for
  -- bracketed ones. Sch-A's bands are stored as a `bands` array so the
  -- gross-up is driven off this table rather than literals in code.
  rate_note            JSONB NOT NULL,
  statutory_reference  TEXT,
  entered_by           UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX idx_tax_rate_references_schedule ON tax_rate_references(tax_schedule_id, effective_from DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Read: tax officer, finance, admin, executive. Write: tax officer or admin.
ALTER TABLE tax_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rate_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY tax_schedules_select ON tax_schedules FOR SELECT TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false));

CREATE POLICY tax_schedules_write ON tax_schedules FOR ALL TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false))
  WITH CHECK (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false));

CREATE POLICY tax_rate_references_select ON tax_rate_references FOR SELECT TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false));

CREATE POLICY tax_rate_references_write ON tax_rate_references FOR ALL TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false))
  WITH CHECK (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false));

-- ── Seed: the catalogue ─────────────────────────────────────────────────
-- applies_to_kuncho reflects what the platform shows Kuncho actually owes
-- today: VAT, Sch-A payroll tax, WHT and Pension monthly, Sch-C annually.
-- The rest are seeded so they exist, but do not generate filing periods.
INSERT INTO tax_schedules
  (code, display_label, name, authority, periodicity, statutory_reference, default_due_rule,
   applies_to_kuncho, tax_obligation_type_id, display_order)
VALUES
  ('SCH_A', 'Sch-A', 'Employment income tax (PAYE)', 'MoR', 'monthly',
   'Proc. 979/2016 as amended by 1395/2025', '{"kind":"following_month_day","day":8}',
   true, (SELECT id FROM tax_obligation_types WHERE tax_type = 'payroll_tax'), 10),

  ('SCH_B', 'Sch-B', 'Rental of buildings income tax', 'MoR', 'annual',
   'Proc. 979/2016', '{"kind":"months_after_fy_end","months":4}', false, NULL, 20),

  ('SCH_C', 'Sch-C', 'Business profit tax', 'MoR', 'annual',
   'Proc. 979/2016', '{"kind":"months_after_fy_end","months":4}', true, NULL, 30),

  ('SCH_D', 'Sch-D', 'Other income / withholding', 'MoR', 'monthly',
   'Proc. 979/2016', '{"kind":"following_month_end"}', false, NULL, 40),

  ('SCH_E', 'Sch-E', 'Exempt income', 'MoR', 'annual',
   'Proc. 979/2016', '{"kind":"months_after_fy_end","months":4}', false, NULL, 50),

  ('VAT', 'VAT', 'Value Added Tax', 'MoR', 'monthly',
   'Proc. 1341/2024 + Reg. 570/2025', '{"kind":"following_month_end"}',
   true, (SELECT id FROM tax_obligation_types WHERE tax_type = 'VAT'), 60),

  ('WHT', 'WHT', 'Withholding tax on payments', 'MoR', 'monthly',
   'Proc. 1395/2025', '{"kind":"following_month_end"}',
   true, (SELECT id FROM tax_obligation_types WHERE tax_type = 'WHT'), 70),

  ('PENSION', 'Pension', 'Pension contributions', 'PSSSA', 'monthly',
   'POESSA / PSSSA', '{"kind":"following_month_day","day":10}', true, NULL, 80),

  ('TOT', 'TOT', 'Turnover tax (non-VAT-registered)', 'MoR', 'monthly',
   'Turnover Tax Proclamation', '{"kind":"following_month_end"}', false, NULL, 90),

  ('EXCISE', 'Excise', 'Excise tax', 'MoR', 'monthly',
   'Excise Tax Proclamation', '{"kind":"following_month_end"}', false, NULL, 100);

-- ── Seed: current rates ─────────────────────────────────────────────────
-- Sch-A's bands carry `rate` and `deduct` (the deduction constant K), so
-- PAYE = rate * gross - deduct, and the gross-up divisor is derived as
-- (1 - pension_rate - rate). Both are read from here rather than hardcoded.
-- The K values were checked for continuity at every band boundary before
-- seeding: at 2,000 / 4,000 / 7,000 / 10,000 / 14,000 both adjacent bands
-- give the same PAYE (0 / 300 / 900 / 1,650 / 2,850).
INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2025-07-07',
  '{"kind":"progressive_monthly","currency":"ETB","pension_pre_tax":false,
    "bands":[
      {"min":0,        "max":2000,  "rate":0.00, "deduct":0},
      {"min":2000.01,  "max":4000,  "rate":0.15, "deduct":300},
      {"min":4000.01,  "max":7000,  "rate":0.20, "deduct":500},
      {"min":7000.01,  "max":10000, "rate":0.25, "deduct":850},
      {"min":10000.01, "max":14000, "rate":0.30, "deduct":1350},
      {"min":14000.01, "max":null,  "rate":0.35, "deduct":2050}
    ]}'::jsonb,
  'Proc. 1395/2025, effective 7 July 2025'
FROM tax_schedules WHERE code = 'SCH_A';

INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2024-01-01',
  '{"kind":"flat","standard_rate":0.15,"zero_rated":0.00,
    "registration_threshold_etb":2000000,"threshold_window_months":12}'::jsonb,
  'Proc. 1341/2024 + Reg. 570/2025'
FROM tax_schedules WHERE code = 'VAT';

-- Raised from 2% by 1395/2025. The thresholds are per contract.
INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2025-07-07',
  '{"kind":"flat","rate":0.03,
    "goods_threshold_etb":20000,"services_threshold_etb":10000,
    "note":"Higher default rate applies without a TIN - confirm current figure with the tax officer"}'::jsonb,
  'Proc. 1395/2025'
FROM tax_schedules WHERE code = 'WHT';

-- The 15,000 insurable-earnings ceiling is NOT applied: it is recorded here
-- as unconfirmed and left off until the tax officer confirms it.
INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2011-06-24',
  '{"kind":"contribution","employee_rate":0.07,"employer_rate":0.11,
    "foreign_nationals_exempt":true,
    "insurable_earnings_ceiling_etb":null,
    "ceiling_note":"Some sources cite an ETB 15,000 ceiling - unconfirmed, off until the tax officer confirms"}'::jsonb,
  'POESSA / PSSSA'
FROM tax_schedules WHERE code = 'PENSION';

INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2016-08-01',
  '{"kind":"flat","bodies_rate":0.30,"note":"Individuals progressive"}'::jsonb,
  'Proc. 979/2016'
FROM tax_schedules WHERE code = 'SCH_C';

INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2016-08-01',
  '{"kind":"flat","bodies_rate":0.30,"note":"Individuals progressive"}'::jsonb,
  'Proc. 979/2016'
FROM tax_schedules WHERE code = 'SCH_B';

INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2016-08-01',
  '{"kind":"mixed","dividends":0.10,"royalties":0.05,"games_of_chance":0.15}'::jsonb,
  'Proc. 979/2016'
FROM tax_schedules WHERE code = 'SCH_D';

INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2016-08-01', '{"kind":"exempt","rate":0.00}'::jsonb, 'Proc. 979/2016'
FROM tax_schedules WHERE code = 'SCH_E';

INSERT INTO tax_rate_references (tax_schedule_id, effective_from, rate_note, statutory_reference)
SELECT id, DATE '2016-08-01',
  '{"kind":"flat","goods_rate":0.02,"services_rate":0.10}'::jsonb,
  'Turnover Tax Proclamation'
FROM tax_schedules WHERE code = 'TOT';
