-- 455: Engagements paid by many clients, and what clients keep back.
--
-- Built from closing Meskerem 2019 (EFF 2026: some 50 exhibitors paying a
-- booth package by bank transfer, plus government clients):
--
-- 1. What a client keeps back is no longer one number. Matching a payment
--    splits the shortfall into
--      · income tax withheld (3% of the pre-VAT amount, or as the contract
--        says) — a credit against profit tax, kept in WHT receivable;
--      · VAT withheld — government bodies keep 7.5% of the pre-VAT amount
--        (half the VAT) and pay it to the revenue office; it comes off the
--        VAT the return owes;
--      · a transfer charge — RTGS fees the payer's bank deducted (up to
--        500); a bank charge;
--      · anything beyond that stays owed by the client.
--    Each client has a withholding profile (none / income tax / government;
--    unset follows the business type). The split is automatic and a person
--    can correct it (set_sale_withholding). The ledger follows through an
--    adjusting entry, so payments posted before this migration are split too.
--
-- 2. The VAT position shows VAT withheld by clients and the VAT left to pay.
--
-- 3. Packages: a project can have priced packages (a booth, a sponsorship
--    tier). package_receipt_lines lists money in that fits a package under
--    any withholding profile; record_sale_from_bank_line records the sale
--    and matches it in one step (or matches an open invoice);
--    create_package_invoices invoices a list of clients at once.
--
-- 4. Money received by mistake can be explained as "Refund owed" (a
--    liability, 2060), and the refund paid out against it.

-- ── 1. Withholding profile ───────────────────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_profile text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_withholding_profile_check') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_withholding_profile_check
      CHECK (withholding_profile IN ('none', 'income_tax', 'government'));
  END IF;
END $$;
COMMENT ON COLUMN clients.withholding_profile IS
  'What this client keeps back when paying: none, income_tax (3% WHT), government (3% WHT + VAT withheld). NULL follows business_type.';

CREATE OR REPLACE FUNCTION public.client_withholding_profile(p_client_id uuid)
 RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT COALESCE(c.withholding_profile, CASE WHEN c.business_type = 'Government' THEN 'government' ELSE 'income_tax' END)
    FROM clients c WHERE c.id = p_client_id
$$;

-- Government withholding agents keep half the VAT: 7.5% of the pre-VAT
-- amount at the 15% rate. A 'withholding_rate' in the VAT rate note wins.
CREATE OR REPLACE FUNCTION public.vat_withholding_rate(p_date date)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT COALESCE((tax_rate_note('VAT', p_date) ->> 'withholding_rate')::numeric,
                  (tax_rate_note('VAT', p_date) ->> 'standard_rate')::numeric / 2, 0.075)
$$;

-- The most a payer's bank is taken to deduct as a transfer charge.
CREATE OR REPLACE FUNCTION public.receipt_charge_tolerance()
 RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 500::numeric $$;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS income_tax_withheld numeric,
  ADD COLUMN IF NOT EXISTS vat_withheld numeric,
  ADD COLUMN IF NOT EXISTS receipt_charge numeric,
  ADD COLUMN IF NOT EXISTS receipt_shortfall numeric,
  ADD COLUMN IF NOT EXISTS withholding_set_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS withholding_note text,
  ADD COLUMN IF NOT EXISTS package_id uuid;
COMMENT ON COLUMN sales.withheld_by_client IS
  'What the client kept back for a known reason: income_tax_withheld + vat_withheld + receipt_charge. An unexplained shortfall (receipt_shortfall) stays owed.';

