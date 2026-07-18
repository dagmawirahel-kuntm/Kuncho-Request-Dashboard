-- ============================================================
-- Vendor receipt / invoice — a different object from a GRN, not
-- collapsed into it. The GRN proves physical delivery; this is the
-- tax document filed against monthly VAT and the thing an ERCA audit
-- wants to see. One purchase can legitimately have a GRN (delivery),
-- a payment (cash), and a receipt (tax doc) — three linked records,
-- not one, each closable independently.
--
-- withholding_amount here is the figure AS PRINTED on the physical
-- receipt — a real, independent data point worth capturing for cross-
-- check — not a second source of truth for WHT. That already lives on
-- expenses (verify_wht, wht_handling_method, wht_fund); this table
-- links to the expense rather than re-deriving or overriding it.
--
-- vendor_receipt_facilitation (migration 001/025) is a DIFFERENT,
-- pre-existing thing — the cost of paying a facilitator to obtain a
-- receipt from a vendor who wouldn't otherwise issue one (commission,
-- money_returned). This table is the receipt itself, however it was
-- obtained. No overlap, not touched here.
--
-- Maker-checker, enforced server-side: the person who enters a
-- receipt (the maker) is a different person, from a different
-- department (finance vs procurement — admin can stand in for either
-- side, same posture as every other segregation-of-duties rule in
-- this project), who then verifies it (the checker). Both identities
-- persist on the record. No fiscal-year gating here the way payment-
-- lifecycle rules have it — this is a brand-new table with no
-- historical rows to grandfather; every row is current by definition.
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS vendor_receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id            UUID REFERENCES expenses(id) ON DELETE SET NULL,
  grn_id                UUID REFERENCES goods_received_notes(id) ON DELETE SET NULL,
  vendor_id             UUID REFERENCES vendors(id) ON DELETE SET NULL,
  receipt_no            TEXT,
  receipt_date          DATE,
  vat_amount            NUMERIC(12,2),
  withholding_amount    NUMERIC(12,2),
  vendor_tin_on_receipt TEXT,
  document_url          TEXT,
  document_name         TEXT,
  notes                 TEXT,
  status                TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified', 'rejected')),
  entered_by            UUID REFERENCES user_profiles(id),
  entered_at            TIMESTAMPTZ DEFAULT NOW(),
  verified_by           UUID REFERENCES user_profiles(id),
  verified_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (expense_id IS NOT NULL OR grn_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vendor_receipts_expense ON vendor_receipts(expense_id);
CREATE INDEX IF NOT EXISTS idx_vendor_receipts_grn ON vendor_receipts(grn_id);
CREATE INDEX IF NOT EXISTS idx_vendor_receipts_vendor ON vendor_receipts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_receipts_status ON vendor_receipts(status);

CREATE OR REPLACE FUNCTION touch_vendor_receipts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_vendor_receipts_updated_at ON vendor_receipts;
CREATE TRIGGER trg_vendor_receipts_updated_at
  BEFORE UPDATE ON vendor_receipts
  FOR EACH ROW EXECUTE FUNCTION touch_vendor_receipts_updated_at();

-- ── Maker-checker ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_vendor_receipt_maker_checker()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_maker_role   TEXT;
  v_checker_role TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- entered_by is always the caller, never client-supplied — a
    -- COALESCE here would let a client claim someone else made the
    -- entry, defeating the whole point of tracking who the maker was.
    NEW.entered_by := auth.uid();
    NEW.entered_at := NOW();
    NEW.status := 'pending_verification';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('verified', 'rejected') AND OLD.status = 'pending_verification' THEN
    NEW.verified_by := auth.uid();
    NEW.verified_at := NOW();

    IF NEW.verified_by = NEW.entered_by THEN
      RAISE EXCEPTION 'The same person cannot both enter and verify a vendor receipt';
    END IF;

    SELECT role INTO v_maker_role FROM user_profiles WHERE id = NEW.entered_by;
    SELECT role INTO v_checker_role FROM user_profiles WHERE id = NEW.verified_by;

    IF NOT (
      (v_maker_role IN ('finance', 'admin') AND v_checker_role IN ('procurement_officer', 'admin'))
      OR (v_maker_role IN ('procurement_officer', 'admin') AND v_checker_role IN ('finance', 'admin'))
    ) THEN
      RAISE EXCEPTION 'A vendor receipt must be verified by someone from a different department than whoever entered it (one finance, one procurement)';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Invalid vendor receipt status transition from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_vendor_receipt_maker_checker ON vendor_receipts;
CREATE TRIGGER trg_enforce_vendor_receipt_maker_checker
  BEFORE INSERT OR UPDATE ON vendor_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_vendor_receipt_maker_checker();

-- ── Monthly VAT — the payoff of digitizing receipts at the point of
-- collection: VAT filing reads from the system instead of a manual
-- pile of paper. Verified receipts only — an unverified figure
-- shouldn't feed a tax filing. ──────────────────────────────────────
CREATE OR REPLACE VIEW v_monthly_vat_from_receipts
WITH (security_invoker = true) AS
SELECT
  TO_CHAR(receipt_date, 'YYYY-MM') AS month,
  count(*) AS receipt_count,
  SUM(vat_amount) AS total_vat,
  SUM(withholding_amount) AS total_withholding
FROM vendor_receipts
WHERE status = 'verified' AND receipt_date IS NOT NULL
GROUP BY TO_CHAR(receipt_date, 'YYYY-MM')
ORDER BY month;

GRANT SELECT ON v_monthly_vat_from_receipts TO authenticated;

-- ── RLS — mirrors the GRN read set (migration 063); write restricted
-- to the two departments actually doing this work, plus admin. ─────
ALTER TABLE vendor_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_receipts_read" ON vendor_receipts;
CREATE POLICY "vendor_receipts_read" ON vendor_receipts FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer'));

DROP POLICY IF EXISTS "vendor_receipts_insert" ON vendor_receipts;
CREATE POLICY "vendor_receipts_insert" ON vendor_receipts FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'finance', 'procurement_officer'));

DROP POLICY IF EXISTS "vendor_receipts_update" ON vendor_receipts;
CREATE POLICY "vendor_receipts_update" ON vendor_receipts FOR UPDATE
  USING (get_user_role() IN ('admin', 'finance', 'procurement_officer'));

-- Verify: table + trigger + view present.
SELECT tgname FROM pg_trigger WHERE tgrelid = 'vendor_receipts'::regclass AND NOT tgisinternal ORDER BY tgname;
SELECT count(*) AS vendor_receipts_count FROM vendor_receipts;
