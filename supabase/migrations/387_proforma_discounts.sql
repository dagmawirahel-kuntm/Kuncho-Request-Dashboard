-- 387 — Discounts on proformas, with a second pair of eyes above a limit
--
-- A proforma can carry one discount on the whole job: a percentage or a
-- fixed amount in ETB, with a reason. VAT is charged on the price after the
-- discount, so the totals read:
--   lines_total        what the lines add up to
--   − discount_amount  the discount, in ETB before VAT
--   = subtotal         what VAT is charged on
--   + vat_amount
--   = total            what the client pays, and what payment requests and
--                      invoices are a share of
-- Existing proformas have no discount: lines_total = subtotal.
--
-- Above company_profile.discount_approval_percent (10 to start) the
-- discount needs approving by someone other than the person who set it —
-- admin, executive or finance, the roles that write proformas. Until then
-- the proforma can't be issued as a numbered copy, sent, accepted, invoiced
-- or have payment requested against it. Changing the discount clears an
-- earlier approval.
--
-- The database checks the arithmetic the page sends: subtotal is the lines
-- less the discount, and a percentage discount is that percentage of the
-- lines (to the cent).

SET search_path TO public;

-- ── The limit ────────────────────────────────────────────────────────────
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS discount_approval_percent numeric NOT NULL DEFAULT 10
  CHECK (discount_approval_percent BETWEEN 0 AND 100);

-- Finance edits the company profile too, but the limit is admin's or an
-- executive's to set — otherwise the people it checks could lift it.
CREATE OR REPLACE FUNCTION company_discount_limit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.discount_approval_percent IS DISTINCT FROM OLD.discount_approval_percent
     AND COALESCE(get_user_role()::text NOT IN ('admin', 'executive'), true)
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Only admin or an executive can change the discount approval limit';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_company_discount_limit_guard ON company_profile;
CREATE TRIGGER trg_company_discount_limit_guard BEFORE UPDATE ON company_profile
  FOR EACH ROW EXECUTE FUNCTION company_discount_limit_guard();

-- ── Discount on the proforma ─────────────────────────────────────────────
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS lines_total          numeric;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS discount_kind        text CHECK (discount_kind IN ('percent', 'amount'));
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS discount_value       numeric CHECK (discount_value >= 0);
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS discount_reason      text;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS discount_amount      numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS discount_set_by      uuid REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS discount_approved_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS discount_approved_at timestamptz;

UPDATE proformas SET lines_total = subtotal WHERE lines_total IS NULL;

-- The discount as a share of the lines, in percent.
CREATE OR REPLACE FUNCTION proforma_discount_percent(p proformas)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(p.lines_total, 0) > 0
              THEN round(COALESCE(p.discount_amount, 0) / p.lines_total * 100, 2)
              ELSE 0 END
$$;

-- True while the proforma's discount is over the limit and not approved.
CREATE OR REPLACE FUNCTION proforma_discount_needs_approval(p proformas)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(p.discount_amount, 0) > 0
     AND p.discount_approved_by IS NULL
     AND proforma_discount_percent(p) > COALESCE((SELECT discount_approval_percent FROM company_profile LIMIT 1), 10)
$$;
GRANT EXECUTE ON FUNCTION proforma_discount_percent(proformas) TO authenticated;
GRANT EXECUTE ON FUNCTION proforma_discount_needs_approval(proformas) TO authenticated;

