-- 340 — Invoices come from payment requests, not straight from proformas
--
-- A proforma is the quote. What the client is actually billed for is a
-- share of it — 30% advance on signing, a progress payment, the balance on
-- handover — asked for in a payment request letter. Until now that letter
-- was printed and forgotten (nothing was saved), and "Convert to Invoice"
-- on a proforma billed its whole total at once, so an advance could not be
-- invoiced as an advance.
--
-- 1. client_payment_requests: a numbered request (CPR-YYYY-NNN) for a
--    percentage of a proforma, or of a contract. It remembers the basis it
--    was a share of, the percentage, the amount, the letter's details, and
--    which milestone it was for. Requests against one proforma or one
--    contract can't add up to more than its total.
-- 2. invoice_client_payment_request(): raises the invoice (a sale at
--    'Invoiced') for exactly the requested amount, linked back to the
--    request, the proforma and the contract. One invoice per request.
-- 3. KUN-2026-01's advance — invoice INV-2026-002, 30% of proforma
--    PI-2026-003 — is filed as the first request, so the proforma shows 30%
--    requested and invoiced.

SET search_path TO public;

-- ── 1. The request ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_payment_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number  text UNIQUE,
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  proforma_id     uuid REFERENCES proformas(id) ON DELETE SET NULL,
  contract_id     uuid REFERENCES contracts(id) ON DELETE SET NULL,
  milestone_id    uuid REFERENCES payment_milestones(id) ON DELETE SET NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  kind            text NOT NULL DEFAULT 'advance' CHECK (kind IN ('advance', 'progress', 'final', 'other')),
  request_date    date NOT NULL DEFAULT current_date,
  -- What the percentage is a share of: the proforma's total, or the
  -- contract's value (VAT included, as billed).
  basis_amount    numeric(18,2) NOT NULL CHECK (basis_amount > 0),
  percent         numeric(7,4) CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  title           text,
  previously_paid numeric(18,2) NOT NULL DEFAULT 0 CHECK (previously_paid >= 0),
  bank_name       text,
  account_number  text,
  account_name    text,
  notes           text,
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'invoiced', 'cancelled')),
  sale_id         uuid UNIQUE REFERENCES sales(id) ON DELETE SET NULL,
  cancelled_reason text,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_payment_requests_client_idx   ON client_payment_requests (client_id);
CREATE INDEX IF NOT EXISTS client_payment_requests_proforma_idx ON client_payment_requests (proforma_id);
CREATE INDEX IF NOT EXISTS client_payment_requests_contract_idx ON client_payment_requests (contract_id);

DROP TRIGGER IF EXISTS client_payment_requests_updated_at ON client_payment_requests;
CREATE TRIGGER client_payment_requests_updated_at BEFORE UPDATE ON client_payment_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Numbered like proformas (PI-YYYY-NNN): CPR-YYYY-NNN, by request year.
CREATE OR REPLACE FUNCTION generate_client_payment_request_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE yr text := to_char(COALESCE(NEW.request_date, current_date), 'YYYY'); v_next int;
BEGIN
  IF NEW.request_number IS NULL OR NEW.request_number = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('client_payment_request_number'));
    SELECT COALESCE(max(split_part(request_number, '-', 3)::int), 0) + 1 INTO v_next
    FROM client_payment_requests WHERE request_number ~ ('^CPR-' || yr || '-\d+$');
    NEW.request_number := 'CPR-' || yr || '-' || lpad(v_next::text, 3, '0');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_client_payment_request_number ON client_payment_requests;
CREATE TRIGGER trg_client_payment_request_number BEFORE INSERT ON client_payment_requests
  FOR EACH ROW EXECUTE FUNCTION generate_client_payment_request_number();

-- Neither the proforma nor the contract a request is against can be
-- requested past its total (1 birr of rounding allowed). Cancelled requests
-- don't count.
CREATE OR REPLACE FUNCTION check_client_payment_request_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total numeric; v_asked numeric; v_label text;
BEGIN
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF NEW.proforma_id IS NOT NULL THEN
    SELECT total, proforma_number INTO v_total, v_label FROM proformas WHERE id = NEW.proforma_id;
    SELECT COALESCE(sum(amount), 0) INTO v_asked FROM client_payment_requests
      WHERE proforma_id = NEW.proforma_id AND status <> 'cancelled' AND id <> NEW.id;
    IF v_total IS NOT NULL AND v_asked + NEW.amount > v_total + 1 THEN
      RAISE EXCEPTION 'Proforma % totals %; % is already requested, so at most % more can be asked for',
        v_label, v_total, v_asked, greatest(v_total - v_asked, 0);
    END IF;
  END IF;
  IF NEW.contract_id IS NOT NULL THEN
    SELECT contract_value, contract_no INTO v_total, v_label FROM contracts WHERE id = NEW.contract_id;
    SELECT COALESCE(sum(amount), 0) INTO v_asked FROM client_payment_requests
      WHERE contract_id = NEW.contract_id AND status <> 'cancelled' AND id <> NEW.id;
    IF v_total IS NOT NULL AND v_asked + NEW.amount > v_total + 1 THEN
      RAISE EXCEPTION 'Contract % is worth %; % is already requested, so at most % more can be asked for',
        v_label, v_total, v_asked, greatest(v_total - v_asked, 0);
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_check_client_payment_request_total ON client_payment_requests;
CREATE TRIGGER trg_check_client_payment_request_total
  BEFORE INSERT OR UPDATE OF amount, proforma_id, contract_id, status ON client_payment_requests
  FOR EACH ROW EXECUTE FUNCTION check_client_payment_request_total();

