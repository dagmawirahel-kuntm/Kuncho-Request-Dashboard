-- ============================================================
-- Quality check on material received at site, provenance for
-- project-to-project transfers, and a GRN register.
--
-- Confirmed by testing against the live schema before writing:
--
--   • A project-to-project transfer ALREADY reaches the receiving
--     project's confirmation queue. confirm_stock_return (159) writes
--     a stock_issues row with issue_type='project_use' for the
--     destination, and v_stock_delivery_confirmations selects exactly
--     those — so a 40-unit transfer showed up at the destination as
--     one pending confirmation with the right item and quantity,
--     unprompted. The receiving step exists; two things are missing
--     from it, below.
--
--   • The receiver cannot tell a transfer from a warehouse dispatch.
--     Nothing on stock_issues records that the row came from a
--     transfer, so the destination PM sees "40 CHS dispatched" with no
--     indication it came off another site rather than out of the
--     warehouse — and no way to query back to the request.
--
--   • There is no quality verdict on receipt. stock_delivery_
--     confirmations (148) records quantity_confirmed and free-text
--     condition_notes only. GRN gained accepted/damaged/rejected per
--     line in 156; the site side never had it.
--
-- ON "TRANSFERS SHOULD RUN THROUGH GRN": deliberately NOT done by
-- writing goods_received_notes rows for transfers, and it is worth
-- being explicit about why, because the requested outcome is still
-- delivered here.
--   goods_received_notes.sourcing_bundle_id is NOT NULL and
--   goods_received_note_items.sourcing_bundle_item_id is NOT NULL — a
--   transfer has neither, so both would have to become nullable.
--   trg_grn_fulfills_bundle would then fire against a null bundle, and
--   trg_receipt_catalogued_stock_item would try to derive an order
--   item that does not exist. Worse, GRN insert is restricted to
--   admin/stock_manager/logistics_officer precisely so that whoever
--   ordered cannot also sign for delivery (063) — the receiver of a
--   transfer is the destination project's PM, so routing transfers
--   through that table means either widening that gate or having the
--   warehouse sign for goods it never saw.
--
--   What was actually asked for — "only to check their quality
--   received" — is the quality check, not the PO paperwork. So the
--   check moves onto the row that already represents receipt at site,
--   using the SAME three-state vocabulary as GRN so the two read
--   identically to a person. A transfer is now quality-checked on
--   arrival exactly as a vendor delivery is, without weakening the
--   control that GRN exists to enforce.
-- ============================================================

SET search_path TO public;

-- ── 1. Provenance: where did this dispatch come from? ────────────────
-- Nullable back-reference, set only for the destination leg of a
-- transfer. Its absence means "came from the warehouse", which is what
-- every existing row is.
ALTER TABLE stock_issues
  ADD COLUMN IF NOT EXISTS stock_return_request_id UUID REFERENCES stock_return_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_issues_return_request
  ON stock_issues(stock_return_request_id) WHERE stock_return_request_id IS NOT NULL;

COMMENT ON COLUMN stock_issues.stock_return_request_id IS
  'Set on the destination leg of a project-to-project transfer, linking back to the request that moved it. NULL means an ordinary warehouse dispatch.';

-- ── 2. Quality verdict on receipt at site ────────────────────────────
-- Same three states as goods_received_note_items.quality_status (159),
-- deliberately identical so "damaged" means the same thing whether the
-- material came from a vendor or another site. condition_notes (148)
-- remains the optional free-text detail beside it.
ALTER TABLE stock_delivery_confirmations
  ADD COLUMN IF NOT EXISTS quality_status TEXT NOT NULL DEFAULT 'accepted';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_delivery_quality_status_check') THEN
    ALTER TABLE stock_delivery_confirmations
      ADD CONSTRAINT stock_delivery_quality_status_check
      CHECK (quality_status IN ('accepted', 'damaged', 'rejected'));
  END IF;
END $$;

COMMENT ON COLUMN stock_delivery_confirmations.quality_status IS
  'Quality verdict recorded by the receiving project on arrival. Same vocabulary as goods_received_note_items.quality_status so vendor deliveries and site transfers read identically.';

-- ── 3. Carry the link when a transfer is confirmed ───────────────────
-- Same body as 156 apart from stamping stock_return_request_id on the
-- destination issue.
CREATE OR REPLACE FUNCTION confirm_stock_return()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_receipt_id  UUID;
  v_from_name   TEXT;
  v_to_name     TEXT;
BEGIN
  IF NEW.status = 'received' AND OLD.status IS DISTINCT FROM 'received' THEN
    NEW.confirmed_by := auth.uid();
    NEW.confirmed_at := NOW();
    IF NEW.quantity_received IS NULL THEN
      NEW.quantity_received := NEW.quantity_requested;
    END IF;

    SELECT project_name INTO v_from_name FROM projects WHERE id = NEW.project_id;
    SELECT project_name INTO v_to_name   FROM projects WHERE id = NEW.destination_project_id;

    INSERT INTO stock_receipts (stock_item_id, quantity, receipt_type, destination, received_date, notes)
    VALUES (
      NEW.stock_item_id, NEW.quantity_received, 'site_return',
      CASE WHEN NEW.destination_project_id IS NULL THEN 'warehouse' ELSE 'site' END,
      CURRENT_DATE,
      CASE
        WHEN NEW.destination_project_id IS NULL
          THEN 'Return to stock' || COALESCE(' from ' || v_from_name, '') || COALESCE(' — ' || NEW.notes, '')
        ELSE 'Transfer out' || COALESCE(' from ' || v_from_name, '') || COALESCE(' to ' || v_to_name, '') || COALESCE(' — ' || NEW.notes, '')
      END
    )
    RETURNING id INTO v_receipt_id;

    NEW.stock_receipt_id := v_receipt_id;

    IF NEW.destination_project_id IS NOT NULL THEN
      INSERT INTO stock_issues (
        stock_item_id, quantity, issue_type, project_id, issued_date, notes, stock_return_request_id
      ) VALUES (
        NEW.stock_item_id, NEW.quantity_received, 'project_use', NEW.destination_project_id, CURRENT_DATE,
        'Transferred in' || COALESCE(' from ' || v_from_name, '') || COALESCE(' — ' || NEW.notes, ''),
        NEW.id
      );
    END IF;

  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    NEW.confirmed_by := auth.uid();
    NEW.confirmed_at := NOW();
  END IF;
  RETURN NEW;
