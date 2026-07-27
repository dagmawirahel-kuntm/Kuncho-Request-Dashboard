-- ============================================================
-- Collapses sales_receipts into client_attachments, and links vendor
-- receipts to the vendor's own document store — so a tax receipt is
-- ONE object that procurement, project finance, and the tax officer
-- each see from their own page, rather than a document filed twice.
--
-- ── Why sales_receipts is being dropped one migration after it was
-- created ───────────────────────────────────────────────────────────
-- It duplicated something that already existed. client_attachments has
-- carried category='receipt'/'wht_receipt', a sale_id foreign key, and
-- an amount column since migration 018, and ClientDetailPage already
-- computes hasReceipt / whtCollected from it. Adding sales_receipts in
-- 157 created a second place a client receipt document could live —
-- exactly the scattering this tax work exists to remove. Caught while
-- wiring the two together; both tables were empty, so this is the
-- cheapest moment it will ever be fixed.
--
-- The split is now: the ATTACHMENT is the document (one file, one
-- bucket, one place per counterparty), and the extra columns here are
-- only what an attachment can't express — VAT figures, receipt
-- number/date, the review chain, and physical custody.
--
-- uploaded_by doubles as "who presented it". No separate presented_by:
-- the uploader IS the presenter. Existing insert sites never set
-- uploaded_by (it was silently NULL), so the trigger below now stamps
-- it — which also fixes that gap for contracts and other categories.
--
-- ── Access ──────────────────────────────────────────────────────────
-- sales_receipts allowed admin/finance/sales/project_manager to write.
-- client_attachments' only policy is admin/manager/finance, so
-- collapsing would have silently REMOVED sales and project_manager's
-- ability to present a receipt — the very people the process names as
-- responsible. Rather than widen the existing blanket policy (which
-- would also hand them contracts and everything else), a second
-- narrow policy grants those two roles receipt categories only.
-- ============================================================

SET search_path TO public;

-- ── 1. Tax workflow columns on the existing document store ──────────
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS receipt_no           TEXT;
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS receipt_date         DATE;
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS vat_amount           NUMERIC(12,2);
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS project_id           UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS tax_status           TEXT;
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS tax_reviewed_by      UUID REFERENCES user_profiles(id);
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS tax_reviewed_at      TIMESTAMPTZ;
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS tax_review_note      TEXT;
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS tax_rejection_reason TEXT;
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS physical_received_at TIMESTAMPTZ;
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS physical_received_by UUID REFERENCES user_profiles(id);
ALTER TABLE client_attachments ADD COLUMN IF NOT EXISTS physical_note        TEXT;

