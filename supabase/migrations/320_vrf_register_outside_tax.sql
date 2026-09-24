-- 320 — VRF as its own component, outside every tax figure
--
-- A VRF record is a receipt bought in Kuncho's name for goods Kuncho never
-- received: Kuncho pays the receipt amount to the VRF company, the goods go
-- to someone else, and the money comes back (less WHT and the individual's
-- commission) to an account held by Kuncho's authorised representative.
-- Nothing was supplied to Kuncho, so none of it is a purchase: it carries no
-- creditable input VAT and is not a deductible expense.
--
-- This migration makes the system say so, and gives VRF its own register:
--
--   1. VRF receipt payments (expenses linked to a VRF record, or typed 'vrf')
--      are excluded from the Government Statement, the Input VAT tracker,
--      and input VAT by period — so from Tax Filings' computed figures too,
--      which read those views. input_vat_items refuses them outright.
--      WHT is deliberately NOT excluded: the WHT on a VRF payment was
--      actually withheld from the VRF company, which gets the credit for it,
--      so Kuncho owes it to the government like any other WHT.
--
--   2. vrf_personal_draws records money taken from a VRF's returned funds
--      for personal use (the other use, company payments, is already
--      recorded as expenses and payroll linked by vrf_id). Draws can never
--      exceed what that VRF has left. Only admin can delete one.
--
--   3. v_vrf_fund_status now counts payroll paid from a VRF and personal
--      draws, so fund_available (which confirm_vrf_payment checks) is what
--      is really left. Existing columns keep their names and order;
--      fund_drawn becomes the total of all three kinds of draw.
--
--   4. v_vrf_register: one row per VRF with its Ethiopian month and fiscal
--      year, and where the receipt amount went — WHT, commission, returned,
--      and any remainder not yet accounted for — then how the returned money
--      was used and what is still held. The VRF page aggregates it.
--
-- Additive for the deployed frontend: every replaced view keeps its columns.

SET search_path TO public;

-- ── 1. VRF out of the tax views ───────────────────────────────────────────

CREATE OR REPLACE VIEW v_government_expense_statement_by_ec_period
WITH (security_invoker = true) AS
SELECT fp.id AS fiscal_period_id,
  fp.label AS fiscal_year,
  tp.ec_year,
  tp.ec_month,
  ec_month_name(tp.ec_month) || ' ' || tp.ec_year AS period_label,
  c.category_name,
  c.nature,
  c.asset_class,
  CASE WHEN c.nature = 'Expense' THEN 'operating_expense' ELSE 'consumable_inventory' END AS gov_treatment,
  count(*) AS line_count,
  sum(e.amount_etb) AS amount
FROM expenses e
JOIN categories c ON c.id = e.category_id
CROSS JOIN LATERAL tax_period_for_date(e.date) tp(ec_year, ec_month)
LEFT JOIN fiscal_periods fp ON e.date >= fp.start_date AND e.date <= fp.end_date
WHERE e.payment_status = true
  AND e.date >= financials_cutover_date()
  AND (c.nature = 'Expense' OR (c.nature = 'Asset' AND c.asset_class = 'Inventory'))
  AND e.vendor_receipt_facilitation_id IS NULL
  AND e.expense_type IS DISTINCT FROM 'vrf'
GROUP BY fp.id, fp.label, tp.ec_year, tp.ec_month, c.category_name, c.nature, c.asset_class,
  CASE WHEN c.nature = 'Expense' THEN 'operating_expense' ELSE 'consumable_inventory' END;

