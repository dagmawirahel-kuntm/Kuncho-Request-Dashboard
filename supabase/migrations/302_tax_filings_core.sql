-- Ethiopian Tax Filing module, group B: the filings themselves, their
-- uploaded government records, the deletion audit trail, RLS, and
-- period generation.

SET search_path TO public;

-- ── Due-date computation ────────────────────────────────────────────────
-- Deliberately computed by OFFSETTING FROM THE NEXT EC MONTH'S START, not by
-- indexing a day number inside the next EC month. "The 8th of the following
-- month" has no meaning when the following month is Pagume, which has 5 days
-- (6 in a leap year) -- a naive reading produces an invalid date once a year,
-- every year. Adding (day - 1) to that month's first day is well defined for
-- all 13 months and gives the same answer for the twelve 30-day ones.
--
-- Every due date is also STORED per filing and editable, because §1 of the
-- brief flags the exact remittance day as unconfirmed against current
-- ERCA/MoR directives. This computes the default; the tax officer overrides.
CREATE OR REPLACE FUNCTION tax_filing_due_date(
  p_rule JSONB,
  p_ec_year INT,
  p_ec_month INT,      -- NULL for annual schedules
  p_fy_end DATE
)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_kind      text := p_rule->>'kind';
  v_next_year int;
  v_next_mon  int;
BEGIN
  IF v_kind = 'months_after_fy_end' THEN
    RETURN (p_fy_end + ((p_rule->>'months')::int || ' months')::interval)::date;
  END IF;

  IF p_ec_month IS NULL THEN
    RETURN NULL;
  END IF;

  -- The EC month after the filing period; Pagume (13) rolls into Meskerem.
  IF p_ec_month = 13 THEN
    v_next_year := p_ec_year + 1; v_next_mon := 1;
  ELSE
    v_next_year := p_ec_year; v_next_mon := p_ec_month + 1;
  END IF;

  IF v_kind = 'following_month_day' THEN
    RETURN ec_month_start_greg(v_next_year, v_next_mon) + ((p_rule->>'day')::int - 1);
  ELSIF v_kind = 'following_month_end' THEN
    RETURN ec_month_end_greg(v_next_year, v_next_mon);
  END IF;

  RETURN NULL;
END;
$$;

-- ── tax_filings ─────────────────────────────────────────────────────────
CREATE TABLE tax_filings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_schedule_id        UUID NOT NULL REFERENCES tax_schedules(id),
  -- Denormalised so the label a user sees survives even if the catalogue
  -- row is later relabelled, and so the deletion snapshot reads standalone.
  schedule_code          TEXT NOT NULL,
  fiscal_period_id       UUID REFERENCES fiscal_periods(id),
  period_ec_year         INT NOT NULL,
  period_ec_month        INT CHECK (period_ec_month BETWEEN 1 AND 13),  -- NULL = annual
  period_label           TEXT GENERATED ALWAYS AS (
                           CASE WHEN period_ec_month IS NULL
                                THEN period_ec_year::text || ' E.C.'
                                ELSE ec_month_name(period_ec_month) || ' ' || period_ec_year::text
                           END) STORED,
  period_start_greg      DATE NOT NULL,
  period_end_greg        DATE NOT NULL,
  due_date_greg          DATE,
  status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'filed', 'acknowledged')),
  declared_amount        NUMERIC,
  paid_amount            NUMERIC,
  payment_date           DATE,
  government_reference_no TEXT,
  filed_by               UUID REFERENCES auth.users(id),
  filed_at               TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULLS NOT DISTINCT so annual filings (month NULL) are also unique per
  -- year. Without it Postgres treats every NULL as distinct and would happily
  -- allow twenty "2018 E.C." Sch-C rows.
  CONSTRAINT tax_filings_one_per_period UNIQUE NULLS NOT DISTINCT
    (tax_schedule_id, period_ec_year, period_ec_month)
);

CREATE INDEX idx_tax_filings_schedule ON tax_filings(tax_schedule_id);
CREATE INDEX idx_tax_filings_fiscal_period ON tax_filings(fiscal_period_id);
CREATE INDEX idx_tax_filings_period ON tax_filings(period_ec_year DESC, period_ec_month);
CREATE INDEX idx_tax_filings_status_due ON tax_filings(status, due_date_greg);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tax_filings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON COLUMN tax_filings.due_date_greg IS
  'Default computed from the schedule''s due rule, then editable per filing: the exact remittance day per tax is unconfirmed against current ERCA/MoR directives.';

-- ── tax_filing_documents ────────────────────────────────────────────────
-- Files live in the private `tax-records` bucket created in migration 303.
-- Reusing the existing tax-documents bucket was the original intent, but its
-- policies grant every authenticated user read and delete across the whole
-- bucket, and storage policies OR together -- so a filing PDF stored there
-- would be readable and deletable past all of the RLS below. See 303's
-- header for the full reasoning.
CREATE TABLE tax_filing_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_filing_id  UUID NOT NULL REFERENCES tax_filings(id) ON DELETE CASCADE,
  storage_path   TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  mime_type      TEXT,
  size_bytes     BIGINT,
  doc_type       TEXT NOT NULL DEFAULT 'other'
                   CHECK (doc_type IN ('declaration', 'official_receipt', 'acknowledgement', 'assessment', 'other')),
  uploaded_by    UUID REFERENCES auth.users(id),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tax_filing_documents_filing ON tax_filing_documents(tax_filing_id);

-- Defined after both tables because it counts documents. `overdue` is
-- derived here, never stored, so it cannot go stale.
CREATE OR REPLACE VIEW v_tax_filings
WITH (security_invoker = true) AS
SELECT f.*,
       s.display_label,
       s.name        AS schedule_name,
       s.authority,
       s.periodicity,
       s.statutory_reference,
       (f.status <> 'acknowledged'
        AND f.due_date_greg IS NOT NULL
        AND f.due_date_greg < CURRENT_DATE) AS is_overdue,
       (SELECT count(*) FROM tax_filing_documents d WHERE d.tax_filing_id = f.id) AS document_count
