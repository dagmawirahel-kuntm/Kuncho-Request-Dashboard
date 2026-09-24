-- Input VAT, transaction by transaction, on the VAT Receipt Tracker.
--
-- For every paid purchase the tracker now says: does it carry input VAT
-- (flag), which month's VAT return claims it (editable), and whether a copy
-- of the receipt is in the system (editable status).
--
-- ── What already existed, and what does not change ──────────────────────
-- vendor_receipts holds each tax receipt through a three-person workflow --
-- entered, verified by the other department, reviewed by the Tax Officer --
-- and only 'tax_reviewed' receipts feed a VAT return. That was a user
-- decision (156) and it stands: flags here never make VAT claimable on
-- their own. They make the pipeline visible -- which purchases should
-- produce a claim, for how much, in which month, and what is still missing
-- -- and the declaration month they carry decides WHERE a reviewed claim
-- lands.
--
-- ── input_vat_items ─────────────────────────────────────────────────────
-- One optional row per expense, created the first time someone flags or
-- edits it. Everything on it is an override of a derived default:
--   vat_applicable      NULL not yet looked at / true carries VAT / false none
--   declare_ec_*        the return that claims it; NULL = the tax period of
--                       the receipt date (or the expense date before a
--                       receipt exists). May be moved LATER -- a receipt that
--                       arrives late is claimed in a later return -- never
--                       earlier than the purchase itself.
--   copy_status         not_uploaded / uploaded / not_available; NULL = derived
--                       from whether a receipt file is attached anywhere
--   vat_amount          NULL = the reviewed receipt's VAT, else an estimate
--                       of amount * r / (1 + r) (amount_etb is VAT-inclusive)
--
-- Additive for the deployed frontend: v_vat_input_by_ec_period and
-- v_vat_position_by_ec_period keep their columns and gain new ones at the end.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS input_vat_items (
  expense_id        uuid PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  vat_applicable    boolean,
  declare_ec_year   int,
  declare_ec_month  int CHECK (declare_ec_month BETWEEN 1 AND 12),
  copy_status       text CHECK (copy_status IN ('not_uploaded', 'uploaded', 'not_available')),
  vat_amount        numeric CHECK (vat_amount >= 0),
  notes             text,
  updated_by        uuid REFERENCES auth.users(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((declare_ec_year IS NULL) = (declare_ec_month IS NULL))
);

COMMENT ON TABLE input_vat_items IS
  'Per-purchase input VAT tracking: flag, declaration month override, receipt-copy status. Overrides only; defaults are derived in v_input_vat_tracker. Does not by itself make VAT claimable -- only tax_reviewed vendor_receipts do (156).';

-- The date a purchase's VAT is anchored to: its reviewed-or-latest receipt's
-- date if one exists, else the expense date.
CREATE OR REPLACE FUNCTION input_vat_anchor_date(p_expense_id uuid)
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT vr.receipt_date FROM vendor_receipts vr
     WHERE vr.expense_id = p_expense_id AND vr.receipt_date IS NOT NULL
     ORDER BY (vr.status = 'tax_reviewed') DESC, vr.receipt_date DESC LIMIT 1),
    (SELECT e.date FROM expenses e WHERE e.id = p_expense_id));
$$;
REVOKE EXECUTE ON FUNCTION input_vat_anchor_date(uuid) FROM PUBLIC, anon;

-- Stamp who edited, and refuse a declaration month earlier than the
-- purchase's own tax period.
CREATE OR REPLACE FUNCTION input_vat_items_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_def_y int; v_def_m int;
BEGIN
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
$$;

DROP TRIGGER IF EXISTS trg_input_vat_items_guard ON input_vat_items;
CREATE TRIGGER trg_input_vat_items_guard
  BEFORE INSERT OR UPDATE ON input_vat_items
  FOR EACH ROW EXECUTE FUNCTION input_vat_items_guard();

ALTER TABLE input_vat_items ENABLE ROW LEVEL SECURITY;