CREATE OR REPLACE VIEW v_input_vat_tracker
WITH (security_invoker = true) AS
WITH base AS (
  SELECT e.id AS expense_id,
    e.expense_code,
    e.date AS expense_date,
    e.amount_etb,
    e.vendor_id,
    v.vendor_name,
    v.tin AS vendor_tin,
    e.project_id,
    p.project_name,
    e.receipt_url,
    vr.id AS receipt_id,
    vr.status AS receipt_status,
    vr.vat_amount AS receipt_vat,
    vr.document_url AS receipt_document,
    COALESCE(vr.receipt_date, e.date) AS anchor_date,
    i.vat_applicable,
    i.declare_ec_year,
    i.declare_ec_month,
    i.copy_status AS copy_status_set,
    i.vat_amount AS vat_amount_set,
    i.notes
  FROM expenses e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN input_vat_items i ON i.expense_id = e.id
  LEFT JOIN LATERAL (
    SELECT r_1.id, r_1.status, r_1.vat_amount, r_1.document_url, r_1.receipt_date
    FROM vendor_receipts r_1
    WHERE r_1.expense_id = e.id
    ORDER BY (r_1.status = 'tax_reviewed') DESC, r_1.created_at DESC
    LIMIT 1
  ) vr ON true
  WHERE e.payment_status = true
    AND NOT COALESCE(e.is_archived, false)
    AND e.date >= financials_cutover_date()
    AND e.vendor_receipt_facilitation_id IS NULL
    AND e.expense_type IS DISTINCT FROM 'vrf'
)
SELECT b.expense_id,
  b.expense_code,
  b.expense_date,
  b.amount_etb,
  b.vendor_id,
  b.vendor_name,
  b.vendor_tin,
  b.project_id,
  b.project_name,
  b.vat_applicable,
  b.anchor_date,
  dp.ec_year AS default_ec_year,
  dp.ec_month AS default_ec_month,
  COALESCE(b.declare_ec_year, dp.ec_year) AS declare_ec_year,
  COALESCE(b.declare_ec_month, dp.ec_month) AS declare_ec_month,
  ec_month_name(COALESCE(b.declare_ec_month, dp.ec_month)) || ' ' || COALESCE(b.declare_ec_year, dp.ec_year) AS declare_period_label,
  b.declare_ec_year IS NOT NULL AS declare_overridden,
  COALESCE(b.vat_amount_set, b.receipt_vat, round(b.amount_etb * r.rate / (1 + r.rate), 2)) AS vat_amount,
  CASE
    WHEN b.vat_amount_set IS NOT NULL THEN 'entered'
    WHEN b.receipt_vat IS NOT NULL THEN 'receipt'
    ELSE 'estimated'
  END AS vat_source,
  b.receipt_id,
  b.receipt_status,
  COALESCE(b.copy_status_set,
    CASE WHEN b.receipt_document IS NOT NULL OR b.receipt_url IS NOT NULL THEN 'uploaded' ELSE 'not_uploaded' END) AS copy_status,
  b.copy_status_set IS NOT NULL AS copy_status_set,
  COALESCE(b.vat_applicable, false) AND COALESCE(b.receipt_status = 'tax_reviewed', false) AS claimable,
  b.notes
FROM base b
CROSS JOIN LATERAL tax_period_for_date(b.anchor_date) dp(ec_year, ec_month)
CROSS JOIN LATERAL (SELECT (tax_rate_note('VAT', b.anchor_date) ->> 'standard_rate')::numeric AS rate) r;

CREATE OR REPLACE VIEW v_vat_input_by_ec_period
WITH (security_invoker = true) AS
WITH claimed AS (
  SELECT COALESCE(i.declare_ec_year, tp.ec_year) AS ec_year,
    COALESCE(i.declare_ec_month, tp.ec_month) AS ec_month,
    count(*) AS receipt_count,
    sum(vr.vat_amount) AS input_vat
  FROM vendor_receipts vr
  LEFT JOIN input_vat_items i ON i.expense_id = vr.expense_id
  CROSS JOIN LATERAL tax_period_for_date(vr.receipt_date) tp(ec_year, ec_month)
  WHERE vr.status = 'tax_reviewed'
    AND vr.receipt_date IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = vr.expense_id
        AND (e.vendor_receipt_facilitation_id IS NOT NULL OR e.expense_type = 'vrf'))
  GROUP BY COALESCE(i.declare_ec_year, tp.ec_year), COALESCE(i.declare_ec_month, tp.ec_month)
), pending AS (
  SELECT t.declare_ec_year AS ec_year,
    t.declare_ec_month AS ec_month,
    count(*) AS pending_count,
    sum(t.vat_amount) AS pending_vat
  FROM v_input_vat_tracker t
  WHERE t.vat_applicable AND NOT t.claimable
  GROUP BY t.declare_ec_year, t.declare_ec_month
)
SELECT COALESCE(c.ec_year, p.ec_year) AS ec_year,
  COALESCE(c.ec_month, p.ec_month) AS ec_month,
  COALESCE(c.receipt_count, 0::bigint) AS receipt_count,
  COALESCE(c.input_vat, 0::numeric) AS input_vat,
  COALESCE(p.pending_count, 0::bigint) AS pending_review_count,
  COALESCE(p.pending_vat, 0::numeric) AS input_vat_pending_review