FROM tax_filings f
JOIN tax_schedules s ON s.id = f.tax_schedule_id;

-- ── tax_filing_deletions ────────────────────────────────────────────────
-- The audit trail that makes the admin hard-delete acceptable. Written
-- inside the delete RPC, before the row goes.
CREATE TABLE tax_filing_deletions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_filing_snapshot  JSONB NOT NULL,
  schedule_code            TEXT NOT NULL,
  period_label             TEXT NOT NULL,
  reason                   TEXT NOT NULL,
  deleted_by               UUID NOT NULL REFERENCES auth.users(id),
  deleted_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tax_filing_deletions_at ON tax_filing_deletions(deleted_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE tax_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_filing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_filing_deletions ENABLE ROW LEVEL SECURITY;

-- Read: tax officer, finance, admin, executive. Everyone else: nothing.
CREATE POLICY tax_filings_select ON tax_filings FOR SELECT TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false));

CREATE POLICY tax_filings_insert ON tax_filings FOR INSERT TO authenticated
  WITH CHECK (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false));

-- Editable while draft/filed. Once acknowledged the figures are locked: to
-- change them the status has to come back down first, which is itself an
-- edit a tax officer makes deliberately.
CREATE POLICY tax_filings_update ON tax_filings FOR UPDATE TO authenticated
  USING (
    status IN ('draft', 'filed')
    AND (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false))
  )
  WITH CHECK (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false));

-- No DELETE policy: deletion goes through delete_tax_filing() (group C),
-- which is admin-only and writes a snapshot first. A tax officer can never
-- remove a recorded filing, by design.

CREATE POLICY tax_filing_documents_select ON tax_filing_documents FOR SELECT TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false));

CREATE POLICY tax_filing_documents_insert ON tax_filing_documents FOR INSERT TO authenticated
  WITH CHECK (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false));

-- No DELETE policy here either -- removing a document is admin-only and
-- snapshotted, via delete_tax_filing_document() in group C.

-- Audit trail is readable by the same group, and never writable directly:
-- the delete RPCs are SECURITY DEFINER and insert past RLS.
CREATE POLICY tax_filing_deletions_select ON tax_filing_deletions FOR SELECT TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'executive'), false));

-- ── Period generation ───────────────────────────────────────────────────
-- Idempotent: re-running adds only what is missing, leaning on
-- tax_filings_one_per_period.
--
-- An Ethiopian fiscal year (Hamle 1 -> Sene 30) spans the tail of one EC
-- year and the head of the next -- FY2026/27 is Hamle 2018 through Sene
-- 2019, which is 13 EC months because Pagume falls inside it. The loop walks
-- actual EC months rather than assuming 12, so that comes out right on its
-- own.
--
-- SECURITY INVOKER: tax_filings' own policies decide who may insert, so the
-- caller's rights are the right rights. The auth guard is here so an
-- unauthenticated call fails with a clear message rather than an empty loop.
CREATE OR REPLACE FUNCTION generate_tax_filing_periods(p_fiscal_period_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_fy       fiscal_periods%ROWTYPE;
  v_sched    RECORD;
  v_y        INT;
  v_m        INT;
  v_cursor   DATE;
  v_created  INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_fy FROM fiscal_periods WHERE id = p_fiscal_period_id;
  IF v_fy.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;

  FOR v_sched IN
    SELECT * FROM tax_schedules
    WHERE is_active AND applies_to_kuncho
    ORDER BY display_order
  LOOP
    IF v_sched.periodicity = 'annual' THEN
      -- Named by the EC year the fiscal year STARTS in: FY2026/27 begins
      -- Hamle 2018, so its annual return is "2018 E.C.".
      SELECT ec_year INTO v_y FROM gregorian_to_ec(v_fy.start_date);

      INSERT INTO tax_filings (tax_schedule_id, schedule_code, fiscal_period_id,
        period_ec_year, period_ec_month, period_start_greg, period_end_greg, due_date_greg)
      VALUES (v_sched.id, v_sched.code, v_fy.id, v_y, NULL,
        v_fy.start_date, v_fy.end_date,
        tax_filing_due_date(v_sched.default_due_rule, v_y, NULL, v_fy.end_date))
      ON CONFLICT ON CONSTRAINT tax_filings_one_per_period DO NOTHING;

      IF FOUND THEN v_created := v_created + 1; END IF;

    ELSIF v_sched.periodicity = 'monthly' THEN
      v_cursor := v_fy.start_date;
      WHILE v_cursor <= v_fy.end_date LOOP
        SELECT ec_year, ec_month INTO v_y, v_m FROM gregorian_to_ec(v_cursor);

        INSERT INTO tax_filings (tax_schedule_id, schedule_code, fiscal_period_id,
          period_ec_year, period_ec_month, period_start_greg, period_end_greg, due_date_greg)
        VALUES (v_sched.id, v_sched.code, v_fy.id, v_y, v_m,
          ec_month_start_greg(v_y, v_m), ec_month_end_greg(v_y, v_m),
          tax_filing_due_date(v_sched.default_due_rule, v_y, v_m, v_fy.end_date))
        ON CONFLICT ON CONSTRAINT tax_filings_one_per_period DO NOTHING;

        IF FOUND THEN v_created := v_created + 1; END IF;

        -- Step to the first day of the next EC month.
        v_cursor := ec_month_end_greg(v_y, v_m) + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION generate_tax_filing_periods(UUID) FROM PUBLIC, anon;