-- The VAT tracker's audience reads; the people who capture and review
-- receipts write.
CREATE POLICY input_vat_items_read ON input_vat_items FOR SELECT TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'executive', 'finance', 'procurement_officer'), false));
CREATE POLICY input_vat_items_write ON input_vat_items FOR ALL TO authenticated
  USING (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'procurement_officer'), false))
  WITH CHECK (is_tax_officer() OR COALESCE(get_user_role() IN ('admin', 'finance', 'procurement_officer'), false));

GRANT SELECT, INSERT, UPDATE, DELETE ON input_vat_items TO authenticated;

-- ── v_input_vat_tracker: one row per paid purchase ──────────────────────
CREATE OR REPLACE VIEW v_input_vat_tracker
WITH (security_invoker = true) AS
WITH base AS (
  SELECT e.id AS expense_id, e.expense_code, e.date AS expense_date, e.amount_etb,
         e.vendor_id, v.vendor_name, v.tin AS vendor_tin,
         e.project_id, p.project_name,
         e.receipt_url,
         vr.id AS receipt_id, vr.status AS receipt_status, vr.vat_amount AS receipt_vat,
         vr.document_url AS receipt_document,
         COALESCE(vr.receipt_date, e.date) AS anchor_date,
         i.vat_applicable, i.declare_ec_year, i.declare_ec_month,
         i.copy_status AS copy_status_set, i.vat_amount AS vat_amount_set, i.notes
  FROM expenses e
  LEFT JOIN vendors  v ON v.id = e.vendor_id
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN input_vat_items i ON i.expense_id = e.id
  LEFT JOIN LATERAL (
    SELECT r.id, r.status, r.vat_amount, r.document_url, r.receipt_date
    FROM vendor_receipts r
    WHERE r.expense_id = e.id
    ORDER BY (r.status = 'tax_reviewed') DESC, r.created_at DESC
    LIMIT 1
  ) vr ON true
  WHERE e.payment_status = true
    AND NOT COALESCE(e.is_archived, false)
    AND e.date >= financials_cutover_date()
)
SELECT b.expense_id, b.expense_code, b.expense_date, b.amount_etb,
       b.vendor_id, b.vendor_name, b.vendor_tin, b.project_id, b.project_name,
       b.vat_applicable,
       b.anchor_date,
       dp.ec_year                                        AS default_ec_year,
       dp.ec_month                                       AS default_ec_month,
       COALESCE(b.declare_ec_year,  dp.ec_year)          AS declare_ec_year,
       COALESCE(b.declare_ec_month, dp.ec_month)         AS declare_ec_month,
       ec_month_name(COALESCE(b.declare_ec_month, dp.ec_month)) || ' ' || COALESCE(b.declare_ec_year, dp.ec_year)
                                                         AS declare_period_label,
       (b.declare_ec_year IS NOT NULL)                   AS declare_overridden,
       COALESCE(b.vat_amount_set, b.receipt_vat,
                round(b.amount_etb * r.rate / (1 + r.rate), 2)) AS vat_amount,
       CASE WHEN b.vat_amount_set IS NOT NULL THEN 'entered'
            WHEN b.receipt_vat   IS NOT NULL THEN 'receipt'
            ELSE 'estimated' END                         AS vat_source,
       b.receipt_id, b.receipt_status,
       COALESCE(b.copy_status_set,
                CASE WHEN b.receipt_document IS NOT NULL OR b.receipt_url IS NOT NULL
                     THEN 'uploaded' ELSE 'not_uploaded' END) AS copy_status,
       (b.copy_status_set IS NOT NULL)                   AS copy_status_set,
       (COALESCE(b.vat_applicable, false) AND b.receipt_status = 'tax_reviewed') AS claimable,
       b.notes
FROM base b
CROSS JOIN LATERAL tax_period_for_date(b.anchor_date) dp
CROSS JOIN LATERAL (SELECT (tax_rate_note('VAT', b.anchor_date) ->> 'standard_rate')::numeric AS rate) r;