END;
$fn$;

-- ── 4. The receiving queue, now with source and quality ──────────────
-- Columns are APPENDED, never inserted mid-list: CREATE OR REPLACE VIEW
-- reads a column added in the middle as a rename of whatever already
-- sits at that position and fails. Same constraint migration 137 hit.
CREATE OR REPLACE VIEW v_stock_delivery_confirmations
WITH (security_invoker = true) AS
SELECT
  si.id AS stock_issue_id,
  si.stock_item_id,
  st.item_name AS stock_item_name,
  si.project_id,
  p.project_name,
  si.quantity AS quantity_dispatched,
  si.issued_date,
  si.transport_request_id,
  dc.id AS confirmation_id,
  dc.quantity_confirmed,
  dc.condition_notes,
  dc.confirmed_by,
  dc.confirmed_at,
  (dc.id IS NOT NULL) AS is_confirmed,
  (dc.id IS NOT NULL AND dc.quantity_confirmed IS DISTINCT FROM si.quantity) AS has_discrepancy,
  -- appended below this line
  dc.quality_status,
  si.stock_return_request_id,
  CASE WHEN si.stock_return_request_id IS NULL THEN 'warehouse_dispatch' ELSE 'project_transfer' END AS source_kind,
  srp.id   AS source_project_id,
  srp.project_name AS source_project_name
FROM stock_issues si
JOIN stock_items st ON st.id = si.stock_item_id
LEFT JOIN projects p ON p.id = si.project_id
LEFT JOIN stock_delivery_confirmations dc ON dc.stock_issue_id = si.id
LEFT JOIN stock_return_requests srr ON srr.id = si.stock_return_request_id
LEFT JOIN projects srp ON srp.id = srr.project_id
WHERE si.issue_type = 'project_use';

GRANT SELECT ON v_stock_delivery_confirmations TO authenticated;

-- ── 5. A GRN register ────────────────────────────────────────────────
-- Until now a GRN could only be reached by opening the purchase order
-- it belonged to (sourcing/:id) — there is no list of GRNs anywhere in
-- the app, so "what did we receive last week, and was any of it
-- rejected" had no answer short of a database query. One row per GRN
-- with its line count, quantity and the worst verdict on it, so a bad
-- delivery is visible without opening it.
CREATE OR REPLACE VIEW v_grn_register
WITH (security_invoker = true) AS
SELECT
  g.id,
  g.grn_code,
  g.received_at,
  g.sourcing_bundle_id,
  sb.bundle_code,
  COALESCE(v.vendor_name, sb.vendor_name) AS vendor_name,
  g.received_by,
  up.full_name AS received_by_name,
  g.photo_url,
  g.notes,
  count(gi.id)                                   AS line_count,
  COALESCE(SUM(gi.quantity_received), 0)         AS total_quantity_received,
  count(*) FILTER (WHERE gi.quality_status = 'damaged')  AS damaged_lines,
  count(*) FILTER (WHERE gi.quality_status = 'rejected') AS rejected_lines,
  -- Worst verdict on the note, so the register sorts and filters on the
  -- thing anyone actually looks for.
  CASE
    WHEN count(*) FILTER (WHERE gi.quality_status = 'rejected') > 0 THEN 'rejected'
    WHEN count(*) FILTER (WHERE gi.quality_status = 'damaged')  > 0 THEN 'damaged'
    ELSE 'accepted'
  END AS worst_quality,
  string_agg(DISTINCT c.category_name, ', ' ORDER BY c.category_name) AS ledgers
FROM goods_received_notes g
LEFT JOIN goods_received_note_items gi ON gi.grn_id = g.id
LEFT JOIN sourcing_bundles sb ON sb.id = g.sourcing_bundle_id
LEFT JOIN vendors v ON v.id = sb.vendor_id
LEFT JOIN user_profiles up ON up.id = g.received_by
LEFT JOIN categories c ON c.id = gi.category_id
GROUP BY g.id, g.grn_code, g.received_at, g.sourcing_bundle_id, sb.bundle_code,
         v.vendor_name, sb.vendor_name, g.received_by, up.full_name, g.photo_url, g.notes;

GRANT SELECT ON v_grn_register TO authenticated;

-- ── Verify ───────────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns
WHERE table_name = 'stock_delivery_confirmations' AND column_name = 'quality_status';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'stock_issues' AND column_name = 'stock_return_request_id';

SELECT viewname FROM pg_views WHERE viewname IN ('v_stock_delivery_confirmations', 'v_grn_register') ORDER BY viewname;

SELECT count(*) AS grns_in_register FROM v_grn_register;