-- What a client of this profile is expected to keep back from a sale.
CREATE OR REPLACE FUNCTION public.sale_expected_withholding(
  p_amount numeric, p_date date, p_vat_exempt boolean, p_contract_id uuid, p_is_final boolean, p_client_id uuid)
 RETURNS TABLE(profile text, ex_vat numeric, income_tax numeric, vat_withheld numeric)
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE d date := COALESCE(p_date, CURRENT_DATE); v_vat numeric; v_wht numeric; v_thr numeric; v_mode text; b record;
BEGIN
  profile := COALESCE(client_withholding_profile(p_client_id), 'income_tax');
  v_vat := COALESCE((tax_rate_note('VAT', d) ->> 'standard_rate')::numeric, 0.15);
  ex_vat := round(CASE WHEN COALESCE(p_vat_exempt, false) THEN COALESCE(p_amount, 0)
                       ELSE COALESCE(p_amount, 0) / (1 + v_vat) END, 2);
  income_tax := 0; vat_withheld := 0;
  IF profile <> 'none' THEN
    IF p_contract_id IS NOT NULL THEN
      SELECT * INTO b FROM contract_wht_basis(p_contract_id);
      SELECT wht_deduction_mode INTO v_mode FROM contracts WHERE id = p_contract_id;
      IF COALESCE(b.wht_applies, false) THEN
        income_tax := CASE WHEN v_mode = 'final_only'
                           THEN CASE WHEN COALESCE(p_is_final, false) THEN round(b.base_ex_vat * b.rate_fraction, 2) ELSE 0 END
                           ELSE round(ex_vat * b.rate_fraction, 2) END;
      END IF;
    ELSE
      v_wht := COALESCE((tax_rate_note('WHT', d) ->> 'rate')::numeric, 0.03);
      v_thr := COALESCE((tax_rate_note('WHT', d) ->> 'client_contract_threshold_etb')::numeric, 0);
      IF ex_vat >= v_thr THEN income_tax := round(ex_vat * v_wht, 2); END IF;
    END IF;
  END IF;
  IF profile = 'government' AND NOT COALESCE(p_vat_exempt, false) THEN
    vat_withheld := round(ex_vat * vat_withholding_rate(d), 2);
  END IF;
  RETURN NEXT;
END $function$;

-- Splits a shortfall: income tax first, then VAT withheld, then a transfer
-- charge up to the tolerance; anything more is still owed.
CREATE OR REPLACE FUNCTION public.sale_receipt_split(p_shortfall numeric, p_income_tax numeric, p_vat_withheld numeric)
 RETURNS TABLE(income_tax numeric, vat_withheld numeric, charge numeric, open_shortfall numeric)
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE rem numeric := GREATEST(round(COALESCE(p_shortfall, 0), 2), 0);
BEGIN
  income_tax := 0; vat_withheld := 0; charge := 0; open_shortfall := 0;
  -- A difference of a birr or less is rounding (as match_sale_to_transfer).
  IF rem > 1 THEN
    income_tax := LEAST(rem, GREATEST(COALESCE(p_income_tax, 0), 0)); rem := rem - income_tax;
    vat_withheld := LEAST(rem, GREATEST(COALESCE(p_vat_withheld, 0), 0)); rem := rem - vat_withheld;
    IF rem <= receipt_charge_tolerance() THEN charge := rem; ELSE open_shortfall := rem; END IF;
  END IF;
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_sale_withholding_split()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e record; s record;
BEGIN
  IF NEW.amount_received IS NULL THEN
    NEW.income_tax_withheld := NULL; NEW.vat_withheld := NULL; NEW.receipt_charge := NULL;
    NEW.receipt_shortfall := NULL; NEW.withholding_set_by := NULL;
    RETURN NEW;
  END IF;
  IF NEW.withholding_set_by IS NOT NULL THEN RETURN NEW; END IF;   -- set by a person
  IF TG_OP = 'UPDATE' AND NEW.income_tax_withheld IS NOT NULL
     AND NEW.amount_received IS NOT DISTINCT FROM OLD.amount_received AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id AND NEW.contract_id IS NOT DISTINCT FROM OLD.contract_id
     AND NEW.is_final_payment IS NOT DISTINCT FROM OLD.is_final_payment AND NEW.is_vat_exempt IS NOT DISTINCT FROM OLD.is_vat_exempt THEN
    RETURN NEW;
  END IF;
  SELECT * INTO e FROM sale_expected_withholding(NEW.amount, NEW.date, NEW.is_vat_exempt, NEW.contract_id, NEW.is_final_payment, NEW.client_id);
  SELECT * INTO s FROM sale_receipt_split(COALESCE(NEW.amount, 0) - NEW.amount_received, e.income_tax, e.vat_withheld);
  NEW.income_tax_withheld := s.income_tax;
  NEW.vat_withheld := s.vat_withheld;
  NEW.receipt_charge := s.charge;
  NEW.receipt_shortfall := s.open_shortfall;
  NEW.withheld_by_client := s.income_tax + s.vat_withheld + s.charge;
  RETURN NEW;
