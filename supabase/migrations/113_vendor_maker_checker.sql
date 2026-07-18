-- ============================================================
-- Maker-checker on the vendor database — the same discipline as
-- vendor receipts (migration 112), applied to what makes the vendor
-- database itself trustworthy: TIN and bank details are where payment
-- fraud lives, and they shouldn't be changeable by one person alone.
--
-- Grandfathered: the existing 439 vendors predate this control —
-- retroactively demanding a second sign-off on rows nobody flagged a
-- problem with is busywork, not a real control. They default to
-- 'verified' (via the new column's own DEFAULT, applied by ALTER
-- TABLE to every existing row) with entered_by/entered_at left NULL —
-- expected and permitted for historical records, same shape as every
-- other FY-bridge grandfather in this project, just keyed on "existed
-- before this migration" rather than a fiscal-year boundary, since a
-- vendor record has no natural transaction date to gate on.
-- ============================================================

SET search_path TO public;

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'verified'
  CHECK (verification_status IN ('pending_verification', 'verified'));
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS entered_by  UUID REFERENCES user_profiles(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS entered_at  TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES user_profiles(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION enforce_vendor_maker_checker()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.entered_by := auth.uid();
    NEW.entered_at := NOW();
    NEW.verification_status := 'pending_verification';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    RETURN NEW;
  END IF;

  -- TIN or bank details changed — the fraud-sensitive fields, per the
  -- confirmed scope. Resets to pending_verification regardless of who
  -- is editing or what the prior status was; entered_by/entered_at
  -- re-stamp to THIS edit, since it's this edit's figures that need
  -- their own maker-checker pass, not the original creation's.
  IF NEW.tin IS DISTINCT FROM OLD.tin OR NEW.bank_account IS DISTINCT FROM OLD.bank_account THEN
    NEW.verification_status := 'pending_verification';
    NEW.entered_by := auth.uid();
    NEW.entered_at := NOW();
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_vendor_maker_checker ON vendors;
CREATE TRIGGER trg_enforce_vendor_maker_checker
  BEFORE INSERT OR UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION enforce_vendor_maker_checker();

-- ── Verify: a different person, a different department ─────────────
CREATE OR REPLACE FUNCTION verify_vendor_record(p_vendor_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vendor       RECORD;
  v_maker_role   TEXT;
  v_checker_role TEXT;
BEGIN
  SELECT * INTO v_vendor FROM vendors WHERE id = p_vendor_id;
  IF v_vendor IS NULL THEN
    RAISE EXCEPTION 'Vendor not found';
  END IF;
  IF v_vendor.verification_status <> 'pending_verification' THEN
    RAISE EXCEPTION 'Vendor % is not pending verification (status = %)', p_vendor_id, v_vendor.verification_status;
  END IF;
  IF v_vendor.entered_by IS NULL THEN
    RAISE EXCEPTION 'Vendor % has no recorded maker to check against — grandfathered record, nothing to verify', p_vendor_id;
  END IF;
  IF auth.uid() = v_vendor.entered_by THEN
    RAISE EXCEPTION 'The same person cannot both enter/edit and verify a vendor record';
  END IF;

  SELECT role INTO v_maker_role FROM user_profiles WHERE id = v_vendor.entered_by;
  SELECT role INTO v_checker_role FROM user_profiles WHERE id = auth.uid();

  IF NOT (
    (v_maker_role IN ('finance', 'admin') AND v_checker_role IN ('procurement_officer', 'admin'))
    OR (v_maker_role IN ('procurement_officer', 'admin') AND v_checker_role IN ('finance', 'admin'))
  ) THEN
    RAISE EXCEPTION 'Verifier must be from a different department than whoever entered/edited the vendor record (one finance, one procurement)';
  END IF;

  UPDATE vendors SET verification_status = 'verified', verified_by = auth.uid(), verified_at = NOW() WHERE id = p_vendor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_vendor_record(UUID) TO authenticated;

-- Verify: existing vendors grandfathered as verified; trigger + RPC present.
SELECT verification_status, count(*) FROM vendors GROUP BY verification_status;
SELECT count(*) AS grandfathered_with_null_maker FROM vendors WHERE verification_status = 'verified' AND entered_by IS NULL;
SELECT tgname FROM pg_trigger WHERE tgrelid = 'vendors'::regclass AND tgname = 'trg_enforce_vendor_maker_checker';
SELECT proname FROM pg_proc WHERE proname = 'verify_vendor_record';