-- NULL for non-receipt categories (contracts, other) — the workflow
-- simply doesn't apply to those, and a default would imply it does.
ALTER TABLE client_attachments DROP CONSTRAINT IF EXISTS client_attachments_tax_status_check;
ALTER TABLE client_attachments ADD CONSTRAINT client_attachments_tax_status_check
  CHECK (tax_status IS NULL OR tax_status IN ('pending_review', 'tax_reviewed', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_client_attachments_tax_status ON client_attachments(tax_status) WHERE tax_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_attachments_project    ON client_attachments(project_id);

COMMENT ON COLUMN client_attachments.tax_status IS
  'Set only for receipt/wht_receipt categories. NULL means the tax workflow does not apply to this document. uploaded_by is the presenter; tax_reviewed_by is the Tax Officer.';

-- ── 2. Presenter -> tax officer, on receipt categories only ─────────
CREATE OR REPLACE FUNCTION enforce_client_attachment_tax_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reviewer_is_tax BOOLEAN;
  v_reviewer_role   TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Never client-supplied: the presenter identity is the record of
    -- who is accountable, so a caller must not be able to claim it was
    -- someone else. Also backfills a field the existing upload sites
    -- never populated.
    NEW.uploaded_by := auth.uid();
    IF NEW.category IN ('receipt', 'wht_receipt') THEN
      NEW.tax_status := 'pending_review';
    ELSE
      NEW.tax_status := NULL;
    END IF;
    NEW.tax_reviewed_by := NULL; NEW.tax_reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.tax_status IS DISTINCT FROM NEW.tax_status THEN
    IF OLD.tax_status = 'pending_review' AND NEW.tax_status IN ('tax_reviewed', 'rejected') THEN
      NEW.tax_reviewed_by := auth.uid();
      NEW.tax_reviewed_at := NOW();

      SELECT is_tax_officer, role INTO v_reviewer_is_tax, v_reviewer_role
      FROM user_profiles WHERE id = NEW.tax_reviewed_by;

      IF NOT (COALESCE(v_reviewer_is_tax, false) OR v_reviewer_role = 'admin') THEN
        RAISE EXCEPTION 'Only the designated Tax Officer (or an admin standing in) can review a client receipt';
      END IF;

      IF NEW.tax_reviewed_by = NEW.uploaded_by THEN
        RAISE EXCEPTION 'The person who presented a receipt cannot also review it';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid tax status transition from % to %', COALESCE(OLD.tax_status, 'none'), COALESCE(NEW.tax_status, 'none');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_client_attachment_tax_review ON client_attachments;
CREATE TRIGGER trg_enforce_client_attachment_tax_review
  BEFORE INSERT OR UPDATE ON client_attachments
  FOR EACH ROW EXECUTE FUNCTION enforce_client_attachment_tax_review();

-- ── 3. Preserve the write access the collapse would have removed ────
DROP POLICY IF EXISTS "client_attachments_receipt_presenters" ON client_attachments;
CREATE POLICY "client_attachments_receipt_presenters" ON client_attachments FOR INSERT
  WITH CHECK (
    get_user_role() IN ('sales', 'project_manager')
    AND category IN ('receipt', 'wht_receipt')
  );

DROP POLICY IF EXISTS "client_attachments_receipt_presenters_read" ON client_attachments;
CREATE POLICY "client_attachments_receipt_presenters_read" ON client_attachments FOR SELECT
  USING (get_user_role() IN ('sales', 'project_manager'));

-- ── 4. Retire sales_receipts ────────────────────────────────────────
-- Views first: they depend on the table.
DROP VIEW IF EXISTS v_sales_receipts_awaiting_review;
DROP VIEW IF EXISTS v_sales_receipts_outstanding;
DROP FUNCTION IF EXISTS confirm_sales_receipt_physical(UUID, TEXT);
DROP TABLE IF EXISTS sales_receipts;
DROP FUNCTION IF EXISTS enforce_sales_receipt_presenter_reviewer();

-- ── 5. Same views, rebuilt on client_attachments ────────────────────
CREATE OR REPLACE VIEW v_sales_receipts_outstanding
WITH (security_invoker = true) AS
SELECT
  s.id AS sale_id, s.invoice_number, s.date, s.amount AS gross_amount,
  s.sales_status, s.is_vat_exempt,
  CASE WHEN s.is_vat_exempt THEN 0 ELSE ROUND(s.amount * 15.0 / 115.0, 2) END AS expected_vat,
  s.project_id, p.project_name, s.client_id, c.client_name,
  COALESCE(ca.tax_status, 'none') AS receipt_status
FROM sales s
LEFT JOIN projects p ON p.id = s.project_id
LEFT JOIN clients  c ON c.id = s.client_id
LEFT JOIN LATERAL (
  SELECT tax_status FROM client_attachments
  WHERE sale_id = s.id AND category = 'receipt'
  ORDER BY CASE tax_status WHEN 'tax_reviewed' THEN 1 WHEN 'pending_review' THEN 2 ELSE 3 END
  LIMIT 1
) ca ON TRUE
WHERE s.sales_status IN ('Invoiced', 'Paid')
  AND COALESCE(ca.tax_status, 'none') <> 'tax_reviewed';

GRANT SELECT ON v_sales_receipts_outstanding TO authenticated;

CREATE OR REPLACE VIEW v_sales_receipts_awaiting_review
WITH (security_invoker = true) AS
SELECT
  ca.id, ca.receipt_no, ca.receipt_date, ca.vat_amount, ca.file_path AS document_url,
  ca.category, ca.physical_received_at,
  s.invoice_number, s.amount AS gross_amount,
  c.client_name, p.project_name,
  presenter.full_name AS presented_by_name, ca.created_at AS presented_at
FROM client_attachments ca
LEFT JOIN sales    s ON s.id = ca.sale_id
LEFT JOIN clients  c ON c.id = ca.client_id
LEFT JOIN projects p ON p.id = COALESCE(ca.project_id, s.project_id)
LEFT JOIN user_profiles presenter ON presenter.id = ca.uploaded_by
WHERE ca.tax_status = 'pending_review';

GRANT SELECT ON v_sales_receipts_awaiting_review TO authenticated;

CREATE OR REPLACE FUNCTION confirm_client_receipt_physical(p_attachment_id UUID, p_note TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only finance or admin can confirm physical receipt of a document';
  END IF;
  UPDATE client_attachments
  SET physical_received_at = NOW(), physical_received_by = auth.uid(), physical_note = COALESCE(p_note, physical_note)
  WHERE id = p_attachment_id AND physical_received_at IS NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION confirm_client_receipt_physical(UUID, TEXT) TO authenticated;

-- ── 6. Vendor side: link the receipt to the vendor's document store ─
-- vendor_attachments.category is plain TEXT with no CHECK, so the new
-- 'tax_receipt' category needs no constraint change — only the UI
-- offers it. vendor_receipts keeps its own table (unlike sales) because
-- it carries the three-party chain that has no equivalent on an
-- attachment, but the DOCUMENT now lives with the vendor.
ALTER TABLE vendor_receipts ADD COLUMN IF NOT EXISTS vendor_attachment_id UUID REFERENCES vendor_attachments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_receipts_attachment ON vendor_receipts(vendor_attachment_id);

COMMENT ON COLUMN vendor_receipts.vendor_attachment_id IS
  'The receipt document as filed under the vendor (vendor_attachments, category tax_receipt). One file, visible from both the vendor page and the tax queue. document_url remains for GRN-linked receipts that have no vendor to file against.';

-- ── 7. One row per receipt, seen from every angle ───────────────────
-- What procurement, project finance, and the tax officer each need,
-- from a single query rather than three reconciled by eye.
CREATE OR REPLACE VIEW v_tax_receipt_movement
WITH (security_invoker = true) AS
SELECT
  'purchase'                             AS side,
  vr.id,
  vr.receipt_no,
  vr.receipt_date,
  vr.vat_amount,
  vr.status                              AS workflow_status,
  vr.physical_received_at,
  v.vendor_name                          AS counterparty,
  COALESCE(vr.project_id, e.project_id)  AS project_id,
  p.project_name,
  maker.full_name                        AS collected_by,
  checker.full_name                      AS verified_by,
  reviewer.full_name                     AS tax_reviewed_by,
  COALESCE(va.file_path, vr.document_url) AS document_ref,
  CASE WHEN va.id IS NOT NULL THEN 'vendor-documents' ELSE 'tax-documents' END AS document_bucket
FROM vendor_receipts vr
LEFT JOIN vendors  v ON v.id = vr.vendor_id
LEFT JOIN expenses e ON e.id = vr.expense_id
LEFT JOIN projects p ON p.id = COALESCE(vr.project_id, e.project_id)
LEFT JOIN vendor_attachments va ON va.id = vr.vendor_attachment_id
LEFT JOIN user_profiles maker    ON maker.id    = vr.entered_by
LEFT JOIN user_profiles checker  ON checker.id  = vr.verified_by
LEFT JOIN user_profiles reviewer ON reviewer.id = vr.reviewed_by
UNION ALL
SELECT
  'sale',
  ca.id,
  ca.receipt_no,
  ca.receipt_date,
  ca.vat_amount,
  ca.tax_status,
  ca.physical_received_at,
  c.client_name,
  COALESCE(ca.project_id, s.project_id),
  p.project_name,
  presenter.full_name,
  NULL,                                   -- sales has no cross-department verify step, by design
  reviewer.full_name,
  ca.file_path,
  'client-documents'
FROM client_attachments ca
LEFT JOIN clients  c ON c.id = ca.client_id
LEFT JOIN sales    s ON s.id = ca.sale_id
LEFT JOIN projects p ON p.id = COALESCE(ca.project_id, s.project_id)
LEFT JOIN user_profiles presenter ON presenter.id = ca.uploaded_by
LEFT JOIN user_profiles reviewer  ON reviewer.id  = ca.tax_reviewed_by
WHERE ca.tax_status IS NOT NULL;

GRANT SELECT ON v_tax_receipt_movement TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT count(*) AS sales_receipts_should_be_0
FROM information_schema.tables WHERE table_name = 'sales_receipts';

SELECT count(*) AS new_client_attachment_cols_expect_12
FROM information_schema.columns WHERE table_name='client_attachments'
  AND column_name IN ('receipt_no','receipt_date','vat_amount','project_id','tax_status',
                      'tax_reviewed_by','tax_reviewed_at','tax_review_note','tax_rejection_reason',
                      'physical_received_at','physical_received_by','physical_note');

SELECT count(*) AS vendor_attachment_link_expect_1
FROM information_schema.columns WHERE table_name='vendor_receipts' AND column_name='vendor_attachment_id';

SELECT proname FROM pg_proc
WHERE proname IN ('confirm_client_receipt_physical','enforce_client_attachment_tax_review') ORDER BY proname;

-- All run clean; empty on today's data.
SELECT count(*) AS outstanding FROM v_sales_receipts_outstanding;
SELECT count(*) AS awaiting     FROM v_sales_receipts_awaiting_review;
SELECT count(*) AS movement     FROM v_tax_receipt_movement;