FROM claimed c
FULL JOIN pending p ON p.ec_year = c.ec_year AND p.ec_month = c.ec_month;

-- The tracker no longer lists VRF payments; this stops a flag being written
-- against one by any other route.
CREATE OR REPLACE FUNCTION public.input_vat_items_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_def_y int; v_def_m int;
BEGIN
  IF EXISTS (SELECT 1 FROM expenses e
             WHERE e.id = NEW.expense_id
               AND (e.vendor_receipt_facilitation_id IS NOT NULL OR e.expense_type = 'vrf')) THEN
    RAISE EXCEPTION 'VRF payments are kept out of input VAT: Kuncho received no goods for them';
  END IF;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  IF NEW.declare_ec_year IS NOT NULL THEN
    SELECT tp.ec_year, tp.ec_month INTO v_def_y, v_def_m
    FROM tax_period_for_date(input_vat_anchor_date(NEW.expense_id)) tp;
    IF (NEW.declare_ec_year * 100 + NEW.declare_ec_month) < (v_def_y * 100 + v_def_m) THEN
      RAISE EXCEPTION 'Input VAT cannot be declared in % %, before the purchase''s own period (% %)',
        ec_month_name(NEW.declare_ec_month), NEW.declare_ec_year, ec_month_name(v_def_m), v_def_y;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2. Personal draws from a VRF's returned money ────────────────────────

CREATE TABLE IF NOT EXISTS vrf_personal_draws (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vrf_id      uuid NOT NULL REFERENCES vendor_receipt_facilitation(id) ON DELETE RESTRICT,
  draw_date   date NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  drawn_by    text NOT NULL CHECK (btrim(drawn_by) <> ''),
  note        text,
  created_by  uuid NOT NULL DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vrf_personal_draws_vrf ON vrf_personal_draws(vrf_id);

ALTER TABLE vrf_personal_draws ENABLE ROW LEVEL SECURITY;

-- Same audience as the rest of VRF: admin, executive, and finance holding
-- the VRF badge. Anyone in it can record or correct a draw; only admin can
-- delete one, so a record of money taken cannot quietly disappear.
DROP POLICY IF EXISTS vrf_draws_read ON vrf_personal_draws;
CREATE POLICY vrf_draws_read ON vrf_personal_draws FOR SELECT
  USING (get_user_role() IN ('admin', 'executive')
    OR (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true)));
DROP POLICY IF EXISTS vrf_draws_insert ON vrf_personal_draws;
CREATE POLICY vrf_draws_insert ON vrf_personal_draws FOR INSERT
  WITH CHECK (created_by = auth.uid() AND (get_user_role() IN ('admin', 'executive')
    OR (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true))));
DROP POLICY IF EXISTS vrf_draws_update ON vrf_personal_draws;
CREATE POLICY vrf_draws_update ON vrf_personal_draws FOR UPDATE
  USING (get_user_role() IN ('admin', 'executive')
    OR (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true)))
  WITH CHECK (get_user_role() IN ('admin', 'executive')
    OR (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true)));
DROP POLICY IF EXISTS vrf_draws_delete_admin ON vrf_personal_draws;
CREATE POLICY vrf_draws_delete_admin ON vrf_personal_draws FOR DELETE
  USING (get_user_role() = 'admin');

REVOKE ALL ON vrf_personal_draws FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON vrf_personal_draws TO authenticated;

-- ── 3. Fund status counts every kind of draw ──────────────────────────────

CREATE OR REPLACE VIEW v_vrf_fund_status
WITH (security_invoker = true) AS
SELECT
  f.id AS vrf_id,
  f.record_name,
  f.facilitator_name,
  f.status,
  f.amount_transferred,
  f.money_returned,
  f.commission_amount,
  f.return_account_id,
  COALESCE(f.amount_transferred, 0) - COALESCE(f.money_returned, 0) - COALESCE(f.commission_amount, 0) AS settlement_gap,
  ex.drawn + pr.drawn + pd.drawn AS fund_drawn,
  COALESCE(f.money_returned, 0) - (ex.drawn + pr.drawn + pd.drawn) AS fund_available,
  ex.n AS payments_count,
  ex.drawn AS company_expense_drawn,
  pr.drawn AS payroll_drawn,
  pd.drawn AS personal_drawn,
  pd.n AS personal_draw_count