GRANT SELECT ON v_input_vat_tracker TO authenticated;

-- ── Input VAT per return: claimable (reviewed) + flagged, awaiting review ─
-- Claimable keeps 156's rule -- tax-reviewed receipts only -- but lands in
-- the declaration month from the tracker when one was set for its purchase.
-- The awaiting-review figure is flagged purchases with no reviewed receipt,
-- so the gap between "should claim" and "can claim" is visible per return.
CREATE OR REPLACE VIEW v_vat_input_by_ec_period
WITH (security_invoker = true) AS
WITH claimed AS (
  SELECT COALESCE(i.declare_ec_year,  tp.ec_year)  AS ec_year,
         COALESCE(i.declare_ec_month, tp.ec_month) AS ec_month,
         count(*)                                  AS receipt_count,
         sum(vr.vat_amount)                        AS input_vat
  FROM vendor_receipts vr
  LEFT JOIN input_vat_items i ON i.expense_id = vr.expense_id
  CROSS JOIN LATERAL tax_period_for_date(vr.receipt_date) tp
  WHERE vr.status = 'tax_reviewed' AND vr.receipt_date IS NOT NULL
  GROUP BY 1, 2
),
pending AS (
  SELECT declare_ec_year AS ec_year, declare_ec_month AS ec_month,
         count(*)        AS pending_count,
         sum(vat_amount) AS pending_vat
  FROM v_input_vat_tracker
  WHERE vat_applicable AND NOT claimable
  GROUP BY 1, 2
)
SELECT COALESCE(c.ec_year, p.ec_year)   AS ec_year,
       COALESCE(c.ec_month, p.ec_month) AS ec_month,
       COALESCE(c.receipt_count, 0)     AS receipt_count,
       COALESCE(c.input_vat, 0)         AS input_vat,
       COALESCE(p.pending_count, 0)     AS pending_review_count,
       COALESCE(p.pending_vat, 0)       AS input_vat_pending_review
FROM claimed c
FULL JOIN pending p ON p.ec_year = c.ec_year AND p.ec_month = c.ec_month;

CREATE OR REPLACE VIEW v_vat_position_by_ec_period
WITH (security_invoker = true) AS
SELECT p.ec_year, p.ec_month,
       ec_month_name(p.ec_month) || ' ' || p.ec_year      AS period_label,
       b.start_greg                                        AS period_start_greg,
       b.end_greg                                          AS period_end_greg,
       COALESCE(o.output_vat, 0)                           AS output_vat,
       COALESCE(i.input_vat, 0)                            AS input_vat_reclaimable,
       COALESCE(o.output_vat, 0) - COALESCE(i.input_vat, 0) AS net_vat,
       CASE WHEN COALESCE(o.output_vat, 0) - COALESCE(i.input_vat, 0) >= 0
            THEN 'payable' ELSE 'reclaimable' END           AS position,
       COALESCE(o.sale_count, 0)                           AS sale_count,
       COALESCE(i.receipt_count, 0)                        AS reviewed_receipt_count,
       f.id                                                AS vat_filing_id,
       f.status                                            AS vat_filing_status,
       COALESCE(i.input_vat_pending_review, 0)             AS input_vat_pending_review,
       COALESCE(i.pending_review_count, 0)                 AS pending_review_count
FROM (SELECT ec_year, ec_month FROM v_vat_output_by_ec_period
      UNION SELECT ec_year, ec_month FROM v_vat_input_by_ec_period) p
CROSS JOIN LATERAL tax_period_bounds(p.ec_year, p.ec_month) b
LEFT JOIN v_vat_output_by_ec_period o USING (ec_year, ec_month)
LEFT JOIN v_vat_input_by_ec_period  i USING (ec_year, ec_month)
LEFT JOIN tax_filings f
  ON f.schedule_code = 'VAT' AND f.period_ec_year = p.ec_year AND f.period_ec_month = p.ec_month;