CREATE OR REPLACE FUNCTION proforma_discount_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_changed boolean;
BEGIN
  NEW.lines_total     := COALESCE(NEW.lines_total, NEW.subtotal);
  NEW.discount_amount := COALESCE(NEW.discount_amount, 0);
  IF NEW.discount_amount = 0 THEN
    NEW.discount_kind := NULL; NEW.discount_value := NULL;
  END IF;

  -- The arithmetic the page sent.
  IF NEW.discount_amount > NEW.lines_total THEN
    RAISE EXCEPTION 'The discount (%) is more than the lines add up to (%)', NEW.discount_amount, NEW.lines_total;
  END IF;
  IF abs(NEW.subtotal - (NEW.lines_total - NEW.discount_amount)) > 0.01 THEN
    RAISE EXCEPTION 'Subtotal % should be the lines (%) less the discount (%)', NEW.subtotal, NEW.lines_total, NEW.discount_amount;
  END IF;
  IF NEW.discount_kind = 'percent' AND abs(NEW.discount_amount - round(NEW.lines_total * NEW.discount_value / 100, 2)) > 0.01 THEN
    RAISE EXCEPTION 'A % percent discount on % is %, not %', NEW.discount_value, NEW.lines_total,
      round(NEW.lines_total * NEW.discount_value / 100, 2), NEW.discount_amount;
  END IF;
  IF NEW.discount_amount > 0 AND COALESCE(btrim(NEW.discount_reason), '') = '' THEN
    RAISE EXCEPTION 'Say why the discount is given';
  END IF;

  -- Who set it; a changed discount needs approving again.
  v_changed := TG_OP = 'INSERT'
            OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
            OR NEW.discount_kind   IS DISTINCT FROM OLD.discount_kind
            OR NEW.discount_value  IS DISTINCT FROM OLD.discount_value
            OR NEW.lines_total     IS DISTINCT FROM OLD.lines_total;
  IF v_changed THEN
    NEW.discount_set_by := CASE WHEN NEW.discount_amount > 0 THEN v_uid END;
    NEW.discount_approved_by := NULL;
    NEW.discount_approved_at := NULL;
  ELSIF NEW.discount_approved_by IS DISTINCT FROM OLD.discount_approved_by THEN
    -- Approving (or withdrawing an approval).
    IF NEW.discount_approved_by IS NOT NULL THEN
      IF NEW.discount_approved_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'You can only approve a discount as yourself';
      END IF;
      IF v_uid = NEW.discount_set_by THEN
        RAISE EXCEPTION 'Someone other than the person who set the discount has to approve it';
      END IF;
      IF COALESCE(get_user_role()::text NOT IN ('admin', 'executive', 'finance'), true) THEN
        RAISE EXCEPTION 'Only admin, executive or finance can approve a discount';
      END IF;
      NEW.discount_approved_at := now();
    ELSE
      NEW.discount_approved_at := NULL;
    END IF;
  END IF;

  -- Over the limit and not approved: it stays a draft.
  IF proforma_discount_needs_approval(NEW) THEN
    IF NEW.status IN ('sent', 'accepted', 'converted')
       AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'The % discount needs approving before the proforma is %', trim_scale(proforma_discount_percent(NEW)) || '%', NEW.status;
    END IF;
    IF NEW.sent_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.sent_at IS NULL) THEN
      RAISE EXCEPTION 'The % discount needs approving before the proforma is sent', trim_scale(proforma_discount_percent(NEW)) || '%';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_proforma_discount_guard ON proformas;
CREATE TRIGGER trg_proforma_discount_guard BEFORE INSERT OR UPDATE ON proformas
  FOR EACH ROW EXECUTE FUNCTION proforma_discount_guard();

-- No numbered copy (print / PDF / share, with its QR check) until approved.
CREATE OR REPLACE FUNCTION issued_document_discount_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE p proformas%ROWTYPE;
BEGIN
  IF NEW.doc_type = 'proforma' THEN
    SELECT * INTO p FROM proformas WHERE id = NEW.source_id;
    IF FOUND AND proforma_discount_needs_approval(p) THEN
      RAISE EXCEPTION 'The % discount on this proforma needs approving before it is issued', trim_scale(proforma_discount_percent(p)) || '%';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_issued_document_discount_guard ON issued_documents;
CREATE TRIGGER trg_issued_document_discount_guard BEFORE INSERT ON issued_documents
  FOR EACH ROW EXECUTE FUNCTION issued_document_discount_guard();

-- No payment requests against it until approved either.
CREATE OR REPLACE FUNCTION payment_request_discount_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE p proformas%ROWTYPE;
BEGIN
  IF NEW.proforma_id IS NOT NULL THEN
    SELECT * INTO p FROM proformas WHERE id = NEW.proforma_id;
    IF FOUND AND proforma_discount_needs_approval(p) THEN
      RAISE EXCEPTION 'The % discount on this proforma needs approving before payment is requested', trim_scale(proforma_discount_percent(p)) || '%';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payment_request_discount_guard ON client_payment_requests;
CREATE TRIGGER trg_payment_request_discount_guard BEFORE INSERT ON client_payment_requests
  FOR EACH ROW EXECUTE FUNCTION payment_request_discount_guard();

-- Discounts given, for the Proformas page: live versions only (not the
-- ones a revision replaced), newest first. Reads through proformas' RLS.
CREATE OR REPLACE VIEW v_proforma_discounts WITH (security_invoker = true) AS
SELECT p.id, p.proforma_number, p.date, p.status, p.client_id, c.client_name,
       p.lines_total, p.discount_kind, p.discount_value, p.discount_amount,
       proforma_discount_percent(p) AS discount_percent, p.discount_reason,
       p.discount_set_by, sb.full_name AS discount_set_by_name,
       p.discount_approved_by, ab.full_name AS discount_approved_by_name, p.discount_approved_at,
       proforma_discount_needs_approval(p) AS needs_approval,
       p.total
  FROM proformas p
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN user_profiles sb ON sb.id = p.discount_set_by
  LEFT JOIN user_profiles ab ON ab.id = p.discount_approved_by
 WHERE p.discount_amount > 0 AND p.status <> 'superseded';

REVOKE ALL ON v_proforma_discounts FROM anon;
GRANT SELECT ON v_proforma_discounts TO authenticated;