FROM vendor_receipt_facilitation f
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(e.amount_etb), 0) AS drawn, count(*) AS n
  FROM expenses e
  WHERE e.vrf_id = f.id AND e.payment_state = 'paid'
) ex
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(ps.net_amount), 0) AS drawn
  FROM payroll p JOIN payroll_staff ps ON ps.payroll_id = p.id
  WHERE p.vrf_id = f.id AND p.payment_status = 'paid' AND NOT COALESCE(p.is_archived, false)
) pr
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(d.amount), 0) AS drawn, count(*) AS n
  FROM vrf_personal_draws d
  WHERE d.vrf_id = f.id
) pd;
GRANT SELECT ON v_vrf_fund_status TO authenticated;

-- A personal draw can only come out of money that is still there.
CREATE OR REPLACE FUNCTION public.vrf_personal_draws_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_status text; v_available numeric;
BEGIN
  SELECT status INTO v_status FROM vendor_receipt_facilitation WHERE id = NEW.vrf_id;
  IF v_status IS DISTINCT FROM 'settled' THEN
    RAISE EXCEPTION 'Money can only be drawn from a settled VRF (this one is %)', COALESCE(v_status, 'missing');
  END IF;
  SELECT fund_available INTO v_available FROM v_vrf_fund_status WHERE vrf_id = NEW.vrf_id;
  -- On an edit, the row's own old amount is already counted as drawn.
  IF TG_OP = 'UPDATE' AND OLD.vrf_id = NEW.vrf_id THEN
    v_available := v_available + OLD.amount;
  END IF;
  IF COALESCE(v_available, 0) < NEW.amount THEN
    RAISE EXCEPTION 'This VRF has only % left, cannot draw %', COALESCE(v_available, 0), NEW.amount;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_personal_draws_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_vrf_personal_draws_guard ON vrf_personal_draws;
CREATE TRIGGER trg_vrf_personal_draws_guard
  BEFORE INSERT OR UPDATE ON vrf_personal_draws
  FOR EACH ROW EXECUTE FUNCTION vrf_personal_draws_guard();

-- ── 4. The register ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_vrf_register
WITH (security_invoker = true) AS
SELECT
  f.id AS vrf_id,
  f.record_name,
  f.facilitator_name,
  f.status,
  f.trxn_date,
  ec.ec_year,
  ec.ec_month,
  CASE WHEN ec.ec_year IS NOT NULL THEN ec_month_name(ec.ec_month) || ' ' || ec.ec_year END AS period_label,
  fp.id AS fiscal_period_id,
  fp.label AS fiscal_year,
  -- The receipt amount is the linked VRF payment; before one exists, the
  -- transfer stands in for it.
  COALESCE(rx.receipt_amount, f.amount_transferred, 0) AS receipt_amount,
  COALESCE(f.amount_transferred, 0) AS transferred,
  rx.wht_recorded,
  COALESCE(f.commission_amount, 0) AS commission,
  COALESCE(f.money_returned, 0) AS returned,
  COALESCE(rx.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0) AS kept_back,
  -- What left and did not come back, less the WHT and commission on record.
  -- Non-zero means a WHT or commission figure is missing from the record.
  COALESCE(rx.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0)
    - rx.wht_recorded - COALESCE(f.commission_amount, 0) AS unaccounted,
  fs.company_expense_drawn,
  fs.payroll_drawn,
  fs.personal_drawn,
  fs.fund_available AS held
FROM vendor_receipt_facilitation f
CROSS JOIN LATERAL (
  SELECT sum(e.amount_etb) AS receipt_amount, COALESCE(sum(e.wht_amount), 0) AS wht_recorded
  FROM expenses e
  WHERE e.vendor_receipt_facilitation_id = f.id AND NOT COALESCE(e.is_archived, false)
) rx
LEFT JOIN LATERAL gregorian_to_ec(f.trxn_date) ec ON f.trxn_date IS NOT NULL
LEFT JOIN fiscal_periods fp ON f.trxn_date >= fp.start_date AND f.trxn_date <= fp.end_date
LEFT JOIN v_vrf_fund_status fs ON fs.vrf_id = f.id
WHERE NOT COALESCE(f.is_archived, false);

REVOKE ALL ON v_vrf_register FROM PUBLIC, anon;
GRANT SELECT ON v_vrf_register TO authenticated;