-- The same people who write proformas write requests.
ALTER TABLE client_payment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cpr_write ON client_payment_requests;
CREATE POLICY cpr_write ON client_payment_requests FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin', 'finance', 'executive']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'finance', 'executive']::user_role[]));
REVOKE ALL ON client_payment_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_payment_requests TO authenticated;

-- ── 2. The invoice comes from the request ───────────────────────────────
-- Runs with the caller's rights, so the sales permissions (admin, finance)
-- decide who can invoice.
CREATE OR REPLACE FUNCTION invoice_client_payment_request(p_request_id uuid, p_invoice_date date DEFAULT current_date)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r client_payment_requests%ROWTYPE; v_project uuid; v_sale uuid; v_desc text; v_pf text; v_con text;
BEGIN
  IF NOT COALESCE(get_user_role() IN ('admin', 'finance'), false) THEN
    RAISE EXCEPTION 'Only finance or an admin can raise an invoice';
  END IF;
  SELECT * INTO r FROM client_payment_requests WHERE id = p_request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Payment request % not found', p_request_id; END IF;
  IF r.status <> 'issued' THEN
    RAISE EXCEPTION 'Payment request % is %; only an issued request can be invoiced', r.request_number, r.status;
  END IF;

  SELECT proforma_number INTO v_pf FROM proformas WHERE id = r.proforma_id;
  SELECT contract_no INTO v_con FROM contracts WHERE id = r.contract_id;
  v_project := COALESCE(r.project_id,
    (SELECT project_id FROM contracts WHERE id = r.contract_id),
    (SELECT project_id FROM proformas WHERE id = r.proforma_id));
  v_desc := COALESCE(NULLIF(btrim(r.title), ''), initcap(r.kind) || ' payment')
    || CASE WHEN r.percent IS NOT NULL THEN ' (' || rtrim(rtrim(r.percent::text, '0'), '.') || '%'
         || COALESCE(' of ' || COALESCE(v_pf, v_con), '') || ')' ELSE '' END;

  INSERT INTO sales (sales_description, amount, date, sales_status, client_id, project_id,
                     contract_id, proforma_id, payment_method, notes, is_final_payment)
  VALUES (v_desc, r.amount, COALESCE(p_invoice_date, current_date), 'Invoiced', r.client_id, v_project,
          r.contract_id, r.proforma_id, 'Bank Transfer', 'From payment request ' || r.request_number,
          r.kind = 'final')
  RETURNING id INTO v_sale;

  UPDATE client_payment_requests SET status = 'invoiced', sale_id = v_sale WHERE id = r.id;
  -- The quote has been taken up once any of it is invoiced.
  UPDATE proformas SET status = 'converted', converted_sale_id = COALESCE(converted_sale_id, v_sale)
    WHERE id = r.proforma_id AND status <> 'converted';
  RETURN v_sale;
END; $$;
REVOKE ALL ON FUNCTION invoice_client_payment_request(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION invoice_client_payment_request(uuid, date) TO authenticated;

-- ── 3. File KUN-2026-01's advance as the first request ──────────────────
-- INV-2026-002 (6,813,267.13, 3 Aug) is exactly 30% of PI-2026-003
-- (22,710,890.43), the proforma for the same deal as KUN-2026-01. The
-- letter itself was never saved, so the request carries the invoice date.
INSERT INTO client_payment_requests (client_id, proforma_id, contract_id, milestone_id, project_id, kind,
  request_date, basis_amount, percent, amount, title, status, sale_id, notes)
SELECT s.client_id, p.id, c.id, m.id, c.project_id, 'advance',
  s.date, p.total, 30, s.amount, 'Advance payment', 'invoiced', s.id,
  'Filed from invoice ' || s.invoice_number || ' when payment requests started being saved; the original letter was not kept.'
FROM sales s
JOIN contracts c ON c.id = s.contract_id AND c.contract_no = 'KUN-2026-01'
JOIN proformas p ON p.proforma_number = 'PI-2026-003'
LEFT JOIN payment_milestones m ON m.contract_id = c.id AND m.kind = 'advance'
WHERE s.invoice_number = 'INV-2026-002'
  AND abs(p.total * 0.30 - s.amount) < 0.01
  AND NOT EXISTS (SELECT 1 FROM client_payment_requests x WHERE x.sale_id = s.id);

UPDATE sales s SET proforma_id = r.proforma_id
FROM client_payment_requests r
WHERE r.sale_id = s.id AND s.proforma_id IS NULL AND r.proforma_id IS NOT NULL;
