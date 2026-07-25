-- ============================================================
-- Tax Officer function: a designated tax-owner responsibility within
-- Finance & Admin, a filing/engagement log, and a small reference
-- table of recurring obligations so the "next filing due" is surfaced
-- rather than something someone has to remember to create.
--
-- No new RBAC role. user_profiles already carries three peer flags
-- (is_vrf_manager, is_logistics_officer, is_ride_hailing_authorized)
-- that are UI-only designations, not access gates — none of them has
-- a dedicated trigger because the existing admin_user_profiles policy
-- (FOR ALL, admin-only) already covers any write to this table.
-- is_tax_officer follows the same shape. Actual read/write on the new
-- tables below is role-gated to admin/finance, matching this
-- codebase's confirmed convention (migration 147's own comment:
-- identity columns are never a sole access-control gate).
--
-- tax_obligation_types is the "small reference table" — the recurring
-- filing types (VAT, WHT, payroll tax), each with an optional
-- configurable due_day_of_month. That day is NOT a hardcoded ERCA
-- legal deadline — it's left NULL until finance enters the real
-- convention; guessing Ethiopian tax law here would be worse than
-- leaving it blank. Seeded with the three the user named; "other" is
-- an escape hatch for anything not yet modeled.
--
-- tax_engagements is the actual filing log. status is deliberately
-- NOT a stored column (the user's spec listed it as one) — it's
-- derived in v_tax_engagements from filed_date vs due_date, the same
-- "derive, don't duplicate" principle the balance fix (150) applied:
-- a manually-set status can drift out of sync with reality, which is
-- the exact bug class this whole session has been fixing.
--
-- v_next_tax_obligations is the Rent-module equivalent: rent's
-- "upcoming renewal / payment due" is computed client-side, never a
-- persisted draft row (migration 141's own comment). This view does
-- the same — for each active obligation type, the next period needing
-- a filing is computed from the last logged engagement, not
-- pre-inserted. It only becomes a real row when someone actually logs
-- the filing.
--
-- v_tax_liability_summary is the consolidation across the four
-- scattered sources. It is a labeled UNION, not a period-pivoted
-- table: tax_summary.month and payroll_taxes.payroll_month are free-
-- text Amharic calendar strings, while v_monthly_vat_from_receipts
-- uses Gregorian 'YYYY-MM'. Forcing these into one row-per-period grid
-- would fabricate an alignment between two different calendars that
-- isn't actually there. WHT-from-expenses is deliberately not
-- included as a separately-derived figure — expenses carries
-- verify_wht/wht_handling_method/wht_fund flags but no stored WHT
-- amount per row, so tax_summary.wht_from_expenses (the existing
-- manual rollup) remains the only real figure for that, and is
-- included via the tax_summary row already.
-- ============================================================

SET search_path TO public;

-- ── 1. Tax Officer designation (UI-only, admin-gated by existing policy) ──
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_tax_officer BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN user_profiles.is_tax_officer IS
  'UI-only designation of the tax-owning person within Finance & Admin. Not an access gate — read/write on tax_obligation_types/tax_engagements is role-gated to admin/finance regardless of this flag, same convention as finance_contact_id (migration 147).';

-- ── 2. Reference table: recurring obligation types ───────────────────
CREATE TABLE IF NOT EXISTS tax_obligation_types (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_type          TEXT NOT NULL CHECK (tax_type IN ('VAT', 'WHT', 'payroll_tax', 'other')),
  name              TEXT NOT NULL,
  frequency         TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'annual')),
  due_day_of_month  INT CHECK (due_day_of_month BETWEEN 1 AND 28), -- day of the month AFTER the period; NULL until finance confirms the real ERCA convention
  active            BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tax_obligation_types (tax_type, name, frequency)
SELECT * FROM (VALUES
  ('VAT',         'Monthly VAT Return',            'monthly'),
  ('WHT',         'Monthly WHT Remittance',         'monthly'),
  ('payroll_tax', 'Monthly Payroll Income Tax',      'monthly')
) AS seed(tax_type, name, frequency)
WHERE NOT EXISTS (SELECT 1 FROM tax_obligation_types);

ALTER TABLE tax_obligation_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tax_obligation_types_read" ON tax_obligation_types;
CREATE POLICY "tax_obligation_types_read" ON tax_obligation_types FOR SELECT
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "tax_obligation_types_write" ON tax_obligation_types;
CREATE POLICY "tax_obligation_types_write" ON tax_obligation_types FOR ALL
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

GRANT SELECT, INSERT, UPDATE, DELETE ON tax_obligation_types TO authenticated;

CREATE OR REPLACE FUNCTION set_tax_obligation_types_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_tax_obligation_types_updated_at ON tax_obligation_types;
CREATE TRIGGER trg_tax_obligation_types_updated_at
  BEFORE UPDATE ON tax_obligation_types FOR EACH ROW EXECUTE FUNCTION set_tax_obligation_types_updated_at();

-- ── 3. The filing/engagement log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_engagements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_type_id UUID NOT NULL REFERENCES tax_obligation_types(id),
  period_month       DATE NOT NULL, -- first-of-month convention, like fiscal_periods.start_date
  due_date           DATE,
  filed_date         DATE,
  reference_number   TEXT,
  document_url       TEXT, -- the digitized filing — same principle as vendor-receipt digitization
  filed_by           UUID REFERENCES user_profiles(id),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (obligation_type_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_tax_engagements_obligation_type ON tax_engagements(obligation_type_id);
CREATE INDEX IF NOT EXISTS idx_tax_engagements_period ON tax_engagements(period_month);

ALTER TABLE tax_engagements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tax_engagements_read" ON tax_engagements;
CREATE POLICY "tax_engagements_read" ON tax_engagements FOR SELECT
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "tax_engagements_write" ON tax_engagements;
CREATE POLICY "tax_engagements_write" ON tax_engagements FOR ALL
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

GRANT SELECT, INSERT, UPDATE, DELETE ON tax_engagements TO authenticated;

DROP TRIGGER IF EXISTS trg_tax_engagements_updated_at ON tax_engagements;
CREATE TRIGGER trg_tax_engagements_updated_at
  BEFORE UPDATE ON tax_engagements FOR EACH ROW EXECUTE FUNCTION set_tax_obligation_types_updated_at();

-- ── 4. Engagements + derived status (not stored — see header) ───────
CREATE OR REPLACE VIEW v_tax_engagements
WITH (security_invoker = true) AS
SELECT
  te.id,
  te.period_month,
  te.due_date,
  te.filed_date,
  te.reference_number,
  te.document_url,
  te.notes,
  ot.id   AS obligation_type_id,
  ot.tax_type,
  ot.name AS obligation_name,
  up.full_name AS filed_by_name,
  CASE
    WHEN te.filed_date IS NOT NULL THEN 'filed'
    WHEN te.due_date IS NOT NULL AND te.due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'pending'
  END AS status
FROM tax_engagements te
JOIN tax_obligation_types ot ON ot.id = te.obligation_type_id
LEFT JOIN user_profiles up ON up.id = te.filed_by;

GRANT SELECT ON v_tax_engagements TO authenticated;

-- ── 5. Next obligation per active type — computed, not pre-inserted,
-- same philosophy as Rent's "next period" (migration 141). ──────────
CREATE OR REPLACE VIEW v_next_tax_obligations
WITH (security_invoker = true) AS
WITH last_covered AS (
  SELECT obligation_type_id, MAX(period_month) AS last_period
  FROM tax_engagements
  GROUP BY obligation_type_id
)
SELECT
  ot.id AS obligation_type_id,
  ot.tax_type,
  ot.name,
  ot.due_day_of_month,
  COALESCE(lc.last_period + INTERVAL '1 month', date_trunc('month', CURRENT_DATE))::date AS next_period_month,
  CASE WHEN ot.due_day_of_month IS NOT NULL THEN
    (
      (COALESCE(lc.last_period + INTERVAL '1 month', date_trunc('month', CURRENT_DATE)) + INTERVAL '1 month')::date
      + (ot.due_day_of_month - 1)
    )
  ELSE NULL END AS suggested_due_date
FROM tax_obligation_types ot
LEFT JOIN last_covered lc ON lc.obligation_type_id = ot.id
WHERE ot.active
  AND NOT EXISTS (
    SELECT 1 FROM tax_engagements te
    WHERE te.obligation_type_id = ot.id
      AND te.period_month = COALESCE(lc.last_period + INTERVAL '1 month', date_trunc('month', CURRENT_DATE))::date
  );

GRANT SELECT ON v_next_tax_obligations TO authenticated;

-- ── 6. Consolidated liability list — labeled UNION, not a period-
-- pivoted grid (see header for why). ─────────────────────────────────
CREATE OR REPLACE VIEW v_tax_liability_summary
WITH (security_invoker = true) AS
SELECT 'Tax Summary (VAT — expenses)' AS category, month AS period, vat_from_expenses AS amount FROM tax_summary WHERE vat_from_expenses > 0
UNION ALL
SELECT 'Tax Summary (VAT — sales)', month, vat_from_sales FROM tax_summary WHERE vat_from_sales > 0
UNION ALL
SELECT 'Tax Summary (WHT — expenses)', month, wht_from_expenses FROM tax_summary WHERE wht_from_expenses > 0
UNION ALL
SELECT 'Tax Summary (WHT — deducted by client)', month, wht_deducted_by_client FROM tax_summary WHERE wht_deducted_by_client > 0
UNION ALL
SELECT 'VAT (vendor receipts)', month, total_vat FROM v_monthly_vat_from_receipts WHERE total_vat > 0
UNION ALL
SELECT 'WHT (vendor receipts, as printed)', month, total_withholding FROM v_monthly_vat_from_receipts WHERE total_withholding > 0
UNION ALL
SELECT 'Payroll tax', payroll_month, SUM(tax_amount) FROM payroll_taxes GROUP BY payroll_month HAVING SUM(tax_amount) > 0;

GRANT SELECT ON v_tax_liability_summary TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='is_tax_officer';
SELECT tax_type, name, frequency, active FROM tax_obligation_types ORDER BY tax_type;
SELECT * FROM v_next_tax_obligations ORDER BY tax_type;
SELECT category, period, amount FROM v_tax_liability_summary ORDER BY category, period;