END $function$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sale_withholding_split' AND tgrelid = 'sales'::regclass) THEN
    EXECUTE 'CREATE TRIGGER trg_sale_withholding_split BEFORE INSERT OR UPDATE ON sales
             FOR EACH ROW EXECUTE FUNCTION trg_sale_withholding_split()';
  END IF;
END $$;

-- The payment entry debits WHT receivable with everything the client kept
-- back. This adjusting entry moves what is not income tax to where it
-- belongs: VAT withheld off VAT payable, the transfer charge to bank
-- charges, and an unexplained shortfall back to what the client owes.
CREATE OR REPLACE FUNCTION public.sync_sale_receipt_split(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s sales%ROWTYPE; v_posted numeric := 0; v_lines jsonb := '[]'::jsonb; v_owed numeric;
BEGIN
  SELECT * INTO s FROM sales WHERE id = p_id;
  SELECT COALESCE(sum(l.debit - l.credit), 0) INTO v_posted
    FROM journal_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
   WHERE je.source_table = 'sales' AND je.source_id = p_id AND l.account_id = coa_id('wht_receivable');
  IF s.id IS NOT NULL AND s.sales_status = 'Paid' AND v_posted > 0 AND s.income_tax_withheld IS NOT NULL THEN
    v_owed := v_posted - s.income_tax_withheld - COALESCE(s.vat_withheld, 0) - COALESCE(s.receipt_charge, 0);
    v_lines := jsonb_build_array(
      ledger_line(coa_id('wht_receivable'), -(v_posted - s.income_tax_withheld), 'Kept back, but not income tax', s.project_id),
      ledger_line(coa_id('vat_payable'), COALESCE(s.vat_withheld, 0), 'VAT withheld by the client', s.project_id),
      ledger_line(coa_id('bank_charges'), COALESCE(s.receipt_charge, 0), 'Transfer charge taken from the payment', s.project_id),
      ledger_line(coa_id('ar'), v_owed, 'Short-paid: still owed', s.project_id, NULL, s.client_id));
  END IF;
  PERFORM ledger_sync('sale_receipt_split', p_id, COALESCE(s.payment_date, s.date, CURRENT_DATE),
                      'What the client kept back: ' || COALESCE(s.invoice_number, 'sale'), v_lines, 'adjusting');
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('sales', p_id, 'Splitting what the client kept back: ' || SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_zz_sale_receipt_split()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM sync_sale_receipt_split(NEW.id);
  RETURN NULL;
END $function$;

-- Named to fire after trg_post_sale_payment_to_ledger.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_sale_receipt_split' AND tgrelid = 'sales'::regclass) THEN
    EXECUTE 'CREATE TRIGGER trg_zz_sale_receipt_split AFTER INSERT OR UPDATE ON sales
             FOR EACH ROW EXECUTE FUNCTION trg_zz_sale_receipt_split()';
  END IF;
END $$;

-- A person corrects the split (e.g. withholding taken on the whole contract
-- at the final payment). NULL income tax goes back to the automatic split.
CREATE OR REPLACE FUNCTION public.set_sale_withholding(
  p_sale_id uuid, p_income_tax numeric, p_vat_withheld numeric DEFAULT 0, p_charge numeric DEFAULT 0, p_note text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s sales%ROWTYPE; v_short numeric; v_sum numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can change what a client kept back';
  END IF;
  SELECT * INTO s FROM sales WHERE id = p_sale_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF s.amount_received IS NULL THEN RAISE EXCEPTION 'No payment is matched to this sale yet'; END IF;
  IF p_income_tax IS NULL THEN
    UPDATE sales SET withholding_set_by = NULL, withholding_note = NULL, income_tax_withheld = NULL WHERE id = p_sale_id;
    RETURN;
  END IF;
  v_short := round(COALESCE(s.amount, 0) - s.amount_received, 2);
  v_sum := round(GREATEST(p_income_tax, 0) + GREATEST(COALESCE(p_vat_withheld, 0), 0) + GREATEST(COALESCE(p_charge, 0), 0), 2);
  IF v_sum > v_short + 0.01 THEN
    RAISE EXCEPTION 'That is % kept back, but the client paid only % less than the invoice', v_sum, v_short;
  END IF;
  UPDATE sales SET income_tax_withheld = round(GREATEST(p_income_tax, 0), 2),
                   vat_withheld = round(GREATEST(COALESCE(p_vat_withheld, 0), 0), 2),
                   receipt_charge = round(GREATEST(COALESCE(p_charge, 0), 0), 2),
                   receipt_shortfall = GREATEST(v_short - v_sum, 0),
                   withheld_by_client = v_sum,
                   withholding_set_by = auth.uid(),
                   withholding_note = NULLIF(btrim(p_note), '')
   WHERE id = p_sale_id;
END $function$;
GRANT EXECUTE ON FUNCTION public.set_sale_withholding(uuid, numeric, numeric, numeric, text) TO authenticated;

-- ── 2. VAT withheld by clients, by the month it was withheld ─────────────
CREATE OR REPLACE VIEW v_vat_withheld_by_ec_period AS
SELECT tp.ec_year, tp.ec_month, count(*) AS sale_count, sum(s.vat_withheld) AS vat_withheld
  FROM sales s
  CROSS JOIN LATERAL tax_period_for_date(COALESCE(s.payment_date, s.date)) tp(ec_year, ec_month)
 WHERE COALESCE(s.vat_withheld, 0) > 0 AND NOT COALESCE(s.is_archived, false) AND NOT s.carried_forward
 GROUP BY tp.ec_year, tp.ec_month;

CREATE OR REPLACE VIEW v_vat_position_by_ec_period AS
 SELECT p.ec_year,
    p.ec_month,
    (ec_month_name(p.ec_month) || ' '::text) || p.ec_year AS period_label,
    b.start_greg AS period_start_greg,
    b.end_greg AS period_end_greg,
    COALESCE(o.output_vat, 0::numeric) AS output_vat,
    COALESCE(i.input_vat, 0::numeric) AS input_vat_reclaimable,
    COALESCE(o.output_vat, 0::numeric) - COALESCE(i.input_vat, 0::numeric) AS net_vat,
        CASE
            WHEN (COALESCE(o.output_vat, 0::numeric) - COALESCE(i.input_vat, 0::numeric)) >= 0::numeric THEN 'payable'::text
            ELSE 'reclaimable'::text
        END AS "position",
    COALESCE(o.sale_count, 0::bigint) AS sale_count,
    COALESCE(i.receipt_count, 0::bigint) AS reviewed_receipt_count,
    f.id AS vat_filing_id,
    f.status AS vat_filing_status,
    COALESCE(i.input_vat_pending_review, 0::numeric) AS input_vat_pending_review,
    COALESCE(i.pending_review_count, 0::bigint) AS pending_review_count,
    COALESCE(i.input_vat_in_review, 0::numeric) AS input_vat_in_review,
    COALESCE(i.in_review_count, 0::bigint) AS in_review_count,
    COALESCE(i.input_vat_needs_receipt, 0::numeric) AS input_vat_needs_receipt,
    COALESCE(i.needs_receipt_count, 0::bigint) AS needs_receipt_count,
    COALESCE(o.output_vat, 0::numeric) - COALESCE(i.input_vat, 0::numeric) - COALESCE(i.input_vat_in_review, 0::numeric) - COALESCE(i.input_vat_needs_receipt, 0::numeric) AS net_vat_if_all_claimed,
    ((p.ec_year, p.ec_month) = ( SELECT cp.ec_year,
            cp.ec_month
           FROM tax_period_for_date(CURRENT_DATE) cp(ec_year, ec_month))) AS is_current,
    COALESCE(w.vat_withheld, 0::numeric) AS vat_withheld_by_clients,
    COALESCE(o.output_vat, 0::numeric) - COALESCE(i.input_vat, 0::numeric) - COALESCE(w.vat_withheld, 0::numeric) AS net_vat_after_withheld
   FROM ( SELECT v_vat_output_by_ec_period.ec_year,
            v_vat_output_by_ec_period.ec_month
           FROM v_vat_output_by_ec_period
        UNION
         SELECT v_vat_input_by_ec_period.ec_year,
            v_vat_input_by_ec_period.ec_month
           FROM v_vat_input_by_ec_period
        UNION
         SELECT v_vat_withheld_by_ec_period.ec_year,
            v_vat_withheld_by_ec_period.ec_month
           FROM v_vat_withheld_by_ec_period
        UNION
         SELECT cp.ec_year,
            cp.ec_month
           FROM tax_period_for_date(CURRENT_DATE) cp(ec_year, ec_month)) p
     CROSS JOIN LATERAL tax_period_bounds(p.ec_year, p.ec_month) b(start_greg, end_greg)
     LEFT JOIN v_vat_output_by_ec_period o USING (ec_year, ec_month)
     LEFT JOIN v_vat_input_by_ec_period i USING (ec_year, ec_month)
     LEFT JOIN v_vat_withheld_by_ec_period w USING (ec_year, ec_month)
     LEFT JOIN tax_filings f ON f.schedule_code = 'VAT'::text AND f.period_ec_year = p.ec_year AND f.period_ec_month = p.ec_month;

-- ── 3. Packages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_packages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  net_amount  numeric NOT NULL CHECK (net_amount > 0),
  vat_exempt  boolean NOT NULL DEFAULT false,
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid DEFAULT auth.uid() REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_packages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_packages' AND policyname = 'pp_read') THEN
    CREATE POLICY pp_read ON project_packages FOR SELECT
      USING (get_user_role()::text IN ('admin', 'finance', 'executive'));
    CREATE POLICY pp_write ON project_packages FOR ALL
      USING (get_user_role()::text IN ('admin', 'finance'))
      WITH CHECK (get_user_role()::text IN ('admin', 'finance'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_package_id_fkey') THEN
    ALTER TABLE sales ADD CONSTRAINT sales_package_id_fkey FOREIGN KEY (package_id) REFERENCES project_packages(id) ON DELETE SET NULL;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_packages TO authenticated;

CREATE OR REPLACE FUNCTION public.package_gross(p_net numeric, p_vat_exempt boolean, p_date date)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT round(p_net * (1 + CASE WHEN p_vat_exempt THEN 0
                                 ELSE COALESCE((tax_rate_note('VAT', COALESCE(p_date, CURRENT_DATE)) ->> 'standard_rate')::numeric, 0.15) END), 2)
$$;

-- Money in over a date range that is not reconciled yet, each with the
-- package and withholding profile it fits best (if any): package gross,
-- less what that kind of client keeps back, less up to the transfer-charge
-- tolerance.
CREATE OR REPLACE FUNCTION public.package_receipt_lines(p_project_id uuid, p_from date, p_to date)
 RETURNS TABLE(line_id uuid, value_date date, account_id uuid, account_name text, narration text, reference text,
               amount numeric, package_id uuid, package_name text, gross numeric, profile text, expected numeric, charge numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_wht numeric; v_thr numeric; v_vw numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  v_wht := COALESCE((tax_rate_note('WHT', p_from) ->> 'rate')::numeric, 0.03);
  v_thr := COALESCE((tax_rate_note('WHT', p_from) ->> 'client_contract_threshold_etb')::numeric, 0);
  v_vw := vat_withholding_rate(p_from);
  RETURN QUERY
  WITH lines AS (
    SELECT l.line_id, l.value_date, l.account_id, a.account_name, l.narration, COALESCE(l.reference_code, l.reference) AS ref, l.amount
      FROM v_bank_line_status l LEFT JOIN accounts a ON a.id = l.account_id
     WHERE l.direction = 'credit' AND l.reconciled_as IS NULL AND l.value_date BETWEEN p_from AND p_to
  ),
  pk AS (
    SELECT p.id, p.name, p.net_amount, p.vat_exempt, package_gross(p.net_amount, p.vat_exempt, p_from) AS gross
      FROM project_packages p WHERE p.project_id = p_project_id AND p.active
  ),
  opts AS (
    SELECT pk.*, pr.profile,
           round(pk.gross
             - CASE WHEN pr.profile <> 'none' AND pk.net_amount >= v_thr THEN round(pk.net_amount * v_wht, 2) ELSE 0 END
             - CASE WHEN pr.profile = 'government' AND NOT pk.vat_exempt THEN round(pk.net_amount * v_vw, 2) ELSE 0 END, 2) AS expected
      FROM pk CROSS JOIN (VALUES ('none'), ('income_tax'), ('government')) pr(profile)
  ),
  best AS (
    SELECT DISTINCT ON (ln.line_id) ln.line_id, o.id AS pid, o.name, o.gross, o.profile, o.expected,
           round(o.expected - ln.amount, 2) AS diff
      FROM lines ln JOIN opts o ON o.expected - ln.amount BETWEEN -1 AND receipt_charge_tolerance()
     ORDER BY ln.line_id, abs(o.expected - ln.amount)
  )
  SELECT ln.line_id, ln.value_date, ln.account_id, ln.account_name, ln.narration, ln.ref, ln.amount,
         b.pid, b.name, b.gross, b.profile, b.expected, CASE WHEN b.diff > 1 THEN b.diff ELSE 0 END
    FROM lines ln LEFT JOIN best b ON b.line_id = ln.line_id
   ORDER BY (b.pid IS NULL), ln.value_date, ln.amount DESC;
END $function$;
GRANT EXECUTE ON FUNCTION public.package_receipt_lines(uuid, date, date) TO authenticated;

-- Record a sale from a bank line and match it, or match an open invoice.
CREATE OR REPLACE FUNCTION public.record_sale_from_bank_line(
  p_line_id uuid, p_client_id uuid, p_project_id uuid, p_amount numeric,
  p_description text DEFAULT NULL, p_package_id uuid DEFAULT NULL, p_sale_id uuid DEFAULT NULL,
  p_is_final boolean DEFAULT false, p_note text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; s sales%ROWTYPE; pk project_packages%ROWTYPE; v_id uuid; v_amount numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can record a payment';
  END IF;
  SELECT * INTO l FROM v_bank_line_status WHERE v_bank_line_status.line_id = p_line_id;
  IF l.line_id IS NULL THEN RAISE EXCEPTION 'Bank line not found'; END IF;
  IF l.direction <> 'credit' THEN RAISE EXCEPTION 'Only money coming in can pay a sale'; END IF;
  IF l.reconciled_as IS NOT NULL THEN RAISE EXCEPTION 'This bank line is already reconciled (%)', l.reconciled_as; END IF;

  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO s FROM sales WHERE id = p_sale_id;
    IF s.id IS NULL OR s.transfer_id IS NOT NULL OR s.sales_status NOT IN ('Draft', 'Invoiced') THEN
      RAISE EXCEPTION 'That sale is not open for a payment';
    END IF;
    v_id := s.id;
  ELSE
    IF p_client_id IS NULL THEN RAISE EXCEPTION 'Pick the client who paid'; END IF;
    IF p_package_id IS NOT NULL THEN
      SELECT * INTO pk FROM project_packages WHERE id = p_package_id;
      IF pk.id IS NULL THEN RAISE EXCEPTION 'Package not found'; END IF;
    END IF;
    v_amount := COALESCE(p_amount, CASE WHEN pk.id IS NOT NULL THEN package_gross(pk.net_amount, pk.vat_exempt, l.value_date) END);
    IF COALESCE(v_amount, 0) <= 0 THEN RAISE EXCEPTION 'Give the invoice amount (before anything the client kept back)'; END IF;
    INSERT INTO sales (sales_description, product_or_service, sales_status, date, amount, client_id, project_id,
                       account_id, bank_ref, payment_method, is_final_payment, package_id, is_vat_exempt, notes)
    VALUES (COALESCE(NULLIF(btrim(p_description), ''), pk.name, 'Payment received'), COALESCE(pk.name, NULLIF(btrim(p_description), '')),
            'Invoiced', l.value_date, round(v_amount, 2), p_client_id, COALESCE(p_project_id, pk.project_id),
            l.account_id, COALESCE(l.reference_code, l.reference), 'Bank transfer', COALESCE(p_is_final, false), pk.id,
            COALESCE(pk.vat_exempt, false),
            'Recorded from the bank: ' || to_char(l.amount, 'FM999,999,999,990.00') || ' received ' || to_char(l.value_date, 'DD Mon YYYY')
              || COALESCE(' (' || COALESCE(l.reference_code, l.reference) || ')', '') || '.' || COALESCE(' ' || NULLIF(btrim(p_note), ''), ''))
    RETURNING id INTO v_id;
  END IF;
  PERFORM match_sale_to_statement_line(p_line_id, v_id);
  RETURN v_id;
END $function$;
GRANT EXECUTE ON FUNCTION public.record_sale_from_bank_line(uuid, uuid, uuid, numeric, text, uuid, uuid, boolean, text) TO authenticated;

-- Invoice a list of clients for a package at once (clients who already have
-- a sale for this package are skipped). Returns how many were invoiced.
CREATE OR REPLACE FUNCTION public.create_package_invoices(
  p_package_id uuid, p_client_ids uuid[], p_date date DEFAULT NULL, p_note text DEFAULT NULL)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pk project_packages%ROWTYPE; c uuid; n integer := 0; d date := COALESCE(p_date, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date);
BEGIN
  IF get_user_role() IS NULL OR get_user_role()::text NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can invoice';
  END IF;
  SELECT * INTO pk FROM project_packages WHERE id = p_package_id;
  IF pk.id IS NULL THEN RAISE EXCEPTION 'Package not found'; END IF;
  FOREACH c IN ARRAY COALESCE(p_client_ids, '{}') LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM sales s WHERE s.package_id = pk.id AND s.client_id = c
                            AND s.sales_status IS DISTINCT FROM 'Cancelled' AND NOT COALESCE(s.is_archived, false));
    INSERT INTO sales (sales_description, product_or_service, sales_status, date, amount, client_id, project_id,
                       payment_method, package_id, is_vat_exempt, notes)
    VALUES (pk.name, pk.name, 'Invoiced', d, package_gross(pk.net_amount, pk.vat_exempt, d), c, pk.project_id,
            'Bank transfer', pk.id, pk.vat_exempt, NULLIF(btrim(p_note), ''));
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;
GRANT EXECUTE ON FUNCTION public.create_package_invoices(uuid, uuid[], date, text) TO authenticated;

-- ── 4. Money received by mistake ─────────────────────────────────────────
INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section, system_key, description)
SELECT '2060', 'Refunds owed', 'Liability', ca.parent_account_id, true, true, 'operating', 'refunds_owed',
       'Money received by mistake (a wrong payer, a double payment) until it is paid back'
  FROM chart_of_accounts ca
 WHERE ca.system_key = 'client_advances'
   AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '2060');

CREATE OR REPLACE FUNCTION public.bank_classification_coa(p_classification text, p_direction text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT id FROM chart_of_accounts WHERE account_code = CASE
    WHEN p_direction = 'debit' THEN CASE p_classification
      WHEN 'bank_charge' THEN '6301' WHEN 'withholding_tax' THEN '2025' WHEN 'payroll_tax' THEN '2020'
      WHEN 'loan_repayment' THEN '2030' WHEN 'owner_drawing' THEN '3030' WHEN 'other_expense' THEN '5902'
      WHEN 'refund_paid' THEN '2060' END
    ELSE CASE p_classification
      WHEN 'other_income' THEN '4020' WHEN 'owner_injection' THEN '3020' WHEN 'loan_received' THEN '2030'
      WHEN 'vendor_refund' THEN '4020' WHEN 'wht_refund' THEN '2025' WHEN 'refund_owed' THEN '2060' END
  END
$function$;

-- ── 5. Payments already matched get their split (and ledger adjustment) ──
-- Run once after this migration (kept out of it so the schema change and
-- the data change are confirmed separately):
--   UPDATE sales SET income_tax_withheld = NULL
--    WHERE amount_received IS NOT NULL AND withholding_set_by IS NULL;
